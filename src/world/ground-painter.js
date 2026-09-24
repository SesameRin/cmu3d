// Ground painter: paints the terrain's colour texture + a detail-type mask on <canvas>, straight from CAMPUS_DATA.
//
// Every level is painted with exactly the same drawing code (the canvas transform maps world metres → pixels):
//   far  — the whole data bounds (≈3.3 × 3.1 km), painted once at start-up in 'far' mode: only what reads at
//          ~0.8 m per pixel, with the ways batched per 200 m tile (see below)
//   near — a 450 m window around the camera at ~0.22 m per pixel, repainted strip by strip as the camera moves
//          (terrain.js keeps it in a wrap-around canvas; paintRegion() paints one rectangle of it)
// Canvas work is executed asynchronously by the GPU process, and there its cost is mostly per drawing call, so
// the drawing is shaped for Skia: ways are stroked as short pieces (small paths go through its GPU atlas; big
// ones become software coverage masks) — in far mode those pieces are gathered into one path per style and tile
// —, overlay layers are pre-composited tiles, and repetitive shapes (mowing stripes, oil stains) are pattern
// fills instead of clip + rectangle loops.
// Mask channels (read by the terrain shader to pick the close-up detail):
//   R = vegetation (grass / lawn / forest floor)   G = asphalt   B = concrete / pavers / brick   black = soil, tartan, water …
//
// Also exports small polyline helpers shared by roads.js / bridges.js / rail.js.
import { footprintFrame } from '../core/placement.js';
import { pointInRing } from '../core/heightfield.js';

// ---------------------------------------------------------------------------------------------------------------
// polyline helpers (world x/z pairs)
export function polyLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

// Parallel curve at signed distance d (positive = right-hand side when travelling along the line, with z = south).
export function offsetPolyline(pts, d) {
  const n = pts.length, out = new Array(n);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let nx = 0, nz = 0;
    if (i > 0) { const dx = p[0] - a[0], dz = p[1] - a[1], l = Math.hypot(dx, dz) || 1; nx += -dz / l; nz += dx / l; }
    if (i < n - 1) { const dx = b[0] - p[0], dz = b[1] - p[1], l = Math.hypot(dx, dz) || 1; nx += -dz / l; nz += dx / l; }
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    // miter scale: 1/cos(half angle), clamped
    let k = 1;
    if (i > 0 && i < n - 1) {
      const dx = b[0] - p[0], dz = b[1] - p[1], ll = Math.hypot(dx, dz) || 1;
      const c = (-dz / ll) * nx + (dx / ll) * nz;
      k = 1 / Math.max(0.5, c);
    }
    out[i] = [p[0] + nx * d * k, p[1] + nz * d * k];
  }
  return out;
}

// Sub-polyline between arc lengths s0 and s1.
export function slicePolyline(pts, s0, s1) {
  const out = [];
  let s = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L <= 0) continue;
    const e = s + L;
    if (e >= s0 && s <= s1) {
      const t0 = Math.max(0, (s0 - s) / L), t1 = Math.min(1, (s1 - s) / L);
      const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
      if (!out.length) out.push(p0);
      out.push([a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1]);
    }
    s = e;
    if (s > s1) break;
  }
  return out;
}

// Evenly resampled points with tangents: [{ x, z, s, tx, tz }]
export function resamplePolyline(pts, step) {
  const out = [];
  const L = polyLength(pts);
  const n = Math.max(1, Math.ceil(L / step));
  let seg = 1, segStart = 0;
  for (let k = 0; k <= n; k++) {
    const s = (L * k) / n;
    while (seg < pts.length - 1) {
      const segL = Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1]);
      if (segStart + segL >= s) break;
      segStart += segL; seg++;
    }
    const a = pts[seg - 1], b = pts[seg];
    const segL = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6;
    const t = Math.min(1, Math.max(0, (s - segStart) / segL));
    out.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, s, tx: (b[0] - a[0]) / segL, tz: (b[1] - a[1]) / segL });
  }
  // smooth tangents at interior samples that sit on a vertex
  return out;
}

export function ringArea(ring) {
  let A = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) A += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(A / 2);
}

// ---------------------------------------------------------------------------------------------------------------
// tiny deterministic RNG + tileable value noise
export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Periodic fBm value noise on a size×size tile. periods = lattice cells across the tile per octave.
export function tileNoise(size, periods, seed = 1, gains = null) {
  const out = new Float32Array(size * size);
  const rnd = mulberry(seed);
  let total = 0;
  periods.forEach((p, o) => {
    const amp = gains ? gains[o] : 1 / (o + 1);
    total += amp;
    const lat = new Float32Array(p * p);
    for (let i = 0; i < lat.length; i++) lat[i] = rnd();
    const cell = size / p;
    // the x-dependent lattice columns and weights, once per octave (the same for every row)
    const cx0 = new Int32Array(size), cx1 = new Int32Array(size), csx = new Float64Array(size);
    for (let x = 0; x < size; x++) {
      const fx = x / cell, i0 = Math.floor(fx), tx = fx - i0;
      cx0[x] = i0 % p; cx1[x] = (i0 + 1) % p; csx[x] = tx * tx * (3 - 2 * tx);
    }
    // the two lattice rows around y, interpolated along x once per lattice row (not per pixel)
    const rowA = new Float32Array(size), rowB = new Float32Array(size);
    let jCur = -1;
    for (let y = 0; y < size; y++) {
      const fy = y / cell, j0 = Math.floor(fy), ty = fy - j0, sy = ty * ty * (3 - 2 * ty);
      if (j0 !== jCur) {
        jCur = j0;
        const r0 = (j0 % p) * p, r1 = ((j0 + 1) % p) * p;
        for (let x = 0; x < size; x++) {
          const ii = cx0[x], i1 = cx1[x], sx = csx[x];
          const a = lat[r0 + ii], c = lat[r1 + ii];
          rowA[x] = a + (lat[r0 + i1] - a) * sx;
          rowB[x] = c + (lat[r1 + i1] - c) * sx;
        }
      }
      const row = y * size, ka = amp * (1 - sy), kb = amp * sy;
      for (let x = 0; x < size; x++) out[row + x] += rowA[x] * ka + rowB[x] * kb;
    }
  });
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// palette (sRGB)
const COL = {
  grass: '#59733a',
  lawn: '#557538',
  park: '#5d733b',
  dry: '#86835a',
  lush: '#46642e',
  wood: '#3e4428',
  woodLitter: '#6a5433',
  scrub: '#636a3b',
  golf: '#5a7e3c',
  garden: '#51603a',
  mulch: '#4a3527',
  pitchGrass: '#527b38',
  turf: '#3c7a35',
  track: '#a54a3c',
  water: '#39402f',
  parking: '#4a4c4f',
  asphalt: '#434548',
  asphaltOld: '#56585a',
  curb: '#a19d95',
  concrete: '#aea99e',
  sidewalk: '#a9a499',
  plaza: '#b1a592',
  paver: '#a57f66',
  brick: '#8e5b47',
  dirt: '#8b7659',
  gravel: '#9d9483',
  line: '#ebe9e1',
  yellow: '#d8a526',
  building: '#5d5a54',
  ballast: '#6f6a62',
  playground: '#8f6f4d',
  construction: '#8a7457',
  tennisOut: '#4d7a5c',
  tennisIn: '#3e5f8e',
};
const MASK = { veg: '#ff0000', wood: '#b00000', asph: '#00ff00', hard: '#0000ff', soil: '#000000', grassHalf: '#800000' };

const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'primary_link', 'secondary_link', 'tertiary_link', 'trunk_link']);
const ROAD_RANK = { service: 0, unclassified: 1, residential: 1, construction: 1, tertiary: 2, tertiary_link: 2, secondary: 3, secondary_link: 3, primary: 4, primary_link: 4, trunk: 5, trunk_link: 5 };
const NAMED_LAWNS = new Set(['The Cut', 'The Mall', 'CFA Lawn', 'Tepper Quad', 'Cathedral Lawn', 'Mudge Courtyard']);
const MOWN_LAWNS = new Set(['The Cut', 'The Mall']); // lawns that get (faint) mowing stripes
export const RAIL_GONE = new Set(['abandoned', 'razed', 'dismantled']); // OSM railway types whose track was removed

// ---------------------------------------------------------------------------------------------------------------
// canvas helpers
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
// low-resolution layers: small ones (the near level's tiles, painted over and over at the same few sizes) reuse a
// canvas per size (drawImage() snapshots it, so reusing it is safe); big ones (one-off far level) get their own
const scratchCache = new Map();
function scratchCanvas(w, h) {
  if (w * h > 256 * 256) return makeCanvas(w, h);
  const k = w * 4096 + h;
  let c = scratchCache.get(k);
  if (!c) { c = makeCanvas(w, h); scratchCache.set(k, c); }
  return c;
}

