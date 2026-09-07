import { IconBolt, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBrandRole } from "@/hooks/use-brands";
import { getBrandRunStatusFn, runBrandPromptsNowFn } from "@/server/prompts";

// The run is warned about at 30 min and abandoned at 2 h. These mirror the
// `expireInSeconds` ceiling on the enqueued jobs (see runBrandPromptsNowFn).
const WARN_AFTER_MS = 30 * 60 * 1000;
const STOP_AFTER_MS = 2 * 60 * 60 * 1000;
const SNOOZE_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 20 * 1000;
const DONE_COOLDOWN_MS = 10 * 60 * 1000;

type RunState =
	| { kind: "idle" }
	| { kind: "starting" }
	| { kind: "tracking"; startedAt: number; snoozeUntil: number }
	| { kind: "delayed"; startedAt: number }
	| { kind: "stopped" }
	| { kind: "done" }
	| { kind: "cooldown"; until: number }
	| { kind: "error"; message: string };

/**
 * "Run all prompts now" — manually triggers a full scrape cycle across every
 * enabled prompt + engine for the brand, bypassing the weekly cadence.
 *
 * A forced run is a paid multi-engine fan-out, so it never auto-retries. The
 * button polls the run's status: if it stalls past 30 minutes or a prompt
 * fails, the user is asked whether to keep waiting or retry (retrying costs
 * more). If the user keeps waiting, the run is abandoned after 2 hours.
 */
export function RunNowButton({
	brandId,
	className,
	onQueued,
}: {
	brandId: string;
	className?: string;
	onQueued?: (info: { by: string; at: string }) => void;
}) {
	const [state, setState] = useState<RunState>({ kind: "idle" });
	const [now, setNow] = useState(() => Date.now());
	const { isViewer } = useBrandRole(brandId);
	const pollingRef = useRef(false);

	// Tick for cooldown / elapsed-time labels.
	useEffect(() => {
		if (state.kind !== "cooldown" && state.kind !== "tracking" && state.kind !== "delayed") return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [state.kind]);

	useEffect(() => {
		if (state.kind === "cooldown" && now >= state.until) setState({ kind: "idle" });
	}, [state, now]);

	const start = useCallback(
		async (opts?: { bypassCooldown?: boolean }) => {
			setState({ kind: "starting" });
			try {
				const res = await runBrandPromptsNowFn({ data: { brandId, bypassCooldown: opts?.bypassCooldown } });
				if (res.queued > 0) {
					if (res.triggeredBy && res.triggeredAt) onQueued?.({ by: res.triggeredBy, at: res.triggeredAt });
					setState({ kind: "tracking", startedAt: Date.now(), snoozeUntil: Date.now() + WARN_AFTER_MS });
				} else if (res.cooldownMs > 0) {
					setState({ kind: "cooldown", until: Date.now() + res.cooldownMs });
				} else {
					setState({ kind: "error", message: "No enabled prompts to run" });
				}
			} catch (e) {
				setState({ kind: "error", message: e instanceof Error ? e.message : "Something went wrong" });
			}
		},
		[brandId, onQueued],
	);

	// Poll the run status while tracking or while the delay dialog is open. A new
	// run always transitions through "starting", so `state.kind` is enough to
	// re-subscribe; the elapsed check reads `prev.startedAt` inside setState.
	useEffect(() => {
		if (state.kind !== "tracking" && state.kind !== "delayed") return;
		let cancelled = false;

		async function check() {
			if (pollingRef.current) return;
			pollingRef.current = true;
			try {
				const s = await getBrandRunStatusFn({ data: { brandId } });
				if (cancelled) return;

				setState((prev) => {
					if (prev.kind !== "tracking" && prev.kind !== "delayed") return prev;
					const elapsed = Date.now() - prev.startedAt;

					if (s.state === "done" || s.state === "empty") return { kind: "done" };
					if (elapsed >= STOP_AFTER_MS) return { kind: "stopped" };

					const shouldWarn =
						s.state === "failed" ||
						(elapsed >= WARN_AFTER_MS && (prev.kind === "delayed" || Date.now() >= prev.snoozeUntil));
					if (shouldWarn && prev.kind === "tracking") return { kind: "delayed", startedAt: prev.startedAt };
					return prev;
				});
			} catch {
				// Transient — try again on the next tick.
			} finally {
				pollingRef.current = false;
			}
		}

		check();
		const t = setInterval(check, POLL_INTERVAL_MS);
		return () => {
			cancelled = true;
			clearInterval(t);
		};
	}, [state.kind, brandId]);

	// Flash "Run complete" briefly, then drop into the normal cooldown.
	useEffect(() => {
		if (state.kind !== "done") return;
		const t = setTimeout(() => setState({ kind: "cooldown", until: Date.now() + DONE_COOLDOWN_MS }), 4000);
		return () => clearTimeout(t);
	}, [state.kind]);

	const canStart = state.kind === "idle" || state.kind === "stopped" || state.kind === "error";
	const busy = state.kind === "starting";
	const disabled = busy || state.kind === "cooldown" || state.kind === "tracking" || isViewer;

	let label = "Run all prompts now";
	if (state.kind === "starting") label = "Queueing…";
	else if (state.kind === "tracking" || state.kind === "delayed") {
		const mins = Math.max(1, Math.floor((now - state.startedAt) / 60000));
		label = `Running… ${mins} min`;
	} else if (state.kind === "done") label = "Run complete";
	else if (state.kind === "stopped") label = "Run stopped — start again";
	else if (state.kind === "cooldown") {
		const mins = Math.max(1, Math.ceil((state.until - now) / 60000));
		label = `Available again in ~${mins} min`;
	} else if (state.kind === "error") label = state.message;

	return (
		<>
			<Button
				type="button"
				onClick={canStart ? () => start() : undefined}
				disabled={disabled}
				className={cn(
					"h-11 gap-2 rounded-xl bg-pink-500 px-5 text-sm font-semibold text-white",
					"shadow-lg shadow-pink-500/25 ring-1 ring-inset ring-pink-400/40",
					"hover:bg-pink-600 disabled:opacity-70",
					className,
				)}
			>
				{busy || state.kind === "tracking" ? (
					<IconLoader2 className="size-5 animate-spin" />
				) : (
					<IconBolt className="size-5" />
				)}
				{label}
			</Button>

			<Dialog
				open={state.kind === "delayed"}
				onOpenChange={(open) => {
					// Closing via X / overlay is treated as "Continue waiting".
					if (!open) {
						setState((prev) =>
							prev.kind === "delayed"
								? { kind: "tracking", startedAt: prev.startedAt, snoozeUntil: Date.now() + SNOOZE_MS }
								: prev,
						);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Request delayed</DialogTitle>
						<DialogDescription>
							This request has not completed within the expected time due to a technical issue. You may continue waiting
							for it to finish, or retry now. Please note that retrying will incur additional cost.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() =>
								setState((prev) => {
									if (prev.kind !== "delayed") return prev;
									const elapsed = Date.now() - prev.startedAt;
									return elapsed >= STOP_AFTER_MS
										? { kind: "stopped" }
										: { kind: "tracking", startedAt: prev.startedAt, snoozeUntil: Date.now() + SNOOZE_MS };
								})
							}
						>
							Continue waiting
						</Button>
						<Button type="button" onClick={() => start({ bypassCooldown: true })}>
							Retry
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
