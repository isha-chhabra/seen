/**
 * The three model steps of Influencer Finder (gpt-5-mini via the onboarding provider):
 *
 *   1. draftBrief   , the user's free-text direction -> search phrases, competitor
 *                     suggestions and the phrases that count as evidence of fit
 *   2. screenHits   , a cheap first read of search hits (handle + caption snippet)
 *                     to decide which few deserve a paid lookup
 *   3. expandQueries, once the first pass has found some fitting creators, new phrases that
 *                     should surface more like them
 *   4. judgeCreators, reads each analysed creator's bio and recent posts against the
 *                     brief. Counting (cadence, engagement, sponsorships) is done in
 *                     code and passed in; the model only reads and rates.
 */
import { z } from "zod";
import { runStructuredCompletionPrompt } from "../onboarding/llm";
import type { BrandUnderstanding, CreatorKind, InfluencerBrief, Platform, Verdict } from "./types";

type OnCost = (promptChars: number, outputChars: number) => void;

async function ask<T>(prompt: string, schema: z.ZodType<T>, onCost?: OnCost): Promise<T> {
	const { object } = await runStructuredCompletionPrompt(prompt, schema);
	onCost?.(prompt.length, JSON.stringify(object).length);
	return object;
}

// ── the brand ───────────────────────────────────────────────────────

const understandingSchema = z.object({
	summary: z.string().describe("Two sentences: what the brand sells and to whom."),
	customer: z.string().describe("Who buys from it, in one sentence."),
	markets: z.array(z.string()).min(1).max(6).describe("Countries it sells and ships to, as plain names."),
	greatFits: z.array(z.string()).min(2).max(8).describe("Kinds of creator who would gladly make content for it."),
	dealBreakers: z.array(z.string()).min(2).max(8).describe("Obvious reasons a creator would say no or would not help."),
});

/** Reads the brand's own website text and answers the questions an outreach lead would ask before writing to anyone. */
export async function understandBrand(
	args: { brandName: string; website: string; competitors: string[]; pageText: string },
	onCost?: OnCost,
): Promise<BrandUnderstanding> {
	const prompt = [
		`You are the outreach lead for ${args.brandName} (${args.website}). Before anyone writes to a creator you work out, from the brand's own website and what you know of it:`,
		`1. Who would happily make content for this brand if asked? Think about every audience the brand serves, including less obvious ones (for example a menswear brand for big and tall men also suits plus-size women's creators only if the site shows it sells to them).`,
		`2. What are the obvious reasons a creator would say no, or working with them would not help the brand? Think about: a creator who is really a business or a page, one who works exclusively with a competitor, one whose audience lives where the brand does not sell, one in a different niche or price tier, one with no history of brand work.`,
		`3. Would the brand benefit? Which country or countries does it sell in, so that creators whose audience lives elsewhere are worthless to it?`,
		args.competitors.length ? `Known competitors: ${args.competitors.join(", ")}.` : "",
		args.pageText
			? `Text from the website:\n${args.pageText.slice(0, 6000)}`
			: "The website could not be read; answer from what you know of the brand and be cautious.",
		`Answer in plain words. markets are country names only. Deal-breakers are short (a few words each) and specific to this brand, and always include creators based outside the markets.`,
	]
		.filter(Boolean)
		.join("\n");
	return ask(prompt, understandingSchema, onCost);
}

/** The brand's understanding as prompt lines; empty when there is none. */
function brandLines(b: BrandUnderstanding | undefined): string[] {
	if (!b) return [];
	return [
		`About the brand: ${b.summary} Customer: ${b.customer} Sells in: ${b.markets.join(", ")}.`,
		b.greatFits.length ? `Creators who would gladly work with it: ${b.greatFits.join("; ")}.` : "",
		b.dealBreakers.length ? `Obvious reasons a creator would say no: ${b.dealBreakers.join("; ")}.` : "",
	].filter(Boolean);
}

// ── expand ──────────────────────────────────────────────────────────

const expandSchema = z.object({ queries: z.array(z.string()).min(1).max(8) });

export async function expandQueries(
	args: {
		brief: InfluencerBrief;
		brandName: string;
		kept: { handle: string; bio: string }[];
		used: string[];
	},
	onCost?: OnCost,
): Promise<string[]> {
	const prompt = [
		`Brand: ${args.brandName}. The team wants creators matching: "${args.brief.direction}".`,
		...brandLines(args.brief.brand),
		...guidanceLines(args.brief),
		args.kept.length
			? `Creators already found that fit (handle: bio):\n${args.kept.map((k) => `@${k.handle}: ${k.bio}`).join("\n")}`
			: "No fitting creators found yet; the phrases used so far may be too narrow or too generic.",
		`Phrases already searched: ${args.used.join("; ")}.`,
		`Return 6 new SHORT keyword phrases of 1 to 3 words (never full sentences), different from those above, that OTHER creators like these would put in their bio or captions. Each must signal this niche on its own, so never generic words like "fashion", "style", "model" or "lifestyle". Vary the angle: sub-niches, occasions, products, communities, how such creators describe themselves. No quotes, no operators like site:, no brand names, no years, no country names.`,
	].join("\n");
	const r = await ask(prompt, expandSchema, onCost);
	return r.queries;
}

