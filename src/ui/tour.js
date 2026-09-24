// Guided tour (T): cinematic flyTo per stop with a narration card, progress dots, prev / play-pause / next,
// autoplay (each stop stays long enough to read its narration; hovering the card holds it), Esc to exit.
// The rest of the HUD fades out while touring. The stops are framed for a 16:9 screen with a 55° vertical fov: on
// narrower (portrait) screens the camera is pulled back along the same line of sight until the horizontal field
// at the target matches (the engine already widens the fov of portrait screens), so what the narration talks
// about stays in frame. The finish card offers the next steps.
import { h, clamp, isTouchUI } from './dom.js';
import { icon } from './icons.js';

const REF_ASPECT = 16 / 9;       // screen shape the tour stops were framed for…
const REF_FOV = 55;              // …and vertical fov (deg)
const MAX_PULLBACK = 2.2;        // how much farther from the target the camera may be moved on narrow screens
const READ_CPS = 6.5;            // narration reading pace (characters per second) for autoplay
const MALL_WALK = { x: -165, z: 96, look: [-314, 71] };    // on the Mall, looking down it to Hamerschlag

// Used only when CAMPUS_INFO.tour is missing. [x, heightAboveGround, z] for target and camera.
const FALLBACK = [
  { key: 'overview', title: '俯瞰卡内基梅隆', titleEn: 'Carnegie Mellon from above', text: '欢迎来到匹兹堡奥克兰区的卡内基梅隆大学。校园坐落在申利公园旁的高地上，西侧是深谷 Junction Hollow，北侧是繁忙的 Forbes 大道。', t: [-90, 0, 30], p: [-620, 320, 560] },
  { key: 'hamerschlag', title: '哈默施拉格楼', titleEn: 'Hamerschlag Hall', text: '带着圆形塔楼的哈默施拉格楼立在校园西端的崖边，是亨利·霍恩博斯特尔设计的早期校舍之一，如今是电子与计算机工程系的所在地。', t: [-314, 12, 71], p: [-175, 55, 140] },
  { key: 'mall', title: '中央草坪 The Mall', titleEn: 'The Mall', text: '长条形的中央草坪从哈默施拉格楼一路延伸到美术学院，两侧是贝克楼、多尔蒂楼和韦恩楼，是校园最经典的轴线。', t: [-150, 2, 110], p: [-40, 70, 230] },
  { key: 'cfa', title: '美术学院', titleEn: 'College of Fine Arts', text: '美术学院大楼位于中央草坪的东端，立面上雕刻着建筑、音乐、戏剧等艺术的主题图案，是霍恩博斯特尔最华丽的作品之一。', t: [8, 10, 159], p: [-110, 50, 120] },
  { key: 'fence', title: '围栏 The Fence', titleEn: 'The Fence', text: '这道看似普通的木围栏被一层又一层的油漆包裹。按照传统，学生只能在夜里用刷子刷漆，并且要一直守着它直到天亮。', t: [-37, 2, 83], p: [-2, 22, 48] },
  { key: 'cut', title: '剪草坪 The Cut', titleEn: 'The Cut', text: 'The Cut 原本是一道被填平的山谷，如今是校园东部开阔的草坪，春季嘉年华与各种户外活动常在这里举行。', t: [2, 2, -23], p: [-110, 70, 70] },
  { key: 'sky', title: '走向天空', titleEn: 'Walking to the Sky', text: '乔纳森·博罗夫斯基的雕塑《走向天空》：一群不同身份的人沿着高高的斜杆向上走，象征着对未来的向往。', t: [9, 14, -127], p: [48, 22, -78] },
  { key: 'cuc', title: 'Cohon 大学中心', titleEn: 'Cohon University Center', text: '大学中心是学生生活的枢纽：餐厅、健身房、游泳池、礼堂和各种学生社团都集中在这里。', t: [87, 8, -54], p: [175, 70, 10] },
  { key: 'gates', title: '盖茨与希尔曼中心', titleEn: 'Gates and Hillman Centers', text: '计算机学院的大本营。这座锯齿形的现代建筑顺着山坡层层叠落，外墙覆盖着锌板与玻璃，一座步行桥连向东侧。', t: [-133, 12, -62], p: [-30, 80, -150] },
  { key: 'tepper', title: '泰珀商学院', titleEn: 'Tepper Quad', text: '泰珀商学院大楼是校园北部的新地标，明亮的中庭面向一片新的草坪广场，把商学院与校园其他部分连接起来。', t: [-198, 10, -232], p: [-80, 90, -330] },
  { key: 'hunt', title: '亨特图书馆', titleEn: 'Hunt Library', text: '亨特图书馆由铝板与玻璃构成，外观方正简洁。顶层收藏着著名的亨特植物学文献研究所。', t: [-63, 8, 210], p: [20, 45, 290] },
  { key: 'stadium', title: 'Gesling 体育场', titleEn: 'Gesling Stadium', text: '校园东侧的 Gesling 体育场是 Tartans 橄榄球队与田径队的主场，看台面向申利公园。', t: [226, 2, -24], p: [330, 90, 90] },
  { key: 'oakland', title: '奥克兰与学习大教堂', titleEn: 'Oakland & the Cathedral of Learning', text: '向西望去，匹兹堡大学的学习大教堂高耸于奥克兰街区之上。卡内基博物馆与卡内基图书馆也就在不远处。', t: [-760, 60, -150], p: [-260, 170, 40] },
];

