// CMU 3D user interface — entry points required by main.js (see ARCHITECTURE.md §ui):
//   createLoadingScreen(ctx) → { step(label, p), detail(text), done(), error(msg) }
//   createUI(ctx)            → ctx.ui = { showInfo(entry), hideInfo(), toast(msg), startTour(), stopTour(), … }
// Everything is built from JS inside #ui. Each part lives in its own module; this file wires them together,
// owns the keyboard shortcuts (M T H ? L N / F Esc 1 2 3) and the selection state.
import * as THREE from 'three';
import { h, uiRoot, isTyping, copyText, storage, reducedMotion, isTouchUI, isNarrow, clamp } from './dom.js';
import { createLoadingScreen } from './loading.js';
import { createCatalog } from './catalog.js';
import { createLabels, addAuxLabels } from './labels.js';
import { createRoadLabels } from './roadlabels.js';
import { createPicking } from './picking.js';
import { createInfoPanel } from './infopanel.js';
import { createSearch } from './search.js';
import { createMinimap } from './minimap.js';
import { createTour } from './tour.js';
import { createHelp, createToasts } from './help.js';
import { createHud, SEASONS } from './hud.js';
import { createFraming } from './framing.js';
import { icon } from './icons.js';
import { flyToRecord, frameDistance, shareUrl, faceNorth, navMode } from './navutil.js';

export { createLoadingScreen };

// Time-lapse rate in simulated hours per real second (a full day in ~48 s).
// env.setTimeSpeed(k) takes simulated SECONDS per real second, hence the × 3600.
const TIMELAPSE_HOURS_PER_SEC = 0.5;

