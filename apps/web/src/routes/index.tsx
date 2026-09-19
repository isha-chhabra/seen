/**
 * Home page - / route
 *
 * Never renders anything itself: it only routes the visitor.
 * Authenticated users go to /app. On a fresh deployment that needs
 * bootstrapping (registration is open AND no users exist yet) visitors go to
 * /auth/register so they see the signup screen instead of an empty-database
 * login form. Everyone else lands directly on /auth/login.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/auth/session";

export const Route = createFileRoute("/")({
	validateSearch: (search: Record<string, unknown>) => ({
		redirect: typeof search.redirect === "string" ? search.redirect : undefined,
	}),
	beforeLoad: async ({ context, search }) => {
		const session = await getSession();

		if (session) {
			throw redirect({ to: "/app" });
		}

		const returnTo = search.redirect ? { returnTo: search.redirect } : {};

		if (context.clientConfig?.canRegister && !context.clientConfig?.hasUsers) {
			throw redirect({ to: "/auth/register", search: returnTo });
		}

		throw redirect({ to: "/auth/login", search: returnTo });
	},
});
