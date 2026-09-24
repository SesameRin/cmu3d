// Sky rendering for CMU 3D: physically-based single-scattering atmosphere (Nishita-style, evaluated per pixel),
// a procedural drifting cloud layer, stars that rotate with sidereal time, a moon disc and a Milky Way band.
//
// The same atmosphere model exists twice: in GLSL (for the sky dome) and in JS (so env.js can derive the sun light
// colour, the hemisphere/fog colours and the horizon haze from exactly the same numbers the sky shows).
//
// Everything is drawn "at infinity": vertex shaders rotate a unit sphere by the camera's rotation only and output
// clip.xyww, so the sky sits on the far plane, never clips, and is drawn after opaque geometry (early-z skips the
// expensive atmosphere shader wherever buildings/terrain cover the screen).
import * as THREE from 'three';

// ------------------------------------------------------------------------------------------------ atmosphere (JS)
export const ATMO = {
  RE: 6360e3,                                   // planet radius (m)
  RA: 6420e3,                                   // atmosphere top (m)
  BETA_R: [5.8e-6, 13.5e-6, 33.1e-6],           // Rayleigh scattering at sea level (1/m)
  BETA_O: [0.65e-6, 1.881e-6, 0.085e-6],        // ozone absorption at peak density (1/m) — blue twilight zenith
  BETA_M: 14e-6,                                // Mie scattering (1/m); env.js changes it with the weather (haze)
  HR: 7994,                                     // Rayleigh scale height
  HM: 1200,                                     // Mie scale height
  VIEW_H: 300,                                  // viewer altitude used for sky evaluation (m)
  VIEW_SAMPLES: 16,
  LIGHT_SAMPLES: 8,
};

// Ozone layer: tent profile peaking at 25 km
const ozone = (h) => Math.max(0, 1 - Math.abs(h - 25000) / 15000);

function raySphere(ox, oy, oz, dx, dy, dz, r) {
  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const d = b * b - c;
  if (d < 0) return null;
  const s = Math.sqrt(d);
  return [-b - s, -b + s];
}

// Transmittance from a point at altitude h (m) towards direction d (unit [x,y,z]) out of the atmosphere.
// Returns [r,g,b] (0 when the direction is blocked by the planet).
export function transmittance(d, h = ATMO.VIEW_H, out = [0, 0, 0]) {
  const { RE, RA, BETA_R, BETA_M, BETA_O, HR, HM } = ATMO;
  const oy = RE + h;
  const g = raySphere(0, oy, 0, d[0], d[1], d[2], RE);
  // Allow the sun slightly below the geometric horizon (refraction / sun disc radius) to keep a smooth fade.
  if (g && g[0] > 0 && d[1] < -0.02) { out[0] = out[1] = out[2] = 0; return out; }
  const t = raySphere(0, oy, 0, d[0], Math.max(d[1], -0.01), d[2], RA);
  const n = 32, ds = t[1] / n;
  let odR = 0, odM = 0, odO = 0;
  for (let i = 0; i < n; i++) {
    const s = ds * (i + 0.5);
    const px = d[0] * s, py = oy + Math.max(d[1], -0.01) * s, pz = d[2] * s;
    const hh = Math.max(0, Math.sqrt(px * px + py * py + pz * pz) - RE);
    odR += Math.exp(-hh / HR) * ds; odM += Math.exp(-hh / HM) * ds; odO += ozone(hh) * ds;
  }
  for (let k = 0; k < 3; k++) out[k] = Math.exp(-(BETA_R[k] * odR + BETA_M * 1.1 * odM + BETA_O[k] * odO));
  return out;
}

