import type { Icon } from "@tabler/icons-react";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import {
	SidebarGroup,
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@workspace/ui/components/sidebar";
import { motion } from "motion/react";

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

// Active item: pink-tint fill, pink icon. The rail on the left edge is a
// real motion.span (see below), not a CSS pseudo-element, so it can glide
// between items on navigation instead of just appearing/disappearing.
// The `data-[active=true]:` prefixes mean this string is safe to apply to every item.
const ACTIVE =
	"relative data-[active=true]:!bg-highlight data-[active=true]:!text-highlight-foreground data-[active=true]:font-medium " +
	"[&[data-active=true]>svg]:!text-primary";

export function NavMain({ groups }: { groups: NavGroup[] }) {
	const params = useParams({ strict: false }) as { brand?: string };
	const brandId = params.brand;
	const { setOpenMobile } = useSidebar();
	const location = useLocation();
	const pathname = location.pathname;

	const getHref = (url: string, absolute?: boolean) => {
		return absolute ? url : `/app/${brandId}${url}`;
	};

	const isActive = (url: string, absolute?: boolean) => {
		const href = getHref(url, absolute);
		if (href === `/app/${brandId}` || href === `/app/${brandId}/`) {
			return pathname === `/app/${brandId}` || pathname === `/app/${brandId}/`;
		}
		return pathname.startsWith(href);
	};

	return (
		<>
			{groups.map((group) => (
				<SidebarGroup key={group.label}>
					<SidebarGroupLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
						{group.label}
					</SidebarGroupLabel>
					<SidebarMenu>
						{group.items.map((item) => {
							const active = isActive(item.url, item.absolute);
							return (
								<SidebarMenuItem key={item.title}>
									<SidebarMenuButton
										render={<Link to={getHref(item.url, item.absolute)} onClick={() => setOpenMobile(false)} />}
										tooltip={item.title}
										isActive={active}
										className={ACTIVE}
									>
										{active && (
											<motion.span
												layoutId="nav-active-rail"
												className="pointer-events-none absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-primary"
												transition={{ type: "spring", stiffness: 500, damping: 35 }}
											/>
										)}
										<motion.span
											className="flex items-center gap-2"
											whileHover={{ x: 3 }}
											transition={{ type: "spring", stiffness: 500, damping: 30 }}
										>
											{item.icon && <item.icon />}
											<span>{item.title}</span>
										</motion.span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							);
						})}
					</SidebarMenu>
				</SidebarGroup>
			))}
		</>
	);
}
