import * as THREE from "three";

export interface WorldSemantics {
  /** null or 1.0 means Marble could not infer scale — see hasMetricScale. */
  metricScaleFactor: number | null;
  groundPlaneOffset: number | null;
}

export interface WorldFrame {
  /**
   * The app's frame: metres, Y-up, ground plane at y=0.
   * Add this to the scene. Place furniture in HERE, in real-world metres.
   */
  worldGroup: THREE.Group;
  /** Splats and the collider mesh go in here — raw Marble asset space. */
  contentGroup: THREE.Group;
  /** False when Marble returned no usable scale; furniture sizing is unreliable. */
  hasMetricScale: boolean;
}

/**
 * Marble hands back splats in arbitrary model units, Y-down, with the ground at
 * an arbitrary height. Three transforms fix that, and the order matters:
 *
 *   metric_xyz  = raw_xyz * metric_scale_factor      (semantics_metadata)
 *   aligned_xyz = metric_xyz - (0, ground_plane_offset, 0)
 *   world_xyz   = R(180deg about X) * aligned_xyz    (Y-down -> Y-up)
 *
 * A single Object3D can't express that — its local matrix is always T * R * S,
 * so the flip would be applied before the ground offset. Hence nested groups:
 *
 *   worldGroup                       <- furniture, in metres, ground at y=0
 *     alignGroup   R(180 about X)
 *       contentGroup  T(0,-offset,0) * S(scale)
 *         SplatMesh, collider GLB
 *
 * Placing furniture as a sibling of the splats inside worldGroup (rather than
 * flipping the SplatMesh itself, as a bare viewer does) is what keeps stored
 * placement coordinates meaningful.
 */
export function createWorldFrame(semantics: WorldSemantics): WorldFrame {
  const scale = semantics.metricScaleFactor ?? 1;
  const offset = semantics.groundPlaneOffset ?? 0;

  const worldGroup = new THREE.Group();
  worldGroup.name = "worldGroup";

  const alignGroup = new THREE.Group();
  alignGroup.name = "alignGroup";
  alignGroup.quaternion.set(1, 0, 0, 0); // 180 degrees about X
  worldGroup.add(alignGroup);

  const contentGroup = new THREE.Group();
  contentGroup.name = "contentGroup";
  contentGroup.scale.setScalar(scale);
  contentGroup.position.y = -offset;
  alignGroup.add(contentGroup);

  return {
    worldGroup,
    contentGroup,
    hasMetricScale: semantics.metricScaleFactor != null && semantics.metricScaleFactor !== 1,
  };
}
