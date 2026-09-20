/**
 * "Export" dropdown shared by the finders: download a CSV, or get the table into
 * Google Sheets. Sheets is a copy-and-paste hand-off (the table goes on the
 * clipboard, then a blank sheet opens): creating a sheet directly would need a
 * Google Drive permission that has to pass Google's review first.
 */
import { IconChevronDown, IconDownload, IconFileTypeCsv, IconTable } from "@tabler/icons-react";
import { Button, buttonVariants } from "@workspace/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useState } from "react";
import { copyTableForSheets, downloadCsv, type ExportColumn, exportFileName } from "@/lib/table-export";

export function ExportMenu<T>({
	rows,
	columns,
	filePrefix,
	brandName,
	disabled,
}: {
	rows: readonly T[];
	columns: readonly ExportColumn<T>[];
	/** File name stem, e.g. "article-finder". */
	filePrefix: string;
	brandName?: string;
	disabled?: boolean;
}) {
	const [sheets, setSheets] = useState<"closed" | "copied" | "blocked">("closed");
	const csv = () => downloadCsv(rows, columns, exportFileName(filePrefix, brandName, "csv"));
	const rowLabel = `${rows.length} ${rows.length === 1 ? "row" : "rows"}`;

	async function openSheetsHandoff() {
		setSheets((await copyTableForSheets(rows, columns)) ? "copied" : "blocked");
	}

	return (
		<>
			<DropdownMenu>
				<DropdownMenuTrigger render={<Button variant="outline" size="sm" disabled={disabled} className="gap-1.5" />}>
					<IconDownload className="size-4" />
					Export
					<IconChevronDown className="size-3.5 opacity-60" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end" className="w-56">
					<DropdownMenuGroup>
						<DropdownMenuLabel>{rowLabel} shown</DropdownMenuLabel>
						<DropdownMenuItem className="cursor-pointer" onClick={csv}>
							<IconFileTypeCsv />
							Download CSV
						</DropdownMenuItem>
						<DropdownMenuItem className="cursor-pointer" onClick={openSheetsHandoff}>
							<IconTable />
							Open in Google Sheets
						</DropdownMenuItem>
					</DropdownMenuGroup>
				</DropdownMenuContent>
			</DropdownMenu>

			<Dialog open={sheets !== "closed"} onOpenChange={(open) => !open && setSheets("closed")}>
				<DialogContent>
					<DialogHeader className="text-left">
						<DialogTitle>{sheets === "copied" ? `${rowLabel} copied` : "Couldn't copy the table"}</DialogTitle>
						<DialogDescription>
							{sheets === "copied"
								? "Open a blank Google Sheet, click cell A1, and paste (⌘V on Mac, Ctrl+V on Windows)."
								: "Your browser blocked copying. Download the CSV instead, then use File, Import in Google Sheets."}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						{sheets === "copied" ? (
							<>
								<Button variant="outline" onClick={csv}>
									Download CSV Instead
								</Button>
								<a
									href="https://sheets.new"
									target="_blank"
									rel="noopener noreferrer"
									className={buttonVariants({ variant: "default" })}
									onClick={() => setSheets("closed")}
								>
									Open Google Sheets
								</a>
							</>
						) : (
							<Button
								onClick={() => {
									csv();
									setSheets("closed");
								}}
							>
								Download CSV
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
