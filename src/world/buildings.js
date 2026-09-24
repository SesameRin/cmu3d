// Generic OSM buildings (≈10 000): CMU campus, Oakland, Shadyside (Walnut Street) and East Liberty (Penn / Highland /
// Centre Avenue). Contract: ARCHITECTURE.md §buildings.
//
// Pipeline per building: infer a style (curated b.style wins) → spec (facade layer, colours, roof, parapet, plinth,
// porches / entrances) → street typology for brick / commercial blocks (rowhouse, mixed-use, 1920s apartments,
// modern infill; see applyTypology) → street frontage analysis (storefronts.js: which walls face a street, shop units,
// businesses from POIs / business-named buildings) → emit into per-chunk buffers carrying a per-vertex tint, ground
// height, texture-array layer and building index → ONE mesh per chunk and level of detail: a single material samples
// the facade and the surface texture arrays (see facades.js). Picking resolves the building index from the hit face;
// highlight is a shader uniform (no geometry rebuild).
// Shop signs (canvas-drawn names), blade signs, cornice brackets, fire escapes and café furniture sample one signage
// atlas (signage.js) and are merged per detail chunk into a 'far' and a 'near' mesh, distance-culled every frame.
// Shopping streets: the Oakland main streets, plus every stretch of a named main street with ≥ 2 businesses within
// 40 m (commercialInfo) — Walnut Street's shops, Penn / Highland / Centre Avenue in East Liberty — while residential
// stretches of the same streets stay residential.
//
// UV note: wall u runs continuously along each straight-ish run of wall (runs break at corners > 28°) and is
// stretched ±15 % so every run holds a whole number of window bays — windows are never cut by a corner.
// v is 0 at the ground floor (groundY) and scaled so the texture's storeys match the building's storey count.
import * as THREE from 'three';
import { buildingLevels, footprintFrame } from '../core/placement.js';
import { pointInRing } from '../core/heightfield.js';
import { GeoBuffer, Emitter, GROUND_BIAS, cleanRing, signedArea, emitWalls, emitCap, emitBox, emitWallQuad, emitRingWall, offsetRing, emitFrameBox } from './building-geometry.js';
import { roofPlanes, envelope, envelopeKinks, limitRise, setRise, emitPitchedRoof, emitFlatRoof, emitRooftopUnits, emitDome, emitDeckBand, mansardFrontPlanes, emitBracketCornice, emitChimney } from './roofs.js';
import { createBuildingMaterials, FACADES, tintFor, NO_TINT } from './facades.js';
import { createStreetIndex, createFootprintIndex, wallRuns, runFrontage, runPoint, runSegs, findBusinesses, nameBusiness, planStorefronts, emitStorefrontRun, emitBay, emitDormer, emitFireEscape, emitCorniceDetail, emitBoard, AtlasBuffer, SHOP_POI, requestStorefrontSigns } from './storefronts.js';
import { createSignage, businessStyle } from './signage.js';

// Two levels of detail, both merged per spatial chunk:
//  * BASE (built for every building at start-up): walls with their facade textures (storefront bands and bay windows
//    included), pitched roof surfaces, flat decks, domes, stair penthouses. Drawn up to quality.drawDistance.
//  * DETAIL: parapet copings and cornices, soffits / fascias / gutters / ridge caps, chimneys, rooftop equipment,
//    porches, entrances, storefront trims + awnings, bracketed cornices, dormers, fire escapes, shop signs. Built at
//    start-up only around the start view (LOD.init); everywhere else lazily — time-sliced, nearest first — once the
//    camera comes within LOD.build, and drawn within LOD.show (its small shadows only within ~420 m).
const CHUNK = 250;
const BASE_CHUNK = 500; // base meshes: one draw per 500 m (their shadows come from the shadow proxies, merged per 500 m
                        // anyway; each chunk draw is CPU time on a slow machine, the extra off-screen triangles are cheap)
const SIGN_FAR = 520;   // fascia signs + awning-free boards visible up to this distance (m) from their 250 m chunk
const DETAIL_NEAR = 250; // blade signs, café furniture

// Hand-checked street buildings (reference photos of South Craig Street, 2024–25). Typology / colour / roof tweaks
// that the generic rules cannot infer from OSM:
//  * 415–425 S Craig (1904 store-and-apartments block on the Forbes corner; OSM splits it in two ways): white-painted
//    brick, three storeys, heavy dentil cornice, black "STARBUCKS COFFEE" boards on both street faces
//  * 207–213 S Craig: brick Victorian rowhouses with slate mansard fronts and gabled dormers, painted eaves; only
//    no. 207 (Crêpes Parisiennes) has a shopfront
//  * 311–315 S Craig ("Craig Square Shops"): red brick, angled two-storey bays, mansard with wall dormers
//  * PNC Bank, 4600 Fifth Ave: 1960s glass pavilion under a deep white fascia slab, pole sign at the corner
const STREET_OVERRIDES = {
  w1306720931: { typo: 'mixed', height: 12.5, levels: 3, painted: '#e0ddd5', bracket: { dentil: true, color: '#8d978f' }, sf: 5 },
  w172661493: { typo: 'mixed', height: 12.5, levels: 3, painted: '#e0ddd5', bracket: { dentil: true, color: '#8d978f' }, sf: 5 },
  w173057615: { typo: 'row', height: 9.6, mansard: true, facade: 'victorian', bracket: { color: '#7a2a22' }, wallColor: '#8f4b3a', sf: 1 },
  w173057616: { typo: 'row', height: 9.6, mansard: true, facade: 'victorian', bracket: { color: '#6e2a22' }, wallColor: '#86473a', noShop: true },
  w173057617: { typo: 'row', height: 9.6, mansard: true, facade: 'victorian', bracket: { color: '#7a2a22' }, wallColor: '#93503c', noShop: true },
  w173057618: { typo: 'row', height: 9.6, mansard: true, facade: 'victorian', bracket: { color: '#7a2a22' }, wallColor: '#8c4d3b', noShop: true },
  w543159680: { typo: 'row', style: 'residential-brick', height: 10.5, mansard: true, bays: 3, facade: 'victorian', wallColor: '#8a4a38', bracket: { color: '#3b3f45' }, shopMode: 'poi' },
  w34264357: { typo: 'pavilion' },
  // Hillel Jewish University Center (Joseph Stern Building, Forbes Ave): modern buff brick, not a rowhouse block
  w172661098: { style: 'modern-brick', wallColor: '#c9a97c' },
};

// ---------------------------------------------------------------- small utils
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function segDist(px, pz, ax, az, bx, bz) {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1e-9;
  let t = ((px - ax) * ex + (pz - az) * ez) / l2; t = clamp(t, 0, 1);
  return Math.hypot(px - ax - ex * t, pz - az - ez * t);
}

// ---------------------------------------------------------------- colours
const COLOR_WORDS = {
  beige: '#d8c8a6', tan: '#c4a27a', brown: '#7b5440', lightyellow: '#e3d7a3', yellow: '#d8c07c', white: '#e6e2d8',
  grey: '#9d9b96', gray: '#9d9b96', lightgrey: '#bdbbb5', lightgray: '#bdbbb5', darkgrey: '#5f5e5b', darkgray: '#5f5e5b',
  red: '#9a4b37', darkred: '#7a3a2c', teal: '#6b8f8b', black: '#3a3a3a', cream: '#e2d6b8', orange: '#c47a4f',
  green: '#6d7d5e', blue: '#6d7f93', silver: '#a9acaf', maroon: '#6e3228', pink: '#c99a8e', sandstone: '#c9b690',
};
// Parse an OSM colour tag into a realistic (desaturated) hex, or null.
function parseColor(s) {
  if (!s) return null;
  const k = String(s).trim().toLowerCase().replace(/[\s_-]/g, '');
  let hex = COLOR_WORDS[k] || null;
  if (!hex && /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(k)) hex = k;
  if (!hex && THREE.Color.NAMES && THREE.Color.NAMES[k] !== undefined) hex = '#' + new THREE.Color(THREE.Color.NAMES[k]).getHexString();
  if (!hex) return null;
  // clamp saturation / lightness in sRGB (THREE.Color's HSL defaults to the linear working space)
  const c = new THREE.Color(hex), hsl = {};
  c.getHSL(hsl, THREE.SRGBColorSpace);
  c.setHSL(hsl.h, Math.min(hsl.s, 0.55), clamp(hsl.l, 0.12, 0.88), THREE.SRGBColorSpace);
  return '#' + c.getHexString();
}

const PAL = {
  buff: ['#d2b886', '#cdb07c', '#d8c192', '#c9aa77', '#dcc69a', '#d0b283'],
  red: ['#8f4d3b', '#84473a', '#95563f', '#7d4535', '#915a47', '#8a5140', '#9a5a44'],
  brown: ['#7b5440', '#6f4a3a', '#86604a', '#65463a'],
  tan: ['#b8916a', '#c49a6c', '#a98463', '#bf9f78'],
  limestone: ['#dcd3c0', '#d4cab5', '#e0d8c6', '#cfc6b1'],
  gothic: ['#a89c86', '#9a8f7b', '#b3a891', '#8f8676', '#9f9480'],
  concrete: ['#bcb7ac', '#b0aba0', '#c4c0b6', '#a9a59c'],
  terracotta: ['#c7764f', '#b86a48', '#c98a60'],
  siding: ['#ebe7de', '#e2d8c0', '#bfc2bd', '#8f9ba4', '#9ca58c', '#d9c68c', '#a65b47', '#6f7e6c', '#c8b89c', '#7d8a96', '#d5cbb5', '#5f6b75'],
  stucco: ['#d8cdb8', '#e2dccd', '#cfc3a8', '#d9c9ae'],
  shingleWall: ['#8a6a4f', '#77716a', '#6e5a48'],
  industrial: ['#a9a8a2', '#8f969c', '#b5aa94', '#9b9d98'],
  // flat roofs, weighted by repetition: mostly gravel ballast / grey-to-black EPDM & bitumen, a few white TPO decks
  flatRoof: ['#cdcbc4', '#b1afa9', '#9f978a', '#9f978a', '#9f978a', '#8d8a84', '#7f7d78', '#7f7d78', '#6c6b67', '#6c6b67', '#56554f'],
  clay: ['#a4553a', '#9b4f36', '#ad6244'],
  slate: ['#3e4249', '#474b52', '#393c42', '#40474a'],
  shingle: ['#4a4a4c', '#5a4d44', '#63605b', '#3f4247', '#6b5a4c', '#4f5a52', '#58524d'],
  metal: ['#8b9197', '#7b8a7d', '#6f7780'],
};

// ---------------------------------------------------------------- style inference
const STYLE_NAMES = new Set(['beaux-arts', 'collegiate-brick', 'modern-brick', 'modern-glass', 'curtain-wall', 'brutalist',
  'limestone-classical', 'gothic-stone', 'residential-brick', 'house', 'parking', 'industrial', 'terracotta-modern',
  // internal extras
  'shed', 'glasshouse', 'commercial', 'tower']);

// Fallback hints for CMU buildings when the curated style is absent (curation data takes precedence).
const CAMPUS_HINTS = [
  [/Hamerschlag Hall|Baker Hall|Porter Hall|Doherty Hall|College of Fine Arts|Margaret Morrison Carnegie Hall|Hamburg Hall/i, 'beaux-arts'],
  [/Mellon Institute/i, 'limestone-classical'],
  [/Gates and Hillman|Collaborative Innovation|Scott Hall|TCS Hall|ANSYS|Tepper School|Tartans Pavilion|Highmark Center|Scaife/i, 'modern-glass'],
  [/Hunt Library/i, 'curtain-wall'],
  [/Wean Hall/i, 'brutalist'],
  [/Cohon|Purnell|Warner Hall|Roberts Engineering|Stever|Resnik|Software Engineering|Information Networking|Hall of the Arts|Morewood E-Tower/i, 'modern-brick'],
  [/Facilities Management/i, 'industrial'],
  [/Parking|Garage/i, 'parking'],
];

// Well-known non-CMU buildings whose style the generic rules get wrong (checked against Wikipedia / Pitt sources:
// Posvar Hall and the Barco Law Building are 1970s Brutalist, David Lawrence Hall a 1968 concrete building).
const NAME_HINTS = [
  [/^(Wesley W\. Posvar Hall|Barco Law Building|David Lawrence Hall)$/i, 'brutalist'],
];

const HOUSE_TYPES = new Set(['house', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'cabin', 'farm']);
const RELIGIOUS = /church|cathedral|chapel|congregation|oratory|synagogue|meeting house|temple|parish|mosque/i;
// Institutional buildings never take the 'commercial' style from their street; they only get a shopfront band when a
// shop POI actually sits at one of their outer walls next to a street (see commercialInfo).
const INSTITUTIONAL = new Set(['university', 'college', 'school', 'kindergarten', 'dormitory', 'library', 'museum', 'church',
  'cathedral', 'chapel', 'religious', 'synagogue', 'mosque', 'temple', 'hospital', 'civic', 'public', 'government', 'fire_station']);
const INSTITUTION_OPERATOR = /universit|college|school|museum|library|institute/i;
const isInstitutional = (b) => INSTITUTIONAL.has(b.type) || ((!b.type || b.type === 'yes') && INSTITUTION_OPERATOR.test(b.operator || ''));

