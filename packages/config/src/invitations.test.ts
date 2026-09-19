import { describe, expect, it } from "vitest";
import { invitationSignupPath } from "./invitations";

describe("invitationSignupPath", () => {
	it("opens sign up and returns to the acceptance page afterwards", () => {
		const path = invitationSignupPath("inv_123");
		const url = new URL(path, "https://app.example.com");
		expect(url.pathname).toBe("/auth/register");
		expect(url.searchParams.get("returnTo")).toBe("/accept-invitation/inv_123");
	});
});
