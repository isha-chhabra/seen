/**
 * /app/$brand/settings/brand - Brand settings page
 *
 * Form to edit brand name, website, additional domains, and aliases, plus a
 * danger zone to permanently remove the brand.
 */

import { IconInfoCircle, IconTrash } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { TagsInput } from "@workspace/ui/components/tags-input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { useCallback, useState } from "react";
import { brandKeys, useBrand } from "@/hooks/use-brands";
import { citationKeys } from "@/hooks/use-citations";
import { dashboardKeys } from "@/hooks/use-dashboard-summary";
import { cleanAndValidateDomain } from "@/lib/domain-categories";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";
import { deleteBrandFn, updateBrandFn } from "@/server/brands";

export const Route = createFileRoute("/_authed/app/$brand/settings/brand")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("Brand Settings", { appName, brandName }) },
				{ name: "description", content: "Manage your brand name and website." },
			],
		};
	},
	component: BrandSettingsPage,
});

function BrandSettingsPage() {
	const { brand, isLoading, revalidate } = useBrand();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	const [additionalDomains, setAdditionalDomains] = useState<string[]>([]);
	const [aliases, setAliases] = useState<string[]>([]);
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);

	// Reseed the fields when the brand changes server-side, without discarding
	// whatever is being typed in between.
	const [seededFrom, setSeededFrom] = useState<Date | null>(null);
	if (brand && brand.updatedAt !== seededFrom) {
		setSeededFrom(brand.updatedAt);
		setAdditionalDomains(brand.additionalDomains || []);
		setAliases(brand.aliases || []);
	}

	const validateDomain = useCallback((val: string): true | string => {
		const cleaned = cleanAndValidateDomain(val);
		if (!cleaned) return `"${val}" is not a valid domain`;
		return true;
	}, []);
	const handleAliasesChange = useCallback((values: string[]) => setAliases(values), []);

	if (isLoading) {
		return (
			<div className="max-w-2xl space-y-6">
				<h1 className="text-2xl font-semibold">Brand</h1>
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}

	if (!brand) {
		return (
			<div className="max-w-2xl space-y-6">
				<h1 className="text-2xl font-semibold">Brand</h1>
				<p className="text-destructive">Brand not found</p>
			</div>
		);
	}

	const handleSubmit = async (formData: FormData) => {
		setIsSubmitting(true);
		setError("");
		setSuccess("");

		try {
			const name = formData.get("name") as string;
			const website = formData.get("website") as string;

			await updateBrandFn({
				data: {
					brandId: brand.id,
					name,
					website,
					additionalDomains,
					aliases,
				},
			});

			// Domain/alias changes affect citation categorization and mention detection
			queryClient.invalidateQueries({ queryKey: citationKeys.all });
			queryClient.invalidateQueries({ queryKey: dashboardKeys.all });

			setSuccess("Brand details updated successfully!");
			await revalidate();
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleDelete = async () => {
		setDeleting(true);
		setError("");
		try {
			await deleteBrandFn({ data: { brandId: brand.id } });
			queryClient.invalidateQueries({ queryKey: brandKeys.all });
			navigate({ to: "/app" });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Could not delete the brand");
			setDeleting(false);
			setConfirmingDelete(false);
		}
	};

	return (
		<div className="max-w-2xl space-y-8">
			<div>
				<h1 className="text-2xl font-semibold tracking-tight">Brand</h1>
				<p className="text-sm text-muted-foreground">Manage your brand name and website</p>
			</div>

			<form action={handleSubmit} className="space-y-6">
				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="name">Brand Name</Label>
						<Input
							id="name"
							name="name"
							type="text"
							placeholder="Brand Name"
							defaultValue={brand.name}
							required
							disabled={isSubmitting}
						/>
						<p className="text-xs text-muted-foreground">Enter your brand&apos;s name</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="website">Website</Label>
						<Input
							id="website"
							name="website"
							type="text"
							placeholder="example.com"
							defaultValue={brand.website}
							required
							disabled={isSubmitting}
						/>
						<p className="text-xs text-muted-foreground">Your brand&apos;s primary website</p>
					</div>

					<div className="space-y-2">
						<Label className="flex items-center gap-1.5">
							Additional Domains
							<Tooltip>
								<TooltipTrigger render={<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />} />
								<TooltipContent className="max-w-xs text-xs font-normal">
									Other domains your brand owns (e.g. blog.example.com, shop.example.com). Citations from these domains
									will be counted as your brand&apos;s citations. <strong>Updates retroactively</strong>, existing
									citations will be reclassified immediately.
								</TooltipContent>
							</Tooltip>
						</Label>
						<TagsInput
							value={additionalDomains}
							onValueChange={setAdditionalDomains}
							placeholder="Add domain..."
							searchPlaceholder="Add domain..."
							maxItems={10}
							normalizeValue={(raw) => cleanAndValidateDomain(raw) ?? raw.trim()}
							onValidate={validateDomain}
						/>
					</div>

					<div className="space-y-2">
						<Label className="flex items-center gap-1.5">
							Brand Aliases
							<Tooltip>
								<TooltipTrigger render={<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />} />
								<TooltipContent className="max-w-xs text-xs font-normal">
									Alternative names for your brand (sub-brands, product lines, abbreviations). Used for mention detection
									in <strong>future</strong> prompt runs only, does not apply retroactively to past results.
								</TooltipContent>
							</Tooltip>
						</Label>
						<TagsInput
							value={aliases}
							onValueChange={handleAliasesChange}
							placeholder="Add alias..."
							searchPlaceholder="Add alias..."
							maxItems={10}
						/>
					</div>
				</div>

				{error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
				{success && (
					<div className="rounded-md bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">{success}</div>
				)}

				<Button type="submit" disabled={isSubmitting}>
					{isSubmitting ? "Saving..." : "Save Changes"}
				</Button>
			</form>

			<div className="rounded-xl border border-destructive/30 bg-destructive/[0.03] p-4">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="min-w-0">
						<p className="text-sm font-semibold text-destructive">Delete brand</p>
						<p className="text-xs text-muted-foreground">
							Permanently removes {brand.name} and all of its prompts, runs, citations, competitors and reports. No undo.
						</p>
					</div>
					{confirmingDelete ? (
						<div className="flex shrink-0 items-center gap-2">
							<Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
								{deleting ? "Deleting..." : `Delete ${brand.name}`}
							</Button>
							<Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)} disabled={deleting}>
								Cancel
							</Button>
						</div>
					) : (
						<Button
							variant="outline"
							size="sm"
							className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive hover:text-white"
							onClick={() => setConfirmingDelete(true)}
						>
							<IconTrash className="size-4" />
							Delete brand
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
