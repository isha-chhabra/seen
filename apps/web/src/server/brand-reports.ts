/**
 * Brand analytics reports — periodic, LLM-narrated, client-facing PDF over the
 * brand's own tracked runs / mentions / citations data, framed for affiliate
 * marketing.
 *
 * Rate limit: one report per brand per rolling 7 days (brands.lastReportGeneratedAt),
 * keyed to generation time, not the analyzed range. Any member generating starts
 * the brand's clock. Thin/empty ranges are blocked.
 *
 * Generation is synchronous (no reverse proxy in front of this deployment): the
 * digest is plain SQL, the single gpt-5-mini completion is ~15-30s.
 */
import { createServerFn } from "@tanstack/react-start";
import { db } from "@workspace/lib/db/db";
import { brandReports, brands, prompts } from "@workspace/lib/db/schema";
import { generateReportNarrative } from "@workspace/lib/report/narrative";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireBrandAccess } from "@/lib/auth/helpers";
import { extractDomain } from "@/lib/domain-categories";
import { categorizeDomain } from "@/lib/domain-categories.server";
import { getCitationDomainStats } from "@/lib/postgres-read";
import { resolveTimezone } from "@/lib/timezone-utils";

const COOLDOWN_DAYS = 7;
const MIN_RUNS = 20;

const ENGINE_LABEL: Record<string, string> = {
	chatgpt: "ChatGPT",
	gemini: "Gemini",
	perplexity: "Perplexity",
	"google-ai-mode": "Google AI Mode",
	"google-ai-overview": "Google AI Overview",
	"claude": "Claude",
	"copilot": "Microsoft Copilot",
};
const CATEGORY_LABEL: Record<string, string> = {
	affiliate: "Affiliate / roundup",
	editorial: "Editorial",
	reviews: "Reviews",
	ecommerce: "Retailer",
	social: "Community",
	reference: "Reference",
	institutional: "Institutional",
	developer: "Developer",
	pr: "PR / news",
	brand: "The brand's own site",
	competitor: "A competitor's site",
	other: "Other",
};

interface PeriodStats {
	from: string;
	to: string;
	totalRuns: number;
	totalPrompts: number;
	visibility: number | null;
	sovPct: number | null;
	perPrompt: { promptId: string; runs: number; mentionRate: number }[];
	perPromptTopCompetitor: Map<string, string>;
	competitorOnlyPromptIds: string[];
	perEngine: { engine: string; runs: number; mentionRate: number }[];
	competitors: { name: string; mentions: number }[];
	dailyVisibility: { date: string; visibility: number }[];
	sources: { domain: string; count: number; category: string; exampleTitle: string | null }[];
}

