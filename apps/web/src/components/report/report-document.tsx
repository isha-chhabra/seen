/**
 * Offscreen two-page report, snapshotted to a PDF by downloadReportPdf().
 * US Letter at 96dpi (816 x 1056 px). Our own visual language: pink "seen"
 * wordmark, pink accents, clean analytics-report layout.
 */
import type { ReportNarrative } from "@workspace/lib/report/narrative";
import { forwardRef } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

interface ReportDigestView {
	headlineMetrics: {
		visibilityPct: number | null;
		shareOfVoicePct: number | null;
		totalRuns: number;
		trackedPrompts: number;
		visibilityDeltaPts?: number | null;
		shareOfVoiceDeltaPts?: number | null;
	};
	charts: {
		dailyVisibility: { date: string; visibility: number }[];
		engineMentionRate: { engine: string; pct: number }[];
		citationCategoryMix: Record<string, number>;
	};
}

const PINK = "#ec4899";
const INK = "#0f172a";
const MUTE = "#64748b";

export interface ReportDocProps {
	brandName: string;
	periodLabel: string;
	compareLabel: string | null;
	digest: ReportDigestView;
	narrative: ReportNarrative;
}

const pageStyle: React.CSSProperties = {
	width: 816,
	minHeight: 1056,
	background: "#fff",
	color: INK,
	padding: "56px 60px",
	fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
	boxSizing: "border-box",
};

function Wordmark() {
	return <span style={{ fontFamily: "'Titan One', system-ui", fontSize: 26, color: PINK, lineHeight: 1 }}>seen</span>;
}

function Header({ brandName, periodLabel, compareLabel, page }: ReportDocProps & { page: 1 | 2 }) {
	return (
		<div
			style={{
				display: "flex",
				justifyContent: "space-between",
				alignItems: "flex-start",
				borderBottom: `2px solid ${PINK}`,
				paddingBottom: 14,
				marginBottom: 26,
			}}
		>
			<div>
				<Wordmark />
				<div style={{ fontSize: 20, fontWeight: 700, marginTop: 8 }}>{brandName} — AI Visibility Report</div>
				<div style={{ fontSize: 12, color: MUTE, marginTop: 3 }}>
					{periodLabel}
					{compareLabel ? `  ·  vs  ${compareLabel}` : ""}
				</div>
			</div>
			<div style={{ fontSize: 11, color: MUTE, textAlign: "right" }}>
				{page === 1 ? "Summary & Analysis" : "Opportunities"}
				<br />
				Page {page} of 2
			</div>
		</div>
	);
}

function Stat({ label, value, delta }: { label: string; value: string; delta?: number | null }) {
	return (
		<div style={{ flex: 1, border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 14px" }}>
			<div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.6, color: MUTE }}>{label}</div>
			<div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
			{delta != null && (
				<div style={{ fontSize: 11, marginTop: 2, color: delta >= 0 ? "#059669" : "#dc2626" }}>
					{delta >= 0 ? "+" : ""}
					{delta} pts vs prior
				</div>
			)}
		</div>
	);
}

function PerfTable({ title, rows }: { title: string; rows: ReportNarrative["page1"]["topPerformers"] }) {
	return (
		<div style={{ flex: 1 }}>
			<div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>{title}</div>
			{rows.map((r, i) => (
				<div
					key={i}
					style={{ display: "flex", gap: 8, padding: "5px 0", borderTop: i ? "1px solid #f1f5f9" : "none", fontSize: 11 }}
				>
					<div style={{ flex: 1 }}>
						<div style={{ fontWeight: 600 }}>{r.label}</div>
						<div style={{ color: MUTE }}>{r.note}</div>
					</div>
					<div style={{ whiteSpace: "nowrap", fontWeight: 700, color: PINK }}>{r.value}</div>
				</div>
			))}
		</div>
	);
}

