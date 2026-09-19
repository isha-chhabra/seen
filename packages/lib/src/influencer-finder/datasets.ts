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
