/**
 * Small pieces shared by the Influencer Finder screens: platform icons, the
 * verdict badge, the fit bar, and the filter-menu trigger.
 */
import { IconBrandInstagram, IconBrandTiktok, IconChevronDown } from "@tabler/icons-react";
import type { InfluencerResult, Platform, Verdict } from "@workspace/lib/influencer-finder/types";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";

export const PLATFORM_LABEL: Record<Platform, string> = { instagram: "Instagram", tiktok: "TikTok" };

export function PlatformIcon({ platform, className }: { platform: Platform; className?: string }) {
	const Icon = platform === "instagram" ? IconBrandInstagram : IconBrandTiktok;
	return <Icon aria-label={PLATFORM_LABEL[platform]} className={cn("size-4", className)} />;
}

const VERDICT_STYLE: Record<Verdict, { label: string; className: string }> = {
	include: {
		label: "Match",
		className:
			"bg-[color-mix(in_oklch,var(--chart-1)_18%,transparent)] text-[var(--chart-1)] border-[color-mix(in_oklch,var(--chart-1)_40%,transparent)]",
	},
	maybe: {
		label: "Maybe",
		className:
			"bg-[color-mix(in_oklch,var(--chart-2)_18%,transparent)] text-[var(--chart-2)] border-[color-mix(in_oklch,var(--chart-2)_40%,transparent)]",
	},
	exclude: { label: "Excluded", className: "bg-muted text-muted-foreground border-border" },
};

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
	const v = VERDICT_STYLE[verdict];
	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full border px-2 py-0.5 font-medium text-[11px]",
				v.className,
				className,
			)}
		>
			{v.label}
		</span>
	);
}

export const EXCLUDED_LABEL: Record<NonNullable<InfluencerResult["excludedBecause"]>, string> = {
	competitor: "Competitor",
	competitor_partner: "Promotes a competitor",
	not_a_creator: "Not an individual creator",
	outside_market: "Outside the brand's market",
	low_fit: "Low fit",
};

/** Score out of 100 as a bar that shifts from muted to the brand gradient as it rises. */
export function FitBar({ score, className }: { score: number; className?: string }) {
	const clamped = Math.max(0, Math.min(100, score));
	return (
		<div className={cn("flex items-center gap-2", className)}>
			<span className="w-7 text-right font-semibold text-sm tabular-nums">{Math.round(clamped)}</span>
			<div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" role="presentation">
				<div
					className={cn(
						"h-full rounded-full transition-[width] duration-500",
						clamped >= 70 ? "bg-gradient-to-r from-primary to-primary-gradient-to" : "bg-muted-foreground/50",
					)}
					style={{ width: `${clamped}%` }}
				/>
			</div>
		</div>
	);
}

/** Same look as Article Finder's filter buttons: outline, chevron, highlighted when a filter is on. */
export function FilterTrigger({
	label,
	active,
	badgeCount,
	icon,
	className,
	...props
}: { label: string; active?: boolean; badgeCount?: number; icon?: ReactNode } & ComponentProps<typeof Button>) {
	return (
		<Button
			variant="outline"
			size="sm"
			{...props}
			className={cn("h-8 gap-1.5 font-normal", active && "border-foreground/30 bg-accent/50", className)}
		>
			{icon && <span className="flex items-center text-muted-foreground">{icon}</span>}
			<span className="text-foreground">{label}</span>
			{badgeCount !== undefined && badgeCount > 0 && (
				<span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-medium text-[10px] text-primary-foreground">
					{badgeCount}
				</span>
			)}
			<IconChevronDown className="size-3.5 text-muted-foreground" />
		</Button>
	);
}