// Single-scattered sky radiance in direction d for light direction l (both unit arrays), light intensity I.
// Mirror of scatter() in SKY_GLSL. Directions below the horizon are evaluated at the horizon.
export function scatter(d, l, I, g = 0.76, out = [0, 0, 0]) {
  const { RE, RA, BETA_R, BETA_M, BETA_O, HR, HM, VIEW_H, VIEW_SAMPLES: N, LIGHT_SAMPLES: M } = ATMO;
  let dx = d[0], dy = Math.max(d[1], 0.0), dz = d[2];
  const dl = Math.hypot(dx, dy, dz); dx /= dl; dy /= dl; dz /= dl;
  const oy = RE + VIEW_H;
  const tA = raySphere(0, oy, 0, dx, dy, dz, RA);
  const tMax = tA[1];
  const ds = tMax / N;
  const mu = dx * l[0] + dy * l[1] + dz * l[2];
  const phaseR = 3 / (16 * Math.PI) * (1 + mu * mu);
  const g2 = g * g;
  const phaseM = 3 / (8 * Math.PI) * ((1 - g2) * (1 + mu * mu)) / ((2 + g2) * Math.pow(1 + g2 - 2 * g * mu, 1.5));
  let sR0 = 0, sR1 = 0, sR2 = 0, sM0 = 0, sM1 = 0, sM2 = 0, odR = 0, odM = 0, odO = 0;
  for (let i = 0; i < N; i++) {
    const s = ds * (i + 0.5);
    const px = dx * s, py = oy + dy * s, pz = dz * s;
    const h = Math.sqrt(px * px + py * py + pz * pz) - RE;
    const hr = Math.exp(-h / HR) * ds, hm = Math.exp(-h / HM) * ds;
    odR += hr; odM += hm; odO += ozone(h) * ds;
    const e = raySphere(px, py, pz, l[0], l[1], l[2], RE);
    if (e && e[0] > 0) continue; // planet shadow
    const tl = raySphere(px, py, pz, l[0], l[1], l[2], RA);
    const dsl = tl[1] / M;
    let odRl = 0, odMl = 0, odOl = 0;
    for (let j = 0; j < M; j++) {
      const sl = dsl * (j + 0.5);
      const qx = px + l[0] * sl, qy = py + l[1] * sl, qz = pz + l[2] * sl;
      const hl = Math.sqrt(qx * qx + qy * qy + qz * qz) - RE;
      odRl += Math.exp(-hl / HR) * dsl; odMl += Math.exp(-hl / HM) * dsl; odOl += ozone(hl) * dsl;
    }
    const tm = BETA_M * 1.1 * (odM + odMl), to = odO + odOl, tr = odR + odRl;
    const a0 = Math.exp(-(BETA_R[0] * tr + tm + BETA_O[0] * to));
    const a1 = Math.exp(-(BETA_R[1] * tr + tm + BETA_O[1] * to));
    const a2 = Math.exp(-(BETA_R[2] * tr + tm + BETA_O[2] * to));
    sR0 += a0 * hr; sR1 += a1 * hr; sR2 += a2 * hr;
    sM0 += a0 * hm; sM1 += a1 * hm; sM2 += a2 * hm;
  }
  out[0] = I * (sR0 * BETA_R[0] * phaseR + sM0 * BETA_M * phaseM);
  out[1] = I * (sR1 * BETA_R[1] * phaseR + sM1 * BETA_M * phaseM);
  out[2] = I * (sR2 * BETA_R[2] * phaseR + sM2 * BETA_M * phaseM);
  return out;
}

// JS port of three.js' ACESFilmicToneMapping (linear in → linear display-referred out, before sRGB OETF).
export function acesFilmic(c, exposure = 1, out = [0, 0, 0]) {
  const k = exposure / 0.6;
  const r = c[0] * k, g = c[1] * k, b = c[2] * k;
  // ACESInputMat (columns as in the GLSL source)
  const ir = 0.59719 * r + 0.35458 * g + 0.04823 * b;
  const ig = 0.07600 * r + 0.90834 * g + 0.01566 * b;
  const ib = 0.02840 * r + 0.13383 * g + 0.83777 * b;
  const f = (v) => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
  const fr = f(ir), fg = f(ig), fb = f(ib);
  out[0] = Math.min(1, Math.max(0, 1.60475 * fr - 0.53108 * fg - 0.07367 * fb));
  out[1] = Math.min(1, Math.max(0, -0.10208 * fr + 1.10813 * fg - 0.00605 * fb));
  out[2] = Math.min(1, Math.max(0, -0.00327 * fr - 0.07276 * fg + 1.07602 * fb));
  return out;
}

// Night sky radiance (JS mirror of nightSky() in GLSL, without moon glow / Milky Way).
// zen/hor are the (possibly blue-hour boosted) colours currently in the shader uniforms.
export function nightSkyJS(d, cityGlow, zen = NIGHT.zenith, hor = NIGHT.horizon, out = [0, 0, 0]) {
  const h = Math.max(d[1], 0);
  const t = Math.sqrt(h);
  const cg = NIGHT.city;
  const glow = Math.exp(-h * 9) * cityGlow;
  for (let k = 0; k < 3; k++) out[k] = hor[k] + (zen[k] - hor[k]) * t + cg[k] * glow;
  return out;
}
export const NIGHT = {
  zenith: [0.0045, 0.0085, 0.024],
  horizon: [0.0150, 0.0225, 0.043],
  city: [0.026, 0.015, 0.006],   // Pittsburgh light pollution: warm glow low on the horizon
  blueZenith: [0.004, 0.013, 0.046], // blue-hour boost (sun −5°…−12°), where single scattering has faded
  blueHorizon: [0.014, 0.022, 0.05],
};

// ------------------------------------------------------------------------------------------------ GLSL
const GLSL_NOISE = /* glsl */`
float skyHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float skyNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = skyHash12(i), b = skyHash12(i + vec2(1.0, 0.0));
  float c = skyHash12(i + vec2(0.0, 1.0)), d = skyHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// fbm whose finest octaves fade out with 'lod' (0 = full detail, 1 = only the coarse octaves) to avoid shimmer
float skyFbm(vec2 p, float lod) {
  float s = 0.0, a = 0.5, n = 0.0;
  mat2 R = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 6; i++) {
    float w = clamp(5.2 - float(i) - lod * 4.0, 0.0, 1.0);
    s += a * w * skyNoise(p); n += a * w;
    p = R * p + vec2(3.1, 1.7);
    a *= 0.5;
  }
  return s / max(n, 1e-3);
}
`;

