import * as THREE from 'three';
import { ledTime, ledMaterial, ledColorNorm, frameGeometry } from './neon.js';

/**
 * Placa flutuante no início de cada avenida, sustentada por dois propulsores "sônicos":
 * em vez de fogo, cada propulsor solta anéis de pressão que descem e se abrem como ondas
 * de som, e o campo deixa ondulações no chão logo abaixo. A placa flutua (sobe/desce,
 * balança de leve) e o empuxo acompanha: mais forte quando ela sobe.
 */

const SIGN_TINT = new THREE.Color(0.82, 0.82, 0.82); // texto abaixo do bloom e um pouco contido: informa sem competir com os projetos
const CONE_H = 3.2;

let shared = null;
function getShared() {
  if (shared) return shared;
  // cone aberto: topo no bocal (y = 0), abrindo para baixo
  const cone = new THREE.CylinderGeometry(0.42, 1.75, CONE_H, 40, 1, true).translate(0, -CONE_H / 2, 0);
  shared = {
    metal: new THREE.MeshStandardMaterial({ color: '#1b1430', metalness: 0.85, roughness: 0.32, envMapIntensity: 0.7 }),
    pod: new THREE.CylinderGeometry(0.5, 0.36, 0.6, 24),
    podCap: new THREE.CylinderGeometry(0.36, 0.36, 0.05, 24),
    nozzle: new THREE.TorusGeometry(0.4, 0.05, 8, 32).rotateX(Math.PI / 2),
    cone,
  };
  return shared;
}

/** Anéis de pressão descendo pelo cone (vistos de lado parecem ondas de som se abrindo). */
function thrustMaterial(color, uniforms) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { ...uniforms, uColor: { value: color } },
    vertexShader: /* glsl */ `#include <bend_pars>
      varying float vY;
      void main() {
        vY = -position.y / ${CONE_H.toFixed(2)}; // 0 no bocal, 1 na ponta
        gl_Position = projectionMatrix * bendView(modelViewMatrix * vec4(position, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime, uThrust, uPhase;
      varying float vY;
      void main() {
        // anéis finos descendo; ficam mais largos e fracos à medida que se afastam do bocal
        float ph = fract(vY * 2.4 - uTime * 1.7 * (0.8 + 0.4 * uThrust) + uPhase);
        float ring = pow(1.0 - abs(ph - 0.5) * 2.0, mix(26.0, 8.0, vY));
        float body = 0.16 * pow(1.0 - vY, 2.0);
        float fade = pow(1.0 - vY, 1.4) * smoothstep(0.0, 0.05, vY + 0.02);
        vec3 col = mix(uColor, vec3(1.0), 0.25) * (ring * 1.4 + body) * fade * uThrust;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

/** Ondulações no chão: o campo dos propulsores "tocando" a calçada. */
function rippleMaterial(color, uniforms, podX) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -10,
    uniforms: { ...uniforms, uColor: { value: color }, uPodX: { value: podX } },
    vertexShader: /* glsl */ `#include <bend_pars>
      varying vec2 vP;
      void main() {
        vP = position.xz;
        gl_Position = projectionMatrix * bendView(modelViewMatrix * vec4(position, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uTime, uThrust, uPhase, uPodX;
      varying vec2 vP;
      float field(vec2 c) {
        float r = length(vP - c);
        float ring = pow(1.0 - abs(fract(r / 1.6 - uTime * 0.9 + uPhase) - 0.5) * 2.0, 14.0);
        return ring * smoothstep(4.2, 0.6, r) * 0.55 + exp(-r * r * 0.9) * 0.35;
      }
      void main() {
        float a = field(vec2(-uPodX, 0.0)) + field(vec2(uPodX, 0.0));
        gl_FragColor = vec4(uColor * a * uThrust * 0.4, 1.0);
      }
    `,
  });
}

/**
 * @param {THREE.Texture} map   textura da placa (legível dos dois lados)
 * @param {number} width        largura da placa (unidades do mundo)
 * @param {number} height
 * @param {string} hex          cor neon da avenida
 * @param {number} baseY        altura do centro da placa
 */
export function createHoverSign(map, width, height, hex, baseY) {
  const S = getShared();
  const color = ledColorNorm(hex, 0.62, 0.2);
  const uniforms = { uTime: ledTime, uThrust: { value: 1 }, uPhase: { value: Math.random() } };
  const podX = width / 2 - width * 0.16;

  const root = new THREE.Group();
  const float = new THREE.Group();
  root.add(float);

  // placa: frente e verso (o verso é girado, então o texto nunca fica espelhado) + moldura de LED
  const geo = new THREE.PlaneGeometry(width, height);
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, color: SIGN_TINT });
  const front = new THREE.Mesh(geo, mat);
  const back = new THREE.Mesh(geo, mat);
  back.rotation.y = Math.PI;
  back.position.z = -0.06;
  const frame = new THREE.Mesh(frameGeometry(width + 0.14, height + 0.14, 0.06), ledMaterial(hex, 1.15));
  frame.material.side = THREE.DoubleSide;
  frame.position.z = -0.03;
  float.add(front, back, frame);

  // chassi embaixo da placa, com um filete de LED
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, 0.32, 0.55), S.metal);
  chassis.position.y = -height / 2 - 0.2;
  chassis.castShadow = true;
  const strip = new THREE.Mesh(new THREE.BoxGeometry(width - 0.6, 0.05, 0.57), ledMaterial(hex, 1.2));
  strip.position.y = chassis.position.y - 0.06;
  float.add(chassis, strip);

  // propulsores
  const podY = chassis.position.y - 0.45;
  for (const sx of [-1, 1]) {
    const pod = new THREE.Group();
    pod.position.set(sx * podX, podY, 0);
    const body = new THREE.Mesh(S.pod, S.metal);
    body.castShadow = true;
    const cap = new THREE.Mesh(S.podCap, ledMaterial(hex, 0.9));
    cap.position.y = -0.31;
    const nozzle = new THREE.Mesh(S.nozzle, ledMaterial(hex, 2.0));
    nozzle.position.y = -0.3;
    const cone = new THREE.Mesh(S.cone, thrustMaterial(color, uniforms));
    cone.position.y = -0.32;
    cone.frustumCulled = false;
    pod.add(body, cap, nozzle, cone);
    float.add(pod);
  }

  // ondulações no chão (fixas no chão, não flutuam com a placa)
  const ripple = new THREE.Mesh(new THREE.PlaneGeometry(width + 8, 9, 24, 12).rotateX(-Math.PI / 2), rippleMaterial(color, uniforms, podX));
  ripple.position.y = 0.06;
  ripple.renderOrder = 2;
  root.add(ripple);

  const phase = Math.random() * 10;
  return {
    group: root,
    /** obstáculo para o tráfego aéreo (no espaço local da placa) */
    extent: { y0: podY + baseY - 0.6, y1: baseY + height / 2 + 0.6, halfW: width / 2 + 0.4 },
    update(t) {
      const a = t * 1.15 + phase;
      // flutuação: duas frequências, para não parecer um metrônomo
      float.position.y = baseY + Math.sin(a) * 0.32 + Math.sin(a * 2.3) * 0.05;
      float.rotation.z = Math.sin(t * 0.7 + phase) * 0.025;
      float.rotation.x = Math.sin(t * 0.9 + phase) * 0.015;
      // empuxo acompanha a subida (derivada da flutuação)
      uniforms.uThrust.value = 0.8 + 0.3 * Math.cos(a);
    },
  };
}
