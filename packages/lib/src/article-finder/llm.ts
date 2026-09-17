/**
 * Article Finder, LLM steps (gpt-5-mini via the onboarding provider).
 *
 *   1. generateSearchQueries, free-text direction -> concrete Western-editorial Google queries,
 *                              deliberately branched across audience/occasion/sub-category
 *   2. judgeArticles        , full vetting of fetched pages: relevance, affiliate-editorial
 *                              fit, authority tier, Western-market focus, and the outreach verdict
 *
 * There is no cheap pre-fetch triage anymore. Guessing relevance from a title and a
 * one-line snippet was throwing away real candidates before anything read the actual
 * page; we fetch everything that survives basic junk/retailer/syndication filtering
 * and let judgeArticles decide on full content instead.
 */
import { z } from "zod";
import { runStructuredCompletionPrompt } from "../onboarding/llm";

// ── 1. query generation ─────────────────────────────────────────────

export const searchQueriesSchema = z.object({
	queries: z
		.array(
			z.object({
				query: z.string().describe("A natural Google search string. No quotes, no site: operators, no brand name."),
				angle: z
					.string()
					.describe(
						"Short label for what makes this variation distinct, e.g. 'gifts for dad' vs 'gifts for husband' vs 'budget picks'.",
					),
			}),
		)
		.min(6)
		.max(20),
});
export type SearchQuery = z.infer<typeof searchQueriesSchema>["queries"][number];

export async function generateSearchQueries(args: {
	brandName: string;
	brandWebsite: string;
	brandSummary: string;
	competitors: string[];
	trackedTopics: string[];
	direction: string;
	rangeLabel: string;
}): Promise<SearchQuery[]> {
	const prompt = [
		`Brand: ${args.brandName} (${args.brandWebsite}).`,
		args.brandSummary ? `What the brand sells (from its site): ${args.brandSummary}` : "",
		`Competitors: ${args.competitors.join(", ") || "none listed"}.`,
		args.trackedTopics.length > 0
			? `The brand is already tracked on these AI-search topics, stay in the same product territory: ${args.trackedTopics.join("; ")}.`
			: "",
		`The affiliate team wants a WIDE net of Western-market articles (US, Canada, UK/Ireland, Europe, Australia, NZ) they could pitch ${args.brandName} into, the kind of breadth a person manually clicking through Google for an hour would find, not just the first page of one search.`,
		`Their direction, verbatim: "${args.direction}". Timeframe of interest: ${args.rangeLabel}.`,
		``,
		`Produce 10-20 Google searches a shopper or editor in the US, Canada, UK, Europe, Australia or NZ would type to surface PUBLISHED editorial roundups, buying guides, "best of" lists and review posts in the brand's exact product category.`,
		`Rules:`,
		`- Every query must sit squarely in ${args.brandName}'s product category. Do NOT drift into adjacent categories the brand does not sell.`,
		`- Phrase them the way Western publications title this content: "best X 2026", "X we tested", "top X for <use-case>", "X gift guide", "X buying guide".`,
		`- Think like a category strategist, not a paraphraser: branch across genuinely different AUDIENCES (e.g. dad, husband, brother, boyfriend, coworker, self-buyer), OCCASIONS (holiday, birthday, housewarming, thank-you), PRICE TIERS (budget, splurge), and SUB-CATEGORIES. "Best gifts for dad" and "best gifts for husband" are two different articles on two different pages, not a duplicate, generate both when the direction implies gifting.`,
		`- Weight toward the stated timeframe first (seasonal/current), but also include a few evergreen "best X" queries that fit the direction, those roundups get updated year over year and are still live pitch targets.`,
		`- Do NOT put "${args.brandName}" or any brand/competitor name in the query, we also want articles that don't feature the brand yet.`,
		`- No quotation marks around the whole query, no site: / intitle: operators.`,
		`Good: best insulated water bottles 2026   Too narrow: purple 32oz bottle review   Too broad: best outdoor gear`,
		`Return the queries ranked most-useful first, each with a short 'angle' label.`,
	]
		.filter(Boolean)
		.join("\n");
	const { object } = await runStructuredCompletionPrompt(prompt, searchQueriesSchema);
	return object.queries;
}

// ── 2. full page vetting ────────────────────────────────────────────

