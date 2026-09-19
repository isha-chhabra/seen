/**
 * Everything known about one creator, in a side panel: why they fit (in their own
 * words), the numbers, their collaboration history, the competitor check, and
 * their recent posts with each sponsorship tag.
 */
import { IconAlertTriangle, IconCircleCheck, IconExternalLink, IconShieldX } from "@tabler/icons-react";
import type { CreatorPost, InfluencerResult, SponsorTag } from "@workspace/lib/influencer-finder/types";
import { Badge } from "@workspace/ui/components/badge";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { cn } from "@workspace/ui/lib/utils";
import type { ReactNode } from "react";
import { UserAvatar } from "@/components/user-avatar";
import { formatCount, formatDaysAgo } from "@/lib/influencer-results";
import { EXCLUDED_LABEL, FitBar, PLATFORM_LABEL, PlatformIcon, VerdictBadge } from "./parts";

const TAG_STYLE: Record<Exclude<SponsorTag, "organic">, { label: string; className: string }> = {
	ad: { label: "Ad", className: "bg-primary/15 text-primary" },
	gifted: {
		label: "Gifted",
		className: "bg-[color-mix(in_oklch,var(--chart-2)_18%,transparent)] text-[var(--chart-2)]",
	},
	code: {
		label: "Discount code",
		className: "bg-[color-mix(in_oklch,var(--chart-5)_18%,transparent)] text-[var(--chart-5)]",
	},
	partner: {
		label: "Partner",
		className: "bg-[color-mix(in_oklch,var(--chart-3)_18%,transparent)] text-[var(--chart-3)]",
	},
	own_brand: { label: "Own brand", className: "bg-muted text-muted-foreground" },
};

function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
	return (
		<div className="rounded-lg border bg-card/60 p-3">
			<dt className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">{label}</dt>
			<dd className="mt-1 font-semibold text-base tabular-nums">{value}</dd>
			{hint && <p className="mt-0.5 text-muted-foreground text-xs">{hint}</p>}
		</div>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section className="space-y-2.5">
			<h3 className="font-semibold text-sm">{title}</h3>
			{children}
		</section>
	);
}

function PostRow({ post }: { post: CreatorPost }) {
	const tag = post.tag === "organic" ? null : TAG_STYLE[post.tag];
	return (
		<li className="space-y-1 rounded-lg border bg-card/40 p-3">
			<div className="flex items-center gap-2 text-muted-foreground text-xs">
				<span>
					{post.date
						? formatDaysAgo(Math.round((Date.now() - new Date(post.date).getTime()) / 86_400_000))
						: "Date unknown"}
				</span>
				{post.kind && <span>· {post.kind}</span>}
				{tag && (
					<span className={cn("rounded-full px-1.5 py-0.5 font-medium text-[10px]", tag.className)}>
						{tag.label}
						{post.brand ? `: @${post.brand}` : ""}
					</span>
				)}
				{post.url && (
					<a
						href={post.url}
						target="_blank"
						rel="noopener noreferrer"
						className="ml-auto hover:text-foreground"
						aria-label="Open post"
					>
						<IconExternalLink className="size-3.5" />
					</a>
				)}
			</div>
			<p className="text-sm leading-snug">
				{post.caption || <span className="text-muted-foreground">No caption</span>}
			</p>
		</li>
	);
}

