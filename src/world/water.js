// Water: Westinghouse Pond, fountain basins (Mary Schenley Memorial Fountain, plaza fountains) with a cheap
// animated reflective surface (MeshStandardMaterial + procedural wave normals → the sky/env map does the reflecting).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pointInRing } from '../core/heightfield.js';
import { ringArea, mulberry, tileNoise } from './ground-painter.js';

// Classify water areas and compute their water level. Shared with terrain.js (which carves pond beds).
// kind: 'pond' (natural, level just under the lowest bank) | 'basin' (raised stone rim fountain / pool)
let cachedBodies = null;
export function waterBodies(ctx) {
  if (cachedBodies && cachedBodies.data === ctx.data) return cachedBodies.list;
  const list = [];
  const fountains = (ctx.data.pois || []).filter((p) => p.type === 'fountain');
  for (const a of ctx.data.areas) {
    if (a.type !== 'water' || !a.polygon || a.polygon.length < 3) continue;
    if (a.sport) continue; // steeplechase water pit etc.
    const area = ringArea(a.polygon);
    if (area < 5) continue;
    // sample bank heights every ~1 m
    const hs = [];
    const ring = a.polygon;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const n = Math.max(1, Math.ceil(L));
      for (let k = 0; k < n; k++) hs.push(ctx.heightAt(p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n));
    }
    hs.sort((x, y) => x - y);
    const lo = hs[Math.floor(hs.length * 0.08)], hi = hs[hs.length - 1];
    const hasJet = fountains.some((f) => pointInRing(f.x, f.z, ring)) || /fountain/i.test(a.name || '');
    const pond = /pond|lake/i.test(a.name || '') || (area > 400 && !/fountain/i.test(a.name || '') && !hasJet);
    let cx = 0, cz = 0;
    for (const [x, z] of ring) { cx += x; cz += z; }
    cx /= ring.length; cz /= ring.length;
    list.push({
      area: a, ring, size: area, kind: pond ? 'pond' : 'basin', hasJet,
      level: pond ? lo - 0.25 : hi + 0.3, rimTop: hi + 0.5, bankLow: lo, center: [cx, cz],
    });
  }
  // stand-alone fountain POIs (not inside any water polygon) → small round basin
  for (const f of fountains) {
    if (list.some((b) => pointInRing(f.x, f.z, b.ring))) continue;
    const r = 2.6, ring = [];
    for (let i = 0; i < 20; i++) { const a = (i / 20) * Math.PI * 2; ring.push([f.x + Math.cos(a) * r, f.z + Math.sin(a) * r]); }
    let hi = -Infinity;
    for (const [x, z] of ring) hi = Math.max(hi, ctx.heightAt(x, z));
    list.push({ area: null, ring, size: Math.PI * r * r, kind: 'basin', hasJet: true, level: hi + 0.3, rimTop: hi + 0.5, bankLow: hi, center: [f.x, f.z] });
  }
  cachedBodies = { data: ctx.data, list };
  return list;
}

