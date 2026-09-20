/**
 * Influencer Finder pipeline: brief -> search -> cheap screen -> paid lookups ->
 * judging -> engagement top-up -> (widen the search if there are too few keepers).
 *
 * Every paid step asks the CostLedger before buying, so a run stops at its cap and
 * returns what it has. All network and model access comes in through `deps`, which
 * keeps the orchestration testable without spending anything.
 */
import {
	buildCompetitorMatcher,
	type CompetitorInput,
	daysSince,
	engagementPct,
	inFollowerBands,
	postsPerWeek,
	summarizeCollabs,
	tagPost,
} from "./analyze";
import { CostLedger, PRICE } from "./cost";
import { DATASETS, type DatasetRecord } from "./datasets";
import type { JudgeDossier, Judgment, ScreenHit } from "./llm";
import {
	type IgPostRec,
	type IgProfileRec,
	readIgPost,
	readIgProfile,
	readTtProfile,
	type TtProfileRec,
} from "./records";
import type {
	CreatorPost,
	InfluencerBrief,
	InfluencerResult,
	InfluencerSearchPayload,
	InfluencerSearchStats,
	Platform,
	Verdict,
} from "./types";

/** A creator's stored profile and engagement are reused for this long, across every brand. */
const PROFILE_TTL_MS = 90 * 24 * 3_600_000;
/** Past this age a stored profile is bought again (one cheap record) so activity is current; the engagement sample is kept. */
const ACTIVITY_REFRESH_MS = 14 * 24 * 3_600_000;
/** Google results for an identical phrase and page. */
const SERP_TTL_MS = 7 * 24 * 3_600_000;
const BATCH = 20;
const JUDGE_BATCH = 5;
const EXTRA_POSTS_FOR_ENGAGEMENT = 3;
const GENERIC_TAGS = new Set([
	"#fashion",
	"#style",
	"#ootd",
	"#mensfashion",
	"#menswear",
	"#fyp",
	"#foryou",
	"#viral",
	"#explore",
	"#reels",
	"#instagood",
	"#love",
	"#follow",
]);

export interface CachedProfile {
	/** When the profile record was last bought. */
	fetchedAt: number;
	ig?: IgProfileRec;
	tt?: TtProfileRec;
	/** The posts engagement was measured on, and when they were fetched. Reused until they are this old. */
	samples?: IgPostRec[];
	samplesAt?: number;
}

/** Small lookups worth keeping for every brand: which creator a post belongs to, and a Google results page. */
export interface Memo {
	get(kind: "serp" | "ig_post", key: string): Promise<{ value: unknown; at: number } | null>;
	put(kind: "serp" | "ig_post", key: string, value: unknown): Promise<void>;
}

export interface PipelineDeps {
	serp(query: string, page: number): Promise<{ url: string; title: string; snippet: string }[]>;
	/** New search phrases that should surface more creators like the ones already found. */
	expand(args: {
		brief: InfluencerBrief;
		brandName: string;
		kept: { handle: string; bio: string }[];
		used: string[];
	}): Promise<string[]>;
	scrape(dataset: string, urls: string[]): Promise<DatasetRecord[]>;
	screen(args: {
		brief: InfluencerBrief;
		hits: ScreenHit[];
		keep: Record<Platform, number>;
	}): Promise<Record<Platform, number[]>>;
	judge(args: {
		brief: InfluencerBrief;
		brandName: string;
		competitors: string[];
		batch: JudgeDossier[];
	}): Promise<Judgment[]>;
	cache: {
		get(platform: Platform, handle: string): Promise<CachedProfile | null>;
		put(platform: Platform, handle: string, data: CachedProfile): Promise<void>;
	};
	memo: Memo;
	now?: () => number;
}

export interface PipelineInput {
	brief: InfluencerBrief;
	brandName: string;
	competitors: CompetitorInput[];
	/** Keep searching until this many creators are kept (a match or a maybe), or the money or the leads run out. */
	targetResults: number;
	capUsd: number;
}

