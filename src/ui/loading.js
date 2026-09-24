// Loading screen: animated campus "blueprint" drawn from CAMPUS_DATA footprints that lights up with progress,
// title, progress bar driven by step(label, p), rotating tips / CMU facts, error card, fade-out on done().
// The blueprint's static layers are painted once; each step only paints the newly lit buildings, so the
// loading screen costs next to nothing while the heavy init steps run. The card is painted first: the blueprint
// (thousands of outlines) is drawn in two slices after the first frame, so a slow device isn't left blank.
import { h, uiRoot, clamp, isTouchUI } from './dom.js';
import { icon } from './icons.js';

const MAX_BACKING = 1200;   // px: backing-store cap of the blueprint canvas (it is a soft, tilted backdrop)

const TIPS_TOUCH = [
  ['操作', '单指拖动旋转视角，双指捏合缩放、双指拖动平移；轻点建筑即可查看介绍。'],
  ['操作', '点「俯瞰 · 步行 · 飞行」按钮切换三种浏览模式。'],
  ['操作', '步行模式下用左下方的摇杆移动，在屏幕右侧拖动环视四周。'],
  ['操作', '点右上角的 ⚑ 开始导览，镜头会带你依次游览校园的主要地标。'],
  ['操作', '点右上角的放大镜，搜索建筑、地标、艺术品与咖啡馆。'],
  ['操作', '左下角的时间面板可以切换白天、夜晚与四季。'],
];
const TIPS = [
  ['操作', '左键拖动旋转视角，右键拖动平移，滚轮缩放；双击地面可直接飞过去。'],
  ['操作', '按 1 / 2 / 3 切换 俯瞰 · 步行 · 飞行 三种模式。'],
  ['操作', '按 / 或 F 搜索建筑、地标、艺术品与咖啡馆。'],
  ['操作', '按 T 开始导览，镜头会带你依次游览校园的主要地标。'],
  ['操作', '按 N 在白天与夜晚之间切换，看看校园亮灯的样子。'],
  ['操作', '步行模式下用 WASD 移动，Shift 奔跑，空格跳跃，Esc 释放鼠标。'],
  ['操作', '按 M 展开或收起右下角的小地图，点击地图可以直接前往。'],
  ['趣闻', '1900 年，安德鲁·卡内基出资创办卡内基技术学校，这就是 CMU 的前身。'],
  ['趣闻', '1967 年，卡内基理工学院与梅隆工业研究所合并，才有了今天的“卡内基梅隆大学”。'],
  ['趣闻', '校园里的 The Fence 是出了名的“被刷漆最多的围栏”：学生社团会通宵守着它，刷上自己的宣传。'],
  ['趣闻', '早期校园由建筑师亨利·霍恩博斯特尔规划，米黄色砖墙与拱形窗是他留下的标志。'],
  ['趣闻', 'CMU 的吉祥物是苏格兰梗犬 Scotty，运动队叫 Tartans（格子呢），都呼应卡内基的苏格兰出身。'],
  ['趣闻', '1982 年，CMU 的 Scott Fahlman 在校内论坛上第一次提议用 :-) 表示玩笑，笑脸符号由此诞生。'],
  ['趣闻', 'CMU 是极少数能授予风笛演奏学位的大学之一。'],
  ['趣闻', '每年春季嘉年华都有 Buggy 比赛：无动力的流线型小车载着车手沿申利公园的坡道疾驰。'],
  ['趣闻', '1979 年成立的机器人研究所（Robotics Institute）是美国最早专门研究机器人的学术机构之一。'],
  ['趣闻', '雕塑《走向天空》高约 30 米，一群人沿着倾斜的长杆走向天空，就立在 Cohon 中心旁。'],
];

