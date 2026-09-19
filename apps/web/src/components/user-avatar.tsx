import { cn } from "@workspace/ui/lib/utils";

/**
 * Initials avatar in a theme colour. The colour isn't chosen: it is picked from
 * the palette by hashing a stable seed (the user's email), so a person keeps the
 * same colour everywhere and it follows the theme.
 */
const AVATAR_TOKENS = ["--primary", "--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5"] as const;

function avatarToken(seed?: string | null): string {
	let hash = 0;
	for (const char of (seed ?? "").trim().toLowerCase()) {
		hash = (hash * 31 + char.charCodeAt(0)) | 0;
	}
	return AVATAR_TOKENS[Math.abs(hash) % AVATAR_TOKENS.length] ?? AVATAR_TOKENS[0];
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
	seed,
	className,
}: {
	name?: string | null;
	/** Anything stable per person, normally their email. Decides the colour. */
	seed?: string | null;
	className?: string;
}) {
	const token = avatarToken(seed);
	return (
		<span
			role="img"
			aria-label={name ? `${name}'s avatar` : "Avatar"}
			className={cn(
				"inline-flex size-8 shrink-0 select-none items-center justify-center rounded-lg font-semibold text-xs tracking-wide ring-1 ring-white/15",
				className,
			)}
			style={{
				backgroundColor: `var(${token})`,
				color: "var(--background)",
				boxShadow: `0 8px 24px -12px var(${token})`,
			}}
		>
			{avatarInitials(name)}
		</span>
	);
}
