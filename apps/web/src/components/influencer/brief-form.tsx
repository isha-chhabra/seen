/**
 * Step 1 of Influencer Finder: who to look for. Three answers are required
 * (who, platforms, size); three optional ones sharpen the results.
 */
import { IconLoader2, IconSearch } from "@tabler/icons-react";
import { FOLLOWER_BANDS, type FollowerBand, type Platform } from "@workspace/lib/influencer-finder/types";
import { Button } from "@workspace/ui/components/button";
import { FormRow, FormRows, nextRange, type Step, StopScale, ToggleGroup } from "@/components/finder-form";
import { TagInput } from "@/components/tag-input";
import { formatCount } from "@/lib/influencer-results";
import { PLATFORM_LABEL, PlatformIcon } from "./parts";

export const INFLUENCER_STEPS: readonly Step[] = [
	["Describe", "Say who you want to reach, in a sentence."],
	["Check the plan", "See the searches before they run, and set a spending limit."],
	[
		"Review creators",
		"Each creator comes with proof: real posts, engagement, past brand deals and no competitor ties.",
	],
];

export interface Extras {
	similarTo: string[];
	avoid: string[];
	basedIn: string[];
}

export const BANDS = Object.keys(FOLLOWER_BANDS) as FollowerBand[];

const SHORT: Record<FollowerBand, string> = {
	nano: "1–10K",
	micro: "10–100K",
	mid: "100–500K",
	macro: "500K–1M",
	mega: "1M+",
};
const STOPS = BANDS.map((b) => ({ label: b[0]?.toUpperCase() + b.slice(1), sub: SHORT[b] }));

/** "10K–500K followers", or "Any size" when nothing is picked. */
export function rangeCaption(bands: FollowerBand[]): string {
	const picked = BANDS.filter((b) => bands.includes(b));
	const first = picked[0];
	const last = picked[picked.length - 1];
	if (!first || !last) return "Any size";
	const max = FOLLOWER_BANDS[last].max;
	return `${formatCount(FOLLOWER_BANDS[first].min)}${max === null ? "+" : `–${formatCount(max)}`} followers`;
}

/** Follower size as a ruler. Picked sizes are always adjacent: click to start, stretch, trim or clear. */
export function SizeRange({
	bands,
	onChange,
	disabled,
}: {
	bands: FollowerBand[];
	onChange: (v: FollowerBand[]) => void;
	disabled?: boolean;
}) {
	const picked = BANDS.filter((b) => bands.includes(b));
	const lo = picked[0] ? BANDS.indexOf(picked[0]) : -1;
	const hi = picked.length ? BANDS.indexOf(picked[picked.length - 1] as FollowerBand) : -1;
	return (
		<div className="space-y-2">
			<StopScale
				label="Audience size"
				stops={STOPS}
				lo={lo}
				hi={hi}
				disabled={disabled}
				onPick={(i) => {
					const [from, to] = nextRange(lo, hi, i);
					onChange(from === -1 ? [] : BANDS.slice(from, to + 1));
				}}
			/>
			<p className="text-muted-foreground text-xs tabular-nums">{rangeCaption(bands)}</p>
		</div>
	);
}

export function BriefForm({
	direction,
	onDirection,
	platforms,
	onPlatforms,
	bands,
	onBands,
	extras,
	onExtras,
	busy,
	canSubmit,
	error,
	onSubmit,
}: {
	direction: string[];
	onDirection: (v: string[]) => void;
	platforms: Platform[];
	onPlatforms: (v: Platform[]) => void;
	bands: FollowerBand[];
	onBands: (v: FollowerBand[]) => void;
	extras: Extras;
	onExtras: (v: Extras) => void;
	busy: boolean;
	canSubmit: boolean;
	error: string | null;
	onSubmit: () => void;
}) {
	const togglePlatform = (p: Platform) =>
		onPlatforms(
			platforms.includes(p) ? (platforms.length > 1 ? platforms.filter((x) => x !== p) : platforms) : [...platforms, p],
		);
	return (
		<div>
			<FormRows>
				<FormRow label="Who to find">
					<TagInput
						plain
						icon={<IconSearch className="size-4" />}
						values={direction}
						onChange={onDirection}
						placeholder="e.g. barbecue cooks, or style creators for big and tall men"
						disabled={busy}
					/>
				</FormRow>
				<FormRow label="Platforms">
					<ToggleGroup
						label="Platforms"
						selected={platforms}
						onToggle={togglePlatform}
						disabled={busy}
						options={[
							{
								id: "instagram",
								label: PLATFORM_LABEL.instagram,
								icon: (p) => <PlatformIcon platform="instagram" className={p.className} />,
							},
							{
								id: "tiktok",
								label: PLATFORM_LABEL.tiktok,
								icon: (p) => <PlatformIcon platform="tiktok" className={p.className} />,
							},
							{ id: "youtube" as Platform, label: "YouTube · soon", unavailable: "Coming soon" },
						]}
					/>
				</FormRow>
				<FormRow label="Audience size">
					<SizeRange bands={bands} onChange={onBands} disabled={busy} />
				</FormRow>
			</FormRows>

			<p className="mt-8 mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
				Optional · sharper results
			</p>
			<FormRows>
				<FormRow label="Creators you like" hint="Used as a style guide">
					<TagInput
						plain
						values={extras.similarTo}
						onChange={(v) => onExtras({ ...extras, similarTo: v })}
						placeholder="@handle or profile link"
						disabled={busy}
						max={5}
					/>
				</FormRow>
				<FormRow label="Steer clear of" hint="Accounts to rule out">
					<TagInput
						plain
						values={extras.avoid}
						onChange={(v) => onExtras({ ...extras, avoid: v })}
						placeholder="e.g. giveaway pages, meme accounts"
						disabled={busy}
						max={8}
					/>
				</FormRow>
				<FormRow label="Audience location">
					<TagInput
						plain
						values={extras.basedIn}
						onChange={(v) => onExtras({ ...extras, basedIn: v })}
						placeholder="e.g. United States"
						disabled={busy}
						max={3}
					/>
				</FormRow>
			</FormRows>

			{error && <p className="mt-5 text-destructive text-sm">{error}</p>}

			<div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2">
				<Button onClick={onSubmit} disabled={!canSubmit} className="gap-2">
					{busy && <IconLoader2 className="size-4 animate-spin" />}
					{busy ? "Creating plan…" : "Create search plan"}
				</Button>
			</div>
		</div>
	);
}
