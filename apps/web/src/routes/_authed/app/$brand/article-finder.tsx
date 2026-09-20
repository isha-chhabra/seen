/**
 * /app/$brand/article-finder: turn a free-text direction into a vetted list of
 * Western-market (US, Canada, UK/Ireland, Europe, Australia, NZ) affiliate
 * articles to pitch this brand to, split by publisher authority.
 * The latest run per brand is persisted, so opening the tab shows it for free.
 */

import {
	IconArrowUpRight,
	IconChevronDown,
	IconLink,
	IconLoader2,
	IconMail,
	IconSearch,
	IconX,
} from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@workspace/ui/components/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Switch } from "@workspace/ui/components/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { ArticleSearchLoader } from "@/components/article-search-loader";
import { DateRangePicker } from "@/components/date-range-picker";
import { EmptyState } from "@/components/empty-state";
import { ExportMenu } from "@/components/export-menu";
import { FinderSteps, FormRow, FormRows, type Step, StopScale } from "@/components/finder-form";
import { PageHeader } from "@/components/page-header";
import { TagInput } from "@/components/tag-input";
import { useBrand, useBrandRole } from "@/hooks/use-brands";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";
import type { ExportColumn } from "@/lib/table-export";
import {
	type ArticleResult,
	findArticlesFn,
	generateArticleQueriesFn,
	getArticleSearchStatusFn,
	getLatestArticleSearchFn,
} from "@/server/article-finder";

export const Route = createFileRoute("/_authed/app/$brand/article-finder")({
	head: ({ matches, match }) => ({
		meta: [
			{ title: buildTitle("Article Finder", { appName: getAppName(match), brandName: getBrandName(matches) }) },
			{
				name: "description",
				content: "Find articles to pitch this brand to.",
			},
		],
	}),
	component: ArticleFinderPage,
});

function ymd(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function parseYmd(s: string): Date {
	return new Date(`${s}T00:00:00`);
}
function prettyAt(iso: string): string {
	return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type Query = { query: string; angle?: string };
const ARTICLE_EXPORT_COLUMNS: ExportColumn<ArticleResult>[] = [
	{ header: "category", value: (r) => (r.tier === "high_authority" ? "High-authority" : "Niche / blog") },
	{ header: "fit score", value: (r) => r.fitScore },
	{ header: "affiliate", value: (r) => r.affiliateStatus },
	{ header: "mentions brand", value: (r) => r.brandAlreadyMentioned },
	{ header: "article name", value: (r) => r.title },
	{ header: "article link", value: (r) => r.url },
	{ header: "published", value: (r) => r.publishedDate },
	{ header: "links competitor", value: (r) => r.linksCompetitor },
	{ header: "fit reasoning", value: (r) => r.verdict },
	{ header: "contact", value: (r) => r.contactHint },
];

const ARTICLE_STEPS: readonly Step[] = [
	["Describe", "Say what kind of articles to pitch this brand to, in a sentence."],
	["Check the searches", "See the searches before they run. Add, remove or reword any of them."],
	["Review articles", "Each article is checked for fit and affiliate links, then sorted by publisher authority."],
];
const DEPTH_STOPS = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
	label: String(n),
	sub: n === 1 ? "Quick" : n === 8 ? "Thorough" : undefined,
}));

type Phase = "idle" | "queries" | "searching" | "results";
// mirrors MAX_QUERIES in apps/web/src/server/article-finder.ts (the server's real cap)
const MAX_QUERIES_UI = 20;

function ScoreBadge({ score }: { score: number }) {
	return (
		<Badge variant={score >= 80 ? "success" : score >= 55 ? "default" : "quiet"} className="tabular-nums">
			{score}
		</Badge>
	);
}

function AffiliateBadge({ status }: { status: ArticleResult["affiliateStatus"] }) {
	if (status === "yes") return <Badge variant="success">Affiliate</Badge>;
	if (status === "unsure") return <Badge variant="quiet">Unsure</Badge>;
	return <Badge variant="outline">Not affiliate</Badge>;
}

/** Same trigger look as the shared FilterBar's FilterTriggerButton (see
 *  @/components/filter-bar), reimplemented locally so this toolbar doesn't
 *  need to pass a decorative icon for every dropdown. */
