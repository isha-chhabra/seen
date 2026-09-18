/**
 * Floating, brand-wide indicator for an in-flight (or just-finished) Article
 * Finder search. Lives in the brand layout, not the Article Finder route
 * itself, so it keeps showing real progress no matter which tab you're on —
 * the search runs server-side regardless of which page is mounted, this is
 * just the piece that used to forget about it the moment you navigated away.
 */
import { IconAlertTriangle, IconCircleCheck, IconX } from "@tabler/icons-react";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { Progress } from "@workspace/ui/components/progress";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useRef, useState } from "react";
import { getArticleSearchStatusFn } from "@/server/article-finder";

const POLL_MS = 4_000;
const AUTO_DISMISS_MS = 9_000;

type Status = {
	id: string;
	status: "running" | "done" | "error";
	stage: string | null;
	progressPct: number | null;
	error: string | null;
	startedAt: string;
	updatedAt: string;
} | null;

export function ArticleSearchStatusBar() {
	const params = useParams({ strict: false }) as { brand?: string };
	const brandId = params.brand;
	const { pathname } = useLocation();
	const [status, setStatus] = useState<Status>(null);
	const [dismissedId, setDismissedId] = useState<string | null>(null);
	const autoDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(() => {
		if (!brandId) return;
		let cancelled = false;
		async function poll() {
			const r = await getArticleSearchStatusFn({ data: { brandId: brandId as string } }).catch(() => null);
			if (!cancelled) setStatus(r);
		}
		poll();
		const id = setInterval(poll, POLL_MS);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [brandId]);

	// once a "done" or "error" run has been visible a while, auto-dismiss it
	useEffect(() => {
		if (!status || status.status === "running") return;
		if (status.id === dismissedId) return;
		autoDismissTimer.current = setTimeout(() => setDismissedId(status.id), AUTO_DISMISS_MS);
		return () => {
			if (autoDismissTimer.current) clearTimeout(autoDismissTimer.current);
		};
	}, [status, dismissedId]);

	const onArticleFinderPage = pathname.includes("/article-finder");
	if (!brandId || !status || status.id === dismissedId) return null;
	// the Article Finder page itself already renders this state inline once a
	// result lands, no need for a floating duplicate on top of it
	if (onArticleFinderPage && status.status !== "running") return null;

	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 sm:justify-end sm:pr-6">
			<div
				className={cn(
					"pointer-events-auto w-full max-w-sm rounded-xl border p-3 shadow-lg backdrop-blur-xl transition-all",
					"border-border/60 bg-popover/70 supports-[backdrop-filter]:bg-popover/60",
					status.status === "error" && "border-destructive/40",
				)}
			>
				{status.status === "running" && (
					<Link to={`/app/${brandId}/article-finder`} className="block space-y-2">
						<div className="flex items-center gap-2">
							<span className="relative flex size-2">
								<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
								<span className="relative inline-flex size-2 rounded-full bg-primary" />
							</span>
							<span className="font-titan-one text-[13px] tracking-wide text-foreground/90">Article Finder</span>
							<span className="ml-auto text-xs text-muted-foreground">{status.progressPct ?? 0}%</span>
						</div>
						<Progress value={status.progressPct ?? 5} className="h-1.5" />
						<p className="text-xs text-muted-foreground">{status.stage ?? "Working…"}</p>
					</Link>
				)}

				{status.status === "done" && (
					<div className="flex items-start gap-2.5">
						<IconCircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium">Article search finished</p>
							<Link
								to={`/app/${brandId}/article-finder`}
								className="text-xs text-primary hover:underline"
								onClick={() => setDismissedId(status.id)}
							>
								View results
							</Link>
						</div>
						<button
							type="button"
							onClick={() => setDismissedId(status.id)}
							aria-label="Dismiss"
							className="shrink-0 text-muted-foreground/60 hover:text-foreground"
						>
							<IconX className="size-3.5" />
						</button>
					</div>
				)}

				{status.status === "error" && (
					<div className="flex items-start gap-2.5">
						<IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium">Article search failed</p>
							<Link
								to={`/app/${brandId}/article-finder`}
								className="text-xs text-primary hover:underline"
								onClick={() => setDismissedId(status.id)}
							>
								Try again
							</Link>
						</div>
						<button
							type="button"
							onClick={() => setDismissedId(status.id)}
							aria-label="Dismiss"
							className="shrink-0 text-muted-foreground/60 hover:text-foreground"
						>
							<IconX className="size-3.5" />
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