async function periodStats(
	brandId: string,
	from: string,
	to: string,
	timezone: string,
	brandDomains: Set<string>,
	competitorDomains: Set<string>,
): Promise<PeriodStats> {
	const rangeStart = sql`(${from}::date AT TIME ZONE ${timezone})`;
	const rangeEnd = sql`((${to}::date + interval '1 day') AT TIME ZONE ${timezone})`;
	const inRange = sql`brand_id = ${brandId} AND created_at >= ${rangeStart} AND created_at < ${rangeEnd}`;

	const totals = (
		await db.execute(sql`
			SELECT
				count(*)::int AS total_runs,
				count(DISTINCT prompt_id)::int AS total_prompts,
				round(count(*) FILTER (WHERE brand_mentioned) * 100.0 / NULLIF(count(*), 0), 0)::int AS visibility,
				count(*) FILTER (WHERE brand_mentioned)::int AS brand_mentions,
				COALESCE(sum(cardinality(competitors_mentioned)), 0)::int AS competitor_mentions
			FROM prompt_runs WHERE ${inRange}
		`)
	).rows[0] as {
		total_runs: number;
		total_prompts: number;
		visibility: number | null;
		brand_mentions: number;
		competitor_mentions: number;
	};

	const perPrompt = (
		await db.execute(sql`
			SELECT prompt_id::text AS prompt_id, count(*)::int AS runs,
				round(avg(CASE WHEN brand_mentioned THEN 1 ELSE 0 END)::numeric, 4)::float AS mention_rate,
				count(*) FILTER (WHERE NOT brand_mentioned AND cardinality(competitors_mentioned) > 0)::int AS comp_only
			FROM prompt_runs WHERE ${inRange} GROUP BY prompt_id
		`)
	).rows as { prompt_id: string; runs: number; mention_rate: number; comp_only: number }[];

	const perEngine = (
		await db.execute(sql`
			SELECT model AS engine, count(*)::int AS runs,
				round(avg(CASE WHEN brand_mentioned THEN 1 ELSE 0 END)::numeric, 4)::float AS mention_rate
			FROM prompt_runs WHERE ${inRange} GROUP BY model ORDER BY runs DESC
		`)
	).rows as { engine: string; runs: number; mention_rate: number }[];

	const competitorRows = (
		await db.execute(sql`
			SELECT pr.prompt_id::text AS prompt_id, c AS name, count(*)::int AS mentions
			FROM prompt_runs pr, unnest(pr.competitors_mentioned) AS c
			WHERE pr.brand_id = ${brandId} AND pr.created_at >= ${rangeStart} AND pr.created_at < ${rangeEnd}
			GROUP BY pr.prompt_id, c
		`)
	).rows as { prompt_id: string; name: string; mentions: number }[];

	const perPromptTopCompetitor = new Map<string, string>();
	const competitorTotals = new Map<string, number>();
	for (const r of competitorRows) {
		competitorTotals.set(r.name, (competitorTotals.get(r.name) ?? 0) + r.mentions);
		const cur = perPromptTopCompetitor.get(r.prompt_id);
		if (!cur || r.mentions > (competitorRows.find((x) => x.prompt_id === r.prompt_id && x.name === cur)?.mentions ?? 0)) {
			perPromptTopCompetitor.set(r.prompt_id, r.name);
		}
	}
	const competitors = [...competitorTotals.entries()]
		.map(([name, mentions]) => ({ name, mentions }))
		.sort((a, b) => b.mentions - a.mentions)
		.slice(0, 8);

	const dailyVisibility = (
		await db.execute(sql`
			SELECT (created_at AT TIME ZONE ${timezone})::date::text AS date,
				round(count(*) FILTER (WHERE brand_mentioned) * 100.0 / NULLIF(count(*), 0), 0)::int AS visibility
			FROM prompt_runs WHERE ${inRange} GROUP BY 1 ORDER BY 1
		`)
	).rows as { date: string; visibility: number }[];

	const domainRows = await getCitationDomainStats(brandId, from, to, timezone);
	const sources = domainRows.slice(0, 16).map((d) => ({
		domain: d.domain,
		count: d.count,
		category: categorizeDomain(extractDomain(d.domain), brandDomains, competitorDomains),
		exampleTitle: (d as { example_title?: string | null }).example_title ?? null,
	}));

	const sovDenom = totals.brand_mentions + totals.competitor_mentions;
	return {
		from,
		to,
		totalRuns: totals.total_runs ?? 0,
		totalPrompts: totals.total_prompts ?? 0,
		visibility: totals.visibility,
		sovPct: sovDenom > 0 ? Math.round((totals.brand_mentions * 100) / sovDenom) : null,
		perPrompt: perPrompt.map(({ prompt_id, runs, mention_rate }) => ({ promptId: prompt_id, runs, mentionRate: mention_rate })),
		perPromptTopCompetitor,
		competitorOnlyPromptIds: perPrompt.filter((p) => p.runs >= 3 && p.comp_only / p.runs >= 0.5).map((p) => p.prompt_id),
		perEngine,
		competitors,
		dailyVisibility,
		sources,
	};
}

