/**
 * Article Finder, BrightData search + page-signal layer.
 *
 *   • sdk_serp    , Google organic results as parsed JSON (brd_json=1), US/English
 *   • sdk_unlocker, raw HTML of a candidate page, for affiliate signal scanning
 *
 * Best-effort: a blocked SERP page or an un-fetchable article is dropped, not
 * surfaced as an error.
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
	const params = new URLSearchParams({
		q: query,
		brd_json: "1",
		gl: "us",
		hl: "en",
		lr: "lang_en",
		num: "20",
	});
	if (page > 0) params.set("start", String(page * 10));
	if (from && to) params.set("tbs", `cdr:1,cd_min:${gd(from)},cd_max:${gd(to)}`);
	return `https://www.google.com/search?${params.toString()}`;
}

async function brightdataRaw(
	zone: string,
	url: string,
	timeoutMs: number,
	attempts: number,
	render = false,
): Promise<string | null> {
	const token = getCredential("BRIGHTDATA_API_TOKEN");
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			const res = await fetch(BRIGHTDATA_REQUEST_URL, {
				method: "POST",
				headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
				// render:true makes the Unlocker execute page JS, so client-side link
				// monetizers (Skimlinks, Sovrn, Amazon OneLink) get a chance to rewrite
				// plain links into affiliate links before we scan.
				body: JSON.stringify({ zone, url, method: "GET", format: "raw", ...(render ? { render: true } : {}) }),
				signal: AbortSignal.timeout(timeoutMs),
			});
			const body = await res.text();
			if (res.ok && body.trim()) return body;
			if (res.status === 400 || res.status === 401 || res.status === 403) return null;
		} catch {
			// network / timeout, fall through to retry
		}
		if (attempt < attempts - 1) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
	}
	return null;
}

export async function googleSerp(
	query: string,
	page: number,
	opts: { from?: string; to?: string },
): Promise<SerpOrganicResult[]> {
	const body = await brightdataRaw(SERP_ZONE, googleSearchUrl(query, page, opts.from, opts.to), 30_000, 3);
	if (!body) return [];
	let parsed: any;
	try {
		parsed = JSON.parse(body);
	} catch {
		return [];
	}
	const organic: any[] = Array.isArray(parsed?.organic)
		? parsed.organic
		: Array.isArray(parsed?.organic_results)
			? parsed.organic_results
			: [];
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

export async function unlockerFetchHtml(url: string, render = false): Promise<string | null> {
	// One attempt, tight timeout: with dozens of these per run a hung page must
	// not stretch the whole request. A miss just drops the candidate.
	return brightdataRaw(UNLOCKER_ZONE, url, render ? 35_000 : 22_000, 1, render);
}

// ── affiliate HTML signal scan ──────────────────────────────────────

const AFFILIATE_NETWORK_HINTS = [
	"amzn.to",
	"tag=",
	"shareasale.com",
	"skimresources.com",
	"skimlinks.com",
	"go.redirectingat.com",
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
	"bam-x.com",
	"narrativ.com",
	"shop-links.co",
	"cj.com",
	"pepperjam",
	"flexoffices",
	"flexoffers.com",
];

const DISCLOSURE_RE =
	/(affiliate\s+(link|links|commission|partner|disclosure)|we\s+(may\s+)?earn\s+a?\s*commission|earn(s)?\s+(an?\s+)?commission|commission\s+(if|when)\s+you\s+(buy|purchase|click)|as\s+an\s+amazon\s+associate|supported\s+by\s+our\s+readers|this\s+(post|article|page)\s+contains\s+affiliate|may\s+(receive|get)\s+(a\s+)?(small\s+)?(commission|compensation)|independently\s+(chosen|selected|reviewed)\s+(products|by)|when\s+you\s+buy\s+through\s+(our\s+)?links)/i;

const SPONSORED_REL_RE = /rel=["'][^"']*\bsponsored\b/i;

const AFFILIATE_PARAM_RE =
	/[?&](?:tag=[\w.-]+-2\d|aff(?:iliate)?_?id=|utm_medium=affiliate|irclickid=|ranmid=|clickref=|awc=|asc=|siteid=|affid=|partner=|ascsubtag=|linkcode=)/i;

const COMMERCE_RE =
	/cdn\.shopify\.com|\.myshopify\.com|woocommerce|bigcommerce|"@type"\s*:\s*"product"|property=["']og:type["']\s+content=["']product["']|add[\s_-]?to[\s_-]?cart|class=["'][^"']*add-to-cart|\/checkout(?:["'/?]|$)|name=["']add-to-cart["']/i;

export interface AffiliateHtmlSignals {
	sponsoredRel: boolean;
	networkScript: boolean;
	disclosure: boolean;
	/** distinct off-domain hosts reached by an affiliate-tagged link in this article */
	taggedOutboundHosts: string[];
	/** the raw tagged hrefs (capped), so callers can test them against competitor domains */
	taggedLinks: string[];
	commerceMarkers: boolean;
	strong: boolean;
	labels: string[];
}

