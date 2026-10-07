import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Utilitários de "LED / neon".
 *
 * Regra de luz do projeto (bloom seletivo com limiar 1.0):
 *  - o que deve BRILHAR usa cor > 1 (ledColor com k entre 1.6 e 3);
 *  - o que deve ser LIDO fica com cor <= 0.95 e nunca entra no bloom.
 */

const WHITE = new THREE.Color(1, 1, 1);

/** Tempo compartilhado por todos os shaders de LED (atualizado pelo World). */
export const ledTime = { value: 0 };

/** Cor de tubo de LED: núcleo puxado para o branco + intensidade HDR (o bloom faz o halo colorido). */
export function ledColor(hex, k = 2, core = 0.3) {
  return new THREE.Color(hex).lerp(WHITE, core).multiplyScalar(k);
}

/**
 * Cor de LED com luminancia normalizada: amarelo, rosa e azul brilham por igual
 * (sem isso, o amarelo, que e muito mais luminoso, estoura o bloom).
 */
export function ledColorNorm(hex, targetLum = 0.62, core = 0.3) {
  const c = new THREE.Color(hex).lerp(WHITE, core);
  const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  return c.multiplyScalar(targetLum / Math.max(lum, 0.05));
}

export function ledMaterial(hex, k = 2, core = 0.3) {
  return new THREE.MeshBasicMaterial({ color: ledColor(hex, k, core) });
}

/** Moldura retangular (4 barras finas) no plano XY, centrada na origem. */
export function frameGeometry(w, h, t) {
  const top = new THREE.PlaneGeometry(w, t).translate(0, h / 2 - t / 2, 0);
  const bottom = new THREE.PlaneGeometry(w, t).translate(0, -h / 2 + t / 2, 0);
  const left = new THREE.PlaneGeometry(t, h - 2 * t).translate(-w / 2 + t / 2, 0, 0);
  const right = new THREE.PlaneGeometry(t, h - 2 * t).translate(w / 2 - t / 2, 0, 0);
  return mergeGeometries([top, bottom, left, right]);
}

/** Névoa manual para shaders customizados (mesma do Engine). */
export const FOG_GLSL = /* glsl */ `
  float fogAmount(vec3 worldPos) {
    return smoothstep(55.0, 210.0, length(worldPos.xz - cameraPosition.xz));
  }
  const vec3 FOG_COLOR = vec3(0.227, 0.039, 0.290);
`;

/**
 * Lâmpadas de letreiro (marquee) em volta de um retângulo, com luz "correndo"
 * como nas placas de cassino/fliperama. Tudo num único draw call.
 */
export function createMarquee(w, h, spacing, hex, { radius = 0.11 } = {}) {
  const points = [];
  const perimeter = 2 * (w + h);
  const n = Math.max(8, Math.round(perimeter / spacing));
  for (let i = 0; i < n; i++) {
    let d = (i / n) * perimeter;
    let x;
    let y;
    if (d < w) [x, y] = [-w / 2 + d, h / 2];
    else if ((d -= w) < h) [x, y] = [w / 2, h / 2 - d];
    else if ((d -= h) < w) [x, y] = [w / 2 - d, -h / 2];
    else [x, y] = [-w / 2, -h / 2 + (d - w)];
    points.push([x, y]);
  }
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: ledTime, uColor: { value: new THREE.Color(hex).lerp(WHITE, 0.35) } },
    vertexShader: /* glsl */ `
      #include <bend_pars>
      varying float vI;
      void main() {
        vI = float(gl_InstanceID);
        gl_Position = projectionMatrix * bendView(modelViewMatrix * instanceMatrix * vec4(position, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor;
      varying float vI;
      void main() {
        // grupos de 4 lâmpadas, 2 acesas, "correndo" em volta da placa
        float on = step(0.5, fract(vI / 4.0 - uTime * 2.2));
        gl_FragColor = vec4(uColor * mix(0.3, 2.6, on), 1.0);
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(radius, 8, 6), mat, n);
  const m = new THREE.Matrix4();
  points.forEach(([x, y], i) => mesh.setMatrixAt(i, m.makeTranslation(x, y, 0)));
  mesh.computeBoundingSphere();
  return mesh;
}

/** Amortecimento crítico (SmoothDamp): movimento suave, sem "tranco", que acelera e freia naturalmente. */
export function smoothDamp(current, target, state, key, smoothTime, dt) {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = current - target;
  const vel = state[key] || 0;
  const temp = (vel + omega * change) * dt;
  state[key] = (vel - omega * temp) * exp;
  return target + (change + temp) * exp;
}

export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Padrão de "lâmpada fluorescente ligando": pisca algumas vezes e estabiliza. */
export function igniteFlicker(elapsed) {
  if (elapsed < 0) return 0;
  if (elapsed > 0.55) return 1;
  const k = Math.floor(elapsed * 26);
  const r = Math.abs(Math.sin(k * 91.7 + 13.1) * 43758.5453) % 1;
  return r > 0.42 ? 1 : 0.12;
}
