import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasTexture, createInfoCanvas, createLabelCanvas, INFO_W, INFO_H } from '../utils/textures.js';
import { ledColorNorm, ledMaterial, frameGeometry, smoothDamp, easeOutBack, igniteFlicker } from './neon.js';

export const SCREEN_W = 6.4;
export const SCREEN_H = 3.6;
const PANEL_W = 4.0;
const PANEL_H = PANEL_W * (INFO_H / INFO_W);
const LENS_Y = 1.6;
const IDLE_Y = 4.6;
const NEAR_Y = 3.4;

/* Base telescópica: posições dos níveis 2 e 3 (fechado -> aberto) */
const T2_CLOSED = 0.3; // nível 2 afundado no nível 1, só um filete aparece
const T2_OPEN = 0.8;
const T3_CLOSED = 0.115; // nível 3 (relativo ao nível 2)
const T3_OPEN = 0.52;
const LENS_OFF = 0.24; // lente acima do centro do nível 3
const IRIS_R = 1.38;
const OPEN_TIME = 1.5; // segundos para abrir
const CLOSE_TIME = 1.1; // segundos para recolher

export const COLLIDER_RADIUS = 4.9;
export const EXPAND_START = 21;
export const INTERACT_RADIUS = 13.5;

/* Materiais compartilhados entre todos os pedestais */
let shared = null;
function getShared() {
  if (shared) return shared;
  shared = {
    metal: new THREE.MeshStandardMaterial({ color: '#1b1430', metalness: 0.75, roughness: 0.42, envMapIntensity: 0.6 }),
    metalDark: new THREE.MeshStandardMaterial({ color: '#0d0a1a', metalness: 0.65, roughness: 0.5, envMapIntensity: 0.6 }),
    tier1: new THREE.CylinderGeometry(4.2, 4.6, 0.5, 64),
    tier2: new THREE.CylinderGeometry(3.0, 3.4, 0.6, 64),
    tier3: new THREE.CylinderGeometry(1.4, 1.8, 0.45, 48),
    ringBig: new THREE.TorusGeometry(4.25, 0.07, 8, 96),
    ringSide: new THREE.TorusGeometry(4.43, 0.05, 6, 96),
    ringMid: new THREE.TorusGeometry(3.05, 0.06, 8, 80),
    ringSmall: new THREE.TorusGeometry(1.45, 0.05, 8, 48),
    lens: new THREE.CircleGeometry(1.1, 48),
    iris: new THREE.CircleGeometry(IRIS_R, 64),
    screen: new THREE.PlaneGeometry(SCREEN_W, SCREEN_H),
    glow: new THREE.PlaneGeometry(SCREEN_W + 2.4, SCREEN_H + 2.4),
    panel: new THREE.PlaneGeometry(PANEL_W, PANEL_H),
    floor: new THREE.RingGeometry(4.7, 7.5, 96),
    brackets: createBracketGeometry(SCREEN_W + 0.5, SCREEN_H + 0.5, 0.9, 0.07),
    beam: createBeamGeometry(),
    particles: createParticleGeometry(48),
    panelFrame: frameGeometry(PANEL_W + 0.14, PANEL_H + 0.14, 0.05),
    screenFrame: frameGeometry(SCREEN_W + 0.08, SCREEN_H + 0.08, 0.035),
  };
  return shared;
}

function createBracketGeometry(w, h, len, th) {
  const parts = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const horiz = new THREE.PlaneGeometry(len, th);
      horiz.translate(sx * (w / 2 - len / 2), sy * (h / 2), 0);
      const vert = new THREE.PlaneGeometry(th, len);
      vert.translate(sx * (w / 2), sy * (h / 2 - len / 2), 0);
      parts.push(horiz, vert);
    }
  }
  // pequenas marcações no meio das bordas
  const tick = new THREE.PlaneGeometry(0.5, th);
  parts.push(tick.clone().translate(0, h / 2 + 0.18, 0), tick.clone().translate(0, -h / 2 - 0.18, 0));
  return mergeGeometries(parts);
}

