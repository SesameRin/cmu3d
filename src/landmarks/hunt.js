// Hunt Library (Lawrie & Green with Deeter & Ritchey, 1960–61) — the aluminium box at the south-east corner of the
// Mall, given by Roy A. Hunt of ALCOA and therefore dressed almost entirely in anodised aluminium.
//
// What the model follows (Commons photos 2012–2023, Ralf Brown 2011, Mid-Century Mundane 2014, Esri imagery):
//  · a plain 59 × 34 m box, five floors (a tall entrance floor, three stack floors, the Hunt Institute on top);
//  · deep silver-white fins on a five-foot module wrap the north, east and south faces; between them narrow slots of
//    dark glazing with a spandrel at every slab. The west face is a closed wall of fine vertical ribs;
//  · the fins rise ~1.5 m above the roof and carry a thin cap ring, so the rooftop (a low grey hip behind a dark
//    gutter band) is screened, and sky shows between the fin tops;
//  · the entrance faces the lawn on the north side, west of centre (the OSM entrance path meets the facade there): a
//    thin knife-edged canopy with an inverted-pyramid mesh soffit, carried on one red granite pylon carved with the
//    dedication, and diamond-lattice screens over the doors; low boxwood hedges run along the north and east faces;
//  · since 2009 Color Kinetics LED washes at the foot of the slots light the fins at night, normally a cool blue.
//    Selecting the library at night (or ?huntshow=1) plays a rainbow colour show around the building.
import * as THREE from 'three';
import { footprintFrame } from '../core/placement.js';
import { Bag, makeFrame, orientRing, flatPolygon, groundAlong, wallQuad, orientQuadTo, hipRoof, prng, settleMallEast } from './lib/mallEast-kit.js';
import { getKitMaterials, painters } from './lib/mallEast-materials.js';

const OSM_ID = 'w27574204';
const { canvas, tex, noise } = painters;

const MOD = 1.524;                       // five-foot fin module
const FLOORS = [4.9, 4.1, 4.1, 4.1, 4.1];
const TOPG = FLOORS.reduce((a, b) => a + b, 0);   // 21.3 — top of the glazing / roof slab
const SCREEN = 1.5;                      // fins stand this far above the roof
const FIN_H = TOPG + SCREEN;
const CAP = 0.42;                        // cap ring thickness
const GI = 0.85;                         // glass line set back from the fin fronts
const ALU = '#d9dcdd';                   // clear anodised aluminium (reads silver-white in photos)
const TEX_BAYS = 8;                      // curtain texture width in bays

