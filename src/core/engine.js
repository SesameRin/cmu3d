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
  // Keep ~60 fps. Every 2.5 s the average frame interval is compared with the average time our own JS takes per
  // frame (ctx.tick + render — mostly three's draw-call submission):
  //  · GPU-bound (JS < ½ of the interval): walk down the GPU ladder — pixel ratio (HiDPI: 2 → 1.5 → 1.25 → 1), then
  //    AO (post), then a render scale below 1 (0.85 → 0.75), which also gives 'low'/'medium' a real fallback.
  //  · CPU-bound (JS ≥ ¾ of the interval): resolution and AO would only blur the picture for nothing. Instead raise the
  //    CPU degrade level 1..3 and emit 'perf:degrade' { level, cpu, gpu, pixelRatio, ao }: env renders the shadow map
  //    less often; other modules may shrink update radii / refresh rates. When nothing is left, the UI suggests a lower
  //    preset once.  · In between: CPU levers first (they also save GPU time), then GPU levers.
  // Recovery after a stretch of fast frames; with vsync at 60 Hz frame times can't show headroom, so after a while at
  // vsync rate one step up is probed, and the probe interval doubles every time it fails.
  const RES_STEPS = [2, 1.5, 1.25, 1];
  const SUB_STEPS = [0.85, 0.75];
  const CPU_MAX = 3;
  const perf = { sum: 0, js: 0, n: 0, slow: 0, fast: 0, vsync: 0, skip: 0, probing: false, probeWait: 20, gpu: 0, cpu: 0, hinted: false, avg: 0, share: 0, gpuCheck: 0, gpuBlock: 0 };
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
    ctx.events?.emit?.('perf:degrade', { level: perf.cpu, cpu: perf.cpu, gpu: perf.gpu, pixelRatio: renderer.getPixelRatio(), ao: !!post?.aoEnabled });
  }
  function resetPerf() {
    Object.assign(perf, { sum: 0, js: 0, n: 0, slow: 0, fast: 0, vsync: 0, skip: 0, probing: false, probeWait: 20, gpu: 0, cpu: 0, gpuCheck: 0, gpuBlock: 0 });
  }
  function hint() {
    if (perf.hinted || ctx.quality.level === 'low') return;
    perf.hinted = true;
    ctx.ui?.toast?.('画面较卡 · 可在「设置 → 画质」中选择较低画质', { icon: 'warn', ms: 5200 });
  }

  function autoDegrade(raw, js) {
    if (shotMode || elapsed < 8 || document.hidden || qualityBusy) return;
    if (raw <= 0 || raw > 0.5) { perf.sum = 0; perf.js = 0; perf.n = 0; return; }   // stall / tab switch: restart
    perf.sum += raw; perf.js += Math.min(js, raw); perf.n++;
    if (perf.sum < 2.5) return;
    const avg = perf.sum / perf.n, share = perf.js / perf.sum;
    perf.sum = 0; perf.js = 0; perf.n = 0;
    perf.avg = avg; perf.share = share;
    if (perf.skip > 0) { perf.skip--; return; }    // settling after a change
    const ms = (avg * 1000).toFixed(1), pct = Math.round(share * 100);
    const kind = share >= 0.75 ? 'CPU-bound' : share >= 0.5 ? 'CPU+GPU' : 'GPU-bound';
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
    if (avg > 0.0175) {
      perf.fast = 0;
      if (++perf.slow < 2 && !perf.probing) return;   // a single slow window (hitch) is ignored
      perf.slow = 0; perf.vsync = 0;
      if (perf.probing) perf.probeWait = Math.min(perf.probeWait * 2, 320);
      perf.probing = false;
      const L = gpuLadder();
      const canGpu = perf.gpu < L.length - 1 && elapsed >= perf.gpuBlock, canCpu = perf.cpu < CPU_MAX;
      let what = null;
      if (share >= 0.75) what = canCpu ? 'cpu' : null;                           // CPU-bound
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
        console.info(`[engine] average frame ${ms} ms, our JS ${pct}% of it (${kind}) — CPU degrade level ${perf.cpu}`);
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
    if (perf.gpu === 0 && perf.cpu === 0) return;
    // on the way back up: picture quality first, then the CPU levers
    const up = () => {
      if (perf.gpu > 0) { perf.gpu--; applyLevels(); } else perf.cpu--;
      perf.skip = 1;
      emitPerf();
    };
    if (avg < 0.012) {
      perf.vsync = 0;
      if (++perf.fast >= 2) { perf.fast = 0; up(); }
    } else {
      perf.fast = 0;
      if ((perf.vsync += 2.5) >= perf.probeWait) { perf.vsync = 0; perf.probing = true; up(); }
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
  function sceneTextures(root) {
    const set = new Set();
    const addUniforms = (u) => {
      if (!u) return;
      for (const k in u) {
        const v = u[k]?.value;
        if (v?.isTexture) set.add(v);
        else if (Array.isArray(v)) for (const t of v) if (t?.isTexture) set.add(t);
      }
    };
    const addMat = (m) => {
      if (!m) return;
      for (const k in m) { const v = m[k]; if (v && v.isTexture) set.add(v); }
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
  function uploadTextures(root) {
    let n = 0;
    for (const t of sceneTextures(root)) {
      if (t.isRenderTargetTexture || t.isDepthTexture || t.isVideoTexture || t.isFramebufferTexture) continue;
      if (!(t.version > 0)) continue;
      const img = t.image;
      if (!img || img.complete === false || (Array.isArray(img) && img.some((x) => !x))) continue;
      if (renderer.properties?.get(t).__version === t.version) continue;
      try { renderer.initTexture(t); n++; } catch (e) { console.warn('[engine] texture upload failed', t.name || t.uuid, e); }
    }
    return n;
  }

  const engine = {
    start() {
      if (running) return;
      running = true;
      last = -1;
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
    warm(root = scene) {
      if (!root) return;
      // relief normal maps for materials built from the shared surface / facade textures (before their programs
      // are compiled: the normal map is part of the program key)
      try { ctx.materials?.enhance?.(root); } catch (e) { console.warn('[engine] material relief failed', e); }
      try { issueCompiles(root, null, false)?.dispose(); } catch (e) { console.warn('[engine] warm-up compile failed', e); }
      try { uploadTextures(root); } catch (e) { console.warn('[engine] warm-up texture upload failed', e); }
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
      };
      const bad = res.find((r) => r.status === 'rejected');
      if (bad) throw bad.reason;
    },
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
