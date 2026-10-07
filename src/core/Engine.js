import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Pós-processamento final, propositalmente sutil para não cansar a vista:
 * aberração cromática só nas bordas da tela, scanlines leves, vinheta e grão quase imperceptíveis.
 */
const CRTShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uStrength: { value: 1 },
    uFocus: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uStrength;
    uniform float uFocus;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float d = dot(c, c);
      // aberração cromática só perto das bordas (o centro, onde ficam os textos, fica limpo)
      vec2 off = c * smoothstep(0.08, 0.35, d) * 0.006 * uStrength;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      float scan = 0.975 + 0.025 * sin(vUv.y * uRes.y * 1.5708);
      col *= mix(1.0, scan, uStrength);
      col *= 1.0 - d * 0.65;
      // modo foco: periferia mais escura e menos saturada, o holograma ganha destaque
      float periph = smoothstep(0.04, 0.32, d) * uFocus;
      float lum = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(col, vec3(lum), periph * 0.55);
      col *= 1.0 - periph * 0.55;
      col += (hash(vUv * uRes + fract(uTime) * 100.0) - 0.5) * 0.01 * uStrength;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class Engine {
  constructor(container) {
    this.container = container;
    this.quality = 'high';

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0a0014');
    // névoa mais próxima: a cidade distante vira silhueta, e só feixes/emblemas dos projetos atravessam
    this.scene.fog = new THREE.Fog('#3a0a4a', 55, 210);

    this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 2200);
    this.camera.rotation.order = 'YXZ';

    // MSAA no render target do composer (o antialias do canvas não vale para pós-processamento)
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    // Rede de segurança: um único pixel NaN/infinito seria espalhado pelo bloom e apagaria a tela inteira.
    this.composer.addPass(
      new ShaderPass({
        uniforms: { tDiffuse: { value: null } },
        vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D tDiffuse; varying vec2 vUv;
          // NaN/Inf têm o expoente todo em 1; checar os bits é imune às otimizações do compilador
          bool bad(float x) { return (floatBitsToUint(x) & 0x7f800000u) == 0x7f800000u; }
          void main() {
            vec4 c = texture2D(tDiffuse, vUv);
            if (bad(c.r) || bad(c.g) || bad(c.b)) c = vec4(0.0, 0.0, 0.0, 1.0);
            gl_FragColor = vec4(clamp(c.rgb, 0.0, 64.0), c.a);
          }
        `,
      }),
    );

    // Bloom seletivo por HDR: limiar 1.0 => só materiais "neon" (cor > 1) brilham.
    // Textos, telas e painéis ficam abaixo de 1 e permanecem nítidos.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.8, 0.42, 1.0);
    this.composer.addPass(this.bloom);

    this.crt = new ShaderPass(CRTShader);
    this.composer.addPass(this.crt);
    this.composer.addPass(new OutputPass());

    this.timer = new THREE.Timer();
    this.callbacks = [];
    this._onResize = this.resize.bind(this);
    window.addEventListener('resize', this._onResize);
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    const pr = q === 'high' ? Math.min(window.devicePixelRatio, 1.5) : Math.min(window.devicePixelRatio, 1) * 0.75;
    this.renderer.setPixelRatio(pr);
    this.bloom.enabled = true;
    this.bloom.strength = q === 'high' ? 0.8 : 0.6;
    this.resize();
  }

  /** Intensidade do "modo foco" (0 a 1), suavizada. */
  setFocus(target, dt) {
    const u = this.crt.uniforms.uFocus;
    u.value += (target - u.value) * (1 - Math.exp(-4 * dt));
  }

  setCRT(on) {
    this.crt.uniforms.uStrength.value = on ? 1 : 0;
    document.body.classList.toggle('no-crt', !on);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    // O composer repassa o tamanho a cada pass; o bloom já trabalha internamente em meia resolução.
    this.composer.setSize(w, h);
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.crt.uniforms.uRes.value.set(size.x, size.y);
  }

  onUpdate(fn) {
    this.callbacks.push(fn);
  }

  start() {
    this.renderer.setAnimationLoop((time) => {
      this.timer.update(time);
      const dt = Math.min(this.timer.getDelta(), 1 / 20);
      const t = this.timer.getElapsed();
      for (const fn of this.callbacks) fn(dt, t);
      this.crt.uniforms.uTime.value = t;
      this.composer.render(dt);
    });
  }
}
