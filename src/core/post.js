// Post-processing for the 'high' quality preset.
//
//   RenderPass  → HDR half-float target with 4× MSAA (hardware AA on geometry edges) + resolved depth texture
//   BloomPass   → UnrealBloom mip chain, but NOT blended back into the MSAA target (saves a full-res pass);
//                 the final pass adds it instead. Threshold/strength follow nightFactor (night lights glow).
//                 By day only the sun disc and specular sun glints (glass, water, cars) exceed the threshold.
//   FinalPass   → depth-only screen-space AO (half resolution, 12 samples, bilateral blur, depth-aware upsample,
//                 weaker on sunlit pixels), bloom add, gentle vignette, ACES tone mapping, a subtle colour grade
//                 (saturation + warm/cool split tone), sRGB output + dithering — i.e. OutputPass's job plus AO
//                 composite in a single full-screen draw.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

// ------------------------------------------------------------------------------------------------ bloom
class SoftBloomPass extends UnrealBloomPass {
  constructor(resolution, strength, radius, threshold) {
    super(resolution, strength, radius, threshold);
    this.highPassUniforms.smoothWidth.value = 0.8;
    this.output = this.renderTargetsHorizontal[0].texture;
  }
  // Same as UnrealBloomPass.render minus the final additive blend into readBuffer.
  render(renderer, writeBuffer, readBuffer) {
    if (this.strength <= 0.001) return;
    renderer.getClearColor(this._oldClearColor);
    this.oldClearAlpha = renderer.getClearAlpha();
    const oldAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.clearColor, 0);

    this.highPassUniforms.tDiffuse.value = readBuffer.texture;
    this.highPassUniforms.luminosityThreshold.value = this.threshold;
    this.fsQuad.material = this.materialHighPassFilter;
    renderer.setRenderTarget(this.renderTargetBright);
    renderer.clear();
    this.fsQuad.render(renderer);

    let input = this.renderTargetBright;
    for (let i = 0; i < this.nMips; i++) {
      const m = this.separableBlurMaterials[i];
      this.fsQuad.material = m;
      m.uniforms.colorTexture.value = input.texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionX;
      renderer.setRenderTarget(this.renderTargetsHorizontal[i]);
      renderer.clear();
      this.fsQuad.render(renderer);
      m.uniforms.colorTexture.value = this.renderTargetsHorizontal[i].texture;
      m.uniforms.direction.value = UnrealBloomPass.BlurDirectionY;
      renderer.setRenderTarget(this.renderTargetsVertical[i]);
      renderer.clear();
      this.fsQuad.render(renderer);
      input = this.renderTargetsVertical[i];
    }
    this.fsQuad.material = this.compositeMaterial;
    this.compositeMaterial.uniforms.bloomStrength.value = this.strength;
    this.compositeMaterial.uniforms.bloomRadius.value = this.radius;
    this.compositeMaterial.uniforms.bloomTintColors.value = this.bloomTintColors;
    renderer.setRenderTarget(this.renderTargetsHorizontal[0]);
    renderer.clear();
    this.fsQuad.render(renderer);

    renderer.setClearColor(this._oldClearColor, this.oldClearAlpha);
    renderer.autoClear = oldAutoClear;
  }
}

// ------------------------------------------------------------------------------------------------ AO shaders
const FS_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const DEPTH_COMMON = /* glsl */`
uniform sampler2D tDepth;
uniform vec4 uProj;            // x: tan(fovY/2)*aspect, y: tan(fovY/2), z: near, w: far
float linDepth(float d) { return uProj.z * uProj.w / (uProj.w - d * (uProj.w - uProj.z)); }
vec3 viewPos(vec2 uv) {
  float z = linDepth(textureLod(tDepth, uv, 0.0).r);
  return vec3((uv * 2.0 - 1.0) * uProj.xy * z, -z);
}
`;

