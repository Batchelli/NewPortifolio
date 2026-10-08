import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD_SIZE, wrapDelta, wrapCoord } from '../core/Planet.js';
import { mulberry } from './Scenery.js';
import { smoothDamp } from './neon.js';
import {
  createCarMaterial,
  createHoverCarGeometry,
  createHoverLightsGeometry,
  createHoverLightsMaterial,
  HOVER_PAINTS,
  POD_X,
  POD_Y,
  NOZZLE_Z,
} from './CarModels.js';

const TRAIL_LEN = 11;

const CAR_HALF_WIDTH = 1.4;
const MIN_ALT = 5.5; // nunca desce abaixo disso (postes e placas ficam mais baixo)

/**
 * Carros voadores sobre as estradas. Como as estradas dão a volta no planeta,
 * os carros também: cada um percorre sua faixa para sempre, sempre desenhado
 * na cópia mais próxima do jogador.
 *
 * "Rodovia aérea": cada avenida tem duas faixas de altitude (a de cima para os rápidos,
 * a de baixo para os mais lentos) e as duas avenidas ficam em alturas diferentes, então o
 * cruzamento sobre a praça é seguro. Em cada faixa o carro mantém distância do da frente
 * (piloto automático adaptativo) e desvia dos obstáculos (letreiros, arcos) por cima,
 * por baixo ou pelo lado, começando com antecedência.
 * As manobras usam molas (smoothDamp) e o carro inclina o nariz/asas conforme se move.
 */
