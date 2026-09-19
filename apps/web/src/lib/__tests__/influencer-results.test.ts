import type { InfluencerResult } from "@workspace/lib/influencer-finder/types";
import { describe, expect, it } from "vitest";
import {
	applyFilters,
	defaultFilters,
	formatCount,
	formatDaysAgo,
	matchesFilters,
	sortResults,
	summarize,
} from "../influencer-results";

function creator(over: Partial<InfluencerResult> & { handle: string }): InfluencerResult {
	return {
		key: `instagram:${over.handle}`,
		platform: "instagram",
		name: null,
		profileUrl: `https://www.instagram.com/${over.handle}/`,
		followers: 50_000,
		postsCount: 100,
		bio: "",
		links: [],
		fitScore: 80,
		verdict: "include",
		confidence: 0.9,
		kind: "individual_creator",
		fitReason: "fits",
		fitEvidence: [],
		engagementPct: 2,
		engagementSample: 4,
		postsPerWeek: 2,
		lastPostDaysAgo: 3,
		collab: { sponsoredPosts: 0, postsChecked: 12, brands: [], discloses: null },
		competitor: { isCompetitor: false, promotesCompetitor: false, names: [], evidence: "" },
		concern: "",
		recentPosts: [],
		excludedBecause: null,
		...over,
	};
}

describe("matchesFilters", () => {
	const a = creator({ handle: "a" });
	it("shows only the chosen tab", () => {
		const f = defaultFilters();
		expect(matchesFilters(a, f)).toBe(true);
		expect(matchesFilters(creator({ handle: "b", verdict: "maybe" }), f)).toBe(false);
		expect(matchesFilters(creator({ handle: "b", verdict: "exclude" }), { ...f, tab: "excluded" })).toBe(true);
	});

	it("keeps creators of the chosen platforms and follower bands", () => {
		const tt = creator({ handle: "t", platform: "tiktok", followers: 5_000 });
		expect(matchesFilters(tt, { ...defaultFilters(), platforms: new Set(["instagram"]) })).toBe(false);
		expect(matchesFilters(tt, { ...defaultFilters(), bands: new Set(["nano"]) })).toBe(true);
		expect(matchesFilters(a, { ...defaultFilters(), bands: new Set(["nano"]) })).toBe(false);
	});

	it("leaves out creators with an unknown value while a filter on that value is on", () => {
		const tiktok = creator({
			handle: "t",
			platform: "tiktok",
			postsPerWeek: null,
			lastPostDaysAgo: null,
			engagementPct: null,
		});
		const f = defaultFilters();
		expect(matchesFilters(tiktok, f)).toBe(true);
		expect(matchesFilters(tiktok, { ...f, activeWithinDays: 30 })).toBe(false);
		expect(matchesFilters(tiktok, { ...f, minPostsPerWeek: 1 })).toBe(false);
		expect(matchesFilters(tiktok, { ...f, minEngagement: 1 })).toBe(false);
	});

	it("applies fit, engagement, activity and cadence thresholds", () => {
		const f = { ...defaultFilters(), minFit: 85 };
		expect(matchesFilters(a, f)).toBe(false);
		expect(matchesFilters(a, { ...defaultFilters(), minEngagement: 2 })).toBe(true);
		expect(matchesFilters(a, { ...defaultFilters(), minEngagement: 3 })).toBe(false);
		expect(matchesFilters(a, { ...defaultFilters(), activeWithinDays: 7 })).toBe(true);
		expect(
			matchesFilters(creator({ handle: "old", lastPostDaysAgo: 40 }), { ...defaultFilters(), activeWithinDays: 30 }),
		).toBe(false);
	});

	it("filters by collaboration history", () => {
		const collab = creator({
			handle: "c",
			collab: { sponsoredPosts: 2, postsChecked: 12, brands: ["Walmart"], discloses: true },
		});
		expect(matchesFilters(collab, { ...defaultFilters(), collab: "has" })).toBe(true);
		expect(matchesFilters(collab, { ...defaultFilters(), collab: "none" })).toBe(false);
		expect(matchesFilters(a, { ...defaultFilters(), collab: "has" })).toBe(false);
	});

	it("searches handle, name, bio, reason and the brands they've worked with", () => {
		const c = creator({
			handle: "zach",
			name: "Zach Miko",
			bio: "menswear",
			collab: { sponsoredPosts: 1, postsChecked: 12, brands: ["Buck Mason"], discloses: true },
		});
		for (const q of ["zach", "miko", "menswear", "buck mason"])
			expect(matchesFilters(c, { ...defaultFilters(), search: q })).toBe(true);
		expect(matchesFilters(c, { ...defaultFilters(), search: "nike" })).toBe(false);
	});
});

