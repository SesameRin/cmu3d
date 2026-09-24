// Environment for CMU 3D (contract: ARCHITECTURE.md §env).
//
//  · Real solar position for Pittsburgh (40.4433 N, 79.9436 W, America/New_York incl. DST) on a date that matches
//    the season (spring Apr 20 · summer Jul 10 · autumn Oct 12 · winter Jan 15).
//  · Physically-based sky (sky.js) whose JS twin drives the sun colour, the hemisphere light, the fog colour and the
//    horizon haze, so terrain, fog and sky always agree.
//  · Sun DirectionalLight with a shadow frustum that follows the view (sized by camera distance, texel-snapped),
//    stretched to always cover the viewer's foreground; on 'high' plus a second, near shadow cascade (sunNear) of
//    ~140 m in front of a low viewer. After dusk the same light becomes weak, cool moonlight.
//  · Fill balance: under a clear sky with a high sun the sky fill (hemisphere light + diffuse IBL) is reduced where
//    the sun shines and the sun made a little stronger → deeper, more legible shadows (patched light chunks).
//  · Distance haze + height fog with sun in-scattering, installed globally by patching three's fog shader chunks (so
//    every built-in material and every ShaderMaterial using the standard fog chunks gets it for free). Two separate
//    terms: a light, physically-shaped atmospheric haze (Beer–Lambert, thins with altitude, independent of the draw
//    distance) and a world-edge fade by horizontal radius around the data centre that hides the end of the terrain
//    skirt. The airlight is warm towards the sun, cooler on the anti-solar side at low sun, and dimmer on downward rays.
//  · Cloud shadows: the sun/moon light is attenuated by the same drifting cloud layer the sky draws (patched
//    lights_fragment_begin chunk; off on 'low').
//  · scene.environment = PMREM of the sky (with a generic skyline of trees / buildings just above the horizon, so
//    glass reflects a structured band of surroundings), re-generated only when the sun/weather changed noticeably.
//  · Night: nightFactor, stars (sidereal rotation), moon disc, Milky Way, city glow. Clouds, weather and winter snow.
import * as THREE from 'three';
import { createSkyObjects, scatter, transmittance, acesFilmic, nightSkyJS, ATMO, NIGHT } from './sky.js';
import { WEATHER, SEASON_WEATHER, createSnow } from './weather.js';

const LAT = 40.4433, LON = -79.9436;
const YEAR = 2025;
const D2R = Math.PI / 180;
export const SEASON_DATES = { spring: [4, 20], summer: [7, 10], autumn: [10, 12], winter: [1, 15] };
const SEASONS = Object.keys(SEASON_DATES);

// Tuning constants (HDR units; tone mapping is ACES with exposure ≈ 1)
const K = {
  SKY_I: 32,          // atmosphere brightness
  SUN_I: 3.4,         // direct sunlight at high sun
  DISC_I: 55,         // solar disc radiance (blooms)
  MOON_I: 0.3,        // moonlight
  HEMI_F: 0.28,       // hemisphere light ≈ this fraction of the sky irradiance (Lambert/Phong also get this)
  ENV_I: 0.6,         // scene.environmentIntensity
  CLOUD_SUN: 2.4,     // sunlight on clouds
  GROUND: [0.15, 0.16, 0.115], // average ground albedo (bounce light & lower half of the environment map)
  HEIGHT_FOG: 1.6e-4, // height-fog extinction at the reference height (1/m)
  HEIGHT_FALL: 1 / 55,// height-fog falloff (1/m)
  HEIGHT_REF: 32,     // height-fog reference altitude (world y, m) — Junction Hollow floor is ~15–30
  HAZE_GAIN: 0.85,    // horizon haze brightness relative to the physical sky at HZ_EL
  CLOUD_SHADOW: 0.8,  // how much a cloud dims direct sun/moon light
  HAZE_M: 9000,       // atmospheric haze: extinction 1/HAZE_M per metre at ground level (× weather fog) on 'high'
  EDGE_FADE: 1300,    // world-edge fade width (m), ending just inside the terrain skirt's outer edge
  SKIRT: 3150,        // how far the terrain skirt reaches beyond the data bounds (terrain.js SKIRT_OFFSETS ≈ 3200)
};
const HZ_EL = 3;      // elevation (deg) at which the horizon haze colour is sampled
// Anti-solar haze tint at low sun (Earth's shadow / Belt of Venus side: lavender-blue), luminance-normalised below
const ANTI_TINT = [0.9, 0.95, 1.22];

// ------------------------------------------------------------------------------------------------ global fog patch
// Shared (by reference) uniform values: UniformsUtils.clone() keeps plain objects by reference, so every material
// compiled after this module loads reads these objects directly. Materials whose uniforms lack them (a module that
// merged UniformsLib.fog before this file loaded) read zeros: no height fog, no sun lobe, no anti-solar tint and no
// world-edge fade; the haze itself still works.
export const FOG_SHARED = {
  sunDir: { x: 0, y: 1, z: 0 },
  sunColor: { x: 0, y: 0, z: 0 },
  params: { x: 0, y: 0, z: 0, w: 8 },   // x: height falloff (1/m) · y: reference height · z: height-fog density · w: sun lobe exponent
  anti: { x: 0, y: 0, z: 0 },           // anti-solar haze colour (0 = same as fogColor)
  edge: { x: 0, y: 0, z: 0, w: 0 },     // world-edge fade: xy centre · z start radius · w end radius (w ≤ z = off)
};

