import { useEffect, useRef, useState } from "react";
import { defaultCorners, detectCorners, scan, type Filter, type Pt } from "./image";
import { buildPdf } from "./pdf";
import "./Scan.css";

interface Page {
	id: number;
	name: string;
	full: ImageData; // working resolution, used for export
	small: ImageData; // downscaled, used for the editor and live preview
	corners: Pt[];
	filter: Filter;
}

const FULL = 3000, SMALL = 900, PREVIEW = 700, EXPORT = 2400;
let nextId = 1;

function toImageData(bmp: ImageBitmap, max: number) {
	const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
	const c = document.createElement("canvas");
	c.width = Math.round(bmp.width * k);
	c.height = Math.round(bmp.height * k);
	const ctx = c.getContext("2d")!;
	ctx.drawImage(bmp, 0, 0, c.width, c.height);
	return ctx.getImageData(0, 0, c.width, c.height);
}

async function load(file: File): Promise<Page> {
	const bmp = await createImageBitmap(file); // honours EXIF orientation
	const full = toImageData(bmp, FULL), small = toImageData(bmp, SMALL);
	bmp.close();
	return { id: nextId++, name: file.name, full, small, corners: detectCorners(small), filter: "bw" };
}

function paint(canvas: HTMLCanvasElement, img: ImageData) {
	canvas.width = img.width;
	canvas.height = img.height;
	canvas.getContext("2d")!.putImageData(img, 0, 0);
}

function Thumb({ page }: { page: Page }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => { paint(ref.current!, page.small); }, [page.small]);
	return <canvas ref={ref} />;
}

export default function Scan() {
	const [pages, setPages] = useState<Page[]>([]);
	const [sel, setSel] = useState(0);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const editRef = useRef<HTMLCanvasElement>(null);
	const prevRef = useRef<HTMLCanvasElement>(null);
	const drag = useRef(-1);
	const page = pages[sel];

	const update = (patch: Partial<Page>) =>
		setPages((ps) => ps.map((p, i) => (i === sel ? { ...p, ...patch } : p)));

	const add = async (files: FileList) => {
		setBusy(true);
		setError("");
		try {
			const loaded: Page[] = [];
			for (const f of Array.from(files)) {
				try { loaded.push(await load(f)); } catch { setError(`Could not read ${f.name}`); }
			}
			if (loaded.length) {
				setSel(pages.length);
				setPages((ps) => [...ps, ...loaded]);
			}
		} finally {
			setBusy(false);
		}
	};

	// Editor: source image with the draggable crop quad.
	useEffect(() => {
		if (!page) return;
		const c = editRef.current!;
		paint(c, page.small);
		const ctx = c.getContext("2d")!;
		const pts = page.corners.map((p) => ({ x: p.x * c.width, y: p.y * c.height }));
		const r = Math.max(8, c.width / 50);
		ctx.beginPath();
		pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
		ctx.closePath();
		ctx.fillStyle = "rgba(74,144,217,0.15)";
		ctx.fill();
		ctx.lineWidth = Math.max(2, r / 4);
		ctx.strokeStyle = "#4a90d9";
		ctx.stroke();
		for (const p of pts) {
			ctx.beginPath();
			ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
			ctx.fillStyle = "#fff";
			ctx.fill();
			ctx.stroke();
		}
	}, [page]);

	// Live preview of the scanned result.
	useEffect(() => {
		if (page) paint(prevRef.current!, scan(page.small, page.corners, page.filter, PREVIEW));
	}, [page]);

	const pos = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
		const r = e.currentTarget.getBoundingClientRect();
		return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
	};
	const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
		const p = pos(e), r = e.currentTarget.getBoundingClientRect();
		let best = -1, bd = 32 ** 2; // grab radius in screen px
		page.corners.forEach((c, i) => {
			const d = ((c.x - p.x) * r.width) ** 2 + ((c.y - p.y) * r.height) ** 2;
			if (d < bd) { bd = d; best = i; }
		});
		drag.current = best;
		if (best >= 0) e.currentTarget.setPointerCapture(e.pointerId);
	};
	const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
		if (drag.current < 0) return;
		const p = pos(e);
		update({ corners: page.corners.map((c, i) => (i === drag.current ? p : c)) });
	};

	const move = (to: number) => {
		if (to < 0 || to >= pages.length) return;
		setPages((ps) => {
			const a = [...ps];
			[a[sel], a[to]] = [a[to], a[sel]];
			return a;
		});
		setSel(to);
	};
	const remove = () => {
		setPages((ps) => ps.filter((_, i) => i !== sel));
		setSel(Math.max(0, sel - (sel === pages.length - 1 ? 1 : 0)));
	};

	const exportPdf = async () => {
		setBusy(true);
		setError("");
		try {
			const out = [];
			for (const p of pages) {
				const img = scan(p.full, p.corners, p.filter, EXPORT);
				const c = document.createElement("canvas");
				c.width = img.width;
				c.height = img.height;
				c.getContext("2d")!.putImageData(img, 0, 0);
				const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/jpeg", 0.85));
				if (!blob) throw new Error("JPEG encoding failed");
				out.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), w: img.width, h: img.height });
				await new Promise((r) => setTimeout(r)); // let the UI breathe between pages
			}
			const a = document.createElement("a");
			a.href = URL.createObjectURL(buildPdf(out));
			a.download = "scan.pdf";
			a.click();
			setTimeout(() => URL.revokeObjectURL(a.href), 1000);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="scan">
			<h1>📷 Image → PDF Scanner</h1>
			<div className="scan-row">
				<input type="file" accept="image/*" multiple disabled={busy} onChange={(e) => { if (e.target.files?.length) add(e.target.files); e.target.value = ""; }} />
				<button disabled={!pages.length || busy} onClick={exportPdf}>
					{busy ? "Working…" : `Download PDF (${pages.length} page${pages.length === 1 ? "" : "s"})`}
				</button>
			</div>
			{error && <p role="alert">{error}</p>}
			<p style={{ margin: 0, fontSize: "0.9rem", opacity: 0.8 }}>
				Add photos of documents, drag the corners to match the page edges, and pick a filter. Everything runs in your browser; nothing is uploaded.
			</p>
			{page && (
				<>
					<div className="scan-thumbs">
						{pages.map((p, i) => (
							<div key={p.id} className={`scan-thumb${i === sel ? " on" : ""}`} onClick={() => setSel(i)}>
								<Thumb page={p} />
								{i + 1}
							</div>
						))}
					</div>
					<div className="scan-row">
						<label>Filter{" "}
							<select value={page.filter} onChange={(e) => update({ filter: e.target.value as Filter })}>
								<option value="bw">Black &amp; white (document)</option>
								<option value="gray">Grayscale</option>
								<option value="color">Color</option>
							</select>
						</label>
						<button onClick={() => update({ corners: detectCorners(page.small) })}>Auto-detect edges</button>
						<button onClick={() => update({ corners: defaultCorners() })}>Reset corners</button>
						<button disabled={sel === 0} onClick={() => move(sel - 1)}>← Move</button>
						<button disabled={sel === pages.length - 1} onClick={() => move(sel + 1)}>Move →</button>
						<button onClick={remove}>Remove</button>
					</div>
					<div className="scan-panes">
						<canvas ref={editRef} className="scan-edit" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = -1)} onPointerCancel={() => (drag.current = -1)} />
						<canvas ref={prevRef} />
					</div>
				</>
			)}
		</div>
	);
}
