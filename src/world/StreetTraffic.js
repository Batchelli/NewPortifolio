import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { WORLD_SIZE, wrapDelta, wrapCoord } from '../core/Planet.js';
import {
  BLOCK,
  GRID_N,
  STREET_LINES,
  LANE_OFFSET,
  STREET_CROSS_STOP,
  AVENUE_CROSS_STOP,
} from '../core/CityPlan.js';
import { mulberry } from './Scenery.js';
import { ledTime } from './neon.js';

/* ================================================================== */
/*  Carro de rua (frente = -z). Pintura vem da cor da instância.       */
/* ================================================================== */
export const CAR_LENGTH = 4.4;
export const CAR_WIDTH = 1.9;
export const CAR_PAINTS = ['#e8e6f0', '#1c1a26', '#c0283c', '#2c4bd8', '#e0a020', '#26a0a8', '#7b3fd0', '#ff6aa8', '#7a7f8a', '#3a8a4a'];

function painted(geo, rgb) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) arr.set(rgb, i);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(key)) g.deleteAttribute(key);
  return g;
}

/** Carroceria anos 80: capô comprido, cabine recuada, janelas escuras e rodas. */
export function createCarGeometry() {
  const PAINT = [1, 1, 1];
  const GLASS = [0.05, 0.06, 0.09];
  const DARK = [0.06, 0.05, 0.08];
  const parts = [
    painted(new THREE.BoxGeometry(CAR_WIDTH, 0.55, CAR_LENGTH).translate(0, 0.6, 0), PAINT),
    painted(new THREE.BoxGeometry(1.62, 0.5, 2.1).translate(0, 1.12, 0.3), PAINT),
    painted(new THREE.BoxGeometry(1.66, 0.34, 2.14).translate(0, 1.08, 0.3), GLASS),
    painted(new THREE.BoxGeometry(1.96, 0.18, 0.2).translate(0, 0.42, -2.2), DARK),
    painted(new THREE.BoxGeometry(1.96, 0.18, 0.2).translate(0, 0.42, 2.2), DARK),
  ];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.push(painted(new THREE.CylinderGeometry(0.34, 0.34, 0.28, 8).rotateZ(Math.PI / 2).translate(sx * 0.86, 0.34, sz * 1.35), DARK));
    }
  }
  return mergeGeometries(parts);
}

export function createCarMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.38, envMapIntensity: 0.7 });
}

/* ================================================================== */
/*  Semáforos: a mesma conta roda no shader das lentes e aqui           */
/* ================================================================== */
export const SIGNAL_HALF = 8; // meio ciclo (s)
export const SIGNAL_GREEN = 6;
export const SIGNAL_YELLOW = 7.5;
/** Defasagem de cada cruzamento (ix = rua NS ou GRID_N p/ avenida; iz idem). */
export const signalOffset = (ix, iz) => ((ix * 3 + iz * 5) % 4) * 2;

/** 0 = verde, 1 = amarelo, 2 = vermelho. axis: 0 = trânsito N–S (ruas x fixo), 1 = L–O. */
export function signalState(axis, offset, t) {
  const p = SIGNAL_HALF * 2;
  const local = (((t + offset - axis * SIGNAL_HALF) % p) + p) % p;
  if (local < SIGNAL_GREEN) return 0;
  if (local < SIGNAL_YELLOW) return 1;
  return 2;
}

/** GLSL equivalente (para as lentes dos semáforos). */
export const SIGNAL_GLSL = /* glsl */ `
  float signalState(float axis, float offset, float t) {
    float p = ${(SIGNAL_HALF * 2).toFixed(1)};
    float local = mod(t + offset - axis * ${SIGNAL_HALF.toFixed(1)}, p);
    if (local < ${SIGNAL_GREEN.toFixed(1)}) return 0.0;
    if (local < ${SIGNAL_YELLOW.toFixed(1)}) return 1.0;
    return 2.0;
  }
`;

/**
 * Todas as faixas de rolamento e os cruzamentos de cada uma.
 * axis 'x' = ruas N–S (x fixo, o carro anda em z); 'z' = ruas L–O.
 */
