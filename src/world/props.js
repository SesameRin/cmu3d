// Street furniture & parked cars (owner: life agent). Contract: ARCHITECTURE.md §props.
//
// Everything is instanced. Most props share ONE vertex-coloured material (one draw call per prop type):
//   benches (OSM benches, facing the nearest path), CMU black globe lamps along campus walks, taller
//   street lamps along streets, waste/recycling bins, bike racks with parked bikes, bollards, fire hydrants,
//   bus shelters on Forbes & Fifth, USPS mail boxes, picnic tables, park pavilions, a flagpole with a waving
//   US flag near Warner Hall, and parked cars (stall-aligned rows in lots + parallel parking on residential streets).
// Night: lamp globes/lenses use an emissive night material (driven by materials.registerNightMaterial) and each
// lamp gets a cheap additive "light pool" decal on the ground that fades in with env.state.nightFactor.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { footprintFrame } from '../core/placement.js';
import { getLandMask, M, mulberry32, samplePolyline, composeMatrix, pointInRing, createCuller, createCameraWatch, animTime, glslRad } from './graph.js';
import { createCarMaterial, createVehicleMesh, randomPaint } from './cars.js';

// ------------------------------------------------------------------ vertex-coloured geometry helpers
const _col = new THREE.Color();
function vc(g, hex) {
  if (g.index) g = g.toNonIndexed();
  if (g.attributes.uv) g.deleteAttribute('uv');
  _col.set(hex);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = _col.r; c[i * 3 + 1] = _col.g; c[i * 3 + 2] = _col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}