function installFogChunks() {
  const C = THREE.ShaderChunk;
  if (C.fog_fragment.includes('fogParams')) return;
  C.fog_pars_vertex = /* glsl */`
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogWorldPos;
#endif
`;
  C.fog_vertex = /* glsl */`
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogWorldPos = cameraPosition + ( vec4( mvPosition.xyz, 0.0 ) * viewMatrix ).xyz;
#endif
`;
  C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorldPos;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
	uniform vec3 fogSunDir;
	uniform vec3 fogSunColor;
	uniform vec4 fogParams;
	uniform vec3 fogAnti;
	uniform vec4 fogEdge;
	// mean relative density along a ray rising dy metres from height h (density ∝ exp(-b·h)); written as a
	// difference of the two end densities so it cannot overflow for high cameras
	float cmuFogLayer( float b, float h, float dy ) {
		float t = b * dy;
		if ( abs( t ) < 1e-3 ) return exp( - b * h ) * ( 1.0 - 0.5 * t );
		return ( exp( - b * h ) - exp( - b * ( h + dy ) ) ) / t;
	}
#endif
`;
  C.fog_fragment = /* glsl */`
#ifdef USE_FOG
	vec3 fogRay = vFogWorldPos - cameraPosition;
	float fogDist = length( fogRay );
	#ifdef FOG_EXP2
		// atmospheric haze (Beer–Lambert; density falls off with a 1.2 km scale height, so it thins when seen from
		// above) + exponential ground fog, both integrated along the ray
		float fogCamH = cameraPosition.y - fogParams.y;
		float fogHaze = max( cmuFogLayer( 1.0 / 1200.0, fogCamH, fogRay.y ), 0.05 );
		float fogLow = min( cmuFogLayer( fogParams.x, fogCamH, fogRay.y ), 8.0 );
		float fogFactor = 1.0 - exp( - fogDensity * fogDist * fogHaze - fogParams.z * fogDist * fogLow );
		// world edge: fade by horizontal radius around the data centre (never right in front of the camera)
		if ( fogEdge.w > fogEdge.z ) {
			float fogR = length( vFogWorldPos.xz - fogEdge.xy );
			fogFactor = max( fogFactor, smoothstep( fogEdge.z, fogEdge.w, fogR ) * smoothstep( 150.0, 600.0, fogDist ) );
		}
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
	#endif
	vec3 fogDir = fogRay / max( fogDist, 1e-3 );
	// sun glare lobe: for the distant landscape (on near objects the thin haze would tint whole facades)
	float fogSun = pow( max( dot( fogDir, fogSunDir ), 0.0 ), max( fogParams.w, 1.0 ) ) * smoothstep( 100.0, 1200.0, fogDist );
	// airlight: warm towards the sun, anti-solar colour away from it (same weighting as the sky's horizon band)
	vec3 fogCol = fogColor;
	if ( fogAnti.x + fogAnti.y + fogAnti.z > 0.0 ) {
		float fogSL = length( fogSunDir.xz ), fogRL = length( fogDir.xz );
		float fogW = ( fogSL > 1e-4 && fogRL > 1e-4 ) ? pow( clamp( 0.5 + 0.5 * dot( fogDir.xz, fogSunDir.xz ) / ( fogSL * fogRL ), 0.0, 1.0 ), 1.5 ) : 1.0;
		fogCol = mix( fogAnti, fogColor, fogW );
	}
	// downward rays: the air in front of the ground is dimmer and cooler than the horizon sky (matches sky.js)
	fogCol = ( fogCol + fogSunColor * fogSun ) * mix( vec3( 1.0 ), vec3( 0.74, 0.79, 0.86 ), smoothstep( 0.0, - 0.35, fogDir.y ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, fogFactor );
#endif
`;
  const extra = {
    fogSunDir: { value: FOG_SHARED.sunDir },
    fogSunColor: { value: FOG_SHARED.sunColor },
    fogParams: { value: FOG_SHARED.params },
    fogAnti: { value: FOG_SHARED.anti },
    fogEdge: { value: FOG_SHARED.edge },
  };
  Object.assign(THREE.UniformsLib.fog, extra);
  for (const key of Object.keys(THREE.ShaderLib)) {
    const u = THREE.ShaderLib[key].uniforms;
    if (u && 'fogColor' in u) Object.assign(u, extra);
  }
}
installFogChunks();

// ------------------------------------------------------------------------------------------------ cloud shadows
// The sun/moon (directional light 0 — the shadow caster sorts first) is attenuated by the same cloud field the sky
// draws, projected along the light direction onto the cloud layer. Uniforms shared by reference as above;
// materials without them (x = 0) are unaffected.
export const CLOUD_SHADOW = {
  a: { x: 0, y: 2300, z: 0.6, w: 0.1 },  // x: strength (0 = off) · y: layer height · z: coverage threshold · w: softness
  b: { x: 0, y: 0, z: 0, w: 0 },         // xy: wind offset (m) · zw: light direction xz / y
};
function installCloudShadowChunks() {
  const C = THREE.ShaderChunk;
  if (C.lights_pars_begin.includes('cmuCloudShade')) return;
  C.lights_pars_begin += /* glsl */`
uniform vec4 cmuCloudShadow;
uniform vec4 cmuCloudShadowP;
float cmuHash12( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
float cmuNoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( cmuHash12( i ), cmuHash12( i + vec2( 1.0, 0.0 ) ), u.x ),
	            mix( cmuHash12( i + vec2( 0.0, 1.0 ) ), cmuHash12( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
// same field as cloudField() in sky.js (4 octaves), sampled where the light ray from wp crosses the cloud layer
float cmuCloudShade( vec3 wp ) {
	if ( cmuCloudShadow.x <= 0.0 ) return 1.0;
	vec2 q = wp.xz + cmuCloudShadowP.zw * ( cmuCloudShadow.y - wp.y ) + cmuCloudShadowP.xy;
	vec2 p = q * ( 1.0 / 1700.0 );
	p += ( vec2( cmuNoise( p * 0.6 + 3.7 ), cmuNoise( p * 0.6 + 11.1 ) ) - 0.5 ) * 0.35;
	p += ( vec2( cmuNoise( p * 2.3 + 5.2 ), cmuNoise( p * 2.3 + 17.9 ) ) - 0.5 ) * 0.12;
	float s = 0.0, a = 0.5, n = 0.0;
	vec2 pp = p;
	for ( int k = 0; k < 4; k ++ ) {
		s += a * cmuNoise( pp ); n += a;
		pp = mat2( 1.6, 1.2, - 1.2, 1.6 ) * pp + vec2( 3.1, 1.7 );
		a *= 0.5;
	}
	float f = ( s / n ) * 0.74 + cmuNoise( p * 0.17 + 7.3 ) * 0.26;
	return 1.0 - cmuCloudShadow.x * smoothstep( cmuCloudShadow.z, cmuCloudShadow.z + cmuCloudShadow.w, f );
}
`;
  const hook = 'getDirectionalLightInfo( directionalLight, directLight );';
  if (C.lights_fragment_begin.includes(hook)) {
    // cmuSunVis (cloud shade of light 0) is also read by the fill balance (installIblChunks)
    C.lights_fragment_begin = 'float cmuSunVis = 1.0;\n' + C.lights_fragment_begin.replace(hook, hook + `
		#if ( UNROLLED_LOOP_INDEX == 0 )
		cmuSunVis = cmuCloudShade( cameraPosition + ( vec4( geometryPosition, 0.0 ) * viewMatrix ).xyz );
		directLight.color *= cmuSunVis;
		#endif`);
  } else {
    console.warn('[env] lights_fragment_begin changed — cloud shadows disabled');
  }
  const extra = { cmuCloudShadow: { value: CLOUD_SHADOW.a }, cmuCloudShadowP: { value: CLOUD_SHADOW.b }, cmuCascade: { value: CASCADE.a }, cmuIbl: { value: IBL.a } };
  Object.assign(THREE.UniformsLib.lights, extra);
  for (const key of Object.keys(THREE.ShaderLib)) {
    const u = THREE.ShaderLib[key].uniforms;
    if (u && 'directionalLights' in u) Object.assign(u, extra);
  }
}

// ------------------------------------------------------------------------------------------------ shadow cascades
// 'high': two shadow maps for the sun. Directional light 0 (the sun itself) carries the MAIN cascade (the whole
// area around what the camera looks at, up to 1.8 km across); light 1 ('sunNear', intensity 0 — it only exists for
// its shadow map) carries a NEAR cascade of ~140 m in front of a low viewer at 3–5 cm per texel. The patched
// shadow lookup of light 0 uses the near map where the fragment lies inside it (blending into the main map across
// the outer 12 % of the near box) and the main map elsewhere. Light 1 is skipped entirely in the lighting loop (no
// shadow lookup, no BRDF evaluation): a stand-in light must not cost a second light's worth of shading per pixel.
// Presets with one shadow light (medium) compile the original code (NUM_DIR_LIGHT_SHADOWS == 1).
// x: 1 = near map in use this frame · y: blend band (fraction of the box) · z: 1 = light 1 is the stand-in
export const CASCADE = { a: { x: 0, y: 0.12, z: 0, w: 0 } };
function installCascadeChunks() {
  const C = THREE.ShaderChunk;
  if (C.shadowmap_pars_fragment.includes('cmuSunShadow')) return;
  const line = 'directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow( directionalShadowMap[ i ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, directionalLightShadow.shadowRadius, vDirectionalShadowCoord[ i ] ) : 1.0;';
  if (!C.lights_fragment_begin.includes(line)) { console.warn('[env] lights_fragment_begin changed — shadow cascades disabled'); return; }
  C.lights_pars_begin += /* glsl */`
uniform vec4 cmuCascade;
`;
  C.shadowmap_pars_fragment += /* glsl */`
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 1
	// three's getShadow() samples with implicit derivatives, which the D3D shader compiler (ANGLE) cannot keep
	// inside a dynamic branch: it flattens the branch and runs every lookup. The same PCF-soft filter with explicit
	// LOD keeps the branches real, so a fragment pays for one shadow lookup (two only in the cascade blend band).
	float cmuCmp( sampler2D depths, vec2 uv, float compare ) {
		return step( compare, unpackRGBAToDepth( textureLod( depths, uv, 0.0 ) ) );
	}
	float cmuPCF( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, vec4 shadowCoord ) {
		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;
		if ( shadowCoord.x < 0.0 || shadowCoord.x > 1.0 || shadowCoord.y < 0.0 || shadowCoord.y > 1.0 || shadowCoord.z > 1.0 ) return 1.0;
		vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
		float dx = texelSize.x, dy = texelSize.y, z = shadowCoord.z;
		vec2 uv = shadowCoord.xy;
		vec2 f = fract( uv * shadowMapSize + 0.5 );
		uv -= f * texelSize;
		float s = cmuCmp( shadowMap, uv, z ) + cmuCmp( shadowMap, uv + vec2( dx, 0.0 ), z ) + cmuCmp( shadowMap, uv + vec2( 0.0, dy ), z ) + cmuCmp( shadowMap, uv + texelSize, z )
			+ mix( cmuCmp( shadowMap, uv + vec2( - dx, 0.0 ), z ), cmuCmp( shadowMap, uv + vec2( 2.0 * dx, 0.0 ), z ), f.x )
			+ mix( cmuCmp( shadowMap, uv + vec2( - dx, dy ), z ), cmuCmp( shadowMap, uv + vec2( 2.0 * dx, dy ), z ), f.x )
			+ mix( cmuCmp( shadowMap, uv + vec2( 0.0, - dy ), z ), cmuCmp( shadowMap, uv + vec2( 0.0, 2.0 * dy ), z ), f.y )
			+ mix( cmuCmp( shadowMap, uv + vec2( dx, - dy ), z ), cmuCmp( shadowMap, uv + vec2( dx, 2.0 * dy ), z ), f.y )
			+ mix( mix( cmuCmp( shadowMap, uv + vec2( - dx, - dy ), z ), cmuCmp( shadowMap, uv + vec2( 2.0 * dx, - dy ), z ), f.x ),
			       mix( cmuCmp( shadowMap, uv + vec2( - dx, 2.0 * dy ), z ), cmuCmp( shadowMap, uv + vec2( 2.0 * dx, 2.0 * dy ), z ), f.x ), f.y );
		return mix( 1.0, s * ( 1.0 / 9.0 ), shadowIntensity );
	}
	// sun shadow: near map where the fragment lies inside it (blending into the main map across the outer band)
	float cmuSunShadow() {
		DirectionalLightShadow s0 = directionalLightShadows[ 0 ];
		float wNear = 0.0;
		if ( cmuCascade.x > 0.5 ) {
			vec3 p1 = vDirectionalShadowCoord[ 1 ].xyz / vDirectionalShadowCoord[ 1 ].w;
			vec2 e1 = abs( p1.xy - 0.5 ) * 2.0;
			wNear = ( p1.z >= 0.0 && p1.z <= 1.0 ) ? 1.0 - smoothstep( 1.0 - cmuCascade.y, 1.0, max( e1.x, e1.y ) ) : 0.0;
		}
		float sh = 1.0;
		if ( wNear < 0.999 ) sh = cmuPCF( directionalShadowMap[ 0 ], s0.shadowMapSize, s0.shadowIntensity, s0.shadowBias, vDirectionalShadowCoord[ 0 ] );
		if ( wNear > 0.001 ) {
			DirectionalLightShadow s1 = directionalLightShadows[ 1 ];
			sh = mix( sh, cmuPCF( directionalShadowMap[ 1 ], s1.shadowMapSize, s0.shadowIntensity, s1.shadowBias, vDirectionalShadowCoord[ 1 ] ), wNear );
		}
		return sh;
	}
#endif
`;
  const B = C.lights_fragment_begin;
  const s0 = B.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )'), s1 = B.indexOf('#pragma unroll_loop_end', s0);
  const direct = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  if (s0 < 0 || s1 < 0 || !B.slice(s0, s1).includes(direct)) { console.warn('[env] lights_fragment_begin changed — shadow cascades disabled'); return; }
  // light 0: cascaded sun shadow · light 1: the stand-in (cmuCascade.z = 1) is skipped — no lookup, no BRDF
  const section = B.slice(s0, s1).replace(line, `
		#if ( NUM_DIR_LIGHT_SHADOWS > 1 ) && defined( SHADOWMAP_TYPE_PCF_SOFT ) && ( UNROLLED_LOOP_INDEX == 0 )
		if ( directLight.visible && receiveShadow ) directLight.color *= cmuSunShadow();
		#elif ( NUM_DIR_LIGHT_SHADOWS > 1 ) && defined( SHADOWMAP_TYPE_PCF_SOFT ) && ( UNROLLED_LOOP_INDEX == 1 )
		if ( cmuCascade.z < 0.5 && directLight.visible && receiveShadow ) directLight.color *= cmuPCF( directionalShadowMap[ 1 ], directionalLightShadow.shadowMapSize, directionalLightShadow.shadowIntensity, directionalLightShadow.shadowBias, vDirectionalShadowCoord[ 1 ] );
		#else
		${line}
		#endif`).replace(direct, `#if ( NUM_DIR_LIGHT_SHADOWS > 1 ) && ( UNROLLED_LOOP_INDEX == 1 )
		if ( cmuCascade.z < 0.5 )
		#endif
		${direct}`);
  C.lights_fragment_begin = B.slice(0, s0) + section + B.slice(s1);
}
// ------------------------------------------------------------------------------------------------ fill balance
// The environment map (PMREM of the sky + ground) lights every standard material twice: diffuse irradiance and
// specular reflections; the hemisphere light adds more sky fill. Where the sun shines (and is not hidden by the
// drifting clouds), the diffuse IBL is scaled by cmuIbl.x and the hemisphere light by cmuIbl.y (see 'flat' in
// recompute()) so that sunlit and shaded ground differ by a believable ~3.7 : 1 instead of ~2.6 : 1; reflections on
// glass and metal keep their full strength. Under a cloud shadow the full (overcast-like) fill is kept.
export const IBL = { a: { x: 1, y: 1, z: 0, w: 0 } };
function installIblChunks() {
  const C = THREE.ShaderChunk;
  if (C.lights_fragment_maps.includes('cmuIbl')) return;
  const hook = 'iblIrradiance += getIBLIrradiance( geometryNormal );';
  const hemi = 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal );';
  if (!C.lights_fragment_maps.includes(hook) || !C.lights_fragment_begin.includes(hemi) || !C.lights_fragment_begin.includes('cmuSunVis')) {
    console.warn('[env] lighting chunks changed — fill balance disabled');
    return;
  }
  C.lights_pars_begin += /* glsl */`
uniform vec4 cmuIbl;
`;
  C.lights_fragment_maps = C.lights_fragment_maps.replace(hook, 'iblIrradiance += getIBLIrradiance( geometryNormal ) * mix( 1.0, cmuIbl.x, cmuSunVis );');
  C.lights_fragment_begin = C.lights_fragment_begin.replace(hemi, 'irradiance += getHemisphereLightIrradiance( hemisphereLights[ i ], geometryNormal ) * mix( 1.0, cmuIbl.y, cmuSunVis );');
}
installCloudShadowChunks();
installCascadeChunks();
installIblChunks();

// ------------------------------------------------------------------------------------------------ astronomy
function nthSunday(y, m, n) {
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  return 1 + ((7 - first) % 7) + (n - 1) * 7;
}
// Hours to add to America/New_York local clock time to get UTC (EDT 4, EST 5; DST 2nd Sun Mar … 1st Sun Nov).
export function utcOffset(y, m, d) {
  const start = nthSunday(y, 3, 2), end = nthSunday(y, 11, 1);
  const dst = (m > 3 && m < 11) || (m === 3 && d >= start) || (m === 11 && d < end);
  return dst ? 4 : 5;
}

// NOAA solar position (accurate to ~0.01°). Returns declination, hour angle (radians) and Julian day.
export function sunEquatorial(y, m, d, hoursLocal) {
  const off = utcOffset(y, m, d);
  const ms = Date.UTC(y, m - 1, d) + (hoursLocal + off) * 3.6e6;
  const jd = ms / 864e5 + 2440587.5, T = (jd - 2451545) / 36525;
  const L0 = (((280.46646 + T * (36000.76983 + T * 0.0003032)) % 360) + 360) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const C = Math.sin(M * D2R) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * M * D2R) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * D2R) * 0.000289;
  const om = 125.04 - 1934.136 * T;
  const lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * D2R);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(om * D2R);
  const decl = Math.asin(Math.sin(eps * D2R) * Math.sin(lam * D2R));
  const yy = Math.tan(eps * D2R / 2) ** 2;
  const eot = 4 / D2R * (yy * Math.sin(2 * L0 * D2R) - 2 * e * Math.sin(M * D2R)
    + 4 * e * yy * Math.sin(M * D2R) * Math.cos(2 * L0 * D2R) - 0.5 * yy * yy * Math.sin(4 * L0 * D2R)
    - 1.25 * e * e * Math.sin(2 * M * D2R));
  const tst = (hoursLocal + off) * 60 + eot + 4 * LON;       // true solar time (minutes)
  return { decl, ha: (tst / 4 - 180) * D2R, jd };
}

