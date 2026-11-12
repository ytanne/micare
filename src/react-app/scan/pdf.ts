// Minimal PDF writer: one full-bleed JPEG per page. No dependencies.
export interface PdfPage { jpeg: Uint8Array; w: number; h: number }

export function buildPdf(pages: PdfPage[]): Blob {
	const enc = new TextEncoder();
	const chunks: Uint8Array[] = [];
	const offsets: number[] = [];
	let len = 0;
	const push = (d: string | Uint8Array) => {
		const b = typeof d === "string" ? enc.encode(d) : d;
		chunks.push(b);
		len += b.length;
	};
	const obj = (n: number, ...body: (string | Uint8Array)[]) => {
		offsets[n] = len;
		push(`${n} 0 obj\n`);
		body.forEach(push);
		push("\nendobj\n");
	};

	push("%PDF-1.4\n");
	obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
	obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(" ")}] >>`);
	pages.forEach((p, i) => {
		const s = 842 / Math.max(p.w, p.h); // longest side = A4 long edge (842 pt)
		const pw = +(p.w * s).toFixed(2), ph = +(p.h * s).toFixed(2);
		const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
		obj(3 + 3 * i, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 ${5 + 3 * i} 0 R >> >> /Contents ${4 + 3 * i} 0 R >>`);
		obj(4 + 3 * i, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
		obj(5 + 3 * i,
			`<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
			p.jpeg, "\nendstream");
	});

	const count = 3 + 3 * pages.length;
	const xref = len;
	push(`xref\n0 ${count}\n0000000000 65535 f \n`);
	for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
	push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
	return new Blob(chunks as BlobPart[], { type: "application/pdf" });
}
