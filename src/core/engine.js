// Renderer, camera, main loop, quality switching and (on 'high') post-processing. Contract: ARCHITECTURE.md §engine.
import * as THREE from 'three';
import { qualityPreset } from './context.js';
import { createPost } from './post.js';

const BASE_FOV = 55;          // vertical field of view on landscape / square screens
const MAX_PORTRAIT_FOV = 78;  // portrait phones: widen the vertical fov up to this (see fovForAspect)

// Portrait screens: a fixed 55° vertical fov leaves a ~27° horizontal field on a phone (390×844), a telephoto
// "tube" view. Below aspect 1 keep the horizontal field of a square 55° view by widening the vertical fov, capped at
// 78° (≈ 41° horizontal at 390×844, 55° on a 3:4 tablet). Continuous at aspect 1.
export function fovForAspect(aspect) {
  if (!(aspect > 0) || aspect >= 1) return BASE_FOV;
  const v = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) / aspect);
  return Math.min(MAX_PORTRAIT_FOV, THREE.MathUtils.radToDeg(v));
}

// World-matrix updates. three's Scene has matrixAutoUpdate on, so every render re-multiplies the world matrix of
// EVERY object (2000+ here, twice a frame with the water reflection pass) although almost all of them are static
// (matrixAutoUpdate off). Once the world is built the scene root stops forcing that (staticWorld below): objects then
// update when they have to — matrixAutoUpdate objects every frame as before, others after updateMatrix() /
// matrixWorldNeedsUpdate — and anything added to the scene graph is flagged here so its subtree is placed once.
let addPatched = false;
function flagAddedObjects() {
  if (addPatched) return;
  addPatched = true;
  const P = THREE.Object3D.prototype;
  const add = P.add, attach = P.attach;
  const dirtyUp = (p) => { for (; p; p = p.parent) if (p.__static) p.__static.dirty = true; };
  P.add = function (...objects) {
    const r = add.apply(this, objects);
    for (const o of objects) if (o && o.isObject3D) o.matrixWorldNeedsUpdate = true;
    dirtyUp(this);
    return r;
  };
  P.attach = function (object) {
    const r = attach.call(this, object);
    if (object && object.isObject3D) object.matrixWorldNeedsUpdate = true;
    dirtyUp(this);
    return r;
  };
}

// Static subtrees. Even without the forced pass, three's updateMatrixWorld still walks every object of the scene
// on every render (main pass + water reflection): ~2400 calls, ~0.35 ms per walk on a fast desktop, for a world
// where only the sun lights move. A top-level subtree marked static skips that walk: per frame it only checks its
// matrixAutoUpdate objects (their position / rotation / scale — e.g. a landmark part that a module animates) and
// updates the ones that changed, with their descendants. Anything added below it (Object3D.add / attach, patched
// above) makes it walk once again; the engine's forced update once a second places everything regardless (a module
// that writes .matrix directly or sets matrixWorldNeedsUpdate by hand on a non-auto object is placed then).
const baseUMW = THREE.Object3D.prototype.updateMatrixWorld;
function collectAutos(root) {
  const autos = [];
  root.traverse((o) => { if (o.matrixAutoUpdate) autos.push(o); });
  const cache = new Float64Array(autos.length * 10);
  autos.forEach((o, i) => writeTRS(o, cache, i * 10));
  return { autos, cache };
}
function writeTRS(o, c, k) {
  const p = o.position, q = o.quaternion, s = o.scale;
  c[k] = p.x; c[k + 1] = p.y; c[k + 2] = p.z; c[k + 3] = q.x; c[k + 4] = q.y; c[k + 5] = q.z; c[k + 6] = q.w; c[k + 7] = s.x; c[k + 8] = s.y; c[k + 9] = s.z;
}
function staticUMW(force) {
  const st = this.__static;
  if (force || st.dirty || this.matrixWorldNeedsUpdate) {
    baseUMW.call(this, force);
    if (st.dirty) { const a = collectAutos(this); st.autos = a.autos; st.cache = a.cache; st.dirty = false; }
    else for (let i = 0; i < st.autos.length; i++) writeTRS(st.autos[i], st.cache, i * 10);
    return;
  }
  const A = st.autos, c = st.cache;
  for (let i = 0; i < A.length; i++) {
    const o = A[i], k = i * 10, p = o.position, q = o.quaternion, s = o.scale;
    if (p.x !== c[k] || p.y !== c[k + 1] || p.z !== c[k + 2] || q.x !== c[k + 3] || q.y !== c[k + 4] || q.z !== c[k + 5] || q.w !== c[k + 6] ||
      s.x !== c[k + 7] || s.y !== c[k + 8] || s.z !== c[k + 9] || o.matrixWorldNeedsUpdate) {
      writeTRS(o, c, k);
      if (o.parent) baseUMW.call(o, true);      // (autos are in traversal order: a moved parent was placed first)
    }
  }
}
function markStatic(root) {
  if (root.__static) return;
  const a = collectAutos(root);
  root.__static = { autos: a.autos, cache: a.cache, dirty: false };
  root.updateMatrixWorld = staticUMW;
}

// Opaque draw order. three sorts opaque items by material id, then depth, so materials sharing a program are
// scattered through the list and every program switch re-uploads the camera and all light / shadow uniforms (the
// largest part of setProgram). Here: program first, then material, then depth — same per-material batching and
// front-to-back order within a material, a fraction of the program switches. Materials whose relative draw order
// can matter for opaque items (no depth write / test, colour write off, non-normal blending) split the list into
// segments, so everything keeps its order relative to them.
function isSpecial(m) {
  return !m.depthWrite || !m.depthTest || !m.colorWrite || m.blending !== THREE.NormalBlending;
}
function makeOpaqueSort(renderer) {
  let epoch = 1, lastEpochAt = 0;
  const specials = [];              // sorted ids of special materials seen so far
  const keyOf = (m) => {
    if (m.__rkE === epoch) return m.__rk;
    let lo = 0, hi = specials.length;
    if (isSpecial(m) && !specials.includes(m.id)) {
      specials.push(m.id); specials.sort((a, b) => a - b);
      epoch++;                      // every segment after it moved
    }
    while (lo < hi) { const mid = (lo + hi) >> 1; if (specials[mid] < m.id) lo = mid + 1; else hi = mid; }
    const seg = lo * 2 + (specials[lo] === m.id ? 1 : 0);
    const prog = renderer.properties.get(m).currentProgram;
    const k = seg * 1048576 + (prog ? prog.id % 1048576 : 0);
    if (m.__rkE === undefined) Object.defineProperties(m, { __rk: { value: k, writable: true }, __rkE: { value: epoch, writable: true } });
    else { m.__rk = k; m.__rkE = epoch; }
    return k;
  };
  return {
    sort(a, b) {
      if (a.groupOrder !== b.groupOrder) return a.groupOrder - b.groupOrder;
      if (a.renderOrder !== b.renderOrder) return a.renderOrder - b.renderOrder;
      const ma = a.material, mb = b.material;
      if (ma !== mb) {
        const d = keyOf(ma) - keyOf(mb);
        if (d !== 0) return d;
        return ma.id - mb.id;
      }
      if (a.z !== b.z) return a.z - b.z;
      return a.id - b.id;
    },
    // (programs are only known after a material's first draw, and may change: re-key now and then)
    refresh(now) { if (now - lastEpochAt > 1500) { lastEpochAt = now; epoch++; } },
  };
}

