/**
 * Article Finder — stateless per-search server functions.
 *
 * 1. generateArticleQueriesFn — LLM expands a free-text content direction into
 *    concrete Google queries. Returned to the UI for review before anything runs.
 * 2. findArticlesFn — runs the chosen queries through BrightData SERP, dedupes,
 *    keeps likely affiliate-monetized publishers (free URL/domain check first,
 *    then a page-HTML signal scan on the survivors), and has the LLM write a
 *    one-line fit rationale per article.
 *
 * Hard caps keep the worst-case cost of one run bounded (~$0.30-0.60):
 * <=8 queries, <=5 pages/query, <=40 page fetches. A short in-process debounce
 * per brand guards against accidental double-runs — no persistence, no history.
 */
import { createServerFn } from "@tanstack/react-start";
import {
	extractReadableText,
	googleSerp,
	scanHtmlForAffiliateSignals,
	unlockerFetchHtml,
} from "@workspace/lib/article-finder/search";
import { db } from "@workspace/lib/db/db";
import { brands, competitors } from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { generateSearchQueries, reasonAboutArticles } from "@workspace/lib/article-finder/llm";
import { requireAuthSession, requireBrandAccess } from "@/lib/auth/helpers";
import { extractDomain, isAffiliateRedirectHost, isAffiliateUrl } from "@/lib/domain-categories";
import { isAffiliatePublisherDomain } from "@/lib/domain-categories.server";

const MAX_QUERIES = 8;
const MAX_PAGES = 5;
const MAX_FETCHES = 40;
const SERP_CONCURRENCY = 6;
const FETCH_CONCURRENCY = 8;
const DEBOUNCE_MS = 45_000;

/** Domains that never hold a pitchable editorial article. */
const JUNK_DOMAINS = new Set([
	"google.com",
	"google.co.uk",
	"youtube.com",
	"youtu.be",
	"facebook.com",
	"instagram.com",
	"twitter.com",
	"x.com",
	"tiktok.com",
	"pinterest.com",
	"reddit.com",
	"linkedin.com",
	"quora.com",
	"wikipedia.org",
	"amazon.com",
	"amazon.co.uk",
	"ebay.com",
	"walmart.com",
	"target.com",
	"etsy.com",
	"aliexpress.com",
	"tripadvisor.com",
	"yelp.com",
	"glassdoor.com",
	"indeed.com",
	"apple.com",
	"play.google.com",
]);

const lastRunByBrand = new Map<string, number>();

const ymdRe = /^\d{4}-\d{2}-\d{2}$/;

function inJunkDomain(domain: string): boolean {
	if (JUNK_DOMAINS.has(domain)) return true;
	for (const j of JUNK_DOMAINS) if (domain.endsWith(`.${j}`)) return true;
	return false;
}

function normalizeUrlKey(url: string): string {
	try {
		const u = new URL(url);
		return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
	} catch {
		return "";
	}
}

function dedupeLower(values: (string | null | undefined)[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const v of values) {
		const t = (v ?? "").trim().toLowerCase();
		if (t && !seen.has(t)) {
			seen.add(t);
			out.push(t);
		}
	}
	return out;
}

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
	const out = new Array<R>(items.length);
	let cursor = 0;
	const workers = Array.from({ length: Math.min(concurrency, items.length || 1) }, async () => {
		while (true) {
			const i = cursor++;
			if (i >= items.length) return;
			out[i] = await fn(items[i]!, i);
		}
	});
	await Promise.all(workers);
	return out;
}

// ── 1. query generation ─────────────────────────────────────────────

export const generateArticleQueriesFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			direction: z.string().trim().min(3).max(500),
			from: z.string().regex(ymdRe),
			to: z.string().regex(ymdRe),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireBrandAccess(session.user.id, data.brandId);

		const [brand] = await db.select().from(brands).where(eq(brands.id, data.brandId)).limit(1);
		if (!brand) throw new Error("Brand not found");
		const comps = await db.select({ name: competitors.name }).from(competitors).where(eq(competitors.brandId, data.brandId));

		const queries = await generateSearchQueries({
			brandName: brand.name,
			brandWebsite: brand.website,
			competitors: comps.map((c) => c.name).filter(Boolean),
			direction: data.direction,
			rangeLabel: `${data.from} to ${data.to}`,
		});
		return { queries: queries.slice(0, MAX_QUERIES) };
	});

// ── 2. search + filter + reason ─────────────────────────────────────

export interface ArticleResult {
	title: string;
	url: string;
	domain: string;
	reasoning: string;
	signals: string[];
	competitorsMentioned: string[];
	brandAlreadyMentioned: boolean;
	query: string;
}