export function CreatorSheet({ creator, onClose }: { creator: InfluencerResult | null; onClose: () => void }) {
	const c = creator;
	return (
		<Sheet open={c !== null} onOpenChange={(open) => !open && onClose()}>
			<SheetContent className="w-full gap-0 p-0 sm:max-w-xl">
				{c && (
					<>
						<SheetHeader className="space-y-3 border-b p-6 text-left">
							<div className="flex items-center gap-3">
								<UserAvatar name={c.name ?? c.handle} seed={c.key} className="size-12 rounded-xl text-base" />
								<div className="min-w-0">
									<SheetTitle className="truncate text-lg">{c.name ?? `@${c.handle}`}</SheetTitle>
									<SheetDescription className="flex items-center gap-1.5">
										<PlatformIcon platform={c.platform} className="size-3.5" />
										<a
											href={c.profileUrl}
											target="_blank"
											rel="noopener noreferrer"
											className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
										>
											@{c.handle}
											<IconExternalLink className="size-3" />
										</a>
										<span>· {PLATFORM_LABEL[c.platform]}</span>
									</SheetDescription>
								</div>
								<VerdictBadge verdict={c.verdict} className="ml-auto mr-6" />
							</div>
						</SheetHeader>

						<div className="flex-1 space-y-6 overflow-y-auto p-6">
							<Section title="Why they fit">
								<div className="flex items-center gap-3">
									<FitBar score={c.fitScore} className="[&>div]:w-40" />
									<span className="text-muted-foreground text-xs">{Math.round(c.confidence * 100)}% confident</span>
									{c.verdict === "exclude" && c.excludedBecause && (
										<Badge variant="secondary">{EXCLUDED_LABEL[c.excludedBecause]}</Badge>
									)}
								</div>
								<p className="text-sm leading-relaxed">{c.fitReason}</p>
								{c.fitEvidence.length > 0 && (
									<ul className="space-y-1.5">
										{c.fitEvidence.map((q) => (
											<li key={q} className="border-primary/40 border-l-2 pl-3 text-muted-foreground text-sm italic">
												“{q}”
											</li>
										))}
									</ul>
								)}
								{c.concern && (
									<p className="flex gap-2 rounded-lg border border-[color-mix(in_oklch,var(--chart-2)_40%,transparent)] bg-[color-mix(in_oklch,var(--chart-2)_10%,transparent)] p-3 text-sm">
										<IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-[var(--chart-2)]" />
										{c.concern}
									</p>
								)}
							</Section>

							<Section title="Numbers">
								<dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
									<Stat
										label="Followers"
										value={formatCount(c.followers)}
										hint={c.postsCount ? `${formatCount(c.postsCount)} posts in total` : undefined}
									/>
									<Stat
										label="Engagement"
										value={c.engagementPct === null ? "—" : `${Math.round(c.engagementPct * 100) / 100}%`}
										hint={
											c.engagementPct === null
												? "Likes are hidden or unavailable"
												: `Average of ${c.engagementSample} post${c.engagementSample === 1 ? "" : "s"}`
										}
									/>
									<Stat
										label="Posting"
										value={c.postsPerWeek === null ? "—" : `${c.postsPerWeek}/wk`}
										hint={c.platform === "tiktok" ? "Not measurable on TikTok yet" : undefined}
									/>
									<Stat label="Last post" value={formatDaysAgo(c.lastPostDaysAgo)} />
									<Stat
										label="Sponsored"
										value={`${c.collab.sponsoredPosts} of ${c.collab.postsChecked}`}
										hint="Recent posts with a sponsorship marker"
									/>
									<Stat
										label="Discloses"
										value={c.collab.discloses === null ? "—" : c.collab.discloses ? "Yes" : "Not always"}
									/>
								</dl>
							</Section>

							<Section title="Brand collaborations">
								{c.collab.brands.length === 0 ? (
									<p className="text-muted-foreground text-sm">No brand partners spotted in their recent posts.</p>
								) : (
									<div className="flex flex-wrap gap-1.5">
										{c.collab.brands.map((b) => (
											<Badge key={b} variant="secondary">
												@{b}
											</Badge>
										))}
									</div>
								)}
							</Section>

							<Section title="Competitor check">
								{c.competitor.isCompetitor || c.competitor.promotesCompetitor ? (
									<p className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
										<IconShieldX className="mt-0.5 size-4 shrink-0 text-destructive" />
										<span>
											<strong>
												{c.competitor.isCompetitor ? "This account is a competitor" : "Promotes a competitor"}
											</strong>
											{c.competitor.names.length > 0 && <> ({c.competitor.names.join(", ")})</>}.{" "}
											{c.competitor.evidence}
										</span>
									</p>
								) : (
									<p className="flex items-center gap-2 text-sm">
										<IconCircleCheck className="size-4 text-[var(--chart-1)]" />
										No competitor conflict found in their identity or sponsored posts.
									</p>
								)}
							</Section>

							{(c.bio || c.links.length > 0) && (
								<Section title="Bio">
									{c.bio && <p className="whitespace-pre-line text-sm leading-relaxed">{c.bio}</p>}
									{c.links.length > 0 && (
										<div className="flex flex-wrap gap-1.5">
											{c.links.map((l) => (
												<Badge key={l} variant="outline">
													{l}
												</Badge>
											))}
										</div>
									)}
								</Section>
							)}

							{c.recentPosts.length > 0 && (
								<Section title={`Recent posts (${c.recentPosts.length})`}>
									<ul className="space-y-2">
										{c.recentPosts.map((p) => (
											<PostRow key={`${p.url ?? p.date}-${p.caption.slice(0, 12)}`} post={p} />
										))}
									</ul>
								</Section>
							)}
						</div>
					</>
				)}
			</SheetContent>
		</Sheet>
	);
}
