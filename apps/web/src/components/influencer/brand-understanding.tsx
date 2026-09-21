/**
 * "About this brand": what the search is judged against. Written from the brand's own website, then
 * confirmed or corrected here, and kept for next time. Every creator is asked three things: would they
 * make content for this brand, is there an obvious reason they'd say no, and would the brand benefit.
 */
import { IconChevronDown, IconRefresh } from "@tabler/icons-react";
import type { BrandUnderstanding } from "@workspace/lib/influencer-finder/types";
import { Input } from "@workspace/ui/components/input";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Textarea } from "@workspace/ui/components/textarea";
import { useState } from "react";
import { FormRow, FormRows } from "@/components/finder-form";
import { TagInput } from "@/components/tag-input";

/** An input that sits on its row as a line, like the tag fields. */
const UNDERLINE =
	"rounded-none border-0 border-foreground/25 border-b bg-transparent px-0 shadow-none dark:bg-transparent focus-visible:border-primary focus-visible:ring-0";

export const EMPTY_UNDERSTANDING: BrandUnderstanding = {
	summary: "",
	customer: "",
	markets: [],
	greatFits: [],
	dealBreakers: [],
};

/** Whether the required answers are filled in. */
export function understandingComplete(u: BrandUnderstanding | null): u is BrandUnderstanding {
	return !!u && u.summary.trim() !== "" && u.customer.trim() !== "" && u.markets.length > 0;
}

export function BrandUnderstandingPanel({
	brandName,
	value,
	onChange,
	loading,
	error,
	onRefresh,
	disabled,
	source,
}: {
	brandName: string;
	value: BrandUnderstanding;
	onChange: (v: BrandUnderstanding) => void;
	loading: boolean;
	error: string | null;
	onRefresh: () => void;
	disabled?: boolean;
	/** "website" when the AI wrote it and nobody has looked yet, "edited" once a person has. */
	source?: string;
}) {
	const [open, setOpen] = useState(false);
	const expanded = open || !understandingComplete(value) || !!error;
	return (
		<section className="mb-8">
			<div className="mb-3 flex items-start justify-between gap-4">
				<div className="min-w-0">
					<h2 className="font-semibold text-lg tracking-tight">About {brandName}</h2>
					{!loading && understandingComplete(value) && !expanded ? (
						<p className="mt-1 text-muted-foreground text-sm">
							Sells in {value.markets.join(", ")}. Looking for {value.greatFits.join(", ") || "creators who fit"}.
						</p>
					) : (
						<p className="text-muted-foreground text-sm">
							Every creator is judged on three things: would they make content for this brand, is there an obvious
							reason they'd say no, and would the brand benefit.
							{source === "website" && " Written from the website and Google. Fix anything that's off."}
						</p>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-4 text-muted-foreground text-xs">
					{expanded && (
						<button
							type="button"
							onClick={onRefresh}
							disabled={loading || disabled}
							className="flex items-center gap-1.5 transition-colors hover:text-foreground disabled:opacity-50"
						>
							<IconRefresh className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
							Read Website Again
						</button>
					)}
					{!loading && understandingComplete(value) && (
						<button
							type="button"
							onClick={() => setOpen((o) => !o)}
							aria-expanded={expanded}
							className="flex items-center gap-1 transition-colors hover:text-foreground"
						>
							{expanded ? "Done" : "Edit"}
							<IconChevronDown className={expanded ? "size-3.5 rotate-180" : "size-3.5"} />
						</button>
					)}
				</div>
			</div>
			{loading ? (
				<div className="space-y-3 border-border/40 border-y py-5" role="status" aria-live="polite">
					<p className="text-muted-foreground text-sm">Reading {brandName}'s website…</p>
					<Skeleton className="h-4 w-3/4" />
					<Skeleton className="h-4 w-1/2" />
					<Skeleton className="h-4 w-2/3" />
				</div>
			) : !expanded ? null : (
				<>
					{error && <p className="mb-2 text-amber-500 text-sm">{error}</p>}
					<FormRows>
						<FormRow label="What It Sells">
							<Textarea
								value={value.summary}
								onChange={(e) => onChange({ ...value, summary: e.target.value })}
								disabled={disabled}
								rows={2}
								className={`min-h-0 resize-none ${UNDERLINE}`}
								placeholder="What the brand sells, and to whom"
							/>
						</FormRow>
						<FormRow label="Customer">
							<Input
								value={value.customer}
								onChange={(e) => onChange({ ...value, customer: e.target.value })}
								disabled={disabled}
								className={UNDERLINE}
								placeholder="Who buys from it"
							/>
						</FormRow>
						<FormRow label="Sells In" hint="Creators outside these are ruled out">
							<TagInput
								plain
								values={value.markets}
								onChange={(v) => onChange({ ...value, markets: v })}
								disabled={disabled}
								max={8}
								placeholder="e.g. United States"
							/>
						</FormRow>
						<FormRow label="Great Fits" hint="Creators who'd gladly say yes">
							<TagInput
								plain
								values={value.greatFits}
								onChange={(v) => onChange({ ...value, greatFits: v })}
								disabled={disabled}
								max={12}
								placeholder="e.g. big and tall men, plus-size women"
							/>
						</FormRow>
						<FormRow label="Deal-Breakers" hint="Obvious reasons they'd say no">
							<TagInput
								plain
								values={value.dealBreakers}
								onChange={(v) => onChange({ ...value, dealBreakers: v })}
								disabled={disabled}
								max={12}
								placeholder="e.g. based outside the US, only works with a competitor"
							/>
						</FormRow>
					</FormRows>
				</>
			)}
		</section>
	);
}
