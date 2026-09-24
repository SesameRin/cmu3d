// Scotty — bronze Scottish terrier by CFA alumnus Raymond Kaskey, installed in the Merson Courtyard outside the
// Cohon University Center in November 2021 (celebrated April 2022; funded by Kathy Sabec Dax and the late
// F. Robert Dax). Modelled after a real Scottie named Bean; cast gold-bright and then hand-patinated. It stands
// four-square on a granite base that doubles as a bench, and its upright tail is a handle for climbing up.
// Rubbing Scotty's nose is said to bring good luck — so the nose (and tail) are polished bright.
import * as THREE from 'three';
import { meshSDFSteps, primField, primProxyGeometry, makeNoise3, frameFromDir } from './lib/icons-sdf.js';
import { PartBucket, registerLandmark, makeCanvas, canvasTexture, rng, FONT_SERIF, makeLOD, deferRefine } from './lib/icons-common.js';

// colour slots
const BRONZE = 0, POLISHED = 1, EYE = 2;
const SCOTTY_LOD_FAR = 60;    // detailed sculpt within this distance, low-poly stand-in beyond

// Scottie sculpted at ~2.6x life size (scaled to ~3x when placed). Local frame: +z = where he looks, +y up, origin on the base top under his chest.
function scottyPrims() {
  const P = [];
  const ell = (p, r, c = BRONZE, extra = {}) => P.push({ t: 'ell', p, r, c, ...extra });
  const cone = (a, b, r1, r2, c = BRONZE, extra = {}) => P.push({ t: 'cone', a, b, r1, r2, c, ...extra });
  // barrel body, deep chest, rump
  ell([0, 0.44, 0.0], [0.19, 0.195, 0.35]);
  ell([0, 0.41, 0.27], [0.185, 0.22, 0.19]);
  ell([0, 0.46, -0.27], [0.175, 0.18, 0.15]);
  // long "skirt" of furnishings hanging from belly and flanks, almost to the ground
  ell([0, 0.27, 0.02], [0.212, 0.15, 0.36], BRONZE, { k: 0.08 });
  ell([0, 0.25, 0.26], [0.19, 0.14, 0.14], BRONZE, { k: 0.07 });                  // chest apron
  // neck and head: long skull, strong muzzle, beard, bushy brows, erect ears
  cone([0, 0.56, 0.3], [0, 0.72, 0.42], 0.135, 0.1, BRONZE, { k: 0.07 });
  ell([0, 0.77, 0.46], [0.098, 0.1, 0.13]);
  cone([0, 0.745, 0.54], [0, 0.725, 0.73], 0.085, 0.072, BRONZE, { k: 0.05 });
  ell([0, 0.655, 0.645], [0.092, 0.1, 0.11], BRONZE, { k: 0.05 });               // beard
  ell([0, 0.595, 0.63], [0.062, 0.065, 0.07], BRONZE, { k: 0.05 });               // beard tip
  P.push({ t: 'sph', p: [0, 0.745, 0.785], r: 0.028, c: POLISHED, k: 0.015, bias: 0.002 }); // lucky nose
  for (const s of [-1, 1]) {
    ell([s * 0.05, 0.818, 0.585], [0.05, 0.03, 0.06], BRONZE, { k: 0.02 });       // bushy eyebrows
    P.push({ t: 'sph', p: [s * 0.05, 0.793, 0.588], r: 0.016, c: EYE, k: 0.006, bias: 0.006 }); // eyes under the brows
    // ears: small, pointed and erect, slightly flattened front-to-back and tilted outwards
    ell([s * 0.066, 0.875, 0.43], [0.045, 0.06, 0.02], BRONZE, { m: frameFromDir([s * 0.3, 1, -0.1], [0, 0, 1]), k: 0.03 });
    cone([s * 0.07, 0.88, 0.43], [s * 0.1, 0.975, 0.415], 0.03, 0.006, BRONZE, { k: 0.02 });
  }
  // legs: short and sturdy
  for (const s of [-1, 1]) {
    cone([s * 0.1, 0.4, 0.3], [s * 0.1, 0.07, 0.34], 0.068, 0.056, BRONZE, { k: 0.05 });
    ell([s * 0.1, 0.038, 0.375], [0.062, 0.038, 0.085], BRONZE, { k: 0.03 });      // front paws
    ell([s * 0.11, 0.37, -0.26], [0.085, 0.14, 0.12], BRONZE, { k: 0.06 });        // hind thighs
    cone([s * 0.11, 0.26, -0.33], [s * 0.1, 0.07, -0.29], 0.058, 0.05, BRONZE, { k: 0.04 });
    ell([s * 0.1, 0.038, -0.25], [0.06, 0.038, 0.08], BRONZE, { k: 0.03 });         // hind paws
  }
  // the famous upright carrot tail — also the climbing handle, polished by hands
  cone([0, 0.56, -0.38], [0, 0.85, -0.46], 0.062, 0.026, BRONZE, { k: 0.06 });
  cone([0, 0.71, -0.42], [0, 0.85, -0.46], 0.045, 0.026, POLISHED, { k: 0.0, bias: 0.004 });
  return P;
}

