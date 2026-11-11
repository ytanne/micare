import { openBook, resolvePath, type Book } from "../epub/epub";

// EPUB -> MOBI6 (.azw). Text + images only.
// shortcut: text is stored uncompressed, and there are no internal links, cover or CSS; upgrade if files are too big or devices want them.

const KEEP = new Set("p h1 h2 h3 h4 h5 h6 div span b i u em strong br hr ul ol li blockquote table tr td th sup sub pre center".split(" "));
const VOID = new Set(["br", "hr"]);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Chapter DOM -> minimal HTML; <img> become recindex references (1-based image record numbers).
function walk(node: Node, rec: Map<Element, number>): string {
	if (node.nodeType === 3) return esc(node.textContent ?? "");
	if (node.nodeType !== 1) return "";
	const el = node as Element;
	const tag = el.localName.toLowerCase();
	if (tag === "img") {
		const n = rec.get(el);
		return n ? `<img recindex="${String(n).padStart(5, "0")}"/>` : "";
	}
	if (["style", "script", "svg", "head", "title"].includes(tag)) return "";
	const inner = [...el.childNodes].map((c) => walk(c, rec)).join("");
	if (!KEEP.has(tag)) return inner;
	return VOID.has(tag) ? `<${tag}/>` : `<${tag}>${inner}</${tag}>`;
}

// Decode and re-encode as JPEG (MOBI6 readers handle JPEG/GIF only). Undecodable images (SVG) -> null.
async function toJpeg(blob: Blob): Promise<Uint8Array | null> {
	try {
		const bmp = await createImageBitmap(blob);
		const k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
		const c = document.createElement("canvas");
		c.width = Math.max(1, Math.round(bmp.width * k));
		c.height = Math.max(1, Math.round(bmp.height * k));
		const g = c.getContext("2d")!;
		g.fillStyle = "#fff";
		g.fillRect(0, 0, c.width, c.height);
		g.drawImage(bmp, 0, 0, c.width, c.height);
		const out = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", 0.85));
		return out && new Uint8Array(await out.arrayBuffer());
	} catch {
		return null;
	}
}

async function flatten(book: Book) {
	const images: Uint8Array[] = [];
	const byPath = new Map<string, number>(); // zip path -> record number (0 = unusable)
	const parts: string[] = [];
	for (const path of book.chapters) {
		const html = await book.zip.file(path)!.async("string");
		let doc = new DOMParser().parseFromString(html, "application/xhtml+xml");
		if (doc.getElementsByTagName("parsererror").length) doc = new DOMParser().parseFromString(html, "text/html");
		const rec = new Map<Element, number>();
		for (const img of doc.getElementsByTagName("img")) {
			const src = img.getAttribute("src");
			if (!src) continue;
			const p = resolvePath(path, src);
			if (!byPath.has(p)) {
				const file = book.zip.file(p);
				const jpg = file && (await toJpeg(await file.async("blob")));
				if (jpg) images.push(jpg);
				byPath.set(p, jpg ? images.length : 0);
			}
			if (byPath.get(p)) rec.set(img, byPath.get(p)!);
		}
		parts.push(walk(doc.body ?? doc.documentElement, rec));
	}
	// Kindle 3 "Go To > Table of Contents" jumps to the guide's filepos; entries link by byte offset.
	// filepos is fixed-width, so offsets can be computed before the final text is assembled.
	const enc = new TextEncoder();
	const pos = (n: number) => String(n).padStart(10, "0");
	const SEP = "<mbp:pagebreak/>";
	const head = (toc: number) => `<html><head><guide><reference type="toc" title="Table of Contents" filepos=${pos(toc)}/></guide></head><body>`;
	const title = (i: number) => book.titles.get(book.chapters[i]) ?? `Chapter ${i + 1}`;
	const tocHtml = (offs: number[]) =>
		`<h2>Contents</h2>${offs.map((o, i) => `<p><a filepos=${pos(o)}>${esc(title(i))}</a></p>`).join("")}${SEP}`;
	const tocStart = enc.encode(head(0)).length;
	let at = tocStart + enc.encode(tocHtml(parts.map(() => 0))).length;
	const toc: TocEntry[] = parts.map((p, i) => {
		const length = enc.encode(p + SEP).length;
		const e = { title: title(i), offset: at, length };
		at += length;
		return e;
	});
	toc[toc.length - 1].length -= enc.encode(SEP).length; // no separator after the last chapter
	const html = `${head(tocStart)}${tocHtml(toc.map((t) => t.offset))}${parts.join(SEP)}</body></html>`;
	return { text: enc.encode(html), images, toc };
}

