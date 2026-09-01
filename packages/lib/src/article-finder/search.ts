/**
 * Article Finder — BrightData search + page-signal layer.
 *
 * Reuses the two zones the deployment already runs on one BRIGHTDATA_API_TOKEN:
 *   • sdk_serp     — Google organic results as parsed JSON (brd_json=1)
 *   • sdk_unlocker — raw HTML of a candidate page, for affiliate signal scanning
 *
 * Everything here is best-effort: a blocked SERP page or an un-fetchable
 * article is dropped, not surfaced as an error.
 */
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { getCredential } from "../secrets";

const BRIGHTDATA_REQUEST_URL = "https://api.brightdata.com/request";
const SERP_ZONE = process.env.BRIGHTDATA_SERP_ZONE ?? "sdk_serp";
const UNLOCKER_ZONE = process.env.BRIGHTDATA_UNLOCKER_ZONE ?? "sdk_unlocker";

export interface SerpOrganicResult {
	title: string;
	url: string;
	snippet: string;
	rank: number;
}

function gd(ymd: string): string {
	const [y, m, d] = ymd.split("-");
	return `${Number(m)}/${Number(d)}/${y}`;
}

function googleSearchUrl(query: string, page: number, from?: string, to?: string): string {
	const params = new URLSearchParams({ q: query, brd_json: "1", gl: "us", hl: "en", num: "20" });
	if (page > 0) params.set("start", String(page * 10));
	if (from && to) params.set("tbs", `cdr:1,cd_min:${gd(from)},cd_max:${gd(to)}`);
	return `https://www.google.com/search?${params.toString()}`;
}

async function brightdataRaw(zone: string, url: string, timeoutMs: number): Promise<string | null> {
	const token = getCredential("BRIGHTDATA_API_TOKEN");
	for (let attempt = 0; attempt < 3; attempt++) {
		try {
			const res = await fetch(BRIGHTDATA_REQUEST_URL, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				body: JSON.stringify({ zone, url, method: "GET", format: "raw" }),
				signal: AbortSignal.timeout(timeoutMs),
			});
			const body = await res.text();
			if (res.ok && body.trim()) return body;
			// auth / bad-request errors won't fix themselves on retry
			if (res.status === 400 || res.status === 401 || res.status === 403) return null;
		} catch {
			// network / timeout — fall through to retry
		}
		await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
	}
	return null;
}

export async function googleSerp(
	query: string,
	page: number,
	opts: { from?: string; to?: string },
): Promise<SerpOrganicResult[]> {
	const body = await brightdataRaw(SERP_ZONE, googleSearchUrl(query, page, opts.from, opts.to), 45_000);
	if (!body) return [];
	let parsed: any;
	try {
		parsed = JSON.parse(body);
	} catch {
		return [];
	}
	const organic: any[] = Array.isArray(parsed?.organic) ? parsed.organic : [];
	return organic
		.map((o, i) => ({
			title: String(o?.title ?? o?.name ?? "").trim(),
			url: String(o?.link ?? o?.url ?? "").trim(),
			snippet: String(o?.description ?? o?.snippet ?? "").trim(),
			rank:
				typeof o?.global_rank === "number"
					? o.global_rank
					: typeof o?.rank === "number"
						? o.rank + page * 100
						: i + 1 + page * 100,
		}))
		.filter((o) => o.url.startsWith("http") && o.title.length > 0);
}

export async function unlockerFetchHtml(url: string): Promise<string | null> {
	return brightdataRaw(UNLOCKER_ZONE, url, 40_000);
}

// ── affiliate HTML signal scan ──────────────────────────────────────

const AFFILIATE_NETWORK_HINTS = [
	"amzn.to",
	"tag=",
	"shareasale.com",
	"skimresources.com",
	"skimlinks.com",
	"prf.hn",
	"partnerize",
	"anrdoezrs.net",
	"dpbolvw.net",
	"tkqlhce.com",
	"jdoqocy.com",
	"kqzyfj.com",
	"linksynergy.com",
	"rakuten.com",
	"impact.com",
	"impactradius",
	"sjv.io",
	"avantlink",
	"howl.me",
	"levanta",
	"sovrn.com",
	"gopjn.com",
	"pntra.com",
	"pntrac.com",
	"avln.me",
	"clickbank.net",
	"awin1.com",
	"zenaps.com",
	"go.redirectingat.com",
	"bam-x.com",
	"narrativ.com",
	"shop-links.co",
];

const DISCLOSURE_RE =
	/(affiliate\s+(link|links|commission|partner|disclosure)|we\s+(may\s+)?earn\s+a?\s*commission|earn(s)?\s+(an?\s+)?commission|commission\s+(if|when)\s+you\s+(buy|purchase|click)|as\s+an\s+amazon\s+associate|supported\s+by\s+our\s+readers|this\s+(post|article|page)\s+contains\s+affiliate|may\s+(receive|get)\s+(a\s+)?(small\s+)?(commission|compensation))/i;

const SPONSORED_REL_RE = /rel=["'][^"']*\bsponsored\b/i;

const AFFILIATE_PARAM_IN_HREF_RE =
	/href=["'][^"']*(?:[?&](?:tag=[\w.-]+-2\d|aff(?:iliate)?_?id=|utm_medium=affiliate|irclickid=|ranmid=|clickref=|awc=|asc=|siteid=|affid=|partner=)[^"'\s]*)/i;

export interface AffiliateHtmlSignals {
	sponsoredRel: boolean;
	networkScript: boolean;
	trackedOutboundLink: boolean;
	disclosure: boolean;
	score: number;
	labels: string[];
}

export function scanHtmlForAffiliateSignals(html: string): AffiliateHtmlSignals {
	const lower = html.toLowerCase();
	const labels: string[] = [];

	const sponsoredRel = SPONSORED_REL_RE.test(html);
	if (sponsoredRel) labels.push('rel="sponsored" links');

	const netHit = AFFILIATE_NETWORK_HINTS.find((h) => lower.includes(h));
	const networkScript = Boolean(netHit);
	if (netHit) labels.push(`affiliate network (${netHit})`);

	const trackedOutboundLink = AFFILIATE_PARAM_IN_HREF_RE.test(html);
	if (trackedOutboundLink && !networkScript) labels.push("affiliate tracking parameter in a link");

	const disclosure = DISCLOSURE_RE.test(html);
	if (disclosure) labels.push("affiliate disclosure text");

	const score = (sponsoredRel ? 1 : 0) + (networkScript ? 1 : 0) + (trackedOutboundLink ? 1 : 0) + (disclosure ? 1 : 0);
	return { sponsoredRel, networkScript, trackedOutboundLink, disclosure, score, labels };
}

export function extractReadableText(html: string): string {
	try {
		const { document } = parseHTML(html);
		const article = new Readability(document).parse();
		const text = article?.textContent?.trim() || document.body?.textContent?.trim() || "";
		return text.replace(/\s+/g, " ").trim();
	} catch {
		return "";
	}
}
