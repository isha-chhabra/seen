/**
 * Article Finder — stateless per-search server functions.
 *
 * 1. generateArticleQueriesFn — LLM expands a free-text direction into concrete
 *    US-editorial Google queries, grounded in an excerpt of the brand's own site.
 *    Returned to the UI for review before anything runs.
 * 2. findArticlesFn — runs the chosen queries through BrightData SERP, then:
 *      dedupe -> drop junk / aggregators / foreign ccTLDs / the brand's own site
 *      -> collapse syndicated (same headline across domains)
 *      -> cheap LLM triage on title+snippet
 *      -> fetch survivors, scan page HTML for affiliate signals, drop pure
 *         retailers and disclosure-only pages
 *      -> LLM vetting pass: relevance, affiliate-editorial fit, authority tier,
 *         US focus, and a one-line "would the editor feature us" verdict
 *      -> split into high-authority vs niche/blog.
 *
 * Hard caps keep one run bounded (~$0.15-0.35): <=8 queries, <=5 pages/query,
 * <=36 page fetches. A short in-process debounce per brand guards against
 * accidental double-runs. The latest run per brand is persisted so re-opening
 * the tab shows it for free (getLatestArticleSearchFn) — a new search is a
 * deliberate click.
 */
import { createServerFn } from "@tanstack/react-start";
import { generateSearchQueries, judgeArticles, triageCandidates } from "@workspace/lib/article-finder/llm";
import {
	extractContactHint,
	extractPublishDate,
	extractReadableText,
	googleSerp,
	scanHtmlForAffiliateSignals,
	unlockerFetchHtml,
} from "@workspace/lib/article-finder/search";
import { db } from "@workspace/lib/db/db";
import { brandArticleSearches, brands, competitors, prompts } from "@workspace/lib/db/schema";
import { getWebsiteExcerpt } from "@workspace/lib/website-excerpt";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireBrandAccess } from "@/lib/auth/helpers";
import { extractDomain, isAffiliateRedirectHost, isAffiliateUrl } from "@/lib/domain-categories";
import { isAffiliatePublisherDomain, isEcommerceDomain, isPrWireDomain } from "@/lib/domain-categories.server";

const MAX_QUERIES = 8;
const MAX_PAGES = 5;
const MAX_FETCHES = 36;
const TRIAGE_INPUT_CAP = 120;
const SERP_CONCURRENCY = 6;
const FETCH_CONCURRENCY = 8;
const DEBOUNCE_MS = 45_000;

/** Never an editorial article we can pitch: search/social/video, marketplaces,
 *  retailers, Q&A, and newswire / headline aggregators (the syndication source). */
const JUNK_DOMAINS = new Set([
	"google.com",
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
	"ebay.com",
	"walmart.com",
	"target.com",
	"bestbuy.com",
	"etsy.com",
	"aliexpress.com",
	"temu.com",
	"tripadvisor.com",
	"yelp.com",
	"glassdoor.com",
	"indeed.com",
	"apple.com",
	"play.google.com",
	// aggregators / newswire — the usual syndication carriers
	"yahoo.com",
	"news.yahoo.com",
	"msn.com",
	"aol.com",
	"news.google.com",
	"flipboard.com",
	"smartnews.com",
	"apple.news",
	"newsbreak.com",
	"patch.com",
	"benzinga.com",
	"marketbeat.com",
	"stocktitan.net",
	"globenewswire.com",
	"prnewswire.com",
	"businesswire.com",
	"prweb.com",
	"einnews.com",
	"accesswire.com",
	"digitaljournal.com",
	"streetinsider.com",
	"markets.businessinsider.com",
]);

/** ccTLDs / editions we treat as non-US for this feature. */
const NON_US_SUFFIXES = [
	".co.uk",
	".uk",
	".com.au",
	".au",
	".co.nz",
	".nz",
	".ca",
	".ie",
	".co.za",
	".co.in",
	".in",
	".sg",
	".com.sg",
	".my",
	".ph",
	".ng",
	".pk",
	".eu",
	".de",
	".fr",
	".es",
	".it",
	".nl",
];

/** Large well-known US publications (and verticals) -> "high authority". Everything
 *  else that survives vetting is "niche / blog". Kept deliberately tight. */
