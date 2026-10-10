// Renderer + "miniature diorama" post stack: tilt-shift, warm vignette, film grain.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QUALITY as Q } from './quality.js';

const DioramaShader = {
  uniforms: {
    tDiffuse: { value: null },
    uRes: { value: new THREE.Vector2(1, 1) },
    uFocus: { value: 0.5 },      // screen-y of the sharp band
    uBand: { value: 0.18 },
    uBlur: { value: 0.0 },       // 0 = off
    uVignette: { value: 0.35 },
    uGrain: { value: 0.035 },
    uTime: { value: 0 },
    uWarm: { value: new THREE.Vector3(1.02, 1.0, 0.96) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform vec2 uRes; uniform float uFocus, uBand, uBlur, uVignette, uGrain, uTime; uniform vec3 uWarm;
    varying vec2 vUv;
    float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233)) + uTime*7.0) * 43758.5453); }
    void main(){
      float d = max(0.0, abs(vUv.y - uFocus) - uBand);
      float r = clamp(d * 2.6, 0.0, 1.0) * uBlur;
      vec4 col = texture2D(tDiffuse, vUv);
      if (r > 0.001) {
        vec4 acc = col; float wsum = 1.0;
        // golden-angle disc blur (TAPS comes from the quality tier)
        for (int i = 1; i < TAPS; i++) {
          float fi = float(i);
          float a = fi * 2.39996;
          float rr = sqrt(fi / float(TAPS)) * r * 10.0;
          vec2 off = vec2(cos(a), sin(a)) * rr / uRes * vec2(uRes.y/720.0);
          acc += texture2D(tDiffuse, vUv + off); wsum += 1.0;
        }
        col = acc / wsum;
      }
      vec2 q = vUv - 0.5;
      float vig = smoothstep(0.85, 0.2, length(q * vec2(1.0, 1.15)));
      col.rgb *= mix(1.0 - uVignette, 1.0, vig);
      col.rgb *= uWarm;
      col.rgb += (rand(vUv * uRes) - 0.5) * uGrain;
      gl_FragColor = col;
      // no-ops while this pass renders into a target (OutputPass follows); when it is the
      // last pass (low/medium tier, OutputPass dropped) three injects tone mapping + sRGB here
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  const maxDpr = () => Math.min(window.devicePixelRatio, Q.maxDpr);
  let dpr = Math.min(window.devicePixelRatio, Q.dpr);
  renderer.setPixelRatio(dpr);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const size = new THREE.Vector2();
  renderer.getDrawingBufferSize(size);
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: Q.msaa });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  // phones skip bloom entirely (its mip chain is ~10 extra full-screen-ish passes)
  const bloom = Q.bloom ? new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.5, 1.15) : { strength: 0, enabled: false };
  const diorama = new ShaderPass({ ...DioramaShader, defines: { TAPS: Q.blurTaps } });
  composer.addPass(renderPass);
  if (Q.bloom) composer.addPass(bloom);
  composer.addPass(diorama);
  // without bloom the diorama pass can tone-map straight to the screen: one less full-screen pass
  if (!Q.tonemapInPost) composer.addPass(new OutputPass());

  const api = {
    renderer, composer, envMap, diorama, bloom, quality: Q,
    // adaptive resolution: keep it smooth on laptops & phones.
    // Phones check more often, drop harder and need two good windows in a row before going back up
    // (so a 60Hz phone doesn't ping-pong between two resolutions).
    perf: { acc: 0, n: 0, good: 0, skip: 1 },
    adapt(dt) {
      const p = this.perf; p.acc += dt; p.n++;
      if (p.acc < Q.adaptEvery) return;
      const avg = p.acc / p.n; p.acc = 0; p.n = 0;
      if (p.skip > 0) { p.skip--; return; } // first window is full of shader compiles
      const hi = maxDpr(), lo = Math.min(Q.minDpr, hi);
      if (avg > 1 / Q.slowFps && dpr > lo) {
        const step = Q.tier === 'high' ? 0.25 : (avg > 1 / 28 ? 0.25 : 0.15);
        dpr = Math.max(lo, dpr - step); p.good = 0; renderer.setPixelRatio(dpr); this.resize();
      } else if (avg < 1 / Q.fastFps && dpr < hi) {
        if (Q.tier !== 'high' && ++p.good < 2) return;
        p.good = 0; dpr = Math.min(hi, dpr + (Q.tier === 'high' ? 0.25 : 0.125)); renderer.setPixelRatio(dpr); this.resize();
      } else p.good = 0;
    },
    render(scene, camera, t) {
      renderPass.scene = scene; renderPass.camera = camera;
      diorama.uniforms.uTime.value = t % 100;
      composer.render();
    },
    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h);
      composer.setSize(w, h);
      renderer.getDrawingBufferSize(size);
      diorama.uniforms.uRes.value.set(size.x, size.y);
    },
    setLook({ blur = 0, focus = 0.5, band = 0.18, vignette = 0.35, bloom: b = 0.35, world = false } = {}) {
      // the "serious" world gets filmic ACES; the Mold Lab keeps punchy neutral colours
      renderer.toneMapping = world ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
      renderer.toneMappingExposure = world ? 0.92 : 0.95;
      diorama.uniforms.uGrain.value = world ? 0.012 : 0.03;
      Object.assign(diorama.uniforms.uBlur, { value: blur });
      diorama.uniforms.uFocus.value = focus;
      diorama.uniforms.uBand.value = band;
      diorama.uniforms.uVignette.value = vignette;
      bloom.strength = b;
    },
  };
  api.resize();
  return api;
}
