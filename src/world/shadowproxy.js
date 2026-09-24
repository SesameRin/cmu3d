// Shadow proxies: the static shadow casters of the landmarks, the generic buildings' base chunks and a few static
// structures, merged into a handful of position-only meshes per ~500 m cell, drawn ONLY into the shadow maps.
//
// Every shadow-map refresh (env re-renders the main cascade up to 30 times a second while the camera moves) drew
// each caster separately — ~500 draw calls at the opening view: 350 landmark parts, 170 building chunks — which made every other
// frame several milliseconds longer. The depth pass needs nothing but positions (three's depth material ignores the
// casters' own materials unless they alpha-test), so the casters of a cell are merged (world space) into one mesh
// per shadow side. The proxy group is hidden, except while the renderer draws the shadow maps (its shadowMap.render
// is wrapped); the originals keep drawing in the colour pass with castShadow off. The shadows stay exactly the same.
// (three tests layers against the main camera in the shadow pass too, so a shadow-only layer would not work.)
// Not merged (they keep casting themselves): instanced / skinned meshes, alpha-tested or displaced materials,
// custom depth materials, multi-material meshes, anything inside a THREE.LOD, anything hidden right now (distance-
// or season-toggled parts) and anything flagged userData.noShadowProxy or userData.dynamic (on the object or an
// ancestor; staticbatch.js probeDynamic flags what it sees changing by day / night).
import * as THREE from 'three';

const CELL = 500;
const FLIP = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };

function qualifies(o) {
  if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh || !o.castShadow) return false;
  if (o.customDepthMaterial || o.morphTargetInfluences) return false;
  const g = o.geometry, m = o.material;
  if (!g?.attributes?.position || Array.isArray(m) || !m || m.visible === false) return false;
  if (g.morphAttributes && Object.keys(g.morphAttributes).length) return false;
  if (m.alphaTest > 0 || m.alphaMap || m.alphaToCoverage || m.displacementMap || m.clippingPlanes?.length) return false;
  if (g.groups?.length > 1) return false;
  return true;
}

export function buildShadowProxies(ctx, roots) {
  const env = ctx.env, scene = ctx.scene;
  const lights = [env?.sun, env?.sunNear].filter((l) => l?.shadow?.camera);
  if (!scene || !lights.length || !lights[0].castShadow) return null;
  scene.updateMatrixWorld(true);
  const buckets = new Map();
  let sources = 0;
  const _v = new THREE.Vector3(), _c = new THREE.Vector3();
  const walk = (o, ok) => {
    ok = ok && o.visible && !o.isLOD && !o.userData?.noShadowProxy && !o.userData?.dynamic;
    if (!ok) return;
    if (qualifies(o)) {
      const g = o.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      _c.copy(g.boundingSphere.center).applyMatrix4(o.matrixWorld);
      const side = o.material.shadowSide ?? FLIP[o.material.side] ?? THREE.BackSide;
      const key = `${side}|${Math.floor(_c.x / CELL)},${Math.floor(_c.z / CELL)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { side, list: [], verts: 0, idx: 0 }));
      const n = g.attributes.position.count;
      const dr = g.drawRange;
      const ic = g.index ? Math.min(g.index.count, dr.count === Infinity ? g.index.count : dr.count) : Math.min(n, dr.count === Infinity ? n : dr.count);
      b.list.push(o); b.verts += n; b.idx += ic;
      sources++;
    }
    for (const c of o.children) walk(c, ok);
  };
  for (const r of roots) if (r) walk(r, true);

  const group = new THREE.Group();
  group.name = 'shadow-proxies';
  group.matrixAutoUpdate = false;
  let tris = 0;
  for (const b of buckets.values()) {
    if (b.list.length < 2) continue; // nothing to gain
    const pos = new Float32Array(b.verts * 3);
    const index = new Uint32Array(b.idx);
    let vo = 0, io = 0;
    for (const o of b.list) {
      const g = o.geometry, p = g.attributes.position, n = p.count, e = o.matrixWorld.elements;
      for (let i = 0; i < n; i++) {
        _v.fromBufferAttribute(p, i);
        const x = _v.x, y = _v.y, z = _v.z;
        const k = (vo + i) * 3;
        pos[k] = e[0] * x + e[4] * y + e[8] * z + e[12];
        pos[k + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        pos[k + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      const dr = g.drawRange;
      if (g.index) {
        const src = g.index.array, s0 = dr.start, cnt = Math.min(g.index.count - s0, dr.count === Infinity ? g.index.count : dr.count);
        for (let i = 0; i < cnt; i++) index[io++] = src[s0 + i] + vo;
      } else {
        const s0 = dr.start, cnt = Math.min(n - s0, dr.count === Infinity ? n : dr.count);
        for (let i = 0; i < cnt; i++) index[io++] = s0 + i + vo;
      }
      vo += n;
      o.castShadow = false;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(io === index.length ? index : index.subarray(0, io), 1));
    geo.computeBoundingSphere();
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    mat.shadowSide = b.side;
    mat.name = 'shadow-proxy';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'shadow-proxy';
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    tris += io / 3;
  }
  group.visible = false;
  scene.add(group);
  // visible only inside the shadow pass (the colour pass, post passes and the water reflection never see it)
  const sm = ctx.renderer?.shadowMap;
  if (sm && typeof sm.render === 'function' && group.children.length) {
    const render = sm.render;
    sm.render = function (...args) {
      group.visible = true;
      try { return render.apply(this, args); } finally { group.visible = false; }
    };
  }
  const stats = { sources, proxies: group.children.length, triangles: Math.round(tris) };
  return { group, stats };
}