const MAJOR_PUBLISHERS = new Set([
	"nytimes.com",
	"nytimes.com/wirecutter",
	"wsj.com",
	"washingtonpost.com",
	"usatoday.com",
	"forbes.com",
	"cnn.com",
	"cnbc.com",
	"time.com",
	"people.com",
	"cnet.com",
	"wired.com",
	"theverge.com",
	"engadget.com",
	"techradar.com",
	"tomsguide.com",
	"tomshardware.com",
	"pcmag.com",
	"gizmodo.com",
	"mashable.com",
	"digitaltrends.com",
	"businessinsider.com",
	"buzzfeed.com",
	"buzzfeednews.com",
	"popsci.com",
	"popularmechanics.com",
	"goodhousekeeping.com",
	"realsimple.com",
	"marthastewart.com",
	"foodandwine.com",
	"bonappetit.com",
	"epicurious.com",
	"seriouseats.com",
	"allrecipes.com",
	"thespruce.com",
	"thespruceeats.com",
	"thekitchn.com",
	"tasteofhome.com",
	"delish.com",
	"eatingwell.com",
	"cookinglight.com",
	"travelandleisure.com",
	"cntraveler.com",
	"afar.com",
	"outsideonline.com",
	"rei.com/blog",
	"gearpatrol.com",
	"menshealth.com",
	"womenshealthmag.com",
	"self.com",
	"health.com",
	"prevention.com",
	"parents.com",
	"thebump.com",
	"verywellfamily.com",
	"rollingstone.com",
	"variety.com",
	"esquire.com",
	"gq.com",
	"vogue.com",
	"elle.com",
	"harpersbazaar.com",
	"allure.com",
	"cosmopolitan.com",
	"refinery29.com",
	"apartmenttherapy.com",
	"housebeautiful.com",
	"elledecor.com",
	"architecturaldigest.com",
	"bhg.com",
	"southernliving.com",
	"realhomes.com",
	"thisoldhouse.com",
	"familyhandyman.com",
	"nbcnews.com",
	"today.com",
	"abcnews.go.com",
	"cbsnews.com",
	"reviewed.com",
	"rtings.com",
	"consumerreports.org",
	"nymag.com",
	"thestrategist.com",
	"vulture.com",
	"slate.com",
	"theatlantic.com",
	"vanityfair.com",
	"lifehacker.com",
	"si.com",
	"golfdigest.com",
	"runnersworld.com",
	"bicycling.com",
	"cleaneatingmag.com",
]);

const lastRunByBrand = new Map<string, number>();
const ymdRe = /^\d{4}-\d{2}-\d{2}$/;

function inJunkDomain(domain: string): boolean {
	if (JUNK_DOMAINS.has(domain)) return true;
	for (const j of JUNK_DOMAINS) if (domain.endsWith(`.${j}`)) return true;
	return false;
}

function isNonUsDomain(domain: string): boolean {
	return NON_US_SUFFIXES.some((s) => domain === s.slice(1) || domain.endsWith(s));
}

function isMajorPublisher(domain: string, url: string): boolean {
	if (MAJOR_PUBLISHERS.has(domain)) return true;
	const path = safePath(url);
	for (const p of MAJOR_PUBLISHERS) {
		if (p.includes("/") && `${domain}${path}`.startsWith(p)) return true;
	}
	return false;
}

function safePath(url: string): string {
	try {
		return new URL(url).pathname.toLowerCase();
	} catch {
		return "";
	}
}

