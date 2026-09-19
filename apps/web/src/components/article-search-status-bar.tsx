/**
 * Floating, brand-wide card for an Article Finder search, shown on every page
 * except Article Finder itself (which shows the search inline). It lives in the
 * brand layout so it keeps reporting no matter where you navigate; the search
 * runs server-side regardless of which page is mounted.
 *
 * Two separate moments, each dismissed on its own and never shown again for that
 * run once crossed:
 *   1. "in progress", while the search runs and you're elsewhere
 *   2. "finished" (or "failed"), once it ends and you haven't seen the result
 * Nothing auto-dismisses; opening Article Finder counts as having seen it.
 *
 * Deliberately near-black glass regardless of page theme: it should read as a
 * floating object, like a notification, not another panel of the page.
 */
import { IconAlertTriangle, IconArrowUpRight, IconCircleCheck, IconSearch, IconX } from "@tabler/icons-react";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { Progress } from "@workspace/ui/components/progress";
import { cn } from "@workspace/ui/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { getArticleSearchStatusFn } from "@/server/article-finder";

const POLL_MS = 4_000;

type Status = {
	id: string;
	status: "running" | "done" | "error";
	stage: string | null;
	progressPct: number | null;
	error: string | null;
	startedAt: string;
	updatedAt: string;
} | null;

/** Remembers, per brand and in this browser, which run's card was last crossed. */
function useDismissedRun(key: string) {
	const [dismissedId, setDismissedId] = useState<string | null>(null);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		try {
			setDismissedId(localStorage.getItem(key));
		} catch {
			/* storage unavailable: fall back to in-memory only */
		}
		setLoaded(true);
	}, [key]);

	const dismiss = useCallback(
		(id: string) => {
			setDismissedId(id);
			try {
				localStorage.setItem(key, id);
			} catch {
				/* storage unavailable */
			}
		},
		[key],
	);

	return { dismissedId, loaded, dismiss };
}

export function ArticleSearchStatusBar() {
	const params = useParams({ strict: false }) as { brand?: string };
	const brandId = params.brand;
	const { pathname } = useLocation();
	const [status, setStatus] = useState<Status>(null);
	const progress = useDismissedRun(`article-search-progress-dismissed:${brandId}`);
	const finished = useDismissedRun(`article-search-seen:${brandId}`);
	const onArticleFinderPage = pathname.includes("/article-finder");

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

	// A result that lands while you're on the Article Finder page is already shown
	// there, so count it as seen instead of popping up after you leave.
	const { dismissedId: finishedDismissedId, dismiss: dismissFinished } = finished;
	useEffect(() => {
		if (onArticleFinderPage && status && status.status !== "running" && status.id !== finishedDismissedId) {
			dismissFinished(status.id);
		}
	}, [onArticleFinderPage, status, finishedDismissedId, dismissFinished]);

	if (!brandId || !progress.loaded || !finished.loaded || !status) return null;
	// Article Finder itself shows the search inline.
	if (onArticleFinderPage) return null;

	const running = status.status === "running";
	if (running ? status.id === progress.dismissedId : status.id === finished.dismissedId) return null;

	const articleFinderPath = `/app/${brandId}/article-finder`;
	const dismissCurrent = () => (running ? progress.dismiss(status.id) : finished.dismiss(status.id));

	return (
		<div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4 sm:justify-end sm:pr-6">
			<div
				className={cn(
					"pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-neutral-900/90 p-3.5",
					"text-neutral-100 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.55)] backdrop-blur-xl transition-all",
					"supports-[backdrop-filter]:bg-neutral-900/75",
					status.status === "error" && "border-destructive/40",
				)}
			>
				{running && (
					<div className="flex items-start gap-3">
						<Link to={articleFinderPath} className="block min-w-0 flex-1 space-y-2.5">
							<div className="flex items-center gap-2">
								<span className="relative flex size-2">
									<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
									<span className="relative inline-flex size-2 rounded-full bg-primary" />
								</span>
								<IconSearch className="size-4 text-primary" />
								<span className="text-[13px] font-semibold tracking-wide text-white">Article finding in progress</span>
								<span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
									{status.progressPct ?? 0}%
								</span>
							</div>
							<Progress value={status.progressPct ?? 5} className="h-1.5 bg-white/10" />
							<p className="text-xs text-neutral-400">{status.stage ?? "Working…"}</p>
						</Link>
						<button
							type="button"
							onClick={dismissCurrent}
							aria-label="Dismiss"
							className="shrink-0 text-neutral-500 hover:text-neutral-200"
						>
							<IconX className="size-3.5" />
						</button>
					</div>
				)}

				{status.status === "done" && (
					<div className="flex items-center gap-3">
						<IconCircleCheck className="size-5 shrink-0 text-emerald-400" />
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium text-white">Article search finished</p>
							<p className="text-xs text-neutral-400">Results are ready to review</p>
						</div>
						<Link
							to={articleFinderPath}
							onClick={dismissCurrent}
							className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-transform hover:scale-105"
						>
							View results
							<IconArrowUpRight className="size-3.5" />
						</Link>
						<button
							type="button"
							onClick={dismissCurrent}
							aria-label="Dismiss"
							className="shrink-0 text-neutral-500 hover:text-neutral-200"
						>
							<IconX className="size-3.5" />
						</button>
					</div>
				)}

				{status.status === "error" && (
					<div className="flex items-center gap-3">
						<IconAlertTriangle className="size-5 shrink-0 text-destructive" />
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium text-white">Article search failed</p>
							<p className="text-xs text-neutral-400">{status.error ?? "Something went wrong"}</p>
						</div>
						<Link
							to={articleFinderPath}
							onClick={dismissCurrent}
							className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-transform hover:scale-105"
						>
							Retry
						</Link>
						<button
							type="button"
							onClick={dismissCurrent}
							aria-label="Dismiss"
							className="shrink-0 text-neutral-500 hover:text-neutral-200"
						>
							<IconX className="size-3.5" />
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
