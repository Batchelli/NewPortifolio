import * as THREE from 'three';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { WORLD_SIZE, HALF_WORLD, wrapDelta } from '../core/Planet.js';

const EYE = 1.7;
const WALK = 7.5;
const SPRINT = 14;
const GRAVITY = 26;
const JUMP = 9;
const BODY_RADIUS = 0.5;
const BASE_FOV = 70;
const GRID_CELL = 16; // tamanho da célula da grade de colisão

export class Player {
  constructor(camera, domElement) {
    this.camera = camera;
    this.controls = new PointerLockControls(camera, domElement);
    this.position = new THREE.Vector3(0, 0, 8);
    this.velocity = new THREE.Vector3();
    this.vy = 0;
    this.onGround = true;
    this.enabled = false;
    this.keys = new Set();
    this.touchMove = new THREE.Vector2();
    this.colliders = [];
    this.bobPhase = 0;
    this.lastBob = 0;
    this.baseFov = BASE_FOV;
    this.onStep = null;
    this.onJump = null;
    /** chamado ao cruzar a borda do mundo: (eixo 'x' | 'z', sentido +1 | -1) */
    this.onWrap = null;
    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.roll = 0; // inclinação lateral da câmera ao andar de lado
    this.landDip = 0; // afundada da câmera ao aterrissar
    this.landVel = 0;

    const movementKeys = new Set([
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'ShiftLeft', 'ShiftRight', 'Space',
    ]);
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || !movementKeys.has(e.code)) return;
      e.preventDefault();
      this.keys.add(e.code);
      if (e.code === 'Space') this.jump();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /**
   * Obstáculos: círculos { x, z, r } (postes, árvores, pedestais) e caixas { x, z, hx, hz }
   * (prédios, carros). Ficam numa grade espacial que dá a volta no mundo, então cada
   * frame só testa os obstáculos da célula onde o jogador está.
   */
  setColliders(list) {
    this.colliders = list;
    const n = Math.max(1, Math.round(WORLD_SIZE / GRID_CELL));
    const cell = WORLD_SIZE / n;
    const cells = Array.from({ length: n * n }, () => []);
    const cellOf = (v) => Math.floor((v + HALF_WORLD) / cell);
    const wrapI = (i) => ((i % n) + n) % n;
    for (const c of list) {
      const ex = (c.hx ?? c.r) + BODY_RADIUS + 0.05;
      const ez = (c.hz ?? c.r) + BODY_RADIUS + 0.05;
      for (let i = cellOf(c.x - ex); i <= cellOf(c.x + ex); i++) {
        for (let j = cellOf(c.z - ez); j <= cellOf(c.z + ez); j++) cells[wrapI(i) * n + wrapI(j)].push(c);
      }
    }
    this.grid = { n, cells, cellOf, wrapI };
  }

