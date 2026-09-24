// Low-poly vehicle kit shared by parked cars (props.js) and traffic (life.js) (owner: life agent).
//
// Each vehicle type is ONE merged geometry with a per-vertex `aPart` id, rendered by one instanced material:
//   0 paint (per-instance colour) · 1 glass · 2 black trim/tyres · 3 chrome/rims · 4 headlight · 5 taillight
//   6 livery accent (bus gold) · 7 destination sign (amber LED)
// Local frame: +Z = forward, +Y = up, origin = ground contact centre. Units: metres.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function tag(g, part) {
  if (g.index) g = g.toNonIndexed();
  if (g.attributes.uv) g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  return g;
}

// Extrude a side profile given as [[z, y], ...] (CCW when z = right, y = up) across the car width.
function sideExtrude(profile, width, part, bevel = 0.05, arches = null) {
  const s = new THREE.Shape();
  s.moveTo(profile[0][0], profile[0][1]);
  for (let i = 1; i < profile.length; i++) {
    const p = profile[i];
    if (p === 'arch' && arches) { const a = arches.shift(); s.lineTo(a[0] - a[2], a[1]); s.absarc(a[0], a[1], a[2], Math.PI, 0, true); continue; }
    s.lineTo(p[0], p[1]);
  }
  const depth = Math.max(0.01, width - bevel * 2);
  let g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: 5 });
  // shape x → local +Z (forward), extrusion z → local X (width), centred
  const m = new THREE.Matrix4().set(0, 0, -1, depth / 2, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
  g.applyMatrix4(m);
  return tag(g, part);
}

function box(w, h, d, x, y, z, part, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return tag(g, part);
}

// Slanted pillar (paint) from (z0,y0) to (z1,y1) at lateral offset x
function strut(z0, y0, z1, y1, x, w = 0.08, t = 0.07) {
  const dz = z1 - z0, dy = y1 - y0, len = Math.hypot(dz, dy);
  const g = new THREE.BoxGeometry(w, t, len);
  g.rotateX(-Math.atan2(dy, dz));
  g.translate(x, (y0 + y1) / 2, (z0 + z1) / 2);
  return tag(g, 0);
}
const pillars = (a, b, x) => [strut(...a, x), strut(...a, -x), strut(...b, x), strut(...b, -x)];

function wheel(x, z, r, w) {
  const tyre = new THREE.CylinderGeometry(r, r, w, 10, 1);
  tyre.rotateZ(Math.PI / 2);
  tyre.translate(x, r, z);
  const rim = new THREE.CylinderGeometry(r * 0.58, r * 0.58, w + 0.02, 7, 1, true);
  rim.rotateZ(Math.PI / 2);
  rim.translate(x, r, z);
  return [tag(tyre, 2), tag(rim, 3)];
}

