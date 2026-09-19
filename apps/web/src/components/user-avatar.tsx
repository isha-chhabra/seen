import { cn } from "@workspace/ui/lib/utils";

/**
 * Initials avatar. The colour is a palette key (not a hex value) so it follows
 * the theme: each key resolves to a theme token, and an unknown or missing key
 * falls back to the primary swatch.
 */
export const AVATAR_COLORS = [
	{ key: "lavender", label: "Lavender", token: "--primary" },
	{ key: "green", label: "Green", token: "--chart-1" },
	{ key: "gold", label: "Gold", token: "--chart-2" },
	{ key: "mauve", label: "Mauve", token: "--chart-3" },
	{ key: "rose", label: "Rose", token: "--chart-4" },
	{ key: "violet", label: "Violet", token: "--chart-5" },
] as const;

export type AvatarColorKey = (typeof AVATAR_COLORS)[number]["key"];

const DEFAULT_COLOR = AVATAR_COLORS[0];

export function resolveAvatarColor(key?: string | null) {
	return AVATAR_COLORS.find((c) => c.key === key) ?? DEFAULT_COLOR;
}

/** "Isha Chhabra" -> "IC", "Isha" -> "I". Uses the first and last word of the name. */
export function avatarInitials(name?: string | null): string {
	const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
	const first = words[0]?.charAt(0);
	if (!first) return "?";
	const last = words.length > 1 ? words[words.length - 1]?.charAt(0) : "";
	return (first + (last ?? "")).toUpperCase();
}

export function UserAvatar({
	name,
	color,
	className,
}: {
	name?: string | null;
	color?: string | null;
	className?: string;
}) {
	const swatch = resolveAvatarColor(color);
	return (
		<span
			role="img"
			aria-label={name ? `${name}'s avatar` : "Avatar"}
			className={cn(
				"inline-flex size-8 shrink-0 select-none items-center justify-center rounded-lg font-semibold text-xs tracking-wide ring-1 ring-white/15 transition-[background-color,box-shadow] duration-300",
				className,
			)}
			style={{
				backgroundColor: `var(${swatch.token})`,
				color: "var(--background)",
				boxShadow: `0 8px 24px -12px var(${swatch.token})`,
			}}
		>
			{avatarInitials(name)}
		</span>
	);
}
