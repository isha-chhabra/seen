/**
 * Reads Bright Data's raw scraper records into the small shapes the engine
 * works with. Everything is optional-chained on purpose: these are third-party
 * responses, and a missing field should mean "unknown", not a crash.
 */
import type { DatasetRecord } from "./datasets";

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export function domainOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
}

export interface IgPostRec {
	url: string;
	handle: string;
	followers: number | null;
	postsCount: number | null;
	likes: number | null;
	comments: number | null;
	date: string | null;
	kind: string | null;
	caption: string;
	hashtags: string[];
	coauthors: string[];
	tagged: string[];
	partnershipLabel: boolean;
}

export function readIgPost(r: DatasetRecord): IgPostRec | null {
	const handle = str(r.user_posted);
	if (!handle) return null;
	const partnership = r.partnership_details;
	return {
		url: str(r.url),
		handle,
		followers: num(r.followers),
		postsCount: num(r.posts_count),
		likes: num(r.likes),
		comments: num(r.num_comments),
		date: str(r.date_posted) || null,
		kind: str(r.product_type) || null,
		caption: str(r.description),
		hashtags: arr(r.hashtags).map(str).filter(Boolean),
		coauthors: arr(r.coauthor_producers).map(str).filter(Boolean),
		tagged: arr(r.tagged_users)
			.map((t) => str(obj(t).username))
			.filter(Boolean),
		partnershipLabel:
			!!partnership && (typeof partnership !== "object" || Object.keys(partnership as object).length > 0),
	};
}

export interface IgProfilePost {
	date: string | null;
	kind: string | null;
	caption: string;
	url: string | null;
	hashtags: string[];
}

export interface IgProfileRec {
	handle: string;
	name: string | null;
	followers: number | null;
	postsCount: number | null;
	bio: string;
	links: string[];
	hasEmail: boolean;
	isPrivate: boolean;
	isVerified: boolean;
	posts: IgProfilePost[];
}

export function readIgProfile(r: DatasetRecord): IgProfileRec | null {
	const handle = str(r.account);
	if (!handle) return null;
	return {
		handle,
		name: str(r.full_name) || str(r.profile_name) || null,
		followers: num(r.followers),
		postsCount: num(r.posts_count),
		bio: str(r.biography),
		links: [
			...new Set(
				arr(r.external_urls)
					.map((u) => domainOf(str(obj(u).url)))
					.filter(Boolean),
			),
		],
		hasEmail: !!str(r.email_address),
		isPrivate: r.is_private === true,
		isVerified: r.is_verified === true,
		posts: arr(r.posts).map((p) => {
			const o = obj(p);
			return {
				date: str(o.datetime) || null,
				kind: str(o.content_type) || null,
				caption: str(o.caption),
				url: str(o.url) || null,
				hashtags: arr(o.post_hashtags).map(str).filter(Boolean),
			};
		}),
	};
}

export interface TtProfileRec {
	handle: string;
	name: string | null;
	followers: number | null;
	videosCount: number | null;
	bio: string;
	category: string | null;
	isVerified: boolean;
	isPrivate: boolean;
	/** Percent, as reported by the scraper (it returns a fraction or a percent depending on the account). */
	engagementPct: number | null;
	/** Bright Data returns the account's top videos, not its latest, so these say nothing about recent activity. */
	topVideos: { date: string | null; description: string; plays: number | null }[];
}

export function readTtProfile(r: DatasetRecord): TtProfileRec | null {
	const handle = str(r.account_id);
	if (!handle) return null;
	const rate = num(r.awg_engagement_rate);
	return {
		handle,
		name: str(r.nickname) || null,
		followers: num(r.followers),
		videosCount: num(r.videos_count),
		bio: str(r.biography) || str(r.signature),
		category: str(r.category) || null,
		isVerified: r.is_verified === true,
		isPrivate: r.is_private === true,
		engagementPct: rate === null ? null : Math.round((rate < 1 ? rate * 100 : rate) * 100) / 100,
		topVideos: arr(r.top_videos)
			.slice(0, 8)
			.map((v) => {
				const o = obj(v);
				return {
					date: str(o.create_date) || null,
					description: str(o.description) || str(o.title),
					plays: num(o.playcount),
				};
			}),
	};
}
