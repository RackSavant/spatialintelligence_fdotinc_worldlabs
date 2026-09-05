import * as THREE from "three";

export interface GlbProfile {
  /** Footprint area of the lowest 20% of the model, in model units squared. */
  bottomArea: number;
  /** Footprint area of the highest 20%. */
  topArea: number;
}

export interface GlbBounds {
  primitives: number;
  /** Size in the model's own units — metres for well-authored furniture. */
  size: { x: number; y: number; z: number } | null;
  /** Distance from the model origin down to its lowest point. */
  minY: number | null;
  /** Vertical shape profile, used to spot models authored upside down. */
  profile: GlbProfile | null;
}

/**
 * Decode POSITION and measure the footprint at the top and bottom of the model.
 *
 * Seating has a wide seat below and a narrow backrest above. When that is
 * inverted the model was authored upside down — which is exactly what happened
 * to the sled chair, where the thin 0.20-deep panel sat at the bottom.
 */
function readProfile(
  json: Record<string, any>,
  bytes: Uint8Array,
  jsonLength: number,
): GlbProfile | null {
  const primitive = json.meshes?.[0]?.primitives?.[0];
  const accessor = json.accessors?.[primitive?.attributes?.POSITION];
  if (!accessor || accessor.componentType !== 5126 || accessor.type !== "VEC3") return null;
  // Compressed geometry (Draco, meshopt) can't be read this way.
  if (accessor.extensions || json.extensionsUsed?.length) return null;

  const binOffset = 20 + jsonLength + 8;
  const view = json.bufferViews?.[accessor.bufferView];
  if (!view) return null;

  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = binOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? 12;

  let minY = Infinity;
  let maxY = -Infinity;
  const points: Array<[number, number, number]> = [];
  for (let i = 0; i < accessor.count; i++) {
    const o = start + i * stride;
    if (o + 12 > bytes.byteLength) return null;
    const point: [number, number, number] = [
      dv.getFloat32(o, true),
      dv.getFloat32(o + 4, true),
      dv.getFloat32(o + 8, true),
    ];
    points.push(point);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }
  if (!points.length || maxY <= minY) return null;

  const span = maxY - minY;
  const band = (lo: number, hi: number) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, n = 0;
    for (const [x, y, z] of points) {
      const t = (y - minY) / span;
      if (t < lo || t > hi) continue;
      n++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x);
      z0 = Math.min(z0, z); z1 = Math.max(z1, z);
    }
    return n ? (x1 - x0) * (z1 - z0) : 0;
  };

  return { bottomArea: band(0, 0.2), topArea: band(0.8, 1) };
}

/**
 * Read a GLB's bounding box without decoding any buffers.
 *
 * glTF stores min/max on the POSITION accessor, so the exact bounds fall out of
 * the JSON chunk alone once node transforms are applied. That means the server
 * can measure a model without a full glTF loader or a DOM.
 */
export function readGlbBounds(bytes: Uint8Array): GlbBounds {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error("not a GLB (bad magic)");

  const jsonLength = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));

  const meshes = json.meshes ?? [];
  const accessors = json.accessors ?? [];
  const nodes = json.nodes ?? [];
  const scene = (json.scenes ?? [])[json.scene ?? 0];

  const box = new THREE.Box3();
  let primitives = 0;

  const visit = (index: number, parent: THREE.Matrix4) => {
    const node = nodes[index];
    if (!node) return;

    const local = new THREE.Matrix4();
    if (node.matrix) {
      local.fromArray(node.matrix);
    } else {
      local.compose(
        new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
        new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
        new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1]),
      );
    }
    const world = new THREE.Matrix4().multiplyMatrices(parent, local);

    if (node.mesh != null) {
      for (const primitive of meshes[node.mesh]?.primitives ?? []) {
        const accessor = accessors[primitive.attributes?.POSITION];
        if (!accessor?.min || !accessor?.max) continue;
        primitives++;
        box.union(
          new THREE.Box3(
            new THREE.Vector3().fromArray(accessor.min),
            new THREE.Vector3().fromArray(accessor.max),
          ).applyMatrix4(world),
        );
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };

  for (const root of scene?.nodes ?? []) visit(root, new THREE.Matrix4());

  if (box.isEmpty()) return { primitives, size: null, minY: null, profile: null };
  const size = box.getSize(new THREE.Vector3());
  return {
    primitives,
    size: { x: +size.x.toFixed(4), y: +size.y.toFixed(4), z: +size.z.toFixed(4) },
    minY: +box.min.y.toFixed(4),
    profile: readProfile(json, bytes, jsonLength),
  };
}
