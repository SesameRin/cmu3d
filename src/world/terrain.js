// Terrain: heightfield mesh in 128×128-cell chunks with four levels of detail (vertex stride 1–8 cells by distance;
// all built during loading on medium / high, on demand on low; curtains hide the cracks between levels) + a
// low-detail skirt of concentric rings that continues the terrain 3.2 km beyond the data bounds (edge heights
// blending into synthetic hills) and fades into the fog. One MeshStandardMaterial shades it all (onBeforeCompile):
//   · painted ground texture in two levels (ground-painter.js): 'far' covers the whole data (painted once at
//     start-up, in far mode) and carries the road / field markings; 'near' is a ~450 m window around the camera
//     at ~0.22 m per pixel in a wrap-around texture, painted tile by tile (paced, nearest first) as the camera
//     moves (createNearLevel) — sharp ground wherever one walks. It has NO markings: within CORE_FADE of the camera those are crisp decal
//     geometry (roads.js), beyond it the far level takes over;
//   · a detail-type mask (vegetation / asphalt / hard / soil) selecting world-space close-up detail;
//   · outside the data: a procedural, band-limited "Pittsburgh" (wooded slopes, street-grid neighbourhoods);
//   · seasons ('env:season'): grass tint, fallen leaves, bare winter canopy, snow with cleared walks; ground snow
//     also builds up while the weather is 'snow' (env state), whatever the season;
//   · crisp lawn / path borders near the camera (edge field from the near mask), night street lights outside;
//   · 3D grass blades on the lawns around the camera (high / medium, createGrass);
//   · 3D surroundings on the first ~400 m of the skirt (buildSkirtContent): trees, houses on the painted lots and
//     the mapped roads that leave the data, with land use continuing the data along each stretch of its edge.
// Contract: ARCHITECTURE.md §terrain. ctx.terrain = { mesh (Group), material, heightAt, normalAt, extHeightAt
//   (continues beyond the grid), meshHeightAt (exact LOD-0 triangle surface), raycast(origin, dir), bounds,
//   coreRect (the near level's current window, null before its first paint), groundTexture (far level),
//   groundTextures, minimapCanvas (1024 px top-down ground), uniforms, setSeason(s), stats, groundData (classified
//   roads/paths/areas shared with roads.js), surroundings (Group), near ({ rect(), update(force), stats }) }.
//   After a WebGL context loss the released far canvases are repainted when the context is restored.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pointInRing } from '../core/heightfield.js';
import { paintGround, paintRegion, tileNoise, mulberry, resamplePolyline, RAIL_GONE } from './ground-painter.js';
import { waterBodies } from './water.js';
import { extendedBridgeRoads } from './bridges.js';

const SKIRT_OFFSETS = [0, 6, 14, 26, 42, 64, 94, 134, 186, 254, 340, 450, 590, 770, 1000, 1290, 1650, 2100, 2600, 3200];
// The sharp 'near' ground level: a square window of `m` metres painted at `px` pixels, following the camera
// (moved in steps of m / 8; only the newly exposed strips are painted, into a wrap-around canvas). It replaces
// the fixed campus / Oakland levels of earlier versions: sharp ground wherever one goes on the (now 3.3 × 3.1 km)
// map, and nothing of it to paint at start-up.
const NEAR = { high: { px: 2048, m: 448 }, medium: { px: 2048, m: 512 }, low: { px: 1024, m: 384 } };
const NEAR_MAX_H = 420; // camera height above the ground up to which the near level is kept up to date (m)
const CHUNK = { low: 128, medium: 128, high: 128 }; // cells per terrain chunk side (bigger chunks = fewer draw calls; the GPU easily takes the extra triangles)
// Terrain chunk levels of detail: vertex stride 1 / 2 / 4 / 8 cells, switched by the distance from the camera to
// the chunk (LOD 0 — the exact surface meshHeightAt describes, which the road decals are draped on — reaches
// beyond the marking range). Chunks hang a short curtain from their edges that hides the cracks between levels.
const LOD_DIST = { high: [520, 1000, 1800], medium: [480, 900, 1600], low: [340, 700, 1300] };
export const CORE_FADE = [300, 400]; // sharp level → far ground texture cross-fade distance (m)
// Road / field markings: crisp decals (roads.js) within MARK_RANGE of the camera, the far level's painted
// markings fading in over its last 100 m. The decal tiles and the shader take their range from here.
export const MARK_RANGE = { low: 250, medium: 400, high: 400 };
export const markRange = (ctx) => MARK_RANGE[ctx.quality?.level] || 400;

