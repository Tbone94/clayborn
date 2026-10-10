// Plasticine / felt / vinyl / jelly material with procedural patterns painted in
// rest-pose object space, so spots and stripes stick to the body as it moves.
import * as THREE from 'three';

// Gloom zones shared by every gloom-aware material: (x, z, radius, strength)
export const GLOOM = { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, 0, 0, 0)) };

export const PATTERNS = ['solid', 'spots', 'stripes', 'patches', 'belly', 'speckle', 'gradient', 'lava', 'stars'];
export const FINISHES = ['clay', 'felt', 'vinyl', 'jelly'];

export const NOISE_GLSL = /* glsl */`
float hash31(vec3 p){ p = fract(p*vec3(0.1031,0.1030,0.0973)); p += dot(p, p.yzx+33.33); return fract((p.x+p.y)*p.z); }
vec3 hash33(vec3 p){ p = fract(p*vec3(0.1031,0.1030,0.0973)); p += dot(p, p.yxz+33.33); return fract((p.xxy+p.yxx)*p.zyx); }
// gradient noise (no grid-aligned artifacts), remapped to 0..1
vec3 grad3(vec3 i){ return normalize(hash33(i)*2.0-1.0 + 1e-4); }
float vnoise(vec3 p){
  vec3 i = floor(p), f = fract(p); vec3 u = f*f*f*(f*(f*6.0-15.0)+10.0);
  float n000 = dot(grad3(i), f), n100 = dot(grad3(i+vec3(1,0,0)), f-vec3(1,0,0));
  float n010 = dot(grad3(i+vec3(0,1,0)), f-vec3(0,1,0)), n110 = dot(grad3(i+vec3(1,1,0)), f-vec3(1,1,0));
  float n001 = dot(grad3(i+vec3(0,0,1)), f-vec3(0,0,1)), n101 = dot(grad3(i+vec3(1,0,1)), f-vec3(1,0,1));
  float n011 = dot(grad3(i+vec3(0,1,1)), f-vec3(0,1,1)), n111 = dot(grad3(i+vec3(1,1,1)), f-vec3(1,1,1));
  float n = mix(mix(mix(n000,n100,u.x), mix(n010,n110,u.x), u.y), mix(mix(n001,n101,u.x), mix(n011,n111,u.x), u.y), u.z);
  return n*0.9 + 0.5;
}
float fbm3(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+17.1; a*=0.5; } return s; }
// worley: x = F1, y = F2
vec2 worley(vec3 p){
  vec3 i = floor(p), f = fract(p); float d1 = 9.0, d2 = 9.0;
  for(int z=-1;z<=1;z++) for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec3 g = vec3(x,y,z); vec3 o = hash33(i+g); vec3 r = g + o - f; float d = dot(r,r);
    if(d<d1){ d2=d1; d1=d; } else if(d<d2){ d2=d; }
  }
  return sqrt(vec2(d1,d2));
}
`;

const PATTERN_GLSL = /* glsl */`
uniform vec3 uColA; uniform vec3 uColB; uniform int uPattern; uniform float uBump; uniform float uFuzz;
uniform float uSeed; uniform float uTime;
varying vec3 vRestPos; varying vec3 vRestNormal;

${NOISE_GLSL}
#ifdef USE_GLOOM
uniform vec4 uZones[4]; varying vec3 vGWorld;
float gloomAt(vec3 w){ float g = 0.0; for(int i=0;i<4;i++){ vec4 z = uZones[i]; if(z.z <= 0.0) continue;
  float d = length(w.xz - z.xy); g = max(g, z.w * (1.0 - smoothstep(z.z*0.55, z.z, d + (vnoise(w*0.35)-0.5)*3.0))); } return g; }
#endif
float patMask(vec3 p, vec3 n, out float glow){
  glow = 0.0;
  vec3 q = p + uSeed;
  if(uPattern==1){ vec2 w = worley(q*5.0); return 1.0 - smoothstep(0.28,0.34,w.x + 0.08*vnoise(q*14.0)); }
  if(uPattern==2){ float s = sin((p.x*9.0 + fbm3(q*2.5)*3.5)*3.14159); return smoothstep(0.25,0.4,s); }
  if(uPattern==3){ return smoothstep(0.5,0.54, fbm3(q*2.4)); }
  if(uPattern==4){ return smoothstep(-0.05,-0.35, n.y) * (1.0 - smoothstep(0.15, 0.3, abs(n.z)*0.6)); }
  if(uPattern==5){ return step(0.86, hash31(floor(q*38.0))) * step(0.3, vnoise(q*38.0)); }
  if(uPattern==6){ return smoothstep(0.2, 1.6, p.y + 0.25*fbm3(q*3.0)); }
  if(uPattern==7){ vec2 w = worley(q*4.0); float c = 1.0 - smoothstep(0.0, 0.09, w.y - w.x);
    glow = c * (0.75 + 0.25*sin(uTime*2.0 + p.y*6.0)); return c; }
  if(uPattern==8){ float st = step(0.93, hash31(floor(q*30.0))) * smoothstep(0.6,0.1,length(fract(q*30.0)-0.5)*2.0);
    glow = st; return st; }
  return 0.0;
}
float clayHeight(vec3 p){
  vec3 q = p + uSeed;
  #ifdef CLAY_CHEAP
  return vnoise(q*14.0)*0.5 + vnoise(q*40.0)*0.25;
  #endif
  float h = fbm3(q*14.0) * 0.6;
  vec2 w = worley(q*3.0);
  h += sin(w.x*120.0) * 0.18 * smoothstep(0.55, 0.15, w.x);   // fingerprints
  h += vnoise(q*60.0) * uFuzz;                                  // felt fuzz
  return h;
}
vec3 clayPerturb(vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection){
  vec3 vSigmaX = normalize(dFdx(surf_pos)); vec3 vSigmaY = normalize(dFdy(surf_pos));
  vec3 R1 = cross(vSigmaY, surf_norm); vec3 R2 = cross(surf_norm, vSigmaX);
  float fDet = dot(vSigmaX, R1) * faceDirection;
  vec3 vGrad = sign(fDet) * (dHdxy.x*R1 + dHdxy.y*R2);
  return normalize(abs(fDet)*surf_norm - vGrad);
}
`;