// Tileable normal-ish noise texture (RG = slopes) for ripples, shared.
function rippleTexture() {
  const S = 256;
  const n = tileNoise(S, [8, 16, 32, 64], 91, [1, 0.8, 0.5, 0.3]);
  const d = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const dx = n[y * S + ((x + 1) % S)] - n[y * S + ((x + S - 1) % S)];
    const dy = n[((y + 1) % S) * S + x] - n[((y + S - 1) % S) * S + x];
    d[i * 4] = Math.max(0, Math.min(255, 128 + dx * 900));
    d[i * 4 + 1] = Math.max(0, Math.min(255, 128 + dy * 900));
    d[i * 4 + 2] = n[i] * 255; d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

export function createWaterMaterial(ctx, { color = '#1f3b40', strength = 1 } = {}) {
  const uniforms = { uTime: { value: 0 }, uRipple: { value: rippleTexture() }, uStrength: { value: strength } };
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.05, metalness: 0.0, envMapIntensity: 1.25 });
  mat.name = 'water';
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uTime;\nuniform float uStrength;\nuniform sampler2D uRipple;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        vec2 p = vWPos.xz;
        float t = uTime;
        vec2 g = vec2(0.0);
        g += vec2(0.8, 0.6) * 0.030 * cos(dot(p, vec2(0.8, 0.6)) * 1.9 + t * 1.3);
        g += vec2(-0.5, 0.85) * 0.022 * cos(dot(p, vec2(-0.5, 0.85)) * 3.1 + t * 1.9);
        g += vec2(0.95, -0.3) * 0.014 * cos(dot(p, vec2(0.95, -0.3)) * 5.3 + t * 2.6);
        vec2 r1 = texture2D(uRipple, p / 4.3 + t * vec2(0.021, 0.013)).rg - 0.5;
        vec2 r2 = texture2D(uRipple, p / 1.9 - t * vec2(0.017, 0.026)).rg - 0.5;
        g += (r1 * 0.22 + r2 * 0.14);
        float fd = 1.0 - smoothstep(20.0, 160.0, length(vWPos - cameraPosition));
        g *= uStrength * (0.35 + 0.65 * fd);
        vec3 wn = normalize(vec3(-g.x, 1.0, -g.y));
        normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
      }`);
  };
  mat.customProgramCacheKey = () => 'cmu-water-v1';
  ctx.onUpdate((dt, el) => { uniforms.uTime.value = el; }, 10);
  return mat;
}

// Water surface level at (x, z) inside a pond / basin ring, else null (for walk-mode surface queries: the DEM
// the walker stands on is not carved, so over a pond it lies above the water).
export function waterLevelAt(ctx, x, z) {
  for (const b of waterBodies(ctx)) {
    if (!b._bb) { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [px, pz] of b.ring) { x0 = Math.min(x0, px); x1 = Math.max(x1, px); z0 = Math.min(z0, pz); z1 = Math.max(z1, pz); } b._bb = [x0, z0, x1, z1]; }
    if (x < b._bb[0] || x > b._bb[2] || z < b._bb[1] || z > b._bb[3]) continue;
    if (pointInRing(x, z, b.ring)) return b.level;
  }
  return null;
}

// Flat polygon → BufferGeometry at height y (triangulated with THREE.ShapeUtils), metre UVs.
function flatPolygon(ring, y) {
  const contour = ring.map(([x, z]) => new THREE.Vector2(x, z));
  if (THREE.ShapeUtils.isClockWise(contour)) contour.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  const pos = new Float32Array(contour.length * 3), uv = new Float32Array(contour.length * 2);
  contour.forEach((v, i) => { pos[i * 3] = v.x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = v.y; uv[i * 2] = v.x; uv[i * 2 + 1] = v.y; });
  const idx = [];
  for (const t of tris) idx.push(t[0], t[2], t[1]); // shape CCW in (x,z) → flip so the face points up (+y)
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // make sure the normal points up
  if (g.attributes.normal.getY(0) < 0) { const ix = g.index.array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; } g.computeVertexNormals(); }
  return g;
}

// Wall ribbon along a closed ring: from yBottom to yTop, thickness outward (rim of a basin).
function rimGeometry(ring, yBottom, yTop, thick) {
  // outer ring = offset outward. Determine orientation: outward = right side for CCW (x,z) rings in z-south coords? compute by area sign
  let A = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) A += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  const sgn = A > 0 ? 1 : -1;
  const n = ring.length;
  const outer = ring.map((p, i) => {
    const a = ring[(i + n - 1) % n], b = ring[(i + 1) % n];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    // left normal (-tz, tx)·sgn points outward for this orientation
    const nx = tz * sgn, nz = -tx * sgn;
    return [p[0] + nx * thick, p[1] + nz * thick];
  });
  const pos = [];
  // triangle with winding fixed so its face normal agrees with the expected direction e
  const tri = (a, b, c, e) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * e[0] + ny * e[1] + nz * e[2] < 0) pos.push(...a, ...c, ...b); else pos.push(...a, ...b, ...c);
  };
  const quad = (a, b, c, d, e) => { tri(a, b, c, e); tri(a, c, d, e); };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const iA = [ring[i][0], yTop, ring[i][1]], iB = [ring[j][0], yTop, ring[j][1]];
    const oA = [outer[i][0], yTop, outer[i][1]], oB = [outer[j][0], yTop, outer[j][1]];
    const oAb = [outer[i][0], yBottom, outer[i][1]], oBb = [outer[j][0], yBottom, outer[j][1]];
    const iAb = [ring[i][0], yBottom, ring[i][1]], iBb = [ring[j][0], yBottom, ring[j][1]];
    const out = [(outer[i][0] + outer[j][0]) / 2 - (ring[i][0] + ring[j][0]) / 2, 0, (outer[i][1] + outer[j][1]) / 2 - (ring[i][1] + ring[j][1]) / 2];
    quad(iA, iB, oB, oA, [0, 1, 0]);                    // top
    quad(oA, oB, oBb, oAb, out);                         // outer face
    quad(iB, iA, iAb, iBb, [-out[0], 0, -out[2]]);       // inner face
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Build all water surfaces + fountain basins. Returns a Group.
export function createWater(ctx) {
  const group = new THREE.Group();
  group.name = 'water';
  const bodies = waterBodies(ctx);
  if (!bodies.length) return group;
  const mat = createWaterMaterial(ctx);
  const stone = ctx.materials.get('granite');
  const surfaces = [], rims = [];
  for (const b of bodies) {
    surfaces.push(flatPolygon(b.ring, b.level));
    if (b.kind === 'pond') {
      // walk mode stops at the bank (the walk surface is the uncarved DEM, which lies above the water level
      // over the pond: without this you could stroll across Panther Hollow Lake)
      ctx.colliders.addPolygon(insetRing(b.ring, 0.4), b.level - 3, b.level + 1.8, 'water');
    }
    if (b.kind === 'basin') {
      // the outer wall must reach below the terrain all the way round, also on sloping sites
      const thick = b.size > 60 ? 0.55 : 0.35;
      let low = b.bankLow;
      const [cx, cz] = b.center;
      for (const [x, z] of b.ring) {
        const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz) || 1;
        low = Math.min(low, ctx.heightAt(x + (dx / l) * (thick + 0.4), z + (dz / l) * (thick + 0.4)));
      }
      const bottom = low - 0.6;
      const rim = rimGeometry(b.ring, bottom, b.rimTop, thick);
      rims.push(ctx.materials.applyWorldUV(rim));
      if (b.size > 100) {
        // central pedestal (sculpture base) for the large memorial fountain
        const ped = new THREE.CylinderGeometry(1.6, 2.0, 2.4, 20);
        ped.translate(b.center[0], b.level + 1.1, b.center[1]);
        rims.push(ctx.materials.applyWorldUV(ped));
        ctx.colliders.addCircle(b.center[0], b.center[1], 2.0, b.level - 1, b.level + 2.4, 'fountain');
      }
      ctx.colliders.addPolygon(b.ring, bottom, b.rimTop, 'fountain');
    }
  }
  const water = new THREE.Mesh(mergeGeometries(surfaces), mat);
  water.receiveShadow = true;
  water.name = 'water-surfaces';
  group.add(water);
  if (rims.length) {
    const rimMesh = new THREE.Mesh(mergeGeometries(rims.map((g) => (g.index ? g.toNonIndexed() : g)).map(stripToPosNormUv)), stone);
    rimMesh.castShadow = true; rimMesh.receiveShadow = true;
    rimMesh.name = 'fountain-rims';
    group.add(rimMesh);
  }
  // jets
  const jets = bodies.filter((b) => b.hasJet);
  if (jets.length) group.add(createJets(ctx, jets));
  ctx.scene.add(group);
  return group;
}

// Ring moved inwards by d metres (mitred vertex offsets, clamped at sharp corners).
function insetRing(ring, d) {
  let A = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) A += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  const s = A > 0 ? 1 : -1, n = ring.length;
  return ring.map((p, i) => {
    const a = ring[(i + n - 1) % n], b = ring[(i + 1) % n];
    const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]];
    const l1 = Math.hypot(...e1) || 1, l2 = Math.hypot(...e2) || 1;
    // inward normals of both edges (left of travel for a positive-area ring in x/z)
    const n1 = [-e1[1] / l1 * s, e1[0] / l1 * s], n2 = [-e2[1] / l2 * s, e2[0] / l2 * s];
    let nx = n1[0] + n2[0], nz = n1[1] + n2[1];
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    const k = Math.min(2, 1 / Math.max(0.5, nx * n1[0] + nz * n1[1]));
    return [p[0] + nx * d * k, p[1] + nz * d * k];
  });
}

function stripToPosNormUv(g) {
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', g.attributes.position);
  if (!g.attributes.normal) g.computeVertexNormals();
  out.setAttribute('normal', g.attributes.normal);
  out.setAttribute('uv', g.attributes.uv || new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return out;
}

// Simple animated spray: translucent tapered cones with a scrolling streak texture.
function createJets(ctx, bodies) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0)'; g.fillRect(0, 0, 64, 256);
  const r = mulberry(5);
  for (let i = 0; i < 160; i++) {
    g.fillStyle = `rgba(255,255,255,${0.15 + r() * 0.5})`;
    g.fillRect(r() * 64, r() * 256, 1 + r() * 2, 6 + r() * 30);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide, color: '#e8f4ff' });
  mat.forceSinglePass = true; // thin translucent spray: one DoubleSide pass is enough (no back/front two-pass)
  mat.name = 'fountain-spray';
  const geos = [];
  for (const b of bodies) {
    const big = b.size > 100;
    const h = big ? 3.2 : 1.8;
    const main = new THREE.CylinderGeometry(0.05, big ? 0.6 : 0.3, h, 12, 1, true);
    main.translate(b.center[0], b.level + (big ? 2.4 : 0) + h / 2, b.center[1]);
    geos.push(main);
    const n = big ? 8 : 5, rr = big ? 3.2 : 1.1;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const j = new THREE.CylinderGeometry(0.03, 0.18, h * 0.45, 8, 1, true);
      j.translate(0, h * 0.225, 0);
      j.rotateZ(0.35);
      j.rotateY(-a);
      j.translate(b.center[0] + Math.cos(a) * rr, b.level, b.center[1] + Math.sin(a) * rr);
      geos.push(j);
    }
  }
  const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
  mesh.name = 'fountain-jets';
  mesh.renderOrder = 2;
  ctx.onUpdate((dt) => { tex.offset.y -= dt * 1.6; }, 10);
  return mesh;
}
