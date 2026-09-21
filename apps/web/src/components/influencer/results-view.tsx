/**
 * The Influencer Finder results screen: a summary strip, Matches / Maybe / Excluded
 * tabs, filters and sorting over the one result set, a table or card view, and the
 * export menu. Filtering is live and free, nothing here re-runs the search.
 */
import {
	IconAdjustmentsHorizontal,
	IconAlertTriangle,
	IconArrowDown,
	IconArrowUp,
	IconLayoutGrid,
	IconList,
	IconSearch,
	IconShieldCheck,
	IconShieldX,
	IconX,
} from "@tabler/icons-react";
import {
	FOLLOWER_BANDS,
	type FollowerBand,
	type InfluencerResult,
	type InfluencerSearchPayload,
	type Platform,
} from "@workspace/lib/influencer-finder/types";
import { Button } from "@workspace/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@workspace/ui/components/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { cn } from "@workspace/ui/lib/utils";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/empty-state";
import { ExportMenu } from "@/components/export-menu";
import { StopScale, ToggleGroup } from "@/components/finder-form";
import { UserAvatar } from "@/components/user-avatar";
import {
	applyFilters,
	type CollabFilter,
	defaultFilters,
	formatCount,
	formatDaysAgo,
	type ResultFilters,
	type ResultTab,
	type SortDir,
	type SortKey,
	summarize,
} from "@/lib/influencer-results";
import type { ExportColumn } from "@/lib/table-export";
import { SizeRange } from "./brief-form";
import { CreatorSheet } from "./creator-sheet";
import { EXCLUDED_LABEL, FilterTrigger, FitBar, PLATFORM_LABEL, PlatformIcon, VerdictBadge } from "./parts";

const EXPORT_COLUMNS: ExportColumn<InfluencerResult>[] = [
	{
		header: "verdict",
		value: (r) => (r.verdict === "include" ? "Match" : r.verdict === "maybe" ? "Maybe" : "Excluded"),
	},
	{ header: "fit score", value: (r) => r.fitScore },
	{ header: "platform", value: (r) => PLATFORM_LABEL[r.platform] },
	{ header: "handle", value: (r) => `@${r.handle}` },
	{ header: "name", value: (r) => r.name },
	{ header: "profile link", value: (r) => r.profileUrl },
	{ header: "followers", value: (r) => r.followers },
	{ header: "typical engagement %", value: (r) => r.engagementPct },
	{ header: "engagement sample (posts)", value: (r) => r.engagementSample },
	{ header: "posts per week", value: (r) => r.postsPerWeek },
	{ header: "last post (days ago)", value: (r) => r.lastPostDaysAgo },
	{ header: "sponsored posts", value: (r) => r.collab.sponsoredPosts },
	{ header: "posts checked", value: (r) => r.collab.postsChecked },
	{ header: "brands worked with", value: (r) => r.collab.brands.map((b) => `@${b}`).join(", ") },
	{ header: "competitor conflict", value: (r) => r.competitor.isCompetitor || r.competitor.promotesCompetitor },
	{ header: "why they fit", value: (r) => r.fitReason },
	{ header: "concern", value: (r) => r.concern },
	{ header: "excluded because", value: (r) => (r.excludedBecause ? EXCLUDED_LABEL[r.excludedBecause] : "") },
	{ header: "bio", value: (r) => r.bio },
];

const SORT_LABEL: Record<SortKey, string> = {
	fit: "Fit Score",
	followers: "Followers",
	engagement: "Engagement",
	postsPerWeek: "Posting Frequency",
	lastPost: "Most Recent Post",
	collabs: "Brand Collabs",
	name: "Name",
};

const ENGAGEMENT_STEPS = [
	[0, "Any"],
	[1, "1%+"],
	[2, "2%+"],
	[3, "3%+"],
	[5, "5%+"],
] as const;
const ACTIVE_STEPS = [
	[0, "Any"],
	[14, "2 Weeks"],
	[30, "30 Days"],
	[90, "90 Days"],
] as const;
const POSTING_STEPS = [
	[0, "Any"],
	[1, "1+/Wk"],
	[3, "3+/Wk"],
	[5, "5+/Wk"],
] as const;
const FIT_STEPS = [
	[0, "Any"],
	[60, "60+"],
	[70, "70+"],
	[80, "80+"],
	[90, "90+"],
] as const;
const COLLAB_STEPS: readonly (readonly [CollabFilter, string])[] = [
	["any", "Any"],
	["has", "Has Collabs"],
	["none", "None Seen"],
];
/** One row of the filter panel: a label, then the control. */
function PanelRow({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-4 py-3">
			<span className="pt-0.5 font-medium text-sm">{label}</span>
			<div className="min-w-0">{children}</div>
		</div>
	);
}