export function createUI(ctx) {
  const root = uiRoot();
  const params = ctx.params || new URLSearchParams(location.search);
  if (params.has('noui')) root.classList.add('noui');
  if (reducedMotion()) root.classList.add('reduced-motion');
  const touchUI = isTouchUI(ctx);
  if (touchUI) root.classList.add('is-touch');
  // quality class: at low the frosted-glass panels drop their per-frame backdrop blur (css)
  const setQualityClass = (lvl) => { for (const q of ['low', 'medium', 'high']) root.classList.toggle(`q-${q}`, q === lvl); };
  setQualityClass(ctx.quality?.level || 'medium');
  ctx.events.on('quality', (q) => setQualityClass(typeof q === 'string' ? q : q?.level || ctx.quality?.level));

  const toast = createToasts(root);
  const safe = (label, fn, fallback = null) => { try { return fn(); } catch (e) { console.error(`[ui] ${label} failed`, e); return fallback; } };

  // ---------------------------------------------------------------- data
  const catalog = safe('catalog', () => createCatalog(ctx)) || { records: [], get: () => null, fromPick: () => null, infoFor: () => null, search: () => [], byKey: new Map(), dedupe: (l) => l };
  safe('aux labels', () => addAuxLabels(ctx, catalog));

  // first-visit welcome card state (see the end of this function)
  let welcomed = false;
  let welcomeEl = null;
  let welcomeOpen = false;

  // ---------------------------------------------------------------- selection
  let selected = null;
  let emitting = false;
  function entryFor(rec) {
    if (!rec) return null;
    const e = {
      key: rec.landmarkKey || rec.osmId || rec.key, kind: rec.kind, name: rec.nameEn, nameZh: rec.nameZh,
      osmId: rec.osmId || null, position: rec.position, radius: rec.radius,
    };
    Object.defineProperty(e, '__rec', { value: rec, enumerable: false });
    return e;
  }
  function emitSelect(entry) {
    emitting = true;
    try { ctx.events.emit('select', entry); } finally { emitting = false; }
  }
  // Accepts a catalogue record, a pick entry ({key, kind, osmId…}) or a string (landmark key, osmId or name).
  function resolveTarget(target) {
    if (!target) return null;
    if (typeof target === 'string') {
      return catalog.get(target) || catalog.get(`lm:${target}`) || catalog.byOsm?.get(target) || catalog.byName?.(target)
        || catalog.records.find((r) => r.nameZh === target) || null;
    }
    return target.cat && target.kind ? target : catalog.fromPick(target);
  }
  function select(target, { fly = false, entry = null } = {}) {
    const rec = resolveTarget(target);
    if (!rec) { deselect(); return null; }
    if (tour?.active) tour.stop();
    selected = rec;
    info?.show(rec);
    emitSelect(entry || entryFor(rec));
    if (fly) flyToRecord(ctx, rec);
    else setTimeout(() => { if (selected === rec) revealIfHidden(rec); }, 80);
    return rec;
  }
  function deselect() {
    const had = !!selected;
    selected = null;
    info?.hide(true);
    if (had) emitSelect(null);
  }
  ctx.events.on('select', (entry) => {
    if (emitting) return;             // our own emit
    if (!entry) { selected = null; info?.hide(true); return; }
    const rec = catalog.fromPick(entry);
    if (rec) { selected = rec; info?.show(rec); }
  });

  // ---------------------------------------------------------------- components
  const obstacleSel = '.brand, .loc.show, .modes, .toolbar, .popover.open, .compass, .envp, .minimap:not(.collapsed), .mm-fab.show, .info.open, .info-chip.show, .tour.open, .walk-hint.show, .welcome.open, .attrib, .debug.show';
  const labels = safe('labels', () => createLabels(ctx, {
    root, catalog,
    obstacles: () => {
      if (root.classList.contains('touring')) {
        const bar = innerHeight * 0.055;   // cinematic letterbox bars
        return [...root.querySelectorAll('.tour.open')].map((e) => e.getBoundingClientRect())
          .concat([{ left: 0, right: innerWidth, top: 0, bottom: bar }, { left: 0, right: innerWidth, top: innerHeight - bar, bottom: innerHeight }]);
      }
      return [...root.querySelectorAll(obstacleSel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    },
    onSelect: (lb, rec) => {
      const r = rec || (lb.recKey && catalog.get(lb.recKey)) || catalog.fromPick({
        key: lb.key, kind: lb.kind === 'area' || lb.kind === 'poi' || lb.kind === 'landmark' ? lb.kind : 'building',
        name: lb.text, nameZh: lb.textZh, osmId: lb.osmId, infoKey: lb.infoKey,
        position: lb.position ? [lb.position.x, lb.position.y, lb.position.z] : null,
      });
      if (r) select(r, { fly: true });
    },
  }));
  // road names along the streets (below the other labels, placed in the gaps they leave)
  const roadLabels = safe('road labels', () => createRoadLabels(ctx, { root, labels, before: labels?.layer }));
  const copyLink = async () => {
    const ok = await copyText(shareUrl(ctx));
    toast(ok ? '已复制当前视角链接' : '复制失败，请手动复制地址栏', { icon: ok ? 'check' : 'warn' });
  };
  const info = safe('info panel', () => createInfoPanel(ctx, {
    root, catalog, toast, copyLink,
    onClose: () => { if (selected) { selected = null; emitSelect(null); } },
  }));
  const search = safe('search', () => createSearch(ctx, {
    root, catalog,
    onPick: (rec) => select(rec, { fly: true }),
    onHome: () => { deselect(); actions.goHome(); },
    onOpenChange: () => syncNavEnabled(),
  }));
  const minimap = safe('minimap', () => createMinimap(ctx, { root, catalog, getSelected: () => selected, toast }));
  const tour = safe('tour', () => createTour(ctx, {
    root, toast,
    onStart: () => { closeWelcome(); deselect(); search?.close(); help?.hide(); hud?.closePopover(); labels?.setMinPriority(5); roadLabels?.setMinPriority(6); framing?.refresh(); },
    onStop: () => { labels?.setMinPriority(-Infinity); roadLabels?.setMinPriority(-Infinity); framing?.refresh(); },
    onFinishAction: (kind) => {
      if (kind === 'home') actions.goHome();
      else if (kind === 'search') actions.openSearch();
    },
  }));
  const help = safe('help', () => createHelp(ctx, { root, onOpenChange: () => syncNavEnabled() }));

  // ---------------------------------------------------------------- framing around panels
  // The part of the screen a panel covers; the view is shifted by half of it so framed targets stay visible.
  function coveredInset() {
    const W = innerWidth, H = innerHeight;
    if (tour?.active && tour.el) {
      const r = tour.el.getBoundingClientRect();
      if (!r.height) return null;
      const bar = H * 0.055;
      const bottom = Math.max(bar + 120, r.top - 8);
      return { x: 0, y: clamp(H / 2 - (bar + bottom) / 2, 0, H * 0.2) };
    }
    if (info?.isOpen && info.el) {
      if (isNarrow()) return { x: 0, y: clamp(info.el.offsetHeight / 2, 0, H * 0.3) };
      return { x: clamp((info.el.offsetWidth + 16) / 2, 0, W * 0.3), y: 0 };
    }
    return null;
  }
  const framing = safe('framing', () => createFraming(ctx, { getInset: coveredInset }));
  const projV = new THREE.Vector3();
  // A record selected by a click / tap may end up under the panel: pan (same distance and angle) to reveal it.
  function revealIfHidden(rec) {
    const nav = ctx.nav;
    if (!rec?.position || !nav?.flyTo || !info?.isOpen || navMode(ctx) !== 'orbit' || nav.busy || !ctx.camera) return;
    const W = innerWidth, H = innerHeight;
    const inset = coveredInset() || { x: 0, y: 0 };
    const off = framing?.offset?.() || { x: 0, y: 0 };
    projV.set(rec.position[0], rec.position[1], rec.position[2]).project(ctx.camera);
    if (projV.z > 1) return;
    // screen position once the framing shift has finished easing
    const sx = (projV.x + 1) / 2 * W - (inset.x + off.x), sy = (1 - projV.y) / 2 * H - (inset.y + off.y);
    const right = W - inset.x * 2, bottom = H - inset.y * 2;
    if (sx > 24 && sx < right - 24 && sy > 70 && sy < bottom - 24) return;
    let st = null;
    try { st = nav.getState(); } catch { st = null; }
    if (!st) return;
    safe('reveal', () => nav.flyTo({
      target: rec.position.slice(), distance: st.distance || frameDistance(rec),
      heading: st.heading, elevation: Number.isFinite(st.pitch) ? -st.pitch : undefined, duration: 0.9,
    }));
  }

  // ---------------------------------------------------------------- time-lapse
  let lapse = false;
  let lapseSelf = false;   // true when env has no setTimeSpeed and the UI advances time itself
  function setTimeLapse(on) {
    lapse = on;
    const env = ctx.env;
    lapseSelf = false;
    if (env?.setTimeSpeed) safe('setTimeSpeed', () => env.setTimeSpeed(on ? TIMELAPSE_HOURS_PER_SEC * 3600 : 0));
    else lapseSelf = on && !!env?.setTime;
    hud?.setPlaying(on);
  }
  const getHours = () => {
    const env = ctx.env;
    const v = env?.getTime ? env.getTime() : env?.state?.hours;
    return Number.isFinite(v) ? v : 15;
  };

  // ---------------------------------------------------------------- HUD actions
  let labelsOn = storage.get('cmu3d.labels') !== 'off';
  labels?.setEnabled(labelsOn);
  roadLabels?.setEnabled(labelsOn);
  const actions = {
    setMode(m) {
      if (!ctx.nav?.setMode) { toast('导航模块不可用'); return; }
      if (tour?.active) tour.stop();
      closeWelcome();
      safe('setMode', () => ctx.nav.setMode(m));
    },
    openSearch: () => { closeWelcome(); hud?.closePopover(); search?.open(); },
    toggleTour: () => tour?.toggle(),
    toggleLabels() {
      labelsOn = !labelsOn;
      labels?.setEnabled(labelsOn);
      roadLabels?.setEnabled(labelsOn);
      storage.set('cmu3d.labels', labelsOn ? 'on' : 'off');
      syncToggles();
      toast(labelsOn ? '标签：显示' : '标签：隐藏', { icon: 'labels', ms: 1400 });
    },
    labelsOn: () => labelsOn,
    toggleMap() { minimap?.toggle(); syncToggles(); },
    mapOn: () => (minimap ? !minimap.collapsed : false),
    toggleHelp: () => { closeWelcome(); hud?.closePopover(); help?.toggle(); },
    copyLink,
    toggleFullscreen() {
      const d = document;
      const el = d.documentElement;
      if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen)?.call(d);
      else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => toast('浏览器拒绝了全屏请求'));
    },
    setQuality(level) {
      if (level === ctx.quality?.level) { toast('已经是这个画质'); return; }
      storage.set('cmu3d.quality', level);
      const u = new URL(location.href);
      if (u.searchParams.has('q')) u.searchParams.set('q', level);
      toast(`正在以「${{ low: '低', medium: '中', high: '高' }[level]}」画质重新加载…`, { icon: 'refresh' });
      setTimeout(() => { if (u.href !== location.href) location.href = u.href; else location.reload(); }, 450);
    },
    setSeason(s) {
      if (!ctx.env?.setSeason) { toast('环境模块不可用'); return; }
      safe('setSeason', () => ctx.env.setSeason(s));
      hud?.syncSeason(s);
      const x = SEASONS.find((q) => q.id === s);
      if (x) toast(`${x.zh}季 · ${x.en}`, { ms: 1500 });
    },
    toggleTimeLapse: () => setTimeLapse(!lapse),
    toggleNight() {
      if (!ctx.env?.setTime) { toast('环境模块不可用'); return; }
      const hNow = getHours();
      const day = hNow >= 6.5 && hNow < 19;
      if (lapse) setTimeLapse(false);
      safe('setTime', () => ctx.env.setTime(day ? 21.5 : 15));
      hud?.syncTime(day ? 21.5 : 15);
      toast(day ? '夜晚 · 21:30' : '白天 · 15:00', { icon: day ? 'moon' : 'sun', ms: 1500 });
    },
    faceNorth: () => faceNorth(ctx),
    goHome() {
      if (tour?.active) tour.stop();
      if (ctx.nav?.goHome) safe('goHome', () => ctx.nav.goHome());
      else if (ctx.nav?.flyTo) {
        const y = ctx.heightAt ? ctx.heightAt(-95, 55) : 45;
        safe('flyTo', () => ctx.nav.flyTo({ target: [-95, y, 55], position: [420, y + 380, 420] }));
      }
    },
  };
  const hud = safe('hud', () => createHud(ctx, { root, catalog, actions }));
  function syncToggles() { hud?.syncToggles({ labels: labelsOn, map: minimap ? !minimap.collapsed : false }); }
  syncToggles();

  const picking = safe('picking', () => createPicking(ctx, {
    root, catalog, labels,
    isBlocked: () => !!(search?.isOpen || help?.isOpen || tour?.active),
    onSelect: (entry, rec) => {
      closeWelcome();
      if (entry && rec) select(rec, { entry });
      else if (info?.isOpen) deselect();
    },
  }));

  // ---------------------------------------------------------------- nav.enabled while typing / modal
  function syncNavEnabled() {
    if (!ctx.nav) return;
    const block = isTyping() || !!search?.isOpen || !!help?.isOpen;
    try { if (ctx.nav.enabled !== !block) ctx.nav.enabled = !block; } catch { /* read-only nav */ }
  }
  root.addEventListener('focusin', syncNavEnabled);
  root.addEventListener('focusout', () => setTimeout(syncNavEnabled, 0));

  // ---------------------------------------------------------------- events from other modules
  let lastMode = navMode(ctx);
  hud?.setMode(lastMode);
  ctx.events.on('nav:mode', (p) => {
    const m = typeof p === 'string' ? p : p?.mode;
    if (!m) return;
    hud?.setMode(m);
    // touch walk / fly: the joystick takes the left of the screen and a drag elsewhere looks around —
    // the info panel folds into a chip so it doesn't cover the look-around area
    if (touchUI && (m === 'walk' || m === 'fly') && info?.isOpen) info.collapse?.();
    if (m !== lastMode) {
      if (m === 'fly') toast(touchUI ? '飞行模式 · 左侧摇杆移动 · 右侧拖动转向 · 升 / 降 按钮' : '飞行模式 · WASD 移动 · E/Q 升降 · 拖动转向 · 滚轮调速', { icon: 'fly', ms: 3200 });
      if (m === 'walk' && touchUI) toast('步行模式 · 左侧摇杆移动 · 右侧拖动环视', { icon: 'walk', ms: 3200 });
      if (m === 'orbit' && lastMode) toast('俯瞰模式', { icon: 'orbit', ms: 1200 });
    }
    lastMode = m;
    framing?.refresh();
  });
  ctx.events.on('env:change', (st) => { if (st && Number.isFinite(st.hours)) hud?.syncTime(st.hours); });
  ctx.events.on('env:season', (s) => hud?.syncSeason(typeof s === 'string' ? s : s?.season));
  ctx.events.on('app:ready', (p) => {
    const n = p?.errors?.length || 0;
    if (n) toast(`有 ${n} 个模块加载失败，部分内容可能缺失`, { icon: 'warn', ms: 4200 });
    welcome();
  });
  hud?.syncTime(getHours());
  if ((ctx.env?.getTimeSpeed?.() || 0) > 0) { lapse = true; hud?.setPlaying(true); }
  hud?.syncSeason(ctx.env?.state?.season || params.get('season') || 'autumn');

  // ---------------------------------------------------------------- keyboard
  // Esc that releases the walk-mode pointer lock must not also close panels.
  let lastUnlock = 0;
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) lastUnlock = performance.now(); });
  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (e.isComposing || e.keyCode === 229) return;          // IME composition (pinyin): not a shortcut
    if (isTyping()) return;
    const k = e.key;
    if (k === 'Escape') {
      if (document.pointerLockElement || performance.now() - lastUnlock < 300) return;
      if (welcomeOpen) closeWelcome();
      else if (search?.isOpen) search.close();
      else if (help?.isOpen) help.hide();
      else if (hud?.popoverOpen) hud.closePopover();
      else if (tour?.active) tour.stop();
      else if (info?.isOpen) deselect();
      else if (navMode(ctx) === 'walk' || navMode(ctx) === 'fly') actions.setMode('orbit');   // "Esc 退出步行"
      else return;
      e.preventDefault();
      return;
    }
    if (search?.isOpen) return;
    let handled = true;
    switch (k) {
      case '/': case 'f': case 'F': actions.openSearch(); break;
      case '?': case 'h': case 'H': actions.toggleHelp(); break;
      case 'm': case 'M': actions.toggleMap(); break;
      case 't': case 'T': closeWelcome(); actions.toggleTour(); break;
      case 'l': case 'L': actions.toggleLabels(); break;
      case 'n': case 'N': actions.toggleNight(); break;
      case '1': actions.setMode('orbit'); break;
      case '2': actions.setMode('walk'); break;
      case '3': actions.setMode('fly'); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });

  // ---------------------------------------------------------------- per-frame
  // Each component updates in isolation: one that throws is logged (throttled) and the others keep running.
  const failures = new Map();
  function step(name, fn, dt) {
    try { fn(dt); } catch (e) {
      const n = (failures.get(name) || 0) + 1;
      failures.set(name, n);
      if (n === 1 || n % 600 === 0) console.error(`[ui] ${name}.update failed${n > 1 ? ` (${n}×)` : ''}`, e);
    }
  }
  const upd = {
    hud: (dt) => hud.update(dt), framing: (dt) => framing.update(dt), labels: (dt) => labels.update(dt), roadLabels: (dt) => roadLabels.update(dt),
    picking: (dt) => picking.update(dt), minimap: (dt) => minimap.update(dt), tour: (dt) => tour.update(dt),
  };
  let pollT = 0, pokeT = 0, obsT = 1;
  // HUD panel rects (label declutter obstacles) are re-read — a forced style / layout pass of ~1–2 ms — only while
  // they may be changing: for a while after a panel's class changes (open / close and their CSS transitions) or a
  // resize, plus a slow safety poll. The labels' own class toggles don't count.
  let obsHot = 1.5;
  const heat = () => { obsHot = 1.2; };
  addEventListener('resize', () => { obsT = 1; heat(); });
  try {
    new MutationObserver((list) => {
      for (const m of list) {
        const t = m.target;
        if (t.closest?.('.lbl-layer, .rlbl-layer')) continue;
        heat();
        return;
      }
    }).observe(root, { attributes: true, attributeFilter: ['class', 'aria-hidden'], subtree: true });
  } catch { obsHot = Infinity; }   // no MutationObserver: poll as before
  const perf = { ms: 0 };           // exponential moving average of the UI's own per-frame cost
  ctx.onUpdate((dt) => {
    const t0 = performance.now();
    // HUD rects for the label declutter: read first, before any component writes to the DOM this frame
    obsT += dt;
    obsHot -= dt;
    if (labels && obsT > (obsHot > 0 ? 0.2 : 2)) { obsT = 0; safe('obstacles', () => labels.sampleObstacles()); }
    if (lapseSelf && ctx.env?.setTime) {
      const hNow = (getHours() + dt * TIMELAPSE_HOURS_PER_SEC) % 24;
      safe('setTime', () => ctx.env.setTime(hNow));
    }
    pollT += dt;
    if (pollT > 0.25) { pollT = 0; hud?.syncTime(getHours()); }
    // reading a panel / the search list / the tour counts as activity: no idle showcase rotation meanwhile
    pokeT += dt;
    if (pokeT > 1 && (info?.isOpen || search?.isOpen || help?.isOpen || tour?.active || welcomeOpen)) { pokeT = 0; safe('poke', () => ctx.nav?.poke?.()); }
    if (hud) step('hud', upd.hud, dt);
    if (framing) step('framing', upd.framing, dt);
    if (labels) step('labels', upd.labels, dt);
    if (roadLabels) step('roadLabels', upd.roadLabels, dt);     // after labels: fits into this frame's declutter grid
    if (picking) step('picking', upd.picking, dt);
    if (minimap) step('minimap', upd.minimap, dt);
    if (tour) step('tour', upd.tour, dt);
    perf.ms += (performance.now() - t0 - perf.ms) * 0.05;
  }, 100);

  // ---------------------------------------------------------------- entrance + first-visit welcome
  const reveal = () => requestAnimationFrame(() => root.classList.add('hud-ready'));
  if (ctx.loading?.isDone === false) ctx.events.on('ui:loaded', reveal);
  else reveal();
  function closeWelcome() {
    if (!welcomeOpen) return;
    welcomeOpen = false;
    welcomeEl.classList.remove('open');
    welcomeEl.setAttribute('aria-hidden', 'true');
    setTimeout(() => welcomeEl?.remove(), 500);
  }
  function showWelcomeCard() {
    const meta = ctx.info?.meta || {};
    const startBtn = h('button.btn.btn-primary', { type: 'button' }, [h('span', { html: icon('tour') }), h('span', null, '开始导览')]);
    const freeBtn = h('button.btn.btn-ghost', { type: 'button' }, [h('span', { html: icon('orbit') }), h('span', null, '自由探索')]);
    const closeBtn = h('button.icon-btn.sm.wl-close', { type: 'button', 'aria-label': '关闭', html: icon('close') });
    const hint = touchUI
      ? '单指拖动旋转 · 双指缩放 · 轻点建筑查看介绍 · 右上角 ⚑ 导览'
      : '拖动旋转 · 滚轮缩放 · 点击建筑查看介绍 · 按 H 查看操作指南';
    welcomeEl = h('section.welcome.glass', { role: 'dialog', 'aria-labelledby': 'wl-title', 'aria-hidden': 'false' }, [
      h('div.wl-top', null, [h('span.wl-kicker', null, 'Welcome · 欢迎'), closeBtn]),
      h('h2.wl-title', { id: 'wl-title' }, meta.title || '卡内基梅隆大学 · 3D 校园'),
      meta.subtitle ? h('div.wl-sub', null, meta.subtitle) : null,
      meta.intro ? h('p.wl-intro', null, meta.intro) : null,
      meta.motto ? h('blockquote.wl-motto', null, meta.motto) : null,
      h('div.wl-hint', null, hint),
      h('div.wl-actions', null, [startBtn, freeBtn]),
    ]);
    root.appendChild(welcomeEl);
    welcomeOpen = true;
    storage.set('cmu3d.visited', '1');     // only once the card has actually been shown
    requestAnimationFrame(() => requestAnimationFrame(() => welcomeEl?.classList.add('open')));
    startBtn.addEventListener('click', () => { closeWelcome(); tour?.start(); });
    freeBtn.addEventListener('click', () => closeWelcome());
    closeBtn.addEventListener('click', () => closeWelcome());
    const canvas = ctx.renderer?.domElement || ctx.canvas;
    canvas?.addEventListener('pointerdown', () => closeWelcome(), { once: true });
    setTimeout(() => { if (welcomeOpen && !root.contains(document.activeElement)) startBtn.focus({ preventScroll: true }); }, 600);
  }
  function welcome() {
    if (welcomed) return;
    welcomed = true;
    const force = params.has('welcome');
    // A shared view (?cam&look): the visitor came to see exactly this — no card over it, no tour flying away.
    // A short hint instead; the welcome card waits for a later visit (cmu3d.visited stays unset).
    if (params.get('cam') && params.get('look') && !force) {
      if (!params.has('shot') && !params.has('noui')) {
        setTimeout(() => toast(touchUI ? '你打开的是一个分享视角 · 点 ⚙ 查看操作' : '你打开的是一个分享视角 · 按 H 查看操作', { icon: 'link', ms: 4200 }), 900);
      }
      return;
    }
    if (params.has('tour')) { setTimeout(() => tour?.start(), 900); return; }
    if (!force && (storage.get('cmu3d.visited') || params.has('shot') || params.has('noui'))) return;
    setTimeout(() => safe('welcome', showWelcomeCard), force ? 300 : 1400);
  }

  // ---------------------------------------------------------------- public API
  ctx.ui = {
    // Loading time (main.js): everything the first minutes of exploring would otherwise build lazily — label boxes
    // and line-of-sight grids, road-name anchors, the picking triangle grids. detail(text) updates the loading line.
    async prepare(detail) {
      safe('labels.prepare', () => labels?.prepare?.());
      safe('roadLabels.prepare', () => roadLabels?.prepare?.());
      safe('minimap.prepare', () => minimap?.prepare?.());
      safe('hud.prepare', () => hud?.prepare?.());
      // the info panel's first open (DOM build, cold code, catalogue lookups, layout) cost ~100 ms on the first click:
      // one open / close behind the loading screen (no events, no camera move)
      safe('info warm-up', () => {
        const rec = catalog.records.find((r) => r.kind === 'landmark' && r.position) || catalog.records[0];
        if (!info || !rec || info.isOpen) return;
        info.show(rec);
        void info.el.offsetHeight;
        info.hide(true);
      });
      detail?.('拾取网格');
      try { await picking?.prepare?.(() => ctx.yield()); } catch (e) { console.warn('[ui] pick grids failed', e); }
      detail?.('');
    },
    showInfo(entry) { return select(entry); },
    hideInfo: () => deselect(),
    toast: (msg, opts) => toast(msg, opts),
    startTour: () => tour?.start(),
    stopTour: () => tour?.stop(),
    // extras
    openSearch: (q) => { search?.open(q); },
    closeSearch: () => search?.close(),
    showHelp: () => help?.show(),
    hideHelp: () => help?.hide(),
    select: (target, opts) => select(target, opts),
    get selected() { return selected; },
    catalog,
    labels,
    roadLabels,
    minimap,
    tour,
    framing,
    picking,
    perf,
  };
  return ctx.ui;
}
