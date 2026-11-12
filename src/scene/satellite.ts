// GK-2A, low-poly and built in code (SPEC 6.7): a box body, one wing of three solar panels on a boom, a small
// dish on an arm beside the body, and instrument boxes.
// Not to scale. The group's +z axis faces the Earth after lookAt(0, 0, 0). Drawn as a thin-line drawing in
// pale ink (DESIGN 5): faces in the colour of space, their edges as fine lines.
import * as THREE from 'three';
import { SCENE } from './colors';

/** Body edge length in scene units (1 = Earth radius). About 13 km, far larger than the real body. */
export const SAT_SIZE = 0.0021;

export function buildSatellite(): THREE.Group {
  const s = SAT_SIZE;
  const g = new THREE.Group();
  const fill = () => new THREE.MeshBasicMaterial({ color: SCENE.satFill, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const body = fill();
  const metal = fill();
  const panel = fill();

  // Body.
  g.add(new THREE.Mesh(new THREE.BoxGeometry(s, s * 1.2, s), body));

  // One solar wing of three panels on a boom, pointing north (+y), the way a geostationary satellite holds it.
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.04, s * 0.04, s * 1.0, 6), metal);
  boom.position.y = s * 1.1;
  g.add(boom);
  const PW = s * 1.5;
  const PH = s * 1.5;
  const panelY = (i: number) => s * 1.6 + PH / 2 + i * (PH + s * 0.12);
  for (let i = 0; i < 3; i++) {
    const cell = new THREE.Mesh(new THREE.BoxGeometry(PW, PH, s * 0.05), panel);
    cell.position.y = panelY(i);
    g.add(cell);
  }

  // A small dish facing the Earth (+z), on a short arm beside the body, so it shows from behind as well.
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.035, s * 0.035, s * 0.45, 6), metal);
  arm.rotation.z = Math.PI / 2;
  arm.position.set(-s * 0.72, -s * 0.1, s * 0.2);
  g.add(arm);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(s * 0.42, 16, 6, 0, Math.PI * 2, 0, Math.PI / 3), metal);
  dish.rotation.x = -Math.PI / 2;
  dish.position.set(-s * 1.2, -s * 0.1, s * 0.05);
  g.add(dish);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.03, s * 0.03, s * 0.35, 6), metal);
  feed.rotation.x = Math.PI / 2;
  feed.position.set(-s * 1.2, -s * 0.1, s * 0.3);
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

  // Edges as fine pale lines over the dark faces.
  const ink = new THREE.LineBasicMaterial({ color: SCENE.satInk });
  for (const m of [...g.children]) {
    if (!(m instanceof THREE.Mesh)) continue;
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 25), ink);
    e.position.copy(m.position);
    e.rotation.copy(m.rotation);
    g.add(e);
  }
  // Solar cells: a grid on both faces of each panel (4 across, 3 down), so the wing reads as panels of cells.
  const cellLines: THREE.Vector3[] = [];
  for (let i = 0; i < 3; i++) {
    const y = panelY(i);
    for (const z of [-s * 0.03, s * 0.03]) {
      for (let k = 1; k < 4; k++) {
        const x = -PW / 2 + (PW * k) / 4;
        cellLines.push(new THREE.Vector3(x, y - PH / 2, z), new THREE.Vector3(x, y + PH / 2, z));
      }
      for (let k = 1; k < 3; k++) {
        const yy = y - PH / 2 + (PH * k) / 3;
        cellLines.push(new THREE.Vector3(-PW / 2, yy, z), new THREE.Vector3(PW / 2, yy, z));
      }
    }
  }
  const cellInk = new THREE.LineBasicMaterial({ color: SCENE.satInk, transparent: true, opacity: 0.55 });
  g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cellLines), cellInk));
  return g;
}