/** A numeric filter as a ruler; the first stop is always "Any". */
function StepScale({
	label,
	steps,
	value,
	onChange,
}: {
	label: string;
	steps: readonly (readonly [number, string])[];
	value: number;
	onChange: (v: number) => void;
}) {
	const i = Math.max(
		0,
		steps.findIndex(([v]) => v === value),
	);
	return (
		<StopScale
			label={label}
			stops={steps.map(([, l]) => ({ label: l }))}
			lo={i}
			hi={i}
			onPick={(n) => onChange(steps[n]?.[0] ?? 0)}
		/>
	);
}

const pct = (n: number) => Math.round(n * 100) / 100;

const BAND_ORDER: FollowerBand[] = ["nano", "micro", "mid", "macro", "mega"];
const BAND_TINT: Record<FollowerBand, string> = {
	nano: "var(--chart-1)",
	micro: "var(--chart-2)",
	mid: "var(--chart-3)",
	macro: "var(--chart-4)",
	mega: "var(--chart-5)",
};

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
	return (
		<div className="rounded-xl border bg-card/60 px-4 py-3 backdrop-blur-sm">
			<p className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
			<p className="mt-1 font-semibold text-2xl tabular-nums tracking-tight">{value}</p>
			{hint && <p className="mt-0.5 text-muted-foreground text-xs">{hint}</p>}
		</div>
	);
}

function SummaryStrip({ results }: { results: InfluencerResult[] }) {
	const s = useMemo(() => summarize(results), [results]);
	const kept = s.matches + s.maybe;
	const bandTotal = BAND_ORDER.reduce((n, b) => n + (s.bands[b] ?? 0), 0);
	return (
		<div className="space-y-3">
			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				<StatTile label="Matches" value={String(s.matches)} hint={s.maybe > 0 ? `+ ${s.maybe} maybe` : undefined} />
				<StatTile
					label="Median Engagement"
					value={s.medianEngagementPct === null ? "—" : `${s.medianEngagementPct}%`}
					hint="Across kept creators"
				/>
				<StatTile label="Median Followers" value={formatCount(s.medianFollowers)} />
				<StatTile
					label="Do Brand Collabs"
					value={kept === 0 ? "—" : `${s.withCollabs} of ${kept}`}
					hint="Sponsored posts spotted"
				/>
			</div>
			{bandTotal > 0 && (
				<div className="rounded-xl border bg-card/60 px-4 py-3 backdrop-blur-sm">
					<div
						className="flex h-2 gap-0.5 overflow-hidden rounded-full"
						role="img"
						aria-label="Creators by follower size"
					>
						{BAND_ORDER.filter((b) => s.bands[b]).map((b) => (
							<span key={b} style={{ flex: s.bands[b], backgroundColor: BAND_TINT[b] }} />
						))}
					</div>
					<ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground text-xs">
						{BAND_ORDER.filter((b) => s.bands[b]).map((b) => (
							<li key={b} className="flex items-center gap-1.5">
								<span className="size-2 rounded-full" style={{ backgroundColor: BAND_TINT[b] }} />
								{FOLLOWER_BANDS[b].label.split(" ")[0]}{" "}
								<span className="text-foreground tabular-nums">{s.bands[b]}</span>
							</li>
						))}
					</ul>
				</div>
			)}
			{s.excludedByCompetitor > 0 ? (
				<p className="flex items-center gap-2 rounded-xl border border-primary/25 bg-primary/8 px-4 py-2.5 text-sm">
					<IconShieldX className="size-4 shrink-0 text-primary" />
					<span>
						Kept out {s.excludedByCompetitor} creator{s.excludedByCompetitor === 1 ? "" : "s"} tied to a competitor.
						They're in the Excluded tab with the evidence.
					</span>
				</p>
			) : (
				<p className="flex items-center gap-2 rounded-xl border bg-card/40 px-4 py-2.5 text-muted-foreground text-sm">
					<IconShieldCheck className="size-4 shrink-0 text-[var(--chart-1)]" />
					No competitor accounts or partners found in this list.
				</p>
			)}
		</div>
	);
}