function finishGeo(parts) {
  const g = mergeGeometries(parts, false);
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ vehicle types
function sedan() {
  const W = 1.8;
  const body = sideExtrude([
    [-2.33, 0.3], [-1.83, 0.3], 'arch', [0.97, 0.3], 'arch', [2.32, 0.3],
    [2.4, 0.45], [2.38, 0.68], [2.2, 0.8], [1.05, 0.96], [0.85, 0.98], [-1.72, 1.0], [-2.26, 0.98], [-2.4, 0.8], [-2.4, 0.42],
  ], W, 0, 0.06, [[-1.4, 0.3, 0.42], [1.4, 0.3, 0.42]]);
  const cabin = sideExtrude([[0.86, 0.96], [0.05, 1.41], [-0.95, 1.43], [-1.72, 0.98]], W - 0.24, 1, 0.04);
  const roof = box(1.56, 0.05, 1.04, 0, 1.465, -0.45, 0);
  const parts = [body, cabin, roof, ...pillars([0.86, 0.98, 0.04, 1.45], [-1.72, 0.98, -0.94, 1.45], 0.79),
    box(0.08, 0.42, 0.14, 0.72, 1.18, -0.38, 0), box(0.08, 0.42, 0.14, -0.72, 1.18, -0.38, 0), // B pillars
    box(W - 0.1, 0.16, 0.12, 0, 0.44, 2.39, 2), box(W - 0.1, 0.16, 0.12, 0, 0.44, -2.39, 2), // bumpers
    box(0.42, 0.12, 0.06, 0.62, 0.7, 2.37, 4), box(0.42, 0.12, 0.06, -0.62, 0.7, 2.37, 4),
    box(0.4, 0.13, 0.06, 0.64, 0.8, -2.39, 5), box(0.4, 0.13, 0.06, -0.64, 0.8, -2.39, 5),
    box(0.62, 0.1, 0.04, 0, 0.62, 2.41, 3), // grille
  ];
  for (const z of [-1.4, 1.4]) for (const x of [-0.8, 0.8]) parts.push(...wheel(x, z, 0.33, 0.22));
  return finishGeo(parts);
}

function suv() {
  const W = 1.92;
  const body = sideExtrude([
    [-2.35, 0.38], [-1.9, 0.38], 'arch', [1.06, 0.38], 'arch', [2.33, 0.38],
    [2.42, 0.55], [2.4, 0.9], [2.2, 1.06], [1.15, 1.16], [0.95, 1.18], [-2.3, 1.2], [-2.42, 1.1], [-2.42, 0.5],
  ], W, 0, 0.07, [[-1.48, 0.38, 0.44], [1.48, 0.38, 0.44]]);
  const cabin = sideExtrude([[0.96, 1.16], [0.3, 1.74], [-2.2, 1.78], [-2.32, 1.2]], W - 0.22, 1, 0.05);
  const parts = [body, cabin, ...pillars([0.96, 1.16, 0.3, 1.8], [-2.34, 1.2, -2.22, 1.8], 0.86),
    box(1.68, 0.06, 2.55, 0, 1.815, -0.95, 0),
    box(0.08, 0.5, 0.16, 0.78, 1.47, -0.5, 0), box(0.08, 0.5, 0.16, -0.78, 1.47, -0.5, 0),
    box(0.08, 0.5, 0.2, 0.78, 1.47, -2.2, 0), box(0.08, 0.5, 0.2, -0.78, 1.47, -2.2, 0),
    box(W - 0.08, 0.22, 0.14, 0, 0.52, 2.41, 2), box(W - 0.08, 0.22, 0.14, 0, 0.52, -2.41, 2),
    box(0.44, 0.14, 0.06, 0.66, 0.92, 2.4, 4), box(0.44, 0.14, 0.06, -0.66, 0.92, 2.4, 4),
    box(0.22, 0.3, 0.06, 0.8, 1.02, -2.43, 5), box(0.22, 0.3, 0.06, -0.8, 1.02, -2.43, 5),
    box(0.8, 0.22, 0.04, 0, 0.78, 2.42, 3),
  ];
  for (const z of [-1.48, 1.48]) for (const x of [-0.84, 0.84]) parts.push(...wheel(x, z, 0.37, 0.26));
  return finishGeo(parts);
}

function pickup() {
  const W = 2.0;
  const body = sideExtrude([
    [-2.8, 0.45], [-2.35, 0.45], 'arch', [1.45, 0.45], 'arch', [2.75, 0.45],
    [2.85, 0.62], [2.83, 1.0], [2.6, 1.14], [1.45, 1.22], [1.25, 1.24], [-0.4, 1.24], [-0.4, 1.12], [-2.8, 1.12],
  ], W, 0, 0.06, [[-1.9, 0.45, 0.46], [1.9, 0.45, 0.46]]);
  const cabin = sideExtrude([[1.26, 1.22], [0.6, 1.86], [-0.3, 1.88], [-0.4, 1.24]], W - 0.2, 1, 0.05);
  const parts = [body, cabin, box(1.82, 0.06, 0.95, 0, 1.915, 0.15, 0), ...pillars([1.27, 1.22, 0.6, 1.92], [-0.41, 1.24, -0.31, 1.92], 0.9),
    box(0.12, 0.42, 2.3, 0.94, 1.33, -1.62, 0), box(0.12, 0.42, 2.3, -0.94, 1.33, -1.62, 0), box(W, 0.42, 0.12, 0, 1.33, -2.76, 0), // bed walls
    box(W - 0.24, 0.04, 2.3, 0, 1.13, -1.62, 2), // bed floor
    box(W, 0.24, 0.16, 0, 0.6, 2.84, 3), box(W, 0.22, 0.14, 0, 0.62, -2.84, 3),
    box(0.46, 0.16, 0.06, 0.7, 1.0, 2.84, 4), box(0.46, 0.16, 0.06, -0.7, 1.0, 2.84, 4),
    box(0.2, 0.34, 0.06, 0.88, 1.2, -2.84, 5), box(0.2, 0.34, 0.06, -0.88, 1.2, -2.84, 5),
    box(1.0, 0.3, 0.04, 0, 0.82, 2.86, 3),
  ];
  for (const z of [-1.9, 1.9]) for (const x of [-0.88, 0.88]) parts.push(...wheel(x, z, 0.4, 0.28));
  return finishGeo(parts);
}

// Pittsburgh Regional Transit (ex Port Authority) 40-ft bus: steel blue with a gold accent band.
function bus() {
  const W = 2.55, L = 12.2, H = 3.15;
  const body = sideExtrude([
    [-L / 2, 0.42], [-4.4, 0.42], 'arch', [3.1, 0.42], 'arch', [L / 2 - 0.1, 0.42],
    [L / 2, 0.6], [L / 2, H - 0.25], [L / 2 - 0.25, H], [-L / 2 + 0.2, H], [-L / 2, H - 0.2], [-L / 2, 0.6],
  ], W, 0, 0.08, [[-3.6, 0.42, 0.62], [3.9, 0.42, 0.62]]);
  const parts = [body,
    // side window band + windscreen + rear window
    box(W + 0.02, 1.05, L - 2.2, 0, 1.95, -0.6, 1),
    box(W - 0.2, 1.55, 0.06, 0, 1.75, L / 2 + 0.06, 1),
    box(W - 0.4, 0.7, 0.06, 0, 2.2, -L / 2 - 0.06, 1),
    // gold accent band under the windows, black skirt
    box(W + 0.03, 0.16, L - 0.4, 0, 1.33, 0, 6),
    box(W + 0.02, 0.28, L - 0.2, 0, 0.56, 0, 2),
    // destination sign, lights, bumpers
    box(1.9, 0.26, 0.05, 0, H - 0.42, L / 2 + 0.08, 7),
    box(0.3, 0.2, 0.06, 0.95, 0.85, L / 2 + 0.04, 4), box(0.3, 0.2, 0.06, -0.95, 0.85, L / 2 + 0.04, 4),
    box(0.25, 0.45, 0.06, 1.02, 1.05, -L / 2 - 0.04, 5), box(0.25, 0.45, 0.06, -1.02, 1.05, -L / 2 - 0.04, 5),
    box(W, 0.3, 0.2, 0, 0.5, L / 2 + 0.05, 2), box(W, 0.3, 0.2, 0, 0.5, -L / 2 - 0.05, 2),
    box(1.9, 0.5, 0.2, 0, H + 0.2, -2.5, 3), // roof AC pod
  ];
  for (const z of [-3.6, 3.9]) for (const x of [-1.05, 1.05]) parts.push(...wheel(x, z, 0.5, 0.32));
  return finishGeo(parts);
}

// Far LOD (~60 triangles): body + greenhouse boxes + wheel blocks, same part ids / material.
function lowPoly(type) {
  const d = { sedan: [4.75, 1.8, 0.98, 1.43, 0.85, -1.72], suv: [4.8, 1.92, 1.18, 1.8, 0.96, -2.32], pickup: [5.65, 2.0, 1.22, 1.9, 1.26, -0.4] }[type];
  const [L, W, belt, roof, zf, zr] = d;
  const parts = [box(W, belt - 0.3, L, 0, (belt + 0.3) / 2, 0, 0)];
  const cz = (zf + zr) / 2, cl = zf - zr;
  parts.push(box(W - 0.12, roof - belt, cl * 0.9, 0, (roof + belt) / 2, cz, 1));
  parts.push(box(W - 0.2, 0.05, cl * 0.62, 0, roof + 0.01, cz - cl * 0.08, 0));
  const wz = L * 0.3, r = type === 'sedan' ? 0.33 : 0.38;
  for (const z of [-wz, wz]) parts.push(box(W + 0.02, r * 1.6, r * 1.8, 0, r * 0.85, z, 2));
  parts.push(box(W - 0.3, 0.12, 0.05, 0, belt - 0.25, L / 2 + 0.01, 4), box(W - 0.3, 0.12, 0.05, 0, belt - 0.2, -L / 2 - 0.01, 5));
  return finishGeo(parts);
}
let lowCache = null;
export function getLowCarGeometries() {
  if (!lowCache) lowCache = { sedan: lowPoly('sedan'), suv: lowPoly('suv'), pickup: lowPoly('pickup') };
  return lowCache;
}

export const CAR_DIMS = {
  sedan: { length: 4.8, width: 1.85 },
  suv: { length: 4.9, width: 1.95 },
  pickup: { length: 5.7, width: 2.0 },
  bus: { length: 12.3, width: 2.6 },
};

// Realistic US car colour distribution (white, black, grey, silver dominate)
const PAINTS = [
  ['#e9e9e6', 22], ['#16181b', 19], ['#6d7075', 16], ['#b9bcc0', 12], ['#8e1f1c', 8], ['#1f3b6b', 8],
  ['#3a4a5a', 4], ['#7a6a55', 3], ['#2f4a33', 2], ['#c9a227', 1], ['#d45a1c', 1], ['#5a1f33', 2], ['#4b8fc1', 2],
];
const PAINT_TOTAL = PAINTS.reduce((s, p) => s + p[1], 0);
const _pc = new THREE.Color();
export function randomPaint(r, out, o) {
  let x = r * PAINT_TOTAL;
  let hex = PAINTS[0][0];
  for (const [h, w] of PAINTS) { x -= w; if (x <= 0) { hex = h; break; } }
  _pc.set(hex);
  out[o] = _pc.r; out[o + 1] = _pc.g; out[o + 2] = _pc.b;
}

let geoCache = null;
export function getCarGeometries() {
  if (!geoCache) geoCache = { sedan: sedan(), suv: suv(), pickup: pickup(), bus: bus() };
  return geoCache;
}

// Instanced vehicle material. uniforms.uHead / uTail / uSign (0..1) drive the emissive lamps.
export function createCarMaterial({ lights = true } = {}) {
  const uniforms = {
    uHead: { value: 0 }, uTail: { value: 0 }, uSign: { value: lights ? 1 : 0 },
    uAccent: { value: new THREE.Color('#e0a526') },
  };
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.2, envMapIntensity: 1.0 });
  mat.name = lights ? 'vehicles' : 'parkedVehicles';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aPart; attribute vec3 iColor; varying float vPart; varying vec3 vPaint; varying float vBrake;
        attribute float iBrake;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vPart = aPart; vPaint = iColor; vBrake = iBrake;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uHead; uniform float uTail; uniform float uSign; uniform vec3 uAccent;
        varying float vPart; varying vec3 vPaint; varying float vBrake;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pp = floor(vPart + 0.5);
        vec3 pc = vPaint;
        if (pp == 1.0) pc = vec3(0.025, 0.03, 0.035);
        else if (pp == 2.0) pc = vec3(0.018);
        else if (pp == 3.0) pc = vec3(0.5, 0.51, 0.53);
        else if (pp == 4.0) pc = vec3(0.85, 0.85, 0.8);
        else if (pp == 5.0) pc = vec3(0.35, 0.015, 0.015);
        else if (pp == 6.0) pc = uAccent;
        else if (pp == 7.0) pc = vec3(0.05, 0.04, 0.02);
        diffuseColor.rgb = pc;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = pp == 1.0 ? 0.05 : pp == 2.0 ? 0.85 : pp == 3.0 ? 0.3 : pp < 0.5 ? 0.32 : 0.4;`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = pp == 1.0 ? 0.6 : pp == 3.0 ? 0.9 : pp < 0.5 ? 0.35 : 0.0;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (pp == 4.0) totalEmissiveRadiance += vec3(1.0, 0.93, 0.8) * uHead * 4.0;
        else if (pp == 5.0) totalEmissiveRadiance += vec3(1.0, 0.05, 0.03) * (uTail * 1.6 + vBrake * 3.0);
        else if (pp == 7.0) totalEmissiveRadiance += vec3(1.0, 0.62, 0.1) * uSign * 1.4;`);
  };
  mat.customProgramCacheKey = () => 'cmu-vehicle-v1';
  return { material: mat, uniforms };
}

// Creates an InstancedMesh for a vehicle type with the per-instance attributes the material needs.
export function createVehicleMesh(type, material, capacity, low = false) {
  const geo = (low ? getLowCarGeometries() : getCarGeometries())[type].clone();
  geo.setAttribute('iColor', new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3));
  geo.setAttribute('iBrake', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
  const mesh = new THREE.InstancedMesh(geo, material, capacity);
  mesh.name = `vehicles:${type}${low ? ':low' : ''}`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