describe("sortResults", () => {
	const rows = [
		creator({ handle: "low", fitScore: 60, followers: 900_000, engagementPct: null, lastPostDaysAgo: 1 }),
		creator({ handle: "mid", fitScore: 80, followers: 20_000, engagementPct: 4, lastPostDaysAgo: 30 }),
		creator({ handle: "top", fitScore: 95, followers: 300_000, engagementPct: 1, lastPostDaysAgo: null }),
	];
	it("sorts by fit and followers in either direction", () => {
		expect(sortResults(rows, "fit", "desc").map((r) => r.handle)).toEqual(["top", "mid", "low"]);
		expect(sortResults(rows, "followers", "asc").map((r) => r.handle)).toEqual(["mid", "top", "low"]);
	});
	it("always puts creators with no value last, whichever way it sorts", () => {
		expect(sortResults(rows, "engagement", "desc").map((r) => r.handle)).toEqual(["mid", "top", "low"]);
		expect(sortResults(rows, "engagement", "asc").map((r) => r.handle)).toEqual(["top", "mid", "low"]);
		expect(sortResults(rows, "lastPost", "desc").map((r) => r.handle)).toEqual(["low", "mid", "top"]);
	});
	it("does not change the input", () => {
		const copy = [...rows];
		sortResults(rows, "fit", "asc");
		expect(rows).toEqual(copy);
	});
});

describe("applyFilters + summarize", () => {
	const rows = [
		creator({ handle: "a", followers: 5_000, engagementPct: 6 }),
		creator({
			handle: "b",
			followers: 80_000,
			engagementPct: 2,
			collab: { sponsoredPosts: 3, postsChecked: 12, brands: ["X"], discloses: true },
		}),
		creator({ handle: "c", verdict: "maybe", followers: 250_000, engagementPct: null }),
		creator({ handle: "d", verdict: "exclude", excludedBecause: "competitor" }),
		creator({ handle: "e", verdict: "exclude", excludedBecause: "low_fit" }),
	];
	it("filters then sorts", () => {
		expect(applyFilters(rows, defaultFilters(), "engagement", "desc").map((r) => r.handle)).toEqual(["a", "b"]);
	});
	it("summarises the kept creators and counts competitor exclusions", () => {
		const s = summarize(rows);
		expect(s).toMatchObject({
			matches: 2,
			maybe: 1,
			excluded: 2,
			excludedByCompetitor: 1,
			withCollabs: 1,
			medianEngagementPct: 4,
		});
		expect(s.bands).toEqual({ nano: 1, micro: 1, mid: 1 });
		expect(s.medianFollowers).toBe(80_000);
	});
});

describe("formatters", () => {
	it("formats follower counts", () => {
		expect(formatCount(850)).toBe("850");
		expect(formatCount(1_500)).toBe("1.5K");
		expect(formatCount(47_000)).toBe("47K");
		expect(formatCount(2_400_000)).toBe("2.4M");
		expect(formatCount(null)).toBe("—");
	});
	it("formats how long ago", () => {
		expect(formatDaysAgo(0)).toBe("today");
		expect(formatDaysAgo(1)).toBe("yesterday");
		expect(formatDaysAgo(12)).toBe("12 days ago");
		expect(formatDaysAgo(90)).toBe("3 mo ago");
		expect(formatDaysAgo(null)).toBe("—");
	});
});
