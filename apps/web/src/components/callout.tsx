import { cn } from "@workspace/ui/lib/utils";
import type { ComponentType, ReactNode } from "react";

interface CalloutProps {
	icon?: ComponentType<{ className?: string }>;
	title?: ReactNode;
	children: ReactNode;
	/** "pink" (default brand tint) or "muted" (neutral). */
	tone?: "pink" | "muted";
	className?: string;
}

/** Boxed note. Pink-tinted by default; used for the affiliate angle, cooldowns, tips. */
export function Callout({ icon: Icon, title, children, tone = "pink", className }: CalloutProps) {
	return (
		<div
			className={cn(
				"flex gap-3 rounded-xl border px-4 py-3 text-sm",
				tone === "pink"
					? "border-highlight-border bg-highlight text-highlight-foreground"
					: "border-border bg-muted/50 text-foreground",
				className,
			)}
		>
			{Icon && <Icon className="mt-0.5 size-4 shrink-0 opacity-80" />}
			<div className="min-w-0 leading-relaxed">
				{title && <span className="font-semibold">{title} </span>}
				<span className={tone === "pink" ? "text-highlight-foreground/90" : "text-muted-foreground"}>{children}</span>
			</div>
		</div>
	);
}
