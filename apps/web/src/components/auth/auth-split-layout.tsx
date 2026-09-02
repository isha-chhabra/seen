/**
 * Auth page shell (sign-in / sign-up / password reset).
 *
 * Rebranded self-host: a single centred card with the wordmark above it and a
 * soft pink glow behind. The upstream "sales panel" (marketing pitch, GitHub
 * CTA, G2 rating, customer quotes, managed-offer card) and the Docs/Pricing/
 * GitHub footer are intentionally not rendered. `pitch` / `footer` stay in the
 * props so callers are untouched.
 */

import type { ReactNode } from "react";
import { Logo } from "@/components/logo";

interface AuthSplitLayoutProps {
	title: string;
	subtitle?: string;
	children: ReactNode;
	/** Kept for source compatibility with callers; not rendered. */
	pitch?: ReactNode;
	/** Kept for source compatibility with callers; not rendered. */
	footer?: ReactNode;
}

export function AuthSplitLayout({ title, subtitle, children }: AuthSplitLayoutProps) {
	return (
		<div className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-background px-6 py-12">
			<div
				aria-hidden
				className="pointer-events-none absolute left-1/2 top-[-10%] h-[440px] w-[760px] -translate-x-1/2 rounded-full bg-primary/10 blur-[130px] dark:bg-primary/20"
			/>
			<div className="relative w-full max-w-sm">
				<div className="mb-6 flex justify-center">
					<Logo />
				</div>
				<div className="rounded-2xl border bg-card p-7 shadow-[0_1px_2px_oklch(0_0_0/0.04),0_12px_40px_-8px_oklch(0_0_0/0.12)] dark:shadow-[0_1px_2px_oklch(0_0_0/0.4),0_16px_48px_-10px_oklch(0_0_0/0.5)]">
					<h1 className="text-xl font-semibold tracking-tight">{title}</h1>
					{subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
					<div className="mt-6">{children}</div>
				</div>
			</div>
		</div>
	);
}