// Cloud layer shared by the sky dome, the stars and the moon (so they are hidden behind clouds).
const GLSL_CLOUDS = /* glsl */`
uniform float uCloudCover;     // 0..1 coverage
uniform float uCloudHeight;    // layer altitude (m)
uniform vec2 uCloudOffset;     // wind drift (m)
uniform vec3 uCloudLightDir;   // sun (day) or moon (night)
uniform vec3 uCloudSun;        // direct light colour on the clouds (HDR)
uniform vec3 uCloudAmb;        // ambient/sky light on the clouds (HDR)

// Raw cloud field (≈0..1, mean 0.5): fbm shapes clustered by a large-scale noise.
// Mirrored (without the billow term) by cmuCloudShade() in env.js — keep both in sync.
float cloudField(vec2 wp, float lod) {
  vec2 p = wp * (1.0 / 1700.0);
  // domain warp → organic, non-blobby outlines. Kept small: a large low-frequency warp curls the field into hooks
  // and spirals; a second, finer warp breaks up the edges instead.
  p += (vec2(skyNoise(p * 0.6 + 3.7), skyNoise(p * 0.6 + 11.1)) - 0.5) * 0.35;
  p += (vec2(skyNoise(p * 2.3 + 5.2), skyNoise(p * 2.3 + 17.9)) - 0.5) * 0.12;
  float base = skyFbm(p, lod);
  float big = skyNoise(p * 0.17 + 7.3);
  // billowy (cauliflower) detail that erodes the edges, faded out with distance
  float b = abs(skyNoise(p * 6.3 + 1.3) * 2.0 - 1.0);
  return base * 0.74 + big * 0.26 - (1.0 - b) * 0.045 * (1.0 - lod);
}
// coverage → threshold on the field's distribution
float cloudThreshold() { return 0.5 + (0.5 - uCloudCover) * 0.42; }
// Overcast / snow: a continuous stratus deck under the cumulus field, so the last gaps don't read as thin blue veins
float cloudDeck() { return smoothstep(0.62, 0.86, uCloudCover) * 0.97; }
// Ray-plane hit with the cloud layer. Returns (world xz, distance). dist < 0 when looking away.
vec3 cloudHit(vec3 dir, vec3 camPos) {
  float h = uCloudHeight - camPos.y;
  if (dir.y < 0.015 || h < 50.0) return vec3(0.0, 0.0, -1.0);
  float t = h / dir.y;
  return vec3(camPos.xz + dir.xz * t + uCloudOffset, t);
}
float cloudFade(vec3 dir, float t) { return smoothstep(0.015, 0.1, dir.y) * exp(-t / 55000.0); }
float cloudAlpha(vec3 dir, vec3 camPos) {
  if (uCloudCover < 0.01) return 0.0;
  vec3 hit = cloudHit(dir, camPos);
  if (hit.z < 0.0) return 0.0;
  float lod = clamp(hit.z / 12000.0, 0.0, 1.0);
  float th = cloudThreshold();
  float n = cloudField(hit.xy, lod);
  float edge = 0.05 + 0.1 * lod;
  float a = smoothstep(th, th + edge, n) * mix(0.82, 1.0, smoothstep(th, th + 0.25, n));
  return max(a, cloudDeck()) * cloudFade(dir, hit.z);
}
// Colour (HDR) and alpha of the cloud layer in direction dir.
vec4 cloudLayer(vec3 dir, vec3 camPos) {
  if (uCloudCover < 0.01) return vec4(0.0);
  vec3 hit = cloudHit(dir, camPos);
  if (hit.z < 0.0) return vec4(0.0);
  float lod = clamp(hit.z / 12000.0, 0.0, 1.0);
  float th = cloudThreshold();
  float n = cloudField(hit.xy, lod);
  float edge = 0.05 + 0.1 * lod;                               // crisp near, softer far (anti-aliasing)
  float a = smoothstep(th, th + edge, n);
  float deck = cloudDeck();
  if (a < 0.003 && deck < 0.003) return vec4(0.0);
  float core = smoothstep(th, th + 0.26, n);                   // thickness proxy
  vec3 col = vec3(0.0);
  if (a >= 0.003) {
    vec2 ld = uCloudLightDir.xz;
    float ll = length(ld);
    ld = ll > 1e-4 ? ld / ll : vec2(0.0);
    float n2 = cloudField(hit.xy + ld * 380.0, lod);           // density towards the light
    float lit = clamp(0.5 + (n - n2) * 5.0, 0.0, 1.0);         // sun-facing flanks brighter
    float mu = dot(dir, uCloudLightDir);
    float silver = pow(max(mu, 0.0), 8.0) * (1.0 - core) * 2.2 + pow(max(mu, 0.0), 2.0) * 0.2;
    // thick cores get little direct light → darker, flat-looking bases
    col = uCloudSun * (mix(1.0, 0.12, core) * (0.5 + 0.5 * lit) + silver)
        + uCloudAmb * mix(1.05, 0.6, core);
  }
  a *= mix(0.82, 1.0, core);
  if (deck > 0.003) {
    // stratus deck behind the cumulus: flat grey, gently mottled at a large scale
    float m = skyNoise(hit.xy * (0.8 / 1700.0) + 2.9);
    vec3 deckCol = (uCloudSun * 0.3 + uCloudAmb * 0.85) * (0.8 + 0.3 * m);
    col = mix(col, deckCol, deck * 0.6);                        // no bright rims / dark cores in a closed deck
    float alpha = 1.0 - (1.0 - a) * (1.0 - deck);
    col = (deckCol * deck * (1.0 - a) + col * a) / max(alpha, 1e-4);
    a = alpha;
  }
  return vec4(col, a * cloudFade(dir, hit.z));
}
`;

