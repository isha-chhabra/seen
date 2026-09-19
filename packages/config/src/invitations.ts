/**
 * Where an invitation link sends the invitee.
 *
 * Most invitees have no account yet, so the link opens the sign-up form and
 * carries on to the acceptance page once they're signed up and verified (the
 * form has a "Sign in" link for people who already have an account). Shared by
 * the invitation email and the Team page's copy-link button so both agree.
 */
export function invitationSignupPath(invitationId: string): string {
	return `/auth/register?returnTo=${encodeURIComponent(`/accept-invitation/${invitationId}`)}`;
}
