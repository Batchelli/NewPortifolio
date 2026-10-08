import * as THREE from 'three';
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
import {
  CAR_LENGTH,
  CAR_MODELS,
  NEON_TINTS,
  CAR_PAINTS,
  WHEEL_R,
  carSpec,
  pickCarModel,
  createCarBodyGeometry,
  createCarLightsGeometry,
  createCarLightsMaterial,
  createCarMaterial,
  createWheelGeometry,
  createUnderglow,
} from './CarModels.js';

export { CAR_LENGTH, CAR_WIDTH, CAR_PAINTS, CAR_MODELS, pickCarModel, createCarGeometry, createCarMaterial } from './CarModels.js';

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


/*
 * Direção: Intelligent Driver Model (IDM, Treiber 2000). Cada carro calcula a aceleração
 * a partir da velocidade desejada, da distância até o obstáculo à frente e da velocidade
 * de aproximação. Resultado: arrancadas progressivas, frenagens antecipadas e paradas
 * macias na faixa de retenção, sem os "trancos" de uma aceleração constante.
 */
const IDM_A = 2.3; // aceleração confortável (m/s²)
const IDM_B = 3.0; // frenagem confortável
const IDM_T = 1.15; // distância de segurança em tempo (s)
const IDM_S0 = 1.7; // distância mínima parado (para-choque a para-choque)
const MAX_BRAKE = 9;
const YELLOW_BRAKE = 4.5; // freada que o motorista aceita para parar no amarelo

function idm(v, v0, s, dv) {
  const sStar = IDM_S0 + Math.max(0, v * IDM_T + (v * dv) / (2 * Math.sqrt(IDM_A * IDM_B)));
  const r = sStar / Math.max(s, 0.05);
  return IDM_A * (1 - (v / v0) ** 4 - r * r);
}

/** Mola amortecida (2ª ordem): balanço com um leve "rebote", como uma suspensão de verdade. */
function spring(state, key, target, omega, zeta, dt) {
  const vk = key + 'V';
  const a = omega * omega * (target - state[key]) - 2 * zeta * omega * state[vk];
  state[vk] += a * dt;
  state[key] += state[vk] * dt;
}

