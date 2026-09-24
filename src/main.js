// Application bootstrap. Builds the world step by step behind the loading screen.
import { createContext } from './core/context.js';
import { createMaterials } from './core/materials.js';
import { createEngine } from './core/engine.js';
import { createEnvironment } from './core/env.js';
import { createTerrain } from './world/terrain.js';
import { createRoads } from './world/roads.js';
import { createBuildings } from './world/buildings.js';
import { createVegetation } from './world/vegetation.js';
import { createProps } from './world/props.js';
import { createLife } from './world/life.js';
import { createStreetSigns } from './world/streetsigns.js';
import { LANDMARKS } from './landmarks/index.js';
import { createControls } from './controls/controls.js';
import { createLoadingScreen, createUI } from './ui/ui.js';
import { shareUrl } from './ui/navutil.js';

// Display name for a landmark: prefer the curated CAMPUS_INFO name so the loading screen matches labels and panels
function landmarkName(ctx, lm) {
  const info = ctx.info || {};
  const e = info.landmarks?.[lm.key] || (lm.osmIds || []).map((id) => info.buildings?.[id]).find(Boolean);
  return e?.nameZh || lm.nameZh || lm.name;
}

function fatal(msg) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;inset:0;display:grid;place-items:center;background:#111;color:#eee;font:16px/1.6 system-ui;padding:24px;text-align:center';
  el.textContent = msg;
  document.body.appendChild(el);
}

async function main() {
  const data = window.CAMPUS_DATA;
  if (!data) { fatal('找不到 data/campus.js（校园数据）。请先运行 npm run data。'); return; }
  const ctx = createContext({ data, info: window.CAMPUS_INFO });
  window.__ctx = ctx;
  const params = new URLSearchParams(location.search);
  ctx.params = params;
  ctx.shotMode = params.has('shot');

  const loading = createLoadingScreen(ctx);
  ctx.loading = loading;
  const errors = [];

  // Register landmark replacements before anything generic is built
  for (const lm of LANDMARKS) {
    for (const id of lm.osmIds || []) ctx.skipBuildingIds.add(id);
  }
  // a replaced outline takes its building:parts with it (e.g. the Cathedral of Learning's OSM tower parts)
  for (const b of data.buildings) if (b.parentId && ctx.skipBuildingIds.has(b.parentId)) ctx.skipBuildingIds.add(b.id);
  ctx.skipRoadIds = new Set(LANDMARKS.flatMap((l) => l.skipRoads || []));
  ctx.skipBarrierIds = new Set(LANDMARKS.flatMap((l) => l.skipBarriers || []));

  const canvas = document.getElementById('scene');
  handleContextLoss(ctx, canvas);

  // Everything is built behind the loading screen, on every preset: a somewhat longer load buys smooth exploring
  // (building trees / props / traffic after the first frame on 'low' made the first seconds stutter).
  const worldSteps = [
    ['树木', () => createVegetation(ctx)],
    ['街道设施', () => createProps(ctx)],
    ['路牌', () => createStreetSigns(ctx)],
    ['行人与车辆', () => createLife(ctx)],
  ];
  const steps = [
    ['渲染引擎', () => createEngine(ctx, canvas)],
    ['天空与光照', () => createEnvironment(ctx)],
    ['材质', () => { ctx.materials = createMaterials(ctx); }],
    ['地形', () => createTerrain(ctx)],
    ['道路与桥梁', () => createRoads(ctx)],
    ['建筑', () => createBuildings(ctx)],
    ...LANDMARKS.map((lm) => [`地标 · ${landmarkName(ctx, lm)}`, async () => {
      const object = await lm.build(ctx);
      if (object) { object.name = object.name || `landmark:${lm.key}`; ctx.scene.add(object); }
      ctx.landmarks.push({ key: lm.key, name: lm.name, nameZh: lm.nameZh, osmIds: lm.osmIds || [], object });
    }]),
    ...worldSteps,
    ['操控', () => createControls(ctx)],
    ['界面', () => createUI(ctx)],
  ];

  const timings = [];
  window.__initTimings = timings;
  const tStart = performance.now();
  for (let i = 0; i < steps.length; i++) {
    const [label, fn] = steps[i];
    loading.step(label, 0.86 * (i / steps.length)); // the last 14 %: shaders, preload tasks, warm-up frames
    await ctx.yield();
    const t0 = performance.now();
    try {
      await fn();
      timings.push([label, Math.round(performance.now() - t0)]);
    } catch (e) {
      console.error(`[init] ${label} failed`, e);
      errors.push(`${label}: ${e.message}`);
      if (i < 2) { loading.error?.(`${label} 初始化失败：${e.message}`); return; }
    }
  }
  timings.push(['build', Math.round(performance.now() - tStart)]);

  const hours = parseFloat(params.get('hours'));
  if (Number.isFinite(hours)) ctx.env?.setTime?.(hours);
  window.__setView = (cam, look) => ctx.nav?.setView?.(cam, look);
  applyViewParams(ctx, params);

  // ---- final preparation, still behind the loading screen: whatever the first minutes of exploring would otherwise
  // build, compile or upload on the fly happens now (a few seconds more loading, no hitches afterwards).
  const timed = async (label, p, fn) => {
    loading.step(label, p);
    await ctx.yield();
    const t0 = performance.now();
    let r;
    try { r = await fn(); } catch (e) { console.warn(`[init] ${label} failed`, e); }
    timings.push([label, Math.round(performance.now() - t0)]);
    return r;
  };
  // 1. deferred work that modules registered with ctx.addLoadTask(label, fn) (detail builds, caches…)
  const tasks = (ctx.loadTasks || []).splice(0);
  for (let i = 0; i < tasks.length; i++) await timed(tasks[i][0], 0.86 + 0.03 * (i / tasks.length), tasks[i][1]);
  // 2. every shader program, compiled in parallel where the driver supports it, and every texture uploaded
  await timed('编译着色器', 0.89, () => ctx.engine.precompile());
  // 3. interaction caches: picking grids, label sizes, line-of-sight grids, the camera's terrain index
  await timed('准备交互', 0.93, async () => {
    ctx.nav?.prepare?.();
    await ctx.ui?.prepare?.((d) => loading.detail?.(d));
  });
  // 4. warm-up frames: the first frames' one-off work, then every object drawn once (GPU buffers, shader variants)
  const warm = await timed('预热场景', 0.97, () => ctx.engine.warmScene?.());
  if (warm) window.__warmStats = warm;
  timings.push(['total', Math.round(performance.now() - tStart)]);
  loading.step('准备就绪', 1);

  ctx.engine.start();
  const tf = performance.now();
  requestAnimationFrame(() => requestAnimationFrame(() => timings.push(['firstFrames', Math.round(performance.now() - tf)])));
  loading.done();
  ctx.events.emit('app:ready', { errors });
  ctx.events.emit('world:complete');     // (kept for listeners: the world is always complete at this point now)
  if (errors.length) console.warn('[init] finished with errors:', errors);

  let frames = 0;
  const unsub = ctx.onUpdate(() => { if (++frames > 8) { window.__READY = true; unsub(); } }, 1000);
}