export function createLoadingScreen(ctx) {
  const root = uiRoot();
  const data = ctx?.data || window.CAMPUS_DATA;
  const meta = (ctx?.info || window.CAMPUS_INFO)?.meta;
  // keyboard / mouse tips on desktop, touch tips on phones and tablets; facts from CAMPUS_INFO.meta when present
  const ops = (isTouchUI(ctx) ? TIPS_TOUCH : TIPS.filter((t) => t[0] === '操作'));
  const facts = Array.isArray(meta?.facts) && meta.facts.length ? meta.facts.map((f) => ['趣闻', String(f)]) : TIPS.filter((t) => t[0] !== '操作');
  const tips = [];
  for (let i = 0; i < Math.max(ops.length, facts.length); i++) { if (ops[i]) tips.push(ops[i]); if (facts[i]) tips.push(facts[i]); }

  const canvas = h('canvas.ld-map', { 'aria-hidden': 'true' });
  const bar = h('i');
  const stepEl = h('span.ld-step', null, '正在准备…');
  const pctEl = h('span.ld-pct', null, '0%');
  const detailEl = h('div.ld-detail');
  const tipKind = h('span.ld-tip-k', null, '提示');
  const tipText = h('span.ld-tip-t');
  const tipBox = h('div.ld-tip', { 'aria-live': 'polite' }, [tipKind, tipText]);
  const errorBox = h('div.ld-error', { role: 'alert', hidden: true });

  const el = h('div.ld', { role: 'dialog', 'aria-modal': 'true', 'aria-label': '正在加载 CMU 3D' }, [
    h('div.ld-stage', null, h('div.ld-plane', null, canvas)),
    h('div.ld-scrim'),
    h('div.ld-tartan'),
    h('div.ld-card', null, [
      h('div.ld-kicker', null, [h('span.brand-mark', { 'aria-hidden': 'true' }, [h('b', null, 'C'), h('i')]), h('span', null, 'Carnegie Mellon · Pittsburgh, PA')]),
      h('h1.ld-title', null, [h('span.ld-title-en', null, 'CMU 3D'), h('span.ld-dot', null, '·'), h('span.ld-title-zh', null, '卡内基梅隆大学校园漫游')]),
      h('p.ld-sub', null, '以 OpenStreetMap 建筑轮廓与真实地形重建的匹兹堡校园 —— 俯瞰、步行、飞行，随你探索。'),
      h('div.ld-progress', null, [
        h('div.ld-bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100' }, bar),
        h('div.ld-meta', null, [stepEl, pctEl]),
        detailEl,
      ]),
      tipBox,
      errorBox,
    ]),
    h('div.ld-foot', null, '非官方爱好者作品，与卡内基梅隆大学无关 · 地图数据 © OpenStreetMap 贡献者 (ODbL)'),
  ]);
  root.appendChild(el);
  const barWrap = el.querySelector('.ld-bar');

  // ---------------------------------------------------------------- blueprint map
  const map = prepareMap(data);
  let progress = 0;
  let shown = 0; // animated progress actually drawn
  let painter = null;
  let lastSize = 0;
  let finished = false;
  let paintGen = 0;
  function sizeCanvas() {
    if (finished) return;
    const size = Math.round(Math.min(1500, Math.max(innerWidth, innerHeight) * 1.05));
    if (size === lastSize && painter) return;
    lastSize = size;
    const px = Math.min(MAX_BACKING, size);          // DPR 1, capped: CSS scales it up a little
    canvas.width = px;
    canvas.height = px;
    canvas.style.width = canvas.style.height = `${size}px`;
    const p = createPainter(canvas, map);
    painter = null;
    const gen = ++paintGen;
    // slice 1: greens, roads, paths · slice 2: outlines, campus boundary and whatever is lit by then
    setTimeout(() => {
      if (finished || gen !== paintGen) return;
      p.base(1);
      setTimeout(() => {
        if (finished || gen !== paintGen) return;
        p.base(2);
        painter = p;
        p.light(shown);
      }, 0);
    }, 0);
  }
  // after the first frame with the card has been painted (rAF runs just before that frame; the timeout after it)
  requestAnimationFrame(() => setTimeout(sizeCanvas, 0));
  let resizeT = 0;
  const onResize = () => { clearTimeout(resizeT); resizeT = setTimeout(sizeCanvas, 150); };
  addEventListener('resize', onResize);

  // Ease the drawn progress towards the real one whenever the main thread is free (only new buildings are painted).
  let raf = 0;
  function animate() {
    raf = 0;
    const d = progress - shown;
    if (Math.abs(d) < 0.002) { shown = progress; painter?.light(shown); return; }
    shown += d * 0.18;
    painter?.light(shown);
    raf = requestAnimationFrame(animate);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(animate); };

  // ---------------------------------------------------------------- tips
  let tipIdx = Math.floor(Math.random() * tips.length);
  let firstTip = true;
  function showTip() {
    const [k, t] = tips[tipIdx % tips.length];
    tipBox.classList.remove('in');
    if (!firstTip) void tipBox.offsetWidth; // restart the CSS animation (the first one needs no restart)
    firstTip = false;
    tipKind.textContent = k;
    tipText.textContent = t;
    tipBox.classList.add('in');
    tipIdx++;
  }
  showTip();
  const tipTimer = setInterval(showTip, 5200);

  const api = {
    step(label, p) {
      if (finished) return;
      progress = clamp(Number(p) || 0, 0, 1);
      stepEl.textContent = p >= 1 ? '准备就绪' : `正在构建 · ${label}`;
      pctEl.textContent = `${Math.round(progress * 100)}%`;
      bar.style.transform = `scaleX(${Math.max(0.02, progress)})`;
      barWrap.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
      detailEl.textContent = '';
      // Paint immediately too (cheap: only the newly lit buildings): heavy init steps block rAF.
      shown += (progress - shown) * 0.6;
      painter?.light(shown);
      kick();
    },
    detail(text) { if (!finished) detailEl.textContent = text || ''; },
    error(msg) {
      el.classList.add('has-error');
      errorBox.hidden = false;
      errorBox.innerHTML = '';
      errorBox.append(
        h('div.ld-error-h', { html: `${icon('warn')}<span>加载遇到问题</span>` }),
        h('p', null, String(msg || '未知错误')),
        h('div.ld-error-actions', null, [
          h('button.btn.btn-primary', { type: 'button', onclick: () => location.reload() }, [h('span', { html: icon('refresh') }), '重新加载']),
          h('button.btn.btn-ghost', { type: 'button', onclick: () => api.done(true) }, '仍然进入'),
        ]),
      );
    },
    done(force = false) {
      if (finished && !force) return;
      finished = true;
      progress = 1;
      bar.style.transform = 'scaleX(1)';
      pctEl.textContent = '100%';
      stepEl.textContent = '欢迎来到卡内基梅隆大学';
      clearInterval(tipTimer);
      el.classList.add('ld-out');
      root.classList.add('app-ready');
      api.isDone = true;
      setTimeout(() => {
        removeEventListener('resize', onResize);
        clearTimeout(resizeT);
        if (raf) cancelAnimationFrame(raf);
        el.remove();
        canvas.width = canvas.height = 0;   // release the backing store
        painter = null;
      }, 1100);
      ctx?.events?.emit?.('ui:loaded');
    },
    isDone: false,
    el,
  };
  return api;
}

