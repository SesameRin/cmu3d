// Loading-time completion of the world (queued by createLife, the last world build step).
//
// Browsing used to stutter whenever something was built or seen for the first time. Everything is built eagerly now
// (buildings' detail, terrain levels of detail, surroundings, marking / curb tiles, near-ground tiles around the start
// view); what is left is done here, behind the loading screen:
//   1. finish the landmarks' deferred refinements (flushRefine: sculpted details, the Fence paint job, Kenmawr's
//      detailed buildings) — they used to be built in idle slices / on approach while exploring;
//   2. merge the static shadow casters of landmarks / building chunks / structures into shadow-only proxies
//      (shadowproxy.js) — a fraction of the shadow-pass draw calls;
//   3. make the water reflection's per-body cull lists (no first-visit cost later);
//   4. put everything on the GPU: when the engine has a warm-up of its own (engine.warmScene, run by main.js after
//      the shader precompile: every object drawn once — vertex buffers, textures and the ANGLE/D3D11 shader
//      variants for each vertex layout, which otherwise compile inside the frame that first shows an object) that
//      is it; otherwise this module does it: every object made visible and unculled (hidden LOD levels, far
//      chunks, distance-culled details, night-only lights …), engine.precompile() (parallel compiles, uploads, one
//      warm-up frame incl. the shadow maps), one water-reflection render, then every flag restored.
// With ctx.addLoadTask (main.js runs those after all build steps, before the precompile) the work is registered
// there; without it, it runs right away at the end of createLife.
import { flushRefine } from '../landmarks/lib/icons-common.js';
import { buildShadowProxies } from './shadowproxy.js';

export function scheduleFinishWorld(ctx) {
  if (typeof ctx.addLoadTask === 'function') { ctx.addLoadTask('完善场景细节', () => finishWorld(ctx)); return null; }
  return finishWorld(ctx);
}

export async function finishWorld(ctx) {
  const stats = { refine: 0, refineMs: 0, warmMs: 0 };
  ctx.worldWarmup = stats;
  const t0 = performance.now();
  try { stats.refine = await flushRefine(ctx); } catch (e) { console.warn('[warmup] refinements failed', e); }
  stats.refineMs = Math.round(performance.now() - t0);
  await ctx.yield?.();
  if (!ctx.scene || !ctx.renderer) return stats;

  // static landmark / structure / building-chunk shadow casters → merged shadow-only proxies (while every flag is
  // still the real one: parts hidden right now are the ones whose visibility changes at runtime)
  try {
    const roots = new Set((ctx.landmarks || []).map((l) => l.object).filter(Boolean));
    for (const o of ctx.scene.children) if (/^landmark|^(bridges|barriers|cliffs|buildings)$/.test(o.name || '')) roots.add(o);
    const t = performance.now();
    stats.shadowProxies = buildShadowProxies(ctx, [...roots])?.stats || null;
    if (stats.shadowProxies) stats.shadowProxies.ms = Math.round(performance.now() - t);
  } catch (e) { console.warn('[warmup] shadow proxies failed', e); }
  try { ctx.water?.reflection?.prepare?.(); } catch (e) { console.warn('[warmup] reflection lists failed', e); }

  // the engine's own warm-up (main.js: after the precompile) draws everything once — nothing more to do here
  if (!ctx.engine || typeof ctx.engine.warmScene === 'function') return stats;
  if (ctx.engine.running) return stats; // (built after the first frame: too late for a hidden warm-up frame)
  const t1 = performance.now();
  const saved = [];
  try {
    ctx.scene.traverse((o) => {
      saved.push(o, o.visible, o.frustumCulled, o.isLOD ? o.autoUpdate : null);
      o.visible = true;
      o.frustumCulled = false;
      if (o.isLOD) o.autoUpdate = false;
    });
    stats.objects = saved.length / 4;
    if (typeof ctx.engine.precompile === 'function') await ctx.engine.precompile();
    else { ctx.engine.warm?.(ctx.scene); ctx.engine.render?.(); }
    // (after the precompile: the reflection pass uses the same render-target program variants as the main pass on
    // 'high' — rendered first, it compiled all of them synchronously, one after another: ~27 s)
    try { ctx.water?.reflection?.warm?.(); } catch (e) { console.warn('[warmup] reflection warm-up failed', e); }
  } catch (e) {
    console.warn('[warmup] world warm-up failed', e);
  } finally {
    for (let k = 0; k < saved.length; k += 4) {
      const o = saved[k];
      o.visible = saved[k + 1];
      o.frustumCulled = saved[k + 2];
      if (saved[k + 3] !== null) o.autoUpdate = saved[k + 3];
    }
    ctx.env?.refreshShadows?.();
  }
  stats.warmMs = Math.round(performance.now() - t1);
  return stats;
}