const CACHE = new WeakMap();
function huntMaterials(ctx) {
  const M = ctx.materials;
  if (CACHE.has(M)) return CACHE.get(M);
  const low = ctx.quality?.level === 'low';
  const aniso = Math.min(8, ctx.renderer?.capabilities?.getMaxAnisotropy?.() ?? 4);
  const std = (o, name) => { const m = new THREE.MeshStandardMaterial(o); m.name = name; return m; };
  const r = prng(1961);

  // ---------------------------------------------------------------- slot glazing (u = bays, v = metres above floor 1)
  const ppm = low ? 18 : 36;
  const H = TOPG + 0.6;
  const W = Math.round(TEX_BAYS * MOD * ppm), Hp = Math.round(H * ppm);
  const cm = canvas(W, Hp), gm = cm.getContext('2d');
  const ce = canvas(W, Hp), ge = ce.getContext('2d');
  const cr = canvas(W, Hp), gr = cr.getContext('2d');
  const Y = (v) => Hp - v * ppm;
  const px = (m) => Math.max(1, m * ppm);
  gm.fillStyle = '#4b5256'; gm.fillRect(0, 0, W, Hp);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, Hp);
  gr.fillStyle = '#9a9a9a'; gr.fillRect(0, 0, W, Hp);
  let y0 = 0;
  for (let f = 0; f < FLOORS.length; f++) {
    const y1 = y0 + FLOORS[f];
    const gBot = f === 0 ? 0.05 : y0 + 0.28, gTop = y1 - 0.72;
    for (let b = 0; b < TEX_BAYS; b++) {
      const x0 = b * MOD * ppm, x1 = (b + 1) * MOD * ppm;
      const top = Y(gTop), h = (gTop - gBot) * ppm;
      // dark glass: sky reflection at the top fading into the dim interior
      const grd = gm.createLinearGradient(x0, top, x0 + (x1 - x0) * 0.5, top + h);
      grd.addColorStop(0, '#8d9aa2'); grd.addColorStop(0.3, '#46525a'); grd.addColorStop(1, '#262c30');
      gm.fillStyle = grd; gm.fillRect(x0, top, x1 - x0, h);
      // interior: ceiling light line, book stacks on the stack floors, reading tables on floor 1
      gm.fillStyle = 'rgba(225,232,236,0.16)'; gm.fillRect(x0, top, x1 - x0, px(0.22));
      if (f >= 1 && f <= 3) {
        for (let s = 0; s < 5; s++) {
          const sx = x0 + (x1 - x0) * (0.12 + 0.17 * s + (r() - 0.5) * 0.05);
          gm.fillStyle = `rgba(${120 + ((r() * 60) | 0)},${90 + ((r() * 40) | 0)},${70 + ((r() * 30) | 0)},0.22)`;
          gm.fillRect(sx, top + h * 0.3, px(0.12), h * 0.62);
        }
      }
      // mullions: bay edges (hidden behind the fins) and a centre bar; transoms (small top / bottom lights)
      gm.fillStyle = '#9aa0a3';
      gm.fillRect(x0, top, px(0.06), h); gm.fillRect(x1 - px(0.06), top, px(0.06), h);
      gm.fillRect((x0 + x1) / 2 - px(0.025), top, px(0.05), h);
      const tr = f === 0 ? [2.75] : [gTop - 0.55, gBot + 0.5];
      for (const t of tr) gm.fillRect(x0, Y(t) - px(0.03), x1 - x0, px(0.06));
      gr.fillStyle = '#262626'; gr.fillRect(x0, top, x1 - x0, h);
      // night: the stacks are lit late; the Hunt Institute floor (5th) mostly dark
      const on = r() < (f === 4 ? 0.22 : f === 0 ? 0.92 : 0.8);
      if (on) {
        const g2 = ge.createLinearGradient(0, top, 0, top + h);
        const k = f === 0 ? 1 : 0.85 + r() * 0.15;
        g2.addColorStop(0, `rgba(255,250,236,${k})`); g2.addColorStop(0.2, `rgba(250,240,215,${0.85 * k})`); g2.addColorStop(1, `rgba(245,225,185,${0.55 * k})`);
        ge.fillStyle = g2; ge.fillRect(x0, top, x1 - x0, h);
        ge.fillStyle = '#000';
        ge.fillRect((x0 + x1) / 2 - px(0.025), top, px(0.05), h);
        for (const t of tr) ge.fillRect(x0, Y(t) - px(0.03), x1 - x0, px(0.06));
        if (f >= 1 && f <= 3) { ge.fillStyle = 'rgba(0,0,0,0.35)'; for (let s = 0; s < 3; s++) ge.fillRect(x0 + (x1 - x0) * (0.2 + s * 0.28), top + h * 0.35, px(0.14), h * 0.6); }
      }
    }
    // spandrel panel straddling the slab (dark grey-blue enamel) with a sill ledge
    if (f < FLOORS.length - 1) {
      gm.fillStyle = '#5d666b'; gm.fillRect(0, Y(y1 + 0.28), W, 1.0 * ppm);
      gm.fillStyle = 'rgba(255,255,255,0.22)'; gm.fillRect(0, Y(y1 + 0.28), W, px(0.04));
      gm.fillStyle = 'rgba(0,0,0,0.25)'; gm.fillRect(0, Y(y1 - 0.72) - px(0.05), W, px(0.05));
    }
    y0 = y1;
  }
  // parapet band above the top floor
  gm.fillStyle = '#3e4447'; gm.fillRect(0, 0, W, Y(TOPG - 0.72));
  noise(gm, W, Hp, r, 0.03, 2);
  const rep = [1 / TEX_BAYS, 1 / H];
  const glass = std({
    map: tex(cm, { repeat: rep, wrapT: false, aniso }), roughnessMap: tex(cr, { repeat: rep, wrapT: false, color: false, aniso }),
    emissiveMap: tex(ce, { repeat: rep, wrapT: false, aniso }), emissive: new THREE.Color('#fff6e4'),
    roughness: 1, metalness: 0.45, envMapIntensity: 1.25,
  }, 'hunt-glass');
  M.registerNightMaterial(glass, 0.55);

  // ---------------------------------------------------------------- fins: brushed panels (uv) + LED wash (uv1)
  // uv: u = metres around the fin profile, v = metres above floor 1 (panel joints at every floor);
  // uv1: u = position around the building (0..1, for the colour shows), v = 0 at the foot .. 1 at the top.
  const cj = canvas(32, 512), gj = cj.getContext('2d');
  gj.fillStyle = ALU; gj.fillRect(0, 0, 32, 512);
  noise(gj, 32, 512, r, 0.025, 1);
  { let yy = 0; for (const fh of FLOORS) { yy += fh; const y = 512 - (yy / FIN_H) * 512; gj.fillStyle = 'rgba(60,64,66,0.55)'; gj.fillRect(0, y, 32, 1.4); gj.fillStyle = 'rgba(255,255,255,0.5)'; gj.fillRect(0, y + 1.4, 32, 1); } }
  const jointMap = tex(cj, { repeat: [1, 1 / FIN_H], wrapT: false, aniso: 4 });
  const led = (paint) => {
    const c = canvas(256, 64), g = c.getContext('2d');
    paint(g, 256, 64);
    const t = tex(c, { wrapT: false, aniso: 1 });
    t.channel = 1;
    return t;
  };
  // vertical profile of the wash: bright at the fixtures, softer mid-height, the tops catch the spill again
  const washStops = [[0, 1], [0.08, 0.92], [0.45, 0.58], [0.85, 0.66], [1, 0.8]];
  const ledBlue = led((g, w, h) => {
    const grd = g.createLinearGradient(0, h, 0, 0);
    for (const [s, k] of washStops) grd.addColorStop(s, `rgb(${Math.round(22 + 95 * k * k * k)},${Math.round(42 + 118 * k * k * k)},${Math.round(255 * (0.5 + 0.5 * k))})`);
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  });
  const ledShow = led((g, w, h) => {
    for (let x = 0; x < w; x++) {
      const hue = ((x / w) * 4) % 1;   // four rainbows around the building
      const grd = g.createLinearGradient(0, h, 0, 0);
      for (const [s, k] of washStops) grd.addColorStop(s, `hsl(${Math.round(hue * 360)},95%,${Math.round(28 + 34 * k)}%)`);
      g.fillStyle = grd; g.fillRect(x, 0, 1, h);
    }
  });
  const fin = std({ color: '#ffffff', map: jointMap, metalness: 0.62, roughness: 0.34, envMapIntensity: 1.25, emissive: new THREE.Color('#ffffff'), emissiveMap: ledBlue }, 'hunt-fin');
  M.registerNightMaterial(fin, 1.15);
  const alu = std({ color: ALU, metalness: 0.65, roughness: 0.32, envMapIntensity: 1.2 }, 'hunt-alu');

  // ---------------------------------------------------------------- west wall: fine vertical ribs (u, v metres)
  const cw = canvas(96, 64), gw = cw.getContext('2d');
  for (let x = 0; x < 96; x++) {
    const ph = (x % 16) / 16;   // 16 px per 0.33 m rib: lit face, crest, shaded face
    const k = ph < 0.45 ? 0.93 + ph * 0.1 : ph < 0.55 ? 1.02 : 0.8 + (1 - ph) * 0.2;
    const c = new THREE.Color(ALU).multiplyScalar(k);
    gw.fillStyle = `#${c.getHexString()}`; gw.fillRect(x, 0, 1, 64);
  }
  noise(gw, 96, 64, r, 0.02, 1);
  const rib = std({ color: '#ffffff', map: tex(cw, { repeat: [1 / 2, 1 / 1.33], aniso }), metalness: 0.55, roughness: 0.4, envMapIntensity: 1.1 }, 'hunt-rib');
  // the end wall catches some of the blue wash from the corner fixtures
  rib.emissive = new THREE.Color('#3552ff');
  M.registerNightMaterial(rib, 0.22);

  // ---------------------------------------------------------------- canopy soffit: woven bronze mesh, glows at night
  const cs = canvas(64, 64), gs = cs.getContext('2d');
  gs.fillStyle = '#6d5a45'; gs.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 4) for (let x = (y / 4) % 2 ? 2 : 0; x < 64; x += 4) { gs.fillStyle = '#a58a66'; gs.fillRect(x, y, 2, 2); }
  const ces = canvas(4, 4), ges = ces.getContext('2d'); ges.fillStyle = '#fff'; ges.fillRect(0, 0, 4, 4);
  const soffit = std({ color: '#ffffff', map: tex(cs, { repeat: [1 / 0.5, 1 / 0.5], aniso }), roughness: 0.55, metalness: 0.5, emissive: new THREE.Color('#ff5a1e'), side: THREE.DoubleSide }, 'hunt-soffit');
  M.registerNightMaterial(soffit, 0.75);

  // red granite pylon (polished) and the carved, gilded dedications
  const pylon = std({ map: M.surfaceTexture('stone', '#8a4c42', 2, 61), roughness: 0.3, metalness: 0.05, envMapIntensity: 1.1 }, 'hunt-pylon');
  const inscription = (key, lines) => {
    const Wc = low ? 256 : 512, Hc = Wc * 1.5;
    const c = canvas(Wc, Hc), g = c.getContext('2d');
    g.fillStyle = '#8a4c42'; g.fillRect(0, 0, Wc, Hc);
    noise(g, Wc, Hc, r, 0.08, 2);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const fs = Wc * 0.11;
    g.font = `500 ${fs}px Georgia, "Times New Roman", serif`;
    lines.forEach((s, i) => {
      const yy = Hc * 0.24 + i * fs * 1.25;
      g.fillStyle = 'rgba(40,15,10,0.6)'; g.fillText(s, Wc / 2 + 1.5, yy + 1.5);
      g.fillStyle = '#d7b46a'; g.fillText(s, Wc / 2, yy);
    });
    return std({ map: tex(c, { wrapT: false, aniso }), roughness: 0.3, metalness: 0.1 }, `hunt-insc-${key}`);
  };
  const inscN = inscription('n', ['THE HUNT', 'LIBRARY', 'GIFT OF', 'MR AND MRS', 'ROY A HUNT', '1960']);
  const inscS = inscription('s', ['THE RACHEL', 'McMASTERS', 'MILLER HUNT', 'BOTANICAL', 'LIBRARY 1960']);

  // diamond-lattice screens over the entrance doors (unit uv per door bay)
  const cd = canvas(64, 128), gd = cd.getContext('2d'), cde = canvas(64, 128), gde = cde.getContext('2d');
  gd.fillStyle = '#39342c'; gd.fillRect(0, 0, 64, 128);
  gd.fillStyle = '#6f7a80'; gd.fillRect(5, 5, 54, 118);
  gde.fillStyle = '#000'; gde.fillRect(0, 0, 64, 128);
  gde.fillStyle = '#ffd89a'; gde.fillRect(5, 5, 54, 118);
  gd.strokeStyle = '#c9a25a'; gd.lineWidth = 2.2; gde.strokeStyle = '#000'; gde.lineWidth = 2.2;
  for (let k = -8; k <= 8; k++) {
    for (const [g] of [[gd], [gde]]) {
      g.beginPath(); g.moveTo(5 + k * 14, 5); g.lineTo(5 + k * 14 + 118 * 0.45, 123); g.stroke();
      g.beginPath(); g.moveTo(59 - k * 14, 5); g.lineTo(59 - k * 14 - 118 * 0.45, 123); g.stroke();
    }
  }
  gd.fillStyle = '#39342c'; gd.fillRect(0, 60, 64, 4); gde.fillStyle = '#000'; gde.fillRect(0, 60, 64, 4);
  const door = std({ map: tex(cd, { wrapT: false, aniso }), emissiveMap: tex(cde, { wrapT: false, aniso }), emissive: new THREE.Color('#ffe3b0'), roughness: 0.35, metalness: 0.5 }, 'hunt-door');
  M.registerNightMaterial(door, 0.9);

  // clipped boxwood
  const ch = canvas(64, 64), gh = ch.getContext('2d');
  gh.fillStyle = '#3d5a2a'; gh.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 700; i++) { gh.fillStyle = r() < 0.5 ? 'rgba(20,40,14,0.5)' : 'rgba(120,160,70,0.35)'; gh.fillRect(r() * 64, r() * 64, 1 + r() * 2, 1 + r() * 2); }
  const hedge = std({ color: '#ffffff', map: tex(ch, { repeat: [1 / 0.8, 1 / 0.8], aniso: 2 }), roughness: 0.95 }, 'hunt-hedge');

  const out = { glass, fin, alu, rib, soffit, pylon, inscN, inscS, door, hedge, ledBlue, ledShow };
  CACHE.set(M, out);
  return out;
}

