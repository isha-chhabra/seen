/**
 * Step 2 of Influencer Finder: the editable plan, and the spending limit. The
 * search only starts from here, and it can never spend past the limit chosen.
 */
import { IconLoader2, IconSearch } from "@tabler/icons-react";
import { estimateSearchCost } from "@workspace/lib/influencer-finder/cost";
import type { InfluencerBrief, Platform } from "@workspace/lib/influencer-finder/types";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { TagInput } from "@/components/tag-input";
import { PLATFORM_LABEL } from "./parts";

export const CAP_OPTIONS = [0.1, 0.2, 0.35, 0.5] as const;
export const TARGET_OPTIONS = [20, 30, 50] as const;

function Field({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
	return (
		<div className="space-y-1.5">
			<div>
				<span className="font-medium text-sm">{title}</span>
				<p className="text-muted-foreground text-xs">{help}</p>
			</div>
			{children}
		</div>
	);
}

function Segmented<T extends number>({
	value,
	options,
	format,
	onChange,
	disabled,
	label,
}: {
	value: T;
	options: readonly T[];
	format: (v: T) => string;
	onChange: (v: T) => void;
	disabled?: boolean;
	label: string;
}) {
	return (
		<fieldset className="inline-flex overflow-hidden rounded-md border">
			<legend className="sr-only">{label}</legend>
			{options.map((o) => (
				<button
					key={o}
					type="button"
					aria-pressed={value === o}
					disabled={disabled}
					onClick={() => onChange(o)}
					className={cn(
						"h-8 px-3.5 text-sm tabular-nums transition-colors disabled:opacity-60",
						value === o ? "bg-primary text-primary-foreground" : "hover:bg-accent",
					)}
				>
					{format(o)}
				</button>
			))}
		</fieldset>
	);
}

export function BriefReview({
	brief,
	onBrief,
	capUsd,
	onCap,
	target,
	onTarget,
	locked,
	canRun,
	hasResults,
	error,
	onRegenerate,
	onBack,
	onRun,
	running,
}: {
	brief: InfluencerBrief;
	onBrief: (b: InfluencerBrief) => void;
	capUsd: number;
	onCap: (v: number) => void;
	target: number;
	onTarget: (v: number) => void;
	locked: boolean;
	canRun: boolean;
	hasResults: boolean;
	error: string | null;
	onRegenerate: () => void;
	onBack: () => void;
	onRun: () => void;
	running: boolean;
}) {
	const est = estimateSearchCost(target);
	const setQueries = (p: Platform, list: string[]) => onBrief({ ...brief, queries: { ...brief.queries, [p]: list } });
	return (
		<div className="max-w-2xl space-y-6">
			<div className="flex items-center justify-between">
				<span className="font-medium text-sm">Review the plan</span>
				<div className="flex gap-4 text-muted-foreground text-xs">
					<button
						type="button"
						onClick={onRegenerate}
						disabled={locked}
						className="transition-colors hover:text-foreground"
					>
						Regenerate
					</button>
					<button type="button" onClick={onBack} disabled={locked} className="transition-colors hover:text-foreground">
						{hasResults ? "Back to results" : "Edit brief"}
					</button>
				</div>
			</div>

			{brief.platforms.map((p) => (
				<Field
					key={p}
					title={`${PLATFORM_LABEL[p]} search phrases`}
					help="Plain words people use to describe this kind of creator. One phrase per tag."
				>
					<TagInput
						values={brief.queries[p]}
						onChange={(v) => setQueries(p, v)}
						disabled={locked}
						max={12}
						placeholder="Add a phrase, press Enter…"
					/>
				</Field>
			))}

			<Field
				title="Competitors to keep out"
				help="Their own accounts, and anyone who promotes them, are excluded. Your tracked competitors are already here."
			>
				<TagInput
					values={brief.competitors}
					onChange={(v) => onBrief({ ...brief, competitors: v })}
					disabled={locked}
					max={40}
					placeholder="Add a competitor name or handle…"
				/>
			</Field>

			<Field
				title="What a good fit looks like"
				help="Signals we look for in a bio or a post. Add or remove to steer the judging."
			>
				<TagInput
					values={brief.fitSignals}
					onChange={(v) => onBrief({ ...brief, fitSignals: v })}
					disabled={locked}
					max={20}
					placeholder="Add a signal, e.g. posts recipes weekly…"
				/>
			</Field>

			<div className="space-y-4 rounded-xl border bg-card/60 p-4 backdrop-blur-sm">
				<div className="flex flex-wrap items-center gap-x-8 gap-y-3">
					<div className="space-y-1.5">
						<span className="font-medium text-sm">Creators to find</span>
						<div>
							<Segmented
								label="Creators to find"
								value={target}
								options={TARGET_OPTIONS}
								format={(v) => `${v}`}
								onChange={onTarget}
								disabled={locked}
							/>
						</div>
					</div>
					<div className="space-y-1.5">
						<span className="font-medium text-sm">Spending limit</span>
						<div>
							<Segmented
								label="Spending limit"
								value={capUsd as (typeof CAP_OPTIONS)[number]}
								options={CAP_OPTIONS}
								format={(v) => `$${v.toFixed(2)}`}
								onChange={onCap}
								disabled={locked}
							/>
						</div>
					</div>
				</div>
				<p className="text-sm leading-relaxed">
					Expect about{" "}
					<strong className="tabular-nums">
						${est.low.toFixed(2)}–${Math.min(est.high, capUsd).toFixed(2)}
					</strong>
					. The search stops at <strong className="tabular-nums">${capUsd.toFixed(2)}</strong> and never goes past it,
					returning what it has vetted so far. Creators looked up in the last 30 days are reused for free, and we return
					fewer creators rather than pad the list.
				</p>
			</div>

			{error && <p className="text-destructive text-sm">{error}</p>}

			<Button onClick={onRun} disabled={!canRun} className="gap-2">
				{running ? <IconLoader2 className="size-4 animate-spin" /> : <IconSearch className="size-4" />}
				{running ? "Finding creators…" : `Find up to ${target} creators`}
			</Button>
		</div>
	);
}
