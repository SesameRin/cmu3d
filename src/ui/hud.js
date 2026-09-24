// HUD chrome: brand block + location readout, mode switch, toolbar, settings popover (quality etc.),
// time-of-day / season panel, compass, walk-mode hint + crosshair, attribution footer, ?debug overlay.
// The top bar is one grid row (brand | modes | toolbar) so its parts can never overlap; fitTopBar() compacts
// it (or moves the modes to the bottom) if a viewport is still too narrow.
import { h, fmtClock, dayPart, isNarrow, isTouchUI, storage } from './dom.js';
import { icon } from './icons.js';
import { cameraHeading, navMode } from './navutil.js';
import { ATTRIBUTION } from './help.js';

const MODES = [
  { id: 'orbit', zh: '俯瞰', en: 'Orbit', key: '1', icon: 'orbit' },
  { id: 'walk', zh: '步行', en: 'Walk', key: '2', icon: 'walk' },
  { id: 'fly', zh: '飞行', en: 'Fly', key: '3', icon: 'fly' },
];
const SEASONS = [
  { id: 'spring', zh: '春', en: 'Spring' },
  { id: 'summer', zh: '夏', en: 'Summer' },
  { id: 'autumn', zh: '秋', en: 'Autumn' },
  { id: 'winter', zh: '冬', en: 'Winter' },
];
const QUALITY = [
  { id: 'low', zh: '低', desc: '无阴影，适合手机与集成显卡' },
  { id: 'medium', zh: '中', desc: '柔和阴影，适合大多数电脑' },
  { id: 'high', zh: '高', desc: '高清阴影与后期特效' },
];