function TriggerButton({
	label,
	active,
	badgeCount,
	icon,
	className,
	...props
}: { label: string; active?: boolean; badgeCount?: number; icon?: React.ReactNode } & React.ComponentProps<
	typeof Button
>) {
	return (
		<Button
			variant="outline"
			size="sm"
			{...props}
			className={cn("h-8 gap-1.5 font-normal", active && "border-foreground/30 bg-accent/50", className)}
		>
			{icon && <span className="flex items-center text-muted-foreground">{icon}</span>}
			<span className="text-foreground">{label}</span>
			{badgeCount !== undefined && badgeCount > 0 && (
				<span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
					{badgeCount}
				</span>
			)}
			<IconChevronDown className="size-3.5 text-muted-foreground" />
		</Button>
	);
}

function ResultRow({ r, brandName }: { r: ArticleResult; brandName?: string }) {
	const isEmail = r.contactHint?.includes("@") && !r.contactHint.startsWith("http");
	const meta = [r.domain, r.publishedDate || null].filter(Boolean).join("  ·  ");
	return (
		<TableRow
			className={cn(
				"border-l-2",
				r.fitScore >= 80 ? "border-l-emerald-500" : r.fitScore >= 55 ? "border-l-primary" : "border-l-transparent",
			)}
		>
			<TableCell className="w-14 py-3 align-top">
				<ScoreBadge score={r.fitScore} />
			</TableCell>
			<TableCell className="py-3 align-top">
				<Tooltip>
					<TooltipTrigger
						render={
							<a
								href={r.url}
								target="_blank"
								rel="noreferrer"
								className="block text-sm font-medium leading-snug hover:text-primary hover:underline"
							/>
						}
					>
						{r.title}
					</TooltipTrigger>
					<TooltipContent className="max-w-sm text-left leading-relaxed">{r.verdict}</TooltipContent>
				</Tooltip>
				<p className="mt-0.5 text-xs text-muted-foreground">{meta}</p>
			</TableCell>
			<TableCell className="py-3 align-top">
				<div className="flex flex-wrap gap-1.5">
					<Badge variant={r.tier === "high_authority" ? "secondary" : "outline"}>
						{r.tier === "high_authority" ? "High authority" : "Niche & blog"}
					</Badge>
					<AffiliateBadge status={r.affiliateStatus} />
					{r.linksCompetitor && <Badge variant="accent">Links a competitor</Badge>}
					{r.brandAlreadyMentioned && <Badge variant="quiet">Mentions {brandName ?? "brand"}</Badge>}
					{r.viaCrawl && <Badge variant="quiet">Via crawl</Badge>}
				</div>
			</TableCell>
			<TableCell className="w-16 py-3 text-right align-top">
				<div className="flex items-center justify-end gap-2">
					{r.contactHint && (
						<Tooltip>
							<TooltipTrigger
								render={
									<a
										href={isEmail ? `mailto:${r.contactHint}` : r.contactHint}
										target={isEmail ? undefined : "_blank"}
										rel="noreferrer"
										className="text-muted-foreground/60 transition-colors hover:text-primary"
									/>
								}
							>
								<IconMail className="size-4" />
							</TooltipTrigger>
							<TooltipContent>{isEmail ? r.contactHint : "Contact page"}</TooltipContent>
						</Tooltip>
					)}
					<a
						href={r.url}
						target="_blank"
						rel="noreferrer"
						title="Open article"
						className="text-muted-foreground/60 transition-colors hover:text-primary"
					>
						<IconArrowUpRight className="size-4" />
					</a>
				</div>
			</TableCell>
		</TableRow>
	);
}