// ---------------------------------------------------------------------------------------------------------------
// smooth hash value noise for the synthetic hills outside the data
function hash2(i, j) {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}
function fbm(x, z) {
  return 0.5 * vnoise(x, z) + 0.3 * vnoise(x * 2.07 + 5.2, z * 2.07 + 1.3) + 0.2 * vnoise(x * 4.3 + 9.1, z * 4.3 + 7.7);
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------------------------------------------
// Close-up detail texture (512², RGBA, tileable): R grass, G asphalt aggregate, B concrete/pavers, A smooth fBm.
function makeDetailTexture() {
  const S = 512;
  const grassHi = tileNoise(S, [128, 256], 3, [1, 0.8]);
  const grassLo = tileNoise(S, [16, 32, 64], 4, [1, 0.8, 0.6]);
  const asphLo = tileNoise(S, [32, 64, 128], 6, [1, 0.7, 0.5]);
  const concr = tileNoise(S, [8, 32, 128, 256], 7, [1, 0.6, 0.5, 0.35]);
  const smoothN = tileNoise(S, [4, 8, 16, 32], 8, [1, 0.55, 0.3, 0.15]);
  const d = new Uint8Array(S * S * 4);
  const r = mulberry(12345);
  for (let i = 0; i < S * S; i++) {
    // grass: fine blades (high freq) modulated by clumps; occasional dark gaps between clumps
    let gr = 0.5 + (grassHi[i] - 0.5) * 1.6 + (grassLo[i] - 0.5) * 1.2;
    if (r() < 0.05) gr -= 0.25;
    // asphalt: aggregate — sparse bright and dark stones over low-freq tone
    let as = 0.5 + (asphLo[i] - 0.5) * 0.8;
    const k = r();
    if (k < 0.07) as += 0.35; else if (k < 0.15) as -= 0.3;
    // concrete: soft mottling + pores
    let co = 0.5 + (concr[i] - 0.5) * 1.3;
    if (r() < 0.02) co -= 0.3;
    d[i * 4] = Math.max(0, Math.min(255, gr * 255));
    d[i * 4 + 1] = Math.max(0, Math.min(255, as * 255));
    d[i * 4 + 2] = Math.max(0, Math.min(255, co * 255));
    d[i * 4 + 3] = Math.max(0, Math.min(255, smoothN[i] * 255));
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// Second detail texture (256², tileable): R fallen-leaf speckles, G paver/brick joint pattern (running bond),
// B asphalt cracks (0 = crack), A forest-floor litter.
function makeDetail2Texture() {
  const S = 256;
  const chan = (draw) => {
    const c = document.createElement('canvas');
    c.width = c.height = S;
    // CPU-backed: reading back a GPU canvas would wait for the GPU process to finish all queued canvas work,
    // i.e. the whole ground painting — this way the painting overlaps with the rest of the loading.
    const g = c.getContext('2d', { willReadFrequently: true });
    draw(g);
    return g.getImageData(0, 0, S, S).data;
  };
  const wrapDraw = (g, x, y, fn) => { for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S]) fn(x + ox, y + oy); };
  const r = mulberry(4242);
  // (the speckle channels are rasterised on the CPU: thousands of tiny canvas ellipses cost ~30 ms of calls)
  const leaves = stampEllipses(S, 0, 520, () => { const x = r() * S, y = r() * S, rad = 2.2 + r() * 2.6, rot = r() * Math.PI; return [x, y, rad * 1.6, rad, rot, 110 + ((r() * 145) | 0)]; });
  const pavers = chan((g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    const pw = S / 4, ph = S / 8; // 0.3 × 0.15 m at a 1.2 m tile
    for (let row = 0; row < 8; row++) {
      for (let k = -1; k < 5; k++) {
        const x = k * pw + (row % 2) * pw / 2, v = 170 + ((r() * 70) | 0);
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x + 1.5, row * ph + 1.5, pw - 3, ph - 3);
      }
    }
  });
  const cracks = chan((g) => {
    g.fillStyle = '#fff'; g.fillRect(0, 0, S, S);
    g.strokeStyle = '#000'; g.lineCap = 'round';
    for (let i = 0; i < 7; i++) {
      let x = r() * S, y = r() * S, a = r() * Math.PI * 2;
      g.lineWidth = 0.8 + r() * 1.2;
      g.globalAlpha = 0.5 + r() * 0.5;
      const pts = [[x, y]];
      for (let k = 0; k < 18; k++) { a += (r() - 0.5) * 1.2; x += Math.cos(a) * 6; y += Math.sin(a) * 6; pts.push([x, y]); }
      wrapDraw(g, 0, 0, (ox, oy) => { g.beginPath(); g.moveTo(pts[0][0] + ox, pts[0][1] + oy); for (const p of pts) g.lineTo(p[0] + ox, p[1] + oy); g.stroke(); });
    }
    g.globalAlpha = 1;
  });
  const litter = stampEllipses(S, 128, 900, () => { const x = r() * S, y = r() * S, rad = 1 + r() * 3, v = (r() * 255) | 0; return [x, y, rad * 2, rad, r() * 3, v]; });
  const d = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    d[i * 4] = leaves[i]; d[i * 4 + 1] = pavers[i * 4]; d[i * 4 + 2] = cracks[i * 4]; d[i * 4 + 3] = litter[i];
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// Tileable single-channel field of anti-aliased filled ellipses over a background value (drawn in order, each
// covering what is below). next() → [x, y, radiusX, radiusY, rotation, value 0..255].
function stampEllipses(S, bg, n, next) {
  const buf = new Float32Array(S * S).fill(bg);
  for (let i = 0; i < n; i++) {
    const [x, y, ra, rb, rot, v] = next();
    const ca = Math.cos(rot), sa = Math.sin(rot), ext = Math.ceil(Math.max(ra, rb)) + 1;
    for (let py = Math.floor(y - ext); py <= Math.ceil(y + ext); py++) {
      const row = (((py % S) + S) % S) * S;
      for (let px = Math.floor(x - ext); px <= Math.ceil(x + ext); px++) {
        const dx = px + 0.5 - x, dy = py + 0.5 - y;
        const u = (dx * ca + dy * sa) / ra, w = (-dx * sa + dy * ca) / rb;
        const cov = Math.min(1, (1 - Math.sqrt(u * u + w * w)) * Math.min(ra, rb) + 0.5);
        if (cov <= 0) continue;
        const k = row + (((px % S) + S) % S);
        buf[k] += (v - buf[k]) * cov;
      }
    }
  }
  return buf;
}

// ---------------------------------------------------------------------------------------------------------------
const SEASONS = {
  spring: { tint: [0.93, 1.06, 0.88], leaves: 0.0, snow: 0, bare: 0 },
  summer: { tint: [1, 1, 1], leaves: 0.0, snow: 0, bare: 0 },
  autumn: { tint: [1.05, 1.0, 0.86], leaves: 0.3, snow: 0, bare: 0 },
  winter: { tint: [1.1, 0.96, 0.8], leaves: 0.12, snow: 0.85, bare: 0.85 },
};
const SNOWFALL_COVER = 0.4; // ground snow reached during snowfall outside winter
// 3D content on the procedural surroundings: trees up to `trees` m beyond the data edge (thinning out from
// `treesFull`), houses up to `houses` m (the painted roofs take over beyond).
const SKIRT_3D = { trees: 400, treesFull: 190, houses: 420 };
const SKIRT_LOOKUP_OUT = Math.max(SKIRT_3D.trees, SKIRT_3D.houses) + 260; // exact skirt surface lookup reach (m)
// Mapped railways leaving the data are drawn this far out over the skirt (rail.js); the surroundings keep clear.
export const RAIL_OUT = 300;

// Procedural Pittsburgh beyond the mapped data: wooded hillsides, and on flatter ground the street grids of
// tree-shaded neighbourhoods with house roofs and the odd park. Everything is band-limited by the pixel
// footprint `fp` (metres per pixel): features that get smaller than a few pixels fade to their mean colour, so
// nothing shimmers from far away. Colours are linear.
const OUTER_GLSL = /* glsl */`
  float gHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  // anti-aliased band |d| < hw for a pixel footprint fp; tends to the band's mean coverage once unresolvable
  float gBand(float d, float hw, float fp, float period) {
    float c = 1.0 - smoothstep(hw - 0.5 * fp, hw + 0.5 * fp, abs(d));
    return mix(c, min(1.0, 2.0 * hw / period), smoothstep(0.15 * period, 0.5 * period, fp));
  }
  // position along the data rectangle's perimeter (0..1) of the nearest edge point
  float gPerim(vec2 wp) {
    vec2 r = clamp(wp - uDataRect.xy, vec2(0.0), uDataRect.zw);
    float W = uDataRect.z, H = uDataRect.w;
    float dT = r.y, dR = W - r.x, dB = H - r.y, dL = r.x;
    float m = min(min(dT, dR), min(dB, dL));
    float t = m == dT ? r.x : m == dR ? W + r.y : m == dB ? 2.0 * W + H - r.x : 2.0 * W + 2.0 * H - r.y;
    return t / (2.0 * (W + H));
  }
  // dOut = distance outside the data rectangle (m); emit = night lighting (street lamps, lit windows)
  vec3 outerGround(vec2 wp, vec3 n, float fp, float dOut, out vec3 omask, out vec3 emit) {
    mat2 R1 = mat2(0.8, 0.6, -0.6, 0.8), R2 = mat2(0.28, -0.96, 0.96, 0.28);
    // low-frequency land use (negative LOD bias: coarse mips of the noise would show blocky threshold edges)
    float nBig = texture(uDetail, wp / 3100.0 + vec2(0.13, 0.71), -4.0).a;
    float nMid = texture(uDetail, R1 * wp / 870.0 + 0.4, -4.0).a;
    float nSm = texture(uDetail, R2 * wp / 230.0 + 0.2, -3.0).a;
    float flatness = smoothstep(0.93, 0.972, n.y);
    float town = flatness * smoothstep(0.43, 0.52, nBig * 0.6 + nMid * 0.4 + (nSm - 0.5) * 0.15);
    // Near the data the land use continues what the data shows along the nearest stretch of its edge
    // (uEdgeLU: built-up share per perimeter position, terrain.js) — the Schenley Park woods go on as woods,
    // Squirrel Hill / Shadyside / Oakland as streets and houses; further out the noise decides.
    float eT = texture(uEdgeLU, vec2(gPerim(wp), 0.5)).r;
    town = mix(town, eT * smoothstep(0.8, 0.9, n.y), (1.0 - smoothstep(180.0, 650.0, dOut)) * 0.9);
    float park = town * smoothstep(0.64, 0.72, nMid) * 0.9;
    // beyond the 3D surroundings (SKIRT_3D) the neighbourhoods fade towards what they are from afar — leafy,
    // with the street grid no longer reading as a regular pattern of light and dark blocks
    float farOut = smoothstep(420.0, 1100.0, dOut);
    // street grid; its orientation changes from district to district
    float sel = step(0.5, texture(uDetail, wp / 5300.0 + 0.27, -4.0).a);
    float ang = mix(0.21, -0.52, sel);
    float ca = cos(ang), sa = sin(ang);
    vec2 q = mat2(ca, sa, -sa, ca) * wp + sel * vec2(37.0, 11.0);
    // gentle domain warp so streets bend and blocks vary like Pittsburgh's hill-hugging grids
    q += (vec2(texture(uDetail, wp / 1700.0 + 0.33, -4.0).a, texture(uDetail, wp / 1700.0 + 0.71, -4.0).a) - 0.5) * 110.0;
    vec2 blk = vec2(104.0, 66.0);
    vec2 de = 0.5 * blk - abs((fract(q / blk) - 0.5) * blk);    // distance to the street centre lines
    float street = 1.0 - (1.0 - gBand(de.x, 4.2, fp, blk.x)) * (1.0 - gBand(de.y, 4.2, fp, blk.y));
    float verge = 1.0 - (1.0 - gBand(de.x, 6.3, fp, blk.x)) * (1.0 - gBand(de.y, 6.3, fp, blk.y));
    // (far out the grid would only alias into a fine regular grain at grazing angles: it fades to the mean tone)
    street *= 1.0 - 0.85 * farOut;
    verge *= 1.0 - 0.9 * farOut;
    // houses: two rows of lots per block, each facing its street, set back behind a front yard
    vec2 lot = vec2(13.0, 0.5 * blk.y);
    vec2 lid = floor(q / lot);
    vec2 lf = q - (lid + 0.5) * lot;
    float h = gHash(lid + sel * 17.0);
    float side = mod(lid.y, 2.0) < 0.5 ? -1.0 : 1.0;
    vec2 hc = vec2((h - 0.5) * 1.6, side * (0.5 * lot.y - 13.0));
    vec2 hs = vec2(4.1, 5.3) * (0.85 + 0.35 * fract(h * 7.13));
    float far = smoothstep(3.0, 9.0, fp);
    float hx = 1.0 - smoothstep(hs.x - 0.5 * fp, hs.x + 0.5 * fp, abs(lf.x - hc.x));
    float hy = 1.0 - smoothstep(hs.y - 0.5 * fp, hs.y + 0.5 * fp, abs(lf.y - hc.y));
    float house = mix(hx * hy * step(0.16, h), 0.17, max(far, 0.8 * farOut)); // (the lot grid fades out far out)
    vec3 roof = h < 0.45 ? vec3(0.05, 0.05, 0.055) : h < 0.68 ? vec3(0.11, 0.05, 0.036) : h < 0.87 ? vec3(0.16, 0.15, 0.14) : vec3(0.085, 0.075, 0.065);
    roof *= 1.0 - 0.3 * smoothstep(0.2 * hs.x, hs.x, abs(lf.x - hc.x)) * step(0.5, fract(h * 3.7)); // gable shading
    roof = mix(roof, vec3(0.085, 0.066, 0.06), far);
    // close to the data the houses are real 3D instances (terrain.js → skirt content) standing on these very
    // footprints: only a dark footing / contact shade stays painted there
    float h3 = 1.0 - smoothstep(uHouse3D.x, uHouse3D.y, dOut);
    roof = mix(roof, vec3(0.04, 0.05, 0.032), h3);
    // tree canopy blobs + individual crowns (mipmapped noise, no aliasing)
    float cn = texture(uDetail, R1 * wp / 26.0).a * 0.55 + texture(uDetail, R2 * wp / 9.7 + 0.3).a * 0.45;
    float crowns = texture(uDetail, wp / 6.3 + 0.7).a;
    float canTown = smoothstep(0.43, 0.54, cn + (nSm - 0.5) * 0.3);
    float cover = mix(0.95, canTown * 0.93, town);
    cover = mix(cover, canTown * 0.35, park);
    cover = mix(cover, max(cover, 0.5 + 0.35 * nSm), farOut * (1.0 - 0.5 * park));
    float cv = texture(uDetail, R2 * wp / 47.0 + 0.61, -1.0).a;
    vec3 canopy = mix(vec3(0.024, 0.04, 0.015), vec3(0.05, 0.07, 0.024), cv) * (0.65 + 0.7 * crowns);
    canopy *= 1.0 + farOut * (nMid - 0.5) * 0.5; // (patchy woods on the far hills)
    // beyond the 3D tree belt, painted crowns seen from afar show their shaded sides too (as the 3D ones do)
    canopy *= 1.0 - 0.22 * smoothstep(250.0, 520.0, dOut);
    // fake crown relief: treat the canopy noise as a height field and shade its slopes facing away from the sun
    // (emboss towards the sun; the offset grows as the sun sinks). Mipmapped, so it flattens out with distance.
    vec2 so = uSunDir.xz / max(uSunDir.y, 0.25) * 2.2;
    float cnS = texture(uDetail, R1 * (wp + so) / 26.0).a * 0.55 + texture(uDetail, R2 * (wp + so) / 9.7 + 0.3).a * 0.45;
    float rel = clamp((cnS - cn) * 7.0, -1.0, 1.0);
    canopy *= 1.0 - 0.38 * max(rel, 0.0) + 0.14 * max(-rel, 0.0);
    float au = uLeaves * smoothstep(0.52, 0.72, texture(uDetail, R1 * wp / 33.0 + 0.17).a);
    canopy = mix(canopy, mix(vec3(0.17, 0.05, 0.012), vec3(0.22, 0.12, 0.018), cv) * (0.7 + 0.6 * crowns), au * 0.85);
    canopy = mix(canopy, vec3(0.065, 0.055, 0.045) * (0.75 + 0.5 * crowns), uBare);
    // (lawn tones close to the painted campus grass, so the surroundings continue it without a colour step)
    vec3 lawn = mix(vec3(0.07, 0.115, 0.034), vec3(0.092, 0.14, 0.044), nSm);
    lawn = mix(lawn, vec3(0.095, 0.155, 0.045), park);
    lawn = mix(lawn, vec3(0.052, 0.072, 0.036) * (0.8 + 0.4 * nMid), farOut * 0.55);
    vec3 townCol = mix(lawn, roof, house * (1.0 - park) * mix(1.0, 0.22, h3));
    townCol = mix(townCol, vec3(0.11, 0.105, 0.097), verge * (1.0 - park) * 0.45);
    townCol = mix(townCol, vec3(0.045, 0.047, 0.05), street * (1.0 - park * 0.85) * 0.9);
    vec3 col = mix(lawn, townCol, town);
    float treeHide = cover * (1.0 - street * town * 0.6);
    col = mix(col, canopy, treeHide);
    // detail mask for the close-up shader: canopy/lawn = vegetation, streets = asphalt, roofs/sidewalks = hard
    float st = street * town * (1.0 - treeHide);
    omask = vec3(0.5 * (1.0 - st), st, house * town * (1.0 - treeHide) * 0.5);
    // night: warm pools of street light every 32 m along the streets, and lit windows in some of the painted
    // houses (the 3D ones near the data have their own). Both average out once they are below pixel size.
    emit = vec3(0.0);
    if (uNight > 0.01) {
      float sp = 32.0;
      float dl = min(length(vec2((fract(q.x / sp) - 0.5) * sp, de.y)), length(vec2((fract(q.y / sp) - 0.5) * sp, de.x)));
      float pool = 1.0 - smoothstep(0.6, 4.2 + fp, dl);
      pool = mix(pool * pool, 0.02, smoothstep(5.0, 16.0, fp));
      float lamps = pool * town * (1.0 - park) * (1.0 - 0.7 * treeHide);
      float lit = step(0.5, fract(h * 13.7)) * mix(hx * hy * step(0.16, h) * (0.6 + 0.4 * step(0.5, fract(h * 29.3))), 0.05, far);
      lit *= town * (1.0 - park) * (1.0 - treeHide) * (1.0 - h3);
      emit = uNight * (vec3(1.0, 0.66, 0.32) * lamps * 0.85 + vec3(1.0, 0.78, 0.48) * lit * 0.28);
    }
    return col;
  }
`;

// Crisp grass ↔ path / plaza / sidewalk borders near the camera, against the sharp painted level.
// Their textures have 0.2–0.25 m texels, so up close every border is a soft ramp. The level mask's vegetation
// channel is used as an edge field: its 0.5 iso-line is the border, (r - 0.5) / |∇r| the signed distance to it.
// On each side the colour / mask are re-sampled 0.55 m away from the border and chosen with a pixel-wide step
// at the true border, plus a thin darker soil line. Only for lawn (r ≈ 1) against hard or bare ground (r ≈ 0):
// wood edges stay soft.
// The near level's slot table (createNearLevel): texel (i mod n, j mod n) holds the world tile (i, j) painted into that
// slot of the wrap-around textures. gNearOk: 1 where the tile under p is painted. gNearW: weight of the near level —
// 0 outside painted tiles, fading from the centres of the outermost painted tiles to their outer edges (the old
// window edge fade; it also hides the seam next to a tile that is not painted yet).
const NEAR_GLSL = /* glsl */`
  uniform sampler2D uNearTiles;
  uniform vec2 uNearTile; // (tile size m, tiles per side)
  float gTileOk(vec2 t) {
    vec2 v = texelFetch(uNearTiles, ivec2(mod(t, uNearTile.y)), 0).rg;
    return step(abs(v.x - t.x) + abs(v.y - t.y), 0.25);
  }
  float gNearOk(vec2 p) { return gTileOk(floor(p / uNearTile.x)); }
  // the near colour texture stores sRGB values (plain RGBA8): decode after filtering
  vec3 gNearRGB(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }
  float gNearW(vec2 p) {
    vec2 q = p / uNearTile.x;
    if (gTileOk(floor(q)) < 0.5) return 0.0;
    vec2 c = q - 0.5, b = floor(c), f = c - b;
    float v = mix(mix(gTileOk(b), gTileOk(b + vec2(1.0, 0.0)), f.x), mix(gTileOk(b + vec2(0.0, 1.0)), gTileOk(b + vec2(1.0, 1.0)), f.x), f.y);
    return clamp(v * 2.0 - 1.0, 0.0, 1.0);
  }
`;
const EDGE_GLSL = /* glsl */`
  void gCrispEdge(sampler2D map, sampler2D msk, vec4 rect, float w, vec2 wp, float vd, float fp, inout vec3 gcol, inout vec3 gm, inout float edgeLine) {
    vec2 uv = (wp - rect.xy) / rect.zw;
    float r0 = textureLod(msk, uv, 0.0).r;
    if (r0 <= 0.03 || r0 >= 0.97) return;
    vec2 eh = vec2(0.3) / rect.zw;
    float rxp = textureLod(msk, uv + vec2(eh.x, 0.0), 0.0).r, rxm = textureLod(msk, uv - vec2(eh.x, 0.0), 0.0).r;
    float rzp = textureLod(msk, uv + vec2(0.0, eh.y), 0.0).r, rzm = textureLod(msk, uv - vec2(0.0, eh.y), 0.0).r;
    vec2 gr = vec2(rxp - rxm, rzp - rzm) / 0.6;
    float gl = length(gr);
    if (gl <= 0.35) return;
    vec2 en = gr / gl;                        // towards the lawn
    // (a 5-tap blur of the field smooths the texel-scale wobble of the iso-line)
    float sd = ((2.0 * r0 + rxp + rxm + rzp + rzm) / 6.0 - 0.5) / gl; // signed distance to the border (m), + on the lawn side
    vec2 pe = wp - en * sd;
    vec2 uG = (pe + en * 0.55 - rect.xy) / rect.zw, uH = (pe - en * 0.55 - rect.xy) / rect.zw;
    vec3 mG = textureLod(msk, uG, 0.0).rgb, mH = textureLod(msk, uH, 0.0).rgb;
    float ok = smoothstep(0.75, 0.92, mG.r) * (1.0 - smoothstep(0.08, 0.25, mH.r)) * smoothstep(0.5, 0.8, w)
             * (1.0 - smoothstep(32.0, 45.0, vd)) * step(abs(sd), 0.9);
    if (ok <= 0.0) return;
    float e = smoothstep(-0.6 * fp, 0.6 * fp, sd);
    vec3 cc = gNearRGB(mix(textureLod(map, uH, 0.0).rgb, textureLod(map, uG, 0.0).rgb, e)); // (only used with the near level)
    gcol = mix(gcol, cc, ok);
    gm = mix(gm, mix(mH, mG, e), ok);
    edgeLine = ok * exp(-(sd - 0.02) * (sd - 0.02) / 0.0016) * (1.0 - smoothstep(0.012, 0.035, fp));
  }
  // weight of a painted level: 1 inside its rectangle, ramping to 0 over the last 30 m
  float gRectW(vec2 wp, vec4 r) { vec2 e = min(wp - r.xy, r.xy + r.zw - wp); return clamp(min(e.x, e.y) / 30.0, 0.0, 1.0); }
`;

function makeGroundMaterial(uniforms) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
  mat.name = 'ground';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGPos;\nvarying vec3 vGNrm;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vGNrm = normalize(mat3(modelMatrix) * objectNormal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vGPos;
        varying vec3 vGNrm;
        uniform sampler2D uFarMap, uFarMask, uFarMarks, uNearMap, uNearMask, uDetail, uDetail2;
        uniform vec4 uFarRect, uNearRect, uDataRect;
        uniform float uNearPeriod;
        uniform vec2 uMarkFade;
        uniform vec3 uMarkWhite, uMarkYellow;
        uniform vec3 uGrassTint;
        uniform vec2 uCoreFade;
        uniform float uSnow, uLeaves, uBare, uDetailAmt, uSharpen, uNight;
        uniform vec3 uSunDir;
        uniform vec2 uHouse3D;
        uniform sampler2D uEdgeLU;
        ${OUTER_GLSL}
        ${NEAR_GLSL}
        ${EDGE_GLSL}`)
      .replace('#include <map_fragment>', `
        vec2 wp = vGPos.xz;
        float vd = length(vGPos - cameraPosition);
        float fp = max(length(fwidth(wp)), 1e-3);   // metres per pixel
        vec2 uvF = (wp - uFarRect.xy) / uFarRect.zw;
        // The sharp 'near' level: a window (uNearRect) around the camera in a wrap-around texture that repeats every
        // uNearPeriod metres. It carries no road / field markings: within uMarkFade.x of the camera those are crisp
        // decal geometry (roads.js); further out they come from the far level's own markings texture (uFarMarks),
        // faded in over uMarkFade. Beyond uCoreFade (or outside the window) the far level alone is used.
        vec2 uvN = wp / uNearPeriod;
        float wN = gNearW(wp) * (1.0 - smoothstep(uCoreFade.x, uCoreFade.y, vd));
        vec3 gcol = texture2D(uFarMap, uvF).rgb;
        vec3 gm = texture2D(uFarMask, uvF).rgb;
        if (wN > 0.0) {
          gcol = mix(gcol, gNearRGB(texture2D(uNearMap, uvN).rgb), wN);
          gm = mix(gm, texture2D(uNearMask, uvN).rgb, wN);
        }
        // unsharp mask while the painted texture is magnified (close to the camera) — on luminance only: per
        // channel it overshoots differently in R, G and B and fringes saturated edges (red / white field paint)
        float shp = uSharpen * (1.0 - smoothstep(6.0, 35.0, vd));
        if (shp > 0.001) {
          vec3 blur = mix(texture2D(uFarMap, uvF, 1.3).rgb, gNearRGB(texture2D(uNearMap, uvN, 1.3).rgb), wN);
          const vec3 LUM = vec3(0.2126, 0.7152, 0.0722);
          float l = dot(gcol, LUM), lb = dot(blur, LUM);
          gcol *= max(l + (l - lb) * shp, 0.0) / max(l, 1e-3);
        }

        float edgeLine = 0.0;
        if (uSharpen > 0.0 && vd < 45.0 && wN > 0.5) gCrispEdge(uNearMap, uNearMask, vec4(0.0, 0.0, uNearPeriod, uNearPeriod), wN, wp, vd, fp, gcol, gm, edgeLine);

        // painted road / field markings of the far level, where the decals no longer reach
        vec2 mk = texture2D(uFarMarks, uvF).rg * smoothstep(uMarkFade.x, uMarkFade.y, vd);
        gcol = mix(gcol, uMarkWhite, mk.r);
        gcol = mix(gcol, uMarkYellow, mk.g);

        vec3 gN = normalize(vGNrm);
        // outside the mapped data: procedural neighbourhoods / woods, cross-faded over the last 140 m of data
        vec2 ed = min(wp - uDataRect.xy, uDataRect.xy + uDataRect.zw - wp);
        float wD = clamp(min(ed.x, ed.y) / 140.0, 0.0, 1.0);
        wD = wD * wD * (3.0 - 2.0 * wD);
        // mapped streets stay painted right up to the edge, where their 3D continuation begins (skirt content)
        wD = max(wD, smoothstep(0.45, 0.85, gm.g) * step(0.0, min(ed.x, ed.y)));
        vec3 gEmit = vec3(0.0);
        if (wD < 1.0) {
          vec3 om, oe;
          vec3 outCol = outerGround(wp, gN, fp, length(max(-ed, vec2(0.0))), om, oe);
          gcol = mix(outCol, gcol, wD);
          gm = mix(om, gm, wD);
          gEmit = oe * (1.0 - wD);
        }

        // exposed rock / soil on steep vegetated slopes
        float steep = smoothstep(0.80, 0.60, gN.y) * clamp(gm.r * 1.3, 0.0, 1.0) * mix(0.35, 1.0, wD);
        vec3 rock = mix(vec3(0.15, 0.125, 0.09), vec3(0.27, 0.24, 0.19), texture2D(uDetail, wp / 11.0).a);
        gcol = mix(gcol, rock, steep * 0.5);

        // season tint on vegetation
        gcol = mix(gcol, gcol * uGrassTint, gm.r);

        // close-up detail
        float fade = uDetailAmt * (1.0 - smoothstep(30.0, 230.0, vd));
        float nearF = 1.0 - smoothstep(12.0, 60.0, vd);
        vec4 d1 = texture2D(uDetail, wp * 0.4348);
        vec4 d2 = texture2D(uDetail, wp * 1.4085 + vec2(0.37, 0.61));
        vec4 d3 = texture2D(uDetail, wp * 0.1266 + vec2(0.11, 0.83));
        vec4 e1 = texture2D(uDetail2, wp / 3.0);
        vec4 e2 = texture2D(uDetail2, wp / 1.2 + 0.5);
        vec4 e3 = texture2D(uDetail2, wp / 9.0 + 0.25);
        float soil = clamp(1.0 - gm.r - gm.g - gm.b, 0.0, 1.0);
        // pavers: warm-toned, non-green hard surfaces (plazas, brick walks) get a running-bond joint pattern
        float warm = smoothstep(0.8, 0.68, gcol.b / max(gcol.r, 1e-3)) * smoothstep(1.2, 1.0, gcol.g / max(gcol.r, 1e-3));
        float paver = smoothstep(0.35, 0.75, gm.b) * (1.0 - smoothstep(0.2, 0.45, gm.r)) * warm;
        // forest floor / garden beds (mask R between ~0.4 and ~0.8) get leaf-litter blobs instead of grass blades
        // (not at blurred grass/pavement edges, where the mask also has some G or B)
        float litterW = smoothstep(0.4, 0.5, gm.r) * smoothstep(0.9, 0.75, gm.r) * (1.0 - smoothstep(0.04, 0.16, gm.g + gm.b));
        float det = gm.r * mix((d1.r * 0.45 + d2.r * 0.55) - 0.5, (e1.a - 0.5) * 1.1, litterW) * 0.95
                  + gm.g * ((d2.g * 0.65 + d1.g * 0.35) - 0.5) * 0.6
                  + gm.b * ((d1.b * 0.6 + d2.b * 0.4) - 0.5) * 0.45
                  + soil * ((d2.b * 0.6 + d1.b * 0.4) - 0.5) * 0.4;
        gcol *= 1.0 + det * fade;
        gcol *= mix(1.0, 0.62 + 0.55 * e2.g, paver * nearF);
        gcol *= mix(1.0, 0.62, (1.0 - e3.b) * gm.g * nearF);
        gcol = mix(gcol, gcol * vec3(1.14, 1.06, 0.78), gm.r * fade * smoothstep(0.55, 0.8, d3.r) * 0.55);
        // macro variation (all distances) breaks up large flat areas
        float mac = texture2D(uDetail, wp / 53.0, -2.0).a * 0.5 + texture2D(uDetail, wp / 233.0 + 0.5, -3.0).a * 0.5 - 0.5;
        gcol *= 1.0 + mac * (0.24 * gm.r + 0.08) * wD;
        gcol *= 1.0 - 0.32 * edgeLine; // thin soil / kerb line along crisp lawn borders

        // fallen leaves: individual leaves up close, an averaged tint further away
        float leafDensity = uLeaves * clamp(gm.r * 1.2, 0.0, 1.0) * smoothstep(0.3, 0.75, texture2D(uDetail, wp / 19.0 + 0.4).a) * wD;
        float leafNear = step(0.35, e1.r) * (1.0 - smoothstep(0.0, 1.0, (1.0 - leafDensity) * 1.4 - e1.r * 0.3));
        float leafAmt = mix(leafDensity * 0.35, leafNear, 1.0 - smoothstep(25.0, 70.0, vd));
        vec3 leafC = mix(vec3(0.40, 0.11, 0.025), vec3(0.58, 0.36, 0.05), e1.r * 1.3 - 0.3) * (0.7 + 0.3 * d2.r);
        gcol = mix(gcol, leafC, clamp(leafAmt, 0.0, 1.0) * 0.9);

        // snow
        // (walks and roads are cleared: only a thin dusting stays on hard surfaces)
        float snow = uSnow * smoothstep(0.55, 0.85, gN.y) * (1.0 - gm.g * 0.92) * (1.0 - gm.b * 0.75);
        snow *= smoothstep(0.3, 0.5, texture2D(uDetail, wp / 13.0).a * 0.55 + uSnow * 0.55 - (1.0 - gm.r) * 0.15);
        gcol = mix(gcol, gcol * 0.72, uSnow * gm.g);
        gcol = mix(gcol, vec3(0.8, 0.84, 0.9) * (0.88 + 0.08 * d1.a + 0.06 * mac), snow);

        diffuseColor.rgb *= gcol;
      `)
      .replace('#include <roughnessmap_fragment>', `
        float roughnessFactor = roughness;
        roughnessFactor = mix(roughnessFactor, 0.82, gm.g * (1.0 - snow));
        roughnessFactor = mix(roughnessFactor, 0.6, snow * 0.6 + uSnow * gm.g * 0.4);
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += gEmit;`);
  };
  mat.customProgramCacheKey = () => 'cmu-ground-v9';
  return mat;
}

// ---------------------------------------------------------------------------------------------------------------
export async function createTerrain(ctx) {
  const T0 = performance.now();
  const steps = {}; // per-step ms (stats.steps)
  let tLast = T0;
  const mark = (k) => { const t = performance.now(); steps[k] = Math.round(t - tLast); tLast = t; performance.mark?.('terrain:' + k); };
  let skirtContent = null; // 3D trees / houses / roads on the surroundings (built after the skirt mesh)
  const hf = ctx.heightfield;
  const { width: GW, height: GH, cellSize: CS } = hf;
  const B = { minX: hf.minX, minZ: hf.minZ, maxX: hf.minX + (GW - 1) * CS, maxZ: hf.minZ + (GH - 1) * CS };

  // In the stand-alone harness a placeholder terrain may already exist — hide it.
  if (ctx.terrain?.mesh && ctx.terrain.mesh.parent) ctx.terrain.mesh.visible = false;

  // ---------------------------------------------------------------- extended height function
  // Anchors: bridge ends that lie outside the grid pull the synthetic terrain up to deck level — but only where
  // the deck approaches the data edge on high ground. A bridge that leaves the data mid-span (the Charles
  // Anderson Bridge over Junction Hollow) must not raise an earth dam across the hollow under it: if the ground
  // below its in-grid part near the edge lies well below the deck, no anchor. (Clipped decks are extended to their
  // real far end first, as bridges.js builds them.)
  const anchors = [];
  const inB = (p) => p[0] >= B.minX && p[0] <= B.maxX && p[1] >= B.minZ && p[1] <= B.maxZ;
  const edgeIn = (x, z) => Math.min(x - B.minX, B.maxX - x, z - B.minZ, B.maxZ - z);
  const extBridges = extendedBridgeRoads(ctx.data, B);
  for (const r of ctx.data.roads) {
    if (!r.bridge || r.tunnel) continue;
    const pts = extBridges.get(r.id) || r.points;
    const a = pts[0], b = pts[pts.length - 1];
    if (inB(a) === inB(b)) continue;
    const [pin, pout] = inB(a) ? [a, b] : [b, a];
    const deck = hf.heightAt(pin[0], pin[1]);
    let minG = Infinity;
    for (const q of resamplePolyline(pts, 4)) if (inB([q.x, q.z]) && edgeIn(q.x, q.z) < 40) minG = Math.min(minG, hf.heightAt(q.x, q.z));
    if (minG < deck - 6) continue;
    const beyond = Math.hypot(Math.max(B.minX - pout[0], 0, pout[0] - B.maxX), Math.max(B.minZ - pout[1], 0, pout[1] - B.maxZ));
    anchors.push({ x: pout[0], z: pout[1], h: deck - 0.4, r: Math.max(10, Math.min(70, 2 * beyond)) });
  }
  let edgeSum = 0, edgeN = 0;
  for (let i = 0; i < GW; i += 4) { edgeSum += hf.heights[i] + hf.heights[(GH - 1) * GW + i]; edgeN += 2; }
  for (let j = 0; j < GH; j += 4) { edgeSum += hf.heights[j * GW] + hf.heights[j * GW + GW - 1]; edgeN += 2; }
  const farBase = edgeSum / edgeN;
  const clampX = (x) => Math.min(B.maxX, Math.max(B.minX, x));
  const clampZ = (z) => Math.min(B.maxZ, Math.max(B.minZ, z));

  function extHeightAt(x, z) {
    if (x >= B.minX && x <= B.maxX && z >= B.minZ && z <= B.maxZ) return hf.heightAt(x, z);
    const cx = clampX(x), cz = clampZ(z);
    const dx = x - cx, dz = z - cz;
    const d = Math.hypot(dx, dz);
    // blurred edge height: a weighted average of the data edge around the nearest edge point, sampled along the
    // edge (diagonally in the corner regions) with a spread that grows with the distance — removes streaks
    const tx = dz !== 0 ? 1 : 0, tz = dx !== 0 ? (dz !== 0 ? -1 : 1) : 0;
    const step = (d * 0.7) / 3;
    let e = 0, wsum = 0;
    for (let k = -3; k <= 3; k++) {
      const w = 1 - Math.abs(k) / 4;
      e += hf.heightAt(clampX(cx + tx * k * step), clampZ(cz + tz * k * step)) * w;
      wsum += w;
    }
    e /= wsum;
    // synthetic rolling hills far away (Pittsburgh is hilly), gently rising towards the horizon
    const far = farBase - 6 + (fbm(x / 650, z / 650) - 0.45) * 55 + smooth(1400, 3200, d) * 30;
    const t = smooth(0, 1100, d);
    let h = e * (1 - t) + far * t;
    if (anchors.length) {
      const h0 = h;
      for (const a of anchors) {
        const ad = Math.hypot(x - a.x, z - a.z);
        if (ad < a.r * 2) h += (a.h - h) * Math.exp(-(ad * ad) / (a.r * a.r));
      }
      // never a step at the data edge: within 30 m of it the terrain stays within ±4 m of the edge height
      const dev = 4 + Math.max(0, d - 30) * 0.6;
      h = Math.min(h0 + dev, Math.max(h0 - dev, h));
    }
    return h;
  }

  // ---------------------------------------------------------------- grid heights (+ carved pond beds)
  mark("anchors");
  const H = new Float32Array(hf.heights);
  for (const w of waterBodies(ctx)) {
    if (w.kind !== 'pond') continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of w.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let j = Math.max(0, Math.floor((z0 - B.minZ) / CS) - 1); j <= Math.min(GH - 1, Math.ceil((z1 - B.minZ) / CS) + 1); j++) {
      for (let i = Math.max(0, Math.floor((x0 - B.minX) / CS) - 1); i <= Math.min(GW - 1, Math.ceil((x1 - B.minX) / CS) + 1); i++) {
        const x = B.minX + i * CS, z = B.minZ + j * CS;
        if (!pointInRing(x, z, w.ring)) continue;
        let dEdge = Infinity;
        for (let a = 0, b = w.ring.length - 1; a < w.ring.length; b = a++) {
          const [ax, az] = w.ring[b], ex = w.ring[a][0] - ax, ez = w.ring[a][1] - az;
          const l2 = ex * ex + ez * ez || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
          dEdge = Math.min(dEdge, Math.hypot(x - ax - ex * t, z - az - ez * t));
        }
        H[j * GW + i] = Math.min(H[j * GW + i], w.level - 0.2 - Math.min(1.6, dEdge * 0.35));
      }
    }
  }
  // Exact height of the rendered terrain mesh (same triangulation as the chunks below) — for decals draped on it.
  // Beyond the grid: the rendered skirt out to SKIRT_LOOKUP_OUT (a lookup built on first use), then extHeightAt.
  let skirtGeo = null, skirtLook = null;
  const skirtLookup = () => {
    if (!skirtLook && skirtGeo) {
      const it = skirtSurface(skirtGeo, B, SKIRT_LOOKUP_OUT);
      let r;
      do { r = it.next(); } while (!r.done);
      skirtLook = r.value;
    }
    return skirtLook;
  };
  function meshHeightAt(x, z) {
    const fx = (x - B.minX) / CS, fz = (z - B.minZ) / CS;
    if (fx < 0 || fz < 0 || fx > GW - 1 || fz > GH - 1) {
      const s = skirtGeo ? skirtLookup()?.(x, z) : null;
      return s ? s.y : extHeightAt(x, z);
    }
    const i = Math.min(GW - 2, Math.floor(fx)), j = Math.min(GH - 2, Math.floor(fz));
    const u = fx - i, v = fz - j;
    const k = j * GW + i;
    const ha = H[k], hb = H[k + 1], hc = H[k + GW], hd = H[k + GW + 1];
    if (Math.abs(ha - hd) < Math.abs(hb - hc)) {
      return v >= u ? ha + (hd - hc) * u + (hc - ha) * v : ha + (hb - ha) * u + (hd - hb) * v;
    }
    return u + v <= 1 ? ha + (hb - ha) * u + (hc - ha) * v : hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v);
  }
  const gridH = (i, j) => {
    if (i >= 0 && i < GW && j >= 0 && j < GH) return H[j * GW + i];
    return extHeightAt(B.minX + i * CS, B.minZ + j * CS);
  };

  // ---------------------------------------------------------------- material + textures
  ctx.loading?.detail?.('绘制地面纹理 painting ground…');
  await ctx.yield?.();
  const qLevel = ctx.quality?.level || 'high';
  const low = qLevel === 'low';
  const size = ctx.quality?.groundTextureSize || 4096;
  const farW = B.maxX - B.minX, farH = B.maxZ - B.minZ;
  // (asked before painting: a WebGL parameter query waits for the GPU process, busy rasterising the canvases after)
  const maxAniso = ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 8;
  const tPaint0 = performance.now();
  // far: the whole data, painted once in far mode (lite at low, where it is ~1.6 m/px); markings go to their own
  // texture so the shader can hide them where decals draw them. The sharp near level is painted later, around
  // the camera, while exploring (nearLevel below).
  const levelDefs = [
    { name: 'far', minX: B.minX, minZ: B.minZ, w: farW, h: farH, ppm: size / Math.max(farW, farH), maskScale: 0.35, markings: 'separate', marksScale: 0.5, far: true, lite: low },
  ];
  // (the canvas drawing itself is executed later, asynchronously, by the GPU process — nothing below reads the
  // canvases back, so it overlaps with the rest of the loading)
  mark("ponds");
  const painted = paintGround(ctx, levelDefs);
  mark("paint");
  steps.prepare = painted.prepMs; steps.sources = painted.sourcesMs;
  const paintMs = performance.now() - tPaint0;
  const [farL] = painted.levels;
  const mkTex = (canvas, color, rg = false, repeat = false) => {
    const t = new THREE.CanvasTexture(canvas);
    t.flipY = false;
    t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = Math.min(color || rg ? 16 : 4, maxAniso);
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (rg) t.format = THREE.RGFormat; // two coverage channels: half the memory of RGBA
    t.needsUpdate = true;
    return t;
  };
  const tex = { far: mkTex(farL.color, true), farMask: mkTex(farL.mask, false), farMarks: mkTex(farL.marks, false, true) };

  // Minimap-friendly copy of the whole ground (1024 px wide) before the big canvases are released.
  const mm = document.createElement('canvas');
  mm.width = 1024; mm.height = Math.round((1024 * farH) / farW);
  mm.getContext('2d').drawImage(farL.color, 0, 0, mm.width, mm.height);

  // Upload now and release the big canvases (saves ~100 MB of canvas backing store).
  const GROUND_KEYS = ['far', 'farMask', 'farMarks'];
  const uploadAndRelease = () => {
    if (!ctx.renderer?.initTexture) return;
    for (const k of GROUND_KEYS) {
      try {
        ctx.renderer.initTexture(tex[k]);
        const c = tex[k].image;
        tex[k].image = { width: c.width, height: c.height }; // keep dimensions for bookkeeping
        c.width = 1; c.height = 1;
      } catch (e) { console.warn('[terrain] texture pre-upload failed', e); }
    }
  };
  mark("minimap");
  uploadAndRelease();
  mark("upload");
  tex.detail = makeDetailTexture();
  tex.detail2 = makeDetail2Texture();
  mark("detailTex");

  // ---- the near level: wrap-around canvases (colour + half-resolution mask), kept (they are repainted)
  const nearCfg = NEAR[qLevel] || NEAR.high;
  const nearLevel = createNearLevel(ctx, painted.prepared, nearCfg, mkTex);
  tex.near = nearLevel.tex.color; tex.nearMask = nearLevel.tex.mask;

  // After a WebGL context loss three.js re-uploads every texture from its image — the released far canvases
  // have none, so repaint them (~1 s, once) when the context comes back (the near canvases are kept anyway).
  // This listener runs after three's own.
  const glCanvas = ctx.renderer?.domElement || ctx.canvas;
  glCanvas?.addEventListener?.('webglcontextrestored', () => {
    try {
      const again = paintGround(ctx, levelDefs, painted.prepared);
      const [f] = again.levels;
      tex.far.image = f.color; tex.farMask.image = f.mask; tex.farMarks.image = f.marks;
      for (const k of GROUND_KEYS) tex[k].needsUpdate = true;
      uploadAndRelease();
      console.info('[terrain] ground textures repainted after WebGL context restore');
    } catch (e) {
      console.warn('[terrain] could not repaint the ground after a context loss', e);
      ctx.ui?.toast?.('图形上下文已恢复，但地面纹理丢失，请刷新页面 · Ground textures lost — please reload');
    }
  });
  const season0 = SEASONS[ctx.env?.state?.season] || SEASONS.autumn;
  mark("near");
  const edgeLU = edgeLandUse(ctx.data, B);
  mark("edgeLU");
  const uniforms = {
    uEdgeLU: { value: edgeLU.tex },
    uFarMap: { value: tex.far }, uFarMask: { value: tex.farMask },
    uFarMarks: { value: tex.farMarks },
    uNearMap: { value: tex.near }, uNearMask: { value: tex.nearMask },
    uNearRect: nearLevel.rectUniform, uNearPeriod: { value: nearCfg.m },
    uNearTiles: nearLevel.tilesUniform, uNearTile: nearLevel.tileUniform,
    uMarkFade: { value: new THREE.Vector2(markRange(ctx) - 100, markRange(ctx)) },
    uMarkWhite: { value: new THREE.Color('#ebe9e1') }, uMarkYellow: { value: new THREE.Color('#d8a526') },
    uDetail: { value: tex.detail },
    uDetail2: { value: tex.detail2 },
    uSharpen: { value: ctx.quality?.level === 'low' ? 0 : 0.6 },
    uFarRect: { value: new THREE.Vector4(B.minX, B.minZ, farW, farH) },
    uDataRect: { value: new THREE.Vector4(B.minX, B.minZ, farW, farH) },
    uGrassTint: { value: new THREE.Vector3(...season0.tint) },
    uSnow: { value: season0.snow },
    uLeaves: { value: season0.leaves },
    uBare: { value: season0.bare },
    // the sharp level is used up to x m from the camera, the far texture beyond y m
    uCoreFade: { value: new THREE.Vector2(CORE_FADE[0], CORE_FADE[1]) },
    uDetailAmt: { value: 1 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.4) },
    uNight: { value: 0 },
    // painted house roofs of the procedural surroundings give way to 3D houses up to this far out (m)
    uHouse3D: { value: new THREE.Vector2(SKIRT_3D.houses - 20, SKIRT_3D.houses + 20) },
  };
  const material = makeGroundMaterial(uniforms);
  let grass = null;
  try { grass = createGrass(ctx, { H, GW, GH, CS, B, uniforms, nearCfg }); } catch (e) { console.warn('[terrain] grass failed', e); }

  // ---------------------------------------------------------------- chunked grid mesh (levels of detail)
  ctx.loading?.detail?.('生成地形网格 building terrain mesh…');
  mark("yield");
  const tMesh0 = performance.now();
  const group = new THREE.Group();
  group.name = 'terrain';
  const CH = CHUNK[qLevel] || 64;
  const lodDist = LOD_DIST[qLevel] || LOD_DIST.high;
  const chunks = [];
  for (let cj = 0; cj < GH - 1; cj += CH) {
    for (let ci = 0; ci < GW - 1; ci += CH) {
      const ni = Math.min(CH, GW - 1 - ci), nj = Math.min(CH, GH - 1 - cj);
      let y0 = Infinity, y1 = -Infinity;
      for (let j = 0; j <= nj; j++) for (let i = 0; i <= ni; i++) { const h = H[(cj + j) * GW + ci + i]; if (h < y0) y0 = h; if (h > y1) y1 = h; }
      const box = new THREE.Box3(new THREE.Vector3(B.minX + ci * CS, y0, B.minZ + cj * CS), new THREE.Vector3(B.minX + (ci + ni) * CS, y1, B.minZ + (cj + nj) * CS));
      const c = { ci, cj, ni, nj, box, sphere: box.getBoundingSphere(new THREE.Sphere()), geos: [], lod: -1, mesh: null, drop: 0 };
      c.drop = chunkCurtainDrop(c, H, GW);
      const mesh = new THREE.Mesh(chunkGeometry(c, 3, H, GW, CS, B, gridH), material);
      c.geos[3] = mesh.geometry;
      c.lod = 3;
      mesh.name = `terrain-chunk-${ci / CH}-${cj / CH}`;
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.matrixAutoUpdate = false;
      c.mesh = mesh;
      group.add(mesh);
      chunks.push(c);
    }
  }
  // Levels of detail: on medium / high every level of every chunk is built now, during loading (~0.5 s; building
  // them on demand while exploring cost up to 14 ms per frame after each flight, plus new GPU buffers), each as its
  // own mesh of which only the chunk's current level is visible — so the per-frame selection only flips visibility,
  // and the loading-time warm-up (which draws every hidden object once) puts all of them on the GPU. On low (phones:
  // memory) they are still built on demand, nearest first within a small per-frame budget, swapped into the one
  // mesh, and LOD 0 of chunks far behind is dropped again.
  const eagerLods = !low;
  const lodStats = { built: 0, buildMs: 0, counts: [0, 0, 0, 0] };
  if (eagerLods) {
    const tL = performance.now();
    let tY = tL;
    for (const c of chunks) {
      c.meshes = [];
      for (let lod = 0; lod < 4; lod++) {
        if (!c.geos[lod]) { c.geos[lod] = chunkGeometry(c, lod, H, GW, CS, B, gridH); lodStats.built++; }
        let m = c.mesh;
        if (lod !== c.lod) {
          m = new THREE.Mesh(c.geos[lod], material);
          m.name = `${c.mesh.name}-lod${lod}`;
          m.receiveShadow = true;
          m.castShadow = false;
          m.matrixAutoUpdate = false;
          m.visible = false;
          group.add(m);
        }
        c.meshes[lod] = m;
      }
      if (performance.now() - tY > 60) { await ctx.yield?.(); tY = performance.now(); }
    }
    lodStats.buildMs += performance.now() - tL;
  }
  const _cp = new THREE.Vector3();
  let lodLast = null, lodPending = true;
  const lodWant = [];
  const updateLods = (force = false) => {
    const cam = ctx.camera;
    if (!cam) return;
    const p = cam.position;
    const moved = !lodLast || Math.abs(p.x - lodLast.x) + Math.abs(p.y - lodLast.y) + Math.abs(p.z - lodLast.z) > 6;
    if (!moved && !lodPending && !force) return;
    const jump = !lodLast || Math.abs(p.x - lodLast.x) + Math.abs(p.z - lodLast.z) > 150;
    if (lodLast) lodLast.copy(p); else lodLast = p.clone();
    const want = lodWant;
    want.length = 0;
    for (const c of chunks) {
      const d = c.box.distanceToPoint(p);
      const lod = d < lodDist[0] ? 0 : d < lodDist[1] ? 1 : d < lodDist[2] ? 2 : 3;
      if (c.geos[lod]) setLod(c, lod);
      else want.push([d, c, lod]);
      if (!eagerLods && c.geos[0] && lod > 0 && d > lodDist[1] * 1.6) { c.geos[0].dispose(); c.geos[0] = null; }
    }
    want.sort((a, b) => a[0] - b[0]);
    const t0 = performance.now(), budget = force ? 1e9 : jump ? 14 : 4;
    let k = 0;
    for (; k < want.length && (k === 0 || performance.now() - t0 < budget); k++) {
      const [, c, lod] = want[k];
      c.geos[lod] = chunkGeometry(c, lod, H, GW, CS, B, gridH);
      lodStats.built++;
      setLod(c, lod);
    }
    lodStats.buildMs += performance.now() - t0;
    lodPending = k < want.length;
  };
  const setLod = (c, lod) => {
    if (c.lod === lod) return;
    if (c.meshes) { c.mesh.visible = false; c.mesh = c.meshes[lod]; c.mesh.visible = true; }
    else c.mesh.geometry = c.geos[lod];
    c.lod = lod;
  };
  ctx.onUpdate?.(() => updateLods(), 22);
  const triStats = () => {
    const counts = [0, 0, 0, 0];
    let tris = 0;
    for (const c of chunks) { counts[c.lod]++; tris += c.mesh.geometry.index.count / 3; }
    return { counts, tris };
  };
  let triCount = chunks.reduce((n, c) => n + c.ni * c.nj * 2, 0); // (full resolution; see stats.lod for the drawn)

  // ---------------------------------------------------------------- skirt: concentric rectangular rings, zipped
  mark("chunks");
  const skirt = buildSkirt(B, GW, GH, CS, H, extHeightAt);
  skirtGeo = skirt;
  const skirtMesh = new THREE.Mesh(skirt, material);
  skirtMesh.name = 'terrain-skirt';
  skirtMesh.receiveShadow = true;
  skirtMesh.matrixAutoUpdate = false;
  group.add(skirtMesh);
  triCount += skirt.index.count / 3;
  group.matrixAutoUpdate = false;
  group.updateMatrixWorld(true);
  ctx.scene.add(group);
  const meshMs = performance.now() - tMesh0;
  mark("skirt");

  // ---------------------------------------------------------------- 3D surroundings on the skirt
  // Built now, during loading (~0.2 s; 0.7 s+ on slow CPUs). They used to be built after the first frame, a few
  // milliseconds per frame, which showed up as stutter while exploring (and as new GPU buffers / first draws later).
  let skirtStats = { ms: 0, pending: true };
  try {
    const kit = skirtKit(ctx);
    const surface = { get: () => skirtLook, set: (v) => { skirtLook = v; } };
    const gen = buildSkirtContent(ctx, { B, skirtGeo: skirt, surface, detailData: tex.detail.image.data, meshHeightAt, edgeAt: edgeLU.at, kit });
    let ms = 0, tS = performance.now(), r = { done: false };
    try {
      for (;;) {
        r = gen.next();
        if (r.done) break;
        if (performance.now() - tS > 60) { ms += performance.now() - tS; await ctx.yield?.(); tS = performance.now(); }
      }
    } catch (e) { console.warn('[terrain] surroundings failed', e); r = { done: true, value: null }; }
    ms += performance.now() - tS;
    skirtContent = r.value;
    skirtStats = Object.assign(skirtContent?.stats || {}, { ms: Math.round(ms) });
  } catch (e) { console.warn('[terrain] surroundings failed', e); }

  // ---------------------------------------------------------------- seasons + weather
  // Ground snow follows the season, and also builds up while it is snowing (weather 'snow' in any season):
  // it ramps towards at least SNOWFALL_COVER over ~25 s and melts away again afterwards.
  let season = SEASONS[ctx.env?.state?.season] ? ctx.env.state.season : 'autumn';
  let snowing = ctx.env?.state?.weather === 'snow';
  let snowNow = (SEASONS[season] || SEASONS.autumn).snow;
  if (snowing) snowNow = Math.max(snowNow, SNOWFALL_COVER);
  const applyCover = () => {
    const S = SEASONS[season] || SEASONS.summer;
    uniforms.uSnow.value = snowNow;
    const extra = Math.max(0, snowNow - S.snow); // snowfall beyond the season's own cover dulls the grass
    uniforms.uGrassTint.value.set(...S.tint).multiplyScalar(1 - 0.1 * Math.min(1, extra / SNOWFALL_COVER));
  };
  function setSeason(s) {
    season = SEASONS[s] ? s : 'summer';
    // (env has already switched the weather to the new season's default: winter → summer must not start from a
    // snowfall cover that then takes ~10 s to melt)
    if (ctx.env?.state?.weather !== undefined) snowing = ctx.env.state.weather === 'snow';
    const S = SEASONS[season];
    snowNow = snowing ? Math.max(S.snow, SNOWFALL_COVER) : S.snow;
    uniforms.uLeaves.value = S.leaves;
    uniforms.uBare.value = S.bare;
    applyCover();
    skirtContent?.setSeason?.(season);
  }
  applyCover();
  ctx.events?.on?.('env:season', setSeason);
  ctx.events?.on?.('env:change', (st) => { if (st && 'weather' in st) snowing = st.weather === 'snow'; });
  ctx.onUpdate?.((dt) => {
    const env = ctx.env?.state;
    if (env) {
      if (env.sunDir) uniforms.uSunDir.value.copy(env.sunDir);
      uniforms.uNight.value = env.nightFactor || 0;
      if (env.weather !== undefined) snowing = env.weather === 'snow';
    }
    const target = snowing ? Math.max((SEASONS[season] || SEASONS.summer).snow, SNOWFALL_COVER) : (SEASONS[season] || SEASONS.summer).snow;
    if (snowNow !== target) {
      const step = Math.min(dt, 0.1) / 25;
      snowNow = snowNow < target ? Math.min(target, snowNow + step) : Math.max(target, snowNow - step);
      applyCover();
    }
  }, 5);
  ctx.events?.on?.('quality', (q) => {
    const low = (q?.level || q) === 'low';
    uniforms.uSharpen.value = low ? 0 : 0.6;
    uniforms.uDetailAmt.value = low ? 0.7 : 1;
  });

  // ---------------------------------------------------------------- ray vs. terrain (heightfield march)
  const _o = new THREE.Vector3();
  function raycast(origin, dir, maxDist = 6000) {
    const step = 2;
    let prevT = 0, prevD = origin.y - extHeightAt(origin.x, origin.z);
    if (prevD < 0) return null;
    for (let t = step; t <= maxDist; t += step * (1 + t / 400)) {
      _o.copy(origin).addScaledVector(dir, t);
      const dd = _o.y - extHeightAt(_o.x, _o.z);
      if (dd < 0) {
        let a = prevT, b = t;
        for (let k = 0; k < 20; k++) {
          const m = (a + b) / 2;
          _o.copy(origin).addScaledVector(dir, m);
          if (_o.y - extHeightAt(_o.x, _o.z) < 0) b = m; else a = m;
        }
        return origin.clone().addScaledVector(dir, (a + b) / 2);
      }
      prevT = t; prevD = dd;
    }
    return null;
  }

  // GPU memory of the ground textures (RGBA8 + full mip chain ≈ 4/3)
  const texMB = Object.values(tex).reduce((m, t) => m + ((t.image?.width || 0) * (t.image?.height || 0) * (t.format === THREE.RGFormat ? 2 : 4) * 4) / 3, 0) / 1048576;
  // the sharp near level around the start view (so the first frames have next to nothing to paint)
  try { nearLevel.prefill(); } catch (e) { console.warn('[terrain] near level prefill failed', e); }
  mark("nearPrefill");
  mark("rest");
  const stats = {
    steps, paintMs: Math.round(paintMs), meshMs: Math.round(meshMs), surroundings: skirtStats, totalMs: Math.round(performance.now() - T0),
    triangles: triCount, chunks: chunks.length, textureMB: Math.round(texMB),
    texSizes: Object.fromEntries(Object.entries(tex).map(([k, t]) => [k, `${t.image?.width}x${t.image?.height}`])),
    near: nearLevel.stats,
    grass: grass ? { tufts: grass.tufts, triangles: grass.triangles } : null,
    get lod() { return { ...triStats(), built: lodStats.built, buildMs: Math.round(lodStats.buildMs) }; },
  };
  ctx.terrain = {
    mesh: group,
    material,
    heightAt: hf.heightAt,
    normalAt: hf.normalAt,
    extHeightAt,
    meshHeightAt,
    raycast,
    bounds: { ...B },
    // the sharp level's current window (it follows the camera; null until first painted)
    get coreRect() { return nearLevel.rect(); },
    oakRect: null,
    markRange: markRange(ctx),
    groundTexture: tex.far,
    groundTextures: tex,
    minimapCanvas: mm,
    uniforms,
    setSeason,
    stats,
    groundData: painted.prepared, // classified roads/paths (used by roads.js for the marking decals)
    surroundings: null, // 3D trees / houses / road continuations beyond the data (Group, set below)
    near: nearLevel, // the sharp level: { rect(), update(force), stats }
  };
  ctx.terrain.surroundings = skirtContent?.group || null;
  if (skirtContent && season !== (ctx.env?.state?.season || 'autumn')) skirtContent.setSeason(season);
  ctx.events?.emit?.('terrain:surroundings', skirtContent?.group || null);
  console.info('[terrain]', JSON.stringify(stats));
  return ctx.terrain;
}

// ---------------------------------------------------------------------------------------------------------------
// The sharp near level: an M-metre window of the ground around the camera at PX² pixels in a wrap-around texture —
// world (x, z) lives at texel (x·ppm mod PX, z·ppm mod PX), so the shader samples it with uv = world / M on a
// repeating texture. The window is made of 8 × 8 tiles of M/8 metres. Each tile is painted on its own into a small
// scratch canvas (paintRegion) and copied into its slot of the textures (texSubImage2D of one tile — never a
// re-upload of the whole texture); a tiny slot table (uNearTiles: which world tile each slot holds) tells the
// shaders where the painted ground is valid, so tiles can be painted in any order, a few per frame, nearest first,
// and nothing wrong is ever shown in between (unpainted tiles show the far level). The window sits a little ahead
// of the camera, in the direction it looks, and moves in steps of one tile; above NEAR_MAX_H the far level alone is
// visible and the window stays where it is. Tiles are painted within a small per-frame time budget (repainting whole
// strips / the whole window and re-uploading the 2048² textures was the main source of stutter while exploring);
// the window around the start view is painted during loading (prefill).
// Pacing. A tile costs ~1–1.5 ms of drawing calls on the main thread but ~7–9 ms of rasterisation in the GPU process
// (Skia), which shares its thread with the WebGL frame — so tiles are paced by an estimate of that GPU time: each
// painted tile adds NEAR_TILE_GPU ms of "debt", every frame pays NEAR_GPU_PER_FRAME ms back, and a tile is only
// painted when the debt is paid (≈ one tile every other frame); a missing tile right around the camera may go
// one tile ahead. The main-thread time is capped too.
const NEAR_TILE_GPU = 9, NEAR_GPU_PER_FRAME = 5, NEAR_BUDGET_MS = 2.5;
function createNearLevel(ctx, P, cfg, mkTex) {
  const PX = cfg.px, M = cfg.m, ppm = PX / M, NT = 8, T = M / NT, TPX = PX / NT;
  const MPX = PX / 2, mppm = ppm / 2, MTPX = TPX / 2;
  const mk = (n) => { const c = document.createElement('canvas'); c.width = c.height = n; return c; };
  const color = mk(PX), mask = mk(MPX);
  const gc = color.getContext('2d', { alpha: false }), gmk = mask.getContext('2d', { alpha: false });
  gc.fillStyle = '#59733a'; gc.fillRect(0, 0, PX, PX);   // (never shown: no slot is valid before it is painted)
  gmk.fillStyle = '#ff0000'; gmk.fillRect(0, 0, MPX, MPX);
  // The colour level holds sRGB values in a plain RGBA8 texture, decoded in the shaders (gNearRGB): copying canvas
  // tiles into an SRGB8_ALPHA8 texture takes the GPU process about twice as long (an extra conversion pass).
  const tex = { color: mkTex(color, true, false, true), mask: mkTex(mask, false, false, true) };
  tex.color.colorSpace = THREE.NoColorSpace;
  // scratch tile canvases (+ texture wrappers used only as copy sources; they are never uploaded themselves)
  const tc = mk(TPX), tm = mk(MTPX);
  const tcg = tc.getContext('2d', { alpha: false }), tmg = tm.getContext('2d', { alpha: false });
  // slot table: world tile (i, j) held by slot (i mod NT, j mod NT); -1e6 = empty
  const tableData = new Float32Array(NT * NT * 2).fill(-1e6);
  const table = new THREE.DataTexture(tableData, NT, NT, THREE.RGFormat, THREE.FloatType);
  table.minFilter = table.magFilter = THREE.NearestFilter;
  table.generateMipmaps = false;
  table.needsUpdate = true;
  const tilesUniform = { value: table };
  const tileUniform = { value: new THREE.Vector2(T, NT) };
  const rectUniform = { value: new THREE.Vector4(-1e7, -1e7, 1, 1) };
  const stats = { px: PX, m: M, tile: T, paints: 0, windows: 0, ms: 0, lastMs: 0, maxMs: 0, pending: 0 };
  let win = null;
  let want = [];          // tiles of the current window, nearest first: [i, j, d²]
  const mod = (a, n) => ((a % n) + n) % n;
  const holds = (i, j) => { const k = (mod(j, NT) * NT + mod(i, NT)) * 2; return tableData[k] === i && tableData[k + 1] === j; };
  // Copy a painted tile canvas into its slot: a plain texSubImage2D with default unpack parameters, which Chrome
  // executes GPU-side and asynchronously for a GPU canvas (three's copyTextureToTexture sets UNPACK_ROW_LENGTH,
  // which sends it down the synchronous read-back path: ~13 ms of main thread per tile), then the mip chain.
  function uploadTile(t, canvas, x, y) {
    const r = ctx.renderer;
    if (!r) return;
    const gl = r.getContext();
    let p = r.properties.get(t);
    if (!p.__webglTexture) { r.initTexture(t); p = r.properties.get(t); }
    r.state.bindTexture(gl.TEXTURE_2D, p.__webglTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.generateMipmap(gl.TEXTURE_2D);
    r.state.unbindTexture();
  }
  function paintTile(i, j) {
    const t0 = performance.now();
    const rect = { minX: i * T, minZ: j * T, w: T, h: T };
    try {
      paintRegion(tcg, 'color', P, rect, 0, 0, ppm, { name: 'near' });
      paintRegion(tmg, 'mask', P, rect, 0, 0, mppm, { name: 'near' });
      const sx = mod(i, NT), sz = mod(j, NT);
      uploadTile(tex.color, tc, sx * TPX, sz * TPX);
      uploadTile(tex.mask, tm, sx * MTPX, sz * MTPX);
      const k = (sz * NT + sx) * 2;
      tableData[k] = i; tableData[k + 1] = j;
      table.needsUpdate = true;
    } catch (e) { console.warn('[terrain] near ground painting failed', e); }
    const ms = performance.now() - t0;
    stats.paints++;
    stats.lastMs = Math.round(ms * 10) / 10;
    stats.maxMs = Math.max(stats.maxMs, stats.lastMs);
    stats.ms += ms;
  }
  // move the window (on the tile grid) for a camera position + view direction; false when it stays
  function focusWindow(px, pz, dx, dy, dz, hAbove) {
    const fl = Math.hypot(dx, dz);
    // focus: ahead of the camera by up to 18 % of the window (less when looking down from above)
    let off = 0.18 * M;
    if (dy < -0.02) off = Math.min(off, (Math.max(0, hAbove) * fl) / -dy);
    const fx = px + (fl > 1e-3 ? (dx / fl) * off : 0), fz = pz + (fl > 1e-3 ? (dz / fl) * off : 0);
    if (win && Math.abs(fx - (win.x + M / 2)) < T * 0.75 && Math.abs(fz - (win.z + M / 2)) < T * 0.75) return false;
    const nx = Math.round((fx - M / 2) / T) * T, nz = Math.round((fz - M / 2) / T) * T;
    if (win && nx === win.x && nz === win.z) return false;
    win = { x: nx, z: nz };
    rectUniform.value.set(nx, nz, M, M);
    const i0 = Math.round(nx / T), j0 = Math.round(nz / T);
    want = [];
    for (let j = 0; j < NT; j++) for (let i = 0; i < NT; i++) want.push([i0 + i, j0 + j, ((i0 + i + 0.5) * T - px) ** 2 + ((j0 + j + 0.5) * T - pz) ** 2]);
    want.sort((a, b) => a[2] - b[2]);
    stats.windows++;
    return true;
  }
  // paint missing tiles of the window, nearest first, within budgetMs (at least one); returns how many are left
  let gpuDebt = 0;
  function paintMissing(budgetMs, paced, px = 0, pz = 0) {
    const t0 = performance.now();
    let n = 0, left = 0;
    const urgentD2 = (1.6 * T) ** 2;
    for (const w of want) {
      if (holds(w[0], w[1])) continue;
      let go = !paced || (gpuDebt <= 0 && (n === 0 || performance.now() - t0 < budgetMs));
      if (!go && paced && n === 0 && gpuDebt <= NEAR_TILE_GPU) {
        const dx = (w[0] + 0.5) * T - px, dz = (w[1] + 0.5) * T - pz;
        go = dx * dx + dz * dz < urgentD2; // under / right next to the camera: don't wait
      }
      if (!go) { left++; continue; }
      paintTile(w[0], w[1]);
      if (paced) gpuDebt += NEAR_TILE_GPU;
      n++;
    }
    stats.pending = left;
    if (!left) want = [];
    return left;
  }
  const dir = new THREE.Vector3();
  // CPU degrade (engine 'perf:degrade'): fewer tiles per second and a smaller main-thread budget — the tiles right
  // around the camera still come at once, the rest of the window fills in a little later
  const PACE = [[NEAR_GPU_PER_FRAME, NEAR_BUDGET_MS], [3.6, 2], [2.6, 1.5], [1.8, 1]];
  let pace = PACE[0];
  ctx.events?.on?.('perf:degrade', (e) => { pace = PACE[Math.max(0, Math.min(PACE.length - 1, Math.round(Number(e?.cpu) || 0)))]; });
  function update(force = false) {
    const cam = ctx.camera;
    if (!cam) return;
    const p = cam.position;
    const hAbove = p.y - ctx.heightAt(p.x, p.z);
    if (hAbove > NEAR_MAX_H && !force) return;
    cam.getWorldDirection(dir);
    focusWindow(p.x, p.z, dir.x, dir.y, dir.z, hAbove);
    gpuDebt = Math.max(0, gpuDebt - pace[0]);
    if (want.length) paintMissing(pace[1], !(force || ctx.shotMode), p.x, p.z);
  }
  // During loading: paint the window around the start view (a ?cam= link, else the opening overview — the same
  // pose as controls.js HOME) so the first frames have nothing (or only a strip) to paint.
  function prefill() {
    let cam = null, look = null;
    try {
      const q = new URLSearchParams(location.search);
      const v = (q.get('cam') || '').split(',').map(Number), l = (q.get('look') || '').split(',').map(Number);
      if (v.length === 3 && v.every(Number.isFinite)) { cam = v; look = l.length === 3 && l.every(Number.isFinite) ? l : null; }
    } catch { /* no location */ }
    if (!cam) {
      const h = (292 * Math.PI) / 180, el = (29 * Math.PI) / 180, dist = 600, tx = -120, tz = 70, ty = ctx.heightAt(tx, tz);
      const dx = Math.sin(h), dz = -Math.cos(h);
      cam = [tx - dx * dist * Math.cos(el), ty + dist * Math.sin(el), tz - dz * dist * Math.cos(el)];
      look = [tx, ty, tz];
    }
    const d = look ? [look[0] - cam[0], look[1] - cam[1], look[2] - cam[2]] : [0, -1, 0];
    const dl = Math.hypot(d[0], d[1], d[2]) || 1;
    focusWindow(cam[0], cam[2], d[0] / dl, d[1] / dl, d[2] / dl, cam[1] - ctx.heightAt(cam[0], cam[2]));
    paintMissing(Infinity, false);
  }
  ctx.onUpdate?.(() => update(), 21);
  // after a WebGL context loss the textures come back blank: every slot has to be painted again
  (ctx.renderer?.domElement || ctx.canvas)?.addEventListener?.('webglcontextrestored', () => {
    tableData.fill(-1e6); table.needsUpdate = true;
    if (win) { const w = win; win = null; focusWindow(w.x + M / 2, w.z + M / 2, 0, 0, 0, 0); }
  });
  return {
    tex, rectUniform, tilesUniform, tileUniform, stats, update, prefill,
    rect: () => (win ? { minX: win.x, maxX: win.x + M, minZ: win.z, maxZ: win.z + M } : null),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 3D grass near the camera (high / medium). A fixed grid of tufts (a few blades each) centred on the camera, drawn
// in one instanced call; the vertex shader places each tuft in the world cell it covers (so the blades stay put
// as the grid follows the camera), stands it on the exact terrain triangle surface (a height texture with the
// mesh's own triangulation), takes its colour from the painted near level, and folds it away where that level's
// mask is not lawn (paths, roads, beds, buildings, woods) and towards the edge of the grid. Mown campus lawns:
// 6–12 cm blades.
const GRASS = { high: { radius: 17, spacing: 0.21 }, medium: { radius: 11, spacing: 0.25 } };
function createGrass(ctx, { H, GW, GH, CS, B, uniforms, nearCfg }) {
  const cfg = GRASS[ctx.quality?.level];
  if (!cfg) return null;
  const N = Math.ceil(cfg.radius / cfg.spacing);
  // tuft: 5 blades, each a thin triangle leaning out from the tuft centre (unit height; the shader scales it)
  const pos = [], side = [];
  const rnd = mulberry(515);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 + rnd() * 0.8, r0 = 0.02 + rnd() * 0.06, w = 0.012 + rnd() * 0.01;
    const bx = Math.cos(a) * r0, bz = Math.sin(a) * r0, px = -Math.sin(a), pz = Math.cos(a);
    const lean = 0.18 + rnd() * 0.25, h = 0.75 + rnd() * 0.25;
    pos.push(bx - px * w, 0, bz - pz * w, bx + px * w, 0, bz + pz * w, bx + Math.cos(a) * lean * h, h, bz + Math.sin(a) * lean * h);
    side.push(0, 0, 1);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geo.setAttribute('aTip', new THREE.Float32BufferAttribute(side, 1));
  const cells = [];
  for (let j = -N; j <= N; j++) for (let i = -N; i <= N; i++) if (i * i + j * j <= N * N) cells.push(i, j);
  geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(new Float32Array(cells), 2));
  geo.instanceCount = cells.length / 2;
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  // exact terrain heights (with the carved pond beds) for the vertex shader
  const hTex = new THREE.DataTexture(H, GW, GH, THREE.RedFormat, THREE.FloatType);
  hTex.minFilter = hTex.magFilter = THREE.NearestFilter;
  hTex.needsUpdate = true;
  const gu = {
    uGCell: { value: new THREE.Vector2() }, uGSpacing: { value: cfg.spacing }, uGRadius: { value: cfg.radius },
    uGHeight: { value: hTex }, uGHGrid: { value: new THREE.Vector4(B.minX, B.minZ, CS, 0) }, uGHSize: { value: new THREE.Vector2(GW, GH) },
    uGTime: { value: 0 },
  };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
  mat.name = 'grass-blades';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, gu, {
      uNearMap: uniforms.uNearMap, uNearMask: uniforms.uNearMask, uNearRect: uniforms.uNearRect, uNearPeriod: uniforms.uNearPeriod,
      uNearTiles: uniforms.uNearTiles, uNearTile: uniforms.uNearTile,
      uGrassTint: uniforms.uGrassTint, uSnow: uniforms.uSnow,
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec2 aCell;
        attribute float aTip;
        uniform vec2 uGCell;
        uniform float uGSpacing, uGRadius, uGTime, uNearPeriod, uSnow;
        uniform vec4 uGHGrid, uNearRect;
        uniform vec2 uGHSize;
        uniform sampler2D uGHeight, uNearMap, uNearMask;
        uniform vec3 uGrassTint;
        varying vec3 vGCol;
        ${NEAR_GLSL}
        float gH1(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
        // the terrain mesh surface (same triangulation as terrain.js chunkGeometry / meshHeightAt)
        float gTerrain(vec2 p) {
          vec2 f = (p - uGHGrid.xy) / uGHGrid.z;
          ivec2 i = clamp(ivec2(floor(f)), ivec2(0), ivec2(uGHSize) - 2);
          vec2 u = clamp(f - vec2(i), 0.0, 1.0);
          float ha = texelFetch(uGHeight, i, 0).r, hb = texelFetch(uGHeight, i + ivec2(1, 0), 0).r;
          float hc = texelFetch(uGHeight, i + ivec2(0, 1), 0).r, hd = texelFetch(uGHeight, i + ivec2(1, 1), 0).r;
          if (abs(ha - hd) < abs(hb - hc)) return u.y >= u.x ? ha + (hd - hc) * u.x + (hc - ha) * u.y : ha + (hb - ha) * u.x + (hd - hb) * u.y;
          return u.x + u.y <= 1.0 ? ha + (hb - ha) * u.x + (hc - ha) * u.y : hd + (hc - hd) * (1.0 - u.x) + (hb - hd) * (1.0 - u.y);
        }`)
      .replace('#include <begin_vertex>', `
        vec2 cell = uGCell + aCell;
        float r1 = gH1(cell), r2 = gH1(cell + 17.31), r3 = gH1(cell + 41.7);
        vec2 base = (cell + vec2(r1, r2)) * uGSpacing;
        float d = length(base - (uGCell + 0.5) * uGSpacing);
        // lawn? (near level mask: vegetation without asphalt / hard surface, not beds or woods)
        vec3 m = textureLod(uNearMask, base / uNearPeriod, 0.0).rgb;
        float lawn = smoothstep(0.86, 0.96, m.r) * (1.0 - smoothstep(0.04, 0.12, m.g + m.b)) * gNearOk(base);
        float hgt = (0.06 + 0.06 * r3) * lawn * (1.0 - smoothstep(uGRadius * 0.55, uGRadius, d)) * (1.0 - smoothstep(0.2, 0.5, uSnow));
        float ang = r2 * 6.2832, ca = cos(ang), sa = sin(ang);
        vec3 p = position;
        p.xz = mat2(ca, sa, -sa, ca) * p.xz * (0.8 + 0.5 * r1);
        // wind: the tips sway a little
        float sw = sin(uGTime * 1.7 + base.x * 0.9 + base.y * 0.6) * 0.5 + sin(uGTime * 2.9 + base.x * 2.3) * 0.25;
        p.xz += vec2(0.7, 0.4) * sw * 0.12 * p.y;
        vec3 transformed = vec3(base.x + p.x, gTerrain(base) + p.y * hgt - 0.01, base.y + p.z);
        // no lawn here: fold the tuft into a point under the ground (flat blades would poke out of slopes)
        if (hgt < 0.004) transformed = vec3(base.x, gTerrain(base) - 1.0, base.y);
        vec3 gc = gNearRGB(textureLod(uNearMap, base / uNearPeriod, 0.0).rgb);
        gc *= uGrassTint;                                           // (the texture is decoded from sRGB)
        vGCol = gc * mix(0.62, 1.22 + 0.25 * (r3 - 0.5), aTip) * mix(vec3(1.0), vec3(1.08, 1.05, 0.82), aTip * r1 * 0.6);
      `)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);\n#ifdef USE_TANGENT\nvec3 objectTangent = vec3(1.0, 0.0, 0.0);\n#endif');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGCol;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vGCol;')
      // (both faces lit like the ground below them: no flipped normal on the back face)
      .replace('#include <normal_fragment_begin>', 'float faceDirection = 1.0;\nvec3 normal = normalize(vNormal);\nvec3 nonPerturbedNormal = normal;');
  };
  mat.customProgramCacheKey = () => 'cmu-grass-v3';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'terrain-grass';
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.matrixAutoUpdate = false;
  ctx.scene.add(mesh);
  ctx.onUpdate?.((dt, el) => {
    const cam = ctx.camera;
    if (!cam) return;
    const p = cam.position;
    const above = p.y - ctx.heightAt(p.x, p.z);
    mesh.visible = above < 45 && uniforms.uNearRect.value.x > -1e6;
    if (!mesh.visible) return;
    gu.uGCell.value.set(Math.floor(p.x / cfg.spacing), Math.floor(p.z / cfg.spacing));
    gu.uGTime.value = el;
  }, 23);
  return { mesh, tufts: geo.instanceCount, triangles: geo.instanceCount * 5 };
}

