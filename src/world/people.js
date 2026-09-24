// Low-poly pedestrians, Scottish terriers and birds, animated entirely in the vertex shader (owner: life agent).
//
// Person geometry (one merged mesh, +Z forward, feet at y = 0, ~1.72 m):
//   aPart: 0 shirt · 1 trousers · 2 skin · 3 hair · 4 shoes · 5 backpack (optional) · 6 long hair (optional)
//   aLimb: 0 body · 1/2 thighs · 3/4 upper arms · 5/6 shins (bent at the knee) · 7/8 forearms (bent at the elbow)
// Per-instance: iShirt, iPants (rgb, linear), iLook = (skinTone, hairTone, hasBackpack, hasLongHair),
//               iAnim = (phaseOffset, strideFrequency Hz, swingAmplitude)
// The walk cycle phase is uTime * freq, so the CPU never touches animation state after spawning. uTime is the
// wrapped animation clock (graph.js animTime) and every frequency (iAnim.y, via loopHz) completes a whole number of
// cycles per wrap, so float32 phases stay precise and the wrap is invisible.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { glslRad } from './graph.js';

function prep(g, part, limb, color = null) {
  if (g.index) g = g.toNonIndexed();
  if (g.attributes.uv) g.deleteAttribute('uv');
  const n = g.attributes.position.count;
  g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  g.setAttribute('aLimb', new THREE.BufferAttribute(new Float32Array(n).fill(limb), 1));
  if (color) {
    const c = new THREE.Color(color), a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  return g;
}
const at = (g, x, y, z) => { g.translate(x, y, z); return g; };

// ------------------------------------------------------------------ person
// aLimb: 0 body · 1/2 left/right thigh · 3/4 left/right upper arm · 5/6 left/right shin (+ shoe) · 7/8 left/right
// forearm (+ hand). Shins bend at the knee and forearms at the elbow before the whole limb swings at hip / shoulder.
export function personGeometry() {
  const p = [];
  for (const [side, thigh, shin] of [[1, 1, 5], [-1, 2, 6]]) {
    const x = 0.095 * side;
    p.push(prep(at(new THREE.CylinderGeometry(0.083, 0.066, 0.45, 7), x, 0.72, 0), 1, thigh));     // thigh
    p.push(prep(at(new THREE.CylinderGeometry(0.064, 0.05, 0.46, 7), x, 0.27, 0), 1, shin));       // shin
    const shoe = new RoundedBoxGeometry(0.1, 0.075, 0.25, 1, 0.03);
    p.push(prep(at(shoe, x, 0.037, 0.035), 4, shin));                                               // shoe
  }
  p.push(prep(at(new THREE.BoxGeometry(0.33, 0.2, 0.2), 0, 0.95, 0), 1, 0));                          // hips
  const torso = new THREE.CylinderGeometry(0.2, 0.165, 0.56, 9); torso.scale(1, 1, 0.62);
  p.push(prep(at(torso, 0, 1.23, 0), 0, 0));
  const sh = new THREE.SphereGeometry(0.2, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2); sh.scale(1, 0.35, 0.62);
  p.push(prep(at(sh, 0, 1.5, 0), 0, 0));                                                              // shoulders
  for (const [side, upper, fore] of [[1, 3, 7], [-1, 4, 8]]) {
    const x = 0.245 * side;
    p.push(prep(at(new THREE.CylinderGeometry(0.054, 0.047, 0.31, 6), x, 1.32, 0), 0, upper));        // sleeve (upper arm)
    p.push(prep(at(new THREE.CylinderGeometry(0.046, 0.04, 0.27, 6), x + 0.004 * side, 1.04, 0), 0, fore)); // forearm
    const hand = new THREE.SphereGeometry(0.046, 6, 4); hand.scale(0.8, 1.15, 1);
    p.push(prep(at(hand, x + 0.006 * side, 0.87, 0.005), 2, fore));                                  // hand
  }
  p.push(prep(at(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 6), 0, 1.56, 0), 2, 0));               // neck
  const head = new THREE.SphereGeometry(0.108, 10, 8); head.scale(0.92, 1.12, 1);
  p.push(prep(at(head, 0, 1.67, 0.01), 2, 0));
  const nose = new THREE.ConeGeometry(0.018, 0.045, 4); nose.rotateX(Math.PI / 2); nose.translate(0, 1.655, 0.118);
  p.push(prep(nose, 2, 0));
  for (const s2 of [-1, 1]) {                                                                          // ears
    const ear = new THREE.SphereGeometry(0.022, 5, 4); ear.scale(0.5, 1, 0.8);
    p.push(prep(at(ear, 0.099 * s2, 1.665, 0.005), 2, 0));
  }
  const hair = new THREE.SphereGeometry(0.116, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.52); hair.scale(0.94, 1.1, 1.02);
  p.push(prep(at(hair, 0, 1.685, -0.005), 3, 0));
  p.push(prep(at(new THREE.BoxGeometry(0.2, 0.26, 0.06), 0, 1.56, -0.085), 6, 0));                   // long hair
  const pack = new RoundedBoxGeometry(0.28, 0.36, 0.13, 1, 0.04);
  p.push(prep(at(pack, 0, 1.24, -0.17), 5, 0));
  p.push(prep(at(new THREE.BoxGeometry(0.3, 0.03, 0.16), 0, 1.44, -0.13), 5, 0));                    // backpack straps
  const g = mergeGeometries(p.map((q) => { if (q.attributes.normal === undefined) q.computeVertexNormals(); return q; }), false);
  g.computeBoundingSphere();
  return g;
}

