/**
 * /app/$brand/reports — build a two-page AI-visibility report and download it as PDF.
 * One report per brand per rolling 7 days (enforced server-side).
 */
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Calendar } from "@workspace/ui/components/calendar";
import { Card, CardContent } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Switch } from "@workspace/ui/components/switch";
import { IconCalendar, IconReport, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";
import type { DateRange } from "react-day-picker";
import { PageHeader } from "@/components/page-header";
import { ReportDocument, type ReportDocProps } from "@/components/report/report-document";
import { useBrand } from "@/hooks/use-brands";
import { downloadReportPdf } from "@/lib/report-pdf";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";
import { generateBrandReportFn, getLatestBrandReportFn, getReportAvailabilityFn } from "@/server/brand-reports";

export const Route = createFileRoute("/_authed/app/$brand/reports")({
	head: ({ matches, match }) => ({
		meta: [
			{ title: buildTitle("Reports", { appName: getAppName(match), brandName: getBrandName(matches) }) },
			{ name: "description", content: "Generate a two-page AI-visibility report over any period." },
		],
	}),
	component: ReportsPage,
});

function ymd(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function pretty(d?: Date): string {
	return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
}
function prettyAt(iso: string): string {
	return new Date(iso).toLocaleString("en-US", {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	});
}

function RangeField({ value, onChange, label }: { value?: DateRange; onChange: (r?: DateRange) => void; label: string }) {
	return (
		<div className="space-y-1.5">
			<Label>{label}</Label>
			<Popover>
				<PopoverTrigger render={<Button variant="outline" className="w-full justify-start gap-2 font-normal" />}>
					<IconCalendar className="size-4" />
					{value?.from ? `${pretty(value.from)} \u2013 ${pretty(value.to)}` : "Pick a range"}
				</PopoverTrigger>
				<PopoverContent className="w-auto p-0" align="start">
					<Calendar mode="range" numberOfMonths={2} selected={value} onSelect={onChange} defaultMonth={value?.from} />
				</PopoverContent>
			</Popover>
		</div>
	);
}

function ReportsPage() {
	const { brand: brandId } = Route.useParams();
	const { brand } = useBrand(brandId);

	const [range, setRange] = useState<DateRange | undefined>(() => {
		const to = new Date();
		const from = new Date();
		from.setDate(from.getDate() - 7);
		return { from, to };
	});
	const [compareOn, setCompareOn] = useState(false);
	const [compareRange, setCompareRange] = useState<DateRange | undefined>();
	const [name, setName] = useState("");
	const [status, setStatus] = useState<"idle" | "working" | "error">("idle");
	const [error, setError] = useState<string | null>(null);
	const [availability, setAvailability] = useState<{ canGenerate: boolean; nextAvailableAt: string | null } | null>(null);
	const [doc, setDoc] = useState<ReportDocProps | null>(null);
	const [lastReport, setLastReport] = useState<ReportDocProps & { createdAt: string } | null>(null);
	const docRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		getReportAvailabilityFn({ data: { brandId } })
			.then((a) => setAvailability({ canGenerate: a.canGenerate, nextAvailableAt: a.nextAvailableAt }))
			.catch(() => setAvailability({ canGenerate: true, nextAvailableAt: null }));
		getLatestBrandReportFn({ data: { brandId } })
			.then((r) =>
				r
					? setLastReport({
							brandName: r.brandName,
							periodLabel: r.periodLabel,
							compareLabel: r.compareLabel,
							digest: r.digest as ReportDocProps["digest"],
							narrative: r.narrative as ReportDocProps["narrative"],
							createdAt: String(r.createdAt),
						})
					: setLastReport(null),
			)
			.catch(() => setLastReport(null));
	}, [brandId]);

	// once a doc payload lands, snapshot it to a PDF and download
	useEffect(() => {
		if (!doc || !docRef.current) return;
		const pages = Array.from(docRef.current.querySelectorAll<HTMLElement>("[data-report-page]"));
		downloadReportPdf(pages, doc.name)
			.then(() => setStatus("idle"))
			.catch(() => {
				setStatus("error");
				setError("The report was generated but the PDF export failed. Try again.");
			})
			.finally(() => setDoc(null));
	}, [doc]);

	const inCooldown = availability && !availability.canGenerate;
	const nextLabel = availability?.nextAvailableAt ? prettyAt(availability.nextAvailableAt) : null;

	const canSubmit =
		status === "idle" &&
		!inCooldown &&
		name.trim().length > 0 &&
		range?.from &&
		range?.to &&
		(!compareOn || (compareRange?.from && compareRange?.to));

	async function generate() {
		if (!range?.from || !range?.to) return;
		setStatus("working");
		setError(null);
		try {
			const res = await generateBrandReportFn({
				data: {
					brandId,
					name: name.trim(),
					periodStart: ymd(range.from),
					periodEnd: ymd(range.to),
					...(compareOn && compareRange?.from && compareRange?.to
						? { compareStart: ymd(compareRange.from), compareEnd: ymd(compareRange.to) }
						: {}),
				},
			});
			setDoc({
				brandName: res.brandName,
				periodLabel: res.periodLabel,
				compareLabel: res.compareLabel,
				digest: res.digest,
				narrative: res.narrative,
			});
			// refresh cooldown
			getReportAvailabilityFn({ data: { brandId } }).then((a) =>
				setAvailability({ canGenerate: a.canGenerate, nextAvailableAt: a.nextAvailableAt }),
			);
		} catch (e) {
			setStatus("error");
			setError(e instanceof Error ? e.message : "Report generation failed.");
		}
	}

	return (
		<PageHeader title="Reports" subtitle="A two-page AI-visibility report for any period, generated from this brand's tracked data.">
			<Card className="max-w-2xl">
				<CardContent className="space-y-5 pt-6">
					{inCooldown && nextLabel && (
						<div className="rounded-lg border border-pink-200 bg-pink-50 px-4 py-3 text-sm text-pink-900 dark:border-pink-900/50 dark:bg-pink-950/30 dark:text-pink-200">
							A report was generated for <strong>{brand?.name}</strong> in the last 7 days. Next report available{" "}
							<strong>{nextLabel}</strong>.
						</div>
					)}

					<div className="space-y-1.5">
						<Label htmlFor="report-name">Report name</Label>
						<Input
							id="report-name"
							placeholder={`${brand?.name ?? "Brand"} visibility — ${pretty(range?.from)} to ${pretty(range?.to)}`}
							value={name}
							onChange={(e) => setName(e.target.value)}
							disabled={status === "working" || Boolean(inCooldown)}
						/>
					</div>

					<RangeField label="Report period" value={range} onChange={setRange} />

					<div className="flex items-center gap-3">
						<Switch id="cmp" checked={compareOn} onCheckedChange={setCompareOn} disabled={status === "working"} />
						<Label htmlFor="cmp" className="cursor-pointer">Compare to another period</Label>
					</div>
					{compareOn && <RangeField label="Comparison period" value={compareRange} onChange={setCompareRange} />}

					{error && <p className="text-sm text-destructive">{error}</p>}

					<Button
						onClick={generate}
						disabled={!canSubmit}
						className="h-11 gap-2 rounded-xl bg-pink-500 px-5 font-semibold text-white shadow-lg shadow-pink-500/25 hover:bg-pink-600 disabled:opacity-60"
					>
						{status === "working" ? <IconLoader2 className="size-5 animate-spin" /> : <IconReport className="size-5" />}
						{status === "working" ? "Generating…" : inCooldown ? `Next available ${nextLabel ?? "soon"}` : "Generate report"}
					</Button>

					<p className="text-xs text-muted-foreground">
						One report per brand per week. Any range is allowed — the limit is on how often you generate, not what you analyze.
						The PDF downloads automatically when it's ready.
					</p>

					{lastReport && (
						<div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4 text-sm">
							<span className="text-muted-foreground">
								Last report: <strong>{lastReport.periodLabel}</strong>
							</span>
							<Button
								variant="outline"
								size="sm"
								onClick={() => {
									setStatus("working");
									setDoc({
										brandName: lastReport.brandName,
										periodLabel: lastReport.periodLabel,
										compareLabel: lastReport.compareLabel,
										digest: lastReport.digest,
										narrative: lastReport.narrative,
									});
								}}
							>
								Download PDF again
							</Button>
						</div>
					)}
				</CardContent>
			</Card>

			{doc && <ReportDocument ref={docRef} {...doc} />}
		</PageHeader>
	);
}
