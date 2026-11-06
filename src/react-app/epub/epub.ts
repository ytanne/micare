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

// Chapter as a blob URL for the preview iframe, with images/stylesheets rewritten to blob URLs.
// Parsed as XHTML when well-formed: the HTML parser mangles `<title/>`-style self-closing tags
// (blank page). Falls back to HTML for broken markup. Caller revokes every URL in `urls`.
export async function renderChapter(book: Book, path: string, html: string) {
	let doc = new DOMParser().parseFromString(html, "application/xhtml+xml");
	const isXml = !doc.getElementsByTagName("parsererror").length;
	if (!isXml) doc = new DOMParser().parseFromString(html, "text/html");
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
	const out = isXml ? new XMLSerializer().serializeToString(doc) : doc.documentElement.outerHTML;
	const url = URL.createObjectURL(new Blob([out], { type: isXml ? "application/xhtml+xml" : "text/html" }));
	urls.push(url);
	return { url, urls };
}

export async function saveBook(book: Book): Promise<Blob> {
	// The EPUB spec wants "mimetype" first and uncompressed.
	const mt = await text(book.zip, "mimetype");
	book.zip.file("mimetype", mt, { compression: "STORE" });
	return book.zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE" });
}
