/**
 * Rich animated loading state for a running Article Finder search — a
 * multi-ring spinner plus a small scrolling "log" of what's happening, in
 * the spirit of a boilerplate AI-loading snippet offered elsewhere. That
 * version was purely decorative: a fake progress % (sequenceIndex / count)
 * and a canned script unrelated to any real backend ("Configuring caching
 * strategies…", "Running performance tests…"). This one is driven by the
 * actual stage/progress already coming from getArticleSearchStatusFn — the
 * ring's fill IS the real completion percentage, and the bold label IS the
 * real stage. Only the small secondary lines are decorative flavor text,
 * matched to whichever real stage is active rather than random.
 */
import { useEffect, useRef, useState } from "react";

const RING_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/** Plausible sub-steps for each real backend stage, matched by keyword
 *  since the exact stage string carries a live count (e.g. "Reading 42
 *  articles"). Falls back to a single generic line for an unrecognized
 *  stage rather than showing nothing. */
function flavorLinesFor(stage: string | null): string[] {
	const s = (stage ?? "").toLowerCase();
	if (s.includes("planning")) return ["Reviewing your selected queries…", "Preparing the search plan…"];
	if (s.includes("searching the web"))
		return ["Running your search queries…", "Collecting results…", "Filtering junk and duplicates…"];
	if (s.includes("reading"))
		return ["Fetching each article page…", "Scanning for affiliate signals…", "Extracting publish dates…"];
	if (s.includes("vetting"))
		return ["Scoring topical fit…", "Checking Western-market focus…", "Writing outreach verdicts…"];
	if (s.includes("checking") && s.includes("publisher"))
		return ["Searching each publisher's site…", "Following internal links…", "Vetting the extra finds…"];
	return ["Working on it…"];
}

const LINE_MS = 2200;

function RingSpinner({ progress }: { progress: number }) {
	const clamped = Math.max(0, Math.min(100, progress));
	const dash = (clamped / 100) * 754;
	return (
		<div className="relative size-7 shrink-0">
			<svg aria-hidden="true" className="size-full" fill="none" viewBox="0 0 240 240">
				<defs>
					<mask id="af-loader-mask">
						<rect fill="black" height="240" width="240" />
						<circle
							cx="120"
							cy="120"
							fill="white"
							r="120"
							strokeDasharray={`${dash}, 754`}
							transform="rotate(-90 120 120)"
						/>
					</mask>
				</defs>
				<g mask="url(#af-loader-mask)" strokeDasharray="18% 40%" strokeWidth="16" className="af-loader-spin">
					{RING_COLORS.map((color, i) => (
						<circle
							key={color}
							cx="120"
							cy="120"
							opacity="0.95"
							r={150 - i * 20}
							stroke={color}
							style={{ animationDelay: `${i * 0.15}s`, animationDirection: i % 2 === 0 ? "normal" : "reverse" }}
						/>
					))}
				</g>
			</svg>
		</div>
	);
}

export function ArticleSearchLoader({ stage, progressPct }: { stage: string | null; progressPct: number | null }) {
	const lines = flavorLinesFor(stage);
	const [lineIndex, setLineIndex] = useState(0);
	const stageRef = useRef(stage);

	// a real stage change resets the flavor-line cycle so it never shows a
	// leftover line from the previous stage
	useEffect(() => {
		if (stageRef.current !== stage) {
			stageRef.current = stage;
			setLineIndex(0);
		}
	}, [stage]);

	useEffect(() => {
		if (lines.length <= 1) return;
		const id = setInterval(() => setLineIndex((i) => (i + 1) % lines.length), LINE_MS);
		return () => clearInterval(id);
	}, [lines.length]);

	return (
		<div className="space-y-2.5 rounded-lg border bg-card p-3">
			<div className="flex items-center gap-2.5">
				<RingSpinner progress={progressPct ?? 4} />
				<div className="min-w-0 flex-1">
					<div className="flex items-center justify-between gap-2">
						<span className="text-sm font-medium text-foreground">{stage ?? "Getting started…"}</span>
						{progressPct !== null && <span className="text-xs tabular-nums text-muted-foreground">{progressPct}%</span>}
					</div>
					<p key={lines[lineIndex]} className="af-loader-line-in text-xs text-muted-foreground">
						{lines[lineIndex]}
					</p>
				</div>
			</div>
			<p className="text-xs text-muted-foreground">
				Usually 3-6 minutes. It keeps running on the server even if you switch tabs or close this one — reopen the app
				any time and it's either still going or waiting for you.
			</p>
		</div>
	);
}
