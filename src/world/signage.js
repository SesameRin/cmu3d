// Shop signage for the generic street buildings: one canvas texture ATLAS holding every fascia sign board and
// projecting (blade) sign with the business name drawn in a type-specific style, plus a strip of solid colour
// swatches used by the small street furniture (café tables, chairs, umbrellas, brackets). Everything that samples
// the atlas shares ONE material, so the signage of a 250 m chunk is a single draw call.
//
// Usage: const sg = createSignage(ctx); const h = sg.board(text, style, aspect); …; sg.build() once all requests are
// in → h.rect = [u0, v0, u1, v1] (texture coords of the painted cell), sg.swatch(name) → [u, v], sg.material.
// Names are drawn as written in OSM (English, accents kept); no logos — only lettering and colours.
import * as THREE from 'three';

// ---------------------------------------------------------------- business → sign style
const F = {
  sans: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
  sansBold: '"Arial Black", "Segoe UI Black", "Helvetica Neue", Arial, sans-serif',
  condensed: '"Franklin Gothic Medium", "Arial Narrow", "Roboto Condensed", Arial, sans-serif',
  impact: 'Impact, "Arial Black", "Haettenschweiler", sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  classic: '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif',
  script: '"Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive',
  rounded: '"Trebuchet MS", "Verdana", "Segoe UI", sans-serif',
  mono: '"Courier New", Courier, monospace',
};

// Style = { font, weight, italic, caps, text (colour), board, border?, sub?, awning?: {color, striped} | null,
//           canopy?: bool, blade?: bool, light?: bool (light board → back-lit box sign), tables?: number }
// Brand-ish colours only (text in a generic typeface, no logos).
const BRANDS = [
  [/^starbucks/i, { text: 'STARBUCKS COFFEE', font: F.sans, weight: 700, board: '#161616', color: '#f4f2ec', awning: null, blade: true, tables: 2 }],
  [/chipotle/i, { text: 'CHIPOTLE', font: F.sansBold, weight: 900, board: '#3f1a10', color: '#efe3cf', awning: null, canopy: true }],
  [/^subway/i, { text: 'SUBWAY', font: F.sansBold, weight: 900, italic: true, board: '#0f6b3a', color: '#ffd23f', awning: null }],
  [/^chase$/i, { text: 'CHASE', font: F.sans, weight: 700, board: '#11418f', color: '#ffffff', awning: null, canopy: true, blade: false }],
  [/^pnc/i, { text: 'PNC BANK', font: F.sans, weight: 700, board: '#1f4e7a', color: '#ffffff', canopy: false }],
  [/citizens bank/i, { text: 'Citizens Bank', font: F.sans, weight: 600, board: '#ffffff', color: '#138a64', light: true }],
  [/union grill/i, { text: 'UNION GRILL', font: F.classic, weight: 700, board: '#171717', color: '#e8d6a2', border: '#9a7b3c', awning: { color: '#1e1e1e' }, blade: true }],
  [/sushi fuku/i, { text: 'SUSHI FUKU', font: F.sansBold, weight: 900, board: '#b3151c', color: '#ffffff', awning: null, blade: true }],
  [/cr[eê]pes parisiennes/i, { text: 'Crêpes', sub: 'PARISIENNES', font: F.script, weight: 400, board: '#2f6f78', color: '#ffffff', border: '#e8e2d0', awning: { color: '#264f57' }, tables: 2 }],
  [/eatunique/i, { text: 'eatunique', font: F.rounded, weight: 700, board: '#141414', color: '#f2f2f2', awning: { color: '#141414' }, tables: 3 }],
  [/lucca/i, { text: 'Lucca', sub: 'RISTORANTE', font: F.classic, weight: 400, italic: true, board: '#203a2a', color: '#d9c07a', border: '#b8994a', awning: { color: '#203a2a' }, tables: 3 }],
  [/ali baba/i, { text: 'Ali Baba', font: F.classic, weight: 700, board: '#5e1a17', color: '#e6c56e', border: '#b58f3b', awning: { color: '#7a221e' } }],
  [/rose tea/i, { text: 'Rose Tea Cafe', font: F.rounded, weight: 700, board: '#fbf6ef', color: '#b52a4a', light: true, awning: null }],
  [/wushiland/i, { text: 'Wushiland Boba', font: F.rounded, weight: 700, board: '#f2c21a', color: '#2a2a2a', light: true }],
  [/grapow/i, { text: 'GRAPOW', font: F.sansBold, weight: 900, board: '#e0592a', color: '#ffffff', awning: null }],
  [/pepper space/i, { text: 'Pepper Space', font: F.rounded, weight: 700, board: '#1d1d1d', color: '#e2442f' }],
  [/dunkin/i, { text: "DUNKIN'", font: F.sansBold, weight: 900, board: '#ffffff', color: '#e8642c', light: true }],
  [/mcdonald/i, { text: "McDonald's", font: F.sansBold, weight: 900, board: '#c8102e', color: '#ffc72c' }],
  [/panera/i, { text: 'Panera Bread', font: F.serif, weight: 700, board: '#4a5a25', color: '#f3ead2', awning: { color: '#4a5a25' } }],
  [/primanti/i, { text: 'PRIMANTI BROS.', font: F.impact, weight: 400, board: '#141414', color: '#f6d33c' }],
  [/jimmy john/i, { text: "JIMMY JOHN'S", font: F.sansBold, weight: 900, board: '#ffffff', color: '#d81e2a', light: true }],
  [/noodles & company/i, { text: 'noodles & company', font: F.rounded, weight: 700, board: '#b4202a', color: '#ffffff' }],
  [/einstein/i, { text: 'EINSTEIN BROS. BAGELS', font: F.sansBold, weight: 900, board: '#2a3b6b', color: '#f5c342' }],
  [/crazy mocha/i, { text: 'Crazy Mocha', font: F.script, weight: 400, board: '#3b2417', color: '#f0dcb4', awning: { color: '#3b2417' }, tables: 2 }],
];

