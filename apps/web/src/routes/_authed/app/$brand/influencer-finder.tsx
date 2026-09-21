/**
 * /app/$brand/influencer-finder: describe the creators you want, review the plan
 * and spending limit, then judge the vetted results here. The latest run per
 * brand is saved, so reopening the tab shows it for free.
 */
import { IconUserSearch } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import type {
	BrandUnderstanding,
	FollowerBand,
	InfluencerBrief,
	InfluencerSearchPayload,
	Platform,
} from "@workspace/lib/influencer-finder/types";
import { Button } from "@workspace/ui/components/button";
import { useCallback, useEffect, useState } from "react";
import { ArticleSearchLoader } from "@/components/article-search-loader";
import { FinderSteps } from "@/components/finder-form";
import {
	BrandUnderstandingPanel,
	EMPTY_UNDERSTANDING,
	understandingComplete,
} from "@/components/influencer/brand-understanding";
import { BriefForm, type Extras, INFLUENCER_STEPS } from "@/components/influencer/brief-form";
import { BriefReview } from "@/components/influencer/brief-review";
import { InfluencerResults } from "@/components/influencer/results-view";
import { PageHeader } from "@/components/page-header";
import { useBrand, useBrandRole } from "@/hooks/use-brands";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";
import {
	findInfluencersFn,
	generateInfluencerBriefFn,
	getBrandUnderstandingFn,
	getInfluencerSearchStatusFn,
	getLatestInfluencerSearchFn,
} from "@/server/influencer-finder";

export const Route = createFileRoute("/_authed/app/$brand/influencer-finder")({
	head: ({ matches, match }) => ({
		meta: [
			{ title: buildTitle("Influencer Finder", { appName: getAppName(match), brandName: getBrandName(matches) }) },
			{ name: "description", content: "Find creators that fit this brand." },
		],
	}),
	component: InfluencerFinderPage,
});

type Phase = "idle" | "review" | "searching" | "results";

