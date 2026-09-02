/**
 * Client-facing AI-visibility report, four pages, affiliate-marketing framing,
 * plain language. Rendered visibly for ~1s while downloadReportPdf() snapshots
 * each [data-report-page] to a PDF. US Letter at 96dpi (816 x 1056 px).
 */
import type { ReportNarrative } from "@workspace/lib/report/narrative";
import { forwardRef } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

interface ReportDigestView {
	charts: {
		dailyRecommendationRate: { date: string; rate: number }[];
		byAssistant: { assistant: string; rate: number }[];
		sourceMix: Record<string, number>;
	};
}

const PINK = "#ec4899";
const INK = "#0f172a";
const MUTE = "#64748b";
const LINE = "#e2e8f0";

export interface ReportDocProps {
	brandName: string;
	periodLabel: string;
	compareLabel: string | null;
	digest: ReportDigestView;
	narrative: ReportNarrative;
}

const page: React.CSSProperties = {
	width: 816,
	minHeight: 1056,
	background: "#fff",
	color: INK,
	padding: "52px 60px 64px",
	fontFamily: "'Geist', ui-sans-serif, system-ui, sans-serif",
	fontSize: 12,
	lineHeight: 1.55,
	boxSizing: "border-box",
	position: "relative",
};
const h2: React.CSSProperties = { fontSize: 16, fontWeight: 700, margin: "0 0 10px" };
const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: MUTE, textTransform: "uppercase" };
const note: React.CSSProperties = { color: MUTE };

function Head({ brandName, periodLabel, compareLabel, n }: ReportDocProps & { n: number }) {
	const titles = ["Where you stand", "Which questions you win and lose", "Which sites the AI trusts", "What to do next"];
	return (
		<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", borderBottom: `2px solid ${PINK}`, paddingBottom: 12, marginBottom: 24 }}>
			<div>
				<span style={{ fontFamily: "'Titan One', system-ui", fontSize: 24, color: PINK, lineHeight: 1 }}>seen</span>
				<div style={{ fontSize: 19, fontWeight: 700, marginTop: 8 }}>{brandName} AI Visibility Report</div>
				<div style={{ fontSize: 11, color: MUTE, marginTop: 3 }}>
					{periodLabel}
					{compareLabel ? `  ·  compared with  ${compareLabel}` : ""}
				</div>
			</div>
			<div style={{ fontSize: 10.5, color: MUTE, textAlign: "right" }}>
				{titles[n - 1]}
				<br />
				Page {n} of 4
			</div>
		</div>
	);
}

function Foot({ periodLabel }: { periodLabel: string }) {
	return (
		<div style={{ position: "absolute", left: 60, right: 60, bottom: 34, borderTop: `1px solid ${LINE}`, paddingTop: 8, fontSize: 9, color: MUTE, display: "flex", justifyContent: "space-between" }}>
			<span>Seen AI Visibility Report</span>
			<span>{periodLabel}</span>
		</div>
	);
}

function Callout({ children }: { children: React.ReactNode }) {
	return (
		<div style={{ background: "#fdf2f8", border: `1px solid #fbcfe8`, borderRadius: 10, padding: "14px 16px", fontSize: 12, lineHeight: 1.6 }}>
			{children}
		</div>
	);
}

