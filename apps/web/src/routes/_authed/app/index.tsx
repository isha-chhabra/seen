/**
 * /app - Brand switcher page
 *
 * Lists every brand the user's organization(s) own. Most modes have exactly
 * one org, but whitelabel users can belong to several Auth0-synced orgs, so
 * this is a brand list scoped across all of the user's orgs, not a 1:1 org
 * list.
 */

import { IconArrowRight, IconPlus } from "@tabler/icons-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import { syncAuth0UserById } from "@workspace/whitelabel/auth-hooks";
import { inArray } from "drizzle-orm";
import type { ReactNode } from "react";
import { Logo } from "@/components/logo";
import { SiteIcon } from "@/components/site-icon";
import { listUserOrganizations, requireAuthSession } from "@/lib/auth/helpers";
import { getDeployment } from "@/lib/config/server";
import { buildTitle, getAppName } from "@/lib/route-head";

function Shell({ children }: { children: ReactNode }) {
	return (
		<div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-background px-6 py-12">
			<div
				aria-hidden
				className="pointer-events-none absolute left-1/2 top-[-10%] h-[440px] w-[760px] -translate-x-1/2 rounded-full bg-primary/8 blur-[130px] dark:bg-primary/15"
			/>
			<div className="relative w-full max-w-2xl">
				<div className="mb-8 flex flex-col items-center text-center">
					<Logo />
					<h1 className="mt-6 text-2xl font-semibold tracking-tight">Your brands</h1>
					<p className="mt-1 text-sm text-muted-foreground">Pick a brand to open its dashboard.</p>
				</div>
				{children}
			</div>
		</div>
	);
}

const tile =
	"group flex items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-[0_1px_2px_oklch(0_0_0/0.04),0_6px_16px_-6px_oklch(0_0_0/0.06)] transition-colors hover:border-primary/40 hover:bg-highlight/40";

const getBrandSwitcherData = createServerFn({ method: "GET" }).handler(
	async (): Promise<{
		brands: { id: string; name: string; website: string }[];
		unprovisionedOrgs: { id: string; name: string }[];
		canCreateBrands: boolean;
	}> => {
		const session = await requireAuthSession();
		const deployment = getDeployment();

		if (deployment.mode === "whitelabel") {
			// Keep /app usable during Auth0 Management API incidents; background sync will reconcile memberships later.
			try {
				await syncAuth0UserById(session.user.id);
			} catch (error) {
				console.error("[auth0-sync] Failed to sync user on /app load; continuing with cached memberships", error);
			}
		}

		const orgs = await listUserOrganizations(session.user.id);
		const orgIds = orgs.map((o) => o.id);

		const scopedBrands =
			orgIds.length === 0
				? []
				: await db
						.select({
							id: brands.id,
							name: brands.name,
							website: brands.website,
							organizationId: brands.organizationId,
						})
						.from(brands)
						.where(inArray(brands.organizationId, orgIds));

		// An org with no brand row yet is only reachable through the legacy
		// `/app/$orgId` onboarding wizard. Modes that can create brands from the
		// UI use that flow instead, so surfacing the org there would offer two
		// paths to the same thing.
		const canCreateBrands = deployment.features.canCreateBrands;
		const provisioned = new Set(scopedBrands.map((b) => b.organizationId));

		return {
			// Alphabetical, with the id breaking ties between brands that share a
			// name: an unordered select leaves the order up to Postgres, which is
			// free to hand back a different one after any row rewrite or plan
			// change. Sorted here rather than in SQL so the result doesn't depend
			// on the deployment's database collation.
			brands: scopedBrands
				.map((brand) => ({ id: brand.id, name: brand.name, website: brand.website }))
				.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
			unprovisionedOrgs: canCreateBrands ? [] : orgs.filter((o) => !provisioned.has(o.id)),
			canCreateBrands,
		};
	},
);

function OrgSwitcherSkeleton() {
	return (
		<Shell>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
				{[0, 1, 2, 3].map((i) => (
					<Skeleton key={i} className="h-[68px] w-full rounded-xl" />
				))}
			</div>
		</Shell>
	);
}

export const Route = createFileRoute("/_authed/app/")({
	pendingComponent: OrgSwitcherSkeleton,
	loader: async (): Promise<{
		brands: { id: string; name: string; website: string }[];
		unprovisionedOrgs: { id: string; name: string }[];
		canCreateBrands: boolean;
	}> => {
		return getBrandSwitcherData();
	},
	head: ({ match }) => {
		const appName = getAppName(match);
		return {
			meta: [
				{ title: buildTitle("Brand Switcher", { appName }) },
				{ name: "description", content: "Select a brand to get started." },
			],
		};
	},
	component: BrandSwitcherPage,
});

function hostname(website: string): string {
	try {
		return new URL(website.startsWith("http") ? website : `https://${website}`).hostname.replace(/^www\./, "");
	} catch {
		return website;
	}
}

function BrandSwitcherPage() {
	const { brands: brandList, unprovisionedOrgs, canCreateBrands } = Route.useLoaderData();
	const isEmpty = brandList.length === 0 && unprovisionedOrgs.length === 0 && !canCreateBrands;

	return (
		<Shell>
			{isEmpty ? (
				<p className="rounded-xl border border-dashed bg-muted/30 px-6 py-14 text-center text-sm text-muted-foreground">
					No brands are available on this account yet.
				</p>
			) : (
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					{brandList.map((brand) => (
						<Link key={brand.id} to="/app/$brand" params={{ brand: brand.id }} className={tile}>
							<SiteIcon domain={brand.website} size="lg" className="shrink-0" />
							<span className="min-w-0 flex-1">
								<span className="block truncate text-sm font-semibold">{brand.name}</span>
								<span className="block truncate text-xs text-muted-foreground">{hostname(brand.website)}</span>
							</span>
							<IconArrowRight className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
						</Link>
					))}
					{unprovisionedOrgs.map((org) => (
						<Link key={org.id} to="/app/$brand" params={{ brand: org.id }} className={tile}>
							<span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-highlight text-highlight-foreground">
								<IconPlus className="size-4" />
							</span>
							<span className="min-w-0 flex-1 truncate text-sm font-medium">Set up {org.name}</span>
							<IconArrowRight className="size-4 shrink-0 text-muted-foreground/50 group-hover:text-primary" />
						</Link>
					))}
					{canCreateBrands && (
						<Link
							to="/app/new"
							className={cn(
								tile,
								"border-dashed bg-transparent text-muted-foreground shadow-none hover:text-primary",
							)}
						>
							<span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-dashed">
								<IconPlus className="size-4" />
							</span>
							<span className="flex-1 text-sm font-medium">New brand</span>
						</Link>
					)}
				</div>
			)}
		</Shell>
	);
}
