import { describe, expect, it } from "vitest";
import { exportFileName, toCsv, toTsv } from "../table-export";

type Row = { name: string; note: string | null; n: number | null; flag?: boolean };
const columns = [
	{ header: "name", value: (r: Row) => r.name },
	{ header: "note", value: (r: Row) => r.note },
	{ header: "n", value: (r: Row) => r.n },
	{ header: "flag", value: (r: Row) => r.flag },
];

describe("toCsv", () => {
	it("quotes every cell, doubles inner quotes, and writes booleans and blanks", () => {
		const csv = toCsv([{ name: 'He said "hi", ok', note: null, n: 3, flag: true }], columns);
		expect(csv.split("\r\n")).toEqual(['"name","note","n","flag"', '"He said ""hi"", ok","","3","yes"']);
	});

	it("keeps multi-line text on one row", () => {
		const csv = toCsv([{ name: "a\nb", note: "c\r\nd", n: 1 }], columns);
		expect(csv.split("\r\n")).toHaveLength(2);
		expect(csv).toContain('"a b"');
	});

	it("defuses text a spreadsheet would run as a formula, but leaves real numbers alone", () => {
		const csv = toCsv(
			[
				{ name: '=HYPERLINK("http://evil")', note: "+1 555", n: -5 },
				{ name: "@cmd", note: "-2+3", n: 0 },
			],
			columns,
		);
		expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
		expect(csv).toContain(`"'+1 555"`);
		expect(csv).toContain(`"'@cmd"`);
		expect(csv).toContain(`"'-2+3"`);
		expect(csv).toContain('"-5"'); // a numeric cell stays a number
	});
});

describe("toTsv", () => {
	it("separates cells with tabs and rows with newlines, flattening embedded tabs", () => {
		const tsv = toTsv([{ name: "a\tb", note: "x", n: 2 }], columns);
		expect(tsv).toBe("name\tnote\tn\tflag\na b\tx\t2\t");
	});

	it("defuses formulas in pasted cells too", () => {
		expect(toTsv([{ name: "=1+1", note: null, n: 1 }], columns).split("\n")[1]).toBe("'=1+1\t\t1\t");
	});
});

describe("exportFileName", () => {
	it("builds prefix-brand-date.ext with a safe brand", () => {
		expect(exportFileName("article-finder", "Chico's FAS!", "csv", new Date(2026, 8, 5))).toBe(
			"article-finder-Chicos-FAS-2026-09-05.csv",
		);
		expect(exportFileName("influencers", undefined, "csv", new Date(2026, 0, 31))).toBe(
			"influencers-brand-2026-01-31.csv",
		);
	});
});