const LANES = { z: [9.5, 13.8], x: [17.5, 21] }; // altitudes das faixas [lenta, rápida] por avenida
export class Traffic {
  constructor(scene, count = 18) {
    const rnd = mulberry(99);
    this.cars = Array.from({ length: count }, (_, i) => {
      const axis = i % 2 === 0 ? 'z' : 'x'; // 'z' = Av. Meridiano (N–S), 'x' = Bulevar Equador (L–O)
      const dir = rnd() < 0.5 ? 1 : -1;
      const fast = rnd() < 0.5;
      return {
        axis,
        dir,
        lateral: dir * (2.4 + rnd() * 1.2) * (axis === 'z' ? -1 : 1),
        alt: LANES[axis][fast ? 1 : 0],
        speed: fast ? 28 + rnd() * 8 : 19 + rnd() * 7,
        phase: rnd() * WORLD_SIZE,
        bob: rnd() * 10,
        // estado da pilotagem (posição atual e velocidades das molas)
        curAlt: 0,
        curLat: 0,
        spring: {},
        along: 0,
        pitch: 0,
        roll: 0,
        yaw: 0,
        color: new THREE.Color(['#ff2a9d', '#00f0ff', '#ffd319', '#b26bff'][i % 4]),
      };
    });

    // carroceria (frente = -z): nave hover com cápsulas de propulsão laterais
    this.bodies = new THREE.InstancedMesh(createHoverCarGeometry(), createCarMaterial(), count);
    this.bodies.castShadow = true;
    this.cars.forEach((c, i) => this.bodies.setColorAt(i, new THREE.Color(HOVER_PAINTS[i % HOVER_PAINTS.length])));

    // luzes: faróis, frisos e lanterna na cor do carro, bocais que pulsam com a potência
    const lightsGeo = createHoverLightsGeometry();
    const tint = new Float32Array(count * 3);
    this.cars.forEach((c, i) => tint.set([c.color.r, c.color.g, c.color.b], i * 3));
    lightsGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    this.power = new THREE.InstancedBufferAttribute(new Float32Array(count).fill(1), 1);
    this.power.setUsage(THREE.DynamicDrawUsage);
    lightsGeo.setAttribute('aPower', this.power);
    this.lights = new THREE.InstancedMesh(lightsGeo, createHoverLightsMaterial(), count);

    // rastro de luz saindo de cada bocal
    const trailGeo = mergeGeometries(
      [-1, 1].map((s) =>
        new THREE.PlaneGeometry(0.55, TRAIL_LEN, 1, 8).rotateX(-Math.PI / 2).translate(s * POD_X, POD_Y, NOZZLE_Z + TRAIL_LEN / 2),
      ),
    );
    trailGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
    this.trails = new THREE.InstancedMesh(
      trailGeo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        vertexShader: /* glsl */ `
          #include <bend_pars>
          attribute vec3 aTint;
          varying vec2 vUv; varying vec3 vTint;
          void main() {
            vUv = uv; vTint = aTint;
            gl_Position = projectionMatrix * bendView(modelViewMatrix * instanceMatrix * vec4(position, 1.0));
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv; varying vec3 vTint;
          void main() {
            float along = vUv.y;               // 1 = junto do bocal, 0 = ponta do rastro
            float across = abs(vUv.x - 0.5) * 2.0;
            float a = pow(clamp(along, 0.0, 1.0), 2.2) * smoothstep(1.0, 0.1, across);
            gl_FragColor = vec4(mix(vTint, vec3(1.0), 0.3 * along) * a * 0.8, 1.0);
          }
        `,
      }),
      count,
    );

    for (const m of [this.bodies, this.lights, this.trails]) {
      m.frustumCulled = false;
      scene.add(m);
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this._e.order = 'YXZ';
    this.obstacles = [];
    for (const c of this.cars) {
      c.curAlt = c.alt;
      c.curLat = c.lateral;
      c.along = wrapCoord(c.phase);
      c.v = c.speed;
    }
  }

  /**
   * Obstáculos no espaço "de casa" do mundo:
   * { x, z, y0, y1, hx, hz, modes: ['over' | 'under' | 'side', ...] }
   */
  setObstacles(list) {
    this.obstacles = list;
  }

  /** Para onde o carro quer ir agora (altitude e posição lateral), já desviando do que vem pela frente. */
  plan(c, i) {
    // 1) desvio de obstáculos na faixa (começa ~55 unidades antes, com folga generosa)
    let alt = c.alt;
    let lat = c.lateral;
    let nearObstacle = false;
    this.obstacles.forEach((o, k) => {
      const oAlong = c.axis === 'z' ? o.z : o.x;
      const oLat = c.axis === 'z' ? o.x : o.z;
      const hAlong = c.axis === 'z' ? o.hz : o.hx;
      const hLat = c.axis === 'z' ? o.hx : o.hz;
      if (Math.abs(wrapDelta(c.lateral - oLat)) > hLat + CAR_HALF_WIDTH + 0.8) return; // a faixa não cruza o obstáculo
      const d = Math.abs(wrapDelta(oAlong - c.along));
      if (d < hAlong + 70) nearObstacle = true; // perto de obstáculo: nada de ultrapassar
      if (c.alt > o.y1 + 2.2 || c.alt < o.y0 - 2.2) return; // já passa livre
      const w = 1 - THREE.MathUtils.smoothstep(d, hAlong + 10, hAlong + 55);
      if (w <= 0) return;
      const mode = o.modes[(i + k) % o.modes.length];
      if (mode === 'over') alt = Math.max(alt, THREE.MathUtils.lerp(c.alt, o.y1 + 3.0, w));
      else if (mode === 'under') alt = Math.min(alt, THREE.MathUtils.lerp(c.alt, Math.max(o.y0 - 2.6, MIN_ALT), w));
      else {
        const side = Math.sign(wrapDelta(c.lateral - oLat)) || 1;
        lat = THREE.MathUtils.lerp(c.lateral, oLat + side * (hLat + CAR_HALF_WIDTH + 1.8), w);
      }
    });
    // 2) carro mais lento à frente na mesma faixa: acompanha mantendo distância
    c.follow = this.leader(c);
    return { alt, lat };
  }

  /** Carro imediatamente à frente na mesma faixa (mesma avenida, sentido, lado e altura). */
  leader(c) {
    let best = null;
    for (const other of this.cars) {
      if (other === c || other.axis !== c.axis || other.dir !== c.dir || other.alt !== c.alt) continue;
      const gap = wrapDelta(other.along - c.along) * c.dir;
      if (gap <= 0 || gap > 22) continue;
      if (!best || gap < best.gap) best = { car: other, gap };
    }
    return best;
  }

  update(dt, t, cam) {
    const { _m: m, _q: q, _e: e, _p: p, _s: s } = this;
    this.cars.forEach((c, i) => {
      const target = this.plan(c, i);
      // velocidade integrada: quando não pode ultrapassar, freia para manter distância do carro da frente
      let vTarget = c.speed;
      if (c.follow) vTarget = Math.min(c.speed, c.follow.car.v * THREE.MathUtils.clamp((c.follow.gap - 7) / 9, 0, 1.08));
      const vPrev = c.v;
      c.v += (vTarget - c.v) * (1 - Math.exp(-3 * dt));
      const accel = (c.v - vPrev) / Math.max(dt, 1e-3);
      c.along = wrapCoord(c.along + c.dir * c.v * dt);
      c.curAlt = smoothDamp(c.curAlt, target.alt, c.spring, 'alt', 0.26, dt);
      c.curLat = smoothDamp(c.curLat, target.lat, c.spring, 'lat', 0.26, dt);
      // atitude: nariz acompanha a subida (e abaixa ao acelerar), asas inclinam e o nariz
      // aponta para dentro da manobra; tudo passa por molas para não haver estalos
      const vAlt = c.spring.alt || 0;
      const vLat = c.spring.lat || 0;
      const rightSpeed = c.axis === 'z' ? vLat * -c.dir : vLat * c.dir;
      const pitchT = THREE.MathUtils.clamp(Math.atan2(vAlt, Math.max(c.v, 8)) - accel * 0.012, -0.35, 0.35);
      const rollT = THREE.MathUtils.clamp(-rightSpeed * 0.07, -0.55, 0.55);
      const yawT = THREE.MathUtils.clamp(-rightSpeed * 0.035, -0.22, 0.22);
      c.pitch = smoothDamp(c.pitch, pitchT, c.spring, 'pitch', 0.18, dt);
      c.roll = smoothDamp(c.roll, rollT, c.spring, 'roll', 0.22, dt);
      c.yaw = smoothDamp(c.yaw, yawT, c.spring, 'yaw', 0.3, dt);
      const pitch = c.pitch + Math.sin(t * 1.1 + c.bob * 2) * 0.015;
      const roll = c.roll + Math.sin(t * 0.9 + c.bob) * 0.04;
      const bob = Math.sin(t * 1.3 + c.bob) * 0.3;
      // potência dos bocais: cresce com a velocidade e na aceleração, com leve tremulação
      this.power.setX(i, THREE.MathUtils.clamp(0.35 + (0.55 * c.v) / c.speed + accel * 0.05 + Math.sin(t * 37 + i * 3.1) * 0.06, 0.2, 1.3));
      if (c.axis === 'z') {
        p.set(cam.x + wrapDelta(c.curLat - cam.x), c.curAlt + bob, cam.z + wrapDelta(c.along - cam.z));
        e.set(pitch, (c.dir < 0 ? 0 : Math.PI) + c.yaw, roll);
      } else {
        p.set(cam.x + wrapDelta(c.along - cam.x), c.curAlt + bob, cam.z + wrapDelta(c.curLat - cam.z));
        e.set(pitch, (c.dir > 0 ? -Math.PI / 2 : Math.PI / 2) + c.yaw, roll);
      }
      q.setFromEuler(e);
      m.compose(p, q, s);
      this.bodies.setMatrixAt(i, m);
      this.lights.setMatrixAt(i, m);
      this.trails.setMatrixAt(i, m);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.lights.instanceMatrix.needsUpdate = true;
    this.trails.instanceMatrix.needsUpdate = true;
    this.power.needsUpdate = true;
  }
}
