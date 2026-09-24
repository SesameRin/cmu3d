// Gothic wall helpers shared by the Shady Avenue churches (Calvary, Sacred Heart): walls pierced by lancets with
// deep reveals and hood moulds, bays of grouped lancets, gable outlines, and a traceried great window.
import { holedWall, panel, rectPts, lancetPts, lancetApex, edgeBox } from './kenmawr-kit.js';

// Wall piece with Gothic windows. wins: [{ s0, s1, sill, spring, k, glass:'sg'|'dark', depth, noHood }] (s along E).
// detail 0: flat wall + glass panels in front (distant level); ≥ 1: real openings with deep reveals; 2: + sills and
// hood moulds. opts: { key, trimKey, vRef, seg }
export function gWall(kit, E, outline, wins, detail, { key = 'stone', trimKey = null, vRef = 0, seg } = {}) {
  const sg = seg ?? (detail >= 2 ? 5 : 3);
  if (detail === 0) {
    holedWall(kit, key, E, outline, [], { vRef });
    for (const w of wins) panel(kit, w.glass || 'sg', E, lancetPts(w.s0, w.s1, w.sill, w.spring, { k: w.k ?? 1, seg: 2 }), 0.03, 'metre', vRef);
    return;
  }
  const holes = wins.map((w) => ({
    pts: lancetPts(w.s0, w.s1, w.sill, w.spring, { k: w.k ?? 1, seg: sg }), depth: w.depth ?? 0.45,
    glass: w.glass || 'sg', glassUV: 'metre', vRef, reveal: trimKey || key,
  }));
  holedWall(kit, key, E, outline, holes, { vRef });
  if (detail >= 2) {
    const tk = trimKey || key;
    for (const w of wins) {
      edgeBox(kit, tk, E, (w.s0 + w.s1) / 2, 0.08, w.sill - 0.18, w.sill, w.s1 - w.s0 + 0.3, 0.16, { px: 1, nx: 1, nz: 1, py: 1 }, vRef);
      if (!w.noHood) hood(kit, tk, E, w.s0 - 0.12, w.s1 + 0.12, w.spring, w.k ?? 1);
      if (w.mullions) tracery(kit, tk, E, w, w.mullions);
    }
  }
}

// Hood mould: a projecting band following a pointed arch from s0 to s1 springing at ys.
export function hood(kit, key, E, s0, s1, ys, k) {
  const pts = lancetPts(s0, s1, ys, ys, { k, seg: 4 }).slice(2);
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i], q = pts[i + 1];
    kit.beam(key, E.P3(p[0], p[1], 0.06), E.P3(q[0], q[1], 0.06), 0.12, 0.14, { caps: false });
  }
}

// Simple tracery inside a large pointed window: `n` lights separated by mullions up to the springing line, the
// mullions continuing as pointed sub-arches, and a circle in the head.
export function tracery(kit, key, E, w, n) {
  const d = -(w.depth ?? 0.45) + 0.12, width = w.s1 - w.s0, lw = width / n;
  for (let i = 1; i < n; i++) {
    const s = w.s0 + lw * i;
    edgeBox(kit, key, E, s, d, w.sill, w.spring + lw * 0.5, 0.16, 0.22, { px: 1, nx: 1, nz: 1 });
  }
  // sub-arches over each light
  for (let i = 0; i < n; i++) {
    const a = w.s0 + lw * i, b = a + lw;
    const pts = lancetPts(a, b, w.spring, w.spring, { k: 1, seg: 3 }).slice(2);
    for (let j = 0; j < pts.length - 1; j++) kit.beam(key, E.P3(pts[j][0], pts[j][1], d), E.P3(pts[j + 1][0], pts[j + 1][1], d), 0.2, 0.14, { caps: false });
  }
  // circle in the head
  const top = lancetApex(width, w.spring, w.k ?? 1), cy = (w.spring + lw * 0.9 + top) / 2, r = Math.min(width * 0.28, (top - w.spring - lw * 0.9) * 0.45);
  if (r > 0.3) {
    const c = (w.s0 + w.s1) / 2, seg = 12;
    for (let j = 0; j < seg; j++) {
      const a0 = (j / seg) * Math.PI * 2, a1 = ((j + 1) / seg) * Math.PI * 2;
      kit.beam(key, E.P3(c + Math.cos(a0) * r, cy + Math.sin(a0) * r, d), E.P3(c + Math.cos(a1) * r, cy + Math.sin(a1) * r, d), 0.2, 0.14, { caps: false });
    }
  }
}

// Evenly spaced lancet groups along [a, b]: n bays, each with `per` lancets of width w and gap g.
export function bays(a, b, n, per, w, g, sill, spring, extra = {}) {
  const out = [], bw = (b - a) / n;
  for (let i = 0; i < n; i++) {
    const c = a + bw * (i + 0.5), tot = per * w + (per - 1) * g;
    for (let k = 0; k < per; k++) { const s0 = c - tot / 2 + k * (w + g); out.push({ s0, s1: s0 + w, sill, spring, ...extra }); }
  }
  return out;
}
export const outlineRect = (L, y0, y1) => rectPts(0, L, y0, y1);
// Gable outline: rectangle up to yE then a triangle to the apex yA (edge coordinates 0..L)
export const gableOutline = (L, y0, yE, yA) => [[0, y0], [L, y0], [L, yE], [L / 2, yA], [0, yE]];
