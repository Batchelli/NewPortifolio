import * as THREE from 'three';
import { Sky } from './Sky.js';
import { Ground, MAX_LIGHT_POOLS } from './Ground.js';
import { createMountains, createCity, createPalms, WrappedInstances } from './Scenery.js';
import { Pedestal, COLLIDER_RADIUS, INTERACT_RADIUS } from './Pedestal.js';
import { ledTime, ledMaterial, frameGeometry, createMarquee } from './neon.js';
import { lampLayout, createLamps } from './Props.js';
import { Traffic } from './Traffic.js';
import { createBlimp, createFireflies } from './Blimp.js';
import { City } from './City.js';
import { createBeacon, createEmblem, emblemY, ScanPulse } from './Beacon.js';
import { createCityPlan, streetDist, CURB_OUT } from '../core/CityPlan.js';
import {
  WORLD_SIZE,
  HALF_WORLD,
  ROAD_WIDTH,
  PLAZA_RADIUS,
  FIRST_SLOT,
  SLOT_SPACING,
  wrapDelta,
  horizonDip,
} from '../core/Planet.js';
import {
  canvasTexture,
  createPreviewCanvas,
  createProfileCanvas,
  createSignCanvas,
  createDirectoryCanvas,
  directoryHeight,
  DIRECTORY_W,
  imageToPreviewCanvas,
  FONT_PIXEL,
  FONT_MONO,
} from '../utils/textures.js';
import { createHoverSign } from './HoverSign.js';

const SIDE_OFFSET = 12.5; // distância do pedestal até o centro da estrada
// placas flutuantes das avenidas: logo na saída da praça, antes do primeiro projeto
const ROAD_SIGN_DIST = PLAZA_RADIUS + 12;
const ROAD_SIGN_Y = 11; // bem acima da linha dos olhos: informa sem tapar a avenida
const ROAD_SIGN_W = 6;
// textos abaixo do limiar do bloom (1.0), para ficarem nítidos
const SIGN_TINT = new THREE.Color(0.95, 0.95, 0.95);

/**
 * Placa legível dos dois lados (um plano em cada face; nada de texto espelhado),
 * com moldura de LED em volta (a moldura brilha, o texto fica nítido).
 */
function twoSidedSign(geometry, map, ledHex, extra = {}) {
  const mat = new THREE.MeshBasicMaterial({ map, transparent: true, color: SIGN_TINT, ...extra });
  const g = new THREE.Group();
  const front = new THREE.Mesh(geometry, mat);
  const back = new THREE.Mesh(geometry, mat);
  back.rotation.y = Math.PI;
  back.position.z = -0.02;
  g.add(front, back);
  if (ledHex) {
    const { width, height } = geometry.parameters;
    const frame = new THREE.Mesh(frameGeometry(width + 0.16, height + 0.16, 0.07), ledMaterial(ledHex, 2.2));
    frame.material.side = THREE.DoubleSide;
    frame.position.z = -0.01;
    g.add(frame);
  }
  return g;
}

/**
 * Quatro braços saindo da praça. Norte e Sul são a MESMA avenida (o meridiano),
 * Leste e Oeste são o mesmo bulevar (o equador): seguindo reto, você dá a volta
 * no planeta e chega de novo na praça pelo lado oposto.
 */
const ARMS = [
  { id: 'north', dir: [0, -1], road: 'AV. MERIDIANO', label: 'NORTE', color: '#00f0ff' },
  { id: 'east', dir: [1, 0], road: 'BULEVAR EQUADOR', label: 'LESTE', color: '#ff2a9d', terminal: 'about' },
  { id: 'west', dir: [-1, 0], road: 'BULEVAR EQUADOR', label: 'OESTE', color: '#ff2a9d', terminal: 'contact' },
  { id: 'south', dir: [0, 1], road: 'AV. MERIDIANO', label: 'SUL', color: '#00f0ff' },
];

