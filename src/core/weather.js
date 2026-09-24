// Weather presets (clouds, haze, sun dimming) and the snowfall particle system.
// Snow is a single Points draw: flakes live in a box that wraps around the camera entirely in the vertex shader,
// so there is no per-frame CPU work besides updating three uniforms.
import * as THREE from 'three';

// cover: cloud coverage 0..1 · mie: aerosol scattering (haze) · fog: fog density multiplier ·
// sun: direct sunlight multiplier · snow: snowfall intensity 0..1 · wind: cloud drift (m/s, x/z)
export const WEATHER = {
  clear: { cover: 0.06, mie: 7e-6, fog: 0.8, sun: 1.0, snow: 0, wind: [5, -2] },
  partly: { cover: 0.34, mie: 11e-6, fog: 1.0, sun: 1.0, snow: 0, wind: [7, -3] },
  cloudy: { cover: 0.62, mie: 18e-6, fog: 1.2, sun: 0.7, snow: 0, wind: [9, -4] },
  overcast: { cover: 0.92, mie: 24e-6, fog: 1.5, sun: 0.15, snow: 0, wind: [8, -3] },
  snow: { cover: 0.8, mie: 24e-6, fog: 1.7, sun: 0.25, snow: 1, wind: [4, -1.5] },
};

// What each season looks like unless the user picks a weather explicitly.
export const SEASON_WEATHER = { spring: 'partly', summer: 'partly', autumn: 'partly', winter: 'snow' };

const SNOW_VERT = /* glsl */`
attribute vec4 aSeed;
uniform vec3 uCam;
uniform float uTime;
uniform vec3 uBox;
uniform vec2 uWind;
uniform float uSize;
uniform float uMaxSize;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vec3 p = aSeed.xyz * uBox;
  float t = uTime;
  p.y -= t * (0.75 + aSeed.w * 0.6);                            // fall speed 0.75..1.35 m/s
  p.xz += uWind * t;
  p.x += sin(t * (0.7 + aSeed.w) + aSeed.w * 31.0) * 0.45;      // flutter
  p.z += cos(t * (0.5 + aSeed.y) + aSeed.x * 17.0) * 0.45;
  p = mod(p - uCam + uBox * 0.5, uBox) + uCam - uBox * 0.5;     // wrap around the camera
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  // real flakes are a few mm: small sprites, and the closest ones (which would be big blurry discs) fade out
  gl_PointSize = clamp(uSize * (0.5 + aSeed.w * 1.0) / max(dist, 0.1), 1.3, uMaxSize);
  float edge = 1.0 - smoothstep(uBox.x * 0.32, uBox.x * 0.5, length(p.xz - uCam.xz));
  vAlpha = uOpacity * smoothstep(1.0, 3.0, dist) * edge;
  if (vAlpha < 0.003) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;
const SNOW_FRAG = /* glsl */`
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  // solid core with a soft rim: 1–3 px flakes stay visible, the few larger (close) ones don't turn into bokeh discs
  float a = (1.0 - smoothstep(0.22, 0.5, d)) * 0.85 * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSnow(ctx) {
  const counts = { low: 8000, medium: 17000, high: 30000 };   // small flakes: more of them read as snowfall
  const box = new THREE.Vector3(64, 36, 64);
  let geo = null;
  const uniforms = {
    uCam: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uBox: { value: box },
    uWind: { value: new THREE.Vector2(0.6, -0.25) },
    uSize: { value: 30 },
    uMaxSize: { value: 7 },
    uOpacity: { value: 0 },
    uColor: { value: new THREE.Color(1, 1, 1) },
  };
  const mat = new THREE.ShaderMaterial({
    name: 'snow', uniforms, vertexShader: SNOW_VERT, fragmentShader: SNOW_FRAG,
    transparent: true, depthWrite: false, fog: false,
  });
  const points = new THREE.Points(new THREE.BufferGeometry(), mat);
  points.name = 'snow';
  points.frustumCulled = false;
  points.renderOrder = 900;
  points.visible = false;
  points.raycast = () => {};   // geometry positions are all zero (the shader places the flakes)

  function build(level) {
    const n = counts[level] || counts.medium;
    const seeds = new Float32Array(n * 4);
    let s = 12345;
    const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    for (let i = 0; i < n * 4; i++) seeds[i] = r();
    geo?.dispose();
    geo = new THREE.BufferGeometry();
    // position attribute is required by three for draw count; the shader only uses aSeed
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    points.geometry = geo;
  }
  build(ctx.quality?.level);

  let intensity = 0, target = 0;
  return {
    points,
    uniforms,
    setIntensity(k) { target = k; },
    rebuild(level) { build(level); },
    // brightness: 0..1 scene light level; pixelRatio for point sizes
    update(dt, elapsed, camera, brightness, pixelRatio) {
      intensity += (target - intensity) * Math.min(1, dt * 1.5);
      points.visible = intensity > 0.01;
      if (!points.visible) return;
      uniforms.uTime.value = elapsed;
      uniforms.uCam.value.copy(camera.position);
      uniforms.uOpacity.value = 0.92 * intensity;
      uniforms.uSize.value = 30 * pixelRatio;
      uniforms.uMaxSize.value = 7 * pixelRatio;
      // flakes are lit like the scene but never brighter than the (overcast) sky behind them
      const b = Math.min(0.75, 0.08 + 0.95 * brightness);
      uniforms.uColor.value.setRGB(b, b * 1.01, b * 1.04);
    },
  };
}
