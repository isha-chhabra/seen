/**
 * Turns result rows into a file or a paste-ready table, shared by every finder.
 *
 * Cells hold text scraped from the web (captions, titles), so anything that a
 * spreadsheet would read as a formula ("=", "+", "-", "@" first) gets a leading
 * apostrophe. That keeps a malicious caption from running as a formula when the
 * file is opened in Excel or the table is pasted into Google Sheets.
 */

export interface ExportColumn<T> {
	header: string;
	value: (row: T) => string | number | boolean | null | undefined;
}

const FORMULA_START = /^[=+\-@\t\r]/;

function cellText(value: string | number | boolean | null | undefined): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "boolean") return value ? "yes" : "";
	const text = String(value).replace(/\r?\n/g, " ").trim();
	// Plain negative numbers are fine; only text that could be a formula is defused.
	if (typeof value === "string" && FORMULA_START.test(text)) return `'${text}`;
	return text;
}

export function toCsv<T>(rows: readonly T[], columns: readonly ExportColumn<T>[]): string {
	const quote = (text: string) => `"${text.replace(/"/g, '""')}"`;
	const lines = [columns.map((c) => quote(c.header)).join(",")];
	for (const row of rows) lines.push(columns.map((c) => quote(cellText(c.value(row)))).join(","));
	return lines.join("\r\n");
}

/** Tab-separated, what Google Sheets and Excel split into cells when pasted. */
export function toTsv<T>(rows: readonly T[], columns: readonly ExportColumn<T>[]): string {
	const clean = (text: string) => text.replace(/\t/g, " ");
	const lines = [columns.map((c) => clean(c.header)).join("\t")];
	for (const row of rows) lines.push(columns.map((c) => clean(cellText(c.value(row)))).join("\t"));
	return lines.join("\n");
}

/** "article-finder-chicos-2026-09-19.csv" */
export function exportFileName(prefix: string, brandName: string | undefined, ext: string, now = new Date()): string {
	const brand = (brandName ?? "brand")
		.replace(/[^\w.\- ]+/g, "")
		.trim()
		.replace(/\s+/g, "-");
	const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
	return `${prefix}-${brand || "brand"}-${day}.${ext}`;
}

export function downloadCsv<T>(rows: readonly T[], columns: readonly ExportColumn<T>[], fileName: string): void {
	// The byte-order mark makes Excel read the file as UTF-8 (names, emoji, accents).
	const blob = new Blob([`﻿${toCsv(rows, columns)}`], { type: "text/csv;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = fileName;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

/** Puts the table on the clipboard as tab-separated text. Resolves false when the browser refuses. */
export async function copyTableForSheets<T>(rows: readonly T[], columns: readonly ExportColumn<T>[]): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(toTsv(rows, columns));
		return true;
	} catch {
		return false;
	}
}