// Walk cycle: hip / shoulder swing, knee flexion during the leg's swing phase (peaks as the foot passes under the
// body), elbows slightly bent and bending more as the arm swings forward. rotL(v, a) rotates about +X in the y-z plane.
const PERSON_VERT_ANIM = /* glsl */`
  float ph = uTime * iAnim.y * 6.2831853 + iAnim.x;
  float sw = sin(ph) * iAnim.z, cph = cos(ph);
  float ang = 0.0, pivot = 0.0, subA = 0.0, subP = 0.0;
  int limb = int(aLimb + 0.5);
  if (limb == 1 || limb == 5) { ang = sw * 0.46; pivot = 0.93; if (limb == 5) { subA = (0.08 + 0.95 * max(0.0, -cph)) * iAnim.z; subP = 0.5; } }
  else if (limb == 2 || limb == 6) { ang = -sw * 0.46; pivot = 0.93; if (limb == 6) { subA = (0.08 + 0.95 * max(0.0, cph)) * iAnim.z; subP = 0.5; } }
  else if (limb == 3 || limb == 7) { ang = -sw * 0.4; pivot = 1.46; if (limb == 7) { subA = -(0.28 + 0.4 * max(0.0, sw)); subP = 1.18; } }
  else if (limb == 4 || limb == 8) { ang = sw * 0.4; pivot = 1.46; if (limb == 8) { subA = -(0.28 + 0.4 * max(0.0, -sw)); subP = 1.18; } }
  float ca = cos(ang), sa = sin(ang), cb = cos(subA), sb = sin(subA);
`;
const PERSON_POSE = /* glsl */`
  transformed.y -= subP;
  transformed = vec3(transformed.x, transformed.y * cb - transformed.z * sb, transformed.y * sb + transformed.z * cb);
  transformed.y += subP - pivot;
  transformed = vec3(transformed.x, transformed.y * ca - transformed.z * sa, transformed.y * sa + transformed.z * ca);
  transformed.y += pivot;
  transformed.y += abs(cph) * 0.03 * iAnim.z;
`;

