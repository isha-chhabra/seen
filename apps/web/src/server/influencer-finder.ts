/**
 * Influencer Finder server functions, mirroring Article Finder:
 *
 *   1. generateInfluencerBriefFn, direction -> an editable brief (queries, competitors, fit signals)
 *   2. findInfluencersFn        , starts the search in the background and returns at once; the
 *                                 page follows a "running" marker row exactly as Article Finder does
 *   3. getInfluencerSearchStatusFn / getLatestInfluencerSearchFn, progress and the finished result
 *
 * The heavy lifting (paid lookups, judging, spending cap) lives in
 * @workspace/lib/influencer-finder.
 */
import { createServerFn } from "@tanstack/react-start";
import { googleSerp } from "@workspace/lib/article-finder/search";
import { db } from "@workspace/lib/db/db";
import { brandInfluencerSearches, brands, competitors, influencerProfiles } from "@workspace/lib/db/schema";
import { scrapeDataset } from "@workspace/lib/influencer-finder/datasets";
import { draftBrief, judgeCreators, screenHits } from "@workspace/lib/influencer-finder/llm";
import { type CachedProfile, runInfluencerSearch } from "@workspace/lib/influencer-finder/pipeline";
import type { InfluencerBrief, InfluencerSearchPayload, Platform } from "@workspace/lib/influencer-finder/types";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireBrandAccess, requireBrandWriteAccess } from "@/lib/auth/helpers";

const DEBOUNCE_MS = 45_000;
const MAX_SPEND_USD = 0.5;
/** A running search that has reported nothing for this long is treated as dead. */
const STALE_RUN_MS = 15 * 60_000;
const lastRunByBrand = new Map<string, number>();

const platformSchema = z.enum(["instagram", "tiktok"]);
const bandSchema = z.enum(["nano", "micro", "mid", "macro", "mega"]);

/** Search phrases are typed by people, so strip anything that would change what kind of search runs. */
const cleanQuery = (q: string) =>
	q
		.replace(/"/g, "")
		.replace(/\b(?:site|inurl|intitle|filetype):\S*/gi, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);

const briefSchema = z.object({
	direction: z.string().trim().min(3).max(500),
	platforms: z.array(platformSchema).min(1).max(2),
	queries: z.object({
		instagram: z.array(z.string()).max(12),
		tiktok: z.array(z.string()).max(12),
	}),
	competitors: z.array(z.string().trim().min(1).max(80)).max(40),
	fitSignals: z.array(z.string().trim().min(1).max(120)).max(20),
	followerBands: z.array(bandSchema).max(5),
	similarTo: z.array(z.string().trim().min(1).max(60)).max(5).optional(),
	avoid: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
	basedIn: z.array(z.string().trim().min(1).max(60)).max(3).optional(),
});

/** "https://instagram.com/some.creator/" or "@Some.Creator" -> "some.creator". */
const cleanHandle = (h: string) =>
	h
		.trim()
		.replace(/^https?:\/\/(www\.)?(instagram|tiktok)\.com\/(@)?/i, "")
		.replace(/[/?#].*$/, "")
		.replace(/^@/, "")
		.toLowerCase();

const unique = (list: string[]) => [...new Map(list.map((s) => [s.toLowerCase(), s])).values()];

async function loadBrand(brandId: string) {
	const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
	if (!brand) throw new Error("Brand not found");
	const comps = await db.select().from(competitors).where(eq(competitors.brandId, brandId));
	return { brand, comps };
}

// ── 1. brief ────────────────────────────────────────────────────────

export const generateInfluencerBriefFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			direction: z.string().trim().min(3).max(500),
			platforms: z.array(platformSchema).min(1).max(2),
			followerBands: z.array(bandSchema).max(5).default([]),
			similarTo: z.array(z.string().trim().min(1).max(120)).max(5).default([]),
			avoid: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
			basedIn: z.array(z.string().trim().min(1).max(60)).max(3).default([]),
		}),
	)
	.handler(async ({ data }): Promise<InfluencerBrief> => {
		const session = await requireAuthSession();
		await requireBrandWriteAccess(session.user.id, data.brandId);
		const { brand, comps } = await loadBrand(data.brandId);
		const known = comps.map((c) => c.name);

		const similarTo = unique(data.similarTo.map(cleanHandle).filter(Boolean));
		const draft = await draftBrief({
			brandName: brand.name,
			website: brand.website,
			competitors: known,
			direction: data.direction,
			platforms: data.platforms,
			similarTo,
			avoid: data.avoid,
			basedIn: data.basedIn,
		});
		const pick = (p: Platform) =>
			data.platforms.includes(p) ? unique(draft.queries[p].map(cleanQuery).filter(Boolean)) : [];
		return {
			direction: data.direction,
			platforms: data.platforms,
			queries: { instagram: pick("instagram"), tiktok: pick("tiktok") },
			competitors: unique([...known, ...draft.extraCompetitors]),
			fitSignals: unique(draft.fitSignals),
			followerBands: data.followerBands,
			similarTo,
			avoid: data.avoid,
			basedIn: data.basedIn,
		};
	});