function ArticleFinderPage() {
	const { brand: brandId } = Route.useParams();
	const { brand } = useBrand(brandId);
	const { isViewer } = useBrandRole(brandId);

	const [directionTags, setDirectionTags] = useState<string[]>([]);
	const [range, setRange] = useState<DateRange | undefined>(() => {
		const to = new Date();
		const from = new Date();
		from.setMonth(from.getMonth() - 6);
		return { from, to };
	});
	const [pages, setPages] = useState(4);
	const [excludeBrandMentions, setExcludeBrandMentions] = useState(false);
	const [phase, setPhase] = useState<Phase>("idle");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [queries, setQueries] = useState<Query[]>([]);
	const [high, setHigh] = useState<ArticleResult[]>([]);
	const [niche, setNiche] = useState<ArticleResult[]>([]);
	const [stats, setStats] = useState<Record<string, number> | null>(null);
	const [loaded, setLoaded] = useState<{ at: string; by: string } | null>(null);

	// post-search filters, live over the one tagged result set, no re-run needed
	const [searchText, setSearchText] = useState("");
	const [tierFilter, setTierFilter] = useState<"all" | "high_authority" | "niche_blog">("all");
	const [mentionFilter, setMentionFilter] = useState<"all" | "unmentioned" | "mentioned">("all");
	const [affiliateFilter, setAffiliateFilter] = useState<Set<"yes" | "unsure" | "no">>(
		() => new Set(["yes", "unsure"]),
	);
	const [sortBy, setSortBy] = useState<"score_desc" | "score_asc" | "date_desc" | "domain_asc">("score_desc");
	const [affiliateOpen, setAffiliateOpen] = useState(false);

	// The search itself is a single long HTTP call (can run several minutes with
	// the wider net + outward crawl) — if the connection drops (laptop sleeps,
	// network hiccup, tab backgrounded, or you navigate away to another tab
	// entirely) the browser never sees the response even though the server
	// finished and saved it. So while we wait, also poll the brand-wide status
	// row (the same one the floating indicator in every other tab reads) for
	// real stage/progress and to adopt the result the moment it's marked done
	// — no manual refresh needed, and it picks back up correctly even if this
	// page was fully unmounted while the search ran.
	// The status poll may only run once the search's marker row exists. Polling
	// earlier finds the previous run, reads it as "done", and jumps to its
	// (possibly empty) results while the new search is still starting.
	const [pollReady, setPollReady] = useState(false);
	const [liveStage, setLiveStage] = useState<string | null>(null);
	const [liveProgress, setLiveProgress] = useState<number | null>(null);
	useEffect(() => {
		if (phase !== "searching" || !pollReady) return;
		let cancelled = false;
		async function poll() {
			const s = await getArticleSearchStatusFn({ data: { brandId } }).catch(() => null);
			if (cancelled || !s) return;
			if (s.status === "running") {
				setLiveStage(s.stage);
				setLiveProgress(s.progressPct);
				return;
			}
			if (s.status === "error") {
				setError(s.error ?? "Search failed. Try again.");
				setPhase("queries");
				return;
			}
			const r = await getLatestArticleSearchFn({ data: { brandId } }).catch(() => null);
			if (cancelled || !r) return;
			setDirectionTags(r.direction ? [r.direction] : []);
			setQueries(r.queries.map((q) => ({ query: q.query, angle: q.angle })));
			setHigh(r.highAuthority);
			setNiche(r.nicheBlog);
			setStats(r.stats);
			setLoaded({ at: r.createdAt, by: r.createdBy });
			setPhase("results");
		}
		poll();
		const id = setInterval(poll, 4_000);
		return () => {
			cancelled = true;
			clearInterval(id);
		};
	}, [phase, brandId, pollReady]);

	// on open: a search already running for this brand (started from here or
	// picked up while this tab was elsewhere) takes priority over the last
	// saved result, otherwise show the last saved search, for free
	useEffect(() => {
		let cancelled = false;
		getArticleSearchStatusFn({ data: { brandId } })
			.then((s) => {
				if (cancelled) return;
				if (s?.status === "running") {
					setLiveStage(s.stage);
					setLiveProgress(s.progressPct);
					setPollReady(true);
					setPhase("searching");
					return;
				}
				getLatestArticleSearchFn({ data: { brandId } })
					.then((r) => {
						if (cancelled || !r) return;
						setDirectionTags(r.direction ? [r.direction] : []);
						if (r.from && r.to) setRange({ from: parseYmd(r.from), to: parseYmd(r.to) });
						setPages(r.pagesPerSearch || 4);
						setQueries(r.queries.map((q) => ({ query: q.query, angle: q.angle })));
						setHigh(r.highAuthority);
						setNiche(r.nicheBlog);
						setStats(r.stats);
						setLoaded({ at: r.createdAt, by: r.createdBy });
						setPhase("results");
					})
					.catch(() => {});
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [brandId]);

	function toggleAffiliateFilter(v: "yes" | "unsure" | "no") {
		setAffiliateFilter((prev) => {
			const next = new Set(prev);
			if (next.has(v)) next.delete(v);
			else next.add(v);
			return next;
		});
	}

	function matchesFilters(r: ArticleResult): boolean {
		if (tierFilter !== "all" && r.tier !== tierFilter) return false;
		if (mentionFilter === "mentioned" && !r.brandAlreadyMentioned) return false;
		if (mentionFilter === "unmentioned" && r.brandAlreadyMentioned) return false;
		if (!affiliateFilter.has(r.affiliateStatus)) return false;
		const q = searchText.trim().toLowerCase();
		if (q && !r.title.toLowerCase().includes(q) && !r.domain.toLowerCase().includes(q)) return false;
		return true;
	}

	const totalResults = high.length + niche.length;
	// Plain computation, not useMemo: at most ~150 rows, re-sorting on every
	// render is imperceptible and this stays simpler than getting the
	// dependency list right for a closure-capturing filter function.
	const sortedRows = [...high, ...niche].filter(matchesFilters).sort((a, b) => {
		switch (sortBy) {
			case "score_desc":
				return b.fitScore - a.fitScore;
			case "score_asc":
				return a.fitScore - b.fitScore;
			case "date_desc":
				return (b.publishedDate ?? "").localeCompare(a.publishedDate ?? "");
			case "domain_asc":
				return a.domain.localeCompare(b.domain);
			default:
				return 0;
		}
	});
	const filteredCount = sortedRows.length;
	// Controls stay locked while a search runs, including one picked up from another tab.
	const locked = busy || phase === "searching";
	const canBuild = !isViewer && !busy && directionTags.length > 0 && !!range?.from && !!range?.to;

	async function genQueries() {
		if (!canBuild || !range?.from || !range?.to) return;
		setBusy(true);
		setError(null);
		try {
			const res = await generateArticleQueriesFn({
				data: { brandId, direction: directionTags.join(", "), from: ymd(range.from), to: ymd(range.to) },
			});
			setQueries(res.queries.map((q) => ({ query: q.query, angle: q.angle })));
			setPhase("queries");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't generate queries. Try again.");
		} finally {
			setBusy(false);
		}
	}

	async function run() {
		if (!range?.from || !range?.to || queries.length === 0) return;
		setBusy(true);
		setError(null);
		setLiveStage(null);
		setLiveProgress(null);
		setPollReady(false);
		setPhase("searching");
		try {
			// Only starts the search; progress and the finished result arrive
			// through the status poll above, which flips the page to "results".
			await findArticlesFn({
				data: {
					brandId,
					queries: queries.map((q) => ({ query: q.query, angle: q.angle })),
					direction: directionTags.join(", ") || undefined,
					from: ymd(range.from),
					to: ymd(range.to),
					pagesPerSearch: pages,
					excludeBrandMentions,
				},
			});
			// The marker row exists now, so the poll can safely follow it.
			setPollReady(true);
		} catch (e) {
			// The search never started (validation, debounce, permissions), so
			// there is nothing for the status poll to pick up: back to the queries.
			setError(e instanceof Error ? e.message : "Couldn't start the search. Try again.");
			setPhase("queries");
		} finally {
			setBusy(false);
		}
	}

	function newSearch() {
		setPhase("idle");
		setError(null);
	}

	// Single source of truth for each dropdown's option labels, so the trigger
	// button text and the menu items it opens can never drift out of sync
	// (sentence case throughout: first word capitalized, proper nouns aside).
	const tierLabels: Record<typeof tierFilter, string> = {
		all: "All tiers",
		high_authority: "High authority",
		niche_blog: "Niche & blog",
	};
	const mentionLabels: Record<typeof mentionFilter, string> = {
		all: "Any mentions",
		mentioned: `Mentions ${brand?.name ?? "brand"}`,
		unmentioned: `Doesn't mention ${brand?.name ?? "brand"}`,
	};
	const sortLabels: Record<typeof sortBy, string> = {
		score_desc: "Score, high to low",
		score_asc: "Score, low to high",
		date_desc: "Newest published",
		domain_asc: "Domain, A to Z",
	};

	const dropParts = stats
		? [
				stats.droppedOffTopic ? `${stats.droppedOffTopic} off-topic` : "",
				stats.droppedNonWestern ? `${stats.droppedNonWestern} outside target markets` : "",
				stats.droppedUnvetted ? `${stats.droppedUnvetted} unvetted` : "",
				stats.droppedRetailer ? `${stats.droppedRetailer} retailers` : "",
				stats.droppedSyndicated ? `${stats.droppedSyndicated} syndicated` : "",
				stats.droppedDupePublisher ? `${stats.droppedDupePublisher} duplicate sites` : "",
			].filter(Boolean)
		: [];
	const foundParts = stats
		? [
				stats.expandedDomains
					? `+${stats.expandedFound ?? 0} from checking ${stats.expandedDomains} good publisher${stats.expandedDomains === 1 ? "" : "s"} for other roundups`
					: "",
			].filter(Boolean)
		: [];

	return (
		<PageHeader
			title="Article Finder"
			subtitle="Find articles to pitch this brand to."
			infoContent="We search for editorial articles this brand could be featured in, then check each one for fit and affiliate links. Your last search is saved, so reopening this tab is free."
			actions={
				phase === "results" ? (
					<>
						{queries.length > 0 && (
							<Button variant="ghost" size="sm" onClick={() => setPhase("queries")}>
								Edit queries
							</Button>
						)}
						<ExportMenu
							rows={sortedRows}
							columns={ARTICLE_EXPORT_COLUMNS}
							filePrefix="article-finder"
							brandName={brand?.name}
							disabled={totalResults === 0 || isViewer}
						/>
						<Button variant="outline" size="sm" onClick={newSearch}>
							New search
						</Button>
					</>
				) : undefined
			}
		>
			<div className={phase === "results" ? "max-w-[1400px]" : "max-w-3xl"}>
				{phase !== "results" && <FinderSteps steps={ARTICLE_STEPS} current={phase === "idle" ? 1 : 2} />}

				{phase === "idle" && (
					<div>
						<FormRows>
							<FormRow label="Articles">
								<TagInput
									plain
									icon={<IconSearch className="size-4" />}
									values={directionTags}
									onChange={setDirectionTags}
									placeholder="e.g. gift guides for premium steaks"
									disabled={busy}
								/>
							</FormRow>
							<FormRow label="Published">
								<DateRangePicker value={range} onChange={setRange} />
							</FormRow>
							<FormRow label="Depth">
								<StopScale
									label="Search depth"
									stops={DEPTH_STOPS}
									lo={pages - 1}
									hi={pages - 1}
									onPick={(i) => setPages(i + 1)}
									disabled={busy}
								/>
							</FormRow>
							<FormRow label="Mentions">
								<label className="flex max-w-md cursor-pointer items-center justify-between gap-4 text-sm">
									<span>Skip articles that already mention {brand?.name ?? "the brand"}</span>
									<Switch checked={excludeBrandMentions} onCheckedChange={setExcludeBrandMentions} disabled={busy} />
								</label>
							</FormRow>
						</FormRows>

						{error && <p className="mt-5 text-sm text-destructive">{error}</p>}

						<div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2">
							<Button onClick={genQueries} disabled={!canBuild} className="gap-2">
								{busy && <IconLoader2 className="size-4 animate-spin" />}
								{busy ? "Creating plan…" : "Create search plan"}
							</Button>
						</div>
					</div>
				)}

				{(phase === "queries" || phase === "searching") && (
					<div>
						<div className="mb-4 flex items-end justify-between gap-4">
							<div>
								<h2 className="text-lg font-semibold tracking-tight">Check the searches</h2>
								<p className="text-sm text-muted-foreground">These run when you continue. Edit anything.</p>
							</div>
							<div className="flex shrink-0 gap-4 text-xs text-muted-foreground">
								<button
									type="button"
									onClick={genQueries}
									disabled={locked || isViewer}
									className="transition-colors hover:text-foreground"
								>
									Redo plan
								</button>
								<button
									type="button"
									onClick={() => setPhase(totalResults > 0 ? "results" : "idle")}
									disabled={locked}
									className="transition-colors hover:text-foreground"
								>
									{totalResults > 0 ? "Back to results" : "Back"}
								</button>
							</div>
						</div>
						<FormRows>
							<FormRow label="Searches" hint="Phrases to look up">
								<TagInput
									plain
									values={queries.map((q) => q.query)}
									onChange={(vals) =>
										setQueries(
											vals.map((v) => queries.find((q) => q.query === v) ?? { query: v, angle: "Added by you" }),
										)
									}
									placeholder="Add a phrase, press Enter"
									disabled={locked || isViewer}
									max={MAX_QUERIES_UI}
								/>
							</FormRow>
						</FormRows>
						<Button onClick={run} disabled={locked || queries.length === 0 || isViewer} className="mt-7 gap-2">
							{phase === "searching" && <IconLoader2 className="size-4 animate-spin" />}
							{phase === "searching" ? "Finding articles…" : "Find articles"}
						</Button>
						{phase === "searching" && (
							<div className="mt-6">
								<ArticleSearchLoader stage={liveStage} progressPct={liveProgress} />
							</div>
						)}
						{error && <p className="mt-4 text-sm text-destructive">{error}</p>}
					</div>
				)}

				{phase === "results" && (
					<div className="space-y-3">
						{loaded && (
							<p className="text-xs text-muted-foreground">
								Last run by {loaded.by} · {prettyAt(loaded.at)}
							</p>
						)}

						{/* Toolbar */}
						<div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-2 shadow-xs">
							<InputGroup className="h-8 w-full sm:w-64">
								<InputGroupInput
									value={searchText}
									onChange={(e) => setSearchText(e.target.value)}
									placeholder="Search title or domain…"
									className="h-8 text-sm"
								/>
								<InputGroupAddon className="pl-2.5">
									<IconSearch className="size-3.5" />
								</InputGroupAddon>
								{searchText && (
									<InputGroupAddon align="inline-end" className="pr-1.5">
										<InputGroupButton size="icon-xs" onClick={() => setSearchText("")} aria-label="Clear search">
											<IconX className="size-3.5" />
										</InputGroupButton>
									</InputGroupAddon>
								)}
							</InputGroup>

							<DropdownMenu>
								<DropdownMenuTrigger
									render={<TriggerButton label={tierLabels[tierFilter]} active={tierFilter !== "all"} />}
								/>
								<DropdownMenuContent align="start">
									<DropdownMenuRadioGroup
										value={tierFilter}
										onValueChange={(v) => setTierFilter(v as typeof tierFilter)}
									>
										<DropdownMenuRadioItem value="all">{tierLabels.all}</DropdownMenuRadioItem>
										<DropdownMenuRadioItem value="high_authority">{tierLabels.high_authority}</DropdownMenuRadioItem>
										<DropdownMenuRadioItem value="niche_blog">{tierLabels.niche_blog}</DropdownMenuRadioItem>
									</DropdownMenuRadioGroup>
								</DropdownMenuContent>
							</DropdownMenu>

							<DropdownMenu>
								<DropdownMenuTrigger
									render={<TriggerButton label={mentionLabels[mentionFilter]} active={mentionFilter !== "all"} />}
								/>
								<DropdownMenuContent align="start">
									<DropdownMenuRadioGroup
										value={mentionFilter}
										onValueChange={(v) => setMentionFilter(v as typeof mentionFilter)}
									>
										<DropdownMenuRadioItem value="all">{mentionLabels.all}</DropdownMenuRadioItem>
										<DropdownMenuRadioItem value="mentioned">{mentionLabels.mentioned}</DropdownMenuRadioItem>
										<DropdownMenuRadioItem value="unmentioned">{mentionLabels.unmentioned}</DropdownMenuRadioItem>
									</DropdownMenuRadioGroup>
								</DropdownMenuContent>
							</DropdownMenu>

							{/* Popover + Checkbox, not DropdownMenuCheckboxItem: mirrors the proven
							    multi-select pattern from @/components/filter-bar's TagsDropdown
							    rather than a menu-checkbox-item combination untested elsewhere in
							    this app. */}
							<Popover open={affiliateOpen} onOpenChange={setAffiliateOpen} modal={false}>
								<PopoverTrigger
									render={
										<TriggerButton
											label="Affiliate"
											icon={<IconLink className="size-3.5" />}
											active={affiliateFilter.size < 3}
											badgeCount={affiliateFilter.size}
										/>
									}
								/>
								<PopoverContent align="start" className="w-52 p-1">
									{(
										[
											["yes", "Confirmed"],
											["unsure", "Unsure"],
											["no", "Not affiliate"],
										] as const
									).map(([value, label]) => {
										const checked = affiliateFilter.has(value);
										return (
											<button
												key={value}
												type="button"
												onClick={(e) => {
													e.preventDefault();
													toggleAffiliateFilter(value);
												}}
												className={cn(
													"flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-2 py-1.5 text-left text-sm",
													checked ? "bg-accent" : "hover:bg-muted",
												)}
											>
												<Checkbox checked={checked} className="pointer-events-none" />
												<span className="flex-1">{label}</span>
											</button>
										);
									})}
								</PopoverContent>
							</Popover>

							<DropdownMenu>
								<DropdownMenuTrigger render={<TriggerButton label={sortLabels[sortBy]} />} />
								<DropdownMenuContent align="start">
									<DropdownMenuRadioGroup value={sortBy} onValueChange={(v) => setSortBy(v as typeof sortBy)}>
										<DropdownMenuRadioItem value="score_desc">{sortLabels.score_desc}</DropdownMenuRadioItem>
										<DropdownMenuRadioItem value="score_asc">{sortLabels.score_asc}</DropdownMenuRadioItem>
										<DropdownMenuRadioItem value="date_desc">{sortLabels.date_desc}</DropdownMenuRadioItem>
										<DropdownMenuRadioItem value="domain_asc">{sortLabels.domain_asc}</DropdownMenuRadioItem>
									</DropdownMenuRadioGroup>
								</DropdownMenuContent>
							</DropdownMenu>

							<div className="ml-auto flex items-center gap-2 text-sm">
								<span className="font-semibold tabular-nums">{filteredCount}</span>
								<span className="text-muted-foreground">
									of {totalResults} article{totalResults === 1 ? "" : "s"}
								</span>
								{(dropParts.length > 0 || foundParts.length > 0) && (
									<details className="text-xs text-muted-foreground">
										<summary className="cursor-pointer list-none transition-colors hover:text-foreground">
											{stats?.candidates ?? 0} checked
										</summary>
										<p className="mt-2 max-w-xs text-right leading-relaxed">
											{foundParts.length > 0 && <>{foundParts.join(", ")}. </>}
											{dropParts.length > 0 && <>Filtered out: {dropParts.join(", ")}.</>}
										</p>
									</details>
								)}
							</div>
						</div>

						{totalResults === 0 ? (
							<EmptyState
								icon={IconSearch}
								title="No articles found"
								description="Try a broader direction, a wider date range, or more depth."
							/>
						) : filteredCount === 0 ? (
							<EmptyState
								icon={IconSearch}
								title="Nothing matches these filters"
								description="Loosen the filters above, the results are still there."
							/>
						) : (
							<div className="scroll-reveal overflow-x-auto rounded-lg border shadow-xs">
								<Table>
									<TableHeader>
										<TableRow className="hover:bg-transparent">
											<TableHead className="w-14">Score</TableHead>
											<TableHead>Article</TableHead>
											<TableHead>Signals</TableHead>
											<TableHead className="w-16 text-right">Open</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{sortedRows.map((r) => (
											<ResultRow key={r.url} r={r} brandName={brand?.name} />
										))}
									</TableBody>
								</Table>
							</div>
						)}
					</div>
				)}
			</div>
		</PageHeader>
	);
}