export function createHud(ctx, { root, catalog, actions }) {
  let debugOn = new URLSearchParams(location.search).has('debug') || storage.get('cmu3d.debug') === '1';
  const btn = (name, label, key, onClick, cls = '') => {
    const b = h(`button.icon-btn.tb${cls ? '.' + cls : ''}`, { type: 'button', 'aria-label': key ? `${label} (${key})` : label, 'data-tip': key ? `${label} · ${key}` : label, html: icon(name) });
    b.addEventListener('click', onClick);
    return b;
  };

  // ---------------------------------------------------------------- brand + location
  const locEl = h('div.loc', { 'aria-live': 'off' });
  const brand = h('div.brand.glass.hud-hideable', null, [
    h('span.brand-mark', { 'aria-hidden': 'true' }, [h('b', null, 'C'), h('i')]),
    h('div.brand-txt', null, [
      h('div.brand-title', null, [h('span', null, 'CMU 3D'), h('em', null, 'Carnegie Mellon')]),
      h('div.brand-sub', null, '卡内基梅隆大学校园漫游'),
    ]),
  ]);
  brand.addEventListener('click', () => actions.goHome?.());
  brand.setAttribute('role', 'button');
  brand.setAttribute('tabindex', '0');
  brand.setAttribute('title', '回到校园全景');
  brand.addEventListener('keydown', (e) => { if (e.key === 'Enter') actions.goHome?.(); });
  const topLeft = h('div.hud-tl', null, [brand, locEl]);

  // ---------------------------------------------------------------- mode switch
  const modeBtns = MODES.map((m, i) => {
    const b = h('button.seg-btn', { type: 'button', role: 'radio', 'aria-checked': 'false', 'data-mode': m.id, 'aria-label': `${m.zh} ${m.en} (${m.key})`, title: `${m.zh} · ${m.en}（${m.key}）` }, [
      h('span.seg-ico', { html: icon(m.icon) }),
      h('span.seg-txt', null, m.zh),
      h('kbd.seg-key', null, m.key),
    ]);
    b.addEventListener('click', () => actions.setMode(m.id));
    b.style.setProperty('--i', i);
    return b;
  });
  const modeSwitch = h('div.modes.glass.hud-hideable', { role: 'radiogroup', 'aria-label': '浏览模式' }, [h('span.seg-pill', { 'aria-hidden': 'true' }), ...modeBtns]);

  // ---------------------------------------------------------------- toolbar
  const searchPill = h('button.search-pill', { type: 'button', 'aria-label': '搜索地点 (/)' }, [
    h('span', { html: icon('search') }), h('span.sp-txt', null, '搜索地点'), h('kbd', null, '/'),
  ]);
  searchPill.addEventListener('click', () => actions.openSearch());
  const tourBtn = btn('tour', '导览', 'T', () => actions.toggleTour());
  const labelsBtn = btn('labels', '标签', 'L', () => actions.toggleLabels(), 'opt');
  const mapBtn = btn('map', '地图', 'M', () => actions.toggleMap(), 'opt');
  const helpBtn = btn('help', '帮助', 'H', () => actions.toggleHelp(), 'opt');
  const linkBtn = btn('link', '复制视角链接', '', () => actions.copyLink(), 'opt.tb-link');
  const fsSupported = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const fsBtn = btn('expand', '全屏', '', () => actions.toggleFullscreen(), 'opt.tb-fs');
  if (!fsSupported) fsBtn.hidden = true;
  const setBtn = btn('sliders', '设置', '', () => togglePopover());
  setBtn.setAttribute('aria-haspopup', 'dialog');
  setBtn.setAttribute('aria-expanded', 'false');
  const mSearchBtn = btn('search', '搜索', '/', () => actions.openSearch(), 'mobile-only');
  const toolbar = h('div.toolbar.glass.hud-hideable', { role: 'toolbar', 'aria-label': '工具栏' }, [
    searchPill, mSearchBtn, h('span.tb-sep'), tourBtn, labelsBtn, mapBtn, helpBtn, linkBtn, fsBtn, setBtn,
  ]);

  // ---------------------------------------------------------------- settings popover
  const qBtns = QUALITY.map((q) => {
    const b = h('button.seg-mini', { type: 'button', role: 'radio', 'data-q': q.id, 'aria-checked': String(ctx.quality?.level === q.id), title: q.desc }, q.zh);
    b.addEventListener('click', () => actions.setQuality(q.id));
    return b;
  });
  const qDesc = h('div.pop-desc', null, (QUALITY.find((q) => q.id === ctx.quality?.level) || QUALITY[1]).desc);
  const toggleRow = (ico, label, key, get, onClick) => {
    const sw = h('span.switch', { 'aria-hidden': 'true' }, h('i'));
    const b = h('button.pop-row', { type: 'button', role: 'switch', 'aria-checked': String(!!get()) }, [
      h('span.pop-ico', { html: icon(ico) }), h('span.pop-label', null, label), key ? h('kbd', null, key) : null, sw,
    ]);
    b.addEventListener('click', () => { onClick(); });
    b.sync = () => b.setAttribute('aria-checked', String(!!get()));
    return b;
  };
  const rowLabels = toggleRow('labels', '显示标签', 'L', () => actions.labelsOn(), () => actions.toggleLabels());
  const rowMap = toggleRow('map', '小地图', 'M', () => actions.mapOn(), () => actions.toggleMap());
  const rowFps = toggleRow('gauge', '性能信息', '', () => debugOn, () => setDebug(!debugOn));
  const actRow = (ico, label, onClick, hidden = false) => {
    const b = h('button.pop-row.pop-act', { type: 'button', hidden }, [h('span.pop-ico', { html: icon(ico) }), h('span.pop-label', null, label)]);
    b.addEventListener('click', () => { closePopover(); onClick(); });
    return b;
  };
  const popover = h('div.popover.glass', { role: 'dialog', 'aria-label': '设置', 'aria-hidden': 'true' }, [
    h('div.pop-sec', null, [
      h('div.pop-h', null, [h('span', null, '画质'), h('small', null, 'Quality · 切换后重新加载')]),
      h('div.seg-row', { role: 'radiogroup', 'aria-label': '画质' }, qBtns),
      qDesc,
    ]),
    h('div.pop-sec', null, [rowLabels, rowMap, rowFps]),
    h('div.pop-sec.pop-actions', null, [
      actRow('link', '复制当前视角链接', () => actions.copyLink()),
      actRow('expand', '全屏', () => actions.toggleFullscreen(), !fsSupported),
      actRow('help', '操作指南', () => actions.toggleHelp()),
      actRow('target', '回到校园全景', () => actions.goHome?.()),
    ]),
  ]);
  let popOpen = false;
  function togglePopover(force) {
    popOpen = force === undefined ? !popOpen : force;
    popover.classList.toggle('open', popOpen);
    popover.setAttribute('aria-hidden', String(!popOpen));
    setBtn.setAttribute('aria-expanded', String(popOpen));
    setBtn.classList.toggle('on', popOpen);
    if (popOpen) { rowLabels.sync(); rowMap.sync(); rowFps.sync(); }
  }
  function closePopover() { if (popOpen) togglePopover(false); }
  document.addEventListener('pointerdown', (e) => {
    if (popOpen && !popover.contains(e.target) && !setBtn.contains(e.target)) closePopover();
  }, true);
  const topRight = h('div.hud-tr', null, [toolbar, popover]);

  // ---------------------------------------------------------------- compass
  const rose = h('div.compass-rose', { html: compassSvg() });
  const compass = h('button.compass.glass.hud-hideable', { type: 'button', 'aria-label': '指南针：点击朝北', 'data-tip': '点击朝北' }, rose);
  compass.addEventListener('click', () => actions.faceNorth());

  // ---------------------------------------------------------------- time / season panel
  const env = ctx.env;
  const clockEl = h('span.env-clock', null, '15:00');
  const partEl = h('span.env-part', null, '下午');
  const dayIco = h('span.env-ico', { html: icon('sun') });
  const slider = h('input.env-slider', { type: 'range', min: '0', max: '24', step: '0.25', value: '15', 'aria-label': '一天中的时间' });
  const playBtn = h('button.icon-btn.sm.env-play', { type: 'button', 'aria-label': '播放延时 · 时间流逝', 'data-tip': '时间流逝', html: icon('play') });
  const nightBtn = h('button.icon-btn.sm.env-night', { type: 'button', 'aria-label': '白天 / 夜晚 (N)', 'data-tip': '昼 / 夜 · N', html: icon('moon') });
  const seasonBtns = SEASONS.map((s) => {
    const b = h(`button.season.s-${s.id}`, { type: 'button', role: 'radio', 'data-s': s.id, 'aria-checked': 'false', 'aria-label': `${s.zh}季 ${s.en}`, title: `${s.zh}季 · ${s.en}` }, [h('i'), h('span', null, s.zh)]);
    b.addEventListener('click', () => actions.setSeason(s.id));
    return b;
  });
  const envToggle = h('button.env-head', { type: 'button', 'aria-expanded': 'true', 'aria-label': '时间与季节' }, [dayIco, clockEl, partEl, h('span.env-caret', { html: icon('chevU') })]);
  const envPanel = h('section.envp.glass.hud-hideable', { 'aria-label': '时间与季节' }, [
    h('div.env-top', null, [envToggle, h('span.env-btns', null, [playBtn, nightBtn])]),
    h('div.env-body', null, [
      h('div.env-slider-wrap', null, [slider, h('div.env-ticks', { 'aria-hidden': 'true' }, ['0', '6', '12', '18', '24'].map((t) => h('span', null, t)))]),
      h('div.seasons', { role: 'radiogroup', 'aria-label': '季节' }, seasonBtns),
    ]),
  ]);
  let envCollapsed = isNarrow();
  const applyEnvCollapsed = () => { envPanel.classList.toggle('collapsed', envCollapsed); envToggle.setAttribute('aria-expanded', String(!envCollapsed)); };
  applyEnvCollapsed();
  envToggle.addEventListener('click', () => { envCollapsed = !envCollapsed; applyEnvCollapsed(); });
  if (!env?.setTime) envPanel.classList.add('disabled');

  let dragging = false;
  let pendingT = null;
  slider.addEventListener('pointerdown', () => { dragging = true; });
  addEventListener('pointerup', () => { dragging = false; });
  slider.addEventListener('input', () => {
    const v = +slider.value;
    showTime(v);
    pendingT = v;
  });
  slider.addEventListener('change', () => { dragging = false; });
  playBtn.addEventListener('click', () => actions.toggleTimeLapse());
  nightBtn.addEventListener('click', () => actions.toggleNight());

  function showTime(hrs) {
    clockEl.textContent = fmtClock(hrs);
    partEl.textContent = dayPart(hrs);
    const night = hrs < 6 || hrs >= 19.8;
    const dusk = !night && (hrs < 7.5 || hrs >= 18);
    dayIco.innerHTML = icon(night ? 'moon' : dusk ? 'sunset' : 'sun');
    nightBtn.innerHTML = icon(night ? 'sun' : 'moon');
    envPanel.classList.toggle('is-night', night);
    root.classList.toggle('night', night);
    slider.style.setProperty('--p', `${(hrs / 24) * 100}%`);
  }

  // ---------------------------------------------------------------- walk hint + crosshair
  // A compact card at the bottom centre: shown when walking starts (and the mouse is free), gone after a few
  // seconds or at the first move / look input; it comes back only on the next walk entry.
  const walkHint = h('div.walk-hint', { 'aria-live': 'polite' }, [
    h('div.wh-keys', { 'aria-hidden': 'true' }, [
      h('span', null, [h('kbd', null, 'W')]),
      h('span', null, [h('kbd', null, 'A'), h('kbd', null, 'S'), h('kbd', null, 'D')]),
    ]),
    h('div.wh-txt', null, [h('b', null, '点击画面锁定鼠标开始步行 · Esc 退出'), h('small', null, 'WASD 移动 · Shift 奔跑 · 空格 跳跃 · 拖动或锁定鼠标环视')]),
  ]);
  const HINT_MS = 5200;                 // visible time once the walker has landed
  let hintUntil = 0, hintDismissed = false, hintWanted = false;
  function hideWalkHint(dismiss) {
    hintUntil = 0;
    walkHint.classList.remove('show');
    if (dismiss) hintDismissed = true;
  }
  function showWalkHint() {
    if (hintDismissed) return;
    walkHint.classList.add('show');
    hintUntil = performance.now() + HINT_MS;
  }
  const HINT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);
  addEventListener('keydown', (e) => { if (HINT_KEYS.has(e.code) && walkHint.classList.contains('show')) hideWalkHint(true); });
  (ctx.renderer?.domElement || ctx.canvas)?.addEventListener('pointerdown', () => { if (walkHint.classList.contains('show')) hideWalkHint(true); });
  const crosshair = h('div.crosshair', { 'aria-hidden': 'true' }, [h('i'), h('b')]);
  const lockHint = h('div.lock-hint', null, [h('kbd', null, 'Esc'), h('span', null, '释放鼠标'), h('span.sep'), h('kbd', null, 'Shift'), h('span', null, '奔跑'), h('span.sep'), h('kbd', null, '空格'), h('span', null, '跳跃')]);

  // ---------------------------------------------------------------- footer + debug
  const attrib = h('footer.attrib.hud-hideable', null, [h('span.attrib-full', null, ATTRIBUTION), h('span.attrib-short', null, '© OpenStreetMap · 非官方作品')]);
  const debugEl = h('pre.debug', { 'aria-hidden': 'true' });
  function setDebug(on) { debugOn = on; debugEl.classList.toggle('show', on); storage.set('cmu3d.debug', on ? '1' : '0'); rowFps.sync(); }
  setDebug(debugOn);

  const bottomLeft = h('div.hud-bl', null, [envPanel]);
  const rightCol = h('div.hud-r', null, [compass]);
  const topBar = h('div.hud-top', null, [topLeft, h('div.hud-tc', null, modeSwitch), topRight]);
  root.append(topBar, rightCol, bottomLeft, walkHint, crosshair, lockHint, attrib, debugEl);

  // Safety net for viewports the CSS breakpoints don't cover: compact the brand, then move the modes down.
  function fitTopBar() {
    root.classList.remove('hud-compact', 'modes-bottom');
    if (isNarrow()) return;                               // phones have their own layout
    const tight = () => {
      const b = brand.getBoundingClientRect(), m = modeSwitch.getBoundingClientRect(), t = toolbar.getBoundingClientRect();
      return t.right > innerWidth - 2 || m.left < b.right + 6 || m.right > t.left - 6;
    };
    if (!tight()) return;
    root.classList.add('hud-compact');
    if (tight()) root.classList.add('modes-bottom');
  }
  let fitT = 0;
  addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(fitTopBar, 120); });
  // measured once the app is up (no forced layout during init), again when the web fonts arrive
  ctx.events?.on?.('app:ready', () => {
    requestAnimationFrame(fitTopBar);
    document.fonts?.ready?.then(() => requestAnimationFrame(fitTopBar)).catch(() => {});
  });

  // ---------------------------------------------------------------- state sync
  let mode = null;
  function setMode(m) {
    if (m === mode) return;
    if (m === 'walk') hintDismissed = false;               // a new walk: the hint may show again
    mode = m;
    const i = Math.max(0, MODES.findIndex((x) => x.id === m));
    modeSwitch.style.setProperty('--sel', i);
    for (const b of modeBtns) b.setAttribute('aria-checked', String(b.dataset.mode === m));
    for (const x of MODES) root.classList.toggle(`mode-${x.id}`, x.id === m);
    updateLock();
  }
  let locked = false;
  function updateLock() {
    locked = !!document.pointerLockElement;
    root.classList.toggle('locked', locked);
    const touch = isTouchUI(ctx);
    const want = mode === 'walk' && !locked && !touch;
    if (want && !hintWanted) showWalkHint();
    else if (!want) hideWalkHint(false);
    hintWanted = want;
    crosshair.classList.toggle('show', mode === 'walk' && locked);
    lockHint.classList.toggle('show', mode === 'walk' && locked);
  }
  document.addEventListener('pointerlockchange', updateLock);
  ctx.events.on('nav:pointerlock', updateLock);

  function syncSeason(s) {
    for (const b of seasonBtns) b.setAttribute('aria-checked', String(b.dataset.s === s));
  }
  function syncTime(hrs) {
    if (!Number.isFinite(hrs) || dragging) return;
    slider.value = String(hrs);
    showTime(hrs);
  }
  function setPlaying(p) {
    playBtn.innerHTML = icon(p ? 'pause' : 'play');
    playBtn.classList.toggle('on', p);
    playBtn.setAttribute('aria-label', p ? '暂停时间流逝' : '播放延时 · 时间流逝');
  }
  function syncToggles({ labels, map }) {
    labelsBtn.classList.toggle('on', !!labels);
    labelsBtn.setAttribute('aria-pressed', String(!!labels));
    mapBtn.classList.toggle('on', !!map);
    mapBtn.setAttribute('aria-pressed', String(!!map));
    rowLabels.sync(); rowMap.sync();
  }
  function syncFullscreen() {
    const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
    fsBtn.innerHTML = icon(on ? 'shrink' : 'expand');
    fsBtn.dataset.tip = on ? '退出全屏' : '全屏';
  }
  document.addEventListener('fullscreenchange', syncFullscreen);

  // ---------------------------------------------------------------- per-frame
  // The controls' touch joystick (walk / fly on touch screens) sits bottom-left: panels there make room for it.
  let touchEl = null, joyOn = false;
  let lastHeading = NaN;
  let locT = 0, dbgT = 0, frames = 0, fpsAcc = 0, fps = 0, worstDt = 0;
  let lastLoc = '';
  function update(dt) {
    // apply slider drags at most once per frame
    if (pendingT !== null) { try { env?.setTime?.(pendingT); } catch (e) { console.warn(e); } pendingT = null; }
    const cam = ctx.camera;
    if (cam) {
      const hd = cameraHeading(cam);
      if (Math.abs(hd - lastHeading) > 0.002) {
        lastHeading = hd;
        rose.style.transform = `rotate(${(-hd * 180) / Math.PI}deg)`;
      }
    }
    const m = navMode(ctx);
    if (m !== mode) setMode(m);
    if (hintUntil) {
      if (ctx.nav?.busy) hintUntil = performance.now() + HINT_MS;   // the timer starts once the walk-to has landed
      else if (performance.now() > hintUntil) hideWalkHint(true);
    }
    if (!touchEl || !touchEl.isConnected) touchEl = root.querySelector('.nav-touch');
    const joy = !!touchEl && touchEl.style.display !== 'none' && (m === 'walk' || m === 'fly');
    if (joy !== joyOn) { joyOn = joy; root.classList.toggle('joy-on', joy); }
    // location readout
    locT += dt;
    if (locT > 0.5 && cam && catalog) {
      locT = 0;
      const txt = nearestPlace(ctx, catalog);
      if (txt !== lastLoc) {
        lastLoc = txt;
        locEl.innerHTML = txt ? `${icon('pin')}<span>${txt}</span>` : '';
        locEl.classList.toggle('show', !!txt);
      }
    }
    // debug overlay
    if (debugOn) {
      frames++; fpsAcc += dt; worstDt = Math.max(worstDt, dt); dbgT += dt;
      if (dbgT > 0.5) {
        fps = frames / fpsAcc;
        const info = ctx.renderer?.info;
        const p = cam?.position;
        debugEl.textContent = [
          `FPS  ${fps.toFixed(0).padStart(3)}   worst ${(worstDt * 1000).toFixed(1)} ms`,
          info ? `draw ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k` : '',
          info ? `geo ${info.memory.geometries}  tex ${info.memory.textures}` : '',
          p ? `cam ${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}` : '',
          `mode ${m}  q ${ctx.quality?.level || '?'}  ui ${(ctx.ui?.perf?.ms ?? 0).toFixed(2)} ms`,
        ].filter(Boolean).join('\n');
        frames = 0; fpsAcc = 0; dbgT = 0; worstDt = 0;
      }
    }
  }

  return {
    update, setMode, syncSeason, syncTime, setPlaying, syncToggles, syncFullscreen,
    closePopover, get popoverOpen() { return popOpen; },
    showTime,
    setDebug,
    fitTopBar,
  };
}