const _e = new THREE.Euler(), _mm = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);
function place(g, x, y, z, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz);
  _mm.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s);
  g.applyMatrix4(_mm);
  return g;
}
const B = (w, h, d, x, y, z, hex, rx = 0, ry = 0, rz = 0) => place(vc(new THREE.BoxGeometry(w, h, d), hex), x, y, z, rx, ry, rz);
const Cy = (rt, rb, h, x, y, z, hex, seg = 8, rx = 0, ry = 0, rz = 0) => place(vc(new THREE.CylinderGeometry(rt, rb, h, seg), hex), x, y, z, rx, ry, rz);
const Sp = (r, x, y, z, hex, w = 8, h = 6) => place(vc(new THREE.SphereGeometry(r, w, h), hex), x, y, z);
// Cylinder between two points
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function Rod(x0, y0, z0, x1, y1, z1, r, hex, seg = 6) {
  _a.set(x0, y0, z0); _b.set(x1, y1, z1); _d.subVectors(_b, _a);
  const len = _d.length();
  const g = vc(new THREE.CylinderGeometry(r, r, len, seg, 1), hex);
  _q.setFromUnitVectors(_up, _d.normalize());
  _mm.compose(_p.addVectors(_a, _b).multiplyScalar(0.5), _q, _s);
  return g.applyMatrix4(_mm);
}
function mergeAll(parts) {
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------ prop models (local: +Z = front, y = 0 ground)
const IRON = '#1c1e20', WOOD = '#8a5b38', GALV = '#9aa0a5', GREY = '#3a3f44';
function benchGeo() {
  const p = [];
  for (let i = 0; i < 4; i++) p.push(B(1.8, 0.035, 0.09, 0, 0.45, -0.17 + i * 0.11, WOOD));
  for (let i = 0; i < 3; i++) p.push(B(1.8, 0.085, 0.03, 0, 0.6 + i * 0.12, -0.27 - i * 0.03, WOOD, -0.25));
  for (const x of [-0.8, 0.8]) {
    p.push(B(0.05, 0.45, 0.05, x, 0.225, 0.18, IRON));                 // front leg
    p.push(B(0.05, 0.92, 0.05, x, 0.46, -0.26, IRON, -0.18));          // rear leg + back support
    p.push(B(0.05, 0.04, 0.5, x, 0.46, -0.02, IRON));                  // seat rail
    p.push(B(0.05, 0.035, 0.42, x, 0.66, 0.0, IRON));                  // armrest
    p.push(B(0.04, 0.2, 0.04, x, 0.56, 0.17, IRON));
  }
  return mergeAll(p);
}
function campusLampGeo() {
  return mergeAll([
    Cy(0.15, 0.19, 0.55, 0, 0.275, 0, IRON, 10),
    Cy(0.11, 0.14, 0.12, 0, 0.6, 0, IRON, 10),
    Cy(0.055, 0.07, 3.3, 0, 2.3, 0, IRON, 8),
    Cy(0.11, 0.06, 0.16, 0, 3.98, 0, IRON, 10),
    Cy(0.13, 0.13, 0.05, 0, 4.07, 0, IRON, 10),
    Cy(0.02, 0.1, 0.12, 0, 4.78, 0, IRON, 8), // cap on the globe
    Sp(0.035, 0, 4.86, 0, IRON, 6, 4),
  ]);
}
function campusGlobeGeo() {
  // acorn-shaped globe
  const pts = [];
  const prof = [[0.001, 4.1], [0.12, 4.11], [0.2, 4.2], [0.245, 4.36], [0.235, 4.52], [0.19, 4.64], [0.1, 4.73], [0.001, 4.75]];
  for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
  const g = new THREE.LatheGeometry(pts, 14);
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g.index ? g.toNonIndexed() : g;
}
function streetLampGeo() {
  return mergeAll([
    Cy(0.2, 0.24, 0.5, 0, 0.25, 0, GREY, 8),
    Cy(0.075, 0.12, 8.2, 0, 4.5, 0, GREY, 8),
    Rod(0, 8.4, 0, 0, 8.9, 0.6, 0.055, GREY),
    Rod(0, 8.9, 0.6, 0, 9.0, 1.9, 0.05, GREY),
    B(0.36, 0.16, 0.72, 0, 8.98, 2.2, GREY),
  ]);
}
function streetLensGeo() {
  const g = new THREE.BoxGeometry(0.28, 0.04, 0.56);
  g.translate(0, 8.88, 2.2);
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g.toNonIndexed();
}
function binGeo(hex) {
  return mergeAll([
    Cy(0.29, 0.26, 0.9, 0, 0.45, 0, hex, 12),
    Cy(0.31, 0.31, 0.06, 0, 0.92, 0, hex, 12),
    Cy(0.2, 0.3, 0.12, 0, 1.0, 0, hex, 12),
    Cy(0.12, 0.12, 0.03, 0, 1.07, 0, '#111', 10),
  ]);
}
function bikeRackGeo(n = 5) {
  const p = [];
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.9;
    p.push(Rod(x, 0, -0.32, x, 0.72, -0.32, 0.03, GALV), Rod(x, 0, 0.32, x, 0.72, 0.32, 0.03, GALV));
    p.push(Rod(x, 0.72, -0.32, x, 0.86, -0.2, 0.03, GALV), Rod(x, 0.86, -0.2, x, 0.86, 0.2, 0.03, GALV), Rod(x, 0.86, 0.2, x, 0.72, 0.32, 0.03, GALV));
  }
  return mergeAll(p);
}
// Bicycle: white vertex colour on the frame (tinted per instance), black tyres / saddle
function bikeGeo() {
  const T = '#151515', F = '#ffffff';
  const p = [];
  for (const z of [-0.52, 0.52]) {
    const t = vc(new THREE.TorusGeometry(0.33, 0.022, 5, 18), T);
    t.rotateY(Math.PI / 2); t.translate(0, 0.35, z);
    p.push(t);
    p.push(Cy(0.03, 0.03, 0.06, 0, 0.35, z, '#888', 6, 0, 0, Math.PI / 2));
  }
  const bb = [0, 0.3, -0.02], seat = [0, 0.86, -0.2], head = [0, 0.86, 0.36];
  p.push(Rod(...bb, ...seat, 0.018, F), Rod(...bb, ...head, 0.02, F), Rod(...seat, ...head, 0.017, F));
  p.push(Rod(...bb, 0, 0.35, -0.52, 0.014, F), Rod(...seat, 0, 0.35, -0.52, 0.013, F));
  p.push(Rod(...head, 0, 0.35, 0.52, 0.016, F), Rod(0, 0.86, 0.36, 0, 1.0, 0.33, 0.016, F));
  p.push(Rod(-0.24, 1.0, 0.33, 0.24, 1.0, 0.33, 0.014, T));
  p.push(B(0.1, 0.04, 0.24, 0, 0.9, -0.22, T));
  return mergeAll(p);
}
// Low LODs (beyond ~60 m): a handful of boxes / low-segment cylinders with the same silhouette & colours
function bikeRackLowGeo(n = 5) {
  const p = [];
  for (let i = 0; i < n; i++) p.push(B(0.06, 0.8, 0.66, (i - (n - 1) / 2) * 0.9, 0.43, 0, GALV));
  return mergeAll(p);
}
function bikeLowGeo() {
  const T = '#151515', F = '#ffffff';
  const p = [];
  for (const z of [-0.52, 0.52]) p.push(Cy(0.34, 0.34, 0.05, 0, 0.35, z, T, 7, 0, 0, Math.PI / 2));
  p.push(B(0.05, 0.05, 1.0, 0, 0.62, 0, F, -0.25), B(0.05, 0.5, 0.05, 0, 0.62, -0.18, F), B(0.5, 0.04, 0.05, 0, 1.0, 0.33, T));
  return mergeAll(p);
}
function hydrantLowGeo() {
  return mergeAll([Cy(0.13, 0.15, 0.66, 0, 0.33, 0, '#d8a21c', 6), Cy(0.07, 0.12, 0.16, 0, 0.72, 0, '#b8261e', 6), B(0.4, 0.1, 0.1, 0, 0.42, 0, '#d8a21c')]);
}
function bollardGeo() {
  return mergeAll([Cy(0.1, 0.11, 0.9, 0, 0.45, 0, '#232527', 10), Sp(0.1, 0, 0.9, 0, '#232527', 10, 5), Cy(0.108, 0.108, 0.06, 0, 0.75, 0, '#c9c9c0', 10)]);
}
function hydrantGeo() {
  const Y = '#d8a21c', R = '#b8261e';
  return mergeAll([
    Cy(0.16, 0.16, 0.08, 0, 0.04, 0, Y, 10),
    Cy(0.12, 0.13, 0.55, 0, 0.33, 0, Y, 10),
    Cy(0.14, 0.14, 0.05, 0, 0.62, 0, Y, 10),
    Sp(0.12, 0, 0.66, 0, R, 10, 6),
    Cy(0.03, 0.03, 0.08, 0, 0.8, 0, R, 6),
    Cy(0.055, 0.055, 0.12, 0.15, 0.42, 0, Y, 8, 0, 0, Math.PI / 2),
    Cy(0.055, 0.055, 0.12, -0.15, 0.42, 0, Y, 8, 0, 0, Math.PI / 2),
    Cy(0.07, 0.07, 0.1, 0, 0.42, 0.15, Y, 8, Math.PI / 2),
  ]);
}
function shelterFrameGeo() {
  const p = [];
  for (const x of [-1.8, 1.8]) for (const z of [-0.7, 0.7]) p.push(B(0.08, 2.45, 0.08, x, 1.225, z, GREY));
  p.push(B(4.0, 0.12, 1.9, 0, 2.5, 0, '#2c3034'));
  p.push(B(4.0, 0.05, 0.08, 0, 2.3, -0.72, GREY), B(4.0, 0.05, 0.08, 0, 0.12, -0.72, GREY));
  p.push(B(2.6, 0.05, 0.36, 0, 0.46, -0.45, '#6a6f74'));                       // bench
  for (const x of [-1.1, 1.1]) p.push(B(0.05, 0.44, 0.3, x, 0.23, -0.45, GREY));
  p.push(B(0.12, 1.8, 1.25, 1.85, 1.2, 0.05, '#25282b'));                      // ad box frame
  p.push(B(0.35, 0.35, 0.05, -1.5, 2.25, 0.8, '#1d4f91'));                     // route sign
  return mergeAll(p);
}
function shelterGlassGeo() {
  const g = mergeGeometries([
    place(new THREE.PlaneGeometry(3.5, 2.05), 0, 1.22, -0.72),
    place(new THREE.PlaneGeometry(1.35, 2.05), -1.8, 1.22, 0, 0, Math.PI / 2),
  ].map((q) => { q.deleteAttribute('uv'); return q; }));
  return g;
}
function shelterAdGeo() {
  const g = new THREE.BoxGeometry(0.14, 1.55, 1.05);
  g.translate(1.85, 1.2, 0.05);
  g.deleteAttribute('uv');
  return g.toNonIndexed();
}
function mailboxGeo() {
  const Bl = '#1f4e9c';
  const top = vc(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 12, 1, false, 0, Math.PI), Bl);
  top.rotateZ(Math.PI / 2); top.rotateY(Math.PI / 2); top.translate(0, 1.05, 0);
  return mergeAll([B(0.5, 0.72, 0.5, 0, 0.72, 0, Bl), top, B(0.06, 0.36, 0.06, -0.2, 0.18, -0.2, '#222'), B(0.06, 0.36, 0.06, 0.2, 0.18, -0.2, '#222'),
    B(0.06, 0.36, 0.06, -0.2, 0.18, 0.2, '#222'), B(0.06, 0.36, 0.06, 0.2, 0.18, 0.2, '#222'), B(0.3, 0.05, 0.02, 0, 0.98, 0.26, '#d9d9d9')]);
}
function picnicGeo() {
  const W = '#7d5436', S = '#2b2d2f';
  const p = [];
  for (let i = 0; i < 4; i++) p.push(B(1.9, 0.04, 0.17, 0, 0.76, -0.27 + i * 0.18, W));
  for (const z of [-0.68, 0.68]) p.push(B(1.9, 0.04, 0.26, 0, 0.45, z, W));
  for (const x of [-0.7, 0.7]) {
    p.push(Rod(x, 0, -0.75, x, 0.76, 0.1, 0.03, S), Rod(x, 0, 0.75, x, 0.76, -0.1, 0.03, S));
    p.push(B(0.05, 0.05, 1.6, x, 0.42, 0, S));
  }
  return mergeAll(p);
}
function pavilionGeo() {
  const p = [];
  for (const x of [-2.7, 2.7]) for (const z of [-1.8, 0, 1.8]) p.push(B(0.22, 2.8, 0.22, x, 1.4, z, '#6b4a33'));
  p.push(B(6.0, 0.25, 4.3, 0, 2.9, 0, '#5a3d29'));
  const roof = vc(new THREE.ConeGeometry(4.6, 1.9, 4, 1), '#4a5a3f');
  roof.rotateY(Math.PI / 4); roof.scale(1.1, 1, 0.78); roof.translate(0, 3.95, 0);
  p.push(roof);
  for (const x of [-1.2, 1.2]) p.push(B(1.9, 0.05, 0.9, x, 0.76, 0, '#7d5436'), B(1.9, 0.05, 0.3, x, 0.45, -0.7, '#7d5436'), B(1.9, 0.05, 0.3, x, 0.45, 0.7, '#7d5436'));
  return mergeAll(p);
}
function flagpoleGeo() {
  return mergeAll([
    B(1.4, 0.35, 1.4, 0, 0.1, 0, '#bdb8ad'),
    Cy(0.1, 0.13, 0.5, 0, 0.5, 0, '#d0d0cc', 10),
    Cy(0.045, 0.085, 13.2, 0, 6.85, 0, '#e4e4e0', 10),
    Sp(0.11, 0, 13.55, 0, '#c9a04a', 10, 8),
  ]);
}

