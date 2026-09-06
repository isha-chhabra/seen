import { describe, expect, it } from "vitest";
import { bookDemoUrl, cloudPricingUrl, cloudSignupUrl, demoSiteUrl, marketingUrl } from "./referrals";

/**
 * The contract every one of these has to keep: land on the right page, and say
 * where the click came from. A link that quietly drops its ref still works, so
 * only a test notices.
 */
describe("referral links", () => {
	const builders = {
		marketing: () => marketingUrl("/docs", "cli"),
		signup: () => cloudSignupUrl("cli"),
		pricing: () => cloudPricingUrl("cli"),
		demo: () => bookDemoUrl("cli"),
		liveDemo: () => demoSiteUrl("cli"),
	};

	it.each(Object.entries(builders))("%s carries the source", (_name, build) => {
		expect(new URL(build()).searchParams.get("ref")).toBe("cli");
	});

	it("points each destination at its own page", () => {
		expect(marketingUrl("/docs", "cloud-signin")).toBe("https://www.example.com/docs?ref=cloud-signin");
		expect(cloudSignupUrl("cloud-signin")).toBe("https://app.example.com/auth/register?ref=cloud-signin");
		expect(cloudPricingUrl("cloud-signin")).toBe("https://www.example.com/pricing?ref=cloud-signin");
		expect(bookDemoUrl("cloud-signin")).toBe("https://cal.com?ref=cloud-signin");
		expect(demoSiteUrl("cloud-signin")).toBe("https://demo.example.com/?ref=cloud-signin");
	});
});
