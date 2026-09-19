/**
 * Deterministic facts about a creator, computed in code so they never depend on
 * a model's arithmetic or mood: posting cadence, engagement, sponsorship
 * markers and competitor matches. The AI judge gets these as inputs and adds
 * only what needs reading comprehension (does the content fit the brief).
 */
import type { CollabSummary, CreatorPost, FollowerBand, SponsorTag } from "./types";
import { FOLLOWER_BANDS, followerBandOf } from "./types";

const DAY_MS = 86_400_000;

// ── activity ────────────────────────────────────────────────────────

/** Posts per week across the span of the given dates (newest to oldest). Null with fewer than two dates. */
export function postsPerWeek(dates: readonly string[]): number | null {
	const times = dates.map((d) => new Date(d).getTime()).filter((t) => Number.isFinite(t));
	if (times.length < 2) return null;
	const span = (Math.max(...times) - Math.min(...times)) / DAY_MS;
	return Math.round(((times.length - 1) / Math.max(1, span)) * 7 * 10) / 10;
}

export function daysSince(iso: string | null | undefined, now = Date.now()): number | null {
	if (!iso) return null;
	const t = new Date(iso).getTime();
	return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / DAY_MS)) : null;
}

// ── engagement ──────────────────────────────────────────────────────

export interface EngagementSample {
	likes: number | null | undefined;
	comments: number | null | undefined;
}

/**
 * Average (likes + comments) / followers, in percent, over the posts whose likes
 * are visible. Instagram lets people hide like counts (reported as null or -1);
 * those posts are left out rather than counted as zero.
 */
export function engagementPct(
	samples: readonly EngagementSample[],
	followers: number | null | undefined,
): { pct: number | null; sample: number } {
	const usable = samples.filter((s) => typeof s.likes === "number" && s.likes >= 0);
	if (usable.length === 0 || !followers || followers <= 0) return { pct: null, sample: usable.length };
	const total = usable.reduce((sum, s) => sum + (s.likes as number) + Math.max(0, s.comments ?? 0), 0);
	return { pct: Math.round((total / usable.length / followers) * 10_000) / 100, sample: usable.length };
}

// ── sponsorship markers ─────────────────────────────────────────────

const NOT_WORD = "(?<![\\w])";
const BOUNDARY = "(?![\\w])";
const AD_MARKERS = new RegExp(
	[
		`${NOT_WORD}#ad${BOUNDARY}`,
		`${NOT_WORD}#(?:sponsored|sponsoredpost|paidpartnership|paidad|paidpromo|paidpromotion|advertisement)${BOUNDARY}`,
		"paid partnership",
		"paid promotion",
		`${NOT_WORD}sponsored by`,
		"in paid partnership with",
		`^ad[:\\s]`,
	].join("|"),
	"i",
);
const GIFTED_MARKERS = new RegExp(
	[
		`${NOT_WORD}#(?:gifted|prgift|prsample|prpackage|gifted\\w*)${BOUNDARY}`,
		"gifted (?:by|to me|from)",
		"(?:was|were) gifted",
		"pr (?:gift|package|sample)",
		"sent (?:to me )?by",
	].join("|"),
	"i",
);
const CODE_MARKERS =
	/\b(?:use|with|my)\s+(?:discount\s+)?code\b|\bcode\s+[A-Z0-9]{3,}\b|\b\d{1,2}%\s+off\s+(?:with|using)\b|\baffiliate\b/i;
const PARTNER_MARKERS = new RegExp(
	[
		"in partnership with",
		"partnered with",
		"partnering with",
		`${NOT_WORD}#(?:collab|partner|brandpartner|ambassador|brandambassador|teamup)${BOUNDARY}`,
		"brand ambassador",
		"collab(?:oration)? with",
	].join("|"),
	"i",
);

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

export interface PostInput {
	date?: string | null;
	kind?: string | null;
	caption?: string | null;
	url?: string | null;
	hashtags?: readonly string[] | null;
	/** Instagram's own paid-partnership label, when the record carries one. */
	partnershipLabel?: boolean;
	/** Accounts credited as co-authors of the post (Instagram collab posts). */
	coauthors?: readonly string[] | null;
	/** Accounts tagged in the post. */
	tagged?: readonly string[] | null;
}

/** True when one name contains the other, or they share most of a long common start ("thebigfashionguy" / "thebigfashioncollection"). */
function sameNameFamily(a: string, b: string): boolean {
	if (a.includes(b) || b.includes(a)) return true;
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	return i >= 8 && i >= Math.min(a.length, b.length) * 0.7;
}

function mentionsIn(caption: string): string[] {
	return [...caption.matchAll(/@([A-Za-z0-9._]{2,30})/g)].map((m) => (m[1] ?? "").replace(/\.$/, ""));
}

