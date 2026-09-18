/**
 * Floating, brand-wide indicator for an in-flight (or just-finished) Article
 * Finder search. Lives in the brand layout, not the Article Finder route
 * itself, so it keeps showing real progress no matter which tab you're on —
 * the search runs server-side regardless of which page is mounted, this is
 * just the piece that used to forget about it the moment you navigated away.
 * Deliberately near-black glass regardless of page theme (not a tinted
 * variant of the page background) — it should read as a floating object,
 * the way a notification or call card does, not another panel of the page.
 */
import { IconAlertTriangle, IconArrowUpRight, IconCircleCheck, IconX } from "@tabler/icons-react";
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
		<div className="pointer-events-none fixed inset-x-0 bottom-5 z-50 flex justify-center px-4 sm:justify-end sm:pr-6">
			<div
				className={cn(
					"pointer-events-auto w-full max-w-sm rounded-2xl border border-white/10 bg-neutral-900/90 p-3.5",
					"text-neutral-100 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.55)] backdrop-blur-xl transition-all",
					"supports-[backdrop-filter]:bg-neutral-900/75",
					status.status === "error" && "border-destructive/40",
				)}
			>
				{status.status === "running" && (
					<Link to={`/app/${brandId}/article-finder`} className="block space-y-2.5">
						<div className="flex items-center gap-2">
							<span className="relative flex size-2">
								<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
								<span className="relative inline-flex size-2 rounded-full bg-primary" />
							</span>
							<span className="font-titan-one text-[13px] tracking-wide text-white">Article Finder</span>
							<span className="ml-auto rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground tabular-nums">
								{status.progressPct ?? 0}%
							</span>
						</div>
						<Progress value={status.progressPct ?? 5} className="h-1.5 bg-white/10" />
						<p className="text-xs text-neutral-400">{status.stage ?? "Working…"}</p>
					</Link>
				)}

				{status.status === "done" && (
					<div className="flex items-center gap-3">
						<IconCircleCheck className="size-5 shrink-0 text-emerald-400" />
						<div className="min-w-0 flex-1">
							<p className="text-sm font-medium text-white">Article search finished</p>
							<p className="text-xs text-neutral-400">Results are ready to review</p>
						</div>
						<Link
							to={`/app/${brandId}/article-finder`}
							onClick={() => setDismissedId(status.id)}
							className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-transform hover:scale-105"
						>
							View
							<IconArrowUpRight className="size-3.5" />
						</Link>
						<button
							type="button"
							onClick={() => setDismissedId(status.id)}
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
							to={`/app/${brandId}/article-finder`}
							onClick={() => setDismissedId(status.id)}
							className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-transform hover:scale-105"
						>
							Retry
						</Link>
						<button
							type="button"
							onClick={() => setDismissedId(status.id)}
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
