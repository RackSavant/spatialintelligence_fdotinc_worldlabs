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
  /** Marble assets.imagery.pano_url — lights the furniture with the real room. */
  panoUrl?: string;
  semantics?: WorldSemantics;
}

export default function SplatScene({ spzUrl, colliderUrl, panoUrl, semantics }: SplatSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lockHint, setLockHint] = useState(false);
  const [holding, setHolding] = useState(false);
  const [hovering, setHovering] = useState(false);
  // A ref, not state: the scene effect must not tear down when the selection
  // changes, so the click handler reads the current value instead.
  const selectedAssetRef = useRef<FurnitureAsset | null>(null);
  const controlsRef = useRef<FpsControls | null>(null);

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

    // Splats carry their own colour and need no lighting, but GLB furniture uses
    // PBR materials — with no light and no environment those render pure black,
    // which reads as a broken model rather than an unlit one.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 6, 2);
    scene.add(key);

    // The world's own panorama is the most honest environment we have: it makes
    // reflections and ambient tint match the room the furniture is standing in.
    const pmrem = new THREE.PMREMGenerator(renderer);
    let envTarget: THREE.WebGLRenderTarget | null = null;
    if (panoUrl) {
      new THREE.TextureLoader().load(panoUrl, (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        envTarget = pmrem.fromEquirectangular(texture);
        scene.environment = envTarget.texture;
        texture.dispose();
      });
    }

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
      // With metric scale the floor is y=0, so skip the collider raycast.
      groundY: frame.hasMetricScale ? 0 : null,
      onLockChange: (isLocked) => {
        setLocked(isLocked);
        if (isLocked) setLockHint(false);
      },
      onLockError: () => setLockHint(true),
    });
    controlsRef.current = controls;

    // Placement raycasts the collider (clean geometry, stable normals) and
    // falls back to the splats (fuzzy surface, noisy normals) when absent.
    const raycaster = new THREE.Raycaster();
    const placed: THREE.Object3D[] = [];
    const gltfLoader = new GLTFLoader();
    const modelCache = new Map<string, THREE.Object3D>();

    let ghost: THREE.Object3D | null = null;
    let ghostAssetId: string | null = null;
    /** Guards against a slow ghost load landing after the selection moved on. */
    let ghostToken = 0;
    let yawOffset = 0;

    async function loadModel(url: string): Promise<THREE.Object3D> {
      let template = modelCache.get(url);
      if (!template) {
        template = (await gltfLoader.loadAsync(url)).scene;
        modelCache.set(url, template);
      }
      return template.clone(true);
    }

    /** Where the selected piece would land: on the floor under the crosshair. */
    function computeTarget(): { point: THREE.Vector3; yaw: number } | null {
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hits: THREE.Intersection[] = [];
      raycaster.intersectObject(collider ?? splats, true, hits);
      if (!hits.length) return null;

      // The crosshair decides where on the floor, never how high off it.
      const worldPoint = hits[0].point.clone();
      if (frame.hasMetricScale) {
        // semantics_metadata puts the ground plane at y=0 by construction, so
        // that is the floor — more trustworthy than the collider, which is a
        // rough reconstruction with gaps and no surface under every point.
        worldPoint.y = 0;
      } else if (collider) {
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

      // Face the viewer (+PI, since the camera looks down -Z).
      const camYaw = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ").y;
      return { point: frame.worldGroup.worldToLocal(worldPoint), yaw: camYaw + Math.PI + yawOffset };
    }

    /**
     * Distance from a model's origin down to its lowest point. Computed once
     * per object: yaw doesn't change it, and recomputing a Box3 from geometry
     * every frame is what made the ghost preview stall the render loop.
     */
    function baseOffset(object: THREE.Object3D): number {
      if (typeof object.userData.baseOffset === "number") return object.userData.baseOffset;
      object.position.set(0, 0, 0);
      object.rotation.set(0, 0, 0);
      object.updateMatrixWorld(true);
      const offset = -new THREE.Box3().setFromObject(object).min.y;
      object.userData.baseOffset = offset;
      return offset;
    }

    /** Sit the model's base on the target rather than trusting its origin. */
    function seat(object: THREE.Object3D, target: { point: THREE.Vector3; yaw: number }) {
      const offset = baseOffset(object);
      object.position.set(target.point.x, target.point.y + offset, target.point.z);
      object.rotation.y = target.yaw;
    }

    /**
     * Sweep every ghost out of the scene, not just the one `ghost` points at.
     * A ghost whose load resolved after the selection changed is orphaned —
     * still in the scene, no longer referenced — and stacking those translucent
     * copies is what turns furniture into a pile of outlines.
     */
    function removeGhosts() {
      for (const child of [...frame.worldGroup.children]) {
        if (!child.userData.isGhost) continue;
        frame.worldGroup.remove(child);
        child.traverse((node) => {
          const mesh = node as THREE.Mesh;
          const mat = mesh.material;
          if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
          else mat?.dispose();
        });
      }
      ghost = null;
    }

    function makeTranslucent(object: THREE.Object3D) {
      object.traverse((node) => {
        const mesh = node as THREE.Mesh;
        if (!mesh.material) return;
        const soften = (m: THREE.Material) => {
          const c = m.clone();
          c.transparent = true;
          c.opacity = 0.4;
          c.depthWrite = false;
          return c;
        };
        mesh.material = Array.isArray(mesh.material)
          ? mesh.material.map(soften)
          : soften(mesh.material);
      });
    }

    /** Called only when the selection actually changes, never per frame. */
    async function setGhostAsset(asset: FurnitureAsset | null) {
      const token = ++ghostToken;
      removeGhosts();
      ghostAssetId = asset?.id ?? null;
      if (!asset) return;

      const preview = await loadModel(asset.url);
      if (token !== ghostToken) return; // selection moved on while loading
      makeTranslucent(preview);
      preview.userData.isGhost = true;
      ghost = preview;
      frame.worldGroup.add(preview);
    }

    // Raycasting the collider is expensive, so the preview refreshes on an
    // interval rather than every frame. 20/sec still tracks the crosshair.
    let lastGhostSync = 0;
    function syncGhost(now: number) {
      const asset = selectedAssetRef.current;
      if ((asset?.id ?? null) !== ghostAssetId) void setGhostAsset(asset);
      if (!ghost || now - lastGhostSync < 50) return;
      lastGhostSync = now;
      const target = computeTarget();
      ghost.visible = target !== null;
      if (target) seat(ghost, target);
    }

    async function placeAtCrosshair() {
      const asset = selectedAssetRef.current;
      const target = computeTarget();
      if (!target) return;

      const object = asset
        ? await loadModel(asset.url)
        : new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.5, 0.5),
            new THREE.MeshBasicMaterial({ color: 0x4ade80 }),
          );
      object.userData.placed = true;
      frame.worldGroup.add(object);
      seat(object, target);
      placed.push(object);
    }

    function destroy(object: THREE.Object3D) {
      frame.worldGroup.remove(object);
      object.traverse((node) => {
        const mesh = node as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
    }

    function undoPlacement() {
      const last = placed.pop();
      if (last) destroy(last);
    }

    // --- grab and move -----------------------------------------------------

    let held: THREE.Object3D | null = null;
    /** Where a held piece came from, so cancelling puts it back. */
    let heldRestore: { position: THREE.Vector3; rotationY: number } | null = null;

    const highlight = new THREE.Box3Helper(new THREE.Box3(), 0x4ade80);
    highlight.visible = false;
    scene.add(highlight);

    /** The placed piece under the crosshair, if any. */
    function pickPlaced(): THREE.Object3D | null {
      if (!placed.length) return null;
      raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
      const hits: THREE.Intersection[] = [];
      raycaster.intersectObjects(placed, true, hits);
      if (!hits.length) return null;
      // Hits land on child meshes; walk up to the object we actually placed.
      let node: THREE.Object3D | null = hits[0].object;
      while (node && !node.userData.placed) node = node.parent;
      return node;
    }

    function grab(object: THREE.Object3D) {
      held = object;
      heldRestore = { position: object.position.clone(), rotationY: object.rotation.y };
      setHolding(true);
      // A held piece must not block the raycast that decides where it lands.
      object.traverse((n) => ((n as THREE.Mesh).raycast = () => {}));
    }

    function release(restore: boolean) {
      if (!held) return;
      if (restore && heldRestore) {
        held.position.copy(heldRestore.position);
        held.rotation.y = heldRestore.rotationY;
      }
      // Restore normal raycasting so it can be picked up again.
      held.traverse((n) => {
        const mesh = n as THREE.Mesh;
        if (mesh.isMesh) delete (mesh as Partial<THREE.Mesh>).raycast;
      });
      held = null;
      heldRestore = null;
      setHolding(false);
    }

    function deleteHeld() {
      if (!held) return;
      const index = placed.indexOf(held);
      if (index >= 0) placed.splice(index, 1);
      destroy(held);
      held = null;
      heldRestore = null;
      setHolding(false);
    }

    let lastInteractSync = 0;
    function syncInteraction(now: number) {
      if (held) {
        highlight.visible = false;
        const target = computeTarget();
        if (target) {
          // Follow the crosshair but keep the piece's own facing — picking
          // something up shouldn't spin it round to look at you.
          held.position.set(target.point.x, target.point.y + baseOffset(held), target.point.z);
        }
        return;
      }
      if (now - lastInteractSync < 60) return;
      lastInteractSync = now;

      const hovered = selectedAssetRef.current ? null : pickPlaced();
      setHovering(!!hovered);
      if (hovered) {
        highlight.box.setFromObject(hovered);
        highlight.visible = true;
      } else {
        highlight.visible = false;
      }
    }

    function clearSelection() {
      selectedAssetRef.current = null;
      setSelectedId(null);
      removeGhosts();
    }

    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const step = e.shiftKey ? -Math.PI / 8 : Math.PI / 8;

      if (e.code === "KeyR") {
        if (held) held.rotation.y += step;
        else yawOffset += step;
      } else if (e.code === "KeyE") {
        if (held) release(false);
        else void placeAtCrosshair();
      } else if (e.code === "KeyX" || e.code === "Delete" || e.code === "Backspace") {
        deleteHeld();
      } else if (e.code === "KeyZ") {
        if (!held) undoPlacement();
      } else if (e.code === "KeyQ" || e.code === "Escape") {
        if (held) release(true);
        else clearSelection();
      } else {
        return;
      }
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);

    // Distinguish a click from a look-drag, or dragging the view would drop
    // furniture every time you released the mouse.
    let pressAt: { x: number; y: number } | null = null;
    const onPointerDown = (e: PointerEvent) => (pressAt = { x: e.clientX, y: e.clientY });

    function onClick(e: MouseEvent) {
      const moved = pressAt ? Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y) : 0;
      pressAt = null;
      if (moved > 5) return;

      // Capture the mouse if we can — but interaction must never depend on it.
      if (!controls.locked) controls.requestLock();

      if (held) {
        release(false); // drop where it stands
        return;
      }
      const target = pickPlaced();
      if (target && !selectedAssetRef.current) {
        grab(target);
        return;
      }
      if (selectedAssetRef.current) void placeAtCrosshair();
    }
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
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
      syncGhost(now);
      syncInteraction(now);
      renderer.render(scene, camera);
    });

    if (process.env.NODE_ENV !== "production") {
      Object.assign(window, {
        THREE, scene, camera, renderer, spark, splats, frame, controls,
        placeAtCrosshair, selectedAssetRef, computeTarget, syncGhost, syncInteraction,
        pickPlaced, placedObjects: placed,
      });
    }

    return () => {
      cancelled = true;
      renderer.setAnimationLoop(null);
      renderer.domElement.removeEventListener("click", onClick);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
      removeGhosts();
      scene.remove(highlight);
      highlight.geometry.dispose();
      controls.dispose();
      controlsRef.current = null;
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
      envTarget?.dispose();
      pmrem.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, [spzUrl, colliderUrl, panoUrl, semantics]);

  return (
    <div className="relative h-full w-full bg-black">
      <div ref={hostRef} className="h-full w-full [&>canvas]:block" />

      {ready && (locked || selectedId || holding || hovering) && (
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

      {ready && !locked && !selectedId && !holding && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <p className="rounded bg-black/70 px-4 py-2 font-mono text-sm text-white">
            {lockHint ? "wait a moment, then click again — or drag to look" : "click to walk"}
          </p>
        </div>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 font-mono text-xs text-white/70 [text-shadow:0_1px_2px_#000]">
        {holding
          ? "moving · click to drop · R rotate (shift+R reverse) · X delete · Q cancel"
          : selectedId
            ? "placing · click or E to drop · R rotate · Z undo · Q to stop placing"
            : hovering
              ? "click to pick this up · WASD to move"
              : locked
                ? "walking · WASD move · shift sprint · esc to release"
                : "click to capture the mouse · WASD to move · drag to look"}
      </div>

      {(selectedId || holding) && (
        <div className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 rounded bg-green-400/90 px-3 py-1 font-mono text-xs text-black">
          {holding ? "moving — click to drop, Q to cancel" : "placing — Q to stop"}
        </div>
      )}

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
          // The drawer needs the cursor; closing it should return you to walking
          // rather than making you click through a lock request again.
          // Don't re-request pointer lock here: this runs from an effect, not a
          // user gesture, so the browser refuses it and the refusal burns the
          // rate-limit window that the user's next real click needs.
          if (isOpen && document.pointerLockElement) document.exitPointerLock();
        }}
      />
    </div>
  );
}
