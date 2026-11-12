// The 3D half of Usui-chan's figure (SPEC 6.8), loaded lazily with three.js: one WebGL renderer on a canvas that is
// not in the page draws each figure in turn, and each figure copies the picture into its own 2D canvas.
// Model loading as AstroSphere src/scene/horizonDiagram.ts: GLTFLoader in its own chunk, skinned meshes never
// frustum-culled, VRoid's BLEND materials drawn as alpha-test so the parts sort correctly.
import * as THREE from 'three';
import type { Pose } from './clips';

export interface FigureRenderer {
  /** Draws the figure in `pose` and copies it into `out` (its canvas size is the picture size in device pixels). */
  draw(pose: Pose, out: CanvasRenderingContext2D): void;
}

/** Arms-down rest pose, as directions in model axes (+Y up, +Z toward the viewer, +X her left). */
const ARMS_DOWN: Array<[bone: string, child: string, dir: [number, number, number]]> = [
  ['J_Bip_R_UpperArm', 'J_Bip_R_LowerArm', [-0.2, -1, -0.02]],
  ['J_Bip_R_LowerArm', 'J_Bip_R_Hand', [-0.1, -1, 0.14]],
  ['J_Bip_R_Hand', 'J_Bip_R_Middle1', [-0.06, -1, 0.1]],
  ['J_Bip_L_UpperArm', 'J_Bip_L_LowerArm', [0.2, -1, -0.02]],
  ['J_Bip_L_LowerArm', 'J_Bip_L_Hand', [0.1, -1, 0.14]],
  ['J_Bip_L_Hand', 'J_Bip_L_Middle1', [0.06, -1, 0.1]],
  // The fingers held the props: open them along the hand, a little curled toward the palm side.
  ...(['R', 'L'] as const).flatMap((side) => {
    const sx = side === 'R' ? -1 : 1;
    return (['Index', 'Middle', 'Ring', 'Little'] as const).flatMap((f) => [
      [`J_Bip_${side}_${f}1`, `J_Bip_${side}_${f}2`, [0.06 * sx, -1, 0.16]] as [string, string, [number, number, number]],
      [`J_Bip_${side}_${f}2`, `J_Bip_${side}_${f}3`, [0.06 * sx, -1, 0.26]] as [string, string, [number, number, number]],
    ]);
  }),
];

/** Head-to-waist framing: the part of the model (metres, model axes) the camera keeps in view. */
const FRAME = { bottom: 0.94, top: 1.63, centerX: -0.03 };
const FOV = 18;

interface Joint {
  bone: THREE.Object3D;
  /** Rest local rotation (arms down). */
  rest: THREE.Quaternion;
  /** The parent's rest rotation in model space, and its inverse. */
  parent: THREE.Quaternion;
  parentInv: THREE.Quaternion;
}