function prettyAt(iso: string): string {
	return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function InfluencerFinderPage() {
	const { brand: brandId } = Route.useParams();
	const { brand } = useBrand(brandId);
	const { isViewer } = useBrandRole(brandId);

	const [direction, setDirection] = useState<string[]>([]);
	const [platforms, setPlatforms] = useState<Platform[]>(["instagram"]);
	const [bands, setBands] = useState<FollowerBand[]>([]);
	const [extras, setExtras] = useState<Extras>({ similarTo: [], avoid: [], basedIn: [] });
	const [capUsd, setCapUsd] = useState(0.2);
	const [target, setTarget] = useState(20);

	const [understanding, setUnderstanding] = useState<BrandUnderstanding>(EMPTY_UNDERSTANDING);
	const [understandingLoading, setUnderstandingLoading] = useState(true);
	const [understandingError, setUnderstandingError] = useState<string | null>(null);

	const [phase, setPhase] = useState<Phase>("idle");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [brief, setBrief] = useState<InfluencerBrief | null>(null);
	const [payload, setPayload] = useState<InfluencerSearchPayload | null>(null);
	const [loaded, setLoaded] = useState<{ at: string; by: string } | null>(null);

	// Same follow-along as Article Finder: the search runs on the server and is polled here, but only
	// once its marker row exists, otherwise the poll would read the previous run as "done".
	const [pollReady, setPollReady] = useState(false);
	const [liveStage, setLiveStage] = useState<string | null>(null);
	const [liveProgress, setLiveProgress] = useState<number | null>(null);

	const adopt = useCallback((r: NonNullable<Awaited<ReturnType<typeof getLatestInfluencerSearchFn>>>) => {
		setDirection(r.direction ? [r.direction] : []);
		setBrief(r.payload.brief);
		setPlatforms(r.payload.brief.platforms);
		setBands(r.payload.brief.followerBands);
		setExtras({
			similarTo: r.payload.brief.similarTo ?? [],
			avoid: r.payload.brief.avoid ?? [],
			basedIn: r.payload.brief.basedIn ?? [],
		});
		setPayload(r.payload);
		setLoaded({ at: r.createdAt, by: r.createdBy });
		setPhase("results");
	}, []);

	useEffect(() => {
		if (phase !== "searching" || !pollReady) return;
		let cancelled = false;
		async function poll() {
			const s = await getInfluencerSearchStatusFn({ data: { brandId } }).catch(() => null);
			if (cancelled || !s) return;
			if (s.status === "running") {
				setLiveStage(s.stage);
				setLiveProgress(s.progressPct);
				return;
			}
			if (s.status === "error") {
				setError(s.error ?? "The search failed. Try again.");
				setPhase("review");
				return;
			}
			const r = await getLatestInfluencerSearchFn({ data: { brandId } }).catch(() => null);
			if (cancelled || !r) return;
			adopt(r);
		}
		poll();
		const id = setInterval(poll, 4_000);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [phase, brandId, pollReady, adopt]);

	// On open, a search already running takes priority over the last saved result.
	useEffect(() => {
		let cancelled = false;
		getInfluencerSearchStatusFn({ data: { brandId } })
			.then((s) => {
				if (cancelled) return;
				if (s?.status === "running") {
					setLiveStage(s.stage);
					setLiveProgress(s.progressPct);
					setPollReady(true);
					setPhase("searching");
					return;
				}
				getLatestInfluencerSearchFn({ data: { brandId } })
					.then((r) => {
						if (!cancelled && r) adopt(r);
					})
					.catch(() => {});
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [brandId, adopt]);

	async function loadUnderstanding(refresh: boolean) {
		setUnderstandingLoading(true);
		setUnderstandingError(null);
		try {
			const r = await getBrandUnderstandingFn({ data: { brandId, refresh } });
			setUnderstanding(r.profile);
		} catch (e) {
			setUnderstandingError(e instanceof Error ? e.message : "Couldn't read the website. Fill this in by hand.");
		} finally {
			setUnderstandingLoading(false);
		}
	}
	// biome-ignore lint/correctness/useExhaustiveDependencies: loadUnderstanding only reads brandId
	useEffect(() => {
		void loadUnderstanding(false);
	}, [brandId]);

	const locked = busy || phase === "searching";
	const canBuild =
		!isViewer &&
		!busy &&
		!understandingLoading &&
		direction.length > 0 &&
		platforms.length > 0 &&
		understandingComplete(understanding);
	const hasResults = (payload?.results.length ?? 0) > 0;

	async function buildPlan() {
		if (!canBuild) return;
		setBusy(true);
		setError(null);
		try {
			setBrief(
				await generateInfluencerBriefFn({
					data: { brandId, direction: direction.join(", "), platforms, followerBands: bands, ...extras, understanding },
				}),
			);
			setPhase("review");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't build the plan. Try again.");
		} finally {
			setBusy(false);
		}
	}

	async function run() {
		if (!brief) return;
		setBusy(true);
		setError(null);
		setLiveStage(null);
		setLiveProgress(null);
		setPollReady(false);
		setPhase("searching");
		try {
			await findInfluencersFn({ data: { brandId, brief, maxSpendUsd: capUsd, targetResults: target } });
			setPollReady(true);
		} catch (e) {
			// Never started (validation, debounce, permissions): nothing for the poll to follow.
			setError(e instanceof Error ? e.message : "Couldn't start the search. Try again.");
			setPhase("review");
		} finally {
			setBusy(false);
		}
	}

	// A plan is only on screen if there is one to show; otherwise fall back to the first step.
	const shown: Phase = phase === "review" && !brief ? "idle" : phase;
	const wide = phase === "results";

	return (
		<PageHeader
			title="Influencer Finder"
			subtitle="Find creators that fit this brand."
			infoContent="Creators are matched on bio and recent posts, then checked for engagement, posting rhythm, brand collaborations and competitor ties. The last search is saved, so reopening this tab is free."
			actions={
				phase === "results" ? (
					<>
						{brief && (
							<Button variant="ghost" size="sm" onClick={() => setPhase("review")}>
								Edit Plan
							</Button>
						)}
						<Button variant="outline" size="sm" onClick={() => setPhase("idle")}>
							New Search
						</Button>
					</>
				) : undefined
			}
		>
			<div className={wide ? "max-w-[1400px]" : "max-w-3xl"}>
				{phase !== "results" && <FinderSteps steps={INFLUENCER_STEPS} current={shown === "idle" ? 1 : 2} />}
				{shown === "idle" && (
					<BrandUnderstandingPanel
						brandName={brand?.name ?? "This Brand"}
						value={understanding}
						onChange={setUnderstanding}
						loading={understandingLoading}
						error={understandingError}
						onRefresh={() => void loadUnderstanding(true)}
						disabled={busy || isViewer}
					/>
				)}
				{shown === "idle" && (
					<BriefForm
						direction={direction}
						onDirection={setDirection}
						platforms={platforms}
						onPlatforms={setPlatforms}
						bands={bands}
						onBands={setBands}
						extras={extras}
						onExtras={setExtras}
						busy={busy}
						canSubmit={canBuild}
						error={error}
						onSubmit={buildPlan}
					/>
				)}

				{(shown === "review" || shown === "searching") && (
					<div className="space-y-6">
						{brief && (
							<BriefReview
								brief={brief}
								onBrief={setBrief}
								capUsd={capUsd}
								onCap={setCapUsd}
								target={target}
								onTarget={setTarget}
								locked={locked || isViewer}
								canRun={!locked && !isViewer}
								hasResults={hasResults}
								error={error}
								onRegenerate={buildPlan}
								onBack={() => setPhase(hasResults ? "results" : "idle")}
								onRun={run}
								running={phase === "searching"}
							/>
						)}
						{phase === "searching" && (
							<ArticleSearchLoader title="Finding Creators" stage={liveStage} progressPct={liveProgress} />
						)}
					</div>
				)}

				{phase === "results" && payload && (
					<div className="space-y-3">
						{loaded && (
							<p className="flex items-center gap-1.5 text-muted-foreground text-xs">
								<IconUserSearch className="size-3.5" />
								Last run by {loaded.by} · {prettyAt(loaded.at)}
								{direction[0] ? ` · “${direction[0]}”` : ""}
							</p>
						)}
						<InfluencerResults payload={payload} brandName={brand?.name} canExport={!isViewer} />
					</div>
				)}
			</div>
		</PageHeader>
	);
}