function buildDigest(args: {
	brandName: string;
	promptText: Map<string, string>;
	main: PeriodStats;
	compare?: PeriodStats;
}) {
	const { brandName, promptText, main, compare } = args;
	const q = (id: string) => promptText.get(id) ?? "(a tracked question)";
	const pct = (r: number) => Math.round(r * 100);

	const scored = main.perPrompt.filter((p) => p.runs >= 3).sort((a, b) => b.mentionRate - a.mentionRate);
	const winning = scored
		.filter((p) => p.mentionRate >= 0.5)
		.slice(0, 6)
		.map((p) => ({ question: q(p.promptId), recommendedRate: `${pct(p.mentionRate)}%`, runs: p.runs }));
	const losing = scored
		.filter((p) => p.mentionRate < 0.5)
		.slice(-6)
		.reverse()
		.map((p) => ({
			question: q(p.promptId),
			recommendedRate: `${pct(p.mentionRate)}%`,
			runs: p.runs,
			aiRecommendsInstead: main.perPromptTopCompetitor.get(p.promptId) ?? null,
		}));

	const engines = main.perEngine
		.filter((e) => e.runs >= 3)
		.map((e) => ({ assistant: ENGINE_LABEL[e.engine] ?? e.engine, recommendedRate: `${pct(e.mentionRate)}%`, answersChecked: e.runs }))
		.sort((a, b) => Number.parseInt(b.recommendedRate) - Number.parseInt(a.recommendedRate));

	const sourceTotal = main.sources.reduce((s, d) => s + d.count, 0) || 1;
	const affiliateCount = main.sources.filter((d) => d.category === "affiliate").reduce((s, d) => s + d.count, 0);
	const bucket = main.sources.reduce<Record<string, number>>((acc, d) => {
		acc[CATEGORY_LABEL[d.category] ?? d.category] = (acc[CATEGORY_LABEL[d.category] ?? d.category] ?? 0) + d.count;
		return acc;
	}, {});

	const competitorOnly = main.competitorOnlyPromptIds
		.slice(0, 6)
		.map((id) => ({ question: q(id), aiRecommends: main.perPromptTopCompetitor.get(id) ?? "competitors" }));

	const delta = (a: number | null, b: number | null) => (a == null || b == null ? null : a - b);

	return {
		brand: brandName,
		period: { from: main.from, to: main.to },
		comparisonMode: Boolean(compare),
		comparePeriod: compare ? { from: compare.from, to: compare.to } : null,
		headline: {
			aiRecommendationRatePct: main.visibility,
			shareOfCategoryPct: main.sovPct,
			aiAnswersChecked: main.totalRuns,
			buyingQuestionsTracked: main.totalPrompts,
			...(compare
				? {
						recommendationRateChangePts: delta(main.visibility, compare.visibility),
						shareOfCategoryChangePts: delta(main.sovPct, compare.sovPct),
					}
				: {}),
		},
		buyingQuestions: {
			aiRecommendsBrand: winning,
			aiLeavesBrandOut: losing,
			questionsWhereOnlyCompetitorsAppear: competitorOnly,
		},
		aiAssistants: engines,
		competitorsAiRecommends: main.competitors.map((c) => ({ name: c.name, timesRecommended: c.mentions })),
		sourcesAiReliesOn: {
			total: sourceTotal,
			affiliateSharePct: Math.round((affiliateCount / sourceTotal) * 100),
			byType: Object.entries(bucket)
				.map(([type, count]) => ({ type, sharePct: Math.round((count / sourceTotal) * 100) }))
				.sort((a, b) => b.sharePct - a.sharePct),
			topSites: main.sources.slice(0, 10).map((d) => ({
				site: d.domain,
				type: CATEGORY_LABEL[d.category] ?? d.category,
				timesUsed: d.count,
				examplePage: d.exampleTitle,
			})),
		},
		...(compare
			? {
					previousPeriod: {
						aiRecommendationRatePct: compare.visibility,
						shareOfCategoryPct: compare.sovPct,
						topQuestions: compare.perPrompt
							.filter((p) => p.runs >= 3)
							.sort((a, b) => b.mentionRate - a.mentionRate)
							.slice(0, 4)
							.map((p) => ({ question: q(p.promptId), recommendedRate: `${pct(p.mentionRate)}%` })),
						competitors: compare.competitors.map((c) => ({ name: c.name, timesRecommended: c.mentions })),
					},
				}
			: {}),
		charts: {
			dailyRecommendationRate: main.dailyVisibility.map((d) => ({ date: d.date, rate: d.visibility })),
			byAssistant: engines.map((e) => ({ assistant: e.assistant, rate: Number.parseInt(e.recommendedRate) })),
			sourceMix: main.sources.reduce<Record<string, number>>((acc, d) => {
				const k = CATEGORY_LABEL[d.category] ?? d.category;
				acc[k] = (acc[k] ?? 0) + d.count;
				return acc;
			}, {}),
		},
	};
}

export type ReportDigest = ReturnType<typeof buildDigest>;

async function loadBrandContext(brandId: string) {
	const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
	if (!brand) throw new Error("Brand not found");
	const promptRows = await db
		.select({ id: prompts.id, value: prompts.value })
		.from(prompts)
		.where(and(eq(prompts.brandId, brandId), eq(prompts.enabled, true)));
	const promptText = new Map(promptRows.map((p) => [p.id, p.value]));
	const brandDomains = new Set(
		[brand.website, ...(brand.additionalDomains ?? [])].map((d) => extractDomain(d)).filter(Boolean),
	);
	return { brand, promptText, brandDomains };
}

