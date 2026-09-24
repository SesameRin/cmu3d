// Kraus Campo (2005) — sculpture garden by artist Mel Bochner (CMU alumnus) and landscape architect
// Michael Van Valkenburgh on the roof of the Posner Center, between the College of Fine Arts and Posner Hall.
// A 25 x 60 x 3 ft platform shaped like a draftsman's French curve, clad in white tiles with black numerals,
// sits at its heart; bright orange paths wander between drifting mounds of boxwood, azalea and red barberry;
// and an exposed wall of the old GSIA building is painted blue with a scrambled passage about time's arrow
// and entropy in black-and-white tiles. (The lettering here is an evocation, not the actual text.)
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { pointInRing } from '../../core/heightfield.js';
import { PartBucket, registerLandmark, makeCanvas, canvasTexture, rng, FONT_SANS } from './icons-common.js';

const GARDEN_NAME = 'Kraus Campo';
const PATH_IDS = ['w1192182968', 'w1192182969', 'w1192182970', 'w1192182971', 'w1192182972', 'w1192182973', 'w1192182974', 'w1192182975', 'w1192182976'];
const POSNER_ID = 'w27591241';
const SHRUB_LOD_FAR = 140;    // metres from the garden centre

function numberTileTexture(renderer) {
  const S = 1024, tiles = 30;                 // one texture = 6 m x 6 m of 0.2 m tiles
  const c = makeCanvas(S, S), g = c.getContext('2d');
  const r = rng(1938);
  const t = S / tiles;
  g.fillStyle = '#b9b6ae'; g.fillRect(0, 0, S, S);   // grout
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${Math.round(t * 0.7)}px ${FONT_SANS}`;
  for (let i = 0; i < tiles; i++) for (let j = 0; j < tiles; j++) {
    const v = 238 + ((r() * 14) | 0);
    g.fillStyle = `rgb(${v},${v},${v - 4})`;
    g.fillRect(i * t + 1.5, j * t + 1.5, t - 3, t - 3);
    if (r() < 0.42) { g.fillStyle = '#141414'; g.fillText(String((r() * 10) | 0), i * t + t / 2, j * t + t / 2 + 1); }
  }
  const tex = canvasTexture(c, { renderer });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1 / 6, 1 / 6);
  return tex;
}

function blueWallTexture(renderer) {
  const c = makeCanvas(2048, 512), g = c.getContext('2d');
  g.fillStyle = '#2b5fb4'; g.fillRect(0, 0, 2048, 512);
  // tile grid
  g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1;
  for (let x = 0; x < 2048; x += 24) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, 512); g.stroke(); }
  for (let y = 0; y < 512; y += 24) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(2048, y + 0.5); g.stroke(); }
  // scrambled, backwards-reading words on time and entropy (an evocation of Bochner's piece)
  const lines = ['EMIT  FO  WORRA  EHT  SI  YPORTNE', 'REDRO  OT  MODNAR  MORF  SEOG  TI', 'DRAWKCAB  NUR  REVEN  SKCOLC'];
  g.textAlign = 'center'; g.textBaseline = 'middle';
  lines.forEach((ln, i) => {
    const y = 120 + i * 140;
    g.font = `900 92px ${FONT_SANS}`;
    g.fillStyle = '#f4f4f0'; g.fillRect(90, y - 62, 1868, 124);
    g.fillStyle = '#111111'; g.fillText(ln, 1024, y + 4);
  });
  return canvasTexture(c, { renderer });
}

// Distance from (x, z) to a set of 2D segments [[ax,az],[bx,bz]], exact up to `cap` (returns cap beyond it).
// Segments are bucketed in a 2 m grid so a query only visits the cells within `cap`.
function segmentDistance(segs) {
  const CELL = 2;
  const cells = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const s of segs) {
    const [[ax, az], [bx, bz]] = s;
    const i0 = Math.floor(Math.min(ax, bx) / CELL), i1 = Math.floor(Math.max(ax, bx) / CELL);
    const j0 = Math.floor(Math.min(az, bz) / CELL), j1 = Math.floor(Math.max(az, bz) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      if (!cells.has(k)) cells.set(k, []);
      cells.get(k).push(s);
    }
  }
  return (x, z, cap) => {
    let best = cap;
    const i0 = Math.floor((x - cap) / CELL), i1 = Math.floor((x + cap) / CELL);
    const j0 = Math.floor((z - cap) / CELL), j1 = Math.floor((z + cap) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const list = cells.get(key(i, j));
      if (!list) continue;
      for (const [[ax, az], [bx, bz]] of list) {
        const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
        let t = ((x - ax) * ex + (z - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const dx = x - ax - ex * t, dz = z - az - ez * t;
        const d2 = dx * dx + dz * dz;
        if (d2 < best * best) best = Math.sqrt(d2);
      }
    }
    return best;
  };
}

// Outline of a draftsman's French curve (local metres, long axis = x), as a smooth closed spline.
function frenchCurveShape() {
  const pts = [
    [-9.1, 0.6], [-8.2, 2.6], [-5.8, 3.7], [-2.6, 3.3], [0.2, 1.9], [2.6, 2.5], [5.4, 3.8], [8.0, 3.2], [9.2, 1.2],
    [8.6, -1.4], [6.4, -2.4], [3.8, -1.6], [1.4, -2.9], [-1.8, -3.8], [-5.2, -3.3], [-7.9, -2.0],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const curve = new THREE.SplineCurve([...pts, pts[0]]);
  const shape = new THREE.Shape(curve.getPoints(96));
  // a teardrop-shaped cut-out, like the holes in real French curves
  const hole = new THREE.Path();
  hole.absellipse(-4.6, -0.2, 1.3, 0.8, 0, Math.PI * 2, false, 0.25);
  shape.holes.push(hole);
  return { shape, outline: curve.getPoints(48).map((p) => [p.x, p.y]) };
}

export async function buildKrausCampo(ctx, def) {
  const data = ctx.data;
  const area = data.areas.find((a) => a.name === GARDEN_NAME);
  const ring = area ? area.polygon : [[53, 206], [18, 197], [33, 143], [68, 153]];
  let gx = 0, gz = 0;
  for (const [x, z] of ring) { gx += x; gz += z; }
  gx /= ring.length; gz /= ring.length;
  // garden long axis (from the north edge midpoint to the south edge midpoint)
  const nMid = [(ring[2][0] + ring[3][0]) / 2, (ring[2][1] + ring[3][1]) / 2];
  const sMid = [(ring[0][0] + ring[1][0]) / 2, (ring[0][1] + ring[1][1]) / 2];
  const axis = Math.atan2(sMid[1] - nMid[1], sMid[0] - nMid[0]);

  const root = new THREE.Group();
  root.name = 'landmark:krausCampo';
  const bucket = new PartBucket();
  const r = rng(2005);

  // ---- orange paths (draped ribbons over the footways)
  const pathMat = new THREE.MeshStandardMaterial({ color: '#dc5a25', roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  pathMat.name = 'kraus-paths';
  const paths = data.paths.filter((p) => PATH_IDS.includes(p.id));
  const pos = [], idx = [];
  for (const p of paths) {
    // resample every ~0.8 m so the ribbon follows the ground
    const pts = [];
    for (let i = 0; i < p.points.length - 1; i++) {
      const [x0, z0] = p.points[i], [x1, z1] = p.points[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.8));
      for (let k = 0; k < n; k++) pts.push([x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n]);
    }
    pts.push(p.points[p.points.length - 1]);
    const hw = 0.75;
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      const [x, z] = pts[i];
      for (const s of [-1, 1]) {
        const px = x - tz * hw * s, pz = z + tx * hw * s;
        pos.push(px, ctx.heightAt(px, pz) + 0.05, pz);
      }
      if (i > 0) { const k = base + (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    }
  }
  if (pos.length) {
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    pg.setIndex(idx);
    pg.computeVertexNormals();
    // make sure every ribbon faces up regardless of the polyline direction
    const nrm = pg.attributes.normal;
    for (let i = 0; i < nrm.count; i++) if (nrm.getY(i) < 0) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    const pm = new THREE.Mesh(pg, pathMat);
    pm.material.side = THREE.DoubleSide;
    pm.receiveShadow = true;
    pm.name = 'kraus-paths';
    root.add(pm);
  }

  const pathPts = [];
  for (const p of paths) for (let i = 0; i < p.points.length - 1; i++) pathPts.push([p.points[i], p.points[i + 1]]);
  const distToPaths = segmentDistance(pathPts);
  // ---- French-curve platform clad in numbered tiles, placed where it clears the winding paths best
  const { shape, outline } = frenchCurveShape();
  let bestFit = { score: Infinity, x: gx, z: gz, a: axis };
  const starts = Float64Array.from(pathPts.flatMap(([p]) => p));           // flat copies for the 675-candidate search
  const probe = Float64Array.from(outline.filter((_, i) => i % 2 === 0).flat());
  for (let dx = -7; dx <= 7; dx += 1) for (let dz = -7; dz <= 7; dz += 1) for (let da = -0.4; da <= 0.41; da += 0.4) {
    const x = gx + dx, z = gz + dz, a = axis + da, c = Math.cos(a), sa = Math.sin(a);
    let score = Math.hypot(dx, dz) * 0.05;
    for (let i = 0; i < probe.length; i += 2) {
      const lx = probe[i], lz = probe[i + 1];
      const wx = x + lx * c - lz * sa, wz = z + lx * sa + lz * c;
      if (!pointInRing(wx, wz, ring)) score += 3;
      score += Math.max(0, 1.3 - distToPaths(wx, wz, 1.3)) * 2;
    }
    for (let i = 0; i < starts.length; i += 2) {
      const ax = starts[i] - x, az = starts[i + 1] - z;
      const lx = ax * c + az * sa, lz = -ax * sa + az * c;
      if (Math.abs(lx) < 9 && Math.abs(lz) < 3.5) score += 2;
    }
    if (score < bestFit.score) bestFit = { score, x, z, a };
  }
  const pcx = bestFit.x, pcz = bestFit.z, pAxis = bestFit.a;
  let py = -Infinity;
  const cs = Math.cos(pAxis), sn = Math.sin(pAxis);
  const toWorld = (lx, lz) => [pcx + lx * cs - lz * sn, pcz + lx * sn + lz * cs];
  const worldOutline = outline.map(([lx, lz]) => toWorld(lx, lz));
  let pyMin = Infinity;
  for (const [x, z] of worldOutline) { const h = ctx.heightAt(x, z); py = Math.max(py, h); pyMin = Math.min(pyMin, h); }
  const platH = 0.9;
  const platGeo = new THREE.ExtrudeGeometry(shape, { depth: platH + (py - pyMin) + 0.3, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 48 });
  platGeo.rotateX(Math.PI / 2);                 // extrude downwards (shape y -> +z)
  const platM = new THREE.Matrix4().compose(
    new THREE.Vector3(pcx, pyMin + platH + (py - pyMin) * 0.5, pcz),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -pAxis),
    new THREE.Vector3(1, 1, 1));
  const tileMat = new THREE.MeshStandardMaterial({ map: numberTileTexture(ctx.renderer), roughness: 0.32, metalness: 0.02 });
  tileMat.name = 'kraus-tiles';
  const platUV = ctx.materials?.applyWorldUV ? ctx.materials.applyWorldUV(platGeo, platM) : platGeo;
  bucket.add(tileMat, platUV, platM);
  ctx.colliders?.addPolygon(worldOutline, pyMin - 1, pyMin + platH + (py - pyMin) * 0.5, 'krausCampo');

  // ---- planting mounds (instanced blobs: boxwood, azalea, barberry)
  // smooth-shaded lumpy mound (indexed so normals are averaged); a 20-triangle version for distant views
  const makeBlob = (detail) => {
    const blob = mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute('normal').deleteAttribute('uv'));
    const bp = blob.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      const x = bp.getX(i), y = bp.getY(i), z = bp.getZ(i);
      const k = 1 + 0.12 * Math.sin(x * 5.1 + z * 3.7) + 0.08 * Math.cos(y * 6.3 + x * 2.1);
      bp.setXYZ(i, x * k, Math.max(-0.2, y) * k * 0.62, z * k);
    }
    blob.computeVertexNormals();
    return blob;
  };
  const blob = makeBlob(1);
  const shrubMat = new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: false });
  shrubMat.name = 'kraus-shrubs';
  const spots = [];
  const outlineXZ = Float64Array.from(worldOutline.flat());
  for (let x = gx - 30; x <= gx + 30; x += 1.3) {
    for (let z = gz - 32; z <= gz + 32; z += 1.3) {
      const jx = x + (r() - 0.5) * 0.8, jz = z + (r() - 0.5) * 0.8;
      if (!pointInRing(jx, jz, ring)) continue;
      if (pointInRing(jx, jz, worldOutline)) continue;
      // keep clear of paths and the platform edge; inset from the garden border
      // (the shrub size only depends on path distances up to 1.45 + 0.3 / 0.08 m)
      const dp = distToPaths(jx, jz, 5.3);
      if (dp < 1.45) continue;
      let dEdge = Infinity;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [ax, az] = ring[j], [bx, bz] = ring[i];
        const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
        let t = ((jx - ax) * ex + (jz - az) * ez) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
        dEdge = Math.min(dEdge, Math.hypot(jx - ax - ex * t, jz - az - ez * t));
      }
      if (dEdge < 0.9) continue;
      let dPlat2 = Infinity;
      for (let i = 0; i < outlineXZ.length; i += 2) { const ex = jx - outlineXZ[i], ez = jz - outlineXZ[i + 1]; const d2 = ex * ex + ez * ez; if (d2 < dPlat2) dPlat2 = d2; }
      if (dPlat2 < 1.2 * 1.2) continue;
      spots.push([jx, jz, dp]);
    }
  }
  const inst = new THREE.InstancedMesh(blob, shrubMat, spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  const colors = { box: new THREE.Color('#2d4a26'), box2: new THREE.Color('#38592c'), azalea: new THREE.Color('#4f6b34'), bloom: new THREE.Color('#b8465f'), barberry: new THREE.Color('#7b2331') };
  const col = new THREE.Color();
  spots.forEach(([x, z, dp], i) => {
    // species drift in bands (sin fields) like the designed planting
    const f = Math.sin(x * 0.21 + z * 0.13) + Math.sin(z * 0.27 - x * 0.07) * 0.6;
    const kind = f > 0.75 ? 'barberry' : f < -0.6 ? 'azalea' : 'box';
    const s = (kind === 'box' ? 0.74 : 0.64) + r() * 0.32 + Math.min(0.3, (dp - 1.45) * 0.08);
    q.setFromAxisAngle(pv.set(0, 1, 0), r() * Math.PI * 2);
    pv.set(x, ctx.heightAt(x, z) - 0.05, z);
    sc.set(s * (0.9 + r() * 0.3), s * (0.8 + r() * 0.35), s * (0.9 + r() * 0.3));
    m4.compose(pv, q, sc);
    inst.setMatrixAt(i, m4);
    if (kind === 'box') col.copy(r() < 0.5 ? colors.box : colors.box2);
    else if (kind === 'barberry') col.copy(colors.barberry);
    else col.copy(colors.azalea).lerp(colors.bloom, 0.1 + r() * 0.15);
    col.offsetHSL(0, 0, (r() - 0.5) * 0.04);
    inst.setColorAt(i, col);
  });
  inst.instanceMatrix.needsUpdate = true;
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  // distance LOD sharing the instance buffers: 80-triangle mounds near, 20-triangle ones beyond SHRUB_LOD_FAR
  const instLo = new THREE.InstancedMesh(makeBlob(0), shrubMat, spots.length);
  instLo.instanceMatrix = inst.instanceMatrix;
  instLo.instanceColor = inst.instanceColor;
  const shrubLod = new THREE.LOD();
  shrubLod.name = 'kraus-shrubs';
  shrubLod.position.set(gx, ctx.heightAt(gx, gz), gz);
  for (const [m, name] of [[inst, 'kraus-shrubs'], [instLo, 'kraus-shrubs-far']]) {
    m.castShadow = true; m.receiveShadow = true;
    m.name = name;
    m.position.copy(shrubLod.position).negate();    // instance matrices are in world space
    m.computeBoundingSphere?.();
  }
  shrubLod.addLevel(inst, 0);
  shrubLod.addLevel(instLo, SHRUB_LOD_FAR, 0.1);
  root.add(shrubLod);

  // ---- the blue wall (on the exposed west wall of Posner Hall, facing the garden)
  const posner = data.buildings.find((b) => b.id === POSNER_ID || b.osmId === POSNER_ID);
  if (posner) {
    // wall edge nearest the garden's east side
    let best = null;
    const fp = posner.footprint;
    for (let i = 0; i < fp.length; i++) {
      const a = fp[i], b = fp[(i + 1) % fp.length];
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const d = Math.hypot(mx - gx, mz - gz);
      if (len > 20 && (!best || d < best.d)) best = { a, b, d, len };
    }
    if (best) {
      const { a, b, len } = best;
      const t0 = 0.55, t1 = 0.93;
      const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      const wlen = len * (t1 - t0);
      const mx = (p0[0] + p1[0]) / 2, mz = (p0[1] + p1[1]) / 2;
      // outward normal towards the garden centre
      let nx = -(p1[1] - p0[1]), nz = p1[0] - p0[0];
      const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
      if ((gx - mx) * nx + (gz - mz) * nz < 0) { nx = -nx; nz = -nz; }
      const gy = Math.min(ctx.heightAt(p0[0], p0[1]), ctx.heightAt(p1[0], p1[1]), ctx.heightAt(mx, mz));
      const wallH = 5.2;
      const wallMat = new THREE.MeshStandardMaterial({ map: blueWallTexture(ctx.renderer), roughness: 0.55 });
      wallMat.name = 'kraus-bluewall';
      const wg = new THREE.PlaneGeometry(wlen, wallH);
      const yaw = Math.atan2(nx, nz);
      const wm = new THREE.Matrix4().compose(new THREE.Vector3(mx + nx * 0.07, gy + wallH / 2 - 0.2, mz + nz * 0.07), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
      bucket.add(wallMat, wg, wm);
    }
  }

  root.add(bucket.build({ name: 'krausCampo' }));
  const gy = ctx.heightAt(gx, gz);
  registerLandmark(ctx, def, root, { position: [gx, gy + 1, gz], radius: 30, labelY: 3, priority: 7 });
  return root;
}
