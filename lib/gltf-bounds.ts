import * as THREE from "three";

export interface GlbBounds {
  primitives: number;
  /** Size in the model's own units — metres for well-authored furniture. */
  size: { x: number; y: number; z: number } | null;
  /** Distance from the model origin down to its lowest point. */
  minY: number | null;
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

  if (box.isEmpty()) return { primitives, size: null, minY: null };
  const size = box.getSize(new THREE.Vector3());
  return {
    primitives,
    size: { x: +size.x.toFixed(4), y: +size.y.toFixed(4), z: +size.z.toFixed(4) },
    minY: +box.min.y.toFixed(4),
  };
}