// ------------------------------------------------------------------------------------------------ map helpers
function prepareMap(data) {
  if (!data?.buildings) return null;
  // Focus on the campus: centre between Hamerschlag and the dorms, extent ~1300 m.
  const cx = -90, cz = 30, span = 1300;
  const cxz = [-150, 60];
  const bld = data.buildings
    .filter((b) => b.footprint?.length > 2)
    .map((b) => ({ ring: b.footprint, campus: !!b.campus, d: Math.hypot(b.centroid[0] - cxz[0], b.centroid[1] - cxz[1]) + (b.campus ? -120 : 0) }))
    .sort((a, b) => a.d - b.d);
  const maxD = bld.length ? bld[bld.length - 1].d : 1;
  const roads = (data.roads || []).filter((r) => !r.tunnel).map((r) => ({ pts: r.points, w: r.width || 6 }));
  const paths = (data.paths || []).filter((p) => !p.indoor && !p.tunnel).map((p) => p.points);
  const green = (data.areas || []).filter((a) => ['grass', 'park', 'garden', 'wood', 'golf', 'pitch', 'stadium'].includes(a.type)).map((a) => a.polygon);
  const boundary = data.meta?.campusBoundary || [];
  return { cx, cz, span, bld, maxD, roads, paths, green, boundary };
}