export function scanHtmlForAffiliateSignals(html: string): AffiliateHtmlSignals {
	const lower = html.toLowerCase();
	const labels: string[] = [];

	const sponsoredRel = SPONSORED_REL_RE.test(html);
	const netHit = AFFILIATE_NETWORK_HINTS.find((h) => lower.includes(h));
	const networkScript = Boolean(netHit);
	const disclosure = DISCLOSURE_RE.test(html);
	const commerceMarkers = COMMERCE_RE.test(html);

	const taggedHosts = new Set<string>();
	const taggedLinks: string[] = [];
	const hrefRe = /href=["']([^"']+)["']/gi;
	let m: RegExpExecArray | null;
	let scanned = 0;
	while ((m = hrefRe.exec(html)) !== null && scanned < 800 && taggedLinks.length < 24) {
		scanned++;
		const href = m[1] ?? "";
		if (!/^https?:\/\//i.test(href)) continue;
		const low = href.toLowerCase();
		if (!AFFILIATE_PARAM_RE.test(low) && !AFFILIATE_NETWORK_HINTS.some((h) => low.includes(h))) continue;
		try {
			taggedHosts.add(new URL(href).hostname.replace(/^www\./, ""));
			taggedLinks.push(href);
		} catch {
			/* ignore */
		}
	}
	const taggedOutboundHosts = [...taggedHosts];

	if (netHit) labels.push(`affiliate network (${netHit})`);
	if (sponsoredRel) labels.push('rel="sponsored" links');
	if (taggedOutboundHosts.length > 0)
		labels.push(`links ${taggedOutboundHosts.length} retailer${taggedOutboundHosts.length === 1 ? "" : "s"} w/ affiliate tags`);
	if (disclosure) labels.push("affiliate disclosure text");

	const strong = networkScript || sponsoredRel || taggedOutboundHosts.length >= 2;
	return { sponsoredRel, networkScript, disclosure, taggedOutboundHosts, taggedLinks, commerceMarkers, strong, labels };
}

const JSONLD_MODIFIED_RE = /"dateModified"\s*:\s*"([0-9]{4}-[0-9]{2}-[0-9]{2})/;
const JSONLD_PUBLISHED_RE = /"datePublished"\s*:\s*"([0-9]{4}-[0-9]{2}-[0-9]{2})/;
const META_DATE_RE =
	/<meta[^>]+(?:property|name|itemprop)=["'](?:article:modified_time|article:published_time|dateModified|datePublished|date|pubdate)["'][^>]+content=["']([^"']+)["']/i;
const TIME_TAG_RE = /<time[^>]+datetime=["']([0-9]{4}-[0-9]{2}-[0-9]{2})/i;

/** Best-effort published/updated date (YYYY-MM-DD), preferring "modified". */
export function extractPublishDate(html: string): string | undefined {
	const tryDate = (v?: string): string | undefined => {
		if (!v) return undefined;
		const iso = v.trim().slice(0, 10);
		if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
		const d = new Date(v);
		return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
	};
	return (
		tryDate(html.match(JSONLD_MODIFIED_RE)?.[1]) ??
		tryDate(html.match(META_DATE_RE)?.[1]) ??
		tryDate(html.match(JSONLD_PUBLISHED_RE)?.[1]) ??
		tryDate(html.match(TIME_TAG_RE)?.[1])
	);
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

const EDITORIAL_MAILBOX_RE =
	/\b(editor|editorial|tips?|pitch(?:es)?|news(?:desk|room)?|hello|hi|press|contact|submissions?|write|contribute|partnerships?)\b/i;
const CONTACT_LINK_TEXT_RE =
	/(write for us|contribute|guest post|editorial guidelines|submit a (?:tip|pitch|story)|pitch us|work with us|partner with us|contact us|about us|masthead|meet the team)/i;

/**
 * Best-effort outreach lead: an editorial email address if the page exposes one,
 * else a "write for us" / contact / masthead link. Returns undefined when neither
 * is present. Absolute URL for links.
 */
export function extractContactHint(html: string, baseUrl: string): string | undefined {
	const mailtos = html.match(/mailto:([^"'?\s>]+@[^"'?\s>]+)/gi) ?? [];
	for (const raw of mailtos) {
		const email = raw.slice(7).toLowerCase();
		if (EDITORIAL_MAILBOX_RE.test(email.split("@")[0] ?? "")) return email;
	}
	if (mailtos[0]) return mailtos[0].slice(7).toLowerCase();

	const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
	let m: RegExpExecArray | null;
	let scanned = 0;
	while ((m = anchorRe.exec(html)) !== null && scanned < 600) {
		scanned++;
		const href = m[1] ?? "";
		const textAndHref = `${m[2]?.replace(/<[^>]+>/g, " ") ?? ""} ${href}`;
		if (!CONTACT_LINK_TEXT_RE.test(textAndHref)) continue;
		try {
			return new URL(href, baseUrl).toString();
		} catch {
			/* ignore */
		}
	}
	return undefined;
}