// ---------------------------------------------------------------------------------------------------------------
// Terrain chunk geometry at level of detail `lod` (vertex stride 2^lod cells; the chunk's last row / column is
// always included), with a curtain hanging `c.drop` metres from its four edges (faces outwards) that hides the
// cracks against neighbours drawn at another level.
function chunkGeometry(c, lod, H, GW, CS, B, gridH) {
  const s = 1 << lod;
  const is = [], js = [];
  for (let i = 0; i < c.ni; i += s) is.push(i);
  is.push(c.ni);
  for (let j = 0; j < c.nj; j += s) js.push(j);
  js.push(c.nj);
  const vw = is.length, vh = js.length, nGrid = vw * vh;
  const nV = nGrid + 2 * (vw + vh);
  const pos = new Float32Array(nV * 3), nor = new Float32Array(nV * 3);
  for (let j = 0; j < vh; j++) for (let i = 0; i < vw; i++) {
    const gi = c.ci + is[i], gj = c.cj + js[j], o = (j * vw + i) * 3;
    pos[o] = B.minX + gi * CS; pos[o + 1] = H[gj * GW + gi]; pos[o + 2] = B.minZ + gj * CS;
    const hx = gridH(gi + 1, gj) - gridH(gi - 1, gj), hz = gridH(gi, gj + 1) - gridH(gi, gj - 1);
    const l = Math.hypot(hx, 2 * CS, hz);
    nor[o] = -hx / l; nor[o + 1] = (2 * CS) / l; nor[o + 2] = -hz / l;
  }
  const nIdx = (vw - 1) * (vh - 1) * 6 + 2 * ((vw - 1) + (vh - 1)) * 6;
  const idx = new (nV > 65535 ? Uint32Array : Uint16Array)(nIdx);
  let k = 0;
  for (let j = 0; j < vh - 1; j++) for (let i = 0; i < vw - 1; i++) {
    const a = j * vw + i, b = a + 1, cc = a + vw, d = cc + 1;
    const ha = pos[a * 3 + 1], hb = pos[b * 3 + 1], hc = pos[cc * 3 + 1], hd = pos[d * 3 + 1];
    if (Math.abs(ha - hd) < Math.abs(hb - hc)) { idx[k++] = a; idx[k++] = cc; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = b; }
    else { idx[k++] = a; idx[k++] = cc; idx[k++] = b; idx[k++] = b; idx[k++] = cc; idx[k++] = d; }
  }
  // curtains: edge vertex list, outward direction
  let nv = nGrid;
  const cx = B.minX + (c.ci + c.ni / 2) * CS, cz = B.minZ + (c.cj + c.nj / 2) * CS;
  const edges = [
    Array.from({ length: vw }, (_, i) => i),                      // north (j = 0)
    Array.from({ length: vw }, (_, i) => (vh - 1) * vw + i),      // south
    Array.from({ length: vh }, (_, j) => j * vw),                 // west
    Array.from({ length: vh }, (_, j) => j * vw + vw - 1),        // east
  ];
  for (const e of edges) {
    const base = nv;
    for (const v of e) {
      pos[nv * 3] = pos[v * 3]; pos[nv * 3 + 1] = pos[v * 3 + 1] - c.drop; pos[nv * 3 + 2] = pos[v * 3 + 2];
      nor[nv * 3] = nor[v * 3]; nor[nv * 3 + 1] = nor[v * 3 + 1]; nor[nv * 3 + 2] = nor[v * 3 + 2];
      nv++;
    }
    for (let t = 0; t < e.length - 1; t++) {
      const a = e[t], b = e[t + 1], a2 = base + t, b2 = base + t + 1;
      // outward = away from the chunk centre; (b - a) × (a2 - a) points along ±outward
      const ex = pos[b * 3] - pos[a * 3], ez = pos[b * 3 + 2] - pos[a * 3 + 2];
      const mx = (pos[a * 3] + pos[b * 3]) / 2 - cx, mz = (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2 - cz;
      // cross((ex,0,ez), (0,-1,0)) = (ez, 0, -ex)
      if (ez * mx - ex * mz > 0) { idx[k++] = a; idx[k++] = b; idx[k++] = a2; idx[k++] = b; idx[k++] = b2; idx[k++] = a2; }
      else { idx[k++] = a; idx[k++] = a2; idx[k++] = b; idx[k++] = b; idx[k++] = a2; idx[k++] = b2; }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(k === nIdx ? idx : idx.subarray(0, k), 1));
  geo.boundingBox = c.box.clone();
  geo.boundingBox.min.y -= c.drop;
  geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
  return geo;
}

// How far a chunk's curtain must hang: the largest gap between its edges at full resolution and at any coarser
// level (the neighbour across an edge may be drawn at any of them), plus a margin.
function chunkCurtainDrop(c, H, GW) {
  let e = 0;
  const edge = (i0, j0, di, dj, n) => {
    for (const s of [2, 4, 8]) {
      for (let a = 0; a < n; a += s) {
        const b = Math.min(n, a + s);
        const ha = H[(j0 + dj * a) * GW + i0 + di * a], hb = H[(j0 + dj * b) * GW + i0 + di * b];
        for (let t = a + 1; t < b; t++) {
          const h = H[(j0 + dj * t) * GW + i0 + di * t];
          e = Math.max(e, Math.abs(h - (ha + ((hb - ha) * (t - a)) / (b - a))));
        }
      }
    }
  };
  edge(c.ci, c.cj, 1, 0, c.ni); edge(c.ci, c.cj + c.nj, 1, 0, c.ni);
  edge(c.ci, c.cj, 0, 1, c.nj); edge(c.ci + c.ni, c.cj, 0, 1, c.nj);
  return e + 0.6;
}

// ---------------------------------------------------------------------------------------------------------------
// Surroundings, part 2: the land use along the data edge, and 3D content on the first few hundred metres of the
// procedural skirt (the painted "Pittsburgh" alone read as a flat carpet, and the mapped woods / houses stopped
// along a ruler-straight line). Placement replicates OUTER_GLSL's classification exactly (same noise texture,
// same street grid and house lots), so 3D houses stand on the painted lots and 3D trees on painted canopy.
const sstep = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const f32 = Math.fround;
function gHashJS(px, py) { // OUTER_GLSL gHash in float32
  const k = f32(0.1031);
  let x = f32(px * k), y = f32(py * k), z = x;
  x = f32(x - Math.floor(x)); y = f32(y - Math.floor(y)); z = f32(z - Math.floor(z));
  const d = f32(f32(f32(x * f32(y + 33.33)) + f32(y * f32(z + 33.33))) + f32(z * f32(x + 33.33)));
  x = f32(x + d); y = f32(y + d); z = f32(z + d);
  const r = f32(f32(x + y) * z);
  return r - Math.floor(r);
}

// Built-up share along the data rectangle's perimeter (N samples, texture for the shader + array for JS):
// footprint coverage in a band 20–230 m inside each stretch of the edge.
function edgeLandUse(data, B, N = 512) {
  const C = 8, W = B.maxX - B.minX, H = B.maxZ - B.minZ;
  const nx = Math.ceil(W / C), nz = Math.ceil(H / C);
  const cov = new Uint8Array(nx * nz);
  const near = (x0, z0, x1, z1) => x0 < B.minX + 260 || z0 < B.minZ + 260 || x1 > B.maxX - 260 || z1 > B.maxZ - 260;
  for (const b of data.buildings) {
    const ring = b.footprint;
    if (!ring || ring.length < 3 || b.hidden) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (!near(x0, z0, x1, z1)) continue;
    for (let j = Math.max(0, Math.floor((z0 - B.minZ) / C)); j <= Math.min(nz - 1, Math.floor((z1 - B.minZ) / C)); j++) {
      for (let i = Math.max(0, Math.floor((x0 - B.minX) / C)); i <= Math.min(nx - 1, Math.floor((x1 - B.minX) / C)); i++) {
        if (pointInRing(B.minX + (i + 0.5) * C, B.minZ + (j + 0.5) * C, ring)) cov[j * nx + i] = 1;
      }
    }
  }
  const P = 2 * (W + H);
  const raw = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const t = ((k + 0.5) / N) * P;
    // edge point, direction along the edge, inward normal
    let ex, ez, ax, az, ix, iz;
    if (t < W) { ex = B.minX + t; ez = B.minZ; ax = 1; az = 0; ix = 0; iz = 1; }
    else if (t < W + H) { ex = B.maxX; ez = B.minZ + t - W; ax = 0; az = 1; ix = -1; iz = 0; }
    else if (t < 2 * W + H) { ex = B.maxX - (t - W - H); ez = B.maxZ; ax = -1; az = 0; ix = 0; iz = -1; }
    else { ex = B.minX; ez = B.maxZ - (t - 2 * W - H); ax = 0; az = -1; ix = 1; iz = 0; }
    let s = 0, n = 0;
    for (let u = -64; u <= 64; u += C) for (let v = 20; v <= 230; v += C) {
      const i = Math.floor((ex + ax * u + ix * v - B.minX) / C), j = Math.floor((ez + az * u + iz * v - B.minZ) / C);
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      s += cov[j * nx + i]; n++;
    }
    raw[k] = n ? s / n : 0;
  }
  const prof = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    let s = 0;
    for (let d = -3; d <= 3; d++) s += raw[(k + d + N) % N];
    prof[k] = sstep(0.035, 0.12, s / 7);
  }
  const px = new Uint8Array(N * 4);
  for (let k = 0; k < N; k++) px[k * 4] = px[k * 4 + 1] = px[k * 4 + 2] = Math.round(prof[k] * 255), px[k * 4 + 3] = 255;
  const tex = new THREE.DataTexture(px, N, 1, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  // JS lookup identical to the shader's (perimeter position of the nearest edge point, linear filtering)
  const at = (x, z) => {
    const rx = Math.min(W, Math.max(0, x - B.minX)), rz = Math.min(H, Math.max(0, z - B.minZ));
    const dT = rz, dR = W - rx, dB = H - rz, dL = rx, m = Math.min(dT, dR, dB, dL);
    const t = m === dT ? rx : m === dR ? W + rz : m === dB ? 2 * W + H - rx : 2 * W + 2 * H - rz;
    const f = (t / P) * N - 0.5, i0 = Math.floor(f), fr = f - i0;
    const a = px[(((i0 % N) + N) % N) * 4] / 255, b = px[((((i0 + 1) % N) + N) % N) * 4] / 255;
    return a + (b - a) * fr;
  };
  return { tex, at };
}

// Lookup of the rendered skirt surface (height + normal.y, barycentric on its triangles) out to maxOut metres.
function* skirtSurface(geo, B, maxOut) {
  const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, idx = geo.index.array;
  const C = 24, x0 = B.minX - maxOut - C, z0 = B.minZ - maxOut - C;
  const nx = Math.ceil((B.maxX - B.minX + 2 * maxOut + 2 * C) / C), nz = Math.ceil((B.maxZ - B.minZ + 2 * maxOut + 2 * C) / C);
  const cells = new Map();
  for (let t = 0; t < idx.length; t += 3) {
    if (t % 6000 === 0) yield;
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const tx0 = Math.min(pos[a], pos[b], pos[c]), tx1 = Math.max(pos[a], pos[b], pos[c]);
    const tz0 = Math.min(pos[a + 2], pos[b + 2], pos[c + 2]), tz1 = Math.max(pos[a + 2], pos[b + 2], pos[c + 2]);
    if (tx1 < x0 || tz1 < z0 || tx0 > x0 + nx * C || tz0 > z0 + nz * C) continue;
    for (let j = Math.max(0, Math.floor((tz0 - z0) / C)); j <= Math.min(nz - 1, Math.floor((tz1 - z0) / C)); j++) {
      for (let i = Math.max(0, Math.floor((tx0 - x0) / C)); i <= Math.min(nx - 1, Math.floor((tx1 - x0) / C)); i++) {
        const k = j * nx + i;
        let l = cells.get(k);
        if (!l) cells.set(k, (l = []));
        l.push(t);
      }
    }
  }
  const out = { y: 0, ny: 1 };
  return (x, z) => {
    const i = Math.floor((x - x0) / C), j = Math.floor((z - z0) / C);
    if (i < 0 || j < 0 || i >= nx || j >= nz) return null;
    const l = cells.get(j * nx + i);
    if (!l) return null;
    for (const t of l) {
      const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
      const v0x = pos[b] - pos[a], v0z = pos[b + 2] - pos[a + 2], v1x = pos[c] - pos[a], v1z = pos[c + 2] - pos[a + 2];
      const v2x = x - pos[a], v2z = z - pos[a + 2];
      const den = v0x * v1z - v1x * v0z;
      if (Math.abs(den) < 1e-9) continue;
      const u = (v2x * v1z - v1x * v2z) / den, v = (v0x * v2z - v2x * v0z) / den;
      if (u < -1e-6 || v < -1e-6 || u + v > 1 + 1e-6) continue;
      const w = 1 - u - v;
      out.y = pos[a + 1] * w + pos[b + 1] * u + pos[c + 1] * v;
      out.ny = nor[a + 1] * w + nor[b + 1] * u + nor[c + 1] * v;
      return out;
    }
    return null;
  };
}

// Tree colours for the surroundings (linear), a little darker than the campus trees (distance, dense woods).
const SK_GREEN = ['#44692d', '#4f7431', '#3b6028', '#385c29', '#426a2e', '#2f4a32'].map((c) => new THREE.Color(c));
const SK_AUTUMN = ['#b8931f', '#c9a42e', '#b86c22', '#a44c1c', '#8a2f1d'].map((c) => new THREE.Color(c));
const SK_SPRING = ['#6e9c3f', '#7aa845', '#62903a'].map((c) => new THREE.Color(c));
const SK_TWIG = new THREE.Color('#7a7068'), SK_YELLOWED = new THREE.Color('#8a8a2e'), SK_CONIFER = new THREE.Color('#2c4631');
const SK_ROOFS = [[0.05, 0.05, 0.055], [0.11, 0.05, 0.036], [0.16, 0.15, 0.14], [0.085, 0.075, 0.065]];
// siding (white, cream, grey-blue, sage, yellow) and Pittsburgh red / brown brick
const SK_WALLS = ['#f0ece2', '#e4d6b8', '#c9d3d8', '#b7c2b0', '#d9c38f', '#a45a44', '#8e4a3a', '#9c5a46', '#b36d52', '#7f4838'].map((c) => new THREE.Color(c));

// Materials + geometries of the surroundings, made before the shaders are precompiled (with never-drawn
// placeholder instances in `group`), so the deferred build reuses already compiled programs.
const SK_WALL_H = 6.4, SK_BASE = 1.6; // house wall height above the lowest corner; foundation below it
function skirtKit(ctx) {
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  treeMat.name = 'surroundings-trees';
  const wallMat = ctx.materials.facade({ wall: 'concrete', wallColor: '#e6e1d6', style: 'punched', bay: 2.9, floor: 3.1, winW: 1.0, winH: 1.45, sill: 0.95, frame: '#f3f0ea', lit: 0.3, seed: 31 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.86, metalness: 0 });
  roofMat.name = 'surroundings-roofs';
  const roadMat = new THREE.MeshStandardMaterial({ color: '#46484b', roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  roadMat.name = 'surroundings-roads';
  const kit = {
    treeMat, wallMat, roofMat, roadMat,
    treeGeoNear: skirtTreeGeometry(1), treeGeoFar: skirtTreeGeometry(0),
    wallGeo: houseWalls(8.8, 11.4, SK_WALL_H, SK_BASE), roofGeo: gableRoof(),
    group: new THREE.Group(),
  };
  kit.group.name = 'terrain-surroundings';
  const zero = new THREE.Matrix4().makeScale(0, 0, 0), white = new THREE.Color(1, 1, 1);
  for (const [geo, mat] of [[kit.treeGeoFar, treeMat], [kit.wallGeo, wallMat], [kit.roofGeo, roofMat]]) {
    const m = new THREE.InstancedMesh(geo, mat, 1);
    m.setMatrixAt(0, zero); m.setColorAt(0, white);
    m.visible = false; m.name = 'surroundings-placeholder';
    kit.group.add(m);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute([0, -1e4, 0, 1, -1e4, 0, 0, -1e4, 1], 3));
  rg.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  rg.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  const rm = new THREE.Mesh(rg, roadMat);
  rm.visible = false; rm.name = 'surroundings-placeholder';
  kit.group.add(rm);
  kit.group.matrixAutoUpdate = false;
  ctx.scene.add(kit.group);
  return kit;
}

// trees: rounded low-poly crown + short trunk in one geometry (vertex colour: dark trunk, crown shaded from
// underneath). Unit tree, height 1: trunk 0 … 0.45, crown an ellipsoid (radii 1 / 0.38 / 1) around y = 0.62,
// gently lumpy, with smooth ellipsoid normals. Two levels of detail: 80-triangle crowns next to the data,
// 20-triangle ones further out (they are only ever seen from a few hundred metres away).
function skirtTreeGeometry(detail) {
  const crown = new THREE.IcosahedronGeometry(1, detail);
  const cp = crown.attributes.position, cn = crown.attributes.normal;
  const cc = new Float32Array(cp.count * 3);
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
    const k = 0.9 + 0.2 * Math.sin(x * 5.1 + z * 3.7) * Math.cos(y * 4.3);
    cp.setXYZ(i, x * k, y * k * 0.38 + 0.62, z * k);
    const nx = x, ny = y / 0.38, nz = z, l = Math.hypot(nx, ny, nz) || 1;
    cn.setXYZ(i, nx / l, ny / l, nz / l);
    cc[i * 3] = cc[i * 3 + 1] = cc[i * 3 + 2] = 0.62 + 0.45 * (y * 0.5 + 0.5);
  }
  crown.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  const trunk = new THREE.CylinderGeometry(0.07, 0.1, 0.45, 4, 1, true).translate(0, 0.225, 0).toNonIndexed();
  trunk.setAttribute('color', new THREE.Float32BufferAttribute(new Array(trunk.attributes.position.count * 3).fill(0.3), 3));
  crown.deleteAttribute('uv'); trunk.deleteAttribute('uv');
  return mergeGeometries([crown.index ? crown.toNonIndexed() : crown, trunk]);
}

// A generator: yields every few hundred placements so the caller can spread the work over frames
// (createTerrain runs it after the first frame, a few ms per frame). Returns { group, setSeason, stats }.
function* buildSkirtContent(ctx, { B, skirtGeo, surface, detailData, meshHeightAt, edgeAt, kit }) {
  const S = 512;
  let nIt = 0;
  const A = (u, v) => { // uDetail alpha, bilinear, repeat, mip 0 (as the shader samples it near the camera)
    const x = u * S - 0.5, y = v * S - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const i0 = x0 & 511, i1 = (x0 + 1) & 511, j0 = y0 & 511, j1 = (y0 + 1) & 511;
    const a = detailData[(j0 * S + i0) * 4 + 3], b = detailData[(j0 * S + i1) * 4 + 3];
    const c = detailData[(j1 * S + i0) * 4 + 3], d = detailData[(j1 * S + i1) * 4 + 3];
    return ((a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy) / 255;
  };
  const MAXOUT = SKIRT_LOOKUP_OUT;
  // the rendered skirt surface (shared with meshHeightAt, which keeps it; the other scratch lookups are dropped
  // at the end: the season closure keeps this scope alive)
  let surf = surface?.get();
  if (!surf) { surf = yield* skirtSurface(skirtGeo, B, MAXOUT); surface?.set(surf); }
  const dOutOf = (x, z) => Math.hypot(Math.max(B.minX - x, 0, x - B.maxX), Math.max(B.minZ - z, 0, z - B.maxZ));
  const inGrid = (x, z) => x >= B.minX && x <= B.maxX && z >= B.minZ && z <= B.maxZ;
  const groundY = (x, z) => (inGrid(x, z) ? meshHeightAt(x, z) : (surf(x, z)?.y ?? meshHeightAt(x, z)));

  // ---- street grid / lots of OUTER_GLSL
  const grid = (x, z) => {
    const sel = A(x / 5300 + 0.27, z / 5300 + 0.27) >= 0.5 ? 1 : 0;
    const ang = sel ? -0.52 : 0.21, ca = Math.cos(ang), sa = Math.sin(ang);
    const qx = ca * x - sa * z + sel * 37 + (A(x / 1700 + 0.33, z / 1700 + 0.33) - 0.5) * 110;
    const qz = sa * x + ca * z + sel * 11 + (A(x / 1700 + 0.71, z / 1700 + 0.71) - 0.5) * 110;
    return { sel, ang, ca, sa, qx, qz };
  };
  const lotHouse = (sel, lx, lz) => {
    const h = gHashJS(lx + sel * 17, lz + sel * 17);
    if (h < 0.16) return null;
    const side = (((lz % 2) + 2) % 2) < 0.5 ? -1 : 1;
    const k = 0.85 + 0.35 * (h * 7.13 - Math.floor(h * 7.13));
    return { h, qx: (lx + 0.5) * 13 + (h - 0.5) * 1.6, qz: (lz + 0.5) * 33 + side * (16.5 - 13), hx: 4.1 * k, hz: 5.3 * k };
  };
  // land use at (x, z) with the surface normal's y (near-camera version: bands and lots fully resolved)
  const classify = (x, z, ny, g = grid(x, z)) => {
    const nBig = A(x / 3100 + 0.13, z / 3100 + 0.71);
    const nMid = A((0.8 * x - 0.6 * z) / 870 + 0.4, (0.6 * x + 0.8 * z) / 870 + 0.4);
    const nSm = A((0.28 * x + 0.96 * z) / 230 + 0.2, (-0.96 * x + 0.28 * z) / 230 + 0.2);
    let town = sstep(0.93, 0.972, ny) * sstep(0.43, 0.52, nBig * 0.6 + nMid * 0.4 + (nSm - 0.5) * 0.15);
    town += (edgeAt(x, z) * sstep(0.8, 0.9, ny) - town) * (1 - sstep(180, 650, dOutOf(x, z))) * 0.9;
    const park = town * sstep(0.64, 0.72, nMid) * 0.9;
    const dex = 52 - Math.abs((g.qx / 104 - Math.floor(g.qx / 104) - 0.5) * 104);
    const dez = 33 - Math.abs((g.qz / 66 - Math.floor(g.qz / 66) - 0.5) * 66);
    const street = dex < 4.2 || dez < 4.2 ? 1 : 0;
    const cn = A((0.8 * x - 0.6 * z) / 26, (0.6 * x + 0.8 * z) / 26) * 0.55 + A((0.28 * x + 0.96 * z) / 9.7 + 0.3, (-0.96 * x + 0.28 * z) / 9.7 + 0.3) * 0.45;
    const canTown = sstep(0.43, 0.54, cn + (nSm - 0.5) * 0.3);
    let cover = 0.95 + (canTown * 0.93 - 0.95) * town;
    cover += (canTown * 0.35 - cover) * park;
    return { town, park, street, treeHide: cover * (1 - street * town * 0.6), dex, dez };
  };

  // ---- mapped roads leaving the data: continued as 3D asphalt ribbons over the skirt
  const roadSegs = []; // for keeping trees / houses off them
  const ribbon = { pos: [], nor: [], uv: [], idx: [] };
  const skipRoads = ctx.skipRoadIds || new Set();
  for (const r of ctx.data.roads) {
    if ((++nIt & 63) === 0) yield;
    if (r.bridge || r.tunnel || skipRoads.has(r.id) || r.points.length < 2) continue;
    const w = r.width || (r.type === 'service' ? 4.5 : r.type === 'footway' ? 2 : 7);
    // runs of 4 m samples from 3 m inside the edge outwards, within MAXOUT
    const pts = [];
    for (let i = 1; i < r.points.length; i++) {
      const [ax, az] = r.points[i - 1], [bx, bz] = r.points[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 4));
      for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        for (let i = 1; i < run.length; i++) roadSegs.push([run[i - 1][0], run[i - 1][1], run[i][0], run[i][1], w / 2]);
        addRibbon(ribbon, run, w, groundY);
      }
      run = [];
    };
    for (const p of pts) {
      const out = dOutOf(p[0], p[1]);
      const inside = inGrid(p[0], p[1]);
      const edgeDist = inside ? Math.min(p[0] - B.minX, B.maxX - p[0], p[1] - B.minZ, B.maxZ - p[1]) : -out;
      if (edgeDist < 3 && out < MAXOUT) run.push(p); else flush();
    }
    flush();
  }
  // mapped railways leaving the data (rail.js draws them out to RAIL_OUT): trees and houses keep clear
  for (const r of ctx.data.railways || []) {
    if ((++nIt & 63) === 0) yield;
    if (r.tunnel || r.points.length < 2 || RAIL_GONE.has(r.type)) continue;
    let prev = null;
    for (const p of resamplePolyline(r.points, 4)) {
      const ok = !inGrid(p.x, p.z) && dOutOf(p.x, p.z) < RAIL_OUT + 8;
      if (ok && prev) roadSegs.push([prev.x, prev.z, p.x, p.z, 3.2]);
      prev = ok ? p : null;
    }
  }
  const SEGC = 32, segGrid = new Map();
  for (const s of roadSegs) {
    for (let i = Math.floor((Math.min(s[0], s[2]) - s[4] - 4) / SEGC); i <= Math.floor((Math.max(s[0], s[2]) + s[4] + 4) / SEGC); i++) {
      for (let j = Math.floor((Math.min(s[1], s[3]) - s[4] - 4) / SEGC); j <= Math.floor((Math.max(s[1], s[3]) + s[4] + 4) / SEGC); j++) {
        const k = i * 100003 + j;
        let l = segGrid.get(k);
        if (!l) segGrid.set(k, (l = []));
        l.push(s);
      }
    }
  }
  const nearRoad = (x, z, pad) => {
    const l = segGrid.get(Math.floor(x / SEGC) * 100003 + Math.floor(z / SEGC));
    if (l) for (const [ax, az, bx, bz, hw] of l) {
      const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
      if (Math.hypot(x - ax - ex * t, z - az - ez * t) < hw + pad) return true;
    }
    return false;
  };

  // Mapped features that reach beyond the grid (94 buildings such as the Cathedral of Learning, Schenley Park,
  // the golf course, lots): 3D content keeps off them. Houses stay out of every such area, trees only out of
  // paved ones; around buildings a margin (wider for tall ones).
  const FC = 50, featGrid = new Map();
  const addFeat = (f) => {
    const [x0, z0, x1, z1] = f.bb;
    const g = f.pad + 10; // (+ the largest house radius)
    for (let i = Math.floor((x0 - g) / FC); i <= Math.floor((x1 + g) / FC); i++) {
      for (let j = Math.floor((z0 - g) / FC); j <= Math.floor((z1 + g) / FC); j++) {
        const k = i * 100003 + j;
        let l = featGrid.get(k);
        if (!l) featGrid.set(k, (l = []));
        l.push(f);
      }
    }
  };
  const bbOf = (ring) => {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return [x0, z0, x1, z1];
  };
  const reachesOut = (bb) => bb[0] < B.minX || bb[1] < B.minZ || bb[2] > B.maxX || bb[3] > B.maxZ;
  for (const b of ctx.data.buildings) {
    if (!b.footprint || b.footprint.length < 3) continue;
    const bb = bbOf(b.footprint);
    if (reachesOut(bb)) addFeat({ ring: b.footprint, bb, building: true, pad: (b.height || 10) > 40 ? 35 : 9 });
  }
  const PAVED = new Set(['parking', 'pavement', 'plaza', 'pitch', 'stadium', 'track', 'water', 'construction', 'playground']);
  for (const a of ctx.data.areas) {
    if (!a.polygon || a.polygon.length < 3 || a.type === 'bridgeArea') continue;
    const bb = bbOf(a.polygon);
    if (reachesOut(bb)) addFeat({ ring: a.polygon, bb, building: false, paved: PAVED.has(a.type), pad: 0 });
  }
  const ringDist = (x, z, ring) => {
    let best = Infinity;
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const [ax, az] = ring[b], ex = ring[a][0] - ax, ez = ring[a][1] - az, l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
      best = Math.min(best, Math.hypot(x - ax - ex * t, z - az - ez * t));
    }
    return best;
  };
  // forHouse: the whole lot must be clear (r = footprint radius); trees: their crown spot
  const blocked = (x, z, forHouse, r = 0) => {
    const l = featGrid.get(Math.floor(x / FC) * 100003 + Math.floor(z / FC));
    if (!l) return false;
    for (const f of l) {
      const pad = f.building ? (forHouse ? f.pad : 3) + r : r;
      if (x < f.bb[0] - pad || x > f.bb[2] + pad || z < f.bb[1] - pad || z > f.bb[3] + pad) continue;
      if (!f.building && !forHouse && !f.paved) continue;
      if (pointInRing(x, z, f.ring) || (pad > 0 && ringDist(x, z, f.ring) < pad)) return true;
    }
    return false;
  };

  // sector (side of the data rectangle) → one draw call per kind and side, culled as a unit
  // (each side split in two halves, so views from inside the campus cull what is behind them)
  // (at low one per side: fewer draw calls matter more there than culling half a side)
  const halves = ctx.quality?.level !== 'low';
  const SECTORS = halves ? 8 : 4;
  const sectorOf = (x, z) => {
    const u = (x - (B.minX + B.maxX) / 2) / (B.maxX - B.minX), v = (z - (B.minZ + B.maxZ) / 2) / (B.maxZ - B.minZ);
    const side = Math.abs(u) > Math.abs(v) ? (u > 0 ? 1 : 3) : (v > 0 ? 2 : 0);
    return halves ? side * 2 + ((side === 0 || side === 2 ? u : v) > 0 ? 1 : 0) : side;
  };

  // ---- houses on the painted lots
  const rnd = mulberry(9091);
  const lots = new Map();
  for (let x = B.minX - SKIRT_3D.houses; x <= B.maxX + SKIRT_3D.houses; x += 6) {
    for (let z = B.minZ - SKIRT_3D.houses; z <= B.maxZ + SKIRT_3D.houses; z += 6) {
      if ((++nIt & 2047) === 0) yield;
      const d = dOutOf(x, z);
      if (d < 4 || d > SKIRT_3D.houses) continue;
      const g = grid(x, z);
      const lx = Math.floor(g.qx / 13), lz = Math.floor(g.qz / 33), key = `${g.sel},${lx},${lz}`;
      if (!lots.has(key)) lots.set(key, { sel: g.sel, lx, lz });
    }
  }
  const houses = [], houseLots = new Set();
  for (const [key, L] of lots) {
    if ((++nIt & 255) === 0) yield;
    const hsd = lotHouse(L.sel, L.lx, L.lz);
    if (!hsd) continue;
    // world position of the lot's house centre: invert q(wp) (rotation + slowly varying warp) by iteration
    const ang = L.sel ? -0.52 : 0.21, ca = Math.cos(ang), sa = Math.sin(ang);
    let x = 0, z = 0;
    for (let it = 0; it < 5; it++) {
      const wx = it ? (A(x / 1700 + 0.33, z / 1700 + 0.33) - 0.5) * 110 : 0, wz = it ? (A(x / 1700 + 0.71, z / 1700 + 0.71) - 0.5) * 110 : 0;
      const a = hsd.qx - L.sel * 37 - wx, b = hsd.qz - L.sel * 11 - wz;
      x = ca * a + sa * b; z = -sa * a + ca * b;
    }
    const g = grid(x, z);
    if (g.sel !== L.sel || Math.abs(g.qx - hsd.qx) > 0.6 || Math.abs(g.qz - hsd.qz) > 0.6) continue;
    const d = dOutOf(x, z);
    if (d < Math.max(hsd.hx, hsd.hz) + 3 || d > SKIRT_3D.houses) continue;
    const s = surf(x, z);
    if (!s) continue;
    const c = classify(x, z, s.ny, g);
    if (c.town * (1 - c.park) * (1 - c.treeHide) < 0.5) continue;
    if (nearRoad(x, z, Math.max(hsd.hx, hsd.hz) + 2) || blocked(x, z, true, Math.hypot(hsd.hx, hsd.hz))) continue;
    // footprint corners on the rendered surface; skip lots too steep for a plain box
    let lo = Infinity, hi = -Infinity;
    for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const cx = x + ca * u * hsd.hx + sa * v * hsd.hz, cz = z - sa * u * hsd.hx + ca * v * hsd.hz;
      const y = surf(cx, cz)?.y;
      if (y === undefined) { lo = NaN; break; }
      lo = Math.min(lo, y); hi = Math.max(hi, y);
    }
    if (!(hi - lo < 3.5)) continue;
    houseLots.add(key);
    ctx.colliders?.addBox?.(x, z, hsd.hx, hsd.hz, ang, lo - 2, hi + 10, 'house'); // (walking out past the data)
    houses.push({ x, z, y: lo, rise: hi - lo, ang, hx: hsd.hx, hz: hsd.hz, h: hsd.h, sector: sectorOf(x, z), r: rnd() });
  }

  // ---- trees on the painted canopy
  const trees = [];
  const TS = 8.5;
  const treeDensity = Math.min(1, Math.max(0.3, ctx.quality?.treeDensity ?? 1));
  for (let x = B.minX - SKIRT_3D.trees; x <= B.maxX + SKIRT_3D.trees; x += TS) {
    for (let z = B.minZ - SKIRT_3D.trees; z <= B.maxZ + SKIRT_3D.trees; z += TS) {
      if ((++nIt & 511) === 0) yield;
      const px = x + (rnd() - 0.5) * TS, pz = z + (rnd() - 0.5) * TS;
      const d = dOutOf(px, pz);
      if (d < 2.5 || d > SKIRT_3D.trees) continue;
      const density = (1 - 0.7 * sstep(SKIRT_3D.treesFull, SKIRT_3D.trees, d)) * treeDensity;
      const pick = rnd();
      if (pick > 0.92 * density) continue;
      const s = surf(px, pz);
      if (!s) continue;
      const g = grid(px, pz);
      const c = classify(px, pz, s.ny, g);
      if (pick > c.treeHide * 0.92 * density) continue;
      if (nearRoad(px, pz, 2.5) || blocked(px, pz, false)) continue;
      // not inside (or right next to) a 3D house
      const lx = Math.floor(g.qx / 13), lz = Math.floor(g.qz / 33);
      if (houseLots.has(`${g.sel},${lx},${lz}`)) {
        const hsd = lotHouse(g.sel, lx, lz);
        if (hsd && Math.abs(g.qx - hsd.qx) < hsd.hx + 3 && Math.abs(g.qz - hsd.qz) < hsd.hz + 3) continue;
      }
      const woods = 1 - c.town;
      trees.push({ x: px, z: pz, y: s.y, d, woods, sector: sectorOf(px, pz), r1: rnd(), r2: rnd(), r3: rnd() });
    }
  }

  // ---- meshes
  yield;
  const group = kit.group;
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), P3 = new THREE.Vector3(), SC = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const instanced = (geo, mat, list, setup, name) => {
    const meshes = [];
    for (let s = 0; s < SECTORS; s++) {
      const items = list.filter((t) => t.sector === s);
      if (!items.length) continue;
      const m = new THREE.InstancedMesh(geo, mat, items.length);
      items.forEach((t, i) => { setup(t, i, m); });
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      m.castShadow = false; m.receiveShadow = false;
      m.matrixAutoUpdate = false;
      m.name = `${name}-${s}`;
      m.userData.items = items;
      group.add(m);
      meshes.push(m);
    }
    return meshes;
  };

  const treeMat = kit.treeMat;
  const placeTree = (t, i, m) => {
    const R = t.woods > 0.5 ? 3.9 + t.r1 * 2.7 : 2.9 + t.r1 * 2.3;       // crown radius
    const Hh = R * (2.0 + t.r2 * 0.8);                                    // total height
    Q.setFromAxisAngle(UP, t.r3 * Math.PI * 2);
    m.setMatrixAt(i, M4.compose(P3.set(t.x, t.y - 0.3, t.z), Q, SC.set(R, Hh, R * (0.9 + t.r2 * 0.2))));
    m.setColorAt(i, col.setRGB(1, 1, 1));
  };
  const LOD_NEAR = ctx.quality?.level === 'low' ? 0 : 110;
  const treeMeshes = [
    ...instanced(kit.treeGeoNear, treeMat, trees.filter((t) => t.d < LOD_NEAR), placeTree, 'surroundings-trees'),
    ...instanced(kit.treeGeoFar, treeMat, trees.filter((t) => t.d >= LOD_NEAR), placeTree, 'surroundings-trees-far'),
  ];
  yield;
  // early autumn like the campus trees: mostly green, a little yellowed, about one in eight turning
  const colourTrees = (season) => {
    for (const m of treeMeshes) {
      m.userData.items.forEach((t, i) => {
        const conifer = t.r2 < (t.woods > 0.5 ? 0.1 : 0.05);
        if (conifer) col.copy(SK_CONIFER);
        else col.copy(SK_GREEN[Math.floor(t.r1 * 997) % SK_GREEN.length]);
        if (!conifer) {
          if (season === 'autumn') {
            if (t.r3 < 0.13) col.lerp(SK_AUTUMN[Math.floor(t.r2 * 991) % SK_AUTUMN.length], 0.4 + t.r3 * 3);
            else col.lerp(SK_YELLOWED, 0.04 + t.r1 * 0.14);
          } else if (season === 'winter') col.copy(SK_TWIG).multiplyScalar(0.85 + t.r1 * 0.3);
          else if (season === 'spring') col.copy(SK_SPRING[Math.floor(t.r1 * 997) % SK_SPRING.length]);
        } else if (season === 'winter') col.multiplyScalar(0.8);
        m.setColorAt(i, col.multiplyScalar(0.8 + t.r2 * 0.28));
      });
      m.instanceColor.needsUpdate = true;
    }
  };

  // houses: walls (facade with night-lit windows, metre UVs for a typical 8.8 × 11.4 m house) + gable roof
  const WALL_H = SK_WALL_H, BASE = SK_BASE;
  const { wallGeo, roofGeo, wallMat, roofMat } = kit;
  instanced(wallGeo, wallMat, houses, (h, i, m) => {
    Q.setFromAxisAngle(UP, h.ang);
    m.setMatrixAt(i, M4.compose(P3.set(h.x, h.y - BASE, h.z), Q, SC.set(h.hx / 4.4, 1, h.hz / 5.7)));
    m.setColorAt(i, SK_WALLS[Math.floor(h.r * 997) % SK_WALLS.length]);
  }, 'surroundings-houses');
  yield;
  instanced(roofGeo, roofMat, houses, (h, i, m) => {
    Q.setFromAxisAngle(UP, h.ang);
    const rh = 2.3 + (h.h * 5.3 - Math.floor(h.h * 5.3)) * 1.4;
    m.setMatrixAt(i, M4.compose(P3.set(h.x, h.y + WALL_H, h.z), Q, SC.set(h.hx * 1.07, rh, h.hz * 1.05)));
    const rc = SK_ROOFS[h.h < 0.45 ? 0 : h.h < 0.68 ? 1 : h.h < 0.87 ? 2 : 3];
    m.setColorAt(i, col.setRGB(rc[0] * 1.6, rc[1] * 1.6, rc[2] * 1.6));
  }, 'surroundings-roofs');

  // road ribbons
  if (ribbon.pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ribbon.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(ribbon.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(ribbon.uv, 2));
    g.setIndex(ribbon.idx);
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, kit.roadMat);
    m.name = 'surroundings-roads';
    m.matrixAutoUpdate = false;
    group.add(m);
  }
  group.updateMatrixWorld(true);
  colourTrees(ctx.env?.state?.season || 'autumn');
  const stats = { trees: trees.length, houses: houses.length, roadSegments: roadSegs.length };
  surf = null; segGrid.clear(); featGrid.clear(); lots.clear(); roadSegs.length = 0; houseLots.clear();
  return {
    group,
    setSeason: colourTrees,
    stats,
  };
}

