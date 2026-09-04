/**
 * /app/$brand/settings/members - Team settings page (cloud only)
 *
 * Invite teammates by email, list current members, and manage pending
 * invitations. The redirect in the loader is UX only — the security
 * boundary is the teamInvites guard inside every team server function.
 */
import { IconCheck, IconCopy } from "@tabler/icons-react";
import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { isOrgAdminRole } from "@workspace/config/roles";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { cn } from "@workspace/ui/lib/utils";
import { useState } from "react";
import { trackEvent } from "@/lib/posthog";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";
import {
	cancelInvitationFn,
	inviteTeamMemberFn,
	listTeamFn,
	removeTeamMemberFn,
	type TeamData,
	updateOrganizationFn,
} from "@/server/team";

/** No transactional email on this deployment, so the accept link is shared by hand. */
function inviteLink(id: string): string {
	return `${window.location.origin}/accept-invitation/${id}`;
}

async function copyText(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard && window.isSecureContext) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		/* fall through to the legacy path */
	}
	try {
		const ta = document.createElement("textarea");
		ta.value = text;
		ta.style.position = "fixed";
		ta.style.opacity = "0";
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand("copy");
		ta.remove();
		return ok;
	} catch {
		return false;
	}
}

export const Route = createFileRoute("/_authed/app/$brand/settings/members")({
	loader: async ({ params, context }): Promise<TeamData> => {
		if (!context.clientConfig?.features.teamInvites) {
			throw redirect({ to: "/app/$brand", params: { brand: params.brand } });
		}
		return listTeamFn({ data: { brandId: params.brand } });
	},
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("Team", { appName, brandName }) },
				{ name: "description", content: "Invite teammates and manage team members." },
			],
		};
	},
	component: TeamSettingsPage,
});