const AO_FRAG = /* glsl */`
${DEPTH_COMMON}
uniform vec2 uInvFull;          // 1 / full-res size
uniform float uRadius;          // world radius (m) near the camera; grows with distance
uniform float uIntensity;
uniform float uFadeStart, uFadeEnd;
varying vec2 vUv;
#define SAMPLES 12
void main() {
  float d = textureLod(tDepth, vUv, 0.0).r;
  if (d >= 0.99999) { gl_FragColor = vec4(1.0, 60000.0, 0.0, 1.0); return; }
  vec3 p = viewPos(vUv);
  float z = -p.z;
  if (z > uFadeEnd) { gl_FragColor = vec4(1.0, z, 0.0, 1.0); return; }
  // normal from depth, picking the smaller difference on each axis (no smearing across silhouettes)
  vec2 dx = vec2(uInvFull.x, 0.0), dy = vec2(0.0, uInvFull.y);
  vec3 pl = viewPos(vUv - dx), pr = viewPos(vUv + dx), pd = viewPos(vUv - dy), pu = viewPos(vUv + dy);
  vec3 ddx = abs(pr.z - p.z) < abs(p.z - pl.z) ? pr - p : p - pl;
  vec3 ddy = abs(pu.z - p.z) < abs(p.z - pd.z) ? pu - p : p - pd;
  vec3 n = normalize(cross(ddx, ddy));
  // world radius grows with distance so aerial views still get contact shading; screen-space radius from it
  float R = clamp(uRadius + z * 0.014, uRadius, 7.0);
  float rUv = R / (z * uProj.y * 2.0);
  rUv = clamp(rUv, 4.0 * uInvFull.y, 0.09);
  float aspect = uProj.x / uProj.y;
  // interleaved gradient noise → per-pixel rotation
  float noise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float R2 = R * R;
  float sum = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float fi = float(i);
    float ang = (fi + noise) * 2.39996323;
    float rr = sqrt((fi + 0.5 + noise * 0.5) / float(SAMPLES)) * rUv;
    vec2 off = vec2(cos(ang) / aspect, sin(ang)) * rr;
    vec3 s = viewPos(vUv + off);
    vec3 v = s - p;
    float vv = dot(v, v);
    float vn = dot(v, n);
    float f = max(0.0, 1.0 - vv / R2);
    // generous bias + epsilon: soft contact shading in corners instead of saturating to black
    sum += f * max(0.0, vn - (0.08 * R + 0.002 * z)) / (vv + 0.15 * R2);
  }
  float ao = max(0.0, 1.0 - uIntensity * R * 2.0 * sum / float(SAMPLES));
  ao = max(ao, 0.3);              // (the composite weakens it on sunlit pixels, see FINAL_FRAG)
  ao = mix(ao, 1.0, smoothstep(uFadeStart, uFadeEnd, z));
  gl_FragColor = vec4(ao, z, 0.0, 1.0);
}
`;

const BLUR_FRAG = /* glsl */`
uniform sampler2D tAO;
uniform vec2 uStep;
varying vec2 vUv;
void main() {
  vec4 c = textureLod(tAO, vUv, 0.0);
  float z = c.g;
  float tol = 0.035 * z + 0.08;
  float sum = c.r * 0.2, wsum = 0.2;
  // 11 taps (σ ≈ 2 texels): wide enough to dissolve the interleaved-gradient-noise pattern of the AO pass
  for (int i = 1; i <= 5; i++) {
    float g = exp(-float(i * i) * 0.11) * 0.2;
    vec4 a = textureLod(tAO, vUv + uStep * float(i), 0.0);
    vec4 b = textureLod(tAO, vUv - uStep * float(i), 0.0);
    float wa = g * max(0.0, 1.0 - abs(a.g - z) / tol);
    float wb = g * max(0.0, 1.0 - abs(b.g - z) / tol);
    sum += a.r * wa + b.r * wb; wsum += wa + wb;
  }
  gl_FragColor = vec4(sum / wsum, z, 0.0, 1.0);
}
`;

