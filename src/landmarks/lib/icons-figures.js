// Procedural "painted fibreglass" people for Borofsky's Walking to the Sky.
// A figure is a list of SDF primitives (ellipsoids + tapered capsules) posed with a tiny rig
// (2-bone IK for arms and legs), then meshed with Surface Nets and coloured per body part.
import * as THREE from 'three';
import { meshPrimsSteps, primProxyGeometry, frameFromDir, drain } from './icons-sdf.js';

// Colour slots
export const SKIN = 0, HAIR = 1, TOP = 2, BOTTOM = 3, SHOES = 4, ACCENT = 5, SLEEVE = 6;

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// 2-bone IK: returns the middle joint for root->target with segment lengths l1,l2; `hint` = bend direction.
export function ik2(root, target, l1, l2, hint) {
  const d = target.clone().sub(root);
  let len = d.length();
  const maxL = l1 + l2 - 1e-3, minL = Math.abs(l1 - l2) + 1e-3;
  if (len > maxL) { d.multiplyScalar(maxL / len); len = maxL; }
  if (len < minL) { d.multiplyScalar(minL / len); len = minL; }
  const dir = d.clone().normalize();
  const cosA = (l1 * l1 + len * len - l2 * l2) / (2 * l1 * len);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
  const perp = hint.clone().addScaledVector(dir, -hint.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.set(0, 0, 1).addScaledVector(dir, -dir.z);
  perp.normalize();
  return { mid: root.clone().addScaledVector(dir, l1 * cosA).addScaledVector(perp, l1 * sinA), end: root.clone().add(d) };
}

const arr = (v) => [v.x, v.y, v.z];

/**
 * Build primitives for one figure in adult units (1.75 m tall), local frame: +y up, +z forward, +x = figure's left.
 * spec: {
 *   female, child (bigger head, no chest), build (width scale), longHair, skirt, dress, shorts, shortSleeves, tie, bag, jacket,
 *   pelvis:[x,y,z], lean (rad, + forward), headPitch (rad, - looks up), headYaw,
 *   feet: { L:{ heel:[x,y,z], dir:[x,y,z], up:[x,y,z] }, R:{...} },
 *   hands: { L:[x,y,z], R:[x,y,z] }   (wrist targets)
 * }
 */
export function figurePrims(spec) {
  const P = [];
  const w = spec.build ?? 1;
  const headK = spec.child ? 1.22 : 1;
  const pelvis = V(...(spec.pelvis || [0, 0.93, 0]));
  const lean = spec.lean || 0;
  const cosL = Math.cos(lean), sinL = Math.sin(lean);
  // torso point relative to the pelvis, rotated by lean about the x axis
  const T = (x, y, z) => V(x, y * cosL - z * sinL, y * sinL + z * cosL).add(pelvis);
  const torsoUp = V(0, cosL, sinL), torsoFwd = V(0, -sinL, cosL);

  // ---- pelvis / torso
  const hipW = (spec.female ? 0.175 : 0.16) * w;
  P.push({ t: 'ell', p: arr(pelvis.clone().add(V(0, 0.01, -0.005))), r: [hipW, 0.12, 0.11 * w], m: frameFromDir(arr(torsoUp), arr(torsoFwd)), c: BOTTOM });
  const chest = T(0, 0.37, spec.child ? 0 : 0.005);
  const chestW = (spec.female ? 0.158 : 0.178) * w;
  P.push({ t: 'cone', a: arr(T(0, 0.08, 0)), b: arr(T(0, 0.3, 0)), r1: 0.13 * w, r2: 0.15 * w, c: TOP });
  P.push({ t: 'ell', p: arr(chest), r: [chestW, spec.child ? 0.15 : 0.17, 0.112 * w], m: frameFromDir(arr(torsoUp), arr(torsoFwd)), c: TOP });
  if (spec.female && !spec.child) {
    for (const s of [-1, 1]) P.push({ t: 'sph', p: arr(T(s * 0.065, 0.36, 0.085)), r: 0.055, c: TOP, k: 0.04 });
  }
  if (spec.jacket) { // open jacket: slightly boxier shoulders
    P.push({ t: 'ell', p: arr(T(0, 0.47, -0.01)), r: [0.2 * w, 0.07, 0.1 * w], m: frameFromDir(arr(torsoUp), arr(torsoFwd)), c: TOP });
  }
  if (spec.tie) P.push({ t: 'ell', p: arr(T(0, 0.36, 0.112 * w)), r: [0.028, 0.14, 0.012], m: frameFromDir(arr(torsoUp), arr(torsoFwd)), c: ACCENT, k: 0.005, bias: 0.01 });

  // ---- neck & head
  const neckBase = T(0, 0.53, 0);
  const headPitch = (spec.headPitch || 0) + lean * 0.5;
  const hp = headPitch, hy = spec.headYaw || 0;
  const headUp = V(0, Math.cos(hp), Math.sin(hp)).applyAxisAngle(V(0, 1, 0), hy);
  const headFwd = V(0, -Math.sin(hp), Math.cos(hp)).applyAxisAngle(V(0, 1, 0), hy);
  const neckTop = neckBase.clone().addScaledVector(headUp, 0.085 * headK);
  P.push({ t: 'cone', a: arr(neckBase), b: arr(neckTop), r1: 0.055, r2: 0.048, c: SKIN });
  const headC = neckTop.clone().addScaledVector(headUp, 0.085 * headK).addScaledVector(headFwd, 0.012);
  const headM = frameFromDir(arr(headUp), arr(headFwd));
  P.push({ t: 'ell', p: arr(headC), r: [0.08 * headK, 0.108 * headK, 0.096 * headK], m: headM, c: SKIN });
  // jaw / chin
  P.push({ t: 'ell', p: arr(headC.clone().addScaledVector(headUp, -0.055 * headK).addScaledVector(headFwd, 0.035 * headK)), r: [0.055 * headK, 0.05 * headK, 0.06 * headK], m: headM, c: SKIN, k: 0.03 });
  // nose
  P.push({ t: 'sph', p: arr(headC.clone().addScaledVector(headFwd, 0.098 * headK).addScaledVector(headUp, -0.01)), r: 0.017 * headK, c: SKIN, k: 0.02 });
  // hair: a cap offset back/up; long hair falls to the shoulders
  P.push({ t: 'ell', p: arr(headC.clone().addScaledVector(headUp, 0.025 * headK).addScaledVector(headFwd, -0.018 * headK)), r: [0.086 * headK, 0.102 * headK, 0.1 * headK], m: headM, c: HAIR, k: 0.01, bias: 0.004 });
  if (spec.longHair) {
    P.push({ t: 'ell', p: arr(headC.clone().addScaledVector(headUp, -0.1 * headK).addScaledVector(headFwd, -0.06 * headK)), r: [0.09 * headK, 0.13 * headK, 0.055 * headK], m: headM, c: HAIR, k: 0.04 });
  }

  // ---- arms (IK to wrist targets)
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const shoulder = T(s * 0.19 * w, 0.49, -0.01);
    const handT = V(...(spec.hands?.[side] || [s * 0.24, 0.82, 0.02]));
    const { mid: elbow, end: wrist } = ik2(shoulder, handT, 0.29, 0.26, V(s * 0.3, -0.2, -1));
    const sleeve = spec.shortSleeves ? SKIN : TOP;
    P.push({ t: 'sph', p: arr(shoulder), r: 0.06 * w, c: TOP });
    P.push({ t: 'cone', a: arr(shoulder), b: arr(elbow), r1: 0.055 * w, r2: 0.043, c: TOP });
    if (spec.shortSleeves) P.push({ t: 'cone', a: arr(shoulder.clone().lerp(elbow, 0.55)), b: arr(elbow), r1: 0.046, r2: 0.041, c: SKIN, bias: 0.004 });
    P.push({ t: 'cone', a: arr(elbow), b: arr(wrist), r1: 0.042, r2: 0.032, c: sleeve });
    const fdir = wrist.clone().sub(elbow).normalize();
    const hand = wrist.clone().addScaledVector(fdir, 0.075);
    P.push({ t: 'ell', p: arr(hand), r: [0.022, 0.08, 0.043], m: frameFromDir(arr(fdir), [s, 0, 0]), c: SKIN, k: 0.015 });
    if (spec.bag && side === spec.bag) {
      P.push({ t: 'box', p: arr(hand.clone().add(V(0, -0.2, 0))), h: [0.045, 0.14, 0.17], r: 0.02, c: ACCENT, k: 0.01 });
      P.push({ t: 'cone', a: arr(hand), b: arr(hand.clone().add(V(0, -0.07, 0))), r1: 0.012, r2: 0.012, c: ACCENT, k: 0.005 });
    }
  }

  // ---- legs (IK from hip joint to ankle; feet from heel/dir)
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? 1 : -1;
    const hip = T(s * 0.092 * w, -0.03, 0);
    const f = spec.feet?.[side] || { heel: [s * 0.1, 0, -0.03], dir: [s * 0.12, 0, 1], up: [0, 1, 0] };
    const heel = V(...f.heel), fdir = V(...f.dir).normalize(), fup = V(...f.up).normalize();
    const ankle = heel.clone().addScaledVector(fup, 0.075).addScaledVector(fdir, 0.04);
    const { mid: knee, end: ank } = ik2(hip, ankle, 0.44, 0.43, V(0, 0.15, 1).add(fdir.clone().multiplyScalar(0.3)));
    const legCol = spec.shorts || spec.skirt || spec.dress ? SKIN : BOTTOM;
    P.push({ t: 'cone', a: arr(hip), b: arr(knee), r1: 0.088 * w, r2: 0.056, c: spec.skirt || spec.dress ? SKIN : BOTTOM });
    if (spec.shorts) P.push({ t: 'cone', a: arr(hip), b: arr(hip.clone().lerp(knee, 0.55)), r1: 0.095 * w, r2: 0.075, c: BOTTOM, bias: 0.01 });
    P.push({ t: 'cone', a: arr(knee), b: arr(ank), r1: 0.053, r2: 0.037, c: legCol });
    // shoe: heel -> toe, sitting on the sole plane
    const hc = heel.clone().addScaledVector(fup, 0.042);
    const toe = hc.clone().addScaledVector(fdir, 0.2);
    P.push({ t: 'cone', a: arr(hc), b: arr(toe), r1: 0.044, r2: 0.04, c: SHOES, k: 0.02 });
  }

  // ---- skirt / dress
  if (spec.skirt || spec.dress) {
    const top = spec.dress ? T(0, 0.25, 0) : T(0, 0.08, 0);
    const kneeY = pelvis.y - 0.36;
    const hem = V(pelvis.x, kneeY, pelvis.z + 0.02);
    P.push({ t: 'cone', a: arr(top), b: arr(hem), r1: 0.15 * w, r2: spec.dress ? 0.24 : 0.2, c: spec.dress ? TOP : BOTTOM, k: 0.03, bias: 0.01 });
  }
  return P;
}

