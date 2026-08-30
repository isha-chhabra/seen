import { IconBolt, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useState } from "react";
import { runBrandPromptsNowFn } from "@/server/prompts";

type RunState =
	| { kind: "idle" }
	| { kind: "running" }
	| { kind: "queued"; count: number; until: number }
	| { kind: "cooldown"; until: number }
	| { kind: "error"; message: string };

/**
 * "Run all prompts now" — manually triggers a full scrape cycle across every
 * enabled prompt + engine for the brand, bypassing the per-target 24h cadence.
 * Server enforces a cooldown; the button reflects it.
 */
export function RunNowButton({ brandId, className }: { brandId: string; className?: string }) {
	const [state, setState] = useState<RunState>({ kind: "idle" });
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (state.kind !== "cooldown" && state.kind !== "queued") return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [state.kind]);

	useEffect(() => {
		if ((state.kind === "cooldown" || state.kind === "queued") && now >= state.until) {
			setState(state.kind === "queued" ? { kind: "cooldown", until: state.until + 1 } : { kind: "idle" });
		}
	}, [state, now]);

	async function run() {
		if (state.kind === "running" || state.kind === "cooldown") return;
		setState({ kind: "running" });
		try {
			const res = await runBrandPromptsNowFn({ data: { brandId } });
			const until = Date.now() + (res.cooldownMs || 0);
			if (res.queued > 0) setState({ kind: "queued", count: res.queued, until: Date.now() + 6000 });
			else if (res.cooldownMs > 0) setState({ kind: "cooldown", until });
			else setState({ kind: "error", message: "No enabled prompts to run" });
		} catch (e) {
			setState({ kind: "error", message: e instanceof Error ? e.message : "Something went wrong" });
		}
	}

	let label = "Run all prompts now";
	if (state.kind === "running") label = "Queueing…";
	else if (state.kind === "queued")
		label = `Queued ${state.count} prompt${state.count === 1 ? "" : "s"} — results in a few minutes`;
	else if (state.kind === "cooldown") {
		const mins = Math.max(1, Math.ceil((state.until - now) / 60000));
		label = `Available again in ~${mins} min`;
	} else if (state.kind === "error") label = state.message;

	const busy = state.kind === "running";
	const disabled = busy || state.kind === "cooldown";

	return (
		<Button
			type="button"
			onClick={run}
			disabled={disabled}
			className={cn(
				"h-11 gap-2 rounded-xl bg-pink-500 px-5 text-sm font-semibold text-white",
				"shadow-lg shadow-pink-500/25 ring-1 ring-inset ring-pink-400/40",
				"hover:bg-pink-600 disabled:opacity-70",
				className,
			)}
		>
			{busy ? <IconLoader2 className="size-5 animate-spin" /> : <IconBolt className="size-5" />}
			{label}
		</Button>
	);
}
