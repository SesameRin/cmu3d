// Minimal stand-alone test harness so each module can be rendered in isolation.
// Usage (in a scratch entry file):
//   import { createHarness } from '<root>/src/dev/harness.js';
//   const ctx = await createHarness();            // renderer, scene, camera, lights, simple terrain, materials
//   await createMyModule(ctx);
//   ctx.harness.ready();                           // tells tools/shot.mjs it can screenshot
// Camera can be set from the URL: ?cam=x,y,z&look=x,y,z  or  window.__setView([x,y,z],[x,y,z])
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createContext } from '../core/context.js';
import { createMaterials } from '../core/materials.js';

export async function createHarness({ terrain = true, materials = true, hours = 14, shadows = true } = {}) {
  const ctx = createContext({ data: window.CAMPUS_DATA, info: window.CAMPUS_INFO });
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block';
  document.body.style.margin = '0';
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#a9c8e8');
  scene.fog = new THREE.Fog('#bcd3ea', 900, 3000);
  const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.5, 8000);
  camera.position.set(-150, 220, 420);

  const hemi = new THREE.HemisphereLight('#dfeaff', '#6b6150', 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff4e0', 2.6);
  sun.position.set(-300, 500, 250);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = shadows;
  sun.shadow.mapSize.set(4096, 4096);
  const sc = sun.shadow.camera;
  sc.left = -600; sc.right = 600; sc.top = 600; sc.bottom = -600; sc.near = 10; sc.far = 2000;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  // Simple PMREM environment so metals/glass reflect something
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {},
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'varying vec3 vP; void main(){ float h = normalize(vP).y; vec3 c = mix(vec3(0.55,0.5,0.45), vec3(0.62,0.76,0.92), smoothstep(-0.05,0.1,h)); c = mix(c, vec3(0.35,0.55,0.85), smoothstep(0.1,0.8,h)); gl_FragColor = vec4(c,1.); }',
  }));
  envScene.add(sky);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;

  ctx.renderer = renderer; ctx.scene = scene; ctx.camera = camera; ctx.canvas = canvas;
  ctx.env = { sun, hemi, state: { hours, nightFactor: 0, sunDir: sun.position.clone().normalize() }, setTime() {} };
  if (materials) ctx.materials = createMaterials(ctx);

  if (terrain) {
    const hf = ctx.heightfield;
    const geo = new THREE.PlaneGeometry((hf.width - 1) * hf.cellSize, (hf.height - 1) * hf.cellSize, hf.width - 1, hf.height - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const cx = hf.minX + ((hf.width - 1) * hf.cellSize) / 2, cz = hf.minZ + ((hf.height - 1) * hf.cellSize) / 2;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
      pos.setXYZ(i, x, hf.heightAt(x, z), z);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#6f8f4e', roughness: 1 }));
    mesh.receiveShadow = true;
    mesh.name = 'harness-terrain';
    scene.add(mesh);
    ctx.terrain = { mesh, heightAt: hf.heightAt, normalAt: hf.normalAt };
  }

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(-100, 45, 60);
  controls.update();

  function view(cam, look) {
    camera.position.set(...cam);
    controls.target.set(...look);
    camera.lookAt(...look);
    controls.update();
  }
  const params = new URLSearchParams(location.search);
  const p = (s) => s.split(',').map(Number);
  if (params.get('cam') && params.get('look')) view(p(params.get('cam')), p(params.get('look')));

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight, false);
  });

  const clock = new THREE.Clock();
  let elapsed = 0;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    elapsed += dt;
    controls.update();
    ctx.tick(dt, elapsed);
    renderer.render(scene, camera);
  });

  window.__ctx = ctx;
  window.__setView = (cam, look) => { view(cam, look); renderer.render(scene, camera); };
  ctx.harness = {
    controls, view,
    ready() {
      let frames = 0;
      const unsub = ctx.onUpdate(() => { if (++frames > 5) { window.__READY = true; unsub(); } });
    },
  };
  return ctx;
}
