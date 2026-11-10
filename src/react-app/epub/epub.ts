import JSZip from "jszip";

export interface Book {
	zip: JSZip;
	title: string;
	author: string;
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
	const author = opf.getElementsByTagNameNS("*", "creator")[0]?.textContent ?? "";
	return { zip, title, author, chapters };
}

// Chapter as a blob URL for the preview iframe, with images and stylesheets inlined.
// Parsed as XHTML when well-formed: the HTML parser mangles `<title/>`-style self-closing tags
// (blank page). Falls back to HTML for broken markup. Caller revokes the URL.
export async function renderChapter(book: Book, path: string, html: string) {
	let doc = new DOMParser().parseFromString(html, "application/xhtml+xml");
	const isXml = !doc.getElementsByTagName("parsererror").length;
	if (!isXml) doc = new DOMParser().parseFromString(html, "text/html");
	// Inline resources: a sandboxed (opaque-origin) document can't load blob: URLs of ours.
	// shortcut: url() references inside CSS (fonts, backgrounds) are not rewritten.
	for (const el of doc.querySelectorAll("img[src], link[rel~=stylesheet][href]")) {
		const isImg = el.hasAttribute("src");
		const file = book.zip.file(resolvePath(path, el.getAttribute(isImg ? "src" : "href")!));
		if (!file) continue;
		if (isImg) {
			const ext = file.name.split(".").pop()!.toLowerCase();
			const mime = ext === "svg" ? "svg+xml" : ext === "jpg" ? "jpeg" : ext;
			el.setAttribute("src", `data:image/${mime};base64,${await file.async("base64")}`);
		} else {
			const style = doc.createElementNS("http://www.w3.org/1999/xhtml", "style");
			style.textContent = await file.async("string");
			el.replaceWith(style);
		}
	}
	const out = isXml ? new XMLSerializer().serializeToString(doc) : doc.documentElement.outerHTML;
	return URL.createObjectURL(new Blob([out], { type: isXml ? "application/xhtml+xml" : "text/html" }));
}

export async function saveBook(book: Book): Promise<Blob> {
	// The EPUB spec wants "mimetype" first and uncompressed.
	const mt = await text(book.zip, "mimetype");
	book.zip.file("mimetype", mt, { compression: "STORE" });
	return book.zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE" });
}
