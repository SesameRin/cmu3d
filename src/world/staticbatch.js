// Static batching for the main (colour) pass — done once at loading time (world/warmup.js, after the landmark
// refinements, before the shader precompile / warm-up).
//
// Why: on a CPU-bound machine the frame is three.js draw submission. Landmarks alone are ~360 meshes with ~260
// distinct materials; every material switch costs a uniform upload (+ a program switch), every draw a VAO bind,
// matrices and a frustum test. Most of those materials differ only in scalar parameters (colour, roughness,
// metalness, emissive, normal scale) or in their textures (each landmark paints its own canvases).
//
// What happens here:
//  1. probe — which objects / materials / textures change at runtime? A few update ticks are run by day and by night
//     (and back) and every object's state (visibility, transform, material, geometry versions…), every material's
//     parameters and every texture transform are compared. Changed things are "dynamic": never merged (objects are
//     flagged userData.dynamic, which the shadow proxies respect too). Objects flagged userData.dynamic / noBatch /
//     noShadowProxy / cull by their modules are dynamic too (season-, night- or distance-toggled parts), as is
//     everything hidden at this point, inside a THREE.LOD, with render callbacks, or registered as a walkable.
//  2. material merging (conservative) — static, opaque, non-night MeshStandardMaterials without shader hooks whose
//     only textures are map / normalMap are grouped by everything that shapes the program and the GL state (side,
//     flags, map / normal-map size and sampler settings…). A group of ≥ 2 materials becomes ONE material:
//     colour → vertex colour, roughness / metalness / normal scale / emissive → vertex attributes, map and normal
//     map → texture arrays (one layer per source texture, same size and sampler settings, pixels copied 1:1), the
//     texture transform baked into the UVs. The shading maths is the same as the original's.
//     Materials registered with ctx.materials.registerNightMaterial (night emissive), materials animated at runtime
//     and anything with onBeforeCompile / custom programs keep their own instances.
//  3. spatial batching — static meshes that now share a material are merged, in world space, per ~480 m cell (so
//     frustum culling still works), per shadow / layer / render-order state. Each batch carries a triangle-range
//     table back to its source meshes, so ctx.pick resolvers (static entries or the modules' own resolver functions)
//     answer exactly as before. The original meshes leave the scene graph; their landmark roots get an invisible
//     bounds proxy so Box3.setFromObject(landmark.object) still measures the whole building.
// Not touched: colliders / walkables (separate data; walkable meshes are skipped), labels, LOD children, instanced
// meshes, transparent materials, anything dynamic (see 1). ?nobatch disables all of it (A/B checks); ?batchcheck
// re-checks the removed originals every 2 s and warns if any module still changes them.
import * as THREE from 'three';

const CELL = 480;   // m: batch cell size (frustum culling still works per cell; fewer, larger draws)
const MAX_VERTS = 4_000_000;       // per batch (Uint32 indices anyway)
const MAX_LAYERS = 256;            // texture-array layers per array (WebGL2 guarantees ≥ 256)
const O3 = THREE.Object3D.prototype;

let nid = 0;
const ids = new WeakMap();
const idOf = (o) => { if (o === null || o === undefined) return 0; let v = ids.get(o); if (!v) { v = ++nid; ids.set(o, v); } return v; };
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const matsOf = (o) => (Array.isArray(o.material) ? o.material : o.material ? [o.material] : []);
const TEX_SLOTS = ['map', 'normalMap', 'lightMap', 'aoMap', 'emissiveMap', 'bumpMap', 'displacementMap', 'roughnessMap',
  'metalnessMap', 'alphaMap', 'envMap', 'specularMap', 'gradientMap', 'matcap', 'clearcoatMap', 'clearcoatNormalMap',
  'clearcoatRoughnessMap', 'iridescenceMap', 'iridescenceThicknessMap', 'sheenColorMap', 'sheenRoughnessMap',
  'transmissionMap', 'thicknessMap', 'specularIntensityMap', 'specularColorMap', 'anisotropyMap'];

// ---------------------------------------------------------------- signatures
function valSig(v) {
  if (v === null || v === undefined) return String(v);
  const t = typeof v;
  if (t === 'number') return Number.isFinite(v) ? String(Math.round(v * 1e7) / 1e7) : String(v);
  if (t === 'boolean' || t === 'string') return t[0] + v;
  if (t === 'function') return 'f' + idOf(v);
  if (v.isColor) return 'C' + v.r.toFixed(7) + ',' + v.g.toFixed(7) + ',' + v.b.toFixed(7);
  if (v.isVector2) return 'V' + v.x + ',' + v.y;
  if (v.isVector3) return 'V' + v.x + ',' + v.y + ',' + v.z;
  if (v.isVector4) return 'V' + v.x + ',' + v.y + ',' + v.z + ',' + v.w;
  if (v.isEuler) return 'E' + v.x + ',' + v.y + ',' + v.z + v.order;
  if (v.isTexture) return 'T' + idOf(v);
  if (Array.isArray(v)) return v.length ? 'A' + idOf(v) + ':' + v.length : 'A0';
  if (Object.getPrototypeOf(v) === Object.prototype) { try { return 'J' + JSON.stringify(v); } catch { return 'O' + idOf(v); } }
  return 'O' + idOf(v);
}
// every parameter of a material, incl. what the probe watches (colour, intensities, version = needsUpdate)
function matStateSig(m) {
  const p = [m.type, 'v' + m.version];
  for (const k of Object.keys(m)) { if (k === 'uuid' || k === 'id' || k === '_listeners') continue; p.push(k + '=' + valSig(m[k])); }
  return p.join('|');
}
function texStateSig(t) {
  return [t.version, idOf(t.image), t.offset.x, t.offset.y, t.repeat.x, t.repeat.y, t.rotation, t.center.x, t.center.y,
    t.matrixAutoUpdate ? 1 : 0, t.matrix.elements.join(','), t.channel].join('|');
}
function objStateSig(o) {
  const a = [o.visible ? 1 : 0, o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0, o.layers.mask, o.renderOrder, o.frustumCulled ? 1 : 0,
    idOf(o.parent), o.children.length, matsOf(o).map(idOf).join('/'), idOf(o.geometry)];
  const e = o.matrixWorld.elements;
  for (let i = 0; i < 16; i++) a.push(Math.round(e[i] * 1e5));
  const g = o.geometry;
  if (g?.attributes) {
    for (const k in g.attributes) a.push(k + ':' + idOf(g.attributes[k]) + ':' + g.attributes[k].version);
    if (g.index) a.push('i' + idOf(g.index) + ':' + g.index.version);
    a.push(g.drawRange.start, g.drawRange.count);
  }
  if (o.morphTargetInfluences) a.push(o.morphTargetInfluences.join('/'));
  if (o.isInstancedMesh) a.push('n' + o.count, o.instanceMatrix.version);
  return a.join(',');
}

