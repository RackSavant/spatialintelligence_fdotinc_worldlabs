"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { SparkControls, SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createWorldFrame, type WorldSemantics } from "@/lib/world-frame";

export interface SplatSceneProps {
  spzUrl: string;
  /** Marble assets.mesh.collider_mesh_url — the placement raycast target. */
  colliderUrl?: string;
  semantics?: WorldSemantics;
}

export default function SplatScene({ spzUrl, colliderUrl, semantics }: SplatSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);

    // antialias:false is deliberate — MSAA does nothing for splats and costs a lot.
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);

    const spark = new SparkRenderer({ renderer });
    scene.add(spark);

    const frame = createWorldFrame(
      semantics ?? { metricScaleFactor: null, groundPlaneOffset: null },
    );
    scene.add(frame.worldGroup);
    if (!frame.hasMetricScale) {
      setWarning("No metric scale from Marble — furniture sizing is approximate.");
    }

    const splats = new SplatMesh({
      url: spzUrl,
      onProgress: (e: ProgressEvent) => {
        if (e.lengthComputable && e.total > 0) {
          setProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    });
    frame.contentGroup.add(splats);

    // Fixed camera guesses don't survive worlds of unknown extent, so frame
    // the real bounds once the splats resolve.
    camera.position.set(0, 1.6, 3);
    splats.initialized.then(() => {
      setReady(true);
      frame.worldGroup.updateMatrixWorld(true);
      const box = splats.getBoundingBox(true).applyMatrix4(splats.matrixWorld);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() * 0.5;
      const dist = radius / Math.tan((camera.fov * Math.PI) / 360);
      camera.position.set(center.x, center.y, center.z + dist * 1.2);
      camera.lookAt(center);
    });

    let collider: THREE.Object3D | null = null;
    let cancelled = false;
    if (colliderUrl) {
      new GLTFLoader().loadAsync(colliderUrl).then((gltf) => {
        if (cancelled) return;
        collider = gltf.scene;
        collider.visible = false; // raycast target only
        frame.contentGroup.add(collider);
      });
    }

    // Click-to-place. Raycasts the collider (clean geometry, stable normals)
    // and falls back to the splats (fuzzy surface, noisy normals) when absent.
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const placed: THREE.Object3D[] = [];

    function onClick(ev: MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);

      const target = collider ?? splats;
      const hits: THREE.Intersection[] = [];
      raycaster.intersectObject(target, true, hits);
      if (!hits.length) return;

      // A 0.5m cube proves the metric pipeline before the GLB catalog exists.
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshBasicMaterial({ color: 0x4ade80 }),
      );
      box.position.copy(frame.worldGroup.worldToLocal(hits[0].point.clone()));
      box.position.y += 0.25; // sit on the surface, not centred in it
      frame.worldGroup.add(box);
      placed.push(box);
    }
    renderer.domElement.addEventListener("click", onClick);

    const controls = new SparkControls({ canvas: renderer.domElement });

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = host;
      if (!w || !h) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    renderer.setAnimationLoop(() => {
      controls.update(camera);
      renderer.render(scene, camera);
    });

    // Dev-only handles for poking at the scene from the browser console.
    if (process.env.NODE_ENV !== "production") {
      Object.assign(window, { THREE, scene, camera, renderer, spark, splats, frame, controls });
    }

    return () => {
      cancelled = true;
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("click", onClick);
      observer.disconnect();
      placed.forEach((p) => {
        const m = p as THREE.Mesh;
        m.geometry?.dispose();
        (m.material as THREE.Material)?.dispose();
      });
      splats.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [spzUrl, colliderUrl, semantics]);

  return (
    <div className="relative h-full w-full bg-black">
      <div ref={hostRef} className="h-full w-full [&>canvas]:block" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center font-mono text-sm text-white">
          loading splat… {progress > 0 ? `${progress}%` : ""}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 left-3 font-mono text-xs text-white/70 [text-shadow:0_1px_2px_#000]">
        WASD / arrows to move · drag to look · click to place
      </div>
      {warning && (
        <div className="pointer-events-none absolute top-3 left-3 rounded bg-amber-500/90 px-2 py-1 font-mono text-xs text-black">
          {warning}
        </div>
      )}
    </div>
  );
}
