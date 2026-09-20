/**
 * The shared look of the finders' setup screens: one hairline-ruled list of rows
 * (label on the left, control on the right) instead of a stack of boxes, each row
 * using the control that fits its answer.
 *
 *   text     -> a borderless tag field on the row's own rule
 *   choices  -> a connected toggle bar (ToggleGroup)
 *   a scale  -> a ruler with stops (StopScale), for sizes, depth, budgets
 *   yes / no -> a switch
 *
 * Plus the 1-2-3 step marker (details on hover).
 */
import { IconCheck } from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentType, ReactNode } from "react";

/** The rows share one grid so every label and control lines up down the page. */
export function FormRows({ children }: { children: ReactNode }) {
	return <div className="divide-y divide-border/40 border-y border-border/40">{children}</div>;
}

export function FormRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
	return (
		<div className="grid gap-x-10 gap-y-2.5 py-5 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
			<div className="pt-0.5">
				<p className="font-medium text-sm">{label}</p>
				{hint && <p className="mt-0.5 text-muted-foreground text-xs leading-snug">{hint}</p>}
			</div>
			<div className="min-w-0">{children}</div>
		</div>
	);
}

// ── steps ───────────────────────────────────────────────────────────

export type Step = readonly [title: string, detail: string];

/** Where you are in the flow. The detail for each step only appears on hover or focus. */
export function FinderSteps({ steps, current }: { steps: readonly Step[]; current: number }) {
	return (
		<ol className="mb-7 flex flex-wrap items-center gap-y-2 text-xs">
			{steps.map(([title, detail], i) => {
				const n = i + 1;
				const done = n < current;
				return (
					<li key={title} className="flex items-center">
						{i > 0 && (
							<span
								aria-hidden="true"
								className={cn("mx-2 h-px w-6 sm:w-10", done || n === current ? "bg-primary/60" : "bg-border")}
							/>
						)}
						<Tooltip>
							<TooltipTrigger
								render={
									<button
										type="button"
										aria-current={n === current ? "step" : undefined}
										className={cn(
											"flex cursor-default items-center gap-2 rounded-full py-0.5 pr-2.5 pl-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
											n === current ? "text-foreground" : "text-muted-foreground hover:text-foreground",
										)}
									/>
								}
							>
								<span
									className={cn(
										"flex size-5 items-center justify-center rounded-full font-semibold text-[10px]",
										n === current
											? "bg-primary text-primary-foreground"
											: done
												? "bg-primary/20 text-primary"
												: "bg-muted",
									)}
								>
									{done ? <IconCheck className="size-3" /> : n}
								</span>
								<span className="font-medium">{title}</span>
							</TooltipTrigger>
							<TooltipContent className="max-w-xs text-left leading-relaxed">{detail}</TooltipContent>
						</Tooltip>
					</li>
				);
			})}
		</ol>
	);
}

// ── controls ────────────────────────────────────────────────────────

export interface ToggleOption<T extends string> {
	id: T;
	label: string;
	icon?: ComponentType<{ className?: string }>;
	/** Shown greyed out and not selectable, with the reason on hover. */
	unavailable?: string;
}

/** A single connected bar for a few independent choices, each with a check when on. */
export function ToggleGroup<T extends string>({
	options,
	selected,
	onToggle,
	disabled,
	label,
}: {
	options: readonly ToggleOption<T>[];
	selected: readonly T[];
	onToggle: (id: T) => void;
	disabled?: boolean;
	label: string;
}) {
	return (
		<fieldset className="inline-flex max-w-full divide-x divide-border/70 overflow-hidden rounded-lg border border-border/70">
			<legend className="sr-only">{label}</legend>
			{options.map((o) => {
				const on = selected.includes(o.id);
				const Icon = o.icon;
				const button = (
					<button
						key={o.id}
						type="button"
						aria-pressed={on}
						disabled={disabled || !!o.unavailable}
						onClick={() => onToggle(o.id)}
						className={cn(
							"flex h-9 items-center gap-2 px-3.5 text-sm outline-none transition-colors focus-visible:bg-accent disabled:cursor-not-allowed disabled:opacity-45",
							on ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
						)}
					>
						{Icon && <Icon className="size-4" />}
						{o.label}
						{on && <IconCheck className="size-3.5 text-primary" />}
					</button>
				);
				return o.unavailable ? (
					<Tooltip key={o.id}>
						<TooltipTrigger render={<span className="flex" />}>{button}</TooltipTrigger>
						<TooltipContent>{o.unavailable}</TooltipContent>
					</Tooltip>
				) : (
					button
				);
			})}
		</fieldset>
	);
}

export interface Stop {
	label: string;
	sub?: string;
}

/**
 * A ruler for answers that sit on one scale. The stops are dots on a line; the
 * chosen stretch is filled in. lo/hi are stop indexes (-1 when nothing is chosen);
 * a single choice has lo === hi.
 */
export function StopScale({
	stops,
	lo,
	hi,
	onPick,
	disabled,
	label,
}: {
	stops: readonly Stop[];
	lo: number;
	hi: number;
	onPick: (index: number) => void;
	disabled?: boolean;
	label: string;
}) {
	const n = stops.length;
	const active = lo >= 0;
	return (
		<fieldset disabled={disabled} className="min-w-0" style={{ maxWidth: `min(100%, ${n * 5.5}rem)` }}>
			<legend className="sr-only">{label}</legend>
			<div className="relative">
				<div
					aria-hidden="true"
					className="absolute top-[13px] h-0.5 rounded-full bg-border"
					style={{ left: `${50 / n}%`, right: `${50 / n}%` }}
				/>
				{active && (
					<div
						aria-hidden="true"
						className="absolute top-[13px] h-0.5 rounded-full bg-primary transition-[left,width] duration-300"
						style={{ left: `${((lo + 0.5) / n) * 100}%`, width: `${((hi - lo) / n) * 100}%` }}
					/>
				)}
				<div className="relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
					{stops.map((s, i) => {
						const inside = active && i >= lo && i <= hi;
						const end = active && (i === lo || i === hi);
						return (
							<button
								key={s.label}
								type="button"
								aria-pressed={inside}
								onClick={() => onPick(i)}
								className="group flex flex-col items-center gap-1 pb-1 outline-none disabled:opacity-50"
							>
								<span
									className={cn(
										"mt-1 size-5 rounded-full border-2 bg-background transition-[border-color,background-color,box-shadow]",
										"group-focus-visible:ring-2 group-focus-visible:ring-ring",
										inside ? "border-primary" : "border-border group-hover:border-foreground/50",
										end && "bg-primary shadow-[0_0_0_4px_color-mix(in_oklch,var(--primary)_22%,transparent)]",
									)}
								/>
								<span
									className={cn(
										"font-medium text-xs tabular-nums",
										inside ? "text-foreground" : "text-muted-foreground",
									)}
								>
									{s.label}
								</span>
								{s.sub && <span className="-mt-0.5 text-[10px] text-muted-foreground tabular-nums">{s.sub}</span>}
							</button>
						);
					})}
				</div>
			</div>
		</fieldset>
	);
}

/** Next selection when a stop is clicked on a range scale: start, stretch, trim or clear, always contiguous. */
export function nextRange(lo: number, hi: number, i: number): [number, number] {
	if (lo === -1) return [i, i];
	if (i < lo) return [i, hi];
	if (i > hi) return [lo, i];
	if (lo === hi) return [-1, -1];
	if (i === lo) return [i + 1, hi];
	if (i === hi) return [lo, i - 1];
	return [i, i];
}