const FINAL_FRAG = /* glsl */`
${DEPTH_COMMON}
uniform sampler2D tDiffuse;
uniform sampler2D tBloom;
uniform sampler2D tAO;
uniform vec2 uHalfSize;         // AO texture size
uniform float uAO;              // 0/1
uniform float uAOStrength;
uniform float uBloom;           // 0/1
uniform float uVignette;
uniform float uDebug;           // 1 = show the AO buffer
uniform float uGrade;           // 0..1 strength of the colour grade
varying vec2 vUv;
#include <common>
#include <dithering_pars_fragment>

float aoUpsample(float z) {
  // joint-bilateral 2×2 upsample of the half-res AO
  vec2 t = vUv * uHalfSize - 0.5;
  vec2 f = fract(t);
  vec2 base = (floor(t) + 0.5) / uHalfSize;
  vec2 s = 1.0 / uHalfSize;
  vec4 a = textureLod(tAO, base, 0.0), b = textureLod(tAO, base + vec2(s.x, 0.0), 0.0);
  vec4 c = textureLod(tAO, base + vec2(0.0, s.y), 0.0), d = textureLod(tAO, base + s, 0.0);
  float tol = 0.04 * z + 0.1;
  vec4 w = vec4((1.0 - f.x) * (1.0 - f.y), f.x * (1.0 - f.y), (1.0 - f.x) * f.y, f.x * f.y);
  w *= vec4(max(1e-3, 1.0 - abs(a.g - z) / tol), max(1e-3, 1.0 - abs(b.g - z) / tol),
            max(1e-3, 1.0 - abs(c.g - z) / tol), max(1e-3, 1.0 - abs(d.g - z) / tol));
  return dot(w, vec4(a.r, b.r, c.r, d.r)) / (w.x + w.y + w.z + w.w);
}

void main() {
  vec3 col = texture2D(tDiffuse, vUv).rgb;
  if (uAO > 0.5) {
    float d = textureLod(tDepth, vUv, 0.0).r;
    // Screen-space AO darkens the whole pixel, but occlusion only concerns the ambient part of its light: pixels
    // bright enough to be in direct sun get less of it (no dark halos on sunlit ground next to a sunlit wall)
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    float k = uAOStrength * (1.0 - 0.55 * smoothstep(0.14, 0.6, lum));
    float ao = d < 0.99999 ? mix(1.0, aoUpsample(linDepth(d)), k) : 1.0;
    col *= ao;
    if (uDebug > 0.5) col = vec3(ao * ao);
    if (uDebug > 1.5) col = vec3(fract(linDepth(d) / 20.0), d > 0.99999 ? 1.0 : 0.0, textureLod(tAO, vUv, 0.0).r);
  }
  if (uBloom > 0.5) col += texture2D(tBloom, vUv).rgb;
  vec2 q = vUv - 0.5;
  col *= 1.0 - uVignette * smoothstep(0.1, 0.55, dot(q, q) * 1.3);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  // colour grade (display-referred, before the sRGB encoding): a little more saturation than ACES leaves, and a
  // gentle split tone — warm highlights, slightly cool shadows — for a photographic rather than flat-CG look
  if (uGrade > 0.0) {
    vec3 c = gl_FragColor.rgb;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = max(mix(vec3(l), c, 1.0 + 0.1 * uGrade), 0.0);
    float hi = smoothstep(0.08, 0.7, l);
    c *= mix(vec3(1.0) + uGrade * vec3(-0.018, -0.004, 0.03), vec3(1.0) + uGrade * vec3(0.025, 0.004, -0.03), hi);
    gl_FragColor.rgb = c;
  }
  #include <colorspace_fragment>
  #include <dithering_fragment>
}
`;

class FinalPass extends Pass {
  constructor(camera, bloomPass) {
    super();
    this.camera = camera;
    this.bloomPass = bloomPass;
    this.needsSwap = false;
    this.aoEnabled = true;
    this.halfSize = new THREE.Vector2(1, 1);
    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
    this.aoA = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.aoB = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.aoA.texture.name = 'post.aoA'; this.aoB.texture.name = 'post.aoB';
    const proj = { value: new THREE.Vector4() };
    this.proj = proj;
    const common = { depthTest: false, depthWrite: false, toneMapped: false };
    this.aoMat = new THREE.ShaderMaterial({
      name: 'post.ao', vertexShader: FS_VERT, fragmentShader: AO_FRAG, ...common,
      uniforms: {
        tDepth: { value: null }, uProj: proj, uInvFull: { value: new THREE.Vector2() },
        uRadius: { value: 1.0 }, uIntensity: { value: 2.1 }, uFadeStart: { value: 420 }, uFadeEnd: { value: 1150 },
      },
    });
    this.blurMat = new THREE.ShaderMaterial({
      name: 'post.aoBlur', vertexShader: FS_VERT, fragmentShader: BLUR_FRAG, ...common,
      uniforms: { tAO: { value: null }, uStep: { value: new THREE.Vector2() } },
    });
    this.finalMat = new THREE.ShaderMaterial({
      name: 'post.final', vertexShader: FS_VERT, fragmentShader: FINAL_FRAG,
      depthTest: false, depthWrite: false, dithering: true,
      uniforms: {
        tDiffuse: { value: null }, tBloom: { value: null }, tAO: { value: this.aoA.texture }, tDepth: { value: null },
        uProj: proj, uHalfSize: { value: this.halfSize }, uAO: { value: 1 }, uAOStrength: { value: 0.85 },
        uBloom: { value: 1 }, uVignette: { value: 0.22 }, uDebug: { value: 0 }, uGrade: { value: 1 },
      },
    });
    this.quad = new FullScreenQuad(null);
  }
  setSize(w, h) {
    const hw = Math.max(1, Math.round(w / 2)), hh = Math.max(1, Math.round(h / 2));
    this.aoA.setSize(hw, hh); this.aoB.setSize(hw, hh);
    this.halfSize.set(hw, hh);
    this.aoMat.uniforms.uInvFull.value.set(1 / w, 1 / h);
  }
  render(renderer, writeBuffer, readBuffer) {
    const cam = this.camera;
    const ty = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2) / (cam.zoom || 1);
    this.proj.value.set(ty * cam.aspect, ty, cam.near, cam.far);
    const depth = readBuffer.depthTexture;
    const ao = this.aoEnabled && !!depth;
    if (ao) {
      this.aoMat.uniforms.tDepth.value = depth;
      this.quad.material = this.aoMat;
      renderer.setRenderTarget(this.aoA); this.quad.render(renderer);
      this.quad.material = this.blurMat;
      this.blurMat.uniforms.tAO.value = this.aoA.texture;
      this.blurMat.uniforms.uStep.value.set(1 / this.halfSize.x, 0);
      renderer.setRenderTarget(this.aoB); this.quad.render(renderer);
      this.blurMat.uniforms.tAO.value = this.aoB.texture;
      this.blurMat.uniforms.uStep.value.set(0, 1 / this.halfSize.y);
      renderer.setRenderTarget(this.aoA); this.quad.render(renderer);
    }
    const u = this.finalMat.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = depth;
    u.uAO.value = ao ? 1 : 0;
    const bloomOn = this.bloomPass && this.bloomPass.enabled && this.bloomPass.strength > 0.001;
    u.uBloom.value = bloomOn ? 1 : 0;
    u.tBloom.value = bloomOn ? this.bloomPass.output : null;
    this.quad.material = this.finalMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose() {
    this.aoA.dispose(); this.aoB.dispose();
    this.aoMat.dispose(); this.blurMat.dispose(); this.finalMat.dispose();
    this.quad.dispose();
  }
}