function CollabCell({ r }: { r: InfluencerResult }) {
	if (r.collab.postsChecked === 0) return <span className="text-muted-foreground">—</span>;
	return (
		<div className="space-y-1">
			<p className="text-sm tabular-nums">
				{r.collab.sponsoredPosts}
				<span className="text-muted-foreground"> / {r.collab.postsChecked} posts</span>
			</p>
			{r.collab.brands.length > 0 && (
				<p
					className="max-w-[16rem] truncate text-muted-foreground text-xs"
					title={r.collab.brands.map((b) => `@${b}`).join(", ")}
				>
					{r.collab.brands
						.slice(0, 3)
						.map((b) => `@${b}`)
						.join(", ")}
					{r.collab.brands.length > 3 && ` +${r.collab.brands.length - 3}`}
				</p>
			)}
		</div>
	);
}

function CreatorCell({ r }: { r: InfluencerResult }) {
	return (
		<div className="flex min-w-[15rem] items-start gap-3">
			<UserAvatar name={r.name ?? r.handle} seed={r.key} className="mt-0.5 size-9 rounded-lg" />
			<div className="min-w-0">
				<p className="flex items-center gap-1.5 font-medium text-sm leading-tight">
					<span className="truncate">{r.name ?? `@${r.handle}`}</span>
				</p>
				<p className="flex items-center gap-1 text-muted-foreground text-xs">
					<PlatformIcon platform={r.platform} className="size-3" />@{r.handle}
				</p>
				<p className="mt-1 line-clamp-2 max-w-md whitespace-normal text-muted-foreground text-xs leading-snug">
					{r.fitReason}
				</p>
			</div>
		</div>
	);
}

function Row({ r, onOpen }: { r: InfluencerResult; onOpen: () => void }) {
	const conflict = r.competitor.isCompetitor || r.competitor.promotesCompetitor;
	return (
		<TableRow
			onClick={onOpen}
			className={cn(
				"cursor-pointer border-l-2",
				r.verdict === "include"
					? "border-l-[var(--chart-1)]"
					: r.verdict === "maybe"
						? "border-l-[var(--chart-2)]"
						: "border-l-transparent",
			)}
		>
			<TableCell className="w-28 py-3 align-top">
				<FitBar score={r.fitScore} />
			</TableCell>
			<TableCell className="py-3 align-top">
				<button
					type="button"
					onClick={onOpen}
					className="block w-full text-left"
					aria-label={`Open ${r.name ?? r.handle}`}
				>
					<CreatorCell r={r} />
				</button>
			</TableCell>
			<TableCell className="py-3 text-right align-top tabular-nums">{formatCount(r.followers)}</TableCell>
			<TableCell className="py-3 text-right align-top tabular-nums">
				{r.engagementPct === null ? (
					<span className="text-muted-foreground">—</span>
				) : (
					<>
						{pct(r.engagementPct)}%
						<span className="block text-[10px] text-muted-foreground">
							{r.engagementSample} post{r.engagementSample === 1 ? "" : "s"}
						</span>
					</>
				)}
			</TableCell>
			<TableCell className="py-3 text-right align-top tabular-nums">
				{r.postsPerWeek === null ? <span className="text-muted-foreground">—</span> : `${r.postsPerWeek}/wk`}
				<span className="block text-[10px] text-muted-foreground">{formatDaysAgo(r.lastPostDaysAgo)}</span>
			</TableCell>
			<TableCell className="py-3 align-top">
				<CollabCell r={r} />
			</TableCell>
			<TableCell className="w-28 py-3 align-top">
				<div className="flex flex-col items-start gap-1">
					<VerdictBadge verdict={r.verdict} />
					{r.verdict === "exclude" && r.excludedBecause ? (
						<span className="text-[10px] text-muted-foreground">{EXCLUDED_LABEL[r.excludedBecause]}</span>
					) : conflict ? (
						<span className="text-[10px] text-destructive">Competitor Link</span>
					) : null}
				</div>
			</TableCell>
		</TableRow>
	);
}