const _base = new THREE.Matrix4();
const _local = new THREE.Matrix4();
const _out = new THREE.Matrix4();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Trânsito nas ruas: os carros andam pela direita, mantêm distância do carro da frente,
 * respeitam os semáforos (inclusive ao cruzar as avenidas dos projetos) e param para o jogador.
 * Como as ruas dão a volta no planeta, cada carro roda na sua faixa para sempre.
 *
 * Visual: três modelos anos 80, rodas que giram de verdade, carroceria na suspensão
 * (mergulha na freada, agacha na arrancada, treme em marcha lenta), lanternas que
 * acendem com suavidade, frisos e luz de neon sob o carro.
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
        const model = pickCarModel(rnd);
        const vmax = (model === 'wedge' ? 11 : 9) + rnd() * 3.5;
        const neon = rnd() < 0.65;
        const car = {
          lane,
          model,
          along: wrapCoord(slot + (rnd() - 0.5) * 20),
          v: vmax * 0.5,
          vmax,
          acc: 0,
          // suspensão (molas amortecidas) e rodas
          pitch: 0,
          pitchV: 0,
          heave: 0,
          heaveV: 0,
          roll: 0,
          rollV: 0,
          spin: rnd() * 6,
          brake: 0,
          wait: 0,
          seed: rnd() * 100,
          paint: new THREE.Color(CAR_PAINTS[Math.floor(rnd() * CAR_PAINTS.length)]),
          neon: neon ? new THREE.Color(NEON_TINTS[Math.floor(rnd() * NEON_TINTS.length)]) : new THREE.Color(0, 0, 0),
        };
        lane.cars.push(car);
        this.cars.push(car);
      }
      // nunca há ultrapassagem: a ordem na faixa é fixa (cada carro segue o próximo)
      lane.cars.sort((a, b) => a.along * lane.dir - b.along * lane.dir);
    }
    const count = this.cars.length;

    // um lote (carroceria + luzes) por modelo; rodas, fachos e neon no chão são comuns
    const material = createCarMaterial();
    const lightsMat = createCarLightsMaterial();
    this.groups = CAR_MODELS.map((name) => {
      const cars = this.cars.filter((c) => c.model === name);
      const n = Math.max(cars.length, 1);
      const bodies = new THREE.InstancedMesh(createCarBodyGeometry(name), material, n);
      bodies.castShadow = true;
      cars.forEach((c, i) => {
        c.slot = i;
        bodies.setColorAt(i, c.paint);
      });
      const lightsGeo = createCarLightsGeometry(name);
      const tint = new Float32Array(n * 3);
      cars.forEach((c, i) => tint.set([c.neon.r, c.neon.g, c.neon.b], i * 3));
      lightsGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
      const light = new THREE.InstancedBufferAttribute(new Float32Array(n * 2).fill(1), 2);
      light.setUsage(THREE.DynamicDrawUsage);
      lightsGeo.setAttribute('aLight', light);
      const lights = new THREE.InstancedMesh(lightsGeo, lightsMat, n);
      bodies.count = lights.count = cars.length;
      return { name, spec: carSpec(name), cars, bodies, lights, light };
    });
    for (const car of this.cars) car.group = this.groups[CAR_MODELS.indexOf(car.model)];

    this.wheels = new THREE.InstancedMesh(createWheelGeometry(), material, count * 4);
    this.wheels.castShadow = true;

    this.glow = createUnderglow(count);
    const glowTint = new Float32Array(count * 3);
    this.cars.forEach((c, i) => glowTint.set([c.neon.r, c.neon.g, c.neon.b], i * 3));
    this.glow.geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(glowTint, 3));

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

    this.meshes = [...this.groups.flatMap((g) => [g.bodies, g.lights]), this.wheels, this.glow, this.beams];
    for (const m of this.meshes) {
      m.frustumCulled = false;
      scene.add(m);
    }
    this.onHonk = null;
    this._honkCooldown = 0;
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this._p = new THREE.Vector3();
  }

  /**
   * Aceleração desejada (IDM) considerando o carro da frente, o próximo semáforo
   * (vermelho = obstáculo parado na faixa de retenção) e o jogador na faixa.
   */
  desiredAccel(car, lead, t, player) {
    const lane = car.lane;
    const dir = lane.dir;
    const W = WORLD_SIZE;
    const v = car.v;
    let acc = IDM_A * (1 - (v / car.vmax) ** 4);
    if (lead) {
      const s = ((((lead.along - car.along) * dir) % W) + W) % W - CAR_LENGTH;
      acc = Math.min(acc, idm(v, car.vmax, s, v - lead.v));
    }
    // próximo cruzamento cuja faixa de retenção ainda não foi passada
    let best = null;
    for (const cr of lane.crossings) {
      const d = ((((cr.at - car.along) * dir) % W) + W) % W;
      if (d < cr.stop - 0.6) continue; // já passou da retenção: segue
      if (!best || d < best.d) best = { cr, d };
    }
    if (best) {
      const state = signalState(lane.signalAxis, best.cr.offset, t);
      const toLine = best.d - best.cr.stop;
      // freada constante que para exatamente na faixa (evita a reação exagerada do IDM puro)
      const kin = toLine > 0.3 ? -(v * v) / (2 * toLine) : -Infinity;
      const canStop = -kin < YELLOW_BRAKE;
      if (state === 2 || (state === 1 && canStop)) {
        // o sinal fechado vira um "carro parado" na faixa de retenção
        acc = Math.min(acc, Math.max(idm(v, car.vmax, toLine + IDM_S0, v), kin * 1.2));
      }
    }
    // jogador parado (ou andando) na faixa à frente
    car.blockedByPlayer = false;
    if (player) {
      const pAlong = lane.axis === 'x' ? player.z : player.x;
      const pLat = lane.axis === 'x' ? player.x : player.z;
      if (Math.abs(wrapDelta(pLat - lane.lat)) < 2.1) {
        const ahead = ((((pAlong - car.along) * dir) % W) + W) % W;
        if (ahead < 22) {
          const s = ahead - CAR_LENGTH / 2 - 1.6;
          const a = idm(v, car.vmax, s + IDM_S0, v);
          if (a < acc) {
            acc = a;
            car.blockedByPlayer = true;
          }
        }
      }
    }
    return Math.max(acc, -MAX_BRAKE);
  }

  update(dt, t, cam, player) {
    this._honkCooldown -= dt;
    const W = WORLD_SIZE;
    for (const lane of this.lanes) {
      const n = lane.cars.length;
      lane.cars.forEach((car, index) => {
        const lead = n > 1 ? lane.cars[(index + 1) % n] : null;
        const target = this.desiredAccel(car, lead, t, player);
        // limita o "tranco" (jerk): freadas respondem rápido, arrancadas entram progressivas
        const k = target < car.acc ? 6 : 3;
        car.acc += (target - car.acc) * (1 - Math.exp(-k * dt));
        const prev = car.v;
        car.v = Math.max(0, car.v + car.acc * dt);
        if (car.v === 0 && car.acc < 0) car.acc = 0;
        // garantia final: nunca encosta no carro da frente
        if (lead) {
          const s = ((((lead.along - car.along) * lane.dir) % W) + W) % W - CAR_LENGTH;
          if (s < 0.4) car.v = Math.min(car.v, lead.v);
        }
        car.along = wrapCoord(car.along + lane.dir * car.v * dt);
        car.spin += (car.v * dt) / WHEEL_R;

        // suspensão: mergulha na freada, agacha na arrancada e quica um pouco ao parar
        const accReal = (car.v - prev) / Math.max(dt, 1e-3);
        const moving = Math.min(car.v / 6, 1);
        spring(car, 'pitch', THREE.MathUtils.clamp(accReal * 0.011, -0.055, 0.04), 9, 0.32, dt);
        const road = (Math.sin(car.along * 1.7 + car.seed) + Math.sin(car.along * 3.3 + car.seed * 2)) * 0.006 * moving;
        const idle = car.v < 0.2 ? Math.sin(t * 34 + car.seed) * 0.004 : 0; // motor em marcha lenta
        spring(car, 'heave', road + idle - Math.abs(accReal) * 0.003, 14, 0.4, dt);
        spring(car, 'roll', Math.sin(car.along * 0.9 + car.seed) * 0.006 * moving + idle * 0.6, 11, 0.35, dt);

        // lanternas: freando (ou parado com o pé no freio) acendem forte; LED liga rápido e apaga suave
        const braking = car.acc < -0.7 || car.v < 0.15 ? 1 : 0;
        car.brake += (braking - car.brake) * (1 - Math.exp(-(braking ? 18 : 5) * dt));

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
    this.render(cam);
  }

  render(cam) {
    const { _e: e, _p: p } = this;
    this.cars.forEach((car, i) => {
      const lane = car.lane;
      const group = car.group;
      const spec = group.spec;
      const hx = lane.axis === 'x' ? lane.lat : car.along;
      const hz = lane.axis === 'x' ? car.along : lane.lat;
      const yaw = Math.atan2(-lane.f[0], -lane.f[1]);
      p.set(cam.x + wrapDelta(hx - cam.x), 0, cam.z + wrapDelta(hz - cam.z));
      _qa.setFromAxisAngle(Y_AXIS, yaw);
      _base.compose(p, _qa, _one);
      this.beams.setMatrixAt(i, _base);
      this.glow.setMatrixAt(i, _base);

      // carroceria sobre a suspensão (as rodas ficam no chão)
      e.set(car.pitch, yaw, car.roll);
      _qb.setFromEuler(e);
      _v.set(p.x, car.heave, p.z);
      _out.compose(_v, _qb, _one);
      group.bodies.setMatrixAt(car.slot, _out);
      group.lights.setMatrixAt(car.slot, _out);
      group.light.setXY(car.slot, car.brake, 1);

      // rodas: giram conforme a distância percorrida (as da esquerda estão espelhadas)
      let w = i * 4;
      for (const z of spec.wheelZ) {
        for (const s of [-1, 1]) {
          _qb.setFromAxisAngle(Y_AXIS, s < 0 ? Math.PI : 0);
          _qa.setFromAxisAngle(X_AXIS, s < 0 ? car.spin : -car.spin);
          _qb.multiply(_qa);
          _local.compose(_v.set(s * spec.track, WHEEL_R, z), _qb, _one);
          _out.multiplyMatrices(_base, _local);
          this.wheels.setMatrixAt(w++, _out);
        }
      }
    });
    for (const g of this.groups) {
      g.bodies.instanceMatrix.needsUpdate = true;
      g.lights.instanceMatrix.needsUpdate = true;
      g.light.needsUpdate = true;
    }
    for (const m of [this.wheels, this.glow, this.beams]) m.instanceMatrix.needsUpdate = true;
  }
}
