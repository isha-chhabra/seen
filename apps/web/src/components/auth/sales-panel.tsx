/** The upstream marketing/sales panel is not used in this build. */
interface SalesPanelProps {
	variant?: "cloud" | "self-hosted";
	source?: string;
}

export function SalesPanel(_props: SalesPanelProps) {
	return null;
}

export function SalesFooterLinks(_props: { source?: string }) {
	return null;
}