// ?cam=x,y,z&look=x,y,z[&mode=walk|fly] — shared links. Empty or non-numeric fields make the link invalid.
function applyViewParams(ctx, params) {
  const vec = (s) => {
    const v = String(s || '').split(',').map((t) => (t.trim() === '' ? NaN : Number(t)));
    return v.length === 3 && v.every(Number.isFinite) ? v : null;
  };
  const cam = vec(params.get('cam')), look = vec(params.get('look'));
  if (!cam || !look || !ctx.nav) return;
  cam[1] = Math.max(cam[1], ctx.heightAt(cam[0], cam[2]) + 1.2); // never start underground
  const mode = params.get('mode');
  try {
    if (mode === 'walk' && ctx.nav.walkTo) {
      const dx = look[0] - cam[0], dz = look[2] - cam[2];
      const heading = Math.atan2(dx, -dz);                           // compass heading, 0 = north
      const pitch = Math.atan2(look[1] - cam[1], Math.hypot(dx, dz) || 1);
      ctx.nav.walkTo(cam[0], cam[2], heading, { pitch, instant: true });
    } else {
      ctx.nav.setView?.(cam, look);
      if (mode === 'fly') ctx.nav.setMode?.('fly');
    }
  } catch (e) { console.warn('[init] could not apply the shared view', e); }
}

// Lost GPU context: tell the user, then reload at the same view once it is restored (textures can't be rebuilt in
// place because canvases are released after upload). Repeated losses step the quality down instead of looping.
function handleContextLoss(ctx, canvas) {
  canvas.addEventListener('webglcontextlost', () => {
    try { ctx.ui?.toast?.('图形渲染中断，正在恢复…', { icon: 'warn', ms: 8000 }); } catch { /* UI may not exist yet */ }
  });
  canvas.addEventListener('webglcontextrestored', () => {
    let url;
    try { url = new URL(shareUrl(ctx)); } catch { url = new URL(location.href); }
    try {
      const now = Date.now();
      const log = JSON.parse(sessionStorage.getItem('cmu3d.reloads') || '[]').filter((t) => now - t < 60000);
      log.push(now);
      sessionStorage.setItem('cmu3d.reloads', JSON.stringify(log));
      if (log.length > 2) url.searchParams.set('q', ctx.quality.level === 'high' ? 'medium' : 'low');
    } catch { /* storage blocked */ }
    setTimeout(() => location.replace(url.href), 100);
  });
}

main().catch((e) => { console.error(e); fatal(`启动失败：${e.message}`); });