// Asphalt ribbon along a polyline, draped on groundY (+ a few cm), with metre UVs.
function addRibbon(buf, run, w, groundY) {
  const base = buf.pos.length / 3;
  let s = 0;
  for (let i = 0; i < run.length; i++) {
    const a = run[Math.max(0, i - 1)], b = run[Math.min(run.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    if (i) s += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]);
    for (const side of [-1, 1]) {
      const x = run[i][0] - tz * side * w / 2, z = run[i][1] + tx * side * w / 2;
      buf.pos.push(x, groundY(x, z) + 0.12, z);
      buf.nor.push(0, 1, 0);
      buf.uv.push(side * w / 2, s);
    }
    if (i) {
      const k = base + i * 2;
      buf.idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
    }
  }
  // make sure the faces point up
  for (let t = buf.idx.length - (run.length - 1) * 6; t < buf.idx.length; t += 3) {
    const [a, b, c] = [buf.idx[t] * 3, buf.idx[t + 1] * 3, buf.idx[t + 2] * 3];
    const cr = (buf.pos[b + 2] - buf.pos[a + 2]) * (buf.pos[c] - buf.pos[a]) - (buf.pos[b] - buf.pos[a]) * (buf.pos[c + 2] - buf.pos[a + 2]);
    if (cr < 0) { const tmp = buf.idx[t + 1]; buf.idx[t + 1] = buf.idx[t + 2]; buf.idx[t + 2] = tmp; }
  }
}