export function makeClayMaterial(opts = {}) {
  const uniforms = {
    uColA: { value: new THREE.Color(opts.color || '#ef7d57') },
    uColB: { value: new THREE.Color(opts.color2 || '#ffd36e') },
    uPattern: { value: Math.max(0, PATTERNS.indexOf(opts.pattern || 'solid')) },
    uBump: { value: 0.012 },
    uFuzz: { value: 0 },
    uSeed: { value: (opts.seed ?? Math.random() * 1000) % 7 },
    uTime: { value: 0 },
  };
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.6, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffffff), vertexColors: !!opts.vertexColors });
  mat.userData.uniforms = uniforms;
  mat.defines = { ...(mat.defines || {}) };
  if (opts.gloom) { uniforms.uZones = GLOOM; mat.defines.USE_GLOOM = ''; }
  if (opts.cheap) mat.defines.CLAY_CHEAP = '';
  if (opts.scale) uniforms.uScale = { value: opts.scale };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRestPos; varying vec3 vRestNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRestPos = position * ' + (opts.scale ? opts.scale.toFixed(4) : '1.0') + '; vRestNormal = normal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n#ifdef USE_GLOOM\n vec4 gwp = vec4(transformed, 1.0);\n #ifdef USE_INSTANCING\n gwp = instanceMatrix * gwp;\n #endif\n vGWorld = (modelMatrix * gwp).xyz;\n#endif')
      .replace('#include <common>', '#include <common>\n#ifdef USE_GLOOM\nvarying vec3 vGWorld;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PATTERN_GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float patGlow;
        float pm = patMask(vRestPos, normalize(vRestNormal), patGlow);
        diffuseColor.rgb *= mix(uColA, uColB, pm);
        // a touch of darker tone in creases reads as hand-made
        diffuseColor.rgb *= 0.92 + 0.08*vnoise((vRestPos+uSeed)*6.0);
        #ifdef USE_GLOOM
        { float gl = gloomAt(vGWorld); float lum = dot(diffuseColor.rgb, vec3(0.3,0.59,0.11));
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(lum)*vec3(0.42,0.36,0.55)*0.8, gl); }
        #endif`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          float hh = clayHeight(vRestPos) * uBump;
          normal = clayPerturb(-vViewPosition, normal, vec2(dFdx(hh), dFdy(hh)) * 60.0, faceDirection);
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += patGlow * uColB * 1.3;`);
  };
  mat.customProgramCacheKey = () => 'clay-v3' + (opts.gloom ? 'g' : '') + (opts.cheap ? 'c' : '') + (opts.scale || '');
  applyFinish(mat, opts.finish || 'clay');
  return mat;
}

export function updateClayMaterial(mat, opts) {
  const u = mat.userData.uniforms;
  if (opts.color) u.uColA.value.set(opts.color);
  if (opts.color2) u.uColB.value.set(opts.color2);
  if (opts.pattern) u.uPattern.value = Math.max(0, PATTERNS.indexOf(opts.pattern));
  if (opts.finish) applyFinish(mat, opts.finish);
}

export function applyFinish(mat, finish) {
  const u = mat.userData.uniforms;
  const setTransmission = (v) => { if (mat.transmission !== v) { mat.transmission = v; mat.needsUpdate = true; } };
  if (finish === 'clay') {
    Object.assign(mat, { roughness: 0.62, sheen: 0.45, clearcoat: 0, metalness: 0, thickness: 0 });
    u.uBump.value = 0.014; u.uFuzz.value = 0; setTransmission(0);
  } else if (finish === 'felt') {
    Object.assign(mat, { roughness: 0.95, sheen: 1.0, sheenRoughness: 0.35, clearcoat: 0, metalness: 0, thickness: 0 });
    u.uBump.value = 0.02; u.uFuzz.value = 0.55; setTransmission(0);
  } else if (finish === 'vinyl') {
    Object.assign(mat, { roughness: 0.28, sheen: 0, clearcoat: 1, clearcoatRoughness: 0.12, metalness: 0, thickness: 0 });
    u.uBump.value = 0.002; u.uFuzz.value = 0; setTransmission(0);
  } else if (finish === 'jelly') {
    Object.assign(mat, { roughness: 0.12, sheen: 0, clearcoat: 1, clearcoatRoughness: 0.05, metalness: 0, thickness: 0.8, ior: 1.33, attenuationDistance: 0.6 });
    mat.attenuationColor = mat.attenuationColor || new THREE.Color();
    mat.attenuationColor.copy(u.uColA.value);
    u.uBump.value = 0.001; u.uFuzz.value = 0; setTransmission(0.85);
  }
}