const GLSL_ATMOSPHERE = /* glsl */`
#define ATMO_PI 3.14159265
const float ATMO_RE = ${ATMO.RE.toFixed(1)};
const float ATMO_RA = ${ATMO.RA.toFixed(1)};
const vec3 ATMO_BR = vec3(${ATMO.BETA_R.map((v) => v.toExponential(4)).join(', ')});
uniform float uMieBeta;                         // Mie scattering coefficient (weather dependent)
#define ATMO_BM uMieBeta
const vec3 ATMO_BO = vec3(${ATMO.BETA_O.map((v) => v.toExponential(4)).join(', ')});
const float ATMO_HR = ${ATMO.HR.toFixed(1)};
const float ATMO_HM = ${ATMO.HM.toFixed(1)};

float atmoOzone(float h) { return max(0.0, 1.0 - abs(h - 25000.0) / 15000.0); }
vec2 atmoRaySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float d = b * b - c;
  if (d < 0.0) return vec2(-1.0, -1.0);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}
// Single scattering sky radiance towards 'dir' for a light at 'l' with intensity I (see scatter() in sky.js)
vec3 atmoScatter(vec3 dir, vec3 l, float I, float g) {
  dir.y = max(dir.y, 0.0);
  dir = normalize(dir);
  vec3 ro = vec3(0.0, ATMO_RE + ${ATMO.VIEW_H.toFixed(1)}, 0.0);
  float tMax = atmoRaySphere(ro, dir, ATMO_RA).y;
  float ds = tMax / ${ATMO.VIEW_SAMPLES.toFixed(1)};
  float mu = dot(dir, l);
  float phaseR = 3.0 / (16.0 * ATMO_PI) * (1.0 + mu * mu);
  float g2 = g * g;
  float phaseM = 3.0 / (8.0 * ATMO_PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
  vec3 sumR = vec3(0.0), sumM = vec3(0.0);
  float odR = 0.0, odM = 0.0, odO = 0.0;
  for (int i = 0; i < ${ATMO.VIEW_SAMPLES}; i++) {
    vec3 p = ro + dir * (ds * (float(i) + 0.5));
    float h = length(p) - ATMO_RE;
    float hr = exp(-h / ATMO_HR) * ds, hm = exp(-h / ATMO_HM) * ds;
    odR += hr; odM += hm; odO += atmoOzone(h) * ds;
    vec2 e = atmoRaySphere(p, l, ATMO_RE);
    if (e.x > 0.0) continue;                                   // in the planet's shadow
    float dsl = atmoRaySphere(p, l, ATMO_RA).y / ${ATMO.LIGHT_SAMPLES.toFixed(1)};
    float odRl = 0.0, odMl = 0.0, odOl = 0.0;
    for (int j = 0; j < ${ATMO.LIGHT_SAMPLES}; j++) {
      vec3 q = p + l * (dsl * (float(j) + 0.5));
      float hl = length(q) - ATMO_RE;
      odRl += exp(-hl / ATMO_HR) * dsl; odMl += exp(-hl / ATMO_HM) * dsl; odOl += atmoOzone(hl) * dsl;
    }
    vec3 att = exp(-(ATMO_BR * (odR + odRl) + ATMO_BM * 1.1 * (odM + odMl) + ATMO_BO * (odO + odOl)));
    sumR += att * hr; sumM += att * hm;
  }
  return I * (sumR * ATMO_BR * phaseR + sumM * ATMO_BM * phaseM);
}
`;