const concat = (parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
};
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

interface TocEntry {
	title: string;
	offset: number; // byte offset of the chapter in the (uncompressed) text
	length: number;
}

const pad4 = (a: Uint8Array) => concat([a, new Uint8Array((4 - (a.length % 4)) % 4)]);
const u32 = (...ns: number[]) => {
	const out = new Uint8Array(4 * ns.length);
	ns.forEach((n, i) => new DataView(out.buffer).setUint32(i * 4, n));
	return out;
};
// MOBI variable-width integer: 7-bit groups, big-endian, high bit marks the last byte.
const vwi = (n: number) => {
	const b = [(n & 0x7f) | 0x80];
	for (n = Math.floor(n / 128); n; n = Math.floor(n / 128)) b.unshift(n & 0x7f);
	return Uint8Array.from(b);
};

function indxHeader(type: number, idxt: number, count: number, code: number, total: number, nctoc: number, tagx = false) {
	const h = new Uint8Array(192);
	h.set(ascii("INDX"));
	h.set(u32(192, 0, type, 0, idxt, count, code, 0xffffffff, total, 0, 0, 0, nctoc), 4);
	if (tagx) new DataView(h.buffer).setUint32(180, 192); // TAGX follows the header
	return h;
}

// NCX index = the chapter list the Kindle shows under Go To: INDX header, one INDX data record, one CNCX (labels) record.
// shortcut: flat list, one data record and one CNCX record (~64 KB each, thousands of chapters); upgrade for nested TOCs.
function buildNcx(toc: TocEntry[]): Uint8Array[] {
	const enc = new TextEncoder();
	const labels: Uint8Array[] = [];
	const labelAt: number[] = [];
	let at = 0;
	for (const t of toc) {
		const s = enc.encode(t.title);
		const e = concat([vwi(s.length), s]);
		labelAt.push(at);
		at += e.length;
		labels.push(e);
	}
	const ids = toc.map((_, i) => enc.encode(String(i).padStart(3, "0")));
	// entry = id (length-prefixed) + control byte (tags 1-4 present) + offset, length, label offset, depth
	const entries = toc.map((t, i) => concat([Uint8Array.of(ids[i].length), ids[i], Uint8Array.of(0x0f), vwi(t.offset), vwi(t.length), vwi(labelAt[i]), vwi(0)]));
	const body = pad4(concat(entries));
	const idxtOffsets: number[] = [];
	let o = 192;
	for (const e of entries) {
		idxtOffsets.push(o);
		o += e.length;
	}
	const idxt = (offs: number[]) => pad4(concat([ascii("IDXT"), ...offs.map((x) => Uint8Array.of(x >> 8, x & 0xff))]));
	const data = concat([indxHeader(1, 192 + body.length, toc.length, 0xffffffff, 0, 0), body, idxt(idxtOffsets)]);

	const tags = [[1, 1, 1], [2, 1, 2], [3, 1, 4], [4, 1, 8]]; // offset, length, label, depth
	const tagx = concat([ascii("TAGX"), u32(12 + 4 * (tags.length + 1), 1), ...tags.map((t) => Uint8Array.of(...t, 0)), Uint8Array.of(0, 0, 0, 1)]);
	const last = concat([Uint8Array.of(ids[ids.length - 1].length), ids[ids.length - 1], Uint8Array.of(toc.length >> 8, toc.length & 0xff)]);
	const header = concat([indxHeader(0, 192 + tagx.length + last.length, 1, 65001, toc.length, 1, true), tagx, last, idxt([192 + tagx.length])]);
	return [header, data, pad4(concat(labels))];
}

