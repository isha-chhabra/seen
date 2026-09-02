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

// Active item: pink-tint fill, pink icon, and a pink rail on the left edge.
// The `data-[active=true]:` prefixes mean this string is safe to apply to every item.
const ACTIVE =
	"relative data-[active=true]:!bg-highlight data-[active=true]:!text-highlight-foreground data-[active=true]:font-medium " +
	"[&[data-active=true]>svg]:!text-primary " +
	"data-[active=true]:before:absolute data-[active=true]:before:inset-y-1.5 data-[active=true]:before:left-0 " +
	"data-[active=true]:before:w-[3px] data-[active=true]:before:rounded-full data-[active=true]:before:bg-primary";

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
						{group.items.map((item) => (
							<SidebarMenuItem key={item.title}>
								<SidebarMenuButton
									render={<Link to={getHref(item.url, item.absolute)} onClick={() => setOpenMobile(false)} />}
									tooltip={item.title}
									isActive={isActive(item.url, item.absolute)}
									className={ACTIVE}
								>
									{item.icon && <item.icon />}
									<span>{item.title}</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						))}
					</SidebarMenu>
				</SidebarGroup>
			))}
		</>
	);
}