// ------------------------------------------------------------------------------------------------ factory
export function createPost(renderer, scene, camera, { width, height, samples = 4 } = {}) {
  const pr = renderer.getPixelRatio();
  const w = Math.max(1, Math.round(width * pr)), h = Math.max(1, Math.round(height * pr));
  const depthTexture = new THREE.DepthTexture(w, h);
  depthTexture.type = THREE.UnsignedIntType;
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType, samples, depthTexture, stencilBuffer: false,
  });
  rt.texture.name = 'post.scene';
  const composer = new EffectComposer(renderer, rt);

  const renderPass = new RenderPass(scene, camera);
  const bloom = new SoftBloomPass(new THREE.Vector2(w, h), 0.12, 0.55, 2.2);
  const final = new FinalPass(camera, bloom);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(final);
  composer.setSize(width, height);

  return {
    composer, renderPass, bloom, final,
    get aoEnabled() { return final.aoEnabled; },
    setAO(on) { final.aoEnabled = !!on; },
    setBloom(on) { bloom.enabled = !!on; },
    // Night lights glow, daylight only blooms the sun / hot specular glints (a touch more glare when the solar disc
    // itself is on screen).
    setNight(nf, sunGlare = false) {
      bloom.threshold = 2.4 - 2.15 * nf;              // day: only the sun / hot glints · night: windows, lamps
      bloom.highPassUniforms.smoothWidth.value = 0.8 - 0.3 * nf;
      bloom.strength = 0.1 + 0.45 * nf + (sunGlare ? 0.04 : 0);
      bloom.radius = 0.45 + 0.25 * nf;
      final.finalMat.uniforms.uVignette.value = 0.2 + 0.1 * nf;
    },
    get bloomEnabled() { return bloom.enabled; },
    // Every program the passes use, grouped by where they draw (program keys differ between an off-screen target
    // and the canvas), so engine.precompile() can compile them before the first frame.
    materials() {
      return {
        offscreen: [bloom.materialHighPassFilter, ...bloom.separableBlurMaterials, bloom.compositeMaterial, final.aoMat, final.blurMat],
        screen: [final.finalMat],
        target: composer.readBuffer,
      };
    },
    setSize(cssW, cssH) { composer.setSize(cssW, cssH); },
    setPixelRatio(p) { composer.setPixelRatio(p); },
    render(dt) { composer.render(dt); },
    dispose() {
      composer.passes.forEach((p) => p.dispose?.());
      composer.renderTarget1.dispose(); composer.renderTarget2.dispose();
      depthTexture.dispose();
    },
  };
}
