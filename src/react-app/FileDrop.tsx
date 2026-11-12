import { useEffect, useState, type DragEvent } from "react";
import "./FileDrop.css";

interface Props {
	/** Same syntax as <input accept>: extensions (".epub"), MIME types, or "audio/*". */
	accept: string;
	onFile: (file: File) => void;
	label?: string;
	/** Name of the currently loaded file, shown instead of the prompt. */
	fileName?: string;
	disabled?: boolean;
}

const matches = (f: File, accept: string) =>
	accept
		.split(",")
		.map((t) => t.trim().toLowerCase())
		.filter(Boolean)
		.some((t) =>
			t.startsWith(".") ? f.name.toLowerCase().endsWith(t)
			: t.endsWith("/*") ? f.type.toLowerCase().startsWith(t.slice(0, -1))
			: f.type.toLowerCase() === t,
		);

// Click, keyboard and mobile picker all work through the real (visually hidden) file input.
export default function FileDrop({ accept, onFile, label = "Drop a file here, or click to choose", fileName, disabled }: Props) {
	const [over, setOver] = useState(false);
	const [error, setError] = useState("");

	// A file dropped outside the zone would make the browser navigate to it and wipe the page.
	useEffect(() => {
		const stop = (e: Event) => e.preventDefault();
		window.addEventListener("dragover", stop);
		window.addEventListener("drop", stop);
		return () => {
			window.removeEventListener("dragover", stop);
			window.removeEventListener("drop", stop);
		};
	}, []);

	const take = (file?: File) => {
		if (!file) return;
		if (!matches(file, accept)) {
			setError(`"${file.name}" isn't a supported file type (${accept}).`);
			return;
		}
		setError("");
		onFile(file);
	};

	const onDrop = (e: DragEvent) => {
		e.preventDefault();
		setOver(false);
		if (!disabled) take(e.dataTransfer.files[0]);
	};

	return (
		<div>
			<label
				className={`filedrop${over ? " filedrop-over" : ""}${disabled ? " filedrop-disabled" : ""}`}
				onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
				onDragLeave={() => setOver(false)}
				onDrop={onDrop}
			>
				<input
					type="file"
					accept={accept}
					disabled={disabled}
					onChange={(e) => {
						take(e.target.files?.[0]);
						e.target.value = ""; // allow choosing the same file again
					}}
				/>
				<span className="filedrop-icon" aria-hidden>📂</span>
				<span>{fileName ? <strong>{fileName}</strong> : label}</span>
				{fileName && <small>Drop or click to replace</small>}
			</label>
			{error && <p role="alert">{error}</p>}
		</div>
	);
}