// (no closePath(): fills close their subpaths anyway, and Chrome's Path2D.closePath() is O(subpaths) — a 10k-ring
// building path took ~0.8 s to build with it; a line back to the start keeps it linear)
function ringPath(path, ring) {
  path.moveTo(ring[0][0], ring[0][1]);
  for (let i = 1; i < ring.length; i++) path.lineTo(ring[i][0], ring[i][1]);
  path.lineTo(ring[0][0], ring[0][1]);
}
function linePath(path, pts) {
  path.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
}
function polyPath(poly, holes) {
  const p = new Path2D();
  ringPath(p, poly);
  if (holes) for (const h of holes) if (h.length > 2) ringPath(p, h);
  return p;
}
// A way as short pieces for the painter: Skia rasterises a stroke whose device bounds exceed its GPU path atlas
// (~256 px) into a software coverage mask and uploads it — hundreds of those per canvas were the bulk of the
// ground painting time. Pieces are cut in the middle of a (straight) segment, so butt-capped translucent strokes
// of neighbouring pieces abut exactly (see stroke()); ends = the way's true ends [x, z, outward dx, dz].
const PIECE_M = 30;
function piecePaths(pts, maxE = PIECE_M) {
  const pieces = [], at = [];
  const flush = (run) => {
    if (run.length < 2) return;
    const p = new Path2D(); linePath(p, run); pieces.push(p);
    at.push((run[0][0] + run[run.length - 1][0]) / 2, (run[0][1] + run[run.length - 1][1]) / 2); // (batching tile)
  };
  // densify so no segment is longer than maxE
  const P = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / maxE));
    for (let k = 1; k <= n; k++) P.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  let run = [P[0]], x0 = P[0][0], x1 = x0, z0 = P[0][1], z1 = z0;
  for (let i = 1; i < P.length; i++) {
    const q = P[i];
    if (Math.max(Math.max(x1, q[0]) - Math.min(x0, q[0]), Math.max(z1, q[1]) - Math.min(z0, q[1])) > maxE && run.length > 1) {
      const l = run[run.length - 1], m = [(l[0] + q[0]) / 2, (l[1] + q[1]) / 2];
      run.push(m); flush(run);
      run = [m]; x0 = Math.min(m[0], q[0]); x1 = Math.max(m[0], q[0]); z0 = Math.min(m[1], q[1]); z1 = Math.max(m[1], q[1]);
    } else { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    run.push(q);
  }
  flush(run);
  const end = (p, q) => { const dx = p[0] - q[0], dz = p[1] - q[1], l = Math.hypot(dx, dz) || 1; return [p[0], p[1], dx / l, dz / l]; };
  const n = pts.length;
  return { pieces, at, ends: n > 1 ? [end(pts[0], pts[1]), end(pts[n - 1], pts[n - 2])] : [] };
}
// Far-mode batching: the pieces of many ways drawn with the same style go into one Path2D per BATCH_M tile
// (≈ 250 px at the far level's scale — small enough for Skia's GPU path atlas), stroked / filled together when the
// painter's section ends. Tens of thousands of tiny drawing calls become a few hundred.
const BATCH_M = 200;
function makeBatcher(strokeNow, fillNow) {
  const batches = new Map();
  const ids = new Map();
  const idOf = (style) => { if (typeof style === 'string') return style; let i = ids.get(style); if (i === undefined) ids.set(style, (i = `#p${ids.size}`)); return i; };
  const tileOf = (x, z) => Math.floor(x / BATCH_M) * 100003 + Math.floor(z / BATCH_M);
  const get = (key, make) => { let b = batches.get(key); if (!b) batches.set(key, (b = make())); return b; };
  const tilePath = (b, x, z) => { const k = tileOf(x, z); let p = b.tiles.get(k); if (!p) b.tiles.set(k, (p = new Path2D())); return p; };
  return {
    stroke(path, style, width, opts) {
      const key = `s|${idOf(style)}|${width.toFixed(2)}|${opts.alpha ?? 1}|${opts.dash || ''}|${opts.cap || 'round'}`;
      const b = get(key, () => ({ stroke: true, style, width, opts, tiles: new Map() }));
      for (let i = 0; i < path.pieces.length; i++) tilePath(b, path.at[i * 2], path.at[i * 2 + 1]).addPath(path.pieces[i]);
    },
    // rings (world coordinates) filled with one style
    fillRing(ring, style, x, z) {
      const b = get(`f|${idOf(style)}`, () => ({ stroke: false, style, tiles: new Map() }));
      ringPath(tilePath(b, x, z), ring);
    },
    // a closed Path2D filled with one style (tile by its anchor point)
    fill(path, style, x, z) {
      const b = get(`f|${idOf(style)}`, () => ({ stroke: false, style, tiles: new Map() }));
      tilePath(b, x, z).addPath(path);
    },
    flush() {
      for (const b of batches.values()) for (const p of b.tiles.values()) { if (b.stroke) strokeNow(p, b.style, b.width, b.opts); else fillNow(p, b.style); }
      batches.clear();
    },
  };
}
// [minX, minZ, maxX, maxZ] of a point list, grown by `pad` metres
function bbox(pts, pad) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}
// Tileable colour-with-alpha blotch canvas from a noise field.
function blotchCanvas(size, noise, rgb, lo, hi, maxA) {
  const c = makeCanvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  for (let i = 0; i < size * size; i++) {
    let t = (noise[i] - lo) / (hi - lo);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    t = t * t * (3 - 2 * t);
    d[i * 4] = rgb[0]; d[i * 4 + 1] = rgb[1]; d[i * 4 + 2] = rgb[2]; d[i * 4 + 3] = t * maxA * 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
// Brightness-modulation pair from a noise field: { light: white with alpha where the noise is above 0.5,
// dark: black with alpha where it is below }. Drawn source-over they brighten / darken like a soft-light overlay,
// but with plain alpha blending (soft-light needs destination reads, which is slow on the GPU canvas).
// Both halves live in ONE tile (a pixel is either brightened or darkened, never both): white × 0.34·v where the
// noise is above 0.5, black × 0.5·|v| where it is below — one fill instead of two per modulated shape.
function modCanvases(size, noise, contrast = 1) {
  const both = makeCanvas(size, size);
  const gb = both.getContext('2d');
  const ib = gb.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = Math.max(-1, Math.min(1, (noise[i] - 0.5) * 2 * contrast));
    const w = v > 0 ? 255 : 0;
    ib.data[i * 4] = ib.data[i * 4 + 1] = ib.data[i * 4 + 2] = w;
    ib.data[i * 4 + 3] = (v > 0 ? v * 0.34 : -v * 0.5) * 255;
  }
  gb.putImageData(ib, 0, 0);
  return { both };
}
// Two blotch layers (colour a over noise na, colour b over the transposed noise nb) pre-composited into one tile.
function blotchPair(size, na, rgbA, loA, hiA, aA, nb, rgbB, loB, hiB, aB) {
  const c = makeCanvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  const ramp = (v, lo, hi) => { let t = (v - lo) / (hi - lo); t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const a1 = ramp(na[i], loA, hiA) * aA, a2 = ramp(nb[x * size + y], loB, hiB) * aB;
    const a = a2 + a1 * (1 - a2); // b over a
    d[i * 4 + 3] = a * 255;
    if (a > 0) for (let k = 0; k < 3; k++) d[i * 4 + k] = (rgbB[k] * a2 + rgbA[k] * a1 * (1 - a2)) / a;
  }
  g.putImageData(img, 0, 0);
  return c;
}
// Tileable speckle canvas: random small blobs in the given colours (wraps around the edges).
// (rasterised here into ImageData — thousands of tiny canvas ellipse fills cost ~30 ms of drawing calls)
function speckleCanvas(size, count, colours, rMin, rMax, seed, { alpha = 1, elong = 1 } = {}) {
  const r = mulberry(seed);
  const cols = colours.map(hexRgb);
  const buf = new Float32Array(size * size * 4); // premultiplied RGBA
  for (let i = 0; i < count; i++) {
    const x = r() * size, y = r() * size, rad = rMin + r() * (rMax - rMin), rot = r() * Math.PI;
    const col = cols[(r() * cols.length) | 0];
    const a = alpha * (0.5 + r() * 0.5);
    const ca = Math.cos(rot), sa = Math.sin(rot), ra = rad * elong, rb = rad, ext = Math.ceil(ra) + 1;
    for (let py = Math.floor(y - ext); py <= Math.ceil(y + ext); py++) {
      const row = (((py % size) + size) % size) * size;
      for (let px = Math.floor(x - ext); px <= Math.ceil(x + ext); px++) {
        const dx = px + 0.5 - x, dy = py + 0.5 - y;
        const u = (dx * ca + dy * sa) / ra, v = (-dx * sa + dy * ca) / rb;
        const cov = Math.min(1, (1 - Math.sqrt(u * u + v * v)) * rb + 0.5); // ≈ 1 px anti-aliased edge
        if (cov <= 0) continue;
        const k = (row + (((px % size) + size) % size)) * 4, sA = a * cov, inv = 1 - sA;
        buf[k] = col[0] * sA + buf[k] * inv; buf[k + 1] = col[1] * sA + buf[k + 1] * inv;
        buf[k + 2] = col[2] * sA + buf[k + 2] * inv; buf[k + 3] = sA + buf[k + 3] * inv;
      }
    }
  }
  const c = makeCanvas(size, size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  for (let k = 0; k < size * size * 4; k += 4) {
    const al = buf[k + 3];
    if (al <= 0) continue;
    d[k] = buf[k] / al; d[k + 1] = buf[k + 1] / al; d[k + 2] = buf[k + 2] / al; d[k + 3] = al * 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
// a drawn over b at alpha t, as an opaque colour
function mixHex(b, a, t) {
  const x = hexRgb(b), y = hexRgb(a);
  return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * t)).join(',')})`;
}

// ---------------------------------------------------------------------------------------------------------------
// Scene preparation: classify + build Path2D objects once, reused for every canvas.
function prepare(ctx) {
  const data = ctx.data;
  const skipRoads = ctx.skipRoadIds || new Set();
  const campus = data.meta.campusBoundary && data.meta.campusBoundary[0] ? data.meta.campusBoundary[0] : null;
  const onCampus = (x, z) => (campus ? pointInRing(x, z, campus) : false);
  const mid = (pts) => pts[(pts.length / 2) | 0];

  // ---- areas
  const areas = [];
  const stadium = data.areas.find((a) => a.type === 'stadium' && /Gesling/i.test(a.name || ''));
  for (const a of data.areas) {
    if (!a.polygon || a.polygon.length < 3) continue;
    if (a.type === 'bridgeArea') continue;
    let gesling = false;
    if (a.type === 'pitch' && stadium) {
      let cx = 0, cz = 0;
      for (const [x, z] of a.polygon) { cx += x; cz += z; }
      gesling = pointInRing(cx / a.polygon.length, cz / a.polygon.length, stadium.polygon);
    }
    areas.push({ a, gesling, path: polyPath(a.polygon, a.holes), frame: a.polygon.length >= 3 ? footprintFrame(a.polygon) : null, _bb: bbox(a.polygon, 0) });
  }

  // ---- roads
  // shallow copies: never mutate the shared CAMPUS_DATA records
  const roads = data.roads.filter((r) => !r.bridge && !r.tunnel && !skipRoads.has(r.id) && r.points.length > 1).map((r) => ({ ...r }));
  roads.sort((a, b) => (ROAD_RANK[a.type] ?? 1) - (ROAD_RANK[b.type] ?? 1));
  const ageRnd = mulberry(77);
  for (const r of roads) {
    r._path = piecePaths(r.points);
    r._len = polyLength(r.points);
    r._w = r.width || (r.type === 'service' ? 4.5 : 7);
    r._bb = bbox(r.points, r._w / 2 + 0.5);
    r._age = ageRnd(); // resurfacing age → asphalt tone (fixed per road, so all levels agree)
    const surf = r.surface || '';
    r._brick = /sett|cobble/.test(surf);
    r._concrete = surf === 'concrete';
  }

  // ---- junctions (for trimming lane markings)
  const vkey = (p) => `${Math.round(p[0] * 5)},${Math.round(p[1] * 5)}`;
  const nodeMap = new Map();
  for (const r of roads) {
    r.points.forEach((p, i) => {
      const k = vkey(p);
      if (!nodeMap.has(k)) nodeMap.set(k, []);
      nodeMap.get(k).push({ r, i, end: i === 0 || i === r.points.length - 1 });
    });
  }
  for (const r of roads) {
    r._junctions = [];
    if (!MAJOR.has(r.type) && r.type !== 'residential') continue;
    let s = 0;
    r.points.forEach((p, i) => {
      if (i > 0) s += Math.hypot(p[0] - r.points[i - 1][0], p[1] - r.points[i - 1][1]);
      const list = nodeMap.get(vkey(p));
      if (!list || list.length < 2) return;
      const others = list.filter((o) => o.r !== r && (ROAD_RANK[o.r.type] ?? 0) >= 1);
      if (!others.length) return;
      const selfEnd = i === 0 || i === r.points.length - 1;
      // plain continuation: exactly two ways meeting end to end
      if (list.length === 2 && selfEnd && others[0].end && others[0].r.name === r.name) return;
      const rad = Math.max(...others.map((o) => o.r._w)) / 2 + 2.5;
      r._junctions.push([s - rad, s + rad]);
    });
  }

  // ---- spatial index of carriageway segments (clips crosswalks to the road surface, finds curb neighbours)
  const SEGC = 24;
  const segGrid = new Map();
  const cellKey = (gx, gz) => gx * 100003 + gz;
  for (const r of roads) {
    const hw = r._w / 2;
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i];
      const seg = { ax: a[0], az: a[1], bx: b[0], bz: b[1], hw, r };
      const x0 = Math.floor((Math.min(a[0], b[0]) - hw) / SEGC), x1 = Math.floor((Math.max(a[0], b[0]) + hw) / SEGC);
      const z0 = Math.floor((Math.min(a[1], b[1]) - hw) / SEGC), z1 = Math.floor((Math.max(a[1], b[1]) + hw) / SEGC);
      for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
        const k = cellKey(gx, gz);
        let list = segGrid.get(k);
        if (!list) segGrid.set(k, (list = []));
        list.push(seg);
      }
    }
  }
  // Signed distance to the nearest carriageway edge (negative = on the road surface); `except` skips one road.
  const carriagewayDist = (x, z, except = null) => {
    const list = segGrid.get(cellKey(Math.floor(x / SEGC), Math.floor(z / SEGC)));
    let best = Infinity;
    if (list) for (const s of list) {
      if (s.r === except) continue;
      const ex = s.bx - s.ax, ez = s.bz - s.az, l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * ex + (z - s.az) * ez) / l2));
      const d = Math.hypot(x - s.ax - ex * t, z - s.az - ez * t) - s.hw;
      if (d < best) best = d;
    }
    return best;
  };

  // ---- paths
  const paths = data.paths.filter((p) => !p.bridge && !p.tunnel && !p.indoor && !skipRoads.has(p.id) && p.points.length > 1).map((p) => ({ ...p }));
  for (const p of paths) {
    p._path = piecePaths(p.points);
    const m = mid(p.points);
    p._campus = onCampus(m[0], m[1]);
    const s = p.surface || '';
    let kind;
    if (p.type === 'steps') kind = 'steps';
    else if (p.footway === 'crossing') kind = 'crossing';
    else if (p.footway === 'sidewalk') kind = s === 'asphalt' ? 'asphaltPath' : s === 'paving_stones' ? 'paver' : 'sidewalk';
    else if (/dirt|earth|ground|unpaved|woodchips|mud|grass/.test(s)) kind = 'dirt';
    else if (/gravel|compacted|fine_gravel|pebble/.test(s)) kind = 'gravel';
    else if (s === 'asphalt') kind = 'asphaltPath';
    else if (s === 'paving_stones' || s === 'bricks' || /cobble|sett/.test(s)) kind = 'paver';
    else if (s === 'concrete' || s.startsWith('concrete')) kind = 'concrete';
    else if (p.type === 'path' || p.type === 'track') kind = s === 'paved' ? 'asphaltPath' : 'dirt';
    else if (p.type === 'cycleway') kind = 'asphaltPath';
    else if (p.type === 'pedestrian') kind = 'paver';
    else kind = p._campus ? 'concrete' : (s === 'paved' ? 'asphaltPath' : 'concrete');
    if (p.type === 'track' && kind === 'dirt') kind = 'gravel';
    p._kind = kind;
    p._w = Math.max(1.2, p.width || 2.4);
    if (kind === 'crossing') p._w = Math.max(3, p._w);
    p._bb = bbox(p.points, p._w / 2 + 1);
  }

  // ---- rails (non-tunnel) → ballast strip on the ground. railway=abandoned / razed means the track was lifted
  // (in Junction Hollow the old spur runs across today's parking lot and buildings) — nothing to draw.
  const rails = (data.railways || []).filter((r) => !r.tunnel && !r.bridge && r.points.length > 1 && !RAIL_GONE.has(r.type)).map((r) => {
    const p = new Path2D(); linePath(p, r.points); return { r, path: p, _bb: bbox(r.points, 3) };
  });

  // ---- buildings (ground under footprint + AO halo); each level builds the path of the ones it paints
  const bRings = [];
  for (const b of data.buildings) {
    if (!b.footprint || b.footprint.length < 3) continue;
    if (b.minHeight > 3 || b.hidden) continue; // raised parts (bridges, overhangs) don't touch the ground
    const bb = bbox(b.footprint, 0);
    bRings.push({ ring: b.footprint, _bb: bb, cx: (bb[0] + bb[2]) / 2, cz: (bb[1] + bb[3]) / 2 });
  }

  // ---- OSM trees → soft shade discs (each painted rectangle builds the path of its own)
  const trees = data.trees || [];

  // ---- extent of the painted ground (= the terrain grid); markings are clipped to it
  const hf = ctx.heightfield;
  const bounds = hf ? { minX: hf.minX, minZ: hf.minZ, maxX: hf.maxX ?? hf.minX + (hf.width - 1) * hf.cellSize, maxZ: hf.maxZ ?? hf.minZ + (hf.height - 1) * hf.cellSize }
    : { ...data.meta.bounds };


  // ---- frontage paving: where buildings stand at the back of the sidewalk (Walnut St, Penn Ave, Forbes, Craig…)
  // the whole strip between the kerb and the building face is paved — OSM maps only the sidewalk's centreline,
  // and the rest would read as a lawn in front of the shops. Per road side, rays go out from the kerb every 2 m;
  // a building face within reach (more in shopping streets: commercial buildings / POIs around) paves up to it.
  // Computed lazily per road (cached; the near level asks for the roads in its window).
  const EC = 12;
  let edgeGrid = null, comGrid = null;
  const RESID = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'residential', 'garage', 'garages', 'shed']);
  const COMM = new Set(['commercial', 'retail', 'office', 'hotel', 'church', 'cathedral', 'bank', 'civic', 'public', 'library', 'supermarket']);
  const COM_POI = new Set(['restaurant', 'cafe', 'fast_food', 'bar', 'bank', 'atm', 'library', 'hotel', 'pharmacy', 'shop', 'post_office', 'cinema', 'ice_cream', 'pub']);
  const buildEdgeGrid = () => {
    edgeGrid = new Map();
    for (const b of data.buildings) {
      const ring = b.footprint;
      if (!ring || ring.length < 3 || b.minHeight > 3 || b.hidden) continue;
      const kind = RESID.has(b.type) ? 1 : COMM.has(b.type) ? 2 : 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], c = ring[(i + 1) % ring.length];
        const e = [a[0], a[1], c[0], c[1], kind, 0];
        for (let gx = Math.floor(Math.min(a[0], c[0]) / EC); gx <= Math.floor(Math.max(a[0], c[0]) / EC); gx++) {
          for (let gz = Math.floor(Math.min(a[1], c[1]) / EC); gz <= Math.floor(Math.max(a[1], c[1]) / EC); gz++) {
            const k = gx * 100003 + gz;
            let l = edgeGrid.get(k);
            if (!l) edgeGrid.set(k, (l = []));
            l.push(e);
          }
        }
      }
    }
    // shopping cells (60 m): at least three shops / restaurants / banks … in the cell and its neighbours
    const count = new Map();
    for (const p of data.pois || []) {
      if (!COM_POI.has(p.type)) continue;
      const k = Math.floor(p.x / 60) * 100003 + Math.floor(p.z / 60);
      count.set(k, (count.get(k) || 0) + 1);
    }
    comGrid = new Set();
    for (const k of count.keys()) {
      const i0 = Math.round(k / 100003), j0 = k - i0 * 100003;
      for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
        let n = 0;
        for (let a = i - 1; a <= i + 1; a++) for (let b = j - 1; b <= j + 1; b++) n += count.get(a * 100003 + b) || 0;
        if (n >= 3) comGrid.add(i * 100003 + j);
      }
    }
  };
  const shopping = (x, z) => comGrid.has(Math.floor(x / 60) * 100003 + Math.floor(z / 60));
  // first building face hit by the ray p + d·t, t ≤ maxT → [t, kind] or null
  let rayStamp = 0;
  const rayHit = (px, pz, dx, dz, maxT) => {
    let best = null;
    const ex = px + dx * maxT, ez = pz + dz * maxT;
    const stamp = ++rayStamp;
    for (let gx = Math.floor(Math.min(px, ex) / EC); gx <= Math.floor(Math.max(px, ex) / EC); gx++) {
      for (let gz = Math.floor(Math.min(pz, ez) / EC); gz <= Math.floor(Math.max(pz, ez) / EC); gz++) {
        const l = edgeGrid.get(gx * 100003 + gz);
        if (!l) continue;
        for (const e of l) {
          if (e[5] === stamp) continue;
          e[5] = stamp;
          const sx = e[2] - e[0], sz = e[3] - e[1];
          const den = dx * sz - dz * sx;
          if (Math.abs(den) < 1e-9) continue;
          const qx = e[0] - px, qz = e[1] - pz;
          const t = (qx * sz - qz * sx) / den, u = (qx * dz - qz * dx) / den;
          if (t < 0 || t > maxT || u < 0 || u > 1) continue;
          if (!best || t < best[0]) best = [t, e[4]];
        }
      }
    }
    return best;
  };
  const FRONT_TYPES = new Set(['primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'residential', 'unclassified', 'trunk']);
  const frontage = (r, step = 1.5) => {
    const key = step === 1.5 ? '_front' : '_frontC';
    if (r[key]) return r[key];
    const out = (r[key] = []);
    if (!FRONT_TYPES.has(r.type) || r._w < 5) return out;
    if (!edgeGrid) buildEdgeGrid();
    const S = resamplePolyline(r.points, step);
    for (let i = 1; i < S.length - 1; i++) { // smoothed tangents
      const tx = S[i + 1].x - S[i - 1].x, tz = S[i + 1].z - S[i - 1].z, l = Math.hypot(tx, tz) || 1;
      S[i].tx = tx / l; S[i].tz = tz / l;
    }
    const e0 = r._w / 2 + 0.2;
    for (const sgn of [-1, 1]) {
      const t = S.map((p) => {
        const nx = -p.tz * sgn, nz = p.tx * sgn, x0 = p.x + nx * e0, z0 = p.z + nz * e0;
        const reach = shopping(x0, z0) ? 9 : 4.6;
        const h = rayHit(x0, z0, nx, nz, reach);
        if (!h || h[0] < 1 || (h[1] === 1 && h[0] > 3.4)) return 0;
        if (carriagewayDist(x0 + nx * 0.6, z0 + nz * 0.6, r) < 0) return 0; // a side street / junction
        // not across another carriageway on the way
        if (carriagewayDist(x0 + nx * h[0] * 0.5, z0 + nz * h[0] * 0.5, r) < 0.3) return 0;
        return h[0];
      });
      // close one-sample gaps, then soften the far edge (running mean over the hits)
      const K = Math.max(1, Math.round(3 / step));
      for (let i = 1; i < t.length - 1; i++) if (!t[i] && t[i - 1] && t[i + 1]) t[i] = (t[i - 1] + t[i + 1]) / 2;
      const sm = t.map((v, i) => {
        if (!v) return 0;
        let s = 0, n = 0;
        for (let k = Math.max(0, i - K); k <= Math.min(t.length - 1, i + K); k++) if (t[k]) { s += t[k]; n++; }
        return Math.max(v, s / n) + 0.25; // (reach just under the wall)
      });
      let run = null;
      const flush = () => {
        if (run && run.length > 1) {
          const inner = run.map(([p]) => [p.x - p.tz * sgn * (e0 - 0.3), p.z + p.tx * sgn * (e0 - 0.3)]);
          const outer = run.map(([p, v]) => [p.x - p.tz * sgn * (e0 + v), p.z + p.tx * sgn * (e0 + v)]);
          const ring = inner.concat(outer.reverse());
          const path = new Path2D();
          ringPath(path, ring);
          // saw-cut joints across the paving every sample (≈ 1.5 m slabs)
          const joints = new Path2D();
          if (step <= 2) for (let k = 1; k < run.length - 1; k++) { joints.moveTo(inner[k][0], inner[k][1]); const o = outer[run.length - 1 - k]; joints.lineTo(o[0], o[1]); }
          out.push({ path, joints, _bb: bbox(ring, 0.5) });
        }
        run = null;
      };
      for (let i = 0; i < S.length; i++) {
        if (sm[i]) (run || (run = [])).push([S[i], sm[i]]);
        else flush();
      }
      flush();
    }
    return out;
  };

  return { areas, roads, paths, rails, bRings, trees, onCampus, carriagewayDist, frontage, nodeMap, vkey, bounds };
}

// Parts of a polyline inside the axis-aligned rectangle [x0,x1]×[z0,z1] (exact segment clipping, Liang–Barsky;
// vertices inside are kept as they are, so sharp corners stay sharp).
export function clipPolylineToRect(pts, x0, z0, x1, z1) {
  const runs = [];
  let cur = null;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const dx = bx - ax, dz = bz - az;
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dz, az - z0], [dz, z1 - az]]) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p;
      if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; }
      else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (!ok) { if (cur) { runs.push(cur); cur = null; } continue; }
    const s = [ax + dx * t0, az + dz * t0], e = [ax + dx * t1, az + dz * t1];
    if (!cur || t0 > 0) { if (cur) runs.push(cur); cur = [s]; }
    cur.push(e);
    if (t1 < 1) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs.filter((r) => r.length > 1);
}

// ---------------------------------------------------------------------------------------------------------------
// shared pattern sources (built once)
// (built once and kept: the near level repaints strips with them all the time)
let SOURCES = null;
function makeSources() {
  if (SOURCES) return SOURCES;
  const t0 = performance.now();
  const n256a = tileNoise(256, [4, 8, 16, 32], 11);
  const n256b = tileNoise(256, [3, 6, 12, 24, 48], 23);
  const n256c = tileNoise(256, [8, 16, 32, 64], 37);
  const src = {
    dryBlotch: blotchCanvas(256, n256a, hexRgb(COL.dry), 0.42, 0.82, 0.45),
    lushBlotch: blotchCanvas(256, n256b, hexRgb(COL.lush), 0.38, 0.78, 0.45),
    softGrey: modCanvases(256, n256c, 1.2),
    softGrey2: modCanvases(256, n256b, 1.6),
    // concrete mottling at slab scale (≈ 1–3 m blotches over a 12 m tile)
    slabs: modCanvases(128, tileNoise(128, [8, 16], 41, [1, 0.5]), 1.5),
    litter: speckleCanvas(256, 1400, ['#7a5a32', '#5e4a2a', '#8a6a3a', '#3f3f24', '#6b6a38', '#9a7440'], 1.2, 3.2, 5, { elong: 1.6 }),
    moss: blotchCanvas(256, n256c, [70, 92, 40], 0.5, 0.7, 0.6),
    flowers: speckleCanvas(256, 1800, ['#c8323c', '#e0b030', '#d86aa0', '#f0eee6', '#8a52b8', '#e87a2a', '#4f7d31', '#3f6d2a'], 1.5, 3.5, 9),
    shrubs: speckleCanvas(256, 260, ['#3d5a2a', '#4a6a30', '#34502a', '#56733a'], 5, 11, 13),
    scrubPatches: speckleCanvas(256, 300, ['#56602f', '#7c7a48', '#4a5a2c'], 4, 10, 17, { alpha: 0.7 }),
    gravelSpeck: speckleCanvas(128, 900, ['#7d766b', '#b0a898', '#8a8274', '#c2baa9'], 0.6, 1.4, 21),
    asphaltDark: blotchCanvas(256, n256a, [40, 41, 43], 0.55, 0.8, 0.45),
    // pre-composited pairs (one fill / stroke instead of two): lush + dry lawn blotches, asphalt patches + stains
    grassVar: blotchPair(256, n256b, hexRgb(COL.lush), 0.38, 0.78, 0.45 * 0.85, n256a, hexRgb(COL.dry), 0.42, 0.82, 0.45 * 0.5),
    lawnVar: blotchPair(256, n256b, hexRgb(COL.lush), 0.38, 0.78, 0.45 * 0.55, n256a, hexRgb(COL.dry), 0.42, 0.82, 0.45 * 0.3),
    asphVar: blotchPair(256, n256c, [92, 94, 96], 0.55, 0.72, 0.5 * 0.9, n256a, [40, 41, 43], 0.55, 0.8, 0.45 * 0.8),
    // pattern tiles replacing per-rectangle loops inside polygon clips (clip + thousands of fillRects was slow):
    // mowing stripes (two 32 px bands, rows = across the stripes) and one parking-stall period of oil stains
    stripes: (() => {
      const c = makeCanvas(4, 64), g = c.getContext('2d');
      g.fillStyle = 'rgb(16,34,8)'; g.fillRect(0, 0, 4, 32);            // darker pass (drawn at globalAlpha a)
      g.fillStyle = 'rgba(214,236,160,0.85)'; g.fillRect(0, 32, 4, 32); // lighter pass (≈ 0.85 a)
      return c;
    })(),
    stains: (() => {
      const k = 20; // px per metre
      const c = makeCanvas(Math.round(STALL.width * k), Math.round(STALL.period * k)), g = c.getContext('2d');
      g.fillStyle = 'rgba(20,20,22,0.18)';
      for (const v of [1.8, 7.4]) g.fillRect((STALL.width / 2 - 0.4) * k, v * k, 0.8 * k, 1.8 * k);
      return c;
    })(),
  };
  src.ms = performance.now() - t0;
  SOURCES = src;
  return src;
}

// ---------------------------------------------------------------------------------------------------------------
// The painter. mode = 'color' | 'mask'. The canvas transform maps world metres to pixels; ppm = pixels per metre.
function paintAll(g, mode, ppm, P, S, level) {
  const C = mode === 'color';
  const px = 1 / ppm; // one pixel in metres
  const W = level.w, H = level.h;
  const x0 = level.minX, z0 = level.minZ;

  // world-scaled pattern: tile canvas of `pix` pixels spanning `metres` metres (cached per canvas / transform)
  const patCache = new Map();
  const pat = (canvas, metres, rot = 0, ox = 0, oz = 0) => {
    let byCanvas = patCache.get(canvas);
    if (!byCanvas) patCache.set(canvas, (byCanvas = new Map()));
    const key = `${metres}|${rot}|${ox}|${oz}`;
    let p = byCanvas.get(key);
    if (p) return p;
    p = g.createPattern(canvas, 'repeat');
    const s = metres / canvas.width;
    const c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
    p.setTransform(new DOMMatrix([c, sn, -sn, c, ox, oz]));
    byCanvas.set(key, p);
    return p;
  };
  // Pattern laid out in an area's oriented frame (same angle normalisation as inFrame / frameToWorld).
  // `metres` = size of 32 pattern px for the stripe tile, or metres per px (with perPx) for other tiles;
  // across = pattern rows run along the frame's long axis u instead of across it (v); (u0, v0) = tile origin.
  const framePattern = (canvas, frame, metres, across, { perPx = false, u0 = 0, v0 = 0 } = {}) => {
    let ang = frame.angle;
    while (ang > Math.PI / 2) ang -= Math.PI;
    while (ang <= -Math.PI / 2) ang += Math.PI;
    const k = perPx ? metres : metres / 32, c = Math.cos(ang), s = Math.sin(ang);
    const ox = frame.center[0] + u0 * c - v0 * s, oz = frame.center[1] + u0 * s + v0 * c;
    const p = g.createPattern(canvas, 'repeat');
    p.setTransform(new DOMMatrix(across ? [-k * s, k * c, k * c, k * s, ox, oz] : [k * c, k * s, -k * s, k * c, ox, oz]));
    return p;
  };
  const fillAll = (style, alpha = 1, op = 'source-over') => {
    g.globalAlpha = alpha; g.globalCompositeOperation = op;
    g.fillStyle = style; g.fillRect(x0 - 10, z0 - 10, W + 20, H + 20);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  };
  const fillPath = (path, style, alpha = 1, op = 'source-over', rule = 'evenodd') => {
    g.globalAlpha = alpha; g.globalCompositeOperation = op;
    g.fillStyle = style; g.fill(path, rule);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  };
  const stroke = (path, style, width, opts = {}) => {
    if (batch && path.pieces) batch.stroke(path, style, width, opts); else rawStroke(path, style, width, opts);
  };
  const rawStroke = (path, style, width, opts = {}) => {
    const { alpha = 1, dash = null, cap = 'round', join = 'round', op = 'source-over' } = opts;
    g.globalAlpha = alpha; g.globalCompositeOperation = op;
    g.strokeStyle = style; g.lineWidth = Math.max(width, px * 0.7);
    g.lineCap = cap; g.lineJoin = join;
    if (dash) g.setLineDash(dash);
    // (pieces lying off the painted rectangle are not submitted: a near-level strip is a thin slice of the ways
    // crossing it; a piece lies within 43 m of its anchor)
    const m = 44 + g.lineWidth / 2;
    const inRect = (x, z) => x > x0 - m && x < x0 + W + m && z > z0 - m && z < z0 + H + m;
    const pcs = path.pieces ? path.pieces.filter((q, i) => inRect(path.at[i * 2], path.at[i * 2 + 1])) : null;
    if (!path.pieces) g.stroke(path);
    else if (path.pieces.length === 1 || cap !== 'round' || (alpha >= 1 && typeof style === 'string')) for (const q of pcs) g.stroke(q);
    else {
      // translucent: butt-capped pieces (they abut, no double blending) + the round caps at the true ends
      g.lineCap = 'butt';
      for (const q of pcs) g.stroke(q);
      const r = g.lineWidth / 2;
      g.fillStyle = style;
      for (const [x, z, dx, dz] of path.ends) {
        if (!inRect(x, z)) continue;
        const a = Math.atan2(dz, dx), cap = new Path2D();
        cap.moveTo(x, z); cap.arc(x, z, r, a - Math.PI / 2, a + Math.PI / 2); cap.closePath();
        g.fill(cap);
      }
    }
    if (dash) g.setLineDash([]);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  };
  // A level that contains already painted, sharper levels (level.inners: the far level around the core and
  // Oakland) skips every feature lying entirely inside one of them and gets the inner canvases drawn in
  // (downscaled) at the end — most ways and areas are in those, and each one costs GPU raster time on every
  // canvas. Every level also skips what lies off its own canvas.
  const inners = level.inners || [];
  const IM = 2; // metres of margin (strokes, anti-aliasing, soft shades reaching over the rectangle edge)
  const OM = 12; // off-canvas margin (AO halos, blurred shades)
  const onCanvas = (f) => { const b = f._bb; return !b || !(b[2] < x0 - OM || b[0] > x0 + W + OM || b[3] < z0 - OM || b[1] > z0 + H + OM); };
  const vis = (f, m = IM) => {
    const b = f._bb;
    if (!b) return true;
    if (!onCanvas(f)) return false;
    for (const inner of inners) {
      if (b[0] > inner.minX + m && b[1] > inner.minZ + m && b[2] < inner.minX + inner.w - m && b[3] < inner.minZ + inner.h - m) return false;
    }
    return true;
  };
  // 'lite' (the far level at low quality, ~1 m per pixel): only the fills that read at that scale — no worn
  // edges, joints, speckle overlays, wheel paths or blurred tree shade
  const lite = !!level.lite;
  // 'far' (the far level, ~0.8 m per pixel): what is finer than a pixel or two is left out (worn path edges,
  // joints, speckles, per-road asphalt patches — the terrain shader adds close-up detail and macro variation
  // anyway), and ways / building footprints are batched per tile (makeBatcher)
  const far = !!level.far || lite;
  const batch = far ? makeBatcher((p, style, width, opts) => rawStroke(p, style, width, opts), (p, style) => fillPath(p, style, 1, 'source-over', 'nonzero')) : null;
  const flush = () => { if (batch) batch.flush(); };
  if (mode === 'marks') {
    // road / field markings only, on black: R = white coverage, G = yellow (the terrain shader lays them over the
    // colour texture and fades them out near the camera, where roads.js draws them as crisp decals)
    fillAll('#000');
    paintMarkings(true);
    return;
  }
  // brightness modulation with a light/dark noise pair (see modCanvases); 'strength' ≈ old soft-light alpha
  const modulate = (path, src, metres, rot, strength, { ox = 0, oz = 0, width = 0 } = {}) => {
    const style = pat(src.both, metres, rot, ox, oz);
    if (width) stroke(path, style, width, { alpha: strength });
    else if (path) fillPath(path, style, strength);
    else fillAll(style, strength);
  };
  // A layer composed at 1/SH resolution over the painted rectangle (+ margin m metres) and drawn scaled up in one
  // go: the blurred shades and the low-frequency base ground (full-resolution blur filters / big pattern fills
  // cost hundreds of milliseconds on a 4096² canvas). Its cells are aligned to a grid fixed in world space, so
  // neighbouring strips of the near level compose exactly the same layer where they meet.
  const lowRes = (SH, m, alpha, draw) => {
    const t = g.getTransform();
    const ph = (v) => ((v % SH) + SH) % SH;
    const phx = ph(t.e), phz = ph(t.f);
    const dx0 = Math.floor(((x0 - m) * t.a + t.e - phx) / SH) * SH + phx, dz0 = Math.floor(((z0 - m) * t.d + t.f - phz) / SH) * SH + phz;
    const dx1 = (x0 + W + m) * t.a + t.e, dz1 = (z0 + H + m) * t.d + t.f;
    const cw = Math.max(1, Math.ceil((dx1 - dx0) / SH)), ch = Math.max(1, Math.ceil((dz1 - dz0) / SH));
    const c = scratchCanvas(cw, ch);
    const sg = c.getContext('2d');
    sg.setTransform(1, 0, 0, 1, 0, 0);
    sg.clearRect(0, 0, cw, ch);
    sg.setTransform(t.a / SH, 0, 0, t.d / SH, (t.e - dx0) / SH, (t.f - dz0) / SH);
    draw(sg);
    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = alpha;
    g.imageSmoothingEnabled = true;
    g.drawImage(c, 0, 0, cw, ch, dx0, dz0, cw * SH, ch * SH);
    g.restore();
  };
  // Soft (blurred) shade of a path (or of a list of tile paths)
  // (sharp levels: no blur filter — the layer's own 4× upscaling softens the edges over ~1 m, and a canvas blur
  // costs the GPU several ms per near-level strip)
  const softShade = (path, color, alpha, blurM, rule = 'nonzero') => lowRes(4, 3 * blurM + 2, alpha, (sg) => {
    if (ppm < 2) sg.filter = `blur(${Math.max(0.6, (blurM * ppm) / 4).toFixed(2)}px)`;
    sg.fillStyle = color;
    for (const p of Array.isArray(path) ? path : [path]) sg.fill(p, rule);
    sg.filter = 'none';
  });
  // draw inside a polygon clip, in the polygon's oriented frame (u along the long axis)
  const inFrame = (path, frame, fn) => {
    g.save();
    g.clip(path, 'evenodd');
    g.translate(frame.center[0], frame.center[1]);
    // keep local +u pointing east-ish so painted text reads upright when seen from the south
    let ang = frame.angle;
    while (ang > Math.PI / 2) ang -= Math.PI;
    while (ang <= -Math.PI / 2) ang += Math.PI;
    g.rotate(ang);
    fn(frame.length, frame.width);
    g.restore();
  };

  // ======================================================================= 1. base ground
  if (C) {
    // Only low-frequency variation (≥ 37 m blotches) here, so it is composed at 1/4 resolution and scaled up in a
    // single draw — five full-resolution fills of a 4096² canvas are the most expensive part of the painting.
    lowRes(4, 8, 1, (bg) => {
      const fillB = (style, alpha = 1) => { bg.globalAlpha = alpha; bg.fillStyle = style; bg.fillRect(x0 - 20, z0 - 20, W + 40, H + 40); };
      fillB(COL.grass);
      fillB(pat(S.dryBlotch, 420, 0.3), 0.8);
      fillB(pat(S.lushBlotch, 170, 1.1, 37, 11), 0.9);
      fillB(pat(S.softGrey.both, 37, 0.7), 0.3);
      bg.globalAlpha = 1;
    });
  } else {
    fillAll(MASK.veg);
  }

  // ======================================================================= 2. areas (large → small)
  for (const area of P.areas) {
    if (!vis(area)) continue;
    const { a, path, frame, gesling } = area;
    const t = a.type;
    if (t === 'grass' || t === 'park' || t === 'golf') {
      if (!C) { fillPath(path, MASK.veg); continue; }
      const named = NAMED_LAWNS.has(a.name);
      const base = t === 'park' ? COL.park : t === 'golf' ? COL.golf : named ? COL.lawn : COL.grass;
      fillPath(path, base);
      fillPath(path, pat(named ? S.lawnVar : S.grassVar, named ? 110 : 125, 0.5, 13, 7));
      modulate(path, S.softGrey, 29, 0.2, 0.3);
      if ((t === 'golf' || MOWN_LAWNS.has(a.name)) && frame) {
        // Faint mowing stripes along the long axis — only on the showpiece lawns (the Cut, the Mall) and the golf
        // fairways. Real mower passes are ~1.5 m wide and read as a subtle sheen, not as a sports pitch.
        fillPath(path, framePattern(S.stripes, frame, t === 'golf' ? 9 : 1.6, false), t === 'golf' ? 0.035 : 0.026);
      }
    } else if (t === 'wood') {
      if (!C) { fillPath(path, MASK.wood); continue; }
      fillPath(path, COL.wood);
      fillPath(path, pat(S.moss, 47, 0.4), 0.9);
      fillPath(path, pat(S.litter, 21, 0.9), 0.55);
      modulate(path, S.softGrey2, 33, 1.3, 0.5);
    } else if (t === 'scrub') {
      if (!C) { fillPath(path, MASK.veg); continue; }
      fillPath(path, COL.scrub);
      fillPath(path, pat(S.scrubPatches, 40, 0.3), 1);
      fillPath(path, pat(S.litter, 27, 0.2), 0.3);
    } else if (t === 'garden') {
      if (!C) { fillPath(path, MASK.grassHalf); continue; }
      fillPath(path, COL.garden);
      fillPath(path, pat(S.moss, 23), 0.5);
      fillPath(path, pat(S.shrubs, 30, 0.6), 0.9);
      fillPath(path, pat(S.flowers, 19, 1.2), 0.25);
    } else if (t === 'flowerbed') {
      if (!C) { fillPath(path, MASK.soil); continue; }
      fillPath(path, COL.mulch);
      fillPath(path, pat(S.flowers, 9, 0.3), 1);
    } else if (t === 'water') {
      if (!C) { fillPath(path, MASK.soil); continue; }
      fillPath(path, COL.water);
    } else if (t === 'parking') {
      paintParking(a, path, frame);
    } else if (t === 'plaza' || t === 'pavement') {
      if (!C) { fillPath(path, MASK.hard); continue; }
      const base = a.surface === 'asphalt' ? COL.asphaltOld : t === 'plaza' ? COL.plaza : COL.concrete;
      fillPath(path, base);
      modulate(path, S.softGrey, 19, 0.3, 0.25);
      if (t === 'plaza' && frame && ppm > 3) {
        // faint paving grid (1.5 m) aligned with the plaza
        inFrame(path, frame, (L, Wd) => {
          g.strokeStyle = 'rgba(80,70,60,0.18)'; g.lineWidth = 0.06;
          g.beginPath();
          for (let u = -L / 2 - 2; u < L / 2 + 2; u += 1.5) { g.moveTo(u, -Wd / 2 - 2); g.lineTo(u, Wd / 2 + 2); }
          for (let v = -Wd / 2 - 2; v < Wd / 2 + 2; v += 1.5) { g.moveTo(-L / 2 - 2, v); g.lineTo(L / 2 + 2, v); }
          g.stroke();
        });
      }
    } else if (t === 'playground') {
      if (!C) { fillPath(path, MASK.soil); continue; }
      fillPath(path, COL.playground);
      fillPath(path, pat(S.gravelSpeck, 3), 0.5);
    } else if (t === 'construction') {
      if (!C) { fillPath(path, MASK.soil); continue; }
      fillPath(path, COL.construction);
      fillPath(path, pat(S.gravelSpeck, 4), 0.6);
      modulate(path, S.softGrey2, 20, 0, 0.4);
    } else if (t === 'stadium') {
      if (!C) { fillPath(path, MASK.hard); continue; }
      fillPath(path, COL.concrete);
      modulate(path, S.softGrey, 15, 0, 0.25);
    } else if (t === 'track') {
      paintTrack(a, path);
    } else if (t === 'pitch') {
      paintPitch(a, path, frame, gesling);
    }
  }

  // ======================================================================= 3. rail ballast strips
  for (const rail of P.rails) {
    if (!vis(rail)) continue;
    const { r, path } = rail;
    if (!C) { stroke(path, MASK.soil, 4.6); continue; }
    const rusty = r.type !== 'rail';
    stroke(path, rusty ? '#6a6150' : '#5f5a53', 5.2, { alpha: 0.9 });
    stroke(path, rusty ? '#7a7060' : COL.ballast, 3.6);
    if (far) continue;
    stroke(path, pat(S.gravelSpeck, 2.2), 3.6, { alpha: 0.7 });
    if (rusty) stroke(path, pat(S.moss, 20), 5, { alpha: 0.45 });
  }

  // ======================================================================= 4. tree shade (OSM trees)
  if (C && !lite) {
    const tp = new Path2D();
    let nT = 0;
    for (const [x, z] of P.trees) {
      if (x < x0 - OM || x > x0 + W + OM || z < z0 - OM || z > z0 + H + OM) continue;
      tp.moveTo(x + 3.2, z); tp.arc(x, z, 3.2, 0, Math.PI * 2); nT++;
    }
    if (nT) softShade(tp, '#1e2a12', 0.18, 1.5);
  }

  // ======================================================================= 5. paths (not sidewalks / crossings / steps)
  const pathStyle = {
    concrete: [COL.concrete, MASK.hard], sidewalk: [COL.sidewalk, MASK.hard], paver: [COL.paver, MASK.hard],
    asphaltPath: ['#56585a', MASK.asph], dirt: [COL.dirt, MASK.soil], gravel: [COL.gravel, MASK.soil],
  };
  // NB: outside far mode every way is stroked on its own on purpose. Joining many ways into one big Path2D makes
  // Skia rasterise a software coverage mask over the whole union's bounds (measured: twice as slow); small
  // per-way paths go through its GPU atlas instead. (Far mode joins them per 200 m tile: few, atlas-sized paths.)
  const general = P.paths.filter((p) => p._kind !== 'crossing' && p._kind !== 'steps' && p._kind !== 'sidewalk' && vis(p));
  // soft worn edges first (all), then fills
  if (C && !far) for (const p of general) {
    if (p._kind === 'dirt' || p._kind === 'gravel') stroke(p._path, '#6d6146', p._w + 0.9, { alpha: 0.35 });
    else stroke(p._path, '#5b5a45', p._w + 0.45, { alpha: 0.45 });
  }
  for (const p of general) {
    const [c, m] = pathStyle[p._kind] || pathStyle.concrete;
    stroke(p._path, C ? c : m, far ? Math.round(p._w * 2) / 2 : p._w);
    if (!C || far) continue;
    if (p._kind === 'dirt' || p._kind === 'gravel') stroke(p._path, pat(S.gravelSpeck, 2.5), p._w * 0.8, { alpha: 0.35 });
    else if (p._kind === 'concrete') modulate(p._path, S.slabs, 12, 0.2, 0.22, { width: p._w });
    else if (p._kind === 'asphaltPath') stroke(p._path, pat(S.asphVar, 23, 1.1), p._w, { alpha: 0.6 });
    if (p._kind === 'concrete' && ppm > 3) stroke(p._path, '#8a857b', p._w, { alpha: 0.4, dash: [0.07, 1.5], cap: 'butt' });
  }
  flush();

  // ======================================================================= 6. sidewalks
  const roads = P.roads.filter(vis);
  // paved frontage of shopping streets / buildings at the back of the sidewalk (far level: sampled coarser; not
  // at all in lite mode — the low-quality far level, ~1.6 m per pixel)
  const fronts = [];
  if (!lite) for (const r of roads) for (const fr of P.frontage(r, far ? 6 : 1.5)) if (onCanvas(fr)) fronts.push(fr);
  if (far) {
    for (const fr of fronts) batch.fill(fr.path, C ? COL.sidewalk : MASK.hard, (fr._bb[0] + fr._bb[2]) / 2, (fr._bb[1] + fr._bb[3]) / 2);
    flush();
  } else {
    for (const fr of fronts) fillPath(fr.path, C ? COL.sidewalk : MASK.hard, 1, 'source-over', 'nonzero');
    if (C) for (const fr of fronts) {
      fillPath(fr.path, pat(S.slabs.both, 12, 0.2), 0.22, 'source-over', 'nonzero');
      fillPath(fr.path, pat(S.softGrey.both, 9, 0), 0.12, 'source-over', 'nonzero');
      if (ppm > 2) rawStroke(fr.joints, '#86817a', 0.07, { alpha: 0.5, cap: 'butt' });
    }
  }
  const sidewalks = P.paths.filter((p) => p._kind === 'sidewalk' && vis(p));
  for (const p of sidewalks) stroke(p._path, C ? COL.sidewalk : MASK.hard, far ? Math.round(p._w * 2) / 2 + 0.2 : p._w + 0.2);
  flush();
  if (C && !far) for (const p of sidewalks) {
    // weathered slabs: tone variation at slab scale + slow mottling, then the saw-cut joints every ~1.5 m
    modulate(p._path, S.slabs, 12, 0.2, 0.3, { width: p._w });
    modulate(p._path, S.softGrey, 9, 0, 0.18, { width: p._w });
    if (ppm > 2) stroke(p._path, '#86817a', p._w, { alpha: 0.5, dash: [0.07, 1.45], cap: 'butt' });
  }

  // ======================================================================= 7. roads
  // curbs / gutters
  for (const r of roads) {
    if (r.type === 'service') stroke(r._path, C ? '#6f6d66' : MASK.asph, r._w + 0.4, { alpha: C ? 0.5 : 1 });
    else stroke(r._path, C ? COL.curb : MASK.hard, r._w + 0.7);
  }
  flush();
  // asphalt (base tone includes the per-road resurfacing age; patches + stains are one pre-composited tile)
  const asphVar = C ? pat(S.asphVar, 68, 0.4) : null;
  for (const r of roads) {
    if (!C) { stroke(r._path, r._brick || r._concrete ? MASK.hard : MASK.asph, r._w); continue; }
    let base = r._brick ? COL.brick : r._concrete ? '#9c9990' : r.type === 'service' ? '#4c4e51' : COL.asphalt;
    // (far mode: the age quantised to three tones, so the roads batch into a few styles)
    const age = far ? Math.round(r._age * 2) / 2 : r._age;
    if (!r._brick && !r._concrete) base = mixHex(base, age > 0.5 ? '#5a5c5e' : '#2e3033', 0.08 + 0.12 * Math.abs(age - 0.5) * 2);
    stroke(r._path, base, r._w);
  }
  flush();
  if (C && !far) {
    for (const r of roads) {
      if (!r._brick && !r._concrete) {
        stroke(r._path, asphVar, r._w);
        if (r._w >= 6.5) {
          if (!r._edges) {
            const off = (d) => { const w = new Path2D(); linePath(w, offsetPolyline(r.points, d)); return w; };
            r._edges = { wheel: [off(-r._w / 4), off(r._w / 4)], gutter: r.type === 'service' ? [] : [off(-r._w / 2 + 0.3), off(r._w / 2 - 0.3)] };
          }
          // oil / wear darkening along the wheel paths, grime along the gutters
          for (const w of r._edges.wheel) stroke(w, '#26282a', 1.2, { alpha: 0.12 });
          for (const w of r._edges.gutter) stroke(w, '#2b2a27', 0.55, { alpha: 0.22 });
        }
        roadPatches(r);
      } else if (r._brick) {
        modulate(r._path, S.softGrey2, 6, 0, 0.3, { width: r._w });
      }
    }
  }

  // ======================================================================= 8. crossings, steps
  for (const p of P.paths) {
    if (p._kind !== 'steps' || !vis(p)) continue;
    stroke(p._path, C ? '#b5b0a5' : MASK.hard, p._w + 0.3, { cap: 'butt' });
    if (C && !far) stroke(p._path, '#6e6a62', p._w + 0.3, { dash: [0.09, 0.23], cap: 'butt', alpha: 0.8 });
  }
  flush();

  // ======================================================================= 9. buildings: ground + ambient occlusion halo
  // (the ones on this canvas and not inside one of its inner levels; their AO halo may reach ~6 m)
  const bPaths = new Map();
  for (const b of P.bRings) {
    if (!vis(b, 8)) continue;
    const k = far ? Math.floor(b.cx / BATCH_M) * 100003 + Math.floor(b.cz / BATCH_M) : 0;
    let p = bPaths.get(k);
    if (!p) bPaths.set(k, (p = new Path2D()));
    ringPath(p, b.ring);
  }
  const bList = [...bPaths.values()];
  if (C) {
    // (a broad halo reads as contact shade from the air; up close — near level — it is kept tight: the renderer's
    // SSAO darkens the wall foot there)
    if (!lite && bList.length) { if (far) softShade(bList, '#000000', 0.42, 2.2); else softShade(bList, '#000000', 0.3, 0.9); }
    for (const p of bList) fillPath(p, COL.building, 1, 'source-over', 'nonzero');
  } else {
    for (const p of bList) fillPath(p, MASK.soil, 1, 'source-over', 'nonzero');
  }

  // ======================================================================= 10. the sharper inner levels, downscaled
  for (const inner of inners) {
    g.save();
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.drawImage(C ? inner.color : inner.mask, inner.minX, inner.minZ, inner.w, inner.h);
    g.restore();
  }

  // ======================================================================= 11. markings
  // (only into levels that ask for them: near the camera they are crisp decal geometry, see roads.js)
  if (C && level.markings === true) paintMarkings(false);

  // ======================================================================= helpers used above
  // Street furniture of the carriageway (near level only): utility-cut patches, manhole covers, storm drains
  function roadPatches(r) {
    if (!r._decor) r._decor = roadDecor(r);
    for (const d of r._decor) {
      if (d.x < x0 - 6 || d.x > x0 + W + 6 || d.z < z0 - 6 || d.z > z0 + H + 6) continue;
      g.save();
      g.translate(d.x, d.z);
      g.rotate(d.a);
      if (d.kind === 'patch') {
        g.globalAlpha = d.alpha; g.fillStyle = d.col;
        g.fillRect(-d.l / 2, -d.w / 2, d.l, d.w);
        g.globalAlpha = d.alpha * 0.6; g.strokeStyle = '#1c1d1f'; g.lineWidth = Math.max(0.05, px * 0.8);
        g.strokeRect(-d.l / 2, -d.w / 2, d.l, d.w); // (sealed seam)
      } else if (d.kind === 'manhole') {
        g.fillStyle = '#34322e'; g.beginPath(); g.arc(0, 0, 0.36, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#5e5a53'; g.lineWidth = 0.05; g.beginPath(); g.arc(0, 0, 0.3, 0, Math.PI * 2); g.stroke();
      } else {
        g.fillStyle = '#6d6a64'; g.fillRect(-0.55, -0.3, 1.1, 0.6);   // concrete frame
        g.fillStyle = '#1d1c1a'; g.fillRect(-0.45, -0.21, 0.9, 0.42); // grate
        g.strokeStyle = '#4a4741'; g.lineWidth = 0.05;
        g.beginPath(); for (let k = -0.35; k <= 0.36; k += 0.1) { g.moveTo(k, -0.2); g.lineTo(k, 0.2); } g.stroke();
      }
      g.restore();
    }
  }
  function paintParking(a, path, frame) {
    const gravel = a.surface === 'gravel';
    if (!C) { fillPath(path, gravel ? MASK.soil : MASK.asph); return; }
    fillPath(path, gravel ? COL.gravel : COL.parking);
    if (gravel) {
      fillPath(path, pat(S.gravelSpeck, 3, 0.8), 0.6);
      fillPath(path, pat(S.asphaltDark, 37, 0.2), 0.4);
    } else fillPath(path, pat(S.asphVar, 39, 0.8), 0.75);
    if (gravel || !frame || ppm < 1.5) return;
    // stall lines are markings (parkingStalls → far level + decals); oil stains in the middle of the stalls here
    // (one stall period per pattern tile: stains centred in each stall of both stall rows, none in the aisle)
    fillPath(path, framePattern(S.stains, frame, 1 / 20, false, { perPx: true, u0: -frame.length / 2 + 2.9 - STALL.width / 2, v0: -frame.width / 2 + STALL.v0 }));
  }

  function paintTrack(a, path) {
    if (!C) { fillPath(path, MASK.soil); return; }
    fillPath(path, COL.track);
    modulate(path, S.softGrey, 7, 0, 0.18);
    modulate(path, S.softGrey2, 3.3, 0.4, 0.1);
    // Infield: artificial turf (the football pitch is painted on top by its own area). Lane lines are markings
    // (computeMarkings) — painted into the far level only, crisp decals near the camera.
    const hole = a.holes && a.holes[0];
    if (hole) fillPath(polyPath(hole), COL.turf);
  }

  function paintPitch(a, path, frame, gesling) {
    const sport = a.sport || '';
    const surf = a.surface || '';
    const hard = /tennis|basketball|pickleball|table_tennis/.test(sport) || /asphalt|tiles|concrete|acrylic/.test(surf);
    if (!C) { fillPath(path, hard ? (surf === 'asphalt' || sport === 'basketball' ? MASK.asph : MASK.soil) : gesling ? '#300000' : MASK.veg); return; }
    if (!frame) return;
    if (sport === 'tennis' || sport === 'pickleball') {
      fillPath(path, COL.tennisOut);
    } else if (sport === 'basketball') {
      fillPath(path, '#5a5d5f');
    } else if (sport === 'table_tennis') {
      fillPath(path, '#8f8b82');
    } else if (sport === 'golf') {
      fillPath(path, '#6aa84a');
      modulate(path, S.softGrey, 9, 0, 0.15);
      return;
    } else {
      const artificial = gesling;
      fillPath(path, artificial ? COL.turf : COL.pitchGrass);
      // mowing stripes across the field
      fillPath(path, framePattern(S.stripes, frame, artificial ? 4.572 : 5, true, { u0: -frame.length / 2 }), 0.07);
    }
    inFrame(path, frame, (L, Wd) => {
      g.strokeStyle = COL.line;
      g.lineWidth = Math.max(0.11, px * 0.8);
      g.lineJoin = 'miter';
      const rect = (cx, cy, w, h) => g.strokeRect(cx - w / 2, cy - h / 2, w, h);
      const line = (ax, ay, bx, by) => { g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); };
      // Football / soccer LINES come from fieldMarkings() (markings pass); only fills, numbers and logos here.
      if (sport === 'american_football') {
        const yd = L / 120; // stretch to the polygon
        // end zones (Gesling Stadium: Carnegie red; elsewhere a darker green). The TARTANS lettering and the
        // midfield CMU disc are crisp decal geometry (roads.js → fieldArtDecals), like the yard numbers / lines.
        for (const sgn of [-1, 1]) {
          const ex = sgn * (L / 2 - 5 * yd);
          g.fillStyle = gesling ? '#8a1a24' : 'rgba(20,50,15,0.25)';
          g.fillRect(ex - 5 * yd + 0.2, -Wd / 2 + 0.5, 10 * yd - 0.4, Wd - 1);
        }
      } else if (sport === 'soccer') {
        // lines: fieldMarkings()
      } else if (sport === 'tennis' || sport === 'pickleball') {
        const cl = sport === 'tennis' ? Math.min(23.77, L - 1) : Math.min(13.41, L - 0.6);
        const cw = sport === 'tennis' ? Math.min(10.97, Wd - 1) : Math.min(6.1, Wd - 0.6);
        g.fillStyle = COL.tennisIn; g.fillRect(-cl / 2 - 0.3, -cw / 2 - 0.3, cl + 0.6, cw + 0.6); // lines + net: fieldMarkings
      } else if (sport === 'basketball') {
        const cl = Math.min(28.6, L - 1), cw = Math.min(15.2, Wd - 1);
        g.fillStyle = '#6a4a3c'; g.fillRect(-cl / 2, -cw / 2, cl, cw);
        for (const sgn of [-1, 1]) { g.fillStyle = '#8a3a2c'; g.fillRect(sgn > 0 ? cl / 2 - 5.8 : -cl / 2, -2.45, 5.8, 4.9); }
      } else if (sport !== 'table_tennis' && sport !== 'baseball') {
        rect(0, 0, L - 0.6, Wd - 0.6);
      }
    });
  }

  // Thin lines are widened to ≥ 0.8 px but keep their average brightness (alpha ∝ true width) so a sub-pixel line
  // looks as heavy from afar as it would when filtered, instead of a fat bright stripe.
  // (toMarks: into the separate markings canvas — white → red channel, yellow → green, nets left out)
  function paintMarkings(toMarks) {
    const batches = new Map();
    for (const m of computeMarkings(P)) {
      if (toMarks && m.color === 'dark') continue;
      if (!onCanvas(m)) continue;
      const w = Math.max(m.w, px * 0.8);
      const alpha = Math.round((m.alpha ?? 1) * Math.min(1, (m.w / w) * 1.25) * 20) / 20;
      const key = `${m.color}|${w.toFixed(3)}|${m.dash ? m.dash.join(',') : ''}|${alpha}`;
      let b = batches.get(key);
      if (!b) batches.set(key, (b = { path: new Path2D(), m, w, alpha }));
      linePath(b.path, m.pts);
    }
    for (const { path, m, w, alpha } of batches.values()) {
      const col = toMarks ? (m.color === 'yellow' ? '#00ff00' : '#ff0000') : m.color === 'yellow' ? COL.yellow : m.color === 'dark' ? '#1b1b1b' : COL.line;
      stroke(path, col, w, { dash: m.dash, cap: 'butt', join: 'miter', alpha });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Local oriented-frame (u along the long axis, v across) → world transform, with the same angle normalisation as
// the painter's inFrame() so painted fills and marking lines agree.
// Deterministic carriageway details of a road (see roadPatches): positions along the way from a per-road seed.
function roadDecor(r) {
  let h = 2166136261;
  for (const ch of String(r.id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rnd = mulberry(h >>> 0);
  const out = [];
  const w = r._w, curb = r.type !== 'service';
  for (const p of resamplePolyline(r.points, 9)) {
    const a = Math.atan2(p.tz, p.tx), nx = -p.tz, nz = p.tx;
    const at = (lat, along = 0) => [p.x + nx * lat + p.tx * along, p.z + nz * lat + p.tz * along];
    const k = rnd();
    if (k < 0.07) {                                   // utility-cut patch: newer (darker) or older (greyer) asphalt
      const pw = 0.8 + rnd() * 1.6, pl = 1.4 + rnd() * 4.5, lat = (rnd() - 0.5) * Math.max(0, w - pw - 1);
      const [x, z] = at(lat);
      const fresh = rnd() < 0.6;
      out.push({ kind: 'patch', x, z, a: a + (rnd() < 0.25 ? Math.PI / 2 : 0), l: pl, w: pw, col: fresh ? '#25272a' : '#6a6a67', alpha: fresh ? 0.45 + rnd() * 0.2 : 0.22 + rnd() * 0.12 });
    } else if (k < 0.13 && w >= 6) {                  // manhole cover in a lane
      const lane = w >= 10 ? (rnd() < 0.5 ? -1 : 1) * w / 4 : (rnd() - 0.5) * 1.2;
      const [x, z] = at(lane);
      out.push({ kind: 'manhole', x, z, a: 0 });
    } else if (k < 0.2 && curb && w >= 6) {           // storm drain inlet at the kerb
      const [x, z] = at((rnd() < 0.5 ? -1 : 1) * (w / 2 - 0.3));
      out.push({ kind: 'drain', x, z, a });
    }
  }
  return out;
}

function frameToWorld(frame) {
  let ang = frame.angle;
  while (ang > Math.PI / 2) ang -= Math.PI;
  while (ang <= -Math.PI / 2) ang += Math.PI;
  const c = Math.cos(ang), s = Math.sin(ang), [cx, cz] = frame.center;
  return (u, v) => [cx + u * c - v * s, cz + u * s + v * c];
}

// Parking layout across the lot's short axis: [5.4 m stalls | 5.4 m stalls | 7 m aisle], stalls 2.75 m wide.
const STALL = { period: 17.8, v0: 1.0, depth: 5.4, width: 2.75 };

// Stroke digits for football yard numbers, in a unit box (x right 0..0.62, y up 0..1).
const DIGITS = {
  0: [[[0, 0.15], [0, 0.85], [0.1, 1], [0.52, 1], [0.62, 0.85], [0.62, 0.15], [0.52, 0], [0.1, 0], [0, 0.15]]],
  1: [[[0.14, 0.8], [0.34, 1], [0.34, 0]]],
  2: [[[0, 0.8], [0.1, 1], [0.52, 1], [0.62, 0.86], [0.62, 0.64], [0, 0.1], [0, 0], [0.64, 0]]],
  3: [[[0, 0.88], [0.1, 1], [0.52, 1], [0.62, 0.88], [0.62, 0.64], [0.5, 0.52], [0.18, 0.52]], [[0.5, 0.52], [0.62, 0.4], [0.62, 0.12], [0.52, 0], [0.1, 0], [0, 0.12]]],
  4: [[[0.46, 0], [0.46, 1], [0, 0.3], [0.64, 0.3]]],
  5: [[[0.62, 1], [0.03, 1], [0, 0.55], [0.44, 0.6], [0.62, 0.46], [0.62, 0.12], [0.5, 0], [0.1, 0], [0, 0.1]]],
};

// ---------------------------------------------------------------------------------------------------------------
// Road markings as polylines (shared by the canvas painter and the crisp near-camera decal meshes in roads.js).
// Returns [{ pts:[[x,z]...], w, color:'white'|'yellow', dash:[on,off]|null, alpha }]
// Clipped to the painted ground (the data bounds, 2 m inset): beyond it the terrain is the procedural skirt and
// lines would float across the fields. Cached on P (the far painter level and roads.js both use it).
// Parking stall lines are not in it (at the far level's ~1.6 m markings texels they vanish, and finding them
// for ~200 lots costs ~50 ms): lotStalls() gives them per lot, when the decals near the camera need them.
function markingAdder(P, out) {
  const B = P.bounds;
  return (pts, w, color, dash = null, alpha = 1) => {
    if (pts.length < 2) return;
    if (!B) { out.push({ pts, w, color, dash, alpha, _bb: bbox(pts, w) }); return; }
    for (const run of clipPolylineToRect(pts, B.minX + 2, B.minZ + 2, B.maxX - 2, B.maxZ - 2)) out.push({ pts: run, w, color, dash, alpha, _bb: bbox(run, w) });
  };
}
export function computeMarkings(P) {
  if (P._markings) return P._markings;
  const out = [];
  const add = markingAdder(P, out);
  for (const r of P.roads) {
    if (!MAJOR.has(r.type) || r._w < 6 || r._brick) continue;
    // split the road into marked pieces between junctions
    const pieces = [];
    let s = 0;
    const J = r._junctions.slice().sort((a, b) => a[0] - b[0]);
    for (const [a, b] of J) {
      if (a > s + 3) pieces.push(slicePolyline(r.points, s, a));
      s = Math.max(s, b);
    }
    if (r._len > s + 3) pieces.push(slicePolyline(r.points, s, r._len));
    const W = r._w;
    const lanes = r.lanes || (W >= 13 ? 4 : 2);
    for (const pts of pieces) {
      if (pts.length < 2) continue;
      if (!r.oneway) {
        for (const d of [-0.13, 0.13]) add(offsetPolyline(pts, d), 0.12, 'yellow'); // double yellow centre line
        const perSide = Math.max(1, Math.floor(lanes / 2));
        const lwid = Math.min(3.5, (W / 2 - 0.4) / perSide);
        for (let j = 1; j < perSide; j++) for (const sgn of [-1, 1]) add(offsetPolyline(pts, sgn * j * lwid), 0.12, 'white', [3, 9]);
      } else {
        const lwid = (W - 0.8) / Math.max(1, lanes);
        for (let j = 1; j < lanes; j++) add(offsetPolyline(pts, -W / 2 + 0.4 + j * lwid), 0.12, 'white', [3, 9]);
        add(offsetPolyline(pts, -W / 2 + 0.45), 0.12, 'yellow');
      }
      // white edge lines on arterials
      if (r.type === 'trunk' || r.type === 'primary' || r.type === 'secondary') {
        for (const sgn of (r.oneway ? [1] : [-1, 1])) add(offsetPolyline(pts, sgn * (W / 2 - 0.45)), 0.12, 'white', null, 0.85);
      }
    }
    // stop bars on the approach to each junction (right-hand traffic → the bar spans the right half)
    if (!r.oneway && r._w >= 8) {
      for (const [a, b] of J) {
        for (const [sBar, dir] of [[a - 0.6, 1], [b + 0.6, -1]]) {
          if (sBar < 1 || sBar > r._len - 1) continue;
          const seg = slicePolyline(r.points, sBar - 0.3, sBar + 0.3);
          if (seg.length < 2) continue;
          const p = seg[0], q = seg[seg.length - 1];
          let tx = q[0] - p[0], tz = q[1] - p[1];
          const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
          const nx = -tz * dir, nz = tx * dir; // right-hand normal of travel towards the junction
          const c = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
          add([[c[0] + nx * 0.2, c[1] + nz * 0.2], [c[0] + nx * (W / 2 - 0.4), c[1] + nz * (W / 2 - 0.4)]], 0.45, 'white', null, 0.9);
        }
      }
    }
  }
  // zebra crosswalks (continental bars): a 3 m wide dashed stroke along the crossing way, clipped to the
  // carriageway (OSM crossing ways often run on from curb to curb onto the sidewalk / verge)
  for (const p of P.paths) {
    if (p._kind !== 'crossing') continue;
    for (const run of clipToCarriageway(p.points, P.carriagewayDist)) add(run, 3.0, 'white', [0.6, 0.6], 0.92);
  }
  fieldMarkings(P, add);
  P._markings = out;
  return out;
}

// Surface car parks that get stall lines: [{ a, frame, _bb }] (entries of P.areas)
export function parkingLots(P) {
  return P.areas.filter(({ a, frame }) => a.type === 'parking' && a.surface !== 'gravel' && frame && frame.width >= 8);
}
// Stall lines of one car park (cached on its entry), clipped to the lot polygon and kept off the service aisles
// painted as roads. Same format as computeMarkings().
export function lotStalls(P, lot) {
  if (lot._stalls) return lot._stalls;
  const out = (lot._stalls = []);
  const add = markingAdder(P, out);
  {
    const { a, frame } = lot;
    const W = frameToWorld(frame), L = frame.length, Wd = frame.width;
    // the lot's rings (exact segment clipping), then off the service aisles painted as roads (sampled, only
    // where the lot has carriageways at all)
    const rings = [a.polygon, ...(a.holes || [])];
    const [bx0, bz0, bx1, bz1] = bbox(a.polygon, 1);
    let roads = false;
    for (let gx = Math.floor(bx0 / 24); gx <= Math.floor(bx1 / 24) && !roads; gx++) {
      for (let gz = Math.floor(bz0 / 24); gz <= Math.floor(bz1 / 24) && !roads; gz++) if (P.carriagewayDist((gx + 0.5) * 24, (gz + 0.5) * 24) < Infinity) roads = true;
    }
    const free = (x, z) => !(P.carriagewayDist(x, z) < 0.2);
    const clip = (p0, p1) => {
      const dx = p1[0] - p0[0], dz = p1[1] - p0[1], L = Math.hypot(dx, dz);
      const at = (t) => [p0[0] + dx * t, p0[1] + dz * t];
      for (const [a0, a1] of segmentInRings(p0, p1, rings)) {
        const q0 = at(a0), q1 = at(a1);
        const parts = roads ? intervalsWhere(q0, q1, free, 0.8).map(([u0, u1]) => [a0 + (a1 - a0) * u0, a0 + (a1 - a0) * u1]) : [[a0, a1]];
        for (const [t0, t1] of parts) if ((t1 - t0) * L > 1.2) add([at(t0), at(t1)], 0.12, 'white', null, 0.75);
      }
    };
    for (let v = -Wd / 2 + STALL.v0; v < Wd / 2 - 4; v += STALL.period) {
      const vEnd = Math.min(v + 2 * STALL.depth, Wd / 2 - 0.5);
      for (let u = -L / 2 + 1.5; u < L / 2 - 1.5; u += STALL.width) clip(W(u, v), W(u, vEnd));
      if (v + STALL.depth < vEnd) clip(W(-L / 2 + 1.5, v + STALL.depth), W(L / 2 - 1.5, v + STALL.depth));
    }
  }
  return out;
}

// Parameter intervals [t0, t1] of the segment p0 → p1 inside a polygon with holes (even–odd over all rings).
function segmentInRings(p0, p1, rings) {
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  const ts = [];
  let inside = false;
  for (const ring of rings) {
    if (pointInRing(p0[0], p0[1], ring)) inside = !inside;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = ring[j][0], az = ring[j][1], ex = ring[i][0] - ax, ez = ring[i][1] - az;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-12) continue;
      const qx = ax - p0[0], qz = az - p0[1];
      const t = (qx * ez - qz * ex) / den, u = (qx * dz - qz * dx) / den;
      if (t > 0 && t < 1 && u >= 0 && u < 1) ts.push(t);
    }
  }
  ts.sort((x, y) => x - y);
  const out = [];
  let t0 = inside ? 0 : -1;
  for (const t of ts) {
    if (t0 >= 0) { out.push([t0, t]); t0 = -1; } else t0 = t;
  }
  if (t0 >= 0) out.push([t0, 1]);
  return out;
}

// Parameter intervals [t0, t1] of the segment p0 → p1 where pred(x, z) holds: sampled every ~step metres, each
// change of state located by bisection to ~1/128 of a step (a few times fewer tests than dense sampling).
function intervalsWhere(p0, p1, pred, step) {
  const dx = p1[0] - p0[0], dz = p1[1] - p0[1];
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / step));
  const at = (t) => pred(p0[0] + dx * t, p0[1] + dz * t);
  const edge = (a, b, va) => { for (let k = 0; k < 7; k++) { const m = (a + b) / 2; if (at(m) === va) a = m; else b = m; } return (a + b) / 2; };
  const out = [];
  let prev = at(0), start = prev ? 0 : -1;
  for (let k = 1; k <= n; k++) {
    const t = k / n, v = at(t);
    if (v !== prev) {
      const e = edge((k - 1) / n, t, prev);
      if (v) start = e; else { out.push([start, e]); start = -1; }
      prev = v;
    }
  }
  if (start >= 0) out.push([start, 1]);
  return out;
}

// Parts of a polyline that lie on a painted road surface (≥ 0.25 m inside the carriageway edge).
function clipToCarriageway(pts, dist) {
  const runs = [];
  if (!dist) return [pts];
  const on = (x, z) => dist(x, z) < -0.25;
  let cur = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    let last = 0;
    for (const [t0, t1] of intervalsWhere(a, b, on, 0.9)) {
      const p = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], q = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      if (cur && t0 === 0 && last === 0) cur.push(q);              // continues the run from the previous segment
      else { if (cur) runs.push(cur); cur = [p, q]; }
      last = t1;
      if (t1 < 1) { runs.push(cur); cur = null; }
    }
    if (last < 1 && cur) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs.filter((r) => r.length > 1 && polyLength(r) > 1.5);
}

// Sports lines in world coordinates: American football (NCAA layout), soccer (FIFA, fitted to the polygon) and
// running-track lanes (offsets of the infield ring) + finish line. Same format as computeMarkings().
function fieldMarkings(P, add) {
  const LINE = 0.1;
  for (const { a, frame } of P.areas) {
    if (a.type === 'pitch' && frame && /^(tennis|pickleball|basketball)$/.test(a.sport || '')) {
      courtLines(a.sport, frame, add);
    } else if (a.type === 'pitch' && frame && (a.sport === 'american_football' || a.sport === 'soccer')) {
      const W = frameToWorld(frame);
      const seg = (u0, v0, u1, v1, w = LINE) => add([W(u0, v0), W(u1, v1)], w, 'white');
      const rect = (u, v, lw, lh, w = LINE) => add([W(u - lw / 2, v - lh / 2), W(u + lw / 2, v - lh / 2), W(u + lw / 2, v + lh / 2), W(u - lw / 2, v + lh / 2), W(u - lw / 2, v - lh / 2)], w, 'white');
      const circle = (u, v, r, w = LINE, a0 = 0, a1 = Math.PI * 2) => {
        const n = Math.max(8, Math.ceil((Math.abs(a1 - a0) * r) / 0.8));
        const pts = [];
        for (let k = 0; k <= n; k++) { const t = a0 + ((a1 - a0) * k) / n; pts.push(W(u + Math.cos(t) * r, v + Math.sin(t) * r)); }
        add(pts, w, 'white');
      };
      const L = frame.length, Wd = frame.width;
      if (a.sport === 'american_football') {
        const yd = L / 120;
        rect(0, 0, L - 0.3, Wd - 0.3, 0.15);                        // sidelines + end lines
        for (let y = 10; y <= 110; y += 5) {                         // goal lines + 5-yard lines
          const u = -L / 2 + y * yd;
          seg(u, -Wd / 2 + 0.25, u, Wd / 2 - 0.25, y === 10 || y === 110 ? 0.2 : LINE);
        }
        const hash = Math.min(6.1, Wd / 2 - 3);                       // college hash marks: 60 ft from each sideline
        for (let y = 11; y < 110; y++) {
          if (y % 5 === 0) continue;
          const u = -L / 2 + y * yd;
          for (const v of [-Wd / 2 + 0.3, hash - 0.3, -hash - 0.3, Wd / 2 - 0.9]) seg(u, v, u, v + 0.6);
        }
        for (const sgn of [-1, 1]) seg(sgn * (L / 2 - 13 * yd), -0.45, sgn * (L / 2 - 13 * yd), 0.45); // PAT marks
        // yard numbers: 6 ft digits, bottoms 7 yd in from each sideline, readable from that sideline
        const H = 1.75, DW = 0.62 * H, GAP = 0.7, bottom = Wd / 2 - 7 * yd;
        for (let y = 20; y <= 100; y += 10) {
          const num = y <= 60 ? y - 10 : 110 - y;
          const uLine = -L / 2 + y * yd;
          for (const sgn of [-1, 1]) {
            [Math.floor(num / 10), num % 10].forEach((dg, k) => {
              const x0 = k === 0 ? -GAP / 2 - DW : GAP / 2;
              for (const stroke of DIGITS[dg]) {
                add(stroke.map(([x, yy]) => W(uLine + sgn * (x0 + x * H), sgn * (bottom - yy * H))), 0.28, 'white');
              }
            });
          }
        }
      } else {
        const hl = L / 2, hw = Wd / 2;
        rect(0, 0, L - 0.4, Wd - 0.4, 0.12);
        seg(0, -hw + 0.2, 0, hw - 0.2, 0.12);
        const cr = Math.min(9.15, Wd * 0.14);
        circle(0, 0, cr);
        circle(0, 0, 0.12, 0.24);
        for (const sgn of [-1, 1]) {
          const pd = Math.min(16.5, L * 0.16), pw = Math.min(40.3, Wd * 0.6);
          const gl = hl - 0.2;
          add([W(sgn * gl, -pw / 2), W(sgn * (gl - pd), -pw / 2), W(sgn * (gl - pd), pw / 2), W(sgn * gl, pw / 2)], LINE, 'white');
          const gd = 5.5, gw = Math.min(18.3, Wd * 0.28);
          add([W(sgn * gl, -gw / 2), W(sgn * (gl - gd), -gw / 2), W(sgn * (gl - gd), gw / 2), W(sgn * gl, gw / 2)], LINE, 'white');
          const spot = sgn * (gl - Math.min(11, pd * 0.66));
          circle(spot, 0, 0.12, 0.24);
          // penalty arc: the part of the 9.15 m circle around the spot outside the penalty area
          const dx = pd - Math.min(11, pd * 0.66);
          if (cr > dx) { const h = Math.acos(dx / cr); circle(spot, 0, cr, LINE, sgn > 0 ? Math.PI - h : -h, sgn > 0 ? Math.PI + h : h); }
          for (const sv of [-1, 1]) circle(sgn * gl, sv * (hw - 0.2), 1, LINE, sgn > 0 ? (sv > 0 ? Math.PI : Math.PI / 2) : (sv > 0 ? -Math.PI / 2 : 0), sgn > 0 ? (sv > 0 ? Math.PI * 1.5 : Math.PI) : (sv > 0 ? 0 : Math.PI / 2));
        }
      }
    } else if (a.type === 'track' && a.holes && a.holes[0] && a.holes[0].length > 8) {
      trackLanes(a, add);
    }
  }
}

// Tennis / pickleball / basketball court lines (same layout the painter fills).
function courtLines(sport, frame, add) {
  const W = frameToWorld(frame), L = frame.length, Wd = frame.width, LW = 0.07;
  const seg = (u0, v0, u1, v1, w = LW, c = 'white') => add([W(u0, v0), W(u1, v1)], w, c);
  const rect = (lw, lh, w = LW) => add([W(-lw / 2, -lh / 2), W(lw / 2, -lh / 2), W(lw / 2, lh / 2), W(-lw / 2, lh / 2), W(-lw / 2, -lh / 2)], w, 'white');
  const arc = (u, r, a0, a1) => {
    const n = Math.max(8, Math.ceil((Math.abs(a1 - a0) * r) / 0.6)), pts = [];
    for (let k = 0; k <= n; k++) { const t = a0 + ((a1 - a0) * k) / n; pts.push(W(u + Math.cos(t) * r, Math.sin(t) * r)); }
    add(pts, LW, 'white');
  };
  if (sport === 'tennis') {
    const cl = Math.min(23.77, L - 1), cw = Math.min(10.97, Wd - 1), sw = cw * 0.75;
    rect(cl, cw, 0.08); rect(cl, sw);
    seg(-6.4, 0, 6.4, 0);
    seg(-6.4, -sw / 2, -6.4, sw / 2); seg(6.4, -sw / 2, 6.4, sw / 2);
    for (const sgn of [-1, 1]) seg(sgn * (cl / 2 - 0.1), 0, sgn * cl / 2, 0); // centre marks
    seg(0, -cw / 2 - 0.9, 0, cw / 2 + 0.9, 0.06, 'dark');                      // net
  } else if (sport === 'pickleball') {
    const cl = Math.min(13.41, L - 0.6), cw = Math.min(6.1, Wd - 0.6);
    rect(cl, cw);
    seg(-2.13, -cw / 2, -2.13, cw / 2); seg(2.13, -cw / 2, 2.13, cw / 2);
    seg(-cl / 2, 0, -2.13, 0); seg(2.13, 0, cl / 2, 0);
    seg(0, -cw / 2 - 0.3, 0, cw / 2 + 0.3, 0.05, 'dark');
  } else {
    const cl = Math.min(28.6, L - 1), cw = Math.min(15.2, Wd - 1);
    rect(cl, cw);
    seg(0, -cw / 2, 0, cw / 2);
    arc(0, 1.8, 0, Math.PI * 2);
    for (const sgn of [-1, 1]) {
      const e = sgn * cl / 2, k = sgn * (cl / 2 - 5.8);
      add([W(e, -2.45), W(k, -2.45), W(k, 2.45), W(e, 2.45)], LW, 'white');   // key
      arc(k, 1.8, sgn > 0 ? Math.PI / 2 : -Math.PI / 2, sgn > 0 ? Math.PI * 1.5 : Math.PI / 2); // free-throw circle
      arc(sgn * (cl / 2 - 1.6), 6.75, sgn > 0 ? Math.PI / 2 + 0.1 : -Math.PI / 2 + 0.1, sgn > 0 ? Math.PI * 1.5 - 0.1 : Math.PI / 2 - 0.1);
    }
  }
}

// Lane lines of a running track: the infield ring offset outwards every 1.22 m, as many lanes as fit.
function trackLanes(a, add) {
  const hole = a.holes[0];
  const closed = hole.concat([hole[0]]);
  const S = resamplePolyline(closed, 1.0);
  S.pop(); // last == first
  // outward = away from the infield: pick the normal side by the ring's signed area
  let A = 0;
  for (let i = 0, j = hole.length - 1; i < hole.length; j = i++) A += hole[j][0] * hole[i][1] - hole[i][0] * hole[j][1];
  const n = S.length;
  const nrm = S.map((p, i) => {
    const q0 = S[(i + n - 1) % n], q1 = S[(i + 1) % n];
    let tx = q1.x - q0.x, tz = q1.z - q0.z;
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    return A > 0 ? [tz, -tx] : [-tz, tx];
  });
  // track width = distance from the infield to the outer edge (min over the ring)
  let minW = Infinity;
  const outer = a.polygon;
  for (let i = 0; i < n; i += 3) {
    const p = S[i];
    let best = Infinity;
    for (let k = 0, j = outer.length - 1; k < outer.length; j = k++) {
      const [ax, az] = outer[j], ex = outer[k][0] - ax, ez = outer[k][1] - az, l2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * ex + (p.z - az) * ez) / l2));
      best = Math.min(best, Math.hypot(p.x - ax - ex * t, p.z - az - ez * t));
    }
    minW = Math.min(minW, best);
  }
  const LANE = 1.22, KERB = 0.3;
  const lanes = Math.max(1, Math.min(9, Math.floor((minW - KERB - 0.15) / LANE)));
  for (let k = 0; k <= lanes; k++) {
    const d = KERB + k * LANE;
    const ring = S.map((p, i) => [p.x + nrm[i][0] * d, p.z + nrm[i][1] * d]);
    ring.push(ring[0]);
    add(ring, 0.08, 'white');
  }
  // Finish line: races run counter-clockwise (seen from above), so on the home straight — taken as the northern
  // straight, where Gesling's grandstand is — runners head west and finish at its west end.
  const straightAt = (i) => {
    const a0 = S[(i + n - 1) % n], a1 = S[i], a2 = S[(i + 1) % n];
    const t0x = a1.x - a0.x, t0z = a1.z - a0.z, t1x = a2.x - a1.x, t1z = a2.z - a1.z;
    return Math.abs(t0x * t1z - t0z * t1x) / ((Math.hypot(t0x, t0z) * Math.hypot(t1x, t1z)) || 1) < 0.01;
  };
  const runs = [];
  let start = -1;
  const first = S.findIndex((_, i) => !straightAt(i));
  if (first >= 0) {
    for (let k = 1; k <= n; k++) {
      const i = (first + k) % n;
      if (straightAt(i)) { if (start < 0) start = i; }
      else if (start >= 0) { runs.push([start, (i + n - 1) % n]); start = -1; }
    }
  }
  const long = runs.filter(([i0, i1]) => ((i1 - i0 + n) % n) > 25);
  if (long.length) {
    const midZ = ([i0, i1]) => (S[i0].z + S[i1].z) / 2;
    const home = long.reduce((b, r) => (midZ(r) < midZ(b) ? r : b));
    const i = S[home[0]].x < S[home[1]].x ? home[0] : home[1];
    const p = S[i];
    add([[p.x + nrm[i][0] * KERB, p.z + nrm[i][1] * KERB], [p.x + nrm[i][0] * (KERB + lanes * LANE), p.z + nrm[i][1] * (KERB + lanes * LANE)]], 0.12, 'white');
  }
}

/**
 * Paint one rectangle of a level into an existing canvas (the near level's wrap-around canvas, terrain.js).
 * g: its 2D context; rect: world rectangle { minX, minZ, w, h }; (cx, cz): the canvas pixel of its top-left
 * corner; ppm: pixels per metre (rect edges must fall on whole pixels). The drawing is clipped to the rectangle.
 * mode: 'color' | 'mask'. Features within a few metres outside are drawn too (clipped), so neighbouring
 * rectangles painted separately join without seams.
 */
export function paintRegion(g, mode, P, rect, cx, cz, ppm, opts = {}) {
  const S = makeSources();
  P = localView(P, rect);
  const w = Math.round(rect.w * ppm), h = Math.round(rect.h * ppm);
  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.beginPath();
  g.rect(cx, cz, w, h);
  g.clip();
  g.setTransform(ppm, 0, 0, ppm, cx - rect.minX * ppm, cz - rect.minZ * ppm);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  paintAll(g, mode, ppm, P, S, { name: opts.name || 'region', markings: false, ...opts, minX: rect.minX, minZ: rect.minZ, w: rect.w, h: rect.h });
  g.restore();
}

// Spatial index over the prepared features (64 m cells), so painting a small region (a near-level tile) only
// visits what lies around it instead of culling every area / way / building of the map (that culling was ~40 % of
// a tile's drawing-call time). Items are registered with a 16 m margin (paintAll draws features within 12 m of the
// rectangle; it still culls the candidates exactly) and returned in their original (painting) order.
const LV_CELL = 64, LV_MARGIN = 16, LV_KEYS = ['areas', 'rails', 'paths', 'roads', 'bRings'];
function buildIndex(P) {
  const cellKey = (i, j) => i * 65536 + j;
  const idx = { always: {}, cells: new Map() };
  const put = (name, k, n) => {
    let c = idx.cells.get(k);
    if (!c) idx.cells.set(k, (c = {}));
    (c[name] || (c[name] = [])).push(n);
  };
  for (const name of LV_KEYS) {
    const list = P[name] || [];
    idx.always[name] = [];
    for (let n = 0; n < list.length; n++) {
      const b = list[n]._bb;
      if (!b) { idx.always[name].push(n); continue; }
      const i0 = Math.floor((b[0] - LV_MARGIN) / LV_CELL), i1 = Math.floor((b[2] + LV_MARGIN) / LV_CELL);
      const j0 = Math.floor((b[1] - LV_MARGIN) / LV_CELL), j1 = Math.floor((b[3] + LV_MARGIN) / LV_CELL);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) { idx.always[name].push(n); continue; } // huge: always a candidate
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) put(name, cellKey(i, j), n);
    }
  }
  const trees = P.trees || [];
  for (let n = 0; n < trees.length; n++) {
    const [x, z] = trees[n];
    const i0 = Math.floor((x - LV_MARGIN) / LV_CELL), i1 = Math.floor((x + LV_MARGIN) / LV_CELL);
    const j0 = Math.floor((z - LV_MARGIN) / LV_CELL), j1 = Math.floor((z + LV_MARGIN) / LV_CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) put('trees', cellKey(i, j), n);
  }
  idx.cellKey = cellKey;
  return idx;
}
const indexes = new WeakMap();
function localView(P, rect) {
  let idx = indexes.get(P);
  if (!idx) { idx = buildIndex(P); indexes.set(P, idx); }
  const i0 = Math.floor(rect.minX / LV_CELL), i1 = Math.floor((rect.minX + rect.w) / LV_CELL);
  const j0 = Math.floor(rect.minZ / LV_CELL), j1 = Math.floor((rect.minZ + rect.h) / LV_CELL);
  if ((i1 - i0 + 1) * (j1 - j0 + 1) > 64) return P; // big region: the plain lists are as fast
  const out = Object.assign({}, P);
  for (const name of [...LV_KEYS, 'trees']) {
    const src = P[name];
    if (!src) continue;
    const seen = new Set(idx.always[name] || []);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const c = idx.cells.get(idx.cellKey(i, j));
      const l = c && c[name];
      if (l) for (const n of l) seen.add(n);
    }
    const ids = [...seen].sort((a, b) => a - b);
    const arr = new Array(ids.length);
    for (let k = 0; k < ids.length; k++) arr[k] = src[ids[k]];
    out[name] = arr;
  }
  return out;
}

/** Road/path preparation without painting (for modules that need the same classification). */
export function prepareGround(ctx) { return prepare(ctx); }

// ---------------------------------------------------------------------------------------------------------------
/**
 * Paint all ground levels.
 * levelDefs: [{ name, minX, minZ, w, h (metres), ppm (pixels per metre), maskScale (mask res / colour res),
 *               markings (true: paint road / field / parking markings into the colour; 'separate': into their own
 *               canvas `marks` (R = white, G = yellow coverage, size × marksScale) so the terrain shader can fade
 *               them out near the camera, where they are decal geometry; false: none),
 *               lite (bool: skip the fine detail passes — for ~1 m/px levels) }]
 * Smaller levels are painted first; a level containing them skips their features and draws them in downscaled.
 * prepared: optional result of an earlier call's `prepared` (re-painting after a WebGL context loss).
 * @returns {{ levels: Array<{name, minX, minZ, w, h, color:HTMLCanvasElement, mask:HTMLCanvasElement, marks?}>, ms:number }}
 */
export function paintGround(ctx, levelDefs, prepared = null) {
  const t0 = performance.now();
  const P = prepared || prepare(ctx);
  const tP = performance.now();
  const S = makeSources();
  const tS = performance.now();
  const out = new Array(levelDefs.length);
  // Smaller (sharper) levels first: a level that contains one of them reuses it (see paintAll → level.inner).
  const order = levelDefs.map((_, i) => i).sort((a, b) => levelDefs[a].w * levelDefs[a].h - levelDefs[b].w * levelDefs[b].h);
  for (const i of order) {
    const L = levelDefs[i];
    const inners = [];
    for (const o of out) {
      if (o && L.reuseInner !== false && o.ppm >= L.ppm && o.minX >= L.minX && o.minZ >= L.minZ &&
          o.minX + o.w <= L.minX + L.w && o.minZ + o.h <= L.minZ + L.h) inners.push(o);
    }
    inners.sort((a, b) => a.ppm - b.ppm); // (drawn in this order: the sharpest wins where inner levels overlap)
    const cw = Math.round(L.w * L.ppm), ch = Math.round(L.h * L.ppm);
    const mw = Math.round(cw * L.maskScale), mh = Math.round(ch * L.maskScale);
    const color = makeCanvas(cw, ch);
    const mask = makeCanvas(mw, mh);
    const marks = L.markings === 'separate' ? makeCanvas(Math.round(cw * (L.marksScale || 1)), Math.round(ch * (L.marksScale || 1))) : null;
    for (const [canvas, mode] of [[color, 'color'], [mask, 'mask'], [marks, 'marks']]) {
      if (!canvas) continue;
      const g = canvas.getContext('2d', { alpha: false });
      const sx = canvas.width / L.w, sz = canvas.height / L.h;
      g.setTransform(sx, 0, 0, sz, -L.minX * sx, -L.minZ * sz);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      paintAll(g, mode, Math.min(sx, sz), P, S, { ...L, inners });
    }
    out[i] = { ...L, color, mask, marks };
  }
  return { levels: out, ms: performance.now() - t0, prepared: P, prepMs: Math.round(tP - t0), sourcesMs: Math.round(tS - tP) };
}