// Mesh a figure. `scale` uniformly scales the adult-unit model about the local origin, `matrix` places it.
export function meshFigure(spec, palette, opts = {}) {
  return drain(meshFigureSteps(spec, palette, opts));
}
// Step-generator version (see meshSDFSteps); returns the placed geometry.
export function* meshFigureSteps(spec, palette, { voxel = 0.028, scale = 1, matrix = null } = {}) {
  const prims = figurePrims(spec);
  const geo = yield* meshPrimsSteps(prims, {
    k: 0.028, voxel, palette,
    // subtle painted-sculpture shading: darken creases (downward-facing), lighten tops
    tweak: (x, y, z, nx, ny, nz, out) => { const f = 0.9 + 0.12 * ny; out[0] *= f; out[1] *= f; out[2] *= f; },
  });
  if (scale !== 1) geo.scale(scale, scale, scale);
  if (matrix) geo.applyMatrix4(matrix);
  return geo;
}

// Low-poly stand-in of the same posed figure (distance LOD; also shown until the sculpt is meshed).
// Returns one vertex-coloured geometry, already scaled and placed.
export function figureProxy(spec, palette, { scale = 1, matrix = null } = {}) {
  const m = new THREE.Matrix4().makeScale(scale, scale, scale);
  if (matrix) m.premultiply(matrix);
  const geo = primProxyGeometry(figurePrims(spec), palette, { minSize: 0.02, matrix: m });
  // same painted-sculpture shading as the sculpt (darker undersides)
  const n = geo.attributes.normal.array, c = geo.attributes.color.array;
  for (let i = 0; i < c.length; i += 3) { const f = 0.9 + 0.12 * n[i + 1]; c[i] *= f; c[i + 1] *= f; c[i + 2] *= f; }
  return geo;
}
