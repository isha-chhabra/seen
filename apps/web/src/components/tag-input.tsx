/**
 * Type a phrase, press Enter, it becomes a removable tag — shared by
 * Article Finder's direction input and its query-review step, so both use
 * one implementation instead of two copies of the same chip+input pattern.
 */
import { IconX } from "@tabler/icons-react";
import { Badge } from "@workspace/ui/components/badge";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";

export function TagInput({
	values,
	onChange,
	placeholder,
	disabled,
	max,
	className,
}: {
	values: string[];
	onChange: (values: string[]) => void;
	placeholder?: string;
	disabled?: boolean;
	max?: number;
	className?: string;
}) {
	const [draft, setDraft] = useState("");

	function add() {
		const v = draft.trim();
		if (!v || (max !== undefined && values.length >= max)) return;
		if (values.some((x) => x.toLowerCase() === v.toLowerCase())) {
			setDraft("");
			return;
		}
		onChange([...values, v]);
		setDraft("");
	}

	function remove(i: number) {
		onChange(values.filter((_, j) => j !== i));
	}

	const canAddMore = !disabled && (max === undefined || values.length < max);

	return (
		<div
			className={cn(
				"flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border bg-transparent p-2",
				"focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30",
				className,
			)}
		>
			{values.map((v, i) => (
				<Badge
					key={v}
					variant="outline"
					className="tag-chip gap-1 py-1 pl-2.5 pr-1.5 text-xs font-normal"
					style={{ "--tag-color": `var(--chart-${(i % 5) + 1})` } as React.CSSProperties}
				>
					{v}
					{!disabled && (
						<button
							type="button"
							onClick={() => remove(i)}
							aria-label={`Remove: ${v}`}
							className="flex items-center justify-center rounded-full p-0.5 opacity-70 transition-opacity hover:opacity-100"
						>
							<IconX className="size-3" />
						</button>
					)}
				</Badge>
			))}
			{canAddMore && (
				<input
					type="text"
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter") {
							e.preventDefault();
							add();
						}
					}}
					placeholder={values.length === 0 ? placeholder : "Add another…"}
					disabled={disabled}
					className="h-7 min-w-[140px] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
				/>
			)}
		</div>
	);
}
