// Gesling Stadium — CMU's football / soccer / track stadium (opened 1990 with the East Campus project; FieldTurf
// "Richard M. Lackner Field"; ~3,500 seats in the grandstand, 3,900 capacity). The home grandstand is on the north
// side, built against the East Campus Garage; the Resnik / West Wing dorms and the Tartans Pavilion overlook the
// south (visitor) sideline and the Cohon Center is the backdrop to the west end zone. A 13 x 24 ft video
// scoreboard went up in 2019.
// The terrain agent paints the turf, lines and the running track; this module adds the 3D structures:
// raked concrete grandstand with aluminium benches, aisles, handrails and a press box; four light towers;
// the video scoreboard; yellow goalposts; the perimeter fence; team benches; and a night "light pool".
import * as THREE from 'three';
import { PartBucket, registerLandmark, makeCanvas, canvasTexture, cylinderBetween, FONT_SANS, FONT_SERIF } from './lib/icons-common.js';

const STAND_ID = 'w220799870';      // OSM grandstand footprint (replaced by this model)
const PITCH_ID = 'w220799874';

// Grandstand cross-section (metres)
const ROWS = 14, TREAD = 0.8, RISE = 0.4;
const WALKWAY = 1.65;               // front cross-aisle depth
const PARAPET_H = 1.0, PARAPET_T = 0.25;
const AISLES_A = [-37.5, -12.5, 12.5, 37.5];   // aisle centres along the stand (field-frame a)
const AISLE_W = 1.3;
const STAIRS_A = [-25, 0, 25];                  // stairs from the apron to the front walkway
const STAIR_W = 2.0;
const PRESS = { a0: -14.5, a1: 15.5, depth: 4.6, h: 3.4 };

// ------------------------------------------------------------------ canvas art
function fasciaTexture(renderer) {
  // one 25 m tile of the grandstand front band
  const c = makeCanvas(2048, 80), g = c.getContext('2d');
  g.fillStyle = '#b3102b'; g.fillRect(0, 0, 2048, 80);
  g.fillStyle = '#7e0b1f'; g.fillRect(0, 0, 2048, 6); g.fillRect(0, 74, 2048, 6);
  g.fillStyle = '#ffffff'; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.font = `900 46px ${FONT_SANS}`;
  g.fillText('CARNEGIE MELLON', 560, 42);
  g.fillText('TARTANS', 1560, 42);
  // tartan swatches between words
  for (const x of [1120, 1990, 70]) tartanSwatch(g, x - 40, 14, 80, 52);
  return canvasTexture(c, { renderer, repeat: true });
}

function tartanSwatch(g, x, y, w, h) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = '#1f3b2d'; g.fillRect(x, y, w, h);
  const bands = [['#b3102b', 10], ['#0b1b3a', 6], ['#e8e2d0', 2], ['#b3102b', 10], ['#0b1b3a', 6]];
  let o = 0;
  for (const [col, bw] of bands) {
    g.globalAlpha = 0.75; g.fillStyle = col;
    g.fillRect(x + o, y, bw, h); g.fillRect(x, y + o * (h / w), w, bw * (h / w));
    o += bw + 6;
  }
  g.restore();
  g.globalAlpha = 1;
}