export function createTour(ctx, { root, onStart, onStop, toast, onFinishAction }) {
  const count = h('span.tour-count');
  const titleEl = h('h2.tour-title');
  const enEl = h('div.tour-en');
  const textEl = h('p.tour-text');
  const bar = h('i');
  const dots = h('div.tour-dots', { role: 'tablist', 'aria-label': '导览站点' });
  const prevBtn = h('button.icon-btn', { type: 'button', 'aria-label': '上一站', title: '上一站', html: icon('prev') });
  const playBtn = h('button.icon-btn.tour-play', { type: 'button', 'aria-label': '暂停', title: '暂停 / 继续', html: icon('pause') });
  const nextBtn = h('button.icon-btn', { type: 'button', 'aria-label': '下一站', title: '下一站', html: icon('next') });
  const exitBtn = h('button.icon-btn.sm', { type: 'button', 'aria-label': '退出导览 (Esc)', title: '退出导览 (Esc)', html: icon('close') });
  const body = h('div.tour-body', null, [titleEl, enEl, textEl]);
  // finish card: what to do next (the HUD is still hidden while the card is up, so the actions live here)
  const finBtn = (ico, label, kind, cls) => {
    const b = h(`button.btn.${cls}`, { type: 'button' }, [h('span', { html: icon(ico) }), h('span', null, label)]);
    b.addEventListener('click', () => finishAction(kind));
    return b;
  };
  const finish1 = finBtn('target', '回到校园全景', 'home', 'btn-primary');
  const finishRow = h('div.tour-finish', null, [finish1, finBtn('walk', '去中央草坪步行', 'walk', 'btn-ghost'), finBtn('search', '搜索地点', 'search', 'btn-ghost')]);
  const el = h('section.tour.glass', { role: 'region', 'aria-label': '校园导览', 'aria-live': 'polite', 'aria-hidden': 'true' }, [
    h('div.tour-top', null, [h('span.tour-kicker', { html: `${icon('tour')}<span>校园导览 · Guided Tour</span>` }), count, exitBtn]),
    body,
    finishRow,
    h('div.tour-bar', null, bar),
    h('div.tour-ctrl', null, [h('div.tour-btns', null, [prevBtn, playBtn, nextBtn]), dots]),
  ]);
  root.appendChild(el);

  let stops = [];
  let idx = 0;
  let active = false;
  let playing = true;
  let flying = false;
  let flyToken = 0;
  let dwell = 0;
  let flyTimeout = 0;
  let hovering = false;          // mouse over the card: autoplay holds so the narration can be finished

  // ---------------------------------------------------------------- narrow / portrait screens
  // Pull-back factor that gives the horizontal field of the 16:9 reference at the target's distance.
  const rad = (d) => (d * Math.PI) / 180;
  function pullback() {
    const cam = ctx.camera;
    if (!cam?.isPerspectiveCamera) return 1;
    const aspect = cam.aspect || innerWidth / Math.max(1, innerHeight);
    const refT = Math.tan(rad(REF_FOV / 2)) * REF_ASPECT;
    const curT = Math.tan(rad(cam.fov / 2)) * aspect;
    return clamp(refT / curT, 1, MAX_PULLBACK);
  }
  function adaptedPosition(s) {
    if (!s.position || !s.target) return s.position;
    const k = pullback();
    if (k <= 1.001) return s.position;
    const [tx, ty, tz] = s.target;
    const x = tx + (s.position[0] - tx) * k, z = tz + (s.position[2] - tz) * k;
    let y = ty + (s.position[1] - ty) * k;
    const g = ctx.heightAt ? ctx.heightAt(x, z) : -Infinity;
    if (y < g + 20) y = g + 20;
    return [x, y, z];
  }
  const dwellFor = (s) => Math.max(s?.duration || 12, 4 + String(s?.text || '').length / READ_CPS);

  function loadStops() {
    const src = ctx.info?.tour?.length ? ctx.info.tour : null;
    const H = (x, z) => (ctx.heightAt ? ctx.heightAt(x, z) : 45);
    if (src) {
      stops = src.filter((s) => s && (s.target || s.position)).map((s) => ({ ...s }));
    } else {
      stops = FALLBACK.map((s) => ({
        key: s.key, title: s.title, titleEn: s.titleEn, text: s.text, duration: 12,
        target: [s.t[0], H(s.t[0], s.t[2]) + s.t[1], s.t[2]],
        position: [s.p[0], H(s.p[0], s.p[2]) + s.p[1], s.p[2]],
      }));
    }
    dots.innerHTML = '';
    stops.forEach((s, i) => {
      const d = h('button.tour-dot', { type: 'button', role: 'tab', 'aria-label': `第 ${i + 1} 站：${s.title || ''}`, title: s.title || '' });
      d.addEventListener('click', () => go(i));
      dots.appendChild(d);
    });
  }

  function render() {
    const s = stops[idx];
    count.textContent = `${String(idx + 1).padStart(2, '0')} / ${String(stops.length).padStart(2, '0')}`;
    titleEl.textContent = s.title || '';
    enEl.textContent = s.titleEn || '';
    textEl.textContent = s.text || '';
    body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap');
    [...dots.children].forEach((d, i) => { d.classList.toggle('on', i === idx); d.classList.toggle('done', i < idx); d.setAttribute('aria-selected', String(i === idx)); });
    prevBtn.disabled = idx === 0;
    bar.style.transform = 'scaleX(0)';
  }

  function setPlaying(p) {
    playing = p;
    playBtn.innerHTML = icon(p ? 'pause' : 'play');
    playBtn.setAttribute('aria-label', p ? '暂停' : '继续');
    el.classList.toggle('paused', !p);
  }

  function go(i) {
    if (!stops.length) return;
    if (i >= stops.length) { finish(); return; }
    idx = clamp(i, 0, stops.length - 1);
    dwell = 0;
    el.classList.remove('finished');
    render();
    const s = stops[idx];
    const token = ++flyToken;
    flying = true;
    const position = adaptedPosition(s);
    const cam = ctx.camera?.position;
    const dist = cam && position ? Math.hypot(cam.x - position[0], cam.y - position[1], cam.z - position[2]) : 400;
    const duration = clamp(2.2 + dist / 380, 2.5, 6);
    const done = () => { if (token === flyToken) flying = false; };
    clearTimeout(flyTimeout);
    flyTimeout = setTimeout(done, (duration + 1.5) * 1000);
    try {
      const nav = ctx.nav;
      if (nav?.flyTo) {
        const p = nav.flyTo({ target: s.target, position, duration });
        if (p?.then) p.then(done, done); else setTimeout(done, duration * 1000);
      } else if (nav?.setView) { nav.setView(position, s.target); done(); }
      else done();
    } catch (e) { console.warn('[ui] tour flyTo failed', e); done(); }
  }

  function finish() {
    setPlaying(false);
    el.classList.add('finished');
    count.textContent = '完成';
    titleEl.textContent = '导览结束';
    enEl.textContent = 'Thanks for visiting';
    textEl.textContent = '你已经游览了校园的主要地标。接下来可以回到校园全景自由探索，去中央草坪（The Mall）步行走一走，或者搜索更多地点。'
      + (isTouchUI(ctx) ? '' : '（快捷键：/ 搜索 · 2 步行 · H 操作指南）');
    body.classList.remove('swap'); void body.offsetWidth; body.classList.add('swap');
    bar.style.transform = 'scaleX(1)';
    [...dots.children].forEach((d) => { d.classList.remove('on'); d.classList.add('done'); });
    idx = stops.length;
    if (!isTouchUI(ctx)) requestAnimationFrame(() => { if (el.classList.contains('finished')) finish1.focus({ preventScroll: true }); });
  }
  function finishAction(kind) {
    stop();
    const nav = ctx.nav;
    try {
      if (kind === 'walk' && nav?.walkTo) {
        const { x, z, look } = MALL_WALK;
        nav.walkTo(x, z, Math.atan2(look[0] - x, -(look[1] - z)));
      } else onFinishAction?.(kind);
    } catch (e) { console.warn('[ui] tour finish action failed', e); }
  }

  function start(from = 0) {
    loadStops();
    if (!stops.length) { toast?.('暂无导览数据'); return; }
    active = true;
    el.classList.add('open');
    el.setAttribute('aria-hidden', 'false');
    root.classList.add('touring');
    setPlaying(true);
    onStart?.();
    try { if (ctx.nav?.mode && ctx.nav.mode !== 'orbit') ctx.nav.setMode?.('orbit'); } catch { /* ignore */ }
    go(from);
  }
  function stop() {
    if (!active) return;
    active = false;
    flyToken++;
    clearTimeout(flyTimeout);
    el.classList.remove('open', 'finished');
    el.setAttribute('aria-hidden', 'true');
    root.classList.remove('touring');
    onStop?.();
  }

  prevBtn.addEventListener('click', () => { if (idx >= stops.length) go(stops.length - 1); else go(idx - 1); });
  nextBtn.addEventListener('click', () => { if (idx >= stops.length) { setPlaying(true); go(0); } else go(idx + 1); });
  playBtn.addEventListener('click', () => {
    if (idx >= stops.length) { setPlaying(true); go(0); return; }
    setPlaying(!playing);
  });
  exitBtn.addEventListener('click', () => stop());

  // Any manual camera interaction pauses autoplay (the user wants to look around).
  const canvas = ctx.renderer?.domElement || ctx.canvas;
  const pauseByUser = (say) => { if (active && playing && idx < stops.length) { setPlaying(false); if (say) toast?.('导览已暂停 · 点击 ▶ 继续'); } };
  canvas?.addEventListener('pointerdown', () => { if (!flying) pauseByUser(true); });
  canvas?.addEventListener('wheel', () => { if (!flying) pauseByUser(false); }, { passive: true });
  // Keyboard camera moves (WASD / arrows / Q E pan and rotate the orbit camera; they also cut a flight short).
  const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  addEventListener('keydown', (e) => {
    if (!active || !MOVE_KEYS.has(e.code) || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''))) return;
    if (ctx.nav && ctx.nav.enabled === false) return;
    pauseByUser(true);
  });

  el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hovering = true; });
  el.addEventListener('pointerleave', () => { hovering = false; });

  function update(dt) {
    if (!active || flying || !playing || idx >= stops.length) return;
    const dur = dwellFor(stops[idx]);
    if (!hovering) dwell += dt;
    bar.style.transform = `scaleX(${clamp(dwell / dur, 0, 1).toFixed(4)})`;
    if (dwell >= dur) go(idx + 1);
  }

  return {
    el, start, stop, update,
    get active() { return active; },
    toggle() { active ? stop() : start(); },
    next: () => go(idx + 1),
    prev: () => go(idx - 1),
  };
}