export function createPersonMaterial(shared) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.82, metalness: 0 });
  mat.name = 'pedestrians';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        attribute float aPart; attribute float aLimb;
        attribute vec3 iShirt; attribute vec3 iPants; attribute vec4 iLook; attribute vec3 iAnim;
        varying float vPart; varying vec3 vShirt; varying vec3 vPants; varying vec4 vLook;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        ${PERSON_VERT_ANIM}
        objectNormal = vec3(objectNormal.x, objectNormal.y * cb - objectNormal.z * sb, objectNormal.y * sb + objectNormal.z * cb);
        objectNormal = vec3(objectNormal.x, objectNormal.y * ca - objectNormal.z * sa, objectNormal.y * sa + objectNormal.z * ca);`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${PERSON_POSE}
        if ((aPart > 4.5 && aPart < 5.5 && iLook.z < 0.5) || (aPart > 5.5 && iLook.w < 0.5)) transformed = vec3(0.0, 1.3, 0.0);
        vPart = aPart; vShirt = iShirt; vPants = iPants; vLook = iLook;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vPart; varying vec3 vShirt; varying vec3 vPants; varying vec4 vLook;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float pp = floor(vPart + 0.5);
        vec3 skin = mix(vec3(0.72, 0.47, 0.34), vec3(0.09, 0.045, 0.025), vLook.x);
        vec3 hairC = vLook.y < 0.45 ? vec3(0.012, 0.01, 0.009) : vLook.y < 0.7 ? vec3(0.07, 0.035, 0.015) : vLook.y < 0.88 ? vec3(0.35, 0.22, 0.08) : vec3(0.42, 0.42, 0.4);
        float bk = fract(vLook.x * 17.31 + vLook.y * 7.7);
        vec3 bag = bk < 0.5 ? vec3(0.02) : bk < 0.72 ? vec3(0.02, 0.03, 0.08) : bk < 0.88 ? vec3(0.12) : vec3(0.45, 0.01, 0.03);
        vec3 pc = pp < 0.5 ? vShirt : pp < 1.5 ? vPants : pp < 2.5 ? skin : pp < 3.5 ? hairC : pp < 4.5 ? vec3(0.03) : pp < 5.5 ? bag : hairC;
        diffuseColor.rgb = pc;`);
  };
  mat.customProgramCacheKey = () => 'cmu-person-v2';
  return mat;
}