/** Reads one post: which sponsorship marker it carries (if any) and which brand it was for. */
export function tagPost(post: PostInput, self: { handle: string; name?: string | null }): CreatorPost {
	const caption = (post.caption ?? "").replace(/\s+/g, " ").trim();
	const text = [caption, ...(post.hashtags ?? [])].join(" ");
	let tag: SponsorTag = "organic";
	if (post.partnershipLabel || AD_MARKERS.test(text)) tag = "ad";
	else if (GIFTED_MARKERS.test(text)) tag = "gifted";
	else if (CODE_MARKERS.test(text)) tag = "code";
	else if (PARTNER_MARKERS.test(text) || (post.coauthors ?? []).length > 0) tag = "partner";

	let brand: string | null = null;
	if (tag !== "organic") {
		const ownKeys = [norm(self.handle), norm(self.name)].filter((k) => k.length >= 4);
		const candidates = [...(post.coauthors ?? []), ...mentionsIn(caption), ...(post.tagged ?? [])].filter(
			(m) => norm(m) !== norm(self.handle),
		);
		const first = candidates[0];
		if (first) {
			const key = norm(first);
			// A "sponsor" that is the creator's own line or shop is not a brand collaboration.
			if (key.length >= 4 && ownKeys.some((o) => sameNameFamily(o, key))) tag = "own_brand";
			else brand = first;
		}
	}
	return {
		date: post.date ?? null,
		kind: post.kind ?? null,
		caption: caption.slice(0, 220),
		url: post.url ?? null,
		tag,
		brand,
	};
}

const SPONSORED: readonly SponsorTag[] = ["ad", "gifted", "partner", "code"];

export function summarizeCollabs(posts: readonly CreatorPost[]): CollabSummary {
	const sponsored = posts.filter((p) => SPONSORED.includes(p.tag));
	const brands = [...new Set(sponsored.map((p) => p.brand).filter((b): b is string => !!b))];
	// Disclosure: how many of the sponsored posts carry an explicit "ad" marker, not just a code or a tag.
	const explicit = sponsored.filter((p) => p.tag === "ad").length;
	return {
		sponsoredPosts: sponsored.length,
		postsChecked: posts.length,
		brands,
		discloses: sponsored.length === 0 ? null : explicit / sponsored.length >= 0.5,
	};
}

// ── competitors ─────────────────────────────────────────────────────

export interface CompetitorInput {
	name: string;
	aliases?: readonly string[];
	domains?: readonly string[];
}

export interface CompetitorMatcher {
	/** A competitor name found in an account's own identity (handle, display name, site). */
	identity(parts: readonly (string | null | undefined)[]): string[];
	/** A competitor named or tagged in free text (captions, hashtags, credited accounts). */
	mentions(text: string): string[];
}

const SITE_SUFFIXES = ["com", "co", "net", "shop", "store", "official", "us"];

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildCompetitorMatcher(competitors: readonly CompetitorInput[]): CompetitorMatcher {
	interface Entry {
		display: string;
		key: string;
		phrase: RegExp;
		/** Short single words ("target", "gap") also occur in ordinary sentences, so they only count as @handle or #tag. */
		needsSigil: boolean;
	}
	const entries: Entry[] = [];
	for (const c of competitors) {
		const forms = [
			c.name,
			...(c.aliases ?? []),
			...(c.domains ?? []).map((d) => d.replace(/^www\./, "").split(".")[0] ?? ""),
		];
		for (const form of forms) {
			const key = norm(form);
			if (key.length < 4) continue;
			const words = form
				.trim()
				.split(/[^A-Za-z0-9]+/)
				.filter(Boolean);
			const spaced = words.map(escapeRegex).join("[\\s._-]*");
			entries.push({
				display: c.name,
				key,
				phrase: new RegExp(`(?<![A-Za-z0-9])${spaced}(?![A-Za-z0-9])`, "i"),
				needsSigil: words.length === 1 && key.length < 7,
			});
		}
	}
	return {
		identity(parts) {
			const cleaned = parts.filter((p): p is string => !!p);
			const blob = norm(cleaned.join(" "));
			const hit = (e: Entry) => {
				if (!e.needsSigil) return blob.includes(e.key);
				// A short common word must BE the account (or its site), not merely sit inside a longer handle.
				return cleaned.some((p) => {
					const part = norm(p);
					return part === e.key || (part.startsWith(e.key) && SITE_SUFFIXES.includes(part.slice(e.key.length)));
				});
			};
			return [...new Set(entries.filter(hit).map((e) => e.display))];
		},
		mentions(text) {
			const hits = new Set<string>();
			for (const e of entries) {
				if (e.needsSigil) {
					if (new RegExp(`[@#]${escapeRegex(e.key)}(?![A-Za-z0-9])`, "i").test(text)) hits.add(e.display);
				} else if (e.phrase.test(text) || new RegExp(`[@#]${escapeRegex(e.key)}`, "i").test(text)) {
					hits.add(e.display);
				}
			}
			return [...hits];
		},
	};
}

// ── follower bands ──────────────────────────────────────────────────

export function inFollowerBands(followers: number | null | undefined, bands: readonly FollowerBand[]): boolean {
	if (bands.length === 0) return true;
	const band = followerBandOf(followers);
	return band !== null && bands.includes(band);
}

export function followerBandLabel(followers: number | null | undefined): string {
	const band = followerBandOf(followers);
	return band ? FOLLOWER_BANDS[band].label : "Under 1K";
}
