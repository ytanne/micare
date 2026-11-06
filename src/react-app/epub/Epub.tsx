import { useEffect, useState } from "react";
import { openBook, renderChapter, saveBook, type Book } from "./epub";

export default function Epub() {
	const [book, setBook] = useState<Book>();
	const [name, setName] = useState("book.epub");
	const [idx, setIdx] = useState(0);
	const [src, setSrc] = useState(""); // chapter source, editable
	const [mode, setMode] = useState<"read" | "edit">("read");
	const [preview, setPreview] = useState("");
	const [error, setError] = useState("");

	const path = book?.chapters[idx];

	// Load the chapter source when the book or chapter changes.
	useEffect(() => {
		if (!book || !path) return;
		let stale = false;
		book.zip.file(path)!.async("string").then((s) => !stale && setSrc(s));
		return () => { stale = true; };
	}, [book, path]);

	// Rebuild the preview from the (possibly edited) source.
	useEffect(() => {
		if (!book || !path || mode !== "read") return;
		let stale = false;
		let urls: string[] = [];
		renderChapter(book, path, src).then((r) => {
			urls = r.urls;
			if (stale) urls.forEach(URL.revokeObjectURL);
			else setPreview(r.url);
		});
		return () => { stale = true; urls.forEach(URL.revokeObjectURL); };
	}, [book, path, src, mode]);

	const load = async (file: File) => {
		try {
			setError("");
			setBook(await openBook(await file.arrayBuffer()));
			setName(file.name);
			setIdx(0);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const edit = (s: string) => {
		setSrc(s);
		book!.zip.file(path!, s);
	};

	const download = async () => {
		const a = document.createElement("a");
		a.href = URL.createObjectURL(await saveBook(book!));
		a.download = name.replace(/\.epub$/i, "") + "-edited.epub";
		a.click();
		URL.revokeObjectURL(a.href);
	};

	return (
		<div style={{ display: "grid", gap: 12, maxWidth: 800, margin: "0 auto", padding: 16 }}>
			<h1>📖 EPUB Viewer / Editor</h1>
			<input type="file" accept=".epub,application/epub+zip" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
			{error && <p role="alert">{error}</p>}
			{book && (
				<>
					<h2>{book.title}</h2>
					<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
						<button disabled={idx === 0} onClick={() => setIdx(idx - 1)}>←</button>
						<select value={idx} onChange={(e) => setIdx(+e.target.value)}>
							{book.chapters.map((c, i) => <option key={c} value={i}>{i + 1}. {c}</option>)}
						</select>
						<button disabled={idx === book.chapters.length - 1} onClick={() => setIdx(idx + 1)}>→</button>
						<button onClick={() => setMode(mode === "read" ? "edit" : "read")}>{mode === "read" ? "Edit" : "Read"}</button>
						<button onClick={download}>Download EPUB</button>
					</div>
					{mode === "read" ? (
						// No allow-scripts: book content can't run code.
						<iframe title="chapter" sandbox="" src={preview} style={{ width: "100%", height: "70vh", background: "#fff", colorScheme: "light", border: "1px solid #888" }} />
					) : (
						<textarea value={src} onChange={(e) => edit(e.target.value)} spellCheck={false} style={{ height: "70vh", fontFamily: "monospace" }} />
					)}
				</>
			)}
		</div>
	);
}
