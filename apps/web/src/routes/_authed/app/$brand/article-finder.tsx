/**
 * /app/$brand/article-finder: turn a free-text direction into a vetted list of
 * US affiliate articles to pitch this brand to, split by publisher authority.
 * The latest run per brand is persisted, so opening the tab shows it for free.
 */
import { createFileRoute } from "@tanstack/react-router";
import { IconBolt, IconCalendar, IconLoader2, IconMail, IconSearch } from "@tabler/icons-react";
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
import { useBrand } from "@/hooks/use-brands";
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
			{ name: "description", content: "Find vetted US affiliate articles this brand could be pitched into." },
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
			{(r.linksCompetitor || r.brandAlreadyMentioned || r.relevance === "weak") && (
				<div className="mt-1.5 flex gap-3 pl-[38px] text-[11px]">
					{r.linksCompetitor && <span className="font-medium text-primary">Links a competitor</span>}
					{r.brandAlreadyMentioned && <span className="text-muted-foreground">Mentions {brandName ?? "the brand"}</span>}
					{r.relevance === "weak" && <span className="text-muted-foreground">Loose fit</span>}
				</div>
			)}
		</div>
	);
}

function ArticleFinderPage() {
	const { brand: brandId } = Route.useParams();
	const { brand } = useBrand(brandId);

	const [direction, setDirection] = useState("");
	const [range, setRange] = useState<DateRange | undefined>(() => {
		const to = new Date();
		const from = new Date();
		from.setMonth(from.getMonth() - 6);
		return { from, to };
	});
	const [pages, setPages] = useState(2);
	const [freshOnly, setFreshOnly] = useState(true);
	const [strict, setStrict] = useState(true);
	const [phase, setPhase] = useState<Phase>("idle");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [queries, setQueries] = useState<Query[]>([]);
	const [high, setHigh] = useState<ArticleResult[]>([]);
	const [niche, setNiche] = useState<ArticleResult[]>([]);
	const [stats, setStats] = useState<Record<string, number> | null>(null);
	const [loaded, setLoaded] = useState<{ at: string; by: string } | null>(null);

	// on open: show the last saved search for this brand, for free
	useEffect(() => {
		let cancelled = false;
		getLatestArticleSearchFn({ data: { brandId } })
			.then((r) => {
				if (cancelled || !r) return;
				setDirection(r.direction);
				if (r.from && r.to) setRange({ from: parseYmd(r.from), to: parseYmd(r.to) });
				setPages(r.pagesPerSearch || 2);
				setFreshOnly(r.freshOnly);
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

	const selected = queries.filter((q) => q.on);
	const totalResults = high.length + niche.length;
	const canBuild = !busy && direction.trim().length >= 3 && !!range?.from && !!range?.to;

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
					includeAlreadyFeatured: !freshOnly,
					strict,
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
			["category", "fit score", "article name", "article link", "published", "links competitor", "fit reasoning", "contact"]
				.map(esc)
				.join(","),
		];
		const add = (label: string, list: ArticleResult[]) => {
			for (const r of list)
				rows.push(
					[label, r.fitScore, r.title, r.url, r.publishedDate ?? "", r.linksCompetitor ? "yes" : "", r.verdict, r.contactHint ?? ""]
						.map(esc)
						.join(","),
				);
		};
		add("High-authority", high);
		add("Niche / blog", niche);
		const blob = new Blob([`﻿${rows.join("\r\n")}`], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `article-finder-${(brand?.name ?? "brand").replace(/[^\w.\- ]+/g, "").trim().replace(/\s+/g, "-")}-${ymd(new Date())}.csv`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	const dropParts = stats
		? [
				stats.droppedOffTopic ? `${stats.droppedOffTopic} off-topic` : "",
				stats.droppedNotAffiliate ? `${stats.droppedNotAffiliate} not affiliate` : "",
				stats.droppedThinAffiliate ? `${stats.droppedThinAffiliate} unconfirmed affiliate links` : "",
				stats.droppedLowScore ? `${stats.droppedLowScore} scored low` : "",
				stats.droppedStale ? `${stats.droppedStale} stale` : "",
				stats.droppedNonUs ? `${stats.droppedNonUs} non-US` : "",
				stats.droppedRetailer ? `${stats.droppedRetailer} retailers` : "",
				stats.droppedSyndicated ? `${stats.droppedSyndicated} syndicated` : "",
				stats.droppedDupePublisher ? `${stats.droppedDupePublisher} duplicate sites` : "",
				stats.droppedAlreadyFeatured ? `${stats.droppedAlreadyFeatured} already feature the brand` : "",
			].filter(Boolean)
		: [];

	return (
		<PageHeader
			title="Article Finder"
			subtitle="US articles to pitch this brand to, vetted for topical fit and affiliate links."
			infoContent="We turn your direction into US Google searches, drop non-US, retailer and syndicated results, then check each page for real affiliate links and score how likely an editor is to feature the brand. The last run is saved, so reopening this tab is free."
			actions={
				phase === "results" ? (
					<>
						{queries.length > 0 && (
							<Button variant="ghost" size="sm" onClick={() => setPhase("queries")}>
								Queries
							</Button>
						)}
						<Button variant="ghost" size="sm" onClick={exportCsv} disabled={totalResults === 0}>
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
									{[1, 2, 3, 4, 5].map((n) => (
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

						<details className="text-sm">
							<summary className="cursor-pointer list-none transition-colors hover:text-foreground marker:content-none [&::-webkit-details-marker]:hidden text-muted-foreground">
								Advanced options
							</summary>
							<div className="mt-3 space-y-3 border-l-2 pl-4">
								<label className="flex items-center justify-between gap-4">
									<span>Hide articles that already mention {brand?.name ?? "the brand"}</span>
									<Switch checked={freshOnly} onCheckedChange={setFreshOnly} disabled={busy} />
								</label>
								<label className="flex items-center justify-between gap-4">
									<span>Strict: only outlets with confirmed affiliate links</span>
									<Switch checked={strict} onCheckedChange={setStrict} disabled={busy} />
								</label>
								<p className="text-xs text-muted-foreground">More depth means more results and a higher cost per search.</p>
							</div>
						</details>

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
								<button type="button" onClick={genQueries} disabled={busy} className="transition-colors hover:text-foreground">
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
								<li key={`${q.query}-${i}`}>
									<label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent">
										<Checkbox
											checked={q.on}
											onCheckedChange={(v) => setQueries((qs) => qs.map((x, j) => (j === i ? { ...x, on: v === true } : x)))}
											disabled={busy}
											className="mt-0.5"
										/>
										<span className="text-sm">{q.query}</span>
									</label>
								</li>
							))}
						</ul>
						<Button onClick={run} disabled={busy || selected.length === 0} className="gap-2">
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

						<div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b pb-3 text-sm">
							<span className="font-semibold">
								{totalResults} article{totalResults === 1 ? "" : "s"}
							</span>
							{totalResults > 0 && (
								<span className="text-muted-foreground">
									{high.length} high-authority · {niche.length} niche
								</span>
							)}
							{dropParts.length > 0 && (
								<details className="ml-auto text-xs text-muted-foreground">
									<summary className="cursor-pointer list-none transition-colors hover:text-foreground">
										{stats?.candidates ?? 0} checked
									</summary>
									<p className="mt-2 max-w-md text-right leading-relaxed">Filtered out: {dropParts.join(", ")}.</p>
								</details>
							)}
						</div>

						{totalResults === 0 ? (
							<EmptyState
								icon={IconSearch}
								title="Nothing cleared vetting"
								description="Try a broader direction, a wider date range, or more depth."
							/>
						) : (
							<div className="space-y-7">
								{high.length > 0 && (
									<section>
										<SectionHeading count={high.length}>High authority</SectionHeading>
										<div className="divide-y">
											{high.map((r) => (
												<ArticleRow key={r.url} r={r} brandName={brand?.name} />
											))}
										</div>
									</section>
								)}
								{niche.length > 0 && (
									<section>
										<SectionHeading count={niche.length}>Niche &amp; blog</SectionHeading>
										<div className="divide-y">
											{niche.map((r) => (
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
