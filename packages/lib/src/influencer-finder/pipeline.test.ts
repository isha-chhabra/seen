import { describe, expect, it, vi } from "vitest";
import { DATASETS } from "./datasets";
import type { JudgeDossier, Judgment, ScreenHit } from "./llm";
import { type CachedProfile, type PipelineDeps, type PipelineInput, runInfluencerSearch } from "./pipeline";
import type { InfluencerBrief } from "./types";

const brief: InfluencerBrief = {
	direction: "big and tall men who post menswear fit content",
	platforms: ["instagram", "tiktok"],
	queries: { instagram: ["big and tall outfit ideas", "plus size men fit check"], tiktok: ["tall guy style"] },
	competitors: ["One Bone"],
	fitSignals: ["#bigandtall"],
	followerBands: [],
};

const input = (overrides: Partial<PipelineInput> = {}): PipelineInput => ({
	brief,
	brandName: "DXL",
	competitors: [{ name: "One Bone", domains: ["onebonebrand.com"], aliases: ["onebone"] }],
	targetResults: 5,
	capUsd: 0.2,
	...overrides,
});

const NOW = Date.UTC(2026, 8, 19);
const daysAgoIso = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

// ── fake Bright Data records, in the raw shape the real API returns ──
const CODES: Record<string, string> = { AAA: "zachmiko", BBB: "goodguy", CCC: "onebonebrand" };
const igPostRecord = (url: string) => {
	const code = /\/(?:p|reel)\/(\w+)/.exec(url)?.[1] ?? "";
	// Profile posts are named "<handle><n>", so their records belong to that handle, as in the real API.
	const handle = CODES[code] ?? /^([a-z]+)\d+$/.exec(code)?.[1] ?? `poster_${code}`;
	const promo = handle === "zachmiko";
	return {
		url,
		user_posted: handle,
		followers: handle === "goodguy" ? 50_000 : 120_000,
		posts_count: 400,
		likes: 1000,
		num_comments: 50,
		date_posted: daysAgoIso(3),
		product_type: "clips",
		description: promo ? "@onebonebrand has been my secret weapon #ad" : "Fit check for the big guys #bigandtall",
		hashtags: promo ? ["#ad", "#sponsored"] : ["#bigandtall"],
		coauthor_producers: promo ? ["onebonebrand"] : [],
		tagged_users: [],
	};
};
const profilePosts = (handle: string) =>
	Array.from({ length: 12 }, (_, i) => ({
		caption: `${handle} post ${i} big and tall fit`,
		datetime: daysAgoIso(2 + i * 7),
		content_type: "Reel",
		id: `${handle}-${i}`,
		url: `https://www.instagram.com/reel/${handle}${i}/`,
		post_hashtags: ["#bigandtall"],
	}));
const igProfileRecord = (handle: string) => ({
	account: handle,
	full_name: handle === "onebonebrand" ? "One Bone" : `${handle} name`,
	followers: handle === "goodguy" ? 50_000 : 120_000,
	posts_count: 400,
	biography: handle === "goodguy" ? "6'5 big guy, menswear for bigger men" : "menswear",
	external_urls: [{ url: handle === "onebonebrand" ? "https://onebonebrand.com/" : "https://linktr.ee/x" }],
	is_private: false,
	is_verified: false,
	posts: profilePosts(handle),
});
const ttProfileRecord = (handle: string) => ({
	account_id: handle,
	nickname: "Tall Guy",
	followers: 20_000,
	videos_count: 100,
	biography: "Your page for everything tall men",
	awg_engagement_rate: 0.05,
	top_videos: [{ create_date: "2021-01-01T00:00:00Z", description: "tall guy fit", playcount: 1000 }],
});