export function laneLayout() {
  const lanes = [];
  for (const axis of ['x', 'z']) {
    STREET_LINES.forEach((line, k) => {
      for (const dir of [1, -1]) {
        // frente f e direita r (mão inglesa não: no Brasil se anda pela direita)
        const f = axis === 'x' ? [0, dir] : [dir, 0];
        const r = [-f[1], f[0]];
        const lat = line + (axis === 'x' ? r[0] : r[1]) * LANE_OFFSET;
        const crossings = [];
        STREET_LINES.forEach((c, m) => {
          const ix = axis === 'x' ? k : m;
          const iz = axis === 'x' ? m : k;
          crossings.push({ at: c, stop: STREET_CROSS_STOP + CAR_LENGTH / 2 + 0.2, avenue: false, offset: signalOffset(ix, iz) });
        });
        // a avenida dos projetos (x = 0 ou z = 0)
        const ix = axis === 'x' ? k : GRID_N;
        const iz = axis === 'x' ? GRID_N : k;
        crossings.push({ at: 0, stop: AVENUE_CROSS_STOP + CAR_LENGTH / 2 + 0.2, avenue: true, offset: signalOffset(ix, iz) });
        lanes.push({ axis, k, line, dir, f, r, lat, crossings, signalAxis: axis === 'x' ? 0 : 1, cars: [] });
      }
    });
  }
  return lanes;
}

const ACCEL = 3.2;
const DECEL = 6.5;
const MIN_GAP = CAR_LENGTH + 1.8; // distância centro a centro com o carro da frente parado

/**
 * Trânsito nas ruas: os carros andam pela direita, mantêm distância do carro da frente,
 * respeitam os semáforos (inclusive ao cruzar as avenidas dos projetos) e param para o jogador.
 * Como as ruas dão a volta no planeta, cada carro roda na sua faixa para sempre.
 */
