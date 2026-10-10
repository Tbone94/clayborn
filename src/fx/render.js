// Renderer + "miniature diorama" post stack: tilt-shift, warm vignette, film grain.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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
        // golden-angle disc blur
        for (int i = 1; i < 24; i++) {
          float fi = float(i);
          float a = fi * 2.39996;
          float rr = sqrt(fi / 24.0) * r * 10.0;
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
    }`,
};

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  let dpr = Math.min(window.devicePixelRatio, 1.75);
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
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, rt);
  const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.5, 1.15);
  const diorama = new ShaderPass(DioramaShader);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(diorama);
  composer.addPass(new OutputPass());

  const api = {
    renderer, composer, envMap, diorama, bloom,
    // adaptive resolution: keep it smooth on laptops & phones
    perf: { acc: 0, n: 0 },
    adapt(dt) {
      const p = this.perf; p.acc += dt; p.n++;
      if (p.acc < 2) return;
      const avg = p.acc / p.n; p.acc = 0; p.n = 0;
      const maxDpr = Math.min(window.devicePixelRatio, 1.75);
      if (avg > 1 / 45 && dpr > 0.75) { dpr = Math.max(0.75, dpr - 0.25); renderer.setPixelRatio(dpr); this.resize(); }
      else if (avg < 1 / 58 && dpr < maxDpr) { dpr = Math.min(maxDpr, dpr + 0.25); renderer.setPixelRatio(dpr); this.resize(); }
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