// ---------------------------------------------------------------- 1. probe
/**
 * Which objects / materials / textures under `roots` change at runtime? Runs a few update ticks by day and by night
 * (engine.tickOnly: per-frame updates without rendering; the water reflection is paused meanwhile) and compares.
 * Returns { objects:Set, materials:Set, textures:Set, ms }. Dynamic objects are also flagged userData.dynamic.
 */
export function probeDynamic(ctx, roots) {
  const t0 = performance.now();
  const out = { objects: new Set(), materials: new Set(), textures: new Set(), ms: 0, ticks: 0 };
  const env = ctx.env, eng = ctx.engine, scene = ctx.scene;
  if (!scene) return out;
  const objs = [];
  for (const r of roots) r?.traverse((o) => objs.push(o));
  const mats = new Set(), texs = new Set();
  for (const o of objs) for (const m of matsOf(o)) {
    mats.add(m);
    for (const k of TEX_SLOTS) if (m[k]?.isTexture) texs.add(m[k]);
  }
  const snap = () => {
    scene.updateMatrixWorld(true);
    return {
      o: objs.map(objStateSig),
      m: new Map([...mats].map((m) => [m, matStateSig(m)])),
      t: new Map([...texs].map((t) => [t, texStateSig(t)])),
    };
  };
  const base = snap();
  const debug = ctx.params?.has?.('batchdebug') ? (out.details = []) : null;
  const diff = () => {
    const s = snap();
    for (let i = 0; i < objs.length; i++) {
      if (s.o[i] === base.o[i]) continue;
      if (debug && !out.objects.has(objs[i])) {
        const a = base.o[i].split(','), b = s.o[i].split(',');
        const f = a.findIndex((x, k) => x !== b[k]);
        let r = objs[i]; while (r.parent && r.parent !== scene) r = r.parent;
        debug.push(`${r.name}/${objs[i].name || objs[i].type}: field ${f} ${a[f]}→${b[f]}`);
      }
      out.objects.add(objs[i]);
    }
    for (const [m, sig] of s.m) if (sig !== base.m.get(m)) out.materials.add(m);
    for (const [t, sig] of s.t) if (sig !== base.t.get(t)) out.textures.add(t);
  };
  const tick = (n) => {
    if (typeof eng?.tickOnly !== 'function') return;
    for (let i = 0; i < n; i++) { eng.tickOnly(0.1); out.ticks++; }
  };
  const refl = ctx.water?.reflection;
  const reflWas = refl ? refl.enabled : undefined;
  if (refl) refl.enabled = false;               // (it would render — and compile — the scene inside the tick)
  const h0 = env?.getTime?.();
  try {
    tick(3); diff();
    if (env?.setTime && Number.isFinite(h0)) {
      const night = (env.state?.nightFactor ?? 0) > 0.5;
      env.setTime(night ? 13 : 22.5); tick(4); diff();
      env.setTime(h0); tick(4); diff();
    }
  } catch (e) {
    console.warn('[batch] probe failed — nothing is merged', e);
    for (const o of objs) out.objects.add(o);
  } finally {
    if (refl) refl.enabled = reflWas;
    if (env?.setTime && Number.isFinite(h0) && env.getTime() !== h0) env.setTime(h0);
  }
  for (const o of out.objects) o.userData.dynamic = true;
  if (out.details) window.__probeDetails = out.details;
  out.ms = Math.round(performance.now() - t0);
  return out;
}

// ---------------------------------------------------------------- 2. material merging
function texReadable(t) {
  if (!t?.isTexture || t.isRenderTargetTexture || t.isVideoTexture || t.isCompressedTexture || t.isCubeTexture ||
    t.isDataArrayTexture || t.isData3DTexture || t.isDepthTexture || t.isFramebufferTexture) return false;
  if (t.format !== THREE.RGBAFormat || t.type !== THREE.UnsignedByteType || t.internalFormat || t.premultiplyAlpha) return false;
  if (!(t.version > 0)) return false;          // never marked for upload: nothing to copy from
  const img = t.image;
  if (!img || Array.isArray(img)) return false;
  const w = img.width, h = img.height;
  if (!(w > 1 && h > 1)) return false;        // released canvas (already uploaded) or placeholder
  if (t.isDataTexture) {
    const d = img.data;
    return (d instanceof Uint8Array || d instanceof Uint8ClampedArray) && d.length === w * h * 4;
  }
  return (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) ||
    (typeof OffscreenCanvas !== 'undefined' && img instanceof OffscreenCanvas) ||
    (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) ||
    (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement && img.complete);
}
// size + sampler settings of a texture that goes into an array (layers must agree on all of them)
function texClassSig(t) {
  const img = t.image;
  return [img.width, img.height, t.colorSpace, t.wrapS, t.wrapT, t.magFilter, t.minFilter, t.anisotropy,
    t.generateMipmaps ? 1 : 0, t.unpackAlignment].join(',');
}
// map / normal-map UV transform (row-major 2×3) — the texture's own matrix, as three computes it
function texXform(t) {
  if (t.matrixAutoUpdate) t.updateMatrix();
  const e = t.matrix.elements;
  return [e[0], e[3], e[6], e[1], e[4], e[7]];
}
const sameXform = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);