function makeDeps(overrides: Partial<PipelineDeps> = {}) {
	const judged: string[][] = [];
	const scrapeCalls: { dataset: string; urls: string[] }[] = [];
	const store = new Map<string, CachedProfile>();
	const memoStore = new Map<string, { value: unknown; at: number }>();
	const deps: PipelineDeps = {
		serp: vi.fn(async (query: string) =>
			query.includes("instagram.com")
				? [
						{ url: "https://www.instagram.com/reel/AAA/", title: "t1", snippet: "s1" },
						{ url: "https://www.instagram.com/reel/BBB/", title: "t2", snippet: "s2" },
						{ url: "https://www.instagram.com/p/CCC/", title: "t3", snippet: "s3" },
					]
				: [{ url: "https://www.tiktok.com/@ttguy/video/1", title: "tall guy", snippet: "tall" }],
		),
		expand: vi.fn(async () => []),
		scrape: vi.fn(async (dataset: string, urls: string[]) => {
			scrapeCalls.push({ dataset, urls });
			if (dataset === DATASETS.instagramPost) return urls.map(igPostRecord);
			if (dataset === DATASETS.instagramProfile)
				return urls.map((u) => igProfileRecord(/instagram\.com\/([\w.]+)\/?$/.exec(u)?.[1] ?? ""));
			return urls.map((u) => ttProfileRecord(/@([\w.]+)/.exec(u)?.[1] ?? ""));
		}),
		screen: vi.fn(async ({ hits }: { hits: ScreenHit[] }) => ({
			instagram: hits.filter((h) => h.platform === "instagram").map((h) => h.index),
			tiktok: hits.filter((h) => h.platform === "tiktok").map((h) => h.index),
		})),
		judge: vi.fn(async ({ batch }: { batch: JudgeDossier[] }): Promise<Judgment[]> => {
			judged.push(batch.map((b) => b.handle));
			return batch.map((b) => ({
				handle: b.handle,
				kind: "individual_creator" as const,
				fitScore: b.handle === "goodguy" ? 92 : b.handle === "zachmiko" ? 80 : 60,
				verdict: b.handle === "ttguy" ? ("maybe" as const) : ("include" as const),
				confidence: 0.9,
				fitReason: "fits",
				fitEvidence: ["#bigandtall"],
				concern: "",
				competitor: { isCompetitor: false, promotesCompetitor: false, names: [], evidence: "" },
			}));
		}),
		memo: {
			get: async (k, key) => memoStore.get(`${k}:${key}`) ?? null,
			put: async (k, key, value) => void memoStore.set(`${k}:${key}`, { value, at: NOW }),
		},
		cache: {
			get: async (p, h) => store.get(`${p}:${h.toLowerCase()}`) ?? null,
			put: async (p, h, d) => void store.set(`${p}:${h.toLowerCase()}`, d),
		},
		now: () => NOW,
		...overrides,
	};
	return { deps, judged, scrapeCalls, store, memoStore };
}

