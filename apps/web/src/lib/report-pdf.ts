/**
 * Turn the on-screen report pages into a downloaded multi-page PDF.
 *
 * html2canvas-pro (already a dep) snapshots each fixed-width page; a tiny
 * hand-rolled writer assembles them. Each PDF page's box is sized to the exact
 * aspect ratio of its snapshot, so nothing is stretched. Pixels are embedded
 * lossless (FlateDecode RGB) when the browser supports CompressionStream, with a
 * high-quality JPEG fallback, so text stays sharp.
 */
import html2canvas from "html2canvas-pro";

const PAGE_W_PT = 612; // US Letter width at 72dpi; height is derived per page

function b64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function zlibDeflate(bytes: Uint8Array): Promise<Uint8Array | null> {
	if (typeof CompressionStream === "undefined") return null;
	try {
		const cs = new CompressionStream("deflate");
		// read and write concurrently so the stream doesn't deadlock on backpressure
		const readPromise = new Response(cs.readable).arrayBuffer();
		const writer = cs.writable.getWriter();
		void writer.write(bytes).then(() => writer.close());
		return new Uint8Array(await readPromise);
	} catch {
		return null;
	}
}

interface ImgPage {
	bytes: Uint8Array;
	filter: "FlateDecode" | "DCTDecode";
	wPx: number;
	hPx: number;
}

function buildImagePdf(pages: ImgPage[]): Blob {
	const enc = new TextEncoder();
	const parts: Uint8Array[] = [];
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
		const hPt = Math.round((PAGE_W_PT * pg.hPx) / pg.wPx);

		startObj(pageIds[i]);
		put(
			`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W_PT} ${hPt}] ` +
				`/Resources << /XObject << /Im0 ${imgIds[i]} 0 R >> >> /Contents ${contentIds[i]} 0 R >>\nendobj\n`,
		);

		startObj(imgIds[i]);
		put(
			`<< /Type /XObject /Subtype /Image /Width ${pg.wPx} /Height ${pg.hPx} ` +
				`/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${pg.filter} /Length ${pg.bytes.length} >>\nstream\n`,
		);
		put(pg.bytes);
		put("\nendstream\nendobj\n");

		const content = `q\n${PAGE_W_PT} 0 0 ${hPt} 0 0 cm\n/Im0 Do\nQ\n`;
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

	return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

async function snapshotPage(el: HTMLElement): Promise<ImgPage> {
	// scale for sharpness, but keep the biggest side under ~4200px so getImageData
	// and deflate stay within a comfortable memory budget.
	const longest = Math.max(el.scrollWidth, el.scrollHeight, 1);
	const scale = Math.max(2, Math.min(3, Math.floor(4200 / longest) || 2));

	const canvas = await html2canvas(el, {
		scale,
		backgroundColor: "#ffffff",
		logging: false,
		useCORS: true,
		imageTimeout: 0,
	});
	if (!canvas.width || !canvas.height) throw new Error("report page rendered empty");

	// lossless path
	try {
		const ctx = canvas.getContext("2d");
		if (ctx) {
			const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
			const rgb = new Uint8Array((data.length / 4) * 3);
			for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
				rgb[j] = data[i];
				rgb[j + 1] = data[i + 1];
				rgb[j + 2] = data[i + 2];
			}
			const deflated = await zlibDeflate(rgb);
			if (deflated) return { bytes: deflated, filter: "FlateDecode", wPx: canvas.width, hPx: canvas.height };
		}
	} catch {
		// fall through to JPEG
	}

	// fallback
	let dataUrl: string;
	try {
		dataUrl = canvas.toDataURL("image/jpeg", 0.95);
	} catch {
		throw new Error("could not read the rendered page (canvas tainted)");
	}
	return { bytes: b64ToBytes(dataUrl.slice(dataUrl.indexOf(",") + 1)), filter: "DCTDecode", wPx: canvas.width, hPx: canvas.height };
}

/** Snapshot each element, assemble a PDF, trigger a download named `<fileName>.pdf`. */
export async function downloadReportPdf(pageEls: HTMLElement[], fileName: string): Promise<void> {
	// let charts / fonts settle before snapshotting
	await new Promise((r) => setTimeout(r, 400));
	const imgPages: ImgPage[] = [];
	for (const el of pageEls) {
		imgPages.push(await snapshotPage(el));
	}
	const blob = buildImagePdf(imgPages);
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${String(fileName || "report").replace(/[^\w.\- ]+/g, "").trim() || "report"}.pdf`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 2000);
}