// Properties that stay per material in the merged key: everything except the parameters moved into vertex data
// and the ones without effect for this material (their map is absent).
const PER_VERTEX = new Set(['color', 'roughness', 'metalness', 'emissive', 'emissiveIntensity', 'normalScale', 'map', 'normalMap',
  'envMapIntensity', 'envMapRotation', 'aoMapIntensity', 'lightMapIntensity', 'bumpScale', 'displacementScale', 'displacementBias',
  'name', 'uuid', 'id', 'version', 'userData', '_listeners', 'vertexColors']);

function mergeableMaterial(m, dyn) {
  if (!m || m.type !== 'MeshStandardMaterial' || !m.isMeshStandardMaterial) return false;
  if (dyn.materials.has(m) || m.userData?.nightIntensity !== undefined || m.userData?.dynamic || m.userData?.noBatch) return false;
  if (hasOwn(m, 'onBeforeCompile') || hasOwn(m, 'customProgramCacheKey') || hasOwn(m, 'onBuild') || hasOwn(m, 'onBeforeRender')) return false;
  if (m.transparent || m.alphaTest > 0 || m.alphaHash || m.alphaToCoverage || m.wireframe || m.visible === false) return false;
  if (m.clippingPlanes?.length || m.stencilWrite || m.blending !== THREE.NormalBlending) return false;
  for (const k of TEX_SLOTS) if (k !== 'map' && k !== 'normalMap' && m[k]) return false;
  if (m.map && (!texReadable(m.map) || dyn.textures.has(m.map))) return false;
  if (m.normalMap && (!texReadable(m.normalMap) || dyn.textures.has(m.normalMap) || m.normalMapType !== THREE.TangentSpaceNormalMap)) return false;
  const d = m.defines ? Object.keys(m.defines) : [];
  if (d.some((k) => k !== 'STANDARD')) return false;
  return true;
}
function mergeKey(m) {
  const p = [];
  for (const k of Object.keys(m).sort()) if (!PER_VERTEX.has(k)) p.push(k + '=' + valSig(m[k]));
  const ud = { ...m.userData }; delete ud.cmuRelief; delete ud.cmuA2C;
  p.push('ud=' + valSig(ud));
  p.push('map=' + (m.map ? texClassSig(m.map) : '-'));
  p.push('nrm=' + (m.normalMap ? texClassSig(m.normalMap) : '-'));
  // one shared UV set when map and normal map use the same UVs (else the normal map gets its own, uv1)
  if (m.map && m.normalMap) p.push('same=' + (m.map.channel === m.normalMap.channel && sameXform(texXform(m.map), texXform(m.normalMap)) ? 1 : 0));
  return p.join('|');
}

let DUMMY = null;
function dummyTex(colorSpace, channel) {
  DUMMY ||= new Map();
  const k = colorSpace + ':' + channel;
  if (!DUMMY.has(k)) {
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.colorSpace = colorSpace; t.channel = channel; t.name = 'batch-dummy'; t.needsUpdate = true;
    DUMMY.set(k, t);
  }
  return DUMMY.get(k);
}

// copy the source textures of one slot into a texture array (one layer each, rows as three would upload them)
function buildArray(textures, name) {
  const t0 = textures[0], w = t0.image.width, h = t0.image.height, n = textures.length;
  const data = new Uint8Array(w * h * 4 * n);
  let scratch = null, sg = null;
  textures.forEach((t, layer) => {
    let px;
    const img = t.image;
    if (t.isDataTexture) px = img.data;
    else {
      if (!scratch) { scratch = document.createElement('canvas'); scratch.width = w; scratch.height = h; sg = scratch.getContext('2d', { willReadFrequently: true }); }
      sg.clearRect(0, 0, w, h);
      sg.drawImage(img, 0, 0);
      px = sg.getImageData(0, 0, w, h).data;
    }
    const off = layer * w * h * 4, row = w * 4;
    if (t.flipY) for (let y = 0; y < h; y++) data.set(px.subarray((h - 1 - y) * row, (h - y) * row), off + y * row);
    else data.set(px.subarray(0, w * h * 4), off);
  });
  if (scratch) { scratch.width = scratch.height = 1; }
  const a = new THREE.DataArrayTexture(data, w, h, n);
  a.name = name;
  a.onUpdate = () => { a.onUpdate = null; a.image.data = null; };   // (the GPU keeps the pixels; a lost context reloads the page)
  a.format = THREE.RGBAFormat; a.type = THREE.UnsignedByteType;
  a.colorSpace = t0.colorSpace;
  a.wrapS = t0.wrapS; a.wrapT = t0.wrapT;
  a.magFilter = t0.magFilter; a.minFilter = t0.minFilter;
  a.anisotropy = t0.anisotropy; a.generateMipmaps = t0.generateMipmaps;
  a.flipY = false; a.premultiplyAlpha = false; a.unpackAlignment = 4;
  a.needsUpdate = true;
  return a;
}

