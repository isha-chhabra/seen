/**
 * /app/$brand/article-finder — turn a free-text content direction into a list of
 * published affiliate articles this brand could be pitched into.
 *
 * Stateless: nothing is saved, every search starts fresh. Two steps —
 * generate + review queries, then run them (SERP → affiliate filter → fit note).
 */
import { createFileRoute } from "@tanstack/react-router";
import { IconBolt, IconCalendar, IconExternalLink, IconLoader2, IconRefresh, IconSearch, IconTable } from "@tabler/icons-react";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Calendar } from "@workspace/ui/components/calendar";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Label } from "@workspace/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Textarea } from "@workspace/ui/components/textarea";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { PageHeader } from "@/components/page-header";
import { useBrand } from "@/hooks/use-brands";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";
import { type ArticleResult, findArticlesFn, generateArticleQueriesFn } from "@/server/article-finder";

export const Route = createFileRoute("/_authed/app/$brand/article-finder")({
	head: ({ matches, match }) => ({
		meta: [
			{ title: buildTitle("Article Finder", { appName: getAppName(match), brandName: getBrandName(matches) }) },
			{ name: "description", content: "Find published affiliate articles this brand could be pitched into." },
		],
	}),
	component: ArticleFinderPage,
});

function ymd(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function pretty(d?: Date): string {
	return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
}

function RangeField({ value, onChange, label }: { value?: DateRange; onChange: (r?: DateRange) => void; label: string }) {
	return (
		<div className="space-y-1.5">
			<Label>{label}</Label>
			<Popover>
				<PopoverTrigger render={<Button variant="outline" className="w-full justify-start gap-2 font-normal" />}>
					<IconCalendar className="size-4" />
					{value?.from ? `${pretty(value.from)} – ${pretty(value.to)}` : "Pick a range"}
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
	const [phase, setPhase] = useState<Phase>("idle");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [queries, setQueries] = useState<Query[]>([]);
	const [results, setResults] = useState<ArticleResult[]>([]);
	const [stats, setStats] = useState<Record<string, number> | null>(null);

	const selected = queries.filter((q) => q.on);

	async function genQueries() {
		if (!range?.from || !range?.to || direction.trim().length < 3) return;
		setBusy(true);
		setError(null);
		try {
			const res = await generateArticleQueriesFn({
				data: { brandId, direction: direction.trim(), from: ymd(range.from), to: ymd(range.to) },
			});
			setQueries(res.queries.map((q) => ({ query: q.query, angle: q.angle, on: true })));
			setResults([]);
			setStats(null);
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
					from: ymd(range.from),
					to: ymd(range.to),
					pagesPerSearch: pages,
				},
			});
			setResults(res.results);
			setStats(res.stats);
			setPhase("results");
		} catch (e) {
			setError(e instanceof Error ? e.message : "Search failed.");
			setPhase("queries");
		} finally {
			setBusy(false);
		}
	}

	function reset() {
		setPhase("idle");
		setQueries([]);
		setResults([]);
		setStats(null);
		setError(null);
	}

	function exportCsv() {
		const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
		const rows = [["article name", "article link", "fit reasoning"].map(esc).join(",")];
		for (const r of results) rows.push([esc(r.title), esc(r.url), esc(r.reasoning)].join(","));
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

	const pinkBtn =
		"h-11 gap-2 rounded-xl bg-pink-500 px-5 font-semibold text-white shadow-lg shadow-pink-500/25 hover:bg-pink-600 disabled:opacity-60";

	return (
		<PageHeader
			title="Article Finder"
			subtitle="Find published affiliate articles and roundups you could pitch this brand into. Best-effort — it reads pages and looks for affiliate signals, so expect the occasional miss."
		>
			<div className="max-w-3xl space-y-6">
				<Card>
					<CardContent className="space-y-5 pt-6">
						<div className="space-y-1.5">
							<Label htmlFor="direction">What kind of articles are you looking for?</Label>
							<Textarea
								id="direction"
								rows={3}
								placeholder="e.g. gift guides and product roundups for eco-friendly kitchen gear, aimed at home cooks"
								value={direction}
								onChange={(e) => setDirection(e.target.value)}
								disabled={busy}
							/>
						</div>

						<RangeField label="Published between" value={range} onChange={setRange} />

						<div className="space-y-1.5">
							<Label>Pages of results per search</Label>
							<div className="flex gap-1.5">
								{[1, 2, 3, 4, 5].map((n) => (
									<Button
										key={n}
										type="button"
										size="sm"
										variant={pages === n ? "default" : "outline"}
										className={pages === n ? "bg-pink-500 text-white hover:bg-pink-600" : ""}
										onClick={() => setPages(n)}
										disabled={busy}
									>
										{n}
									</Button>
								))}
							</div>
							<p className="text-xs text-muted-foreground">
								More pages means more candidates and a higher cost per search. Two is enough for most directions.
							</p>
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
									<Button variant="ghost" size="sm" className="text-xs" onClick={reset} disabled={busy}>
										Start over
									</Button>
								</div>
							</div>
							<p className="text-xs text-muted-foreground">
								These run on Google through your BrightData SERP zone. Uncheck any you don't want.
							</p>
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
									? "Searching & checking pages…"
									: `Find articles (${selected.length} ${selected.length === 1 ? "query" : "queries"})`}
							</Button>
							{phase === "searching" && (
								<p className="text-xs text-muted-foreground">
									Running the queries, fetching candidate pages, and checking each for affiliate signals. This usually
									takes one to two minutes.
								</p>
							)}
						</CardContent>
					</Card>
				)}

				{phase === "results" && (
					<Card>
						<CardContent className="space-y-4 pt-6">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<div>
									<h3 className="text-sm font-semibold">
										{results.length} article{results.length === 1 ? "" : "s"}
									</h3>
									{stats && (
										<p className="text-xs text-muted-foreground">
											{stats.candidates} candidates from {stats.serpRequests} searches · {stats.pagesFetched} pages checked
										</p>
									)}
								</div>
								<div className="flex gap-2">
									<Button
										variant="outline"
										size="sm"
										className="gap-1.5"
										onClick={exportCsv}
										disabled={results.length === 0}
									>
										<IconTable className="size-4" />
										Export CSV
									</Button>
									<Button variant="ghost" size="sm" className="gap-1.5" onClick={reset}>
										<IconRefresh className="size-4" />
										New search
									</Button>
								</div>
							</div>

							{results.length === 0 ? (
								<p className="py-6 text-center text-sm text-muted-foreground">
									No affiliate-monetized articles matched. Try a broader direction, a wider date range, or more pages per
									search.
								</p>
							) : (
								<ul className="divide-y">
									{results.map((r) => (
										<li key={r.url} className="space-y-1.5 py-4">
											<a
												href={r.url}
												target="_blank"
												rel="noreferrer"
												className="inline-flex items-start gap-1.5 font-medium text-pink-600 hover:underline dark:text-pink-400"
											>
												{r.title}
												<IconExternalLink className="mt-0.5 size-3.5 shrink-0 opacity-60" />
											</a>
											<p className="text-xs text-muted-foreground">{r.domain}</p>
											<p className="text-sm">{r.reasoning}</p>
											<div className="flex flex-wrap gap-1.5 pt-0.5">
												{r.competitorsMentioned.map((c) => (
													<Badge key={c} className="bg-amber-500/90 text-white hover:bg-amber-500/90">
														Mentions {c}
													</Badge>
												))}
												{r.brandAlreadyMentioned && (
													<Badge variant="outline">Already mentions {brand?.name ?? "the brand"}</Badge>
												)}
												{r.signals.map((s) => (
													<Badge key={s} variant="secondary" className="font-normal">
														{s}
													</Badge>
												))}
											</div>
										</li>
									))}
								</ul>
							)}
						</CardContent>
					</Card>
				)}

				{phase === "idle" && (
					<p className="max-w-2xl text-xs text-muted-foreground">
						How it works: an LLM turns your direction into a handful of Google searches (you review them first), the
						results run through your BrightData SERP zone, then each candidate page is fetched and checked for affiliate
						signals — <code>rel="sponsored"</code> links, affiliate networks, tracking parameters, disclosure text — or a
						match against a list of known affiliate publishers. Surviving articles get a one-line fit note. Nothing is
						saved; every search starts fresh.
					</p>
				)}
			</div>
		</PageHeader>
	);
}
