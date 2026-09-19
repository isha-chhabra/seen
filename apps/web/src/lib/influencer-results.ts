/**
 * Filtering, sorting and summarising Influencer Finder results. Pure functions
 * over InfluencerResult so the screen stays thin and the rules are testable.
 *
 * One rule runs through the filters: a creator whose value for a filtered field
 * is unknown (TikTok activity, hidden likes) is left out while that filter is
 * on, never let through silently. The screen says so next to the filter.
 */
import type { FollowerBand, InfluencerResult, Platform, Verdict } from "@workspace/lib/influencer-finder/types";
import { followerBandOf } from "@workspace/lib/influencer-finder/types";

export type ResultTab = "matches" | "maybe" | "excluded";
export type CollabFilter = "any" | "has" | "none";
export type SortKey = "fit" | "followers" | "engagement" | "postsPerWeek" | "lastPost" | "collabs" | "name";
export type SortDir = "asc" | "desc";

export interface ResultFilters {
	tab: ResultTab;
	platforms: Set<Platform>;
	bands: Set<FollowerBand>;
	minFit: number;
	minEngagement: number;
	/** Posted within this many days; 0 means any. */
	activeWithinDays: number;
	minPostsPerWeek: number;
	collab: CollabFilter;
	search: string;
}

export function defaultFilters(): ResultFilters {
	return {
		tab: "matches",
		platforms: new Set(),
		bands: new Set(),
		minFit: 0,
		minEngagement: 0,
		activeWithinDays: 0,
		minPostsPerWeek: 0,
		collab: "any",
		search: "",
	};
}

const TAB_VERDICT: Record<ResultTab, Verdict> = { matches: "include", maybe: "maybe", excluded: "exclude" };

export function tabOf(r: Pick<InfluencerResult, "verdict">): ResultTab {
	return r.verdict === "include" ? "matches" : r.verdict === "maybe" ? "maybe" : "excluded";
}

export function matchesFilters(r: InfluencerResult, f: ResultFilters): boolean {
	if (r.verdict !== TAB_VERDICT[f.tab]) return false;
	if (f.platforms.size > 0 && !f.platforms.has(r.platform)) return false;
	if (f.bands.size > 0) {
		const band = followerBandOf(r.followers);
		if (!band || !f.bands.has(band)) return false;
	}
	if (r.fitScore < f.minFit) return false;
	if (f.minEngagement > 0 && (r.engagementPct === null || r.engagementPct < f.minEngagement)) return false;
	if (f.activeWithinDays > 0 && (r.lastPostDaysAgo === null || r.lastPostDaysAgo > f.activeWithinDays)) return false;
	if (f.minPostsPerWeek > 0 && (r.postsPerWeek === null || r.postsPerWeek < f.minPostsPerWeek)) return false;
	if (f.collab === "has" && r.collab.sponsoredPosts === 0) return false;
	if (f.collab === "none" && r.collab.sponsoredPosts > 0) return false;
	const q = f.search.trim().toLowerCase();
	if (q) {
		const hay = [r.handle, r.name, r.bio, r.fitReason, ...r.collab.brands, ...r.links].join(" ").toLowerCase();
		if (!hay.includes(q)) return false;
	}
	return true;
}

const sortValue: Record<SortKey, (r: InfluencerResult) => number | string | null> = {
	fit: (r) => r.fitScore,
	followers: (r) => r.followers,
	engagement: (r) => r.engagementPct,
	postsPerWeek: (r) => r.postsPerWeek,
	// fewer days since the last post is "more recent", so it sorts by the negative
	lastPost: (r) => (r.lastPostDaysAgo === null ? null : -r.lastPostDaysAgo),
	collabs: (r) => r.collab.sponsoredPosts,
	name: (r) => (r.name ?? r.handle).toLowerCase(),
};

/** Sorts a copy. Creators with no value for the key always go last, in either direction. */
export function sortResults(results: readonly InfluencerResult[], key: SortKey, dir: SortDir): InfluencerResult[] {
	const value = sortValue[key];
	const sign = dir === "asc" ? 1 : -1;
	return [...results].sort((a, b) => {
		const av = value(a);
		const bv = value(b);
		if (av === null && bv === null) return b.fitScore - a.fitScore;
		if (av === null) return 1;
		if (bv === null) return -1;
		if (av < bv) return -sign;
		if (av > bv) return sign;
		return b.fitScore - a.fitScore;
	});
}

export function applyFilters(
	results: readonly InfluencerResult[],
	f: ResultFilters,
	key: SortKey,
	dir: SortDir,
): InfluencerResult[] {
	return sortResults(
		results.filter((r) => matchesFilters(r, f)),
		key,
		dir,
	);
}

export interface ResultsSummary {
	matches: number;
	maybe: number;
	excluded: number;
	excludedByCompetitor: number;
	withCollabs: number;
	medianEngagementPct: number | null;
	medianFollowers: number | null;
	bands: Partial<Record<FollowerBand, number>>;
}

const median = (values: number[]): number | null => {
	if (values.length === 0) return null;
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	const m = s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
	return Math.round(m * 100) / 100;
};

/** Numbers for the strip above the table, over the creators being kept (matches and maybes). */
export function summarize(results: readonly InfluencerResult[]): ResultsSummary {
	const kept = results.filter((r) => r.verdict !== "exclude");
	const bands: ResultsSummary["bands"] = {};
	for (const r of kept) {
		const band = followerBandOf(r.followers);
		if (band) bands[band] = (bands[band] ?? 0) + 1;
	}
	return {
		matches: results.filter((r) => r.verdict === "include").length,
		maybe: results.filter((r) => r.verdict === "maybe").length,
		excluded: results.filter((r) => r.verdict === "exclude").length,
		excludedByCompetitor: results.filter(
			(r) => r.excludedBecause === "competitor" || r.excludedBecause === "competitor_partner",
		).length,
		withCollabs: kept.filter((r) => r.collab.sponsoredPosts > 0).length,
		medianEngagementPct: median(kept.map((r) => r.engagementPct).filter((v): v is number => v !== null)),
		medianFollowers: median(kept.map((r) => r.followers).filter((v): v is number => v !== null)),
		bands,
	};
}

/** 47000 -> "47K", 2400000 -> "2.4M", 850 -> "850". */
export function formatCount(n: number | null | undefined): string {
	if (n === null || n === undefined) return "—";
	if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
	if (n >= 10_000) return `${Math.round(n / 1_000)}K`;
	if (n >= 1_000) return `${trim(n / 1_000)}K`;
	return String(n);
}
const trim = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, "");

/** "2 days ago", "today", "3 months ago", or an em dash when unknown. */
export function formatDaysAgo(days: number | null | undefined): string {
	if (days === null || days === undefined) return "—";
	if (days <= 0) return "today";
	if (days === 1) return "yesterday";
	if (days < 30) return `${days} days ago`;
	if (days < 365) return `${Math.round(days / 30)} mo ago`;
	return `${Math.round(days / 365)} yr ago`;
}