// Replace a program chunk, checking the text we patch is really there (three changes) — else the merge is off.
function patchChunk(src, name, from, to) {
  const chunk = THREE.ShaderChunk[name];
  if (!chunk || !chunk.includes(from)) throw new Error(`[batch] chunk ${name} changed`);
  const inc = `#include <${name}>`;
  if (!src.includes(inc)) throw new Error(`[batch] ${inc} missing`);
  return src.replace(inc, chunk.split(from).join(to));
}
function checkChunks() {
  const need = [['roughnessmap_fragment', 'float roughnessFactor = roughness;'], ['metalnessmap_fragment', 'float metalnessFactor = metalness;'],
    ['map_fragment', 'texture2D( map, vMapUv )'], ['normal_fragment_maps', 'texture2D( normalMap, vNormalMapUv )'], ['normal_fragment_maps', 'mapN.xy *= normalScale;']];
  const frag = THREE.ShaderLib.physical?.fragmentShader || '';
  return need.every(([n, s]) => THREE.ShaderChunk[n]?.includes(s)) && frag.includes('vec3 totalEmissiveRadiance = emissive;') &&
    frag.includes('#include <roughnessmap_fragment>') && frag.includes('#include <metalnessmap_fragment>');
}

function makeMergedMaterial(proto, spec, index) {
  const m = new THREE.MeshStandardMaterial();
  m.copy(proto);
  m.name = `batch:${proto.name || 'std'}+${spec.members.length - 1}`;
  m.color.setRGB(1, 1, 1);
  m.roughness = 1; m.metalness = 1;
  m.emissive.setRGB(0, 0, 0); m.emissiveIntensity = 1;
  m.vertexColors = true;
  m.map = spec.mapArr ? dummyTex(spec.mapArr.colorSpace, 0) : null;
  m.normalMap = spec.nrmArr ? dummyTex(THREE.NoColorSpace, spec.nrmCh) : null;
  m.normalScale.set(1, 1);
  m.userData = { cmuRelief: false, staticBatch: true };      // (materials.enhance: nothing to add)
  const emissive = spec.emissive, mapArr = spec.mapArr, nrmArr = spec.nrmArr;
  const flags = `${emissive ? 'e' : ''}${mapArr ? 'm' : ''}${nrmArr ? 'n' + spec.nrmCh : ''}`;
  m.onBeforeCompile = (sh) => {
    let vs = sh.vertexShader, fs = sh.fragmentShader;
    const decl = ['attribute vec4 bparams;', 'varying vec4 vBParams;'];
    const set = ['vBParams = bparams;'];
    if (emissive) { decl.push('attribute vec3 bemissive;', 'varying vec3 vBEmissive;'); set.push('vBEmissive = bemissive;'); }
    if (mapArr || nrmArr) { decl.push('attribute vec2 blayer;', 'varying vec2 vBLayer;'); set.push('vBLayer = blayer;'); }
    vs = vs.replace('#include <common>', `#include <common>\n${decl.join('\n')}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${set.join('\n')}`);
    const fdecl = ['varying vec4 vBParams;'];
    if (emissive) fdecl.push('varying vec3 vBEmissive;');
    if (mapArr || nrmArr) fdecl.push('varying vec2 vBLayer;');
    if (mapArr) { fdecl.push('uniform sampler2DArray bMapArr;'); sh.uniforms.bMapArr = { value: mapArr }; }
    if (nrmArr) { fdecl.push('uniform sampler2DArray bNrmArr;'); sh.uniforms.bNrmArr = { value: nrmArr }; }
    fs = fs.replace('#include <common>', `#include <common>\n${fdecl.join('\n')}`);
    fs = patchChunk(fs, 'roughnessmap_fragment', 'float roughnessFactor = roughness;', 'float roughnessFactor = vBParams.x;');
    fs = patchChunk(fs, 'metalnessmap_fragment', 'float metalnessFactor = metalness;', 'float metalnessFactor = vBParams.y;');
    if (emissive) {
      if (!fs.includes('vec3 totalEmissiveRadiance = emissive;')) throw new Error('[batch] emissive line changed');
      fs = fs.replace('vec3 totalEmissiveRadiance = emissive;', 'vec3 totalEmissiveRadiance = vBEmissive;');
    }
    if (mapArr) fs = patchChunk(fs, 'map_fragment', 'texture2D( map, vMapUv )', 'texture( bMapArr, vec3( vMapUv, vBLayer.x ) )');
    if (nrmArr) {
      fs = fs.replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps
        .split('texture2D( normalMap, vNormalMapUv )').join('texture( bNrmArr, vec3( vNormalMapUv, vBLayer.y ) )')
        .split('mapN.xy *= normalScale;').join('mapN.xy *= vBParams.zw;'));
    }
    sh.vertexShader = vs; sh.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => `cmu-static-batch-v1:${flags}:${index}`;
  return m;
}

// ---------------------------------------------------------------- 3. geometry
const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
function drawSpan(g) {
  const n = g.index ? g.index.count : g.attributes.position.count;
  const s = Math.max(0, g.drawRange.start), e = Math.min(n, g.drawRange.count === Infinity ? n : g.drawRange.start + g.drawRange.count);
  return [s, Math.max(s, e - ((e - s) % 3))];
}
function attrSig(g) {
  return Object.keys(g.attributes).sort().map((k) => {
    const a = g.attributes[k];
    return `${k}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.gpuType ?? ''}:${(a.isInterleavedBufferAttribute ? a.data.array : a.array).constructor.name}`;
  }).join(',');
}

