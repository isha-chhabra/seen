/**
 * /app/$brand/reports, build a two-page AI-visibility report and download it as PDF.
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
import { useBrand, useBrandRole } from "@/hooks/use-brands";
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
	return d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
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
	const { isViewer } = useBrandRole(brandId);

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
	const [doc, setDoc] = useState<(ReportDocProps & { fileName: string }) | null>(null);
	const [lastReport, setLastReport] = useState<(ReportDocProps & { createdAt: string; name: string }) | null>(null);
	const docRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		getReportAvailabilityFn({ data: { brandId } })
			.then((a) => setAvailability({ canGenerate: a.canGenerate, nextAvailableAt: a.nextAvailableAt }))
			.catch(() => setAvailability({ canGenerate: true, nextAvailableAt: null }));
		getLatestBrandReportFn({ data: { brandId } })
			.then((r) =>
				r
					? setLastReport({
							name: r.name,
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
		downloadReportPdf(pages, doc.fileName)
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
		!isViewer &&
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
				fileName: name.trim(),
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
		<PageHeader title="Reports" subtitle="A client-facing PDF report from this brand's tracked data.">
			<div className="max-w-xl space-y-4">
				<Card>
					<CardContent className="space-y-5 pt-6">
						{inCooldown && nextLabel && (
							<div className="rounded-xl border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
								One report per week. Next available <span className="font-medium text-foreground">{nextLabel}</span>.
							</div>
						)}

						<div className="space-y-1.5">
							<Label htmlFor="report-name">Report name</Label>
							<Input
								id="report-name"
								placeholder={`${brand?.name ?? "Brand"} visibility, ${pretty(range?.from)} to ${pretty(range?.to)}`}
								value={name}
								onChange={(e) => setName(e.target.value)}
								disabled={status === "working" || Boolean(inCooldown)}
							/>
						</div>

						<RangeField label="Report period" value={range} onChange={setRange} />

						<div className="flex items-center gap-3">
							<Switch id="cmp" checked={compareOn} onCheckedChange={setCompareOn} disabled={status === "working"} />
							<Label htmlFor="cmp" className="cursor-pointer font-normal">
								Compare to another period
							</Label>
						</div>
						{compareOn && <RangeField label="Comparison period" value={compareRange} onChange={setCompareRange} />}

						{error && <p className="text-sm text-destructive">{error}</p>}

						<Button onClick={generate} disabled={!canSubmit} className="h-11 w-full gap-2 font-semibold">
							{status === "working" ? <IconLoader2 className="size-4 animate-spin" /> : <IconReport className="size-4" />}
							{status === "working" ? "Generating…" : inCooldown ? `Next available ${nextLabel ?? "soon"}` : "Generate report"}
						</Button>

						<p className="text-xs text-muted-foreground">One report per brand per week. The PDF downloads automatically.</p>
					</CardContent>
				</Card>

				{lastReport && (
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 text-sm">
						<div className="min-w-0">
							<div className="font-medium">Last report</div>
							<div className="truncate text-xs text-muted-foreground">{lastReport.periodLabel}</div>
						</div>
						<Button
							variant="outline"
							size="sm"
							disabled={isViewer}
							onClick={() => {
								setStatus("working");
								setDoc({
									brandName: lastReport.brandName,
									periodLabel: lastReport.periodLabel,
									compareLabel: lastReport.compareLabel,
									digest: lastReport.digest,
									narrative: lastReport.narrative,
									fileName: lastReport.name || `${lastReport.brandName} report`,
								});
							}}
						>
							Download PDF
						</Button>
					</div>
				)}
			</div>

			{doc && <ReportDocument ref={docRef} {...doc} />}
		</PageHeader>
	);
}
