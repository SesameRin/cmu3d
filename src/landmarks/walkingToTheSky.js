// Walking to the Sky — Jonathan Borofsky (CMU alumnus), installed May 2006 on the lawn in front of Warner Hall
// just off Forbes Avenue; a gift of trustee Jill Gansman Kraus and Peter Kraus. A 100-ft (~30 m) stainless-steel
// pole rises out of the lawn at 75° pointing east; seven life-size painted fibreglass figures of different ages
// walk up it while three more stand on the grass looking up. (The pole was re-set in 2009 for structural reasons,
// the figures were taken down for repainting in 2016, and the piece still stands.)
import * as THREE from 'three';
import { meshFigureSteps, figureProxy } from './lib/icons-figures.js';
import { buildKrausCampo } from './lib/icons-kraus.js';
import { PartBucket, registerLandmark, makeCanvas, canvasTexture, rng, FONT_SERIF, mergeCompatible, makeLOD, deferRefine } from './lib/icons-common.js';

const FIG_LOD_FAR = 75;         // sculpted figures within this distance of the group's centre, low-poly beyond
const POLE_LEN = 31.0;          // ~100 ft rise
const POLE_ELEV = THREE.MathUtils.degToRad(75);
const POLE_AZIMUTH = 0;         // radians from +x (east); world z is south
const R_BASE = 0.3, R_TOP = 0.19;

// People on the pole (bottom -> top): distance along the pole of the trailing heel, clothing & build
const CLIMBERS = [
  { s: 3.6, h: 1.8, cols: ['#c99a78', '#2a1d14', '#b3262e', '#2f3e5c', '#e8e8e8'], spec: { shortSleeves: false } },                         // young man, red hoodie & jeans
  { s: 7.4, h: 1.68, cols: ['#e3b99a', '#6b3f22', '#50545c', '#50545c', '#1b1b1b', '#7a1f2b'], spec: { female: true, skirt: true, bag: 'R', longHair: true, jacket: true } }, // businesswoman
  { s: 11.2, h: 1.76, cols: ['#8a5a3c', '#1a1410', '#e7e2d4', '#3a3f45', '#4a2c1a', '#6b1d1d'], spec: { tie: true, jacket: false } },             // man in shirt & tie
  { s: 14.6, h: 1.12, cols: ['#f0c7a6', '#c28a45', '#ef6fa6', '#ef6fa6', '#f4f4f4'], spec: { child: true, dress: true, longHair: true, female: true } }, // little girl
  { s: 17.8, h: 1.78, cols: ['#d6a785', '#b9b4ad', '#7a5236', '#c9b38a', '#3a2718'], spec: { jacket: true, build: 1.08 } },                        // older man, brown jacket
  { s: 21.4, h: 1.66, cols: ['#b37a55', '#141010', '#2f7d57', '#161616', '#8d2b2b'], spec: { female: true, longHair: true } },                  // woman, green top
  { s: 25.0, h: 1.8, cols: ['#e8bf9e', '#3b2a1d', '#f2f2f2', '#3f5f8f', '#c8c8c8'], spec: { shortSleeves: true } },                          // student, white tee & jeans
];

// People on the ground, looking up (dad holding the child's hand, a woman shading her eyes)
const WATCHERS = [
  { key: 'woman', off: [-3.2, -1.4], h: 1.66, cols: ['#e9c2a2', '#8b4a24', '#d9692b', '#2a2a2a', '#2a2a2a'], spec: { female: true, longHair: true } },
  { key: 'dad', off: [-3.6, 1.3], h: 1.8, cols: ['#c48e6a', '#221810', '#3f6fa8', '#6b6f75', '#3a2a1c'], spec: {} },
  { key: 'kid', off: [-3.25, 1.95], h: 1.15, cols: ['#c48e6a', '#221810', '#f2c230', '#b83232', '#f5f5f5'], spec: { child: true, shorts: true, shortSleeves: true } },
];

// colour slots: skin, hair, top, bottom, shoes, accent (tie/bag), sleeve
const palette = (cols) => [cols[0], cols[1], cols[2], cols[3], cols[4], cols[5] || '#7a1f2b', cols[2]];

function brushedTexture(renderer) {
  const c = makeCanvas(64, 512), g = c.getContext('2d');
  const r = rng(42);
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, 64, 512);
  for (let i = 0; i < 700; i++) {
    const v = 120 + (r() * 90) | 0;
    g.fillStyle = `rgba(${v},${v},${v},0.35)`;
    g.fillRect(r() * 64, r() * 512, 1, 20 + r() * 160);
  }
  const t = canvasTexture(c, { srgb: false, renderer });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 6);
  return t;
}