// Sky-view LUT: single scattering is symmetric about the sun's vertical plane, so a small 2D table indexed by
// (azimuth relative to the sun, sqrt(elevation)) holds the whole sky. Rebuilt only when the sun or haze changes.
const LUT_W = 128, LUT_H = 64;
const LUT_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const LUT_FRAG = /* glsl */`
uniform vec3 uSunDir;
uniform float uMieG;
varying vec2 vUv;
${GLSL_ATMOSPHERE}
void main() {
  // texel i ↔ parameter i / (N - 1), so both ends of each axis are sampled exactly
  vec2 uv = floor(vUv * vec2(${LUT_W}.0, ${LUT_H}.0)) / vec2(${LUT_W - 1}.0, ${LUT_H - 1}.0);
  float phi = clamp(uv.x, 0.0, 1.0) * 3.14159265;              // azimuth relative to the sun
  float el = clamp(uv.y, 0.0, 1.0); el = el * el * 1.5707963;   // sqrt mapping: more rows near the horizon
  vec2 s = uSunDir.xz; float sl = length(s);
  float saz = sl > 1e-5 ? atan(s.x, -s.y) : 0.0;               // sun azimuth (clockwise from north, z = south)
  float az = saz + phi;
  vec3 dir = vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
  gl_FragColor = vec4(atmoScatter(dir, uSunDir, 1.0, uMieG), 1.0);
}
`;
// Lookup matching LUT_FRAG's parameterisation
const GLSL_LUT = /* glsl */`
uniform sampler2D uSkyLut;
vec3 skyLut(vec3 dir) {
  vec2 s = uSunDir.xz, d = dir.xz;
  float sl = length(s), dl = length(d);
  float c = (sl > 1e-5 && dl > 1e-5) ? dot(s, d) / (sl * dl) : 1.0;
  float u = acos(clamp(c, -1.0, 1.0)) / 3.14159265;
  float v = sqrt(clamp(asin(clamp(dir.y, 0.0, 1.0)) / 1.5707963, 0.0, 1.0));
  vec2 texel = vec2(1.0 / ${LUT_W}.0, 1.0 / ${LUT_H}.0);
  vec2 uv = mix(texel * 0.5, 1.0 - texel * 0.5, vec2(u, v));
  return texture2D(uSkyLut, uv).rgb;
}
`;

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;                                        // on the far plane
}
`;

const SKY_FRAG = /* glsl */`
uniform vec3 uSunDir;
uniform float uSunI;          // scattering intensity of the sun (multiplies the LUT)
uniform vec3 uSunDisc;        // HDR colour of the solar disc (0 when hidden)
uniform float uSunCos;        // cos of the disc's angular radius
uniform vec3 uMoonDir;
uniform float uMoonUp;        // 0..1 moon above horizon & dark enough
uniform float uNight;         // nightFactor
uniform float uCityGlow;
uniform vec3 uNightZenith;
uniform vec3 uNightHorizon;
uniform vec3 uNightCity;
uniform vec3 uHorizon;        // HDR haze colour at the horizon (= fog colour) on the sun's side
uniform vec3 uHorizonAnti;    // HDR haze colour on the anti-solar side (cooler at low sun; = uHorizon by day)
uniform vec3 uHorizonSun;     // extra haze towards the sun
uniform float uAntiCool;      // 0..1 cool shift of the low anti-solar sky (golden hour)
uniform float uHorizonK;      // exponent of the sun lobe
uniform float uHorizonBand;   // height (dir.y) of the haze band
uniform vec3 uGround;         // colour below the horizon (environment pass only)
uniform vec3 uSurroundSky;    // sky + ground fill on the surrounding skyline (radiance per unit albedo; env pass)
uniform vec3 uSurroundSun;    // direct sun on skyline faces turned towards it (radiance per unit albedo; env pass)
uniform float uEnvPass;       // 1 while rendering the PMREM environment
uniform mat3 uStarRot;        // celestial rotation (for the Milky Way band)
uniform float uMilkyWay;
varying vec3 vDir;
#include <common>
#include <dithering_pars_fragment>

${GLSL_NOISE}
${GLSL_CLOUDS}
${GLSL_LUT}

vec3 nightSky(vec3 dir) {
  float h = max(dir.y, 0.0);
  vec3 c = mix(uNightHorizon, uNightZenith, sqrt(h));
  c += uNightCity * exp(-h * 9.0) * uCityGlow;
  float mm = max(dot(dir, uMoonDir), 0.0);
  c += vec3(0.030, 0.038, 0.055) * (pow(mm, 24.0) * 0.5 + pow(mm, 300.0) * 1.6) * uMoonUp;
  // faint Milky Way band (galactic plane) rotating with the stars (skipped by day)
  if (uMilkyWay > 0.002) {
    vec3 cel = uStarRot * dir;
    float band = exp(-pow(dot(cel, normalize(vec3(0.46, 0.62, -0.63))), 2.0) * 28.0);
    if (band > 0.01) {
      float mw = band * (0.55 + 0.9 * skyFbm(vec2(cel.x + 0.5 * cel.y, cel.z - 0.3 * cel.y) * 7.0, 0.0));
      c += vec3(0.010, 0.011, 0.014) * mw * uMilkyWay * smoothstep(0.0, 0.3, h);
    }
  }
  return c;
}