function granitePlinthTexture(renderer) {
  // speckled grey granite, written straight into the pixels (26k tiny fillRects cost ~20 ms)
  const S = 512;
  const c = makeCanvas(S, S), g = c.getContext('2d');
  const r = rng(314);
  const img = g.createImageData(S, S), px = new Uint32Array(img.data.buffer);
  const rgba = (hex) => { const n = parseInt(hex.slice(1), 16); return (255 << 24 | (n & 255) << 16 | ((n >> 8) & 255) << 8 | (n >> 16)) >>> 0; };
  const base = rgba('#4a4a4e'), grains = ['#2a2a2d', '#6c6b6e', '#8d8a88', '#b8b2aa'].map(rgba);
  px.fill(base);
  for (let i = 0; i < 26000; i++) {
    const v = r();
    const col = v < 0.45 ? grains[0] : v < 0.8 ? grains[1] : v < 0.95 ? grains[2] : grains[3];
    const s = Math.round(1 + r() * 2.4);
    const x0 = (r() * S) | 0, y0 = (r() * S) | 0;
    for (let y = y0; y < y0 + s && y < S; y++) for (let x = x0; x < x0 + s && x < S; x++) px[y * S + x] = col;
  }
  g.putImageData(img, 0, 0);
  const t = canvasTexture(c, { renderer });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 1.2, 1 / 1.2);  // metre UVs: one tile per 1.2 m
  return t;
}

function plaqueTexture(renderer) {
  const c = makeCanvas(512, 160), g = c.getContext('2d');
  g.fillStyle = '#5b4327'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#caa56a'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 144);
  g.fillStyle = '#ecd29a'; g.textAlign = 'center';
  g.font = `700 54px ${FONT_SERIF}`; g.fillText('SCOTTY', 256, 70);
  g.font = `400 26px ${FONT_SERIF}`; g.fillText('Raymond Kaskey · Carnegie Mellon · 2021', 256, 118);
  return canvasTexture(c, { renderer });
}