export function createEngine(ctx, canvas) {
  const q = ctx.quality;
  const params = new URLSearchParams(location.search);
  const shotMode = ctx.shotMode ?? params.has('shot');

  // With post-processing the scene renders into an MSAA target, so the default framebuffer needs no MSAA.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !!q.antialias && !q.post,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: shotMode,   // reliable screenshots in ?shot mode
  });
  // Dynamic resolution: autoDegrade() may cap the pixel ratio below the preset (see gpuLadder), even below 1.
  let resCap = Infinity;
  const effectivePixelRatio = () => Math.min(ctx.quality.pixelRatio, resCap);
  renderer.setPixelRatio(effectivePixelRatio());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !!q.shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;     // we reset once per frame so stats include shadow + post passes
  const opaqueSort = makeOpaqueSort(renderer);
  if (!params.has('nosort')) renderer.setOpaqueSort(opaqueSort.sort);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#a9c8e8');   // replaced by the sky once env exists
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.5, 9000);
  camera.position.set(-150, 220, 420);
  camera.lookAt(-100, 45, 60);

  Object.assign(ctx, { renderer, scene, camera, canvas });

  // ---------------------------------------------------------------- sizing
  // The page CSS normally makes the canvas fill the window; if it is unstyled (e.g. the stylesheet failed to load)
  // fall back to a fixed full-window canvas so we never render into a 300×150 box.
  if (canvas.clientWidth === 300 && canvas.clientHeight === 150 && !canvas.style.width) {
    canvas.style.cssText += ';position:fixed;inset:0;width:100%;height:100%;display:block';
  }
  let cssW = 1, cssH = 1;
  function measure() {
    cssW = Math.max(1, canvas.clientWidth || innerWidth);
    cssH = Math.max(1, canvas.clientHeight || innerHeight);
  }
  let post = null;
  function resize() {
    measure();
    camera.aspect = cssW / cssH;
    camera.fov = fovForAspect(camera.aspect);
    camera.updateProjectionMatrix();
    renderer.setSize(cssW, cssH, false);
    post?.setSize(cssW, cssH);
  }
  addEventListener('resize', resize);
  // layout changes that don't fire window.resize (panels, fullscreen transitions)
  if (typeof ResizeObserver !== 'undefined') {
    let pending = false;
    new ResizeObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; if (canvas.clientWidth !== cssW || canvas.clientHeight !== cssH) resize(); });
    }).observe(canvas);
  }
  // devicePixelRatio changes (moving the window to another monitor, browser zoom)
  let dprQuery = null;
  function watchDpr() {
    dprQuery?.removeEventListener?.('change', onDpr);
    dprQuery = matchMedia?.(`(resolution: ${devicePixelRatio}dppx)`);
    dprQuery?.addEventListener?.('change', onDpr);
  }
  function onDpr() {
    const preset = qualityPreset(ctx.quality.level);
    ctx.quality.pixelRatio = preset.pixelRatio;
    perf.gpu = 0;                      // the resolution ladder depends on the preset ratio: start over
    applyLevels(true);
    watchDpr();
  }
  function applyPixelRatio(force = false) {
    const pr = effectivePixelRatio();
    if (!force && renderer.getPixelRatio() === pr) return;
    renderer.setPixelRatio(pr);
    post?.setPixelRatio(pr);
    resize();
  }
  watchDpr();

  function enablePost(on) {
    if (on && !post) {
      measure();
      post = createPost(renderer, scene, camera, { width: cssW, height: cssH });
    } else if (!on && post) {
      post.dispose();
      post = null;
    }
  }
  enablePost(!!q.post);
  resize();

  // ---------------------------------------------------------------- loop
  let last = -1, elapsed = 0, running = false;
  let fps = 60, frameMs = 16.7, cpuMs = 5, lastFrameAt = 0;
  const frameInfo = { calls: 0, triangles: 0, points: 0, lines: 0 };
  let bloomOff = false;   // user/debug override (engine.setBloom)

  // By day the bloom threshold is only exceeded by the sun disc and by specular sun glints (glass, water, cars).
  // The pass costs < 0.3 ms on the reference GPU, so it stays on to let the glints glow; sunInView() only adds a
  // little more glare when the solar disc itself is on screen.
  const _sunV = new THREE.Vector3();
  function sunInView() {
    const st = ctx.env?.state;
    if (!st?.sunDir || (st.sunElevation ?? 90) < -1.5) return false;
    _sunV.copy(st.sunDir).transformDirection(camera.matrixWorldInverse);
    if (_sunV.z > -0.05) return false;                         // behind the camera
    const ty = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / (camera.zoom || 1);
    const x = _sunV.x / -_sunV.z / (ty * camera.aspect), y = _sunV.y / -_sunV.z / ty;
    return Math.abs(x) < 1.35 && Math.abs(y) < 1.35;           // margin: the glow reaches in from off-screen
  }

  function renderFrame(dt) {
    renderer.info.reset();
    if (post) {
      const nf = ctx.env?.state?.nightFactor ?? 0;
      post.setNight(nf, nf <= 0.05 && sunInView());
      post.setBloom(!bloomOff);
      post.render(dt);
    } else {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
    const ri = renderer.info.render;
    frameInfo.calls = ri.calls; frameInfo.triangles = ri.triangles; frameInfo.points = ri.points; frameInfo.lines = ri.lines;
  }

  function frame(time) {
    const t0 = performance.now();
    const now = time ?? t0;
    lastFrameAt = t0;
    if (last < 0) last = now;
    const raw = (now - last) / 1000;
    last = now;
    const dt = Math.min(Math.max(raw, 0), 0.1);
    elapsed += dt;
    if (worldStatic && ++safetyN >= SAFETY_FRAMES) { safetyN = 0; scene.updateMatrixWorld(true); }
    opaqueSort.refresh(t0);
    lodTick();
    ctx.tick(dt, elapsed);
    renderFrame(dt);
    // our own main-thread time for this frame (update callbacks + three's draw submission); compared with the
    // frame interval it tells a CPU-bound frame from a GPU-bound one
    const js = (performance.now() - t0) / 1000;
    if (raw > 0 && raw < 1) {
      frameMs += (raw * 1000 - frameMs) * 0.08;
      cpuMs += (js * 1000 - cpuMs) * 0.08;
      fps = 1000 / frameMs;
    }
    autoDegrade(raw, js);
  }

  // ---------------------------------------------------------------- adaptive quality
  // Keep ~60 fps. Every 2.5 s the window's median frame interval (and share of dropped frames, > 20 ms) is compared
  // with the median time our own JS takes per frame (ctx.tick + render — mostly three's draw-call submission). Two
  // slow windows in a row (median > 17.5 ms, or ≥ 20 % dropped frames) step down:
  //  · GPU-bound (JS < ½ of the interval): walk down the GPU ladder — pixel ratio (HiDPI: 2 → 1.5 → 1.25 → 1), then
  //    AO (post), then a render scale below 1 (0.85 → 0.75), which also gives 'low'/'medium' a real fallback.
  //  · CPU-bound (JS ≥ ¾ of the interval): resolution and AO would only blur the picture for nothing. Instead raise the
  //    CPU degrade level 1..3 and emit 'perf:degrade' { level, cpu, gpu, pixelRatio, ao, levers }: the modules drop
  //    invisible-ish costs first (CPU_LEVERS: water reflection cadence → off, shadow refresh cadence, minimap rate,
  //    out-of-view NPC rate, near-ground tile pacing, landmark detail ranges). When nothing is left, the UI suggests a
  //    lower preset once.  · In between: CPU levers first (they also save GPU time), then GPU levers.
  // Back up: picture quality first, then the CPU levers — after two windows with headroom (vsync rate, < 4 % dropped
  // frames, our JS < 55 % of the frame; a step up that is slow again within 20 s doubles the windows needed), after
  // fast frames on a > 60 Hz display, or probing: after a while at vsync rate one step up is tried, and the probe
  // interval doubles every time it fails.
  const RES_STEPS = [2, 1.5, 1.25, 1];
  const SUB_STEPS = [0.85, 0.75];
  const CPU_MAX = 3;
  // What each CPU level asks of the modules (they listen to 'perf:degrade' and read .cpu). Invisible costs first;
  // nothing switches at eye level while it is on screen (LOD ranges only change for objects not near a switch).
  const CPU_LEVERS = [
    'full rate',
    'water reflection 1/4 frames · shadow refresh 45 ms · minimap 20 Hz · NPCs out of view at ¼ rate · ground tiles 2 ms',
    'water reflection 1/6 frames, 400 m · shadow refresh 60 ms · minimap 12 Hz · landmark / building detail range ×0.85 · glow every 2nd frame · ground tiles 1.5 ms',
    'water reflection off (one on screen fades to 1/8 frames first) · shadow refresh 90 ms · minimap 8 Hz · landmark / building detail range ×0.7 · glow every 2nd frame · ground tiles 1 ms',
  ];
  const perf = { sum: 0, js: 0, n: 0, drop: 0, slow: 0, fast: 0, vsync: 0, skip: 0, probing: false, probeWait: 20, gpu: 0, cpu: 0, hinted: false, avg: 0, share: 0, dropFrac: 0, gpuCheck: 0, gpuBlock: 0, head: 0, headNeed: 2, upAt: -1e9 };
  const winRaw = new Float32Array(1024), winJs = new Float32Array(1024), sortBuf = new Float32Array(1024);
  function median(a, n, q = 0.5) {
    if (!n) return 0;
    sortBuf.set(a.subarray(0, n));
    const s = sortBuf.subarray(0, n).sort();
    return s[Math.min(n - 1, Math.floor(n * q))];
  }
  let aoWanted = true;       // engine.setAO() override
  let qualityBusy = false;   // setQuality() in progress
  let qualitySeq = 0;

  function gpuLadder() {
    const P = ctx.quality.pixelRatio;
    const ao = !!post && aoWanted;
    const L = [{ res: P, ao }];
    for (const s of RES_STEPS) if (s >= 1 && s < L[L.length - 1].res - 0.01) L.push({ res: s, ao });
    if (ao) L.push({ res: L[L.length - 1].res, ao: false });
    for (const s of SUB_STEPS) if (s < L[L.length - 1].res - 0.01) L.push({ res: s, ao: false });
    return L;
  }
  function applyLevels(force = false) {
    const L = gpuLadder();
    perf.gpu = Math.max(0, Math.min(perf.gpu, L.length - 1));
    const s = L[perf.gpu];
    resCap = perf.gpu === 0 ? Infinity : s.res;
    applyPixelRatio(force);
    post?.setAO(aoWanted && s.ao);
  }
  function emitPerf() {
    ctx.events?.emit?.('perf:degrade', { level: perf.cpu, cpu: perf.cpu, gpu: perf.gpu, pixelRatio: renderer.getPixelRatio(), ao: !!post?.aoEnabled, levers: CPU_LEVERS[perf.cpu] });
  }
  function resetPerf() {
    Object.assign(perf, { sum: 0, js: 0, n: 0, drop: 0, slow: 0, fast: 0, vsync: 0, skip: 0, probing: false, probeWait: 20, gpu: 0, cpu: 0, gpuCheck: 0, gpuBlock: 0, head: 0, headNeed: 2, upAt: -1e9 });
  }
  // Landmark detail ranges (CPU levels 2–3): every THREE.LOD's switch distances (and ctx.lodScale, which the
  // distance-culled detail groups read) shrink ×0.85 / ×0.7. Applied per LOD only while the camera is clear of every
  // threshold that moves — nothing switches at the moment the level changes; it simply switches nearer from then on.
  const LOD_SCALE = [1, 1, 0.85, 0.7];
  const lodCtl = { list: null, scale: 1, pending: false, n: 0 };
  ctx.lodScale = 1;
  const _lv = new THREE.Vector3(), _cv = new THREE.Vector3();
  function lodTick() {
    if (!lodCtl.pending || (++lodCtl.n & 7)) return;
    if (!lodCtl.list) {
      lodCtl.list = [];
      scene.traverse((o) => { if (o.isLOD && o.levels.length > 1) lodCtl.list.push({ o, base: o.levels.map((l) => l.distance), cur: 1 }); });
    }
    _cv.setFromMatrixPosition(camera.matrixWorld);
    let left = 0;
    for (const L of lodCtl.list) {
      if (L.cur === lodCtl.scale) continue;
      const d = _lv.setFromMatrixPosition(L.o.matrixWorld).distanceTo(_cv) / (camera.zoom || 1);
      let clear = true;
      for (let i = 1; i < L.base.length; i++) {
        const a = L.base[i] * L.cur, b = L.base[i] * lodCtl.scale, h = L.o.levels[i].hysteresis || 0;
        if (d >= Math.min(a, b) * (1 - h) - 2 && d <= Math.max(a, b) + 2) { clear = false; break; }
      }
      if (!clear) { left++; continue; }
      for (let i = 0; i < L.base.length; i++) L.o.levels[i].distance = L.base[i] * lodCtl.scale;
      L.cur = lodCtl.scale;
    }
    lodCtl.pending = left > 0;
  }
  ctx.events?.on?.('perf:degrade', (p) => {
    const lvl = Math.max(0, Math.min(LOD_SCALE.length - 1, Math.round(Number(p?.cpu) || 0)));
    const s = LOD_SCALE[lvl];
    if (s !== lodCtl.scale) { lodCtl.scale = s; lodCtl.pending = true; ctx.lodScale = s; }
    post?.setBloomEvery?.(lvl >= 2 ? 2 : 1);      // (the glow of sun glints / night lights: every other frame)
  });

  function hint() {
    if (perf.hinted || ctx.quality.level === 'low') return;
    perf.hinted = true;
    ctx.ui?.toast?.('画面较卡 · 可在「设置 → 画质」中选择较低画质', { icon: 'warn', ms: 5200 });
  }

  function autoDegrade(raw, js) {
    if (shotMode || elapsed < 8 || document.hidden || qualityBusy) return;
    if (raw <= 0 || raw > 0.5) { perf.sum = 0; perf.js = 0; perf.n = 0; perf.drop = 0; return; }   // stall / tab switch: restart
    if (perf.n < winRaw.length) { winRaw[perf.n] = raw; winJs[perf.n] = Math.min(js, raw); }
    perf.sum += raw; perf.js += Math.min(js, raw); perf.n++;
    if (perf.sum < 2.5) return;
    // The window's MEDIAN frame (and our median JS time): a few one-off hitches (a panel opening, a GC) must not
    // cost resolution or effects — lowering them would not help against hitches anyway, and the switch itself
    // (render targets re-allocated) is one. Sustained slowness moves the median — or, on a machine that alternates
    // between 60 and 30 fps, the share of dropped frames (≥ 20 % of the window).
    const n = Math.min(perf.n, winRaw.length);
    const avg = median(winRaw, n), mjs = median(winJs, n), share = Math.min(1, mjs / Math.max(avg, 1e-6));
    // dropped frame: 1.5 display intervals (the window's fast frames: 25 ms at 60 Hz, 30 ms at 50 Hz), and never
    // faster than 50 fps on high-refresh displays
    const base = Math.max(1 / 250, median(winRaw, n, 0.1));
    const dropAt = Math.max(0.02, 1.5 * base);
    let drops = 0;
    for (let i = 0; i < n; i++) if (winRaw[i] > dropAt) drops++;
    const dropFrac = drops / Math.max(1, n);
    perf.sum = 0; perf.js = 0; perf.n = 0; perf.drop = 0;
    perf.avg = avg; perf.share = share; perf.dropFrac = dropFrac;
    if (perf.skip > 0) { perf.skip--; return; }    // settling after a change
    const ms = (avg * 1000).toFixed(1), pct = Math.round(share * 100);
    // With vsync a frame whose JS misses the refresh deadline waits for the next one: 20 ms of JS shows as a 33 ms
    // frame (share 0.6) although the GPU idles. So our JS is also compared with the display interval (the window's
    // fast frames): JS that alone fills ≥ 80 % of it is CPU-bound — lowering the resolution would not help there
    // (and re-allocating the render targets is a hitch of its own).
    const cpuBound = share >= 0.75 || mjs >= 0.8 * base;
    const kind = cpuBound ? 'CPU-bound' : share >= 0.5 ? 'CPU+GPU' : 'GPU-bound';
    const slow = avg > 0.0175 || dropFrac >= 0.2;
    // A GPU step must pay for itself: if the frames did not get faster, the GPU was not the bottleneck (e.g. the
    // browser blocked inside GL calls) — undo it and leave the resolution alone for two minutes.
    if (perf.gpuCheck) {
      const before = perf.gpuCheck;
      perf.gpuCheck = 0;
      if (perf.gpu > 0 && avg > before * 0.92) {
        perf.gpu--; applyLevels(); perf.gpuBlock = elapsed + 120; perf.skip = 1; perf.slow = 0;
        console.info(`[engine] average frame ${ms} ms (was ${(before * 1000).toFixed(1)} ms) — the lower resolution did not help, restored`);
        emitPerf();
        return;
      }
    }
    if (slow) {
      perf.fast = 0; perf.head = 0;
      if (++perf.slow < 2 && !perf.probing) return;   // a single slow window (hitch) is ignored
      perf.slow = 0; perf.vsync = 0;
      if (perf.probing) perf.probeWait = Math.min(perf.probeWait * 2, 320);
      // stepped up on "headroom" less than 20 s ago and slow again: ask for more headroom next time
      if (elapsed - perf.upAt < 20) perf.headNeed = Math.min(perf.headNeed * 2, 16);
      perf.probing = false;
      const L = gpuLadder();
      const canGpu = perf.gpu < L.length - 1 && elapsed >= perf.gpuBlock, canCpu = perf.cpu < CPU_MAX;
      let what = null;
      if (cpuBound) what = canCpu ? 'cpu' : null;                                // CPU-bound
      else if (share >= 0.5) what = canCpu ? 'cpu' : canGpu ? 'gpu' : null;     // both
      else what = canGpu ? 'gpu' : canCpu ? 'cpu' : null;                       // GPU-bound
      if (what === 'gpu') {
        const from = L[perf.gpu];
        perf.gpu++;
        applyLevels();
        const to = L[perf.gpu];
        perf.gpuCheck = avg;
        const did = [];
        if (to.res !== from.res) did.push(`pixel ratio ${from.res} → ${to.res}`);
        if (to.ao !== from.ao) did.push('ambient occlusion off');
        console.info(`[engine] average frame ${ms} ms, our JS ${pct}% of it (${kind}) — ${did.join(', ')}`);
      } else if (what === 'cpu') {
        perf.cpu++;
        console.info(`[engine] median frame ${ms} ms, ${Math.round(dropFrac * 100)}% dropped, our JS ${pct}% of it (${kind}) — CPU degrade level ${perf.cpu}: ${CPU_LEVERS[perf.cpu]}`);
      } else {
        hint();
        return;
      }
      perf.skip = 1;
      emitPerf();
      return;
    }
    perf.slow = 0;
    if (perf.probing) { perf.probing = false; perf.probeWait = 20; }   // probe held: reset backoff
    if (elapsed - perf.upAt > 60) perf.headNeed = 2;                    // stable for a minute: normal again
    if (perf.gpu === 0 && perf.cpu === 0) return;
    // on the way back up: picture quality first, then the CPU levers
    const up = (why) => {
      if (perf.gpu > 0) { perf.gpu--; applyLevels(); } else perf.cpu--;
      perf.skip = 1; perf.upAt = elapsed; perf.head = 0;
      console.info(`[engine] median frame ${ms} ms, our JS ${pct}% of it — ${why}: back to CPU level ${perf.cpu}, GPU level ${perf.gpu}`);
      emitPerf();
    };
    // Headroom: at vsync rate with (almost) no dropped frames while our own JS uses little of the frame. With vsync
    // the interval cannot show spare time, our JS time can: a CPU-bound laptop that got faster (plugged in, the
    // view got simpler) comes back up within seconds instead of waiting for the next probe.
    if (dropFrac < 0.04 && mjs < 0.55 * Math.max(avg, 1 / 60)) {
      if (++perf.head >= perf.headNeed) { up('headroom'); return; }
    } else perf.head = 0;
    if (avg < 0.012) {
      perf.vsync = 0;
      if (++perf.fast >= 2) { perf.fast = 0; up('fast frames'); }
    } else {
      perf.fast = 0;
      if ((perf.vsync += 2.5) >= perf.probeWait) { perf.vsync = 0; perf.probing = true; up('probing'); }
    }
  }

  // In ?shot mode keep rendering even if the page is hidden/unfocused (rAF may be throttled).
  let watchdog = null;

  // GPU context loss (driver reset, too many tabs): pause, and resume once three has restored its state.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('[engine] WebGL context lost — pausing');
    if (running) renderer.setAnimationLoop(null);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    console.warn('[engine] WebGL context restored');
    // every render-target texture is empty now: re-render the sky LUT + environment map and the shadow map
    ctx.env?.refreshEnvironment?.();
    renderer.shadowMap.needsUpdate = true;
    if (running) { last = -1; renderer.setAnimationLoop(frame); }
  });

  // ---------------------------------------------------------------- precompile helpers
  // One quad per post material (FullScreenQuad draws a plain Mesh with an empty light state, like this scene).
  function quadScene(materials) {
    const s = new THREE.Scene();
    const g = new THREE.PlaneGeometry(2, 2);
    for (const m of materials) if (m) { const o = new THREE.Mesh(g, m); o.frustumCulled = false; s.add(o); }
    return s;
  }
  // renderer.compile(root, camera, scene) also collects the lights of `root` when root !== scene, which counts the
  // lights of a subtree already in the scene twice (wrong program keys). This stand-in only exposes root's objects.
  function subtree(root) {
    if (root === scene) return scene;
    const proxy = new THREE.Object3D();
    proxy.traverseVisible = () => {};
    proxy.traverse = (cb) => root.traverse(cb);
    return proxy;
  }
  // Proxies reproducing the depth materials WebGLShadowMap derives for every shadow caster (three r170
  // getDepthMaterial): RGBA-packed MeshDepthMaterial, or the object's customDepthMaterial, with the caster's side
  // flipped and its map / alphaMap / alphaTest / displacement / clipping copied over. Programs are shared by cache
  // key, so compiling these warms exactly the programs the first shadow pass would otherwise compile synchronously.
  const SHADOW_SIDE = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };
  const DEPTH_PROPS = ['side', 'alphaMap', 'alphaTest', 'map', 'clipShadows', 'clippingPlanes', 'clipIntersection', 'displacementMap', 'displacementScale', 'displacementBias'];
  function shadowDepthScenes(root = scene) {
    if (!renderer.shadowMap.enabled) return [];
    let caster = false;
    scene.traverseVisible((o) => { if (o.isLight && o.castShadow) caster = true; });
    if (!caster) return [];
    const std = new THREE.Scene();
    const customs = [];
    const seen = new Set();
    root.traverse((o) => {
      if (!o.castShadow || !o.isMesh || o.isSkinnedMesh || o.isBatchedMesh || !o.geometry) return;
      const geo = o.geometry;
      const morph = geo.morphAttributes ? Object.keys(geo.morphAttributes).map((k) => k + geo.morphAttributes[k].length).join() : '';
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        if (!m || m.visible === false) continue;
        const custom = o.customDepthMaterial;
        const props = {
          side: m.shadowSide ?? SHADOW_SIDE[m.side], alphaMap: m.alphaMap, alphaTest: m.alphaTest, map: m.map,
          clipShadows: m.clipShadows, clippingPlanes: m.clippingPlanes, clipIntersection: m.clipIntersection,
          displacementMap: m.displacementMap, displacementScale: m.displacementScale, displacementBias: m.displacementBias,
        };
        const key = [custom ? custom.uuid : 'std', o.isInstancedMesh ? 'I' : 'M', o.instanceColor ? 'c' : '', o.morphTexture ? 't' : '',
          morph, props.side, !!m.map, m.map?.channel ?? 0, !!m.alphaMap, m.alphaMap?.channel ?? 0, m.alphaTest > 0,
          !!m.displacementMap, m.clippingPlanes?.length ?? 0].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const dm = custom || Object.assign(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), props);
        const p = o.isInstancedMesh ? new THREE.InstancedMesh(geo, dm, 0) : new THREE.Mesh(geo, dm);
        if (o.isInstancedMesh) { p.instanceColor = o.instanceColor; p.morphTexture = o.morphTexture ?? null; }
        p.frustumCulled = false;
        if (!custom) { std.add(p); continue; }
        // a shared custom depth material is mutated by the shadow pass per caster: compile each state separately
        const s = new THREE.Scene();
        s.add(p);
        let saved = null;
        customs.push({
          scene: s,
          apply() { saved = {}; for (const k of DEPTH_PROPS) { saved[k] = custom[k]; custom[k] = props[k]; } },
          restore() { if (saved) for (const k of DEPTH_PROPS) custom[k] = saved[k]; saved = null; },
        });
      }
    });
    return std.children.length ? [{ scene: std }, ...customs] : customs;
  }
  // Issue the compiles for root (scene programs for the target the scene is really drawn into — the post buffer on
  // 'high' needs linear/no-tone-mapping variants — plus the shadow-map depth variants). With `async` the returned
  // promises resolve once the driver has finished; without it this only issues them (the driver compiles in the
  // background where KHR_parallel_shader_compile exists).
  function issueCompiles(root, jobs, async) {
    const prev = renderer.getRenderTarget();
    let offscreen = post ? post.composer.readBuffer : null;
    let tmpTarget = null;
    const compile = (obj, target) => {
      if (async) jobs.push(renderer.compileAsync(obj, camera, target));
      else renderer.compile(obj, camera, target);
    };
    try {
      renderer.setRenderTarget(post ? post.composer.readBuffer : null);
      compile(subtree(root), scene);
      const depth = shadowDepthScenes(root);
      if (depth.length) {
        if (!offscreen) offscreen = tmpTarget = new THREE.WebGLRenderTarget(1, 1);
        renderer.setRenderTarget(offscreen);           // like the shadow map: off-screen, linear, no tone mapping
        const fog = scene.fog;
        scene.fog = null;                              // the shadow pass draws with an empty scene (no fog)
        try {
          for (const d of depth) {
            d.apply?.();
            try { compile(d.scene, scene); } finally { d.restore?.(); }
          }
        } finally { scene.fog = fog; }
      }
    } finally {
      renderer.setRenderTarget(prev);
    }
    return tmpTarget;
  }
  // Every texture the scene's materials reference: material maps, ShaderMaterial uniforms, custom depth materials and
  // the uniforms onBeforeCompile hooks added (three keeps the compiled shader's uniforms in the material properties,
  // so this finds them once the material has been compiled — e.g. the buildings' facade texture arrays).
  const texOwner = new WeakMap();   // texture → 'material.slot' (diagnostics for slow uploads)
  function sceneTextures(root) {
    const set = new Set();
    let owner = '';
    const add = (t, k) => { if (!set.has(t)) { set.add(t); if (!texOwner.has(t)) texOwner.set(t, owner + '.' + k); } };
    const addUniforms = (u) => {
      if (!u) return;
      for (const k in u) {
        const v = u[k]?.value;
        if (v?.isTexture) add(v, k);
        else if (Array.isArray(v)) for (const t of v) if (t?.isTexture) add(t, k);
      }
    };
    const addMat = (m) => {
      if (!m) return;
      owner = m.name || m.type;
      for (const k in m) { const v = m[k]; if (v && v.isTexture) add(v, k); }
      addUniforms(m.uniforms);
      addUniforms(renderer.properties?.get(m)?.uniforms);
    };
    root.traverse((o) => {
      if (Array.isArray(o.material)) o.material.forEach(addMat); else addMat(o.material);
      addMat(o.customDepthMaterial); addMat(o.customDistanceMaterial);
    });
    return set;
  }
  // Upload every pending texture now (the first frame would otherwise do it: texSubImage2D/3D was the largest part of
  // the post-loading freeze). Returns the number uploaded.
  const slowUploads = [];   // the slowest texture uploads of the last precompile (name, size, ms) — diagnostics
  function uploadTextures(root) {
    let n = 0;
    for (const t of sceneTextures(root)) {
      if (t.isRenderTargetTexture || t.isDepthTexture || t.isVideoTexture || t.isFramebufferTexture) continue;
      if (!(t.version > 0)) continue;
      const img = t.image;
      if (!img || img.complete === false || (Array.isArray(img) && img.some((x) => !x))) continue;
      if (renderer.properties?.get(t).__version === t.version) continue;
      const w = img.width ?? img[0]?.width ?? 0, h = img.height ?? img[0]?.height ?? 0;
      const t0 = performance.now();
      try { renderer.initTexture(t); n++; } catch (e) { console.warn('[engine] texture upload failed', t.name || t.uuid, e); }
      const ms = performance.now() - t0;
      if (ms > 4) {
        slowUploads.push([t.name || texOwner.get(t) || (img.constructor?.name ?? '?'), `${w}x${h}${t.isDataArrayTexture ? 'x' + (img.depth ?? '?') : ''}`, Math.round(ms)]);
        slowUploads.sort((a, b) => b[2] - a[2]);
        slowUploads.length = Math.min(slowUploads.length, 10);
      }
    }
    return n;
  }

  // (see flagAddedObjects) — from the first real frame on; a full forced update every SAFETY_FRAMES still places
  // anything whose matrix was edited without flagging it (at worst a second late).
  const SAFETY_FRAMES = 60;
  let worldStatic = false, safetyN = 0;
  function staticWorld() {
    if (worldStatic) return;
    worldStatic = true;
    flagAddedObjects();
    scene.updateMatrixWorld(true);
    scene.matrixAutoUpdate = false;       // (the scene root itself never moves)
    // every top-level subtree except the lights and the sky objects env places by hand (see markStatic)
    if (!params.has('nostatic')) {
      for (const c of scene.children) {
        if (c.isLight || c.isCamera || c.userData?.dynamicRoot || /^(sky|stars|moon|snow|sun|sunNear|sunTarget|sunNearTarget)$/.test(c.name || '')) continue;
        markStatic(c);
      }
    }
  }

  // One complete frame (per-frame updates + render) while the loop is not running yet — the loading screen still
  // covers the canvas. Used by warmScene() so the first frames' one-off work happens during loading.
  function hiddenFrame(dt = 1 / 60) {
    elapsed += dt;
    try { ctx.tick(dt, elapsed); } catch (e) { console.warn('[engine] warm-up tick failed', e); }
    renderFrame(dt);
  }
  // Per-frame updates only (no render), on the engine's own clock — loading-time probes (world/staticbatch.js)
  // watch what the modules change from frame to frame.
  function tickOnly(dt = 1 / 60) {
    if (running) return;
    elapsed += dt;
    ctx.tick(dt, elapsed);
  }
  // Wait until the GPU has executed everything queued so far (shader variants, buffer / texture uploads, the warm-up
  // draws): a 1-pixel read-back is a full round trip through the command buffer.
  const px1 = new Uint8Array(4);
  function gpuSync() {
    try {
      const gl = renderer.getContext();
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
      renderer.setRenderTarget(prev);
    } catch { /* context lost: nothing to wait for */ }
  }
  // Draw EVERY object once through the real pipeline — scene pass into the post buffer, both shadow cascades, post
  // chain — no matter where it is or whether it is shown right now: frustum culling off, every LOD level, hidden
  // meshes (distance-LOD'd chunks, night / weather / seasonal extras, far street signs…) made visible for this one
  // frame. The first draw of an object creates its vertex buffers / VAO and — on ANGLE/D3D11 — compiles the shader
  // variant for its vertex layout inside the GPU process, which took 100–400 ms per new combination while browsing
  // (the page stalled whenever the view first reached a new part of the map). Lights keep their state (a light
  // switched on would change every program). Everything is restored exactly afterwards.
  function drawEverything() {
    const lods = [], objs = [];
    scene.traverse((o) => {
      if (!o.isLOD) return;
      lods.push({ o, auto: o.autoUpdate, vis: o.levels.map((l) => l.object.visible) });
      o.autoUpdate = false;
      for (const l of o.levels) l.object.visible = true;
    });
    let n = 0, unhidden = 0, emptied = 0;
    // (three skips a draw with nothing in it — an instanced mesh with count 0, a geometry with an empty draw range —
    // so e.g. a tree tier or a car type that has no instance near the start view was never drawn, and ANGLE compiled
    // its shader variant for the instanced vertex layout in the frame the first instance appeared: 0.3–1.6 s stalls
    // at x2 CPU in the tour / walk / zoom phases. One (degenerate) instance / triangle each for this frame.)
    const counts = [], ranges = [];
    scene.traverse((o) => {
      if (o === scene || o.isLight || o.isCamera) return;
      const drawable = o.isMesh || o.isPoints || o.isLine || o.isSprite;
      if (o.isInstancedMesh && o.count === 0 && o.instanceMatrix?.count > 0) { counts.push(o); o.count = 1; emptied++; }
      const g = drawable ? o.geometry : null;
      if (g?.drawRange && g.drawRange.count === 0 && !ranges.includes(g)) {
        const avail = g.index ? g.index.count : g.attributes?.position?.count ?? 0;
        const need = o.isPoints ? 1 : o.isLine ? 2 : 3;
        if (avail - g.drawRange.start >= need) { ranges.push(g); g.drawRange.count = need; emptied++; }
      }
      if (o.visible && !(drawable && o.frustumCulled)) return;
      objs.push(o, o.visible, o.frustumCulled);
      if (!o.visible) unhidden++;
      o.visible = true;
      if (drawable) { o.frustumCulled = false; n++; }
    });
    const lights = [];
    scene.traverse((o) => { if (o.isLight && o.castShadow && o.shadow) { lights.push(o); o.shadow.needsUpdate = true; } });
    renderer.shadowMap.needsUpdate = true;
    try { renderFrame(0); } catch (e) { console.warn('[engine] warm-up draw failed', e); }
    // the water reflection's own target too (a separate pass; every object's first draw into it)
    try { ctx.water?.reflection?.warm?.(true); } catch (e) { console.warn('[engine] reflection warm-up failed', e); }
    for (let i = 0; i < objs.length; i += 3) { objs[i].visible = objs[i + 1]; objs[i].frustumCulled = objs[i + 2]; }
    for (const { o, auto, vis } of lods) { o.autoUpdate = auto; o.levels.forEach((l, i) => { l.object.visible = vis[i]; }); }
    for (const o of counts) o.count = 0;
    for (const g of ranges) g.drawRange.count = 0;
    return { objects: n, unhidden, emptied, lods: lods.length, calls: frameInfo.calls, triangles: frameInfo.triangles };
  }

  const engine = {
    start() {
      if (running) return;
      running = true;
      last = -1;
      staticWorld();
      renderer.setAnimationLoop(frame);
      if (shotMode && !watchdog) {
        watchdog = setInterval(() => { if (running && performance.now() - lastFrameAt > 250) frame(performance.now()); }, 120);
      }
    },
    stop() {
      running = false;
      renderer.setAnimationLoop(null);
      if (watchdog) { clearInterval(watchdog); watchdog = null; }
    },
    get running() { return running; },
    render() { renderFrame(0); },
    // Start compiling root's programs (default: the whole scene) without waiting and upload its textures: the GPU
    // process compiles / uploads in the background while the app keeps building on the main thread. main.js may call
    // this after big init steps (best once the light setup is final, i.e. after the landmarks — a light added later
    // changes every lit program) so the final precompile() mostly finds everything ready. Cheap once programs are
    // cached (~10 ms for the whole scene). Only call it for finished subtrees (textures are uploaded as they are).
    // { upload: false } only issues the compiles: texture uploads queue behind the compiles in the GPU process and
    // would block the main thread until those are done, so an early warm-up during loading (main.js, right after the
    // landmarks — the light setup is final then) should leave the uploads to precompile().
    warm(root = scene, { upload = true } = {}) {
      if (!root) return;
      // relief normal maps for materials built from the shared surface / facade textures (before their programs
      // are compiled: the normal map is part of the program key)
      try { ctx.materials?.enhance?.(root); } catch (e) { console.warn('[engine] material relief failed', e); }
      try { issueCompiles(root, null, false)?.dispose(); } catch (e) { console.warn('[engine] warm-up compile failed', e); }
      if (upload) try { uploadTextures(root); } catch (e) { console.warn('[engine] warm-up texture upload failed', e); }
    },
    // Get everything the first frames need onto the GPU before the loading screen goes away:
    //  1. compile every program in parallel where KHR_parallel_shader_compile exists (scene for its real target,
    //     shadow-depth variants, post passes);
    //  2. while the driver compiles, upload every texture the scene references;
    //  3. run each program's first use (a synchronous GPU round trip, quick while the queue is empty);
    //  4. render one full warm-up frame (environment map, shadow map, post chain) so vertex buffers, VAOs and uniform
    //     locations exist too. The first visible frame then only draws.
    async precompile() {
      const tIssue = performance.now();
      try { ctx.materials?.enhance?.(scene); } catch (e) { console.warn('[engine] material relief failed', e); }
      const prev = renderer.getRenderTarget();
      const jobs = [];
      let tmpTarget = null;
      try {
        tmpTarget = issueCompiles(scene, jobs, true);
        if (post) {
          const pm = post.materials();
          renderer.setRenderTarget(pm.target);
          jobs.push(renderer.compileAsync(quadScene(pm.offscreen), camera));
          renderer.setRenderTarget(null);
          jobs.push(renderer.compileAsync(quadScene(pm.screen), camera));
        }
      } catch (e) {
        console.warn('[engine] precompile setup failed', e);
      } finally {
        renderer.setRenderTarget(prev);
      }
      // Texture uploads go out while the driver compiles (issued compiles run in the background); the uploads that
      // precede the program first-use queries below are part of what those queries wait for.
      const tUp = performance.now();
      let uploaded = 0;
      try { uploaded = uploadTextures(scene); } catch (e) { console.warn('[engine] texture pre-upload failed', e); }
      const tWait = performance.now();
      const res = await Promise.allSettled(jobs);
      tmpTarget?.dispose();
      // Program "first use" (link-status / info-log queries, uniform lookup) is a synchronous round trip to the GPU
      // process: done here, behind the loading screen, instead of in the first visible frame.
      const t0 = performance.now();
      for (const p of renderer.info.programs || []) { try { p.getUniforms(); } catch { /* reported by three */ } }
      const t1 = performance.now();
      // hidden warm-up frame: environment map, shadow map, vertex buffers / VAOs, post chain
      try {
        ctx.env?.prepareFrame?.();
        renderFrame(0);
      } catch (e) { console.warn('[engine] warm-up frame failed', e); }
      engine.precompileStats = {
        issue: Math.round(tUp - tIssue), upload: Math.round(tWait - tUp), textures: uploaded, wait: Math.round(t0 - tWait),
        firstUse: Math.round(t1 - t0), warmFrame: Math.round(performance.now() - t1), programs: renderer.info.programs?.length ?? 0,
        slowUploads: slowUploads.slice(),
      };
      const bad = res.find((r) => r.status === 'rejected');
      if (bad) throw bad.reason;
    },
    // Final loading step (main.js, after precompile): run the first frames' one-off work now, behind the loading
    // screen, instead of while the user starts exploring —
    //  1. two complete frames (per-frame updates + render): every module's first-update work (LOD choices, near
    //     ground paint, reflection, cloud-shadow map…) and the programs / uploads those frames need;
    //  2. every object drawn once, wherever it is and whatever its state (drawEverything);
    //  3. one more normal frame, then a GPU round trip so the driver has finished all of it.
    // The shadow maps are re-rendered for the real view afterwards. Returns timings / counts for __initTimings.
    warmScene() {
      if (running) return null;
      const t0 = performance.now();
      try { ctx.materials?.enhance?.(scene); } catch (e) { console.warn('[engine] material relief failed', e); }
      hiddenFrame(0); hiddenFrame(1 / 60);
      const t1 = performance.now();
      const all = drawEverything();
      gpuSync();
      const t2 = performance.now();
      ctx.env?.refreshShadows?.();
      hiddenFrame(1 / 60);
      gpuSync();
      const programs = renderer.info.programs?.length ?? 0;
      return { frames: Math.round(t1 - t0), everything: Math.round(t2 - t1), settle: Math.round(performance.now() - t2), programs, ...all };
    },
    hiddenFrame,
    tickOnly,
    gpuSync,
    resize,
    get postActive() { return !!post; },
    get post() { return post; },
    setAO(on) { aoWanted = !!on; applyLevels(); },
    setBloom(on) { bloomOff = !on; },
    // Runtime preset switch. Changing post / shadows / quality defines needs new variants of most programs; compiling
    // them lazily froze the page for 12–15 s (one synchronous compile per program on ANGLE). So the loop pauses, the
    // preset is applied, every program is compiled in parallel (precompile) and the loop resumes. Returns a Promise
    // (true once the new preset renders; false if a later call superseded it). The HUD reloads the page instead,
    // which also switches the canvas MSAA (can't change at runtime).
    setQuality(level) {
      if (!['low', 'medium', 'high'].includes(level)) return Promise.resolve(false);
      const seq = ++qualitySeq;
      const resume = running || qualityBusy;
      if (running) engine.stop();
      qualityBusy = true;
      const preset = qualityPreset(level);
      Object.assign(ctx.quality, preset);
      resetPerf();
      renderer.shadowMap.enabled = !!preset.shadows;
      renderer.shadowMap.needsUpdate = true;
      enablePost(!!preset.post);
      applyLevels(true);
      ctx.events.emit('quality', ctx.quality);
      emitPerf();
      const toastT = setTimeout(() => ctx.ui?.toast?.('正在切换画质…', { icon: 'refresh', ms: 1800 }), 250);
      return engine.precompile()
        .catch((e) => console.warn('[engine] precompile after quality change failed', e))
        .then(() => {
          clearTimeout(toastT);
          if (seq !== qualitySeq) return false;   // superseded: the newer call resumes the loop
          qualityBusy = false;
          if (resume) engine.start();
          return true;
        });
    },
    stats() {
      return {
        fps: Math.round(fps * 10) / 10,
        frameMs: Math.round(frameMs * 100) / 100,
        cpuMs: Math.round(cpuMs * 100) / 100,   // our JS per frame (update callbacks + draw submission)
        calls: frameInfo.calls,            // whole frame: shadow map + scene + post passes
        triangles: frameInfo.triangles,
        points: frameInfo.points,
        lines: frameInfo.lines,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        programs: renderer.info.programs?.length ?? 0,
        pixelRatio: renderer.getPixelRatio(),
        post: !!post,
        ao: !!post?.aoEnabled,
        bloom: !!post?.bloomEnabled,
        degrade: { cpu: perf.cpu, gpu: perf.gpu, share: Math.round(perf.share * 100) / 100 },
      };
    },
    get perfLevel() { return perf.cpu; },
  };
  ctx.engine = engine;
  return engine;
}