/** Pirâmide de luz: da lente (quadrado pequeno) até os 4 cantos da tela. */
function createBeamGeometry() {
  const C = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const corner = [];
  const tt = [];
  const uu = [];
  const push = (c, t, u) => {
    corner.push(c[0], c[1]);
    tt.push(t);
    uu.push(u);
  };
  for (let k = 0; k < 4; k++) {
    const a = C[k];
    const b = C[(k + 1) % 4];
    push(a, 0, 0);
    push(b, 0, 1);
    push(b, 1, 1);
    push(a, 0, 0);
    push(b, 1, 1);
    push(a, 1, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Array(tt.length * 3).fill(0), 3));
  geo.setAttribute('aCorner', new THREE.Float32BufferAttribute(corner, 2));
  geo.setAttribute('aT', new THREE.Float32BufferAttribute(tt, 1));
  geo.setAttribute('aU', new THREE.Float32BufferAttribute(uu, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), 10);
  return geo;
}

function createParticleGeometry(n) {
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i++) seed[i] = Math.random();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 4, 0), 10);
  return geo;
}

const beamUniformsShared = /* glsl */ `
  uniform float uW, uH, uY, uX, uLens, uTime, uIntensity;
  uniform vec3 uColor;
`;

const VERT_UV = /* glsl */ `#include <bend_pars>
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * bendView(modelViewMatrix * vec4(position, 1.0)); }
`;

/**
 * Tela do holograma.
 *  - em espera: holograma "vivo" (glitch, aberração cromática, scanlines, tinta da cor do projeto);
 *  - ao ativar: uma linha de LED varre a tela de baixo para cima e, por onde passa,
 *    a imagem fica estável, opaca e limpa para leitura.
 * A moldura da tela é um LED (cor > 1, entra no bloom); o conteúdo fica < 1 (nítido).
 */
function hologramMaterial(map, color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: map },
      uTime: { value: 0 },
      uActive: { value: 0 },
      uWipe: { value: 0 },
      uEdge: { value: 1 },
      uColor: { value: new THREE.Color(color) },
      uSeed: { value: Math.random() * 100 },
    },
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uTime, uActive, uWipe, uEdge, uSeed; uniform vec3 uColor;
      varying vec2 vUv;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        vec2 uv = vUv;
        // parte da tela já "ligada" pela varredura
        float lit = smoothstep(vUv.y, vUv.y + 0.035, uWipe);
        float idle = 1.0 - lit;
        float tick = floor(uTime * 14.0 + uSeed);
        float bandId = floor(uv.y * 30.0);
        float glitch = step(0.975 - idle * 0.05, hash(bandId * 1.7 + tick)) * idle;
        uv.x += glitch * (hash(tick + bandId) - 0.5) * 0.08;
        float ca = (0.003 + glitch * 0.01) * idle;
        vec3 col;
        col.r = texture2D(uMap, uv + vec2(ca, 0.0)).r;
        col.g = texture2D(uMap, uv).g;
        col.b = texture2D(uMap, uv - vec2(ca, 0.0)).b;
        float scan = 1.0 - (0.025 + 0.12 * idle) * (0.5 + 0.5 * sin(vUv.y * 520.0 - uTime * 10.0));
        float sweep = smoothstep(0.08, 0.0, abs(fract(-vUv.y * 0.6 + uTime * 0.22) - 0.5)) * (0.02 + 0.2 * idle);
        col *= scan;
        col += uColor * sweep;
        col = mix(col, col * uColor * 1.6 + uColor * 0.05, 0.3 * idle);
        float flicker = mix(0.9 + 0.1 * hash(tick * 0.37), 1.0, lit);
        // conteúdo sempre abaixo de 1.0 (fora do bloom) => texto nítido
        col *= flicker * mix(0.8, 0.95, lit);
        // linha de LED da varredura (essa sim brilha)
        float bar = smoothstep(0.022, 0.0, abs(vUv.y - uWipe)) * step(0.001, uWipe) * step(uWipe, 1.0);
        col += mix(uColor, vec3(1.0), 0.35) * bar * 2.6;
        // borda fina em LED
        vec2 e = min(vUv, 1.0 - vUv);
        float edge = 1.0 - smoothstep(0.0, 0.006, min(e.x * 1.7778, e.y));
        col += mix(uColor, vec3(1.0), 0.3) * edge * uEdge;
        float alpha = mix(0.74 * flicker, 0.98, lit);
        gl_FragColor = vec4(col, max(alpha, bar));
      }
    `,
  });
}

/**
 * Anel de LED: brilho de base + uma onda de luz que sobe pelos anéis da base,
 * acendendo e apagando de forma contínua (sem segmentos correndo).
 */
function ringLedMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uBase: { value: 1.2 },
      uWave: { value: 0 },
    },
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uBase, uWave;
      varying vec2 vUv;
      void main() {
        gl_FragColor = vec4(mix(uColor, vec3(1.0), uWave * 0.1) * (uBase + uWave), 1.0);
      }
    `,
  });
}

