/**
 * Bright Data's ready-made social scrapers ("datasets"). One call takes public
 * profile or post URLs and returns one structured record per URL, billed per
 * record. Small batches answer immediately (HTTP 200); larger ones are queued
 * (HTTP 202) and polled until ready.
 */
import { getCredential } from "../secrets";

const BASE = "https://api.brightdata.com/datasets/v3";

export const DATASETS = {
	instagramProfile: "gd_l1vikfch901nx3by4",
	instagramPost: "gd_lk5ns7kz21pck8jpis",
	tiktokProfile: "gd_l1villgoiiidt09ci",
} as const;

export type DatasetRecord = Record<string, unknown>;

export interface ScrapeOptions {
	fetchImpl?: typeof fetch;
	pollMs?: number;
	maxPolls?: number;
}

export async function scrapeDataset(
	dataset: string,
	urls: readonly string[],
	{ fetchImpl = fetch, pollMs = 5_000, maxPolls = 60 }: ScrapeOptions = {},
): Promise<DatasetRecord[]> {
	if (urls.length === 0) return [];
	const token = getCredential("BRIGHTDATA_API_TOKEN");
	if (!token) throw new Error("BRIGHTDATA_API_TOKEN is not set");
	const auth = { Authorization: `Bearer ${token}` };

	const res = await fetchImpl(`${BASE}/scrape?dataset_id=${dataset}&format=json`, {
		method: "POST",
		headers: { ...auth, "Content-Type": "application/json" },
		body: JSON.stringify({ input: urls.map((url) => ({ url })) }),
		signal: AbortSignal.timeout(120_000),
	});

	let records: unknown;
	if (res.status === 200) {
		records = await res.json();
	} else if (res.status === 202) {
		const { snapshot_id: snapshot } = (await res.json()) as { snapshot_id: string };
		let status = "running";
		for (let i = 0; i < maxPolls && status !== "ready" && status !== "failed"; i++) {
			await new Promise((r) => setTimeout(r, pollMs));
			const progress = await fetchImpl(`${BASE}/progress/${snapshot}`, {
				headers: auth,
				signal: AbortSignal.timeout(30_000),
			});
			status = ((await progress.json()) as { status?: string }).status ?? "running";
		}
		if (status !== "ready") return [];
		const download = await fetchImpl(`${BASE}/snapshot/${snapshot}?format=json`, {
			headers: auth,
			signal: AbortSignal.timeout(60_000),
		});
		records = await download.json();
	} else {
		console.warn(`[influencer-finder] dataset ${dataset} responded ${res.status}`);
		return [];
	}

	const list = Array.isArray(records) ? records : [records];
	// A record with an error field is a URL that could not be read; it isn't a creator.
	return list.filter((r): r is DatasetRecord => !!r && typeof r === "object" && !("error" in r));
}

// ── searching Bright Data's ready-made Instagram profiles ───────────

const MARKETPLACE = "https://api.brightdata.com/datasets";

export interface ProfileSearch {
	/** A profile qualifies when its bio contains any of these (case-insensitive). */
	keywords: readonly string[];
	minFollowers: number;
	maxFollowers: number | null;
	/** Handles already seen, left out so a second pass returns new creators. */
	exclude: readonly string[];
	/** The most records to return, and so the most that can be billed. */
	limit: number;
}

/** Bright Data allows at most 4 rules in one group and 3 levels of groups, so bio keywords go in groups of 4. */
const GROUP_MAX = 4;

/** The filter the search sends: bio keywords, follower range, minus handles already seen. Private accounts are dropped after. */
export function profileFilter(search: ProfileSearch): Record<string, unknown> {
	const words = search.keywords
		.slice(0, GROUP_MAX * GROUP_MAX)
		.map((value) => ({ name: "biography", operator: "includes", value }));
	const groups: Record<string, unknown>[] = [];
	for (let i = 0; i < words.length; i += GROUP_MAX)
		groups.push({ operator: "or", filters: words.slice(i, i + GROUP_MAX) });
	const bio = groups.length === 1 ? groups[0] : { operator: "or", filters: groups };
	const filters: Record<string, unknown>[] = [
		bio as Record<string, unknown>,
		{ name: "followers", operator: ">=", value: search.minFollowers },
	];
	if (search.maxFollowers !== null) filters.push({ name: "followers", operator: "<=", value: search.maxFollowers });
	if (search.exclude.length > 0) filters.push({ name: "account", operator: "not_in", value: [...search.exclude] });
	return { operator: "and", filters };
}

/**
 * Asks Bright Data's Instagram profile database for creators whose bio matches, billed per record
 * returned ($2.50 per 1,000; nothing when nothing matches). The job takes a couple of minutes to build,
 * whatever its size, so it is polled until ready.
 */
export async function searchInstagramProfiles(
	search: ProfileSearch,
	{ fetchImpl = fetch, pollMs = 5_000, maxPolls = 84 }: ScrapeOptions = {},
): Promise<DatasetRecord[]> {
	if (search.keywords.length === 0 || search.limit <= 0) return [];
	const token = getCredential("BRIGHTDATA_API_TOKEN");
	if (!token) throw new Error("BRIGHTDATA_API_TOKEN is not set");
	const auth = { Authorization: `Bearer ${token}` };

	const res = await fetchImpl(`${MARKETPLACE}/filter`, {
		method: "POST",
		headers: { ...auth, "Content-Type": "application/json" },
		body: JSON.stringify({
			dataset_id: DATASETS.instagramProfile,
			records_limit: search.limit,
			filter: profileFilter(search),
		}),
		signal: AbortSignal.timeout(60_000),
	});
	if (!res.ok) throw new Error(`profile search responded ${res.status}`);
	const { snapshot_id: snapshot } = (await res.json()) as { snapshot_id?: string };
	if (!snapshot) throw new Error("profile search returned no snapshot");

	for (let i = 0; i < maxPolls; i++) {
		await new Promise((r) => setTimeout(r, pollMs));
		const meta = await fetchImpl(`${MARKETPLACE}/snapshots/${snapshot}`, {
			headers: auth,
			signal: AbortSignal.timeout(30_000),
		});
		const info = (await meta.json()) as { status?: string; dataset_size?: number };
		if (info.status === "failed") throw new Error("profile search failed");
		if (info.status !== "ready") continue;
		if (!info.dataset_size) return [];
		const download = await fetchImpl(`${MARKETPLACE}/snapshots/${snapshot}/download?format=json`, {
			headers: auth,
			signal: AbortSignal.timeout(90_000),
		});
		const records = await download.json();
		return (Array.isArray(records) ? records : []).filter((r): r is DatasetRecord => !!r && typeof r === "object");
	}
	throw new Error("profile search timed out");
}
