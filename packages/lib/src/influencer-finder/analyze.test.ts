import { describe, expect, it } from "vitest";
import {
	buildCompetitorMatcher,
	daysSince,
	engagementPct,
	inFollowerBands,
	postsPerWeek,
	summarizeCollabs,
	tagPost,
} from "./analyze";

describe("postsPerWeek", () => {
	it("measures cadence over the span of the dates", () => {
		// 12 posts over 77 days: 11 intervals / 77 days * 7 = 1.0/week
		const dates = Array.from({ length: 12 }, (_, i) =>
			new Date(Date.UTC(2026, 6, 1) + i * 7 * 86_400_000).toISOString(),
		);
		expect(postsPerWeek(dates)).toBe(1);
	});
	it("needs two posts to measure anything", () => {
		expect(postsPerWeek([])).toBeNull();
		expect(postsPerWeek(["2026-09-01T00:00:00Z"])).toBeNull();
	});
});

describe("daysSince", () => {
	it("counts whole days and tolerates missing or bad dates", () => {
		const now = Date.UTC(2026, 8, 19);
		expect(daysSince("2026-09-17T00:00:00Z", now)).toBe(2);
		expect(daysSince(null, now)).toBeNull();
		expect(daysSince("not a date", now)).toBeNull();
	});
});

describe("engagementPct", () => {
	it("uses the median, so one viral post does not distort the rate", () => {
		const r = engagementPct(
			[
				{ likes: 900, comments: 100 },
				{ likes: 1000, comments: 0 },
				{ likes: 1100, comments: 0 },
				{ likes: 400_000, comments: 1000 },
			],
			100_000,
		);
		expect(r.pct).toBe(1.05);
		expect(r.sample).toBe(4);
	});

	it("averages (likes + comments) over followers across the visible posts", () => {
		const r = engagementPct(
			[
				{ likes: 90, comments: 10 },
				{ likes: 180, comments: 20 },
			],
			10_000,
		);
		expect(r).toEqual({ pct: 1.5, sample: 2 });
	});
	it("leaves out posts with hidden likes instead of counting them as zero", () => {
		const r = engagementPct(
			[
				{ likes: -1, comments: 4 },
				{ likes: null, comments: 4 },
				{ likes: 100, comments: 0 },
			],
			1_000,
		);
		expect(r).toEqual({ pct: 10, sample: 1 });
	});
	it("returns null when nothing is measurable", () => {
		expect(engagementPct([{ likes: -1, comments: 0 }], 1000).pct).toBeNull();
		expect(engagementPct([{ likes: 5, comments: 1 }], 0).pct).toBeNull();
	});
});

describe("tagPost", () => {
	const self = { handle: "zachmiko", name: "Zach Miko" };
	it("reads a hashtag ad and the brand credited on the post", () => {
		const p = tagPost(
			{
				caption: "@onebonebrand has been my secret weapon",
				hashtags: ["#onebone", "#ad", "#sponsored"],
				coauthors: ["onebonebrand"],
			},
			self,
		);
		expect(p.tag).toBe("ad");
		expect(p.brand).toBe("onebonebrand");
	});
	it("does not mistake #adventure or a word ending in ad for an ad marker", () => {
		expect(tagPost({ caption: "Sunday #adventure with the crew, so rad" }, self).tag).toBe("organic");
	});
	it("recognises gifted, discount-code and partnership language", () => {
		expect(tagPost({ caption: "Thanks @brandx for sending this, #gifted" }, self).tag).toBe("gifted");
		expect(tagPost({ caption: "Use code ZACH15 for 15% off" }, self).tag).toBe("code");
		expect(tagPost({ caption: "In partnership with @brandy on this drop" }, self).tag).toBe("partner");
	});
	it("treats Instagram's paid-partnership label as an ad even without a hashtag", () => {
		expect(tagPost({ caption: "New fit", partnershipLabel: true }, self).tag).toBe("ad");
	});
	it("does not count a creator's own line as a sponsor", () => {
		const own = { handle: "thebigfashionguy", name: "The Big Fashion Guy" };
		for (const caption of [
			"New drop from @thebigfashionguycollection #ad",
			"New drop from @thebigfashioncollection #ad",
		]) {
			const p = tagPost({ caption }, own);
			expect(p.tag).toBe("own_brand");
			expect(p.brand).toBeNull();
		}
		// an unrelated brand with a similar-looking start is still a sponsor
		expect(tagPost({ caption: "Thanks @thebigcloset #ad" }, own).brand).toBe("thebigcloset");
	});
});

describe("summarizeCollabs", () => {
	it("counts sponsored posts, lists brands once, and reports disclosure", () => {
		const s = summarizeCollabs([
			{ date: null, kind: null, caption: "", url: null, tag: "ad", brand: "walmart" },
			{ date: null, kind: null, caption: "", url: null, tag: "ad", brand: "walmart" },
			{ date: null, kind: null, caption: "", url: null, tag: "code", brand: "amazon" },
			{ date: null, kind: null, caption: "", url: null, tag: "organic", brand: null },
			{ date: null, kind: null, caption: "", url: null, tag: "own_brand", brand: null },
		]);
		expect(s).toEqual({ sponsoredPosts: 3, postsChecked: 5, brands: ["walmart", "amazon"], discloses: true });
	});
	it("says nothing about disclosure when there were no sponsored posts", () => {
		expect(
			summarizeCollabs([{ date: null, kind: null, caption: "", url: null, tag: "organic", brand: null }]).discloses,
		).toBeNull();
	});
});

describe("buildCompetitorMatcher", () => {
	const matcher = buildCompetitorMatcher([
		{ name: "One Bone", domains: ["onebonebrand.com"], aliases: ["onebone"] },
		{ name: "Casual Male XL", domains: ["casualmale.com"], aliases: ["Casual Male"] },
		{ name: "Target", domains: ["target.com"] },
		{ name: "Carhartt", domains: ["carhartt.com"] },
	]);
	it("finds a competitor in an account's own handle, name or site", () => {
		expect(matcher.identity(["onebonebrand", "One Bone", "onebonebrand.com"])).toEqual(["One Bone"]);
		expect(matcher.identity(["zachmiko", "Zach Miko", "linktr.ee"])).toEqual([]);
		// a short common-word brand must be the account itself, not just appear inside a longer handle
		expect(matcher.identity(["targetfitness", "Target Fitness Coach", "linktr.ee"])).toEqual([]);
		expect(matcher.identity(["target", "Target", "target.com"])).toEqual(["Target"]);
	});
	it("finds competitors named or tagged in captions", () => {
		expect(matcher.mentions("Loving this shirt from @onebonebrand #ad")).toEqual(["One Bone"]);
		expect(matcher.mentions("I wore my Casual Male XL jacket")).toEqual(["Casual Male XL"]);
		expect(matcher.mentions("Carhartt work jacket haul")).toEqual(["Carhartt"]);
	});
	it("does not fire on an ordinary word that happens to be a short brand name", () => {
		expect(matcher.mentions("my target this year is to hit the gym")).toEqual([]);
		expect(matcher.mentions("picked it up at @target")).toEqual(["Target"]);
	});
});

describe("inFollowerBands", () => {
	it("keeps everyone when no band is chosen, otherwise only the chosen bands", () => {
		expect(inFollowerBands(500, [])).toBe(true);
		expect(inFollowerBands(50_000, ["micro"])).toBe(true);
		expect(inFollowerBands(50_000, ["mid", "macro"])).toBe(false);
		expect(inFollowerBands(2_400_000, ["mega"])).toBe(true);
		expect(inFollowerBands(300, ["nano"])).toBe(false);
	});
});
