/**
 * /app/$brand/settings/profile - "My Profile" (members and admins; viewers never see it)
 *
 * Name and avatar colour are editable, email is shown but fixed. Recent activity
 * lists the last few prompt runs and Article Finder searches. Deleting the
 * account sits at the bottom behind a typed confirmation.
 */
import { IconBolt, IconCheck, IconHistory, IconLock, IconSearch, IconTrash } from "@tabler/icons-react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { isOrgAdminRole } from "@workspace/config/roles";
import { authClient } from "@workspace/lib/auth/client";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { AVATAR_COLORS, resolveAvatarColor, UserAvatar } from "@/components/user-avatar";
import { DELETE_CONFIRM_PHRASE } from "@/lib/delete-account";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";
import { deleteMyAccountFn, getMyProfileFn, type ProfileData } from "@/server/profile";

export const Route = createFileRoute("/_authed/app/$brand/settings/profile")({
	loader: async ({ params, context }): Promise<ProfileData> => {
		if (!context.clientConfig?.features.teamInvites) {
			throw redirect({ to: "/app/$brand", params: { brand: params.brand } });
		}
		const profile = await getMyProfileFn({ data: { brandId: params.brand } });
		// Viewers see no profile page.
		if (profile.role === "viewer") {
			throw redirect({ to: "/app/$brand", params: { brand: params.brand } });
		}
		return profile;
	},
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("My Profile", { appName, brandName }) },
				{ name: "description", content: "Your name, avatar and recent activity." },
			],
		};
	},
	component: ProfilePage,
});

function timeAgo(iso: string): string {
	const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
	if (seconds < 60) return "Just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} hr ago`;
	const days = Math.round(hours / 24);
	return days === 1 ? "Yesterday" : `${days} days ago`;
}

function roleLabel(role: string): string {
	if (isOrgAdminRole(role)) return "Admin";
	return role === "member" ? "Member" : role;
}

