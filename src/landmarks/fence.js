// The Fence — CMU's legendary painted fence on the Cut.
// Built in 1923 as a wooden rail fence, it became "the most painted object in the world" (Guinness) under
// decades of nightly coats; it collapsed under the weight of its paint in 1993 and was rebuilt in steel and
// concrete at the same spot, where the painting simply started over. Students paint it between midnight and
// dawn and then "guard" their message with paintbrushes.
//
// Model: 8 chunky posts + 2 rails sculpted as a signed-distance field (smooth union + lumpy noise + drips)
// and meshed with Surface Nets, so every edge is rounded and blobby like thousands of layers of latex.
// Paint is a large canvas texture looked up in object space by a small shader patch (front and back sides
// carry different student messages). Plus trampled/splattered ground and a few paint cans.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { meshSDFSteps, smin, sdRoundBox, sdEllipsoid, sdRoundCone, makeNoise3 } from './lib/icons-sdf.js';
import { PartBucket, registerLandmark, makeCanvas, canvasTexture, rng, FONT_SANS, FONT_CJK, cylinderBetween, tint, mergeCompatible, makeLOD, deferRefine } from './lib/icons-common.js';

const FENCE_ID = 'w39545443';
const FENCE_LOD_FAR = 60;     // sculpted fence within this distance of its middle, rounded boxes beyond

// Fence proportions (metres, painted size)
const N_POSTS = 8;
const POST_HALF = 0.2;        // posts ~0.4 m square after decades of paint
const POST_TOP = 1.55;
const RAILS = [               // [centre y, half height, half depth]
  [1.14, 0.19, 0.16],
  [0.54, 0.18, 0.16],
];
const TEX_MARGIN = 0.45;      // texture window extends this far beyond the end posts
const TEX_Y0 = -0.12, TEX_H = 1.84;

