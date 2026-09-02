import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

interface StatCardProps {
	label: ReactNode;
	value: ReactNode;
	/** e.g. "+9 pts" — colored by `trend`. */
	delta?: ReactNode;
	trend?: "up" | "down" | "flat";
	hint?: ReactNode;
	className?: string;
}

/** Compact metric tile: label, big tabular number, optional delta + hint. */
export function StatCard({ label, value, delta, trend = "flat", hint, className }: StatCardProps) {
	return (
		<div className={cn("rounded-xl border bg-card p-4", className)}>
			<div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
			<div className="mt-2 flex items-baseline gap-2">
				<span className="text-2xl font-semibold tabular-nums">{value}</span>
				{delta != null && (
					<span
						className={cn(
							"text-xs font-medium tabular-nums",
							trend === "up" && "text-emerald-600 dark:text-emerald-400",
							trend === "down" && "text-destructive",
							trend === "flat" && "text-muted-foreground",
						)}
					>
						{delta}
					</span>
				)}
			</div>
			{hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
		</div>
	);
}