// House walls: an open box (no top / bottom), local x ∈ ±W/2, z ∈ ±D/2, y from -base to H (unit scale = the
// typical house; instances scale x / z). UVs in metres, v = 0 at the lowest ground corner (facade contract).
function houseWalls(W, D, H, base) {
  const pos = [], nor = [], uv = [];
  const faces = [
    [[-W / 2, D / 2], [W / 2, D / 2], [0, 0, 1], W], [[W / 2, D / 2], [W / 2, -D / 2], [1, 0, 0], D],
    [[W / 2, -D / 2], [-W / 2, -D / 2], [0, 0, -1], W], [[-W / 2, -D / 2], [-W / 2, D / 2], [-1, 0, 0], D],
  ];
  for (const [[ax, az], [bx, bz], n, L] of faces) {
    const q = [[ax, -base, az, 0, -base], [bx, -base, bz, L, -base], [bx, H, bz, L, H], [ax, H, az, 0, H]];
    for (const k of [0, 1, 2, 0, 2, 3]) { const v = q[k]; pos.push(v[0], v[1] + base, v[2]); nor.push(...n); uv.push(v[3], v[4]); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

// Gable roof over x ∈ ±1, z ∈ ±1: eaves at y = 0, ridge (along z) at y = 1.
function gableRoof() {
  const P = [[-1, 0, -1], [0, 1, -1], [1, 0, -1], [-1, 0, 1], [0, 1, 1], [1, 0, 1]];
  const tris = [[0, 4, 1], [0, 3, 4], [1, 4, 5], [1, 5, 2], [0, 1, 2], [3, 5, 4]];
  const pos = [];
  for (const t of tris) for (const k of t) pos.push(...P[k]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // outward winding check (flip any face whose normal points into the roof)
  const p = g.attributes.position, n = g.attributes.normal;
  for (let f = 0; f < p.count; f += 3) {
    const cx = (p.getX(f) + p.getX(f + 1) + p.getX(f + 2)) / 3, cy = (p.getY(f) + p.getY(f + 1) + p.getY(f + 2)) / 3 - 0.35, cz = (p.getZ(f) + p.getZ(f + 1) + p.getZ(f + 2)) / 3;
    if (n.getX(f) * cx + n.getY(f) * cy + n.getZ(f) * cz < 0) {
      const x1 = p.getX(f + 1), y1 = p.getY(f + 1), z1 = p.getZ(f + 1);
      p.setXYZ(f + 1, p.getX(f + 2), p.getY(f + 2), p.getZ(f + 2));
      p.setXYZ(f + 2, x1, y1, z1);
    }
  }
  g.computeVertexNormals();
  return g;
}

// Concentric rings around the data rectangle. Ring 0 = the grid boundary (exact same vertices/heights), each next
// ring is further out with coarser spacing; consecutive rings are stitched side by side with a zipper
// triangulation, so there are no T-junctions or cracks.
function buildSkirt(B, GW, GH, CS, H, extHeightAt) {
  const pos = [], nor = [], idx = [];
  const addV = (x, z, y) => {
    const e = CS; // same stencil as the grid normals → no lighting seam at ring 0
    const hx = extHeightAt(x + e, z) - extHeightAt(x - e, z);
    const hz = extHeightAt(x, z + e) - extHeightAt(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    pos.push(x, y, z); nor.push(-hx / l, (2 * e) / l, -hz / l);
    return pos.length / 3 - 1;
  };
  // ring 0 sides use grid vertices (with the grid's own heights)
  const gridV = (i, j) => addV(B.minX + i * CS, B.minZ + j * CS, H[j * GW + i]);
  const ringSides = (k) => {
    const d = SKIRT_OFFSETS[k];
    if (k === 0) {
      const N = [], E = [], S = [], W = [];
      for (let i = 0; i < GW; i++) N.push(gridV(i, 0));
      for (let j = 0; j < GH; j++) E.push(j === 0 ? N[GW - 1] : gridV(GW - 1, j));
      for (let i = GW - 1; i >= 0; i--) S.push(i === GW - 1 ? E[GH - 1] : gridV(i, GH - 1));
      for (let j = GH - 1; j >= 0; j--) W.push(j === GH - 1 ? S[GW - 1] : j === 0 ? N[0] : gridV(0, j));
      return [N, E, S, W];
    }
    const prev = SKIRT_OFFSETS[k - 1], next = SKIRT_OFFSETS[Math.min(SKIRT_OFFSETS.length - 1, k + 1)];
    const spacing = Math.min(420, Math.max(CS, (next - prev) / 2));
    const x0 = B.minX - d, x1 = B.maxX + d, z0 = B.minZ - d, z1 = B.maxZ + d;
    const side = (ax, az, bx, bz) => {
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.ceil(L / spacing));
      const out = [];
      for (let s = 0; s <= n; s++) { const x = ax + ((bx - ax) * s) / n, z = az + ((bz - az) * s) / n; out.push(addV(x, z, extHeightAt(x, z))); }
      return out;
    };
    const N = side(x0, z0, x1, z0);
    const E = side(x1, z0, x1, z1); E[0] = N[N.length - 1];
    const S = side(x1, z1, x0, z1); S[0] = E[E.length - 1];
    const W = side(x0, z1, x0, z0); W[0] = S[S.length - 1]; W[W.length - 1] = N[0];
    return [N, E, S, W];
  };
  const tri = (a, b, c) => {
    // enforce upward winding
    const ax = pos[a * 3], az = pos[a * 3 + 2], bx = pos[b * 3], bz = pos[b * 3 + 2], cx = pos[c * 3], cz = pos[c * 3 + 2];
    const cross = (bz - az) * (cx - ax) - (bx - ax) * (cz - az); // y of (b-a)×(c-a)
    if (cross > 0) idx.push(a, b, c); else idx.push(a, c, b);
  };
  let inner = ringSides(0);
  for (let k = 1; k < SKIRT_OFFSETS.length; k++) {
    const outer = ringSides(k);
    for (let s = 0; s < 4; s++) {
      const A = inner[s], O = outer[s];
      const na = A.length - 1, no = O.length - 1;
      let i = 0, j = 0;
      while (i < na || j < no) {
        if (j >= no || (i < na && (i + 1) / na <= (j + 1) / no)) { tri(A[i], A[i + 1], O[j]); i++; }
        else { tri(A[i], O[j + 1], O[j]); j++; }
      }
    }
    inner = outer;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}
