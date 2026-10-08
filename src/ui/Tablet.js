import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

/**
 * ============================================================
 *  O tablet do jogador (UI diegética)
 * ============================================================
 * Todo menu do jogo acontece num tablet que o personagem segura, à moda do
 * Pip-Boy (Fallout) e do RIG (Dead Space):
 *
 *  - o aparelho é um modelo 3D de verdade, desenhado numa cena própria por cima
 *    do mundo (Engine.addOverlay): nunca atravessa paredes e ganha bloom/CRT;
 *  - a tela é HTML real (TabletOS) projetado no vidro com o CSS3DRenderer, com a
 *    mesma câmera: texto nítido, mouse e teclado funcionando, perspectiva correta;
 *  - tudo se move com molas amortecidas: sobe girando da cintura, balança na mão,
 *    inclina atrás do cursor e dá um "tranco" a cada toque.
 */

// medidas (metros), tela 16:10
const SCREEN_W = 0.3;
const SCREEN_H = 0.1875;
const BODY_W = 0.324;
const BODY_H = 0.2115;
const CASE_W = 0.346;
const CASE_H = 0.2335;
const GRIP_X = CASE_W / 2 + 0.011;
const FULL_W = CASE_W + 0.05; // com as alças
const FULL_H = CASE_H + 0.03; // com a antena
const SCREEN_Z = 0.0056;

/** Tamanho lógico do HTML da tela (o CSS3DRenderer escala para o vidro). */
export const SCREEN_PX = { w: 1280, h: 800 };
/** No celular em pé a tela tem menos "pixels lógicos": o texto fica maior no aparelho pequeno. */
const SCREEN_PX_PORTRAIT = { w: 540, h: 864 };

/* ------------------------------------------------------------------ */
/*  Geometria                                                          */
/* ------------------------------------------------------------------ */
function roundedRectPath(path, w, h, r) {
  const x = w / 2 - r;
  const y = h / 2 - r;
  path.moveTo(-x, -h / 2);
  path.lineTo(x, -h / 2);
  path.absarc(x, -y, r, -Math.PI / 2, 0, false);
  path.lineTo(w / 2, y);
  path.absarc(x, y, r, 0, Math.PI / 2, false);
  path.lineTo(-x, h / 2);
  path.absarc(-x, y, r, Math.PI / 2, Math.PI, false);
  path.lineTo(-w / 2, -y);
  path.absarc(-x, -y, r, Math.PI, Math.PI * 1.5, false);
  return path;
}

function roundedShape(w, h, r, hole = null) {
  const s = roundedRectPath(new THREE.Shape(), w, h, r);
  if (hole) s.holes.push(roundedRectPath(new THREE.Path(), ...hole));
  return s;
}

/** Placa arredondada extrudada em z, centrada na origem, com chanfro. */
function slab(shape, depth, bevel, segments = 10) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(depth - 2 * bevel, 0.0005),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 2,
    curveSegments: segments,
  });
  g.translate(0, 0, -(depth - 2 * bevel) / 2);
  return g;
}

function roundedBox(w, h, d, r, bevel = 0.0015) {
  return slab(roundedShape(w, h, r), d, bevel, 6);
}

/** Etiqueta gravada na moldura inferior. */
function labelTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 48;
  const ctx = c.getContext('2d');
  ctx.font = '700 26px "Orbitron", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#9a86c4';
  ctx.fillText('PORTIMAX  ·  NX-84', 256, 26);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/* ------------------------------------------------------------------ */
/*  Mola amortecida (2ª ordem)                                         */
/* ------------------------------------------------------------------ */
class Spring {
  constructor(value = 0, omega = 10, zeta = 0.7) {
    this.x = value;
    this.v = 0;
    this.omega = omega;
    this.zeta = zeta;
  }

  update(target, dt) {
    // sub-passos: estável mesmo com quedas de framerate
    const n = Math.ceil(dt / (1 / 120));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const a = this.omega * this.omega * (target - this.x) - 2 * this.zeta * this.omega * this.v;
      this.v += a * h;
      this.x += this.v * h;
    }
    return this.x;
  }
}