/**
 * Diafragma (íris) de 6 lâminas cobrindo a lente: fechado deixa só uma fresta com borda
 * de LED; ao abrir, as lâminas giram e se recolhem para a borda até sumirem.
 */
function irisMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color }, uOpen: { value: 0 } },
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpen; varying vec2 vUv;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float r = length(p);
        float seg = 6.2832 / 6.0;
        float rot = uOpen * 1.4;
        float a = atan(p.y, p.x) + rot;
        // distância até um hexágono girando: é o furo central das lâminas
        float poly = r * cos(floor(0.5 + a / seg) * seg - a);
        float aperture = mix(0.14, 1.06, uOpen);
        if (poly < aperture) discard;
        // emendas curvas entre as lâminas
        float s = fract((a + r * 1.8) / seg);
        float seam = smoothstep(0.035, 0.0, min(s, 1.0 - s));
        vec3 col = vec3(0.07, 0.05, 0.12) * (0.55 + 0.45 * r);
        col += vec3(0.1, 0.08, 0.16) * pow(max(0.0, sin(a * 3.0 + r * 4.0)), 8.0) * 0.5;
        col = mix(col, uColor * 0.35, seam * 0.6);
        // borda da abertura em LED
        col += mix(uColor, vec3(1.0), 0.3) * smoothstep(0.07, 0.0, poly - aperture) * 1.8;
        // aro externo
        col += uColor * smoothstep(0.04, 0.0, abs(r - 0.97)) * 0.9;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** Painel de informações: aparece de cima para baixo com uma linha de luz, como um display ligando. */