function CreatorCard({ r, onOpen }: { r: InfluencerResult; onOpen: () => void }) {
	return (
		<button
			type="button"
			onClick={onOpen}
			className="group flex flex-col gap-3 rounded-2xl border bg-card/70 p-4 text-left backdrop-blur-sm transition-[border-color,transform] hover:-translate-y-0.5 hover:border-primary/40 active:scale-[0.99]"
		>
			<div className="flex items-start gap-3">
				<UserAvatar name={r.name ?? r.handle} seed={r.key} className="size-11 rounded-xl" />
				<div className="min-w-0 flex-1">
					<p className="truncate font-semibold text-sm">{r.name ?? `@${r.handle}`}</p>
					<p className="flex items-center gap-1 text-muted-foreground text-xs">
						<PlatformIcon platform={r.platform} className="size-3" />@{r.handle}
					</p>
				</div>
				<VerdictBadge verdict={r.verdict} />
			</div>
			<FitBar score={r.fitScore} className="[&>div]:flex-1" />
			<p className="line-clamp-3 text-muted-foreground text-sm leading-snug">{r.fitReason}</p>
			<dl className="mt-auto grid grid-cols-3 gap-2 border-t pt-3 text-center">
				{[
					["Followers", formatCount(r.followers)],
					["Engagement", r.engagementPct === null ? "—" : `${pct(r.engagementPct)}%`],
					["Collabs", r.collab.postsChecked ? `${r.collab.sponsoredPosts}/${r.collab.postsChecked}` : "—"],
				].map(([k, v]) => (
					<div key={k}>
						<dt className="text-[10px] text-muted-foreground uppercase tracking-wide">{k}</dt>
						<dd className="font-semibold text-sm tabular-nums">{v}</dd>
					</div>
				))}
			</dl>
		</button>
	);
}

const TABS: { id: ResultTab; label: string }[] = [
	{ id: "matches", label: "Matches" },
	{ id: "maybe", label: "Maybe" },
	{ id: "excluded", label: "Excluded" },
];