const HOUSE_BOARDS = ['#1d3a2b', '#5b1d22', '#1c2a44', '#161616', '#3a2a1c', '#2c4a4a', '#4a2a4a', '#6a2a1a', '#223344', '#2e2e2e'];
const LIGHT_BOARDS = ['#f3efe4', '#e9e2cf', '#ffffff', '#f5e9c8'];
const GOLD = ['#e2c67a', '#d8b865', '#f0dca0'];
const CREAM = ['#f2ead6', '#ffffff', '#f6efdc'];
export const AWNING_COLORS = ['#1f5a3a', '#7a1f2b', '#1f2f55', '#262626', '#a51f24', '#b89b6a', '#1f6f72', '#c4622d', '#2446a0', '#4a4a4a', '#5a2a4a', '#2d5a2a'];

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// Clean an OSM name for a sign board.
export function signText(name) {
  return String(name || '')
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/\s+-\s+[A-Z][A-Z\s]+$/, '')   // "WILD BLUE SUSHI - RUGE ATRIUM" -> "WILD BLUE SUSHI"
    .replace(/\s+/g, ' ').trim();
}

// biz = { name, type (poi type or 'retail'), cuisine? } → style object (deterministic per name)
export function businessStyle(biz) {
  const name = signText(biz.name);
  for (const [re, st] of BRANDS) if (re.test(name)) return { ...defaults(biz, name), ...st };
  return defaults(biz, name);
}