// ── 2. run ──────────────────────────────────────────────────────────

/** A trimmed copy of a profile record: enough to reuse it, without keeping more of anyone's data than needed. */
function trimForCache(data: CachedProfile) {
	return {
		ig: data.ig
			? { ...data.ig, posts: data.ig.posts.slice(0, 12).map((p) => ({ ...p, caption: p.caption.slice(0, 300) })) }
			: undefined,
		tt: data.tt,
	};
}

const profileCache = {
	async get(platform: Platform, handle: string): Promise<CachedProfile | null> {
		const [row] = await db
			.select()
			.from(influencerProfiles)
			.where(and(eq(influencerProfiles.platform, platform), eq(influencerProfiles.handle, handle.toLowerCase())))
			.limit(1);
		if (!row) return null;
		return { ...(row.data as Omit<CachedProfile, "fetchedAt">), fetchedAt: row.fetchedAt.getTime() };
	},
	async put(platform: Platform, handle: string, data: CachedProfile): Promise<void> {
		const values = { data: trimForCache(data), fetchedAt: new Date(data.fetchedAt) };
		await db
			.insert(influencerProfiles)
			.values({ platform, handle: handle.toLowerCase(), ...values })
			.onConflictDoUpdate({ target: [influencerProfiles.platform, influencerProfiles.handle], set: values });
	},
};

export const findInfluencersFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			brief: briefSchema,
			maxSpendUsd: z.number().min(0.05).max(MAX_SPEND_USD).default(0.2),
			targetResults: z.number().int().min(5).max(50).default(30),
		}),
	)
	.handler(async ({ data }): Promise<{ runId: string }> => {
		const session = await requireAuthSession();
		await requireBrandWriteAccess(session.user.id, data.brandId);

		const now = Date.now();
		if (now - (lastRunByBrand.get(data.brandId) ?? 0) < DEBOUNCE_MS) {
			throw new Error("A search for this brand just ran. Give it a moment and try again.");
		}
		lastRunByBrand.set(data.brandId, now);

		const brief: InfluencerBrief = {
			...data.brief,
			queries: {
				instagram: unique(data.brief.queries.instagram.map(cleanQuery).filter(Boolean)),
				tiktok: unique(data.brief.queries.tiktok.map(cleanQuery).filter(Boolean)),
			},
		};
		if (brief.platforms.every((p) => brief.queries[p].length === 0)) throw new Error("Add at least one search phrase.");

		const { brand, comps } = await loadBrand(data.brandId);
		const [run] = await db
			.insert(brandInfluencerSearches)
			.values({
				brandId: data.brandId,
				direction: brief.direction.slice(0, 500),
				brief,
				payload: {},
				createdBy: session.user.name?.trim() || session.user.email || "a teammate",
				status: "running",
				stage: "Planning the search",
				progressPct: 5,
			})
			.returning({ id: brandInfluencerSearches.id });
		if (!run) throw new Error("Couldn't start the search.");
		const runId = run.id;

		const setStage = async (stage: string, progressPct: number): Promise<void> => {
			await db
				.update(brandInfluencerSearches)
				.set({ stage, progressPct, updatedAt: new Date() })
				.where(eq(brandInfluencerSearches.id, runId))
				.catch(() => {});
		};

		// The competitors the team already tracks for this brand come with their domains and aliases;
		// names the brief added on top are matched by name alone.
		const tracked = new Set(comps.map((c) => c.name.toLowerCase()));
		const competitorInputs = [
			...comps.map((c) => ({ name: c.name, aliases: c.aliases, domains: c.domains })),
			...brief.competitors.filter((n) => !tracked.has(n.toLowerCase())).map((name) => ({ name })),
		];

		// Detached on purpose: the run takes minutes, longer than a proxy will hold a request open.
		// Its outcome is written to the row, never thrown from here.
		void (async () => {
			try {
				// Creators not looked up for a couple of months are dropped, so the cache doesn't quietly become a database of people.
				await db
					.delete(influencerProfiles)
					.where(lt(influencerProfiles.fetchedAt, sql`now() - interval '60 days'`))
					.catch(() => {});
				const payload: InfluencerSearchPayload = await runInfluencerSearch(
					{
						brief,
						brandName: brand.name,
						competitors: competitorInputs,
						targetResults: data.targetResults,
						capUsd: data.maxSpendUsd,
					},
					{
						serp: async (query) =>
							(await googleSerp(query, 0, { timeoutMs: 75_000, attempts: 2 })).map((r) => ({
								url: r.url,
								title: r.title,
								snippet: r.snippet,
							})),
						scrape: (dataset, urls) => scrapeDataset(dataset, urls),
						screen: (args) => screenHits(args),
						judge: (args) => judgeCreators(args),
						cache: profileCache,
					},
					setStage,
				);
				await db
					.update(brandInfluencerSearches)
					.set({ status: "done", stage: null, progressPct: 100, payload, updatedAt: new Date() })
					.where(eq(brandInfluencerSearches.id, runId));
			} catch (e) {
				await db
					.update(brandInfluencerSearches)
					.set({
						status: "error",
						stage: null,
						error: e instanceof Error ? e.message.slice(0, 500) : "Search failed",
						updatedAt: new Date(),
					})
					.where(eq(brandInfluencerSearches.id, runId))
					.catch(() => {});
				console.error("[influencer-finder] run failed", e);
			}
		})();

		return { runId };
	});