// Merge a list of sources { mesh, matrix (world), det, params? } into one geometry.
// mode 'exact': all attributes copied (position / normal transformed). mode 'merged': the merged material's layout.
function mergeSources(list, mode, spec) {
  let nv = 0, ni = 0;
  for (const s of list) { const [a, b] = drawSpan(s.mesh.geometry); s.span = [a, b]; nv += s.mesh.geometry.attributes.position.count; ni += b - a; }
  const g0 = list[0].mesh.geometry;
  const out = new THREE.BufferGeometry();
  const pos = new Float32Array(nv * 3);
  const hasNormal = !!g0.attributes.normal;
  const nor = hasNormal ? new Float32Array(nv * 3) : null;
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const extra = {};    // exact mode: other attributes
  if (mode === 'exact') {
    for (const k of Object.keys(g0.attributes)) {
      if (k === 'position' || k === 'normal') continue;
      const a = g0.attributes[k], Arr = (a.isInterleavedBufferAttribute ? a.data.array : a.array).constructor;
      extra[k] = { arr: new Arr(nv * a.itemSize), size: a.itemSize, norm: a.normalized, gpuType: a.gpuType };
    }
  }
  let col, bp, bem, uv0, uv1, lay;
  if (mode === 'merged') {
    col = new Float32Array(nv * 3); bp = new Float32Array(nv * 4);
    if (spec.emissive) bem = new Float32Array(nv * 3);
    if (spec.mapArr || (spec.nrmArr && spec.nrmCh === 0)) uv0 = new Float32Array(nv * 2);
    if (spec.nrmArr && spec.nrmCh === 1) uv1 = new Float32Array(nv * 2);
    if (spec.mapArr || spec.nrmArr) lay = new Float32Array(nv * 2);
  }
  const ranges = [];
  let vo = 0, io = 0;
  for (const s of list) {
    const g = s.mesh.geometry, P = g.attributes.position, N = g.attributes.normal, n = P.count, e = s.matrix.elements;
    for (let i = 0; i < n; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i), k = (vo + i) * 3;
      pos[k] = e[0] * x + e[4] * y + e[8] * z + e[12];
      pos[k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      pos[k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    if (nor) {
      _nm.getNormalMatrix(s.matrix);
      for (let i = 0; i < n; i++) {
        _n.set(N.getX(i), N.getY(i), N.getZ(i)).applyMatrix3(_nm).normalize();
        const k = (vo + i) * 3;
        nor[k] = _n.x; nor[k + 1] = _n.y; nor[k + 2] = _n.z;
      }
    }
    if (mode === 'exact') {
      for (const k in extra) {
        const a = g.attributes[k], x = extra[k], sz = x.size, base = vo * sz;
        if (!a.isInterleavedBufferAttribute && a.array.length >= n * sz) x.arr.set(a.array.subarray(0, n * sz), base);
        else for (let i = 0; i < n; i++) for (let c = 0; c < sz; c++) x.arr[base + i * sz + c] = a.getComponent(i, c);
      }
    } else {
      const p = s.params, C = s.mesh.material.vertexColors ? g.attributes.color : null;
      for (let i = 0; i < n; i++) {
        const k3 = (vo + i) * 3, k4 = (vo + i) * 4;
        col[k3] = p.color[0] * (C ? C.getX(i) : 1); col[k3 + 1] = p.color[1] * (C ? C.getY(i) : 1); col[k3 + 2] = p.color[2] * (C ? C.getZ(i) : 1);
        bp[k4] = p.rough; bp[k4 + 1] = p.metal; bp[k4 + 2] = p.ns[0]; bp[k4 + 3] = p.ns[1];
        if (bem) { bem[k3] = p.em[0]; bem[k3 + 1] = p.em[1]; bem[k3 + 2] = p.em[2]; }
      }
      const uvOf = (t, M, dst) => {
        const U = g.attributes[t.channel ? `uv${t.channel}` : 'uv'];
        for (let i = 0; i < n; i++) {
          const u = U.getX(i), v = U.getY(i), k = (vo + i) * 2;
          dst[k] = M[0] * u + M[1] * v + M[2]; dst[k + 1] = M[3] * u + M[4] * v + M[5];
        }
      };
      const mat = s.mesh.material;
      if (spec.mapArr) uvOf(mat.map, p.mapX, uv0);
      if (spec.nrmArr) uvOf(mat.normalMap, p.nrmX, spec.nrmCh === 1 ? uv1 : uv0);
      if (lay) for (let i = 0; i < n; i++) { const k = (vo + i) * 2; lay[k] = p.mapLayer; lay[k + 1] = p.nrmLayer; }
    }
    // indices (winding flipped for mirrored transforms), range table for picking
    const [a, b] = s.span, I = g.index, flip = s.det < 0;
    const t0 = io / 3;
    for (let j = a; j < b; j += 3) {
      let i0 = I ? I.getX(j) : j, i1 = I ? I.getX(j + 1) : j + 1, i2 = I ? I.getX(j + 2) : j + 2;
      if (flip) { const t = i1; i1 = i2; i2 = t; }
      index[io++] = i0 + vo; index[io++] = i1 + vo; index[io++] = i2 + vo;
    }
    ranges.push({ start: t0, end: io / 3, src: s, vo, tri0: a / 3 });
    vo += n;
  }
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (nor) out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  for (const k in extra) {
    const x = extra[k], attr = new THREE.BufferAttribute(x.arr, x.size, x.norm);
    if (x.gpuType !== undefined) attr.gpuType = x.gpuType;          // (integer attributes: vertexAttribIPointer)
    out.setAttribute(k, attr);
  }
  if (mode === 'merged') {
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('bparams', new THREE.BufferAttribute(bp, 4));
    if (bem) out.setAttribute('bemissive', new THREE.BufferAttribute(bem, 3));
    if (uv0) out.setAttribute('uv', new THREE.BufferAttribute(uv0, 2));
    if (uv1) out.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
    if (lay) out.setAttribute('blayer', new THREE.BufferAttribute(lay, 2));
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return { geometry: out, ranges };
}

// ---------------------------------------------------------------- entry point
/**
 * Merge the static meshes under `roots` (landmarks, bridges…; `lite` roots go into a second group that the water
 * reflection skips like their originals). Call after the shadow proxies exist and before the shader precompile.
 */
export function buildStaticBatches(ctx, { roots = [], lite = [], dynamic = null } = {}) {
  const t0 = performance.now();
  const scene = ctx.scene;
  const stats = { sources: 0, batches: 0, materialsBefore: 0, materialsAfter: 0, mergedGroups: 0, mergedMaterials: 0, arrays: 0, arrayLayers: 0, skipped: {}, ms: 0 };
  if (!scene) return stats;
  const dyn = dynamic || { objects: new Set(), materials: new Set(), textures: new Set() };
  const skip = (why) => { stats.skipped[why] = (stats.skipped[why] || 0) + 1; };
  scene.updateMatrixWorld(true);
  const walkables = new Set(ctx.walkables?.meshes || []);
  const pickItems = ctx.pick?.items;
  const pickOf = (o) => { for (let p = o; p; p = p.parent) { const e = pickItems?.get(p); if (e) return e; } return null; };

  // ---- candidates
  const cands = [];
  const visit = (o, root, isLite) => {
    if (!o.visible) return;                                    // hidden now = toggled at runtime (or a proxy)
    if (o.isLOD) { skip('lod'); return; }
    const u = o.userData;
    if (u && (u.dynamic || u.noBatch || u.noShadowProxy || u.cull) ) { skip('flagged'); return; }
    if (dyn.objects.has(o)) { skip('dynamic'); return; }
    if (o.isMesh && o !== root) {
      const why = meshSkip(o, walkables);
      if (why) skip(why);
      else cands.push({ mesh: o, root, lite: isLite });
    }
    for (const c of o.children) visit(c, root, isLite);
  };
  for (const r of roots) if (r) visit(r, r, false);
  for (const r of lite) if (r) visit(r, r, true);
  const before = new Set(cands.map((c) => c.mesh.material));
  stats.materialsBefore = before.size;

  // ---- material merge groups
  const groups = new Map();
  const mergeOK = checkChunks();
  if (mergeOK) {
    for (const c of cands) {
      const m = c.mesh.material, g = c.mesh.geometry;
      if (!mergeableMaterial(m, dyn)) continue;
      if (!g.attributes.normal) continue;
      if (m.vertexColors && !g.attributes.color) continue;
      if (m.map && !g.attributes[m.map.channel ? `uv${m.map.channel}` : 'uv']) continue;
      if (m.normalMap && !g.attributes[m.normalMap.channel ? `uv${m.normalMap.channel}` : 'uv']) continue;
      const k = mergeKey(m);
      let G = groups.get(k);
      if (!G) groups.set(k, (G = { key: k, mats: new Set(), cands: [] }));
      G.mats.add(m); G.cands.push(c);
    }
  }
  const mergedOf = new Map();         // source material → { material, params }
  const specOf = new WeakMap();       // merged material → its layout (emissive, arrays, normal-map UV channel)
  let gi = 0;
  for (const G of groups.values()) {
    if (G.mats.size < 2) continue;
    const members = [...G.mats];
    const proto = members[0];
    // texture arrays (layers by texture identity; a group larger than MAX_LAYERS is split off by first-come)
    const mapTex = [], nrmTex = [];
    const mapIdx = new Map(), nrmIdx = new Map();
    let ok = true;
    for (const m of members) {
      if (m.map && !mapIdx.has(m.map)) { mapIdx.set(m.map, mapTex.length); mapTex.push(m.map); }
      if (m.normalMap && !nrmIdx.has(m.normalMap)) { nrmIdx.set(m.normalMap, nrmTex.length); nrmTex.push(m.normalMap); }
    }
    if (mapTex.length > MAX_LAYERS || nrmTex.length > MAX_LAYERS) ok = false;
    if (!ok) continue;
    const same = !!(proto.map && proto.normalMap) && proto.map.channel === proto.normalMap.channel && sameXform(texXform(proto.map), texXform(proto.normalMap));
    const spec = { members, emissive: false, mapArr: null, nrmArr: null, nrmCh: 0 };
    try {
      if (mapTex.length) { spec.mapArr = buildArray(mapTex, `batch-map[${gi}]`); stats.arrays++; stats.arrayLayers += mapTex.length; }
      if (nrmTex.length) { spec.nrmArr = buildArray(nrmTex, `batch-normal[${gi}]`); stats.arrays++; stats.arrayLayers += nrmTex.length; }
    } catch (e) {
      console.warn('[batch] texture array failed — group left alone', e);
      continue;
    }
    spec.nrmCh = spec.nrmArr && spec.mapArr && !same ? 1 : 0;
    for (const m of members) {
      const e = m.emissive, ei = m.emissiveIntensity;
      if (e && (e.r * ei > 0 || e.g * ei > 0 || e.b * ei > 0)) spec.emissive = true;
    }
    let material;
    try { material = makeMergedMaterial(proto, spec, gi); } catch (e) { console.warn('[batch] merged material failed', e); continue; }
    specOf.set(material, spec);
    const back = proto.side === THREE.BackSide ? -1 : 1;     // (three negates normalScale for back-side materials)
    for (const m of members) {
      const ei = m.emissiveIntensity;
      mergedOf.set(m, {
        material,
        params: {
          color: [m.color.r, m.color.g, m.color.b], rough: m.roughness, metal: m.metalness,
          ns: [m.normalScale.x * back, m.normalScale.y * back], em: [m.emissive.r * ei, m.emissive.g * ei, m.emissive.b * ei],
          mapLayer: m.map ? mapIdx.get(m.map) : 0, nrmLayer: m.normalMap ? nrmIdx.get(m.normalMap) : 0,
          mapX: m.map ? texXform(m.map) : null, nrmX: m.normalMap ? texXform(m.normalMap) : null,
        },
      });
    }
    stats.mergedGroups++; stats.mergedMaterials += members.length;
    gi++;
  }

  // ---- spatial buckets
  const buckets = new Map();
  const _c = new THREE.Vector3();
  for (const c of cands) {
    const o = c.mesh, g = o.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    _c.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld);
    const mg = mergedOf.get(o.material);
    const pick = pickOf(o);
    const key = [mg ? 'M' + mg.material.id : 'X' + o.material.id + '|' + attrSig(g), Math.floor(_c.x / CELL), Math.floor(_c.z / CELL),
      o.castShadow ? 1 : 0, o.receiveShadow ? 1 : 0, o.layers.mask, o.renderOrder, c.lite ? 1 : 0, pick ? 1 : 0].join('|');
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { key, merged: mg ? mg.material : null, material: mg ? mg.material : o.material, list: [], verts: 0, lite: c.lite, pickable: !!pick }));
    const n = g.attributes.position.count;
    if (b.verts + n > MAX_VERTS) { skip('batch-full'); continue; }
    b.list.push({ mesh: o, root: c.root, matrix: o.matrixWorld.clone(), det: o.matrixWorld.determinant(), params: mg ? mg.params : null, pick });
    b.verts += n;
  }

  // ---- build
  const group = new THREE.Group(); group.name = 'static-batches';
  const liteGroup = new THREE.Group(); liteGroup.name = 'static-batches-lite';
  const pickGroup = new THREE.Group(); pickGroup.name = 'static-batches:pick';
  const pickLite = new THREE.Group(); pickLite.name = 'static-batches-lite:pick';
  group.add(pickGroup); liteGroup.add(pickLite);
  const removed = new Map();        // root → [meshes]
  const originals = [];
  for (const b of buckets.values()) {
    if (!b.merged && b.list.length < 2) continue;             // nothing to gain
    let res;
    try { res = mergeSources(b.list, b.merged ? 'merged' : 'exact', b.merged ? specOf.get(b.merged) : null); } catch (e) { console.warn('[batch] merge failed', e); continue; }
    const s0 = b.list[0].mesh;
    const mesh = new THREE.Mesh(res.geometry, b.material);
    mesh.name = `batch:${b.material.name || b.material.type}`;
    mesh.castShadow = s0.castShadow; mesh.receiveShadow = s0.receiveShadow;
    mesh.layers.mask = s0.layers.mask; mesh.renderOrder = s0.renderOrder;
    mesh.matrixAutoUpdate = false;
    mesh.userData.batchRanges = res.ranges;
    (b.pickable ? (b.lite ? pickLite : pickGroup) : (b.lite ? liteGroup : group)).add(mesh);
    for (const s of b.list) {
      const o = s.mesh;
      if (!removed.has(s.root)) removed.set(s.root, []);
      removed.get(s.root).push(o);
      originals.push(o);
      o.parent?.remove(o);
      if (pickItems?.has(o)) ctx.pick.remove(o);    // (its entry answers through the batch's range table now)
      // what picking needs later: a static entry, or the module's resolver + the source mesh (see resolver below)
      const p = s.pick;
      s.entry = p && typeof p !== 'function' ? p : null;
      s.fn = typeof p === 'function' ? p : null;
      if (!s.fn) s.mesh = null;         // (the original is only kept for resolver functions)
      s.matrix = null; s.params = null; s.root = null;
    }
    stats.sources += b.list.length;
    stats.batches++;
  }
  if (!stats.batches) { stats.ms = Math.round(performance.now() - t0); return stats; }

  // triangle → source → pick entry (static entries directly; resolver functions get a hit on the source mesh)
  const resolver = (hit) => {
    const r = hit.object?.userData?.batchRanges, f = hit.faceIndex;
    if (!r || f === undefined || f === null) return null;
    let lo = 0, hi = r.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, x = r[mid];
      if (f < x.start) hi = mid - 1;
      else if (f >= x.end) lo = mid + 1;
      else {
        const s = x.src;
        if (s.entry) return s.entry;
        if (!s.fn) return null;
        const face = hit.face ? { ...hit.face, a: hit.face.a - x.vo, b: hit.face.b - x.vo, c: hit.face.c - x.vo } : null;
        try { return s.fn({ ...hit, object: s.mesh, faceIndex: f - x.start + x.tri0, face }) || null; } catch { return null; }
      }
    }
    return null;
  };
  for (const pg of [pickGroup, pickLite]) if (pg.children.length) ctx.pick?.add(pg, resolver);

  // bounds proxies: Box3.setFromObject(landmark root) still spans what was moved out (world-space AABB corners of
  // the removed meshes, in a mesh whose world matrix is the identity)
  const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
  proxyMat.name = 'batch-bounds';
  const box = new THREE.Box3();
  for (const [root, list] of removed) {
    const pts = [];
    for (const o of list) {
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      box.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      if (!box.isEmpty()) pts.push(box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z);
    }
    if (!pts.length) continue;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
    pg.computeBoundingBox(); pg.computeBoundingSphere();
    const proxy = new THREE.Mesh(pg, proxyMat);
    proxy.name = `${root.name || 'root'}:batch-bounds`;
    proxy.visible = false;
    proxy.castShadow = false; proxy.receiveShadow = false;
    proxy.layers.set(31);                                     // never raycast
    proxy.matrixAutoUpdate = false;
    proxy.matrix.copy(root.matrixWorld).invert();             // world matrix = identity
    root.add(proxy);
    proxy.updateMatrixWorld(true);
  }

  // The originals left the scene, but modules may still hold them (kits, caches) — free their vertex data (the batches
  // hold a copy): only geometries nothing in the scene uses any more, and not those a pick resolver may look at.
  const inUse = new Set();
  scene.traverse((o) => { if (o.geometry) inUse.add(o.geometry); });
  for (const b of buckets.values()) for (const s of b.list) if (s.fn && s.mesh?.geometry) inUse.add(s.mesh.geometry);
  let freed = 0;
  for (const o of originals) {
    const g = o.geometry;
    if (!g || inUse.has(g)) continue;
    inUse.add(g);
    for (const k of Object.keys(g.attributes)) { const a = g.attributes[k]; freed += (a.isInterleavedBufferAttribute ? 0 : a.array?.byteLength) || 0; g.deleteAttribute(k); }
    if (g.index) { freed += g.index.array?.byteLength || 0; g.setIndex(null); }
    g.morphAttributes = {};
    g.dispose();
  }
  stats.freedMB = Math.round(freed / 1e5) / 10;

  for (const gr of [group, liteGroup]) {
    gr.matrixAutoUpdate = false;
    gr.userData.staticSubtree = true;                         // (engine: no per-frame world-matrix pass)
    scene.add(gr);
    gr.updateMatrixWorld(true);
  }
  const after = new Set();
  scene.traverse((o) => { if (o.isMesh && o.visible) for (const m of matsOf(o)) if (before.has(m) || m.userData?.staticBatch) after.add(m); });
  stats.materialsAfter = after.size;

  // Source canvases that nothing in the scene uses any more (their pixels live in the arrays now) are released the
  // way their modules release them after an upload (texture.onUpdate) — never uploaded now, they would stay.
  const used = new Set();
  const addU = (u) => { if (u) for (const k in u) { const v = u[k]?.value; if (v?.isTexture) used.add(v); else if (Array.isArray(v)) for (const t of v) if (t?.isTexture) used.add(t); } };
  scene.traverse((o) => {
    for (const m of [...matsOf(o), o.customDepthMaterial, o.customDistanceMaterial]) {
      if (!m) continue;
      for (const k of TEX_SLOTS) if (m[k]) used.add(m[k]);
      addU(m.uniforms);
    }
  });
  let released = 0;
  for (const [m] of mergedOf) {
    for (const t of [m.map, m.normalMap]) {
      if (!t || used.has(t)) continue;
      used.add(t);
      const img = t.image;
      if (typeof t.onUpdate === 'function' && typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) {
        try { t.onUpdate(t); released++; } catch { /* ignore */ }
      }
    }
  }
  stats.releasedCanvases = released;

  if (ctx.params?.has?.('batchcheck')) watchOriginals(originals);
  stats.ms = Math.round(performance.now() - t0);
  return stats;
}

