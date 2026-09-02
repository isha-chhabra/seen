/**
 * /app/$brand/article-finder: turn a free-text direction into a vetted list of
 * US affiliate articles to pitch this brand to, split by publisher authority.
 * The latest run per brand is persisted, so opening the tab shows it for free.
 */
import { createFileRoute } from "@tanstack/react-router";
import { IconBolt, IconCalendar, IconExternalLink, IconLoader2, IconMail, IconRefresh, IconSearch, IconTable } from "@tabler/icons-react";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Calendar } from "@workspace/ui/components/calendar";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Label } from "@workspace/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Switch } from "@workspace/ui/components/switch";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { useEffect, useState } from "react";
import type { DateRange } from "react-day-picker";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { ScorePill } from "@/components/score-pill";
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
function pretty(d?: Date): string {
	return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
}
function prettyAt(iso: string): string {
	return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function RangeField({ value, onChange, label }: { value?: DateRange; onChange: (r?: DateRange) => void; label: string }) {
	return (
		<div className="space-y-1.5">
			<Label>{label}</Label>
			<Popover>
				<PopoverTrigger render={<Button variant="outline" className="w-full justify-start gap-2 font-normal" />}>
					<IconCalendar className="size-4" />
					{value?.from ? `${pretty(value.from)} to ${pretty(value.to)}` : "Pick a range"}
				</PopoverTrigger>
				<PopoverContent className="w-auto p-0" align="start">
					<Calendar mode="range" numberOfMonths={2} selected={value} onSelect={onChange} defaultMonth={value?.from} />
				</PopoverContent>
			</Popover>
		</div>
	);
}

type Query = { query: string; angle?: string; on: boolean };
type Phase = "idle" | "queries" | "searching" | "results";

function ArticleRow({ r, brandName }: { r: ArticleResult; brandName?: string }) {
	const contactIsEmail = r.contactHint?.includes("@") && !r.contactHint.startsWith("http");
	const merchantCount = r.merchants?.length ?? 0;
	const meta = [
		r.domain,
		r.publishedDate || null,
		merchantCount > 0 ? `${merchantCount} retailer${merchantCount === 1 ? "" : "s"} linked` : null,
	]
		.filter(Boolean)
		.join("   ·   ");
	return (
		<div
			className={cn(
				"flex gap-3 rounded-xl border bg-card p-4 transition-colors hover:border-primary/30",
				r.linksCompetitor && "border-l-[3px] border-l-primary",
			)}
		>
			<ScorePill score={r.fitScore} />
			<div className="min-w-0 flex-1 space-y-1">
				<a
					href={r.url}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-start gap-1 text-sm font-medium hover:text-primary hover:underline"
				>
					{r.title}
					<IconExternalLink className="mt-0.5 size-3 shrink-0 opacity-40" />
				</a>
				<p className="text-xs text-muted-foreground">{meta}</p>
				<p className="text-[13px] leading-relaxed text-foreground/90">{r.verdict}</p>
				<div className="flex flex-wrap items-center gap-1.5 pt-1">
					{r.linksCompetitor && <Badge variant="accent">competitor linked</Badge>}
					{r.relevance === "weak" && <span className="text-[11px] text-muted-foreground">loose fit</span>}
					{r.competitorsMentioned.length > 0 && (
						<Badge variant="quiet">mentions {r.competitorsMentioned.slice(0, 2).join(", ")}</Badge>
					)}
					{r.brandAlreadyMentioned && <Badge variant="quiet">mentions {brandName ?? "the brand"}</Badge>}
					{r.signals.map((s) => (
						<Badge key={s} variant="quiet">
							{s}
						</Badge>
					))}
					{r.contactHint &&
						(contactIsEmail ? (
							<a
								href={`mailto:${r.contactHint}`}
								className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary hover:underline"
							>
								<IconMail className="size-3" />
								{r.contactHint}
							</a>
						) : (
							<a
								href={r.contactHint}
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary hover:underline"
							>
								<IconMail className="size-3" />
								contact
							</a>
						))}
				</div>
			</div>
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
	const [loading, setLoading] = useState(true);

	// on open: show the last saved search for this brand, for free
	useEffect(() => {
		let cancelled = false;
		setLoading(true);
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
			.catch(() => {})
			.finally(() => !cancelled && setLoading(false));
		return () => {
			cancelled = true;
		};
	}, [brandId]);

	const selected = queries.filter((q) => q.on);
	const totalResults = high.length + niche.length;

	async function genQueries() {
		if (!range?.from || !range?.to || direction.trim().length < 3) return;
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

	const pinkBtn = "h-11 w-full gap-2 text-sm font-semibold";

	const dropParts = stats
		? [
				stats.droppedOffTopic ? `${stats.droppedOffTopic} off-topic` : "",
				stats.droppedNotAffiliate ? `${stats.droppedNotAffiliate} not an affiliate outlet` : "",
				stats.droppedThinAffiliate ? `${stats.droppedThinAffiliate} no confirmable affiliate links` : "",
				stats.droppedLowScore ? `${stats.droppedLowScore} scored too low` : "",
				stats.droppedStale ? `${stats.droppedStale} stale` : "",
				stats.droppedNonUs ? `${stats.droppedNonUs} non-US` : "",
				stats.droppedRetailer ? `${stats.droppedRetailer} retailers` : "",
				stats.droppedSyndicated ? `${stats.droppedSyndicated} syndicated` : "",
				stats.droppedDupePublisher ? `${stats.droppedDupePublisher} extra from same site` : "",
				stats.droppedAlreadyFeatured ? `${stats.droppedAlreadyFeatured} already feature ${brand?.name ?? "the brand"}` : "",
			].filter(Boolean)
		: [];

	return (
		<PageHeader
			title="Article Finder"
			subtitle="Find US articles to pitch this brand to. Vetted for topical fit and affiliate links, but skim before you send."
		>
			<div className="max-w-3xl space-y-6">
				{phase !== "results" && (
					<Card>
						<CardContent className="space-y-5 pt-6">
							<div className="space-y-1.5">
								<Label htmlFor="direction">What articles are you looking for?</Label>
								<Textarea
									id="direction"
									rows={3}
									placeholder="e.g. gift guides for eco-friendly kitchen products"
									value={direction}
									onChange={(e) => setDirection(e.target.value)}
									disabled={busy}
								/>
							</div>

							<RangeField label="Published between" value={range} onChange={setRange} />

							<div className="space-y-1.5">
								<Label>Result pages per search</Label>
								<div className="flex gap-1.5">
									{[1, 2, 3, 4, 5].map((n) => (
										<Button
											key={n}
											type="button"
											size="sm"
											variant={pages === n ? "default" : "outline"}
											
											onClick={() => setPages(n)}
											disabled={busy}
										>
											{n}
										</Button>
									))}
								</div>
								<p className="text-xs text-muted-foreground">More pages, more results, higher cost. Two is usually enough.</p>
							</div>

							<div className="flex items-center justify-between gap-4">
								<Label htmlFor="fresh-only" className="font-normal">
									Hide articles that already mention {brand?.name ?? "the brand"}
								</Label>
								<Switch id="fresh-only" checked={freshOnly} onCheckedChange={setFreshOnly} disabled={busy} />
							</div>

							<div className="flex items-center justify-between gap-4">
								<Label htmlFor="strict" className="font-normal">
									Strict: only outlets with confirmed affiliate links
								</Label>
								<Switch id="strict" checked={strict} onCheckedChange={setStrict} disabled={busy} />
							</div>

							{error && <p className="text-sm text-destructive">{error}</p>}

							{phase === "idle" && (
								<Button
									onClick={genQueries}
									disabled={busy || direction.trim().length < 3 || !range?.from || !range?.to}
									className={pinkBtn}
								>
									{busy ? <IconLoader2 className="size-5 animate-spin" /> : <IconBolt className="size-5" />}
									{busy ? "Thinking…" : "Generate search queries"}
								</Button>
							)}
						</CardContent>
					</Card>
				)}

				{(phase === "queries" || phase === "searching") && (
					<Card>
						<CardContent className="space-y-4 pt-6">
							<div className="flex items-center justify-between">
								<h3 className="text-sm font-semibold">Search queries</h3>
								<div className="flex gap-1">
									<Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={genQueries} disabled={busy}>
										<IconRefresh className="size-3.5" />
										Regenerate
									</Button>
									{totalResults > 0 && (
										<Button variant="ghost" size="sm" className="text-xs" onClick={() => setPhase("results")} disabled={busy}>
											Back to results
										</Button>
									)}
								</div>
							</div>
							<p className="text-xs text-muted-foreground">Uncheck any you don't want, then search.</p>
							<ul className="space-y-2">
								{queries.map((q, i) => (
									<li key={`${q.query}-${i}`} className="flex items-start gap-3 rounded-lg border p-3">
										<Checkbox
											checked={q.on}
											onCheckedChange={(v) => setQueries((qs) => qs.map((x, j) => (j === i ? { ...x, on: v === true } : x)))}
											disabled={busy}
											className="mt-0.5"
										/>
										<div className="min-w-0">
											<p className="text-sm">{q.query}</p>
											{q.angle && <p className="mt-0.5 text-xs text-muted-foreground">{q.angle}</p>}
										</div>
									</li>
								))}
							</ul>
							<Button onClick={run} disabled={busy || selected.length === 0} className={pinkBtn}>
								{phase === "searching" ? (
									<IconLoader2 className="size-5 animate-spin" />
								) : (
									<IconSearch className="size-5" />
								)}
								{phase === "searching"
									? "Searching and vetting..."
									: `Find articles (${selected.length} ${selected.length === 1 ? "query" : "queries"})`}
							</Button>
							{phase === "searching" && (
								<p className="text-xs text-muted-foreground">Takes about a minute or two.</p>
							)}
						</CardContent>
					</Card>
				)}

				{phase === "results" && (
					<Card>
						<CardContent className="space-y-5 pt-6">
							{loaded && (
								<div className="rounded-xl border border-highlight-border bg-highlight px-4 py-3 text-sm text-highlight-foreground">
									Last search by <strong>{loaded.by}</strong>, {prettyAt(loaded.at)}. Reopening is free.
								</div>
							)}
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div>
									<h3 className="text-sm font-semibold">
										{totalResults} article{totalResults === 1 ? "" : "s"}: {high.length} high-authority, {niche.length}{" "}
										niche/blog
									</h3>
									{stats && (
										<p className="text-xs text-muted-foreground">
											{stats.candidates ?? 0} candidates, {stats.pagesFetched ?? 0} pages fetched
										</p>
									)}
									{dropParts.length > 0 && (
										<p className="text-xs text-muted-foreground">Filtered out: {dropParts.join(", ")}</p>
									)}
								</div>
								<div className="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										className="gap-1.5"
										onClick={exportCsv}
										disabled={totalResults === 0}
									>
										<IconTable className="size-4" />
										Export CSV
									</Button>
									{queries.length > 0 && (
										<Button variant="ghost" size="sm" onClick={() => setPhase("queries")}>
											Edit queries
										</Button>
									)}
									<Button variant="ghost" size="sm" className="gap-1.5" onClick={newSearch}>
										<IconRefresh className="size-4" />
										New search
									</Button>
								</div>
							</div>

							{totalResults === 0 ? (
								<EmptyState
									icon={IconSearch}
									title="Nothing cleared vetting"
									description="Try a broader direction, a wider date range, or more pages per search."
								/>
							) : (
								<div className="space-y-8">
									{high.length > 0 && (
										<section>
											<SectionHeading count={high.length}>High-authority publications</SectionHeading>
											<div className="space-y-2">
												{high.map((r) => (
													<ArticleRow key={r.url} r={r} brandName={brand?.name} />
												))}
											</div>
										</section>
									)}
									{niche.length > 0 && (
										<section>
											<SectionHeading count={niche.length}>Niche &amp; blog sites</SectionHeading>
											<div className="space-y-2">
												{niche.map((r) => (
													<ArticleRow key={r.url} r={r} brandName={brand?.name} />
												))}
											</div>
										</section>
									)}
								</div>
							)}
						</CardContent>
					</Card>
				)}

				{phase === "idle" && !loading && (
					<p className="max-w-xl text-xs text-muted-foreground">
						We turn your direction into Google searches, drop non-US, retailer and syndicated results, then check each page
						for real affiliate links and score how likely an editor is to feature the brand. Results split by publisher
						authority. The last run is saved, so reopening this tab is free.
					</p>
				)}
			</div>
		</PageHeader>
	);
}