export function packMobi(title: string, author: string, text: Uint8Array, images: Uint8Array[], toc: TocEntry[]): Uint8Array {
	// Text records of <=4096 bytes, cut on UTF-8 character boundaries (so no trailing-byte flags needed).
	const texts: Uint8Array[] = [];
	for (let a = 0; a < text.length; ) {
		let b = Math.min(a + 4096, text.length);
		while (b < text.length && (text[b] & 0xc0) === 0x80) b--;
		texts.push(text.subarray(a, b));
		a = b;
	}
	const T = texts.length;
	const flis = ascii("FLIS\0\0\0\x08\0\x41\0\0\0\0\0\0\xff\xff\xff\xff\0\x01\0\x03\0\0\0\x03\0\0\0\x01\xff\xff\xff\xff");
	const fcis = new Uint8Array(44);
	fcis.set(ascii("FCIS\0\0\0\x14\0\0\0\x10\0\0\0\x01\0\0\0\0"));
	new DataView(fcis.buffer).setUint32(16, text.length);
	fcis.set(ascii("\0\0\0\0\0\0\0\x20\0\0\0\x08\0\x01\0\x01\0\0\0\0"), 24);
	const eof = Uint8Array.of(0xe9, 0x8e, 0x0d, 0x0a);

	// EXTH: 503 = updated title, 100 = author.
	const enc = new TextEncoder();
	const exthRecs = [[503, enc.encode(title)], ...(author ? [[100, enc.encode(author)] as const] : [])] as const;
	const exth = concat([
		...exthRecs.map(([type, data]) => {
			const r = new Uint8Array(8 + data.length);
			new DataView(r.buffer).setUint32(0, type);
			new DataView(r.buffer).setUint32(4, 8 + data.length);
			r.set(data, 8);
			return r;
		}),
	]);
	const exthHead = new Uint8Array(12);
	exthHead.set(ascii("EXTH"));
	new DataView(exthHead.buffer).setUint32(4, 12 + exth.length);
	new DataView(exthHead.buffer).setUint32(8, exthRecs.length);
	const exthPad = (4 - ((12 + exth.length) % 4)) % 4;

	const name = enc.encode(title);
	const last = T + images.length; // index of the last content record
	const ncx = buildNcx(toc); // records last+1 .. last+3
	const r0 = new Uint8Array(248);
	const v = new DataView(r0.buffer);
	const nameOff = 248 + 12 + exth.length + exthPad;
	v.setUint16(0, 1); // no compression
	v.setUint32(4, text.length);
	v.setUint16(8, T);
	v.setUint16(10, 4096);
	r0.set(ascii("MOBI"), 16);
	v.setUint32(20, 232); // MOBI header length
	v.setUint32(24, 2); // type: book
	v.setUint32(28, 65001); // UTF-8
	v.setUint32(32, crypto.getRandomValues(new Uint32Array(1))[0]);
	v.setUint32(36, 6); // version
	for (let o = 40; o <= 76; o += 4) v.setUint32(o, 0xffffffff); // no indices
	v.setUint32(80, T + 1 + images.length); // first non-book record (FLIS)
	v.setUint32(84, nameOff);
	v.setUint32(88, name.length);
	v.setUint32(92, 9); // locale: English
	v.setUint32(104, 6); // min version
	v.setUint32(108, images.length ? T + 1 : 0xffffffff);
	v.setUint32(128, 0x40); // has EXTH
	v.setUint32(164, 0xffffffff);
	v.setUint32(168, 0xffffffff); // no DRM
	v.setUint16(192, 1);
	v.setUint16(194, last);
	v.setUint32(196, 1);
	v.setUint32(200, last + 1 + ncx.length + 1); // FCIS record
	v.setUint32(204, 1);
	v.setUint32(208, last + 1 + ncx.length); // FLIS record
	v.setUint32(212, 1);
	v.setUint32(224, 0xffffffff);
	v.setUint32(232, 0xffffffff);
	v.setUint32(236, 0xffffffff);
	v.setUint32(244, last + 1); // NCX index record
	const tail = new Uint8Array(name.length + 2 + ((4 - ((name.length + 2) % 4)) % 4));
	tail.set(name);
	const record0 = concat([r0, exthHead, exth, new Uint8Array(exthPad), tail]);

	const records = [record0, ...texts, ...images, ...ncx, flis, fcis, eof];
	const head = new Uint8Array(78 + records.length * 8 + 2);
	const h = new DataView(head.buffer);
	head.set(ascii(title.replace(/[^A-Za-z0-9]/g, "_").slice(0, 31)));
	const now = Math.floor(Date.now() / 1000);
	h.setUint32(36, now);
	h.setUint32(40, now);
	head.set(ascii("BOOKMOBI"), 60);
	h.setUint32(68, 2 * records.length - 1);
	h.setUint16(76, records.length);
	let off = head.length;
	records.forEach((r, i) => {
		h.setUint32(78 + i * 8, off);
		h.setUint32(78 + i * 8 + 4, i * 2); // attrs 0, uid = 2*i
		off += r.length;
	});
	return concat([head, ...records]);
}

export async function epubToAzw(data: ArrayBuffer) {
	const book = await openBook(data);
	const { text, images, toc } = await flatten(book);
	const bytes = packMobi(book.title, book.author, text, images, toc);
	return { blob: new Blob([bytes as BlobPart], { type: "application/x-mobipocket-ebook" }), title: book.title, images: images.length };
}
