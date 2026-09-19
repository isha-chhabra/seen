/**
 * Server functions for the signed-in user's own profile page.
 *
 * Name and avatar colour are edited client-side through better-auth's
 * updateUser (which also refreshes the session cookie), so this module only
 * holds what better-auth can't do: read the page's data in one call, and
 * delete the account behind the safeguards the page promises.
 */
import { createServerFn } from "@tanstack/react-start";
import { isOrgAdminRole, ORG_ADMIN_ROLES } from "@workspace/config/roles";
import { db } from "@workspace/lib/db/db";
import { account, brandArticleSearches, brands, member, promptRuns, user } from "@workspace/lib/db/schema";
import { and, count, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireBrandOrganization } from "@/lib/auth/helpers";
import { DELETE_CONFIRM_PHRASE } from "@/lib/delete-account";

const ACTIVITY_LIMIT = 3;
const ACTIVITY_WINDOW = sql`now() - interval '30 days'`;

export type ActivityItem = {
	kind: "prompt-run" | "article-search";
	/** ISO timestamp. */
	at: string;
	title: string;
	detail: string | null;
};

export type ProfileData = {
	name: string;
	email: string;
	avatarColor: string | null;
	role: string;
	/** ISO timestamp of when the user joined this workspace. */
	memberSince: string;
	signInMethods: string[];
	activity: ActivityItem[];
};

const SIGN_IN_LABELS: Record<string, string> = {
	credential: "Email and password",
	google: "Google",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The last few things done in this workspace: prompt runs and Article Finder searches, newest first. */
async function recentActivity(organizationId: string): Promise<ActivityItem[]> {
	const brandIds = (
		await db.select({ id: brands.id }).from(brands).where(eq(brands.organizationId, organizationId))
	).map((b) => b.id);
	if (brandIds.length === 0) return [];

	// Runs are stored one row per prompt and model, so group them by hour to read as "ran N prompts".
	const hour = sql`date_trunc('hour', ${promptRuns.createdAt})`;
	const [runBatches, searches] = await Promise.all([
		db
			.select({
				at: sql<string | Date>`${hour}`,
				prompts: sql<number>`count(distinct ${promptRuns.promptId})::int`,
				models: sql<number>`count(distinct ${promptRuns.model})::int`,
			})
			.from(promptRuns)
			.where(and(inArray(promptRuns.brandId, brandIds), gte(promptRuns.createdAt, ACTIVITY_WINDOW)))
			.groupBy(hour)
			.orderBy(desc(hour))
			.limit(ACTIVITY_LIMIT),
		db
			.select({
				at: brandArticleSearches.createdAt,
				by: brandArticleSearches.createdBy,
				direction: brandArticleSearches.direction,
			})
			.from(brandArticleSearches)
			.where(and(inArray(brandArticleSearches.brandId, brandIds), eq(brandArticleSearches.status, "done")))
			.orderBy(desc(brandArticleSearches.createdAt))
			.limit(ACTIVITY_LIMIT),
	]);

	const items: ActivityItem[] = [
		...runBatches.map(
			(r): ActivityItem => ({
				kind: "prompt-run",
				at: new Date(r.at).toISOString(),
				title: `Ran ${plural(r.prompts, "prompt", "prompts")}`,
				detail: `across ${plural(r.models, "model", "models")}`,
			}),
		),
		...searches.map(
			(s): ActivityItem => ({
				kind: "article-search",
				at: new Date(s.at).toISOString(),
				title: "Ran an Article Finder search",
				detail: s.direction ? `${s.direction} · by ${s.by}` : `by ${s.by}`,
			}),
		),
	];
	return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, ACTIVITY_LIMIT);
}

export const getMyProfileFn = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }): Promise<ProfileData> => {
		const session = await requireAuthSession();
		const org = await requireBrandOrganization(session.user.id, data.brandId);

		const [[me], [membership], accounts, activity] = await Promise.all([
			db
				.select({ name: user.name, email: user.email, avatarColor: user.avatarColor })
				.from(user)
				.where(eq(user.id, session.user.id))
				.limit(1),
			db
				.select({ createdAt: member.createdAt })
				.from(member)
				.where(and(eq(member.userId, session.user.id), eq(member.organizationId, org.id)))
				.limit(1),
			db.select({ providerId: account.providerId }).from(account).where(eq(account.userId, session.user.id)),
			recentActivity(org.id),
		]);
		if (!me || !membership) throw new Error("Forbidden: No access to this brand");

		return {
			name: me.name,
			email: me.email,
			avatarColor: me.avatarColor,
			role: org.role,
			memberSince: membership.createdAt.toISOString(),
			signInMethods: accounts.map((a) => SIGN_IN_LABELS[a.providerId] ?? a.providerId),
			activity,
		};
	});

export const deleteMyAccountFn = createServerFn({ method: "POST" })
	.validator(z.object({ confirm: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		if (data.confirm.trim().toLowerCase() !== DELETE_CONFIRM_PHRASE) {
			throw new Error(`Type "${DELETE_CONFIRM_PHRASE}" to confirm.`);
		}

		const memberships = await db
			.select({ organizationId: member.organizationId, role: member.role })
			.from(member)
			.where(eq(member.userId, session.user.id));

		// Viewer accounts (including the shared demo login) are managed by an admin, never self-deleted.
		if (memberships.some((m) => m.role === "viewer")) {
			throw new Error("This account can't be deleted here.");
		}

		// A workspace must keep at least one admin, or nobody could manage the team afterwards.
		for (const m of memberships.filter((row) => isOrgAdminRole(row.role))) {
			const [others] = await db
				.select({ n: count() })
				.from(member)
				.where(
					and(
						eq(member.organizationId, m.organizationId),
						inArray(member.role, [...ORG_ADMIN_ROLES]),
						ne(member.userId, session.user.id),
					),
				);
			if (!others || others.n === 0) {
				throw new Error("You're the only admin. Make someone else an admin on the Team page first.");
			}
		}

		// Sessions, sign-in accounts, memberships and sent invitations cascade from the user row.
		await db.delete(user).where(eq(user.id, session.user.id));
		return { deleted: true as const };
	});