export async function createFigureRenderer(url: string): Promise<FigureRenderer> {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);

  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  const model = gltf.scene;

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#b8a99a', 1.5));
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);
  const key = new THREE.DirectionalLight('#ffffff', 1.0);
  key.position.set(0.3, 0.6, 1);
  camera.add(key);
  scene.add(camera);
  scene.add(model);

  const bones = new Map<string, THREE.Object3D>();
  const faces: THREE.Mesh[] = [];
  model.traverse((o) => {
    if (o.name && !bones.has(o.name)) bones.set(o.name, o);
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    // The props in the club model (a base disc, a flag on a pole, the objects in her hands) are not part of the
    // half-body figure; only the skinned body and face are drawn.
    if (!(mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      mesh.visible = false;
      return;
    }
    mesh.frustumCulled = false;
    // The exported materials are physical (clearcoat, specular): their shaders take most of a second to build
    // under software rendering, on the first frame. A Lambert material with the same colour map draws the small
    // figure just as well and builds fast. BLEND becomes alpha-test, as in AstroSphere.
    const toLambert = (m: THREE.Material): THREE.Material => {
      const src = m as THREE.MeshStandardMaterial;
      const out = new THREE.MeshLambertMaterial({
        map: src.map ?? null,
        color: src.color ?? new THREE.Color(1, 1, 1),
        side: src.side,
        alphaTest: src.transparent ? Math.max(src.alphaTest, 0.5) : src.alphaTest,
        transparent: false,
        depthWrite: true,
      });
      m.dispose();
      return out;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(toLambert) : toLambert(mesh.material);
    // The club model's face keeps the Fcl_* names but its merged mesh has no morph targets, so this list is empty
    // for it and face weights show nothing; a model with the shapes gets them.
    if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) faces.push(mesh);
  });

  // Arms down: turn each arm segment so it points along its rest direction.
  const wq = new THREE.Quaternion();
  const pq = new THREE.Quaternion();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  for (const [name, childName, dir] of ARMS_DOWN) {
    const bone = bones.get(name);
    const child = bones.get(childName);
    if (!bone || !child || !bone.parent) continue;
    model.updateMatrixWorld(true);
    bone.getWorldPosition(a);
    child.getWorldPosition(b);
    turn.setFromUnitVectors(b.sub(a).normalize(), new THREE.Vector3(...dir).normalize());
    bone.getWorldQuaternion(wq);
    bone.parent.getWorldQuaternion(pq);
    bone.quaternion.copy(pq.invert().multiply(turn).multiply(wq));
  }
  model.updateMatrixWorld(true);

  // Every J_Bip_* bone, with its rest rotation and its parent's rest rotation.
  const joints = new Map<string, Joint>();
  for (const [name, bone] of bones) {
    if (!/^J_Bip_/.test(name) || !bone.parent) continue;
    const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    joints.set(name, { bone, rest: bone.quaternion.clone(), parent, parentInv: parent.clone().invert() });
  }

  const euler = new THREE.Euler();
  const q = new THREE.Quaternion();
  const setJoint = (j: Joint, x: number, y: number, z: number) => {
    // Offset in the parent's rest frame (model axes): local = P⁻¹ · O · P · rest.
    q.setFromEuler(euler.set(x, y, z, 'XYZ'));
    j.bone.quaternion.copy(j.parentInv).multiply(q).multiply(j.parent).multiply(j.rest);
  };

  function applyPose(pose: Pose): void {
    for (const j of joints.values()) j.bone.quaternion.copy(j.rest);
    for (const name in pose.bones) {
      const j = joints.get(name);
      const e = pose.bones[name];
      if (j) setJoint(j, e[0], e[1], e[2]);
    }
    for (const m of faces) {
      const inf = m.morphTargetInfluences!;
      inf.fill(0);
      const dict = m.morphTargetDictionary!;
      for (const name in pose.face) {
        const i = dict[name];
        if (i !== undefined) inf[i] = pose.face[name];
      }
    }
  }

  let w = 0;
  let h = 0;
  function frame(width: number, height: number): void {
    if (width === w && height === h) return;
    w = width;
    h = height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Fit the framed height, and the width at least 0.62 m (room for the waving hand).
    const tan = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const fitH = (FRAME.top - FRAME.bottom) / 2 / tan;
    const fitW = 0.62 / 2 / (tan * camera.aspect);
    const dist = Math.max(fitH, fitW);
    const cy = (FRAME.top + FRAME.bottom) / 2;
    camera.position.set(FRAME.centerX, cy + 0.02, dist);
    camera.lookAt(FRAME.centerX, cy, 0);
    camera.updateProjectionMatrix();
  }

  // Compile the shaders and upload the textures now, without drawing, so the first figure shown later does not
  // stall a frame (for example the satellite flight's landing).
  frame(136, 160);
  await renderer.compileAsync(scene, camera);
  model.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      for (const v of Object.values(m)) if (v instanceof THREE.Texture) renderer.initTexture(v);
    }
  });

  return {
    draw(pose, out) {
      const cw = out.canvas.width;
      const ch = out.canvas.height;
      if (!cw || !ch) return;
      frame(cw, ch);
      applyPose(pose);
      renderer.render(scene, camera);
      out.clearRect(0, 0, cw, ch);
      out.drawImage(canvas, 0, 0, cw, ch, 0, 0, cw, ch);
    },
  };
}
