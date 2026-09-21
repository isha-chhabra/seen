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
import {
	brandCreatorProfiles,
	brandInfluencerSearches,
	brands,
	competitors,
	influencerProfiles,
} from "@workspace/lib/db/schema";
import { scrapeDataset, searchInstagramProfiles } from "@workspace/lib/influencer-finder/datasets";
import { draftBrief, expandQueries, judgeCreators, screenHits } from "@workspace/lib/influencer-finder/llm";
import { type CachedProfile, clip, type Memo, runInfluencerSearch } from "@workspace/lib/influencer-finder/pipeline";
import type {
	BrandUnderstanding,
	InfluencerBrief,
	InfluencerSearchPayload,
	Platform,
} from "@workspace/lib/influencer-finder/types";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireBrandAccess, requireBrandWriteAccess } from "@/lib/auth/helpers";
import {
	cleanUnderstanding,
	ensureKeywords,
	saveUnderstanding,
	writeUnderstanding,
} from "@/lib/brand/creator-understanding";

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

const understandingSchema = z.object({
	summary: z.string().trim().min(1).max(600),
	customer: z.string().trim().min(1).max(300),
	markets: z.array(z.string().trim().min(1).max(60)).min(1).max(8),
	greatFits: z.array(z.string().trim().min(1).max(120)).max(12),
	dealBreakers: z.array(z.string().trim().min(1).max(120)).max(12),
	keywords: z
		.object({
			instagram: z.array(z.string().trim().min(1).max(60)).max(16),
			tiktok: z.array(z.string().trim().min(1).max(80)).max(16),
			youtube: z.array(z.string().trim().min(1).max(80)).max(16),
		})
		.optional(),
});

const briefSchema = z.object({
	brand: understandingSchema.optional(),
	direction: z.string().trim().min(3).max(500),
	platforms: z.array(platformSchema).min(1).max(2),
	queries: z.object({
		instagram: z.array(z.string()).max(12),
		tiktok: z.array(z.string()).max(12),
	}),
	competitors: z.array(z.string().trim().min(1).max(80)).max(40),
	fitSignals: z.array(z.string().trim().min(1).max(120)).max(20),
	followerBands: z.array(bandSchema).max(5),
	bioKeywords: z.array(z.string().trim().min(1).max(60)).max(16).optional(),
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

/** Data from the profile database can hold half an emoji, which Postgres refuses to search inside; repair it before storing. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const wellFormed = <T>(value: T): T =>
	JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "string" ? v.replace(LONE_SURROGATE, "\uFFFD") : v)));

const unique = (list: string[]) => [...new Map(list.map((s) => [s.toLowerCase(), s])).values()];

async function loadBrand(brandId: string) {
	const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
	if (!brand) throw new Error("Brand not found");
	const comps = await db.select().from(competitors).where(eq(competitors.brandId, brandId));
	return { brand, comps };
}

// ── 0. the brand ────────────────────────────────────────────────────

/** What is known about the brand for creator outreach: the saved copy, or one written now from its website. */
export const getBrandUnderstandingFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1), refresh: z.boolean().default(false) }))
	.handler(async ({ data }): Promise<{ profile: BrandUnderstanding; source: string }> => {
		const session = await requireAuthSession();
		if (data.refresh) await requireBrandWriteAccess(session.user.id, data.brandId);
		else await requireBrandAccess(session.user.id, data.brandId);
		if (!data.refresh) {
			const [row] = await db
				.select()
				.from(brandCreatorProfiles)
				.where(eq(brandCreatorProfiles.brandId, data.brandId))
				.limit(1);
			if (row) {
				const profile = await ensureKeywords(data.brandId, row.profile as BrandUnderstanding, row.source);
				return { profile, source: row.source };
			}
		}
		// Reading a site and writing this up costs a fraction of a cent.
		return { profile: await writeUnderstanding(data.brandId), source: "website" };
	});

// ── 1. brief ────────────────────────────────────────────────────────

