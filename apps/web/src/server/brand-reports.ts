/**
 * Brand analytics reports — periodic, LLM-narrated, two-page PDF over the
 * brand's own tracked runs / mentions / citations data.
 *
 * Rate limit: one report per brand per rolling 7 days (brands.lastReportGeneratedAt),
 * keyed to generation time, not the analyzed range. Any member generating starts
 * the brand's clock. Thin/empty ranges are blocked.
 *
 * Generation is synchronous (no reverse proxy in front of this deployment): the
 * digest is plain SQL, the single gpt-5-mini completion is ~10-25s.
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
const MIN_RUNS = 20; // below this a period has nothing worth reporting on

// ── period aggregation (plain SQL, self-contained) ──────────────────────

interface PeriodStats {
	from: string;
	to: string;
	totalRuns: number;
	totalPrompts: number;
	visibility: number | null; // % of answers that mention the brand
	nonBrandedVisibility: number | null;
	sovPct: number | null; // brand mentions / (brand + competitor mentions)
	perPrompt: { promptId: string; runs: number; mentionRate: number }[];
	perEngine: { engine: string; runs: number; mentionRate: number }[];
	competitors: { name: string; mentions: number }[];
	dailyVisibility: { date: string; visibility: number; runs: number }[];
	topDomains: { domain: string; count: number; category: string }[];
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
				round(avg(CASE WHEN brand_mentioned THEN 1 ELSE 0 END)::numeric, 4)::float AS mention_rate
			FROM prompt_runs WHERE ${inRange} GROUP BY prompt_id
		`)
	).rows as { prompt_id: string; runs: number; mention_rate: number }[];

	const perEngine = (
		await db.execute(sql`
			SELECT model AS engine, count(*)::int AS runs,
				round(avg(CASE WHEN brand_mentioned THEN 1 ELSE 0 END)::numeric, 4)::float AS mention_rate
			FROM prompt_runs WHERE ${inRange} GROUP BY model ORDER BY runs DESC
		`)
	).rows as { engine: string; runs: number; mention_rate: number }[];

	const competitors = (
		await db.execute(sql`
			SELECT c AS name, count(*)::int AS mentions
			FROM prompt_runs pr, unnest(pr.competitors_mentioned) AS c
			WHERE ${sql`pr.brand_id = ${brandId} AND pr.created_at >= ${rangeStart} AND pr.created_at < ${rangeEnd}`}
			GROUP BY c ORDER BY mentions DESC LIMIT 8
		`)
	).rows as { name: string; mentions: number }[];

	const dailyVisibility = (
		await db.execute(sql`
			SELECT (created_at AT TIME ZONE ${timezone})::date::text AS date,
				round(count(*) FILTER (WHERE brand_mentioned) * 100.0 / NULLIF(count(*), 0), 0)::int AS visibility,
				count(*)::int AS runs
			FROM prompt_runs WHERE ${inRange} GROUP BY 1 ORDER BY 1
		`)
	).rows as { date: string; visibility: number; runs: number }[];

	const domainRows = await getCitationDomainStats(brandId, from, to, timezone);
	const topDomains = domainRows.slice(0, 14).map((d) => ({
		domain: d.domain,
		count: d.count,
		category: categorizeDomain(extractDomain(d.domain), brandDomains, competitorDomains),
	}));

	const sovDenom = totals.brand_mentions + totals.competitor_mentions;
	return {
		from,
		to,
		totalRuns: totals.total_runs ?? 0,
		totalPrompts: totals.total_prompts ?? 0,
		visibility: totals.visibility,
		nonBrandedVisibility: totals.visibility,
		sovPct: sovDenom > 0 ? Math.round((totals.brand_mentions * 100) / sovDenom) : null,
		perPrompt,
		perEngine,
		competitors,
		dailyVisibility,
		topDomains,
	};
}

// ── digest assembly ────────────────────────────────────────────────────

function rank<T>(rows: T[], key: (r: T) => number, n: number) {
	const sorted = [...rows].sort((a, b) => key(b) - key(a));
	return { top: sorted.slice(0, n), bottom: sorted.slice(-n).reverse() };
}

function buildDigest(args: {
	brandName: string;
	promptText: Map<string, string>;
	main: PeriodStats;
	compare?: PeriodStats;
}) {
	const { promptText, main, compare } = args;
	const namePrompt = (p: { promptId: string; runs: number; mentionRate: number }) => ({
		prompt: promptText.get(p.promptId) ?? "(deleted prompt)",
		runs: p.runs,
		mentionRatePct: Math.round(p.mentionRate * 100),
	});
	const promptsRanked = rank(main.perPrompt.filter((p) => p.runs >= 3), (p) => p.mentionRate, 5);
	const enginesRanked = rank(main.perEngine.filter((e) => e.runs >= 3), (e) => e.mentionRate, 5);

	const delta = (now: number | null, then: number | null) =>
		now == null || then == null ? null : now - then;

	return {
		brand: args.brandName,
		comparisonMode: Boolean(compare),
		period: { from: main.from, to: main.to },
		comparePeriod: compare ? { from: compare.from, to: compare.to } : null,
		headlineMetrics: {
			visibilityPct: main.visibility,
			shareOfVoicePct: main.sovPct,
			totalRuns: main.totalRuns,
			trackedPrompts: main.totalPrompts,
			...(compare
				? {
						visibilityDeltaPts: delta(main.visibility, compare.visibility),
						shareOfVoiceDeltaPts: delta(main.sovPct, compare.sovPct),
						runsDelta: main.totalRuns - compare.totalRuns,
					}
				: {}),
		},
		prompts: {
			topByMentionRate: promptsRanked.top.map(namePrompt),
			bottomByMentionRate: promptsRanked.bottom.map(namePrompt),
		},
		engines: {
			best: enginesRanked.top.map((e) => ({ engine: e.engine, runs: e.runs, mentionRatePct: Math.round(e.mentionRate * 100) })),
			worst: enginesRanked.bottom.map((e) => ({ engine: e.engine, runs: e.runs, mentionRatePct: Math.round(e.mentionRate * 100) })),
		},
		competitors: main.competitors,
		citations: {
			topSources: main.topDomains,
			categoryMix: Object.entries(
				main.topDomains.reduce<Record<string, number>>((acc, d) => {
					acc[d.category] = (acc[d.category] ?? 0) + d.count;
					return acc;
				}, {}),
			)
				.map(([category, count]) => ({ category, count }))
				.sort((a, b) => b.count - a.count),
		},
		...(compare
			? {
					previousPeriod: {
						visibilityPct: compare.visibility,
						shareOfVoicePct: compare.sovPct,
						totalRuns: compare.totalRuns,
						topPrompts: rank(compare.perPrompt.filter((p) => p.runs >= 3), (p) => p.mentionRate, 3).top.map(namePrompt),
						engines: compare.perEngine.map((e) => ({ engine: e.engine, mentionRatePct: Math.round(e.mentionRate * 100) })),
						competitors: compare.competitors,
					},
				}
			: {}),
		charts: {
			dailyVisibility: main.dailyVisibility,
			compareDailyVisibility: compare?.dailyVisibility ?? null,
			engineMentionRate: main.perEngine.map((e) => ({ engine: e.engine, pct: Math.round(e.mentionRate * 100), runs: e.runs })),
			citationCategoryMix: main.topDomains.reduce<Record<string, number>>((acc, d) => {
				acc[d.category] = (acc[d.category] ?? 0) + d.count;
				return acc;
			}, {}),
		},
	};
}

export type ReportDigest = ReturnType<typeof buildDigest>;

// ── shared loader ──────────────────────────────────────────────────────

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

// ── server fns ─────────────────────────────────────────────────────────

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

		const [earliest] = await db.execute(sql`
			SELECT min(created_at) AS first FROM prompt_runs WHERE brand_id = ${data.brandId}
		`).then((r) => r.rows as { first: string | null }[]);

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

		// cooldown (server is source of truth)
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
		const noCompDomains = new Set<string>();

		const main = await periodStats(data.brandId, data.periodStart, data.periodEnd, timezone, brandDomains, noCompDomains);
		if (main.totalRuns < MIN_RUNS) {
			throw new Error(
				`Not enough data in ${fmtDate(data.periodStart)}–${fmtDate(data.periodEnd)} (${main.totalRuns} runs). Pick a wider range or a period with tracking data.`,
			);
		}
		const compare = compareOn
			? await periodStats(data.brandId, data.compareStart!, data.compareEnd!, timezone, brandDomains, noCompDomains)
			: undefined;

		const digest = buildDigest({ brandName: brand.name, promptText, main, compare });

		// lock the cooldown at initiation
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
			// refund the weekly allowance on failure
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
			periodLabel: `${fmtDate(row.periodStart)} \u2013 ${fmtDate(row.periodEnd)}`,
			compareLabel:
				row.compareStart && row.compareEnd ? `${fmtDate(row.compareStart)} \u2013 ${fmtDate(row.compareEnd)}` : null,
			createdAt: row.createdAt,
			digest: p.digest,
			narrative: p.narrative,
		};
	});