export const articleJudgementSchema = z.object({
	articles: z
		.array(
			z.object({
				url: z.string().describe("The article URL, copied verbatim from the input."),
				relevance: z
					.enum(["strong", "weak", "off_topic"])
					.describe(
						"strong = squarely about the brand's product category and a reader would expect brands like this in it; weak = only tangentially related; off_topic = different category, or thin/AI-spam/link-farm content.",
					),
				affiliateEditorial: z
					.enum(["yes", "unclear", "no"])
					.describe(
						"yes ONLY if this is an independent editorial outlet that (a) publishes product roundups/guides chosen by its editors, (b) monetizes with affiliate links (Amazon Associates, Skimlinks, retailer partner links, \"we may earn a commission\", rel=sponsored outbound links), and (c) would plausibly consider adding a brand if pitched. no = the brand's own site or another brand's store, a pure retailer/DTC site with its own checkout, a site with no affiliate monetization, a press release, or syndicated newswire copy. unclear = genuinely cannot tell.",
					),
				tier: z
					.enum(["high_authority", "niche_blog"])
					.describe(
						"high_authority = large well-known national publication or one of its verticals; niche_blog = smaller independent blog / niche site that still looks credible (real bylines, original testing or photography, consistent focus).",
					),
				westernCentric: z
					.boolean()
					.describe(
						"true if this is a US, Canadian, UK/Irish, European, Australian or NZ publication (or the edition of one for that market).",
					),
				fitScore: z
					.number()
					.int()
					.min(0)
					.max(100)
					.describe(
						"How strong a pitch target this is, 0-100. Weigh: topical fit; whether the article ITSELF carries affiliate links to multiple retailers (affiliateMerchants, 2+ is near-decisive that they'd add another brand); whether it already affiliate-links a direct competitor (linksCompetitor, the strongest signal, 85+); authority; recency. 80+ = clear yes, 55-79 = worth a try, <55 = weak. Be strict, an outreach list is worthless if half the targets won't respond.",
					),
				outreachVerdict: z
					.string()
					.describe(
						"ONE plain sentence answering: if we emailed this outlet's editor, would they realistically feature this brand, and why or why not.",
					),
			}),
		)
		.max(50),
});
export type ArticleJudgement = z.infer<typeof articleJudgementSchema>["articles"][number];

export async function judgeArticles(args: {
	brandName: string;
	brandWebsite: string;
	brandSummary: string;
	direction: string;
	competitors: string[];
	articles: {
		url: string;
		title: string;
		domain: string;
		excerpt: string;
		competitorsMentioned: string[];
		affiliateMerchants: string[];
		linksCompetitor: boolean;
		publishedOrUpdated: string | null;
	}[];
}): Promise<ArticleJudgement[]> {
	if (args.articles.length === 0) return [];
	const prompt = [
		`Brand: ${args.brandName} (${args.brandWebsite}).`,
		`What the brand sells: ${args.brandSummary || args.direction}.`,
		`User's content direction: "${args.direction}".`,
		`Known competitors: ${args.competitors.join(", ") || "none"}.`,
		``,
		`You are vetting candidate articles for an affiliate-outreach list. This list must be all-qualified, every entry should be an outlet that would realistically add the brand if asked. When in doubt, mark it down.`,
		`For each article you get: title, domain, a text excerpt, competitors detected in the text, and, read directly from the page's HTML -`,
		`  affiliateMerchants: retailers this article links with affiliate tracking. [] = none found in static HTML (could still be client-side; judge from the excerpt). 1 = minimal. 2+ = the outlet clearly runs multi-retailer affiliate roundups → affiliateEditorial "yes", fitScore 75+.`,
		`  linksCompetitor: true = the article already has an affiliate-tracked link to a direct competitor. Strongest possible signal → affiliateEditorial "yes", fitScore 85+ unless relevance is off_topic.`,
		`  publishedOrUpdated: the page's date if found. Prefer recent. Older than ~2 years with no sign of updates → cap fitScore around 45 and say so.`,
		`Judge each on: relevance, affiliateEditorial, tier, westernCentric, a 0-100 fitScore, and a one-sentence outreachVerdict.`,
		`Return one entry per input article, url copied verbatim.`,
		`outreachVerdict: ONE sentence, at most 18 words. Lead with the concrete reason, not "This site" or "This outlet". No dashes. Vary the wording between entries, do not use a template.`,
		``,
		`ARTICLES (JSON):`,
		JSON.stringify(
			args.articles.map((a) => ({
				url: a.url,
				title: a.title,
				domain: a.domain,
				competitorsMentioned: a.competitorsMentioned,
				affiliateMerchants: a.affiliateMerchants,
				linksCompetitor: a.linksCompetitor,
				publishedOrUpdated: a.publishedOrUpdated,
				excerpt: a.excerpt.slice(0, 1400),
			})),
			null,
			1,
		),
	].join("\n");
	const { object } = await runStructuredCompletionPrompt(prompt, articleJudgementSchema);
	return object.articles;
}