  collide() {
    const p = this.position;
    let list = this.colliders;
    if (this.grid) {
      const { n, cells, cellOf, wrapI } = this.grid;
      list = cells[wrapI(cellOf(p.x)) * n + wrapI(cellOf(p.z))];
    }
    for (const c of list) {
      const dx = wrapDelta(p.x - c.x);
      const dz = wrapDelta(p.z - c.z);
      if (c.hx !== undefined) {
        // caixa: empurra para fora pelo ponto mais próximo (ou pelo lado de menor invasão)
        const qx = Math.max(-c.hx, Math.min(c.hx, dx));
        const qz = Math.max(-c.hz, Math.min(c.hz, dz));
        const ox = dx - qx;
        const oz = dz - qz;
        const d2 = ox * ox + oz * oz;
        if (d2 > 1e-8) {
          if (d2 < BODY_RADIUS * BODY_RADIUS) {
            const d = Math.sqrt(d2);
            p.x += (ox / d) * (BODY_RADIUS - d);
            p.z += (oz / d) * (BODY_RADIUS - d);
          }
        } else {
          const px = c.hx + BODY_RADIUS - Math.abs(dx);
          const pz = c.hz + BODY_RADIUS - Math.abs(dz);
          if (px < pz) p.x += Math.sign(dx || 1) * px;
          else p.z += Math.sign(dz || 1) * pz;
        }
        continue;
      }
      const min = c.r + BODY_RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x += (dx / d) * (min - d);
        p.z += (dz / d) * (min - d);
      }
    }
  }

  set sensitivity(v) {
    this.controls.pointerSpeed = v;
  }

  spawn(x, z, yaw = 0) {
    this.position.set(x, 0, z);
    this.velocity.set(0, 0, 0);
    this.vy = 0;
    this.camera.position.set(x, EYE, z);
    this.roll = 0;
    this.landDip = 0;
    this.landVel = 0;
    this._euler.set(0, yaw, 0);
    this.camera.quaternion.setFromEuler(this._euler);
  }

  /** Pose que a câmera deve ter ao entrar no jogo (usada na transição do menu). */
  getSpawnPose() {
    return { position: new THREE.Vector3(this.position.x, EYE, this.position.z), quaternion: this.camera.quaternion.clone() };
  }

  jump() {
    if (!this.enabled || !this.onGround) return;
    this.vy = JUMP;
    this.onGround = false;
    this.onJump?.();
  }

  /** Olhar com toque (celular): dx/dy em pixels. */
  look(dx, dy) {
    this._euler.setFromQuaternion(this.camera.quaternion);
    this._euler.y -= dx * 0.0042;
    this._euler.x -= dy * 0.0042;
    this._euler.x = THREE.MathUtils.clamp(this._euler.x, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    this.camera.quaternion.setFromEuler(this._euler);
  }

  releaseKeys() {
    this.keys.clear();
    this.touchMove.set(0, 0);
  }

  update(dt) {
    const k = this.keys;
    let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    let r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    f += this.touchMove.y;
    r += this.touchMove.x;
    const len = Math.hypot(f, r);
    if (len > 1) {
      f /= len;
      r /= len;
    }
    const sprinting = (k.has('ShiftLeft') || k.has('ShiftRight') || this.touchMove.length() > 0.95) && f > 0;

    this._euler.setFromQuaternion(this.camera.quaternion);
    const yaw = this._euler.y;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    const speed = sprinting ? SPRINT : WALK;
    const tx = (fx * f + rx * r) * speed;
    const tz = (fz * f + rz * r) * speed;
    const accel = 1 - Math.exp(-(len > 0 ? 10 : 8) * dt * (this.onGround ? 1 : 0.35));
    this.velocity.x += (tx - this.velocity.x) * accel;
    this.velocity.z += (tz - this.velocity.z) * accel;

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;

    this.collide();

    // Sem paredes: ao cruzar a borda, o jogador continua do lado oposto do planeta.
    // Como tudo é desenhado relativo a ele, a troca é invisível.
    for (const axis of ['x', 'z']) {
      if (this.position[axis] > HALF_WORLD) {
        this.position[axis] -= WORLD_SIZE;
        this.onWrap?.(axis, 1);
      } else if (this.position[axis] < -HALF_WORLD) {
        this.position[axis] += WORLD_SIZE;
        this.onWrap?.(axis, -1);
      }
    }

    // Pulo / gravidade
    this.vy -= GRAVITY * dt;
    this.position.y += this.vy * dt;
    if (this.position.y <= 0) {
      if (!this.onGround && this.vy < -4) {
        this.onStep?.(true);
        this.landVel = Math.max(this.vy * 0.06, -0.9); // impulso para baixo, amortecido por mola
      }
      this.position.y = 0;
      this.vy = 0;
      this.onGround = true;
    }

    // Balanço da cabeça e passos
    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    let bob = 0;
    if (this.onGround && hSpeed > 0.6) {
      this.bobPhase += dt * hSpeed * 1.25;
      bob = Math.sin(this.bobPhase) * 0.055 * Math.min(hSpeed / WALK, 1.6);
      const s = Math.sin(this.bobPhase);
      if (this.lastBob > 0 && s <= 0) this.onStep?.(false);
      this.lastBob = s;
    }
    // mola da aterrissagem (desce e volta suave, com um leve quique)
    this.landVel += (-this.landDip * 120 - this.landVel * 14) * dt;
    this.landDip += this.landVel * dt;
    this.camera.position.set(this.position.x, this.position.y + EYE + bob + this.landDip, this.position.z);

    // inclina levemente a câmera ao andar de lado (sensação de movimento mais orgânica)
    const lateral = this.velocity.x * rx + this.velocity.z * rz;
    const targetRoll = THREE.MathUtils.clamp(-lateral * 0.0012, -0.012, 0.012);
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-4 * dt));
    this._euler.setFromQuaternion(this.camera.quaternion);
    this._euler.z = this.roll;
    this.camera.quaternion.setFromEuler(this._euler);

    // FOV aumenta ao correr
    const targetFov = this.baseFov + (sprinting && hSpeed > WALK ? 9 : 0);
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-6 * dt));
      this.camera.updateProjectionMatrix();
    }
  }
}
