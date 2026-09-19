/**
 * The three model steps of Influencer Finder (gpt-5-mini via the onboarding provider):
 *
 *   1. draftBrief   , the user's free-text direction -> search phrases, competitor
 *                     suggestions and the phrases that count as evidence of fit
 *   2. screenHits   , a cheap first read of search hits (handle + caption snippet)
 *                     to decide which few deserve a paid lookup
 *   3. judgeCreators, reads each analysed creator's bio and recent posts against the
 *                     brief. Counting (cadence, engagement, sponsorships) is done in
 *                     code and passed in; the model only reads and rates.
 */
import { z } from "zod";
import { runStructuredCompletionPrompt } from "../onboarding/llm";
import type { CreatorKind, InfluencerBrief, Platform, Verdict } from "./types";

type OnCost = (promptChars: number, outputChars: number) => void;

async function ask<T>(prompt: string, schema: z.ZodType<T>, onCost?: OnCost): Promise<T> {
	const { object } = await runStructuredCompletionPrompt(prompt, schema);
	onCost?.(prompt.length, JSON.stringify(object).length);
	return object;
}

// ── 1. brief ────────────────────────────────────────────────────────

const briefSchema = z.object({
	instagramQueries: z.array(z.string()).min(4).max(10),
	tiktokQueries: z.array(z.string()).min(2).max(6),
	extraCompetitors: z.array(z.string()).max(12),
	fitSignals: z.array(z.string()).min(3).max(14),
});

export async function draftBrief(
	args: {
		brandName: string;
		website: string;
		competitors: string[];
		direction: string;
		platforms: Platform[];
	},
	onCost?: OnCost,
): Promise<Pick<InfluencerBrief, "queries" | "fitSignals"> & { extraCompetitors: string[] }> {
	const prompt = [
		`Brand: ${args.brandName} (${args.website}). Known competitors: ${args.competitors.join(", ") || "none listed"}.`,
		`The team wants influencers to reach out to. In their words: "${args.direction}".`,
		`Return:`,
		`- instagramQueries: 6 to 8 natural phrases a creator of this kind would write in captions or a shopper would search. Content-first, varied angles (style, fit, reviews, hauls, occasions, sub-audiences). No quotes, no operators like site:, no brand names, no years, no country names.`,
		`- tiktokQueries: 3 to 5 in the same spirit, phrased the way TikTok creators title videos.`,
		`- extraCompetitors: up to 10 brands or major retailers a creator here might also promote that compete with ${args.brandName} and are NOT already listed. Short names only.`,
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
	/** "date type: caption #tags [sponsored: ad, brand X]" lines, newest first. */
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
			fitEvidence: z.array(z.string()).max(4).describe("Short verbatim quotes from the creator's own bio or captions."),
			concern: z.string().describe("Main reservation, or an empty string."),
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
		`You judge influencer candidates for ${args.brandName}. Brief: "${args.brief.direction}".`,
		`Competitors of ${args.brandName}: ${args.competitors.join(", ") || "none listed"}.`,
		args.brief.fitSignals.length ? `Phrases that count as evidence of fit: ${args.brief.fitSignals.join("; ")}.` : "",
		`Rules:`,
		`- Use ONLY the evidence given. Fit must be supported by the creator's own words (bio, captions, hashtags) and by what they regularly post, never guessed from appearance or a name.`,
		`- "kind": individual_creator means one real person creating content. Shops, restaurants, tailors, labels and media pages are brand_or_business.`,
		`- fitScore above 75 only with clear fit AND regular relevant posting. Verdict include >= 70 with high confidence, maybe for real but partial or thin evidence, exclude otherwise or for anything that isn't an individual creator.`,
		`- Sponsored posts are already tagged in the data (ad, gifted, partner, code, own_brand). Do not recount them. Use them only to judge competitor promotion: set promotesCompetitor when a sponsored post is for a competitor.`,
		`- competitorIdentity / competitorMentions are pre-checks. Confirm or refute them from the evidence. Naming a competitor in passing (a comparison, a complaint) is not promoting it.`,
		`Return {"results": [...]} with one entry per candidate, in the same order, each carrying its handle.`,
		JSON.stringify(args.batch),
	]
		.filter(Boolean)
		.join("\n");
	const r = await ask(prompt, judgmentSchema, onCost);
	return r.results as Judgment[];
}