function PageOne(props: ReportDocProps) {
	const { digest, narrative } = props;
	const h = digest.headlineMetrics;
	const trend = digest.charts.dailyVisibility.map((d) => ({ date: d.date.slice(5), visibility: d.visibility }));
	const engines = digest.charts.engineMentionRate.map((e) => ({ engine: e.engine, pct: e.pct }));

	return (
		<div style={pageStyle}>
			<Header {...props} page={1} />

			<div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.4, marginBottom: 18 }}>{narrative.page1.headline}</div>

			<div style={{ display: "flex", gap: 10, marginBottom: 22 }}>
				<Stat label="Visibility" value={h.visibilityPct != null ? `${h.visibilityPct}%` : "—"} delta={h.visibilityDeltaPts} />
				<Stat
					label="Share of Voice"
					value={h.shareOfVoicePct != null ? `${h.shareOfVoicePct}%` : "—"}
					delta={h.shareOfVoiceDeltaPts}
				/>
				<Stat label="Answers sampled" value={String(h.totalRuns)} />
				<Stat label="Prompts tracked" value={String(h.trackedPrompts)} />
			</div>

			<ul style={{ margin: "0 0 22px", paddingLeft: 18, fontSize: 12, lineHeight: 1.55 }}>
				{narrative.page1.summary.map((s, i) => (
					<li key={i} style={{ marginBottom: 4 }}>
						{s}
					</li>
				))}
			</ul>

			<div style={{ display: "flex", gap: 24, marginBottom: 22 }}>
				<div style={{ flex: 1 }}>
					<div style={{ fontSize: 11, fontWeight: 700, color: MUTE, marginBottom: 6 }}>DAILY VISIBILITY</div>
					<LineChart width={318} height={150} data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
						<CartesianGrid stroke="#f1f5f9" vertical={false} />
						<XAxis dataKey="date" tick={{ fontSize: 9, fill: MUTE }} interval="preserveStartEnd" />
						<YAxis tick={{ fontSize: 9, fill: MUTE }} domain={[0, 100]} />
						<Line type="monotone" dataKey="visibility" stroke={PINK} strokeWidth={2} dot={false} isAnimationActive={false} />
					</LineChart>
				</div>
				<div style={{ flex: 1 }}>
					<div style={{ fontSize: 11, fontWeight: 700, color: MUTE, marginBottom: 6 }}>MENTION RATE BY ENGINE</div>
					<BarChart width={318} height={150} data={engines} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
						<CartesianGrid stroke="#f1f5f9" vertical={false} />
						<XAxis dataKey="engine" tick={{ fontSize: 8, fill: MUTE }} />
						<YAxis tick={{ fontSize: 9, fill: MUTE }} domain={[0, 100]} />
						<Bar dataKey="pct" fill={PINK} radius={[3, 3, 0, 0]} isAnimationActive={false} />
					</BarChart>
				</div>
			</div>

			<div style={{ display: "flex", gap: 28 }}>
				<PerfTable title="Top performers" rows={narrative.page1.topPerformers} />
				<PerfTable title="Needs attention" rows={narrative.page1.bottomPerformers} />
			</div>
		</div>
	);
}

const PRIORITY_COLOR: Record<string, string> = { high: "#dc2626", medium: "#d97706", low: "#0891b2" };

function PageTwo(props: ReportDocProps) {
	const { narrative, digest } = props;
	const cats = Object.entries(digest.charts.citationCategoryMix).sort((a, b) => b[1] - a[1]);
	const catTotal = cats.reduce((s, [, n]) => s + n, 0) || 1;

	return (
		<div style={pageStyle}>
			<Header {...props} page={2} />

			<div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Where to focus next</div>
			<div style={{ marginBottom: 26 }}>
				{narrative.page2.opportunities.map((o, i) => (
					<div
						key={i}
						style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: i ? "1px solid #f1f5f9" : "none" }}
					>
						<div
							style={{
								fontSize: 9,
								fontWeight: 700,
								textTransform: "uppercase",
								color: "#fff",
								background: PRIORITY_COLOR[o.priority] ?? MUTE,
								borderRadius: 5,
								padding: "3px 6px",
								height: "fit-content",
								whiteSpace: "nowrap",
							}}
						>
							{o.priority}
						</div>
						<div>
							<div style={{ fontSize: 12.5, fontWeight: 600 }}>{o.title}</div>
							<div style={{ fontSize: 11.5, color: MUTE, lineHeight: 1.5, marginTop: 2 }}>{o.why}</div>
						</div>
					</div>
				))}
			</div>

			<div style={{ display: "flex", gap: 28 }}>
				<div style={{ flex: 1 }}>
					<div style={{ fontSize: 11, fontWeight: 700, color: MUTE, marginBottom: 8 }}>CITATION SOURCE MIX</div>
					{cats.map(([cat, n]) => (
						<div key={cat} style={{ marginBottom: 6 }}>
							<div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, marginBottom: 2 }}>
								<span style={{ textTransform: "capitalize" }}>{cat}</span>
								<span style={{ color: MUTE }}>{Math.round((n / catTotal) * 100)}%</span>
							</div>
							<div style={{ height: 6, background: "#f1f5f9", borderRadius: 3 }}>
								<div style={{ width: `${(n / catTotal) * 100}%`, height: "100%", background: PINK, borderRadius: 3 }} />
							</div>
						</div>
					))}
				</div>
				<div style={{ flex: 1 }}>
					<div style={{ fontSize: 11, fontWeight: 700, color: MUTE, marginBottom: 8 }}>HOW TO READ THIS REPORT</div>
					{narrative.page2.metricGuide.map((m, i) => (
						<div key={i} style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 8 }}>
							<span style={{ fontWeight: 700 }}>{m.term}. </span>
							<span style={{ color: MUTE }}>{m.plainExplanation}</span>
						</div>
					))}
				</div>
			</div>

			<div
				style={{
					position: "absolute",
					bottom: 40,
					left: 60,
					right: 60,
					fontSize: 9,
					color: MUTE,
					borderTop: "1px solid #e2e8f0",
					paddingTop: 8,
					display: "flex",
					justifyContent: "space-between",
				}}
			>
				<span>Generated by Seen</span>
				<span>{props.periodLabel}</span>
			</div>
		</div>
	);
}

export const ReportDocument = forwardRef<HTMLDivElement, ReportDocProps>(function ReportDocument(props, ref) {
	return (
		<div
			ref={ref}
			aria-hidden
			style={{ position: "fixed", left: 0, top: 0, zIndex: -1, opacity: 0, pointerEvents: "none", background: "#fff" }}
		>
			<div data-report-page="1" style={{ position: "relative" }}>
				<PageOne {...props} />
			</div>
			<div data-report-page="2" style={{ position: "relative" }}>
				<PageTwo {...props} />
			</div>
		</div>
	);
});
