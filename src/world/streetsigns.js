// Street-name signs at the intersections of named streets, City of Pittsburgh style: blue blades with a thin white
// border and white mixed-case lettering (small directional prefix / street-type suffix), two blades crossed on a
// pole-top bracket, each blade parallel to the street it names. Poles stand on a corner of the intersection
// (the corner nearest campus that is clear of carriageways and buildings) and follow the terrain.
//
// Rendering: all blades share one canvas atlas and one material (the poles, brackets and blade edges sample solid
// swatches of the same atlas), geometry is merged per ~160 m chunk → one draw call per chunk, and chunks further
// than ~200 m from the camera are hidden. Low quality: only intersections on the main streets, no shadows.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { roadModel, abbrevRoad } from '../ui/roadlabels.js';
import { pointInRing } from '../core/heightfield.js';

const PXM = 136;                 // atlas px per metre of blade (blades a touch larger than life, for legibility)
const ROW = 40;                  // blade height in atlas px → 0.29 m
const GUTTER = 4;
const ATLAS_W = 1024;
const BLUE = '#1d5aa3';          // Pittsburgh street-sign blue
const WHITE = '#f6f8fb';
const POLE = '#8e9399';
const DARK = '#34383e';
const FONT = "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif";
const CHUNK = 160;               // m
const SHOW_DIST = 200;           // m
const BLADE_T = 0.022;           // m, blade thickness
const Y_LOW = 2.98, Y_HIGH = 3.25;   // blade centres above the sidewalk (m)

const SUFFIX = new Set(['Ave', 'St', 'Dr', 'Rd', 'Blvd', 'Pl', 'Ter', 'Ln', 'Ct', 'Way', 'Sq', 'Ext']);
const PREFIX = new Set(['N', 'S', 'E', 'W']);