// ── Page 1 ────────────────────────────────────────────────────────────
function Page1(p: ReportDocProps) {
	const o = p.narrative.overview;
	const trend = p.digest.charts.dailyRecommendationRate.map((d) => ({ d: d.date.slice(5), rate: d.rate }));
	return (
		<div style={page}>
			<Head {...p} n={1} />
			<div style={{ marginBottom: 18 }}>
				<div style={label}>What this report measures</div>
				<div style={{ marginTop: 6 }}>{o.whatThisIs}</div>
			</div>
			<Callout>
				<strong>Bottom line. </strong>
				{o.headline}
			</Callout>
			<div style={{ display: "flex", gap: 12, margin: "22px 0 24px" }}>
				{o.keyNumbers.map((k, i) => (
					<div key={i} style={{ flex: 1, border: `1px solid ${LINE}`, borderRadius: 10, padding: "14px 16px" }}>
						<div style={label}>{k.label}</div>
						<div style={{ fontSize: 26, fontWeight: 700, margin: "6px 0 4px", color: PINK }}>{k.value}</div>
						<div style={{ ...note, fontSize: 11 }}>{k.whatItMeans}</div>
					</div>
				))}
			</div>
			<div style={label}>How often AI recommended {p.brandName}, day by day</div>
			<LineChart width={690} height={190} data={trend} margin={{ top: 10, right: 12, bottom: 0, left: -18 }}>
				<CartesianGrid stroke="#f1f5f9" vertical={false} />
				<XAxis dataKey="d" tick={{ fontSize: 9, fill: MUTE }} interval="preserveStartEnd" />
				<YAxis tick={{ fontSize: 9, fill: MUTE }} domain={[0, 100]} unit="%" />
				<Line type="monotone" dataKey="rate" stroke={PINK} strokeWidth={2.5} dot={false} isAnimationActive={false} />
			</LineChart>
			<div style={{ ...note, fontSize: 10.5, marginTop: 6 }}>
				Each point is the share of that day's AI answers to your tracked buying questions that named {p.brandName}.
			</div>
			<Foot periodLabel={p.periodLabel} />
		</div>
	);
}

// ── Page 2 ────────────────────────────────────────────────────────────
function QList({ items, kind }: { items: { question: string; detail: string; recommendedInstead?: string }[]; kind: "win" | "lose" }) {
	return (
		<div>
			{items.map((it, i) => (
				<div key={i} style={{ padding: "9px 0", borderTop: i ? `1px solid #f1f5f9` : "none" }}>
					<div style={{ fontWeight: 600, fontSize: 12 }}>
						<span style={{ color: kind === "win" ? "#059669" : "#dc2626", marginRight: 6 }}>{kind === "win" ? "▲" : "▼"}</span>
						“{it.question}”
					</div>
					<div style={{ ...note, fontSize: 11, marginTop: 2 }}>{it.detail}</div>
					{it.recommendedInstead && (
						<div style={{ fontSize: 11, marginTop: 2 }}>
							<span style={note}>AI recommends instead: </span>
							<strong>{it.recommendedInstead}</strong>
						</div>
					)}
				</div>
			))}
		</div>
	);
}
function Page2(p: ReportDocProps) {
	const b = p.narrative.buyingQuestions;
	const bars = p.digest.charts.byAssistant.map((e) => ({ a: e.assistant, rate: e.rate }));
	return (
		<div style={page}>
			<Head {...p} n={2} />
			<div style={{ marginBottom: 14 }}>{b.intro}</div>
			<div style={{ display: "flex", gap: 28 }}>
				<div style={{ flex: 1 }}>
					<div style={h2}>AI recommends you here</div>
					<QList items={b.winning} kind="win" />
				</div>
				<div style={{ flex: 1 }}>
					<div style={h2}>AI leaves you out here</div>
					<QList items={b.losing.map((l) => ({ question: l.question, detail: l.detail, recommendedInstead: l.recommendedInstead }))} kind="lose" />
				</div>
			</div>
			<div style={{ marginTop: 24 }}>
				<div style={h2}>By AI assistant</div>
				<div style={{ marginBottom: 8 }}>{b.engineNote}</div>
				<BarChart width={690} height={170} data={bars} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
					<CartesianGrid stroke="#f1f5f9" vertical={false} />
					<XAxis dataKey="a" tick={{ fontSize: 9, fill: MUTE }} />
					<YAxis tick={{ fontSize: 9, fill: MUTE }} domain={[0, 100]} unit="%" />
					<Bar dataKey="rate" fill={PINK} radius={[3, 3, 0, 0]} isAnimationActive={false} />
				</BarChart>
			</div>
			<Foot periodLabel={p.periodLabel} />
		</div>
	);
}

