import { useEffect, useRef, useState } from "react";
import { PLANETS } from "./bodies";
import { createSolarSystem, type SolarSystemHandle } from "./scene";
import "./SolarSystem.css";

function SolarSystem() {
	const container = useRef<HTMLDivElement>(null);
	const handle = useRef<SolarSystemHandle | null>(null);
	const [speed, setSpeed] = useState(0.1);
	const [focused, setFocused] = useState<string | null>(null);

	useEffect(() => {
		const h = createSolarSystem(container.current!, setFocused);
		handle.current = h;
		return () => {
			h.dispose();
			handle.current = null;
		};
	}, []);

	useEffect(() => {
		handle.current?.setSpeed(speed);
	}, [speed]);

	return (
		<div className="solar">
			<div className="solar-canvas" ref={container} />
			<div className="solar-panel">
				<label>
					Speed: {speed.toFixed(2)} yr/s
					<input
						type="range"
						min={0}
						max={2}
						step={0.01}
						value={speed}
						onChange={(e) => setSpeed(Number(e.target.value))}
					/>
				</label>
				<div className="solar-buttons">
					<button className={focused === null ? "active" : ""} onClick={() => handle.current?.focus(null)}>
						Overview
					</button>
					{PLANETS.map((p) => (
						<button
							key={p.name}
							className={focused === p.name ? "active" : ""}
							onClick={() => handle.current?.focus(p.name)}
						>
							{p.name}
						</button>
					))}
				</div>
				<small>Drag to orbit, scroll to zoom, click a planet to follow it.</small>
			</div>
		</div>
	);
}

export default SolarSystem;
