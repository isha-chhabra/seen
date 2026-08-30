/**
 * Turn two on-screen report pages into a downloaded 2-page US-Letter PDF.
 *
 * html2canvas-pro (already a dep, see use-chart-export) snapshots each page to a
 * JPEG; a tiny hand-rolled image-PDF writer (no new dependency) assembles them.
 */
import html2canvas from "html2canvas-pro";

const PAGE_PT = { w: 612, h: 792 }; // US Letter at 72dpi

function dataUrlToBytes(dataUrl: string): Uint8Array {
	const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

interface ImgPage {
	jpeg: Uint8Array;
	wPx: number;
	hPx: number;
}

function buildImagePdf(pages: ImgPage[]): Blob {
	const enc = new TextEncoder();
	const parts: (Uint8Array | string)[] = [];
	const offsets: number[] = [];
	let offset = 0;
	const put = (v: Uint8Array | string) => {
		const b = typeof v === "string" ? enc.encode(v) : v;
		parts.push(b);
		offset += b.length;
	};
	const startObj = (id: number) => {
		offsets[id] = offset;
		put(`${id} 0 obj\n`);
	};

	put("%PDF-1.4\n");
	const n = pages.length;
	const pageIds = pages.map((_, i) => 3 + i * 3);
	const imgIds = pages.map((_, i) => 4 + i * 3);
	const contentIds = pages.map((_, i) => 5 + i * 3);

	startObj(1);
	put("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
	startObj(2);
	put(`<< /Type /Pages /Count ${n} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>\nendobj\n`);

	pages.forEach((pg, i) => {
		startObj(pageIds[i]);
		put(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_PT.w} ${PAGE_PT.h}] ` +
				`/Resources << /XObject << /Im0 ${imgIds[i]} 0 R >> >> /Contents ${contentIds[i]} 0 R >>\nendobj\n`,
		);

		startObj(imgIds[i]);
		put(
			`<< /Type /XObject /Subtype /Image /Width ${pg.wPx} /Height ${pg.hPx} ` +
				`/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>\nstream\n`,
		);
		put(pg.jpeg);
		put("\nendstream\nendobj\n");

		const content = `q\n${PAGE_PT.w} 0 0 ${PAGE_PT.h} 0 0 cm\n/Im0 Do\nQ\n`;
		startObj(contentIds[i]);
		put(`<< /Length ${enc.encode(content).length} >>\nstream\n${content}endstream\nendobj\n`);
	});

	const xrefStart = offset;
	const maxId = 2 + n * 3;
	put(`xref\n0 ${maxId + 1}\n0000000000 65535 f \n`);
	for (let id = 1; id <= maxId; id++) {
		put(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
	}
	put(`trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

	const blobParts = parts.map((p) => (typeof p === "string" ? enc.encode(p) : p));
	return new Blob(blobParts as BlobPart[], { type: "application/pdf" });
}

/** Snapshot each element, assemble a PDF, trigger a download named `<fileName>.pdf`. */
export async function downloadReportPdf(pageEls: HTMLElement[], fileName: string): Promise<void> {
	// let charts / fonts settle before snapshotting
	await new Promise((r) => setTimeout(r, 350));
	const imgPages: ImgPage[] = [];
	for (const el of pageEls) {
		const canvas = await html2canvas(el, {
			scale: 2,
			backgroundColor: "#ffffff",
			logging: false,
			useCORS: true,
			imageTimeout: 0,
		});
		if (!canvas.width || !canvas.height) throw new Error("report page rendered empty");
		let dataUrl: string;
		try {
			dataUrl = canvas.toDataURL("image/jpeg", 0.92);
		} catch {
			throw new Error("could not read the rendered page (canvas tainted)");
		}
		imgPages.push({ jpeg: dataUrlToBytes(dataUrl), wPx: canvas.width, hPx: canvas.height });
	}
	const blob = buildImagePdf(imgPages);
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${fileName.replace(/[^\w.\- ]+/g, "").trim() || "report"}.pdf`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}