export class StreetTraffic {
  constructor(scene, { perLane = 3 } = {}) {
    const rnd = mulberry(77);
    this.lanes = laneLayout();
    this.cars = [];
    for (const lane of this.lanes) {
      // cada carro nasce no meio de um quarteirão diferente (nunca dentro de um cruzamento)
      const mids = Array.from({ length: GRID_N - 1 }, (_, m) => wrapCoord(BLOCK * (m + 1)));
      for (let m = 0; m < Math.min(perLane, mids.length); m++) {
        const slot = mids.splice(Math.floor(rnd() * mids.length), 1)[0];
        const along = wrapCoord(slot + (rnd() - 0.5) * 20);
        const car = {
          lane,
          along,
          v: 0,
          vmax: 9 + rnd() * 4,
          brake: false,
          pitch: 0,
          wait: 0,
          paint: new THREE.Color(CAR_PAINTS[Math.floor(rnd() * CAR_PAINTS.length)]),
        };
        lane.cars.push(car);
        this.cars.push(car);
      }
      // nunca há ultrapassagem: a ordem na faixa é fixa (cada carro segue o próximo)
      lane.cars.sort((a, b) => a.along * lane.dir - b.along * lane.dir);
    }

    const count = this.cars.length;
    this.bodies = new THREE.InstancedMesh(createCarGeometry(), createCarMaterial(), count);
    this.bodies.castShadow = true;
    this.cars.forEach((c, i) => this.bodies.setColorAt(i, c.paint));

    const heads = mergeGeometries([-1, 1].map((s) => new THREE.BoxGeometry(0.42, 0.14, 0.05).translate(s * 0.62, 0.7, -2.23)));
    this.heads = new THREE.InstancedMesh(heads, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.9) }), count);
    // lanterna traseira de ponta a ponta (bem anos 80); acende forte na frenagem
    const tails = mergeGeometries([
      new THREE.BoxGeometry(1.7, 0.12, 0.05).translate(0, 0.72, 2.23),
      ...[-1, 1].map((s) => new THREE.BoxGeometry(0.4, 0.2, 0.05).translate(s * 0.68, 0.72, 2.24)),
    ]);
    this.tails = new THREE.InstancedMesh(tails, new THREE.MeshBasicMaterial({ color: '#ffffff' }), count);
    this.tailOn = new THREE.Color(3.2, 0.12, 0.2);
    this.tailOff = new THREE.Color(1.05, 0.05, 0.1);
    this.cars.forEach((c, i) => this.tails.setColorAt(i, this.tailOff));

    // fachos dos faróis no asfalto
    const beamGeo = new THREE.PlaneGeometry(2.8, 11).rotateX(-Math.PI / 2).translate(0, 0.05, -2.2 - 5.5);
    this.beams = new THREE.InstancedMesh(
      beamGeo,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { uTime: ledTime },
        vertexShader: /* glsl */ `
          #include <bend_pars>
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * bendView(modelViewMatrix * instanceMatrix * vec4(position, 1.0));
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            float along = vUv.y; // 0 = junto do carro, 1 = ponta do facho
            float spread = mix(0.25, 0.5, along);
            float across = smoothstep(spread, 0.0, abs(vUv.x - 0.5));
            float a = across * smoothstep(0.0, 0.08, along) * pow(1.0 - along, 1.6);
            gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * a * 0.32, 1.0);
          }
        `,
      }),
      count,
    );

    for (const m of [this.bodies, this.heads, this.tails, this.beams]) {
      m.frustumCulled = false;
      scene.add(m);
    }
    this.onHonk = null;
    this._honkCooldown = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
  }

  /** Distância livre à frente do carro (até o carro da frente, o semáforo ou o jogador). */
  freeGap(car, index, t, player) {
    const lane = car.lane;
    const dir = lane.dir;
    const W = WORLD_SIZE;
    let gap = Infinity;
    const n = lane.cars.length;
    if (n > 1) {
      const lead = lane.cars[(index + 1) % n];
      gap = (((lead.along - car.along) * dir) % W + W) % W - MIN_GAP;
    }
    // próximo cruzamento cuja faixa de retenção ainda não foi passada
    let best = null;
    for (const cr of lane.crossings) {
      const d = (((cr.at - car.along) * dir) % W + W) % W;
      if (d < cr.stop - 0.6) continue; // já passou da retenção: segue
      if (!best || d < best.d) best = { cr, d };
    }
    if (best) {
      const state = signalState(lane.signalAxis, best.cr.offset, t);
      const toLine = best.d - best.cr.stop;
      const canStop = toLine > (car.v * car.v) / (2 * DECEL) - 0.5;
      if (state === 2 || (state === 1 && canStop)) gap = Math.min(gap, toLine);
    }
    // jogador parado (ou andando) na faixa à frente
    car.blockedByPlayer = false;
    if (player) {
      const pAlong = lane.axis === 'x' ? player.z : player.x;
      const pLat = lane.axis === 'x' ? player.x : player.z;
      if (Math.abs(wrapDelta(pLat - lane.lat)) < 2.1) {
        const ahead = (((pAlong - car.along) * dir) % W + W) % W;
        if (ahead < 18) {
          const g = ahead - CAR_LENGTH / 2 - 1.6;
          if (g < gap) {
            gap = g;
            car.blockedByPlayer = true;
          }
        }
      }
    }
    return gap;
  }

  update(dt, t, cam, player) {
    this._honkCooldown -= dt;
    for (const lane of this.lanes) {
      lane.cars.forEach((car, index) => {
        const gap = this.freeGap(car, index, t, player);
        const vGap = Math.sqrt(Math.max(0, 2 * DECEL * Math.max(gap - 0.2, 0)));
        const target = Math.min(car.vmax, vGap);
        const prev = car.v;
        if (target < car.v) car.v = Math.max(target, car.v - DECEL * 1.6 * dt);
        else car.v = Math.min(target, car.v + ACCEL * dt);
        if (gap < 0.05) car.v = 0;
        car.brake = car.v < prev - 0.01 || car.v < 0.3;
        // "mergulho" da suspensão na freada / agachada na arrancada
        const acc = (car.v - prev) / Math.max(dt, 1e-3);
        car.pitch += (THREE.MathUtils.clamp(acc * 0.006, -0.035, 0.035) - car.pitch) * (1 - Math.exp(-6 * dt));
        car.along = wrapCoord(car.along + lane.dir * car.v * dt);
        // buzina: jogador plantado na frente de um carro parado
        if (car.blockedByPlayer && car.v < 0.3) car.wait += dt;
        else car.wait = 0;
        if (car.wait > 1.6 && this._honkCooldown <= 0) {
          this._honkCooldown = 3.5;
          car.wait = 0;
          this.onHonk?.();
        }
      });
    }

    const { _m: m, _q: q, _e: e, _p: p, _s: s } = this;
    this.cars.forEach((car, i) => {
      const lane = car.lane;
      const hx = lane.axis === 'x' ? lane.lat : car.along;
      const hz = lane.axis === 'x' ? car.along : lane.lat;
      p.set(cam.x + wrapDelta(hx - cam.x), 0, cam.z + wrapDelta(hz - cam.z));
      e.set(car.pitch, Math.atan2(-lane.f[0], -lane.f[1]), 0);
      q.setFromEuler(e);
      m.compose(p, q, s);
      this.bodies.setMatrixAt(i, m);
      this.heads.setMatrixAt(i, m);
      this.tails.setMatrixAt(i, m);
      this.beams.setMatrixAt(i, m);
      this.tails.setColorAt(i, car.brake ? this.tailOn : this.tailOff);
    });
    for (const mesh of [this.bodies, this.heads, this.tails, this.beams]) mesh.instanceMatrix.needsUpdate = true;
    this.tails.instanceColor.needsUpdate = true;
  }
}
