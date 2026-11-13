import {
	AmbientLight,
	BufferGeometry,
	Color,
	Float32BufferAttribute,
	Group,
	LineBasicMaterial,
	LineLoop,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	PerspectiveCamera,
	Points,
	PointsMaterial,
	PointLight,
	RingGeometry,
	Scene,
	SphereGeometry,
	Vector3,
	WebGLRenderer,
	DoubleSide,
	type Material,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PLANETS, SUN } from "./bodies";

export interface SolarSystemHandle {
	setSpeed(yearsPerSecond: number): void;
	focus(name: string | null): void;
	dispose(): void;
}

const DEFAULT_OFFSET = new Vector3(0, 55, 95);

export function createSolarSystem(
	container: HTMLElement,
	onFocus: (name: string | null) => void,
): SolarSystemHandle {
	const renderer = new WebGLRenderer({ antialias: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	container.appendChild(renderer.domElement);

	const scene = new Scene();
	scene.background = new Color(0x02030a);
	const camera = new PerspectiveCamera(55, 1, 0.1, 2000);
	camera.position.copy(DEFAULT_OFFSET);

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.minDistance = 3;
	controls.maxDistance = 400;

	scene.add(new AmbientLight(0xffffff, 0.25));
	scene.add(new PointLight(0xffffff, 3, 0, 0));

	const sun = new Mesh(
		new SphereGeometry(SUN.radius, 48, 24),
		new MeshBasicMaterial({ color: SUN.color }),
	);
	scene.add(sun);

	// Starfield on a distant shell.
	const starPos: number[] = [];
	for (let i = 0; i < 2000; i++) {
		const v = new Vector3().randomDirection().multiplyScalar(800 + Math.random() * 400);
		starPos.push(v.x, v.y, v.z);
	}
	const starGeo = new BufferGeometry();
	starGeo.setAttribute("position", new Float32BufferAttribute(starPos, 3));
	scene.add(new Points(starGeo, new PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false })));

	const orbitMat = new LineBasicMaterial({ color: 0x334466 });
	const planets = PLANETS.map((p) => {
		const pivot = new Group(); // rotated each frame to advance the orbit
		pivot.rotation.y = Math.random() * Math.PI * 2;
		const mesh = new Mesh(
			new SphereGeometry(p.radius, 32, 16),
			new MeshStandardMaterial({ color: p.color, roughness: 0.9 }),
		);
		mesh.position.x = p.distance;
		mesh.rotation.z = p.tilt ?? 0;
		if (p.ring) {
			const ring = new Mesh(
				new RingGeometry(p.ring.inner, p.ring.outer, 64),
				new MeshBasicMaterial({ color: p.ring.color, side: DoubleSide, transparent: true, opacity: 0.7 }),
			);
			ring.rotation.x = Math.PI / 2;
			mesh.add(ring);
		}
		pivot.add(mesh);
		scene.add(pivot);

		const pts: number[] = [];
		for (let i = 0; i < 128; i++) {
			const a = (i / 128) * Math.PI * 2;
			pts.push(Math.cos(a) * p.distance, 0, Math.sin(a) * p.distance);
		}
		const g = new BufferGeometry();
		g.setAttribute("position", new Float32BufferAttribute(pts, 3));
		scene.add(new LineLoop(g, orbitMat));
		return { body: p, pivot, mesh };
	});

	let speed = 0.1;
	let focused: string | null = null;
	const tmp = new Vector3();

	function focus(name: string | null) {
		focused = name;
		if (name === null) {
			controls.target.set(0, 0, 0);
			camera.position.copy(DEFAULT_OFFSET);
		} else {
			const p = planets.find((x) => x.body.name === name);
			if (p) camera.position.copy(p.mesh.getWorldPosition(tmp)).add(new Vector3(0, p.body.radius * 2, p.body.radius * 5 + 4));
		}
		onFocus(name);
	}

	// Click a planet to focus it.
	const down = { x: 0, y: 0 };
	const el = renderer.domElement;
	const onDown = (e: PointerEvent) => {
		down.x = e.clientX;
		down.y = e.clientY;
	};
	const onUp = (e: PointerEvent) => {
		if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return; // a drag, not a click
		const r = el.getBoundingClientRect();
		const ndc = new Vector3(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1, 0.5);
		ndc.unproject(camera);
		const dir = ndc.sub(camera.position).normalize();
		let best: { name: string; t: number } | null = null;
		for (const p of planets) {
			const c = p.mesh.getWorldPosition(tmp);
			const oc = c.clone().sub(camera.position);
			const t = oc.dot(dir);
			if (t < 0) continue;
			const d = oc.sub(dir.clone().multiplyScalar(t)).length();
			// Generous hit radius so small planets stay clickable from afar.
			if (d < Math.max(p.body.radius, t * 0.02) && (!best || t < best.t)) best = { name: p.body.name, t };
		}
		if (best) focus(best.name);
	};
	el.addEventListener("pointerdown", onDown);
	el.addEventListener("pointerup", onUp);

	const resize = () => {
		const w = container.clientWidth;
		const h = container.clientHeight;
		renderer.setSize(w, h);
		camera.aspect = w / Math.max(h, 1);
		camera.updateProjectionMatrix();
	};
	const ro = new ResizeObserver(resize);
	ro.observe(container);
	resize();

	let last = performance.now();
	let raf = 0;
	const frame = (now: number) => {
		raf = requestAnimationFrame(frame);
		const dt = Math.min((now - last) / 1000, 0.1);
		last = now;
		for (const p of planets) {
			p.pivot.rotation.y += ((Math.PI * 2) / p.body.period) * speed * dt;
			p.mesh.rotation.y += dt * 0.5;
		}
		if (focused) {
			const p = planets.find((x) => x.body.name === focused);
			if (p) {
				// Follow the planet: shift camera by the same amount the target moves.
				const pos = p.mesh.getWorldPosition(tmp);
				camera.position.add(pos.clone().sub(controls.target));
				controls.target.copy(pos);
			}
		}
		controls.update();
		renderer.render(scene, camera);
	};
	raf = requestAnimationFrame(frame);

	return {
		setSpeed: (v) => {
			speed = v;
		},
		focus,
		dispose() {
			cancelAnimationFrame(raf);
			ro.disconnect();
			el.removeEventListener("pointerdown", onDown);
			el.removeEventListener("pointerup", onUp);
			controls.dispose();
			scene.traverse((o) => {
				if (o instanceof Mesh || o instanceof Points || o instanceof LineLoop) {
					o.geometry.dispose();
					(o.material as Material).dispose();
				}
			});
			renderer.dispose();
			renderer.domElement.remove();
		},
	};
}
