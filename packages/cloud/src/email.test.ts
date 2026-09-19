import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEmailConfigured, parseSender, sendEmail } from "./email";

const content = { subject: "Hi", html: "<p>Hi</p>", text: "Hi" };

beforeEach(() => {
	vi.stubEnv("RESEND_API_KEY", "");
	vi.stubEnv("BREVO_API_KEY", "");
	vi.stubEnv("BREVO_FROM_EMAIL", "");
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("parseSender", () => {
	it("splits a display name from the address", () => {
		expect(parseSender("Seen <me@example.com>")).toEqual({ name: "Seen", email: "me@example.com" });
		expect(parseSender('"Seen App" <me@example.com>')).toEqual({ name: "Seen App", email: "me@example.com" });
	});

	it("accepts a bare address", () => {
		expect(parseSender(" me@example.com ")).toEqual({ email: "me@example.com" });
	});
});

describe("isEmailConfigured", () => {
	it("is true with either provider's key and false with neither", () => {
		expect(isEmailConfigured()).toBe(false);
		vi.stubEnv("BREVO_API_KEY", "xkeysib-x");
		expect(isEmailConfigured()).toBe(true);
		vi.stubEnv("BREVO_API_KEY", "");
		vi.stubEnv("RESEND_API_KEY", "re_x");
		expect(isEmailConfigured()).toBe(true);
	});
});

describe("sendEmail via Brevo", () => {
	beforeEach(() => {
		vi.stubEnv("BREVO_API_KEY", "xkeysib-x");
		vi.stubEnv("BREVO_FROM_EMAIL", "Seen <me@example.com>");
	});

	it("posts the message to Brevo's API with the key in a header", async () => {
		const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 201 }));
		vi.stubGlobal("fetch", fetchMock);

		await sendEmail("you@newengen.com", content);

		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://api.brevo.com/v3/smtp/email");
		expect((init.headers as Record<string, string>)["api-key"]).toBe("xkeysib-x");
		expect(JSON.parse(init.body as string)).toEqual({
			sender: { name: "Seen", email: "me@example.com" },
			to: [{ email: "you@newengen.com" }],
			subject: "Hi",
			htmlContent: "<p>Hi</p>",
			textContent: "Hi",
		});
	});

	it("throws with the provider's status when Brevo rejects the send", async () => {
		vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("sender not valid", { status: 400 })));
		await expect(sendEmail("you@newengen.com", content)).rejects.toThrow(/Brevo send failed: 400/);
	});

	it("refuses to send without a sender address", async () => {
		vi.stubEnv("BREVO_FROM_EMAIL", "");
		await expect(sendEmail("you@newengen.com", content)).rejects.toThrow("BREVO_FROM_EMAIL is not set");
	});
});