export class World {
  constructor(engine, owner, projects) {
    this.engine = engine;
    this.scene = engine.scene;
    this.owner = owner;
    this.size = WORLD_SIZE;
    this.pedestals = [];
    this.colliders = [];
    this.wrapped = []; // objetos simples reposicionados na cópia mais próxima
    this.instanced = []; // WrappedInstances
    this.animated = [];
    this.focused = null;
    this._img = { x: 0, z: 0 };
    this.discovered = new Set();
    this.trackedId = null;

    this.setupLights();
    this.sky = new Sky(this.scene);
    // planta da cidade (ruas, quarteirões, bairros): o chão, os prédios e o trânsito leem a mesma
    this.plan = createCityPlan();
    this.ground = new Ground(this.scene, this.plan);

    // Cenário de fundo "no infinito": acompanha a câmera como o céu
    this.mountains = createMountains();
    this.skyline = createCity();
    this.scene.add(this.mountains, this.skyline);
    const dip = Math.tan(horizonDip());
    this.mountainsDrop = 560 * dip + 1;
    this.skylineDrop = 800 * dip + 1;

    this.scan = new ScanPulse(this.scene);
    this.buildLayout(projects);
  }

  /** Projeto já visitado? (os terminais Sobre mim / Contato contam como "não-projeto") */
  isFound(item) {
    return item.kind !== 'project' || this.discovered.has(item.id);
  }

  /** Dispara o pulso de radar a partir de (x, z). Retorna false se ainda houver um em andamento. */
  triggerScan(x, z) {
    if (this.scan.running) return false;
    this.scan.start(x, z);
    return true;
  }

