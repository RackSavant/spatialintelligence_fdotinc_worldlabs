import * as THREE from "three";
import { SparkRenderer, SplatMesh, SparkControls } from "@sparkjsdev/spark";

// Drop a Marble export into public/worlds/ and point this at it, e.g.
//   const SPLAT_URL = "/worlds/my-world.spz";
// Or pass one at runtime: http://localhost:5173/?splat=/worlds/my-world.spz
// Defaults to a hosted sample so the scene renders before you have your own.
const SPLAT_URL =
  new URLSearchParams(location.search).get("splat") ??
  "https://sparkjs.dev/assets/splats/butterfly.spz";

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.01,
  1000,
);

// antialias: false is deliberate — MSAA does nothing for splats and costs a lot.
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const spark = new SparkRenderer({ renderer });
scene.add(spark);

const world = new SplatMesh({ url: SPLAT_URL });
// Splat exports are Y-down; this 180° flip about X puts the world upright.
world.quaternion.set(1, 0, 0, 0);
world.position.set(0, 0, -3);
scene.add(world);

world.initialized.then(() => {
  document.getElementById("loading").classList.add("done");
  console.log(`loaded ${world.numSplats.toLocaleString()} splats from ${SPLAT_URL}`);
});

const controls = new SparkControls({ canvas: renderer.domElement });

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update(camera);
  renderer.render(scene, camera);
});

// Dev-only handles for poking at the scene from the browser console.
if (import.meta.env.DEV) {
  Object.assign(window, { THREE, scene, camera, renderer, spark, world, controls });
}
