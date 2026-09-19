/**
 * Step 1 of Influencer Finder: describe who you're looking for, pick platforms and
 * sizes. Says up front what happens next and what it needs from the person, so
 * nothing about the search is a surprise.
 */
import { IconBolt, IconLoader2 } from "@tabler/icons-react";
import { FOLLOWER_BANDS, type FollowerBand, type Platform } from "@workspace/lib/influencer-finder/types";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { TagInput } from "@/components/tag-input";
import { PLATFORM_LABEL, PlatformIcon } from "./parts";

const BANDS = Object.keys(FOLLOWER_BANDS) as FollowerBand[];

const STEPS = [
	["You describe", "Who you want, in your own words."],
	["You review the plan", "We turn it into search phrases, competitors to avoid and fit signals. Edit anything."],
	[
		"We search, you judge",
		"Every creator is checked for fit, engagement, collabs and competitors. You see the evidence.",
	],
] as const;

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
			<ol className="grid gap-3 sm:grid-cols-3">
				{STEPS.map(([title, body], i) => (
					<li key={title} className="rounded-xl border bg-card/60 p-4 backdrop-blur-sm">
						<span className="flex size-6 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary text-xs">
							{i + 1}
						</span>
						<p className="mt-2.5 font-medium text-sm">{title}</p>
						<p className="mt-0.5 text-muted-foreground text-xs leading-relaxed">{body}</p>
					</li>
				))}
			</ol>

			<div className="max-w-2xl space-y-6">
				<div className="space-y-1.5">
					<span className="font-medium text-sm">What kind of creators are you looking for?</span>
					<TagInput
						values={direction}
						onChange={onDirection}
						placeholder="e.g. big & tall men's style creators, barbecue and steak cooks…"
						disabled={busy}
					/>
					<p className="text-muted-foreground text-xs">
						Describe the niche and who they speak to. We judge bios and recent posts, so specific beats broad.
					</p>
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
					<p className="text-muted-foreground text-xs">
						Instagram gives the fullest picture: engagement and posting rhythm. TikTok activity can't be measured yet,
						so those creators show a dash there.
					</p>
				</div>

				<div className="space-y-2">
					<span className="font-medium text-sm">Follower size</span>
					<div className="flex flex-wrap gap-2">
						{BANDS.map((b) => (
							<Chip key={b} on={bands.includes(b)} disabled={busy} onClick={() => onBands(toggle(bands, b))}>
								{FOLLOWER_BANDS[b].label}
							</Chip>
						))}
					</div>
					<p className="text-muted-foreground text-xs">
						Leave all off to allow any size. Picking sizes also saves money, since creators outside them are never
						looked up.
					</p>
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