// ── 1. brief ────────────────────────────────────────────────────────

const briefSchema = z.object({
	instagramQueries: z.array(z.string()).min(4).max(10),
	tiktokQueries: z.array(z.string()).min(2).max(6),
	extraCompetitors: z.array(z.string()).max(12),
	fitSignals: z.array(z.string()).min(3).max(14),
	bioKeywords: z.array(z.string()).min(3).max(12),
});

/** The optional guidance from the brief, as prompt lines. Empty when none was given. */
function guidanceLines(b: Pick<InfluencerBrief, "similarTo" | "avoid" | "basedIn">): string[] {
	return [
		b.similarTo?.length
			? `Creators they already like (a style reference, not to be repeated as results): ${b.similarTo.map((h) => `@${h}`).join(", ")}.`
			: "",
		b.basedIn?.length
			? `Audience should be in: ${b.basedIn.join(", ")}. A creator clearly based elsewhere is at most a maybe.`
			: "",
		b.avoid?.length ? `Rule out: ${b.avoid.join("; ")}. A creator matching any of these is an exclude.` : "",
	].filter(Boolean);
}

export async function draftBrief(
	args: {
		brandName: string;
		website: string;
		competitors: string[];
		direction: string;
		platforms: Platform[];
		similarTo?: string[];
		avoid?: string[];
		basedIn?: string[];
		brand?: BrandUnderstanding;
	},
	onCost?: OnCost,
): Promise<Pick<InfluencerBrief, "queries" | "fitSignals" | "bioKeywords"> & { extraCompetitors: string[] }> {
	const prompt = [
		`Brand: ${args.brandName} (${args.website}). Known competitors: ${args.competitors.join(", ") || "none listed"}.`,
		`The team wants influencers to reach out to. In their words: "${args.direction}".`,
		...brandLines(args.brand),
		...guidanceLines(args),
		`Return:`,
		`- instagramQueries: 6 to 8 SHORT keyword phrases of 2 to 4 words, the kind people type into a search box or use as a topic (for example "big and tall style", "3XL menswear haul"). Never full sentences. Varied angles (style, fit, reviews, hauls, occasions, sub-audiences). No quotes, no operators like site:, no brand names, no years, no country names.`,
		`- tiktokQueries: 3 to 5 short keyword phrases in the same spirit.`,
		`- extraCompetitors: up to 10 brands or major retailers a creator here might also promote that compete with ${args.brandName} and are NOT already listed. Short names only.`,
		`- bioKeywords: 6 to 10 short phrases (1 to 3 words) that creators like this put in their Instagram BIO to describe themselves or their niche, ORDERED FROM MOST SPECIFIC TO LEAST SPECIFIC (for example "big and tall", "bigandtall", "plus size men", "tall guy"). Profiles are searched for ANY of these in the bio, so every phrase must signal this niche on its own. NEVER include generic words that fit thousands of unrelated creators, such as "fashion", "style", "menswear", "model", "lifestyle", "creator", "body positive", or sizes on their own like "3XL". Plain text, no hashtags, no brand names.`,
		`- fitSignals: 6 to 12 short phrases, hashtags or self-descriptions that a truly fitting creator would use about themselves or their content (for example a size, a niche, a community term). Evidence of fit must come from what people say about themselves.`,
	].join("\n");
	const r = await ask(prompt, briefSchema, onCost);
	return {
		queries: {
			instagram: r.instagramQueries,
			tiktok: r.tiktokQueries,
		},
		extraCompetitors: r.extraCompetitors,
		fitSignals: r.fitSignals,
		bioKeywords: r.bioKeywords,
	};
}

// ── 2. screen ───────────────────────────────────────────────────────

const screenSchema = z.object({
	instagram: z.array(z.number().int()),
	tiktok: z.array(z.number().int()),
});

export interface ScreenHit {
	platform: Platform;
	/** Index within its platform's list. */
	index: number;
	text: string;
}

export async function screenHits(
	args: { brief: InfluencerBrief; hits: ScreenHit[]; keep: Record<Platform, number> },
	onCost?: OnCost,
): Promise<Record<Platform, number[]>> {
	const lines = args.hits.map((h) => `${h.platform === "instagram" ? "IG" : "TT"}${h.index}: ${h.text}`).join("\n");
	const prompt = [
		`We look for individual creators (real people) matching this brief: "${args.brief.direction}".`,
		...brandLines(args.brief.brand),
		...guidanceLines(args.brief),
		`Below are search hits (Instagram posts IGn, TikTok creators TTn). Keep the hits most likely to come from an individual creator who fits.`,
		`Drop hits that sound like a brand, retailer or store speaking about itself, aggregator or listicle accounts, and unrelated content. Prefer distinct creators. When unsure, keep.`,
		`Return at most ${args.keep.instagram} Instagram indexes and ${args.keep.tiktok} TikTok indexes.`,
		lines,
	].join("\n");
	const r = await ask(prompt, screenSchema, onCost);
	const valid = (list: number[], platform: Platform) => {
		const known = new Set(args.hits.filter((h) => h.platform === platform).map((h) => h.index));
		return [...new Set(list)].filter((i) => known.has(i)).slice(0, args.keep[platform]);
	};
	return { instagram: valid(r.instagram, "instagram"), tiktok: valid(r.tiktok, "tiktok") };
}

