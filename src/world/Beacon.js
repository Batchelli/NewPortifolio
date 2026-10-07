import * as THREE from 'three';
import { ledColorNorm, ledTime } from './neon.js';
import { wrapDelta } from '../core/Planet.js';

/**
 * Sinalização dos projetos no meio da cidade.
 *
 *  - Farol: coluna de luz fina na cor do projeto, subindo do pedestal até o céu.
 *    Fica acima dos telhados, então dá para achar os projetos de qualquer rua.
 *    Projeto não visitado = feixe forte com pulsos de energia subindo;
 *    visitado = feixe discreto. De perto ele some e o holograma assume.
 *
 *  - Pulso de radar (tecla Q): uma onda varre o chão a partir do jogador;
 *    cada farol "pisca" quando a onda passa por ele.
 */

export const BEACON_HEIGHT = 170;
export const EMBLEM_Y = 32; // altura do emblema no feixe (acima da maioria dos telhados)
const BEACON_WIDTH = 2.4; // largura mínima (de perto); de longe ela cresce para manter alguns pixels na tela

let beaconGeo = null;

export function createBeacon(hex) {
  if (!beaconGeo) {
    beaconGeo = new THREE.PlaneGeometry(1, 1);
    beaconGeo.translate(0, 0.5, 0);
    beaconGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, BEACON_HEIGHT / 2, 0), BEACON_HEIGHT);
  }
  const uniforms = {
    uColor: { value: ledColorNorm(hex, 0.62, 0.2) },
    uTime: ledTime,
    uAlpha: { value: 0 },
    uPulse: { value: 1 },
    uFlash: { value: 0 },
    uWidth: { value: BEACON_WIDTH },
    uSeed: { value: Math.random() },
  };
  const mesh = new THREE.Mesh(
    beaconGeo,
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms,
      vertexShader: /* glsl */ `#include <bend_pars>
        uniform float uWidth;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          // billboard cilíndrico: gira só em torno do eixo vertical, sempre de frente para a câmera
          vec3 base = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec2 toCam = cameraPosition.xz - base.xz;
          float dist = max(length(toCam), 0.001);
          vec3 side = vec3(toCam.y, 0.0, -toCam.x) / dist;
          float w = max(uWidth, dist * 0.02);
          vec3 wp = base + side * (uv.x - 0.5) * w + vec3(0.0, uv.y * ${BEACON_HEIGHT.toFixed(1)}, 0.0);
          gl_Position = projectionMatrix * bendView(viewMatrix * vec4(wp, 1.0));
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime, uAlpha, uPulse, uFlash, uSeed;
        varying vec2 vUv;
        void main() {
          float x = abs(vUv.x - 0.5) * 2.0;
          float y = vUv.y;
          float core = exp(-x * x * 70.0);
          float halo = exp(-x * x * 5.0);
          // nasce no chão e se dissolve no céu
          float fade = smoothstep(0.0, 0.02, y) * pow(1.0 - y, 1.8);
          // pacotes de energia subindo pelo feixe
          float p = fract(y * 5.0 - uTime * 0.32 + uSeed);
          float packet = smoothstep(0.0, 0.015, p) * smoothstep(0.14, 0.015, p) * uPulse;
          // onda do radar: um clarão que sobe rápido pelo feixe
          float flashBand = uFlash * (0.35 + smoothstep(0.25, 0.0, abs(y - (1.0 - uFlash) * 0.7)));
          float a = core * (1.3 + packet * 1.8 + flashBand * 2.0) + halo * (0.22 + packet * 0.25 + flashBand * 0.4);
          vec3 col = mix(uColor, vec3(1.0), core * 0.45) * a * fade * uAlpha;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    }),
  );
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return { mesh, uniforms };
}

/* ------------------------------------------------------------------ */
/*  Emblema: losango holográfico no feixe, com "PROJETO 01" e o nome    */
/* ------------------------------------------------------------------ */

const EM = 512; // canvas quadrado
const EM_CY = 196; // centro do losango (px, de cima)
const EM_R = 150; // meia-diagonal do losango (px)

/**
 * Um canvas, três máscaras: R = moldura (brilha, entra no bloom), G = texto (nítido),
 * B = sombra atrás do título (legível contra prédios claros).
 */
function emblemTexture(item) {
  const c = document.createElement('canvas');
  c.width = EM;
  c.height = EM;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, EM, EM);
  ctx.globalCompositeOperation = 'lighter';
  const project = item.kind === 'project';
  const shape = (r) => {
    ctx.beginPath();
    if (project) {
      ctx.moveTo(EM / 2, EM_CY - r);
      ctx.lineTo(EM / 2 + r, EM_CY);
      ctx.lineTo(EM / 2, EM_CY + r);
      ctx.lineTo(EM / 2 - r, EM_CY);
      ctx.closePath();
    } else ctx.arc(EM / 2, EM_CY, r * 0.8, 0, Math.PI * 2);
  };

  // R: moldura dupla
  ctx.strokeStyle = '#f00';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 9;
  shape(EM_R - 5);
  ctx.stroke();
  ctx.lineWidth = 3;
  shape(EM_R - 26);
  ctx.stroke();

  // título: ajusta o tamanho para caber
  const title = item.title.toUpperCase();
  let size = 74;
  ctx.font = `900 ${size}px "Orbitron", sans-serif`;
  while (ctx.measureText(title).width > EM - 30 && size > 30) {
    size -= 2;
    ctx.font = `900 ${size}px "Orbitron", sans-serif`;
  }
  const tw = ctx.measureText(title).width;
  const ty = 440;

  // B: sombra difusa atrás do título
  ctx.save();
  ctx.filter = 'blur(12px)';
  ctx.fillStyle = '#00f';
  ctx.fillRect(EM / 2 - tw / 2 - 18, ty - size * 0.95, tw + 36, size * 1.35);
  ctx.restore();

  // G: textos
  ctx.fillStyle = '#0f0';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(title, EM / 2, ty);
  ctx.font = '20px "Press Start 2P", monospace';
  ctx.fillText(project ? 'PROJETO' : 'PERFIL', EM / 2, EM_CY - 38);
  const mark = project ? String(item.index + 1).padStart(2, '0') : item.kind === 'about' ? 'i' : '@';
  ctx.font = `900 ${project ? 92 : 104}px "Orbitron", sans-serif`;
  ctx.fillText(mark, EM / 2, EM_CY + 58);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace; // máscaras, não cor
  tex.anisotropy = 4;
  return tex;
}

let emblemGeo = null;

export function createEmblem(item) {
  emblemGeo ??= new THREE.PlaneGeometry(1, 1);
  const uniforms = {
    uMap: { value: emblemTexture(item) },
    uColor: { value: ledColorNorm(item.color, 0.62, 0.15) },
    uTime: ledTime,
    uAlpha: { value: 0 },
    uSize: { value: 10 },
    uFound: { value: 0 },
    uSeed: { value: Math.random() },
    uCircle: { value: item.kind === 'project' ? 0 : 1 },
    uGhost: { value: 0 }, // opacidade do "raio-x" (só para a rota marcada e no radar)
  };
  const material = (ghost) =>
    new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // "raio-x": atrás de um prédio o emblema continua visível, só que bem translúcido
      depthTest: !ghost,
      defines: ghost ? { GHOST: '' } : {},
      uniforms,
      vertexShader: /* glsl */ `#include <bend_pars>
        uniform float uSize;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          // sempre de frente para a câmera
          vec4 c = bendView(modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0));
          c.xy += position.xy * uSize;
          gl_Position = projectionMatrix * c;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap; uniform vec3 uColor;
        uniform float uTime, uAlpha, uFound, uSeed, uCircle, uGhost;
        varying vec2 vUv;
        void main() {
          vec3 m = texture2D(uMap, vUv).rgb;
          vec2 p = vec2(vUv.x - 0.5, vUv.y - ${(1 - EM_CY / EM).toFixed(4)}) * ${(EM / EM_R).toFixed(4)};
          float d = uCircle > 0.5 ? length(p) / 0.8 : abs(p.x) + abs(p.y);
          float inside = smoothstep(0.97, 0.93, d);
          // vidro escuro na cor do projeto, com uma varredura de luz descendo devagar
          float sweep = smoothstep(0.06, 0.0, abs(fract(vUv.y * 1.3 + uTime * 0.25 + uSeed) - 0.5)) * 0.5;
          vec3 col = uColor * (0.08 + sweep * 0.12) * inside;
          float a = inside * 0.78;
          // sombra do título
          col = mix(col, vec3(0.02, 0.0, 0.05), m.b * (1.0 - inside));
          a = max(a, m.b * 0.6);
          // texto nítido (abaixo do bloom)
          col = mix(col, vec3(0.96), m.g);
          a = max(a, m.g);
          // moldura em LED: forte nos não visitados, mais calma nos já vistos
          col += uColor * m.r * mix(2.6, 1.2, uFound);
          a = max(a, m.r);
          // "ping" saindo do losango enquanto o projeto não foi visitado
          float ph = fract(uTime * 0.4 + uSeed);
          float ping = smoothstep(0.035, 0.0, abs(d - (1.0 + ph * 0.6))) * (1.0 - ph) * (1.0 - uFound);
          col += uColor * ping * 2.0;
          a = max(a, ping);
          #ifdef GHOST
            a *= uGhost;
          #endif
          gl_FragColor = vec4(col, a * uAlpha);
        }
      `,
    });
  const mesh = new THREE.Mesh(emblemGeo, material(false));
  const ghost = new THREE.Mesh(emblemGeo, material(true));
  for (const m of [mesh, ghost]) {
    m.position.y = EMBLEM_Y;
    m.frustumCulled = false;
  }
  ghost.renderOrder = 3;
  ghost.visible = false;
  mesh.renderOrder = 4;
  const group = new THREE.Group();
  group.add(ghost, mesh);
  return { mesh: group, ghost, uniforms };
}

/* ------------------------------------------------------------------ */

const SCAN_SPEED = 85; // unidades por segundo
const SCAN_MAX = 300;
const SCAN_HOLD = 7; // segundos em que tudo fica realçado depois do pulso

export class ScanPulse {
  constructor(scene) {
    this.origin = new THREE.Vector2();
    this.center = new THREE.Vector2();
    this.radius = 0;
    this.elapsed = Infinity;
    this.level = 0; // 0..1: realce dos projetos (HUD, faróis)

    const color = new THREE.Color('#7ff8ff');
    this.uniforms = {
      uCenter: { value: this.center },
      uR: { value: 0 },
      uAlpha: { value: 0 },
      uColor: { value: color },
      uMax: { value: SCAN_MAX },
    };

    // Onda no chão: frente nítida + grade holográfica no rastro
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(SCAN_MAX * 2.2, SCAN_MAX * 2.2, 96, 96).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -12,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `#include <bend_pars>
          varying vec2 vW;
          void main() {
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vW = wp.xz;
            gl_Position = projectionMatrix * bendView(viewMatrix * wp);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec2 uCenter; uniform float uR, uAlpha, uMax; uniform vec3 uColor;
          varying vec2 vW;
          void main() {
            float d = length(vW - uCenter);
            // a frente engrossa com a distância para continuar legível perto do horizonte
            float w = 1.2 + uR * 0.012;
            float front = smoothstep(w, 0.0, abs(d - uR));
            float trail = pow(smoothstep(uR - 45.0, uR, d), 2.0) * step(d, uR);
            vec2 g = abs(fract(vW / 3.0) - 0.5);
            float grid = smoothstep(0.43, 0.5, max(g.x, g.y));
            float a = front * 1.6 + trail * (0.08 + grid * 0.55);
            a *= uAlpha * (1.0 - smoothstep(uMax * 0.6, uMax, uR));
            gl_FragColor = vec4(mix(uColor, vec3(1.0), front * 0.4) * a, 1.0);
          }
        `,
      }),
    );
    ground.position.y = 0.1;
    ground.frustumCulled = false;
    ground.renderOrder = 3;

    // Parede baixa e translúcida acompanhando a frente da onda
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 160, 1, true).translate(0, 0.5, 0),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        uniforms: this.uniforms,
        vertexShader: /* glsl */ `#include <bend_pars>
          varying float vY;
          void main() {
            vY = position.y;
            gl_Position = projectionMatrix * bendView(modelViewMatrix * vec4(position, 1.0));
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uR, uAlpha, uMax; uniform vec3 uColor;
          varying float vY;
          void main() {
            // cortina de luz: forte embaixo, some para cima, com um fio brilhante no topo e na base
            float a = pow(1.0 - vY, 1.6) * 0.5;
            float lines = smoothstep(0.035, 0.0, abs(vY - 0.015)) * 1.6 + smoothstep(0.02, 0.0, abs(vY - 0.97)) * 0.9;
            // logo no começo a cortina envolve a câmera: entra suave para não ofuscar
            float k = uAlpha * smoothstep(4.0, 22.0, uR) * (1.0 - smoothstep(uMax * 0.6, uMax, uR));
            gl_FragColor = vec4((uColor * a + mix(uColor, vec3(1.0), 0.4) * lines) * k, 1.0);
          }
        `,
      }),
    );
    wall.frustumCulled = false;
    wall.renderOrder = 3;

    this.ground = ground;
    this.wall = wall;
    this.group = new THREE.Group();
    this.group.add(ground, wall);
    this.group.visible = false;
    scene.add(this.group);
  }

  get running() {
    return this.elapsed !== Infinity && this.radius < SCAN_MAX * 0.6;
  }

  start(x, z) {
    this.origin.set(x, z);
    this.elapsed = 0;
  }

  /** Intensidade do clarão de um farol a `d` do centro da onda. */
  hit(x, z) {
    if (this.elapsed === Infinity) return 0;
    const d = Math.hypot(x - this.center.x, z - this.center.y);
    const behind = this.radius - d;
    return behind < 0 ? 0 : Math.exp(-behind / 18) * this.uniforms.uAlpha.value;
  }

  update(dt, cam) {
    if (this.elapsed === Infinity) return;
    this.elapsed += dt;
    const e = this.elapsed;
    this.radius = e * SCAN_SPEED;
    // a onda acompanha a cópia do mundo mais próxima da câmera
    this.center.set(cam.x + wrapDelta(this.origin.x - cam.x), cam.z + wrapDelta(this.origin.y - cam.z));
    const travelling = this.radius < SCAN_MAX;
    this.group.visible = travelling;
    if (travelling) {
      this.uniforms.uR.value = this.radius;
      this.uniforms.uAlpha.value = Math.min(1, e * 6);
      this.ground.position.x = cam.x;
      this.ground.position.z = cam.z;
      this.wall.position.set(this.center.x, 0, this.center.y);
      // a cortina cresce com a distância para continuar visível acima dos carros e calçadas
      this.wall.scale.set(this.radius, 3 + this.radius * 0.06, this.radius);
    }
    // realce: sobe rápido, segura alguns segundos e apaga devagar
    const hold = SCAN_MAX / SCAN_SPEED + SCAN_HOLD;
    this.level = Math.min(1, e * 4) * (1 - THREE.MathUtils.smoothstep(e, hold, hold + 1.6));
    if (e > hold + 1.6) {
      this.elapsed = Infinity;
      this.level = 0;
    }
  }
}
