import JSZip from "jszip";

export interface Book {
	zip: JSZip;
	title: string;
	chapters: string[]; // zip paths, in spine order
}

const xml = (s: string) => new DOMParser().parseFromString(s, "application/xml");

// Resolve a possibly-relative href against the zip path of the file that contains it.
export function resolvePath(from: string, href: string): string {
	const url = new URL(href, "http://x/" + from);
	return decodeURIComponent(url.pathname.slice(1));
}

async function text(zip: JSZip, path: string): Promise<string> {
	const f = zip.file(path);
	if (!f) throw new Error(`Missing ${path} in EPUB`);
	return f.async("string");
}

export async function openBook(data: ArrayBuffer): Promise<Book> {
	const zip = await JSZip.loadAsync(data);
	const container = xml(await text(zip, "META-INF/container.xml"));
	const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
	if (!opfPath) throw new Error("Not an EPUB: no rootfile");
	const opf = xml(await text(zip, opfPath));
	const manifest = new Map<string, string>();
	for (const item of opf.getElementsByTagName("item")) {
		manifest.set(item.getAttribute("id") ?? "", item.getAttribute("href") ?? "");
	}
	const chapters: string[] = [];
	for (const ref of opf.getElementsByTagName("itemref")) {
		const href = manifest.get(ref.getAttribute("idref") ?? "");
		if (href) chapters.push(resolvePath(opfPath, href));
	}
	if (!chapters.length) throw new Error("EPUB has no readable chapters");
	const title = opf.getElementsByTagNameNS("*", "title")[0]?.textContent ?? "Untitled";
	return { zip, title, chapters };
}

// Chapter HTML with images/stylesheets rewritten to blob URLs. Caller revokes `urls`.
export async function renderChapter(book: Book, path: string, html: string) {
	const doc = new DOMParser().parseFromString(html, "text/html");
	const urls: string[] = [];
	const targets = doc.querySelectorAll("img[src], link[rel~=stylesheet][href]");
	for (const el of targets) {
		const attr = el.hasAttribute("src") ? "src" : "href";
		const file = book.zip.file(resolvePath(path, el.getAttribute(attr)!));
		if (!file) continue;
		const url = URL.createObjectURL(await file.async("blob"));
		urls.push(url);
		el.setAttribute(attr, url);
	}
	return { html: doc.documentElement.outerHTML, urls };
}

export async function saveBook(book: Book): Promise<Blob> {
	// The EPUB spec wants "mimetype" first and uncompressed.
	const mt = await text(book.zip, "mimetype");
	book.zip.file("mimetype", mt, { compression: "STORE" });
	return book.zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE" });
}