function plaqueTexture(renderer) {
  const c = makeCanvas(512, 256), g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 512, 256);
  grd.addColorStop(0, '#6d5334'); grd.addColorStop(1, '#4b3822');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#c9a86a'; g.lineWidth = 8; g.strokeRect(12, 12, 488, 232);
  g.fillStyle = '#e6cf98'; g.textAlign = 'center';
  g.font = `600 48px ${FONT_SERIF}`; g.fillText('Walking to the Sky', 256, 92);
  g.font = `400 30px ${FONT_SERIF}`; g.fillText('Jonathan Borofsky, 2006', 256, 146);
  g.font = `italic 400 24px ${FONT_SERIF}`; g.fillText('Gift of Jill Gansman Kraus & Peter Kraus', 256, 196);
  return canvasTexture(c, { renderer });
}

async function buildSky(ctx, def) {
  const poi = ctx.data.pois.find((p) => p.name === 'Walking to the Sky');
  const bx = poi ? poi.x : 9.49, bz = poi ? poi.z : -126.62;
  const by = ctx.heightAt(bx, bz);
  const root = new THREE.Group();
  root.name = 'landmark:walkingToTheSky';

  // pole frame: dir = along the pole, up = the pole's upper surface normal
  const horiz = new THREE.Vector3(Math.cos(POLE_AZIMUTH), 0, -Math.sin(POLE_AZIMUTH));
  const dir = horiz.clone().multiplyScalar(Math.cos(POLE_ELEV)).add(new THREE.Vector3(0, Math.sin(POLE_ELEV), 0));
  const nUp = horiz.clone().multiplyScalar(-Math.sin(POLE_ELEV)).add(new THREE.Vector3(0, Math.cos(POLE_ELEV), 0));
  const base = new THREE.Vector3(bx, by, bz);
  const radiusAt = (s) => R_BASE + (R_TOP - R_BASE) * (s / POLE_LEN);

  const bucket = new PartBucket();

  // ---- stainless-steel pole (sunk 1.2 m into the ground), rounded tip
  const steel = new THREE.MeshStandardMaterial({ color: '#d4d8dc', metalness: 1, roughness: 0.22, roughnessMap: brushedTexture(ctx.renderer), envMapIntensity: 1.2 });
  steel.name = 'sky-steel';
  const sink = 1.2;
  const pole = new THREE.CylinderGeometry(R_TOP, R_BASE + (R_BASE - R_TOP) * (sink / POLE_LEN), POLE_LEN + sink, 40, 12, true);
  pole.translate(0, (POLE_LEN + sink) / 2 - sink, 0);
  const tip = new THREE.SphereGeometry(R_TOP, 40, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  tip.scale(1, 0.55, 1); tip.translate(0, POLE_LEN, 0);
  const poleMat = new THREE.Matrix4().compose(base, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir), new THREE.Vector3(1, 1, 1));
  bucket.add(steel, pole, poleMat);
  bucket.add(steel, tip, poleMat);

  // ---- footing: a low granite ring flush with the lawn, steel collar where the pole enters
  const granite = ctx.materials?.get ? ctx.materials.get('granite') : new THREE.MeshStandardMaterial({ color: '#8f8b85' });
  const pad = new THREE.CylinderGeometry(1.25, 1.3, 0.5, 40);
  pad.translate(bx, by - 0.2, bz);
  bucket.add(granite, ctx.materials?.applyWorldUV ? ctx.materials.applyWorldUV(pad) : pad);
  const collar = new THREE.CylinderGeometry(R_BASE + 0.07, R_BASE + 0.1, 0.5, 40, 1, true);
  collar.translate(0, 0.0, 0);
  bucket.add(steel, collar, poleMat);

  // ---- plaque on a low stone block next to the footing (facing the path to the west)
  const plaqueTex = plaqueTexture(ctx.renderer);
  const bronzePlate = new THREE.MeshStandardMaterial({ map: plaqueTex, metalness: 0.6, roughness: 0.45 });
  bronzePlate.name = 'sky-plaque';
  const px = bx - 2.1, pz = bz + 1.7, py = ctx.heightAt(px, pz);
  const plaqueYaw = Math.atan2(-1, 0.35);           // block faces west-south-west, toward the footpath
  const block = new THREE.BoxGeometry(0.9, 0.5, 0.42);
  block.translate(0, 0.2, 0);
  const blockM = new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), plaqueYaw), new THREE.Vector3(1, 1, 1));
  bucket.add(granite, ctx.materials?.applyWorldUV ? ctx.materials.applyWorldUV(block, blockM) : block, blockM);
  const plate = new THREE.PlaneGeometry(0.72, 0.34);
  plate.translate(0, 0.24, 0.213);
  const plateMesh = new THREE.Mesh(plate, bronzePlate);
  plateMesh.applyMatrix4(blockM);
  plateMesh.castShadow = false; plateMesh.receiveShadow = true;
  root.add(plateMesh);

  // ---- figures (painted fibreglass): one merged mesh with vertex colours.
  // Loading only poses them and builds a low-poly stand-in; the sculpted (SDF) figures are meshed later in idle
  // time (or immediately when the camera comes near) and replace it within FIG_LOD_FAR metres.
  const figMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.0 });
  figMat.name = 'sky-figures';
  const q = ctx.quality?.level;
  const voxClimb = { low: 0.06, medium: 0.05 }[q] || 0.045, voxGround = { low: 0.04, medium: 0.034 }[q] || 0.03;
  const figJobs = [];                     // [spec, palette, { voxel, scale, matrix }]
  const r = rng(2006);
  // local frame shared by all climbers: +z = pole azimuth (forward), +y = world up
  const yaw = Math.atan2(horiz.x, horiz.z); // rotation so local +z maps onto horiz
  const dLocal = new THREE.Vector3(0, Math.sin(POLE_ELEV), Math.cos(POLE_ELEV));
  const nLocal = new THREE.Vector3(0, Math.cos(POLE_ELEV), -Math.sin(POLE_ELEV));
  for (let i = 0; i < CLIMBERS.length; i++) {
    const c = CLIMBERS[i];
    const scale = c.h / 1.75;
    const lead = i % 2 ? 'L' : 'R';
    const trail = lead === 'L' ? 'R' : 'L';
    const sideX = (s) => (s === 'L' ? 0.075 : -0.075);
    // (adult units, origin = trailing heel on the pole's top line)
    const stride = 0.52;
    const heelT = [sideX(trail), 0, 0];
    const heelL = dLocal.clone().multiplyScalar(stride).add(new THREE.Vector3(sideX(lead), 0, 0));
    const up = [nLocal.x, nLocal.y, nLocal.z], fd = [dLocal.x, dLocal.y, dLocal.z];
    const lsign = lead === 'L' ? 1 : -1;
    const spec = {
      ...c.spec,
      pelvis: [0, 0.94, -0.19],
      lean: 0.14 + r() * 0.06,
      headPitch: -0.3 - r() * 0.2,
      headYaw: (r() - 0.5) * 0.3,
      feet: { [trail]: { heel: heelT, dir: fd, up }, [lead]: { heel: [heelL.x, heelL.y, heelL.z], dir: fd, up } },
      // arms swing opposite the legs: the arm on the trailing-leg side reaches forward
      hands: {
        [trail]: [lsign * -0.2, 1.04 + r() * 0.06, 0.16],
        [lead]: [lsign * 0.22, 0.86, -0.42],
      },
    };
    if (c.spec.bag) spec.hands[c.spec.bag] = [c.spec.bag === 'L' ? 0.24 : -0.24, 0.8, -0.2];
    // world placement: trailing heel sits on the pole's upper surface line
    const s = c.s;
    const contact = base.clone().addScaledVector(dir, s).addScaledVector(nUp, radiusAt(s) - 0.01);
    const m = new THREE.Matrix4().compose(contact, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1));
    figJobs.push([spec, palette(c.cols), { voxel: voxClimb / scale, scale, matrix: m }]);
  }

  // watchers on the lawn: face the upper pole, heads tipped back
  const lookAt = base.clone().addScaledVector(dir, 14);
  const colliderCircles = [];
  const wpos = {};
  for (const wch of WATCHERS) wpos[wch.key] = [bx + wch.off[0], bz + wch.off[1]];
  {
    // the kid stands at dad's right side, close enough to hold hands
    const [dx0, dz0] = wpos.dad;
    const yawD = Math.atan2(lookAt.x - dx0, lookAt.z - dz0);
    const rightX = -Math.cos(yawD), rightZ = Math.sin(yawD);      // local -x in world
    wpos.kid = [dx0 + rightX * 0.54 + Math.sin(yawD) * 0.04, dz0 + rightZ * 0.54 + Math.cos(yawD) * 0.04];
  }
  for (const wch of WATCHERS) {
    const [wx, wz] = wpos[wch.key];
    const wy = ctx.heightAt(wx, wz);
    const scale = wch.h / 1.75;
    const fyaw = wch.key === 'kid' ? Math.atan2(lookAt.x - wpos.dad[0], lookAt.z - wpos.dad[1]) : Math.atan2(lookAt.x - wx, lookAt.z - wz);
    // head pitch needed to see the middle of the pole
    const horizDist = Math.hypot(lookAt.x - wx, lookAt.z - wz);
    const pitch = -Math.min(0.75, Math.atan2(lookAt.y - (wy + wch.h * 0.93), horizDist) * 0.55);
    const spec = { ...wch.spec, pelvis: [0, 0.93, -0.01], lean: -0.1, headPitch: pitch, headYaw: 0 };
    if (wch.key === 'woman') {
      spec.hands = { R: [-0.12, 1.78, 0.42], L: [0.2, 0.95, -0.02] }; // pointing up at the climbers
    } else if (wch.key === 'dad') {
      spec.hands = { R: [-0.27, 0.8, 0.05], L: [0.23, 0.84, 0.05] };   // right hand holds the kid's hand
      spec.headYaw = 0.05;
    } else if (wch.key === 'kid') {
      spec.hands = { L: [0.37, 1.22, 0.06], R: [-0.3, 1.78, 0.2] };   // left up to dad's hand, right waving
    }
    const m = new THREE.Matrix4().compose(new THREE.Vector3(wx, wy, wz), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), fyaw), new THREE.Vector3(1, 1, 1));
    figJobs.push([spec, palette(wch.cols), { voxel: voxGround / scale, scale, matrix: m }]);
    colliderCircles.push([wx, wz, wch.h > 1.3 ? 0.3 : 0.22, wy, wy + wch.h]);
  }

  root.add(bucket.build({ name: 'walkingToTheSky' }));

  // figure LOD, centred on the middle of the group (geometry is in world space, so levels are offset back)
  const lodAt = base.clone().addScaledVector(dir, 11);
  const proxyGeo = mergeCompatible(figJobs.map(([spec, pal, o]) => figureProxy(spec, pal, o)));
  const figProxy = new THREE.Mesh(proxyGeo, figMat);
  const figLod = makeLOD(figProxy, FIG_LOD_FAR);
  figLod.name = 'walkingToTheSky:figures';
  figLod.position.copy(lodAt);
  const placeLevel = (mesh) => {
    mesh.position.copy(lodAt).negate();
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = `walkingToTheSky:${mesh === figProxy ? 'figures-proxy' : 'sky-figures'}`;
    return mesh;
  };
  placeLevel(figProxy);
  root.add(figLod);
  deferRefine(ctx, {
    name: 'walkingToTheSky-figures',
    anchor: [lodAt.x, lodAt.y, lodAt.z],
    near: FIG_LOD_FAR + 60,
    *steps() {
      const geos = [];
      for (const [spec, pal, o] of figJobs) { geos.push(yield* meshFigureSteps(spec, pal, o)); yield; }
      return mergeCompatible(geos);
    },
    apply(geo) { if (geo) figLod.setFine(placeLevel(new THREE.Mesh(geo, figMat))); },
  });

  // ---- colliders, pick, label
  const lean1m = dir.clone().multiplyScalar(1.7 / Math.sin(POLE_ELEV));
  ctx.colliders?.addCircle(bx + lean1m.x * 0.5, bz + lean1m.z * 0.5, R_BASE + 0.3, by - 1, by + 3, 'walkingToTheSky');
  ctx.colliders?.addCircle(bx, bz, 1.3, by - 1, by + 0.25, 'walkingToTheSky-pad');
  for (const [x, z, rr, y0, y1] of colliderCircles) ctx.colliders?.addCircle(x, z, rr, y0 - 0.5, y1, 'walkingToTheSky-figure');
  ctx.colliders?.addBox(px, pz, 0.47, 0.23, plaqueYaw, py - 0.5, py + 0.5, 'walkingToTheSky-plaque');
  const top = base.clone().addScaledVector(dir, POLE_LEN);
  const mid = base.clone().addScaledVector(dir, POLE_LEN * 0.5);
  registerLandmark(ctx, def, root, { position: [mid.x, mid.y, mid.z], radius: POLE_LEN * 0.55, labelY: (top.y - mid.y) * 0.35, priority: 9 });
  return root;
}

const SKY_DEF = {
  key: 'walkingToTheSky',
  name: 'Walking to the Sky',
  nameZh: '走向天空',
  osmIds: [],
  build(ctx) { return buildSky(ctx, SKY_DEF); },
};

// Kraus Campo, the Bochner / Van Valkenburgh sculpture garden — also a Kraus family gift (see lib/icons-kraus.js)
const KRAUS_DEF = {
  key: 'krausCampo',
  name: 'Kraus Campo',
  nameZh: 'Kraus Campo 花园',
  osmIds: [],
  build(ctx) { return buildKrausCampo(ctx, KRAUS_DEF); },
};

export default [SKY_DEF, KRAUS_DEF];
