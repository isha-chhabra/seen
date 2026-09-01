/**
 * Article Finder — LLM steps.
 *
 * Two structured completions (web search OFF) through the same provider brand
 * analysis uses (OPENAI_API_KEY / gpt-5-mini):
 *   1. expand a vague content direction into concrete Google search queries
 *   2. explain, per surviving article, why it's a pitch target for the brand
 */
import { z } from "zod";
import { runStructuredCompletionPrompt } from "../onboarding/llm";

// ── 1. query generation ───────────────────────────────────────────────

export const searchQueriesSchema = z.object({
	queries: z
		.array(
			z.object({
				query: z
					.string()
					.describe("A natural Google search string a person would type. No quotes, no site: operators, no brand name."),
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
	competitors: string[];
	direction: string;
	rangeLabel: string;
}): Promise<SearchQuery[]> {
	const prompt = [
		`Brand: ${args.brandName} (${args.brandWebsite}). Competitors: ${args.competitors.join(", ") || "none listed"}.`,
		`The affiliate team wants to find third-party articles they could pitch ${args.brandName} into.`,
		`Their direction, verbatim: "${args.direction}". Timeframe of interest: ${args.rangeLabel}.`,
		``,
		`Produce 4-8 Google searches a person would type to surface PUBLISHED articles, roundups, buying guides and review posts in this space — pages that recommend products and could plausibly feature ${args.brandName}.`,
		`Rules:`,
		`- Vary the ANGLE across queries (occasion, audience, price band, use-case, adjacent sub-category, "best X 2026" / "X gift guide" phrasing). No two queries that are just reworded versions of each other.`,
		`- Stay strictly inside the user's stated direction. If it is vague, widen only along legitimate sub-topics — never drift to an unrelated category.`,
		`- Do NOT put "${args.brandName}" or any brand/competitor name in the query. We also want articles that do not feature the brand yet.`,
		`- No quotation marks around the whole query, no site: / intitle: operators. Natural phrasing that pulls up editorial and affiliate content, not product-detail pages.`,
		`Good: best reusable water bottles for hiking 2026   Too narrow: purple 32oz insulated bottle review`,
		`Return the queries ranked most-useful first, each with a short 'angle' label.`,
	].join("\n");
	const { object } = await runStructuredCompletionPrompt(prompt, searchQueriesSchema);
	return object.queries;
}

// ── 2. per-article fit reasoning ─────────────────────────────────────

export const articleFitSchema = z.object({
	fits: z
		.array(
			z.object({
				url: z.string().describe("The article URL, copied verbatim from the input."),
				reasoning: z
					.string()
					.describe(
						"One specific sentence on why this article is a good pitch target for the brand, grounded in the page's actual topic. If a listed competitor appears on the page, say so — it is a stronger signal. Otherwise base it on topical fit.",
					),
			}),
		)
		.max(60),
});
export type ArticleFit = z.infer<typeof articleFitSchema>["fits"][number];

export async function reasonAboutArticles(args: {
	brandName: string;
	brandWebsite: string;
	competitors: string[];
	articles: { url: string; title: string; excerpt: string; competitorsMentioned: string[] }[];
}): Promise<ArticleFit[]> {
	if (args.articles.length === 0) return [];
	const prompt = [
		`Brand: ${args.brandName} (${args.brandWebsite}). Known competitors: ${args.competitors.join(", ") || "none"}.`,
		`For each article below, write ONE short, specific sentence on why it is a good place for the affiliate team to pitch ${args.brandName}.`,
		`- Ground it in the article's actual topic (given as an excerpt), not generic praise.`,
		`- "competitorsMentioned" lists any known competitors detected on the page. If non-empty, call that out — it is a strong signal the brand belongs there too.`,
		`- If empty, base the reasoning on topical fit (e.g. "this outlet publishes buying guides in the brand's category").`,
		`Return one entry per input article, url copied verbatim. Plain business English, no jargon.`,
		``,
		`ARTICLES (JSON):`,
		JSON.stringify(
			args.articles.map((a) => ({
				url: a.url,
				title: a.title,
				excerpt: a.excerpt.slice(0, 1200),
				competitorsMentioned: a.competitorsMentioned,
			})),
			null,
			1,
		),
	].join("\n");
	const { object } = await runStructuredCompletionPrompt(prompt, articleFitSchema);
	return object.fits;
}