export function fenceField(L, seed) {
  const spacing = L / (N_POSTS - 1);
  const noise = makeNoise3(seed);
  const r = rng(seed * 31 + 7);
  // Drips hanging under the rails and down post faces, in 0.2 m bins along the fence for fast lookup.
  const BIN = 0.2, NB = Math.ceil((L + 1) / BIN) + 1;
  const binOf = (x) => Math.max(0, Math.min(NB - 1, Math.floor((x + 0.5) / BIN)));
  const bins = Array.from({ length: NB }, () => []);
  const addDrip = (x, yTop, z, len, rad) => { bins[binOf(x)].push([x, yTop, z, len, rad]); };
  for (const [yc, hy, hz] of RAILS) {
    for (let x = 0.3; x < L - 0.3; x += 0.12 + r() * 0.35) {
      if (r() < 0.35) continue;
      const side = r() < 0.5 ? -1 : 1;
      const z = side * (hz - 0.035 - r() * 0.05);
      addDrip(x, yc - hy + 0.03, z, 0.03 + r() ** 2 * 0.16, 0.011 + r() * 0.013);
    }
  }
  for (let i = 0; i < N_POSTS; i++) {
    const xp = i * spacing;
    for (let k = 0; k < 5; k++) {
      const side = r() < 0.5 ? -1 : 1;
      addDrip(xp + (r() - 0.5) * 0.26, 0.2 + r() * 1.1, side * (POST_HALF + 0.005), 0.05 + r() * 0.2, 0.012 + r() * 0.012);
    }
  }

  const postSDF = (x, y, z, i) => {
    const lx = x - i * spacing;
    // square post with generously rounded edges, a little fatter at the bottom where paint pools
    const swell = 0.025 * Math.max(0, 0.5 - y);
    let d = sdRoundBox(lx, y, z, 0, (POST_TOP - 0.5) / 2 - 0.1, 0, POST_HALF + swell, (POST_TOP + 0.5) / 2 - 0.02, POST_HALF + swell, 0.085);
    // domed "paint cap" on top
    d = smin(d, sdEllipsoid(lx, y - (POST_TOP - 0.09), z, POST_HALF + 0.012, 0.1, POST_HALF + 0.012), 0.06);
    // puddled collar at the ground
    d = smin(d, sdEllipsoid(lx, y + 0.02, z, POST_HALF + 0.09, 0.07, POST_HALF + 0.09), 0.05);
    return d;
  };

  const dist = (x, y, z) => {
    // only the nearest post can influence the field (posts are > 2 m apart, blend radius 9 cm)
    const pi = Math.max(0, Math.min(N_POSTS - 1, Math.round(x / spacing)));
    let d = postSDF(x, y, z, pi);
    // rails, with a slight sag between posts (paint is thicker mid-span)
    const t = ((x / spacing) % 1 + 1) % 1;
    const sag = Math.sin(t * Math.PI) * 0.012;
    for (let i = 0; i < RAILS.length; i++) {
      const yc = RAILS[i][0], hy = RAILS[i][1], hz = RAILS[i][2];
      if (Math.abs(y + sag - yc) - hy > d + 0.09) continue;   // cannot affect the smooth union
      d = smin(d, sdRoundBox(x, y + sag, z, L / 2, yc, 0, L / 2, hy, hz + sag * 0.5, 0.06), 0.09);
    }
    if (d > 0.3) return d;
    // drips
    for (let bb = binOf(x - 0.08), b1 = binOf(x + 0.08); bb <= b1; bb++) {
      const list = bins[bb];
      for (let k = 0; k < list.length; k++) {
        const q = list[k];
        if (Math.abs(x - q[0]) > 0.08 || y > q[1] + 0.06 || y < q[1] - q[3] - 0.06) continue;
        d = smin(d, sdRoundCone(x, y, z, q[0], q[1], q[2], q[0], q[1] - q[3], q[2] + Math.sign(q[2]) * 0.004, q[4] * 0.6, q[4]), 0.025);
      }
    }
    // lumpy layers of paint (only matters near the surface)
    if (d > 0.06) return d;
    return d + 0.011 * noise(x * 5.3, y * 5.3, z * 5.3) + 0.005 * noise(x * 13.1 + 7, y * 13.1, z * 13.1);
  };
  return { dist, spacing };
}

// ------------------------------------------------------------------ paint texture
const PAINT = ['#e8202a', '#ffd21a', '#1f7ae0', '#19b36b', '#ff7a1a', '#9b3fd1', '#ff4fa3', '#ffffff', '#101010', '#23c4d9', '#b5e61d', '#c41230'];

const TEX_W = 4096, TEX_H_PX = 256;

