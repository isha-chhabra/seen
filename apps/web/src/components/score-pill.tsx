import { cn } from "@workspace/ui/lib/utils";

/** 0-100 fit score. Pink = solid target, muted = weak. */
export function ScorePill({ score, className }: { score: number; className?: string }) {
	const s = Math.max(0, Math.min(100, Math.round(score)));
	const tone =
		s >= 80
			? "border-primary/30 bg-primary/10 text-primary"
			: s >= 55
				? "border-highlight-border bg-highlight text-highlight-foreground"
				: "border-border bg-muted text-muted-foreground";
	return (
		<span
			className={cn(
				"inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold tabular-nums",
				tone,
				className,
			)}
			title={`Fit score ${s} of 100`}
		>
			{s}
		</span>
	);
}