// ---------------------------------------------------------------- fin geometry with a second uv set (LED wash)
class FinBuilder {
  constructor() { this.p = []; this.n = []; this.u = []; this.u1 = []; }
  quad(A, B, C, D, nrm, uva, uvb, uvc, uvd, w1) {
    // A,B,C,D counter-clockwise seen from the side the normal points to
    for (const [P, T, T1] of [[A, uva, w1[0]], [B, uvb, w1[1]], [C, uvc, w1[2]], [A, uva, w1[0]], [C, uvc, w1[2]], [D, uvd, w1[3]]]) {
      this.p.push(P[0], P[1], P[2]); this.n.push(nrm[0], nrm[1], nrm[2]); this.u.push(T[0], T[1]); this.u1.push(T1[0], T1[1]);
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(this.u1, 2));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

async function buildHunt(ctx) {
  const b = ctx.data.buildings.find((x) => x.osmId === OSM_ID || x.id === OSM_ID);
  if (!b) { console.warn('[hunt] building not in data'); return null; }
  const low = ctx.quality?.level === 'low';
  const K = getKitMaterials(ctx);
  const HM = huntMaterials(ctx);
  const fp = footprintFrame(b.footprint);
  let frame = makeFrame(fp.center, fp.angle);
  // local +z = the entrance side facing the lawn (north)
  if (frame.toLocal(fp.center[0], fp.center[1] - 50)[1] < 0) frame = makeFrame(fp.center, fp.angle + Math.PI);
  const E = frame.toWorld(1, 0)[0] > fp.center[0] ? 1 : -1;   // local +x points east (1) or west (-1)
  const hx = fp.length / 2, hz = fp.width / 2;
  const rect = orientRing([[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]]);
  const g = groundAlong(ctx, frame, orientRing([[-hx - 3, -hz - 3], [hx + 3, -hz - 3], [hx + 3, hz + 9], [-hx - 3, hz + 9]]));
  const F = g.max + 0.1;                 // floor 1 / plaza level
  const yBase = g.min - 1.5;
  const Y_TOPG = F + TOPG, Y_FIN = F + FIN_H, Y_CAP = Y_FIN + CAP;
  const bag = new Bag();
  const xWest = -E * hx;                 // local x of the west face
  const xc = xWest + E * 0.4 * 2 * hx;   // canopy / door centre, 40 % along from the west end

  // ------------------------------------------------ plaza apron (pavers) and the entrance forecourt
  const ap = 1.6;
  const apron = orientRing([[-hx - ap, -hz - ap], [hx + ap, -hz - ap], [hx + ap, hz + ap], [-hx - ap, hz + ap]]);
  for (let i = 0; i < 4; i++) wallQuad(bag, K.granite(), apron[i], apron[(i + 1) % 4], yBase, F - 0.02, 0, 0);
  flatPolygon(bag, K.paver(), apron, F - 0.02, true);
  const fc = orientRing([[xc - 8.5, hz + ap], [xc + 8.5, hz + ap], [xc + 8.5, hz + 9.5], [xc - 8.5, hz + 9.5]]);
  for (let i = 0; i < 4; i++) wallQuad(bag, K.granite(), fc[i], fc[(i + 1) % 4], yBase, F - 0.03, 0, 0);
  flatPolygon(bag, K.paver(), fc, F - 0.03, true);

  // ------------------------------------------------ sides (outer fin line), their fin counts and perimeter positions
  // side order around the building: N (z = +hz), E/W ends, S … perimeter fraction p runs continuously for the shows
  const sides = [
    { a: [-hx, hz], b: [hx, hz], out: [0, 1] }, { a: [hx, hz], b: [hx, -hz], out: [1, 0] },
    { a: [hx, -hz], b: [-hx, -hz], out: [0, -1] }, { a: [-hx, -hz], b: [-hx, hz], out: [-1, 0] },
  ];
  const perim = 4 * (hx + hz);
  let pAcc = 0;
  for (const s of sides) {
    s.L = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]);
    s.t = [(s.b[0] - s.a[0]) / s.L, (s.b[1] - s.a[1]) / s.L];
    s.n = Math.max(2, Math.round(s.L / MOD));
    s.mod = s.L / s.n;
    s.p0 = pAcc; pAcc += s.L;
    s.west = s.out[0] === -E;           // the ribbed end wall
  }