// Equatorial (hour angle, declination) → world direction (x east, y up, z south).
export function horizonDir(ha, decl, out = new THREE.Vector3()) {
  const phi = LAT * D2R;
  const cd = Math.cos(decl), sd = Math.sin(decl), ch = Math.cos(ha), sh = Math.sin(ha);
  const east = -cd * sh;
  const north = Math.cos(phi) * sd - Math.sin(phi) * cd * ch;
  const up = Math.sin(phi) * sd + Math.cos(phi) * cd * ch;
  return out.set(east, up, -north).normalize();
}

// Local sidereal time (radians) for a Julian day
function localSidereal(jd) {
  const gmst = 280.46061837 + 360.98564736629 * (jd - 2451545);
  return ((gmst + LON) % 360) * D2R;
}

// ------------------------------------------------------------------------------------------------ helpers
// Own keys only: ?weather=constructor / toString / __proto__ must not pass as a preset (plain lookups inherit them).
const isWeather = (w) => typeof w === 'string' && Object.prototype.hasOwnProperty.call(WEATHER, w);
// Time speed (simulated s per real s): finite, at most one day per second either way (Infinity / 1e400 made hours NaN).
const sanitizeSpeed = (v) => {
  const k = Number(v);
  return Number.isFinite(k) ? Math.max(-86400, Math.min(86400, k)) : 0;
};
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const srgb = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
// direction from elevation/azimuth (degrees, azimuth clockwise from north) written into out
const dirEA = (elDeg, azDeg, out) => {
  const el = elDeg * D2R, az = azDeg * D2R;
  out[0] = Math.sin(az) * Math.cos(el); out[1] = Math.sin(el); out[2] = -Math.cos(az) * Math.cos(el);
  return out;
};
const SKY_SAMPLES = [[12, 0.5], [35, 1], [65, 1]];   // (elevation, weight) rings for the sky irradiance average
const UP3 = [0, 1, 0], MID3 = [0, 0.5, 0.866];
const CLOUD_NIGHT_AMB = [0.010, 0.013, 0.021], CLOUD_CITY_TINT = [0.012, 0.007, 0.003];

