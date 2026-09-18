import type { Icon } from "@tabler/icons-react";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { useSidebar } from "@workspace/ui/components/sidebar";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useRef, useState } from "react";

export interface NavItem {
	title: string;
	url: string;
	icon?: Icon;
	absolute?: boolean;
}

export interface NavGroup {
	label: string;
	items: NavItem[];
}

interface HoverState {
	href: string;
	top: number;
	height: number;
}

/**
 * Sidebar navigation in the "ruler" style: each row has small tick marks on
 * its left edge, non-focused rows dim while one is hovered, a highlight pill
 * slides between rows, and the active row is marked by a short accent bar
 * that glides to the next active row on navigation. The nav data, links,
 * active detection and mobile-close behavior are unchanged; only the
 * presentation is. Icons on NavItem are intentionally not rendered here —
 * the tick marks take their place. Respects prefers-reduced-motion.
 */
export function NavMain({ groups }: { groups: NavGroup[] }) {
	const params = useParams({ strict: false }) as { brand?: string };
	const brandId = params.brand;
	const { setOpenMobile } = useSidebar();
	const pathname = useLocation().pathname;
	const containerRef = useRef<HTMLDivElement>(null);
	const [hover, setHover] = useState<HoverState | null>(null);

	const getHref = (url: string, absolute?: boolean) => (absolute ? url : `/app/${brandId}${url}`);

	const isActive = (href: string) => {
		if (href === `/app/${brandId}` || href === `/app/${brandId}/`) {
			return pathname === `/app/${brandId}` || pathname === `/app/${brandId}/`;
		}
		return pathname.startsWith(href);
	};

	function showHover(href: string, row: HTMLElement) {
		const container = containerRef.current;
		if (!container) return;
		const rowRect = row.getBoundingClientRect();
		const containerRect = container.getBoundingClientRect();
		setHover({ href, top: rowRect.top - containerRect.top, height: rowRect.height });
	}

	return (
		<MotionConfig reducedMotion="user">
			<div ref={containerRef} className="relative px-2">
				<AnimatePresence>
					{hover && (
						<motion.div
							key="nav-hover-pill"
							className="pointer-events-none absolute right-2 left-[33px] z-0 rounded-md bg-primary/15"
							initial={false}
							animate={{ top: hover.top + 2, height: hover.height - 4, opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={{ type: "spring", stiffness: 300, damping: 30 }}
						/>
					)}
				</AnimatePresence>

				{groups.map((group) => (
					<div key={group.label} className="flex flex-col">
						<div className="mt-2 px-0 py-3.5 font-medium text-foreground/40 text-sm">{group.label}</div>
						{group.items.map((item) => {
							const href = getHref(item.url, item.absolute);
							const active = isActive(href);
							const isHovered = hover?.href === href;
							const opacity = active ? 1 : hover ? (isHovered ? 1 : 0.3) : 0.55;
							const x = active ? 8 : isHovered ? 6 : 0;
							return (
								<div key={item.title} className="relative">
									{active && (
										<motion.span
											layoutId="nav-active-bar"
											className="pointer-events-none absolute top-1/2 left-[4px] z-10 h-[1.8px] w-[23px] -translate-y-1/2 rounded-full bg-primary"
											transition={{ type: "spring", stiffness: 800, damping: 40 }}
										/>
									)}
									<motion.span
										className="pointer-events-none absolute top-1/2 left-0 h-px -translate-y-1/2 bg-foreground/50"
										animate={{ width: active ? 0 : isHovered ? 26 : 18 }}
										transition={{ type: "spring", stiffness: 600, damping: 30 }}
									/>
									<span className="pointer-events-none absolute top-0 left-0 h-px w-[16px] bg-foreground/30" />
									<span className="pointer-events-none absolute top-1/4 left-0 h-px w-[13px] bg-foreground/30" />
									<span className="pointer-events-none absolute top-3/4 left-0 h-px w-[13px] bg-foreground/30" />

									<motion.div
										animate={{ opacity, x }}
										transition={{ type: "spring", stiffness: 700, damping: 30 }}
										style={{ transformOrigin: "left center" }}
									>
										<Link
											to={href}
											aria-current={active ? "page" : undefined}
											onClick={() => setOpenMobile(false)}
											onMouseEnter={(e) =>
												showHover(href, e.currentTarget.parentElement?.parentElement ?? e.currentTarget)
											}
											onFocus={(e) => showHover(href, e.currentTarget.parentElement?.parentElement ?? e.currentTarget)}
											onMouseLeave={() => setHover(null)}
											onBlur={() => setHover(null)}
											className="relative ml-2 flex select-none items-center gap-2 py-1.5 pl-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
										>
											<span className="relative z-1 truncate">{item.title}</span>
										</Link>
									</motion.div>
								</div>
							);
						})}
					</div>
				))}
			</div>
		</MotionConfig>
	);
}
