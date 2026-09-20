/**
 * Step 2 of Influencer Finder: the plan, editable, and the spending limit. The
 * search only starts from here, and it can never spend past the limit chosen.
 */
import { IconLoader2 } from "@tabler/icons-react";
import { estimateCreatorsForLimit, estimateSearchCost } from "@workspace/lib/influencer-finder/cost";
import type { InfluencerBrief, Platform } from "@workspace/lib/influencer-finder/types";
import { Button } from "@workspace/ui/components/button";
import { FormRow, FormRows, StopScale } from "@/components/finder-form";
import { TagInput } from "@/components/tag-input";
import { PLATFORM_LABEL } from "./parts";

export const CAP_OPTIONS = [0.1, 0.2, 0.35, 0.5] as const;
export const TARGET_OPTIONS = [10, 20, 30, 50] as const;

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
	const reach = estimateCreatorsForLimit(capUsd);
	const fitting = CAP_OPTIONS.find((c) => estimateCreatorsForLimit(c) >= target);
	const setQueries = (p: Platform, list: string[]) => onBrief({ ...brief, queries: { ...brief.queries, [p]: list } });
	const targetIdx = TARGET_OPTIONS.indexOf(target as (typeof TARGET_OPTIONS)[number]);
	const capIdx = CAP_OPTIONS.indexOf(capUsd as (typeof CAP_OPTIONS)[number]);
	const optional = [
		["similarTo", "Creators you like", "@handle or profile link"],
		["avoid", "Steer clear of", "e.g. giveaway pages"],
		["basedIn", "Audience location", "e.g. United States"],
	] as const;
	return (
		<div>
			<div className="mb-4 flex items-end justify-between gap-4">
				<div>
					<h2 className="font-semibold text-lg tracking-tight">Check the Plan</h2>
					<p className="text-muted-foreground text-sm">These searches run when you continue. Edit anything.</p>
				</div>
				<div className="flex shrink-0 gap-4 text-muted-foreground text-xs">
					<button
						type="button"
						onClick={onRegenerate}
						disabled={locked}
						className="transition-colors hover:text-foreground"
					>
						Redo Plan
					</button>
					<button type="button" onClick={onBack} disabled={locked} className="transition-colors hover:text-foreground">
						{hasResults ? "Back to results" : "Back"}
					</button>
				</div>
			</div>

			<FormRows>
				{brief.platforms.map((p) => (
					<FormRow key={p} label={`${PLATFORM_LABEL[p]} searches`} hint="Phrases to look up">
						<TagInput
							plain
							values={brief.queries[p]}
							onChange={(v) => setQueries(p, v)}
							disabled={locked}
							max={12}
							placeholder="Add a phrase, press Enter"
						/>
					</FormRow>
				))}
				<FormRow label="Competitors" hint="Excluded, with partners">
					<TagInput
						plain
						values={brief.competitors}
						onChange={(v) => onBrief({ ...brief, competitors: v })}
						disabled={locked}
						max={40}
						placeholder="Add a brand or handle"
					/>
				</FormRow>
				<FormRow label="Good Signs" hint="Clues in bios and posts">
					<TagInput
						plain
						values={brief.fitSignals}
						onChange={(v) => onBrief({ ...brief, fitSignals: v })}
						disabled={locked}
						max={20}
						placeholder="e.g. posts recipes weekly"
					/>
				</FormRow>
				{optional.map(([key, label, placeholder]) =>
					(brief[key]?.length ?? 0) > 0 ? (
						<FormRow key={key} label={label}>
							<TagInput
								plain
								values={brief[key] ?? []}
								onChange={(v) => onBrief({ ...brief, [key]: v })}
								disabled={locked}
								placeholder={placeholder}
							/>
						</FormRow>
					) : null,
				)}
				<FormRow label="Creators to Find">
					<StopScale
						label="Creators to Find"
						stops={TARGET_OPTIONS.map((n) => ({ label: String(n) }))}
						lo={targetIdx}
						hi={targetIdx}
						onPick={(i) => onTarget(TARGET_OPTIONS[i] ?? 30)}
						disabled={locked}
					/>
				</FormRow>
				<FormRow label="Spending Limit" hint="A hard stop">
					<div className="space-y-2">
						<StopScale
							label="Spending Limit"
							stops={CAP_OPTIONS.map((n) => ({ label: `$${n.toFixed(2)}` }))}
							lo={capIdx}
							hi={capIdx}
							onPick={(i) => onCap(CAP_OPTIONS[i] ?? 0.2)}
							disabled={locked}
						/>
						<p className="text-muted-foreground text-xs leading-relaxed">
							{target} creators usually cost{" "}
							<span className="text-foreground tabular-nums">
								${est.low.toFixed(2)}–${est.high.toFixed(2)}
							</span>
							. The search stops at the limit. Creators checked in the last 30 days cost nothing.
						</p>
						{reach < target && (
							<p className="text-amber-500 text-xs leading-relaxed">
								At ${capUsd.toFixed(2)} expect about {reach} creators, not {target}.
								{fitting && (
									<>
										{" "}
										<button
											type="button"
											onClick={() => onCap(fitting)}
											disabled={locked}
											className="underline underline-offset-2 hover:text-foreground"
										>
											Use ${fitting.toFixed(2)}
										</button>{" "}
										to reach {target}.
									</>
								)}
							</p>
						)}
					</div>
				</FormRow>
			</FormRows>

			{error && <p className="mt-5 text-destructive text-sm">{error}</p>}

			<Button onClick={onRun} disabled={!canRun} className="mt-7 gap-2">
				{running && <IconLoader2 className="size-4 animate-spin" />}
				{running ? "Finding creators…" : "Find creators"}
			</Button>
		</div>
	);
}