function defaults(biz, name) {
  const h = hash(name || 'x');
  const pickH = (arr, k = 0) => arr[((h >>> (k * 3)) + k) % arr.length];
  const t = biz.type || 'retail', cu = String(biz.cuisine || '').toLowerCase();
  const st = { text: name, font: F.sans, weight: 700, italic: false, caps: false, board: pickH(HOUSE_BOARDS), color: pickH(CREAM, 1), awning: null, blade: false, tables: 0 };
  const awn = (k) => ({ color: pickH(AWNING_COLORS, k), striped: ((h >>> 11) & 3) === 0 });
  if (t === 'cafe' || t === 'ice_cream') {
    Object.assign(st, { font: (h & 1) ? F.script : F.serif, weight: (h & 1) ? 400 : 700, italic: !(h & 1), color: pickH(CREAM, 2), awning: (h & 4) ? awn(1) : null, blade: true, tables: 2 + (h & 1) });
    if (/bubble_tea|tea/.test(cu)) Object.assign(st, { font: F.rounded, italic: false, weight: 700, board: pickH(LIGHT_BOARDS, 3), color: pickH(['#c2185b', '#6a1b9a', '#00796b', '#e65100'], 4), light: true, tables: 1 });
  } else if (t === 'restaurant') {
    Object.assign(st, { font: (h & 2) ? F.classic : F.serif, weight: 700, color: pickH(GOLD, 2), border: (h & 8) ? '#a88a4a' : null, awning: (h & 16) ? null : awn(2), blade: !!(h & 32), tables: (h & 64) ? 2 : 0 });
    if (/sushi|japanese|ramen|korean/.test(cu)) Object.assign(st, { font: F.sansBold, weight: 900, board: pickH(['#b3151c', '#161616', '#1d2b45'], 5), color: '#ffffff', border: null });
    else if (/chinese|thai|taiwanese|asian|vietnamese/.test(cu)) Object.assign(st, { font: F.sansBold, weight: 900, board: pickH(['#9e1b1b', '#1a1a1a', '#6b1414'], 5), color: '#f3cf6a' });
    else if (/italian|pizza/.test(cu)) Object.assign(st, { font: F.classic, italic: true, board: pickH(['#1f3b2a', '#6b1a1a', '#161616'], 5), color: pickH(CREAM, 3) });
    else if (/mexican|latin|caribbean/.test(cu)) Object.assign(st, { font: F.impact, weight: 400, board: pickH(['#c4622d', '#1f6f72', '#7a1f2b'], 5), color: '#ffffff' });
    else if (/indian|syrian|middle_eastern|mediterranean|kebab|arab|moroccan/.test(cu)) Object.assign(st, { font: F.classic, board: pickH(['#5e1a17', '#1f3b2a', '#3a2a1c'], 5), color: pickH(GOLD, 3) });
  } else if (t === 'fast_food') {
    Object.assign(st, { font: (h & 1) ? F.impact : F.sansBold, weight: 900, caps: true, board: pickH(['#c8102e', '#0f6b3a', '#1c2a44', '#f2c21a', '#e0592a', '#161616'], 2), color: '#ffffff' });
    if (st.board === '#f2c21a') { st.color = '#1a1a1a'; st.light = true; }
  } else if (t === 'bank' || t === 'atm') {
    Object.assign(st, { font: F.sans, weight: 700, board: pickH(['#11418f', '#1f4e7a', '#0e5a4a', '#2a2a2a'], 2), color: '#ffffff', canopy: true });
  } else if (t === 'bar' || t === 'pub') {
    Object.assign(st, { font: F.classic, weight: 700, caps: true, board: pickH(['#161616', '#1d3a2b', '#3a1a14'], 2), color: pickH(GOLD, 3), border: '#9a7b3c', blade: true });
  } else if (t === 'pharmacy') {
    Object.assign(st, { font: F.sans, weight: 700, board: '#ffffff', color: '#c8102e', light: true });
  } else if (t === 'generic') {
    Object.assign(st, { font: (h & 1) ? F.condensed : F.sans, weight: 700, caps: true, board: (h & 2) ? pickH(LIGHT_BOARDS, 3) : pickH(HOUSE_BOARDS, 4), awning: (h & 4) ? awn(3) : null });
    if (LIGHT_BOARDS.includes(st.board)) { st.color = pickH(['#1c2a44', '#5b1d22', '#1d3a2b', '#222222'], 5); st.light = true; }
  } else if (t === 'office') {
    Object.assign(st, { font: F.serif, weight: 400, board: pickH(['#1c2a44', '#2e2e2e', '#3a2a1c'], 2), color: pickH(GOLD, 3) });
  } else {
    Object.assign(st, { awning: (h & 4) ? awn(3) : null });
  }
  if (st.caps) st.text = st.text.toUpperCase();
  return st;
}

// Generic category words for unnamed shop units (no invented business names).
export const GENERIC_SIGNS = ['PIZZA', 'DELI', 'CLEANERS', 'BARBER', 'NAILS', 'PHONE REPAIR', 'BOOKS', 'FLOWERS', 'OPTICAL', 'LAUNDROMAT', 'TAILOR', 'GIFTS', 'CONVENIENCE', 'SALON', 'COPY & PRINT', 'COFFEE'];