describe("runInfluencerSearch", () => {
	it("keeps a real fit, and sets aside a competitor account and a creator promoting a competitor", async () => {
		const { deps, judged } = makeDeps();
		const out = await runInfluencerSearch(input(), deps);
		const byHandle = new Map(out.results.map((r) => [r.handle, r]));

		const good = byHandle.get("goodguy");
		expect(good?.verdict).toBe("include");
		expect(good?.fitScore).toBe(92);

		// the competitor's own account is excluded without the model ever reading it
		const brand = byHandle.get("onebonebrand");
		expect(brand?.verdict).toBe("exclude");
		expect(brand?.excludedBecause).toBe("competitor");
		expect(judged.flat()).not.toContain("onebonebrand");

		// the creator the model liked is still excluded because a sponsored post is for a competitor
		const promoter = byHandle.get("zachmiko");
		expect(promoter?.verdict).toBe("exclude");
		expect(promoter?.excludedBecause).toBe("competitor_partner");
		expect(promoter?.competitor.names).toContain("One Bone");
		expect(promoter?.fitScore).toBeLessThanOrEqual(40);
	});

	it("averages engagement over the posts fetched, and reports how many", async () => {
		const { deps } = makeDeps();
		const out = await runInfluencerSearch(input(), deps);
		const good = out.results.find((r) => r.handle === "goodguy");
		// (1000 likes + 50 comments) / 50,000 followers = 2.1% on every post
		expect(good?.engagementPct).toBe(2.1);
		expect(good?.engagementSample).toBeGreaterThanOrEqual(2);
	});

	it("measures posting cadence for Instagram but not TikTok, which only returns top videos", async () => {
		const { deps } = makeDeps();
		const out = await runInfluencerSearch(input(), deps);
		const good = out.results.find((r) => r.handle === "goodguy");
		expect(good?.postsPerWeek).not.toBeNull();
		expect(good?.lastPostDaysAgo).toBe(2);
		const tt = out.results.find((r) => r.platform === "tiktok");
		expect(tt?.postsPerWeek).toBeNull();
		expect(tt?.lastPostDaysAgo).toBeNull();
		expect(tt?.engagementPct).toBe(5);
	});

	it("never spends past its cap and says so when it stops", async () => {
		const { deps } = makeDeps();
		const out = await runInfluencerSearch(input({ capUsd: 0.03 }), deps);
		expect(out.cost.usd).toBeLessThanOrEqual(0.03);
		expect(out.stats.stoppedAtBudget).toBe(true);
	});

	it("reuses a creator it already paid for instead of buying them again", async () => {
		const first = makeDeps();
		await runInfluencerSearch(input(), first.deps);
		const profileBuys = (calls: { dataset: string; urls: string[] }[]) =>
			calls.filter((c) => c.dataset === DATASETS.instagramProfile).flatMap((c) => c.urls);
		expect(profileBuys(first.scrapeCalls).length).toBeGreaterThan(0);

		const second = makeDeps({ cache: first.deps.cache });
		const out = await runInfluencerSearch(input(), second.deps);
		expect(profileBuys(second.scrapeCalls)).toEqual([]);
		expect(out.stats.fromCache).toBeGreaterThan(0);
	});

	it("drops creators outside the chosen follower bands before paying for a judgement", async () => {
		const { deps, judged } = makeDeps();
		await runInfluencerSearch(input({ brief: { ...brief, followerBands: ["mid"] } }), deps);
		// goodguy has 50K followers (micro), so the model never reads him
		expect(judged.flat()).not.toContain("goodguy");
	});

	it("reports progress through the stages", async () => {
		const { deps } = makeDeps();
		const stages: string[] = [];
		await runInfluencerSearch(input(), deps, (stage) => void stages.push(stage));
		expect(stages).toEqual(expect.arrayContaining(["Searching the web", "Judging fit", "Finishing up"]));
	});

	it("keeps searching (deeper pages, new phrases) until the requested number of creators is kept", async () => {
		const igOnly = {
			...brief,
			platforms: ["instagram" as const],
			queries: { instagram: ["big and tall style"], tiktok: [] },
		};
		const codesFor = (query: string, page: number) =>
			[1, 2, 3].map((n) => ({
				url: `https://www.instagram.com/reel/${query.replace(/\W/g, "").slice(-6)}P${page}N${n}/`,
				title: "t",
				snippet: "s",
			}));
		const { deps } = makeDeps({
			serp: vi.fn(async (query: string, page: number) => codesFor(query, page)),
			expand: vi.fn(async () => ["broad shoulder tailoring", "tall dad style"]),
		});
		const out = await runInfluencerSearch(input({ brief: igOnly, targetResults: 9, capUsd: 0.5 }), deps);
		const kept = out.results.filter((r) => r.verdict !== "exclude");
		expect(kept.length).toBeGreaterThanOrEqual(9);
		expect(vi.mocked(deps.serp).mock.calls.some(([, page]) => page > 0)).toBe(true);
		expect(deps.expand).toHaveBeenCalled();
		expect(out.stats.requested).toBe(9);
		expect(out.cost.usd).toBeLessThanOrEqual(0.5);
	});

	it("says so when it runs out of money before reaching the requested number", async () => {
		const igOnly = {
			...brief,
			platforms: ["instagram" as const],
			queries: { instagram: ["big and tall style"], tiktok: [] },
		};
		const { deps } = makeDeps({
			serp: vi.fn(async (query: string, page: number) =>
				[1, 2, 3].map((n) => ({
					url: `https://www.instagram.com/reel/${query.replace(/\W/g, "").slice(-6)}P${page}N${n}/`,
					title: "t",
					snippet: "s",
				})),
			),
			expand: vi.fn(async () => ["another angle", "one more angle"]),
		});
		const out = await runInfluencerSearch(input({ brief: igOnly, targetResults: 50, capUsd: 0.1 }), deps);
		expect(out.cost.usd).toBeLessThanOrEqual(0.1);
		expect(out.results.filter((r) => r.verdict !== "exclude").length).toBeLessThan(50);
		expect(out.stats.stoppedAtBudget).toBe(true);
	});

	it("a repeat search reuses Google pages, post owners, profiles and engagement samples", async () => {
		const first = makeDeps();
		const a = await runInfluencerSearch(input(), first.deps);
		const second = makeDeps({ cache: first.deps.cache, memo: first.deps.memo });
		const b = await runInfluencerSearch(input(), second.deps);
		expect(second.deps.serp).not.toHaveBeenCalled();
		expect(second.scrapeCalls.filter((c) => c.dataset === DATASETS.instagramPost)).toEqual([]);
		expect(b.cost.usd).toBeLessThan(a.cost.usd * 0.5);
		expect(b.results.map((r) => r.handle).sort()).toEqual(a.results.map((r) => r.handle).sort());
	});

	it("re-buys only the profile, not the engagement posts, for a creator stored a few weeks ago", async () => {
		const first = makeDeps();
		await runInfluencerSearch(input(), first.deps);
		for (const entry of first.store.values()) {
			entry.fetchedAt = NOW - 20 * 86_400_000;
			entry.samplesAt = NOW - 20 * 86_400_000;
		}
		const second = makeDeps({ cache: first.deps.cache, memo: first.deps.memo });
		const out = await runInfluencerSearch(input(), second.deps);
		expect(second.scrapeCalls.some((c) => c.dataset === DATASETS.instagramProfile)).toBe(true);
		expect(second.scrapeCalls.filter((c) => c.dataset === DATASETS.instagramPost)).toEqual([]);
		expect(out.results.find((r) => r.handle === "goodguy")?.engagementAgeDays).toBe(20);
	});

	it("buys a creator again once the stored copy is over three months old", async () => {
		const first = makeDeps();
		await runInfluencerSearch(input(), first.deps);
		for (const entry of first.store.values()) {
			entry.fetchedAt = NOW - 100 * 86_400_000;
			entry.samplesAt = NOW - 100 * 86_400_000;
		}
		const second = makeDeps({ cache: first.deps.cache, memo: first.deps.memo });
		const out = await runInfluencerSearch(input(), second.deps);
		expect(second.scrapeCalls.some((c) => c.dataset === DATASETS.instagramProfile)).toBe(true);
		expect(second.scrapeCalls.some((c) => c.dataset === DATASETS.instagramPost)).toBe(true);
		expect(out.results.find((r) => r.handle === "goodguy")?.engagementAgeDays).toBe(0);
	});
});
