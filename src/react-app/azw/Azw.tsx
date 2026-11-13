import { useEffect, useState } from "react";
import FileDrop from "../FileDrop";
import { epubToAzw } from "./azw";

interface Result { url: string; name: string; title: string; images: number; kb: number }

export default function Azw() {
	const [res, setRes] = useState<Result>();
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	useEffect(() => () => { if (res) URL.revokeObjectURL(res.url); }, [res]);

	const convert = async (file: File) => {
		setBusy(true);
		setError("");
		setRes(undefined);
		try {
			const r = await epubToAzw(await file.arrayBuffer());
			setRes({
				url: URL.createObjectURL(r.blob),
				name: file.name.replace(/\.epub$/i, "") + ".azw",
				title: r.title,
				images: r.images,
				kb: Math.round(r.blob.size / 1024),
			});
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
		setBusy(false);
	};

	return (
		<div style={{ display: "grid", gap: 12, maxWidth: 800, margin: "0 auto", padding: 16 }}>
			<h1>📚 EPUB → AZW</h1>
			<FileDrop accept=".epub,application/epub+zip" onFile={convert} label="Drop an EPUB here, or click to choose" disabled={busy} />
			{busy && <p>Converting…</p>}
			{error && <p role="alert">{error}</p>}
			{res && (
				<>
					<p>{res.title}: {res.images} images, {res.kb} KB. Text and images only; EPUB styling is dropped.</p>
					<a href={res.url} download={res.name}>Download {res.name}</a>
				</>
			)}
		</div>
	);
}
