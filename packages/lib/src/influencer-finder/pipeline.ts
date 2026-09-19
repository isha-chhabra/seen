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
import { CostLedger } from "./cost";
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

const PROFILE_TTL_MS = 30 * 24 * 3_600_000;
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
	fetchedAt: number;
	ig?: IgProfileRec;
	tt?: TtProfileRec;
}

export interface PipelineDeps {
	serp(query: string): Promise<{ url: string; title: string; snippet: string }[]>;
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
	now?: () => number;
}

export interface PipelineInput {
	brief: InfluencerBrief;
	brandName: string;
	competitors: CompetitorInput[];
	/** Stop widening once this many creators are "include". */
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
}

const key = (platform: Platform, handle: string) => `${platform}:${handle.toLowerCase()}`;
const clip = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

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
	const usedQueries = new Set<string>();
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
	};
	const stageDone = async (label: string, pct: number) => onProgress(label, pct);
	const stop = () => {
		stats.stoppedAtBudget = true;
	};

	async function searchAll(byPlatform: Partial<Record<Platform, string[]>>, reserve: number) {
		const igHits: { code: string; url: string; text: string }[] = [];
		const ttHits: { handle: string; text: string }[] = [];
		for (const platform of brief.platforms) {
			for (const q of byPlatform[platform] ?? []) {
				const query = `site:${platform === "instagram" ? "instagram.com" : "tiktok.com"} ${q}`;
				if (usedQueries.has(query)) continue;
				usedQueries.add(query);
				let results: Awaited<ReturnType<PipelineDeps["serp"]>> = [];
				for (let attempt = 0; attempt < 2 && results.length === 0; attempt++) {
					if (!ledger.canSearch(reserve)) {
						stop();
						return null;
					}
					ledger.chargeSearch();
					stats.searches += 1;
					results = await deps.serp(query).catch(() => []);
				}
				for (const r of results) {
					if (platform === "instagram") {
						const m = /instagram\.com\/(p|reel)\/([\w-]+)/.exec(r.url);
						if (m?.[2] && !seenIgPosts.has(m[2])) {
							seenIgPosts.add(m[2]);
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
							ttHits.push({
								handle: m?.[1] ?? h,
								text: `@${m?.[1]} | ${clip(r.title, 110)} | ${clip(r.snippet, 200)}`,
							});
						}
					}
				}
			}
		}
		stats.postsFound += igHits.length + ttHits.length;
		return { igHits, ttHits };
	}

	/** One full pass over a set of queries. Returns how many new creators were analysed. */
	async function round(queries: Partial<Record<Platform, string[]>>, share: number): Promise<number> {
		// Money this pass may spend, after keeping some back for a possible next pass.
		const roundBudget = Math.max(0, ledger.remaining() * share);
		const spendFloor = ledger.spent();
		const spendLimit = () => ledger.spent() - spendFloor >= roundBudget;

		await stageDone("Searching the web", 10);
		const found = await searchAll(queries, ledger.remaining() - roundBudget * 0.5);
		if (!found) return 0;
		const { igHits, ttHits } = found;
		if (igHits.length + ttHits.length === 0) return 0;

		// How many creators this pass can afford to look up, at rough all-in costs.
		const perIg = 0.0064;
		const perTt = 0.0028;
		const budgetForCreators = Math.max(0, roundBudget - ledger.spent() + spendFloor - 0.01);
		const igKeepMax = Math.min(igHits.length, 30, Math.floor((budgetForCreators * 0.65) / perIg));
		const ttKeepMax = brief.platforms.includes("tiktok")
			? Math.min(ttHits.length, 14, Math.floor((budgetForCreators * 0.25) / perTt))
			: 0;
		if (igKeepMax + ttKeepMax === 0) {
			stop();
			return 0;
		}

		await stageDone("Picking who to look at", 30);
		const hits: ScreenHit[] = [
			...igHits.map((h, i) => ({ platform: "instagram" as const, index: i, text: h.text })),
			...ttHits.map((h, i) => ({ platform: "tiktok" as const, index: i, text: h.text })),
		];
		let keep: Record<Platform, number[]>;
		if (ledger.canAffordLlm()) {
			keep = await deps
				.screen({ brief, hits, keep: { instagram: igKeepMax, tiktok: ttKeepMax } })
				.catch(() => ({
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
		for (let i = 0; i < postUrls.length; i += BATCH) {
			const n = Math.min(BATCH, ledger.affordableRecords(0.02), postUrls.length - i);
			if (n <= 0 || spendLimit()) {
				stop();
				break;
			}
			const chunk = postUrls.slice(i, i + n);
			const recs = (await deps.scrape(DATASETS.instagramPost, chunk).catch(() => []))
				.map(readIgPost)
				.filter((r): r is IgPostRec => !!r);
			ledger.chargeRecords(chunk.length);
			for (const rec of recs) {
				const k = key("instagram", rec.handle);
				let w = creators.get(k);
				if (!w) {
					w = {
						platform: "instagram",
						handle: rec.handle,
						fromCache: false,
						samples: new Map(),
						posts: [],
						engagement: { pct: null, sample: 0 },
					};
					creators.set(k, w);
					fresh.push(w);
				}
				w.samples.set(rec.url, rec);
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

		// Profiles: reuse anyone we already paid for within the freshness window.
		await stageDone("Reading bios and posts", 55);
		const need: { igUrls: string[]; ttUrls: string[]; byUrl: Map<string, Working> } = {
			igUrls: [],
			ttUrls: [],
			byUrl: new Map(),
		};
		for (const w of fresh) {
			const cached = await deps.cache.get(w.platform, w.handle).catch(() => null);
			if (cached && now() - cached.fetchedAt < PROFILE_TTL_MS && (w.platform === "instagram" ? cached.ig : cached.tt)) {
				w.ig = cached.ig;
				w.tt = cached.tt;
				w.fromCache = true;
				stats.fromCache += 1;
				continue;
			}
			const url =
				w.platform === "instagram" ? `https://www.instagram.com/${w.handle}/` : `https://www.tiktok.com/@${w.handle}`;
			(w.platform === "instagram" ? need.igUrls : need.ttUrls).push(url);
			need.byUrl.set(url, w);
		}
		async function buy(
			dataset: string,
			urls: string[],
			read: (r: DatasetRecord) => IgProfileRec | TtProfileRec | null,
		) {
			for (let i = 0; i < urls.length; i += BATCH) {
				const n = Math.min(BATCH, ledger.affordableRecords(0.015), urls.length - i);
				if (n <= 0 || spendLimit()) {
					stop();
					return;
				}
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
					await deps.cache.put(w.platform, w.handle, { fetchedAt: now(), ig: w.ig, tt: w.tt }).catch(() => {});
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
			if (!ledger.canAffordLlm()) {
				stop();
				break;
			}
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
			w.posts = w.tt.topVideos
				.slice(0, 6)
				.map((v) => ({
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

	// ── run ─────────────────────────────────────────────────────────

	await round(brief.queries, 0.7);

	// Widen the search from the best creators' own hashtags if there aren't enough keepers yet.
	const keepers = () => [...creators.values()].filter((w) => w.judged?.verdict === "include" && !w.preExcluded).length;
	if (keepers() < input.targetResults && ledger.remaining() > 0.05 && !stats.stoppedAtBudget) {
		const tags = new Map<string, number>();
		for (const w of creators.values()) {
			if (w.judged?.verdict !== "include") continue;
			for (const p of w.posts.slice(0, 12))
				for (const t of p.caption.match(/#[A-Za-z0-9_]{4,}/g) ?? [])
					tags.set(t.toLowerCase(), (tags.get(t.toLowerCase()) ?? 0) + 1);
		}
		const widened = [...tags.entries()]
			.filter(([t]) => !GENERIC_TAGS.has(t))
			.sort((a, b) => b[1] - a[1])
			.slice(0, 4)
			.map(([t]) => t);
		if (widened.length > 0) await round({ instagram: widened }, 0.9);
	}

	// Engagement top-up: a few more posts for the creators worth keeping, so the average means something.
	await stageDone("Checking engagement", 85);
	const worthy = [...creators.values()].filter(
		(w) => w.platform === "instagram" && w.ig && !w.preExcluded && w.judged && w.judged.verdict !== "exclude",
	);
	const topUp: { w: Working; url: string }[] = [];
	for (const w of worthy) {
		const urls = (w.ig?.posts ?? []).map((p) => p.url).filter((u): u is string => !!u && !w.samples.has(u));
		for (const url of urls.slice(0, Math.max(0, EXTRA_POSTS_FOR_ENGAGEMENT - Math.max(0, w.samples.size - 1))))
			topUp.push({ w, url });
	}
	for (let i = 0; i < topUp.length; i += BATCH) {
		const n = Math.min(BATCH, ledger.affordableRecords(0), topUp.length - i);
		if (n <= 0) {
			stop();
			break;
		}
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
		for (const rec of recs) creators.get(key("instagram", rec.handle))?.samples.set(rec.url, rec);
	}
	for (const w of worthy) prepare(w);

	await stageDone("Finishing up", 95);
	const results = [...creators.values()].filter((w) => w.ig || w.tt).map((w) => toResult(w));
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
