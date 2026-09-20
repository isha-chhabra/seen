/**
 * Influencer Finder data contract, shared by the engine, the server functions
 * and the results screen. Plain JSON-serialisable types only.
 */

export type Platform = "instagram" | "tiktok";
export type Verdict = "include" | "maybe" | "exclude";
export type CreatorKind = "individual_creator" | "brand_or_business" | "unclear";

/** What the search was asked to find. Editable by the user before anything runs. */
export interface InfluencerBrief {
	/** The user's own words, e.g. "big and tall men who post menswear fit content". */
	direction: string;
	platforms: Platform[];
	/** Natural search phrases (no operators), by platform. */
	queries: Record<Platform, string[]>;
	/** Brand names that must never appear as a creator or a creator's partner. */
	competitors: string[];
	/** Concrete phrases/hashtags that count as evidence of fit (bio, captions, hashtags). */
	fitSignals: string[];
	/** Follower bands to keep; empty means any size. */
	followerBands: FollowerBand[];
	/** Optional extras that sharpen the search; every one may be empty or absent. */
	/** Handles of creators they already like, as a style reference. */
	similarTo?: string[];
	/** Kinds of account to rule out, in their words, e.g. "giveaway pages". */
	avoid?: string[];
	/** Where the audience should be, e.g. "United States". */
	basedIn?: string[];
}

export type FollowerBand = "nano" | "micro" | "mid" | "macro" | "mega";

/** [min, max) follower counts; max null means no upper limit. */
export const FOLLOWER_BANDS: Record<FollowerBand, { label: string; min: number; max: number | null }> = {
	nano: { label: "Nano (1K–10K)", min: 1_000, max: 10_000 },
	micro: { label: "Micro (10K–100K)", min: 10_000, max: 100_000 },
	mid: { label: "Mid (100K–500K)", min: 100_000, max: 500_000 },
	macro: { label: "Macro (500K–1M)", min: 500_000, max: 1_000_000 },
	mega: { label: "Mega (1M+)", min: 1_000_000, max: null },
};

export function followerBandOf(followers: number | null | undefined): FollowerBand | null {
	if (followers === null || followers === undefined || followers < 1_000) return null;
	for (const [band, { min, max }] of Object.entries(FOLLOWER_BANDS) as [
		FollowerBand,
		(typeof FOLLOWER_BANDS)[FollowerBand],
	][]) {
		if (followers >= min && (max === null || followers < max)) return band;
	}
	return null;
}

export type SponsorTag = "ad" | "gifted" | "partner" | "code" | "own_brand" | "organic";

export interface CreatorPost {
	/** ISO timestamp, when known. */
	date: string | null;
	kind: string | null;
	caption: string;
	url: string | null;
	tag: SponsorTag;
	/** Third-party brand behind a sponsored post, when one could be read from it. */
	brand: string | null;
}

export interface CollabSummary {
	/** Recent posts carrying a sponsorship marker (#ad, paid partnership, gifted, discount code...). */
	sponsoredPosts: number;
	/** Posts looked at, so "3 of 12" means something. */
	postsChecked: number;
	brands: string[];
	/** Whether the sponsored posts are labelled as such; null when there were none. */
	discloses: boolean | null;
}

export interface CompetitorCheck {
	/** The account itself is a competitor (its name, handle or site). */
	isCompetitor: boolean;
	/** Recent sponsored content for a competitor. */
	promotesCompetitor: boolean;
	names: string[];
	evidence: string;
}

export interface InfluencerResult {
	/** "instagram:handle", lowercase. */
	key: string;
	platform: Platform;
	handle: string;
	name: string | null;
	profileUrl: string;
	followers: number | null;
	postsCount: number | null;
	bio: string;
	links: string[];
	fitScore: number;
	verdict: Verdict;
	confidence: number;
	kind: CreatorKind;
	fitReason: string;
	/** Short quotes from the creator's own words that back up the fit. */
	fitEvidence: string[];
	/** Average (likes + comments) / followers, in percent. Null when likes are hidden or unavailable. */
	engagementPct: number | null;
	/** How many posts the average is based on. */
	engagementSample: number;
	/** Null when activity can't be measured (TikTok returns top videos, not recent ones). */
	postsPerWeek: number | null;
	lastPostDaysAgo: number | null;
	collab: CollabSummary;
	competitor: CompetitorCheck;
	concern: string;
	recentPosts: CreatorPost[];
	/** Why a creator was set aside, for the Excluded list. */
	excludedBecause: "competitor" | "competitor_partner" | "not_a_creator" | "low_fit" | null;
}

export interface InfluencerSearchStats {
	searches: number;
	postsFound: number;
	creatorsFound: number;
	creatorsAnalyzed: number;
	fromCache: number;
	included: number;
	maybe: number;
	excluded: number;
	/** Set when the run stopped early because it reached the spending limit. */
	stoppedAtBudget: boolean;
}

export interface InfluencerSearchCost {
	usd: number;
	capUsd: number;
	searches: number;
	records: number;
}

export interface InfluencerSearchPayload {
	results: InfluencerResult[];
	stats: InfluencerSearchStats;
	brief: InfluencerBrief;
	cost: InfluencerSearchCost;
}