export const findArticlesFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			queries: z
				.array(z.object({ query: z.string().trim().min(1).max(300), angle: z.string().max(120).optional() }))
				.min(1)
				.max(MAX_QUERIES),
			from: z.string().regex(ymdRe),
			to: z.string().regex(ymdRe),
			pagesPerSearch: z.number().int().min(1).max(MAX_PAGES),
		}),
	)
	.handler(async ({ data }): Promise<{ results: ArticleResult[]; stats: Record<string, number> }> => {
		const session = await requireAuthSession();
		await requireBrandAccess(session.user.id, data.brandId);

		const now = Date.now();
		if (now - (lastRunByBrand.get(data.brandId) ?? 0) < DEBOUNCE_MS) {
			throw new Error("A search for this brand just ran — give it a moment and try again.");
		}
		lastRunByBrand.set(data.brandId, now);

		const [brand] = await db.select().from(brands).where(eq(brands.id, data.brandId)).limit(1);
		if (!brand) throw new Error("Brand not found");
		const comps = await db.select().from(competitors).where(eq(competitors.brandId, data.brandId));

		const competitorNames = comps.map((c) => c.name).filter(Boolean);
		const compTermsByName = comps
			.filter((c) => c.name)
			.map((c) => ({ name: c.name, terms: dedupeLower([c.name, ...(c.aliases ?? [])]).filter((t) => t.length >= 3) }));
		const brandTerms = dedupeLower([brand.name, ...(brand.aliases ?? [])]).filter((t) => t.length >= 3);
		const brandDomains = new Set(
			[brand.website, ...(brand.additionalDomains ?? [])].map((d) => extractDomain(d)).filter(Boolean),
		);

		// 1. SERP fan-out
		const queries = data.queries.slice(0, MAX_QUERIES);
		const serpTasks: { query: string; page: number }[] = [];
		for (const q of queries) {
			for (let p = 0; p < data.pagesPerSearch; p++) serpTasks.push({ query: q.query, page: p });
		}
		const serpBatches = await mapPool(serpTasks, SERP_CONCURRENCY, (t) =>
			googleSerp(t.query, t.page, { from: data.from, to: data.to }).then((rows) =>
				rows.map((r) => ({ ...r, query: t.query })),
			),
		);

		// 2. dedupe + drop junk / the brand's own site
		const seen = new Set<string>();
		let candidates = serpBatches.flat().filter((row) => {
			const key = normalizeUrlKey(row.url);
			if (!key || seen.has(key)) return false;
			const domain = extractDomain(row.url);
			if (!domain || inJunkDomain(domain) || brandDomains.has(domain)) return false;
			seen.add(key);
			return true;
		});
		candidates.sort((a, b) => a.rank - b.rank);

		// 3. free affiliate pre-filter — known publishers / redirect hosts / tagged URLs first
		const known: typeof candidates = [];
		const rest: typeof candidates = [];
		for (const c of candidates) {
			const domain = extractDomain(c.url);
			if (isAffiliateUrl(c.url) || isAffiliateRedirectHost(domain) || isAffiliatePublisherDomain(domain)) known.push(c);
			else rest.push(c);
		}
		const toFetch = [...known, ...rest].slice(0, MAX_FETCHES);

		// 4. fetch survivors + scan page HTML for affiliate signals
		const fetched = await mapPool(toFetch, FETCH_CONCURRENCY, async (c) => {
			const domain = extractDomain(c.url);
			const domainKnown =
				isAffiliatePublisherDomain(domain) || isAffiliateRedirectHost(domain) || isAffiliateUrl(c.url);
			const html = await unlockerFetchHtml(c.url).catch(() => null);
			if (!html) {
				// couldn't fetch — keep only if the domain itself is a known affiliate publisher
				if (!domainKnown) return null;
				return {
					url: c.url,
					title: c.title,
					query: c.query,
					domain,
					excerpt: c.snippet,
					signals: ["known affiliate publisher"],
					competitorsMentioned: [] as string[],
					brandAlreadyMentioned: false,
				};
			}
			const signals = scanHtmlForAffiliateSignals(html);
			if (!domainKnown && signals.score < 1) return null;

			const text = extractReadableText(html) || c.snippet;
			const haystack = `${c.title}\n${text}`.toLowerCase();
			return {
				url: c.url,
				title: c.title,
				query: c.query,
				domain,
				excerpt: text.slice(0, 1500),
				signals: domainKnown ? ["known affiliate publisher", ...signals.labels] : signals.labels,
				competitorsMentioned: compTermsByName
					.filter((c) => c.terms.some((t) => haystack.includes(t)))
					.map((c) => c.name),
				brandAlreadyMentioned: brandTerms.some((t) => haystack.includes(t)),
			};
		});
		const survivors = fetched.filter((x): x is NonNullable<typeof x> => x !== null);

		// 5. one batched LLM call for fit rationales (fall back to a plain line on failure)
		let reasonByUrl = new Map<string, string>();
		try {
			const fits = await reasonAboutArticles({
				brandName: brand.name,
				brandWebsite: brand.website,
				competitors: competitorNames,
				articles: survivors.map((s) => ({
					url: s.url,
					title: s.title,
					excerpt: s.excerpt,
					competitorsMentioned: s.competitorsMentioned,
				})),
			});
			reasonByUrl = new Map(fits.map((f) => [f.url, f.reasoning.trim()]));
		} catch {
			// leave the map empty; fallbackReasoning covers every row
		}

		const results: ArticleResult[] = survivors.map((s) => ({
			title: s.title,
			url: s.url,
			domain: s.domain,
			reasoning:
				reasonByUrl.get(s.url) ||
				(s.competitorsMentioned.length > 0
					? `Mentions ${s.competitorsMentioned.join(", ")} — a natural place to pitch ${brand.name} alongside them.`
					: `${s.domain} publishes affiliate roundups in this space; topically a fit for ${brand.name}.`),
			signals: dedupeLower(s.signals),
			competitorsMentioned: s.competitorsMentioned,
			brandAlreadyMentioned: s.brandAlreadyMentioned,
			query: s.query,
		}));

		return {
			results,
			stats: {
				queries: queries.length,
				serpRequests: serpTasks.length,
				candidates: candidates.length,
				pagesFetched: toFetch.length,
				matched: results.length,
			},
		};
	});