function pressSignTexture(renderer) {
  const c = makeCanvas(2048, 128), g = c.getContext('2d');
  g.fillStyle = '#b3102b'; g.fillRect(0, 0, 2048, 128);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 76px ${FONT_SERIF}`;
  g.fillText('GESLING STADIUM  ·  CARNEGIE MELLON', 1024, 68);
  return canvasTexture(c, { renderer });
}

function scoreboardTextures(renderer) {
  // Video board (24 x 13 ft) content: header + TARTANS + game score
  const c = makeCanvas(1024, 555), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 555);
  grd.addColorStop(0, '#12151c'); grd.addColorStop(1, '#05060a');
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 555);
  // tartan strip
  for (let x = 0; x < 1024; x += 96) tartanSwatch(g, x, 0, 96, 56);
  g.fillStyle = '#c41230'; g.fillRect(0, 56, 1024, 150);
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `900 118px ${FONT_SANS}`; g.fillText('TARTANS', 512, 136);
  // score panel
  g.font = `700 44px ${FONT_SANS}`; g.fillStyle = '#e8e8e8';
  g.fillText('CMU', 220, 262); g.fillText('GUEST', 804, 262);
  g.font = `900 170px ${FONT_SANS}`;
  g.fillStyle = '#ffcc33'; g.fillText('24', 220, 390); g.fillText('17', 804, 390);
  g.fillStyle = '#ffffff'; g.font = `700 50px ${FONT_SANS}`; g.fillText('QTR 4', 512, 300);
  g.font = `700 76px ${FONT_SANS}`; g.fillStyle = '#ff4444'; g.fillText('2:07', 512, 380);
  g.font = `600 34px ${FONT_SANS}`; g.fillStyle = '#9fb3c8'; g.fillText('DOWN 3  ·  TO GO 6  ·  BALL ON 34', 512, 500);
  // subtle LED pixel grid
  g.fillStyle = 'rgba(0,0,0,0.28)';
  for (let y = 0; y < 555; y += 4) g.fillRect(0, y, 1024, 1);
  for (let x = 0; x < 1024; x += 4) g.fillRect(x, 0, 1, 555);
  const screen = canvasTexture(c, { renderer });

  const h = makeCanvas(1024, 160), gh = h.getContext('2d');
  gh.fillStyle = '#b3102b'; gh.fillRect(0, 0, 1024, 160);
  gh.fillStyle = '#ffffff'; gh.textAlign = 'center'; gh.textBaseline = 'middle';
  gh.font = `800 64px ${FONT_SERIF}`; gh.fillText('CARNEGIE MELLON', 512, 60);
  gh.font = `700 40px ${FONT_SANS}`; gh.fillText('T A R T A N S', 512, 122);
  const header = canvasTexture(h, { renderer });

  const f = makeCanvas(1024, 96), gf = f.getContext('2d');
  gf.fillStyle = '#1b1d22'; gf.fillRect(0, 0, 1024, 96);
  gf.fillStyle = '#e7e7e7'; gf.textAlign = 'center'; gf.textBaseline = 'middle';
  gf.font = `700 50px ${FONT_SANS}`; gf.fillText('GESLING STADIUM  ·  LACKNER FIELD', 512, 50);
  const footer = canvasTexture(f, { renderer });
  return { screen, header, footer };
}

function chainLinkTexture(renderer) {
  const c = makeCanvas(64, 64), g = c.getContext('2d');
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath();
  g.moveTo(0, 32); g.lineTo(32, 0); g.lineTo(64, 32); g.lineTo(32, 64); g.closePath();
  g.moveTo(-32, 32); g.lineTo(0, 0); g.moveTo(64, 0); g.lineTo(96, 32);
  g.stroke();
  const t = canvasTexture(c, { renderer, srgb: false });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function lightPoolTexture(renderer) {
  const c = makeCanvas(256, 128), g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 64, 10, 128, 64, 128);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.8)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 128);
  return canvasTexture(c, { renderer, srgb: false });
}

// ------------------------------------------------------------------ build
async function buildStadium(ctx, def) {
  const data = ctx.data;
  const M = ctx.materials;
  const pitch = data.areas.find((a) => a.id === PITCH_ID)?.polygon
    || [[290.48, -29.13], [276.89, 17.77], [171.46, -12.58], [185.05, -59.46]];
  // field frame: centre c, u = along the field (towards the east end), v = across (towards the south stands side)
  let cx = 0, cz = 0;
  for (const [x, z] of pitch) { cx += x; cz += z; }
  cx /= pitch.length; cz /= pitch.length;
  const m1 = [(pitch[2][0] + pitch[3][0]) / 2, (pitch[2][1] + pitch[3][1]) / 2];
  const m2 = [(pitch[0][0] + pitch[1][0]) / 2, (pitch[0][1] + pitch[1][1]) / 2];
  let ux = m2[0] - m1[0], uz = m2[1] - m1[1];
  const ul = Math.hypot(ux, uz); ux /= ul; uz /= ul;
  const vx = -uz, vz = ux;
  const W = (a, b) => [cx + a * ux + b * vx, cz + a * uz + b * vz];
  const H = (a, b) => { const [x, z] = W(a, b); return ctx.heightAt(x, z); };
  const fieldY = H(0, 0);
  const yawU = Math.atan2(ux, uz);           // rotation.y that maps local +z onto u

  // Grandstand extents from the OSM footprint (fallback: surveyed numbers)
  const standB = data.buildings.find((b) => b.id === STAND_ID || b.osmId === STAND_ID);
  let a0 = -49.25, a1 = 50.65, bFront = -44.55, bBack = -58.0;
  if (standB) {
    const as = [], bs = [];
    for (const [x, z] of standB.footprint) { as.push((x - cx) * ux + (z - cz) * uz); bs.push((x - cx) * vx + (z - cz) * vz); }
    a0 = Math.min(...as); a1 = Math.max(...as); bFront = Math.max(...bs); bBack = Math.min(...bs);
  }
  const sF = -bFront, sB = -bBack;          // stand-frame "s" = distance behind the field centre line
  const yT0 = fieldY + 2.7;                 // front walkway level
  const yTop = yT0 + ROWS * RISE;
  const rowS = (k) => sF + WALKWAY + k * TREAD;   // front edge of row k's tread
  const rowY = (k) => yT0 + (k + 1) * RISE;       // tread level of row k

  // Stand frame -> world: local X = s (towards the garage), Y = up, Z = a - a0 (along the stand)
  const standM = new THREE.Matrix4().makeBasis(
    new THREE.Vector3(-vx, 0, -vz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(ux, 0, uz),
  ).setPosition(cx + a0 * ux, 0, cz + a0 * uz);
  const len = a1 - a0;
  const zOf = (a) => a - a0;

  const bucket = new PartBucket();
  const worldUV = (g, m) => (M?.applyWorldUV ? M.applyWorldUV(g, m) : g);
  const addS = (mat, geo, uv = false) => bucket.add(mat, uv ? worldUV(geo, standM) : geo, standM);

  // slightly darker, warmer concrete than the generic preset so the silver benches read against it
  const concrete = new THREE.MeshStandardMaterial({ map: M.surfaceTexture('concrete', '#a9a59c', 6, 11), roughness: 0.93 });
  concrete.name = 'stadium-concrete';
  const alu = M.color('#c5ccd3', { metalness: 0.72, roughness: 0.34 });
  const steelDark = M.get('darkMetal');
  const galv = M.color('#a3a8ad', { metalness: 0.65, roughness: 0.42 });
  const yellow = M.color('#f3c21b', { roughness: 0.45, metalness: 0.1 });
  const padRed = M.color('#a3172d', { roughness: 0.8, side: THREE.DoubleSide }); // goalpost pads + flags
  const panel = M.color('#d8d4cc', { roughness: 0.7 });
  const trim = steelDark;                    // one dark-metal material for rails, frames and trims

  // ---- grandstand concrete: stepped profile extruded along the stand
  const yBottom = Math.min(H(a0, bFront), H(a1, bFront), H((a0 + a1) / 2, bFront), fieldY) - 2.5;
  const prof = new THREE.Shape();
  prof.moveTo(sF, yBottom);
  prof.lineTo(sB, yBottom);
  prof.lineTo(sB, yTop);
  for (let k = ROWS - 1; k >= 0; k--) {
    prof.lineTo(rowS(k), rowY(k));
    prof.lineTo(rowS(k), rowY(k) - RISE);
  }
  prof.lineTo(sF, yT0);
  prof.lineTo(sF, yBottom);
  const standGeo = new THREE.ExtrudeGeometry(prof, { depth: len, bevelEnabled: false, steps: 1, curveSegments: 1 });
  addS(concrete, standGeo, true);

  // parapet along the front walkway, broken by the stairs
  const gaps = STAIRS_A.map((a) => [zOf(a) - STAIR_W / 2, zOf(a) + STAIR_W / 2]);
  const spans = [];
  let z = 0;
  for (const [g0, g1] of gaps) { if (g0 > z) spans.push([z, g0]); z = g1; }
  if (z < len) spans.push([z, len]);
  const fascia = new THREE.MeshStandardMaterial({ map: fasciaTexture(ctx.renderer), roughness: 0.6 });
  fascia.name = 'stadium-fascia';
  for (const [z0, z1] of spans) {
    const g = new THREE.BoxGeometry(PARAPET_T, PARAPET_H, z1 - z0);
    g.translate(sF + PARAPET_T / 2, yT0 + PARAPET_H / 2, (z0 + z1) / 2);
    addS(concrete, g, true);
    // red CARNEGIE MELLON / TARTANS band on the field side
    const band = new THREE.PlaneGeometry(z1 - z0, 0.62);
    band.rotateY(-Math.PI / 2);
    band.translate(sF - 0.006, yT0 + 0.5, (z0 + z1) / 2);
    const uv = band.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, (z0 + uv.getX(i) * (z1 - z0)) / 25);
    addS(fascia, band);
    // steel cap rail
    addS(steelDark, cylinderBetween([sF + PARAPET_T / 2, yT0 + PARAPET_H + 0.03, z0], [sF + PARAPET_T / 2, yT0 + PARAPET_H + 0.03, z1], 0.04, 0.04, 6));
  }

  // stairs from the apron up to the walkway
  for (const a of STAIRS_A) {
    const gy = H(a, bFront + 1.5);
    const n = Math.max(1, Math.ceil((yT0 - gy) / 0.19));
    const riser = (yT0 - gy) / n;
    for (let i = 0; i < n; i++) {
      const top = yT0 - i * riser;
      const g = new THREE.BoxGeometry(0.32, top - (gy - 0.4), STAIR_W);
      g.translate(sF - 0.16 - i * 0.32, (top + gy - 0.4) / 2, zOf(a));
      addS(concrete, g, true);
    }
    // handrails either side of the stair
    for (const side of [-1, 1]) {
      const zr = zOf(a) + side * (STAIR_W / 2 - 0.05);
      addS(steelDark, cylinderBetween([sF - n * 0.32, gy + 0.95, zr], [sF + 0.1, yT0 + 0.95, zr], 0.025, 0.025, 6));
      for (const t of [0, 0.5, 1]) {
        const ss = sF - n * 0.32 + t * (n * 0.32 + 0.1), yy = gy + t * (yT0 - gy);
        addS(steelDark, cylinderBetween([ss, yy - 0.1, zr], [ss, yy + 0.95, zr], 0.022, 0.022, 6));
      }
    }
  }

  // aisle steps (half-height steps on the rake) + centre handrails
  for (const a of AISLES_A) {
    const zc = zOf(a);
    for (let k = 0; k < ROWS; k++) {
      const g = new THREE.BoxGeometry(0.4, RISE / 2, AISLE_W);
      g.translate(rowS(k) - 0.2, rowY(k) - RISE * 0.75, zc);
      addS(concrete, g, true);
    }
    const p0 = [rowS(0) - 0.4, yT0 + 0.95, zc], p1 = [rowS(ROWS - 1) + TREAD, yTop + 0.95, zc];
    addS(steelDark, cylinderBetween(p0, p1, 0.03, 0.03, 6));
    for (let k = 0; k <= ROWS; k += 3) {
      const s = rowS(Math.min(k, ROWS - 1)) - 0.2, y = k === 0 ? yT0 + 0.2 : rowY(Math.min(k, ROWS - 1)) - RISE * 0.5;
      addS(steelDark, cylinderBetween([s, y, zc], [s, y + 0.95 + (k / ROWS) * 0.05, zc], 0.025, 0.025, 6));
    }
  }

  // aluminium bench seating
  const aisleIv = AISLES_A.map((a) => [zOf(a) - AISLE_W / 2 - 0.15, zOf(a) + AISLE_W / 2 + 0.15]);
  const pressIv = [zOf(PRESS.a0) - 0.3, zOf(PRESS.a1) + 0.3];
  const benchSegs = (k) => {
    const cuts = aisleIv.slice();
    if (rowS(k) + 0.65 > sB - PRESS.depth) cuts.push(pressIv);
    cuts.sort((p, q) => p[0] - q[0]);
    const segs = []; let z0 = 0.35;
    for (const [c0, c1] of cuts) { if (c0 > z0 + 0.5) segs.push([z0, c0]); z0 = Math.max(z0, c1); }
    if (len - 0.35 > z0 + 0.5) segs.push([z0, len - 0.35]);
    return segs;
  };
  const benchParts = [];
  for (let k = 0; k < ROWS; k++) {
    const sSeat = rowS(k) + 0.5, ySeat = rowY(k) + 0.44;
    for (const [z0, z1] of benchSegs(k)) {
      const plank = new THREE.BoxGeometry(0.3, 0.045, z1 - z0);
      plank.translate(sSeat, ySeat, (z0 + z1) / 2);
      benchParts.push(plank);
      for (let zz = z0 + 0.3; zz < z1; zz += 2.1) {
        const leg = new THREE.BoxGeometry(0.05, 0.44, 0.05);
        leg.translate(sSeat, ySeat - 0.22, zz);
        benchParts.push(leg);
      }
    }
  }
  for (const g of benchParts) addS(alu, g);

  // rear guard rail and end rails following the rake
  for (const zr of [0.15, len - 0.15]) {
    addS(steelDark, cylinderBetween([sF + 0.2, yT0 + 1.0, zr], [rowS(ROWS - 1) + TREAD - 0.2, yTop + 1.05, zr], 0.03, 0.03, 6));
    for (let k = 0; k < ROWS; k += 2) addS(steelDark, cylinderBetween([rowS(k) + 0.4, rowY(k), zr], [rowS(k) + 0.4, rowY(k) + 1.02, zr], 0.022, 0.022, 6));
  }
  addS(steelDark, cylinderBetween([sB - 0.12, yTop + 1.08, 0.2], [sB - 0.12, yTop + 1.08, len - 0.2], 0.035, 0.035, 6));
  for (let zz = 0.2; zz < len; zz += 3) addS(steelDark, cylinderBetween([sB - 0.12, yTop, zz], [sB - 0.12, yTop + 1.08, zz], 0.025, 0.025, 6));
  const rearWall = new THREE.BoxGeometry(0.2, 0.45, len);
  rearWall.translate(sB - 0.1, yTop + 0.22, len / 2);
  addS(concrete, rearWall, true);

  // ---- press box on the top rows
  const pz0 = zOf(PRESS.a0), pz1 = zOf(PRESS.a1), pLen = pz1 - pz0, pzc = (pz0 + pz1) / 2;
  const pS0 = sB - PRESS.depth, pS1 = sB - 0.08;
  const baseY = rowY(8) - RISE;
  const pbBase = new THREE.BoxGeometry(pS1 - pS0, yTop - baseY + 0.05, pLen);
  pbBase.translate((pS0 + pS1) / 2, (yTop + baseY) / 2, pzc);
  addS(concrete, pbBase, true);
  const floorY = yTop + 0.05, roofY = floorY + PRESS.h;
  // walls: solid back & ends, glazed front band
  const back = new THREE.BoxGeometry(0.25, PRESS.h, pLen);
  back.translate(pS1 - 0.125, floorY + PRESS.h / 2, pzc);
  addS(panel, back);
  for (const zz of [pz0 + 0.125, pz1 - 0.125]) {
    const e = new THREE.BoxGeometry(pS1 - pS0, PRESS.h, 0.25);
    e.translate((pS0 + pS1) / 2, floorY + PRESS.h / 2, zz);
    addS(panel, e);
  }
  const sill = new THREE.BoxGeometry(0.3, 1.0, pLen);
  sill.translate(pS0 + 0.15, floorY + 0.5, pzc);
  addS(panel, sill);
  const lintel = new THREE.BoxGeometry(0.3, 0.55, pLen);
  lintel.translate(pS0 + 0.15, roofY - 0.275, pzc);
  addS(panel, lintel);
  // glazing (lit at night) + mullions
  const glassMat = new THREE.MeshStandardMaterial({ color: '#27343f', roughness: 0.08, metalness: 0.6, emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 0 });
  glassMat.name = 'stadium-pressglass';
  M.registerNightMaterial?.(glassMat, 0.9);
  const glazing = new THREE.PlaneGeometry(pLen - 0.5, PRESS.h - 1.55);
  glazing.rotateY(-Math.PI / 2);
  glazing.translate(pS0 + 0.22, floorY + 1.0 + (PRESS.h - 1.55) / 2, pzc);
  addS(glassMat, glazing);
  for (let zz = pz0 + 0.25; zz <= pz1 - 0.2; zz += 1.8) {
    const mu = new THREE.BoxGeometry(0.08, PRESS.h - 1.55, 0.08);
    mu.translate(pS0 + 0.2, floorY + 1.0 + (PRESS.h - 1.55) / 2, zz);
    addS(trim, mu);
  }
  // roof slab with overhang, sign fascia, rooftop camera deck rail
  const roof = new THREE.BoxGeometry(pS1 - pS0 + 0.7, 0.3, pLen + 0.6);
  roof.translate((pS0 + pS1) / 2 - 0.35, roofY + 0.15, pzc);
  addS(trim, roof);
  const signMat = new THREE.MeshStandardMaterial({ map: pressSignTexture(ctx.renderer), roughness: 0.55 });
  signMat.name = 'stadium-presssign';
  const sign = new THREE.PlaneGeometry(pLen * 0.92, 0.52);
  sign.rotateY(-Math.PI / 2);
  sign.translate(pS0 - 0.012, roofY - 0.28, pzc);
  addS(signMat, sign);
  const deckRail = [[pS0 - 0.6, pz0 - 0.2], [pS1, pz0 - 0.2], [pS1, pz1 + 0.2], [pS0 - 0.6, pz1 + 0.2]];
  for (let i = 0; i < 4; i++) {
    const [s0, z0] = deckRail[i], [s1, z1] = deckRail[(i + 1) % 4];
    addS(steelDark, cylinderBetween([s0, roofY + 1.3, z0], [s1, roofY + 1.3, z1], 0.03, 0.03, 6));
  }
  for (let zz = pz0 - 0.2; zz <= pz1 + 0.2; zz += 2.5) addS(steelDark, cylinderBetween([pS0 - 0.6, roofY + 0.3, zz], [pS0 - 0.6, roofY + 1.3, zz], 0.025, 0.025, 6));
  // camera platforms / flag poles on the roof
  for (const zz of [pz0 + 2, pz1 - 2]) {
    addS(steelDark, cylinderBetween([pS1 - 0.8, roofY + 0.3, zz], [pS1 - 0.8, roofY + 7.5, zz], 0.05, 0.035, 8));
  }
  const flagMat = padRed;
  for (const zz of [pz0 + 2, pz1 - 2]) {
    const flag = new THREE.PlaneGeometry(1.8, 1.1);
    flag.translate(0.9, 0, 0);
    flag.rotateY(Math.PI / 2 - 0.4);
    flag.translate(pS1 - 0.8, roofY + 6.85, zz);
    addS(flagMat, flag);
  }

  // ---- light towers (four corners; emissive luminaires at night)
  const lampMat = new THREE.MeshStandardMaterial({ color: '#dfe6ea', roughness: 0.25, metalness: 0.1, emissive: new THREE.Color('#fff4dc'), emissiveIntensity: 0 });
  lampMat.name = 'stadium-lamps';
  M.registerNightMaterial?.(lampMat, 4.0);
  const towers = [[-62, -47.5], [62, -47.5], [-62, 43.6], [62, 43.2]];
  for (const [a, b] of towers) {
    const [x, zw] = W(a, b);
    const gy = ctx.heightAt(x, zw);
    const topY = fieldY + 24;
    bucket.add(galv, cylinderBetween([x, gy - 0.5, zw], [x, topY, zw], 0.36, 0.2, 10));
    const base = new THREE.CylinderGeometry(0.55, 0.65, 0.6, 12);
    base.translate(x, gy + 0.1, zw);
    bucket.add(concrete, worldUV(base));
    // head frame facing the field centre
    const yaw = Math.atan2(cx - x, cz - zw);
    const hm = new THREE.Matrix4().compose(new THREE.Vector3(x, topY, zw), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
    const frame = new THREE.BoxGeometry(4.4, 0.12, 0.12);
    for (const yy of [-0.2, 1.0, 2.2]) bucket.add(galv, frame.clone().translate(0, yy, 0.25), hm);
    for (const xx of [-2.2, 2.2]) bucket.add(galv, new THREE.BoxGeometry(0.12, 2.5, 0.12).translate(xx, 1.0, 0.25), hm);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        const lx = -1.8 + col * 0.9, ly = row * 0.75 + 0.15;
        const housing = new THREE.BoxGeometry(0.6, 0.45, 0.35);
        housing.rotateX(0.55);
        housing.translate(lx, ly, 0.55);
        bucket.add(trim, housing, hm);
        const lens = new THREE.PlaneGeometry(0.52, 0.38);
        lens.rotateX(0.55);
        lens.translate(lx, ly - 0.1, 0.72 + 0.08);
        bucket.add(lampMat, lens, hm);
      }
    }
    ctx.colliders?.addCircle(x, zw, 0.7, gy - 1, topY, 'stadium-tower');
  }

  // ---- video scoreboard beyond the east end zone, facing the field
  const tex = scoreboardTextures(ctx.renderer);
  const sbA = 97.5, sbB = -1.5;
  const [sbx, sbz] = W(sbA, sbB);
  const sgy = ctx.heightAt(sbx, sbz);
  const sbM = new THREE.Matrix4().compose(new THREE.Vector3(sbx, sgy, sbz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yawU + Math.PI, 0)), new THREE.Vector3(1, 1, 1));
  const boardW = 7.32, boardH = 3.96, boardY = 4.2;
  for (const xx of [-2.6, 2.6]) {
    bucket.add(trim, new THREE.BoxGeometry(0.45, boardY + boardH + 2.2, 0.45).translate(xx, (boardY + boardH + 2.2) / 2 - 0.6, -0.5), sbM);
    const foot = new THREE.CylinderGeometry(0.45, 0.5, 0.5, 10);
    foot.translate(xx, 0.1, -0.5);
    bucket.add(concrete, foot, sbM);
  }
  bucket.add(trim, new THREE.BoxGeometry(boardW + 0.5, boardH + 0.4, 0.7).translate(0, boardY + boardH / 2, -0.1), sbM);
  const screenMat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: new THREE.Color('#ffffff'), emissiveMap: tex.screen, emissiveIntensity: 1.05, roughness: 0.35, metalness: 0 });
  screenMat.name = 'stadium-screen';
  bucket.add(screenMat, new THREE.PlaneGeometry(boardW, boardH).translate(0, boardY + boardH / 2, 0.26), sbM);
  const headerMat = new THREE.MeshStandardMaterial({ map: tex.header, roughness: 0.6 });
  headerMat.name = 'stadium-sbheader';
  bucket.add(trim, new THREE.BoxGeometry(boardW + 0.5, 1.3, 0.5).translate(0, boardY + boardH + 0.95, -0.1), sbM);
  bucket.add(headerMat, new THREE.PlaneGeometry(boardW + 0.3, 1.15).translate(0, boardY + boardH + 0.95, 0.16), sbM);
  const footerMat = new THREE.MeshStandardMaterial({ map: tex.footer, roughness: 0.6 });
  footerMat.name = 'stadium-sbfooter';
  bucket.add(trim, new THREE.BoxGeometry(boardW - 1.0, 0.75, 0.4).translate(0, boardY - 0.55, -0.1), sbM);
  bucket.add(footerMat, new THREE.PlaneGeometry(boardW - 1.2, 0.62).translate(0, boardY - 0.55, 0.11), sbM);
  ctx.colliders?.addBox(sbx, sbz, 0.6, 3.3, -Math.atan2(uz, ux), sgy - 1, sgy + boardY + boardH + 2, 'stadium-scoreboard');

  // ---- goalposts (college spec: 18'6" crossbar at 10 ft, offset gooseneck)
  for (const sgn of [-1, 1]) {
    const aEnd = sgn * (ul / 2);
    const [gx, gz] = W(aEnd, 0);
    const gy = ctx.heightAt(gx, gz);
    const gm = new THREE.Matrix4().compose(new THREE.Vector3(gx, gy, gz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yawU + (sgn < 0 ? Math.PI : 0), 0)), new THREE.Vector3(1, 1, 1));
    // local: +z points out of the field (behind the end line)
    bucket.add(yellow, cylinderBetween([0, -0.5, 1.8], [0, 2.7, 1.8], 0.13, 0.12, 12), gm);
    bucket.add(yellow, cylinderBetween([0, 2.7, 1.8], [0, 3.05, 1.3], 0.12, 0.12, 12), gm);
    bucket.add(yellow, cylinderBetween([0, 3.05, 1.3], [0, 3.05, 0], 0.12, 0.12, 12), gm);
    bucket.add(yellow, cylinderBetween([-2.82, 3.05, 0], [2.82, 3.05, 0], 0.1, 0.1, 12), gm);
    for (const xx of [-2.82, 2.82]) {
      bucket.add(yellow, cylinderBetween([xx, 3.0, 0], [xx, 12.2, 0], 0.07, 0.06, 10), gm);
      const ribbon = new THREE.PlaneGeometry(0.1, 1.1);
      ribbon.translate(xx, 12.2 - 0.55, 0.05);
      bucket.add(flagMat, ribbon, gm);
    }
    const pad = new THREE.CylinderGeometry(0.34, 0.34, 2.0, 14);
    pad.translate(0, 1.0, 1.8);
    bucket.add(padRed, pad, gm);
    const [px, pz] = W(aEnd + sgn * 1.8, 0);
    ctx.colliders?.addCircle(px, pz, 0.4, gy - 1, gy + 3, 'stadium-goalpost');
  }

  // ---- team benches on the south sideline
  for (const [a0b, a1b] of [[-16, -4], [4, 16]]) {
    for (const [off, hh] of [[0, 0.45], [0.55, 0.85]]) {
      const [x0, z0] = W(a0b, 28 + off), [x1, z1] = W(a1b, 28 + off);
      const y0 = ctx.heightAt(x0, z0), y1 = ctx.heightAt(x1, z1);
      bucket.add(alu, cylinderBetween([x0, y0 + hh, z0], [x1, y1 + hh, z1], 0.12, 0.12, 4));
      for (let t = 0; t <= 1.001; t += 0.25) {
        const x = x0 + (x1 - x0) * t, zz = z0 + (z1 - z0) * t, yy = y0 + (y1 - y0) * t;
        bucket.add(alu, cylinderBetween([x, yy, zz], [x, yy + hh, zz], 0.03, 0.03, 4));
      }
    }
  }

  // ---- perimeter chain-link fence around the track (south side + both ends; north side is the stand)
  const linkTex = chainLinkTexture(ctx.renderer);
  const linkMat = new THREE.MeshStandardMaterial({ color: '#23262a', alphaMap: linkTex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 });
  linkMat.name = 'stadium-chainlink';
  // Oval around the track: curve centres at a = ±ac, radius R (outer track edge + ~1.5 m).
  // Runs from the north-west, round the west end, along the south straight and round the east end
  // until just before the sprint straight extension in the north-east.
  const R = 42.2, ac = 49.3, fenceH = 1.25;
  const fencePts = [];
  const onCurve = (centre, deg) => { const r = THREE.MathUtils.degToRad(deg); return [centre + R * Math.cos(r), -R * Math.sin(r)]; };
  for (let deg = 110; deg < 270; deg += 4) fencePts.push(onCurve(-ac, deg));
  for (let a = -ac; a < ac; a += 3.05) fencePts.push([a, R]);
  for (let deg = 270; deg <= 398; deg += 4) fencePts.push(onCurve(ac, deg));
  const fencePos = [], fenceUv = [], fenceIdx = [];
  let run = 0;
  // two gates: behind the west end zone and mid south straight
  const gatesAt = new Set([Math.round(fencePts.length * 0.25), Math.round(fencePts.length * 0.5)]);
  for (let i = 0; i < fencePts.length; i++) {
    const [a, b] = fencePts[i];
    const [x, zz] = W(a, b);
    const gy = ctx.heightAt(x, zz);
    if (i > 0) { const [pa, pb] = fencePts[i - 1]; run += Math.hypot(a - pa, b - pb); }
    fencePos.push(x, gy + 0.05, zz, x, gy + fenceH, zz);
    fenceUv.push(run / 0.12, 0, run / 0.12, fenceH / 0.12);
    if (i > 0 && !gatesAt.has(i)) { const k = (i - 1) * 2; fenceIdx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
    // posts at every sample (~3 m) and a top rail
    bucket.add(steelDark, cylinderBetween([x, gy - 0.3, zz], [x, gy + fenceH + 0.05, zz], 0.035, 0.035, 6));
    if (i > 0) {
      const [pa, pb] = fencePts[i - 1];
      const [px, pz] = W(pa, pb);
      const py = ctx.heightAt(px, pz);
      bucket.add(steelDark, cylinderBetween([px, py + fenceH, pz], [x, gy + fenceH, zz], 0.025, 0.025, 5));
    }
  }
  const fenceGeo = new THREE.BufferGeometry();
  fenceGeo.setAttribute('position', new THREE.Float32BufferAttribute(fencePos, 3));
  fenceGeo.setAttribute('uv', new THREE.Float32BufferAttribute(fenceUv, 2));
  fenceGeo.setIndex(fenceIdx);
  fenceGeo.computeVertexNormals();
  const fenceMesh = new THREE.Mesh(fenceGeo, linkMat);
  fenceMesh.name = 'stadium-fence';
  fenceMesh.castShadow = false; fenceMesh.receiveShadow = true;
  // fence colliders (segment boxes)
  for (let i = 1; i < fencePts.length; i++) {
    if (gatesAt.has(i)) continue;
    const [pa, pb] = fencePts[i - 1], [a, b] = fencePts[i];
    const [x0, z0] = W(pa, pb), [x1, z1] = W(a, b);
    const gy = ctx.heightAt(x1, z1);
    ctx.colliders?.addBox((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + 0.05, 0.08, -Math.atan2(z1 - z0, x1 - x0), gy - 1, gy + fenceH, 'stadium-fence');
  }

  // ---- assemble
  const root = new THREE.Group();
  root.name = 'landmark:stadium';
  const built = bucket.build({ name: 'stadium' });
  root.add(built);
  root.add(fenceMesh);

  // night: soft pool of light on the field from the four towers (additive, costs one draw call)
  const poolMat = new THREE.MeshBasicMaterial({ map: lightPoolTexture(ctx.renderer), color: '#fff1d6', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  poolMat.name = 'stadium-lightpool';
  const pool = new THREE.PlaneGeometry(190, 92, 38, 18);
  pool.rotateX(-Math.PI / 2);
  const pp = pool.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const a = pp.getX(i), b = pp.getZ(i);
    const [x, zz] = W(a, b);
    pp.setXYZ(i, x, ctx.heightAt(x, zz) + 0.08, zz);
  }
  pool.computeVertexNormals();
  const poolMesh = new THREE.Mesh(pool, poolMat);
  poolMesh.name = 'stadium-lightpool';
  poolMesh.renderOrder = 2;
  poolMesh.visible = false;
  root.add(poolMesh);
  ctx.onUpdate?.(() => {
    const nf = ctx.env?.state?.nightFactor ?? 0;
    const k = Math.max(0, Math.min(1, (nf - 0.35) / 0.4));
    poolMesh.visible = k > 0.01;
    poolMat.opacity = 0.2 * k;
  }, 20);

  // ---- colliders for the grandstand shell (front face below the parapet, ends, press box)
  const segBox = (a0s, a1s, b0s, b1s, y0, y1, tag) => {
    const [x0, z0] = W((a0s + a1s) / 2, (b0s + b1s) / 2);
    ctx.colliders?.addBox(x0, z0, Math.abs(a1s - a0s) / 2, Math.abs(b1s - b0s) / 2, -Math.atan2(uz, ux), y0, y1, tag);
  };
  for (const [z0, z1] of spans) segBox(a0 + z0, a0 + z1, bFront, bFront - PARAPET_T, yBottom, yT0 + PARAPET_H, 'stadium-stand');
  segBox(a0, a0 + 0.3, bFront, bBack, yBottom, yTop + 1.1, 'stadium-stand');
  segBox(a1 - 0.3, a1, bFront, bBack, yBottom, yTop + 1.1, 'stadium-stand');
  segBox(PRESS.a0, PRESS.a1, bBack + PRESS.depth, bBack, yTop - 2.2, roofY + 1.4, 'stadium-pressbox');

  // walkables: the merged concrete mesh (tiers, walkway, stairs) — walk mode can climb the stand
  const concreteMesh = built.children.find((m) => m.material === concrete);
  if (concreteMesh) ctx.walkables?.add(concreteMesh);

  const labelPos = [cx, fieldY + 2, cz];
  registerLandmark(ctx, def, root, { position: labelPos, radius: 95, labelY: 12, priority: 9, pickObject: built });
  return root;
}

const STADIUM_DEF = {
  key: 'stadium',
  name: 'Gesling Stadium',
  nameZh: '盖斯林体育场',
  osmIds: [STAND_ID],
  build(ctx) { return buildStadium(ctx, STADIUM_DEF); },
};

export default [STADIUM_DEF];