  setupLights() {
    const scene = this.scene;
    // Luz ambiente: céu rosado em cima, roxo escuro refletido do chão
    scene.add(new THREE.HemisphereLight('#d877dc', '#1a0630', 1.1));

    // "Sol" baixo no horizonte (direção norte): sombras longas vindo na direção do jogador.
    // A câmera de sombra acompanha o jogador, então as sombras existem em todo o planeta.
    this.sunDir = new THREE.Vector3(0, 0.42, -1).normalize();
    const sun = (this.sunLight = new THREE.DirectionalLight('#ffa07a', 2.0));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -70;
    sc.right = 70;
    sc.top = 70;
    sc.bottom = -70;
    sc.near = 1;
    sc.far = 300;
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.05;
    scene.add(sun, sun.target);

    const fill = new THREE.DirectionalLight('#00e5ff', 0.45);
    fill.position.set(60, 30, 80);
    scene.add(fill);

    // Luz do holograma mais próximo: pinta a base e o entorno com a cor do projeto
    this.focusLight = new THREE.PointLight('#ffffff', 0, 30, 2);
    scene.add(this.focusLight);

    // Mapa de ambiente "neon" para os metais refletirem rosa/ciano
    const envScene = new THREE.Scene();
    envScene.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(10, 32, 16),
        new THREE.ShaderMaterial({
          side: THREE.BackSide,
          vertexShader: `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
          fragmentShader: `varying vec3 vP; void main(){
            vec3 col = mix(vec3(1.0,0.15,0.55), vec3(0.08,0.0,0.18), smoothstep(-0.1, 0.6, vP.y));
            col = mix(vec3(0.05,0.0,0.1), col, smoothstep(-0.4, -0.05, vP.y));
            gl_FragColor = vec4(col, 1.0); }`,
        }),
      ),
    );
    const strip = (color, x, y, z, ry) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 6, 0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4) }));
      m.position.set(x, y, z);
      m.rotation.set(0, ry, Math.PI / 2);
      envScene.add(m);
    };
    strip('#00f0ff', 0, 4, -8, 0);
    strip('#00f0ff', 8, 3, 0, Math.PI / 2);
    strip('#ff2a9d', -8, 3, 0, Math.PI / 2);
    strip('#ffd319', 0, 5, 8, 0);
    const pmrem = new THREE.PMREMGenerator(this.engine.renderer);
    scene.environment = pmrem.fromScene(envScene, 0.03).texture;
    scene.environmentIntensity = 0.9;
    pmrem.dispose();
  }

  /* ------------------------------------------------------------------ */
  buildLayout(projects) {
    const owner = this.owner;
    const perArm = ARMS.map(() => []);
    projects.forEach((p, i) => perArm[i % ARMS.length].push({ ...p, kind: 'project', index: i }));

    // Terminais especiais entram no fim da lista do seu braço
    ARMS.forEach((arm, a) => {
      if (arm.terminal === 'about') {
        perArm[a].push({
          kind: 'about',
          id: 'about',
          title: 'Sobre mim',
          subtitle: owner.role,
          description: owner.about.join(' '),
          tags: owner.skills.slice(0, 6),
          color: '#00f0ff',
          canvas: createProfileCanvas(owner, 'about'),
          action: 'VER PERFIL',
        });
      } else if (arm.terminal === 'contact') {
        perArm[a].push({
          kind: 'contact',
          id: 'contact',
          title: 'Contato',
          subtitle: 'Vamos conversar?',
          description: 'Aberto a novas oportunidades, projetos freelance e colaborações. Aperte E para ver meus links.',
          tags: owner.links.map((l) => l.label),
          color: '#ffd319',
          canvas: createProfileCanvas(owner, 'contact'),
          action: 'VER CONTATOS',
        });
      }
    });

    const palmHomes = [];
    this.roadSignObstacles = [];

    ARMS.forEach((arm, a) => {
      const dir = new THREE.Vector2(arm.dir[0], arm.dir[1]);
      const perp = new THREE.Vector2(-dir.y, dir.x);
      const items = perArm[a];

      items.forEach((item, k) => {
        const s = FIRST_SLOT + k * SLOT_SPACING;
        const side = k % 2 === 0 ? 1 : -1;
        const x = dir.x * s + perp.x * side * SIDE_OFFSET;
        const z = dir.y * s + perp.y * side * SIDE_OFFSET;
        const action = item.action || (item.url ? 'ABRIR PROJETO' : 'EM BREVE');
        const p = this.addPedestal(item, x, z, action, item.canvas);
        p.facing = new THREE.Vector2(perp.x * side, perp.y * side); // do centro da estrada para o pedestal
      });

      // Palmeiras no calçadão, ao longo de todo o braço (sem invadir as ruas que cruzam a avenida)
      for (let s = PLAZA_RADIUS + 8; s < HALF_WORLD - 4; s += 15) {
        if (Math.abs(s - HALF_WORLD) < 14) continue; // espaço para o arco do antípoda
        if (streetDist(s) < CURB_OUT + 1.5) continue;
        for (const side of [-1, 1]) {
          const off = 18.6 + ((s * 7) % 3) * 0.5;
          const px = dir.x * s + perp.x * side * off;
          const pz = dir.y * s + perp.y * side * off;
          palmHomes.push([px, pz]);
          this.colliders.push({ x: px, z: pz, r: 0.6 });
        }
      }

      this.addRoadSign(dir, arm, items);
    });

    // Arcos nos pontos opostos do planeta (onde Norte encontra Sul e Leste encontra Oeste)
    this.addAntipodeArch(0, HALF_WORLD, 0, 'MERIDIANO 180°', '#00f0ff');
    this.addAntipodeArch(HALF_WORLD, 0, Math.PI / 2, 'EQUADOR 180°', '#ff2a9d');

    // Postes de luz ao longo das avenidas (no meio de cada quarteirão)
    const lamps = lampLayout(ARMS);
    const lampMeshes = createLamps(lamps);
    this.scene.add(...lampMeshes);
    this.instanced.push(new WrappedInstances(lampMeshes, lamps.map((l) => [l.x, l.z])));
    for (const l of lamps) this.colliders.push({ x: l.x, z: l.z, r: 0.3 });

    const palms = createPalms(palmHomes);
    palms.castShadow = true;
    palms.receiveShadow = true;
    this.scene.add(palms);
    this.instanced.push(new WrappedInstances([palms], palmHomes));

    // A cidade: ruas paralelas às avenidas, quarteirões, bairros, trânsito e tudo o que dá vida às calçadas
    this.city = new City(this, this.plan, owner);
    this.mapCanvas = this.city.mapCanvas;

    this.addWelcomeSign();

    // Vida no céu e no ar: carros voadores, dirigível com letreiro de LED e vaga-lumes
    this.traffic = new Traffic(this.scene, 9);
    // o que os carros precisam contornar (coordenadas "de casa" do mundo)
    this.traffic.setObstacles([
      // letreiro de boas-vindas (com lâmpadas e a flutuação de ±0.4)
      // (a faixa rápida desvia pelo lado; por cima/baixo invadiria a outra faixa ou o cruzamento)
      { x: 0, z: -PLAZA_RADIUS - 6, y0: 13.5, y1: 22.5, hx: 8.8, hz: 0.5, modes: ['side'] },
      // placas dos arcos dos antípodas: entre os pilares, a faixa lenta passa por baixo
      { x: 0, z: HALF_WORLD, y0: 8.2, y1: 11.0, hx: 5.3, hz: 0.4, modes: ['under'] },
      { x: HALF_WORLD, z: 0, y0: 8.2, y1: 11.0, hx: 0.4, hz: 5.3, modes: ['under'] },
      ...this.roadSignObstacles,
    ]);
    const name = owner.name.toUpperCase();
    const role = owner.role.toUpperCase();
    this.blimp = createBlimp(
      `★ PORTIMAX ★ ${name} · ${role} ★ ${projects.length} PROJETOS PARA DESCOBRIR ★ SIGA AS ESTRADAS DE NEON ★ O MUNDO NÃO TEM FIM `,
    );
    this.scene.add(this.blimp.group);
    this.scene.add(createFireflies());
  }

  /** Bairro e rua/avenida num ponto do mundo (para o HUD). */
  locate(x, z) {
    return this.city.locate(x, z);
  }

  /** Registra um objeto que deve ser sempre desenhado na cópia mais próxima do jogador. */
  addWrapped(obj, x, z) {
    obj.position.x = x;
    obj.position.z = z;
    this.wrapped.push({ obj, x, z });
    this.scene.add(obj);
  }

  addPedestal(item, x, z, actionLabel, customCanvas) {
    const canvas = customCanvas || createPreviewCanvas(item);
    const tex = canvasTexture(canvas);
    item.thumb = item.image || canvas.toDataURL('image/jpeg', 0.75);
    delete item.canvas;
    const p = new Pedestal(item, tex, actionLabel);
    p.home = new THREE.Vector2(x, z);
    p.setPosition(x, z);
    p.beacon = createBeacon(item.color);
    p.emblem = createEmblem(item);
    p.group.add(p.beacon.mesh, p.emblem.mesh);
    this.scene.add(p.group);
    this.pedestals.push(p);
    this.colliders.push({ x, z, r: COLLIDER_RADIUS });

    if (item.image) {
      const img = new Image();
      img.onload = () => {
        p.setPreview(canvasTexture(imageToPreviewCanvas(img)));
        tex.dispose();
      };
      img.src = item.image;
    }
    return p;
  }

  /**
   * Placa-diretório flutuando no centro da avenida, logo na saída da praça: nome da via
   * e a lista dos projetos daquele trecho (o primeiro "cartaz" que deixa claro o propósito do mundo).
   */
  addRoadSign(dir, arm, items) {
    const nProjects = items.filter((i) => i.kind === 'project').length;
    const extra = arm.terminal === 'about' ? ' + SOBRE MIM' : arm.terminal === 'contact' ? ' + CONTATO' : '';
    const subtitle = `${arm.label} · ${nProjects} PROJETO${nProjects === 1 ? '' : 'S'}${extra}`;
    const rows = items.map((item, k) => ({
      mark: item.kind === 'project' ? String(item.index + 1).padStart(2, '0') : item.kind === 'about' ? 'i' : '@',
      title: item.title,
      color: item.color,
      circle: item.kind !== 'project',
      dist: Math.round(FIRST_SLOT + k * SLOT_SPACING - ROAD_SIGN_DIST),
    }));
    const canvas = createDirectoryCanvas(arm.road, subtitle, rows, arm.color);
    const width = ROAD_SIGN_W;
    const height = width * (directoryHeight(rows.length) / DIRECTORY_W);
    const sign = createHoverSign(canvasTexture(canvas), width, height, arm.color, ROAD_SIGN_Y);
    const x = dir.x * ROAD_SIGN_DIST;
    const z = dir.y * ROAD_SIGN_DIST;
    // de frente para a praça
    sign.group.rotation.y = Math.atan2(-x, -z);
    this.addWrapped(sign.group, x, z);
    this.animated.push((dt, t) => sign.update(t));
    // os carros voadores da faixa baixa contornam a placa pelo lado
    const { y0, y1, halfW } = sign.extent;
    const alongZ = dir.x === 0;
    this.roadSignObstacles.push({ x, z, y0, y1, hx: alongZ ? halfW : 0.6, hz: alongZ ? 0.6 : halfW, modes: ['side'] });
  }

  /** Arco neon no ponto do planeta mais distante da praça. */
  addAntipodeArch(x, z, rotY, title, color) {
    const g = new THREE.Group();
    g.rotation.y = rotY;
    const metal = new THREE.MeshStandardMaterial({ color: '#1b1430', metalness: 0.85, roughness: 0.3 });
    const neon = ledMaterial(color, 2.6);
    const yellow = ledMaterial('#ffd319', 2.4);
    const half = ROAD_WIDTH / 2 + 2;
    for (const sx of [-1, 1]) {
      const pillar = new THREE.Mesh(new THREE.BoxGeometry(1.4, 12, 1.4), metal);
      pillar.position.set(sx * half, 6, 0);
      pillar.castShadow = true;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 11, 0.12), neon);
      stripe.position.set(sx * half - sx * 0.72, 6, 0.72);
      const stripeBack = stripe.clone();
      stripeBack.position.z = -0.72;
      g.add(pillar, stripe, stripeBack);
      const wp = new THREE.Vector3(sx * half, 0, 0).applyEuler(g.rotation);
      this.colliders.push({ x: x + wp.x, z: z + wp.z, r: 1.2 });
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(half, 0.22, 10, 64, Math.PI), neon);
    arch.position.y = 12;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(half - 1.2, 0.08, 8, 64, Math.PI), yellow);
    ring.position.y = 12;
    g.add(arch, ring);
    const canvas = createSignCanvas(
      [
        { text: title, size: 76, color: '#ffffff' },
        { text: 'O OUTRO LADO DO MUNDO · SIGA EM FRENTE', size: 24, color: '#ffd319', font: FONT_PIXEL, weight: 400 },
      ],
      color,
    );
    const sign = twoSidedSign(new THREE.PlaneGeometry(10, 2.5), canvasTexture(canvas), color);
    sign.position.set(0, 9.6, 0);
    g.add(sign);
    this.addWrapped(g, x, z);
  }

  addWelcomeSign() {
    const o = this.owner;
    const canvas = createSignCanvas(
      [
        { text: 'BEM-VINDO AO MEU MUNDO', size: 30, color: '#ffd319', font: FONT_PIXEL, weight: 400 },
        { text: o.name.toUpperCase(), size: 96, color: '#ffffff' },
        { text: o.role, size: 44, color: '#00f0ff', font: FONT_MONO, weight: 400 },
        { text: 'SIGA AS ESTRADAS · ENCONTRE OS PROJETOS', size: 22, color: '#ff8fd8', font: FONT_PIXEL, weight: 400 },
      ],
      '#ff2a9d',
      1280,
      560,
    );
    const sign = twoSidedSign(new THREE.PlaneGeometry(16, 7), canvasTexture(canvas), '#ff2a9d', { depthWrite: false });
    // lâmpadas de letreiro correndo em volta
    sign.add(createMarquee(16.9, 7.9, 0.7, '#ffd319', { radius: 0.15 }));
    sign.position.y = 18;
    this.addWrapped(sign, 0, -PLAZA_RADIUS - 6);
    this.animated.push((dt, t) => {
      sign.position.y = 18 + Math.sin(t * 0.9) * 0.4;
    });
  }

  /** Posição em frente a um pedestal (usada pela viagem rápida). */
  viewpointFor(id) {
    const p = this.pedestals.find((x) => x.item.id === id);
    if (!p) return null;
    // fica perto do centro da estrada, olhando para o pedestal
    const pos = p.home.clone().sub(p.facing.clone().multiplyScalar(11));
    const yaw = Math.atan2(-p.facing.x, -p.facing.y);
    return { x: pos.x, z: pos.y, yaw };
  }

  update(dt, t, camera, mode) {
    const cam = camera.position;
    this.sky.update(dt, t, camera);
    this.ground.update(dt, t, camera);
    this.skyline.material.uniforms.uTime.value = t;
    this.mountains.position.set(cam.x, cam.y - 1.7 - this.mountainsDrop, cam.z);
    this.skyline.position.set(cam.x, cam.y - 1.7 - this.skylineDrop, cam.z);
    ledTime.value = t;
    for (const fn of this.animated) fn(dt, t);

    // dirigível circulando a praça
    const a = t * 0.035;
    const bx = Math.cos(a) * 95;
    const bz = Math.sin(a) * 95;
    const bg = this.blimp.group;
    bg.position.set(cam.x + wrapDelta(bx - cam.x), 42 + Math.sin(t * 0.3) * 1.5, cam.z + wrapDelta(bz - cam.z));
    bg.rotation.set(Math.sin(t * 0.4) * 0.02, Math.atan2(-Math.cos(a), -Math.sin(a)), 0);
    this.blimp.update(t);
    this.traffic.update(dt, t, cam);
    // no menu a câmera passeia pela avenida: os carros só param para o jogador de verdade
    this.city.update(dt, t, cam, mode === 'play' ? cam : null);

    // cada objeto na cópia do mundo mais próxima do jogador
    for (const w of this.wrapped) {
      w.obj.position.x = cam.x + wrapDelta(w.x - cam.x);
      w.obj.position.z = cam.z + wrapDelta(w.z - cam.z);
    }
    for (const inst of this.instanced) inst.update(cam);

    // sol acompanha o jogador (em passos fixos, para as sombras não "tremerem")
    const sx = Math.round(cam.x / 2) * 2;
    const sz = Math.round(cam.z / 2) * 2;
    this.sunLight.target.position.set(sx, 0, sz);
    this.sunLight.position.set(sx + this.sunDir.x * 150, this.sunDir.y * 150, sz + this.sunDir.z * 150);

    const playing = mode === 'play';
    const portrait = this.engine.camera.aspect < 1;
    let best = null;
    let nearest = null;
    for (const p of this.pedestals) {
      p.setPosition(cam.x + wrapDelta(p.home.x - cam.x), cam.z + wrapDelta(p.home.y - cam.z));
      p.update(dt, t, camera, { allowExpand: playing, portrait });
      if (playing && p.dist < INTERACT_RADIUS && (!best || p.dist < best.dist)) best = p;
      if (!nearest || p.dist < nearest.dist) nearest = p;
    }
    for (const p of this.pedestals) p.focused = p === best;
    this.focused = best;

    // faróis e emblemas: os não visitados chamam mais atenção, mas os já vistos continuam fáceis de achar
    this.scan.update(dt, cam);
    const scan = this.scan.level;
    for (const p of this.pedestals) {
      const u = p.beacon.uniforms;
      const tracked = p.item.id === this.trackedId;
      const found = this.isFound(p.item);
      // de perto o holograma é o destaque: feixe e emblema se recolhem
      const far = THREE.MathUtils.smoothstep(p.dist, 16, 48);
      let a = tracked ? 1.5 : found ? 0.6 : 1;
      a *= (1 + scan * 0.8) * far;
      u.uAlpha.value = a;
      u.uPulse.value = tracked ? 1.6 : found ? 0.25 + scan * 0.75 : 1;
      u.uWidth.value = tracked ? 3.4 : 2.4;
      u.uFlash.value = this.scan.hit(p.position.x, p.position.z);

      // emblema com tamanho angular quase constante: legível de longe, sem tomar a tela de perto
      const em = p.emblem.uniforms;
      p.emblem.mesh.position.y = emblemY(p.dist);
      em.uSize.value = THREE.MathUtils.clamp(p.dist * 0.17, 10, 55) * (found && !tracked ? 0.85 : 1) * (tracked ? 1.15 : 1);
      em.uTitle.value = tracked ? 1 : 1 - THREE.MathUtils.smoothstep(p.dist, 120, 170);
      em.uAlpha.value = THREE.MathUtils.smoothstep(p.dist, 22, 46) * (found && !tracked ? 0.85 : 1);
      em.uFound.value = found && !tracked ? 1 : 0;
      // raio-x através dos prédios só para o destino da rota e durante o radar (senão vira poluição)
      em.uGhost.value = Math.max(tracked ? 0.45 : 0, scan * 0.35);
      p.emblem.ghost.visible = em.uGhost.value > 0.01;
    }

    // luz pontual no pedestal mais próximo, mais forte conforme o holograma se expande
    const fl = this.focusLight;
    if (nearest && nearest.dist < 45) {
      fl.position.set(nearest.position.x, 4.5, nearest.position.z);
      fl.color.copy(nearest.color);
      const target = (5 + 5 * nearest.expand) * THREE.MathUtils.clamp((nearest.dist - 4) / 8, 0.6, 1);
      fl.intensity += (target - fl.intensity) * (1 - Math.exp(-4 * dt));
    } else fl.intensity *= Math.exp(-4 * dt);

    // poças de luz no chão: pedestais primeiro, depois as luzes da cidade mais próximas
    const pools = this.pedestals
      .filter((p) => p.dist < 120)
      .sort((a, b) => a.dist - b.dist)
      // cada projeto num "palco": uma poça de luz larga na cor dele, como obra iluminada numa galeria
      .map((p) => ({
        x: p.position.x,
        z: p.position.z,
        radius: 10 + 2 * p.expand,
        intensity: 0.17 + 0.06 * p.expand,
        color: p.color,
      }));
    const free = MAX_LIGHT_POOLS - pools.length;
    if (free > 0) {
      const near = [];
      for (const l of this.city.lights) {
        const x = cam.x + wrapDelta(l.x - cam.x);
        const z = cam.z + wrapDelta(l.z - cam.z);
        const d = Math.hypot(x - cam.x, z - cam.z);
        if (d < 110) near.push({ x, z, d, radius: l.radius, intensity: l.intensity, color: l.color });
      }
      near.sort((a, b) => a.d - b.d);
      pools.push(...near.slice(0, free));
    }
    this.ground.setLightPools(pools);
  }

  /** Liga/desliga as sombras (qualidade gráfica). */
  setShadows(on) {
    this.sunLight.castShadow = on;
    this.ground.shadowMesh.visible = on;
  }
}
