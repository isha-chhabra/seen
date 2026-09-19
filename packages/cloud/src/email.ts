/**
 * The only module that talks to a transactional-email provider.
 *
 * Brevo is used when BREVO_API_KEY is set (its free tier can send from a single
 * verified address, so no domain is needed); otherwise Resend, which needs a
 * verified sending domain. Both are plain HTTPS APIs on purpose: DigitalOcean
 * droplets block outbound SMTP.
 *
 * The Resend client is constructed lazily so importing this module (e.g. from
 * the mode smoke test, which builds cloud auth options with dummy env) never
 * requires a real API key.
 */
import { Resend } from "resend";
import type { EmailContent } from "./email-templates";

let client: Resend | null = null;

function getResendClient(): Resend {
	if (!client) client = new Resend(process.env.RESEND_API_KEY);
	return client;
}

/** True when a provider is configured. Without one, auth skips email entirely. */
export function isEmailConfigured(): boolean {
	return !!(process.env.BREVO_API_KEY || process.env.RESEND_API_KEY);
}

/** Splits "Name <addr@example.com>" (or a bare address) into Brevo's sender shape. */
export function parseSender(from: string): { name?: string; email: string } {
	const match = from.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
	if (!match) return { email: from.trim() };
	const [, rawName = "", address = ""] = match;
	const name = rawName.replace(/^"(.*)"$/, "$1");
	return name ? { name, email: address.trim() } : { email: address.trim() };
}

async function sendViaBrevo(to: string, content: EmailContent): Promise<void> {
	const from = process.env.BREVO_FROM_EMAIL;
	if (!from) throw new Error("BREVO_FROM_EMAIL is not set");
	const res = await fetch("https://api.brevo.com/v3/smtp/email", {
		method: "POST",
		headers: {
			"api-key": process.env.BREVO_API_KEY ?? "",
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify({
			sender: parseSender(from),
			to: [{ email: to }],
			subject: content.subject,
			htmlContent: content.html,
			textContent: content.text,
		}),
	});
	if (!res.ok) throw new Error(`Brevo send failed: ${res.status} ${await res.text()}`);
}

async function sendViaResend(to: string, content: EmailContent): Promise<void> {
	const from = process.env.RESEND_FROM_EMAIL;
	if (!from) throw new Error("RESEND_FROM_EMAIL is not set");
	const { error } = await getResendClient().emails.send({ from, to, ...content });
	if (error) throw new Error(`Resend send failed: ${error.message}`);
}

export async function sendEmail(to: string, content: EmailContent): Promise<void> {
	if (process.env.BREVO_API_KEY) return sendViaBrevo(to, content);
	return sendViaResend(to, content);
}
