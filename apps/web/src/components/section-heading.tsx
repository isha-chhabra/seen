import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";

interface SectionHeadingProps {
	children: ReactNode;
	count?: number;
	action?: ReactNode;
	className?: string;
}

/** Small uppercase label + optional count, with a right-aligned action slot. */
export function SectionHeading({ children, count, action, className }: SectionHeadingProps) {
	return (
		<div className={cn("mb-2 flex items-center justify-between gap-3", className)}>
			<h3 className="flex items-baseline gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
				{children}
				{count != null && <span className="tabular-nums font-normal text-muted-foreground/70">{count}</span>}
			</h3>
			{action}
		</div>
	);
}
