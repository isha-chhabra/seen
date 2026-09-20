/**
 * Shared date-range picker with quick presets — used everywhere a date
 * range gets picked (Article Finder, Reports) instead of each page
 * reimplementing its own Popover + Calendar. Built on the app's existing
 * Calendar/Popover/Button (no new dependency — a boilerplate snippet
 * offered elsewhere pulled in @radix-ui/react-select and a parallel
 * Button/Card/Select set that would have duplicated and conflicted with
 * these).
 */
import { IconCalendar } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { Calendar } from "@workspace/ui/components/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";
import type { DateRange } from "react-day-picker";

function addDays(d: Date, n: number): Date {
	const r = new Date(d);
	r.setDate(r.getDate() + n);
	return r;
}
function startOfMonth(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function startOfQuarter(d: Date): Date {
	return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
}
function endOfQuarter(d: Date): Date {
	return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3 + 3, 0);
}
function startOfYear(d: Date): Date {
	return new Date(d.getFullYear(), 0, 1);
}
function endOfYear(d: Date): Date {
	return new Date(d.getFullYear(), 11, 31);
}

function buildPresets(today: Date): { label: string; range: DateRange }[] {
	const lastMonthDay = addDays(startOfMonth(today), -1);
	const lastQuarterDay = addDays(startOfQuarter(today), -1);
	const lastYearDay = addDays(startOfYear(today), -1);
	return [
		{ label: "Today", range: { from: today, to: today } },
		{ label: "Yesterday", range: { from: addDays(today, -1), to: addDays(today, -1) } },
		{ label: "Last 7 Days", range: { from: addDays(today, -6), to: today } },
		{ label: "Last 14 Days", range: { from: addDays(today, -13), to: today } },
		{ label: "Last 30 Days", range: { from: addDays(today, -29), to: today } },
		{ label: "Last 90 Days", range: { from: addDays(today, -89), to: today } },
		{ label: "Month to Date", range: { from: startOfMonth(today), to: today } },
		{ label: "Quarter to Date", range: { from: startOfQuarter(today), to: today } },
		{ label: "Year to Date", range: { from: startOfYear(today), to: today } },
		{ label: "Last Month", range: { from: startOfMonth(lastMonthDay), to: endOfMonth(lastMonthDay) } },
		{ label: "Last Quarter", range: { from: startOfQuarter(lastQuarterDay), to: endOfQuarter(lastQuarterDay) } },
		{ label: "Last Year", range: { from: startOfYear(lastYearDay), to: endOfYear(lastYearDay) } },
	];
}

/** Always shows the year on the end date (and on both ends when the range
 *  crosses a year boundary), so "which year" is never ambiguous. */
function formatRange(value?: DateRange): string {
	if (!value?.from) return "Pick a range";
	const to = value.to ?? value.from;
	const sameYear = value.from.getFullYear() === to.getFullYear();
	const from = value.from.toLocaleDateString(
		"en-US",
		sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" },
	);
	const toStr = to.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
	return `${from} – ${toStr}`;
}

export function DateRangePicker({
	value,
	onChange,
	disabled,
	className,
}: {
	value?: DateRange;
	onChange: (r?: DateRange) => void;
	disabled?: boolean;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const presets = buildPresets(new Date());

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<Button variant="outline" size="sm" disabled={disabled} className={cn("gap-1.5 font-normal", className)} />
				}
			>
				<IconCalendar className="size-3.5" />
				{formatRange(value)}
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="start">
				<div className="flex">
					<div className="flex w-40 flex-col gap-0.5 border-r p-2">
						{presets.map((p) => (
							<button
								key={p.label}
								type="button"
								onClick={() => {
									onChange(p.range);
									setOpen(false);
								}}
								className="rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								{p.label}
							</button>
						))}
					</div>
					<Calendar mode="range" numberOfMonths={2} selected={value} onSelect={onChange} defaultMonth={value?.from} />
				</div>
			</PopoverContent>
		</Popover>
	);
}
