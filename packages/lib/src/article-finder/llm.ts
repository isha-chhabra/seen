/**
 * Article Finder — LLM steps (gpt-5-mini via the onboarding provider).
 *
 *   1. generateSearchQueries — free-text direction -> concrete US-editorial Google queries
 *   2. triageCandidates      — cheap title/snippet pass to drop obvious misfits before fetching
 *   3. judgeArticles         — full vetting of fetched pages: relevance, affiliate-editorial
 *                              fit, authority tier, US focus, and the outreach verdict
 */
import { z } from "zod";
import { runStructuredCompletionPrompt } from "../onboarding/llm";

// ── 1. query generation ─────────────────────────────────────────────

export const searchQueriesSchema = z.object({
	queries: z
		.array(
			z.object({
				query: z.string().describe("A natural Google search string. No quotes, no site: operators, no brand name."),
				angle: z.string().describe("Short label for what makes this variation distinct, e.g. 'budget picks' or 'holiday gifting'."),
			}),
		)
		.min(4)
		.max(8),
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
			? `The brand is already tracked on these AI-search topics — stay in the same product territory: ${args.trackedTopics.join("; ")}.`
			: "",
		`The affiliate team wants US articles they could pitch ${args.brandName} into.`,
		`Their direction, verbatim: "${args.direction}". Timeframe of interest: ${args.rangeLabel}.`,
		``,
		`Produce 4-8 Google searches a US shopper or editor would type to surface PUBLISHED editorial roundups, buying guides, "best of" lists and review posts in the brand's exact product category.`,
		`Rules:`,
		`- Every query must sit squarely in ${args.brandName}'s product category. Do NOT drift into adjacent categories the brand does not sell.`,
		`- Phrase them the way US publications title this content: "best X 2026", "X we tested", "top X for <use-case>", "X gift guide", "X buying guide".`,
		`- Vary the ANGLE across queries (occasion, audience, price band, use-case, sub-category). No two that are just reworded versions of each other.`,
		`- Do NOT put "${args.brandName}" or any brand/competitor name in the query — we also want articles that don't feature the brand yet.`,
		`- No quotation marks around the whole query, no site: / intitle: operators.`,
		`Good: best insulated water bottles 2026   Too narrow: purple 32oz bottle review   Too broad: best outdoor gear`,
		`Return the queries ranked most-useful first, each with a short 'angle' label.`,
	]
		.filter(Boolean)
		.join("\n");
	const { object } = await runStructuredCompletionPrompt(prompt, searchQueriesSchema);
	return object.queries;
}

// ── 2. pre-fetch triage ─────────────────────────────────────────────

export const triageSchema = z.object({
	keepNumbers: z
		.array(z.number().int())
		.describe(
			"The list numbers to KEEP: US editorial articles/roundups in the brand's category that could plausibly carry affiliate links. Drop retailers and brand-owned stores, forums, videos, press releases, syndicated wire stories, and anything off-category.",
		),
});

export async function triageCandidates(args: {
	brandName: string;
	brandSummary: string;
	direction: string;
	candidates: { title: string; snippet: string; domain: string }[];
}): Promise<number[]> {
	if (args.candidates.length === 0) return [];
	const list = args.candidates
		.map((c, i) => `${i + 1}. [${c.domain}] ${c.title}${c.snippet ? ` — ${c.snippet.slice(0, 160)}` : ""}`)
		.join("\n");
	const prompt = [
		`Brand: ${args.brandName}. Sells: ${args.brandSummary || args.direction}.`,
		`User is looking for: "${args.direction}".`,
		``,
		`Below is a numbered list of Google results. Return the numbers worth keeping — US editorial articles, roundups or buying guides in the brand's category that an outlet could add an affiliate link to.`,
		`Drop: retailers / brand-owned online stores, marketplaces, forums (Reddit/Quora), videos, PDFs, press releases, syndicated newswire reprints, and anything about a different product category.`,
		`Be generous at this stage — when unsure, keep it; a later step vets each page in full.`,
		``,
		list,
	].join("\n");
	const { object } = await runStructuredCompletionPrompt(prompt, triageSchema);
	return object.keepNumbers;
}

// ── 3. full page vetting ────────────────────────────────────────────

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
						'yes ONLY if this is an independent editorial outlet that (a) publishes product roundups/guides chosen by its editors, (b) monetizes with affiliate links (Amazon Associates, Skimlinks, retailer partner links, "we may earn a commission", rel=sponsored outbound links), and (c) would plausibly consider adding a brand if pitched. no = the brand\'s own site or another brand\'s store, a pure retailer/DTC site with its own checkout, a site with no affiliate monetization, a press release, or syndicated newswire copy. unclear = genuinely cannot tell.',
					),
				tier: z
					.enum(["high_authority", "niche_blog"])
					.describe(
						"high_authority = large well-known national publication or one of its verticals; niche_blog = smaller independent blog / niche site that still looks credible (real bylines, original testing or photography, consistent focus).",
					),
				usCentric: z.boolean().describe("true if this is a US publication or the US edition of one."),
				fitScore: z
					.number()
					.int()
					.min(0)
					.max(100)
					.describe(
						"How strong a pitch target this is, 0-100, weighing topical fit, whether the outlet actually runs affiliate editorial, authority, and how likely an editor would say yes. 80+ = clear yes, 50-79 = worth a try, <50 = weak.",
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
	articles: { url: string; title: string; domain: string; excerpt: string; competitorsMentioned: string[] }[];
}): Promise<ArticleJudgement[]> {
	if (args.articles.length === 0) return [];
	const prompt = [
		`Brand: ${args.brandName} (${args.brandWebsite}).`,
		`What the brand sells: ${args.brandSummary || args.direction}.`,
		`User's content direction: "${args.direction}".`,
		`Known competitors: ${args.competitors.join(", ") || "none"}.`,
		``,
		`You are vetting candidate articles for an affiliate-outreach list. For each you get the title, domain, any known competitors detected on the page, and a text excerpt. Use ONLY that text.`,
		`Judge each on: relevance, affiliateEditorial, tier, usCentric, a 0-100 fitScore, and a one-sentence outreachVerdict.`,
		`If competitors are already on the page, that is a strong sign the brand belongs there too — reflect it in the verdict.`,
		`Return one entry per input article, url copied verbatim. Plain business English.`,
		``,
		`ARTICLES (JSON):`,
		JSON.stringify(
			args.articles.map((a) => ({
				url: a.url,
				title: a.title,
				domain: a.domain,
				competitorsMentioned: a.competitorsMentioned,
				excerpt: a.excerpt.slice(0, 1400),
			})),
			null,
			1,
		),
	].join("\n");
	const { object } = await runStructuredCompletionPrompt(prompt, articleJudgementSchema);
	return object.articles;
}
