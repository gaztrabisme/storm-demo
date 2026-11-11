// GK-2A, low-poly and built in code (SPEC 6.7): a box body, one solar panel wing, a dish and instrument boxes.
// Not to scale. The group's +z axis faces the Earth after lookAt(0, 0, 0).
import * as THREE from 'three';
import { SCENE } from './colors';

/** Body edge length in scene units (1 = Earth radius). About 16 km, far larger than the real body. */
export const SAT_SIZE = 0.0025;

export function buildSatellite(): THREE.Group {
  const s = SAT_SIZE;
  const g = new THREE.Group();
  const body = new THREE.MeshLambertMaterial({ color: SCENE.satBody });
  const metal = new THREE.MeshLambertMaterial({ color: SCENE.satMetal });
  const panel = new THREE.MeshLambertMaterial({ color: SCENE.satPanel, side: THREE.DoubleSide });

  // Body.
  g.add(new THREE.Mesh(new THREE.BoxGeometry(s, s * 1.2, s), body));

  // One solar wing on a boom, pointing north (+y), the way a geostationary satellite holds it.
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.04, s * 0.04, s * 0.9, 6), metal);
  boom.position.y = s * 1.05;
  g.add(boom);
  for (let i = 0; i < 3; i++) {
    const cell = new THREE.Mesh(new THREE.BoxGeometry(s * 1.4, s * 1.1, s * 0.05), panel);
    cell.position.y = s * (2.1 + i * 1.18);
    g.add(cell);
  }

  // Dish facing the Earth (+z).
  const dish = new THREE.Mesh(new THREE.SphereGeometry(s * 0.45, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.6), metal);
  dish.rotation.x = -Math.PI / 2;
  dish.position.set(-s * 0.15, -s * 0.2, s * 0.85);
  g.add(dish);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.03, s * 0.03, s * 0.35, 6), metal);
  feed.rotation.x = Math.PI / 2;
  feed.position.set(-s * 0.15, -s * 0.2, s * 0.75);
  g.add(feed);

  // Instrument boxes on the Earth-facing side.
  const boxes: Array<[number, number, number, number]> = [
    [0.28, 0.3, 0.55, 0.35],
    [0.3, -0.38, 0.55, 0.26],
    [-0.3, 0.38, 0.55, 0.22],
  ];
  for (const [x, y, z, k] of boxes) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(s * k, s * k, s * k), metal);
    b.position.set(x * s, y * s, z * s);
    g.add(b);
  }
  return g;
}