function normalizeUrlKey(url: string): string {
	try {
		const u = new URL(url);
		return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`.toLowerCase();
	} catch {
		return "";
	}
}

function normalizeTitleKey(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9 ]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 90);
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
		const trackedRows = await db
			.select({ value: prompts.value })
			.from(prompts)
			.where(and(eq(prompts.brandId, data.brandId), eq(prompts.enabled, true)))
			.limit(12);
		const brandSummary = (await getWebsiteExcerpt(brand.website).catch(() => ""))
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, 700);

		const queries = await generateSearchQueries({
			brandName: brand.name,
			brandWebsite: brand.website,
			brandSummary,
			competitors: comps.map((c) => c.name).filter(Boolean),
			trackedTopics: trackedRows.map((r) => r.value).filter(Boolean),
			direction: data.direction,
			rangeLabel: `${data.from} to ${data.to}`,
		});
		return { queries: queries.slice(0, MAX_QUERIES) };
	});

// ── 2. search + filter + vet ────────────────────────────────────────

export type ArticleTier = "high_authority" | "niche_blog";

export interface ArticleResult {
	title: string;
	url: string;
	domain: string;
	tier: ArticleTier;
	fitScore: number;
	verdict: string;
	relevance: "strong" | "weak";
	signals: string[];
	merchants: string[];
	linksCompetitor: boolean;
	publishedDate?: string;
	competitorsMentioned: string[];
	brandAlreadyMentioned: boolean;
	contactHint?: string;
	query: string;
}

export interface ArticleSearchPayload {
	highAuthority: ArticleResult[];
	nicheBlog: ArticleResult[];
	stats: Record<string, number>;
}

export const findArticlesFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			queries: z
				.array(z.object({ query: z.string().trim().min(1).max(300), angle: z.string().max(120).optional() }))
				.min(1)
				.max(MAX_QUERIES),
			direction: z.string().trim().max(500).optional(),
			from: z.string().regex(ymdRe),
			to: z.string().regex(ymdRe),
			pagesPerSearch: z.number().int().min(1).max(MAX_PAGES),
			// default: only surface articles that DON'T already name the brand — those are the pitch targets
			includeAlreadyFeatured: z.boolean().optional(),
			// default (undefined) = strict: only keep articles that themselves carry
			// affiliate links to 2+ retailers or to a competitor. false = balanced.
			strict: z.boolean().optional(),
		}),
	)
	.handler(async ({ data }): Promise<ArticleSearchPayload> => {
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

			const wordRe = (term: string) =>
				new RegExp(`(?:^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`, "i");

			const competitorNames = comps.map((c) => c.name).filter(Boolean);
			const compResByName = comps
				.filter((c) => c.name)
				.map((c) => ({
					name: c.name,
					res: dedupeLower([c.name, ...(c.aliases ?? [])])
						.filter((t) => t.length >= 3)
						.map(wordRe),
				}));
			const brandRes = dedupeLower([brand.name, ...(brand.aliases ?? [])])
				.filter((t) => t.length >= 3)
				.map(wordRe);
			const brandDomains = new Set(
				[brand.website, ...(brand.additionalDomains ?? [])].map((d) => extractDomain(d)).filter(Boolean),
			);
			const competitorDomains = new Set(comps.flatMap((c) => (c.domains ?? []).map((d) => extractDomain(d)).filter(Boolean)));
			const competitorUrlNeedles = dedupeLower(
				comps.flatMap((c) => [c.name, ...(c.aliases ?? [])]).flatMap((n) => {
					const t = (n ?? "").trim().toLowerCase();
					if (t.length < 4) return [];
					return [t.replace(/\s+/g, ""), t.replace(/\s+/g, "+"), t.replace(/\s+/g, "-"), t.replace(/\s+/g, "%20")];
				}),
			).filter((n) => n.length >= 4);
			const linksACompetitor = (taggedLinks: string[]): boolean =>
				taggedLinks.some((href) => {
					const low = href.toLowerCase();
					try {
						const h = new URL(href).hostname.replace(/^www\./, "");
						if ([...competitorDomains].some((d) => h === d || h.endsWith(`.${d}`))) return true;
					} catch {
						/* ignore */
					}
					return competitorUrlNeedles.some((n) => low.includes(n));
				});
			const brandSummary = (await getWebsiteExcerpt(brand.website).catch(() => ""))
				.replace(/\s+/g, " ")
				.trim()
				.slice(0, 700);

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

			// 2. dedupe + drop junk / non-US / brand's & competitors' own sites
			const seen = new Set<string>();
			let candidates = serpBatches.flat().filter((row) => {
				const key = normalizeUrlKey(row.url);
				if (!key || seen.has(key)) return false;
				const domain = extractDomain(row.url);
				if (!domain) return false;
				if (inJunkDomain(domain) || isNonUsDomain(domain) || isPrWireDomain(domain)) return false;
				if (brandDomains.has(domain) || competitorDomains.has(domain)) return false;
				seen.add(key);
				return true;
			});
			const afterJunk = candidates.length;
			candidates.sort((a, b) => a.rank - b.rank);

			// 3. collapse syndicated copies: same headline across >=2 distinct domains -> keep best-rank one
			const byTitle = new Map<string, typeof candidates>();
			for (const c of candidates) {
				const k = normalizeTitleKey(c.title);
				if (k.length < 12) continue;
				const arr = byTitle.get(k) ?? [];
				arr.push(c);
				byTitle.set(k, arr);
			}
			const syndicatedDrop = new Set<string>();
			for (const arr of byTitle.values()) {
				const domains = new Set(arr.map((a) => extractDomain(a.url)));
				if (domains.size >= 2) {
					const best = arr.reduce((a, b) => (a.rank <= b.rank ? a : b));
					for (const a of arr) if (a.url !== best.url) syndicatedDrop.add(a.url);
				}
			}
			candidates = candidates.filter((c) => !syndicatedDrop.has(c.url));

			// 4. drop obvious retailers before spending an LLM/fetch on them
			candidates = candidates.filter((c) => {
				const domain = extractDomain(c.url);
				const known = isAffiliatePublisherDomain(domain) || isAffiliateRedirectHost(domain);
				return known || !isEcommerceDomain(domain);
			});
			const afterRetail = candidates.length;

			const userDirection = data.direction?.trim() || data.queries.map((q) => q.query).join("; ");

			// 5. cheap triage on title+snippet -> keep the most on-topic
			let triaged = candidates;
			if (candidates.length > 24) {
				const input = candidates.slice(0, TRIAGE_INPUT_CAP);
				try {
					const keepNums = await triageCandidates({
						brandName: brand.name,
						brandSummary,
						direction: userDirection,
						candidates: input.map((c) => ({ title: c.title, snippet: c.snippet, domain: extractDomain(c.url) })),
					});
					const keep = new Set(keepNums.filter((n) => n >= 1 && n <= input.length).map((n) => n - 1));
					triaged = keep.size > 0 ? input.filter((_, i) => keep.has(i)) : input;
				} catch {
					triaged = candidates.slice(0, TRIAGE_INPUT_CAP);
				}
			}
			const afterTriage = triaged.length;

			// 6. rank-order, then fetch survivors + scan page HTML
			const strict = data.strict !== false;
			let renderBudget = 12;
			let droppedThinAffiliate = 0;
			const toFetch = triaged.slice().sort((a, b) => a.rank - b.rank).slice(0, MAX_FETCHES);
			const fetched = await mapPool(toFetch, FETCH_CONCURRENCY, async (c) => {
				const domain = extractDomain(c.url);
				const domainKnown = isAffiliatePublisherDomain(domain) || isAffiliateRedirectHost(domain) || isAffiliateUrl(c.url);
				let html = await unlockerFetchHtml(c.url).catch(() => null);
				if (!html) {
					if (!domainKnown) return null;
					return {
						url: c.url,
						title: c.title,
						query: c.query,
						domain,
						excerpt: c.snippet,
						signals: ["known affiliate publisher"],
						merchants: [] as string[],
						linksCompetitor: false,
						publishedDate: undefined as string | undefined,
						competitorsMentioned: [] as string[],
						brandAlreadyMentioned: false,
						contactHint: undefined as string | undefined,
						rank: c.rank,
					};
				}
				let sig = scanHtmlForAffiliateSignals(html);
				let linkedComp = linksACompetitor(sig.taggedLinks);

				// static HTML looks affiliate-ish (disclosure) but thin on links, and it's
				// not a known publisher — re-fetch with JS rendered so client-side link
				// monetizers can rewrite links, then re-scan. Best-effort, budget-capped.
				if (!domainKnown && !linkedComp && sig.taggedOutboundHosts.length < 2 && sig.disclosure && renderBudget > 0) {
					renderBudget--;
					const rendered = await unlockerFetchHtml(c.url, true).catch(() => null);
					if (rendered && rendered.length > html.length * 0.8) {
						html = rendered;
						sig = scanHtmlForAffiliateSignals(html);
						linkedComp = linksACompetitor(sig.taggedLinks);
					}
				}

				const merchantCount = sig.taggedOutboundHosts.length;
				// keep rule. strict: the article ITSELF must prove affiliate behaviour —
				// links 2+ retailers, links a competitor, has rel=sponsored, or is a known
				// affiliate publisher. balanced also allows a single disclosure + link.
				const keep = strict
					? domainKnown || linkedComp || sig.sponsoredRel || merchantCount >= 2
					: domainKnown ||
						sig.strong ||
						linkedComp ||
						(sig.disclosure && merchantCount >= 1 && !sig.commerceMarkers);
				if (!keep) {
					droppedThinAffiliate++;
					return null;
				}
				if (sig.commerceMarkers && !domainKnown && !sig.strong && !linkedComp) {
					droppedThinAffiliate++;
					return null;
				}

				const text = extractReadableText(html) || c.snippet;
				const haystack = `${c.title}\n${text}`;
				return {
					url: c.url,
					title: c.title,
					query: c.query,
					domain,
					excerpt: text.slice(0, 1500),
					signals: dedupeLower(
						[...(domainKnown ? ["known affiliate publisher"] : []), ...(linkedComp ? ["affiliate-links a competitor"] : []), ...sig.labels],
					),
					merchants: sig.taggedOutboundHosts.slice(0, 8),
					linksCompetitor: linkedComp,
					publishedDate: extractPublishDate(html),
					competitorsMentioned: compResByName
						.filter((cc) => cc.res.some((re) => re.test(haystack)))
						.map((cc) => cc.name),
					brandAlreadyMentioned: brandRes.some((re) => re.test(haystack)),
					contactHint: extractContactHint(html, c.url),
					rank: c.rank,
				};
			});
			const survivors = fetched.filter((x): x is NonNullable<typeof x> => x !== null);

			// 7. LLM vetting pass
			let judgements: Awaited<ReturnType<typeof judgeArticles>> = [];
			try {
				judgements = await judgeArticles({
					brandName: brand.name,
					brandWebsite: brand.website,
					brandSummary,
					direction: userDirection,
					competitors: competitorNames,
					articles: survivors.map((s) => ({
						url: s.url,
						title: s.title,
						domain: s.domain,
						excerpt: s.excerpt,
						competitorsMentioned: s.competitorsMentioned,
						affiliateMerchants: s.merchants,
						linksCompetitor: s.linksCompetitor,
						publishedOrUpdated: s.publishedDate ?? null,
					})),
				});
			} catch {
				judgements = [];
			}
			const byUrl = new Map(judgements.map((j) => [j.url, j]));
			const staleYear = new Date().getFullYear() - 2;

			const highAuthority: ArticleResult[] = [];
			const nicheBlog: ArticleResult[] = [];
			const drop = {
				alreadyFeatured: 0,
				offTopic: 0,
				notAffiliate: 0,
				nonUs: 0,
				unvetted: 0,
				lowScore: 0,
				stale: 0,
				dupePublisher: 0,
			};
			for (const s of survivors) {
				// the point of the tool is finding pitch targets — skip articles that
				// already name the brand unless the caller opts to see them
				if (s.brandAlreadyMentioned && data.includeAlreadyFeatured !== true) {
					drop.alreadyFeatured++;
					continue;
				}
				const j = byUrl.get(s.url);
				const majorList = isMajorPublisher(s.domain, s.url);
				const merchantCount = s.merchants.length;
				// with no judgement, fall back to conservative keep for known publishers only
				if (!j) {
					if (!majorList && !s.signals.includes("known affiliate publisher") && !s.linksCompetitor && merchantCount < 2) {
						drop.unvetted++;
						continue;
					}
				} else {
					if (j.relevance === "off_topic") {
						drop.offTopic++;
						continue;
					}
					if (j.affiliateEditorial === "no" || (strict && j.affiliateEditorial === "unclear" && !s.linksCompetitor && merchantCount < 2)) {
						drop.notAffiliate++;
						continue;
					}
					if (!j.usCentric && !majorList) {
						drop.nonUs++;
						continue;
					}
					if (j.relevance === "weak" && s.competitorsMentioned.length === 0 && !s.linksCompetitor && j.affiliateEditorial !== "yes") {
						drop.offTopic++;
						continue;
					}
				}

				let score = Math.max(0, Math.min(100, Math.round(j?.fitScore ?? (j?.relevance === "weak" ? 42 : 62))));
				if (s.linksCompetitor) score = Math.max(score, 84);
				else if (merchantCount >= 3) score = Math.max(score, 72);
				else if (merchantCount >= 2) score = Math.max(score, 62);

				// staleness: an old roundup with no update signal is a weak pitch
				const year = s.publishedDate ? Number(s.publishedDate.slice(0, 4)) : null;
				if (year && year < staleYear && !s.linksCompetitor) {
					if (strict) {
						drop.stale++;
						continue;
					}
					score = Math.min(score, 44);
				}

				if (strict && score < 55) {
					drop.lowScore++;
					continue;
				}

				const row: ArticleResult = {
					title: s.title,
					url: s.url,
					domain: s.domain,
					tier: majorList ? "high_authority" : (j?.tier ?? "niche_blog"),
					fitScore: score,
					verdict:
						j?.outreachVerdict?.trim() ||
						(s.linksCompetitor
							? `Already affiliate-links a competitor — they monetize this category and would very likely add ${brand.name}.`
							: s.competitorsMentioned.length > 0
								? `Features ${s.competitorsMentioned.join(", ")} — a natural fit to pitch ${brand.name} alongside them.`
								: `${s.domain} runs affiliate roundups in this space; worth a pitch.`),
					relevance: j?.relevance === "weak" ? "weak" : "strong",
					signals: s.signals,
					merchants: s.merchants,
					linksCompetitor: s.linksCompetitor,
					publishedDate: s.publishedDate,
					competitorsMentioned: s.competitorsMentioned,
					brandAlreadyMentioned: s.brandAlreadyMentioned,
					contactHint: s.contactHint,
					query: s.query,
				};
				(row.tier === "high_authority" ? highAuthority : nicheBlog).push(row);
			}

			// at most 2 articles per publisher — an outreach list shouldn't repeat a site
			const cappedByDomain = (rows: ArticleResult[]): ArticleResult[] => {
				const perDomain = new Map<string, number>();
				const out: ArticleResult[] = [];
				for (const r of [...rows].sort((a, b) => b.fitScore - a.fitScore)) {
					const n = perDomain.get(r.domain) ?? 0;
					if (n >= 2) {
						drop.dupePublisher++;
						continue;
					}
					perDomain.set(r.domain, n + 1);
					out.push(r);
				}
				return out;
			};

			const sortRows = (rows: ArticleResult[]) =>
				rows.sort((a, b) => b.fitScore - a.fitScore || (a.relevance === b.relevance ? 0 : a.relevance === "strong" ? -1 : 1));
			const highFinal = sortRows(cappedByDomain(highAuthority));
			const nicheFinal = sortRows(cappedByDomain(nicheBlog));

			const payload: ArticleSearchPayload = {
				highAuthority: highFinal,
				nicheBlog: nicheFinal,
				stats: {
					queries: queries.length,
					serpRequests: serpTasks.length,
					candidates: afterJunk,
					pagesFetched: toFetch.length,
					highAuthority: highFinal.length,
					nicheBlog: nicheFinal.length,
					droppedAlreadyFeatured: drop.alreadyFeatured,
					droppedOffTopic: drop.offTopic,
					droppedNotAffiliate: drop.notAffiliate,
					droppedNonUs: drop.nonUs,
					droppedThinAffiliate,
					droppedLowScore: drop.lowScore,
					droppedStale: drop.stale,
					droppedDupePublisher: drop.dupePublisher,
					droppedRetailer: Math.max(0, afterJunk - afterRetail),
					droppedSyndicated: syndicatedDrop.size,
				},
			};

			// persist the latest run so re-opening the tab is free
			try {
				await db.insert(brandArticleSearches).values({
					brandId: data.brandId,
					direction: userDirection.slice(0, 500),
					periodStart: data.from,
					periodEnd: data.to,
					pagesPerSearch: data.pagesPerSearch,
					freshOnly: data.includeAlreadyFeatured !== true,
					queries: data.queries,
					payload,
					createdBy: session.user.name?.trim() || session.user.email || "a teammate",
				});
			} catch (e) {
				console.error("[article-finder] failed to persist search", e);
			}

			return payload;
		},
	);

export const getLatestArticleSearchFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1) }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireBrandAccess(session.user.id, data.brandId);
		const [row] = await db
			.select()
			.from(brandArticleSearches)
			.where(eq(brandArticleSearches.brandId, data.brandId))
			.orderBy(desc(brandArticleSearches.createdAt))
			.limit(1);
		if (!row) return null;
		const payload = row.payload as ArticleSearchPayload;
		// backfill fields added after a row was written, so the UI never hits undefined
		const norm = (list: ArticleResult[] | undefined): ArticleResult[] =>
			(list ?? []).map((r) => ({
				...r,
				merchants: r.merchants ?? [],
				linksCompetitor: r.linksCompetitor ?? false,
				signals: r.signals ?? [],
				competitorsMentioned: r.competitorsMentioned ?? [],
			}));
		return {
			createdAt: String(row.createdAt),
			createdBy: row.createdBy ?? "a teammate",
			direction: row.direction ?? "",
			from: row.periodStart,
			to: row.periodEnd,
			pagesPerSearch: row.pagesPerSearch,
			freshOnly: row.freshOnly,
			queries: (row.queries as { query: string; angle?: string }[] | null) ?? [],
			highAuthority: norm(payload?.highAuthority),
			nicheBlog: norm(payload?.nicheBlog),
			stats: payload?.stats ?? {},
		};
	});
