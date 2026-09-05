"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { SparkRenderer, SplatMesh } from "@sparkjsdev/spark";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { createWorldFrame, type WorldSemantics } from "@/lib/world-frame";
import { FpsControls } from "./fps-controls";
import { FurnitureDrawer, type FurnitureAsset } from "./FurnitureDrawer";

/** Standing eye height in metres; worlds are metric with the ground at y=0. */
const EYE_HEIGHT = 1.6;
/** How far above a crosshair hit to start the drop-to-floor probe, in metres. */
const DROP_PROBE = 3;

export interface SplatSceneProps {
  spzUrl: string;
  /** Marble assets.mesh.collider_mesh_url — floor probe and placement target. */
  colliderUrl?: string;
  semantics?: WorldSemantics;
}

export default function SplatScene({ spzUrl, colliderUrl, semantics }: SplatSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lockHint, setLockHint] = useState(false);
  // A ref, not state: the scene effect must not tear down when the selection
  // changes, so the click handler reads the current value instead.
  const selectedAssetRef = useRef<FurnitureAsset | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, 1, 0.01, 1000);

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
      setWarning("No metric scale from Marble — sizing and walk speed are approximate.");
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

    camera.position.set(0, EYE_HEIGHT, 0);
    splats.initialized.then(() => {
      setReady(true);
      frame.worldGroup.updateMatrixWorld(true);
      const box = splats.getBoundingBox(true).applyMatrix4(splats.matrixWorld);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());

      if (frame.hasMetricScale) {
        // A Marble world is an interior you stand in, not an object you orbit.
        // Framing its bounding sphere would put the camera outside the walls.
        const x = box.min.x < 0 && box.max.x > 0 ? 0 : center.x;
        const z = box.min.z < 0 && box.max.z > 0 ? 0 : center.z;
        camera.position.set(x, EYE_HEIGHT, z);
        camera.lookAt(x, EYE_HEIGHT, z - 1);
      } else {
        // Unknown scale — treat it as an object and frame it from outside.
        const radius = box.getSize(new THREE.Vector3()).length() * 0.5;
        const dist = radius / Math.tan((camera.fov * Math.PI) / 360);
        camera.position.set(center.x, center.y, center.z + dist * 1.2);
        camera.lookAt(center);
      }
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

    const controls = new FpsControls({
      camera,
      domElement: renderer.domElement,
      eyeHeight: EYE_HEIGHT,
      getFloor: () => collider,
      onLockChange: (isLocked) => {
        setLocked(isLocked);
        if (isLocked) setLockHint(false);
      },
      onLockError: () => setLockHint(true),
    });

    // Placement raycasts the collider (clean geometry, stable normals) and
    // falls back to the splats (fuzzy surface, noisy normals) when absent.
    const raycaster = new THREE.Raycaster();
    const placed: THREE.Object3D[] = [];
    const gltfLoader = new GLTFLoader();
    const modelCache = new Map<string, THREE.Object3D>();

    async function loadModel(url: string): Promise<THREE.Object3D> {
      let template = modelCache.get(url);
      if (!template) {
        template = (await gltfLoader.loadAsync(url)).scene;
        modelCache.set(url, template);
      }
      return template.clone(true);
    }

    async function placeAtCrosshair() {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hits: THREE.Intersection[] = [];
      raycaster.intersectObject(collider ?? splats, true, hits);
      if (!hits.length) return;

      // The crosshair decides where on the floor, never how high off it.
      const worldPoint = hits[0].point.clone();

      if (frame.hasMetricScale) {
        // semantics_metadata puts the ground plane at y=0 by construction, so
        // that is the floor — more trustworthy than the collider, which is a
        // rough reconstruction with gaps and no surface under every point.
        worldPoint.y = 0;
      } else if (collider) {
        // No ground plane to trust: drop to the lowest surface underneath.
        const drop = new THREE.Raycaster(
          new THREE.Vector3(worldPoint.x, worldPoint.y + DROP_PROBE, worldPoint.z),
          new THREE.Vector3(0, -1, 0),
        );
        const below: THREE.Intersection[] = [];
        drop.intersectObject(collider, true, below);
        const floor = below.reduce<THREE.Intersection | null>(
          (lowest, h) => (!lowest || h.point.y < lowest.point.y ? h : lowest),
          null,
        );
        if (floor) worldPoint.y = floor.point.y;
      }

      const point = frame.worldGroup.worldToLocal(worldPoint);
      const asset = selectedAssetRef.current;

      const object = asset
        ? await loadModel(asset.url)
        : // A 0.5m cube stands in when nothing is selected.
          new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.5, 0.5),
            new THREE.MeshBasicMaterial({ color: 0x4ade80 }),
          );

      object.position.copy(point);
      // Turn to face the viewer, yaw only — a tipped-over sofa reads as a bug.
      // +PI because the camera looks down -Z, so matching its yaw would point
      // the model's back at you.
      const camYaw = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ").y;
      object.rotation.y = camYaw + Math.PI;
      frame.worldGroup.add(object);

      // Models are authored with the origin anywhere; sit the base on the
      // surface rather than trusting it to be at the model's feet. Refresh the
      // whole branch first or the bounds are computed from a stale matrix.
      frame.worldGroup.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(object);
      object.position.y += point.y - bounds.min.y;

      placed.push(object);
    }

    function onClick() {
      // First click captures the mouse; clicks after that place at the crosshair.
      if (!controls.locked) controls.requestLock();
      else void placeAtCrosshair();
    }
    renderer.domElement.addEventListener("click", onClick);

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

    let last = performance.now();
    renderer.setAnimationLoop(() => {
      const now = performance.now();
      // Clamp dt so a backgrounded tab doesn't teleport you on return.
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      controls.update(dt);
      renderer.render(scene, camera);
    });

    if (process.env.NODE_ENV !== "production") {
      Object.assign(window, {
        THREE, scene, camera, renderer, spark, splats, frame, controls,
        placeAtCrosshair, selectedAssetRef,
      });
    }

    return () => {
      cancelled = true;
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("click", onClick);
      controls.dispose();
      observer.disconnect();
      placed.forEach((p) => {
        p.traverse((child) => {
          const m = child as THREE.Mesh;
          m.geometry?.dispose();
          const mat = m.material;
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat?.dispose();
        });
      });
      modelCache.clear();
      splats.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [spzUrl, colliderUrl, semantics]);

  return (
    <div className="relative h-full w-full bg-black">
      <div ref={hostRef} className="h-full w-full [&>canvas]:block" />

      {ready && locked && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="h-4 w-px bg-white/70 absolute left-1/2 -translate-x-1/2 -top-2" />
          <div className="w-4 h-px bg-white/70 absolute top-1/2 -translate-y-1/2 -left-2" />
        </div>
      )}

      {!ready && (
        <div className="absolute inset-0 grid place-items-center font-mono text-sm text-white">
          loading splat… {progress > 0 ? `${progress}%` : ""}
        </div>
      )}

      {ready && !locked && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="rounded bg-black/70 px-4 py-2 font-mono text-sm text-white">
            {lockHint ? "wait a moment, then click again — or drag to look" : "click to walk"}
          </p>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 font-mono text-xs text-white/70 [text-shadow:0_1px_2px_#000]">
        {locked
          ? `WASD to move · shift to sprint · mouse to look · click to place${
              selectedId ? "" : " a marker"
            } · esc to release`
          : "click to capture the mouse · or drag to look"}
      </div>

      {warning && (
        <div className="pointer-events-none absolute top-3 left-3 rounded bg-amber-500/90 px-2 py-1 font-mono text-xs text-black">
          {warning}
        </div>
      )}

      <FurnitureDrawer
        selectedId={selectedId}
        onSelect={(asset) => {
          selectedAssetRef.current = asset;
          setSelectedId(asset?.id ?? null);
        }}
        onOpenChange={(isOpen) => {
          // The drawer needs the cursor back.
          if (isOpen && document.pointerLockElement) document.exitPointerLock();
        }}
      />
    </div>
  );
}
