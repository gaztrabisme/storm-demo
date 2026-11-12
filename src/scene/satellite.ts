// GK-2A, low-poly and built in code (SPEC 6.7): a body box, the AMI imager box and a small KSEM box, one solar
// wing of three panels on a boom, and a dish on an arm beside the body. Not to scale.
// The group's +z axis faces the Earth after lookAt(0, 0, 0); +y is north. Drawn as a line drawing in pale ink
// (DESIGN 5): faces in the colour of space, their edges as fine lines.
import * as THREE from 'three';
import { SCENE } from './colors';

/** Body edge length in scene units (1 = Earth radius). About 13 km, far larger than the real body. */
export const SAT_SIZE = 0.0021;

/** The parts the HUD labels point at (SPEC 10.6). */
export type PartKey = 'ami' | 'ksem' | 'wing' | 'dish';

export interface SatPart {
  key: PartKey;
  /** Anchor point on the part, in the group's frame. */
  anchor: THREE.Vector3;
  /** Outward normal of the face the anchor sits on, in the group's frame; null for a part seen from both sides. */
  normal: THREE.Vector3 | null;
}

export interface Satellite {
  group: THREE.Group;
  parts: SatPart[];
  /** Every edge vertex of the drawing, in the group's frame (x, y, z, ...): the model's extent on screen. */
  points: Float32Array;
}

export function buildSatellite(): Satellite {
  const s = SAT_SIZE;
  const g = new THREE.Group();
  const fill = new THREE.MeshBasicMaterial({ color: SCENE.satFill, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, fill);
    m.position.set(x, y, z);
    m.rotation.set(rx, 0, rz);
    g.add(m);
    return m;
  };

  // Body.
  add(new THREE.BoxGeometry(s, s * 1.2, s), 0, 0, 0);

  // AMI imager: the largest box on the Earth-facing side, with its aperture as a ring on the face.
  const AMI = { x: s * 0.12, y: s * 0.12, w: s * 0.55, h: s * 0.6, d: s * 0.42 };
  add(new THREE.BoxGeometry(AMI.w, AMI.h, AMI.d), AMI.x, AMI.y, s * 0.5 + AMI.d / 2);
  const amiFace = s * 0.5 + AMI.d;

  // KSEM: a small box on the side facing away from the Earth.
  const KSEM = { x: -s * 0.24, y: s * 0.3, k: s * 0.24 };
  add(new THREE.BoxGeometry(KSEM.k, KSEM.k, KSEM.k), KSEM.x, KSEM.y, -s * 0.5 - KSEM.k / 2);
  const ksemFace = -s * 0.5 - KSEM.k;

  // One solar wing of three panels on a boom, pointing north (+y), the way a geostationary satellite holds it.
  add(new THREE.CylinderGeometry(s * 0.04, s * 0.04, s * 1.0, 6), 0, s * 1.1, 0);
  const PW = s * 1.5;
  const PH = s * 1.5;
  const panelY = (i: number) => s * 1.6 + PH / 2 + i * (PH + s * 0.12);
  for (let i = 0; i < 3; i++) add(new THREE.BoxGeometry(PW, PH, s * 0.05), 0, panelY(i), 0);

  // A dish facing the Earth (+z) on a short arm on the -x side of the body.
  const DISH = { x: -s * 1.2, y: -s * 0.1, z: s * 0.05, r: s * 0.42 };
  add(new THREE.CylinderGeometry(s * 0.035, s * 0.035, s * 0.45, 6), -s * 0.72, DISH.y, s * 0.2, 0, Math.PI / 2);
  add(new THREE.SphereGeometry(DISH.r, 16, 6, 0, Math.PI * 2, 0, Math.PI / 3), DISH.x, DISH.y, DISH.z, -Math.PI / 2);
  add(new THREE.CylinderGeometry(s * 0.03, s * 0.03, s * 0.35, 6), DISH.x, DISH.y, s * 0.3, Math.PI / 2);

  // Edges as fine pale lines over the dark faces.
  const ink = new THREE.LineBasicMaterial({ color: SCENE.satInk });
  const pts: number[] = [];
  const v = new THREE.Vector3();
  for (const m of [...g.children]) {
    if (!(m instanceof THREE.Mesh)) continue;
    const eg = new THREE.EdgesGeometry(m.geometry, 25);
    const e = new THREE.LineSegments(eg, ink);
    e.position.copy(m.position);
    e.rotation.copy(m.rotation);
    g.add(e);
    e.updateMatrix();
    const pos = eg.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(e.matrix);
      pts.push(v.x, v.y, v.z);
    }
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

  const parts: SatPart[] = [
    { key: 'ami', anchor: new THREE.Vector3(AMI.x, AMI.y, amiFace), normal: new THREE.Vector3(0, 0, 1) },
    { key: 'ksem', anchor: new THREE.Vector3(KSEM.x, KSEM.y, ksemFace), normal: new THREE.Vector3(0, 0, -1) },
    // Off the wing's centre line, so the anchor moves when the model turns about the north axis.
    { key: 'wing', anchor: new THREE.Vector3(PW * 0.28, panelY(1) + PH * 0.17, 0), normal: null },
    { key: 'dish', anchor: new THREE.Vector3(DISH.x, DISH.y, DISH.z - DISH.r * 0.9), normal: new THREE.Vector3(0, 0, 1) },
  ];
  return { group: g, parts, points: new Float32Array(pts) };
}