// ── 3. follow ───────────────────────────────────────────────────────

export const getLatestInfluencerSearchFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1) }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireBrandAccess(session.user.id, data.brandId);
		const [row] = await db
			.select()
			.from(brandInfluencerSearches)
			.where(and(eq(brandInfluencerSearches.brandId, data.brandId), eq(brandInfluencerSearches.status, "done")))
			.orderBy(desc(brandInfluencerSearches.createdAt))
			.limit(1);
		if (!row) return null;
		const payload = row.payload as InfluencerSearchPayload;
		return {
			id: row.id,
			createdAt: String(row.createdAt),
			createdBy: row.createdBy ?? "a teammate",
			direction: row.direction ?? "",
			payload: { ...payload, results: payload.results ?? [] } as InfluencerSearchPayload,
		};
	});

/** Cheap, brand-wide poll for a search in flight, so every page can show progress. */
export const getInfluencerSearchStatusFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1) }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireBrandAccess(session.user.id, data.brandId);
		const [row] = await db
			.select({
				id: brandInfluencerSearches.id,
				status: brandInfluencerSearches.status,
				stage: brandInfluencerSearches.stage,
				progressPct: brandInfluencerSearches.progressPct,
				error: brandInfluencerSearches.error,
				createdAt: brandInfluencerSearches.createdAt,
				updatedAt: brandInfluencerSearches.updatedAt,
			})
			.from(brandInfluencerSearches)
			.where(eq(brandInfluencerSearches.brandId, data.brandId))
			.orderBy(desc(brandInfluencerSearches.createdAt))
			.limit(1);
		if (!row) return null;
		// A run whose server went away mid-search (a restart) never finishes; stop showing it as running.
		if (row.status === "running" && Date.now() - row.updatedAt.getTime() > STALE_RUN_MS) {
			const error = "The search was interrupted. Start it again; creators already checked are reused for free.";
			await db
				.update(brandInfluencerSearches)
				.set({ status: "error", stage: null, error, updatedAt: new Date() })
				.where(eq(brandInfluencerSearches.id, row.id));
			return {
				id: row.id,
				status: "error" as const,
				stage: null,
				progressPct: row.progressPct,
				error,
				startedAt: String(row.createdAt),
				updatedAt: String(new Date()),
			};
		}
		return {
			id: row.id,
			status: row.status as "running" | "done" | "error",
			stage: row.stage,
			progressPct: row.progressPct,
			error: row.error,
			startedAt: String(row.createdAt),
			updatedAt: String(row.updatedAt),
		};
	});