  // ------------------------------------------------ glazing between the fins (glass line), ribbed west wall
  for (const s of sides) {
    const inset = s.west ? 0.2 : GI;
    // along-side extent: from the adjacent sides' wall lines
    const prev = sides[(sides.indexOf(s) + 3) % 4], next = sides[(sides.indexOf(s) + 1) % 4];
    const t0 = prev.west ? 0.2 : GI, t1 = next.west ? 0.2 : GI;
    const P = (t, d) => [s.a[0] + s.t[0] * t - s.out[0] * d, s.a[1] + s.t[1] * t - s.out[1] * d];
    const A = P(t0, inset), B = P(s.L - t1, inset);
    if (s.west) {
      bag.quad(HM.rib, [A[0], F, A[1]], [B[0], F, B[1]], [B[0], Y_FIN, B[1]], [A[0], Y_FIN, A[1]],
        [t0, 0], [s.L - t1, 0], [s.L - t1, FIN_H], [t0, FIN_H]);
      // a dark plinth line where the ribs meet the paving
      wallQuad(bag, K.darkMetal(), [A[0] + s.out[0] * 0.02, A[1] + s.out[1] * 0.02], [B[0] + s.out[0] * 0.02, B[1] + s.out[1] * 0.02], F - 0.05, F + 0.25, 0, 0);
    } else {
      const u0 = (t0 / s.mod) + TEX_BAYS * 8, u1 = ((s.L - t1) / s.mod) + TEX_BAYS * 8;
      bag.quad(HM.glass, [A[0], F, A[1]], [B[0], F, B[1]], [B[0], Y_TOPG + 0.6, B[1]], [A[0], Y_TOPG + 0.6, A[1]],
        [u0, 0], [u1, 0], [u1, TOPG + 0.6], [u0, TOPG + 0.6]);
    }
  }

