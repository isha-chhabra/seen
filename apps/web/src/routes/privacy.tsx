/**
 * /privacy - Public privacy policy
 *
 * Reachable without signing in. Google requires a privacy policy link on the
 * OAuth consent screen before an app can accept sign-ins from outside its test
 * users, so this states plainly what Seen collects and who processes it.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { Logo } from "@/components/logo";
import { buildTitle, getAppName } from "@/lib/route-head";

const CONTACT_EMAIL = "tryseen.ai@gmail.com";

export const Route = createFileRoute("/privacy")({
	head: ({ match }) => {
		const appName = getAppName(match);
		return {
			meta: [
				{ title: buildTitle("Privacy policy", { appName }) },
				{ name: "description", content: "What Seen collects, why, and who processes it." },
			],
		};
	},
	component: PrivacyPage,
});

function PrivacyPage() {
	return (
		<div className="min-h-svh bg-background px-6 py-12">
			<div className="mx-auto w-full max-w-2xl space-y-8">
				<div className="flex justify-center">
					<Logo />
				</div>
				<div className="space-y-2">
					<h1 className="text-3xl font-semibold tracking-tight">Privacy policy</h1>
					<p className="text-sm text-muted-foreground">Last updated September 19, 2026</p>
				</div>

				<Section title="What Seen is">
					<p>
						Seen tracks how brands show up in AI answers and helps find editorial sites for affiliate outreach. Access
						is limited to invited teammates and approved email addresses.
					</p>
				</Section>

				<Section title="What we collect">
					<ul className="list-disc space-y-1 pl-5">
						<li>Your name and email address when you create an account.</li>
						<li>
							If you sign in with Google, the name and email address on your Google account. We ask Google only for
							basic profile information. Seen cannot read your email, files, or contacts.
						</li>
						<li>A hashed password if you sign up with email and password. We never store it in readable form.</li>
						<li>Cookies that keep you signed in.</li>
						<li>The brands, prompts, competitors, and results you add to or generate in Seen.</li>
					</ul>
				</Section>

				<Section title="How we use it">
					<p>
						To sign you in, decide who has access, send you verification codes, and run the features you use. We do not
						sell your information or use it for advertising.
					</p>
				</Section>

				<Section title="Who processes it for us">
					<ul className="list-disc space-y-1 pl-5">
						<li>DigitalOcean hosts the Seen server and its database.</li>
						<li>Vercel forwards web traffic to that server.</li>
						<li>Brevo delivers the verification code emails.</li>
						<li>
							BrightData and OpenAI receive the prompts and search queries that Seen runs on your behalf. These describe
							brands and topics, not your personal details.
						</li>
					</ul>
				</Section>

				<Section title="Keeping and deleting your data">
					<p>
						We keep your account and workspace data until it is removed. To have your account and data deleted, email{" "}
						<a className="text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
							{CONTACT_EMAIL}
						</a>
						.
					</p>
				</Section>

				<Section title="Contact">
					<p>
						Questions about this policy:{" "}
						<a className="text-primary hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
							{CONTACT_EMAIL}
						</a>
						.
					</p>
				</Section>

				<p className="text-center text-sm">
					<Link to="/auth/login" className="text-primary hover:underline">
						Back to sign in
					</Link>
				</p>
			</div>
		</div>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<section className="space-y-2">
			<h2 className="text-lg font-semibold">{title}</h2>
			<div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
		</section>
	);
}