export async function createStreetSigns(ctx) {
  const data = ctx.data;
  if (!data?.roads?.length || !ctx.scene) return;
  const low = ctx.quality?.level === 'low';
  const model = roadModel(data);
  const hAt = ctx.heightAt || (() => 0);

  // ------------------------------------------------------------ carriageway index (every drivable way)
  const SEG = 24;
  const segGrid = new Map();
  const skey = (i, j) => (i + 2048) * 4096 + (j + 2048);
  for (const r of data.roads) {
    if (r.tunnel || !r.points || r.points.length < 2) continue;
    const hw = (r.width || 6) / 2;
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i];
      const seg = [a[0], a[1], b[0], b[1], hw];
      const x0 = Math.floor((Math.min(a[0], b[0]) - hw) / SEG), x1 = Math.floor((Math.max(a[0], b[0]) + hw) / SEG);
      const z0 = Math.floor((Math.min(a[1], b[1]) - hw) / SEG), z1 = Math.floor((Math.max(a[1], b[1]) + hw) / SEG);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const k = skey(gx, gz);
        let l = segGrid.get(k);
        if (!l) segGrid.set(k, (l = []));
        l.push(seg);
      }
    }
  }
  function onCarriageway(x, z, margin) {
    for (const s of segGrid.get(skey(Math.floor(x / SEG), Math.floor(z / SEG))) || []) {
      const ex = s[2] - s[0], ez = s[3] - s[1];
      const l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s[0]) * ex + (z - s[1]) * ez) / l2));
      const px = s[0] + ex * t - x, pz = s[1] + ez * t - z;
      if (px * px + pz * pz < (s[4] + margin) ** 2) return true;
    }
    return false;
  }
  function blocked(x, z) {
    for (const s of ctx.colliders?.query?.(x, z, 0.6) || []) {
      if (s.kind === 'circle') { if (Math.hypot(x - s.x, z - s.z) < s.r + 0.5) return true; }
      else if (pointInRing(x, z, s.ring)) return true;
      else if (s.tag && !/barrier|fence|rail/i.test(String(s.tag))) {
        // close to a building wall
        const r = s.ring;
        for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
          const ax = r[j][0], az = r[j][1], ex = r[i][0] - ax, ez = r[i][1] - az;
          const l2 = ex * ex + ez * ez || 1e-9;
          const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
          if (Math.hypot(ax + ex * t - x, az + ez * t - z) < 0.6) return true;
        }
      }
    }
    return false;
  }

  // ------------------------------------------------------------ intersections → sign posts
  const CAMPUS = [-80, 0];
  const posts = [];
  const pairSeen = [];
  for (const n of model.nodes) {
    const list = n.roads.filter((r) => !r.bridge).sort((a, b) => b.road.pri - a.road.pri || b.width - a.width);
    if (list.length < 2) continue;
    const A = list[0];
    // the most important street that actually crosses A (not a straight name change)
    const B = list.slice(1).find((r) => Math.abs(A.dx * r.dz - A.dz * r.dx) > 0.35);
    if (!B) continue;
    const top = Math.max(A.road.pri, B.road.pri);
    if (low && top < 5) continue;
    if (top < 4 && Math.min(A.road.pri, B.road.pri) < 3) continue;
    const pair = [A.road.name, B.road.name].sort().join('|');
    if (pairSeen.some((p) => p.pair === pair && Math.hypot(p.x - n.x, p.z - n.z) < 45)) continue;   // divided roads
    pairSeen.push({ pair, x: n.x, z: n.z });
    const s = Math.max(0.5, Math.abs(A.dx * B.dz - A.dz * B.dx));
    let spot = null;
    for (const off of [1.7, 2.6]) {
      const al = (B.width / 2 + off) / s, be = (A.width / 2 + off) / s;
      const corners = [];
      for (const sa of [1, -1]) for (const sb of [1, -1]) {
        corners.push([n.x + sa * al * A.dx + sb * be * B.dx, n.z + sa * al * A.dz + sb * be * B.dz]);
      }
      corners.sort((p, q) => Math.hypot(p[0] - CAMPUS[0], p[1] - CAMPUS[1]) - Math.hypot(q[0] - CAMPUS[0], q[1] - CAMPUS[1]));
      spot = corners.find(([x, z]) => !onCarriageway(x, z, 0.5) && !blocked(x, z));
      if (spot) break;
    }
    if (!spot) continue;
    posts.push({ x: spot[0], z: spot[1], y: hAt(spot[0], spot[1]), A, B });
  }
  if (!posts.length) return;
  await ctx.yield?.();

  // ------------------------------------------------------------ atlas
  const names = new Map();       // road name → { u0, u1, v0, v1, len }
  for (const p of posts) for (const r of [p.A.road, p.B.road]) names.set(r.name, null);
  const measureC = document.createElement('canvas').getContext('2d');
  const big = `700 25px ${FONT}`, small = `700 18px ${FONT}`;
  function parts(name) {
    const words = abbrevRoad(name).split(' ');
    const pre = words.length > 1 && PREFIX.has(words[0]) ? words.shift() : '';
    const suf = words.length > 1 && SUFFIX.has(words[words.length - 1]) ? words.pop() : '';
    return { pre, main: words.join(' '), suf };
  }
  const SX = 0.9;                // horizontal condensing of the lettering (highway-gothic-ish proportions)
  function textWidth(p) {
    measureC.font = big;
    let w = measureC.measureText(p.main).width;
    measureC.font = small;
    if (p.pre) w += measureC.measureText(p.pre).width + 5;
    if (p.suf) w += measureC.measureText(p.suf).width + 5;
    return w * SX;
  }
  // shelf packing
  const layout = [];
  let x = 60, y = 0;             // row 0 starts after the solid swatches
  for (const name of names.keys()) {
    const p = parts(name);
    const w = Math.ceil(textWidth(p) + 26);
    if (x + w > ATLAS_W) { x = 0; y += ROW + GUTTER; }
    layout.push({ name, p, x, y, w });
    x += w + GUTTER;
  }
  const H = Math.ceil((y + ROW) / 8) * 8;      // WebGL2: mipmapped NPOT textures are fine
  const cv = document.createElement('canvas');
  cv.width = ATLAS_W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = BLUE; g.fillRect(0, 0, 18, ROW);
  g.fillStyle = POLE; g.fillRect(20, 0, 18, ROW);
  g.fillStyle = DARK; g.fillRect(40, 0, 18, ROW);
  const swatch = (i) => [(i * 20 + 9) / ATLAS_W, 1 - (ROW / 2) / H];
  const SW_BLUE = swatch(0), SW_POLE = swatch(1), SW_DARK = swatch(2);
  for (const L of layout) {
    const { p } = L;
    g.fillStyle = BLUE;
    g.fillRect(L.x, L.y, L.w, ROW);
    // white border, rounded
    g.strokeStyle = WHITE;
    g.lineWidth = 2;
    const r = 5, bx = L.x + 2.5, by = L.y + 2.5, bw = L.w - 5, bh = ROW - 5;
    g.beginPath();
    g.moveTo(bx + r, by); g.arcTo(bx + bw, by, bx + bw, by + bh, r); g.arcTo(bx + bw, by + bh, bx, by + bh, r);
    g.arcTo(bx, by + bh, bx, by, r); g.arcTo(bx, by, bx + bw, by, r); g.closePath();
    g.stroke();
    // lettering
    g.save();
    g.fillStyle = WHITE;
    g.textBaseline = 'alphabetic';
    const tw = textWidth(p);
    g.translate(L.x + (L.w - tw) / 2, L.y + ROW / 2 + 9);
    g.scale(SX, 1);
    let cx = 0;
    if (p.pre) { g.font = small; g.fillText(p.pre, cx, 0); cx += g.measureText(p.pre).width + 5; }
    g.font = big; g.fillText(p.main, cx, 0); cx += g.measureText(p.main).width + 5;
    if (p.suf) { g.font = small; g.fillText(p.suf, cx, 0); }
    g.restore();
    names.set(L.name, { u0: (L.x + 1) / ATLAS_W, u1: (L.x + L.w - 1) / ATLAS_W, v1: 1 - (L.y + 1) / H, v0: 1 - (L.y + ROW - 1) / H, len: L.w / PXM });
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  // the atlas is never repainted: drop the canvas backing store once uploaded (a lost context reloads the page)
  tex.onUpdate = () => { tex.onUpdate = null; cv.width = cv.height = 1; };
  // night glow map: the blades only (poles and brackets stay dark), at half resolution
  const ecv = document.createElement('canvas');
  ecv.width = ATLAS_W / 2; ecv.height = H / 2;
  const eg = ecv.getContext('2d');
  eg.drawImage(cv, 0, 0, ecv.width, ecv.height);
  eg.fillStyle = '#000'; eg.fillRect(19 / 2, 0, 41 / 2, ROW / 2);
  const etex = new THREE.CanvasTexture(ecv);
  etex.colorSpace = THREE.SRGBColorSpace;
  etex.onUpdate = () => { etex.onUpdate = null; ecv.width = ecv.height = 1; };
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, metalness: 0.05, emissive: 0xffffff, emissiveMap: etex, emissiveIntensity: 0 });
  mat.name = 'streetSigns';
  // retroreflective sheeting catches headlights and street lights: a faint glow at night
  ctx.materials?.registerNightMaterial?.(mat, 0.16);

  // ------------------------------------------------------------ geometry
  const setUV = (geo, fn) => {
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) { const [u, v] = fn(i, uv.getX(i), uv.getY(i)); uv.setXY(i, u, v); }
    return geo;
  };
  const solid = (geo, sw) => setUV(geo, () => sw);
  const seg = low ? 6 : 8;
  const bladeCache = new Map();
  function bladeGeo(name) {
    let g0 = bladeCache.get(name);
    if (g0) return g0;
    const a = names.get(name);
    const geo = new THREE.BoxGeometry(a.len, ROW / PXM, BLADE_T);
    // BoxGeometry faces: +x −x +y −y +z −z (4 vertices each); the two broad faces carry the lettering, each
    // mapped so it reads left → right from its own side
    setUV(geo, (i, u, v) => (i >= 16 ? [a.u0 + (a.u1 - a.u0) * u, a.v0 + (a.v1 - a.v0) * v] : SW_BLUE));
    bladeCache.set(name, geo);
    return geo;
  }
  const poleGeo = solid(new THREE.CylinderGeometry(0.038, 0.045, 1, seg, 1, true), SW_POLE);
  poleGeo.translate(0, 0.5, 0);
  // pole-top cross bracket: a short post between the blades and clips gripping each blade's top / bottom edge
  const BH = ROW / PXM;
  const bracketGeo = solid(new THREE.BoxGeometry(0.04, Y_HIGH - Y_LOW - BH + 0.04, 0.04), SW_DARK);
  const clipGeo = solid(new THREE.BoxGeometry(0.06, 0.035, 0.05), SW_DARK);
  const capGeo = solid(new THREE.CylinderGeometry(0.03, 0.05, 0.07, seg), SW_DARK);
  const baseGeo = low ? null : solid(new THREE.CylinderGeometry(0.075, 0.09, 0.12, seg), SW_POLE);

  const chunks = new Map();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  const pos = new THREE.Vector3();
  for (const p of posts) {
    const k = `${Math.floor(p.x / CHUNK)},${Math.floor(p.z / CHUNK)}`;
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = { geos: [], x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }));
    c.x0 = Math.min(c.x0, p.x); c.x1 = Math.max(c.x1, p.x); c.z0 = Math.min(c.z0, p.z); c.z1 = Math.max(c.z1, p.z);
    const y = p.y;
    const topPole = Y_LOW - ROW / PXM / 2 + 0.02;
    // pole (reaching a little below the sidewalk on slopes), base collar, bracket, cap
    const pole = poleGeo.clone();
    pole.applyMatrix4(m4.compose(pos.set(p.x, y - 0.3, p.z), q.identity(), new THREE.Vector3(1, topPole + 0.3, 1)));
    c.geos.push(pole);
    if (baseGeo) c.geos.push(baseGeo.clone().translate(p.x, y + 0.04, p.z));
    c.geos.push(bracketGeo.clone().translate(p.x, y + (Y_LOW + Y_HIGH) / 2, p.z));
    if (!low) for (const yy of [Y_LOW - BH / 2, Y_LOW + BH / 2, Y_HIGH - BH / 2, Y_HIGH + BH / 2]) c.geos.push(clipGeo.clone().translate(p.x, y + yy, p.z));
    c.geos.push(capGeo.clone().translate(p.x, y + Y_HIGH + BH / 2 + 0.05, p.z));
    // blades: the more important street on top; each parallel to its street
    const [upper, lower] = [p.A, p.B];
    for (const [r, yy] of [[lower, Y_LOW], [upper, Y_HIGH]]) {
      const geo = bladeGeo(r.road.name).clone();
      // local +x along the street, pointing roughly east/south so both faces read naturally
      let dx = r.dx, dz = r.dz;
      if (dx < -0.2 || (Math.abs(dx) <= 0.2 && dz < 0)) { dx = -dx; dz = -dz; }
      q.setFromAxisAngle(yAxis, Math.atan2(-dz, dx));
      m4.compose(pos.set(p.x, y + yy, p.z), q, one);
      geo.applyMatrix4(m4);
      c.geos.push(geo);
    }
    ctx.colliders?.addCircle?.(p.x, p.z, 0.1, y - 0.5, y + Y_HIGH + 0.3, 'streetsign');
  }
  await ctx.yield?.();

  const group = new THREE.Group();
  group.name = 'streetSigns';
  const list = [];
  for (const c of chunks.values()) {
    const geo = mergeGeometries(c.geos, false);
    for (const g1 of c.geos) g1.dispose();
    if (!geo) continue;
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'streetSigns:chunk';
    mesh.castShadow = !low && !!ctx.quality?.shadows;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.visible = false;
    group.add(mesh);
    list.push({ mesh, x0: c.x0 - 1, x1: c.x1 + 1, z0: c.z0 - 1, z1: c.z1 + 1 });
  }
  for (const g1 of bladeCache.values()) g1.dispose();
  poleGeo.dispose(); bracketGeo.dispose(); clipGeo.dispose(); capGeo.dispose(); baseGeo?.dispose();
  ctx.scene.add(group);

  // chunks near the camera only (signs are unreadable and sub-pixel further away)
  const show2 = SHOW_DIST * SHOW_DIST;
  let lx = Infinity, ly = Infinity, lz = Infinity;
  ctx.onUpdate?.(() => {
    const cam = ctx.camera;
    if (!cam) return;
    const { x: cx, y: cy, z: cz } = cam.position;
    if (Math.abs(cx - lx) + Math.abs(cy - ly) + Math.abs(cz - lz) < 2) return; // (only when the camera moved)
    lx = cx; ly = cy; lz = cz;
    for (const c of list) {
      const dx = cx < c.x0 ? c.x0 - cx : cx > c.x1 ? cx - c.x1 : 0;
      const dz = cz < c.z0 ? c.z0 - cz : cz > c.z1 ? cz - c.z1 : 0;
      const dy = Math.max(0, cy - (ctx.heightAt?.(cx, cz) ?? 0) - 60);
      const vis = dx * dx + dz * dz + dy * dy < show2;
      if (c.mesh.visible !== vis) c.mesh.visible = vis;
    }
  }, 10);

  ctx.streetSigns = { group, count: posts.length, chunks: list.length, posts: posts.map((p) => ({ x: Math.round(p.x * 10) / 10, z: Math.round(p.z * 10) / 10, a: p.A.road.name, b: p.B.road.name })) };
}