// ── Page 3 ────────────────────────────────────────────────────────────
function Page3(p: ReportDocProps) {
	const s = p.narrative.sources;
	const mix = Object.entries(p.digest.charts.sourceMix).sort((a, b) => b[1] - a[1]);
	const total = mix.reduce((t, [, n]) => t + n, 0) || 1;
	return (
		<div style={page}>
			<Head {...p} n={3} />
			<div style={{ marginBottom: 14 }}>{s.intro}</div>
			<Callout>
				<strong>The affiliate angle. </strong>
				{s.affiliateInsight}
			</Callout>
			<div style={{ display: "flex", gap: 28, marginTop: 22 }}>
				<div style={{ flex: "0 0 250px" }}>
					<div style={label}>Where AI's sources come from</div>
					<div style={{ marginTop: 10 }}>
						{mix.map(([k, n]) => (
							<div key={k} style={{ marginBottom: 8 }}>
								<div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5 }}>
									<span>{k}</span>
									<span style={note}>{Math.round((n / total) * 100)}%</span>
								</div>
								<div style={{ height: 6, background: "#f1f5f9", borderRadius: 3, marginTop: 2 }}>
									<div style={{ width: `${(n / total) * 100}%`, height: "100%", background: PINK, borderRadius: 3 }} />
								</div>
							</div>
						))}
					</div>
				</div>
				<div style={{ flex: 1 }}>
					<div style={label}>The sites AI relied on most</div>
					<div style={{ marginTop: 8 }}>
						{s.keySources.map((k, i) => (
							<div key={i} style={{ padding: "7px 0", borderTop: i ? `1px solid #f1f5f9` : "none" }}>
								<div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5 }}>
									<strong>{k.site}</strong>
									<span style={{ ...note, fontSize: 10 }}>{k.type}</span>
								</div>
								<div style={{ ...note, fontSize: 10.5, marginTop: 1 }}>{k.note}</div>
							</div>
						))}
					</div>
				</div>
			</div>
			<div style={{ marginTop: 22 }}>
				<div style={h2}>Where competitors are cited but you aren't</div>
				<div>{s.competitorSourceGap}</div>
			</div>
			<Foot periodLabel={p.periodLabel} />
		</div>
	);
}

// ── Page 4 ────────────────────────────────────────────────────────────
const PRI: Record<string, string> = { high: "#dc2626", medium: "#d97706", low: "#0891b2" };
function Page4(p: ReportDocProps) {
	return (
		<div style={page}>
			<Head {...p} n={4} />
			<div style={h2}>Your action plan</div>
			<div style={{ marginBottom: 26 }}>
				{p.narrative.actionPlan.map((a, i) => (
					<div key={i} style={{ display: "flex", gap: 10, padding: "10px 0", borderTop: i ? `1px solid #f1f5f9` : "none" }}>
						<span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#fff", background: PRI[a.priority] ?? MUTE, borderRadius: 5, padding: "3px 6px", height: "fit-content", whiteSpace: "nowrap" }}>
							{a.priority}
						</span>
						<div>
							<div style={{ fontSize: 12.5, fontWeight: 600 }}>{a.action}</div>
							<div style={{ ...note, fontSize: 11, marginTop: 2 }}>{a.rationale}</div>
						</div>
					</div>
				))}
			</div>
			<div style={h2}>How to read this report</div>
			<div>
				{p.narrative.glossary.map((g, i) => (
					<div key={i} style={{ fontSize: 11.5, marginBottom: 7 }}>
						<strong>{g.term}. </strong>
						<span style={note}>{g.definition}</span>
					</div>
				))}
			</div>
			<Foot periodLabel={p.periodLabel} />
		</div>
	);
}

export const ReportDocument = forwardRef<HTMLDivElement, ReportDocProps>(function ReportDocument(props, ref) {
	return (
		<div
			ref={ref}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 2147483647,
				background: "#fff",
				overflow: "auto",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				gap: 16,
				padding: "24px 0",
			}}
		>
			<div style={{ fontSize: 13, fontWeight: 600, color: PINK }}>Preparing your PDF…</div>
			{[Page1, Page2, Page3, Page4].map((P, i) => (
				<div key={i} data-report-page={i + 1} style={{ position: "relative", boxShadow: "0 4px 24px rgba(0,0,0,0.1)" }}>
					<P {...props} />
				</div>
			))}
		</div>
	);
});