export function InfluencerResults({
	payload,
	brandName,
	canExport,
}: {
	payload: InfluencerSearchPayload;
	brandName?: string;
	canExport: boolean;
}) {
	const { results, stats, cost } = payload;
	const [filters, setFilters] = useState<ResultFilters>(defaultFilters);
	const [sortKey, setSortKey] = useState<SortKey>("fit");
	const [sortDir, setSortDir] = useState<SortDir>("desc");
	const [view, setView] = useState<"table" | "cards">("table");
	const [open, setOpen] = useState<InfluencerResult | null>(null);

	const set = <K extends keyof ResultFilters>(key: K, value: ResultFilters[K]) =>
		setFilters((f) => ({ ...f, [key]: value }));
	const toggleIn = <T,>(key: "platforms" | "bands", value: T) =>
		setFilters((f) => {
			const next = new Set(f[key] as Set<T>);
			if (next.has(value)) next.delete(value);
			else next.add(value);
			return { ...f, [key]: next };
		});

	const counts = useMemo(() => summarize(results), [results]);
	const rows = useMemo(() => applyFilters(results, filters, sortKey, sortDir), [results, filters, sortKey, sortDir]);
	const inTab = results.filter((r) =>
		filters.tab === "matches"
			? r.verdict === "include"
			: filters.tab === "maybe"
				? r.verdict === "maybe"
				: r.verdict === "exclude",
	).length;
	const activeCount = [
		filters.platforms.size > 0,
		filters.bands.size > 0,
		filters.minFit > 0,
		filters.minEngagement > 0,
		filters.activeWithinDays > 0,
		filters.minPostsPerWeek > 0,
		filters.collab !== "any",
	].filter(Boolean).length;
	const tabCount: Record<ResultTab, number> = {
		matches: counts.matches,
		maybe: counts.maybe,
		excluded: counts.excluded,
	};
	const platformsInResults = [...new Set(results.map((r) => r.platform))] as Platform[];

	return (
		<div className="space-y-4">
			<SummaryStrip results={results} />

			{stats.requested !== undefined && counts.matches + counts.maybe < stats.requested && (
				<p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm">
					<IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
					<span>
						Found {counts.matches + counts.maybe} of {stats.requested} creators.{" "}
						{stats.stoppedAtBudget
							? `The search stopped at the $${cost.capUsd.toFixed(2)} limit. Raise the limit and run it again; creators already checked cost nothing.`
							: `No more fitting creators turned up after ${stats.searches} searches. Try a broader description or more follower sizes.`}
					</span>
				</p>
			)}

			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="inline-flex rounded-lg bg-muted p-[3px]" role="tablist" aria-label="Result groups">
					{TABS.map((t) => (
						<button
							key={t.id}
							type="button"
							role="tab"
							aria-selected={filters.tab === t.id}
							onClick={() => set("tab", t.id)}
							className={cn(
								"flex items-center gap-1.5 rounded-md px-3 py-1 font-medium text-sm transition-colors",
								filters.tab === t.id
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground hover:text-foreground",
							)}
						>
							{t.label}
							<span className="text-muted-foreground text-xs tabular-nums">{tabCount[t.id]}</span>
						</button>
					))}
				</div>
				<ExportMenu
					rows={rows}
					columns={EXPORT_COLUMNS}
					filePrefix="influencer-finder"
					brandName={brandName}
					disabled={rows.length === 0 || !canExport}
				/>
			</div>

			<div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/70 p-2 shadow-xs backdrop-blur-sm sm:flex-nowrap">
				<InputGroup className="h-8 min-w-0 flex-1 sm:max-w-sm">
					<InputGroupInput
						value={filters.search}
						onChange={(e) => set("search", e.target.value)}
						placeholder="Search Name, Bio or Brand"
						className="h-8 text-sm"
					/>
					<InputGroupAddon className="pl-2.5">
						<IconSearch className="size-3.5" />
					</InputGroupAddon>
					{filters.search && (
						<InputGroupAddon align="inline-end" className="pr-1.5">
							<InputGroupButton size="icon-xs" onClick={() => set("search", "")} aria-label="Clear search">
								<IconX className="size-3.5" />
							</InputGroupButton>
						</InputGroupAddon>
					)}
				</InputGroup>

				<Popover modal={false}>
					<PopoverTrigger
						render={
							<FilterTrigger
								label="Filters"
								icon={<IconAdjustmentsHorizontal className="size-3.5" />}
								active={activeCount > 0}
								badgeCount={activeCount}
							/>
						}
					/>
					<PopoverContent
						align="start"
						className="max-h-[70vh] w-[28rem] max-w-[92vw] divide-y divide-border/50 overflow-y-auto p-4"
					>
						<div className="flex items-center justify-between pb-3">
							<span className="font-semibold text-sm">Filters</span>
							<button
								type="button"
								disabled={activeCount === 0}
								onClick={() => setFilters((f) => ({ ...defaultFilters(), tab: f.tab, search: f.search }))}
								className="text-muted-foreground text-xs transition-colors hover:text-foreground disabled:opacity-40"
							>
								Clear All
							</button>
						</div>
						{platformsInResults.length > 1 && (
							<PanelRow label="Platform">
								<ToggleGroup
									label="Platform"
									selected={[...filters.platforms]}
									onToggle={(p) => toggleIn("platforms", p)}
									options={platformsInResults.map((p) => ({ id: p, label: PLATFORM_LABEL[p] }))}
								/>
							</PanelRow>
						)}
						<PanelRow label="Followers">
							<SizeRange bands={[...filters.bands]} onChange={(v) => set("bands", new Set(v))} />
						</PanelRow>
						<PanelRow label="Fit Score">
							<StepScale
								label="Fit Score"
								steps={FIT_STEPS}
								value={filters.minFit}
								onChange={(v) => set("minFit", v)}
							/>
						</PanelRow>
						<PanelRow label="Engagement">
							<StepScale
								label="Engagement"
								steps={ENGAGEMENT_STEPS}
								value={filters.minEngagement}
								onChange={(v) => set("minEngagement", v)}
							/>
						</PanelRow>
						<PanelRow label="Last Posted">
							<StepScale
								label="Last Posted Within"
								steps={ACTIVE_STEPS}
								value={filters.activeWithinDays}
								onChange={(v) => set("activeWithinDays", v)}
							/>
						</PanelRow>
						<PanelRow label="Posting Rate">
							<StepScale
								label="Posting Rate"
								steps={POSTING_STEPS}
								value={filters.minPostsPerWeek}
								onChange={(v) => set("minPostsPerWeek", v)}
							/>
						</PanelRow>
						<PanelRow label="Brand Collabs">
							<StepScale
								label="Brand Collabs"
								steps={COLLAB_STEPS.map(([, l], i) => [i, l] as const)}
								value={COLLAB_STEPS.findIndex(([k]) => k === filters.collab)}
								onChange={(i) => set("collab", COLLAB_STEPS[i]?.[0] ?? "any")}
							/>
						</PanelRow>
					</PopoverContent>
				</Popover>

				<div className="ml-auto flex items-center gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger render={<FilterTrigger label={`Sort: ${SORT_LABEL[sortKey]}`} />} />
						<DropdownMenuContent align="end">
							<DropdownMenuRadioGroup value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
								{(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
									<DropdownMenuRadioItem key={k} value={k}>
										{SORT_LABEL[k]}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
					<Button
						variant="outline"
						size="icon"
						className="size-8"
						onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
						aria-label={
							sortDir === "desc"
								? "Sorted high to low, switch to low to high"
								: "Sorted low to high, switch to high to low"
						}
					>
						{sortDir === "desc" ? <IconArrowDown className="size-4" /> : <IconArrowUp className="size-4" />}
					</Button>
					<div className="flex overflow-hidden rounded-md border">
						{(
							[
								["table", IconList, "Table view"],
								["cards", IconLayoutGrid, "Card view"],
							] as const
						).map(([id, Icon, label]) => (
							<button
								key={id}
								type="button"
								onClick={() => setView(id)}
								aria-label={label}
								aria-pressed={view === id}
								className={cn(
									"flex size-8 items-center justify-center transition-colors",
									view === id ? "bg-primary text-primary-foreground" : "hover:bg-accent",
								)}
							>
								<Icon className="size-4" />
							</button>
						))}
					</div>
				</div>
			</div>

			<p className="flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-xs">
				<span className="font-semibold text-foreground tabular-nums">{rows.length}</span> of {inTab} shown.
				{(filters.minEngagement > 0 || filters.activeWithinDays > 0 || filters.minPostsPerWeek > 0) &&
					" Creators with no value for a filtered number (hidden likes, unmeasured TikTok activity) are left out while it's on."}
				<span className="ml-auto">
					{stats.creatorsAnalyzed} analyzed · {stats.fromCache} reused from earlier searches · spent $
					{cost.usd.toFixed(2)} of ${cost.capUsd.toFixed(2)}
					{stats.stoppedAtBudget && " · stopped at the spending limit"}
				</span>
			</p>

			{results.length === 0 ? (
				<EmptyState
					icon={IconSearch}
					title="No Creators Passed the Checks"
					description="The list is never padded with weak fits. Try a broader direction or more follower sizes."
				/>
			) : rows.length === 0 ? (
				<EmptyState
					icon={IconSearch}
					title="Nothing Matches These Filters"
					description="Loosen the filters above, or switch tabs. The creators are still here."
				/>
			) : view === "table" ? (
				<div className="scroll-reveal overflow-x-auto rounded-lg border shadow-xs">
					<Table>
						<TableHeader>
							<TableRow className="hover:bg-transparent">
								<TableHead className="w-28">Fit</TableHead>
								<TableHead>Creator</TableHead>
								<TableHead className="text-right">Followers</TableHead>
								<TableHead className="text-right">Engagement</TableHead>
								<TableHead className="text-right">Posting</TableHead>
								<TableHead>Brand Collabs</TableHead>
								<TableHead className="w-28">Status</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((r) => (
								<Row key={r.key} r={r} onOpen={() => setOpen(r)} />
							))}
						</TableBody>
					</Table>
				</div>
			) : (
				<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
					{rows.map((r) => (
						<CreatorCard key={r.key} r={r} onOpen={() => setOpen(r)} />
					))}
				</div>
			)}

			<CreatorSheet creator={open} onClose={() => setOpen(null)} />
		</div>
	);
}