type Progress = (stage: string, pct: number) => void | Promise<void>;

interface Working {
	platform: Platform;
	handle: string;
	ig?: IgProfileRec;
	tt?: TtProfileRec;
	fromCache: boolean;
	/** Post records fetched for engagement, keyed by url. */
	samples: Map<string, IgPostRec>;
	posts: CreatorPost[];
	judged?: Judgment;
	engagement: { pct: number | null; sample: number };
	preExcluded?: "competitor";
	/** When the profile record was bought, and when the engagement posts were fetched. */
	profileAt?: number;
	samplesAt?: number;
}

const key = (platform: Platform, handle: string) => `${platform}:${handle.toLowerCase()}`;
const postCode = (url: string): string | undefined => /\/(?:p|reel)\/([\w-]+)/.exec(url)?.[1];
const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** Google lookups in flight at once. */
const SEARCH_CONCURRENCY = 4;
/** Most passes over the web in one run, and the deepest Google page tried per phrase. */
const MAX_ROUNDS = 8;
const MAX_PAGE = 3;

export async function runInfluencerSearch(
	input: PipelineInput,
	deps: PipelineDeps,
	onProgress: Progress = () => {},
): Promise<InfluencerSearchPayload> {
	const { brief, brandName } = input;
	const ledger = new CostLedger(input.capUsd);
	const now = deps.now ?? Date.now;
	const matcher = buildCompetitorMatcher(input.competitors);
	const competitorNames = input.competitors.map((c) => c.name);
	const creators = new Map<string, Working>();
	const seenIgPosts = new Set<string>();
	const seenTtHandles = new Set<string>();
	const stats: InfluencerSearchStats = {
		searches: 0,
		postsFound: 0,
		creatorsFound: 0,
		creatorsAnalyzed: 0,
		fromCache: 0,
		included: 0,
		maybe: 0,
		excluded: 0,
		stoppedAtBudget: false,
		requested: input.targetResults,
	};
	// Progress follows how close the run is to its target, and never goes backwards across rounds.
	let lastPct = 5;
	const stageDone = async (label: string, pct: number) => {
		const shown =
			pct >= 85 ? pct : Math.min(84, 10 + Math.round(70 * Math.min(1, keptCount() / Math.max(1, input.targetResults))));
		lastPct = Math.max(lastPct, shown);
		return onProgress(label, lastPct);
	};
	/** Phrases whose Google page gave something new, and how deep each has been searched. */
	const pageDepth = new Map<string, number>();
	const productive = new Set<string>();
	const allPhrases = new Map<string, Platform>();

	interface SearchJob {
		platform: Platform;
		phrase: string;
		page: number;
	}
	const jobKey = (j: SearchJob) => `${j.platform}|${j.phrase}`;

	async function searchAll(jobs: SearchJob[], reserve: number) {
		const igHits: { code: string; url: string; text: string }[] = [];
		const ttHits: { handle: string; text: string }[] = [];
		// Google lookups are slow (tens of seconds each), so they run a few at a time. Each is paid for
		// before it starts, so the spending limit holds however many are in flight.
		const outcomes: Awaited<ReturnType<PipelineDeps["serp"]>>[] = jobs.map(() => []);
		let next = 0;
		let outOfBudget = false;
		async function worker() {
			while (!outOfBudget && next < jobs.length) {
				const i = next++;
				const job = jobs[i] as SearchJob;
				const site = job.platform === "instagram" ? "instagram.com" : "tiktok.com";
				const query = `site:${site} ${job.phrase}`;
				const memoKey = `${query}|${job.page}`;
				const hit = await deps.memo.get("serp", memoKey).catch(() => null);
				if (hit && Array.isArray(hit.value) && now() - hit.at < SERP_TTL_MS) {
					outcomes[i] = hit.value as Awaited<ReturnType<PipelineDeps["serp"]>>;
					continue;
				}
				if (!ledger.canSearch(reserve)) {
					outOfBudget = true;
					return;
				}
				ledger.chargeSearch();
				stats.searches += 1;
				outcomes[i] = await deps.serp(query, job.page).catch(() => []);
				if (outcomes[i]?.length) await deps.memo.put("serp", memoKey, outcomes[i]).catch(() => {});
			}
		}
		await Promise.all(Array.from({ length: Math.min(SEARCH_CONCURRENCY, jobs.length) }, worker));
		for (const [i, job] of jobs.entries()) {
			pageDepth.set(jobKey(job), job.page);
			for (const r of outcomes[i] ?? []) {
				if (job.platform === "instagram") {
					const m = /instagram\.com\/(p|reel)\/([\w-]+)/.exec(r.url);
					if (m?.[2] && !seenIgPosts.has(m[2])) {
						seenIgPosts.add(m[2]);
						productive.add(jobKey(job));
						igHits.push({
							code: m[2],
							url: `https://www.instagram.com/${m[1]}/${m[2]}/`,
							text: `${clip(r.title, 110)} | ${clip(r.snippet, 200)}`,
						});
					}
				} else {
					const m = /tiktok\.com\/@([\w.]+)\/video\//.exec(r.url);
					const h = m?.[1]?.toLowerCase();
					if (h && !seenTtHandles.has(h)) {
						seenTtHandles.add(h);
						productive.add(jobKey(job));
						ttHits.push({
							handle: m?.[1] ?? h,
							text: `@${m?.[1]} | ${clip(r.title, 110)} | ${clip(r.snippet, 200)}`,
						});
					}
				}
			}
		}
		stats.postsFound += igHits.length + ttHits.length;
		return { igHits, ttHits };
	}

	/** One pass: search, screen, look up and judge. Returns how many new creators were analysed. */
	async function round(jobs: SearchJob[], roundBudget: number, label: string): Promise<number> {
		const spendFloor = ledger.spent();
		const spendLimit = () => ledger.spent() - spendFloor >= roundBudget;

		await stageDone(label, 10);
		const found = await searchAll(jobs, ledger.remaining() - roundBudget * 0.65);
		const { igHits, ttHits } = found;
		if (igHits.length + ttHits.length === 0) return 0;

		// How many creators this pass can afford to look up, at rough all-in costs (the engagement top-up is reserved separately).
		const perIg = 0.0064;
		const perTt = 0.0028;
		const budgetForCreators = Math.max(0, roundBudget - ledger.spent() + spendFloor - 0.005);
		const igKeepMax = Math.min(igHits.length, 30, Math.floor((budgetForCreators * 0.75) / perIg));
		const ttKeepMax = brief.platforms.includes("tiktok")
			? Math.min(ttHits.length, 14, Math.floor((budgetForCreators * 0.25) / perTt))
			: 0;
		if (igKeepMax + ttKeepMax === 0) return 0;

		await stageDone("Picking who to look at", 30);
		const hits: ScreenHit[] = [
			...igHits.map((h, i) => ({ platform: "instagram" as const, index: i, text: h.text })),
			...ttHits.map((h, i) => ({ platform: "tiktok" as const, index: i, text: h.text })),
		];
		let keep: Record<Platform, number[]>;
		if (ledger.canAffordLlm()) {
			keep = await deps.screen({ brief, hits, keep: { instagram: igKeepMax, tiktok: ttKeepMax } }).catch(() => ({
				instagram: igHits.map((_, i) => i).slice(0, igKeepMax),
				tiktok: ttHits.map((_, i) => i).slice(0, ttKeepMax),
			}));
			ledger.chargeLlm(hits.length * 90, 200);
		} else {
			keep = {
				instagram: igHits.map((_, i) => i).slice(0, igKeepMax),
				tiktok: ttHits.map((_, i) => i).slice(0, ttKeepMax),
			};
		}

		// Resolve Instagram posts to the creators behind them (one record per post).
		await stageDone("Looking up creators", 42);
		const postUrls = keep.instagram.map((i) => igHits[i]?.url).filter((u): u is string => !!u);
		const fresh: Working[] = [];
		const workingFor = (handle: string): Working => {
			const k = key("instagram", handle);
			let w = creators.get(k);
			if (!w) {
				w = {
					platform: "instagram",
					handle,
					fromCache: false,
					samples: new Map(),
					posts: [],
					engagement: { pct: null, sample: 0 },
				};
				creators.set(k, w);
				fresh.push(w);
			}
			return w;
		};
		// A post whose owner is already known needs no paid lookup.
		const unknownPosts: string[] = [];
		for (const url of postUrls) {
			const code = postCode(url);
			const owner = code ? await deps.memo.get("ig_post", code).catch(() => null) : null;
			const handle = (owner?.value as { handle?: string } | undefined)?.handle;
			if (handle) workingFor(handle);
			else unknownPosts.push(url);
		}
		for (let i = 0; i < unknownPosts.length; i += BATCH) {
			const n = Math.min(BATCH, ledger.affordableRecords(0.02), unknownPosts.length - i);
			if (n <= 0 || spendLimit()) break;
			const chunk = unknownPosts.slice(i, i + n);
			const recs = (await deps.scrape(DATASETS.instagramPost, chunk).catch(() => []))
				.map(readIgPost)
				.filter((r): r is IgPostRec => !!r);
			ledger.chargeRecords(chunk.length);
			for (const rec of recs) {
				const w = workingFor(rec.handle);
				w.samples.set(rec.url, rec);
				w.samplesAt ??= now();
				const code = postCode(rec.url);
				if (code) await deps.memo.put("ig_post", code, { handle: rec.handle }).catch(() => {});
			}
		}
		for (const i of keep.tiktok) {
			const h = ttHits[i];
			if (!h) continue;
			const k = key("tiktok", h.handle);
			if (creators.has(k)) continue;
			const w: Working = {
				platform: "tiktok",
				handle: h.handle,
				fromCache: false,
				samples: new Map(),
				posts: [],
				engagement: { pct: null, sample: 0 },
			};
			creators.set(k, w);
			fresh.push(w);
		}
		stats.creatorsFound += fresh.length;

		// Profiles: reuse anyone already paid for, whichever brand it was for. Instagram profiles a couple of
		// weeks old are bought again (one record) so posting activity is current; the engagement sample is kept.
		await stageDone("Reading bios and posts", 55);
		const need: { igUrls: string[]; ttUrls: string[] } = { igUrls: [], ttUrls: [] };
		for (const w of fresh) {
			const cached = await deps.cache.get(w.platform, w.handle).catch(() => null);
			const age = cached ? now() - cached.fetchedAt : Number.POSITIVE_INFINITY;
			if (cached && age < PROFILE_TTL_MS && (w.platform === "instagram" ? cached.ig : cached.tt)) {
				w.ig = cached.ig;
				w.tt = cached.tt;
				w.profileAt = cached.fetchedAt;
				w.fromCache = true;
				stats.fromCache += 1;
				if (cached.samples && cached.samplesAt && now() - cached.samplesAt < PROFILE_TTL_MS) {
					for (const smp of cached.samples) if (!w.samples.has(smp.url)) w.samples.set(smp.url, smp);
					w.samplesAt ??= cached.samplesAt;
				}
				if (w.platform !== "instagram" || age <= ACTIVITY_REFRESH_MS) continue;
			}
			const url =
				w.platform === "instagram" ? `https://www.instagram.com/${w.handle}/` : `https://www.tiktok.com/@${w.handle}`;
			(w.platform === "instagram" ? need.igUrls : need.ttUrls).push(url);
		}
		const save = (w: Working) =>
			deps.cache
				.put(w.platform, w.handle, {
					fetchedAt: w.profileAt ?? now(),
					ig: w.ig,
					tt: w.tt,
					samples: [...w.samples.values()],
					samplesAt: w.samplesAt,
				})
				.catch(() => {});
		async function buy(
			dataset: string,
			urls: string[],
			read: (r: DatasetRecord) => IgProfileRec | TtProfileRec | null,
		) {
			for (let i = 0; i < urls.length; i += BATCH) {
				const n = Math.min(BATCH, ledger.affordableRecords(0.015), urls.length - i);
				if (n <= 0 || spendLimit()) return;
				const chunk = urls.slice(i, i + n);
				const recs = await deps.scrape(dataset, chunk).catch(() => []);
				ledger.chargeRecords(chunk.length);
				for (const raw of recs) {
					const rec = read(raw);
					if (!rec) continue;
					const w = creators.get(key(dataset === DATASETS.tiktokProfile ? "tiktok" : "instagram", rec.handle));
					if (!w) continue;
					if (dataset === DATASETS.tiktokProfile) w.tt = rec as TtProfileRec;
					else w.ig = rec as IgProfileRec;
					w.profileAt = now();
					await save(w);
				}
			}
		}
		await buy(DATASETS.instagramProfile, need.igUrls, readIgProfile);
		await buy(DATASETS.tiktokProfile, need.ttUrls, readTtProfile);

		// Facts that don't need a model, then the model reads what's left.
		const analysed = fresh.filter((w) => (w.platform === "instagram" ? w.ig : w.tt));
		for (const w of analysed) prepare(w);
		stats.creatorsAnalyzed += analysed.length;

		await stageDone("Judging fit", 70);
		const toJudge = analysed.filter((w) => !w.preExcluded && passesSize(w));
		for (let i = 0; i < toJudge.length; i += JUDGE_BATCH) {
			if (!ledger.canAffordLlm()) break;
			const batch = toJudge.slice(i, i + JUDGE_BATCH);
			const out = await deps
				.judge({ brief, brandName, competitors: competitorNames, batch: batch.map(dossierOf) })
				.catch(() => [] as Judgment[]);
			ledger.chargeLlm(JSON.stringify(batch.map(dossierOf)).length + 1400, out.length * 700);
			const byHandle = new Map(out.map((j) => [j.handle.toLowerCase(), j]));
			for (const w of batch) w.judged = byHandle.get(w.handle.toLowerCase());
		}
		return analysed.length;
	}

	function passesSize(w: Working): boolean {
		return inFollowerBands(w.ig?.followers ?? w.tt?.followers ?? null, brief.followerBands);
	}

	/** Tag the recent posts, compute cadence/engagement, and set aside accounts that are a competitor outright. */
	function prepare(w: Working) {
		if (w.platform === "instagram" && w.ig) {
			const self = { handle: w.handle, name: w.ig.name };
			const byUrl = new Map<string, CreatorPost>();
			for (const p of w.ig.posts.slice(0, 12)) {
				const rec = p.url ? w.samples.get(p.url) : undefined;
				byUrl.set(
					p.url ?? `${p.date}-${p.caption.slice(0, 20)}`,
					tagPost(
						{
							date: p.date,
							kind: p.kind,
							caption: p.caption,
							url: p.url,
							hashtags: p.hashtags,
							coauthors: rec?.coauthors,
							tagged: rec?.tagged,
							partnershipLabel: rec?.partnershipLabel,
						},
						self,
					),
				);
			}
			// The posts the search found are the best evidence of all, so include them even if they're older than the last 12.
			for (const rec of w.samples.values()) {
				if (byUrl.has(rec.url)) continue;
				byUrl.set(
					rec.url,
					tagPost(
						{
							date: rec.date,
							kind: rec.kind,
							caption: rec.caption,
							url: rec.url,
							hashtags: rec.hashtags,
							coauthors: rec.coauthors,
							tagged: rec.tagged,
							partnershipLabel: rec.partnershipLabel,
						},
						self,
					),
				);
			}
			w.posts = [...byUrl.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
			w.engagement = engagementPct([...w.samples.values()], w.ig.followers);
			if (matcher.identity([w.handle, w.ig.name, ...w.ig.links]).length > 0) w.preExcluded = "competitor";
		} else if (w.tt) {
			w.engagement = { pct: w.tt.engagementPct, sample: w.tt.topVideos.length };
			w.posts = w.tt.topVideos.slice(0, 6).map((v) => ({
				date: v.date,
				kind: "video",
				caption: clip(v.description, 220),
				url: null,
				tag: "organic" as const,
				brand: null,
			}));
			if (matcher.identity([w.handle, w.tt.name]).length > 0) w.preExcluded = "competitor";
		}
	}

	function dossierOf(w: Working): JudgeDossier {
		const ig = w.ig;
		const tt = w.tt;
		const lines = w.posts.slice(0, 10).map((p) => {
			const tag = p.tag === "organic" ? "" : ` [${p.tag}${p.brand ? `: ${p.brand}` : ""}]`;
			return `${(p.date ?? "").slice(0, 10)} ${p.kind ?? ""}: ${clip(p.caption, 130)}${tag}`;
		});
		const text = [w.handle, ig?.name, tt?.name, ig?.bio, tt?.bio, ...lines].join(" ");
		return {
			platform: w.platform,
			handle: w.handle,
			name: ig?.name ?? tt?.name ?? null,
			followers: ig?.followers ?? tt?.followers ?? null,
			bio: clip(ig?.bio ?? tt?.bio ?? "", 300),
			links: ig?.links ?? [],
			category: tt?.category ?? null,
			lastPostDaysAgo: ig ? daysSince(w.posts[0]?.date, now()) : null,
			postsPerWeek: ig ? postsPerWeek(w.posts.map((p) => p.date).filter((d): d is string => !!d)) : null,
			engagementPct: w.engagement.pct,
			posts: lines,
			competitorIdentity: matcher.identity([w.handle, ig?.name ?? tt?.name, ...(ig?.links ?? [])]),
			competitorMentions: matcher.mentions(text),
		};
	}

	/** Whether a creator would end up on the list (a match or a maybe), competitor checks included. */
	function keptOf(w: Working): boolean {
		return !!(w.ig || w.tt) && !w.preExcluded && !!w.judged && toResult(w).verdict !== "exclude";
	}
	function keptCount(): number {
		let n = 0;
		for (const w of creators.values()) if (keptOf(w)) n += 1;
		return n;
	}

	// ── run ─────────────────────────────────────────────────────────

	// Search in passes until enough creators are kept: first the brief's own phrases, then the same
	// phrases one Google page deeper, new phrases dreamed up from who has been found, and the
	// hashtags the best creators use. A pass that turns up nobody new twice in a row ends the run.
	for (const platform of brief.platforms)
		for (const q of brief.queries[platform]) allPhrases.set(`${platform}|${q}`, platform);
	const topUpReserve = Math.min(input.targetResults * EXTRA_POSTS_FOR_ENGAGEMENT * PRICE.record, input.capUsd * 0.4);
	let dry = 0;
	for (let n = 0; n < MAX_ROUNDS && keptCount() < input.targetResults && dry < 2; n++) {
		if (ledger.remaining() - topUpReserve < 0.03) break;
		const jobs = n === 0 ? firstJobs() : await widenJobs();
		if (jobs.length === 0) break;
		const roundBudget = Math.min(ledger.remaining() - topUpReserve, Math.max(0.06, input.capUsd * 0.3));
		const analysed = await round(jobs, roundBudget, n === 0 ? "Searching the web" : "Widening the search");
		dry = analysed === 0 ? dry + 1 : 0;
	}

	function firstJobs(): SearchJob[] {
		return brief.platforms.flatMap((platform) =>
			brief.queries[platform].map((phrase) => ({ platform, phrase, page: 0 })),
		);
	}

	async function widenJobs(): Promise<SearchJob[]> {
		const jobs: SearchJob[] = [];
		// 1. One page deeper for phrases that were still turning up new posts.
		for (const [k, platform] of allPhrases) {
			const depth = pageDepth.get(k);
			if (depth !== undefined && depth < MAX_PAGE && productive.has(k) && jobs.length < 6) {
				jobs.push({ platform, phrase: k.slice(platform.length + 1), page: depth + 1 });
			}
		}
		// 2. New phrases, aimed at creators like the ones already kept.
		const kept = [...creators.values()].filter((w) => keptOf(w));
		if (ledger.canAffordLlm()) {
			const phrases = await deps
				.expand({
					brief,
					brandName,
					kept: kept.slice(0, 8).map((w) => ({ handle: w.handle, bio: clip(w.ig?.bio ?? w.tt?.bio ?? "", 140) })),
					used: [...allPhrases.keys()].map((k) => k.slice(k.indexOf("|") + 1)),
				})
				.catch(() => [] as string[]);
			ledger.chargeLlm(1800, 400);
			for (const phrase of phrases.slice(0, 5)) {
				for (const platform of brief.platforms) {
					const k = `${platform}|${phrase}`;
					if (allPhrases.has(k)) continue;
					allPhrases.set(k, platform);
					jobs.push({ platform, phrase, page: 0 });
				}
			}
		}
		// 3. Hashtags the kept creators use most.
		const tags = new Map<string, number>();
		for (const w of kept) {
			for (const p of w.posts.slice(0, 12))
				for (const t of p.caption.match(/#[A-Za-z0-9_]{4,}/g) ?? [])
					tags.set(t.toLowerCase(), (tags.get(t.toLowerCase()) ?? 0) + 1);
		}
		for (const [tag] of [...tags.entries()]
			.filter(([t]) => !GENERIC_TAGS.has(t))
			.sort((a, b) => b[1] - a[1])
			.slice(0, 8)) {
			const k = `instagram|${tag}`;
			if (!brief.platforms.includes("instagram") || allPhrases.has(k)) continue;
			allPhrases.set(k, "instagram");
			jobs.push({ platform: "instagram", phrase: tag, page: 0 });
			if (jobs.length >= 14) break;
		}
		return jobs;
	}

	// Engagement top-up: a few more posts for the creators worth keeping, so the average means something.
	await stageDone("Checking engagement", 85);
	const worthy = [...creators.values()]
		.filter((w) => w.platform === "instagram" && w.ig && keptOf(w))
		.sort((a, b) => (b.judged?.fitScore ?? 0) - (a.judged?.fitScore ?? 0))
		.slice(0, input.targetResults);
	const topUp: { w: Working; url: string }[] = [];
	for (const w of worthy) {
		const urls = (w.ig?.posts ?? []).map((p) => p.url).filter((u): u is string => !!u && !w.samples.has(u));
		for (const url of urls.slice(0, Math.max(0, EXTRA_POSTS_FOR_ENGAGEMENT - Math.max(0, w.samples.size - 1))))
			topUp.push({ w, url });
	}
	for (let i = 0; i < topUp.length; i += BATCH) {
		const n = Math.min(BATCH, ledger.affordableRecords(0), topUp.length - i);
		if (n <= 0) break;
		const chunk = topUp.slice(i, i + n);
		const recs = (
			await deps
				.scrape(
					DATASETS.instagramPost,
					chunk.map((c) => c.url),
				)
				.catch(() => [])
		)
			.map(readIgPost)
			.filter((r): r is IgPostRec => !!r);
		ledger.chargeRecords(chunk.length);
		for (const rec of recs) {
			const w = creators.get(key("instagram", rec.handle));
			if (!w) continue;
			w.samples.set(rec.url, rec);
			w.samplesAt ??= now();
		}
	}
	for (const w of worthy) {
		prepare(w);
		await deps.cache
			.put(w.platform, w.handle, {
				fetchedAt: w.profileAt ?? now(),
				ig: w.ig,
				tt: w.tt,
				samples: [...w.samples.values()],
				samplesAt: w.samplesAt,
			})
			.catch(() => {});
	}

	await stageDone("Finishing up", 95);
	const results = [...creators.values()].filter((w) => w.ig || w.tt).map((w) => toResult(w));
	stats.stoppedAtBudget = keptCount() < input.targetResults && ledger.remaining() - topUpReserve < 0.03;
	for (const r of results) {
		if (r.verdict === "include") stats.included += 1;
		else if (r.verdict === "maybe") stats.maybe += 1;
		else stats.excluded += 1;
	}
	const rank: Record<Verdict, number> = { include: 0, maybe: 1, exclude: 2 };
	results.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.fitScore - a.fitScore);
	return { results, stats, brief, cost: ledger.snapshot() };

	function toResult(w: Working): InfluencerResult {
		const ig = w.ig;
		const tt = w.tt;
		const j = w.judged;
		const collab = summarizeCollabs(w.posts);
		const followers = ig?.followers ?? tt?.followers ?? null;
		const identityHits = matcher.identity([w.handle, ig?.name ?? tt?.name, ...(ig?.links ?? [])]);
		const sponsoredForCompetitor = w.posts.filter(
			(p) =>
				p.tag !== "organic" && p.tag !== "own_brand" && matcher.mentions(`${p.brand ?? ""} ${p.caption}`).length > 0,
		);
		const promoteNames = [
			...new Set(sponsoredForCompetitor.flatMap((p) => matcher.mentions(`${p.brand ?? ""} ${p.caption}`))),
		];
		const isCompetitor = identityHits.length > 0 || j?.competitor.isCompetitor === true;
		const promotes = promoteNames.length > 0 || j?.competitor.promotesCompetitor === true;
		const names = [...new Set([...identityHits, ...promoteNames, ...(j?.competitor.names ?? [])])];

		let verdict: Verdict = j?.verdict ?? "exclude";
		let excludedBecause: InfluencerResult["excludedBecause"] = null;
		if (isCompetitor) {
			verdict = "exclude";
			excludedBecause = "competitor";
		} else if (promotes) {
			verdict = "exclude";
			excludedBecause = "competitor_partner";
		} else if (j?.kind === "brand_or_business") {
			verdict = "exclude";
			excludedBecause = "not_a_creator";
		} else if (!j) {
			excludedBecause = "low_fit";
		} else if (verdict === "exclude") {
			excludedBecause = "low_fit";
		}
		const handleText = ig?.handle ?? tt?.handle ?? w.handle;
		return {
			key: key(w.platform, w.handle),
			platform: w.platform,
			handle: handleText,
			name: ig?.name ?? tt?.name ?? null,
			profileUrl:
				w.platform === "instagram"
					? `https://www.instagram.com/${handleText}/`
					: `https://www.tiktok.com/@${handleText}`,
			followers,
			postsCount: ig?.postsCount ?? tt?.videosCount ?? null,
			bio: clip(ig?.bio ?? tt?.bio ?? "", 300),
			links: ig?.links ?? [],
			fitScore: isCompetitor || promotes ? Math.min(j?.fitScore ?? 0, 40) : (j?.fitScore ?? 0),
			verdict,
			confidence: j?.confidence ?? 0,
			kind: j?.kind ?? "unclear",
			fitReason:
				j?.fitReason ??
				(isCompetitor
					? "This account is a competitor."
					: "Not judged (spending limit reached or it fell outside the follower range)."),
			fitEvidence: j?.fitEvidence ?? [],
			engagementPct: w.engagement.pct,
			engagementSample: w.engagement.sample,
			engagementAgeDays: w.samplesAt ? Math.max(0, Math.round((now() - w.samplesAt) / 86_400_000)) : null,
			postsPerWeek: ig ? postsPerWeek(w.posts.map((p) => p.date).filter((d): d is string => !!d)) : null,
			lastPostDaysAgo: ig ? daysSince(w.posts[0]?.date, now()) : null,
			collab,
			competitor: {
				isCompetitor,
				promotesCompetitor: promotes,
				names,
				evidence:
					j?.competitor.evidence ||
					(names.length
						? `Matched ${names.join(", ")} in ${isCompetitor ? "the account's identity" : "sponsored posts"}.`
						: ""),
			},
			concern: j?.concern ?? "",
			recentPosts: w.posts.slice(0, 8),
			excludedBecause: verdict === "exclude" ? excludedBecause : null,
		};
	}
}
