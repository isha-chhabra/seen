/**
 * Better-auth client instance.
 *
 * Used in browser code for session management, organization switching,
 * permission checks, and SSO flows.
 */

import { ssoClient } from "@better-auth/sso/client";
import { stripeClient } from "@better-auth/stripe/client";
import { adminClient, emailOTPClient, inferAdditionalFields, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { ac, adminRole, userRole } from "./permissions";

export const authClient = createAuthClient({
	baseURL: typeof window !== "undefined" ? window.location.origin : "",
	basePath: "/api/auth",
	plugins: [
		organizationClient(),
		adminClient({
			ac,
			roles: {
				admin: adminRole,
				user: userRole,
			},
		}),
		ssoClient(),
		// Cloud verifies email by code; the endpoints exist only when the server
		// plugin is injected (cloud with an email provider configured).
		emailOTPClient(),
		// Mirrors user.additionalFields on the server so session and updateUser are typed.
		inferAdditionalFields({ user: { avatarColor: { type: "string", required: false } } }),
		// The subscription endpoints exist only in cloud mode (the server plugin
		// is injected there); no cloud UI calls these methods elsewhere.
		stripeClient({ subscription: true }),
	],
});

export type AuthClient = typeof authClient;
