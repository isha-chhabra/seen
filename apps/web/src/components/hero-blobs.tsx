/**
 * Animated 3D blob field for the sign-in / auth screens (FullPageCard) —
 * the "heavy" version of the ambient background, matching the grainy
 * sculptural-blob reference instead of a flat CSS gradient. Client-only
 * (mounted in useEffect, never touches THREE during SSR); skips the
 * animation loop under prefers-reduced-motion and renders one static frame
 * instead. Scoped to auth screens only — a WebGL canvas has no place
 * running behind a dense data table in the actual app.
 */
import { useEffect, useRef } from "react";

const BLOB_COLORS = [0xc0aafd, 0x7c3aed, 0xd4b96a, 0x4a3d5a];

export function HeroBlobs() {
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		let disposed = false;
		let frameId = 0;

		const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

		import("three").then((THREE) => {
			if (disposed || !container) return;

			const scene = new THREE.Scene();
			const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 100);
			camera.position.set(0, 0, 11);

			const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
			renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
			renderer.setSize(container.clientWidth, container.clientHeight);
			container.appendChild(renderer.domElement);

			scene.add(new THREE.AmbientLight(0xffffff, 0.55));
			const keyLight = new THREE.PointLight(0xc0aafd, 6, 40);
			keyLight.position.set(6, 5, 8);
			scene.add(keyLight);
			const rimLight = new THREE.PointLight(0xd4b96a, 5, 40);
			rimLight.position.set(-6, -3, 6);
			scene.add(rimLight);

			const group = new THREE.Group();
			scene.add(group);
			const meshes: THREE.Mesh[] = [];

			// Cheap organic "noise" via layered trig displacement along each
			// vertex normal — avoids pulling in a simplex-noise dependency for
			// a one-time, non-animated deformation.
			function makeBlobGeometry(radius: number, seed: number): THREE.BufferGeometry {
				const geo = new THREE.IcosahedronGeometry(radius, 5);
				const pos = geo.attributes.position;
				const v = new THREE.Vector3();
				for (let i = 0; i < pos.count; i++) {
					v.fromBufferAttribute(pos, i);
					const n = v.clone().normalize();
					const noise =
						Math.sin(n.x * 3.2 + seed) * Math.sin(n.y * 2.7 + seed * 1.3) * Math.sin(n.z * 3.6 + seed * 0.7) * 0.35 +
						Math.sin(n.x * 6.1 + seed * 2) * 0.08;
					v.addScaledVector(n, noise * radius * 0.55);
					pos.setXYZ(i, v.x, v.y, v.z);
				}
				geo.computeVertexNormals();
				return geo;
			}

			const specs: { radius: number; pos: [number, number, number]; color: number; seed: number }[] = [
				{ radius: 2.6, pos: [-3.2, 1.4, -1], color: BLOB_COLORS[0], seed: 1.1 },
				{ radius: 2.1, pos: [3, -1.2, -2], color: BLOB_COLORS[1], seed: 4.4 },
				{ radius: 1.5, pos: [1.6, 2.4, 0.5], color: BLOB_COLORS[2], seed: 8.2 },
				{ radius: 1.3, pos: [-2, -2.2, 0.8], color: BLOB_COLORS[3], seed: 12.7 },
			];

			for (const s of specs) {
				const material = new THREE.MeshStandardMaterial({
					color: s.color,
					roughness: 0.55,
					metalness: 0.15,
				});
				const mesh = new THREE.Mesh(makeBlobGeometry(s.radius, s.seed), material);
				mesh.position.set(...s.pos);
				group.add(mesh);
				meshes.push(mesh);
			}

			function resize() {
				if (!container) return;
				camera.aspect = container.clientWidth / container.clientHeight;
				camera.updateProjectionMatrix();
				renderer.setSize(container.clientWidth, container.clientHeight);
			}
			window.addEventListener("resize", resize);

			function renderFrame() {
				renderer.render(scene, camera);
			}

			if (reducedMotion) {
				renderFrame();
			} else {
				const animate = (t: number) => {
					group.rotation.y = t * 0.00004;
					group.rotation.x = Math.sin(t * 0.00003) * 0.08;
					for (const [i, mesh] of meshes.entries()) {
						mesh.rotation.y = t * 0.00006 * (i % 2 === 0 ? 1 : -1);
						mesh.position.y += Math.sin(t * 0.0003 + i) * 0.0015;
					}
					renderFrame();
					frameId = requestAnimationFrame(animate);
				};
				frameId = requestAnimationFrame(animate);
			}

			const cleanup = () => {
				disposed = true;
				cancelAnimationFrame(frameId);
				window.removeEventListener("resize", resize);
				for (const mesh of meshes) {
					mesh.geometry.dispose();
					(mesh.material as THREE.Material).dispose();
				}
				renderer.dispose();
				container?.removeChild(renderer.domElement);
			};
			container.dataset.cleanup = "pending";
			(container as unknown as { __heroBlobsCleanup?: () => void }).__heroBlobsCleanup = cleanup;
		});

		return () => {
			disposed = true;
			cancelAnimationFrame(frameId);
			(container as unknown as { __heroBlobsCleanup?: () => void })?.__heroBlobsCleanup?.();
		};
	}, []);

	return (
		<div
			ref={containerRef}
			aria-hidden="true"
			className="pointer-events-none fixed inset-0 -z-10 opacity-80 [mix-blend-mode:screen]"
		/>
	);
}
