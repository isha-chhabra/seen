/**
 * LLM narrative for a brand analytics report.
 *
 * One structured completion (web search OFF) over a deterministic data digest
 * assembled by the caller. Same provider selection as brand analysis
 * (resolveResearchProvider -> OPENAI_API_KEY / gpt-5-mini). No template
 * sentences: the schema is what the model must fill.
 */
import { z } from "zod";
import { runStructuredCompletionPrompt } from "../onboarding";

const performer = z.object({
	label: z.string().describe("The named item verbatim — a tracked prompt, an engine, or a citation source/domain."),
	metric: z.string().describe("What is measured, e.g. 'brand mention rate', 'share of voice', 'citation share'."),
	value: z.string().describe("The figure with unit, e.g. '82%', '+14 pts', '31 of 120 answers'."),
	note: z.string().describe("One short clause on why it stands out. No restating the value."),
});

export const reportNarrativeSchema = z.object({
	page1: z.object({
		headline: z
			.string()
			.describe("One specific sentence naming the single most important finding of the period, with a real number."),
		summary: z
			.array(z.string())
			.min(3)
			.max(5)
			.describe(
				"3-5 bullets. Each <= 25 words, each cites a real number or named item from the digest. Never make the same point twice. Terse — this must fit one page.",
			),
		topPerformers: z.array(performer).min(1).max(4),
		bottomPerformers: z.array(performer).min(1).max(4),
	}),
	page2: z.object({
		opportunities: z
			.array(
				z.object({
					title: z.string().describe("Short, action-oriented — the concrete move, not a metric."),
					why: z.string().describe("1-2 sentences tying it to a specific figure or named item in the digest."),
					priority: z.enum(["high", "medium", "low"]),
				}),
			)
			.min(3)
			.max(7),
		metricGuide: z
			.array(
				z.object({
					term: z.string().describe("A metric shown on this report, e.g. 'Visibility', 'Share of Voice'."),
					plainExplanation: z.string().describe("One plain sentence for a reader new to AI-visibility tracking."),
				}),
			)
			.min(3)
			.max(5),
	}),
});

export type ReportNarrative = z.infer<typeof reportNarrativeSchema>;

export interface ReportPromptArgs {
	brandName: string;
	periodLabel: string;
	compareLabel?: string;
	digest: unknown;
}

export function buildReportPrompt(a: ReportPromptArgs): string {
	const compare = Boolean(a.compareLabel);
	return [
		`You are writing a two-page AI-visibility report for the brand "${a.brandName}".`,
		compare
			? `It compares ${a.periodLabel} against ${a.compareLabel}. Page 1 is about WHAT CHANGED between the two periods.`
			: `It covers ${a.periodLabel}. Page 1 is about WHAT HAPPENED in that period.`,
		`Rules:`,
		`- Use ONLY the data in the digest below. Every claim references a real number or a named item from it.`,
		`- No generic filler ("visibility improved", "solid progress"). Never state the same point twice in other words.`,
		`- Page 1 must fit one printed page: be terse, specifics over prose.`,
		`- Page 2 opportunities are each grounded in a specific figure or item from the digest — no generic marketing advice.`,
		`- metricGuide is for a reader who has never used a visibility tracker: plain, one sentence each.`,
		``,
		`DATA DIGEST (JSON):`,
		JSON.stringify(a.digest ?? {}, null, 1),
	].join("\n");
}

export async function generateReportNarrative(a: ReportPromptArgs): Promise<ReportNarrative> {
	const { object } = await runStructuredCompletionPrompt(buildReportPrompt(a), reportNarrativeSchema);
	return object;
}