function inferStyle(b, info) {
  if (b.style && STYLE_NAMES.has(b.style)) return b.style;
  const t = b.type || 'yes', name = b.name || '', area = b.area, h = b.height, mat = b.material;
  if (!b.campus) for (const [re, s] of NAME_HINTS) if (re.test(name)) return s;
  if (b.type === 'roof') return 'industrial';
  if (t === 'glasshouse' || t === 'greenhouse' || mat === 'glass') return t === 'glasshouse' || t === 'greenhouse' ? 'glasshouse' : 'curtain-wall';
  if (t === 'parking' || (/garage|parking/i.test(name) && area > 300)) return 'parking';
  if (b.campus) {
    for (const [re, s] of CAMPUS_HINTS) if (re.test(name)) return s;
    if (HOUSE_TYPES.has(t) || ((t === 'residential' || t === 'yes') && area < 260 && h <= 12)) return 'house';
    if (t === 'stadium') return 'brutalist';
    return 'collegiate-brick';
  }
  if (['church', 'cathedral', 'chapel', 'synagogue', 'religious', 'mosque', 'temple'].includes(t) || RELIGIOUS.test(name)) return 'gothic-stone';
  if (t === 'industrial' || t === 'warehouse' || t === 'service') return 'industrial';
  if (mat === 'wood') return area < 40 ? 'shed' : 'house';
  if (info.commercial && !HOUSE_TYPES.has(t)) return 'commercial';
  if (t === 'garage' || t === 'garages' || t === 'shed' || t === 'hut' || (area < 45 && h <= 9)) return 'shed';
  if (HOUSE_TYPES.has(t) || ((t === 'yes' || t === 'residential') && area < 350 && h <= 12)) return 'house';
  if (t === 'retail' || t === 'commercial') return 'commercial';
  if (mat === 'limestone' || mat === 'sandstone' || mat === 'stone') return 'limestone-classical';
  if (mat === 'concrete' || mat === 'cement_block') return h > 25 ? 'tower' : 'brutalist';
  if (t === 'office') return h > 28 ? 'curtain-wall' : 'modern-brick';
  if (t === 'museum') return 'limestone-classical';
  if (['university', 'school', 'college', 'public', 'civic', 'library', 'government', 'hospital'].includes(t)) {
    return hashStr(b.id) % 3 === 0 ? 'limestone-classical' : 'collegiate-brick';
  }
  if (h > 26) return 'tower';
  return 'residential-brick';
}