// US flag painted on a canvas (13 stripes, 50 stars)
function usFlagTexture() {
  const W = 494, H = 260;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const sh = H / 13;
  for (let i = 0; i < 13; i++) { g.fillStyle = i % 2 ? '#f4f1ea' : '#b22234'; g.fillRect(0, i * sh, W, Math.ceil(sh)); }
  const cw = W * 0.4, ch = sh * 7;
  g.fillStyle = '#3c3b6e'; g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#ffffff';
  const star = (cx, cy, r) => {
    g.beginPath();
    for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k % 2 ? r * 0.4 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.closePath(); g.fill();
  };
  for (let row = 0; row < 9; row++) {
    const cols = row % 2 ? 5 : 6;
    for (let col = 0; col < cols; col++) star(cw / 12 * (col * 2 + (row % 2 ? 2 : 1)), ch / 10 * (row + 1), sh * 0.3);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Soft light-pool textures (greyscale in the red channel), painted per pixel.
//   'round'   : lamp pool, smooth inverse-square-ish falloff to zero at the edge
//   'beam'    : car headlight cone (car at v = 0, beam widening and fading towards v = 1)
function poolTexture(kind = 'round') {
  const W = kind === 'beam' ? 64 : 128, H = 128;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = (i + 0.5) / W - 0.5, v = (j + 0.5) / H;
    let a;
    if (kind === 'beam') {
      const hw = 0.12 + v * 0.38;
      const across = Math.max(0, 1 - Math.abs(u) / hw);
      a = Math.pow(1 - v, 1.4) * across * across * Math.min(1, v * 8);
    } else {
      const r = Math.hypot(u, v - 0.5) * 2;
      a = r >= 1 ? 0 : Math.pow(1 - r * r, 2.2) / (1 + r * r * 14);
    }
    const k = (j * W + i) * 4, b = Math.round(Math.min(1, a) * 255);
    img.data[k] = img.data[k + 1] = img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

// Additive ground decal material that fades with night factor and distance (fog-safe). Seen at a grazing angle a
// real light pool is barely visible, so the decal fades out there (no long bright streaks along the ground).
export function createLightPoolMaterial(color = '#ffc98a', kind = 'round') {
  const uniforms = { uMap: { value: poolTexture(kind) }, uColor: { value: new THREE.Color(color) }, uIntensity: { value: 0 }, uFar: { value: 900 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      varying vec2 vUv; varying float vDist; varying vec3 vToCam;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vToCam = cameraPosition - wp.xyz;
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uColor; uniform float uIntensity; uniform float uFar;
      varying vec2 vUv; varying float vDist; varying vec3 vToCam;
      void main() {
        float graze = smoothstep(0.08, 0.35, abs(normalize(vToCam).y));
        float a = texture2D(uMap, vUv).r * uIntensity * graze * (1.0 - smoothstep(uFar * 0.5, uFar, vDist));
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
  });
  return { material: mat, uniforms };
}

// ------------------------------------------------------------------ path segment index (nearest path queries)
function segmentIndex(lines, cell = 12) {
  const grid = new Map();
  const key = (i, j) => i * 73856 + j;
  lines.forEach((pts, li) => {
    for (let s = 1; s < pts.length; s++) {
      const x0 = Math.min(pts[s - 1][0], pts[s][0]), x1 = Math.max(pts[s - 1][0], pts[s][0]);
      const z0 = Math.min(pts[s - 1][1], pts[s][1]), z1 = Math.max(pts[s - 1][1], pts[s][1]);
      for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) {
        const k = key(i, j); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(li, s);
      }
    }
  });
  // nearest point on any segment within maxR → {x, z, dx, dz, d, line} | null
  function nearest(x, z, maxR = 15) {
    let best = null, bd = maxR;
    const R = Math.ceil(maxR / cell);
    const ci = Math.floor(x / cell), cj = Math.floor(z / cell);
    for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) {
      const a = grid.get(key(ci + di, cj + dj)); if (!a) continue;
      for (let q = 0; q < a.length; q += 2) {
        const pts = lines[a[q]], s = a[q + 1];
        const ax = pts[s - 1][0], az = pts[s - 1][1], ex = pts[s][0] - ax, ez = pts[s][1] - az;
        const l2 = ex * ex + ez * ez || 1e-9;
        let t = ((x - ax) * ex + (z - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = ax + ex * t, pz = az + ez * t, d = Math.hypot(x - px, z - pz);
        if (d < bd) { const l = Math.sqrt(l2); bd = d; best = { x: px, z: pz, dx: ex / l, dz: ez / l, d, line: a[q] }; }
      }
    }
    return best;
  }
  return { nearest };
}

// Simple spatial occupancy for spacing props apart
function spacing(cell = 6) {
  const g = new Map();
  const key = (i, j) => i * 73856 + j;
  return {
    near(x, z, r) {
      const R = Math.ceil(r / cell), ci = Math.floor(x / cell), cj = Math.floor(z / cell);
      for (let di = -R; di <= R; di++) for (let dj = -R; dj <= R; dj++) {
        const a = g.get(key(ci + di, cj + dj)); if (!a) continue;
        for (let q = 0; q < a.length; q += 2) if ((a[q] - x) ** 2 + (a[q + 1] - z) ** 2 < r * r) return true;
      }
      return false;
    },
    add(x, z) { const k = key(Math.floor(x / cell), Math.floor(z / cell)); let a = g.get(k); if (!a) g.set(k, a = []); a.push(x, z); },
  };
}

// ------------------------------------------------------------------ main
export async function createProps(ctx) {
  const t0 = performance.now();
  const data = ctx.data;
  const q = ctx.quality || {};
  const mask = getLandMask(ctx);
  const rng = mulberry32(0x5eed77);
  const group = new THREE.Group();
  group.name = 'props';
  const propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.2, envMapIntensity: 0.7 });
  propMat.name = 'props';
  let shadows = !!q.shadows;
  const H = (x, z) => ctx.heightAt(x, z);
  const counts = {};
  const bnd = data.meta.bounds;
  // strictly inside the data bounds (the terrain skirt beyond is unpainted and uses a different height function)
  const inB = (x, z, m = 3) => x > bnd.minX + m && x < bnd.maxX - m && z > bnd.minZ + m && z < bnd.maxZ - m;

  // ---- camera-culled instancing. Every prop type keeps its instances in a master list; on camera moves only the
  // instances in view (within a draw distance R) are packed into the drawn meshes. Shadows: only instances within
  // CAST_R (in view, or inside the sun's shadow box) go into a shadow-casting mesh; the rest never cast.
  const lvl = q.level || 'high';
  const PROP_R = lvl === 'low' ? 180 : lvl === 'medium' ? 260 : 320;
  const TILE = 64;
  const TX0 = Math.floor((bnd.minX - 20) / TILE), TZ0 = Math.floor((bnd.minZ - 20) / TILE);
  const NTX = Math.floor((bnd.maxX + 20) / TILE) - TX0 + 1, NTZ = Math.floor((bnd.maxZ + 20) / TILE) - TZ0 + 1, NT = NTX * NTZ;
  const tileOf = (x, z) => Math.min(NTZ - 1, Math.max(0, Math.floor(z / TILE) - TZ0)) * NTX + Math.min(NTX - 1, Math.max(0, Math.floor(x / TILE) - TX0));
  const CAST_R = 100;
  const sets = [];
  // list: [{x, y, z, yaw, s?, sy?, nx?, ny?, nz?}]; makeMesh(tier 'c' cast | 'n' near | 'l' low LOD, capacity)
  function culledSet(name, list, makeMesh, { cast = true, R = PROP_R, lowD = Infinity, hasLow = false, radius = 1, cy = 0.5, attrs = [] } = {}) {
    const keep = [];
    list.forEach((it, i) => { if (inB(it.x, it.z, 2)) keep.push(i); });
    counts[name] = keep.length;
    if (!keep.length) return null;
    const n = keep.length;
    // instances are stored tile by tile (64 m) so a partition only visits the tiles within the draw distance
    const tileK = new Int32Array(list.length);
    for (const li of keep) tileK[li] = tileOf(list[li].x, list[li].z);
    keep.sort((u, v) => tileK[u] - tileK[v] || u - v);
    const S = {
      name, n, R, R2: R * R, lowD2: lowD * lowD, cast, radius,
      xs: new Float32Array(n), ys: new Float32Array(n), zs: new Float32Array(n), mats: new Float32Array(n * 16),
      attrs: attrs.map((a) => ({ name: a.name, size: a.size, src: new Float32Array(n * a.size) })),
      ts: new Int32Array(NT + 1),
      tiers: {},
    };
    keep.forEach((li, i) => {
      const it = list[li];
      composeMatrix(S.mats, i * 16, it.x, it.y, it.z, it.yaw || 0, it.s || 1, it.sy || it.s || 1, it.s || 1, it.nx ?? 0, it.ny ?? 1, it.nz ?? 0);
      S.xs[i] = it.x; S.ys[i] = it.y + cy * (it.sy || it.s || 1); S.zs[i] = it.z;
      attrs.forEach((a, k) => { for (let j = 0; j < a.size; j++) S.attrs[k].src[i * a.size + j] = a.src[li * a.size + j]; });
      S.ts[tileK[li] + 1]++;
    });
    for (let t = 0; t < NT; t++) S.ts[t + 1] += S.ts[t];
    for (const t of ['c', 'n', ...(hasLow ? ['l'] : [])]) {
      if (t === 'c' && !cast) continue;
      const m = makeMesh(t, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.visible = false;
      m.frustumCulled = false;
      m.castShadow = t === 'c' && shadows;
      m.receiveShadow = true;
      m.name = m.name || `props:${name}${t === 'l' ? ':low' : ''}`;
      group.add(m);
      S.tiers[t] = m;
    }
    sets.push(S);
    return S.tiers.n;
  }
  function instanced(name, geo, mat, list, { cast = true, low = null, lowD = 60, R = PROP_R, colors = null } = {}) {
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const bs = geo.boundingSphere;
    return culledSet(name, list, (t, cap) => {
      const m = new THREE.InstancedMesh(t === 'l' ? low : geo, mat, cap);
      if (colors) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
      return m;
    }, { cast, R, lowD: low ? lowD : Infinity, hasLow: !!low, radius: bs.radius, cy: bs.center.y, attrs: colors ? [{ name: 'instanceColor', size: 3, src: colors }] : [] });
  }
  // static (never culled) instanced mesh, e.g. the night light-pool decals
  function staticInstanced(name, geo, mat, list, { cast = false, receive = false } = {}) {
    list = list.filter((it) => inB(it.x, it.z, 2));
    counts[name] = list.length;
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    const arr = m.instanceMatrix.array;
    list.forEach((it, i) => composeMatrix(arr, i * 16, it.x, it.y, it.z, it.yaw || 0, it.s || 1, it.sy || it.s || 1, it.s || 1, it.nx ?? 0, it.ny ?? 1, it.nz ?? 0));
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = cast; m.receiveShadow = receive;
    m.name = `props:${name}`;
    m.computeBoundingSphere();
    group.add(m);
    return m;
  }
  const cull = createCuller();
  const watch = createCameraWatch(10, 12);
  const MOVE = 11;
  function partitionSets() {
    const cam = ctx.camera;
    const sun = ctx.env?.sun;
    const shOn = shadows && !!sun?.castShadow;
    cull.update(cam, 18, shOn ? sun.shadow.camera : null);
    const cx = cull.st.cx, cy = cull.st.cy, cz = cull.st.cz;
    for (const S of sets) {
      const T = S.tiers;
      const cnt = { c: 0, n: 0, l: 0 };
      const castR2 = Math.min(CAST_R * CAST_R, S.lowD2);
      const r = S.radius + MOVE;
      const put = (t, i) => {
        const m = T[t], c = cnt[t]++;
        const arr = m.instanceMatrix.array, o = c * 16, s = i * 16;
        for (let k = 0; k < 16; k++) arr[o + k] = S.mats[s + k];
        for (const a of S.attrs) {
          const dst = a.name === 'instanceColor' ? m.instanceColor : m.geometry.attributes[a.name];
          for (let j = 0; j < a.size; j++) dst.array[c * a.size + j] = a.src[i * a.size + j];
        }
      };
      const R = S.R + TILE;
      const tx0 = Math.max(0, Math.floor((cx - R) / TILE) - TX0), tx1 = Math.min(NTX - 1, Math.floor((cx + R) / TILE) - TX0);
      const tz0 = Math.max(0, Math.floor((cz - R) / TILE) - TZ0), tz1 = Math.min(NTZ - 1, Math.floor((cz + R) / TILE) - TZ0);
      for (let tz = tz0; tz <= tz1; tz++) for (let tx = tx0; tx <= tx1; tx++) {
        const t = tz * NTX + tx, i0 = S.ts[t], i1 = S.ts[t + 1];
        if (i0 === i1) continue;
        for (let i = i0; i < i1; i++) {
          const x = S.xs[i], y = S.ys[i], z = S.zs[i];
          const dx = x - cx, dy = y - cy, dz = z - cz, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > S.R2) continue;
          const vis = cull.inView(x, y, z, r);
          if (T.c && shOn && d2 < castR2) {
            if (vis || cull.inShadow(x, y, z, r)) put('c', i);
          } else if (vis) put(T.l && d2 > S.lowD2 ? 'l' : 'n', i);
        }
      }
      for (const t of ['c', 'n', 'l']) {
        const m = T[t];
        if (!m) continue;
        const c = cnt[t];
        m.count = c; m.visible = c > 0;
        if (!c) continue;
        const list = [[m.instanceMatrix, 16]];
        for (const a of S.attrs) list.push([a.name === 'instanceColor' ? m.instanceColor : m.geometry.attributes[a.name], a.size]);
        for (const [attr, sz] of list) { attr.clearUpdateRanges(); attr.addUpdateRange(0, c * sz); attr.needsUpdate = true; }
      }
    }
  }

  const walkLines = data.paths.filter((p) => !p.indoor && !p.tunnel).map((p) => p.points);
  const paths = segmentIndex(walkLines);
  const roadLines = data.roads.filter((r) => !r.tunnel);
  const roads = segmentIndex(roadLines.map((r) => r.points), 16);
  const yawTo = (dx, dz) => Math.atan2(dx, dz);

  // ---------------------------------------------------------------- benches (face the nearest path)
  const benches = [];
  const benchPts = data.pois.filter((p) => p.type === 'bench');
  for (const p of benchPts) {
    if (mask.at(p.x, p.z) & M.BUILDING) continue;
    let yaw = rng() * Math.PI * 2, bx = p.x, bz = p.z;
    const n = paths.nearest(p.x, p.z, 12);
    if (n) {
      if (n.d < 0.9) {
        // bench mapped on the path centreline: move it to the path edge, facing across
        const side = rng() < 0.5 ? 1 : -1;
        bx = n.x - n.dz * 1.9 * side; bz = n.z + n.dx * 1.9 * side;
        yaw = yawTo(n.x - bx, n.z - bz);
      } else yaw = yawTo(n.x - p.x, n.z - p.z);
    }
    benches.push({ x: bx, y: H(bx, bz) - 0.02, z: bz, yaw });
    ctx.colliders?.addBox(bx, bz, 0.95, 0.35, yaw, H(bx, bz) - 1, H(bx, bz) + 0.9, 'bench');
  }
  instanced('bench', benchGeo(), propMat, benches);

  // ---------------------------------------------------------------- bins (OSM + next to some benches)
  const bins = [], recycle = [];
  for (const p of data.pois) {
    if (p.type !== 'waste_basket' && p.type !== 'recycling') continue;
    if (mask.at(p.x, p.z) & M.BUILDING) continue;
    (p.type === 'recycling' ? recycle : bins).push({ x: p.x, y: H(p.x, p.z), z: p.z, yaw: rng() * 6.28 });
  }
  benches.forEach((b, i) => {
    if (i % 3) return;
    const x = b.x + Math.cos(b.yaw) * 1.35, z = b.z - Math.sin(b.yaw) * 1.35;
    if (mask.at(x, z) & M.BUILDING) return;
    (i % 9 === 0 ? recycle : bins).push({ x, y: H(x, z), z, yaw: rng() * 6.28 });
  });
  for (const b of [...bins, ...recycle]) ctx.colliders?.addCircle(b.x, b.z, 0.32, b.y - 1, b.y + 1.1, 'bin');
  instanced('bin', binGeo('#202224'), propMat, bins);
  instanced('recycling', binGeo('#1f5aa6'), propMat, recycle);

  // ---------------------------------------------------------------- bike racks + bikes
  const racks = [], bikes = [];
  const bikeColors = [];
  const BIKE_PAL = ['#1c1c1c', '#b01c22', '#1f4f9a', '#e8e8e8', '#2f6b3a', '#7a7d80', '#d9c11a', '#3a2a55', '#1b7fa6'];
  for (const p of data.pois) {
    const pogoh = p.type === 'bicycle_rental';
    if (p.type !== 'bicycle_parking' && !pogoh) continue;
    let x = p.x, z = p.z, yaw = rng() * 6.28;
    const n = paths.nearest(x, z, 10);
    if (n) {
      yaw = Math.atan2(n.dx, n.dz) + Math.PI / 2; // rack line parallel to the path
      if (n.d < 1.2) { const side = rng() < 0.5 ? 1 : -1; x = n.x - n.dz * 2.1 * side; z = n.z + n.dx * 2.1 * side; }
    }
    if (mask.at(x, z) & M.BUILDING) continue;
    const y = H(x, z);
    racks.push({ x, y, z, yaw });
    ctx.colliders?.addBox(x, z, 2.3, 0.4, yaw, y - 1, y + 1, 'bikerack');
    // bikes on some slots (rack local X = along the line; bikes stand along local Z)
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (let k = 0; k < 5; k++) {
      if (rng() > (pogoh ? 0.8 : 0.55)) continue;
      const lx = (k - 2) * 0.9 + 0.22;
      const bx = x + lx * c, bz = z - lx * s;
      bikes.push({ x: bx, y: H(bx, bz), z: bz, yaw: yaw + (rng() < 0.5 ? 0 : Math.PI) });
      _col.set(pogoh ? (k % 2 ? '#c7d93a' : '#f2f2f2') : BIKE_PAL[Math.floor(rng() * BIKE_PAL.length)]);
      bikeColors.push(_col.r, _col.g, _col.b);
    }
  }
  instanced('bikeRack', bikeRackGeo(5), propMat, racks, { low: bikeRackLowGeo(5), lowD: 60 });
  const bikeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 });
  instanced('bike', bikeGeo(), bikeMat, bikes, { low: bikeLowGeo(), lowD: 60, R: Math.min(PROP_R, 260), colors: new Float32Array(bikeColors) });

  // ---------------------------------------------------------------- lamps
  const glowMat = new THREE.MeshStandardMaterial({ color: '#efe9dc', emissive: '#ffd6a0', emissiveIntensity: 0, roughness: 0.3 });
  glowMat.name = 'lampGlow';
  if (ctx.materials?.registerNightMaterial) ctx.materials.registerNightMaterial(glowMat, 3.2);
  const lampSpace = spacing(8);
  const campusLamps = [], streetLamps = [], pools = [];
  const addPool = (x, z, r) => {
    const n = ctx.normalAt(x, z);
    pools.push({ x, y: H(x, z) + 0.12, z, yaw: rng() * 6.28, s: r * 2, sy: 1, nx: n[0], ny: n[1], nz: n[2] });
  };
  // campus walks: black globe lamps every ~28 m, alternating sides
  for (const p of data.paths) {
    if (p.indoor || p.tunnel || p.bridge || p.type === 'steps' || p.type === 'track') continue;
    if (p.footway === 'crossing') continue;
    let side = rng() < 0.5 ? 1 : -1;
    samplePolyline(p.points, 27 + rng() * 4, 6 + rng() * 10, (x, z, dx, dz) => {
      if (!(mask.at(x, z) & M.CAMPUS)) return;
      side = -side;
      const off = (p.width || 2) / 2 + 0.55;
      for (const sd of [side, -side]) {
        const lx = x - dz * off * sd, lz = z + dx * off * sd;
        if (mask.at(lx, lz) & (M.BUILDING | M.ROAD | M.WATER | M.HARD)) continue;
        if (!mask.free(lx, lz, 0.3, M.PATH | M.BUILDING)) continue;
        if (lampSpace.near(lx, lz, 16)) return;
        lampSpace.add(lx, lz);
        const y = H(lx, lz) - 0.05;
        campusLamps.push({ x: lx, y, z: lz, yaw: 0 });
        ctx.colliders?.addCircle(lx, lz, 0.2, y - 1, y + 4.8, 'lamp');
        addPool(lx, lz, 5);      // a 4.8 m post-top lamp lights a ~5 m radius
        return;
      }
    });
  }
  await ctx.yield?.();
  // streets: taller lamps every ~32 m (both sides on major roads, one side on residential)
  const LAMP_ROADS = { primary: 30, trunk: 30, secondary: 32, tertiary: 34, residential: 40, unclassified: 40, primary_link: 30 };
  for (const r of data.roads) {
    const step = LAMP_ROADS[r.type];
    if (!step || r.tunnel) continue;
    const major = step <= 34;
    let side = 1;
    const off = (r.width || 7) / 2 + 0.7;
    samplePolyline(r.points, step, 5 + rng() * 10, (x, z, dx, dz) => {
      if (major) side = -side;
      for (const sd of major ? [side] : [1]) {
        const lx = x - dz * off * sd, lz = z + dx * off * sd;
        if (!inB(lx, lz)) continue;
        const f = mask.at(lx, lz);
        if (f & (M.BUILDING | M.WATER)) continue;
        if (!mask.free(lx, lz, 0.6, M.ROAD | M.BUILDING)) continue;
        if (lampSpace.near(lx, lz, 14)) continue;
        lampSpace.add(lx, lz);
        const y = r.bridge ? ctx.surfaceHeightAt(lx, lz) : H(lx, lz) - 0.05;
        // arm points over the road (towards the centreline)
        streetLamps.push({ x: lx, y, z: lz, yaw: yawTo(dz * sd, -dx * sd) });
        ctx.colliders?.addCircle(lx, lz, 0.25, y - 1, y + 9, 'lamp');
        const px = lx + dz * sd * 2.2, pz = lz - dx * sd * 2.2;
        addPool(px, pz, 7.5);
      }
    });
  }
  // lamps are tall and glow at night: longer draw distance; post + globe share positions, so they cull together
  const LAMP_R = lvl === 'low' ? 400 : 650;
  instanced('campusLamp', campusLampGeo(), propMat, campusLamps, { R: LAMP_R });
  instanced('campusGlobe', campusGlobeGeo(), glowMat, campusLamps, { cast: false, R: LAMP_R });
  instanced('streetLamp', streetLampGeo(), propMat, streetLamps, { R: LAMP_R });
  instanced('streetLens', streetLensGeo(), glowMat, streetLamps, { cast: false, R: LAMP_R });
  const pool = createLightPoolMaterial('#ffc58a');
  const poolGeo = new THREE.PlaneGeometry(1, 1); poolGeo.rotateX(-Math.PI / 2);
  const poolMesh = staticInstanced('lightPool', poolGeo, pool.material, pools);
  if (poolMesh) { poolMesh.renderOrder = 2; poolMesh.frustumCulled = false; poolMesh.visible = false; }

  // ---------------------------------------------------------------- road intersections (for hydrants / parking gaps)
  const vtx = new Map();
  data.roads.forEach((r, ri) => {
    if (r.tunnel) return;
    for (const [x, z] of r.points) {
      const k = `${Math.round(x)},${Math.round(z)}`;
      let e = vtx.get(k); if (!e) vtx.set(k, e = { x, z, roads: new Set() });
      e.roads.add(ri);
    }
  });
  const junctions = spacing(16);
  for (const e of vtx.values()) if (e.roads.size > 1) junctions.add(e.x, e.z);

  // ---------------------------------------------------------------- hydrants & bollards
  const hydrants = [];
  for (const r of data.roads) {
    if (!['residential', 'tertiary', 'secondary', 'primary', 'unclassified'].includes(r.type) || r.bridge || r.tunnel) continue;
    const off = (r.width || 7) / 2 + 0.55;
    samplePolyline(r.points, 85 + rng() * 30, 10 + rng() * 40, (x, z, dx, dz) => {
      const sd = rng() < 0.5 ? 1 : -1;
      const hx = x - dz * off * sd, hz = z + dx * off * sd;
      if (!inB(hx, hz) || !mask.free(hx, hz, 0.4, M.ROAD | M.BUILDING | M.WATER)) return;
      const y = H(hx, hz);
      hydrants.push({ x: hx, y, z: hz, yaw: yawTo(-dz * sd, dx * sd) + Math.PI });
      ctx.colliders?.addCircle(hx, hz, 0.2, y - 1, y + 0.9, 'hydrant');
    });
  }
  instanced('hydrant', hydrantGeo(), propMat, hydrants, { low: hydrantLowGeo(), lowD: 60 });

  const bollards = [];
  for (const b of data.barriers) if (b.type === 'bollard') samplePolyline(b.points, 1.6, 0, (x, z) => bollards.push({ x, y: H(x, z), z, yaw: 0 }));
  // bollards where wide campus walkways meet a street (keep cars out of pedestrian zones)
  for (const p of data.paths) {
    if (p.indoor || p.tunnel || p.bridge || (p.width || 2) < 2.4 || p.type === 'steps' || p.footway) continue;
    for (const end of [0, 1]) {
      const pts = p.points;
      const a = end ? pts[pts.length - 1] : pts[0], b2 = end ? pts[pts.length - 2] : pts[1];
      if (!(mask.at(a[0], a[1]) & M.CAMPUS)) continue;
      const L = Math.hypot(b2[0] - a[0], b2[1] - a[1]); if (L < 4) continue;
      const dx = (b2[0] - a[0]) / L, dz = (b2[1] - a[1]) / L;
      const cx = a[0] + dx * 2.5, cz = a[1] + dz * 2.5;
      if (mask.free(a[0], a[1], 1.5, M.ROAD) || !mask.free(cx, cz, 0.6, M.ROAD)) continue;
      const w = Math.min(4, (p.width || 3) / 2);
      for (let k = -1; k <= 1; k++) {
        const bx = cx - dz * k * w * 0.7, bz = cz + dx * k * w * 0.7;
        const y = H(bx, bz);
        bollards.push({ x: bx, y, z: bz, yaw: 0 });
        ctx.colliders?.addCircle(bx, bz, 0.13, y - 1, y + 1, 'bollard');
      }
    }
  }
  instanced('bollard', bollardGeo(), propMat, bollards);

  // ---------------------------------------------------------------- mail boxes (USPS blue)
  const mail = [];
  for (const p of data.pois) {
    if (p.type !== 'post_box') continue;
    const n = roads.nearest(p.x, p.z, 25) || paths.nearest(p.x, p.z, 10);
    let x = p.x, z = p.z, yaw = rng() * 6.28;
    if (n) yaw = yawTo(n.x - x, n.z - z);
    if (mask.at(x, z) & M.BUILDING) continue;
    mail.push({ x, y: H(x, z), z, yaw });
    ctx.colliders?.addBox(x, z, 0.28, 0.28, yaw, H(x, z) - 1, H(x, z) + 1.3, 'mailbox');
  }
  instanced('mailbox', mailboxGeo(), propMat, mail);

  // ---------------------------------------------------------------- bus shelters on Forbes & Fifth
  const shelters = [];
  const glassMat = new THREE.MeshStandardMaterial({ color: '#b7cdd6', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
  glassMat.forceSinglePass = true; // thin panes: one double-sided pass instead of back + front passes
  const adMat = new THREE.MeshStandardMaterial({ color: '#d8dde2', emissive: '#f4f1e6', emissiveIntensity: 0, roughness: 0.4 });
  if (ctx.materials?.registerNightMaterial) ctx.materials.registerNightMaterial(adMat, 1.6);
  // approximate stop locations (near intersections with the cross streets), world x
  const STOPS = [['Forbes Avenue', -185], ['Forbes Avenue', 60], ['Forbes Avenue', 190], ['Forbes Avenue', -470], ['Forbes Avenue', -640],
    ['Fifth Avenue', -180], ['Fifth Avenue', -420], ['Fifth Avenue', 120], ['Fifth Avenue', -620]];
  for (const [name, sx] of STOPS) {
    let best = null;
    for (const r of data.roads) {
      if (r.name !== name || r.tunnel || r.bridge) continue;
      samplePolyline(r.points, 3, 0, (x, z, dx, dz) => { const d = Math.abs(x - sx); if (!best || d < best.d) best = { d, x, z, dx, dz, r }; });
    }
    if (!best || best.d > 20) continue;
    // right-hand side of travel along the polyline; shelter faces the road
    for (const sd of [1, -1]) {
      const off = (best.r.width || 12) / 2 + 2.6;
      const x = best.x - best.dz * off * sd, z = best.z + best.dx * off * sd;
      if (!mask.free(x, z, 2.2, M.BUILDING | M.ROAD)) continue;
      if (shelters.some((s) => Math.hypot(s.x - x, s.z - z) < 40)) break;
      const yaw = yawTo(best.dz * sd, -best.dx * sd);
      const y = H(x, z) - 0.05;
      shelters.push({ x, y, z, yaw });
      ctx.colliders?.addBox(x, z, 2.0, 0.8, yaw, y - 1, y + 2.6, 'busShelter');
      break;
    }
  }
  instanced('busShelter', shelterFrameGeo(), propMat, shelters);
  instanced('busShelterGlass', shelterGlassGeo(), glassMat, shelters, { cast: false });
  instanced('busShelterAd', shelterAdGeo(), adMat, shelters, { cast: false });

  // ---------------------------------------------------------------- park pavilions (OSM shelters) & picnic tables
  const pav = [];
  for (const p of data.pois) {
    if (p.type !== 'shelter') continue;
    if (mask.at(p.x, p.z) & M.BUILDING) continue;
    const y = H(p.x, p.z) - 0.1;
    const n = paths.nearest(p.x, p.z, 20);
    const yaw = n ? Math.atan2(n.dx, n.dz) : 0;
    pav.push({ x: p.x, y, z: p.z, yaw });
    ctx.colliders?.addBox(p.x, p.z, 3.0, 2.1, yaw, y - 1, y + 5, 'pavilion');
  }
  instanced('pavilion', pavilionGeo(), propMat, pav);
  const picnic = [];
  const picnicAreas = data.areas.filter((a) => (a.type === 'grass' || a.type === 'park' || a.type === 'garden') && a.name !== 'Schenley Park');
  let tries = 0;
  while (picnic.length < 16 && tries++ < 4000) {
    const a = picnicAreas[Math.floor(rng() * picnicAreas.length)];
    const pt = a.polygon[Math.floor(rng() * a.polygon.length)];
    const x = pt[0] + (rng() - 0.5) * 16, z = pt[1] + (rng() - 0.5) * 16;
    const f = mask.at(x, z);
    if (!(f & M.CAMPUS) || (f & (M.LAWN | M.HARD))) continue;
    if (!pointInRing(x, z, a.polygon)) continue;
    if (!mask.free(x, z, 2.2, M.BUILDING | M.PATH | M.ROAD | M.WATER)) continue;
    const n = paths.nearest(x, z, 9);
    if (!n || n.d < 3) continue;
    if (picnic.some((p) => Math.hypot(p.x - x, p.z - z) < 25)) continue;
    const y = H(x, z);
    picnic.push({ x, y, z, yaw: Math.atan2(n.dx, n.dz) });
    ctx.colliders?.addBox(x, z, 1.0, 0.8, Math.atan2(n.dx, n.dz), y - 1, y + 0.8, 'picnic');
  }
  instanced('picnicTable', picnicGeo(), propMat, picnic);

  // ---------------------------------------------------------------- flagpole + US flag near Warner Hall
  let flag = null;
  {
    const warner = data.buildings.find((b) => b.name === 'Warner Hall');
    const pref = warner ? [warner.centroid[0] + 34, warner.centroid[1] - 12] : [2, -140];
    let spot = null;
    for (let r = 0; r < 40 && !spot; r += 1.5) {
      for (let k = 0; k < 16 && !spot; k++) {
        const x = pref[0] + Math.cos(k * 0.39) * r, z = pref[1] + Math.sin(k * 0.39) * r;
        if (mask.free(x, z, 2.2, M.BUILDING | M.PATH | M.ROAD | M.WATER | M.HARD) && Math.hypot(x - 9, z + 127) > 12) spot = [x, z];
      }
    }
    if (spot) {
      const [fx, fz] = spot, fy = H(fx, fz) - 0.15;
      const pole = new THREE.Mesh(flagpoleGeo(), propMat);
      pole.position.set(fx, fy, fz);
      pole.castShadow = shadows; pole.receiveShadow = true;
      pole.name = 'props:flagpole';
      ctx.colliders?.addCircle(fx, fz, 0.75, fy - 1, fy + 13.6, 'flagpole');
      const fGeo = new THREE.PlaneGeometry(2.47, 1.3, 26, 10);
      fGeo.translate(1.235 + 0.07, 12.55, 0);
      const fUni = { uTime: { value: 0 } };
      const fMat = new THREE.MeshStandardMaterial({ map: usFlagTexture(), side: THREE.DoubleSide, roughness: 0.8 });
      fMat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, fUni);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;')
          .replace('#include <beginnormal_vertex>', `
            float fk = clamp((position.x - 0.07) / 2.47, 0.0, 1.0);
            float fph = position.x * 2.4 - uTime * ${glslRad(5.2)};
            float fdz = cos(fph) * 2.4 * 0.16 * fk + sin(fph) * 0.16 / 2.47;
            vec3 objectNormal = normalize(vec3(-fdz, 0.0, 1.0));
            #ifdef USE_TANGENT
              vec3 objectTangent = vec3(tangent.xyz);
            #endif`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            transformed.z += sin(fph) * 0.16 * fk + sin(uTime * ${glslRad(1.3)} + position.y * 1.5) * 0.05 * fk;
            transformed.y -= fk * fk * 0.1;`);
      };
      fMat.customProgramCacheKey = () => 'cmu-flag-v2';
      flag = new THREE.Mesh(fGeo, fMat);
      flag.castShadow = shadows;
      flag.name = 'props:usFlag';
      pole.add(flag);
      flag.rotation.y = -0.6; // flying roughly east-north-east with the prevailing westerly wind
      group.add(pole);
      counts.flagpole = 1;
      ctx.onUpdate((dt, t) => { fUni.uTime.value = animTime(t); }, 10);   // wrapped clock (float32-safe, seamless)
    }
  }

  // ---------------------------------------------------------------- parked cars
  const carTypes = ['sedan', 'suv', 'pickup'];
  const parked = { sedan: [], suv: [], pickup: [] };
  const pickType = () => { const r = rng(); return r < 0.56 ? 'sedan' : r < 0.9 ? 'suv' : 'pickup'; };
  const addCar = (x, z, yaw) => {
    const n = ctx.normalAt(x, z);
    const y = H(x, z);
    const type = pickType();
    parked[type].push({ x, y, z, yaw, nx: n[0], ny: n[1], nz: n[2], paint: rng() });
    ctx.colliders?.addBox(x, z, 0.95, 2.4, yaw, y - 1, y + 1.7, 'car');
  };
  const density = q.level === 'low' ? 0.5 : 0.8;
  // lots: rows aligned with the lot's principal axis
  for (const a of data.areas) {
    if (a.type !== 'parking') continue;
    const fr = footprintFrame(a.polygon);
    const c = Math.cos(fr.angle), s = Math.sin(fr.angle);
    const occ = (0.55 + rng() * 0.35) * density;
    let v = -fr.width / 2 + 2.7, dir = 1;
    while (v < fr.width / 2 - 2.4) {
      for (let u = -fr.length / 2 + 1.6; u < fr.length / 2 - 1.4; u += 2.7) {
        const x = fr.center[0] + u * c - v * s, z = fr.center[1] + u * s + v * c;
        let ok = pointInRing(x, z, a.polygon);
        for (const [cu, cv] of [[-1.1, -2.3], [1.1, -2.3], [1.1, 2.3], [-1.1, 2.3]]) {
          if (!ok) break;
          ok = pointInRing(x + cu * c - cv * s, z + cu * s + cv * c, a.polygon);
        }
        if (!ok || !inB(x, z, 4) || !mask.free(x, z, 2.2, M.BUILDING) || !mask.free(x, z, 1.4, M.ROAD | M.PATH)) continue;
        if (rng() > occ) continue;
        const ndx = -s * dir, ndz = c * dir; // nose towards the aisle
        addCar(x, z, yawTo(ndx, ndz) + (rng() - 0.5) * 0.06);
      }
      if (dir === 1) { v += 5.4 + 6.6; dir = -1; } else { v += 5.4; dir = 1; }
    }
  }
  // parallel parking on residential streets
  for (const r of data.roads) {
    if (r.type !== 'residential' || r.bridge || r.tunnel || (r.width || 7) < 6) continue;
    const off = (r.width || 7) / 2 - 1.15;
    for (const sd of [1, -1]) {
      if (r.oneway && sd === -1 && rng() < 0.5) continue;
      samplePolyline(r.points, 6.4, 3 + rng() * 4, (x, z, dx, dz) => {
        if (rng() > 0.48 * density) return;
        const cx = x - dz * off * sd, cz = z + dx * off * sd;
        if (!inB(cx, cz) || junctions.near(cx, cz, 13)) return;
        if (!mask.free(cx, cz, 2.2, M.PATH) || !mask.free(cx, cz, 1.5, M.BUILDING | M.WATER)) return;
        // car faces the direction of traffic on its side of the street
        addCar(cx, cz, sd === 1 ? yawTo(dx, dz) : yawTo(-dx, -dz));
      });
    }
  }
  // Parked cars: full model near the camera (casting within CAST_R), low-poly LOD further out; culled to the view.
  const carMat = createCarMaterial({ lights: false });
  let parkedTotal = 0;
  const CAR_LOW_D = lvl === 'low' ? 140 : 240, CAR_R = lvl === 'low' ? 600 : 900;
  for (const type of carTypes) {
    const list = parked[type];
    const cols = new Float32Array(list.length * 3);
    list.forEach((c, i) => randomPaint(c.paint, cols, i * 3));
    culledSet(`parked_${type}`, list, (t, cap) => {
      const m = createVehicleMesh(type, carMat.material, cap, t === 'l');
      m.geometry.attributes.iColor.setUsage(THREE.DynamicDrawUsage);
      m.name = `vehicles:parked_${type}${t === 'l' ? ':low' : ''}`;
      return m;
    }, { R: CAR_R, lowD: CAR_LOW_D, hasLow: true, radius: 3, cy: 0.8, attrs: [{ name: 'iColor', size: 3, src: cols }] });
    parkedTotal += counts[`parked_${type}`] || 0;
  }

  ctx.scene.add(group);

  // ---------------------------------------------------------------- per frame: culling partition, night light pools
  let lastPart = -1, dirty = true, shadowKey = 0;
  ctx.onUpdate((dt, elapsed) => {
    const cam = ctx.camera;
    if (cam && sets.length) {
      cam.updateMatrixWorld();
      const sun = ctx.env?.sun;
      let sk = 0;
      if (shadows && sun?.castShadow) { const e = sun.shadow.camera.matrixWorldInverse.elements; sk = e[12] + e[13] * 1.3 + e[14] * 0.7 + sun.shadow.camera.right; }
      const changed = watch.changed(cam) || Math.abs(sk - shadowKey) > 8;
      if (dirty || (changed && elapsed - lastPart > (watch.moved(cam) ? 0.2 : 0.08))) {
        watch.mark(cam); shadowKey = sk; dirty = false; lastPart = elapsed;
        partitionSets();
      }
    }
    const nf = ctx.env?.state?.nightFactor ?? 0;
    pool.uniforms.uIntensity.value = nf * 0.3;
    if (poolMesh) poolMesh.visible = nf > 0.02;
  }, 10);

  // runtime quality switch: shadow casting of the caster meshes (+ flag), re-partition
  ctx.events.on('quality', (qp) => {
    if (!qp) return;
    shadows = !!qp.shadows;
    for (const S of sets) if (S.tiers.c) S.tiers.c.castShadow = shadows;
    if (flag) { flag.castShadow = shadows; flag.parent.castShadow = shadows; }
    dirty = true;
  });

  const stats = { ...counts, parkedCars: parkedTotal, ms: Math.round(performance.now() - t0) };
  console.info('[props]', JSON.stringify(stats));
  ctx.props = { group, stats, lampPositions: { campus: campusLamps, street: streetLamps }, busStops: shelters };
  return ctx.props;
}