// Environment pass only: a generic skyline of tree crowns and building blocks just above the horizon (the campus
// around the viewer), so glass and metal reflect a dark, structured band under the bright sky instead of a uniform
// haze. Lit like vertical surfaces: sky + ground fill, plus the sun on the blocks that face it. Periodic in azimuth.
vec3 surroundings(vec3 dir, vec3 haze, vec3 sky) {
  float az = atan(dir.x, -dir.z);
  vec2 cs = vec2(cos(az), sin(az));
  float tree = 0.045 + 0.045 * skyNoise(cs * 3.0 + 11.0) + 0.02 * skyNoise(cs * 11.0 + 3.0) + 0.008 * skyNoise(cs * 37.0 + 5.0);
  float cell = floor((az / 6.2831853 + 0.5) * 48.0);
  float bld = skyHash12(vec2(cell, 7.0)) > 0.45 ? 0.04 + 0.15 * pow(skyHash12(vec2(cell, 3.0)), 1.4) : 0.0;
  float line = max(tree, bld);                                 // sine of the skyline elevation
  float m = 1.0 - smoothstep(line - 0.003, line + 0.003, dir.y);
  if (m <= 0.0) return sky;
  bool isB = bld > tree;
  vec3 alb = isB ? mix(vec3(0.36, 0.31, 0.24), vec3(0.3, 0.17, 0.12), skyHash12(vec2(cell, 5.0))) : vec3(0.06, 0.085, 0.045);
  // window rows on the blocks: darker glass bands
  if (isB) alb *= 1.0 - 0.45 * step(0.55, fract(dir.y * 260.0));
  vec2 dh = dir.xz / max(length(dir.xz), 1e-4), sh = uSunDir.xz / max(length(uSunDir.xz), 1e-4);
  float facing = max(0.0, -dot(dh, sh));                       // blocks opposite the sun face it
  vec3 c = alb * (uSurroundSky + uSurroundSun * facing * (isB ? 1.0 : 0.6));
  c = mix(c, haze, 0.3);                                       // a few hundred metres of air
  return mix(sky, c, m);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = skyLut(dir) * uSunI;
  // azimuth weight: 1 towards the sun, 0 on the anti-solar side
  float hsl = length(uSunDir.xz), hdl = length(dir.xz);
  float hw = (hsl > 1e-4 && hdl > 1e-4) ? pow(clamp(0.5 + 0.5 * dot(dir.xz, uSunDir.xz) / (hsl * hdl), 0.0, 1.0), 1.5) : 1.0;
  if (uAntiCool > 0.0) {
    // Single scattering lacks the multiply-scattered blue that dominates the low anti-solar sky at golden hour
    // (it would stay orange there): pull it towards a slightly darker lavender-blue of similar luminance.
    float k = uAntiCool * (1.0 - hw) * (1.0 - smoothstep(0.0, 0.55, dir.y));
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(col, l * vec3(0.84, 0.85, 1.13), k);
  }
  col += nightSky(dir) * uNight;

  if (uEnvPass < 0.5) {
    // solar disc with limb darkening and a soft edge
    float mu = dot(dir, uSunDir);
    float r = clamp((1.0 - mu) / (1.0 - uSunCos), 0.0, 1.0);
    float disc = smoothstep(1.0, 0.8, r) * (1.0 - 0.45 * r * r);
    col += uSunDisc * disc;
  }

  vec4 cl = cloudLayer(dir, cameraPosition);
  col = mix(col, cl.rgb, cl.a);

  // horizon haze: identical colour to the distance fog (fog_fragment in env.js) so terrain melts into the sky
  float sunLobe = pow(max(dot(dir, uSunDir), 0.0), uHorizonK);
  vec3 haze = mix(uHorizonAnti, uHorizon, hw) + uHorizonSun * sunLobe;
  // below the horizon (beyond the terrain skirt) the airlight is dimmer and cooler, as on the fogged ground
  haze *= mix(vec3(1.0), vec3(0.74, 0.79, 0.86), smoothstep(0.0, -0.35, dir.y));
  float hb = 1.0 - smoothstep(-0.015, uHorizonBand, dir.y);
  col = mix(col, haze, hb);
  if (uEnvPass > 0.5) {
    col = surroundings(dir, haze, col);
    col = mix(col, uGround, smoothstep(-0.01, -0.2, dir.y));
  }

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

const STAR_VERT = /* glsl */`
attribute float aMag;
attribute vec3 aColor;
attribute float aPhase;
uniform float uStarI;
uniform float uTime;
uniform float uPx;             // pixel ratio
varying vec3 vCol;
${GLSL_NOISE}
${GLSL_CLOUDS}
void main() {
  vec3 dir = normalize(mat3(modelMatrix) * position);
  float tw = 0.72 + 0.28 * sin(uTime * (2.0 + aPhase * 3.0) + aPhase * 40.0);
  float vis = smoothstep(0.0, 0.18, dir.y) * (1.0 - cloudAlpha(dir, cameraPosition));
  vCol = aColor * aMag * tw * vis * uStarI;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * dir, 1.0);
  gl_Position = p.xyww;
  gl_PointSize = (1.4 + 2.2 * aMag) * uPx;
  if (vis * uStarI < 0.001) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);  // cull
}
`;
const STAR_FRAG = /* glsl */`
varying vec3 vCol;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(c));
  gl_FragColor = vec4(vCol * a * a, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const MOON_VERT = /* glsl */`
uniform vec3 uMoonDir;
uniform vec3 uMoonRight;
uniform vec3 uMoonUpV;
uniform float uMoonSize;       // angular half-size (radians, ~tan)
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 dir = uMoonDir + (uMoonRight * position.x + uMoonUpV * position.y) * uMoonSize * 2.0;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * dir, 1.0);
  gl_Position = p.xyww;
}
`;
const MOON_FRAG = /* glsl */`
uniform sampler2D uMap;
uniform vec3 uMoonDir;
uniform vec3 uMoonColor;       // HDR tint * brightness
uniform float uMoonAlpha;
varying vec2 vUv;
${GLSL_NOISE}
${GLSL_CLOUDS}
void main() {
  vec4 t = texture2D(uMap, vUv);
  float occ = 1.0 - cloudAlpha(uMoonDir, cameraPosition) * 0.92;
  float a = t.a * uMoonAlpha * occ * smoothstep(-0.01, 0.04, uMoonDir.y);
  gl_FragColor = vec4(t.rgb * uMoonColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// ------------------------------------------------------------------------------------------------ helpers
function seeded(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// Moon surface painted on a canvas: mare patches, a few craters, limb darkening.
function moonTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  // CPU-backed canvas: the getImageData() below would otherwise wait for a GPU readback (~150 ms during loading)
  const g = c.getContext('2d', { willReadFrequently: true });
  const r = seeded(97);
  g.save();
  g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#e9e6de'; g.fillRect(0, 0, S, S);
  // maria: large soft grey patches roughly where the real ones are (upper-left half of the near side)
  const maria = [[0.38, 0.33, 0.16], [0.55, 0.28, 0.12], [0.62, 0.45, 0.1], [0.33, 0.52, 0.13], [0.47, 0.62, 0.08], [0.7, 0.3, 0.07], [0.28, 0.38, 0.09]];
  for (const [x, y, rad] of maria) {
    const grd = g.createRadialGradient(x * S, y * S, 0, x * S, y * S, rad * S * 1.4);
    grd.addColorStop(0, 'rgba(120,122,128,0.75)'); grd.addColorStop(0.7, 'rgba(130,132,138,0.45)'); grd.addColorStop(1, 'rgba(140,140,145,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
  }
  for (let i = 0; i < 70; i++) {
    const x = r() * S, y = r() * S, rad = 1 + r() * r() * 9;
    g.strokeStyle = `rgba(255,255,255,${0.12 + r() * 0.2})`; g.lineWidth = 1;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.stroke();
    g.fillStyle = `rgba(90,90,95,${0.08 + r() * 0.12})`; g.beginPath(); g.arc(x + rad * 0.2, y + rad * 0.2, rad * 0.8, 0, Math.PI * 2); g.fill();
  }
  // Tycho-like bright crater with rays
  g.strokeStyle = 'rgba(255,255,250,0.18)'; g.lineWidth = 1.2;
  for (let i = 0; i < 16; i++) { const a = r() * Math.PI * 2; g.beginPath(); g.moveTo(S * 0.45, S * 0.82); g.lineTo(S * 0.45 + Math.cos(a) * S * 0.35, S * 0.82 + Math.sin(a) * S * 0.35); g.stroke(); }
  g.restore();
  // limb darkening + slight waxing-gibbous terminator on the left
  const img = g.getImageData(0, 0, S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S * 2 - 1, v = (y + 0.5) / S * 2 - 1, rr = u * u + v * v, i = (y * S + x) * 4;
    if (rr > 1) { d[i + 3] = 0; continue; }
    const z = Math.sqrt(1 - rr);
    // lighting from a sun ~165 deg away: normal·light with light slightly from the right
    const lx = 0.26, lz = 0.966;
    const lam = Math.max(0, u * lx + z * lz);
    const shade = 0.35 + 0.65 * Math.pow(lam, 0.6);
    const edge = Math.min(1, (1 - Math.sqrt(rr)) * S * 0.5);
    d[i] *= shade; d[i + 1] *= shade; d[i + 2] *= shade; d[i + 3] = 255 * edge;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------------------------------------ objects
// Creates the sky dome (for the view), an env-only copy (for the PMREM), stars and moon.
export function createSkyObjects({ starCount = 3400, pixelRatio = 1 } = {}) {
  const U = {
    // shared by sky / stars / moon (same uniform objects → one update)
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunI: { value: 20 },
    uMieG: { value: 0.8 },
    uMieBeta: { value: ATMO.BETA_M },
    uSunDisc: { value: new THREE.Vector3() },
    uSunCos: { value: Math.cos(THREE.MathUtils.degToRad(0.42)) },
    uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
    uMoonUp: { value: 0 },
    uNight: { value: 0 },
    uCityGlow: { value: 1 },
    uNightZenith: { value: new THREE.Vector3(...NIGHT.zenith) },
    uNightHorizon: { value: new THREE.Vector3(...NIGHT.horizon) },
    uNightCity: { value: new THREE.Vector3(...NIGHT.city) },
    uHorizon: { value: new THREE.Vector3(0.6, 0.7, 0.8) },
    uHorizonAnti: { value: new THREE.Vector3(0.6, 0.7, 0.8) },
    uHorizonSun: { value: new THREE.Vector3() },
    uAntiCool: { value: 0 },
    uHorizonK: { value: 6 },
    uHorizonBand: { value: 0.07 },
    uGround: { value: new THREE.Vector3(0.1, 0.1, 0.1) },
    uSurroundSky: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    uSurroundSun: { value: new THREE.Vector3() },
    uStarRot: { value: new THREE.Matrix3() },
    uMilkyWay: { value: 1 },
    uCloudCover: { value: 0.4 },
    uCloudHeight: { value: 2300 },
    uCloudOffset: { value: new THREE.Vector2() },
    uCloudLightDir: { value: new THREE.Vector3(0, 1, 0) },
    uCloudSun: { value: new THREE.Vector3(1, 1, 1) },
    uCloudAmb: { value: new THREE.Vector3(0.5, 0.55, 0.65) },
    uTime: { value: 0 },
  };

  // ---- sky-view LUT
  const lutTarget = new THREE.WebGLRenderTarget(LUT_W, LUT_H, {
    type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, generateMipmaps: false,
  });
  lutTarget.texture.name = 'skyViewLut';
  U.uSkyLut = { value: lutTarget.texture };
  const lutMaterial = new THREE.ShaderMaterial({
    name: 'skyLut', uniforms: { uSunDir: U.uSunDir, uMieG: U.uMieG, uMieBeta: U.uMieBeta },
    vertexShader: LUT_VERT, fragmentShader: LUT_FRAG, depthTest: false, depthWrite: false, toneMapped: false,
  });
  // full-screen triangle (same as three's FullScreenQuad, but with a mesh we can also hand to renderer.compile)
  const lutGeo = new THREE.BufferGeometry();
  lutGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, 3, 0, -1, -1, 0, 3, -1, 0], 3));
  lutGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 2, 0, 0, 2, 0], 2));
  const lutMesh = new THREE.Mesh(lutGeo, lutMaterial);
  lutMesh.frustumCulled = false;
  const lutCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  function renderLut(renderer) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(lutTarget);
    renderer.render(lutMesh, lutCam);
    renderer.setRenderTarget(prev);
  }
  // issue the LUT program's compile early (non-blocking with KHR_parallel_shader_compile)
  function compileLut(renderer) {
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(lutTarget);
    renderer.compile(lutMesh, lutCam);
    renderer.setRenderTarget(prev);
  }

  const geo = new THREE.SphereGeometry(1, 64, 32);
  const makeSkyMat = (env) => new THREE.ShaderMaterial({
    name: env ? 'skyEnv' : 'sky',
    uniforms: { ...U, uEnvPass: { value: env ? 1 : 0 } },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
    dithering: !env,
  });
  const sky = new THREE.Mesh(geo, makeSkyMat(false));
  sky.name = 'sky';
  sky.frustumCulled = false;
  sky.renderOrder = 1000;         // after opaque geometry → early-z rejects covered pixels
  sky.matrixAutoUpdate = false;
  sky.castShadow = sky.receiveShadow = false;

  const envSky = new THREE.Mesh(geo, makeSkyMat(true));
  envSky.frustumCulled = false;
  envSky.matrixAutoUpdate = false;

  // ---- stars
  const rnd = seeded(2024);
  const pos = new Float32Array(starCount * 3), mag = new Float32Array(starCount), col = new Float32Array(starCount * 3), ph = new Float32Array(starCount);
  const tints = [[0.78, 0.86, 1.0], [0.92, 0.95, 1.0], [1.0, 1.0, 1.0], [1.0, 0.94, 0.82], [1.0, 0.84, 0.66]];
  for (let i = 0; i < starCount; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos[i * 3] = s * Math.cos(a); pos[i * 3 + 1] = u; pos[i * 3 + 2] = s * Math.sin(a);
    mag[i] = Math.min(1, 0.12 + Math.pow(rnd(), 7) * 1.4);
    const t = tints[Math.min(tints.length - 1, (rnd() * tints.length) | 0)];
    col[i * 3] = t[0]; col[i * 3 + 1] = t[1]; col[i * 3 + 2] = t[2];
    ph[i] = rnd();
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  sg.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
  sg.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
  const starU = { ...U, uStarI: { value: 0 }, uPx: { value: pixelRatio } };
  const stars = new THREE.Points(sg, new THREE.ShaderMaterial({
    name: 'stars', uniforms: starU, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    // opaque list (after the sky, before transparent geometry) but additively blended
    blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, transparent: false, fog: false,
  }));
  stars.name = 'stars';
  stars.frustumCulled = false;
  stars.renderOrder = 1001;
  stars.matrixAutoUpdate = false;

  // ---- moon
  const moonU = {
    ...U,
    uMap: { value: moonTexture() },
    uMoonRight: { value: new THREE.Vector3(1, 0, 0) },
    uMoonUpV: { value: new THREE.Vector3(0, 1, 0) },
    uMoonSize: { value: THREE.MathUtils.degToRad(0.75) },
    uMoonColor: { value: new THREE.Vector3(1, 1, 1) },
    uMoonAlpha: { value: 0 },
  };
  const moon = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShaderMaterial({
    name: 'moon', uniforms: moonU, vertexShader: MOON_VERT, fragmentShader: MOON_FRAG,
    transparent: false, depthWrite: false, depthTest: true, fog: false,
    blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  }));
  moon.name = 'moon';
  moon.frustumCulled = false;
  moon.renderOrder = 1002;
  moon.matrixAutoUpdate = false;

  // Orient the moon quad so its "up" follows the sky
  const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _y = new THREE.Vector3(0, 1, 0);
  function setMoon(dir) {
    U.uMoonDir.value.copy(dir);
    _r.crossVectors(dir, _y);
    if (_r.lengthSq() < 1e-6) _r.set(1, 0, 0);
    _r.normalize();
    _u.crossVectors(_r, dir).normalize();
    moonU.uMoonRight.value.copy(_r);
    moonU.uMoonUpV.value.copy(_u);
  }

  // These objects live at the origin in geometry space (shaders place them at infinity): never let scene-wide
  // raycasts (click-to-fly, picking) hit them.
  const noRaycast = () => {};
  for (const o of [sky, envSky, stars, moon]) o.raycast = noRaycast;

  return { uniforms: U, sky, envSky, stars, starUniforms: starU, moon, moonUniforms: moonU, setMoon, renderLut, compileLut, lutTarget };
}