/* ------------------------------------------------------------------ */
export class Tablet {
  /**
   * @param {import('../core/Engine.js').Engine} engine
   * @param {HTMLElement} screenEl  raiz do TabletOS (vira a tela do aparelho)
   */
  constructor(engine, screenEl) {
    this.engine = engine;
    this.camera = engine.camera;
    this.screenEl = screenEl;

    this.scene = new THREE.Scene();
    engine.addOverlay(this.scene);
    this.rig = new THREE.Group(); // segue a câmera
    this.rig.matrixAutoUpdate = false;
    this.scene.add(this.rig);
    this.device = new THREE.Group(); // pose animada, no espaço da câmera
    this.rig.add(this.device);
    this.body = new THREE.Group(); // gira 90° no celular em pé
    this.device.add(this.body);

    this.color = new THREE.Color('#00f0ff');
    this.targetColor = this.color.clone();
    this.buildModel();
    this.buildLights();

    // tela HTML no vidro
    this.css = new CSS3DRenderer();
    this.css.domElement.className = 'tablet-layer';
    document.body.appendChild(this.css.domElement);
    this.cssScene = new THREE.Scene();
    this.cssObject = new CSS3DObject(screenEl);
    this.cssObject.matrixAutoUpdate = false;
    this.cssScene.add(this.cssObject);
    this.screenAnchor = new THREE.Object3D();
    this.screenAnchor.position.z = SCREEN_Z + 0.0004;
    this.body.add(this.screenAnchor);

    // estado da animação
    this.opened = false;
    this.closeAt = Infinity; // descida agendada (a tela termina de desligar antes)
    this.lift = new Spring(0, 7.5, 0.62); // 0 = guardado, 1 = na frente dos olhos; sobe com um pequeno overshoot
    this.tilt = new Spring(0, 6, 0.72); // a rotação chega um pouco depois da posição
    this.push = new Spring(0, 26, 0.38); // "tranco" dos toques
    this.parX = new Spring(0, 7, 0.8);
    this.parY = new Spring(0, 7, 0.8);
    this.led = 0; // faixa de LED se desenhando ao ligar (0..1)
    this.ledTarget = 0;
    this.mouse = new THREE.Vector2();
    this.time = 0;
    this.portrait = false;
    window.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
    });

    this._m = new THREE.Matrix4();
    this._s = new THREE.Matrix4();
    this.resize();
    this.setVisible(false);
  }

  /* ---------------- Modelo ---------------- */
  buildModel() {
    const chassis = new THREE.MeshStandardMaterial({ color: '#211830', metalness: 0.75, roughness: 0.32, envMapIntensity: 1.1 });
    const rubber = new THREE.MeshStandardMaterial({ color: '#120c1c', metalness: 0.05, roughness: 0.78 });
    const rubberDark = new THREE.MeshStandardMaterial({ color: '#0a0710', metalness: 0.05, roughness: 0.9 });
    const metal = new THREE.MeshStandardMaterial({ color: '#7d7394', metalness: 0.95, roughness: 0.22 });
    this.glassMat = new THREE.MeshStandardMaterial({ color: '#04020a', metalness: 0.9, roughness: 0.06, envMapIntensity: 1.4 });
    const b = this.body;

    // corpo e vidro
    b.add(new THREE.Mesh(slab(roundedShape(BODY_W, BODY_H, 0.016), 0.011, 0.0018, 12), chassis));
    const glass = new THREE.Mesh(new THREE.ShapeGeometry(roundedShape(SCREEN_W + 0.004, SCREEN_H + 0.004, 0.004), 4), this.glassMat);
    glass.position.z = SCREEN_Z;
    b.add(glass);

    // capa robusta (borda de borracha) com cantoneiras
    const ring = slab(roundedShape(CASE_W, CASE_H, 0.024, [BODY_W + 0.002, BODY_H + 0.002, 0.017]), 0.018, 0.003, 12);
    b.add(new THREE.Mesh(ring, rubber));
    const guards = [];
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        guards.push(roundedBox(0.032, 0.032, 0.024, 0.011).translate(sx * (CASE_W / 2 - 0.008), sy * (CASE_H / 2 - 0.008), 0));
      }
    }
    b.add(new THREE.Mesh(mergeGeometries(guards), rubberDark));

    // alças laterais com estrias
    const grips = [];
    const ridges = [];
    for (const sx of [-1, 1]) {
      grips.push(roundedBox(0.026, 0.14, 0.028, 0.01).translate(sx * GRIP_X, 0, -0.002));
      for (let k = -4; k <= 4; k++) ridges.push(roundedBox(0.006, 0.006, 0.03, 0.002, 0.001).translate(sx * (GRIP_X + sx * 0.011), k * 0.014, -0.002));
    }
    b.add(new THREE.Mesh(mergeGeometries(grips), rubber));
    b.add(new THREE.Mesh(mergeGeometries(ridges), rubberDark));

    // botões no topo, antena e câmera frontal
    const top = CASE_H / 2;
    const parts = [
      roundedBox(0.026, 0.006, 0.008, 0.002, 0.0008).translate(-0.1, top + 0.002, 0),
      roundedBox(0.016, 0.006, 0.008, 0.002, 0.0008).translate(-0.07, top + 0.002, 0),
      new THREE.CylinderGeometry(0.0035, 0.005, 0.03, 10).translate(0.125, top + 0.015, -0.004),
      new THREE.CylinderGeometry(0.0022, 0.0022, 0.012, 8).rotateX(Math.PI / 2).translate(0, BODY_H / 2 - 0.006, SCREEN_Z - 0.0042),
    ];
    b.add(new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed())), metal));
    this.antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.0042, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.2, 0.5) }));
    this.antennaTip.position.set(0.125, top + 0.032, -0.004);
    b.add(this.antennaTip);

    // etiqueta gravada na moldura de baixo e três LEDs de status
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.075, 0.007),
      new THREE.MeshBasicMaterial({ map: labelTexture(), transparent: true, opacity: 0.9, depthWrite: false }),
    );
    label.position.set(-0.08, -BODY_H / 2 + 0.006, SCREEN_Z + 0.0001);
    b.add(label);
    this.statusLeds = new THREE.Mesh(
      mergeGeometries([0, 1, 2].map((k) => new THREE.CircleGeometry(0.0013, 10).translate(0.115 + k * 0.006, -BODY_H / 2 + 0.006, SCREEN_Z + 0.0001))),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.2, 1.2) }),
    );
    b.add(this.statusLeds);

    // faixa de LED em volta da tela, que se "desenha" ao ligar e corre luz pela borda
    const ledGeo = slab(roundedShape(CASE_W - 0.007, CASE_H - 0.007, 0.0205, [CASE_W - 0.0115, CASE_H - 0.0115, 0.018]), 0.0012, 0, 12);
    ledGeo.translate(0, 0, 0.009);
    this.ledUniforms = {
      uColor: { value: new THREE.Color() },
      uProgress: { value: 0 },
      uTime: { value: 0 },
      uPower: { value: 0 },
    };
    const led = new THREE.Mesh(
      ledGeo,
      new THREE.ShaderMaterial({
        uniforms: this.ledUniforms,
        vertexShader: /* glsl */ `
          varying vec2 vP;
          void main() {
            vP = position.xy;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uProgress, uTime, uPower;
          varying vec2 vP;
          void main() {
            // posição ao longo da borda (0 = centro de baixo), desenhando para os dois lados
            float a = atan(vP.x, -vP.y * 1.5) / 3.14159265; // -1..1
            float t = abs(a);
            float on = smoothstep(uProgress + 0.02, uProgress - 0.02, t);
            // pulso de luz correndo pela borda
            float chase = pow(0.5 + 0.5 * cos((a - uTime * 0.35) * 6.2831853), 24.0);
            vec3 c = uColor * (0.55 + 0.9 * chase) * on * uPower;
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
    );
    b.add(led);
  }

  buildLights() {
    this.scene.add(new THREE.HemisphereLight('#b9a3ff', '#120020', 0.7));
    const key = new THREE.DirectionalLight('#ffd0f0', 2.2);
    key.position.set(-0.6, 1, 0.8);
    const rim = new THREE.DirectionalLight('#00f0ff', 1.6);
    rim.position.set(1, 0.2, -0.6);
    this.rig.add(key, key.target, rim, rim.target);
    key.target.position.set(0, 0, -0.5);
    rim.target.position.set(0, 0, -0.5);
    // luz da própria tela derramando na moldura e nas alças
    this.spill = new THREE.PointLight(this.color, 0, 0.6, 1.5);
    this.spill.position.set(0, 0, 0.06);
    this.body.add(this.spill);
  }

  /** O mundo emprestado como reflexo (mesmo env map da cidade). */
  setEnvironment(env) {
    this.scene.environment = env;
  }

  /* ---------------- Estado ---------------- */
  /** Está na mão (ou subindo). Vira false assim que mandamos guardar. */
  get isOpen() {
    return this.opened;
  }

  /** Quanto o tablet está na frente dos olhos (0..1), para escurecer o fundo etc. */
  get amount() {
    return THREE.MathUtils.clamp(this.lift.x, 0, 1);
  }

  open() {
    this.opened = true;
    this.closeAt = Infinity; // reabriu no meio da descida: cancela
    if (!this.visible) {
      // sempre parte da pose guardada, fora do quadro
      this.lift.x = this.tilt.x = 0;
      this.lift.v = this.tilt.v = 0;
    }
    this.setVisible(true);
    this.ledTarget = 1;
  }

  /** Guarda o tablet; `delay` (s) deixa a tela terminar de desligar ainda na frente dos olhos. */
  close(delay = 0) {
    this.opened = false;
    this.closeAt = this.time + delay;
  }

  /** Pequeno tranco (toque na tela, troca de app). */
  bump(strength = 1) {
    this.push.v -= 0.12 * strength;
  }

  setAccent(hex) {
    this.targetColor.set(hex);
  }

  setVisible(on) {
    if (this.visible === on) return;
    this.visible = on;
    this.css.domElement.style.display = on ? '' : 'none';
    this.device.visible = on;
  }

  /* ---------------- Layout ---------------- */
  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.css.setSize(w, h);
    this.portrait = w / h < 0.9;
    this.body.rotation.z = this.portrait ? Math.PI / 2 : 0;
    this.screenAnchor.rotation.z = this.portrait ? -Math.PI / 2 : 0;
    const px = this.portrait ? SCREEN_PX_PORTRAIT : SCREEN_PX;
    this.screenEl.style.width = `${px.w}px`;
    this.screenEl.style.height = `${px.h}px`;
    this.screenEl.classList.toggle('portrait', this.portrait);
    this.cssScale = (this.portrait ? SCREEN_H : SCREEN_W) / px.w;
    this.fitDistance();
  }

  /** Distância em que o aparelho inteiro cabe na tela com folga. */
  fitDistance() {
    const cam = this.camera;
    const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const tanX = tanY * cam.aspect;
    const devW = this.portrait ? FULL_H : FULL_W;
    const devH = this.portrait ? FULL_W : FULL_H;
    // enquadra pela TELA (a capa pode vazar um pouco nas bordas, como um aparelho na mão num jogo)
    const scrW = this.portrait ? SCREEN_H : SCREEN_W;
    const scrH = this.portrait ? SCREEN_W : SCREEN_H;
    this.distance = Math.max(scrW / (2 * tanX * 0.8), scrH / (2 * tanY * 0.8), devW / (2 * tanX * 1.0), devH / (2 * tanY * 1.18));
  }

  /* ---------------- Quadro a quadro ---------------- */
  update(dt) {
    this.time += dt;
    // subindo: mola com overshoot. Descendo: mola sem rebote mirando ABAIXO da pose guardada,
    // então ele passa por ela com velocidade e some na hora (nada de ficar "parado" no rodapé)
    const dropping = !this.opened && this.time >= this.closeAt;
    if (dropping) this.ledTarget = 0;
    this.lift.omega = dropping ? 9 : 7.5;
    this.lift.zeta = dropping ? 1 : 0.62;
    this.tilt.zeta = dropping ? 1 : 0.72;
    const target = dropping ? -0.4 : 1;
    const k = this.lift.update(target, dt);
    const r = this.tilt.update(target, dt);
    const push = this.push.update(0, dt);
    const open = THREE.MathUtils.clamp(k, -0.5, 1.2);
    if (!this.visible) return;
    if (dropping && k <= 0) {
      this.setVisible(false);
      return;
    }

    // parallax: o tablet inclina levemente atrás do cursor (como um card 3D)
    const px = this.parX.update(this.mouse.x * 0.07, dt);
    const py = this.parY.update(this.mouse.y * 0.05, dt);
    // balanço da mão: respiração + tremor bem sutil
    const t = this.time;
    const swayX = Math.sin(t * 0.9) * 0.004 + Math.sin(t * 2.3) * 0.0012;
    const swayY = Math.sin(t * 1.3 + 1) * 0.003 + Math.sin(t * 3.1) * 0.0008;

    const d = this.distance;
    const dev = this.device;
    // guardado: abaixo do campo de visão, deitado e virado; na frente: centralizado e de frente
    dev.position.set(
      THREE.MathUtils.lerp(d * 0.4, 0, open) + swayX,
      THREE.MathUtils.lerp(-d * 1.7, 0, open) + swayY,
      -d - push - (1 - Math.min(open, 1)) * d * 0.15,
    );
    const rr = THREE.MathUtils.clamp(r, -0.5, 1.2);
    dev.rotation.set(
      THREE.MathUtils.lerp(-1.25, 0, rr) - py + Math.sin(t * 1.1) * 0.006,
      THREE.MathUtils.lerp(-0.35, 0, rr) + px + Math.sin(t * 0.7) * 0.008,
      THREE.MathUtils.lerp(0.32, 0, rr) + Math.sin(t * 0.8 + 2) * 0.004,
    );

    // LED da borda, cor por app e luz derramada da tela
    this.led += (this.ledTarget - this.led) * (1 - Math.exp(-(this.ledTarget ? 2.6 : 9) * dt));
    this.color.lerp(this.targetColor, 1 - Math.exp(-6 * dt));
    const u = this.ledUniforms;
    u.uProgress.value = this.led * 1.05;
    u.uTime.value = t;
    u.uPower.value = Math.min(this.led * 1.5, 1);
    u.uColor.value.copy(this.color).multiplyScalar(2.2);
    this.spill.color.copy(this.color);
    this.spill.intensity = 0.25 * this.led;
    this.antennaTip.material.color.setRGB(2.4, 0.2, 0.5).multiplyScalar(0.25 + 0.75 * (Math.sin(t * 5) > 0.6 ? 1 : 0));

    // o rig acompanha a câmera; a tela HTML acompanha o vidro
    const cam = this.camera;
    cam.updateMatrixWorld();
    this.rig.matrix.copy(cam.matrixWorld);
    this.rig.matrixWorldNeedsUpdate = true;
    this.scene.updateMatrixWorld();
    this._s.makeScale(this.cssScale, this.cssScale, this.cssScale);
    this.cssObject.matrix.multiplyMatrices(this.screenAnchor.matrixWorld, this._s);
    this.cssObject.matrixWorldNeedsUpdate = true;
    this.css.render(this.cssScene, cam);
  }
}