export function createPersonDepthMaterial(shared) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; attribute float aPart; attribute float aLimb; attribute vec4 iLook; attribute vec3 iAnim;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${PERSON_VERT_ANIM}
        ${PERSON_POSE}
        if ((aPart > 4.5 && aPart < 5.5 && iLook.z < 0.5) || (aPart > 5.5 && iLook.w < 0.5)) transformed = vec3(0.0, 1.3, 0.0);`);
  };
  mat.customProgramCacheKey = () => 'cmu-person-depth-v2';
  return mat;
}

// Clothing palettes (sRGB) — students in early fall: dark jackets, hoodies, jeans, some CMU red & tartan-green
const SHIRTS = ['#1d2330', '#2b2b2e', '#5b6068', '#e9e7e1', '#c41230', '#8c1b2b', '#2d4f7c', '#1f5a3a', '#b8a58a', '#6c3b2a', '#d8c9a3', '#3d6f9c', '#7a2940', '#9aa3ab', '#e0a526', '#4a4f2c'];
const PANTS = ['#26344f', '#1c2433', '#161616', '#3b3f45', '#6e6452', '#a79b82', '#2f3c56', '#4c5561'];
const _c = new THREE.Color();
export function randomOutfit(rng, shirt, pants, look, o3, o4) {
  _c.set(SHIRTS[Math.floor(rng() * SHIRTS.length)]); shirt[o3] = _c.r; shirt[o3 + 1] = _c.g; shirt[o3 + 2] = _c.b;
  _c.set(PANTS[Math.floor(rng() * PANTS.length)]); pants[o3] = _c.r; pants[o3 + 1] = _c.g; pants[o3 + 2] = _c.b;
  look[o4] = rng();                       // skin tone
  look[o4 + 1] = rng();                   // hair tone
  look[o4 + 2] = rng() < 0.45 ? 1 : 0;    // backpack (it's a campus)
  look[o4 + 3] = rng() < 0.35 ? 1 : 0;    // long hair
}

// ------------------------------------------------------------------ Scottish terrier ("Scotty")
// Vertex-coloured; aLimb 1..4 = FL, FR, RL, RR legs pivoting at the shoulder / hip (y = 0.27).
export function scottyGeometry() {
  const BLK = '#141414', DK = '#1e1d1c', RED = '#b3121f';
  const p = [];
  p.push(prep(at(new RoundedBoxGeometry(0.26, 0.21, 0.52, 2, 0.06), 0, 0.33, 0), 0, 0, BLK));   // body
  p.push(prep(at(new THREE.BoxGeometry(0.3, 0.12, 0.52), 0, 0.23, 0), 0, 0, DK));              // coat "skirt"
  p.push(prep(at(new RoundedBoxGeometry(0.19, 0.19, 0.2, 2, 0.05), 0, 0.45, 0.31), 0, 0, BLK));  // head
  p.push(prep(at(new THREE.BoxGeometry(0.13, 0.12, 0.16), 0, 0.39, 0.45), 0, 0, BLK));         // muzzle
  p.push(prep(at(new THREE.BoxGeometry(0.14, 0.12, 0.12), 0, 0.31, 0.43), 0, 0, DK));           // beard
  for (const s of [-1, 1]) p.push(prep(at(new THREE.BoxGeometry(0.06, 0.03, 0.05), 0.05 * s, 0.53, 0.4), 0, 0, DK)); // bushy brows
  p.push(prep(at(new THREE.BoxGeometry(0.05, 0.04, 0.04), 0, 0.42, 0.535), 0, 0, '#050505'));  // nose
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.035, 0.1, 4); ear.translate(0.06 * s, 0.57, 0.3);
    p.push(prep(ear, 0, 0, BLK));
    p.push(prep(at(new THREE.BoxGeometry(0.03, 0.03, 0.02), 0.05 * s, 0.47, 0.405), 0, 0, '#3a2a1a')); // eyes/brows
  }
  const tail = new THREE.ConeGeometry(0.035, 0.16, 5); tail.rotateX(-0.35); tail.translate(0, 0.46, -0.25);
  p.push(prep(tail, 0, 0, BLK));
  p.push(prep(at(new THREE.BoxGeometry(0.22, 0.04, 0.05), 0, 0.37, 0.22), 0, 0, RED));          // collar
  const legs = [[0.08, 0.18, 1], [-0.08, 0.18, 2], [0.08, -0.18, 3], [-0.08, -0.18, 4]];
  for (const [x, z, l] of legs) p.push(prep(at(new THREE.BoxGeometry(0.075, 0.27, 0.08), x, 0.135, z), 0, l, BLK));
  const g = mergeGeometries(p, false);
  g.computeBoundingSphere();
  return g;
}

export function createDogMaterial(shared) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; attribute float aLimb; attribute vec3 iAnim;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = uTime * iAnim.y * 6.2831853 + iAnim.x;
        float sw = sin(ph) * iAnim.z;
        float ang = (aLimb > 0.5 && aLimb < 1.5) || aLimb > 3.5 ? sw * 0.6 : (aLimb > 1.5 ? -sw * 0.6 : 0.0);
        float ca = cos(ang), sa = sin(ang);
        transformed.y -= 0.27;
        transformed = vec3(transformed.x, transformed.y * ca - transformed.z * sa, transformed.y * sa + transformed.z * ca);
        transformed.y += 0.27 + abs(cos(ph)) * 0.02 * iAnim.z;
        if (aLimb < 0.5 && position.z < -0.2 && position.y > 0.38) transformed.x += sin(uTime * ${glslRad(9)} + iAnim.x) * 0.03; // wagging tail`);
  };
  mat.customProgramCacheKey = () => 'cmu-dog-v2';
  return mat;
}

// ------------------------------------------------------------------ bird (gull / pigeon silhouette), wings flap in the shader
export function birdGeometry() {
  const pos = [
    // left wing (two tris), right wing, body
    0, 0, 0.12, -0.42, 0.02, -0.02, 0, 0, -0.12,
    0, 0, 0.12, 0.42, 0.02, -0.02, 0, 0, -0.12,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const body = new THREE.ConeGeometry(0.05, 0.36, 5); body.rotateX(Math.PI / 2);
  const bg = body.toNonIndexed(); bg.deleteAttribute('uv'); bg.deleteAttribute('normal');
  const merged = mergeGeometries([g, bg], false);
  merged.computeVertexNormals();
  return merged;
}

export function createBirdMaterial(shared) {
  const mat = new THREE.MeshStandardMaterial({ color: '#3c3f44', roughness: 0.9, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, shared);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; attribute vec3 iAnim;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float flap = sin(uTime * iAnim.y * 6.2831853 + iAnim.x) * iAnim.z;
        transformed.y += abs(position.x) * flap * 1.3;`);
  };
  mat.customProgramCacheKey = () => 'cmu-bird-v1';
  return mat;
}
