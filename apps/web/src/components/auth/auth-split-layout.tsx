/**
 * Auth page shell (sign-in / sign-up / password reset).
 *
 * Rebranded self-host: a single centred column with the wordmark, title and
 * form. The upstream "sales panel" (marketing pitch, GitHub CTA, G2 rating,
 * customer quotes, managed-offer card) and the Docs/Pricing/GitHub footer are
 * intentionally not rendered. `pitch` / `footer` stay in the props so callers
 * are untouched.
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
		<div className="flex min-h-svh items-center justify-center px-6 py-12">
			<div className="w-full max-w-sm">
				<Logo />
				<div className="mt-10">
					<h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
					{subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
					<div className="mt-8">{children}</div>
				</div>
			</div>
		</div>
	);
}