// ---------------------------------------------------------------- main
export async function createBuildings(ctx) {
  const data = ctx.data;
  const T0 = performance.now();
  const mats = createBuildingMaterials(ctx);
  const lowQ = ctx.quality?.level === 'low';
  const skip = ctx.skipBuildingIds || new Set();
  const outlineById = new Map(data.buildings.map((b) => [b.id, b])); // building:part parentId -> outline

  // ---- commercial context: shop POIs, business-named buildings and the shopping streets (spatial grids: 10 k buildings)
  const shopPois = (data.pois || []).filter((p) => SHOP_POI.has(p.type));
  const GS = 100;
  const gkey = (x, z) => Math.floor(x / GS) + ',' + Math.floor(z / GS);
  function gridOf(items, xy) {
    const g = new Map();
    for (const it of items) { const [x, z] = xy(it); const k = gkey(x, z); let l = g.get(k); if (!l) g.set(k, (l = [])); l.push(it); }
    return g;
  }
  function near(g, x, z, r, fn) { // fn(item) → true stops
    for (let gx = Math.floor((x - r) / GS); gx <= Math.floor((x + r) / GS); gx++) {
      for (let gz = Math.floor((z - r) / GS); gz <= Math.floor((z + r) / GS); gz++) {
        const l = g.get(gx + ',' + gz);
        if (l) for (const it of l) if (fn(it)) return true;
      }
    }
    return false;
  }
  const poiGrid = gridOf(shopPois, (p) => [p.x, p.z]);
  // Shopping streets: the Oakland main streets as a whole, elsewhere (Walnut Street in Shadyside, Penn / Highland /
  // Broad in East Liberty, …) every stretch of a named main street with at least two businesses (shop POIs or
  // business-named buildings) within 40 m — so residential stretches of the same streets stay residential.
  const OAKLAND_SHOP = /^(South Craig Street|North Craig Street|Forbes Avenue|Oakland Avenue|South Bouquet Street|Atwood Street|Murray Avenue)$/;
  const MAIN_ROADS = new Set(['primary', 'secondary', 'tertiary', 'trunk', 'unclassified']);
  const BIZ_TYPES = new Set(['yes', 'retail', 'commercial']);
  const bizNamed = (b) => !b.campus && !b.parentId && BIZ_TYPES.has(b.type || 'yes') && b.area >= 40 && b.area < 8000 && !!nameBusiness(b);
  const bizGrid = gridOf([...shopPois.map((p) => [p.x, p.z]), ...data.buildings.filter(bizNamed).map((b) => b.centroid)], (p) => p);
  const shopSegs = [];
  for (const r of data.roads || []) {
    if (!r.name || r.tunnel) continue;
    const oak = OAKLAND_SHOP.test(r.name);
    if (!oak && !MAIN_ROADS.has(r.type)) continue;
    const half = (r.width || 10) / 2;
    for (let i = 1; i < r.points.length; i++) {
      const [ax, az] = r.points[i - 1], [bx, bz] = r.points[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 40));
      for (let k = 0; k < n; k++) {
        const x0 = ax + ((bx - ax) * k) / n, z0 = az + ((bz - az) * k) / n, x1 = ax + ((bx - ax) * (k + 1)) / n, z1 = az + ((bz - az) * (k + 1)) / n;
        if (!oak) {
          let c = 0;
          near(bizGrid, (x0 + x1) / 2, (z0 + z1) / 2, 70, (p) => segDist(p[0], p[1], x0, z0, x1, z1) < 40 && ++c >= 2);
          if (c < 2) continue;
        }
        shopSegs.push([x0, z0, x1, z1, half]);
      }
    }
  }
  const segGrid = gridOf(shopSegs, (s) => [(s[0] + s[2]) / 2, (s[1] + s[3]) / 2]);
  function commercialInfo(b, ring) {
    // CMU-owned commercial blocks on Craig Street (e.g. 311 S Craig) still get a shopfront where a café sits at the wall
    if (b.campus && !(b.type === 'commercial' || b.type === 'retail')) return { commercial: false, shop: false };
    const edgeDist = (x, z) => { let e = Infinity; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) e = Math.min(e, segDist(x, z, ring[j][0], ring[j][1], ring[i][0], ring[i][1])); return e; };
    if (isInstitutional(b)) {
      // Pitt halls, dorms, schools, churches…: a street frontage alone is not retail, and an interior café / food court
      // (Posvar Hall, Litchfield Towers, the museum and library cafés) is not a storefront. Shopfronts only where a shop
      // POI sits within a few metres of an outer wall close to a street (Sennott Square on Forbes / Oakland Ave, the
      // Amos Hall Starbucks and Nordenberg Hall's PNC on Fifth Ave).
      const shop = near(poiGrid, b.centroid[0], b.centroid[1], 150, (p) => edgeDist(p.x, p.z) < 5 && roadDistance(p.x, p.z, 30) < 30);
      return { commercial: false, shop };
    }
    const poi = near(poiGrid, b.centroid[0], b.centroid[1], 120, (p) => pointInRing(p.x, p.z, ring) || edgeDist(p.x, p.z) < 6);
    let street = false;
    if (b.area >= 60 && b.area < 5000 && b.height < 45) {
      let rad = 0;
      for (const [x, z] of ring) rad = Math.max(rad, Math.hypot(x - b.centroid[0], z - b.centroid[1]));
      street = near(segGrid, b.centroid[0], b.centroid[1], rad + 45, (s) => ring.some(([x, z]) => segDist(x, z, s[0], s[1], s[2], s[3]) < s[4] + 9));
    }
    const typed = b.type === 'retail' || b.type === 'commercial';
    // a building carrying a business name (Walnut Street boutiques, Kelly's / Paris 66 on Highland Avenue, …)
    const named = bizNamed(b);
    if (b.campus) return { commercial: false, shop: poi, poi };
    return { commercial: poi || street || typed || named, shop: poi || street || named || b.type === 'retail', street, poi, typed, named };
  }

  // ---- de-duplicate identical outlines (e.g. a relation with courtyards + a plain way of the same building)
  const all = data.buildings.filter((b) => !b.hidden && !skip.has(b.osmId) && !skip.has(b.id) && b.footprint && b.footprint.length >= 3);
  const dropped = new Set();
  {
    const grid = new Map();
    for (const b of all) {
      const k = `${Math.round(b.centroid[0] / 10)},${Math.round(b.centroid[1] / 10)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(b);
    }
    const outerArea = (b) => Math.abs(signedArea(b.footprint));
    for (const list of grid.values()) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const a = list[i], c = list[j];
        if (a.part || c.part) continue;
        if (Math.hypot(a.centroid[0] - c.centroid[0], a.centroid[1] - c.centroid[1]) > 2) continue;
        const A = outerArea(a), C = outerArea(c);
        if (Math.abs(A - C) / Math.max(A, C) > 0.08) continue;
        // keep the one with courtyards; carry the name over
        const [keep, drop] = (c.holes?.length || 0) > (a.holes?.length || 0) ? [c, a] : [a, c];
        dropped.add(drop.id);
        if (!keep.name && drop.name) keep._nameFrom = drop;
      }
    }
  }
  const src = all.filter((b) => !dropped.has(b.id));

  // ---- street context for storefronts and street-front details
  const street = createStreetIndex(data);
  const fpIndex = createFootprintIndex(src);
  const signage = createSignage(ctx);
  // every shop POI belongs to ONE building: the one containing it, else the one with the nearest wall (< 6 m)
  const poiOwner = new Map();
  const srcGrid = gridOf(src, (b) => b.centroid);
  for (const p of shopPois) {
    if (!p.name) continue;
    let best = null, bestD = 6;
    near(srcGrid, p.x, p.z, 90, (b) => {
      const ring = b.footprint;
      if (Math.abs(b.centroid[0] - p.x) > 90 || Math.abs(b.centroid[1] - p.z) > 90) return false;
      if (pointInRing(p.x, p.z, ring)) { best = b; bestD = -1; return true; }
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const d = segDist(p.x, p.z, ring[j][0], ring[j][1], ring[i][0], ring[i][1]);
        if (d < bestD) { bestD = d; best = b; }
      }
      return false;
    });
    if (best) poiOwner.set(p, best.id);
  }
  const street3d = { storefrontRuns: 0, mansards: 0, bays: 0, fireEscapes: 0, brackets: 0, rowDoors: 0, pavilions: 0, gutters: 0, chimneys: 0, sample: {} };

  // ---- chunked buffers. pass 'base' writes into the 500 m base chunk of the building, pass 'detail' into its 250 m
  // detail chunk (see the LOD note at the top). Detail work is captured per building as a closure (fn) and run later.
  const baseChunks = new Map();   // key -> { key, x0, z0, bufs:{facade, surface}, meshes:[] }
  const detailChunks = new Map(); // key -> { key, x0, z0, items:[{bid, fn}], cursor, done, bufs, far:[], near:[], meshes:[], signFar, signNear }
  let pass = 'base', curBase = null, curDetail = null, curBid = 0, curGround = null;
  // one buffer per chunk for both texture arrays (the building material samples either, see facades.js)
  const bufsOf = (c) => { if (!c.bufs) { const g = new GeoBuffer(4096); c.bufs = { all: g, facade: g, surface: g }; } return c.bufs; };
  function E(slot, tint) {
    const m = bufsOf(pass === 'base' ? curBase : curDetail);
    return new Emitter(m.all, tint || NO_TINT, curBid, slot.code ?? slot.layer, 1 / slot.tileW, 1 / slot.tileH, curGround);
  }
  // street atlas work (signs, blade signs, café furniture, brackets, fire escapes): run once the atlas is packed
  function defer(kind, fn) { curDetail[kind].push(fn); }

  // ---- slots used across styles
  const S = {
    brickPlain: () => mats.surface('brick', 2),
    stonePlain: () => mats.surface('stone', 3),
    concretePlain: () => mats.surface('concrete', 6),
    plasterPlain: () => mats.surface('plain', 4),
    tileRoof: () => mats.surface('tile', 2, { roughness: 0.92 }),
    shingleRoof: () => mats.surface('shingle', 2, { roughness: 0.95 }),
    slateRoof: () => mats.surface('slate', 2, { roughness: 0.78 }),
    seamRoof: () => mats.surface('seam', 4, { roughness: 0.45, metal: 0.5 }),
  };
  // roofing by colour family: slate greys → natural slate, clay reds → tiles, everything else asphalt shingles
  const SLATE = new Set([...PAL.slate, '#474b52', '#3e4249', '#51565c']), CLAY = new Set(PAL.clay);
  const roofFor = (color) => (SLATE.has(color) ? S.slateRoof() : CLAY.has(color) ? S.tileRoof() : S.shingleRoof());
  const plainFor = (kind) => (kind === 'stone' ? S.stonePlain() : kind === 'concrete' || kind === 'panel' ? S.concretePlain() : kind === 'plain' || kind === 'siding' || kind === 'stucco' || kind === 'shingle' ? S.plasterPlain() : S.brickPlain());

  // Build the style spec for one building.
  function makeSpec(style, b, r, geo) {
    const { rect, frame, area } = geo;
    const sp = {
      style, wallSlot: null, wallColor: '#c0c0c0', wallKind: 'brick', plinth: null, shop: false,
      roof: { shape: 'flat' }, parapetH: 0.8, coping: { slot: S.stonePlain(), color: '#d6ceb9' }, cornice: null,
      units: 1, penthouse: false, chimney: false, uniformFloors: true, curtain: false, flatColor: pick(r, PAL.flatRoof),
    };
    const pitchedOK = rect > 0.7 && frame.width < 34 && (b.footprint.length <= 16) && !(b.holes && b.holes.length);
    const tileRoof = (color, pitch, overhang = 0.6) => ({ shape: 'hipped', slot: S.tileRoof(), color, pitch, overhang, maxRise: 7, soffit: '#d9cdb5' });
    switch (style) {
      case 'beaux-arts':
        sp.wallSlot = mats.facade(FACADES.beaux); sp.wallColor = pick(r, PAL.buff);
        sp.plinth = { slot: S.stonePlain(), color: '#a9a59d', h: 0.85 };
        sp.cornice = { slot: S.stonePlain(), color: '#bf9670', out: 0.55, h: 0.75 };
        sp.parapetH = 0.9;
        if (pitchedOK && area < 6000) sp.roof = tileRoof(pick(r, PAL.clay), 20 + r() * 4, 0.9);
        break;
      case 'collegiate-brick':
        sp.wallSlot = mats.facade(FACADES.collegiate); sp.wallColor = pick(r, PAL.buff);
        sp.plinth = { slot: S.stonePlain(), color: '#d5ccb8', h: 0.85 };
        if (r() < 0.6) sp.cornice = { slot: S.stonePlain(), color: '#d9d0bd', out: 0.3, h: 0.45 };
        sp.penthouse = true;
        break;
      case 'modern-brick':
        sp.wallSlot = mats.facade(FACADES.modernBrick); sp.wallColor = pick(r, r() < 0.8 ? PAL.buff : PAL.tan);
        sp.plinth = { slot: S.concretePlain(), color: '#a8a49c', h: 0.6 };
        sp.parapetH = 0.7; sp.coping = { slot: mats.trim(), color: '#8e949a' };
        sp.penthouse = true;
        break;
      case 'modern-glass':
        sp.wallSlot = mats.facade(r() < 0.6 ? FACADES.curtainBlue : FACADES.curtainGreen); sp.curtain = true;
        sp.wallKind = 'concrete'; sp.wallColor = '#b9b6ae';
        sp.plinth = { slot: S.concretePlain(), color: '#8f8c86', h: 0.45 };
        sp.parapetH = 0.6; sp.coping = { slot: mats.trim(), color: '#9aa1a7' };
        break;
      case 'curtain-wall':
        sp.wallSlot = mats.facade(FACADES.curtainDark); sp.curtain = true;
        sp.wallKind = 'concrete'; sp.wallColor = '#9a9892';
        sp.parapetH = 0.6; sp.coping = { slot: mats.trim(), color: '#6d7378' };
        break;
      case 'brutalist':
        sp.wallSlot = mats.facade(FACADES.brutalist); sp.wallKind = 'concrete'; sp.wallColor = pick(r, PAL.concrete);
        sp.parapetH = 1.0; sp.coping = { slot: S.concretePlain(), color: '#b3aea4' };
        sp.penthouse = true;
        break;
      case 'limestone-classical':
        sp.wallSlot = mats.facade(FACADES.limestone); sp.wallKind = 'stone'; sp.wallColor = pick(r, PAL.limestone);
        sp.plinth = { slot: S.stonePlain(), color: '#9f9b94', h: 0.9 };
        sp.cornice = { slot: S.stonePlain(), color: '#d5ccb8', out: 0.6, h: 0.8 };
        sp.parapetH = 1.0; sp.coping = { slot: S.stonePlain(), color: '#d8d0bf' };
        break;
      case 'gothic-stone':
        sp.wallSlot = mats.facade(FACADES.gothic); sp.wallKind = 'stone'; sp.wallColor = pick(r, PAL.gothic);
        sp.plinth = { slot: S.stonePlain(), color: '#7f786d', h: 1.0 };
        sp.parapetH = 1.1; sp.coping = { slot: S.stonePlain(), color: '#b2a892' };
        if (rect > 0.68 && frame.width < 40 && !(b.holes && b.holes.length)) sp.roof = { shape: 'gabled', slot: S.slateRoof(), color: pick(r, PAL.slate), pitch: 46, overhang: 0.35, maxRise: 13, soffit: '#6b6358' };
        sp.units = 0;
        break;
      case 'tower':
        sp.wallSlot = mats.facade(r() < 0.6 ? FACADES.tower : FACADES.residentialTrim);
        sp.wallColor = pick(r, r() < 0.5 ? PAL.buff : r() < 0.6 ? PAL.red : PAL.tan);
        sp.plinth = { slot: S.concretePlain(), color: '#9d988e', h: 0.8 };
        sp.parapetH = 0.9; sp.coping = { slot: S.concretePlain(), color: '#c9c3b6' };
        sp.penthouse = true;
        break;
      case 'commercial':
      case 'residential-brick': {
        const facade = style === 'commercial' ? (r() < 0.5 ? FACADES.residential : FACADES.residentialTrim) : (r() < 0.55 ? FACADES.residential : FACADES.residentialTrim);
        sp.wallSlot = mats.facade(facade);
        const pr = r();
        sp.wallColor = pick(r, pr < 0.5 ? PAL.red : pr < 0.72 ? PAL.brown : pr < 0.9 ? PAL.buff : PAL.tan);
        if (r() < 0.6) sp.plinth = { slot: S.stonePlain(), color: '#8e877c', h: 0.7 };
        if (r() < 0.65) sp.cornice = r() < 0.5 ? { slot: mats.trim(), color: '#3d3a36', out: 0.45, h: 0.6 } : { slot: S.stonePlain(), color: '#d8d0c0', out: 0.4, h: 0.5 };
        sp.parapetH = 0.7;
        sp.units = 0.9;
        break;
      }
      case 'industrial':
        sp.wallSlot = mats.facade(FACADES.industrial); sp.wallKind = 'panel'; sp.wallColor = pick(r, PAL.industrial);
        sp.parapetH = 0.5; sp.coping = { slot: mats.trim(), color: '#7d8388' };
        sp.units = 1.6;
        break;
      case 'terracotta-modern':
        sp.wallSlot = mats.facade(FACADES.terracotta); sp.wallKind = 'panel'; sp.wallColor = pick(r, PAL.terracotta);
        sp.plinth = { slot: S.concretePlain(), color: '#8f8c86', h: 0.5 };
        sp.parapetH = 0.6; sp.coping = { slot: mats.trim(), color: '#7d8388' };
        break;
      case 'parking':
        sp.wallSlot = mats.parking(); sp.wallKind = 'concrete'; sp.wallColor = pick(r, PAL.concrete);
        sp.parapetH = 1.1; sp.coping = { slot: S.concretePlain(), color: '#b8b3a8' };
        sp.flatColor = '#5d5d5b'; sp.units = 0;
        break;
      case 'glasshouse':
        sp.wallSlot = mats.facade(FACADES.glasshouse); sp.curtain = true; sp.wallKind = 'concrete'; sp.wallColor = '#e8e8e4';
        sp.parapetH = 0; sp.units = 0;
        if (rect > 0.72) sp.roof = { shape: 'round', slot: sp.wallSlot, color: null, pitch: 28, overhang: 0.1, maxRise: 7, soffit: '#e8e8e4', glass: true };
        break;
      case 'shed': {
        const kind = r() < 0.55 ? 'siding' : 'brick';
        sp.wallSlot = mats.house(kind, 0, false); sp.wallKind = kind; sp.uniformFloors = false;
        sp.wallColor = kind === 'brick' ? pick(r, PAL.red) : pick(r, PAL.siding);
        sp.parapetH = 0.25; sp.coping = { slot: mats.trim(), color: '#6f6d68' }; sp.units = 0;
        if (rect > 0.75 && r() < 0.45) sp.roof = { shape: r() < 0.6 ? 'gabled' : 'skillion', slot: S.shingleRoof(), color: pick(r, PAL.shingle), pitch: 18, overhang: 0.25, maxRise: 2.2, soffit: '#dcd8cf' };
        break;
      }
      case 'house':
      default: {
        const kr = r();
        const kind = b.material === 'brick' ? 'brick' : b.material === 'wood' ? 'siding' : kr < 0.42 ? 'siding' : kr < 0.8 ? 'brick' : kr < 0.92 ? 'stucco' : 'shingle';
        sp.wallSlot = mats.house(kind, Math.floor(r() * 3), true); sp.wallKind = kind; sp.uniformFloors = false;
        sp.wallColor = kind === 'brick' ? pick(r, r() < 0.75 ? PAL.red : PAL.brown) : kind === 'stucco' ? pick(r, PAL.stucco) : kind === 'shingle' ? pick(r, PAL.shingleWall) : pick(r, PAL.siding);
        sp.plinth = { slot: S.stonePlain(), color: '#8a8175', h: 0.6 };
        sp.units = 0; sp.parapetH = 0.45; sp.coping = { slot: mats.trim(), color: '#e8e4dc' };
        const pitchable = rect > 0.62 && b.footprint.length <= 18 && !(b.holes && b.holes.length) && frame.width < 22;
        if (pitchable) {
          const rr = r();
          const squarish = frame.length / Math.max(frame.width, 1) < 1.25;
          const shape = squarish && rr < 0.25 ? 'pyramidal' : rr < 0.62 ? 'gabled' : 'hipped';
          const pr = r();
          const color = pr < 0.35 ? pick(r, PAL.slate) : pr < 0.95 ? pick(r, PAL.shingle) : pick(r, PAL.clay);
          sp.roof = { shape, slot: roofFor(color), color, pitch: shape === 'gabled' ? 36 + r() * 10 : 28 + r() * 8, overhang: 0.45, maxRise: 6.5, soffit: '#e6e2d8' };
          sp.chimney = r() < 0.6;
        }
        break;
      }
    }
    return sp;
  }

  // Apply OSM / curated overrides to a spec.
  function applyOverrides(sp, b, r, geo) {
    const wc = parseColor(b.facade?.wallColor) || parseColor(b.color);
    if (wc) sp.wallColor = wc;
    // curated facade options go straight into ctx.materials.facade (parking decks and houses keep their
    // dedicated painters, which read better than a window grid; their wallColor is still honoured)
    if (b.facade && typeof b.facade === 'object' && sp.style !== 'parking' && sp.style !== 'house' && sp.style !== 'shed') {
      const { wallColor, ...rest } = b.facade;
      sp.wallSlot = mats.facade({ ...FACADES.collegiate, ...rest });
      sp.curtain = rest.style === 'curtain';
      if (rest.wall) sp.wallKind = rest.wall;
    }
    // material tag nudges the wall surface
    if (!b.style && !b.facade) {
      if ((b.material === 'sandstone' || b.material === 'limestone') && !['limestone-classical', 'gothic-stone'].includes(sp.style)) {
        sp.wallSlot = mats.facade(FACADES.limestone); sp.wallKind = 'stone';
        if (!wc) sp.wallColor = b.material === 'sandstone' ? '#c9b690' : pick(r, PAL.limestone);
      }
    }
    // roof shape: curated roof{} > OSM roof:shape > style default
    const shape = b.roof?.shape || b.roofShape;
    const map = { quadruple_saltbox: 'mansard', double_saltbox: 'gambrel', saltbox: 'gabled', half_hipped: 'hipped', side_hipped: 'hipped', onion: 'dome', cone: 'pyramidal', gabled_row: 'gabled', crosspitched: 'hipped' };
    const s = map[shape] || shape;
    const irregular = geo.rect < 0.45 || (b.holes && b.holes.length);
    if (s && s !== sp.roof.shape) {
      if (s === 'flat' || irregular) sp.roof = { shape: 'flat' };
      else if (['gabled', 'hipped', 'pyramidal', 'skillion', 'mansard', 'gambrel', 'round', 'dome'].includes(s)) {
        const classical = ['beaux-arts', 'limestone-classical'].includes(sp.style);
        const color = sp.roof.color || (classical ? pick(r, PAL.clay) : sp.style === 'gothic-stone' ? pick(r, PAL.slate) : pick(r, r() < 0.5 ? PAL.slate : PAL.shingle));
        sp.roof = {
          shape: s, slot: s === 'dome' ? mats.copper() : roofFor(color), color: s === 'dome' ? null : color,
          pitch: s === 'skillion' ? 12 : s === 'gabled' ? 38 : s === 'pyramidal' ? 35 : 26,
          overhang: geo.area > 600 ? 0.6 : 0.4, maxRise: clamp(Math.sqrt(geo.area) * 0.3, 2.5, 9), soffit: '#d9d3c6',
        };
      }
    }
    if (b.roof?.material) {
      const m = b.roof.material;
      if (m === 'copperRoof') { sp.roof.slot = mats.copper(); sp.roof.color = null; }
      else if (m === 'metalRoof' || m === 'zinc') { sp.roof.slot = S.seamRoof(); sp.roof.color = sp.roof.color || pick(r, PAL.metal); }
      else if (m === 'tileRoof') { sp.roof.slot = S.tileRoof(); sp.roof.color = pick(r, PAL.clay); }
      else if (m === 'slateRoof') { sp.roof.slot = S.slateRoof(); sp.roof.color = pick(r, PAL.slate); }
    }
    if (b.roof?.height > 0 && sp.roof.shape !== 'flat') sp.roof.rise = +b.roof.height;
    const rc = parseColor(b.roof?.color) || parseColor(b.roofColor);
    if (rc) { if (sp.roof.shape === 'flat') sp.flatColor = rc; else if (sp.roof.slot?.key !== 'roof:copper') { sp.roof.color = rc; if (!b.roof?.material && sp.roof.slot?.key?.startsWith('surf:')) sp.roof.slot = roofFor(rc); } }
    return sp;
  }

  // Oakland / Shadyside street typologies for the generic brick / commercial blocks (deterministic per building,
  // own random stream so the rest of the building's picks don't change):
  //   row   – Victorian / Italianate brick rowhouse: tall sashes under stone lintels or brick arches, bracketed
  //           wooden cornice on the street front, sometimes a slate mansard front with dormers or angled bays
  //   mixed – main-street commercial block: storefronts + upper-floor sashes with keystoned lintels, bracketed or
  //           dentilled cornice, sometimes painted brick; fire escapes on some taller ones
  //   apt   – 1920s apartment block: paired sashes, stone belt courses, stone cornice + parapet, fire escapes
  //   infill– modern infill: fibre-cement panels or stucco, wide windows, thin metal coping
  const CORNICE_PAINT = ['#3a3533', '#5b2b22', '#e6e0d2', '#2f3b2f', '#6b4a2e', '#7a2a22', '#3b3f45', '#d8cfb8'];
  const PAINTED_BRICK = ['#e2ded5', '#d8d3c7', '#cfcac0', '#e6dcc3', '#bfc3c0', '#d9c9b0'];
  function applyTypology(sp, b, geo, ci, ov) {
    if (sp.style !== 'residential-brick' && sp.style !== 'commercial') return sp;
    if (b.campus && !ov?.typo) return sp;
    if (isInstitutional(b) && !ov?.typo) {
      // Pitt halls / dorms / churches styled as brick: only the 1920s apartment-block treatment fits them
      if (b.height < 9 || geo.area < 300) return sp;
      ov = { typo: 'apt' };
    }
    const r3 = rng(hashStr(b.id) ^ 0x2c1b3c6d);
    const area = geo.area, h = b.height;
    const small = area < 320 && h <= 13.5;
    let typo = ov?.typo;
    if (ov && !ov.typo) ov = null;
    // East Liberty's big blocks are the 2000s–2010s redevelopment (Eastside, the Penn / Centre Avenue mixed-use
    // apartments, big-box retail): modern panel / stucco infill rather than Victorian commercial blocks
    const eastLiberty = b.centroid[0] > 1250 && b.centroid[0] < 2150 && b.centroid[1] > -2250 && b.centroid[1] < -1550;
    if (!typo && eastLiberty && area > 1800 && !b.style) typo = 'infill';
    if (!typo) {
      if (sp.style === 'commercial' || ci.shop) typo = small && r3() < 0.3 ? 'row' : 'mixed';
      else if (small) typo = r3() < 0.82 ? 'row' : 'infill';
      else if (h >= 9) typo = r3() < 0.8 ? 'apt' : 'infill';
      else typo = r3() < 0.7 ? 'row' : 'infill';
    }
    sp.typo = typo;
    const paint = pick(r3, CORNICE_PAINT);
    if (typo === 'row') {
      sp.wallSlot = mats.facade(ov?.facade ? FACADES[ov.facade] : r3() < 0.6 ? FACADES.victorian : FACADES.victorianArch);
      sp.cornice = null; sp.bracket = { color: paint, dentil: false }; sp.parapetH = 0.55; sp.units = 0.25;
      sp.mansard = r3() < 0.38; sp.bays = r3() < 0.35 ? 1 : 0; sp.chimneys = true;
      if (r3() < 0.1) sp.wallColor = pick(r3, PAINTED_BRICK);
    } else if (typo === 'mixed') {
      sp.wallSlot = mats.facade(FACADES.mixedUse);
      sp.cornice = null; sp.bracket = { color: paint, dentil: r3() < 0.4 }; sp.parapetH = 0.75; sp.units = 0.9;
      sp.fireEscape = r3() < 0.3; sp.chimneys = true;
      if (r3() < 0.22) sp.wallColor = pick(r3, PAINTED_BRICK);
    } else if (typo === 'apt') {
      sp.wallSlot = mats.facade(FACADES.apartment20s);
      const pr = r3();
      sp.wallColor = pick(r3, pr < 0.4 ? PAL.buff : pr < 0.8 ? PAL.red : PAL.brown);
      sp.plinth = { slot: S.stonePlain(), color: '#b3ab9b', h: 1.0 };
      sp.cornice = { slot: S.stonePlain(), color: '#d8d0bf', out: 0.4, h: 0.6 };
      sp.parapetH = 1.0; sp.coping = { slot: S.stonePlain(), color: '#d6cebd' }; sp.units = 0.7;
      sp.fireEscape = r3() < 0.45;
    } else if (typo === 'infill') {
      const panel = r3() < 0.6;
      sp.wallSlot = mats.facade(panel ? FACADES.infillPanel : FACADES.infillStucco);
      sp.wallKind = panel ? 'panel' : 'plain';
      sp.wallColor = pick(r3, panel ? ['#6e7277', '#8d8f8c', '#4f5357', '#9aa39b', '#7c6a5a', '#b7a58c'] : ['#d8d2c4', '#c9c4ba', '#e2dccd', '#b9b3a7']);
      sp.plinth = { slot: S.concretePlain(), color: '#8f8c86', h: 0.5 };
      sp.cornice = null; sp.parapetH = 0.5; sp.coping = { slot: mats.trim(), color: '#5d6166' }; sp.units = 0.8;
    }
    if (ov) {
      if (ov.painted) sp.wallColor = ov.painted;
      if (ov.wallColor) sp.wallColor = ov.wallColor;
      if (ov.bracket) sp.bracket = { ...sp.bracket, ...ov.bracket };
      if (ov.mansard != null) sp.mansard = ov.mansard;
      if (ov.bays != null) sp.bays = ov.bays;
      if (ov.facade) sp.wallSlot = mats.facade(FACADES[ov.facade]);
    }
    return sp;
  }

  // ---- street grid (to turn house porches towards the street)
  const STREET_TYPES = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'trunk',
    'primary_link', 'secondary_link', 'tertiary_link']);
  const RG = 40, roadGrid = new Map();
  for (const rd of data.roads || []) {
    if (!STREET_TYPES.has(rd.type) || rd.tunnel) continue;
    for (let i = 1; i < rd.points.length; i++) {
      const [ax, az] = rd.points[i - 1], [bx, bz] = rd.points[i];
      const seg = [ax, az, bx, bz];
      for (let gx = Math.floor(Math.min(ax, bx) / RG); gx <= Math.floor(Math.max(ax, bx) / RG); gx++) {
        for (let gz = Math.floor(Math.min(az, bz) / RG); gz <= Math.floor(Math.max(az, bz) / RG); gz++) {
          const k = gx + ',' + gz;
          if (!roadGrid.has(k)) roadGrid.set(k, []);
          roadGrid.get(k).push(seg);
        }
      }
    }
  }
  function roadDistance(x, z, maxD = 60) {
    let best = maxD;
    for (let gx = Math.floor((x - maxD) / RG); gx <= Math.floor((x + maxD) / RG); gx++) {
      for (let gz = Math.floor((z - maxD) / RG); gz <= Math.floor((z + maxD) / RG); gz++) {
        const list = roadGrid.get(gx + ',' + gz);
        if (list) for (const sg of list) { const d = segDist(x, z, sg[0], sg[1], sg[2], sg[3]); if (d < best) best = d; }
      }
    }
    return best;
  }

  // Outer-ring edges with direction, outward normal and midpoint.
  function ringEdges(ring) {
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const dx = c[0] - a[0], dz = c[1] - a[1], len = Math.hypot(dx, dz);
      if (len < 0.5) continue;
      out.push({ a, len, tx: dx / len, tz: dz / len, nx: dz / len, nz: -dx / len, mx: (a[0] + c[0]) / 2, mz: (a[1] + c[1]) / 2 });
    }
    return out;
  }

  // Entrance doors for campus / institutional / apartment buildings: a stone or metal surround with glazed double
  // doors on the longest facade (and the longest opposite facade), set at the terrain height outside.
  function addEntrances(ring, sp, groundY, roofY, baseY, r) {
    const edges = ringEdges(ring).sort((p, q) => q.len - p.len);
    if (!edges.length || edges[0].len < 8) return;
    const chosen = [edges[0]];
    const opp = edges.find((e) => e.len >= 10 && e.nx * edges[0].nx + e.nz * edges[0].nz < -0.3);
    if (opp) chosen.push(opp);
    const modern = ['modern-glass', 'curtain-wall', 'modern-brick', 'brutalist', 'terracotta-modern', 'industrial', 'tower'].includes(sp.style);
    const surround = modern ? { slot: mats.trim(), tint: tintFor('#3d4145') } : { slot: S.stonePlain(), tint: tintFor(sp.style === 'gothic-stone' ? '#9a907e' : '#d9d1c0') };
    const doorSlot = mats.door();
    for (const e of chosen) {
      const t = 0.5 + (r() - 0.5) * 0.3;
      const px = e.a[0] + e.tx * e.len * t, pz = e.a[1] + e.tz * e.len * t;
      const ty = ctx.heightAt(px + e.nx * 1.5, pz + e.nz * 1.5);
      const doorY = Math.max(ty - 0.05, baseY + 0.2);
      if (doorY > roofY - 4.5) continue;
      const ang = Math.atan2(e.tz, e.tx);
      emitBox(E(surround.slot, surround.tint), E(surround.slot, surround.tint), px + e.nx * 0.2, pz + e.nz * 0.2, 1.75, 0.2, ang, doorY - 0.4, doorY + 3.6);
      emitWallQuad(E(doorSlot, NO_TINT), px + e.nx * 0.45, pz + e.nz * 0.45, e.tx, e.tz, e.nx, e.nz, 2.4, doorY, doorY + 2.85);
      if (modern) emitBox(E(mats.trim(), tintFor('#2f3336')), E(mats.trim(), tintFor('#2f3336')), px + e.nx * 1.1, pz + e.nz * 1.1, 2.3, 1.0, ang, doorY + 3.35, doorY + 3.55);
    }
  }

  // House front porch facing the street: deck, posts, rails, shed roof, steps and a panelled front door.
  function addPorch(ring, groundY, roofY, r, roofSlot, roofTint, centre) {
    const edges = ringEdges(ring).filter((e) => e.len >= 4);
    if (!edges.length) return;
    // the street side: the wall whose outward normal points most directly at the nearest street (one lookup per house)
    const ns = street.nearestStreet(centre[0], centre[1], 55);
    let best = null;
    if (ns) {
      const vx = ns.px - centre[0], vz = ns.pz - centre[1], vl = Math.hypot(vx, vz) || 1;
      let bestS = -Infinity;
      for (const e of edges) {
        const s = (e.nx * vx + e.nz * vz) / vl + Math.min(e.len, 12) * 0.015;
        if (s > bestS) { bestS = s; best = e; }
      }
    }
    if (!best) best = edges.reduce((p, q) => (q.len > p.len ? q : p));
    const e = best;
    const W = clamp(e.len * (0.45 + r() * 0.4), 2.4, Math.min(e.len - 0.6, 8));
    const D = 1.8 + r() * 0.7;
    const t0 = (e.len - W) * (r() < 0.5 ? 0.5 : r());
    const sx = e.a[0] + e.tx * (t0 + W / 2), sz = e.a[1] + e.tz * (t0 + W / 2); // porch centre on the wall
    const tWall = ctx.heightAt(sx + e.nx * 0.3, sz + e.nz * 0.3), tFront = ctx.heightAt(sx + e.nx * (D + 0.8), sz + e.nz * (D + 0.8));
    const floorY = Math.max(groundY, tWall, tFront) + 0.45;
    if (floorY + 3.3 > roofY) return;
    const ang = Math.atan2(e.tz, e.tx);
    const paint = pick(r, ['#ece8e0', '#e2ddd2', '#c9c4b8', '#8b8f8a', '#f2efe8']);
    const trim = E(mats.trim(), tintFor(paint));
    const cx = sx + e.nx * (D / 2), cz = sz + e.nz * (D / 2);
    // deck (skirted down to the terrain)
    emitBox(trim, trim, cx, cz, W / 2, D / 2, ang, Math.min(tWall, tFront) - 0.3, floorY);
    // posts + rails
    const postH = 2.6;
    const fx = sx + e.nx * (D - 0.15), fz = sz + e.nz * (D - 0.15);
    const nPosts = W > 5 ? 3 : 2;
    for (let k = 0; k < nPosts; k++) {
      const o = -W / 2 + 0.15 + (k * (W - 0.3)) / (nPosts - 1);
      emitBox(trim, null, fx + e.tx * o, fz + e.tz * o, 0.09, 0.09, ang, floorY, floorY + postH);
    }
    const gap = 0.7; // opening for the steps
    for (const side of [-1, 1]) {
      const len = W / 2 - gap - 0.15;
      if (len < 0.3) continue;
      const o = side * (gap + len / 2);
      emitBox(trim, trim, fx + e.tx * o, fz + e.tz * o, len / 2, 0.04, ang, floorY + 0.85, floorY + 0.95);
      emitBox(trim, trim, fx + e.tx * o, fz + e.tz * o, len / 2, 0.03, ang, floorY + 0.12, floorY + 0.2);
    }
    // shed roof sloping away from the wall
    const hw = W / 2 + 0.15, dd = D + 0.25;
    const P = (u, v) => [sx + e.tx * u + e.nx * v, sz + e.tz * u + e.nz * v];
    let rr = [P(-hw, 0), P(hw, 0), P(hw, dd), P(-hw, dd)];
    if (signedArea(rr) < 0) rr = rr.reverse();
    const sl = Math.tan((14 * Math.PI) / 180);
    const plane = { a: -sl * e.nx, b: -sl * e.nz, c: sl * dd + sl * (sx * e.nx + sz * e.nz) };
    emitPitchedRoof(E(roofSlot, roofTint), trim, rr, [plane], floorY + postH, 0.12, 0.12);
    // steps down to the ground in front of the opening
    const ground = tFront;
    const nSteps = clamp(Math.round((floorY - ground) / 0.2), 1, 4);
    for (let k = 0; k < nSteps; k++) {
      const top = floorY - ((k + 1) * (floorY - ground)) / (nSteps + 1);
      const v = D + 0.15 + k * 0.3;
      emitBox(E(S.concretePlain(), tintFor('#a9a49a')), E(S.concretePlain(), tintFor('#b5b0a6')), sx + e.nx * v, sz + e.nz * v, 0.75, 0.15, ang, ground - 0.3, top);
    }
    // front door
    const doorTint = tintFor(pick(r, ['#6b1f1f', '#1f2d3a', '#2f3b2a', '#4a3322', '#1a1a1a', '#8a6a3a', '#34495e']));
    const doorO = (r() - 0.5) * Math.max(0, W - 1.6);
    emitWallQuad(E(mats.woodDoor(), doorTint), sx + e.tx * doorO + e.nx * 0.06, sz + e.tz * doorO + e.nz * 0.06, e.tx, e.tz, e.nx, e.nz, 1.1, floorY, floorY + 2.3);
  }

  // Rowhouse front door: stone jambs + lintel hood, panelled door with a glazed top light, stoop down to the pavement.
  // p = wall frame (runPoint) at the door centre.
  function addRowDoor(p, groundY, liftMax, r) {
    const ty = ctx.heightAt(p.x + p.nx * 1.6, p.z + p.nz * 1.6);
    const base = clamp(ty, groundY, groundY + liftMax + 1);
    const nSteps = 3, rise = 0.17, floorY = base + nSteps * rise;
    const stone = E(S.stonePlain(), tintFor('#cfc6b3'));
    const box = (s0, s1, d0, d1, y0, y1) => emitFrameBox(stone, stone, null, p.x, p.z, p.tx, p.tz, p.nx, p.nz, s0, s1, d0, d1, y0, y1);
    box(-0.8, -0.58, 0, 0.12, floorY - 0.05, floorY + 2.6);
    box(0.58, 0.8, 0, 0.12, floorY - 0.05, floorY + 2.6);
    box(-0.92, 0.92, 0, 0.22, floorY + 2.6, floorY + 2.9);
    const doorTint = tintFor(pick(r, ['#6b1f1f', '#1f2d3a', '#2f3b2a', '#4a3322', '#1a1a1a', '#34495e', '#7a2a22']));
    emitWallQuad(E(mats.woodDoor(), doorTint), p.x + p.nx * 0.03, p.z + p.nz * 0.03, p.tx, p.tz, p.nx, p.nz, 1.16, floorY, floorY + 2.55);
    box(-0.85, 0.85, 0, 0.95, base - 0.4, floorY);
    for (let k = 1; k < nSteps; k++) box(-0.8, 0.8, 0.95 + (k - 1) * 0.3, 0.95 + k * 0.3, base - 0.4, floorY - k * rise);
  }

  // 1960s bank pavilion (PNC, Fifth Ave & Craig St): glass box under a deep white fascia slab, pole sign at the corner.
  function buildPavilion(b, ring, frame, baseY, groundY, roofY, lv) {
    const slabT = 1.3, over = 1.5, eaveY = roofY - slabT;
    const conc = E(S.concretePlain(), tintFor('#e8e6df'));
    const glassSlot = mats.facade(FACADES.curtainDark);
    const gFn = (ax, az, bx, bz) => clamp(Math.min(ctx.heightAt(ax, az), ctx.heightAt(bx, bz)) - 0.05, groundY, groundY + 1.5);
    emitWalls(ring, [
      { em: E(S.stonePlain(), tintFor('#5f5c57')), y0: baseY, y1: (g) => g + 0.3, bay: 0, vFn: (yy) => yy },
      { em: E(glassSlot, NO_TINT), y0: (g) => g + 0.3, y1: 'top', bay: glassSlot.bay, winW: 1, uOffset: 0, vFn: (yy) => (yy - groundY + 0.6) * 0.74 },
    ], () => eaveY + 0.05, { groundFn: gFn, subdiv: 8 });
    const outer = offsetRing(ring, -over, 2);
    emitRingWall(conc, outer, eaveY, roofY);
    emitCap(E(mats.flatRoof(), tintFor('#b9b6ae')), outer, [], roofY, 1);
    emitCap(E(S.concretePlain(), tintFor('#d4d1c9')), outer, [ring.slice().reverse()], eaveY, -1);
    // pole sign next to the Craig Street corner
    let best = null;
    for (const run of wallRuns(ring)) {
      const fr = runFrontage(run, street, fpIndex, b.id);
      if (!fr) continue;
      const craig = /Craig/.test(fr.name || '');
      if (!best || (craig && !best.craig) || (craig === best.craig && run.len > best.run.len)) best = { run, craig };
    }
    let detail = null;
    if (best) {
      const p = runPoint(best.run, best.run.len * 0.9);
      const px = p.x + p.nx * (over + 1.4), pz = p.z + p.nz * (over + 1.4);
      const gy = ctx.heightAt(px, pz);
      const st = businessStyle({ name: 'PNC Bank', type: 'bank' });
      const bw = 2.7, bh = 0.8;
      const cell = signage.board(st.text, st, bw / bh);
      detail = () => defer('far', (buf, sg) => {
        buf.box({ ox: px, oz: pz, tx: p.tx, tz: p.tz, nx: p.nx, nz: p.nz }, -0.1, 0.1, -0.1, 0.1, gy - 0.3, gy + 4.3, sg.swatch('chrome'));
        emitBoard(buf, sg, { ox: px - p.nx * 0.08, oz: pz - p.nz * 0.08, tx: p.tx, tz: p.tz, nx: p.nx, nz: p.nz }, 0, bw, bh, gy + 4.3, cell);
        emitBoard(buf, sg, { ox: px + p.nx * 0.08, oz: pz + p.nz * 0.08, tx: -p.tx, tz: -p.tz, nx: -p.nx, nz: -p.nz }, 0, bw, bh, gy + 4.3, cell);
      });
    }
    ctx.colliders?.addPolygon(ring, baseY, roofY, b.id);
    street3d.pavilions++;
    return { topY: roofY, groundY: lv.groundY, style: 'pavilion', shop: true, ring, detail };
  }

  // ---- per-building build
  const records = [];
  const groups = [];          // group index (= vertex `bid`) -> representative record
  const groupOf = new Map();  // osmId -> group index
  const byId = new Map();
  const nameSeen = new Map();
  let triCount = 0;

  function buildOne(b0) {
    // hand-checked street buildings: height / style overrides (see STREET_OVERRIDES)
    const ov = STREET_OVERRIDES[b0.osmId] || null;
    const b = ov && (ov.height || ov.style || ov.levels) ? {
      ...b0, height: ov.height ?? b0.height, levels: ov.levels ?? b0.levels, style: ov.style ?? b0.style,
      heightSource: ov.height ? 'override' : b0.heightSource,
    } : b0;
    let ring = cleanRing(b.footprint);
    if (ring.length < 3) return null;
    if (signedArea(ring) < 0) ring = ring.reverse();
    const holes = (b.holes || []).map((h) => { const c = cleanRing(h); return signedArea(c) > 0 ? c.reverse() : c; }).filter((h) => h.length >= 3);
    const frame = footprintFrame(ring);
    const area = Math.abs(signedArea(ring));
    const rect = area / Math.max(1e-6, frame.length * frame.width);
    const geo = { rect, frame, area };
    // building:parts take their look from the outline they belong to: a plain 'yes' part inherits the parent's type
    // (so a university's wing is not styled as a house or a shop), and parts without their own style / colour /
    // material / facade inherit those; the random picks are seeded by the parent so sibling parts (e.g. the three
    // Litchfield Towers) share one palette instead of each drawing its own.
    const parent = b.parentId ? outlineById.get(b.parentId) : null;
    const sb = parent ? {
      ...b, type: !b.type || b.type === 'yes' ? parent.type : b.type, name: b.name || parent.name, operator: b.operator || parent.operator,
      style: b.style || parent.style, color: b.color || parent.color, material: b.material || parent.material, facade: b.facade || parent.facade,
    } : b;
    const r = rng(hashStr(parent ? parent.id : b.id));
    const ci = commercialInfo(sb, ring);
    const style = inferStyle(sb, ci);
    const sp = applyTypology(applyOverrides(makeSpec(style, sb, r, geo), sb, r, geo), sb, geo, ci, ov);
    if (ov?.wallColor && !sp.typo) sp.wallColor = ov.wallColor;
    // separate stream for the roof-finish choices, so they don't reshuffle the rest of the building's random picks
    const r2 = rng(hashStr(b.id) ^ 0x5bd1e995);
    const r4 = rng(hashStr(b.id) ^ 0x3a8f05c5); // street-detail picks
    // flat deck finish: gravel ballast (most of the beige-grey decks, some others) or membrane
    sp.gravel = sp.style !== 'parking' && sp.style !== 'glasshouse' && r2() < (sp.flatColor === '#9f978a' ? 0.85 : 0.3);
    if (ci.shop && !['house', 'shed', 'parking', 'gothic-stone', 'glasshouse'].includes(style) && b.height >= 4) sp.shop = true;
    if (ov?.noShop) sp.shop = false;

    // ---- vertical placement
    const lv = buildingLevels(b);
    let { baseY, groundY, roofY } = lv;
    let elevated = (b.minHeight || 0) > 0;
    if (b.type === 'bridge') { baseY = roofY - Math.min(4.5, roofY - groundY - 1); groundY = baseY; elevated = true; sp.shop = false; }
    if (b.type === 'roof') { baseY = roofY - 0.9; elevated = true; sp.shop = false; sp.roof = { shape: 'flat' }; sp.parapetH = 0.2; sp.units = 0; }
    if (elevated) { sp.plinth = null; if (groundY < baseY) groundY = baseY; sp.shop = false; }
    const ground = curGround = { y0: elevated ? -GROUND_BIAS : lv.groundY, hf: elevated ? null : ctx.heightAt };
    if (ov?.typo === 'pavilion') return buildPavilion(b, ring, frame, baseY, groundY, roofY, lv);

    // ---- street frontage: which walls face a street (storefronts, street-front cornices, bays, mansards, fire escapes)
    const needStreet = !elevated && (sp.shop || !!sp.typo);
    const runs = needStreet ? wallRuns(ring) : null;
    const fronts = runs ? runs.map((run) => runFrontage(run, street, fpIndex, b.id, b.parentId)) : null;
    let plan = null;
    if (sp.shop && runs) {
      const biz = findBusinesses(b, ring, shopPois.filter((p) => poiOwner.get(p) === b0.id));
      const nb = isInstitutional(sb) ? null : nameBusiness(b);
      if (nb && !biz.some((z) => z.name === nb.name)) biz.unshift(nb);
      const mode = ov?.shopMode || (ci.typed || ci.street ? 'all' : 'poi');
      plan = planStorefronts({ b, runs, fronts, businesses: biz, mode, bay: 6 });
      if (!plan || !plan.runs.length) plan = null;
    }
    if (!plan) sp.shop = false;

    // ---- pitched roof planes
    let planes = null, rise = 0, mansard = null;
    if (sp.roof.shape !== 'flat' && sp.roof.shape !== 'dome') {
      planes = roofPlanes(sp.roof.shape, frame, sp.roof.pitch, { flip: r() < 0.5 });
      if (planes) rise = sp.roof.rise ? setRise(planes, ring, clamp(sp.roof.rise, 0.5, 14)) : limitRise(planes, ring, sp.roof.maxRise ?? 7);
      if (!planes || rise < 0.3) { planes = null; sp.roof = { shape: 'flat' }; rise = 0; }
    }
    // Victorian mansard FRONT: a steep slate slope on the street wall(s), flat deck behind, dormers (see roofs.js)
    if (!planes && sp.mansard && runs && !holes.length && roofY - groundY > 7) {
      const fr = runs.filter((run, i) => fronts[i] && !run.blocked && run.len >= 3).sort((p, q) => q.len - p.len).slice(0, 2);
      if (fr.length) {
        const H = clamp((roofY - groundY) * 0.26, 2.1, 2.6), pitch = 72;
        const mp = mansardFrontPlanes(ring, fr.map((run) => ({ ax: run.longest.ax, az: run.longest.az, nx: run.nx, nz: run.nz })), H, pitch);
        if (mp) {
          planes = mp; rise = H; roofY -= H;
          mansard = { runs: fr, H, t: Math.tan((pitch * Math.PI) / 180) };
          street3d.mansards++;
          sp.roof = { shape: 'mansard-front', slot: S.slateRoof(), color: pick(r4, ['#474b52', '#3e4249', '#5a4d47', '#6b4f42', '#51565c']), overhang: 0.05, soffit: sp.bracket?.color || '#3a3533' };
        }
      }
    }
    const isPitched = !!planes;
    // Tagged / curated heights run to the roof TOP (see data/curated/buildings.json "about"): a pitched roof sits
    // inside that height, so the eaves come down by the roof's rise (walls keep at least 55 % of the height).
    if (isPitched && !mansard && b.heightSource !== 'default') roofY -= Math.min(rise, (roofY - groundY) * 0.45);
    // Default-height houses: OSM gives no height, so treat the default as eaves + part of the roof
    // (2–2.5 storeys under a pitched roof reads much more like Shadyside than 3 full storeys).
    if (isPitched && b.heightSource === 'default' && (sp.style === 'house' || sp.style === 'shed')) roofY -= clamp((roofY - groundY) * 0.2, 0, 1.6);
    const wallH = roofY - groundY;
    let parapetH = isPitched ? 0 : Math.min(sp.parapetH, Math.max(0, wallH * 0.2));
    if (b.type === 'roof') parapetH = 0.2;

    // ---- colours / tints
    const f = 0.93 + r() * 0.14;
    const wallTint = sp.curtain ? NO_TINT : tintFor(sp.wallColor, f);
    const plainWallTint = tintFor(sp.wallColor, f * 0.97);

    // ---- wall bands
    const slot = sp.wallSlot;
    const texFloor = slot.floor || 3.6;
    // Bands: [stone base] → [plinth | storefront storey] → main facade. The lower bands follow the local terrain of
    // each wall segment (Pittsburgh streets are steep: storefronts step down the hill instead of being buried), while
    // the main facade keeps one storey grid for the whole building. Storefront glazing only on the street walls that
    // got shop units; the other walls of that storey are plain.
    const bands = [];
    const sill = slot.sill ?? 0.9;
    const floorsTop = isPitched ? roofY : roofY - parapetH;
    let shopH = 0;
    if (sp.shop) {
      shopH = clamp(wallH * 0.3, 3.8, 4.6);
      if (wallH - parapetH < shopH + 0.5) shopH = Math.max(3, wallH - parapetH);
    }
    const lowH = shopH > 0 ? shopH : sp.plinth && !elevated ? Math.min(sp.plinth.h, sill * 0.95) : 0;
    const liftMax = Math.max(0, floorsTop - groundY - lowH - 1.0);
    const heightAt = ctx.heightAt;
    const groundFn = lowH > 0 ? (ax, az, bx, bz) => clamp(Math.min(heightAt(ax, az), heightAt(bx, bz)) - 0.05, groundY, groundY + liftMax) : null;
    const vertexGroundFn = lowH > 0 ? (x, z) => clamp(heightAt(x, z) - 0.05, groundY, groundY + liftMax) : null;
    // main facade band with storeys fitted to the wall height
    const start = shopH > 0 ? groundY + shopH : groundY;
    const floorsH = Math.max(0.5, floorsTop - start);
    let nFloors;
    if (b.levels && b.heightSource !== 'default') nFloors = Math.max(1, Math.round(b.levels) - (shopH > 0 ? 1 : 0));
    else nFloors = Math.max(1, Math.round(floorsH / texFloor));
    const vScale = clamp(texFloor / (floorsH / nFloors), 0.6, 1.7);
    let plinthF = 1;
    if (shopH > 0) r(); else if (lowH > 0) plinthF = 0.95 + r() * 0.1; // (keeps the random stream in step)
    const vOff = (sp.uniformFloors ? Math.floor(r() * 3) : 0) * texFloor + (shopH > 0 ? texFloor : 0);
    const shopOnly = shopH > 0 && floorsTop - start < 1.2;
    const mainSlot = shopOnly ? plainFor(sp.wallKind) : slot;
    const mainEm = E(mainSlot, shopOnly ? plainWallTint : wallTint);
    const mainVFn = shopOnly ? (yy) => yy : (yy) => (yy - start) * vScale + vOff;
    const mainUOff = sp.uniformFloors ? Math.floor(r() * 4) * (slot.bay || 0) : 0;
    let y = baseY;
    if (shopH > 0) {
      const sfSlot = mats.storefront(ov?.sf ?? hashStr(b.id) % mats.storefrontVariants);
      const k = 4.5 / shopH;
      bands.push({ em: E(S.stonePlain(), tintFor('#8e877c')), y0: baseY, y1: (g) => g, bay: 0, vFn: (yy) => yy });
      const sfBand = { em: E(sfSlot, wallTint), y0: (g) => g, y1: (g) => g + shopH, bay: sfSlot.bay, winW: sfSlot.winW, uOffset: 0, stretch: true, vFn: (yy, g) => (yy - g) * k };
      bands.push({ em: E(plainFor(sp.wallKind), plainWallTint), y0: (g) => g, y1: (g) => g + shopH, bay: 0, vFn: (yy) => yy, alt: (i) => (plan.shopEdges.has(i) ? sfBand : null) });
      y = (g) => g + shopH;
    } else if (lowH > 0) {
      // base course: its top follows the terrain smoothly (sloped), unlike the level storefronts
      bands.push({ em: E(sp.plinth.slot, tintFor(sp.plinth.color, plinthF)), y0: baseY, y1: (g, gv) => gv + lowH, bay: 0, vFn: (yy) => yy });
      y = (g, gv) => gv + lowH;
    }
    bands.push({ em: mainEm, y0: y, y1: 'top', bay: shopOnly ? 0 : slot.bay, winW: slot.winW, uOffset: mainUOff, vFn: mainVFn });

    const topFn = isPitched ? (x, z) => roofY + envelope(planes, x, z) : () => roofY;
    const kinkFn = isPitched ? (ax, az, bx, bz) => envelopeKinks(planes, ax, az, bx, bz) : null;
    const wallOpts = { kinkFn, groundFn, vertexGroundFn, subdiv: shopH > 0 ? 7 : 12, splitFn: plan ? (i) => plan.split.get(i) || null : null };
    emitWalls(ring, bands, topFn, wallOpts);
    if (holes.length) {
      const holeBands = bands.map(({ alt, ...rest }) => rest);
      for (const h of holes) emitWalls(h, holeBands, topFn, { ...wallOpts, splitFn: null });
    }
    if (elevated) emitCap(E(plainFor(sp.wallKind), plainWallTint), ring, holes, baseY, -1);

    // ---- roof massing (base pass). Everything small is emitted by the detail closure further down.
    let topY = roofY;
    const detail = !lowQ;
    let roofTint = NO_TINT;
    const deckY = roofY - parapetH;
    let roofSlot = null, soffitTint = null, deckF = 1, deckTint = null, deckSlot = null;
    const glassDeck = sp.style === 'glasshouse';
    const overhang = sp.roof.overhang ?? 0.4, roofThick = sp.roof.glass ? 0.08 : 0.2;
    if (isPitched) {
      roofSlot = sp.roof.slot || S.tileRoof();
      roofTint = sp.roof.color ? tintFor(sp.roof.color, 0.92 + r() * 0.16) : NO_TINT;
      soffitTint = tintFor(sp.roof.soffit || '#d9d3c6');
      // mansard front: the last plane is the flat deck behind the slope → membrane / gravel instead of slate
      const deckEm = mansard ? E(sp.gravel ? mats.gravelRoof() : mats.flatRoof(), tintFor(sp.flatColor)) : null;
      emitPitchedRoof(E(roofSlot, roofTint), null, ring, planes, roofY, overhang, roofThick,
        mansard ? { planeEm: (i) => (i === planes.length - 1 ? deckEm : null) } : {});
      topY = roofY + rise;
    } else {
      deckF = 0.93 + r() * 0.14;
      deckTint = tintFor(sp.flatColor, deckF);
      deckSlot = sp.gravel ? mats.gravelRoof() : mats.flatRoof();
      emitCap(glassDeck ? E(sp.wallSlot, NO_TINT) : E(deckSlot, deckTint), ring, holes, deckY + 0.02, 1);
      if (sp.roof.shape === 'dome') {
        const R = Math.min(frame.width, frame.length) * 0.42;
        const domeH = R * 0.75;
        emitDome(E(sp.roof.slot || mats.copper(), NO_TINT), frame.center[0], frame.center[1], R, domeH, roofY, 8, 28);
        topY = roofY + domeH;
      }
      if (detail && sp.penthouse && wallH > 16 && area > 700) {
        // stair / elevator penthouse near the middle of the roof
        const hx = clamp(frame.length * 0.1, 2.5, 6), hz = clamp(frame.width * 0.12, 2, 4.5);
        const [cx, cz] = frame.center;
        if (pointInRing(cx, cz, ring) && !holes.some((h) => pointInRing(cx, cz, h))) {
          const px = cx + (r() - 0.5) * hx, pz = cz + (r() - 0.5) * hz;
          emitBox(E(plainFor(sp.wallKind), plainWallTint), E(mats.flatRoof(), tintFor(sp.flatColor, deckF * 0.9)), px, pz, hx, hz, frame.angle, deckY, deckY + 3.4);
          topY = Math.max(topY, deckY + 3.4);
        }
      }
      if (b.type === 'roof') {
        // canopy posts
        const cs = Math.cos(frame.angle), sn = Math.sin(frame.angle);
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const u = su * (frame.length / 2 - 0.8), v = sv * (frame.width / 2 - 0.8);
          const px = frame.center[0] + u * cs - v * sn, pz = frame.center[1] + u * sn + v * cs;
          emitBox(E(mats.trim(), tintFor('#d8d8d4')), null, px, pz, 0.18, 0.18, frame.angle, lv.groundY - 0.5, baseY);
        }
      }
    }

    // ---- bay windows on rowhouse street fronts: part of the wall massing, so base pass (the facade texture array)
    let bayRun = null;
    if (detail && sp.typo && runs && !elevated && sp.bays && !(isPitched && !mansard)) {
      const eaveTop = (mansard ? roofY : roofY - parapetH) - (sp.bracket ? (mansard ? 0.75 : 0.98) : 0.3);
      const cand = runs.filter((run, i) => fronts[i] && !run.blocked && run.len >= 5.5 && !(plan && plan.runs.some((q) => q.run === run)));
      if (cand.length) {
        bayRun = cand.reduce((p, q) => (q.len > p.len ? q : p));
        const n = Math.min(sp.bays, Math.max(1, Math.floor(bayRun.len / 5.4)));
        const capEm = E(mats.trim(), tintFor(sp.bracket?.color || '#3a3533'));
        for (let k = 0; k < n; k++) {
          const sC = n === 1 ? bayRun.len * 0.32 : (bayRun.len * (k + 0.5)) / n;
          const p = runPoint(bayRun, sC);
          const y0 = clamp(heightAt(p.x + p.nx * 0.6, p.z + p.nz * 0.6), groundY, groundY + liftMax) - 0.3;
          if (eaveTop - y0 < 4.5) continue;
          street3d.bays++;
          emitBay({ run: bayRun, sC, width: 2.9, depth: 0.7, y0, y1: eaveTop, bands: [{ em: mainEm, bay: slot.bay, winW: 0.45, uOffset: 0, vFn: mainVFn }], capEm, bottomEm: null, colliders: ctx.colliders, id: b.id });
        }
      }
    }

    // ---- colliders (walkable courtyards: split walls into thin boxes instead of one filled polygon)
    if (ctx.colliders) {
      if (!holes.length) ctx.colliders.addPolygon(ring, baseY, topY, b.id);
      else {
        for (const rr of [ring, ...holes]) for (let i = 0, j = rr.length - 1; i < rr.length; j = i++) {
          const ax = rr[j][0], az = rr[j][1], bx = rr[i][0], bz = rr[i][1];
          const len = Math.hypot(bx - ax, bz - az);
          if (len < 0.05) continue;
          ctx.colliders.addBox((ax + bx) / 2, (az + bz) / 2, len / 2, 0.3, -Math.atan2(bz - az, bx - ax), baseY, topY, b.id);
        }
      }
    }

    // ---- everything the detail pass will draw from the shop-sign atlas has to be requested now (the atlas is
    // packed once, after the base pass)
    if (plan) for (const pr of plan.runs) requestStorefrontSigns({ plan: pr, shopH, signage, near: !lowQ });
    const bracketKey = sp.typo && sp.bracket ? signage.color(sp.bracket.color || '#3a3533') : null;

    // ================================================================ detail pass (run later, per 250 m chunk)
    const rd = rng(hashStr(b.id) ^ 0x68e31da4); // detail-only random stream
    const centre = b.centroid;
    const detailFn = () => {
      curGround = ground;
      // ---- roof edges and roof-top clutter
      if (isPitched) {
        const house = sp.style === 'house' || sp.style === 'shed';
        // soffits + fascia boards; ridge / hip caps; gutters with downspouts on houses
        emitPitchedRoof(null, E(sp.roof.glass ? roofSlot : mats.trim(), sp.roof.glass ? NO_TINT : soffitTint), ring, planes, roofY, overhang, roofThick, {
          ridgeEm: detail && !sp.roof.glass && !mansard && roofSlot.key !== 'roof:copper' ? E(roofSlot, tintFor(sp.roof.color || '#555555', 0.78)) : null,
          gutter: detail && house && !mansard ? { em: E(mats.trim(), tintFor(pick(rd, ['#ece9e2', '#e4dfd4', '#5a4a3c', '#3b3c3e', '#d9d4c8']))), heightAt, groundY } : null,
        });
        if (detail && house && !mansard) street3d.gutters++;
        if (sp.chimney && detail) {
          const u = (rd() < 0.5 ? -1 : 1) * frame.length * (0.22 + rd() * 0.12);
          const v = (rd() - 0.5) * frame.width * 0.3;
          const cs = Math.cos(frame.angle), sn = Math.sin(frame.angle);
          const cx = frame.center[0] + u * cs - v * sn, cz = frame.center[1] + u * sn + v * cs;
          if (pointInRing(cx, cz, ring)) {
            const hb = roofY + envelope(planes, cx, cz) - 0.3;
            emitChimney(E(S.brickPlain(), tintFor(pick(rd, PAL.red), 0.9)), E(S.concretePlain(), tintFor('#8a857c')), E(S.tileRoof(), tintFor('#9b5a3f')),
              cx, cz, 0.35 + rd() * 0.15, 0.45 + rd() * 0.2, frame.angle, hb, Math.max(hb + 1.2, topY + 0.7), rd);
            street3d.chimneys++;
          }
        }
      } else {
        const corn = detail && sp.cornice && parapetH > 0.3 && wallH > 6 ? sp.cornice : null;
        emitFlatRoof({
          deck: null,
          parapetIn: E(plainFor(sp.wallKind), plainWallTint),
          coping: E(sp.coping.slot, tintFor(sp.coping.color)),
          cornice: corn ? E(corn.slot, tintFor(corn.color)) : null,
        }, ring, holes, roofY, parapetH, { cornice: corn ? { out: corn.out, h: corn.h, y1: roofY - parapetH + 0.12 } : null, parapetT: parapetH < 0.4 ? 0.2 : 0.3 });
        if (detail && !glassDeck && b.type !== 'roof' && parapetH > 0.05 && area > 60) {
          // dirt / water marks collecting along the parapet: dark at the parapet, fading into the deck
          emitDeckBand(E(deckSlot, tintFor(sp.flatColor, deckF * 0.35)), E(deckSlot, tintFor(sp.flatColor, deckF * 0.64)), E(deckSlot, deckTint),
            ring, holes, deckY + 0.07, parapetH < 0.4 ? 0.2 : 0.3, clamp(Math.sqrt(area) * 0.06, 0.8, 2.0));
        }
        if (detail && !glassDeck && area > 350 && b.type !== 'roof') {
          // re-roofed patches: a few rectangles of a clearly different shade
          const cs = Math.cos(frame.angle), sn = Math.sin(frame.angle);
          const np = (area > 1500 ? 2 : 1) + Math.floor(r2() * 3);
          for (let k = 0, tries = 0; k < np && tries < 14; tries++) {
            const u = (r2() - 0.5) * frame.length * 0.7, v = (r2() - 0.5) * frame.width * 0.7;
            const hu = frame.length * (0.08 + r2() * 0.16), hv = frame.width * (0.1 + r2() * 0.2);
            const P = (du, dv) => [frame.center[0] + (u + du) * cs - (v + dv) * sn, frame.center[1] + (u + du) * sn + (v + dv) * cs];
            const rect = [P(-hu, -hv), P(hu, -hv), P(hu, hv), P(-hu, hv)];
            if (!rect.every(([x, z]) => pointInRing(x, z, ring) && !holes.some((h) => pointInRing(x, z, h)))) continue;
            const pf = r2() < 0.5 ? 0.7 + r2() * 0.18 : 1.1 + r2() * 0.2;
            // (each patch at its own height: overlapping coplanar patches would z-fight)
            emitCap(E(deckSlot, tintFor(sp.flatColor, deckF * pf)), signedArea(rect) < 0 ? rect.reverse() : rect, [], deckY + 0.12 + k * 0.03, 1);
            k++;
          }
        }
        if (detail && area > 60 && b.type !== 'roof' && !glassDeck && sp.style !== 'parking') {
          const em = {
            unit: E(mats.unit(), tintFor(pick(rd, ['#c9cbcc', '#b6b9bb', '#d6d4cf', '#a8acae']))), top: E(mats.unitTop(), NO_TINT),
            dark: E(mats.trim(), tintFor(pick(rd, ['#3c3f42', '#4a4c4e', '#5b5a57']))), glass: E(mats.skylight(), NO_TINT), curb: E(mats.trim(), tintFor('#8d8f8e')),
          };
          // packaged HVAC units, fans and skylights on the bigger decks …
          if (sp.units > 0 && area > 140) {
            const count = clamp(Math.round((area / 500) * sp.units * (0.6 + rd() * 0.8)), 1, 16);
            emitRooftopUnits(em, ring, holes, deckY, frame, rd, count, area > 2000 ? 6 : 4, { skylights: area > 400 });
          }
          // … and the small stuff on every deck: condensers, plumbing vents, roof hatches
          const small = clamp(Math.round((area / 170) * (0.5 + rd() * 0.8)), 1, 10);
          emitRooftopUnits(em, ring, holes, deckY, frame, rd, small, 2, { small: true });
        }
      }

      // ---- ground-level details (entrances, porches)
      if (detail && !elevated && b.type !== 'roof') {
        if (sp.style === 'house' && area >= 45 && area < 600 && wallH > 4.5) {
          const pr = isPitched && sp.roof.slot ? sp.roof : { slot: S.shingleRoof(), color: pick(rd, PAL.shingle) };
          addPorch(ring, groundY, roofY, rd, pr.slot || S.tileRoof(), pr.color ? tintFor(pr.color) : NO_TINT, centre);
        } else if (!['house', 'shed', 'parking', 'glasshouse'].includes(sp.style) && !sp.shop && sp.typo !== 'row' && area >= 150 && wallH > 5) {
          addEntrances(ring, sp, groundY, roofY, baseY, rd);
        }
      }

      // ---- storefronts: ledges, storefront cornices, awnings / canopies (building buffer); sign boards, blade signs,
      // café furniture (signage atlas meshes, run once the atlas is packed)
      if (plan) {
        const slots = { trim: mats.trim(), stone: S.stonePlain(), awningSolid: mats.awning(false), awningStriped: mats.awning(true) };
        street3d.storefrontRuns += plan.runs.length;
        for (const pr of plan.runs) {
          emitStorefrontRun({
            plan: pr, shopH, E, slots, tintFor, signage, defer, near: !lowQ, street, fp: fpIndex, selfId: b.id, heightAt,
            groundOf: (u) => { const a = runPoint(pr.run, u.s0 + 0.01), c = runPoint(pr.run, u.s1 - 0.01); return groundFn(a.x, a.z, c.x, c.z); },
            ledgeColor: '#cfc8b8', corniceColor: sp.bracket?.color || pick(r4, ['#3a3835', '#2b2e31', '#5b2b22', '#1f3a2c', '#d8d0bf']),
          });
        }
      }

      // ---- street typology details: bracketed cornices, dormers, bays, rowhouse doors, fire escapes, chimneys
      if (sp.typo && runs && !elevated) {
        const frontRuns = runs.filter((run, i) => fronts[i] && !run.blocked && run.len >= 2);
        const shopRun = (run) => !!plan && plan.runs.some((q) => q.run === run);
        const paint = E(mats.trim(), tintFor(sp.bracket?.color || '#3a3533'));
        if (detail && sp.bracket && (mansard || (!isPitched && parapetH > 0.2))) {
          const list = mansard ? mansard.runs : frontRuns;
          street3d.brackets++;
          for (const run of list) {
            const segs = runSegs(run, 0, run.len), yTop = mansard ? roofY + 0.05 : roofY + 0.06;
            const co = { out: mansard ? 0.42 : 0.55, frieze: mansard ? 0.42 : 0.62, corona: mansard ? 0.24 : 0.3, dentil: !!sp.bracket.dentil };
            emitBracketCornice(paint, segs, yTop, co);
            defer('near', (buf, sg) => emitCorniceDetail(buf, sg.swatch(bracketKey), segs, yTop, co));
          }
        }
        if (mansard && detail) {
          const roofEm = E(S.slateRoof(), roofTint), trimEm = E(mats.trim(), tintFor('#ebe7dd')), winEm = E(mats.dormer(), NO_TINT);
          for (const run of mansard.runs) {
            const n = clamp(Math.floor(run.len / 3.8), 1, 5);
            for (let k = 0; k < n; k++) emitDormer({ p: runPoint(run, (run.len * (k + 0.5)) / n), y0: roofY + 0.04, t: mansard.t, roofEm, trimEm, winEm });
          }
        }
        if (detail && sp.typo === 'row' && !plan && frontRuns.length) {
          // rowhouse front door with stone jambs + hood and a stoop, over the last window bay of the street front
          const run = bayRun || frontRuns.reduce((p, q) => (q.len > p.len ? q : p));
          const nb = Math.max(1, Math.round(run.len / slot.bay)), uw = run.len / nb;
          const sD = bayRun && nb > 1 ? (nb - 0.5) * uw : (Math.max(0, nb - 1) + 0.5) * uw;
          addRowDoor(runPoint(run, sD), groundY, liftMax, r4);
          street3d.rowDoors++;
        }
        const totalFloors = nFloors + (shopH > 0 ? 1 : 0);
        if (detail && sp.fireEscape && totalFloors >= 3) {
          let list = runs.filter((run, i) => !run.blocked && !fronts[i] && run.len >= 6);
          if (!list.length && sp.typo === 'apt') list = frontRuns.filter((run) => run.len >= 9 && !shopRun(run));
          if (list.length) {
            const run = list.reduce((p, q) => (q.len > p.len ? q : p));
            const nb = Math.max(1, Math.round(run.len / slot.bay)), uw = run.len / nb;
            const p = runPoint(run, (Math.floor(nb / 2) + 0.5) * uw);
            const fh = floorsH / nFloors, ys = [];
            for (let j = shopH > 0 ? 0 : 1; j < nFloors; j++) ys.push(start + j * fh);
            if (ys.length >= 2 && !fpIndex.inside(p.x + p.nx * 1.4, p.z + p.nz * 1.4, b.id) && street.clearance(p.x + p.nx * 1.2, p.z + p.nz * 1.2) > 0.3) {
              const width = clamp(uw * 1.15, 2.6, 3.6);
              defer('near', (buf, sg) => emitFireEscape({ p, floors: ys, buf, uv: sg.swatch('black'), width }));
              street3d.fireEscapes++; street3d.sample.fireEscape = street3d.sample.fireEscape || [+p.x.toFixed(1), +p.z.toFixed(1), b.id];
            }
          }
        }
        if (detail && sp.chimneys && (mansard || !isPitched)) {
          const deck = mansard ? roofY + mansard.H : roofY - parapetH;
          const party = runs.filter((run) => run.blocked && run.len > 4);
          const pool = party.length ? party : runs.filter((run, i) => !fronts[i] && run.len > 4);
          const nC = pool.length ? 1 + (r4() < 0.4 ? 1 : 0) : 0;
          for (let k = 0; k < nC; k++) {
            const run = pool[Math.floor(r4() * pool.length)];
            const p = runPoint(run, run.len * (0.25 + r4() * 0.5));
            const cx = p.x - p.nx * 0.55, cz = p.z - p.nz * 0.55;
            if (!pointInRing(cx, cz, ring)) continue;
            const ang = Math.atan2(p.tz, p.tx), hC = 1.0 + r4() * 0.8;
            emitChimney(E(S.brickPlain(), tintFor(pick(r4, PAL.red), 0.85)), E(S.concretePlain(), tintFor('#6e6a64')), E(S.tileRoof(), tintFor('#9b5a3f')),
              cx, cz, 0.5 + r4() * 0.3, 0.3, ang, deck - 0.3, deck + hC, r4);
            street3d.chimneys++;
          }
        }
      }
    };
    return { topY, groundY: lv.groundY, style: sp.style, shop: !!sp.shop && shopH > 0, ring, detail: detailFn };
  }

  // ---- main loop (base pass for every building; detail closures are collected per 250 m chunk)
  const total = src.length;
  ctx.loading?.detail?.(`建筑 0 / ${total}`);
  for (let i = 0; i < total; i++) {
    const b = src[i];
    const cx = b.centroid[0], cz = b.centroid[1];
    const bgx = Math.floor(cx / BASE_CHUNK), bgz = Math.floor(cz / BASE_CHUNK), bk = bgx + ',' + bgz;
    curBase = baseChunks.get(bk);
    if (!curBase) { curBase = { key: bk, x0: bgx * BASE_CHUNK, z0: bgz * BASE_CHUNK, size: BASE_CHUNK, bufs: null, meshes: [] }; baseChunks.set(bk, curBase); }
    const dgx = Math.floor(cx / CHUNK), dgz = Math.floor(cz / CHUNK), dk = dgx + ',' + dgz;
    curDetail = detailChunks.get(dk);
    if (!curDetail) {
      curDetail = { key: dk, x0: dgx * CHUNK, z0: dgz * CHUNK, size: CHUNK, items: [], cursor: 0, done: false, bufs: null, far: [], near: [], meshes: [], signFar: null, signNear: null, d: 0 };
      detailChunks.set(dk, curDetail);
    }
    // parts of one multi-ring relation share a highlight / pick index
    let gid = groupOf.get(b.osmId);
    if (gid === undefined) { gid = groups.length; groupOf.set(b.osmId, gid); groups.push(null); }
    curBid = gid;
    pass = 'base';
    let res = null;
    try { res = buildOne(b); } catch (e) { console.warn('[buildings] failed', b.id, e); }
    if (!res) continue;
    if (res.detail) curDetail.items.push({ bid: gid, fn: res.detail });
    const nameSrc = b.name ? b : b._nameFrom || null;
    const name = nameSrc?.name || null;
    const infoEntry = ctx.info?.buildings?.[b.osmId] || (nameSrc ? ctx.info?.buildings?.[nameSrc.osmId] : null);
    const nameZh = b.nameZh || nameSrc?.nameZh || infoEntry?.nameZh || null;
    let radius = 0;
    for (const [x, z] of res.ring) radius = Math.max(radius, Math.hypot(x - cx, z - cz));
    const rec = {
      index: records.length, group: gid, id: b.id, osmId: b.osmId, name, nameZh, campus: !!b.campus, style: res.style, shop: res.shop,
      center: [cx, cz], topY: res.topY, groundY: res.groundY, radius, data: b,
      entry: {
        key: b.id, kind: 'building', name: name || typeName(b).en, nameZh: nameZh || typeName(b).zh, osmId: nameSrc?.osmId || b.osmId,
        infoKey: nameSrc?.osmId || b.osmId, position: [cx, res.topY, cz], radius: Math.max(radius, 5), unnamed: !name,
        type: b.type, address: b.address || null, campus: !!b.campus, height: +(res.topY - res.groundY).toFixed(1), levels: b.levels || null,
      },
    };
    records.push(rec);
    if (!groups[gid] || groups[gid].data.area < b.area) groups[gid] = rec; // largest part represents the group
    byId.set(b.id, rec);
    if (!byId.has(b.osmId)) byId.set(b.osmId, rec);
    // one label per distinct name (largest building wins; far-apart namesakes get their own label)
    const labelName = name || nameZh;
    if (labelName) {
      const list = nameSeen.get(labelName) || [];
      const near = list.findIndex((o) => Math.hypot(o.center[0] - cx, o.center[1] - cz) < 250);
      if (near < 0) list.push(rec);
      else if (list[near].data.area < b.area) list[near] = rec;
      nameSeen.set(labelName, list);
    }
    if ((i & 31) === 31) {
      if ((i & 1023) === 1023) ctx.loading?.detail?.(`建筑 ${i + 1} / ${total}`);
      await ctx.yield?.();
    }
  }

  const T1 = performance.now();
  // ---- meshes
  const group = new THREE.Group();
  group.name = 'buildings';
  group.matrixAutoUpdate = false;
  const meshes = [];
  const resolver = (hit) => {
    const attr = hit.object.geometry.attributes.bidLayer;
    if (!attr || !hit.face) return null;
    const rec = groups[Math.round(attr.getX(hit.face.a))];
    return rec ? rec.entry : null;
  };
  // every texture layer the (lazy) detail pass can use must exist before the arrays are built
  for (const f of [mats.trim, mats.door, mats.woodDoor, mats.dormer, mats.unit, mats.unitTop, mats.skylight, mats.flatRoof, mats.gravelRoof, mats.copper]) f();
  mats.awning(true); mats.awning(false);
  for (const f of Object.values(S)) f();
  const arrayMats = mats.build();
  const T2 = performance.now();
  let detailTris = 0;
  function makeMeshes(c, tag, shadow = true) {
    if (!c.bufs) return;
    {
      const buf = c.bufs.all;
      if (buf.empty) { c.bufs = null; return; }
      const geom = buf.toGeometry(); // (frees the buffer's growable arrays)
      const mesh = new THREE.Mesh(geom, arrayMats.all);
      mesh.name = `bld:${tag}:${c.key}`;
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
      meshes.push(mesh);
      c.meshes.push(mesh);
      if (tag === 'base') triCount += buf.triangles; else detailTris += buf.triangles;
      if (tag !== 'base') mesh.userData.noShadowProxy = true; // (castShadow / visible change with distance)
      ctx.pick?.add(mesh, resolver);
    }
    c.bufs = null;
  }
  for (const c of baseChunks.values()) makeMeshes(c, 'base');
  const T3 = performance.now();
  ctx.scene.add(group);

  // ---- shop signage + small street furniture: one atlas material, per detail chunk a 'far' mesh (fascia / pole
  // signs) and a 'near' mesh (blade signs, café tables, sandwich boards, cornice brackets, fire escapes)
  const streetGroup = new THREE.Group();
  streetGroup.name = 'street-signage';
  streetGroup.matrixAutoUpdate = false;
  ctx.scene.add(streetGroup);
  const sg = signage.build();
  let signTris = 0;

  // ---- detail chunks: run the collected closures (optionally time-sliced), then build the chunk's meshes
  const detailList = [...detailChunks.values()].filter((c) => c.items.length);
  let detailBuilt = 0, detailMs = 0, shadowDirty = false;
  function stepDetail(dc, deadline) {
    const t0 = performance.now();
    pass = 'detail'; curDetail = dc;
    const items = dc.items;
    while (dc.cursor < items.length) {
      const it = items[dc.cursor++];
      curBid = it.bid;
      try { it.fn(); } catch (e) { console.warn('[buildings] detail failed', e); }
      items[dc.cursor - 1] = null;
      if (performance.now() > deadline && dc.cursor < items.length) { pass = 'base'; detailMs += performance.now() - t0; return false; }
    }
    pass = 'base';
    makeMeshes(dc, 'detail');
    for (const kind of ['far', 'near']) {
      if (!dc[kind].length) continue;
      const buf = new AtlasBuffer();
      for (const fn of dc[kind]) { try { fn(buf, signage); } catch (e) { console.warn('[buildings] street detail failed', e); } }
      const mesh = buf.toMesh(sg.material, `street:${dc.key}:${kind}`);
      dc[kind] = null;
      if (!mesh) continue;
      signTris += buf.tris;
      streetGroup.add(mesh);
      dc[kind === 'far' ? 'signFar' : 'signNear'] = mesh;
    }
    dc.far = dc.near = null;
    dc.items = null;
    dc.done = true;
    detailBuilt++;
    shadowDirty = true;
    detailMs += performance.now() - t0;
    return true;
  }

  // distance from the camera to a chunk's square (the height above ~60 m counts too: detail is sub-pixel from high up)
  const chunkDist = (c, p) => {
    const dx = Math.max(c.x0 - p.x, 0, p.x - c.x0 - c.size), dz = Math.max(c.z0 - p.z, 0, p.z - c.z0 - c.size);
    return Math.hypot(dx, dz, Math.max(0, p.y - 60));
  };
  const LOD = lowQ ? { show: 480 } : { show: 720 };
  // start view: a ?cam= link, else the home view over the campus
  const start = (() => {
    try {
      const v = (new URLSearchParams(location.search).get('cam') || '').split(',').map(Number);
      if (v.length === 3 && v.every(Number.isFinite)) return { x: v[0], y: v[1], z: v[2] };
    } catch { /* no location */ }
    return { x: -120, y: 60, z: 70 };
  })();
  // Every detail chunk is built now, during loading (nearest the start view first, yielding so the loading screen
  // stays alive). Building them lazily while exploring cost 4–12 ms per frame for seconds after every flight, plus
  // a shadow-map refresh and new GPU buffers per chunk; the extra loading time is ~1 s.
  const T4 = performance.now();
  let tY = T4;
  const order = detailList.map((c) => [chunkDist(c, start), c]).sort((a, b) => a[0] - b[0]);
  for (let k = 0; k < order.length; k++) {
    stepDetail(order[k][1], Infinity);
    if (performance.now() - tY > 60) {
      ctx.loading?.detail?.(`建筑细节 ${k + 1} / ${order.length}`);
      await ctx.yield?.();
      tY = performance.now();
    }
  }
  // shop-sign lettering (was painted a few ms per frame after start-up, then uploaded in one go while exploring)
  if (!sg.done) sg.step(Infinity);
  const T5 = performance.now();
  const initChunks = detailBuilt, initDetailMs = Math.round(detailMs);

  // ---- per-frame LOD: base chunks within drawDistance; detail + signs by distance (the detail's small shadows
  // only near the camera). Only visibility flags change here — nothing is built, uploaded or allocated — and only
  // when the camera has moved.
  const baseList = [...baseChunks.values()].filter((c) => c.meshes.length);
  let lx = Infinity, ly = Infinity, lz = Infinity;
  ctx.onUpdate?.(() => {
    const cam = ctx.camera;
    if (!cam) return;
    const p = cam.position;
    if (Math.abs(p.x - lx) + Math.abs(p.y - ly) + Math.abs(p.z - lz) < 2) return;
    lx = p.x; ly = p.y; lz = p.z;
    const far = ctx.quality?.drawDistance || 3200;
    for (const c of baseList) {
      const vis = chunkDist(c, p) < far;
      for (const m of c.meshes) m.visible = vis;
    }
    // detail range × ctx.lodScale (engine CPU degrade), adopted per chunk only while that flips nothing right now
    const showWant = LOD.show * (ctx.lodScale ?? 1);
    for (const c of detailList) {
      const d = chunkDist(c, p);
      if (c.show === undefined) c.show = LOD.show;
      if (c.show !== showWant && (d < c.show) === (d < showWant)) c.show = showWant;
      const vis = d < c.show, cast = d < 420;
      for (const m of c.meshes) { m.visible = vis; m.castShadow = cast; } // (picked up by the next periodic shadow update)
      if (c.signFar) c.signFar.visible = d < SIGN_FAR;
      if (c.signNear) c.signNear.visible = d < DETAIL_NEAR;
    }
  }, 11);

  // ---- labels (one per distinct name)
  for (const rec of [...nameSeen.values()].flat()) {
    ctx.labels?.add({
      key: rec.id, text: rec.name || rec.nameZh, textZh: rec.nameZh || null, kind: 'building', priority: rec.campus ? 6 : 3,
      position: { x: rec.center[0], y: rec.topY + 3, z: rec.center[1] }, maxDistance: rec.campus ? 1400 : 700,
    });
  }

  // ---- highlight + API
  const U = mats.uniforms;
  const indexOf = (id) => (id == null ? -1 : byId.get(id)?.group ?? -1);
  const entryIndex = (e) => (e && e.kind === 'building' ? indexOf(e.key) : -1);
  ctx.events?.on('hover', (e) => { U.uHover.value = entryIndex(e); });
  ctx.events?.on('select', (e) => { U.uSelect.value = entryIndex(e); });

  ctx.buildings = {
    list: records,
    group,
    meshes,
    byId: (id) => byId.get(id) || null,
    highlight(id) { U.uSelect.value = indexOf(id); },
    hover(id) { U.uHover.value = indexOf(id); },
    streetGroup,
    get stats() {
      return {
        buildings: records.length, meshes: meshes.length, triangles: triCount, detailTriangles: detailTris, baseChunks: baseList.length,
        detailChunks: detailList.length, detailBuilt, detailMs: Math.round(detailMs), signs: sg.count, signAtlas: [sg.width, sg.height], street: street3d,
        streetMeshes: streetGroup.children.length, streetTriangles: signTris, materials: 1, layers: mats.slots.size,
        ms: { base: Math.round(T1 - T0), paint: Math.round(mats.paintMs), textures: Math.round(T2 - T1), meshes: Math.round(T3 - T2), atlas: Math.round(T4 - T3), initDetail: Math.round(T5 - T4), initDetailWork: initDetailMs, initChunks, total: Math.round(T5 - T0) },
      };
    },
  };
  console.info(`[buildings] ${records.length} buildings, ${baseList.length} base chunks (${(triCount / 1000).toFixed(0)}k tris), detail ${detailBuilt}/${detailList.length} chunks at start, ${mats.slots.size} texture layers, ${sg.count} signs, ${Math.round(T5 - T0)} ms`);
  return ctx.buildings;
}

function typeName(b) {
  const t = b.type;
  const T = {
    house: ['House', '住宅'], detached: ['House', '独栋住宅'], semidetached_house: ['Semi-detached house', '双拼住宅'], terrace: ['Row house', '联排住宅'],
    residential: ['Residential building', '住宅楼'], apartments: ['Apartment building', '公寓楼'], dormitory: ['Residence hall', '学生宿舍'],
    university: ['University building', '大学建筑'], school: ['School', '学校'], church: ['Church', '教堂'], cathedral: ['Cathedral', '大教堂'],
    synagogue: ['Synagogue', '犹太会堂'], retail: ['Shop', '商店'], commercial: ['Commercial building', '商业楼'], office: ['Office building', '办公楼'],
    garage: ['Garage', '车库'], garages: ['Garages', '车库'], parking: ['Parking garage', '停车楼'], industrial: ['Industrial building', '工业建筑'],
    public: ['Public building', '公共建筑'], civic: ['Civic building', '市政建筑'], library: ['Library', '图书馆'], roof: ['Canopy', '雨棚'],
    stadium: ['Stadium stand', '看台'], bridge: ['Skybridge', '连廊'], glasshouse: ['Glasshouse', '温室'], greenhouse: ['Greenhouse', '温室'],
  };
  const v = T[t] || (b.campus ? ['Carnegie Mellon building', '卡内基梅隆大学建筑'] : ['Building', '建筑']);
  return { en: v[0], zh: v[1] };
}
