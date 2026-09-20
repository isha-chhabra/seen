/**
 * Step 1 of Influencer Finder: describe who you're looking for, pick platforms and
 * sizes. Says up front what happens next and what it needs from the person, so
 * nothing about the search is a surprise.
 */
import { IconBolt, IconLoader2 } from "@tabler/icons-react";
import { FOLLOWER_BANDS, type FollowerBand, type Platform } from "@workspace/lib/influencer-finder/types";
import { Button } from "@workspace/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { TagInput } from "@/components/tag-input";
import { formatCount } from "@/lib/influencer-results";
import { PLATFORM_LABEL, PlatformIcon } from "./parts";

export const BANDS = Object.keys(FOLLOWER_BANDS) as FollowerBand[];

const STEPS = [
	["Describe", "Say who to look for, in plain words."],
	["Review plan", "The brief becomes search phrases, competitors to avoid and fit signals. All of it is editable."],
	[
		"Judge results",
		"Each creator is scored on fit, engagement, collabs and competitor ties, with the evidence beside it.",
	],
] as const;

/** Where you are in the flow. The detail for each step only appears on hover or focus. */
export function StepsHint({ current }: { current: 1 | 2 | 3 }) {
	return (
		<ol className="mb-6 flex items-center gap-2 text-xs">
			{STEPS.map(([title, detail], i) => (
				<li key={title} className="flex items-center gap-2">
					{i > 0 && <span aria-hidden="true" className="h-px w-5 bg-border" />}
					<Tooltip>
						<TooltipTrigger
							render={
								<button
									type="button"
									aria-current={current === i + 1 ? "step" : undefined}
									className={cn(
										"flex cursor-default items-center gap-1.5 rounded-full py-0.5 pr-2 pl-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
										current === i + 1 ? "text-foreground" : "text-muted-foreground hover:text-foreground",
									)}
								/>
							}
						>
							<span
								className={cn(
									"flex size-5 items-center justify-center rounded-full font-semibold text-[10px]",
									current === i + 1 ? "bg-primary text-primary-foreground" : "bg-muted",
								)}
							>
								{i + 1}
							</span>
							{title}
						</TooltipTrigger>
						<TooltipContent className="max-w-xs text-left leading-relaxed">{detail}</TooltipContent>
					</Tooltip>
				</li>
			))}
		</ol>
	);
}

const SHORT: Record<FollowerBand, string> = {
	nano: "1–10K",
	micro: "10–100K",
	mid: "100–500K",
	macro: "500K–1M",
	mega: "1M+",
};

/** "10K–500K followers", or "Any size" when nothing is picked. */
export function rangeCaption(bands: FollowerBand[]): string {
	const picked = BANDS.filter((b) => bands.includes(b));
	const first = picked[0];
	const last = picked[picked.length - 1];
	if (!first || !last) return "Any size";
	const max = FOLLOWER_BANDS[last].max;
	return `${formatCount(FOLLOWER_BANDS[first].min)}${max === null ? "+" : `–${formatCount(max)}`} followers`;
}

/**
 * Follower size as one connected bar, since the sizes are steps on a single scale.
 * Click a step to start a range, click another to stretch it, click an end step to
 * trim it. The picked steps are always adjacent.
 */
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
	const lo = picked.length ? BANDS.indexOf(picked[0] as FollowerBand) : -1;
	const hi = picked.length ? BANDS.indexOf(picked[picked.length - 1] as FollowerBand) : -1;

	function click(i: number) {
		let [from, to] = [lo, hi];
		if (lo === -1) [from, to] = [i, i];
		else if (i < lo) from = i;
		else if (i > hi) to = i;
		else if (i === lo && i === hi) [from, to] = [-1, -1];
		else if (i === lo) from = i + 1;
		else if (i === hi) to = i - 1;
		else [from, to] = [i, i];
		onChange(from === -1 ? [] : BANDS.slice(from, to + 1));
	}

	return (
		<div className="space-y-1.5">
			<fieldset className="grid grid-cols-5 gap-0.5 overflow-hidden rounded-lg border bg-muted/40 p-0.5 sm:max-w-md">
				<legend className="sr-only">Follower size</legend>
				{BANDS.map((b, i) => {
					const on = i >= lo && i <= hi && lo !== -1;
					return (
						<button
							key={b}
							type="button"
							aria-pressed={on}
							disabled={disabled}
							onClick={() => click(i)}
							className={cn(
								"flex flex-col items-center rounded-md px-1 py-1.5 transition-colors disabled:opacity-50",
								on
									? "bg-primary/20 text-foreground ring-1 ring-primary/50 ring-inset"
									: "text-muted-foreground hover:bg-accent hover:text-foreground",
							)}
						>
							<span className="font-medium text-xs capitalize">{b}</span>
							<span className="text-[10px] tabular-nums opacity-70">{SHORT[b]}</span>
						</button>
					);
				})}
			</fieldset>
			<p className="text-muted-foreground text-xs tabular-nums">{rangeCaption(bands)}</p>
		</div>
	);
}

function Chip({
	on,
	disabled,
	onClick,
	children,
}: {
	on: boolean;
	disabled?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={on}
			disabled={disabled}
			onClick={onClick}
			className={cn(
				"inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors disabled:pointer-events-none disabled:opacity-50",
				on
					? "border-primary/60 bg-primary/15 text-foreground"
					: "text-muted-foreground hover:bg-accent hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

export function BriefForm({
	direction,
	onDirection,
	platforms,
	onPlatforms,
	bands,
	onBands,
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
	busy: boolean;
	canSubmit: boolean;
	error: string | null;
	onSubmit: () => void;
}) {
	const toggle = <T,>(list: T[], v: T, min = 0) =>
		list.includes(v) ? (list.length > min ? list.filter((x) => x !== v) : list) : [...list, v];
	return (
		<div className="space-y-6">
			<div className="max-w-2xl space-y-6">
				<div className="space-y-1.5">
					<span className="font-medium text-sm">What kind of creators are you looking for?</span>
					<TagInput
						values={direction}
						onChange={onDirection}
						placeholder="e.g. big & tall men's style creators, barbecue and steak cooks…"
						disabled={busy}
					/>
				</div>

				<div className="space-y-2">
					<span className="font-medium text-sm">Platforms</span>
					<div className="flex flex-wrap gap-2">
						{(["instagram", "tiktok"] as const).map((p) => (
							<Chip
								key={p}
								on={platforms.includes(p)}
								disabled={busy}
								onClick={() => onPlatforms(toggle(platforms, p, 1))}
							>
								<PlatformIcon platform={p} className="size-4" />
								{PLATFORM_LABEL[p]}
							</Chip>
						))}
						<span
							className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed px-3 text-muted-foreground/70 text-sm"
							title="Needs a free YouTube Data API key to be switched on"
						>
							YouTube · soon
						</span>
					</div>
				</div>

				<div className="space-y-2">
					<span className="font-medium text-sm">Follower size</span>
					<SizeRange bands={bands} onChange={onBands} disabled={busy} />
				</div>

				{error && <p className="text-destructive text-sm">{error}</p>}

				<Button onClick={onSubmit} disabled={!canSubmit} className="gap-2">
					{busy ? <IconLoader2 className="size-4 animate-spin" /> : <IconBolt className="size-4" />}
					{busy ? "Planning…" : "Build the plan"}
				</Button>
				<p className="-mt-3 text-muted-foreground text-xs">
					Nothing is spent yet. You'll set a spending limit on the next step.
				</p>
			</div>
		</div>
	);
}
