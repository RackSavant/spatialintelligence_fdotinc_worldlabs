import * as THREE from "three";

/**
 * Pointer-lock FPS controls for walking a metric interior.
 *
 * Spark's SparkControls is drag-to-orbit with inertia — good for inspecting an
 * object, wrong for standing inside a room. This is mouse-look plus WASD, with
 * yaw and pitch tracked separately so the camera never rolls, and movement
 * derived from yaw alone so looking up doesn't walk you into the ceiling.
 *
 * Speeds are in metres per second, which is only meaningful because Marble
 * gives us metric_scale_factor.
 */

const WALK_SPEED = 2.6;
const SPRINT_SPEED = 6.5;
const LOOK_SENSITIVITY = 0.0022;
const PITCH_LIMIT = Math.PI / 2 - 0.02;
/** How far above the camera to start the floor probe. */
const PROBE_HEIGHT = 3;
const FLOOR_SMOOTHING = 12;

export interface FpsControlsOptions {
  camera: THREE.PerspectiveCamera;
  domElement: HTMLElement;
  eyeHeight: number;
  /** Collider mesh to stand on. Null means free-fly. */
  getFloor: () => THREE.Object3D | null;
  onLockChange?: (locked: boolean) => void;
  /** Pointer lock was refused (usually Chrome's rate limit). */
  onLockError?: () => void;
}

export class FpsControls {
  private yaw = 0;
  private pitch = 0;
  private readonly keys = new Set<string>();
  private dragging = false;
  private lastLockRequest = 0;
  private lastPointer: { x: number; y: number } | null = null;
  private readonly raycaster = new THREE.Raycaster();
  private readonly down = new THREE.Vector3(0, -1, 0);
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly move = new THREE.Vector3();
  private disposed = false;

  constructor(private readonly opts: FpsControlsOptions) {
    const { camera } = opts;
    // Seed yaw/pitch from wherever the camera was aimed.
    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
    this.yaw = euler.y;
    this.pitch = euler.x;

    opts.domElement.addEventListener("pointerdown", this.onPointerDown);
    opts.domElement.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("pointerlockchange", this.onLockChange);
  }

  get locked(): boolean {
    return document.pointerLockElement === this.opts.domElement;
  }

  requestLock() {
    // Chrome rate-limits pointer lock after an exit and rejects if asked again
    // too soon. Unhandled, that rejection surfaces as a runtime error overlay.
    const now = performance.now();
    if (now - this.lastLockRequest < 1300) return;
    this.lastLockRequest = now;
    try {
      const result = this.opts.domElement.requestPointerLock?.() as unknown;
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(() => {
          // Drag-to-look still works, so a refusal is not fatal.
          this.opts.onLockError?.();
        });
      }
    } catch {
      this.opts.onLockError?.();
    }
  }

  private onLockChange = () => {
    this.opts.onLockChange?.(this.locked);
    if (!this.locked) this.keys.clear();
  };

  private onPointerDown = (e: PointerEvent) => {
    // Drag-to-look still works when pointer lock is unavailable or declined.
    if (!this.locked) {
      this.dragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    }
  };

  private onPointerUp = () => {
    this.dragging = false;
    this.lastPointer = null;
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.locked) {
      this.applyLook(e.movementX, e.movementY);
      return;
    }
    if (!this.dragging || !this.lastPointer) return;
    this.applyLook(e.clientX - this.lastPointer.x, e.clientY - this.lastPointer.y);
    this.lastPointer = { x: e.clientX, y: e.clientY };
  };

  private applyLook(dx: number, dy: number) {
    this.yaw -= dx * LOOK_SENSITIVITY;
    this.pitch -= dy * LOOK_SENSITIVITY;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    this.keys.add(e.code);
    // Stop Space and the arrows from scrolling the page while walking.
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code)) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => this.keys.delete(e.code);
  private onBlur = () => this.keys.clear();

  private axis(positive: string[], negative: string[]): number {
    const p = positive.some((k) => this.keys.has(k)) ? 1 : 0;
    const n = negative.some((k) => this.keys.has(k)) ? 1 : 0;
    return p - n;
  }

  update(dt: number) {
    if (this.disposed) return;
    const { camera, eyeHeight, getFloor } = this.opts;

    camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, "YXZ"));

    const forwardInput = this.axis(["KeyW", "ArrowUp"], ["KeyS", "ArrowDown"]);
    const strafeInput = this.axis(["KeyD", "ArrowRight"], ["KeyA", "ArrowLeft"]);
    const verticalInput = this.axis(["Space"], ["KeyC", "ShiftRight"]);

    // Walk on the yaw plane only, so looking up never lifts you off the floor.
    this.forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    this.move
      .set(0, 0, 0)
      .addScaledVector(this.forward, forwardInput)
      .addScaledVector(this.right, strafeInput);
    if (this.move.lengthSq() > 0) this.move.normalize();

    const speed = this.keys.has("ShiftLeft") ? SPRINT_SPEED : WALK_SPEED;
    camera.position.addScaledVector(this.move, speed * dt);

    const floor = getFloor();
    if (floor) {
      // Stay a fixed height above whatever is underfoot.
      this.raycaster.set(
        new THREE.Vector3(camera.position.x, camera.position.y + PROBE_HEIGHT, camera.position.z),
        this.down,
      );
      const hits: THREE.Intersection[] = [];
      this.raycaster.intersectObject(floor, true, hits);
      if (hits.length > 0) {
        const target = hits[0].point.y + eyeHeight;
        // Smooth it, or every small step in the collider reads as a jolt.
        const t = 1 - Math.exp(-FLOOR_SMOOTHING * dt);
        camera.position.y += (target - camera.position.y) * t;
      } else if (verticalInput !== 0) {
        camera.position.y += verticalInput * speed * dt;
      }
    } else {
      // No collider: free-fly.
      camera.position.y += verticalInput * speed * dt;
    }
  }

  dispose() {
    this.disposed = true;
    const el = this.opts.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("pointerlockchange", this.onLockChange);
    if (this.locked) document.exitPointerLock?.();
  }
}
