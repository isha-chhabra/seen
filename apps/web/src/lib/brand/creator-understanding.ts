/**
 * What is known about a brand for creator outreach, written once and kept: who buys, where, which creators
 * would say yes or no, and the keywords to find them with. Written from the brand's own site (home page and
 * a couple of its about pages) and two Google searches: one about the brand, one about it working with
 * creators. A brand doesn't change, so this is done when the brand is analyzed, not per search; it costs
 * about a cent and a half, once.
 */
import {
	extractInternalLinks,
	extractReadableText,
	googleSerp,
	unlockerFetchHtml,
} from "@workspace/lib/article-finder/search";
import { db } from "@workspace/lib/db/db";
import { brandCreatorProfiles, brands, competitors } from "@workspace/lib/db/schema";
import { keywordsForBrand, understandBrand } from "@workspace/lib/influencer-finder/llm";
import type { BrandUnderstanding } from "@workspace/lib/influencer-finder/types";
import { eq } from "drizzle-orm";

const unique = (list: string[]) => [...new Map(list.map((s) => [s.toLowerCase(), s])).values()];

/** Bio keywords in the form the profile search wants: lowercase plain text. */
const keywords = (list: string[]) =>
	unique(list.map((k) => k.replace(/["#]/g, "").trim().toLowerCase()).filter((k) => k.length >= 3));

export function cleanUnderstanding(u: BrandUnderstanding): BrandUnderstanding {
	return {
		summary: u.summary.trim(),
		customer: u.customer.trim(),
		markets: unique(u.markets.map((m) => m.trim()).filter(Boolean)),
		greatFits: unique(u.greatFits.map((m) => m.trim()).filter(Boolean)),
		dealBreakers: unique(u.dealBreakers.map((m) => m.trim()).filter(Boolean)),
		keywords: u.keywords
			? {
					instagram: keywords(u.keywords.instagram),
					tiktok: unique(u.keywords.tiktok.map((k) => k.replace(/["#]/g, "").trim().toLowerCase()).filter(Boolean)),
					youtube: unique(u.keywords.youtube.map((k) => k.replace(/["#]/g, "").trim().toLowerCase()).filter(Boolean)),
				}
			: undefined,
	};
}

export async function saveUnderstanding(brandId: string, profile: BrandUnderstanding, source: "website" | "edited") {
	await db
		.insert(brandCreatorProfiles)
		.values({ brandId, profile, source })
		.onConflictDoUpdate({ target: brandCreatorProfiles.brandId, set: { profile, source, updatedAt: new Date() } });
}

const snippets = (results: { title: string; snippet: string }[]) =>
	results
		.slice(0, 7)
		.map((r) => `- ${r.title}: ${r.snippet}`)
		.join("\n");

/** Reads the brand's site and searches Google about it, then writes the profile and saves it. */
export async function writeUnderstanding(brandId: string): Promise<BrandUnderstanding> {
	const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
	if (!brand) throw new Error("Brand not found");
	const comps = await db.select().from(competitors).where(eq(competitors.brandId, brandId));
	const url = /^https?:/i.test(brand.website) ? brand.website : `https://${brand.website}`;
	const host = url.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/.*$/, "");

	const [home, web, creators] = await Promise.all([
		unlockerFetchHtml(url).catch(() => null),
		googleSerp(`${brand.name} ${host}`, 0, { timeoutMs: 60_000, attempts: 2 }).catch(() => []),
		googleSerp(`${brand.name} influencer ambassador creator partnership`, 0, { timeoutMs: 60_000, attempts: 2 }).catch(
			() => [],
		),
	]);

	// An about-style page or two say more about who the brand is for than a home page full of products.
	let about = "";
	if (home) {
		const pages = extractInternalLinks(home, url, 40)
			.filter((l) => /about|story|mission|who[- ]we|why|our[- ]/i.test(`${l.url} ${l.text}`))
			.slice(0, 2);
		const htmls = await Promise.all(pages.map((p) => unlockerFetchHtml(p.url).catch(() => null)));
		about = htmls
			.filter((h): h is string => !!h)
			.map((h) => extractReadableText(h).slice(0, 2000))
			.join("\n\n");
	}

	const profile = cleanUnderstanding(
		await understandBrand({
			brandName: brand.name,
			website: brand.website,
			competitors: comps.map((c) => c.name),
			pageText: [home ? extractReadableText(home).slice(0, 4000) : "", about].filter(Boolean).join("\n\n"),
			webSnippets: snippets(web),
			creatorSnippets: snippets(creators),
		}),
	);
	await saveUnderstanding(brandId, profile, "website");
	return profile;
}

/** Fills in the standing keywords on a profile saved before they existed, without touching anything a person wrote. */
export async function ensureKeywords(
	brandId: string,
	profile: BrandUnderstanding,
	source: string,
): Promise<BrandUnderstanding> {
	if (profile.keywords) return profile;
	const [brand] = await db.select({ name: brands.name }).from(brands).where(eq(brands.id, brandId)).limit(1);
	if (!brand) return profile;
	const filled = cleanUnderstanding({
		...profile,
		keywords: await keywordsForBrand({ brandName: brand.name, profile }),
	});
	await saveUnderstanding(brandId, filled, source === "edited" ? "edited" : "website");
	return filled;
}

/** Called when a brand has been analyzed or created: writes the profile in the background, once. */
export function prepareBrandForCreators(brandId: string): void {
	void (async () => {
		const [row] = await db
			.select()
			.from(brandCreatorProfiles)
			.where(eq(brandCreatorProfiles.brandId, brandId))
			.limit(1);
		if (row) return;
		await writeUnderstanding(brandId);
	})().catch((e) => console.error("[creator-understanding] could not write the brand profile", e));
}
