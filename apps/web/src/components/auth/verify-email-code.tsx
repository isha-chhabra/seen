/**
 * Second step of email/password signup and of signing in to an unverified
 * account: enter the 6-digit code that was emailed. A correct code verifies the
 * address and signs the user in, so success goes straight to the app.
 */

import { useNavigate } from "@tanstack/react-router";
import { authClient } from "@workspace/lib/auth/client";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useEffect, useState } from "react";
import { AuthSplitLayout } from "@/components/auth/auth-split-layout";
import { safeReturnTo } from "@/lib/return-to";

const CODE_LENGTH = 6;
/** Matches the server's per-route rate limit (3 sends a minute) with headroom. */
const RESEND_COOLDOWN_SECONDS = 30;

export function VerifyEmailCode({ email, returnTo }: { email: string; returnTo?: string }) {
	const navigate = useNavigate();
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
	const [resent, setResent] = useState(false);

	useEffect(() => {
		if (cooldown <= 0) return;
		const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
		return () => clearTimeout(timer);
	}, [cooldown]);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);
		try {
			const result = await authClient.emailOtp.verifyEmail({ email, otp: code });
			if (result.error) {
				setError("That code didn't work. Check it and try again, or request a new one.");
				setLoading(false);
				return;
			}
			navigate({ to: safeReturnTo(returnTo) });
		} catch {
			setError("Something went wrong. Please try again.");
			setLoading(false);
		}
	}

	async function handleResend() {
		setError(null);
		setResent(false);
		setCooldown(RESEND_COOLDOWN_SECONDS);
		const result = await authClient.emailOtp.sendVerificationOtp({ email, type: "email-verification" });
		if (result.error) {
			setError("Couldn't send a new code. Wait a moment and try again.");
			return;
		}
		setResent(true);
	}

	return (
		<AuthSplitLayout title="Check your email" subtitle={`Enter the ${CODE_LENGTH}-digit code we sent to ${email}.`}>
			<form onSubmit={handleSubmit} className="w-full space-y-4">
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				{resent && !error && (
					<Alert>
						<AlertDescription>New code sent.</AlertDescription>
					</Alert>
				)}
				<div className="space-y-2">
					<Label htmlFor="verification-code">Verification code</Label>
					<Input
						id="verification-code"
						value={code}
						onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
						inputMode="numeric"
						autoComplete="one-time-code"
						placeholder="123456"
						className="text-center font-mono text-lg tracking-[0.4em]"
						required
						autoFocus
					/>
				</div>
				<Button type="submit" className="w-full" disabled={loading || code.length !== CODE_LENGTH}>
					{loading ? "Verifying..." : "Verify email"}
				</Button>
				<Button type="button" variant="ghost" className="w-full" onClick={handleResend} disabled={cooldown > 0}>
					{cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
				</Button>
			</form>
		</AuthSplitLayout>
	);
}