// The two painted faces: +z (front, facing the Cut) and -z (back)
const FRONT = {
  bg: '#c41230', accent: '#ffffff', cap: '#ffd21a', posts: ['#1b1b1b', '#ffd21a', '#ffffff', '#1f5a3a'],
  sprinkles: ['#ffffff', '#ffd21a', '#111111'],
  lines: [
    { text: 'GO TARTANS! ♥ CMU CLASS OF 2029', y: 1.135, size: 33, fill: '#ffffff', stroke: '#111111' },
    { text: 'HAPPY BDAY SCOTTY ★ BUGGY ★ CARNIVAL', y: 0.535, size: 31, fill: '#ffd21a', stroke: '#111111' },
  ],
};
const BACK = {
  bg: '#1f7ae0', accent: '#ffd21a', cap: '#ff4fa3', posts: ['#ff4fa3', '#ffffff', '#b5e61d', '#9b3fd1'],
  sprinkles: ['#ffd21a', '#ff4fa3', '#ffffff'],
  bays: { text: '你好★CMU!', size: 112, fill: '#ffd21a', stroke: '#14224a' },
};
// Quick base coats (front red, back blue, coloured posts) so the texture exists from the first frame; the full
// paint job (paintFenceSteps) runs later in idle time and repaints the same canvas.
function paintFenceBase(L, spacing, renderer) {
  const c = makeCanvas(TEX_W, TEX_H_PX), g = c.getContext('2d');
  const Wm = L + TEX_MARGIN * 2, sx = (TEX_W / 2) / Wm;
  [FRONT, BACK].forEach((cfg, back) => {
    const ox = back * TEX_W / 2;
    g.fillStyle = cfg.bg; g.fillRect(ox, 0, TEX_W / 2, TEX_H_PX);
    for (let i = 0; i < N_POSTS; i++) {
      const xm = back ? Wm - (i * spacing + TEX_MARGIN) : i * spacing + TEX_MARGIN;
      g.fillStyle = cfg.posts[i % cfg.posts.length];
      g.fillRect(ox + (xm - 0.22) * sx, 0, 0.44 * sx, TEX_H_PX);
    }
  });
  const tex = canvasTexture(c, { renderer });
  tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// The full paint job on the texture's canvas, as a step generator (a few ms per step).
function* paintFenceSteps(tex, L, spacing) {
  const W = TEX_W, H = TEX_H_PX;
  const c = tex.image, g = c.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  const Wm = L + TEX_MARGIN * 2;               // metres covered by one half
  const sx = (W / 2) / Wm, sy = H / TEX_H;     // px per metre
  const r = rng(1923);
  const posts = Array.from({ length: N_POSTS }, (_, i) => i * spacing);

  // Drawing space per side: centimetres, X from the viewer's left edge, Y from the texture top (y = TEX_Y0 + TEX_H)
  const toY = (yWorld) => (TEX_Y0 + TEX_H - yWorld) * 100;
  const side = (back) => {
    g.setTransform(sx / 100, 0, 0, sy / 100, back ? W / 2 : 0, 0);
    // viewer-left X (cm) of a local fence x
    return (x) => (back ? Wm - (x + TEX_MARGIN) : x + TEX_MARGIN) * 100;
  };

  const blob = (x, y, rx, ry, col, n = 9) => {
    g.fillStyle = col; g.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, k = 0.7 + r() * 0.5;
      const px = x + Math.cos(a) * rx * k, py = y + Math.sin(a) * ry * k;
      i ? g.lineTo(px, py) : g.moveTo(px, py);
    }
    g.closePath(); g.fill();
  };
  const drip = (x, y, len, w, col) => {
    g.fillStyle = col;
    g.fillRect(x - w / 2, y, w, len);
    g.beginPath(); g.arc(x, y + len, w * 0.85, 0, Math.PI * 2); g.fill();
  };

  function* paintSide(back, cfg) {
    const X = side(back);
    const totalW = Wm * 100, totalH = TEX_H * 100;
    // 1) decades of older coats peeking through (chaotic multicolour)
    for (let i = 0; i < 260; i++) blob(r() * totalW, r() * totalH, 8 + r() * 45, 5 + r() * 25, PAINT[(r() * PAINT.length) | 0]);
    yield;
    // 2) current base coat with a ragged lower edge + ends
    g.fillStyle = cfg.bg;
    g.beginPath();
    const x0 = X(back ? L : 0) - 30 - r() * 10, x1 = X(back ? 0 : L) + 30 + r() * 10;
    g.moveTo(x0, 0); g.lineTo(x1, 0);
    for (let yy = 0; yy <= totalH - 10; yy += 12) g.lineTo(x1 + (r() - 0.5) * 12, yy);
    for (let xx = x1; xx >= x0; xx -= 9) g.lineTo(xx, toY(0.1 + r() * 0.12 + (r() < 0.1 ? 0.15 : 0)));
    g.closePath(); g.fill();
    // brush streaks in the base coat
    for (let i = 0; i < 900; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      g.fillRect(x0 + r() * (x1 - x0), toY(0.2 + r() * 1.35), 20 + r() * 90, 1 + r() * 2.5);
    }
    yield;
    // 3) post decorations (each post is a little totem of colour)
    posts.forEach((xp, i) => {
      const cx = X(xp);
      const col = cfg.posts[i % cfg.posts.length];
      g.fillStyle = col;
      g.fillRect(cx - 22, toY(POST_TOP + 0.12), 44, toY(0.1) - toY(POST_TOP + 0.12));
      // stripes / dots / hearts alternate
      g.fillStyle = cfg.accent;
      if (i % 3 === 0) for (let yy = 0.25; yy < 1.4; yy += 0.18) g.fillRect(cx - 22, toY(yy), 44, 5);
      else if (i % 3 === 1) for (let yy = 0.3; yy < 1.4; yy += 0.2) { g.beginPath(); g.arc(cx + (r() - 0.5) * 10, toY(yy), 4.5, 0, 7); g.fill(); }
      else {
        g.font = `900 16px ${FONT_SANS}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        for (let yy = 0.35; yy < 1.4; yy += 0.3) g.fillText('♥', cx, toY(yy));
      }
      // cap contrasting colour
      g.fillStyle = cfg.cap;
      g.fillRect(cx - 24, toY(POST_TOP + 0.12), 48, toY(POST_TOP - 0.16) - toY(POST_TOP + 0.12));
      for (let k = 0; k < 3; k++) drip(cx - 14 + r() * 28, toY(POST_TOP - 0.16), 4 + r() * 16, 2 + r() * 2, cfg.cap);
    });
    yield;
    // 4) lettering, laid out span by span like the painters do: every word group sits inside one rail span
    // between two posts (never across a post), centred, and an over-long word is condensed to fit its span.
    // Spans are in viewer order (left to right as seen from this side), so both faces read correctly.
    const bays = (() => {
      const xs = posts.map(X).sort((a, b) => a - b);
      const pad = POST_HALF * 100 + 14;             // clear of the lumpy post and the rail/post fillet
      const out = [];
      for (let k = 0; k < xs.length - 1; k++) out.push([xs[k] + pad, xs[k + 1] - pad]);
      return out;
    })();
    const railText = (text, yCentre, size, fill, stroke, font = FONT_SANS) => {
      g.font = `900 ${size}px ${font}`;
      g.textAlign = 'left'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const words = text.split(/\s+/).filter(Boolean).map((wd) => {
        const chars = [...wd], widths = chars.map((ch) => g.measureText(ch).width);
        return { chars, widths, w: widths.reduce((a, b) => a + b, 0) };
      });
      const spaceW = g.measureText(' ').width;
      const inset = (stroke ? size * 0.08 : 0) + 2;  // outline half-width stays inside the span too
      const nB = bays.length, nW = words.length;
      const groupW = (i0, i1) => { let w = 0; for (let i = i0; i < i1; i++) w += words[i].w + (i > i0 ? spaceW : 0); return w; };
      // Split the words into consecutive groups, one per span (DP): overfull spans cost a lot, sparse or
      // empty ones a little; empty spans are slightly cheaper towards the ends so a short message is centred.
      const cost = (b, i0, i1) => {
        const bw = bays[b][1] - bays[b][0] - 2 * inset;
        if (i1 === i0) return 1.2 - 0.05 * Math.abs(b - (nB - 1) / 2) / Math.max(1, (nB - 1) / 2);
        const f = groupW(i0, i1) / bw;
        return f > 1 ? 40 * (f - 1) ** 2 : (1 - f) ** 2;
      };
      const dp = Array.from({ length: nB + 1 }, () => new Array(nW + 1).fill(Infinity));
      const from = Array.from({ length: nB + 1 }, () => new Array(nW + 1).fill(0));
      dp[0][0] = 0;
      for (let b = 1; b <= nB; b++) {
        for (let i = 0; i <= nW; i++) {
          for (let j = 0; j <= i; j++) {
            const c = dp[b - 1][j] + cost(b - 1, j, i);
            if (c < dp[b][i]) { dp[b][i] = c; from[b][i] = j; }
          }
        }
      }
      const groups = new Array(nB);
      for (let b = nB, i = nW; b > 0; b--) { const j = from[b][i]; groups[b - 1] = [j, i]; i = j; }
      const yc = toY(yCentre);
      groups.forEach(([i0, i1], b) => {
        if (i1 === i0) return;
        const bx0 = bays[b][0] + inset, bw = bays[b][1] - inset - bx0;
        const w = groupW(i0, i1);
        let nGaps = -1;
        for (let i = i0; i < i1; i++) nGaps += words[i].chars.length;
        // short groups get a little letter spacing; long ones are squeezed (then shrunk if really long)
        const track = w < bw * 0.75 && nGaps > 0 ? Math.min(size * 0.12, (bw * 0.75 - w) / nGaps) : 0;
        const natural = w + track * Math.max(0, nGaps);
        const kx = Math.min(1, bw / natural), ky = Math.min(1, kx / 0.7);   // squeeze at most to 70 % aspect
        const drawnW = natural * kx, slack = bw - drawnW;
        let x = bx0 + slack / 2 + (r() - 0.5) * Math.min(slack, 12);
        for (let wi = i0; wi < i1; wi++) {
          const { chars, widths } = words[wi];
          chars.forEach((ch, ci) => {
            const cw = widths[ci] * kx;
            const jitterY = (r() - 0.5) * size * 0.08, rot = (r() - 0.5) * 0.08;
            g.save(); g.translate(x, yc + jitterY); g.rotate(rot); g.scale(kx, ky);
            if (stroke) { g.strokeStyle = stroke; g.lineWidth = size * 0.16; g.strokeText(ch, 0, 0); }
            g.fillStyle = fill; g.fillText(ch, 0, 0);
            g.restore();
            // runny letters
            if (r() < 0.55) for (let k = 0; k < 1 + (r() * 2 | 0); k++) drip(x + r() * cw, yc + size * ky * 0.3, 3 + r() * 14, 1.2 + r() * 1.6, fill);
            x += cw + track * kx;
          });
          x += spaceW * kx;
        }
      });
    };
    for (const t of cfg.lines || []) { railText(t.text, t.y, t.size, t.fill, t.stroke, t.font); yield; }
    if (cfg.bays) {
      // one giant glyph per bay spanning both rails (the classic way big messages are painted), in viewer order
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
      const glyphs = [...cfg.bays.text];
      for (let i = 0; i < bays.length && i < glyphs.length; i++) {
        const ch = glyphs[i];
        const cx = (bays[i][0] + bays[i][1]) / 2;
        const cjk = /[　-鿿]/.test(ch);
        const size = cjk ? cfg.bays.size * 0.8 : cfg.bays.size;
        g.font = `900 ${size}px ${cjk ? FONT_CJK : FONT_SANS}`;
        const yc = toY(0.84) + (cjk ? size * 0.04 : size * 0.02);
        g.save(); g.translate(cx, yc); g.rotate((r() - 0.5) * 0.06);
        g.strokeStyle = cfg.bays.stroke; g.lineWidth = size * 0.1; g.strokeText(ch, 0, 0);
        g.fillStyle = cfg.bays.fill; g.fillText(ch, 0, 0);
        g.restore();
        for (let k = 0; k < 3; k++) drip(cx - size * 0.3 + r() * size * 0.6, toY(0.84) + size * 0.33, 4 + r() * 16, 1.5 + r() * 2, cfg.bays.fill);
      }
      yield;
    }
    // 5) little extras: stars, splats, handprints
    for (let i = 0; i < 26; i++) {
      const px = x0 + r() * (x1 - x0), py = toY(0.2 + r() * 1.3);
      const col = cfg.sprinkles[(r() * cfg.sprinkles.length) | 0];
      if (r() < 0.6) { g.fillStyle = col; g.beginPath(); g.arc(px, py, 1 + r() * 2.5, 0, 7); g.fill(); }
      else blob(px, py, 3 + r() * 5, 2 + r() * 4, col, 7);
    }
    // gloss/grime gradient near the ground
    g.setTransform(1, 0, 0, 1, 0, 0);
    const grime = g.createLinearGradient(0, H, 0, H - sy * 0.45);
    grime.addColorStop(0, 'rgba(60,45,30,0.55)'); grime.addColorStop(1, 'rgba(60,45,30,0)');
    g.fillStyle = grime; g.fillRect(back ? W / 2 : 0, H - sy * 0.45, W / 2, sy * 0.45);
  }

  yield* paintSide(false, FRONT);
  yield* paintSide(true, BACK);
  g.setTransform(1, 0, 0, 1, 0, 0);
  tex.needsUpdate = true;
}

// Coarse fence (distance LOD, and the placeholder until the sculpt is meshed): rounded boxes in the same
// local frame as the sculpt, so the object-space paint lookup works unchanged. ~3k triangles.
function fenceProxyGeometry(L, spacing) {
  const parts = [];
  const pw = POST_HALF * 2 + 0.03, ph = POST_TOP + 0.3;
  for (let i = 0; i < N_POSTS; i++) {
    const g = new RoundedBoxGeometry(pw, ph, pw, 2, 0.09);
    g.translate(i * spacing, ph / 2 - 0.3, 0);
    parts.push(g);
  }
  for (const [yc, hy, hz] of RAILS) {
    const g = new RoundedBoxGeometry(L, hy * 2, hz * 2, 2, 0.06);
    g.translate(L / 2, yc - 0.006, 0);
    parts.push(g);
  }
  for (const g of parts) g.deleteAttribute('uv');
  return mergeCompatible(parts);
}

// Material that samples the paint texture in object space: +z side = front message, -z side = back message.
function fenceMaterial(tex, L) {
  const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4, metalness: 0 });
  mat.name = 'fence-paint';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFenceMap = { value: tex };
    shader.uniforms.uFenceDims = { value: new THREE.Vector4(L, TEX_MARGIN, TEX_H, TEX_Y0) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFenceP;\nvarying vec3 vFenceN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFenceP = position;\nvFenceN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uFenceMap;\nuniform vec4 uFenceDims;\nvarying vec3 vFenceP;\nvarying vec3 vFenceN;')
      .replace('#include <map_fragment>', `
        {
          float back = vFenceN.z >= 0.0 ? 0.0 : 1.0;
          float ux = (vFenceP.x + uFenceDims.y) / (uFenceDims.x + 2.0 * uFenceDims.y);
          float vv = (vFenceP.y - uFenceDims.w) / uFenceDims.z;
          vec2 cont = vec2(ux * 0.5, vv);            // continuous coords for mip selection (no seam artefacts)
          ux = mix(ux, 1.0 - ux, back);
          vec2 fuv = vec2(ux * 0.5 + back * 0.5, vv);
          vec4 fc = textureGrad(uFenceMap, fuv, dFdx(cont), dFdy(cont));
          diffuseColor.rgb *= fc.rgb;
        }`);
  };
  mat.customProgramCacheKey = () => 'cmu-fence-paint-v1';
  return mat;
}

// ------------------------------------------------------------------ ground: trampled grass, paint splatter
function groundDecalTexture(renderer) {
  const W = 1024, H = 256;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  const r = rng(77);
  g.clearRect(0, 0, W, H);
  // worn dirt patch (soft edged)
  for (let i = 0; i < 70; i++) {
    const x = 60 + r() * (W - 120), y = H / 2 + (r() - 0.5) * H * 0.45, rad = 30 + r() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const a = 0.25 + r() * 0.3;
    grd.addColorStop(0, `rgba(${110 + r() * 20 | 0},${90 + r() * 15 | 0},${62 + r() * 10 | 0},${a})`);
    grd.addColorStop(1, 'rgba(110,90,62,0)');
    g.fillStyle = grd; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // paint splatters and footprints of paint
  for (let i = 0; i < 260; i++) {
    const x = 40 + r() * (W - 80), y = H / 2 + (r() - 0.5) * H * 0.7 * (0.3 + r());
    g.fillStyle = PAINT[(r() * PAINT.length) | 0];
    g.globalAlpha = 0.35 + r() * 0.45;
    g.beginPath(); g.ellipse(x, y, 0.5 + r() ** 4 * 5, 0.4 + r() ** 4 * 3.5, r() * 3, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
  const t = canvasTexture(c, { renderer });
  return t;
}

// Paint cans + brushes (vertex coloured, one mesh)
function paintCans(bucket, mat, spots) {
  for (const [x, y, z, col, open] of spots) {
    const body = new THREE.CylinderGeometry(0.085, 0.085, 0.19, 14, 1, false);
    body.translate(x, y + 0.095, z);
    tint(body, '#b9bcc0');
    bucket.add(mat, body);
    // paint running down the side
    const band = new THREE.CylinderGeometry(0.087, 0.087, 0.06, 14, 1, true);
    band.translate(x, y + 0.165, z);
    bucket.add(mat, tint(band, col));
    const lid = new THREE.CylinderGeometry(0.075, 0.075, 0.012, 14);
    lid.translate(x, y + 0.195, z);
    bucket.add(mat, tint(lid, open ? col : '#8e9296'));
    if (open) {
      // brush resting across the top
      const handle = cylinderBetween([x - 0.16, y + 0.2, z + 0.02], [x + 0.05, y + 0.215, z - 0.01], 0.012, 0.012, 6);
      bucket.add(mat, tint(handle, '#b07a45'));
      const bristles = new THREE.BoxGeometry(0.07, 0.02, 0.06);
      bristles.rotateY(0.1); bristles.translate(x + 0.08, y + 0.215, z - 0.015);
      bucket.add(mat, tint(bristles, col));
    }
  }
}

// ------------------------------------------------------------------ landmark
async function buildFence(ctx, def) {
  const data = ctx.data;
  const bar = data.barriers.find((b) => b.id === FENCE_ID);
  const pA = bar ? bar.points[0] : [-45.38, 81.5];
  const pB = bar ? bar.points[bar.points.length - 1] : [-29.36, 85.85];
  const dx = pB[0] - pA[0], dz = pB[1] - pA[1];
  const L = Math.hypot(dx, dz);
  const yA = ctx.heightAt(pA[0], pA[1]), yB = ctx.heightAt(pB[0], pB[1]);
  const rotY = -Math.atan2(dz, dx);

  const root = new THREE.Group();
  root.name = 'landmark:fence';
  root.position.set(pA[0], yA, pA[1]);
  root.rotation.y = rotY;

  // --- the fence body. Loading builds only rounded-box stand-ins with base coats of paint; the sculpted
  // (SDF) fence and the full paint job are done afterwards in idle time — or at once if the camera comes near —
  // and the sculpt then replaces the stand-in within FENCE_LOD_FAR metres.
  const spacing = L / (N_POSTS - 1);
  const tex = paintFenceBase(L, spacing, ctx.renderer);
  const paintMat = fenceMaterial(tex, L);
  const tilt = new THREE.Group();                    // follow the (gentle) slope along the fence
  tilt.rotation.z = Math.atan2(yB - yA, L);
  root.add(tilt);
  const level = (geo, name) => {
    const m = new THREE.Mesh(geo, paintMat);
    m.position.x = -L / 2;                           // geometry stays in fence-local space (paint lookup)
    m.castShadow = true; m.receiveShadow = true;
    m.name = name;
    return m;
  };
  const fenceLod = makeLOD(level(fenceProxyGeometry(L, spacing), 'fence-body-coarse'), FENCE_LOD_FAR);
  fenceLod.name = 'fence-body';
  fenceLod.position.x = L / 2;                       // LOD distance measured from the fence's middle
  tilt.add(fenceLod);
  const voxel = { low: 0.07, medium: 0.06 }[ctx.quality?.level] || 0.05;
  deferRefine(ctx, {
    name: 'fence',
    anchor: [(pA[0] + pB[0]) / 2, (yA + yB) / 2 + 1, (pA[1] + pB[1]) / 2],
    near: FENCE_LOD_FAR + 60,
    *steps() {
      yield* paintFenceSteps(tex, L, spacing);
      const { dist } = fenceField(L, 11);
      return yield* meshSDFSteps(dist, { min: [-0.36, -0.16, -0.34], max: [L + 0.36, POST_TOP + 0.14, 0.34], voxel });
    },
    apply(geo) { fenceLod.setFine(level(geo, 'fence-body-sculpt')); },
  });

  // --- ground decal: trampled lawn with paint splatter, draped on the terrain
  const gx0 = -1.6, gx1 = L + 1.6, gz0 = -2.2, gz1 = 2.2, segX = 36, segZ = 8;
  const dg = new THREE.PlaneGeometry(gx1 - gx0, gz1 - gz0, segX, segZ);
  dg.rotateX(-Math.PI / 2);
  dg.translate((gx0 + gx1) / 2, 0, (gz0 + gz1) / 2);
  const cs = Math.cos(rotY), sn = Math.sin(rotY);
  const dpos = dg.attributes.position;
  for (let i = 0; i < dpos.count; i++) {
    const lx = dpos.getX(i), lz = dpos.getZ(i);
    const wx = pA[0] + lx * cs + lz * sn, wz = pA[1] - lx * sn + lz * cs;
    dpos.setY(i, ctx.heightAt(wx, wz) - yA + 0.035);
  }
  dg.computeVertexNormals();
  const decalMat = new THREE.MeshStandardMaterial({
    map: groundDecalTexture(ctx.renderer), transparent: true, depthWrite: false, roughness: 0.95,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  decalMat.name = 'fence-ground';
  const decal = new THREE.Mesh(dg, decalMat);
  decal.receiveShadow = true;
  decal.renderOrder = 1;
  root.add(decal);

  // --- a few paint cans left by tonight's painters
  const bucket = new PartBucket();
  const canMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.35 });
  canMat.name = 'fence-cans';
  const gAt = (lx, lz) => ctx.heightAt(pA[0] + lx * cs + lz * sn, pA[1] - lx * sn + lz * cs) - yA;
  const spots = [
    [spacing * 1.4, 0, 0.75, '#c41230', true],
    [spacing * 1.4 + 0.24, 0, 0.62, '#ffffff', false],
    [spacing * 5.55, 0, -0.8, '#1f7ae0', true],
    [spacing * 5.3, 0, -0.95, '#ffd21a', false],
  ].map(([x, , z, c, o]) => [x, gAt(x, z), z, c, o]);
  paintCans(bucket, canMat, spots);
  root.add(bucket.build({ name: 'fence' }));

  // --- collision, picking, label
  const mid = [(pA[0] + pB[0]) / 2, (yA + yB) / 2, (pA[1] + pB[1]) / 2];
  ctx.colliders?.addBox(mid[0], mid[2], L / 2 + 0.25, 0.24, rotY, Math.min(yA, yB) - 1, Math.max(yA, yB) + POST_TOP + 0.1, 'fence');
  registerLandmark(ctx, def, root, { position: [mid[0], mid[1] + 1.0, mid[2]], radius: L / 2 + 1, labelY: 1.6, priority: 9, pickObject: fenceLod });
  return root;
}

const FENCE_DEF = {
  key: 'fence',
  name: 'The Fence',
  nameZh: '涂鸦栅栏',
  osmIds: [],
  skipRoads: [],
  skipBarriers: [FENCE_ID],
  build(ctx) { return buildFence(ctx, FENCE_DEF); },
};

export default [FENCE_DEF];