async function buildScotty(ctx, def) {
  const poi = ctx.data.pois.find((p) => p.name === 'Scotty Statue');
  const sx = poi ? poi.x : 64.78, sz = poi ? poi.z : -16.11;
  // face out of Merson Courtyard toward its open south-west side (towards the Cut)
  const tx = 53.5, tz = 5.5;
  const yaw = Math.atan2(tx - sx, tz - sz);
  // base sits on the highest ground point under it so it never floats
  const baseW = 2.0, baseD = 1.05, baseH = 0.46;
  const cs = Math.cos(yaw), sn = Math.sin(yaw);
  let gy = -Infinity, gyMin = Infinity;
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
    const lx = (a * baseD) / 2, lz = (b * baseW) / 2;     // base is long along the dog (local z)
    const h = ctx.heightAt(sx + lx * cs + lz * sn, sz - lx * sn + lz * cs);
    gy = Math.max(gy, h); gyMin = Math.min(gyMin, h);
  }
  const root = new THREE.Group();
  root.name = 'landmark:scotty';
  root.position.set(sx, gy, sz);
  root.rotation.y = yaw;

  const bucket = new PartBucket();
  // ---- granite base (rounded block, doubles as a bench), sunk into the paving on slopes
  const graniteMat = new THREE.MeshStandardMaterial({ map: granitePlinthTexture(ctx.renderer), roughness: 0.3, metalness: 0.05 });
  graniteMat.name = 'scotty-granite';
  const sink = gy - gyMin + 0.1;
  const plinthShape = new THREE.Shape();
  const hw = baseD / 2, hl = baseW / 2, rr = 0.22;
  plinthShape.moveTo(-hw + rr, -hl);
  plinthShape.lineTo(hw - rr, -hl); plinthShape.quadraticCurveTo(hw, -hl, hw, -hl + rr);
  plinthShape.lineTo(hw, hl - rr); plinthShape.quadraticCurveTo(hw, hl, hw - rr, hl);
  plinthShape.lineTo(-hw + rr, hl); plinthShape.quadraticCurveTo(-hw, hl, -hw, hl - rr);
  plinthShape.lineTo(-hw, -hl + rr); plinthShape.quadraticCurveTo(-hw, -hl, -hw + rr, -hl);
  const plinth = new THREE.ExtrudeGeometry(plinthShape, { depth: baseH + sink - 0.03, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 3, curveSegments: 6 });
  plinth.rotateX(-Math.PI / 2);           // extrude along +y
  plinth.translate(0, -sink, 0);
  const plinthUV = ctx.materials?.applyWorldUV ? ctx.materials.applyWorldUV(plinth) : plinth;
  bucket.add(graniteMat, plinthUV);

  // plaque on the front face
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.19), new THREE.MeshStandardMaterial({ map: plaqueTexture(ctx.renderer), metalness: 0.7, roughness: 0.4 }));
  plaque.position.set(0, baseH * 0.5, hl + 0.031);
  plaque.name = 'scotty-plaque';
  root.add(plaque);

  root.add(bucket.build({ name: 'scotty' }));

  // ---- bronze dog (SDF sculpt with fur locks). Loading builds only a low-poly stand-in from the same
  // primitives; the sculpt is meshed afterwards in idle time (or at once when the camera comes near) and
  // replaces it within SCOTTY_LOD_FAR metres.
  const prims = scottyPrims();
  const field = primField(prims, 0.05);
  const dark = new THREE.Color('#2b1f15'), mid = new THREE.Color('#5b4128'), hi = new THREE.Color('#8a6a3e');
  const gold = new THREE.Color('#e1b766'), eye = new THREE.Color('#120d09');
  const bounds = { min: field.bounds.min.map((v) => v - 0.05), max: field.bounds.max.map((v) => v + 0.05) };
  const bronzeMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.78, roughness: 0.4, envMapIntensity: 1.1 });
  bronzeMat.name = 'scotty-bronze';
  const dogMesh = (geo, name) => {
    const m = new THREE.Mesh(geo, bronzeMat);
    m.scale.setScalar(1.15);                  // roughly 3x life size
    m.castShadow = true; m.receiveShadow = true;
    m.name = name;
    return m;
  };
  // distant stand-in: the same primitives as plain low-poly shapes (< 1 ms, ~2k triangles)
  const coarseGeo = primProxyGeometry(prims, [dark.clone().lerp(mid, 0.72), gold, eye], { minSize: 0.02 });
  const dogLod = makeLOD(dogMesh(coarseGeo, 'scotty:bronze-coarse'), SCOTTY_LOD_FAR);
  dogLod.name = 'scotty:bronze';
  dogLod.position.y = baseH;
  root.add(dogLod);

  const voxel = { low: 0.026, medium: 0.02 }[ctx.quality?.level] || 0.016;
  deferRefine(ctx, {
    name: 'scotty',
    anchor: [sx, gy + baseH + 0.6, sz],
    near: SCOTTY_LOD_FAR + 50,
    *steps() {
      const noise = makeNoise3(8);
      const dist = (x, y, z) => {
        let d = field.dist(x, y, z);
        if (d < 0.05) {
          // sculpted fur: long vertical locks on skirt/beard/legs, finer tufts elsewhere
          const locks = noise(x * 30, y * 7, z * 30) * 0.0075 + noise(x * 55 + 3, y * 16, z * 55) * 0.0025;
          const skirt = y < 0.4 ? 1.3 : 1;
          d += locks * skirt;
        }
        return d;
      };
      const tmp = new THREE.Color();
      return yield* meshSDFSteps(dist, {
        ...bounds, voxel,
        color: (x, y, z, nx, ny, nz, out) => {
          const c = field.nearest(x, y, z);
          if (c === POLISHED) { out[0] = gold.r; out[1] = gold.g; out[2] = gold.b; return; }
          if (c === EYE) { out[0] = eye.r; out[1] = eye.g; out[2] = eye.b; return; }
          // cavity term: how "open" the surface is 3 cm out along the normal -> patina collects in crevices
          const open = Math.max(0, Math.min(1, dist(x + nx * 0.035, y + ny * 0.035, z + nz * 0.035) / 0.035));
          const top = Math.max(0, ny) * 0.5;
          tmp.copy(dark).lerp(mid, open).lerp(hi, Math.max(0, open - 0.55) * top * 1.6);
          out[0] = tmp.r; out[1] = tmp.g; out[2] = tmp.b;
        },
      });
    },
    apply(geo) { dogLod.setFine(dogMesh(geo, 'scotty:bronze-sculpt')); },
  });

  // ---- collider, pick, label
  ctx.colliders?.addBox(sx, sz, hw + 0.05, hl + 0.05, yaw, gyMin - 0.5, gy + baseH + 1.1, 'scotty');
  registerLandmark(ctx, def, root, { position: [sx, gy + 1.0, sz], radius: 1.6, labelY: 0.9, priority: 7 });
  return root;
}

const SCOTTY_DEF = {
  key: 'scotty',
  name: 'Scotty Statue',
  nameZh: 'Scotty 铜像',
  osmIds: [],
  build(ctx) { return buildScotty(ctx, SCOTTY_DEF); },
};

export default [SCOTTY_DEF];