export function createEnvironment(ctx) {
  const { scene, renderer } = ctx;
  const params = new URLSearchParams(location.search);
  const shotMode = ctx.shotMode ?? params.has('shot');

  // ---------------------------------------------------------------- state
  let season = SEASONS.includes(params.get('season')) ? params.get('season') : 'autumn';
  let weatherKey = null;                  // null = season default
  if (isWeather(params.get('weather'))) weatherKey = params.get('weather');
  const hp = parseFloat(params.get('hours'));
  let timeSpeed = sanitizeSpeed(parseFloat(params.get('timeSpeed'))); // simulated seconds per real second
  const state = {
    hours: Number.isFinite(hp) ? ((hp % 24) + 24) % 24 : 15.0,
    sunDir: new THREE.Vector3(0, 1, 0),   // towards the sun (also valid below the horizon)
    moonDir: new THREE.Vector3(0, -1, 0),
    lightDir: new THREE.Vector3(0, 1, 0), // direction of the active DirectionalLight (sun or moon)
    nightFactor: 0,
    sunElevation: 0,                       // degrees
    sunAzimuth: 0,                         // degrees from north, clockwise
    season,
    weather: weatherKey || SEASON_WEATHER[season],
    date: '',
    timeSpeed,
  };

  // ---------------------------------------------------------------- lights
  scene.background = null;
  const sun = new THREE.DirectionalLight(0xffffff, K.SUN_I);
  sun.name = 'sun';
  sun.castShadow = !!ctx.quality.shadows;
  sun.shadow.mapSize.set(ctx.quality.shadowMapSize, ctx.quality.shadowMapSize);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 3000;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.1;
  sun.target.name = 'sunTarget';
  sun.shadow.autoUpdate = false;           // updateShadow() decides when each cascade is re-rendered
  // Near shadow cascade ('high' only): a light without light of its own — see installCascadeChunks().
  const sunNear = new THREE.DirectionalLight(0xffffff, 0);
  sunNear.name = 'sunNear';
  sunNear.shadow.autoUpdate = false;
  sunNear.shadow.camera.near = 1;
  sunNear.target.name = 'sunNearTarget';
  const hemi = new THREE.HemisphereLight(0xdfeaff, 0x5d5a48, 0.9);
  hemi.name = 'hemi';
  const ambient = new THREE.AmbientLight(0xffffff, 0.05);
  ambient.name = 'ambient';
  // the sun must stay directional light 0 (cloud shadows, cascades): added first, before sunNear
  scene.add(sun, sun.target, hemi, ambient);
  const cascadesWanted = (q) => !!q.shadows && q.level === 'high';
  function setupCascades(q) {
    const on = cascadesWanted(q);
    if (on && !sunNear.parent) scene.add(sunNear, sunNear.target);
    else if (!on && sunNear.parent) { scene.remove(sunNear, sunNear.target); sunNear.shadow.map?.dispose(); sunNear.shadow.map = null; }
    sunNear.castShadow = on;
    CASCADE.a.z = on ? 1 : 0;
    const ms = on ? q.shadowMapSize : 1024;
    if (sunNear.shadow.mapSize.x !== ms) { sunNear.shadow.mapSize.set(ms, ms); sunNear.shadow.map?.dispose(); sunNear.shadow.map = null; }
    CASCADE.a.x = 0;                       // updateShadow() switches it on together with the near map's first render
  }
  setupCascades(ctx.quality);

  // ---------------------------------------------------------------- sky objects
  const sky = createSkyObjects({ pixelRatio: renderer.getPixelRatio() });
  const U = sky.uniforms;
  scene.add(sky.sky, sky.stars, sky.moon);
  const snow = createSnow(ctx);
  scene.add(snow.points);

  const fog = new THREE.FogExp2(0xbfd0e0, 0.0006);
  scene.fog = fog;

  // ---------------------------------------------------------------- environment map (PMREM of the sky)
  const envScene = new THREE.Scene();
  envScene.add(sky.envSky);
  const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType, generateMipmaps: false });
  const cubeCam = new THREE.CubeCamera(0.1, 10, cubeRT);
  envScene.add(cubeCam);
  const pmrem = new THREE.PMREMGenerator(renderer);
  let pmremRT = null;
  const envLast = { dir: new THREE.Vector3(0, -2, 0), night: -1, cover: -1, t: -1e9, pending: true };
  // sky-view LUT: rebuilt when the sun moved (> 0.05°) or the haze changed
  const lutLast = { dir: new THREE.Vector3(0, -2, 0), mie: -1 };
  function updateLut(force = false) {
    if (!force && state.sunDir.angleTo(lutLast.dir) < 0.05 * D2R && lutLast.mie === U.uMieBeta.value) return;
    sky.renderLut(renderer);
    lutLast.dir.copy(state.sunDir); lutLast.mie = U.uMieBeta.value;
  }
  function regenEnv() {
    updateLut();
    cubeCam.update(renderer, envScene);
    pmremRT = pmrem.fromCubemap(cubeRT.texture, pmremRT);
    scene.environment = pmremRT.texture;
    envLast.dir.copy(state.sunDir); envLast.night = state.nightFactor; envLast.cover = U.uCloudCover.value;
    envLast.pending = false;
  }
  // Start compiling the environment programs now — renderer.compile() only issues the compile, which runs in the
  // background where KHR_parallel_shader_compile exists — and allocate the PMREM target up front, so scene.environment
  // (part of every standard material's program key) already has its final form when the app precompiles its shaders.
  // The first real LUT / cube / PMREM render happens on the first frame (envLast.pending), long after the compile.
  function warmEnvironment() {
    const prev = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(cubeRT);   // off-screen like the real passes: linear output, no tone mapping
      if (typeof pmrem._setSize === 'function' && typeof pmrem._allocateTargets === 'function' && typeof pmrem._compileMaterial === 'function') {
        pmrem._setSize(256);              // = cubeRT size, exactly what fromCubemap() will use
        pmremRT = pmrem._allocateTargets();
        pmrem.compileCubemapShader();
        if (pmrem._blurMaterial) pmrem._compileMaterial(pmrem._blurMaterial);
      }
      renderer.compile(envScene, cubeCam);
      sky.compileLut(renderer);
    } catch (e) {
      console.warn('[env] environment warm-up failed', e);
      pmremRT?.dispose(); pmremRT = null;
    } finally {
      renderer.setRenderTarget(prev);
    }
    if (pmremRT) scene.environment = pmremRT.texture;
    else regenEnv();                      // private PMREM API unavailable: generate synchronously (old path)
  }

  // ---------------------------------------------------------------- scratch
  const a3 = [0, 0, 0], b3 = [0, 0, 0], c3 = [0, 0, 0], t3 = [0, 0, 0], tc3 = [0, 0, 0], n3 = [0, 0, 0];
  const d3 = [0, 0, 0], e3 = [0, 0, 0], tint3 = [0, 0, 0];
  const sunArr = [0, 1, 0];
  const starMat = new THREE.Matrix4();
  const vx = new THREE.Vector3(), vy = new THREE.Vector3(), vz = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const skyAvg = [0, 0, 0], horizonBase = [0, 0, 0], horizonSun = [0, 0, 0], horizonAnti = [0, 0, 0], ground = [0, 0, 0];
  const nightZen = [...NIGHT.zenith], nightHor = [...NIGHT.horizon];
  let horizonK = 8;
  let lightIsSun = true;
  let dateSeason = null;

  // ---------------------------------------------------------------- core recompute
  function currentWeather() {
    const k = weatherKey || SEASON_WEATHER[season];
    return isWeather(k) ? WEATHER[k] : WEATHER.partly;
  }

  function recompute() {
    const [m, d] = SEASON_DATES[season];
    if (dateSeason !== season) { state.date = `${YEAR}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`; dateSeason = season; }
    const W = currentWeather();
    state.weather = weatherKey || SEASON_WEATHER[season];
    ATMO.BETA_M = W.mie;
    U.uMieBeta.value = W.mie;

    // --- sun & moon positions
    const eq = sunEquatorial(YEAR, m, d, state.hours);
    horizonDir(eq.ha, eq.decl, state.sunDir);
    const sd = state.sunDir;
    const el = Math.asin(THREE.MathUtils.clamp(sd.y, -1, 1)) / D2R;
    state.sunElevation = el;
    state.sunAzimuth = ((Math.atan2(sd.x, -sd.z) / D2R) + 360) % 360;
    horizonDir(eq.ha - 165 * D2R, -eq.decl * 0.95 + 0.02, state.moonDir);  // waxing gibbous, opposite declination
    sunArr[0] = sd.x; sunArr[1] = sd.y; sunArr[2] = sd.z;

    // --- day/night
    const nf = 1 - smoothstep(-8, 4, el);
    state.nightFactor = nf;
    const twilightGain = 1 + 2.6 * (1 - smoothstep(-6, 6, el)); // eye adaptation for the dimming sky
    const skyI = K.SKY_I * twilightGain;
    const cover = W.cover;
    const overcast = smoothstep(0.45, 0.95, cover);
    // Daylight balance: the environment map already carries the sky's diffuse light (and the ground bounce), so under
    // a clear sky with a reasonably high sun the hemisphere light is only a small fill, the diffuse IBL is scaled down
    // (reflections are not) and the sun gets a little stronger: sunlit : shaded ground ≈ 3.7 : 1 instead of 2.6 : 1,
    // i.e. deeper, more legible shadows at about the same brightness. Night, dull skies and a low (weak, red) sun keep
    // the flatter balance, where the sky is the main light.
    const flat = Math.max(nf, overcast, 1 - smoothstep(4, 16, el));

    // --- sunlight
    transmittance(sunArr, ATMO.VIEW_H, t3);
    const tMax = Math.max(t3[0], t3[1], t3[2], 1e-6);
    const sunFade = smoothstep(-1.0, 1.5, el);
    const sunI = K.SUN_I * Math.pow(tMax, 0.55) * sunFade * W.sun * (1 + 0.12 * (1 - flat));
    const moonUp = smoothstep(-0.02, 0.12, state.moonDir.y);
    const moonI = K.MOON_I * moonUp * smoothstep(-1.5, -9, el) * (1 - 0.6 * overcast);
    lightIsSun = el > -1.2 || moonI <= 0;
    if (lightIsSun) {
      state.lightDir.copy(sd);
      sun.color.setRGB(t3[0] / tMax, t3[1] / tMax, t3[2] / tMax);
      sun.intensity = sunI;
    } else {
      state.lightDir.copy(state.moonDir);
      sun.color.setRGB(0.62, 0.72, 1.0);
      sun.intensity = moonI;
    }
    sun.shadow.intensity = 1 - 0.9 * overcast;   // an overcast sky casts (almost) no shadows
    sunNear.shadow.intensity = sun.shadow.intensity;

    // --- sky shader uniforms
    U.uSunDir.value.copy(sd);
    U.uSunI.value = skyI;
    U.uSunDisc.value.set(t3[0], t3[1], t3[2]).multiplyScalar(K.DISC_I * sunFade * (1 - 0.8 * overcast));
    U.uNight.value = nf;
    U.uCityGlow.value = 0.6 + cover * 0.8;
    // blue hour: once single scattering has faded (sun −5…−12°) keep the sky a deep twilight blue
    const blue = smoothstep(-13, -6, el) * (1 - smoothstep(-4, -1, el));
    for (let k = 0; k < 3; k++) {
      nightZen[k] = NIGHT.zenith[k] + NIGHT.blueZenith[k] * blue;
      nightHor[k] = NIGHT.horizon[k] + NIGHT.blueHorizon[k] * blue;
    }
    U.uNightZenith.value.fromArray(nightZen);
    U.uNightHorizon.value.fromArray(nightHor);
    sky.setMoon(state.moonDir);
    U.uMoonUp.value = moonUp * nf;
    U.uMilkyWay.value = (1 - cover) * nf * nf;
    U.uCloudCover.value = cover;
    sky.starUniforms.uStarI.value = nf * nf * 2.1;
    sky.moonUniforms.uMoonAlpha.value = 0.28 + 0.72 * nf;
    const mb = 0.9 + 2.6 * nf;
    sky.moonUniforms.uMoonColor.value.set(mb * 0.96, mb * 0.98, mb);

    // --- celestial rotation for stars (RA 0 → x, pole → y, RA 90° → z)
    const lst = localSidereal(eq.jd);
    horizonDir(lst, 0, vx); horizonDir(0, Math.PI / 2, vy); horizonDir(lst - Math.PI / 2, 0, vz);
    starMat.makeBasis(vx, vy, vz);
    sky.stars.matrix.copy(starMat);
    sky.stars.matrixWorld.copy(starMat);
    U.uStarRot.value.setFromMatrix4(starMat).transpose();

    // --- sky irradiance (cosine-weighted average over the upper hemisphere) and horizon haze
    skyAvg[0] = skyAvg[1] = skyAvg[2] = 0;
    let wsum = 0;
    for (const [e, w] of SKY_SAMPLES) {
      for (let az = 0; az < 360; az += 90) {
        scatter(dirEA(e, az + 20, d3), sunArr, skyI, U.uMieG.value, a3);
        const ww = w * Math.sin(e * D2R + 0.2);
        for (let k = 0; k < 3; k++) skyAvg[k] += a3[k] * ww;
        wsum += ww;
      }
    }
    scatter(UP3, sunArr, skyI, U.uMieG.value, a3);
    for (let k = 0; k < 3; k++) skyAvg[k] = (skyAvg[k] + a3[k] * 1.5) / (wsum + 1.5);
    nightSkyJS(MID3, U.uCityGlow.value, nightZen, nightHor, n3);
    for (let k = 0; k < 3; k++) skyAvg[k] += n3[k] * nf;

    // horizon: azimuth-average + sun lobe fitted to the scattering model
    horizonBase[0] = horizonBase[1] = horizonBase[2] = 0;
    for (let az = 0; az < 360; az += 45) {
      scatter(dirEA(HZ_EL, az, d3), sunArr, skyI, U.uMieG.value, a3);
      for (let k = 0; k < 3; k++) horizonBase[k] += a3[k] / 8;
    }
    nightSkyJS(dirEA(HZ_EL, 0, d3), U.uCityGlow.value, nightZen, nightHor, n3);
    for (let k = 0; k < 3; k++) horizonBase[k] += n3[k] * nf;
    const saz = state.sunAzimuth;
    const d0 = dirEA(HZ_EL, saz, d3), d45 = dirEA(HZ_EL, saz + 45, e3);
    scatter(d0, sunArr, skyI, U.uMieG.value, b3);
    scatter(d45, sunArr, skyI, U.uMieG.value, c3);
    const mu0 = d0[0] * sd.x + d0[1] * sd.y + d0[2] * sd.z, mu45 = d45[0] * sd.x + d45[1] * sd.y + d45[2] * sd.z;
    const l0 = lum(b3) - lum(horizonBase), l45 = lum(c3) - lum(horizonBase);
    horizonK = 8;
    if (l0 > 1e-5 && l45 > 1e-6 && mu0 > mu45 + 1e-3 && mu45 > 0.01) horizonK = Math.log(l0 / l45) / Math.log(mu0 / mu45);
    horizonK = THREE.MathUtils.clamp(horizonK || 8, 1.5, 48);
    const amp = mu0 > 0.05 ? Math.min(1.6, 1 / Math.pow(mu0, horizonK)) : 0;
    for (let k = 0; k < 3; k++) horizonSun[k] = Math.max(0, b3[k] - horizonBase[k]) * amp;
    // anti-solar horizon (before horizonBase is modified below)
    scatter(dirEA(HZ_EL, saz + 180, d3), sunArr, skyI, U.uMieG.value, a3);
    nightSkyJS(d3, U.uCityGlow.value, nightZen, nightHor, n3);
    for (let k = 0; k < 3; k++) horizonAnti[k] = a3[k] + n3[k] * nf;
    // Single scattering makes the low horizon yellow-green (no multiple-scattered blue); real haze is a neutral,
    // slightly blue white. Pull the haze towards that (more under clouds), keeping its luminance — less so at low sun,
    // so the sun side of a golden-hour sky stays warm.
    const hl = lum(horizonBase) * K.HAZE_GAIN;
    const lowSun = 1 - smoothstep(4, 12, el);
    const neutral = ((0.45 + 0.45 * cover) * (1 - lowSun) + (0.25 + 0.5 * cover) * lowSun) * (1 - 0.5 * nf);
    const tint = tint3; tint[0] = 0.87 - 0.04 * nf; tint[1] = 0.98; tint[2] = 1.17 + 0.1 * nf;
    for (let k = 0; k < 3; k++) {
      horizonBase[k] = horizonBase[k] * K.HAZE_GAIN * (1 - neutral) + hl * tint[k] * neutral;
      horizonSun[k] *= 1 - 0.7 * overcast;
    }
    // At low sun the sky away from the sun is the cool side (Earth's shadow / Belt of Venus), not the orange
    // azimuth average: facades facing away from a setting sun must read blue-grey. Daytime keeps a uniform band.
    const antiK = (1 - smoothstep(3, 14, el)) * (1 - smoothstep(0.3, 0.9, nf)) * (1 - 0.6 * overcast);
    const al = lum(horizonAnti) * K.HAZE_GAIN * 0.8 / lum(ANTI_TINT);
    for (let k = 0; k < 3; k++) {
      const cool = horizonAnti[k] * K.HAZE_GAIN * 0.15 + al * ANTI_TINT[k] * 0.85;
      horizonAnti[k] = horizonBase[k] + (cool - horizonBase[k]) * antiK;
    }

    // ground bounce (for the environment's lower hemisphere and the hemisphere light)
    const sinEl = Math.max(0, sd.y);
    for (let k = 0; k < 3; k++) {
      const E = sunI * (t3[k] / tMax) * sinEl + Math.PI * skyAvg[k] * 0.9 + moonI * 0.2;
      ground[k] = K.GROUND[k] * E / Math.PI;
    }

    U.uHorizon.value.fromArray(horizonBase);
    U.uHorizonAnti.value.fromArray(horizonAnti);
    U.uAntiCool.value = antiK * 0.8;
    U.uHorizonSun.value.fromArray(horizonSun);
    U.uHorizonK.value = horizonK;
    U.uGround.value.fromArray(ground);
    // skyline in the environment map (sky.js surroundings()): vertical faces see half sky, half ground; the sun
    // (not the moon) lights the faces turned towards it
    const sunH = lightIsSun ? sunI * Math.sqrt(Math.max(0, 1 - sd.y * sd.y)) / Math.PI : 0;
    U.uSurroundSky.value.set(0.5 * (skyAvg[0] + ground[0]), 0.5 * (skyAvg[1] + ground[1]), 0.5 * (skyAvg[2] + ground[2]));
    U.uSurroundSun.value.set(sunH * t3[0] / tMax, sunH * t3[1] / tMax, sunH * t3[2] / tMax);

    // --- clouds lighting
    const cloudDay = smoothstep(-3, 2, el);
    transmittance(sunArr, U.uCloudHeight.value, tc3);
    U.uCloudLightDir.value.copy(cloudDay > 0.02 ? sd : state.moonDir);
    // A closed deck is lit through itself: its underside is a dull grey only a little brighter than the clear sky it
    // replaces (it also lights the scene through the environment map, so it must not outshine the sun it hides).
    const cs = K.CLOUD_SUN * cloudDay * (1 - 0.75 * overcast);
    const mc = 0.05 * moonUp * nf;
    U.uCloudSun.value.set(tc3[0] * cs + mc * 0.7, tc3[1] * cs + mc * 0.8, tc3[2] * cs + mc);
    scatter(UP3, sunArr, skyI, U.uMieG.value, a3);
    const za = lum(skyAvg);
    for (let k = 0; k < 3; k++) {
      const v = (za * 0.9 + a3[k] * 0.5) * (1 - 0.35 * overcast) + nf * CLOUD_NIGHT_AMB[k] + CLOUD_CITY_TINT[k] * nf * U.uCityGlow.value;
      tc3[k] = Math.max(v, (a3[k] + nightZen[k] * nf) * 1.25 * (1 - overcast));   // never darker than the sky behind
    }
    U.uCloudAmb.value.fromArray(tc3);

    // --- hemisphere + ambient fill
    const skyMax = Math.max(skyAvg[0], skyAvg[1], skyAvg[2], 1e-6);
    // extra fill at night so moonlit scenes stay readable
    const nightFill = 0.024 * nf;
    hemi.color.setRGB((skyAvg[0] + nightFill * 0.7) / (skyMax + nightFill), (skyAvg[1] + nightFill * 0.85) / (skyMax + nightFill), (skyAvg[2] + nightFill) / (skyMax + nightFill));
    hemi.groundColor.setRGB(ground[0] / skyMax, ground[1] / skyMax, ground[2] / skyMax);
    // (daylight balance: see 'flat' above)
    // (an overcast deck is a bright dome, a little more diffuse light than a clear sky — but far less than sun + sky)
    hemi.intensity = K.HEMI_F * Math.PI * (skyMax + nightFill) * (1 + 0.15 * overcast);
    ambient.color.copy(hemi.color);
    ambient.intensity = hemi.intensity * 0.12;
    scene.environmentIntensity = K.ENV_I * (1 + 0.1 * overcast);
    IBL.a.x = 0.8 + 0.2 * flat;           // diffuse IBL where the sun shines
    IBL.a.y = 0.35 + 0.65 * flat;         // hemisphere fill where the sun shines

    // --- exposure (mild eye adaptation at night and under a dull sky) — before the fog, whose non-post colour
    // depends on it
    renderer.toneMappingExposure = 1.0 + 0.3 * nf + 0.25 * overcast;

    // --- fog
    applyFog();

    snow.setIntensity(W.snow);

    // --- does the environment map need a refresh?
    if (state.sunDir.angleTo(envLast.dir) > 0.8 * D2R || Math.abs(nf - envLast.night) > 0.02 || Math.abs(cover - envLast.cover) > 0.01) envLast.pending = true;
  }

  // Fog colour must match the sky horizon in whichever pipeline renders: with post-processing, fog is mixed in linear
  // HDR before tone mapping; without it, three mixes fog after tone mapping + sRGB encoding.
  let fogMode = null;
  function applyFog() {
    const W = currentWeather();
    const post = !!ctx.engine?.postActive;
    fogMode = post;
    // Atmospheric haze: a physical extinction coefficient, not tied to the draw distance (the world edge has its own
    // fade). Lower presets cull trees/cars earlier, so their haze is slightly denser to soften that.
    const dd = ctx.quality.drawDistance || 3200;
    fog.density = W.fog / (K.HAZE_M * Math.sqrt(Math.min(1, dd / 3200)));
    FOG_SHARED.params.x = K.HEIGHT_FALL;
    FOG_SHARED.params.y = K.HEIGHT_REF;
    FOG_SHARED.params.z = K.HEIGHT_FOG * W.fog;
    FOG_SHARED.params.w = horizonK;
    FOG_SHARED.sunDir.x = state.sunDir.x; FOG_SHARED.sunDir.y = state.sunDir.y; FOG_SHARED.sunDir.z = state.sunDir.z;
    const E = FOG_SHARED.edge, B = ctx.data?.meta?.bounds;
    if (B) {
      const r1 = Math.min(B.maxX - B.minX, B.maxZ - B.minZ) / 2 + K.SKIRT;
      E.x = (B.minX + B.maxX) / 2; E.y = (B.minZ + B.maxZ) / 2; E.z = r1 - K.EDGE_FADE; E.w = r1;
    }
    const A = FOG_SHARED.anti;
    if (post) {
      fog.color.setRGB(horizonBase[0], horizonBase[1], horizonBase[2]);
      FOG_SHARED.sunColor.x = horizonSun[0]; FOG_SHARED.sunColor.y = horizonSun[1]; FOG_SHARED.sunColor.z = horizonSun[2];
      A.x = Math.max(horizonAnti[0], 1e-6); A.y = Math.max(horizonAnti[1], 1e-6); A.z = Math.max(horizonAnti[2], 1e-6);
    } else {
      // three converts fog.color to the output (sRGB) space itself; the plain-object uniforms must be sRGB already
      const ex = renderer.toneMappingExposure;
      acesFilmic(horizonBase, ex, a3);
      for (let k = 0; k < 3; k++) b3[k] = horizonBase[k] + horizonSun[k];
      acesFilmic(b3, ex, b3);
      fog.color.setRGB(a3[0], a3[1], a3[2]);
      FOG_SHARED.sunColor.x = srgb(b3[0]) - srgb(a3[0]);
      FOG_SHARED.sunColor.y = srgb(b3[1]) - srgb(a3[1]);
      FOG_SHARED.sunColor.z = srgb(b3[2]) - srgb(a3[2]);
      acesFilmic(horizonAnti, ex, c3);
      A.x = Math.max(srgb(c3[0]), 1e-6); A.y = Math.max(srgb(c3[1]), 1e-6); A.z = Math.max(srgb(c3[2]), 1e-6);
    }
    tmpC.copy(fog.color);
    renderer.setClearColor(tmpC, 1);
  }

  // cloud shadows follow the sky's cloud layer (off on 'low' quality)
  function updateCloudShadow() {
    const cover = U.uCloudCover.value;
    const L = state.lightDir;
    const ly = Math.max(0.06, L.y);
    const on = ctx.quality.level !== 'low' && cover > 0.02;
    const overcast = smoothstep(0.45, 0.95, cover);
    CLOUD_SHADOW.a.x = on ? K.CLOUD_SHADOW * (1 - 0.85 * overcast) * smoothstep(0.0, 0.1, L.y) : 0;
    CLOUD_SHADOW.a.y = U.uCloudHeight.value;
    CLOUD_SHADOW.a.z = 0.5 + (0.5 - cover) * 0.42;     // = cloudThreshold() in sky.js
    CLOUD_SHADOW.a.w = 0.05;                            // crisp edges (penumbra of a 2 km-high cloud is ~20 m)
    if (CLOUD_SHADOW.debugThreshold !== undefined) CLOUD_SHADOW.a.z = CLOUD_SHADOW.debugThreshold;
    CLOUD_SHADOW.b.x = U.uCloudOffset.value.x; CLOUD_SHADOW.b.y = U.uCloudOffset.value.y;
    CLOUD_SHADOW.b.z = L.x / ly; CLOUD_SHADOW.b.w = L.z / ly;
  }

  // ---------------------------------------------------------------- shadow frustums that follow the view
  // MAIN cascade (the sun's own map; the only one below 'high'): orbit → around the orbit target, sized by the
  // camera distance; walk / fly → ahead of the viewer. For a low camera it is stretched back so that it always
  // covers the ground right in front of the viewer too (an eye-level orbit view of a far target used to have no
  // shadows in the foreground). NEAR cascade ('high', low cameras only): a small box from the bottom of the view
  // forward. Both are square, symmetric (props / vegetation cull their shadow casters against the main box, which
  // contains the near box), size-quantised (≈9 % steps) and texel-snapped so the shadows don't shimmer.
  const SH = { frames: 0 };
  // Refresh of the shadow maps for animated casters (people, cars, swaying trees), and the minimum number of frames
  // between two shadow passes, per CPU degrade level (engine 'perf:degrade'): on a CPU-bound machine running at
  // 12 fps a 30 Hz refresh re-rendered every caster every frame. With a near cascade the main map holds only the
  // distant casters and refreshes less often.
  const SHADOW_HZ = [30, 15, 10, 6];
  const SHADOW_HZ_FAR = [12, 8, 5, 3];
  const SHADOW_EVERY = [1, 2, 3, 4];
  let perfLevel = 0;
  renderer.shadowMap.autoUpdate = false;   // this module owns shadow refreshes (updateShadow sets needsUpdate)
  renderer.shadowMap.needsUpdate = true;
  const newCascade = (light) => ({ light, half: 0, far: 0, t: -1e9, center: new THREE.Vector3(1e9, 0, 0), light0: new THREE.Vector3(0, -1, 0) });
  const CM = newCascade(sun), CN = newCascade(sunNear);
  let nearActive = false;
  const fwd = new THREE.Vector3(), lx = new THREE.Vector3(), ly = new THREE.Vector3(), center = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const clamp = THREE.MathUtils.clamp;
  const fit = { mx: 0, mz: 0, mh: 0, nx: 0, nz: 0, nh: 0, near: false };

  function fitShadows() {
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    cam.getWorldDirection(fwd);
    const cp = cam.position;
    const camH = Math.max(0, cp.y - ctx.heightAt(cp.x, cp.z));
    const fl = Math.hypot(fwd.x, fwd.z);
    let fx, fz;
    if (fl > 1e-3) { fx = fwd.x / fl; fz = fwd.z / fl; } else {
      const e = cam.matrixWorld.elements;    // looking straight down: "ahead" is the top of the screen
      const ul = Math.hypot(e[4], e[6]) || 1;
      fx = e[4] / ul; fz = e[6] / ul;
    }
    // horizontal distance from the camera to the nearest visible ground (bottom edge of the view)
    const bot = Math.asin(clamp(-fwd.y, -1, 1)) + THREE.MathUtils.degToRad(cam.fov) / 2;
    const g0 = bot > 0.01 ? Math.min(camH / Math.tan(Math.min(bot, 1.5)), 400) : 0;
    const low = camH < 70;
    const nearWanted = low && sunNear.castShadow;
    const hn = clamp(70 + camH * 1.2, 70, 150);
    const gn = Math.min(g0, 40) + hn * 0.55;             // near box centre, metres ahead of the camera
    let half, mx, mz;
    const st = ctx.nav?.getState?.();
    const tgt = st && st.mode === 'orbit' ? st.target : null;
    if (tgt) {
      const tx = tgt[0] ?? tgt.x, ty = tgt[1] ?? tgt.y, tz = tgt[2] ?? tgt.z;
      const dist = Math.hypot(cp.x - tx, cp.y - ty, cp.z - tz);
      half = clamp(0.8 * dist + 0.1 * camH, 70, 900);
      mx = tx + fx * half * 0.2; mz = tz + fz * half * 0.2;
    } else {
      // where the view ray meets the ground (flat approximation); with a near cascade the main one reaches farther
      const t = fwd.y < -0.02 ? camH / -fwd.y : Infinity;
      const reach = Math.min(t, 1500, Math.max(nearWanted ? 600 : 160, camH * 3));
      half = clamp(0.55 * reach + 0.3 * camH, 70, 900);
      const ahead = Math.min(0.6 * half, reach);
      mx = cp.x + fx * ahead; mz = cp.z + fz * ahead;
    }
    if (low) {
      // stretch the main box along the view so it also covers the near box (never beyond 900 m half-size)
      const a = (mx - cp.x) * fx + (mz - cp.z) * fz;
      const lo = Math.min(a - half, gn - hn);
      let hi = Math.max(a + half, gn + hn);
      if (hi - lo > 1800) hi = lo + 1800;
      if (lo < a - half || hi > a + half) {
        const na = (lo + hi) / 2;
        mx += fx * (na - a); mz += fz * (na - a);
        half = Math.max(half, (hi - lo) / 2);
      }
    }
    fit.mx = mx; fit.mz = mz; fit.mh = half;
    // the near cascade only pays off when it is clearly finer than the main one
    fit.near = nearWanted && half > hn * 1.35;
    fit.nx = cp.x + fx * gn; fit.nz = cp.z + fz * gn; fit.nh = hn;
  }

  // Position cascade c (light, shadow camera, biases) around ground point (x, z) with half-size `half`. Returns
  // true when its map is re-rendered this frame. The light, its shadow camera and the biases are only touched
  // together with a new shadow pass, so a map that is not re-rendered stays consistent with the matrix it was
  // rendered with (three updates shadow.matrix inside the shadow pass).
  function placeCascade(c, x, z, half, L, force, hz, now) {
    if (!Number.isFinite(half) || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    half = Math.pow(2, Math.ceil(Math.log2(half) * 8) / 8);
    center.set(x, ctx.heightAt(x, z), z);
    const texel = (2 * half) / c.light.shadow.mapSize.x;
    // light-space basis identical to the one three builds for the shadow camera (lookAt with up = +Y)
    lx.crossVectors(UP, L);
    if (lx.lengthSq() < 1e-8) lx.set(1, 0, 0);
    lx.normalize();
    ly.crossVectors(L, lx);
    const u = center.dot(lx), v = center.dot(ly);
    center.addScaledVector(lx, Math.round(u / texel) * texel - u).addScaledVector(ly, Math.round(v / texel) * texel - v);
    const elev = Math.max(0.05, L.y);
    const R = clamp(260 / Math.tan(Math.asin(elev)), 300, 2600) + half;
    const far = R + half * 1.5 + 250;
    const moved = half !== c.half || Math.abs(far - c.far) > 1 || c.center.distanceToSquared(center) > 1e-6 || c.light0.dot(L) < 1 - 1e-10;
    if (!force && !moved && now - c.t < 1000 / hz - 2) return false;
    const light = c.light;
    light.target.position.copy(center);
    light.position.copy(center).addScaledVector(L, R);
    const sc = light.shadow.camera;
    if (half !== c.half || Math.abs(far - c.far) > 1) {
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.near = 1; sc.far = far;
      sc.updateProjectionMatrix();
      c.half = half; c.far = far;
    }
    light.shadow.normalBias = texel * 1.4;
    light.shadow.bias = -Math.max(0.03, texel * 0.6) / far;
    c.center.copy(center); c.light0.copy(L);
    light.shadow.needsUpdate = true;
    c.t = now;
    return true;
  }

  function updateShadow(force = false) {
    const L = state.lightDir;
    if (!sun.castShadow) {
      // no shadow map ('low'): only the light direction matters — keep it following the sun / moon
      sun.target.position.set(0, 0, 0);
      sun.position.copy(L).multiplyScalar(1000);
      CASCADE.a.x = 0;
      return;
    }
    SH.frames++;
    if (!force && SH.frames < SHADOW_EVERY[perfLevel]) return;
    fitShadows();
    const now = performance.now();
    const lvl = perfLevel;
    let did = placeCascade(CM, fit.mx, fit.mz, fit.mh, L, force, fit.near ? SHADOW_HZ_FAR[lvl] : SHADOW_HZ[lvl], now);
    if (fit.near) {
      // the near map must exist before the shader uses it: a freshly activated cascade is rendered this frame
      if (placeCascade(CN, fit.nx, fit.nz, fit.nh, L, force || !nearActive, SHADOW_HZ[lvl], now)) did = true;
      nearActive = true;
    } else nearActive = false;
    CASCADE.a.x = nearActive ? 1 : 0;
    if (did) { renderer.shadowMap.needsUpdate = true; SH.frames = 0; }
  }
  // Re-render every shadow map on the next frame (context restore, preset change).
  function refreshShadows() {
    CM.t = CN.t = -1e9; CM.half = CN.half = 0;
    sun.shadow.needsUpdate = true;
    if (sunNear.castShadow) sunNear.shadow.needsUpdate = true;
    renderer.shadowMap.needsUpdate = true;
  }
  ctx.events?.on?.('perf:degrade', (p) => {
    const k = Math.round(Number(p?.cpu ?? p?.level) || 0);
    perfLevel = Math.max(0, Math.min(SHADOW_HZ.length - 1, k));
  });

  // ---------------------------------------------------------------- per-frame update
  let lastEmit = -1e9, emitPending = true;
  const cloudWind = new THREE.Vector2();
  ctx.onUpdate((dt, elapsed) => {
    if (timeSpeed) {
      state.hours = (((state.hours + (dt * timeSpeed) / 3600) % 24) + 24) % 24;
      if (!Number.isFinite(state.hours)) { state.hours = 15; timeSpeed = 0; state.timeSpeed = 0; }   // safety net
      recompute();
      emitPending = true;
    }
    if (!!ctx.engine?.postActive !== fogMode) applyFog();

    // clouds drift with the wind
    const w = currentWeather().wind;
    cloudWind.set(w[0], w[1]);
    U.uCloudOffset.value.addScaledVector(cloudWind, dt * (shotMode ? 0 : 1));
    U.uTime.value = elapsed;
    updateCloudShadow();

    updateLut();
    updateShadow();
    const pr = renderer.getPixelRatio();          // may change at runtime (engine's dynamic resolution)
    sky.starUniforms.uPx.value = pr;
    snow.update(dt, elapsed, ctx.camera, Math.min(1, (lightIsSun ? sun.intensity / K.SUN_I : 0) * 0.8 + hemi.intensity * 0.3), pr);

    const now = performance.now();
    if (envLast.pending && now - envLast.t > (timeSpeed ? 250 : 60)) { regenEnv(); envLast.t = now; }
    if (emitPending && now - lastEmit >= 100) {
      emitPending = false; lastEmit = now;
      ctx.events.emit('env:change', state);
    }
  }, 0);

  ctx.events.on('quality', (q) => {
    const want = !!q.shadows;
    if (sun.castShadow !== want) sun.castShadow = want;
    if (sun.shadow.mapSize.x !== q.shadowMapSize) {
      sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    snow.rebuild(q.level);
    sky.starUniforms.uPx.value = renderer.getPixelRatio();
    applyFog();
    setupCascades(q);
    refreshShadows();           // re-fit the frustums and re-render the shadow maps with the new settings
    updateShadow(true);
    updateCloudShadow();
  });

  // ---------------------------------------------------------------- API
  const env = {
    sun, sunNear, hemi, ambient, state,
    sky, snow,
    refreshShadows,
    fogUniforms: FOG_SHARED, cloudShadowUniforms: CLOUD_SHADOW, cascadeUniforms: CASCADE,   // shared shader uniforms (debug / advanced use)
    setTime(h) {
      h = Number(h);
      if (!Number.isFinite(h)) return;
      state.hours = ((h % 24) + 24) % 24;
      recompute();
      emitPending = true;
    },
    getTime: () => state.hours,
    // k = simulated seconds per real second (0 = frozen, 60 = one minute per second, 3600 = one hour per second)
    setTimeSpeed(k) { timeSpeed = sanitizeSpeed(k); state.timeSpeed = timeSpeed; },
    getTimeSpeed: () => timeSpeed,
    setSeason(s) {
      if (!SEASONS.includes(s) || s === season) return;
      season = s; state.season = s;
      recompute();
      emitPending = true;
      ctx.events.emit('env:season', s);
    },
    // 'clear' | 'partly' | 'cloudy' | 'overcast' | 'snow' | 'auto' (season default)
    setWeather(w) {
      weatherKey = isWeather(w) ? w : null;
      recompute();
      emitPending = true;
    },
    getWeather: () => state.weather,
    weathers: Object.keys(WEATHER),
    seasons: SEASONS,
    // Bring the sky LUT, environment map, cloud shadows and the shadow frustum up to date for the current camera
    // right now (engine.precompile() calls this before its hidden warm-up frame, so the first visible frame doesn't
    // have to render the environment map).
    prepareFrame() {
      if (!!ctx.engine?.postActive !== fogMode) applyFog();
      updateCloudShadow();
      updateLut();
      updateShadow(true);
      if (envLast.pending) { regenEnv(); envLast.t = performance.now(); }
    },
    // Re-render the sky LUT and the environment map (next frame, or right now with immediate = true). Also the
    // recovery path after a WebGL context restore, where every render-target texture comes back empty.
    refreshEnvironment(immediate = false) {
      lutLast.mie = -1;                      // forces sky.renderLut() even though the sun has not moved
      refreshShadows();
      if (immediate) regenEnv(); else { envLast.pending = true; envLast.t = -1e9; }
    },
  };
  ctx.env = env;

  recompute();
  warmEnvironment();
  updateShadow();
  updateCloudShadow();
  return env;
}