function ProfilePage() {
	const profile = Route.useLoaderData();
	const router = useRouter();
	const [name, setName] = useState(profile.name);
	const [color, setColor] = useState(profile.avatarColor);
	const [savingName, setSavingName] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const trimmedName = name.trim();
	const nameChanged = trimmedName.length > 0 && trimmedName !== profile.name;
	const activeColor = resolveAvatarColor(color).key;

	function flash(message: string) {
		setNotice(message);
		setTimeout(() => setNotice((current) => (current === message ? null : current)), 2200);
	}

	async function saveName(e: React.FormEvent) {
		e.preventDefault();
		if (!nameChanged) return;
		setError(null);
		setSavingName(true);
		const result = await authClient.updateUser({ name: trimmedName });
		if (result.error) {
			setError(result.error.message ?? "Couldn't save your name. Try again.");
		} else {
			flash("Name saved");
			await router.invalidate();
		}
		setSavingName(false);
	}

	async function pickColor(key: string) {
		if (key === activeColor) return;
		const previous = color;
		setError(null);
		setColor(key);
		const result = await authClient.updateUser({ avatarColor: key });
		if (result.error) {
			setColor(previous);
			setError(result.error.message ?? "Couldn't save the color. Try again.");
			return;
		}
		flash("Avatar color saved");
		await router.invalidate();
	}

	return (
		<div className="max-w-5xl">
			<PageHeader title="My Profile" subtitle="How you appear in Seen, and what you've been up to." />

			<div aria-live="polite" className="h-5 text-sm text-primary">
				{notice && (
					<span className="inline-flex items-center gap-1.5">
						<IconCheck className="size-4" />
						{notice}
					</span>
				)}
			</div>

			{error && (
				<Alert variant="destructive" className="mb-4">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			<div className="grid gap-6 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
				<Card className="scroll-reveal h-fit">
					<CardContent className="flex flex-col items-center gap-5 pt-2 text-center">
						<UserAvatar name={name || profile.name} color={color} className="size-28 rounded-[2rem] text-4xl" />
						<div className="min-w-0 max-w-full">
							<p className="truncate text-lg font-semibold">{profile.name}</p>
							<p className="truncate text-sm text-muted-foreground">{profile.email}</p>
						</div>
						<div className="w-full space-y-3 border-t pt-5">
							<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Avatar color</p>
							<fieldset className="flex flex-wrap justify-center gap-2.5">
								<legend className="sr-only">Avatar color</legend>
								{AVATAR_COLORS.map((swatch) => {
									const selected = swatch.key === activeColor;
									return (
										<label
											key={swatch.key}
											title={swatch.label}
											className={cn(
												"relative size-8 cursor-pointer rounded-full ring-offset-2 ring-offset-card transition-transform hover:scale-110 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
												selected && "ring-2 ring-foreground",
											)}
											style={{ backgroundColor: `var(${swatch.token})` }}
										>
											<input
												type="radio"
												name="avatar-color"
												value={swatch.key}
												checked={selected}
												onChange={() => pickColor(swatch.key)}
												aria-label={swatch.label}
												className="sr-only"
											/>
										</label>
									);
								})}
							</fieldset>
						</div>
					</CardContent>
				</Card>

				<div className="space-y-6">
					<Card className="scroll-reveal">
						<CardHeader>
							<CardTitle>Details</CardTitle>
							<CardDescription>Your name is shown to teammates. Your email is used to sign in.</CardDescription>
						</CardHeader>
						<CardContent className="space-y-5">
							<form onSubmit={saveName} className="space-y-2">
								<Label htmlFor="profile-name">Name</Label>
								<div className="flex gap-2">
									<Input
										id="profile-name"
										value={name}
										onChange={(e) => setName(e.target.value)}
										maxLength={60}
										autoComplete="name"
										required
									/>
									<Button type="submit" disabled={!nameChanged || savingName} className="shrink-0">
										{savingName ? "Saving..." : "Save"}
									</Button>
								</div>
							</form>

							<div className="space-y-2">
								<Label htmlFor="profile-email">Email</Label>
								<div className="relative">
									<Input id="profile-email" value={profile.email} readOnly disabled className="pr-9" />
									<IconLock className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
								</div>
								<p className="text-xs text-muted-foreground">Your email can't be changed.</p>
							</div>

							<dl className="grid gap-4 border-t pt-5 sm:grid-cols-3">
								<div>
									<dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Role</dt>
									<dd className="mt-1.5">
										<Badge variant="secondary">{roleLabel(profile.role)}</Badge>
									</dd>
								</div>
								<div>
									<dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Member since</dt>
									<dd className="mt-1.5 text-sm">
										{new Date(profile.memberSince).toLocaleDateString(undefined, {
											year: "numeric",
											month: "short",
											day: "numeric",
										})}
									</dd>
								</div>
								<div>
									<dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Signs in with</dt>
									<dd className="mt-1.5 text-sm">{profile.signInMethods.join(", ") || "Email and password"}</dd>
								</div>
							</dl>
						</CardContent>
					</Card>

					<Card className="scroll-reveal">
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<IconHistory className="size-4 text-primary" />
								Recent activity
							</CardTitle>
							<CardDescription>The latest prompt runs and Article Finder searches in Seen.</CardDescription>
						</CardHeader>
						<CardContent>
							{profile.activity.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									Nothing yet. Prompt runs and Article Finder searches will show up here.
								</p>
							) : (
								<ol className="space-y-4">
									{profile.activity.map((item) => (
										<li key={`${item.kind}-${item.at}`} className="flex items-start gap-3">
											<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/12 text-primary">
												{item.kind === "prompt-run" ? (
													<IconBolt className="size-4" />
												) : (
													<IconSearch className="size-4" />
												)}
											</span>
											<div className="min-w-0 flex-1">
												<p className="text-sm font-medium">{item.title}</p>
												{item.detail && <p className="truncate text-xs text-muted-foreground">{item.detail}</p>}
											</div>
											<time dateTime={item.at} className="shrink-0 text-xs text-muted-foreground">
												{timeAgo(item.at)}
											</time>
										</li>
									))}
								</ol>
							)}
						</CardContent>
					</Card>
				</div>
			</div>

			<DeleteAccountCard />
		</div>
	);
}

function DeleteAccountCard() {
	const [open, setOpen] = useState(false);
	const [typed, setTyped] = useState("");
	const [deleting, setDeleting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const confirmed = typed.trim().toLowerCase() === DELETE_CONFIRM_PHRASE;

	function onOpenChange(next: boolean) {
		if (deleting) return;
		setOpen(next);
		if (!next) {
			setTyped("");
			setError(null);
		}
	}

	async function confirmDelete(e: React.FormEvent) {
		e.preventDefault();
		if (!confirmed) return;
		setError(null);
		setDeleting(true);
		try {
			await deleteMyAccountFn({ data: { confirm: typed } });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't delete your account. Try again.");
			setDeleting(false);
			return;
		}
		// The session died with the account; clear the leftover cookies, then go to sign up.
		await authClient.signOut().catch(() => {});
		window.location.href = "/auth/register";
	}

	return (
		<>
			<Card className="scroll-reveal mt-6 border-destructive/30">
				<CardContent className="flex flex-wrap items-center justify-between gap-4">
					<div className="min-w-0">
						<p className="font-medium">Delete account</p>
						<p className="text-sm text-muted-foreground">
							Permanently removes your account and your access to Seen. This can't be undone.
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						className="shrink-0 border-destructive/40 text-destructive hover:bg-destructive hover:text-white"
						onClick={() => setOpen(true)}
					>
						<IconTrash className="size-4" />
						Delete account
					</Button>
				</CardContent>
			</Card>

			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent>
					<form onSubmit={confirmDelete} className="space-y-4">
						<DialogHeader>
							<DialogTitle>Delete your account?</DialogTitle>
							<DialogDescription>
								This permanently deletes your account and signs you out everywhere. Brands and results stay with the
								team.
							</DialogDescription>
						</DialogHeader>
						{error && (
							<Alert variant="destructive">
								<AlertDescription>{error}</AlertDescription>
							</Alert>
						)}
						<div className="space-y-2">
							<Label htmlFor="delete-confirm">
								Type <span className="font-mono font-semibold text-foreground">{DELETE_CONFIRM_PHRASE}</span> to confirm
							</Label>
							<Input
								id="delete-confirm"
								value={typed}
								onChange={(e) => setTyped(e.target.value)}
								autoComplete="off"
								autoCapitalize="off"
								spellCheck={false}
								autoFocus
							/>
						</div>
						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>
								Cancel
							</Button>
							<Button type="submit" variant="destructive" disabled={!confirmed || deleting}>
								{deleting ? "Deleting..." : "Confirm"}
							</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	);
}