// Static layers (greens, roads, paths, dim outlines, campus boundary) are painted once by base();
// light(p) then fills only the buildings revealed since the last call (they are sorted by reveal distance).
function createPainter(canvas, map) {
  const g = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  let litN = 0;
  if (!map) return { base() { g.clearRect(0, 0, W, H); }, light() {} };
  const s = W / map.span;
  const X = (x) => (x - map.cx) * s + W / 2;
  const Z = (z) => (z - map.cz) * s + H / 2;
  const poly = (ring) => {
    g.moveTo(X(ring[0][0]), Z(ring[0][1]));
    for (let i = 1; i < ring.length; i++) g.lineTo(X(ring[i][0]), Z(ring[i][1]));
    g.closePath();
  };
  const line = (pts) => {
    g.moveTo(X(pts[0][0]), Z(pts[0][1]));
    for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i][0]), Z(pts[i][1]));
  };
  function base(part = 0) {
    if (part !== 2) {
      g.clearRect(0, 0, W, H);
      litN = 0;
      baseA();
    }
    if (part !== 1) baseB();
  }
  function baseA() {
    // green areas
    g.fillStyle = 'rgba(120,170,120,0.07)';
    g.beginPath(); for (const ring of map.green) poly(ring); g.fill();
    // roads, bucketed by width so each bucket is a single stroke
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(247,244,238,0.10)';
    const buckets = new Map();
    for (const r of map.roads) {
      const w = Math.max(1, Math.round(r.w * s * 0.9 * 2) / 2);
      if (!buckets.has(w)) buckets.set(w, []);
      buckets.get(w).push(r.pts);
    }
    for (const [w, list] of buckets) { g.lineWidth = w; g.beginPath(); for (const pts of list) line(pts); g.stroke(); }
    g.strokeStyle = 'rgba(247,244,238,0.07)';
    g.lineWidth = Math.max(0.6, 1.2 * s);
    g.beginPath(); for (const pts of map.paths) line(pts); g.stroke();
  }
  function baseB() {
    // dim outlines of every building
    g.lineWidth = Math.max(0.8, 1.1 * s);
    g.strokeStyle = 'rgba(247,244,238,0.16)';
    g.beginPath(); for (const b of map.bld) poly(b.ring); g.stroke();
    // campus boundary
    g.setLineDash([6 * s, 5 * s]);
    g.lineWidth = Math.max(1, 1.6 * s);
    g.strokeStyle = 'rgba(196,18,48,0.55)';
    g.beginPath(); for (const ring of map.boundary) if (ring.length > 2) poly(ring); g.stroke();
    g.setLineDash([]);
  }
  function light(p) {
    const lit = Math.floor(map.bld.length * Math.min(1, Math.max(0, p) * 1.04));
    if (lit <= litN) return;
    g.lineWidth = Math.max(0.8, 1.1 * s);
    g.beginPath(); for (let i = litN; i < lit; i++) if (!map.bld[i].campus) poly(map.bld[i].ring);
    g.fillStyle = 'rgba(247,244,238,0.13)'; g.fill();
    g.strokeStyle = 'rgba(247,244,238,0.42)'; g.stroke();
    g.beginPath(); for (let i = litN; i < lit; i++) if (map.bld[i].campus) poly(map.bld[i].ring);
    g.fillStyle = 'rgba(196,18,48,0.42)'; g.fill();
    g.strokeStyle = 'rgba(255,120,130,0.85)'; g.stroke();
    litN = lit;
  }
  return { base, light };
}