function panelMaterial(map, color) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uMap: { value: map },
      uReveal: { value: 0 },
      uOpacity: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(color) },
    },
    vertexShader: VERT_UV,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uReveal, uOpacity, uTime; uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        float edgeY = 1.0 - uReveal * 1.06;
        float shown = smoothstep(edgeY, edgeY + 0.025, vUv.y);
        vec4 tex = texture2D(uMap, vUv);
        float bar = smoothstep(0.018, 0.0, abs(vUv.y - edgeY)) * step(-0.02, edgeY);
        vec3 col = tex.rgb * 0.96 * (0.975 + 0.025 * sin(vUv.y * 640.0 - uTime * 6.0));
        col += mix(uColor, vec3(1.0), 0.35) * bar * 2.4;
        gl_FragColor = vec4(col, clamp(tex.a * shown + bar, 0.0, 1.0) * uOpacity);
      }
    `,
  });
}

export class Pedestal {
  /**
   * @param {object} item  dados do projeto (ou terminal especial)
   * @param {THREE.Texture} previewTexture  textura mostrada no holograma
   */
  constructor(item, previewTexture, actionLabel) {
    const S = getShared();
    this.item = item;
    this.color = new THREE.Color(item.color || '#ff2a9d');
    this.position = new THREE.Vector3();
    this.group = new THREE.Group();
    this.yaw = 0;
    this.expand = 0;
    this.reveal = 0;
    this.focused = false;
    this.dist = Infinity;
    this.phase = Math.random() * Math.PI * 2;
    this.spring = {}; // velocidades das molas
    this.igniteAt = -10; // momento em que o holograma começou a "ligar"
    this.panelAt = -10; // momento em que o painel começou a abrir
    this.wasActive = false;
    this.wasRevealed = false;

    /* ---------- Base (telescópica: recolhida de longe, abre quando o jogador chega) ---------- */
    const base = new THREE.Group();
    const t1 = new THREE.Mesh(S.tier1, S.metal);
    t1.position.y = 0.25;
    const t2 = new THREE.Mesh(S.tier2, S.metalDark);
    const t3 = new THREE.Mesh(S.tier3, S.metal);
    for (const m of [t1, t2, t3]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    // nível 2 sobe de dentro do nível 1; o nível 3 (com a lente) sobe de dentro do nível 2
    this.stage2 = new THREE.Group();
    this.stage2.position.y = T2_CLOSED;
    this.stage3 = new THREE.Group();
    this.stage3.position.y = T3_CLOSED;
    this.stage2.add(t2, this.stage3);
    this.stage3.add(t3);
    base.add(t1, this.stage2);
    this.open = 0; // progresso linear da abertura (0 fechado -> 1 aberto)
    this.opening = false;

    // Anéis de LED: acendem em sequência, de baixo para cima, acompanhando cada nível
    const hex = '#' + this.color.getHexString();
    this.rings = [
      { geo: S.ringSide, hex: '#00f0ff', y: 0.22, parent: base },
      { geo: S.ringBig, hex, y: 0.51, parent: base },
      { geo: S.ringMid, hex, y: 0.31, parent: this.stage2 },
      { geo: S.ringSmall, hex: '#00f0ff', y: 0.23, parent: this.stage3 },
    ].map((r) => {
      const mat = ringLedMaterial(ledColorNorm(r.hex));
      const mesh = new THREE.Mesh(r.geo, mat);
      mesh.rotation.x = Math.PI / 2;
      mesh.position.y = r.y;
      r.parent.add(mesh);
      return { mat, base: ledColorNorm(r.hex) };
    });

    // Lente que emite o feixe
    this.lensMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uColor: { value: this.color }, uTime: { value: 0 }, uActive: { value: 0 } },
      vertexShader: VERT_UV,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime, uActive; varying vec2 vUv;
        void main(){
          float r = length(vUv - 0.5) * 2.0;
          float core = smoothstep(0.6, 0.0, r);
          float ring = smoothstep(0.08, 0.0, abs(r - 0.82 - 0.06 * sin(uTime * 4.0)));
          float pulse = 0.85 + 0.15 * sin(uTime * 3.0);
          vec3 col = mix(uColor, vec3(1.0), core * 0.5) * (core * (1.6 - 0.7 * uActive) * pulse + ring * (1.4 - 0.6 * uActive));
          gl_FragColor = vec4(col, clamp(core + ring, 0.0, 1.0));
        }
      `,
    });
    const lens = new THREE.Mesh(S.lens, this.lensMat);
    lens.rotation.x = -Math.PI / 2;
    lens.position.y = LENS_OFF;
    this.stage3.add(lens);

    // Íris sobre a lente
    this.irisMat = irisMaterial(ledColorNorm(hex));
    this.iris = new THREE.Mesh(S.iris, this.irisMat);
    this.iris.rotation.x = -Math.PI / 2;
    this.iris.position.y = LENS_OFF + 0.012;
    this.stage3.add(this.iris);

    // Decalque de luz no chão: ondas + dois anéis tracejados girando em sentidos opostos
    this.floorMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -10,
      uniforms: { uColor: { value: this.color }, uTime: { value: 0 }, uActive: { value: 0 } },
      vertexShader: /* glsl */ `#include <bend_pars>
        varying vec2 vP;
        void main(){ vP = position.xy; gl_Position = projectionMatrix * bendView(modelViewMatrix * vec4(position,1.0)); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime; uniform float uActive; varying vec2 vP;
        float ringDash(float r, float radius, float w, float ang, float n, float speed) {
          float line = smoothstep(w, 0.0, abs(r - radius));
          return line * step(0.5, fract(ang * n / 6.2832 + uTime * speed));
        }
        void main(){
          float r = length(vP);
          float ang = atan(vP.y, vP.x);
          float t = fract(uTime * 0.35);
          float wave = smoothstep(0.35, 0.0, abs(r - mix(4.7, 7.5, t))) * (1.0 - t);
          float inner = smoothstep(5.6, 4.7, r) * 0.35;
          float dashes = ringDash(r, 5.15, 0.07, ang, 36.0, 0.25) + ringDash(r, 6.9, 0.05, ang, 60.0, -0.15);
          float a = (wave * 0.5 + inner * 0.4) * (0.45 - uActive * 0.25);
          a += dashes * (0.25 + 0.3 * uActive);
          gl_FragColor = vec4(uColor * a, 1.0);
        }
      `,
    });
    const floor = new THREE.Mesh(S.floor, this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.05;
    base.add(floor);
    this.group.add(base);

    /* ---------- Pivot (billboard) ---------- */
    this.pivot = new THREE.Group();
    this.pivot.position.y = T2_CLOSED + T3_CLOSED + LENS_OFF; // acompanha a lente
    this.group.add(this.pivot);

    this.beamUniforms = {
      uW: { value: SCREEN_W },
      uH: { value: SCREEN_H },
      uY: { value: IDLE_Y },
      uX: { value: 0 },
      uLens: { value: 0.35 },
      uTime: { value: 0 },
      uIntensity: { value: 1 },
      uColor: { value: this.color },
    };
    const beam = new THREE.Mesh(
      S.beam,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: this.beamUniforms,
        vertexShader: /* glsl */ `#include <bend_pars>
          ${beamUniformsShared}
          attribute vec2 aCorner; attribute float aT; attribute float aU;
          varying float vT; varying float vU;
          void main() {
            vec3 bottom = vec3(aCorner.x * uLens, 0.0, aCorner.y * uLens);
            vec3 top = vec3(uX + aCorner.x * uW * 0.5, uY + aCorner.y * uH * 0.5, 0.0);
            vT = aT; vU = aU;
            gl_Position = projectionMatrix * bendView(modelViewMatrix * vec4(mix(bottom, top, aT), 1.0));
          }
        `,
        fragmentShader: /* glsl */ `
          ${beamUniformsShared}
          varying float vT; varying float vU;
          void main() {
            float body = (1.0 - vT * 0.8) * 0.07;
            // pulsos de energia subindo pelo feixe
            float bands = 0.6 + 0.4 * smoothstep(0.75, 1.0, sin(vT * 26.0 - uTime * 9.0));
            float edges = 1.0 - smoothstep(0.0, 0.06, min(vU, 1.0 - vU));
            vec3 col = uColor * (body * bands + edges * 0.2 * (1.0 - vT * 0.6)) * uIntensity;
            gl_FragColor = vec4(col, 1.0);
          }
        `,
      }),
    );
    beam.frustumCulled = false;
    this.pivot.add(beam);

    // Partículas subindo pelo feixe
    const particles = new THREE.Points(
      S.particles,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { ...this.beamUniforms, uPR: { value: Math.min(window.devicePixelRatio, 1.5) } },
        vertexShader: /* glsl */ `#include <bend_pars>
          ${beamUniformsShared}
          uniform float uPR;
          attribute vec3 aSeed;
          varying float vA;
          void main() {
            float t = fract(uTime * (0.12 + aSeed.z * 0.1) * (0.8 + uIntensity * 0.6) + aSeed.x);
            vec2 c = aSeed.xy * 2.0 - 1.0;
            vec3 bottom = vec3(c.x * uLens, 0.0, c.y * uLens);
            vec3 top = vec3(uX + c.x * uW * 0.45, uY - uH * 0.5 + (c.y * 0.5 + 0.5) * uH * 0.3, 0.0);
            vec3 p = mix(bottom, top, t);
            p.x += sin(uTime * 2.0 + aSeed.y * 30.0) * 0.15 * t;
            vA = sin(t * 3.14159);
            vec4 mv = bendView(modelViewMatrix * vec4(p, 1.0));
            gl_PointSize = (18.0 + aSeed.z * 22.0) * uPR / -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          ${beamUniformsShared}
          varying float vA;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.0, d) * vA;
            gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.45) * a * 1.8 * uIntensity, 1.0);
          }
        `,
      }),
    );
    particles.frustumCulled = false;
    this.pivot.add(particles);

    /* ---------- Tela holográfica em camadas (paralaxe) ---------- */
    this.screenGroup = new THREE.Group();
    this.screenGroup.position.y = IDLE_Y;
    this.pivot.add(this.screenGroup);

    // halo suave de luz atrás da tela
    this.glowMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: this.color }, uActive: { value: 0 }, uTime: { value: 0 } },
      vertexShader: VERT_UV,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uActive, uTime; varying vec2 vUv;
        void main(){
          vec2 q = abs(vUv - 0.5) * 2.0;
          float d = max(q.x, q.y);
          float breathe = 0.85 + 0.15 * sin(uTime * 1.6);
          float a = smoothstep(1.0, 0.55, d) * (0.3 - 0.2 * uActive) * breathe;
          gl_FragColor = vec4(uColor * a, 1.0);
        }
      `,
    });
    const glow = new THREE.Mesh(S.glow, this.glowMat);
    glow.position.z = -0.35;
    this.screenGroup.add(glow);

    this.holoMat = hologramMaterial(previewTexture, this.color);
    this.screen = new THREE.Mesh(S.screen, this.holoMat);
    this.screenGroup.add(this.screen);

    // cantoneiras de LED (aproximam-se da tela quando ela liga)
    this.bracketMat = ledMaterial(hex, 1.6);
    this.brackets = new THREE.Mesh(S.brackets, this.bracketMat);
    this.brackets.position.z = 0.35;
    this.screenGroup.add(this.brackets);

    // Rótulo com o nome do projeto
    const sub = item.kind === 'project' ? `PROJETO ${String(item.index + 1).padStart(2, '0')}` : 'TERMINAL';
    const labelTex = canvasTexture(createLabelCanvas(item.title, item.color, sub));
    this.labelMat = new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false, color: new THREE.Color(0.95, 0.95, 0.95) });
    this.label = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN_W, SCREEN_W * (160 / 1024)), this.labelMat);
    this.label.position.set(0, SCREEN_H / 2 + 0.95, 0.55);
    this.screenGroup.add(this.label);

    // Painel de informações (abre como um display ligando) + moldura de LED
    this.panelMat = panelMaterial(canvasTexture(createInfoCanvas(item, actionLabel)), this.color);
    this.panel = new THREE.Mesh(S.panel, this.panelMat);
    this.panel.visible = false;
    this.panelFrameMat = ledMaterial(hex, 2.0);
    const panelFrame = new THREE.Mesh(S.panelFrame, this.panelFrameMat);
    panelFrame.position.z = 0.01;
    this.panel.add(panelFrame);
    this.screenGroup.add(this.panel);

    this.base = base;
  }

  setPosition(x, z) {
    this.position.set(x, 0, z);
    this.group.position.copy(this.position);
  }

  setPreview(texture) {
    this.holoMat.uniforms.uMap.value = texture;
  }

  update(dt, t, camera, { allowExpand = true, portrait = false } = {}) {
    const cam = camera.position;
    const dx = cam.x - this.position.x;
    const dz = cam.z - this.position.z;
    this.dist = Math.hypot(dx, dz);

    // Sempre virado para o jogador, com um leve atraso (dá a sensação de paralaxe)
    const targetYaw = Math.atan2(dx, dz);
    this.yaw = dampAngle(this.yaw, targetYaw, this.dist < 30 ? 6 : 3, dt);
    this.pivot.rotation.y = this.yaw;

    // Molas com amortecimento crítico: acelera e freia suavemente
    const targetExpand = allowExpand ? smooth(EXPAND_START, INTERACT_RADIUS - 2, this.dist) : 0;
    this.expand = THREE.MathUtils.clamp(smoothDamp(this.expand, targetExpand, this.spring, 'e', 0.45, dt), 0, 1);
    this.reveal = THREE.MathUtils.clamp(smoothDamp(this.reveal, this.focused ? 1 : 0, this.spring, 'r', 0.3, dt), 0, 1);

    // Base telescópica: abre ao entrar no raio de expansão, recolhe ao sair (com histerese).
    // O progresso é linear e cada etapa tem sua própria curva suave e seu atraso,
    // então a coreografia tem sempre a mesma duração, e ao recolher a ordem se inverte.
    if (allowExpand && this.dist < EXPAND_START - 0.5) this.opening = true;
    else if (!allowExpand || this.dist > EXPAND_START + 2) this.opening = false;
    this.open = THREE.MathUtils.clamp(this.open + (this.opening ? dt / OPEN_TIME : -dt / CLOSE_TIME), 0, 1);
    const o = this.open;
    const p2 = smootherstep(o / 0.55); // nível 2 sobe
    const p3 = smootherstep((o - 0.28) / 0.55); // nível 3 sobe logo em seguida
    const pi = smootherstep((o - 0.5) / 0.5); // íris gira e abre
    this.stage2.position.y = THREE.MathUtils.lerp(T2_CLOSED, T2_OPEN, p2);
    this.stage3.position.y = THREE.MathUtils.lerp(T3_CLOSED, T3_OPEN, p3);
    // leve giro dos níveis enquanto sobem (dá vida à íris e às emendas)
    this.stage3.rotation.y = (1 - p3) * 0.9;
    this.irisMat.uniforms.uOpen.value = pi;
    this.iris.visible = pi < 0.999;
    const lensY = this.stage2.position.y + this.stage3.position.y + LENS_OFF;
    this.pivot.position.y = lensY;

    // Disparo das sequências de "ligar"
    const active = this.expand > 0.08;
    if (active && !this.wasActive) this.igniteAt = t;
    this.wasActive = active;
    if (this.focused && !this.wasRevealed) this.panelAt = t;
    this.wasRevealed = this.focused;
    const ignite = active ? igniteFlicker(t - this.igniteAt) : 1;
    const panelFlicker = igniteFlicker(t - this.panelAt);

    const e = this.expand;
    const r = this.reveal;
    // perto demais, a composição encolhe um pouco para continuar cabendo na tela
    // muito perto (0 longe -> 1 encostado): a base esmaece e a projecao se reenquadra
    const near = 1 - THREE.MathUtils.smoothstep(this.dist, 6, 11);
    const fit = THREE.MathUtils.clamp((this.dist - 1) / 10, 0.58, 1);
    // de perto a projeção cresce bastante (é o destaque da cena)
    const s = (1 + 0.8 * e) * THREE.MathUtils.lerp(1, fit, e);
    const sg = this.screenGroup;
    sg.scale.setScalar(s);

    // posição do painel: ao lado (paisagem) ou abaixo (retrato/celular)
    if (portrait) {
      this.panel.position.set(0, -(SCREEN_H / 2 + 0.3 + PANEL_H / 2), 0.25);
      this.panel.rotation.set(0, 0, 0);
      sg.position.x = 0;
      sg.position.y = THREE.MathUtils.lerp(IDLE_Y, NEAR_Y, e) + r * (PANEL_H / 2 + 0.6) * s;
    } else {
      this.panel.position.set(SCREEN_W / 2 + 0.4 + PANEL_W / 2, 0, 0.3);
      this.panel.rotation.set(0, -0.08 * r, 0);
      sg.position.x = -r * (PANEL_W / 2 + 0.2) * s;
      sg.position.y = THREE.MathUtils.lerp(IDLE_Y, NEAR_Y, e);
    }
    // flutuação suave quando em espera
    const idle = 1 - e;
    sg.position.y += Math.sin(t * 1.3 + this.phase) * 0.15 * idle - near * 0.9;
    sg.rotation.z = Math.sin(t * 0.8 + this.phase) * 0.02 * idle;
    // a lente sobe e desce com a base; a tela fica na mesma altura (o feixe é que estica)
    sg.position.y += LENS_Y - lensY;

    // inclina levemente na direção dos olhos do jogador
    const worldY = lensY + sg.position.y;
    sg.rotation.x = THREE.MathUtils.clamp(Math.atan2(cam.y - worldY, Math.max(this.dist, 1)) * 0.3, -0.25, 0.25);

    // painel desdobra com um leve "overshoot" e acende de cima para baixo
    this.panel.visible = r > 0.01;
    const unfold = easeOutBack(THREE.MathUtils.clamp(r * 1.25, 0, 1));
    this.panel.scale.set(Math.max(unfold, 0.001), 0.92 + 0.08 * r, 1);
    const pu = this.panelMat.uniforms;
    pu.uReveal.value = THREE.MathUtils.clamp((r - 0.2) / 0.8, 0, 1);
    pu.uOpacity.value = THREE.MathUtils.clamp(r * 2, 0, 1);
    pu.uTime.value = t;
    this.panelFrameMat.color.copy(this.rings[1].base).multiplyScalar(2.1 * panelFlicker * THREE.MathUtils.clamp(r * 2, 0, 1));
    this.labelMat.opacity = 1 - r;

    // anéis: uma única onda de luz subindo pela base, acendendo e apagando de forma fluida
    const ringOn = [smootherstep(o / 0.3), smootherstep((o - 0.1) / 0.3), p2, p3];
    this.rings.forEach((ring, i) => {
      const on = ringOn[i];
      const u = ring.mat.uniforms;
      const flick = on > 0.02 ? ignite : 1;
      const wave = 0.5 + 0.5 * Math.sin(t * 1.8 + this.phase - i * 0.9);
      // base acima do limiar do bloom; a onda ganha força quando o holograma está ativo
      u.uBase.value = THREE.MathUtils.lerp(1.0, 0.9, e) * flick;
      u.uWave.value = wave * wave * (0.8 + 0.6 * on) * flick;
    });

    // cantoneiras: convergem para a tela e piscam como lâmpada ao ligar
    const converge = 1 + 0.18 * (1 - e);
    this.brackets.scale.set(converge, converge, 1);
    this.bracketMat.color.copy(this.rings[1].base).multiplyScalar((1.5 + 0.7 * e) * ignite);

    // uniforms
    const u = this.beamUniforms;
    u.uW.value = SCREEN_W * s;
    u.uH.value = SCREEN_H * s;
    u.uX.value = sg.position.x;
    u.uY.value = sg.position.y;
    u.uTime.value = t;
    // a boca do feixe acompanha a abertura da íris
    u.uLens.value = THREE.MathUtils.lerp(0.14, 0.4, pi);
    u.uIntensity.value = (1.0 - 0.4 * e) * (active ? 0.4 + 0.6 * ignite : 1);
    const hu = this.holoMat.uniforms;
    hu.uTime.value = t;
    hu.uActive.value = e;
    hu.uWipe.value = THREE.MathUtils.clamp((e - 0.1) / 0.75, 0, 1) * 1.04;
    hu.uEdge.value = (1.1 + 0.8 * e) * ignite;
    this.glowMat.uniforms.uActive.value = e;
    this.glowMat.uniforms.uTime.value = t + this.phase;
    this.lensMat.uniforms.uTime.value = t;
    this.lensMat.uniforms.uActive.value = Math.min(1, e + near * 0.6);
    this.floorMat.uniforms.uTime.value = t;
    this.floorMat.uniforms.uActive.value = e * (1 - 0.25 * near);
  }
}

function dampAngle(a, b, lambda, dt) {
  let d = b - a;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return a + d * (1 - Math.exp(-lambda * dt));
}

/** Curva de Perlin (início e fim com velocidade e aceleração zero), com x limitado a 0..1. */
function smootherstep(x) {
  const t = THREE.MathUtils.clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** 0 quando x >= far, 1 quando x <= near. */
function smooth(far, near, x) {
  const t = THREE.MathUtils.clamp((far - x) / (far - near), 0, 1);
  return t * t * (3 - 2 * t);
}