function fmtDate(iso: string) {
	return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const getReportAvailabilityFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1) }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireBrandAccess(session.user.id, data.brandId);
		const [row] = await db
			.select({ last: brands.lastReportGeneratedAt })
			.from(brands)
			.where(eq(brands.id, data.brandId))
			.limit(1);
		const last = row?.last ? new Date(row.last) : null;
		const nextAvailableAt = last ? new Date(last.getTime() + COOLDOWN_DAYS * 86400_000) : null;
		const canGenerate = !nextAvailableAt || nextAvailableAt.getTime() <= Date.now();
		const [earliest] = await db
			.execute(sql`SELECT min(created_at) AS first FROM prompt_runs WHERE brand_id = ${data.brandId}`)
			.then((r) => r.rows as { first: string | null }[]);
		return {
			canGenerate,
			nextAvailableAt: nextAvailableAt ? nextAvailableAt.toISOString() : null,
			earliestDataAt: earliest?.first ?? null,
		};
	});

export const generateBrandReportFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			name: z.string().trim().min(1).max(120),
			periodStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
			periodEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
			compareStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
			compareEnd: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireBrandAccess(session.user.id, data.brandId);
		const timezone = resolveTimezone();

		const [brandRow] = await db
			.select({ last: brands.lastReportGeneratedAt })
			.from(brands)
			.where(eq(brands.id, data.brandId))
			.limit(1);
		const last = brandRow?.last ? new Date(brandRow.last) : null;
		if (last && last.getTime() + COOLDOWN_DAYS * 86400_000 > Date.now()) {
			throw new Error("A report was already generated for this brand in the last 7 days.");
		}

		const compareOn = Boolean(data.compareStart && data.compareEnd);
		const { brand, promptText, brandDomains } = await loadBrandContext(data.brandId);
		const noComp = new Set<string>();

		const main = await periodStats(data.brandId, data.periodStart, data.periodEnd, timezone, brandDomains, noComp);
		if (main.totalRuns < MIN_RUNS) {
			throw new Error(
				`Not enough data in ${fmtDate(data.periodStart)}–${fmtDate(data.periodEnd)} (${main.totalRuns} AI answers). Pick a wider range or a period with tracking data.`,
			);
		}
		const compare = compareOn
			? await periodStats(data.brandId, data.compareStart!, data.compareEnd!, timezone, brandDomains, noComp)
			: undefined;

		const digest = buildDigest({ brandName: brand.name, promptText, main, compare });

		await db.update(brands).set({ lastReportGeneratedAt: new Date() }).where(eq(brands.id, data.brandId));

		const [report] = await db
			.insert(brandReports)
			.values({
				brandId: data.brandId,
				name: data.name.trim(),
				periodStart: data.periodStart,
				periodEnd: data.periodEnd,
				compareStart: data.compareStart ?? null,
				compareEnd: data.compareEnd ?? null,
				status: "processing",
				payload: { digest },
			})
			.returning({ id: brandReports.id });

		try {
			const periodLabel = `${fmtDate(data.periodStart)} – ${fmtDate(data.periodEnd)}`;
			const compareLabel = compareOn ? `${fmtDate(data.compareStart!)} – ${fmtDate(data.compareEnd!)}` : undefined;
			const narrative = await generateReportNarrative({ brandName: brand.name, periodLabel, compareLabel, digest });
			await db
				.update(brandReports)
				.set({ status: "done", completedAt: new Date(), payload: { digest, narrative } })
				.where(eq(brandReports.id, report.id));
			return {
				reportId: report.id,
				brandName: brand.name,
				name: data.name.trim(),
				periodLabel,
				compareLabel: compareLabel ?? null,
				digest,
				narrative,
			};
		} catch (err) {
			await db.update(brands).set({ lastReportGeneratedAt: last ?? null }).where(eq(brands.id, data.brandId));
			await db
				.update(brandReports)
				.set({ status: "failed", error: err instanceof Error ? err.message : "narrative generation failed" })
				.where(eq(brandReports.id, report.id));
			throw new Error("The report's written analysis could not be generated. Your weekly allowance was not used — try again.");
		}
	});

export const getLatestBrandReportFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1) }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireBrandAccess(session.user.id, data.brandId);
		const [row] = await db
			.select()
			.from(brandReports)
			.where(and(eq(brandReports.brandId, data.brandId), eq(brandReports.status, "done")))
			.orderBy(desc(brandReports.createdAt))
			.limit(1);
		if (!row || !row.payload) return null;
		const p = row.payload as { digest: unknown; narrative: unknown };
		const [brand] = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, data.brandId)).limit(1);
		return {
			name: row.name,
			brandName: brand?.name ?? "Brand",
			periodLabel: `${fmtDate(row.periodStart)} – ${fmtDate(row.periodEnd)}`,
			compareLabel:
				row.compareStart && row.compareEnd ? `${fmtDate(row.compareStart)} – ${fmtDate(row.compareEnd)}` : null,
			createdAt: row.createdAt,
			digest: p.digest,
			narrative: p.narrative,
		};
	});