// ── 3. judge ────────────────────────────────────────────────────────

export interface JudgeDossier {
	platform: Platform;
	handle: string;
	name: string | null;
	followers: number | null;
	bio: string;
	links: string[];
	category: string | null;
	lastPostDaysAgo: number | null;
	postsPerWeek: number | null;
	engagementPct: number | null;
	/** The hashtags they use most across recent posts, most used first. */
	topHashtags: string[];
	/** Recent caption lines, only included when the bio is nearly empty. */
	posts: string[];
	/** Competitor names found in the account's own identity (handle, name, site). */
	competitorIdentity: string[];
	/** Competitor names appearing in the account's posts. */
	competitorMentions: string[];
}

const judgmentSchema = z.object({
	results: z.array(
		z.object({
			handle: z.string(),
			kind: z.enum(["individual_creator", "brand_or_business", "unclear"]),
			fitScore: z.number().int().min(0).max(100),
			verdict: z.enum(["include", "maybe", "exclude"]),
			confidence: z.number().min(0).max(1),
			fitReason: z.string().describe("One sentence on why they do or don't fit."),
			fitEvidence: z
				.array(z.string())
				.max(2)
				.describe("Up to two short verbatim quotes from the creator's own bio or hashtags."),
			concern: z
				.string()
				.describe("The most obvious reason they might say no or not help the brand, or an empty string."),
			locationOk: z
				.enum(["yes", "no", "unknown"])
				.describe("Whether the creator is based in, or clearly speaks to an audience in, one of the brand's markets."),
			competitor: z.object({
				isCompetitor: z.boolean(),
				promotesCompetitor: z.boolean(),
				names: z.array(z.string()),
				evidence: z.string(),
			}),
		}),
	),
});

export type Judgment = z.infer<typeof judgmentSchema>["results"][number] & { kind: CreatorKind; verdict: Verdict };

export async function judgeCreators(
	args: { brief: InfluencerBrief; brandName: string; competitors: string[]; batch: JudgeDossier[] },
	onCost?: OnCost,
): Promise<Judgment[]> {
	const prompt = [
		`You are the outreach lead for ${args.brandName}, deciding whether each creator is worth writing to. Brief: "${args.brief.direction}".`,
		...brandLines(args.brief.brand),
		`Competitors of ${args.brandName}: ${args.competitors.join(", ") || "none listed"}.`,
		args.brief.fitSignals.length ? `Phrases that count as evidence of fit: ${args.brief.fitSignals.join("; ")}.` : "",
		...guidanceLines(args.brief),
		`Rules:`,
		`- Judge mainly on the bio, name, links and topHashtags (what they post about most). Recent post lines are only given when the bio is nearly empty. Use ONLY the evidence given, never guess from appearance or a name.`,
		`- "kind": individual_creator means one real person creating content. Shops, restaurants, tailors, labels and media pages are brand_or_business.`,
		`- Ask three things of every creator. Would they plausibly make content for this brand if asked? Are there obvious reasons they would say no, or that it would not help (any of the brand's deal-breakers, a business rather than a person, working exclusively with a competitor, an audience outside the brand's markets)? Would the brand benefit, given who it sells to and where? Put the biggest reason for a no in "concern".`,
		`- locationOk: "no" when the bio or hashtags clearly place them outside the brand's markets (a city, country, flag, language or currency), "yes" when they clearly are in one, otherwise "unknown". Never guess from a name or appearance. A "no" means exclude.`,
		`- fitScore above 75 only with a clear fit in the bio and hashtags AND regular posting. Verdict include >= 70 with high confidence, maybe for real but partial or thin evidence, exclude otherwise or for anything that isn't an individual creator.`,
		`- Sponsorships and competitor promotion are checked in code. Set promotesCompetitor only when the bio or hashtags clearly show it.`,
		`- competitorIdentity / competitorMentions are pre-checks. Confirm or refute them from the evidence. Naming a competitor in passing (a comparison, a complaint) is not promoting it.`,
		`Keep every fitReason to one short sentence. Return {"results": [...]} with one entry per candidate, in the same order, each carrying its handle.`,
		JSON.stringify(args.batch),
	]
		.filter(Boolean)
		.join("\n");
	const r = await ask(prompt, judgmentSchema, onCost);
	return r.results as Judgment[];
}
