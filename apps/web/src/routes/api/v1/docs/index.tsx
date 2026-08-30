import { createFileRoute, redirect } from "@tanstack/react-router";

const API_DOCS_URL = "/";

export const Route = createFileRoute("/api/v1/docs/")({
	beforeLoad: () => {
		throw redirect({ href: API_DOCS_URL });
	},
	component: () => null,
});
