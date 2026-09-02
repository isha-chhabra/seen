/**
 * LLM narrative for a client-facing AI-visibility report (affiliate-marketing framing).
 *
 * The reader is a brand that hired an affiliate agency: no analytics access, no
 * SEO/AEO vocabulary. Everything is explained in plain business English, straight
 * and factual. One structured completion (web search OFF) over a deterministic
 * digest. Same provider as brand analysis (OPENAI_API_KEY / gpt-5-mini).
 */
import { z } from "zod";
import { runStructuredCompletionPrompt } from "../onboarding";

export const reportNarrativeSchema = z.object({
	// ── Page 1: what this is + where you stand ──────────────────────────
	overview: z.object({
		whatThisIs: z
			.string()
			.describe(
				"2-3 plain sentences a non-technical brand owner understands: AI assistants (ChatGPT, Gemini, Perplexity, Google's AI answers) now answer 'what's the best <category>' directly, and this report measures how often they recommend this brand and where they leave it out. No jargon, no acronyms.",
			),
		headline: z
			.string()
			.describe("The single most important takeaway of the period in one plain sentence, containing a real number."),
		keyNumbers: z
			.array(
				z.object({
					label: z.string().describe("Plain label, e.g. 'AI recommendation rate', not 'visibility %'."),
					value: z.string().describe("The figure with unit, e.g. '42%' or '+9 points'."),
					whatItMeans: z.string().describe("One plain sentence: what this number tells the client about their business."),
				}),
			)
			.length(3),
	}),

	// ── Page 2: which buying questions you win and lose ─────────────────
	buyingQuestions: z.object({
		intro: z.string().describe("One sentence framing this page for the client."),
		winning: z
			.array(
				z.object({
					question: z.string().describe("The buying question verbatim (a tracked prompt)."),
					detail: z.string().describe("Plain: how consistently AI recommends the brand here and why it matters."),
				}),
			)
			.max(6),
		losing: z
			.array(
				z.object({
					question: z.string().describe("The buying question verbatim."),
					recommendedInstead: z.string().describe("Which competitor(s) AI names here instead, from the data."),
					detail: z.string().describe("Plain: the gap and what it costs the brand."),
				}),
			)
			.max(6),
		engineNote: z
			.string()
			.describe(
				"2-4 sentences, plain: which AI assistants show the brand most and least (with numbers), and a one-line reminder of what each named assistant is.",
			),
	}),

	// ── Page 3: which sites the AI trusts (the affiliate angle) ─────────
	sources: z.object({
		intro: z
			.string()
			.describe(
				"2-3 plain sentences: when AI recommends products in this category it reads a set of third-party sites first; getting the brand featured on them, or featured better, is how the recommendation rate moves. This is the affiliate-placement opportunity.",
			),
		affiliateInsight: z
			.string()
			.describe(
				"Specific, with numbers from the digest: what share of the sources AI relied on are affiliate / 'best of' roundup sites, name the biggest ones, and state plainly that these are placement targets.",
			),
		keySources: z
			.array(
				z.object({
					site: z.string().describe("Domain, e.g. 'goodhousekeeping.com'."),
					type: z.string().describe("One of: Affiliate / roundup, Editorial, Retailer, Community, Reference, from the digest category."),
					note: z.string().describe("Plain: what AI uses this site for and whether the brand appears there."),
				}),
			)
			.max(8),
		competitorSourceGap: z
			.string()
			.describe(
				"Sites that AI cites when recommending competitors but not this brand, if the data shows any; otherwise state plainly that no clear gap stood out this period.",
			),
	}),

	// ── Page 4: action plan + glossary ─────────────────────────────────
	actionPlan: z
		.array(
			z.object({
				action: z
					.string()
					.describe("A concrete affiliate-marketing move, e.g. 'Pitch <site> for inclusion in their <topic> roundup'."),
				rationale: z.string().describe("Tied to a specific number or named item in the digest."),
				priority: z.enum(["high", "medium", "low"]),
			}),
		)
		.min(5)
		.max(8),
	glossary: z
		.array(z.object({ term: z.string(), definition: z.string().describe("One plain sentence, no other jargon inside it.") }))
		.min(4)
		.max(7),
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
		`You are writing a client-facing report for "${a.brandName}", a brand that has hired an affiliate-marketing agency.`,
		`The reader is a brand owner or marketing lead with NO access to analytics tools and NO familiarity with SEO, AEO, "share of voice", "citations" or similar terms. Write for them.`,
		compare
			? `The report covers ${a.periodLabel} compared with ${a.compareLabel}. Where it helps, say what changed between the two.`
			: `The report covers ${a.periodLabel}.`,
		``,
		`FRAME everything through affiliate marketing: AI assistants have become the new "best <product>" roundup. The job is to get ${a.brandName} recommended by them, and to get it placed on the third-party sites those assistants pull from.`,
		``,
		`RULES:`,
		`- Plain business English. Explain every concept the first time it appears. No acronyms, no marketing hype, no reassurance-speak. Straight and factual.`,
		`- Keep it short. One or two sentences per field. Cut every word that is not carrying information.`,
		`- Do not use dashes (em or en). Use commas, or separate sentences.`,
		`- Use ONLY the data in the digest below. Every claim references a real number or a named item from it.`,
		`- Never make the same point twice. Prefer specifics (named questions, named sites, named competitors, real percentages) over generalities.`,
		`- "recommendedInstead" and "competitorSourceGap" must name real competitors/sites from the digest, or say plainly that none stood out.`,
		`- The glossary defines the terms this report actually uses (e.g. the labels in keyNumbers), each in one plain sentence.`,
		``,
		`DATA DIGEST (JSON):`,
		JSON.stringify(a.digest ?? {}, null, 1),
	].join("\n");
}

/** Recursively strip em/en dashes from every string in the narrative. */
function stripDashes<T>(v: T): T {
	if (typeof v === "string") {
		return v
			.replace(/\s*[—–]\s*/g, ", ")
			.replace(/,\s*,/g, ",")
			.replace(/\s+([.,;:!?])/g, "$1")
			.replace(/\s{2,}/g, " ")
			.trim() as unknown as T;
	}
	if (Array.isArray(v)) return v.map(stripDashes) as unknown as T;
	if (v && typeof v === "object") {
		return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, stripDashes(val)])) as T;
	}
	return v;
}

export async function generateReportNarrative(a: ReportPromptArgs): Promise<ReportNarrative> {
	const { object } = await runStructuredCompletionPrompt(buildReportPrompt(a), reportNarrativeSchema);
	return stripDashes(object);
}