function meshSkip(o, walkables) {
  if (o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh) return 'instanced';
  if (o.children.length) return 'has-children';
  if (o.onBeforeRender !== O3.onBeforeRender || o.onAfterRender !== O3.onAfterRender) return 'render-callback';
  if (o.customDepthMaterial || o.customDistanceMaterial) return 'custom-depth';
  if (o.morphTargetInfluences) return 'morph';
  if (!o.frustumCulled) return 'unculled';
  if (walkables.has(o)) return 'walkable';
  const m = o.material;
  if (!m || Array.isArray(m)) return 'multi-material';
  if (m.visible === false) return 'invisible-material';
  if (m.transparent) return 'transparent';
  if (m.isShaderMaterial || m.isRawShaderMaterial) return 'shader';
  const g = o.geometry;
  if (!g?.attributes?.position || g.attributes.position.itemSize !== 3) return 'geometry';
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return 'morph';
  if (g.attributes.tangent) return 'tangent';
  // materials with shader hooks may work in object space (e.g. the Fence's paint): only identity transforms
  if (hasOwn(m, 'onBeforeCompile') || hasOwn(m, 'customProgramCacheKey')) {
    const e = o.matrixWorld.elements;
    for (let i = 0; i < 16; i++) if (Math.abs(e[i] - (i % 5 === 0 ? 1 : 0)) > 1e-9) return 'shader-hook';
  }
  return null;
}

// ?batchcheck: the removed originals must stay untouched — any module still moving / toggling / re-materialising
// one of them would now change nothing on screen. Checked every 2 s.
function watchOriginals(list) {
  const sig = (o) => [o.visible, o.position.toArray().join(), o.quaternion.toArray().join(), o.scale.toArray().join(), idOf(o.material),
    o.material?.version, idOf(o.geometry), o.castShadow, o.parent ? 1 : 0].join('|');
  const base = list.map((o) => sig(o));
  const warned = new Set();
  setInterval(() => {
    for (let i = 0; i < list.length; i++) {
      if (warned.has(i)) continue;
      if (sig(list[i]) !== base[i]) { warned.add(i); console.warn('[batch] a merged original changed at runtime:', list[i].name || list[i].uuid, sig(list[i]), 'was', base[i]); }
    }
  }, 2000);
}
