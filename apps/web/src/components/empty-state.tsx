import { cn } from "@workspace/ui/lib/utils";
import type { ComponentType, ReactNode } from "react";

interface EmptyStateProps {
	icon?: ComponentType<{ className?: string }>;
	title: string;
	description?: ReactNode;
	action?: ReactNode;
	className?: string;
}

/** Calm, centered placeholder for zero-data / pre-action states. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/30 px-6 py-14 text-center",
				className,
			)}
		>
			{Icon && (
				<div className="mb-4 flex size-11 items-center justify-center rounded-full bg-highlight text-highlight-foreground">
					<Icon className="size-5" />
				</div>
			)}
			<p className="text-sm font-semibold">{title}</p>
			{description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
			{action && <div className="mt-5">{action}</div>}
		</div>
	);
}