// ---------------------------------------------------------------- atlas
const SWATCHES = {
  black: '#1b1c1d', metal: '#2e3033', grey: '#6b6e70', white: '#efede6', chrome: '#b9bdc0', wood: '#7a5537', teak: '#9a6e45',
  brass: '#b08a3e', green: '#1f5a3a', red: '#8e1f28', navy: '#1f2f55', cream: '#e9e0c8', terracotta: '#9d4f36', plant: '#3f5f2b',
  orange: '#c4622d', teal: '#1f6f72', slate: '#3e4249',
};

export function createSignage(ctx) {
  const low = ctx.quality?.level === 'low';
  const S = low ? 0.5 : 1;
  const RH = Math.round(76 * S);   // row height (px) of a fascia sign cell
  const AW = Math.round(2048 * S); // atlas width
  const GUT = 3;                   // gutter (px) around every cell, filled with the cell's background
  const items = [];
  const byKey = new Map();
  const styleKey = (st) => [st.board, st.color, st.font, st.weight, st.italic ? 1 : 0, st.border || '', st.sub || '', st.light ? 1 : 0].join('|');

  // Fascia sign cell for a text + style (shared by every board showing it). The cell's aspect follows the text
  // length (2.5:1 … 7:1); a wider board shows the cell in its middle and repeats the plain board colour at the ends.
  function board(text, style) {
    const k = 'b|' + text + '|' + styleKey(style);
    if (byKey.has(k)) return byKey.get(k);
    const aspect = Math.min(7, Math.max(2.5, text.length * 0.5 + 1.6 + (style.sub ? 0.5 : 0)));
    const it = { kind: 'board', text, style, aspect, rect: null };
    items.push(it); byKey.set(k, it);
    return it;
  }
  // Projecting sign: a 3:2 panel (the name wrapped on up to two lines).
  function blade(text, style) {
    const k = 'p|' + text + '|' + styleKey(style);
    if (byKey.has(k)) return byKey.get(k);
    const it = { kind: 'blade', text, style, aspect: 1.5, rect: null };
    items.push(it); byKey.set(k, it);
    return it;
  }
  // Extra solid swatch (e.g. a cornice paint colour) → name for swatch(); call before build()
  const extraSwatches = new Map();
  function color(hex) {
    const k = 'c' + String(hex).toLowerCase();
    if (!extraSwatches.has(k)) extraSwatches.set(k, hex);
    return k;
  }

  let built = null;
  const swatchUV = new Map();
  function swatch(name) { return swatchUV.get(name) || swatchUV.get('metal'); }

  function fitFont(g, style, text, maxW, maxH, weightOverride) {
    const it = style.italic ? 'italic ' : '';
    let px = maxH;
    const font = (p) => `${it}${weightOverride ?? style.weight ?? 700} ${Math.max(6, Math.floor(p))}px ${style.font}`;
    g.font = font(px);
    let w = g.measureText(text).width;
    if (w > maxW) { px *= maxW / w; g.font = font(px); w = g.measureText(text).width; }
    return { px, w };
  }

  function paintCell(g, ge, it, x, y, w, h) {
    const st = it.style;
    // background (+ gutter)
    g.fillStyle = st.board; g.fillRect(x - GUT, y - GUT, w + GUT * 2, h + GUT * 2);
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, 'rgba(255,255,255,0.10)'); grd.addColorStop(0.5, 'rgba(255,255,255,0)'); grd.addColorStop(1, 'rgba(0,0,0,0.16)');
    g.fillStyle = grd; g.fillRect(x, y, w, h);
    // frame line
    const lw = Math.max(1, Math.round(h * 0.035));
    g.strokeStyle = st.border || 'rgba(0,0,0,0.35)'; g.lineWidth = lw;
    g.strokeRect(x + lw * 1.5, y + lw * 1.5, w - lw * 3, h - lw * 3);
    if (st.light) { ge.fillStyle = 'rgba(255,248,230,0.55)'; ge.fillRect(x - GUT, y - GUT, w + GUT * 2, h + GUT * 2); }
    // text
    g.textAlign = 'center'; g.textBaseline = 'middle';
    ge.textAlign = 'center'; ge.textBaseline = 'middle';
    const lines = [];
    if (it.kind === 'blade') {
      const words = it.text.split(' ');
      if (words.length >= 2 && it.text.length > 7) {
        const mid = Math.ceil(words.length / 2);
        lines.push(words.slice(0, mid).join(' '), words.slice(mid).join(' '));
      } else lines.push(it.text);
    } else lines.push(it.text);
    const sub = it.kind === 'board' && st.sub ? st.sub : null;
    const mainH = (sub ? 0.5 : lines.length > 1 ? 0.36 : 0.62) * h;
    const cx = x + w / 2;
    let cy = y + h * (sub ? 0.4 : lines.length > 1 ? 0.3 : 0.52);
    for (const line of lines) {
      const { px } = fitFont(g, st, line, w * 0.86, mainH);
      ge.font = g.font;
      // soft drop shadow for legibility, then the letters
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillText(line, cx + px * 0.03, cy + px * 0.04);
      g.fillStyle = st.color; g.fillText(line, cx, cy);
      ge.fillStyle = st.light ? 'rgba(0,0,0,0)' : st.color; if (!st.light) ge.fillText(line, cx, cy);
      cy += h * 0.4;
    }
    if (sub) {
      fitFont(g, { ...st, italic: false, font: F.sans }, sub, w * 0.6, h * 0.2, 600);
      g.fillStyle = st.color; g.fillText(sub, cx, y + h * 0.8);
      if (!st.light) { ge.font = g.font; ge.fillStyle = st.color; ge.fillText(sub, cx, y + h * 0.8); }
    }
  }

  function build() {
    if (built) return built;
    const M = ctx.materials;
    // shelf packing: swatch row first, then cells by decreasing width
    const cells = items.map((it) => ({ it, w: Math.round(RH * it.aspect), h: RH }));
    cells.sort((a, b) => b.w - a.w);
    const pad = GUT * 2;
    const rows = [];
    let y = Math.round(24 * S) + pad; // swatch strip
    let rowX = AW, rowY = y - RH - pad;
    for (const c of cells) {
      if (rowX + c.w + pad > AW) { rowY += RH + pad; rowX = 0; rows.push(rowY); }
      c.x = rowX + GUT; c.y = rowY + GUT; rowX += c.w + pad;
    }
    const AH = Math.max(64, Math.ceil((rowY + RH + pad + 4) / 4) * 4);
    // emissive (night glow of the letters / light boxes) at half resolution
    const cMap = M.makeCanvas(AW, AH), cEm = M.makeCanvas(AW / 2, Math.ceil(AH / 2));
    const g = cMap.getContext('2d'), ge = cEm.getContext('2d');
    g.fillStyle = '#202020'; g.fillRect(0, 0, AW, AH);
    ge.fillStyle = '#000'; ge.fillRect(0, 0, AW, AH);
    ge.setTransform(0.5, 0, 0, 0.5, 0, 0);
    // swatches (solid squares; sampled at their centres)
    const sw = Math.round(24 * S);
    let sx = 0;
    for (const [name, col] of [...Object.entries(SWATCHES), ...extraSwatches]) {
      if (sx + sw > AW) break;
      g.fillStyle = col; g.fillRect(sx, 0, sw, sw);
      swatchUV.set(name, [(sx + sw / 2) / AW, 1 - (sw / 2) / AH]);
      sx += sw;
    }
    for (const c of cells) {
      paintCell(g, ge, c.it, c.x, c.y, c.w, c.h);
      // canvas y is down; texture v is up (flipY)
      c.it.rect = [c.x / AW, 1 - (c.y + c.h) / AH, (c.x + c.w) / AW, 1 - c.y / AH];
      c.it.edgeU = (c.x + Math.max(3, c.h * 0.08)) / AW; // a plain column inside the frame (for board extensions)
    }
    const map = M.canvasTexture(cMap, { release: true });
    const emissiveMap = M.canvasTexture(cEm, { release: true });
    for (const t of [map, emissiveMap]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.repeat.set(1, 1); }
    const material = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, roughness: 0.55, metalness: 0.1 });
    material.name = 'street-signage';
    M.registerNightMaterial(material, 1.15);
    built = { material, width: AW, height: AH, count: items.length };
    items.length = 0; byKey.clear();
    return built;
  }

  return { board, blade, color, build, swatch, get items() { return items; } };
}