export const generateInfluencerBriefFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			direction: z.string().trim().max(500).default(""),
			platforms: z.array(platformSchema).min(1).max(2),
			followerBands: z.array(bandSchema).max(5).default([]),
			similarTo: z.array(z.string().trim().min(1).max(120)).max(5).default([]),
			avoid: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
			basedIn: z.array(z.string().trim().min(1).max(60)).max(3).default([]),
			understanding: understandingSchema,
		}),
	)
	.handler(async ({ data }): Promise<InfluencerBrief> => {
		const session = await requireAuthSession();
		await requireBrandWriteAccess(session.user.id, data.brandId);
		const { brand, comps } = await loadBrand(data.brandId);
		const known = comps.map((c) => c.name);

		// What the person confirmed or corrected about the brand is kept for next time, and shapes everything below.
		const understanding = cleanUnderstanding(data.understanding);
		await saveUnderstanding(data.brandId, understanding, "edited");
		// Nothing typed means: look for the kinds of creator the brand is already known to want.
		const direction = data.direction || understanding.greatFits.join(", ") || understanding.summary;
		const similarTo = unique(data.similarTo.map(cleanHandle).filter(Boolean));
		const draft = await draftBrief({
			brand: understanding,
			brandName: brand.name,
			website: brand.website,
			competitors: known,
			direction,
			platforms: data.platforms,
			similarTo,
			avoid: data.avoid,
			basedIn: understanding.markets,
		});
		const pick = (p: Platform) =>
			data.platforms.includes(p) ? unique(draft.queries[p].map(cleanQuery).filter(Boolean)) : [];
		return {
			brand: understanding,
			direction,
			platforms: data.platforms,
			// The brand's standing keywords come first, then whatever is specific to this search.
			queries: {
				instagram: pick("instagram"),
				tiktok: unique([
					...(data.platforms.includes("tiktok") ? (understanding.keywords?.tiktok ?? []) : []),
					...pick("tiktok"),
				]).slice(0, 12),
			},
			competitors: unique([...known, ...draft.extraCompetitors]),
			fitSignals: unique(draft.fitSignals),
			bioKeywords: unique(
				[...(understanding.keywords?.instagram ?? []), ...(draft.bioKeywords ?? [])]
					.map((k) => k.replace(/["#]/g, "").trim().toLowerCase())
					.filter((k) => k.length >= 3),
			),
			followerBands: data.followerBands,
			similarTo,
			avoid: data.avoid,
			basedIn: understanding.markets,
		};
	});

// ── 2. run ──────────────────────────────────────────────────────────

/** A trimmed copy of a profile record: enough to reuse it, without keeping more of anyone's data than needed. */
function trimForCache(data: CachedProfile) {
	return {
		ig: data.ig
			? { ...data.ig, posts: data.ig.posts.slice(0, 12).map((p) => ({ ...p, caption: clip(p.caption, 300) })) }
			: undefined,
		tt: data.tt,
		samples: data.samples?.slice(0, 12).map((p) => ({ ...p, caption: clip(p.caption, 200) })),
		samplesAt: data.samplesAt,
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
		const values = { data: wellFormed(trimForCache(data)), fetchedAt: new Date(data.fetchedAt) };
		await db
			.insert(influencerProfiles)
			.values({ platform, handle: handle.toLowerCase(), ...values })
			.onConflictDoUpdate({ target: [influencerProfiles.platform, influencerProfiles.handle], set: values });
	},
};

/**
 * Small lookups kept for every brand in the same table as the profiles, told apart by `platform`:
 * "ig_post" (post code -> creator) and "serp" (one Google results page).
 */
const memo: Memo = {
	async get(kind, key) {
		const [row] = await db
			.select()
			.from(influencerProfiles)
			.where(and(eq(influencerProfiles.platform, kind), eq(influencerProfiles.handle, key)))
			.limit(1);
		return row ? { value: (row.data as { value: unknown }).value, at: row.fetchedAt.getTime() } : null;
	},
	async put(kind, key, value) {
		const values = { data: wellFormed({ value }), fetchedAt: new Date() };
		await db
			.insert(influencerProfiles)
			.values({ platform: kind, handle: key, ...values })
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
		const bioKeywords = unique(
			(data.brief.bioKeywords ?? []).map((k) => k.replace(/["#]/g, "").trim().toLowerCase()).filter(Boolean),
		);
		brief.bioKeywords = bioKeywords;
		const hasInstagramKeywords = brief.platforms.includes("instagram") && bioKeywords.length > 0;
		if (!hasInstagramKeywords && brief.platforms.every((p) => brief.queries[p].length === 0)) {
			throw new Error("Add at least one bio keyword or search phrase.");
		}

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
				// Profiles unused for over three months are dropped, so the cache doesn't quietly become a database of people.
				// Google pages go sooner: search results date quickly.
				await db
					.delete(influencerProfiles)
					.where(lt(influencerProfiles.fetchedAt, sql`now() - interval '100 days'`))
					.catch(() => {});
				await db
					.delete(influencerProfiles)
					.where(
						and(
							eq(influencerProfiles.platform, "serp"),
							lt(influencerProfiles.fetchedAt, sql`now() - interval '10 days'`),
						),
					)
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
						serp: async (query, page) =>
							(await googleSerp(query, page, { timeoutMs: 75_000, attempts: 2 })).map((r) => ({
								url: r.url,
								title: r.title,
								snippet: r.snippet,
							})),
						scrape: (dataset, urls) => scrapeDataset(dataset, urls),
						profiles: (search) => searchInstagramProfiles(search),
						expand: async (args) => (await expandQueries(args)).map(cleanQuery).filter(Boolean),
						screen: (args) => screenHits(args),
						judge: (args) => judgeCreators(args),
						cache: profileCache,
						memo,
					},
					setStage,
				);
				await db
					.update(brandInfluencerSearches)
					.set({ status: "done", stage: null, progressPct: 100, payload: wellFormed(payload), updatedAt: new Date() })
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