function nearestPlace(ctx, catalog) {
  const st = ctx.nav?.getState?.();
  const p = st?.mode === 'orbit' && st.target ? st.target : ctx.camera ? [ctx.camera.position.x, 0, ctx.camera.position.z] : null;
  if (!p) return '';
  const camY = ctx.camera.position.y - (ctx.heightAt?.(ctx.camera.position.x, ctx.camera.position.z) ?? 0);
  if (camY > 900) return '';
  let best = null, bd = Infinity;
  for (const r of catalog.records) {
    if (!r.position || r.kind === 'poi') continue;
    if (r.kind === 'building' && !r.campus) continue;
    const d = Math.hypot(r.position[0] - p[0], r.position[2] - p[2]) - (r.radius || 20) * 0.6 - (r.kind === 'landmark' ? 15 : 0);
    if (d < bd) { bd = d; best = r; }
  }
  if (!best || bd > 140) return '';
  const name = best.nameZh || best.nameEn;
  return `${bd < 20 ? '' : '靠近 '}${name}`;
}

function compassSvg() {
  const ticks = [];
  for (let i = 1; i < 36; i++) {
    const a = (i * 10 * Math.PI) / 180;
    const long = i % 9 === 0;
    const r0 = long ? 15.5 : 17.2, r1 = 19;
    ticks.push(`<line x1="${(Math.sin(a) * r0).toFixed(2)}" y1="${(-Math.cos(a) * r0).toFixed(2)}" x2="${(Math.sin(a) * r1).toFixed(2)}" y2="${(-Math.cos(a) * r1).toFixed(2)}" stroke-width="${long ? 1.3 : 0.7}"/>`);
  }
  return `<svg viewBox="-22 -22 44 44" width="44" height="44" aria-hidden="true">
    <g stroke="currentColor" opacity=".55">${ticks.join('')}</g>
    <path d="M0 -12.5 L4 0 L0 -2 L-4 0 Z" fill="#e8364f"/>
    <path d="M0 12.5 L4 0 L0 2 L-4 0 Z" fill="currentColor" opacity=".75"/>
    <circle r="1.6" fill="currentColor"/>
    <text x="0" y="-15" text-anchor="middle" font-size="6.6" font-weight="700" fill="#ff6b7d" font-family="Source Serif 4, Georgia, serif">N</text>
  </svg>`;
}

export { MODES, SEASONS };
