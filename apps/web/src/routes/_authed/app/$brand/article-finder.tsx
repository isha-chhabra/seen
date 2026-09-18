/**
 * /app/$brand/article-finder: turn a free-text direction into a vetted list of
 * Western-market (US, Canada, UK/Ireland, Europe, Australia, NZ) affiliate
 * articles to pitch this brand to, split by publisher authority.
 * The latest run per brand is persisted, so opening the tab shows it for free.
 */

import { IconBolt, IconCalendar, IconLoader2, IconMail, IconSearch } from "@tabler/icons-react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Calendar } from "@workspace/ui/components/calendar";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Switch } from "@workspace/ui/components/switch";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { SectionHeading } from "@/components/section-heading";
import { useBrand, useBrandRole } from "@/hooks/use-brands";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";
import {
	type ArticleResult,
	findArticlesFn,
	generateArticleQueriesFn,
	getLatestArticleSearchFn,
} from "@/server/article-finder";

export const Route = createFileRoute("/_authed/app/$brand/article-finder")({
	head: ({ matches, match }) => ({
		meta: [
			{ title: buildTitle("Article Finder", { appName: getAppName(match), brandName: getBrandName(matches) }) },
			{
				name: "description",
				content: "Find vetted Western-market affiliate articles this brand could be pitched into.",
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
function short(d?: Date): string {
	return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
}
function prettyAt(iso: string): string {
	return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type Query = { query: string; angle?: string; on: boolean };
type Phase = "idle" | "queries" | "searching" | "results";
// mirrors MAX_QUERIES in apps/web/src/server/article-finder.ts (the server's real cap)
const MAX_QUERIES_UI = 20;

function RangeInline({ value, onChange }: { value?: DateRange; onChange: (r?: DateRange) => void }) {
	return (
		<Popover>
			<PopoverTrigger render={<Button variant="outline" size="sm" className="gap-1.5 font-normal" />}>
				<IconCalendar className="size-3.5" />
				{value?.from ? `${short(value.from)} to ${short(value.to)}` : "any time"}
			</PopoverTrigger>
			<PopoverContent className="w-auto p-0" align="start">
				<Calendar mode="range" numberOfMonths={2} selected={value} onSelect={onChange} defaultMonth={value?.from} />
			</PopoverContent>
		</Popover>
	);
}

function ArticleRow({ r, brandName }: { r: ArticleResult; brandName?: string }) {
	const isEmail = r.contactHint?.includes("@") && !r.contactHint.startsWith("http");
	const meta = [r.domain, r.publishedDate || null].filter(Boolean).join("  ·  ");
	return (
		<div className="py-3.5">
			<div className="flex items-baseline gap-2.5">
				<span
					className={cn(
						"w-7 shrink-0 text-right text-xs font-semibold tabular-nums",
						r.fitScore >= 80 ? "text-primary" : r.fitScore >= 55 ? "text-foreground" : "text-muted-foreground",
					)}
				>
					{r.fitScore}
				</span>
				<a
					href={r.url}
					target="_blank"
					rel="noreferrer"
					className="flex-1 text-sm font-medium leading-snug hover:text-primary hover:underline"
				>
					{r.title}
				</a>
				{r.contactHint && (
					<a
						href={isEmail ? `mailto:${r.contactHint}` : r.contactHint}
						target={isEmail ? undefined : "_blank"}
						rel="noreferrer"
						title={isEmail ? r.contactHint : "Contact / submissions"}
						className="shrink-0 text-muted-foreground/50 transition-colors hover:text-primary"
					>
						<IconMail className="size-3.5" />
					</a>
				)}
			</div>
			<p className="mt-1 pl-[38px] text-xs text-muted-foreground">{meta}</p>
			<p className="mt-1 pl-[38px] text-[13px] leading-relaxed text-foreground/80">{r.verdict}</p>
			<div className="mt-1.5 flex flex-wrap gap-3 pl-[38px] text-[11px]">
				{r.affiliateStatus === "yes" && <span className="text-muted-foreground">Affiliate confirmed</span>}
				{r.affiliateStatus === "unsure" && <span className="text-muted-foreground">Affiliate unsure</span>}
				{r.linksCompetitor && <span className="font-medium text-primary">Links a competitor</span>}
				{r.brandAlreadyMentioned && <span className="text-muted-foreground">Mentions {brandName ?? "the brand"}</span>}
				{r.relevance === "weak" && <span className="text-muted-foreground">Loose fit</span>}
				{r.viaCrawl && <span className="text-muted-foreground">Found via crawl</span>}
			</div>
		</div>
	);
}

function ArticleFinderPage() {
	const { brand: brandId } = Route.useParams();
	const { brand } = useBrand(brandId);
	const { isViewer } = useBrandRole(brandId);

	const [direction, setDirection] = useState("");
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
	const [newQuery, setNewQuery] = useState("");
	const [high, setHigh] = useState<ArticleResult[]>([]);
	const [niche, setNiche] = useState<ArticleResult[]>([]);
	const [stats, setStats] = useState<Record<string, number> | null>(null);
	const [loaded, setLoaded] = useState<{ at: string; by: string } | null>(null);

	// post-search filters, live over the one tagged result set, no re-run needed
	const [mentionFilter, setMentionFilter] = useState<"all" | "unmentioned" | "mentioned">("all");
	const [affiliateFilter, setAffiliateFilter] = useState<Set<"yes" | "unsure" | "no">>(
		() => new Set(["yes", "unsure"]),
	);

	// on open: show the last saved search for this brand, for free
	useEffect(() => {
		let cancelled = false;
		getLatestArticleSearchFn({ data: { brandId } })
			.then((r) => {
				if (cancelled || !r) return;
				setDirection(r.direction);
				if (r.from && r.to) setRange({ from: parseYmd(r.from), to: parseYmd(r.to) });
				setPages(r.pagesPerSearch || 4);
				setQueries(r.queries.map((q) => ({ query: q.query, angle: q.angle, on: true })));
				setHigh(r.highAuthority);
				setNiche(r.nicheBlog);
				setStats(r.stats);
				setLoaded({ at: r.createdAt, by: r.createdBy });
				setPhase("results");
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
		if (mentionFilter === "mentioned" && !r.brandAlreadyMentioned) return false;
		if (mentionFilter === "unmentioned" && r.brandAlreadyMentioned) return false;
		return affiliateFilter.has(r.affiliateStatus);
	}

	const selected = queries.filter((q) => q.on);
	const filteredHigh = high.filter(matchesFilters);
	const filteredNiche = niche.filter(matchesFilters);
	const totalResults = high.length + niche.length;
	const filteredCount = filteredHigh.length + filteredNiche.length;
	const canBuild = !isViewer && !busy && direction.trim().length >= 3 && !!range?.from && !!range?.to;

	function addQuery() {
		const q = newQuery.trim();
		if (!q || queries.length >= MAX_QUERIES_UI) return;
		if (queries.some((x) => x.query.toLowerCase() === q.toLowerCase())) {
			setNewQuery("");
			return;
		}
		setQueries((qs) => [...qs, { query: q, angle: "Added by you", on: true }]);
		setNewQuery("");
	}

	async function genQueries() {
		if (!canBuild || !range?.from || !range?.to) return;
		setBusy(true);
		setError(null);
		try {
			const res = await generateArticleQueriesFn({
				data: { brandId, direction: direction.trim(), from: ymd(range.from), to: ymd(range.to) },
			});
			setQueries(res.queries.map((q) => ({ query: q.query, angle: q.angle, on: true })));
			setPhase("queries");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Couldn't generate queries.");
		} finally {
			setBusy(false);
		}
	}

	async function run() {
		if (!range?.from || !range?.to || selected.length === 0) return;
		setBusy(true);
		setError(null);
		setPhase("searching");
		try {
			const res = await findArticlesFn({
				data: {
					brandId,
					queries: selected.map((q) => ({ query: q.query, angle: q.angle })),
					direction: direction.trim() || undefined,
					from: ymd(range.from),
					to: ymd(range.to),
					pagesPerSearch: pages,
					excludeBrandMentions,
				},
			});
			setHigh(res.highAuthority);
			setNiche(res.nicheBlog);
			setStats(res.stats);
			setLoaded(null);
			setPhase("results");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Search failed.");
			setPhase("queries");
		} finally {
			setBusy(false);
		}
	}

	function newSearch() {
		setPhase("idle");
		setError(null);
	}

	function exportCsv() {
		const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
		const rows = [
			[
				"category",
				"fit score",
				"affiliate",
				"mentions brand",
				"article name",
				"article link",
				"published",
				"links competitor",
				"fit reasoning",
				"contact",
			]
				.map(esc)
				.join(","),
		];
		const add = (label: string, list: ArticleResult[]) => {
			for (const r of list)
				rows.push(
					[
						label,
						r.fitScore,
						r.affiliateStatus,
						r.brandAlreadyMentioned ? "yes" : "",
						r.title,
						r.url,
						r.publishedDate ?? "",
						r.linksCompetitor ? "yes" : "",
						r.verdict,
						r.contactHint ?? "",
					]
						.map(esc)
						.join(","),
				);
		};
		add("High-authority", filteredHigh);
		add("Niche / blog", filteredNiche);
		const blob = new Blob([`﻿${rows.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `article-finder-${(brand?.name ?? "brand")
			.replace(/[^\w.\- ]+/g, "")
			.trim()
			.replace(/\s+/g, "-")}-${ymd(new Date())}.csv`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

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
			subtitle="Western-market articles to pitch this brand to, cast a wide net and vetted for topical fit."
			infoContent="We expand your direction into many angled Google searches, drop results outside the US/Canada/UK/Europe/Australia/NZ and retailer/syndicated results, fetch and read the survivors, then check the best hits for other roundups on that same publisher. Every result is tagged for whether it mentions the brand and whether it shows real affiliate links, filter either on the results screen. The last run is saved, so reopening this tab is free."
			actions={
				phase === "results" ? (
					<>
						{queries.length > 0 && (
							<Button variant="ghost" size="sm" onClick={() => setPhase("queries")}>
								Queries
							</Button>
						)}
						<Button variant="ghost" size="sm" onClick={exportCsv} disabled={totalResults === 0 || isViewer}>
							Export
						</Button>
						<Button variant="outline" size="sm" onClick={newSearch}>
							New search
						</Button>
					</>
				) : undefined
			}
		>
			<div className="max-w-2xl">
				{phase === "idle" && (
					<div className="space-y-5">
						<Textarea
							rows={3}
							className="resize-none text-[15px] leading-relaxed"
							placeholder="Describe the articles you want to pitch this brand to. e.g. gift guides and roundups for premium steaks and meat boxes"
							value={direction}
							onChange={(e) => setDirection(e.target.value)}
							disabled={busy}
						/>

						<div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
							<div className="flex items-center gap-2">
								<span className="text-muted-foreground">Published</span>
								<RangeInline value={range} onChange={setRange} />
							</div>
							<div className="flex items-center gap-2">
								<span className="text-muted-foreground">Depth</span>
								<div className="flex overflow-hidden rounded-md border">
									{[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
										<button
											key={n}
											type="button"
											onClick={() => setPages(n)}
											disabled={busy}
											className={cn(
												"h-8 w-8 text-xs tabular-nums transition-colors",
												pages === n ? "bg-primary text-primary-foreground" : "hover:bg-accent",
											)}
										>
											{n}
										</button>
									))}
								</div>
							</div>
						</div>

						<div className="space-y-2.5 border-t pt-4 text-sm">
							<label className="flex cursor-pointer items-center justify-between gap-4">
								<span>
									Skip articles that already mention {brand?.name ?? "the brand"}{" "}
									<span className="text-xs text-muted-foreground">
										(cheaper: fewer wasted fetches, not just hidden)
									</span>
								</span>
								<Switch checked={excludeBrandMentions} onCheckedChange={setExcludeBrandMentions} disabled={busy} />
							</label>
							<p className="text-xs text-muted-foreground">
								We cast as wide a net as we can, dedupe and vet the results, then check the best hits for other roundups
								on that same publisher. Whether it's affiliate-monetized is a filter on the results screen, not a setting
								here, more depth means a wider net and a higher cost per search.
							</p>
						</div>

						{error && <p className="text-sm text-destructive">{error}</p>}

						<Button onClick={genQueries} disabled={!canBuild} className="gap-2">
							{busy ? <IconLoader2 className="size-4 animate-spin" /> : <IconBolt className="size-4" />}
							{busy ? "Thinking…" : "Build search"}
						</Button>
					</div>
				)}

				{(phase === "queries" || phase === "searching") && (
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">Review queries</span>
							<div className="flex gap-4 text-xs text-muted-foreground">
								<button
									type="button"
									onClick={genQueries}
									disabled={busy || isViewer}
									className="transition-colors hover:text-foreground"
								>
									Regenerate
								</button>
								<button
									type="button"
									onClick={() => setPhase(totalResults > 0 ? "results" : "idle")}
									disabled={busy}
									className="transition-colors hover:text-foreground"
								>
									{totalResults > 0 ? "Back" : "Edit"}
								</button>
							</div>
						</div>
						<ul className="-mx-2">
							{queries.map((q, i) => (
								<li key={q.query}>
									<label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent">
										<Checkbox
											checked={q.on}
											onCheckedChange={(v) =>
												setQueries((qs) => qs.map((x, j) => (j === i ? { ...x, on: v === true } : x)))
											}
											disabled={busy}
											className="mt-0.5"
										/>
										<span className="text-sm">{q.query}</span>
									</label>
								</li>
							))}
						</ul>
						{!isViewer && queries.length < MAX_QUERIES_UI && (
							<div className="flex items-center gap-2">
								<input
									type="text"
									value={newQuery}
									onChange={(e) => setNewQuery(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											e.preventDefault();
											addQuery();
										}
									}}
									placeholder="Add your own query, e.g. best grilling gifts for dad"
									disabled={busy}
									className="h-9 flex-1 rounded-md border bg-transparent px-3 text-sm outline-none focus:border-primary"
								/>
								<Button type="button" variant="outline" size="sm" onClick={addQuery} disabled={busy || !newQuery.trim()}>
									Add
								</Button>
							</div>
						)}
						<Button onClick={run} disabled={busy || selected.length === 0 || isViewer} className="gap-2">
							{phase === "searching" ? (
								<IconLoader2 className="size-4 animate-spin" />
							) : (
								<IconSearch className="size-4" />
							)}
							{phase === "searching"
								? "Searching and vetting…"
								: `Search ${selected.length} ${selected.length === 1 ? "query" : "queries"}`}
						</Button>
						{phase === "searching" && <p className="text-xs text-muted-foreground">Takes about a minute or two.</p>}
					</div>
				)}

				{phase === "results" && (
					<div className="space-y-6">
						{loaded && (
							<p className="text-xs text-muted-foreground">
								Last run by {loaded.by} · {prettyAt(loaded.at)}
							</p>
						)}

						<div className="space-y-3 border-b pb-4">
							<div className="flex flex-wrap items-center gap-x-6 gap-y-2.5 text-sm">
								<div className="flex items-center gap-2">
									<span className="text-muted-foreground">Mentions {brand?.name ?? "brand"}</span>
									<div className="flex overflow-hidden rounded-md border">
										{(
											[
												["all", "Any"],
												["unmentioned", "No"],
												["mentioned", "Yes"],
											] as const
										).map(([v, label]) => (
											<button
												key={v}
												type="button"
												onClick={() => setMentionFilter(v)}
												className={cn(
													"h-8 px-2.5 text-xs transition-colors",
													mentionFilter === v ? "bg-primary text-primary-foreground" : "hover:bg-accent",
												)}
											>
												{label}
											</button>
										))}
									</div>
								</div>
								<div className="flex items-center gap-2">
									<span className="text-muted-foreground">Affiliate</span>
									<div className="flex overflow-hidden rounded-md border">
										{(
											[
												["yes", "Confirmed"],
												["unsure", "Unsure"],
												["no", "Not affiliate"],
											] as const
										).map(([v, label]) => (
											<button
												key={v}
												type="button"
												onClick={() => toggleAffiliateFilter(v)}
												className={cn(
													"h-8 px-2.5 text-xs transition-colors",
													affiliateFilter.has(v) ? "bg-primary text-primary-foreground" : "hover:bg-accent",
												)}
											>
												{label}
											</button>
										))}
									</div>
								</div>
							</div>

							<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
								<span className="font-semibold">
									{filteredCount} of {totalResults} article{totalResults === 1 ? "" : "s"}
								</span>
								{filteredCount > 0 && (
									<span className="text-muted-foreground">
										{filteredHigh.length} high-authority · {filteredNiche.length} niche
									</span>
								)}
								{(dropParts.length > 0 || foundParts.length > 0) && (
									<details className="ml-auto text-xs text-muted-foreground">
										<summary className="cursor-pointer list-none transition-colors hover:text-foreground">
											{stats?.candidates ?? 0} checked
										</summary>
										<p className="mt-2 max-w-md text-right leading-relaxed">
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
								title="Nothing cleared vetting"
								description="Try a broader direction, a wider date range, or more depth."
							/>
						) : filteredCount === 0 ? (
							<EmptyState
								icon={IconSearch}
								title="Nothing matches these filters"
								description="Loosen the mentions/affiliate filters above, the results are still there."
							/>
						) : (
							<div className="space-y-7">
								{filteredHigh.length > 0 && (
									<section>
										<SectionHeading count={filteredHigh.length}>High authority</SectionHeading>
										<div className="divide-y">
											{filteredHigh.map((r) => (
												<ArticleRow key={r.url} r={r} brandName={brand?.name} />
											))}
										</div>
									</section>
								)}
								{filteredNiche.length > 0 && (
									<section>
										<SectionHeading count={filteredNiche.length}>Niche &amp; blog</SectionHeading>
										<div className="divide-y">
											{filteredNiche.map((r) => (
												<ArticleRow key={r.url} r={r} brandName={brand?.name} />
											))}
										</div>
									</section>
								)}
							</div>
						)}
					</div>
				)}
			</div>
		</PageHeader>
	);
}