function TeamSettingsPage() {
	const { brand: brandId } = Route.useParams();
	const { members, invitations, currentUserId, organization } = Route.useLoaderData();
	const isAdmin = isOrgAdminRole(members.find((m) => m.userId === currentUserId)?.role ?? "");
	const router = useRouter();
	const [inviteEmail, setInviteEmail] = useState("");
	const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
	const [inviteExpiry, setInviteExpiry] = useState("30");
	const [inviting, setInviting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [workspaceName, setWorkspaceName] = useState(organization.name);
	const [savingWorkspace, setSavingWorkspace] = useState(false);
	const [lastInvite, setLastInvite] = useState<{ email: string; id: string } | null>(null);
	const [copiedId, setCopiedId] = useState<string | null>(null);

	function copyInviteLink(id: string) {
		void copyText(inviteLink(id)).then((ok) => {
			if (!ok) return;
			setCopiedId(id);
			setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1600);
		});
	}

	async function handleSaveWorkspace(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setSavingWorkspace(true);
		try {
			await updateOrganizationFn({ data: { brandId, name: workspaceName } });
			await router.invalidate();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to update workspace name");
		} finally {
			setSavingWorkspace(false);
		}
	}

	async function handleInvite(e: React.FormEvent) {
		e.preventDefault();
		if (!isAdmin) return;
		setError(null);
		setInviting(true);
		const email = inviteEmail;
		try {
			const res = await inviteTeamMemberFn({
				data: { brandId, email, role: inviteRole, expiresInDays: inviteExpiry === "never" ? 36_500 : Number(inviteExpiry) },
			});
			trackEvent("team_member_invited", { role: inviteRole });
			setInviteEmail("");
			setInviteRole("member");
			await router.invalidate();
			if (res?.id) {
				setLastInvite({ email, id: res.id });
				copyInviteLink(res.id);
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to send invitation");
		} finally {
			setInviting(false);
		}
	}

	async function handleRemove(memberId: string) {
		setError(null);
		try {
			await removeTeamMemberFn({ data: { brandId, memberId } });
			await router.invalidate();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to remove member");
		}
	}

	async function handleCancel(invitationId: string) {
		setError(null);
		try {
			await cancelInvitationFn({ data: { brandId, invitationId } });
			await router.invalidate();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to cancel invitation");
		}
	}

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-3xl font-bold">Team</h1>
				<p className="text-muted-foreground">Invite teammates and manage who has access to your workspace.</p>
			</div>

			{error && (
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			)}

			<div className="space-y-3">
				<h2 className="text-lg font-semibold">Workspace</h2>
				<form onSubmit={handleSaveWorkspace} className="flex flex-wrap items-end gap-3">
					<div className="flex flex-col gap-2">
						<Label htmlFor="workspace-name">Name</Label>
						<Input
							id="workspace-name"
							value={workspaceName}
							onChange={(e) => setWorkspaceName(e.target.value)}
							required
							className="w-64"
						/>
					</div>
					<Button type="submit" disabled={savingWorkspace}>
						{savingWorkspace ? "Saving..." : "Save"}
					</Button>
				</form>
			</div>

			<div className="space-y-2">
				<h2 className="text-lg font-semibold">Invite a teammate</h2>
				{!isAdmin && (
					<p className="text-sm text-muted-foreground">Contact an admin to invite more members.</p>
				)}
				<form
					onSubmit={handleInvite}
					className={cn("flex flex-wrap items-end gap-3", !isAdmin && "pointer-events-none opacity-50")}
				>
					<div className="flex flex-col gap-2">
						<Label htmlFor="invite-email">Email</Label>
						<Input
							id="invite-email"
							type="email"
							placeholder="teammate@example.com"
							value={inviteEmail}
							onChange={(e) => setInviteEmail(e.target.value)}
							required
							disabled={!isAdmin || inviting}
							className="w-64"
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="invite-role">Role</Label>
						<Select
							items={{ member: "Member", admin: "Admin" }}
							value={inviteRole}
							onValueChange={(value) => setInviteRole(value as "member" | "admin")}
							disabled={!isAdmin}
						>
							<SelectTrigger id="invite-role" className="w-32">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="member">Member</SelectItem>
								<SelectItem value="admin">Admin</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="invite-expiry">Link expires</Label>
						<Select
							items={{ "7": "7 days", "30": "30 days", never: "Never" }}
							value={inviteExpiry}
							onValueChange={(value) => setInviteExpiry(value)}
							disabled={!isAdmin}
						>
							<SelectTrigger id="invite-expiry" className="w-32">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="7">7 days</SelectItem>
								<SelectItem value="30">30 days</SelectItem>
								<SelectItem value="never">Never</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<Button type="submit" disabled={!isAdmin || inviting}>
						{inviting ? "Inviting..." : "Invite"}
					</Button>
				</form>

				{lastInvite && (
					<div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] px-3 py-2 text-sm">
						<span className="text-muted-foreground">
							Invited <span className="font-medium text-foreground">{lastInvite.email}</span>. Send them this link:
						</span>
						<code className="min-w-0 flex-1 truncate rounded bg-background px-1.5 py-0.5 text-xs">
							{inviteLink(lastInvite.id)}
						</code>
						<Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => copyInviteLink(lastInvite.id)}>
							{copiedId === lastInvite.id ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
							{copiedId === lastInvite.id ? "Copied" : "Copy"}
						</Button>
					</div>
				)}
			</div>

			<div className="space-y-3">
				<h2 className="text-lg font-semibold">Members</h2>
				<div className="divide-y rounded-md border">
					{members.map((m) => (
						<div key={m.id} className="flex items-center justify-between gap-3 p-3">
							<div className="min-w-0">
								<p className="truncate font-medium">{m.name}</p>
								<p className="truncate text-sm text-muted-foreground">{m.email}</p>
							</div>
							<div className="flex shrink-0 items-center gap-3">
								<Badge variant="secondary">{m.role}</Badge>
								{m.userId !== currentUserId && (
									<Button type="button" variant="outline" size="sm" onClick={() => handleRemove(m.id)}>
										Remove
									</Button>
								)}
							</div>
						</div>
					))}
				</div>
			</div>

			{invitations.length > 0 && (
				<div className="space-y-3">
					<h2 className="text-lg font-semibold">Pending invitations</h2>
					<div className="divide-y rounded-md border">
						{invitations.map((inv) => (
							<div key={inv.id} className="flex items-center justify-between gap-3 p-3">
								<div className="min-w-0">
									<p className="truncate font-medium">{inv.email}</p>
									<p className="text-sm text-muted-foreground">
										{new Date(inv.expiresAt).getFullYear() - new Date().getFullYear() >= 50
											? "Never expires"
											: `Expires ${new Date(inv.expiresAt).toLocaleDateString()}`}
									</p>
								</div>
								<div className="flex shrink-0 items-center gap-2">
									<Badge variant="secondary">{inv.role ?? "member"}</Badge>
									<Button
										type="button"
										variant="outline"
										size="sm"
										className="gap-1.5"
										onClick={() => copyInviteLink(inv.id)}
									>
										{copiedId === inv.id ? <IconCheck className="size-3.5" /> : <IconCopy className="size-3.5" />}
										{copiedId === inv.id ? "Copied" : "Copy link"}
									</Button>
									{isAdmin && (
										<Button type="button" variant="ghost" size="sm" onClick={() => handleCancel(inv.id)}>
											Cancel
										</Button>
									)}
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