  // ------------------------------------------------ fins, corner posts (LED-washed aluminium)
  const FB = new FinBuilder();
  const prof = low
    ? [[-0.19, 0], [-0.07, GI], [0.07, GI], [0.19, 0]]
    : [[-0.2, 0], [-0.15, 0.48], [-0.07, GI], [0.07, GI], [0.15, 0.48], [0.2, 0]];
  const yF0 = F, yF1 = Y_FIN;
  const vv = (y) => (y - F) / FIN_H;
  const addFin = (s, t, pFrac) => {
    // base point on the glass line
    const bx = s.a[0] + s.t[0] * t - s.out[0] * GI, bz = s.a[1] + s.t[1] * t - s.out[1] * GI;
    const pts = prof.map(([ta, d]) => [bx + s.t[0] * ta + s.out[0] * d, bz + s.t[1] * ta + s.out[1] * d]);
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i], p1 = pts[i + 1];
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      // outward normal of this face: perpendicular pointing away from the fin centre line
      let nx = p1[1] - p0[1], nz = -(p1[0] - p0[0]);
      const mx = (p0[0] + p1[0]) / 2 - bx, mz = (p0[1] + p1[1]) / 2 - bz;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      const nl = Math.hypot(nx, nz); nx /= nl; nz /= nl;
      const A = [p0[0], yF0, p0[1]], B = [p1[0], yF0, p1[1]], C = [p1[0], yF1, p1[1]], D = [p0[0], yF1, p0[1]];
      // wind so the face points along (nx, nz): (B - A) × up = (-dz, 0, dx)·h
      const w1 = [[pFrac, 0], [pFrac, 0], [pFrac, vv(yF1)], [pFrac, vv(yF1)]];
      if (-(B[2] - A[2]) * nx + (B[0] - A[0]) * nz >= 0) FB.quad(A, B, C, D, [nx, 0, nz], [acc, 0], [acc + L, 0], [acc + L, FIN_H], [acc, FIN_H], w1);
      else FB.quad(B, A, D, C, [nx, 0, nz], [acc + L, 0], [acc, 0], [acc, FIN_H], [acc + L, FIN_H], w1);
      acc += L;
    }
  };
  const addPost = (cx, cz, sx, sz, pFrac) => {
    // square corner post from the glass line corner to the outer corner, 4 faces
    const x0 = cx - sx / 2, x1 = cx + sx / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    const w1 = [[pFrac, 0], [pFrac, 0], [pFrac, 1], [pFrac, 1]];
    const faces = [
      [[x0, z1], [x1, z1], [0, 1]], [[x1, z1], [x1, z0], [1, 0]], [[x1, z0], [x0, z0], [0, -1]], [[x0, z0], [x0, z1], [-1, 0]],
    ];
    for (const [p0, p1, nn] of faces) {
      const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
      FB.quad([p0[0], yF0, p0[1]], [p1[0], yF0, p1[1]], [p1[0], yF1, p1[1]], [p0[0], yF1, p0[1]], [nn[0], 0, nn[1]], [0, 0], [L, 0], [L, FIN_H], [0, FIN_H], w1);
    }
  };
  for (const s of sides) {
    if (s.west) continue;
    for (let k = 1; k < s.n; k++) {
      const t = k * s.mod;
      addFin(s, t, (s.p0 + t) / perim);
    }
  }
  for (const s of sides) {
    const c = s.a;   // each side starts at a corner
    const d = GI + 0.02;
    addPost(c[0] - Math.sign(c[0]) * d / 2, c[1] - Math.sign(c[1]) * d / 2, d, d, s.p0 / perim);
  }
  const finMesh = new THREE.Mesh(FB.geometry(), HM.fin);
  finMesh.name = 'hunt:fins';
  finMesh.castShadow = true; finMesh.receiveShadow = true;

  // ------------------------------------------------ cap ring on the fin tops; parapet, gutter and low hip roof
  const capIn = GI + 0.15;
  for (const s of sides) {
    const o0 = s.a, o1 = s.b;
    const i0 = [o0[0] - Math.sign(o0[0]) * capIn, o0[1] - Math.sign(o0[1]) * capIn], i1 = [o1[0] - Math.sign(o1[0]) * capIn, o1[1] - Math.sign(o1[1]) * capIn];
    // outer fascia, inner face, top, soffit
    orientQuadTo(bag, HM.alu, [o0[0], Y_FIN, o0[1]], [o1[0], Y_FIN, o1[1]], [o1[0], Y_CAP, o1[1]], [o0[0], Y_CAP, o0[1]], null, null, null, null, [s.out[0], 0, s.out[1]]);
    orientQuadTo(bag, HM.alu, [i0[0], Y_FIN, i0[1]], [i1[0], Y_FIN, i1[1]], [i1[0], Y_CAP, i1[1]], [i0[0], Y_CAP, i0[1]], null, null, null, null, [-s.out[0], 0, -s.out[1]]);
    orientQuadTo(bag, HM.alu, [o0[0], Y_CAP, o0[1]], [o1[0], Y_CAP, o1[1]], [i1[0], Y_CAP, i1[1]], [i0[0], Y_CAP, i0[1]], null, null, null, null, [0, 1, 0]);
    orientQuadTo(bag, K.darkMetal(), [o0[0], Y_FIN, o0[1]], [o1[0], Y_FIN, o1[1]], [i1[0], Y_FIN, i1[1]], [i0[0], Y_FIN, i0[1]], null, null, null, null, [0, -1, 0]);
  }
  // roof: parapet on the glass line, dark gutter band, then a shallow grey hip (the crease lines seen from the air)
  // (the west end wall stands 0.2 m inside the fin line; everywhere else the glass line is GI inside)
  const xMin = E === 1 ? -hx + 0.2 : -hx + GI, xMax = E === 1 ? hx - GI : hx - 0.2;
  const zMin = -hz + GI, zMax = hz - GI;
  const gl = orientRing([[xMin, zMin], [xMax, zMin], [xMax, zMax], [xMin, zMax]]);
  flatPolygon(bag, K.darkMetal(), gl, Y_TOPG + 0.12, true);
  const roofRing = orientRing([[xMin + 1, zMin + 1], [xMax - 1, zMin + 1], [xMax - 1, zMax - 1], [xMin + 1, zMax - 1]]);
  hipRoof(bag, K.flatRoof(), roofRing, Y_TOPG + 0.18, { overhang: 0, inset: (zMax - zMin) / 2 - 1.35, pitch: 4 * Math.PI / 180, topMat: K.flatRoof() });
  const yP0 = Y_TOPG + 0.12, yP1 = Y_TOPG + 0.6;
  const parapet = [
    [[xMin, zMax - 0.3], [xMax, zMax - 0.3], [0, 0, -1], [0, 0.3]], [[xMin, zMin + 0.3], [xMax, zMin + 0.3], [0, 0, 1], [0, -0.3]],
    [[xMin + 0.3, zMin], [xMin + 0.3, zMax], [1, 0, 0], [-0.3, 0]], [[xMax - 0.3, zMin], [xMax - 0.3, zMax], [-1, 0, 0], [0.3, 0]],
  ];
  for (const [a, c, nrm, off] of parapet) {
    // inner face towards the roof (the outside is the glazing texture's dark top band) and the coping
    orientQuadTo(bag, K.darkMetal(), [a[0], yP0, a[1]], [c[0], yP0, c[1]], [c[0], yP1, c[1]], [a[0], yP1, a[1]], null, null, null, null, nrm);
    orientQuadTo(bag, K.darkMetal(), [a[0], yP1, a[1]], [c[0], yP1, c[1]], [c[0] + off[0], yP1, c[1] + off[1]], [a[0] + off[0], yP1, a[1] + off[1]], null, null, null, null, [0, 1, 0]);
  }
  // rooftop penthouse (stair / lift overrun with louvres) towards the west end
  if (!low) {
    const px0 = xWest + E * 9;
    bag.box(HM.rib, px0, Y_TOPG + 1.5, -2.5, 8, 2.6, 5.5);
    bag.box(K.darkMetal(), px0, Y_TOPG + 2.85, -2.5, 8.3, 0.12, 5.8);
  }

  // ------------------------------------------------ entrance: doors, canopy, granite pylon
  const zG = hz - GI;
  const nDoor = 6, sN = sides[0];
  const k0 = Math.round((xc - sN.a[0]) / sN.mod - nDoor / 2);
  for (let k = k0; k < k0 + nDoor; k++) {
    const xa = sN.a[0] + k * sN.mod + 0.2, xb = sN.a[0] + (k + 1) * sN.mod - 0.2;
    orientQuadTo(bag, HM.door, [xa, F, zG + 0.03], [xb, F, zG + 0.03], [xb, F + 3.1, zG + 0.03], [xa, F + 3.1, zG + 0.03], [0, 0], [1, 0], [1, 1], [0, 1], [0, 0, 1]);
  }
  // canopy: flat aluminium top with a knife edge, inverted-pyramid soffit converging on the pylon
  const CW = 14, CD = 7.4, yT = F + 3.95, yE = yT - 0.12;
  const cz0 = hz - 0.3, cz1 = hz + CD;
  const zP = hz + 4.1, yApex = F + 3.3;
  const c4 = [[xc - CW / 2, cz0], [xc + CW / 2, cz0], [xc + CW / 2, cz1], [xc - CW / 2, cz1]];
  flatPolygon(bag, HM.alu, c4, yT, true);
  for (let i = 0; i < 4; i++) {
    const a = c4[i], c = c4[(i + 1) % 4];
    const nrm = i === 0 ? [0, 0, -1] : i === 1 ? [1, 0, 0] : i === 2 ? [0, 0, 1] : [-1, 0, 0];
    orientQuadTo(bag, HM.alu, [a[0], yE, a[1]], [c[0], yE, c[1]], [c[0], yT, c[1]], [a[0], yT, a[1]], null, null, null, null, nrm);
    // soffit facet (faces down / out)
    const Ap = [a[0], yE, a[1]], Cp = [c[0], yE, c[1]], P = [xc, yApex, zP];
    const e1 = [Cp[0] - Ap[0], Cp[1] - Ap[1], Cp[2] - Ap[2]], e2 = [P[0] - Ap[0], P[1] - Ap[1], P[2] - Ap[2]];
    const ny = e1[2] * e2[0] - e1[0] * e2[2];
    if (ny < 0) bag.tri(HM.soffit, Ap, Cp, P, [a[0], a[1]], [c[0], c[1]], [xc, zP]);
    else bag.tri(HM.soffit, Ap, P, Cp, [a[0], a[1]], [xc, zP], [c[0], c[1]]);
  }
  // pylon: a flattened hexagon of polished red granite (3.2 × 1.1 m)
  const hexP = [[-1.6, 0], [-1.25, -0.55], [1.25, -0.55], [1.6, 0], [1.25, 0.55], [-1.25, 0.55]].map(([x, z]) => [xc + x, zP + z]);
  for (let i = 0; i < 6; i++) {
    const a = hexP[i], c = hexP[(i + 1) % 6];
    const mx = (a[0] + c[0]) / 2 - xc, mz = (a[1] + c[1]) / 2 - zP;
    orientQuadTo(bag, HM.pylon, [a[0], F - 0.05, a[1]], [c[0], F - 0.05, c[1]], [c[0], yApex + 0.1, c[1]], [a[0], yApex + 0.1, a[1]], null, null, null, null, [mx, 0, mz]);
  }
  for (const [mat, zz, dir] of [[HM.inscN, zP + 0.555, 1], [HM.inscS, zP - 0.555, -1]]) {
    const xa = xc - 0.95 * dir, xb = xc + 0.95 * dir;
    bag.quad(mat, [xa, F + 0.6, zz], [xb, F + 0.6, zz], [xb, F + 3.05, zz], [xa, F + 3.05, zz], [0, 0], [1, 0], [1, 1], [0, 1]);
  }
  // glowing glass strip around the pylon foot
  if (!low) {
    const ringO = hexP.map(([x, z]) => [xc + (x - xc) * 1.22, zP + (z - zP) * 1.55]);
    for (let i = 0; i < 6; i++) {
      const a = hexP[i], c = hexP[(i + 1) % 6], ao = ringO[i], co = ringO[(i + 1) % 6];
      orientQuadTo(bag, K.lamp(), [a[0], F + 0.005, a[1]], [c[0], F + 0.005, c[1]], [co[0], F + 0.005, co[1]], [ao[0], F + 0.005, ao[1]], null, null, null, null, [0, 1, 0]);
    }
    // soffit downlights along the facade (the walkway floods)
    for (let k = -2; k <= 2; k++) bag.box(K.lamp(), xc + k * 2.6, yE - 0.02, hz + 1.2, 0.35, 0.03, 0.35);
  }
  bag.setOptions(K.lamp(), { castShadow: false });
  bag.setOptions(HM.door, { castShadow: false });

  // ------------------------------------------------ boxwood hedges along the north and east faces
  const hedges = [];
  {
    const hz0 = hz + 2.2, hw = 1.1, hh = 1.05;
    const xa = -hx + 1, xb = hx - 1, gap0 = xc - 8.8, gap1 = xc + 8.8;
    for (const [x0, x1] of [[xa, Math.min(gap0, xb)], [Math.max(gap1, xa), xb]]) if (x1 - x0 > 2) hedges.push([(x0 + x1) / 2, hz0 + hw / 2, x1 - x0, hw]);
    const xe = E * (hx + 2.2 + hw / 2);   // east end
    hedges.push([xe, 0, hw, 2 * hz - 6]);
    // split into ~6 m pieces that each sit on the local lawn level
    const pieces = [];
    for (const [cx, cz, sx, sz] of hedges) {
      const along = sx > sz, L = along ? sx : sz, n = Math.max(1, Math.round(L / 6));
      for (let i = 0; i < n; i++) {
        const o = -L / 2 + (i + 0.5) * (L / n);
        const px = along ? cx + o : cx, pz = along ? cz : cz + o;
        const [wx, wz] = frame.toWorld(px, pz);
        const gy = Math.min(F - 0.02, ctx.heightAt(wx, wz));
        const lx = along ? L / n + 0.02 : sx, lz = along ? sz : L / n + 0.02;
        pieces.push([px, pz, lx, lz, gy]);
        bag.box(HM.hedge, px, gy + (hh - 0.4) / 2, pz, lx, hh + 0.4, lz);
        bag.box(HM.hedge, px, gy + hh + 0.06, pz, lx - (along ? 0 : 0.14), 0.14, lz - (along ? 0.14 : 0));
      }
    }
    hedges.length = 0; hedges.push(...pieces);
  }

  const [cx, cz] = frame.toWorld(0, 0);
  const entry = { key: 'hunt', kind: 'landmark', name: 'Hunt Library', nameZh: '亨特图书馆', osmId: OSM_ID, infoKey: OSM_ID, position: [cx, Y_CAP, cz], radius: hx + 3 };
  const group = bag.build('hunt', { share: { ctx, entry, frame, materials: K.shared } });
  group.add(finMesh);
  frame.place(group);

  // ------------------------------------------------ LED shows: cool blue by default; a rainbow chase when the
  // library is selected at night (for a minute) or always with ?huntshow=1
  let always = false;
  try { always = new URLSearchParams(location.search).has('huntshow'); } catch { /* no location */ }
  let showUntil = always ? Infinity : 0, clock = 0;
  const setProgram = (show) => {
    const t = show ? HM.ledShow : HM.ledBlue;
    if (HM.fin.emissiveMap !== t) HM.fin.emissiveMap = t;
  };
  setProgram(always);
  ctx.events?.on?.('select', (e) => {
    if (!e || (e.key !== 'hunt' && e.osmId !== OSM_ID)) return;
    if ((ctx.env?.state?.nightFactor ?? 0) > 0.2) showUntil = Math.max(showUntil, clock + 60);
  });
  ctx.onUpdate((dt) => {
    clock += dt;
    const on = clock < showUntil;
    setProgram(on);
    if (on && (ctx.env?.state?.nightFactor ?? 0) > 0.02) HM.ledShow.offset.x = (HM.ledShow.offset.x - dt * 0.035) % 1;
  }, 20);

  // ------------------------------------------------ colliders / walkables / pick / label
  ctx.colliders.addPolygon(frame.ringToWorld(rect), yBase, Y_CAP, 'hunt');
  {
    const [px, pz] = frame.toWorld(xc, zP);
    ctx.colliders.addBox(px, pz, 1.65, 0.6, frame.rotationY, F - 1, yApex, 'hunt-pylon');
    for (const [hcx, hcz, sx, sz, gy] of hedges) {
      const [wx, wz] = frame.toWorld(hcx, hcz);
      ctx.colliders.addBox(wx, wz, sx / 2, sz / 2, frame.rotationY, gy - 1, gy + 1.1, 'hunt-hedge');
    }
  }
  const walk = new THREE.Mesh(new THREE.BufferGeometry(), K.walkHidden());
  {
    const pts = [];
    const push = (ring, y) => {
      const w = frame.ringToWorld(ring);
      pts.push(w[0][0], y, w[0][1], w[1][0], y, w[1][1], w[2][0], y, w[2][1], w[0][0], y, w[0][1], w[2][0], y, w[2][1], w[3][0], y, w[3][1]);
    };
    push(apron, F - 0.02); push(fc, F - 0.03);
    walk.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    walk.name = 'hunt-walkable';
    walk.updateMatrixWorld(true);
    ctx.walkables.add(walk);
  }
  ctx.pick.add(group, entry);
  ctx.labels.add({ key: 'hunt', text: 'Hunt Library', textZh: '亨特图书馆', kind: 'landmark', priority: 9, position: { x: cx, y: Y_CAP + 7, z: cz } });
  return group;
}

export default [
  {
    key: 'hunt',
    name: 'Hunt Library',
    nameZh: '亨特图书馆',
    osmIds: [OSM_ID],
    async build(ctx) { try { return await buildHunt(ctx); } finally { settleMallEast(ctx, 'hunt'); } },
  },
];
