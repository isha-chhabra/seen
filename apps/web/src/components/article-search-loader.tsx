/**
 * Loading state for a running Article Finder search: a magnifying glass that
 * sweeps over a stack of article cards, popping a check on each "find".
 * Text stays deliberately short ("Finding articles"); the only live data is the
 * real stage and percentage from getArticleSearchStatusFn, as a quiet footer.
 * Everything moves with transform/opacity only, and stands still for people who
 * ask for reduced motion.
 */
import { motion, useReducedMotion } from "motion/react";

const CARD_TINTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];

/** Where the checks pop up: [left, top] in px inside the scene, timed to the lens passing. */
const FINDS: { left: number; top: number; delay: number }[] = [
	{ left: 250, top: 14, delay: 1.2 },
	{ left: 96, top: 60, delay: 3.4 },
	{ left: 268, top: 96, delay: 5.6 },
];

const SWEEP_SECONDS = 8;

function Magnifier() {
	return (
		<svg aria-hidden="true" width="76" height="76" viewBox="0 0 76 76" fill="none" className="text-primary">
			<defs>
				<radialGradient id="af-lens-fill" cx="32%" cy="28%" r="85%">
					<stop offset="0" stopColor="white" stopOpacity="0.5" />
					<stop offset="1" stopColor="currentColor" stopOpacity="0.14" />
				</radialGradient>
			</defs>
			<circle cx="31" cy="31" r="22" fill="url(#af-lens-fill)" stroke="currentColor" strokeWidth="4.5" />
			<path d="M19 24a15 15 0 0 1 11-9" stroke="white" strokeOpacity="0.85" strokeWidth="3.5" strokeLinecap="round" />
			<line x1="47" y1="47" x2="68" y2="68" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
		</svg>
	);
}

function Scene({ still }: { still: boolean }) {
	return (
		<div className="relative mx-auto h-44 w-[340px] max-w-full" aria-hidden="true">
			{/* article cards */}
			<div className="absolute inset-x-4 top-3 space-y-2.5">
				{CARD_TINTS.map((tint, i) => (
					<motion.div
						key={tint}
						className="flex items-center gap-3 rounded-xl border bg-background/60 px-3 py-2.5"
						animate={still ? undefined : { y: [0, -3, 0] }}
						transition={{ duration: 3 + i * 0.5, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut", delay: i * 0.35 }}
					>
						<span className="size-7 shrink-0 rounded-lg" style={{ backgroundColor: tint, opacity: 0.85 }} />
						<span className="flex-1 space-y-1.5">
							<span className="block h-2 w-3/4 rounded-full bg-foreground/25" />
							<span className="block h-1.5 w-1/2 rounded-full bg-foreground/12" />
						</span>
					</motion.div>
				))}
			</div>

			{/* checks that pop up as the glass passes */}
			{FINDS.map((f) => (
				<motion.span
					key={f.left}
					className="absolute flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground"
					style={{ left: f.left, top: f.top }}
					initial={{ scale: 0, opacity: 0 }}
					animate={still ? { scale: 0, opacity: 0 } : { scale: [0, 1.25, 1, 1, 0], opacity: [0, 1, 1, 1, 0] }}
					transition={{
						duration: 2.4,
						repeat: Number.POSITIVE_INFINITY,
						repeatDelay: SWEEP_SECONDS - 2.4,
						delay: f.delay,
						times: [0, 0.2, 0.32, 0.8, 1],
					}}
				>
					<svg aria-hidden="true" width="11" height="11" viewBox="0 0 12 12" fill="none">
						<path d="M2.5 6.4 5 8.8l4.6-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
					</svg>
				</motion.span>
			))}

			{/* the magnifying glass */}
			<motion.div
				className="absolute top-2 left-2"
				animate={still ? undefined : { x: [0, 118, 236, 130, 0], y: [0, 40, 8, -2, 0], rotate: [-10, 6, -4, 8, -10] }}
				transition={{ duration: SWEEP_SECONDS, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
			>
				<span className="absolute top-[9px] left-[9px] size-11 rounded-full backdrop-brightness-150 backdrop-saturate-150" />
				<span className="absolute top-[9px] left-[9px] size-11 animate-ping rounded-full bg-primary/25" />
				<Magnifier />
			</motion.div>
		</div>
	);
}

function Dots({ still }: { still: boolean }) {
	return (
		<span aria-hidden="true" className="ml-0.5 inline-flex gap-0.5">
			{[0, 1, 2].map((i) => (
				<motion.span
					key={i}
					className="inline-block"
					animate={still ? undefined : { opacity: [0.2, 1, 0.2] }}
					transition={{ duration: 1.2, repeat: Number.POSITIVE_INFINITY, delay: i * 0.2 }}
				>
					.
				</motion.span>
			))}
		</span>
	);
}

export function ArticleSearchLoader({
	stage,
	progressPct,
	title = "Finding Articles",
}: {
	stage: string | null;
	progressPct: number | null;
	title?: string;
}) {
	const still = useReducedMotion() ?? false;
	return (
		<div role="status" aria-live="polite" className="overflow-hidden rounded-2xl border bg-card">
			<div className="bg-gradient-to-b from-primary/10 to-transparent px-4 pt-5">
				<Scene still={still} />
			</div>
			<div className="space-y-1 px-5 pb-5 text-left">
				<p className="text-lg font-semibold tracking-tight">
					{title}
					<Dots still={still} />
				</p>
				<p className="text-sm text-muted-foreground">
					Feel free to leave this page. It keeps running, and we'll let you know when it's done.
				</p>
				<div className="pt-3">
					<div className="h-1 overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full bg-primary transition-[width] duration-700"
							style={{ width: `${Math.max(4, progressPct ?? 4)}%` }}
						/>
					</div>
					<p className="mt-1.5 text-xs text-muted-foreground">{stage ?? "Getting started"}</p>
				</div>
			</div>
		</div>
	);
}
