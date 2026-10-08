import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF_WORLD, WORLD_SIZE, wrapCoord } from '../core/Planet.js';
import {
  BLOCK,
  CURB_OUT,
  LOT_HALF,
  GRID_N,
  AVENUE_CELL,
  STREET_LINES,
  PARK_OFFSET,
  STREET_LAMP_OFFSET,
  STREET_LAMP_SPACING,
  DISTRICTS,
  D,
  PARK,
  LOT,
  cellOf,
  streetLine,
  streetName,
  AVENUE_NAMES,
  parkPathAt,
  locate,
} from '../core/CityPlan.js';
import { createBuildings, createAntennas, createLamps, createArcade, STREET_LAMP_SCALE } from './Props.js';
import { createPalms, createPyramids, WrappedInstances, mulberry } from './Scenery.js';
import { ledTime, ledMaterial, FOG_GLSL } from './neon.js';
import { createCarGeometry, createCarMaterial, CAR_PAINTS, CAR_LENGTH, CAR_WIDTH, CAR_MODELS, pickCarModel, laneLayout, SIGNAL_GLSL, StreetTraffic } from './StreetTraffic.js';
import { canvasTexture, FONT_HEAD, FONT_PIXEL, FONT_MONO } from '../utils/textures.js';

const UP = new THREE.Vector3(0, 1, 0);
const E = LOT_HALF - 0.5; // face externa dos prédios
const STREET_LAMP_COLOR = '#ffb49a';

/* ================================================================== */
/*  Lote de instâncias: várias malhas que compartilham as mesmas       */
/*  posições (ex.: poste + lâmpada), num draw call por malha.          */
/* ================================================================== */
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

class Batch {
  constructor() {
    this.items = [];
  }

  add(x, z, { yaw = 0, y = 0, sx = 1, sy = 1, sz = 1, color = null, attrs = null } = {}) {
    this.items.push({ x: wrapCoord(x), z: wrapCoord(z), yaw, y, sx, sy, sz, color, attrs });
  }

  /** parts: [{ geometry, material, shadow, color (usa a cor da instância), attrs: { nome: tamanho } }] */
  build(city, parts) {
    const n = this.items.length;
    if (!n) return [];
    const meshes = parts.map((part) => {
      const geo = part.geometry;
      for (const [name, size] of Object.entries(part.attrs || {})) {
        const arr = new Float32Array(n * size);
        this.items.forEach((it, i) => {
          const v = it.attrs[name];
          if (size === 1) arr[i] = v;
          else arr.set(v, i * size);
        });
        geo.setAttribute(name, new THREE.InstancedBufferAttribute(arr, size));
      }
      const mesh = new THREE.InstancedMesh(geo, part.material, n);
      mesh.castShadow = !!part.shadow;
      this.items.forEach((it, i) => {
        _q.setFromAxisAngle(UP, it.yaw);
        _p.set(it.x, it.y, it.z);
        _s.set(it.sx, it.sy, it.sz);
        _m.compose(_p, _q, _s);
        mesh.setMatrixAt(i, _m);
        if (part.color) mesh.setColorAt(i, it.color || new THREE.Color(1, 1, 1));
      });
      return mesh;
    });
    city.addInstanced(meshes, this.items.map((it) => [it.x, it.z]));
    return meshes;
  }
}

/** Material com textura-atlas: cada instância escolhe sua célula (aCell). */
function atlasMaterial(map, { cols = 1, rows = 1, intensity = 1 } = {}) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uK: { value: intensity } },
    vertexShader: /* glsl */ `
      #include <bend_pars>
      attribute float aCell;
      varying vec2 vUv; varying vec3 vWorld;
      void main() {
        float col = mod(aCell, ${cols.toFixed(1)});
        float row = floor(aCell / ${cols.toFixed(1)});
        vUv = vec2((col + uv.x) / ${cols.toFixed(1)}, (${rows.toFixed(1)} - row - 1.0 + uv.y) / ${rows.toFixed(1)});
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * bendView(viewMatrix * wp);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uK;
      varying vec2 vUv; varying vec3 vWorld;
      ${FOG_GLSL}
      void main() {
        vec3 c = texture2D(uMap, vUv).rgb * uK;
        c = mix(c, FOG_COLOR, fogAmount(vWorld) * 0.9);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

/** Plano legível dos dois lados (o verso é uma cópia girada, então o texto nunca fica espelhado). */
function twoSidedPlane(w, h) {
  const front = new THREE.PlaneGeometry(w, h);
  const back = new THREE.PlaneGeometry(w, h).rotateY(Math.PI).translate(0, 0, -0.03);
  return mergeGeometries([front, back]);
}

/* ================================================================== */
/*  Texturas (canvas)                                                  */
/* ================================================================== */
function streetSignAtlas(names) {
  const W = 512;
  const H = 96;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H * names.length;
  const ctx = c.getContext('2d');
  names.forEach((name, r) => {
    const y = r * H;
    // placa azul de rua, como as de São Paulo
    ctx.fillStyle = '#0d2a6e';
    ctx.fillRect(0, y, W, H);
    ctx.strokeStyle = '#e8ecff';
    ctx.lineWidth = 5;
    ctx.strokeRect(8, y + 8, W - 16, H - 16);
    ctx.fillStyle = '#f2f4ff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 46;
    ctx.font = `700 ${size}px ${FONT_HEAD}`;
    while (ctx.measureText(name).width > W - 50 && size > 20) {
      size -= 2;
      ctx.font = `700 ${size}px ${FONT_HEAD}`;
    }
    ctx.fillText(name, W / 2, y + H / 2 + 2);
  });
  return canvasTexture(c);
}

const SHOP_SIGNS = [
  ['HOTEL', '#ff2a9d'],
  ['BAR', '#00f0ff'],
  ['CAFÉ', '#ffd319'],
  ['PIZZA', '#ff7a29'],
  ['SUSHI', '#39ff88'],
  ['DISCOS', '#b26bff'],
  ['VÍDEO', '#ff2a9d'],
  ['LOJA', '#00f0ff'],
  ['CINE', '#ffd319'],
  ['GAMES', '#39ff88'],
  ['BOATE', '#b26bff'],
  ['LANCHE', '#ff7a29'],
];

function shopSignAtlas() {
  const CW = 128;
  const CH = 512;
  const c = document.createElement('canvas');
  c.width = CW * SHOP_SIGNS.length;
  c.height = CH;
  const ctx = c.getContext('2d');
  SHOP_SIGNS.forEach(([word, color], k) => {
    const x = k * CW;
    ctx.fillStyle = '#0b0216';
    ctx.fillRect(x, 0, CW, CH);
    ctx.strokeStyle = color;
    ctx.lineWidth = 6;
    ctx.strokeRect(x + 10, 10, CW - 20, CH - 20);
    const letters = [...word];
    const step = Math.min(84, (CH - 60) / letters.length);
    ctx.font = `900 ${Math.round(step * 0.82)}px ${FONT_HEAD}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    letters.forEach((ch, i) => {
      const y = CH / 2 + (i - (letters.length - 1) / 2) * step;
      // tubo de neon: contorno colorido grosso + núcleo branco
      ctx.lineWidth = 9;
      ctx.strokeStyle = color;
      ctx.strokeText(ch, x + CW / 2, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(ch, x + CW / 2, y);
    });
  });
  return canvasTexture(c);
}

/** Outdoors e cartazes: conteúdo do portfólio + propagandas retrô fictícias. */
function billboardAtlas(owner) {
  const W = 1024;
  const H = 384;
  const designs = [
    (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#2a0845');
      g.addColorStop(0.6, '#a01a6a');
      g.addColorStop(1, '#f2742a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // sol listrado
      ctx.save();
      ctx.beginPath();
      ctx.arc(820, 250, 120, Math.PI, 0);
      ctx.clip();
      const sg = ctx.createLinearGradient(0, 130, 0, 250);
      sg.addColorStop(0, '#ffe36b');
      sg.addColorStop(1, '#ff3d8b');
      ctx.fillStyle = sg;
      ctx.fillRect(700, 130, 240, 120);
      ctx.fillStyle = '#a01a6a';
      for (let i = 0; i < 5; i++) ctx.fillRect(700, 190 + i * 13, 240, 3 + i * 1.5);
      ctx.restore();
      text(ctx, owner.name.toUpperCase(), 60, 170, 74, '#ffffff', FONT_HEAD, 'left', 900, 620);
      text(ctx, owner.role.toUpperCase(), 62, 240, 30, '#ffe9a8', FONT_MONO, 'left', 400, 620);
      text(ctx, 'PORTFÓLIO AO VIVO · EXPLORE A CIDADE', 62, 310, 18, '#ffd6f0', FONT_PIXEL, 'left', 400, 640);
    },
    (ctx) => {
      ctx.fillStyle = '#05121e';
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
      ctx.lineWidth = 2;
      for (let x = 0; x < W; x += 48) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      text(ctx, 'STACK DO DIA', W / 2, 90, 30, '#00f0ff', FONT_PIXEL, 'center', 400);
      const skills = owner.skills.slice(0, 4).join(' · ');
      text(ctx, skills, W / 2, 210, 64, '#ffffff', FONT_HEAD, 'center', 900, W - 80);
      text(ctx, owner.skills.slice(4).join(' · '), W / 2, 300, 30, '#9ff6ff', FONT_MONO, 'center', 400, W - 80);
    },
    (ctx) => {
      ctx.fillStyle = '#12002a';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff2a9d';
      ctx.beginPath();
      ctx.moveTo(800, 120);
      ctx.lineTo(940, 192);
      ctx.lineTo(800, 264);
      ctx.closePath();
      ctx.fill();
      text(ctx, 'PROJETOS NO AR', 60, 170, 76, '#ffffff', FONT_HEAD, 'left', 900, 700);
      text(ctx, 'SIGA AS AVENIDAS NEON', 62, 250, 30, '#ffd319', FONT_PIXEL, 'left', 400, 700);
    },
    (ctx) => {
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, '#1b0b3a');
      g.addColorStop(1, '#3a0b4a');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 26; i++) {
        const h = 30 + Math.abs(Math.sin(i * 1.7)) * 160;
        ctx.fillStyle = i % 2 ? '#00f0ff' : '#ff2a9d';
        ctx.fillRect(640 + i * 13, 300 - h, 8, h);
      }
      text(ctx, 'RÁDIO PORTIMAX', 60, 160, 64, '#ffffff', FONT_HEAD, 'left', 900, 560);
      text(ctx, '88.8 FM · SYNTHWAVE 24H', 62, 230, 28, '#9ff6ff', FONT_MONO, 'left', 400, 560);
      text(ctx, 'APERTE M PARA OUVIR', 62, 300, 18, '#ffd319', FONT_PIXEL, 'left', 400, 560);
    },
    (ctx) => {
      ctx.fillStyle = '#2a0010';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ff2a4a';
      ctx.beginPath();
      ctx.ellipse(860, 192, 70, 150, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(800, 170, 120, 40);
      text(ctx, 'CYBER COLA', 60, 170, 84, '#ffffff', FONT_HEAD, 'left', 900, 700);
      text(ctx, 'REFRESCÂNCIA EM 8 BITS', 62, 250, 28, '#ffb3c4', FONT_PIXEL, 'left', 400, 700);
    },
    (ctx) => {
      ctx.fillStyle = '#04140c';
      ctx.fillRect(0, 0, W, H);
      text(ctx, 'VAMOS CONSTRUIR', W / 2, 120, 58, '#ffffff', FONT_HEAD, 'center', 900, W - 80);
      text(ctx, 'ALGO JUNTOS?', W / 2, 200, 58, '#39ff88', FONT_HEAD, 'center', 900, W - 80);
      text(ctx, `CONTATO NO BULEVAR · OESTE  ·  ${owner.links.map((l) => l.label.toUpperCase()).join(' · ')}`, W / 2, 290, 20, '#c8ffe0', FONT_PIXEL, 'center', 400, W - 60);
    },
  ];
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H * designs.length;
  const ctx = c.getContext('2d');
  designs.forEach((draw, r) => {
    ctx.save();
    ctx.translate(0, r * H);
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    draw(ctx);
    ctx.restore();
  });
  return { tex: canvasTexture(c), count: designs.length };
}

function text(ctx, str, x, y, size, color, font, align = 'left', weight = 700, maxW = 2000) {
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  let s = size;
  ctx.font = `${weight} ${s}px ${font}`;
  while (ctx.measureText(str).width > maxW && s > 10) {
    s -= 2;
    ctx.font = `${weight} ${s}px ${font}`;
  }
  ctx.fillText(str, x, y);
}

/* ================================================================== */
/*  Geometrias reaproveitadas                                          */
/* ================================================================== */
const metalMat = () => new THREE.MeshStandardMaterial({ color: '#1b1430', metalness: 0.8, roughness: 0.38 });

function benchGeometry() {
  return mergeGeometries([
    new THREE.BoxGeometry(2.0, 0.1, 0.55).translate(0, 0.48, 0),
    new THREE.BoxGeometry(2.0, 0.45, 0.08).translate(0, 0.82, -0.26),
    new THREE.BoxGeometry(0.08, 0.48, 0.5).translate(-0.9, 0.24, 0),
    new THREE.BoxGeometry(0.08, 0.48, 0.5).translate(0.9, 0.24, 0),
  ]);
}

function hydrantGeometry() {
  return mergeGeometries([
    new THREE.CylinderGeometry(0.17, 0.21, 0.7, 10).translate(0, 0.35, 0),
    new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.7, 0),
    new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6).rotateZ(Math.PI / 2).translate(0, 0.5, 0),
  ]);
}

/** Orelhão: a concha da cabine telefônica brasileira. */
function orelhaoGeometry() {
  const shell = new THREE.SphereGeometry(0.72, 18, 10, Math.PI * 0.3, Math.PI * 1.4, 0, Math.PI * 0.62).scale(1, 1.3, 1).translate(0, 1.85, 0);
  return mergeGeometries([
    shell.toNonIndexed(),
    new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6).translate(0, 0.95, -0.55).toNonIndexed(),
    new THREE.BoxGeometry(0.28, 0.42, 0.14).translate(0, 1.55, -0.45).toNonIndexed(),
  ].map((g) => {
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
    return g;
  }));
}

function shelterGeometry() {
  return mergeGeometries([
    new THREE.BoxGeometry(5.2, 0.12, 1.9).translate(0, 2.65, 0),
    new THREE.BoxGeometry(0.1, 2.6, 0.1).translate(-2.5, 1.3, -0.8),
    new THREE.BoxGeometry(0.1, 2.6, 0.1).translate(2.5, 1.3, -0.8),
    new THREE.BoxGeometry(0.1, 2.6, 0.1).translate(-2.5, 1.3, 0.8),
    new THREE.BoxGeometry(0.1, 2.6, 0.1).translate(2.5, 1.3, 0.8),
    new THREE.BoxGeometry(4.6, 0.3, 0.14).translate(0, 0.35, -0.82),
    new THREE.BoxGeometry(3.2, 0.1, 0.5).translate(0, 0.5, -0.45),
    new THREE.BoxGeometry(0.06, 2.0, 1.5).translate(-2.5, 1.45, 0),
  ]);
}

function treeTrunkGeometry() {
  return new THREE.CylinderGeometry(0.12, 0.2, 2.8, 6).translate(0, 1.4, 0);
}

function treeCanopyGeometry() {
  const parts = [
    new THREE.IcosahedronGeometry(1.55, 1).scale(1, 0.85, 1).translate(0, 3.7, 0),
    new THREE.IcosahedronGeometry(1.05, 0).translate(0.8, 3.15, 0.35),
    new THREE.IcosahedronGeometry(0.95, 0).translate(-0.7, 3.35, -0.45),
  ].map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    n.deleteAttribute('uv');
    return n;
  });
  return mergeGeometries(parts);
}

/* ================================================================== */
/*  A cidade                                                           */
/* ================================================================== */
export class City {
  constructor(world, plan, owner) {
    this.world = world;
    this.scene = world.scene;
    this.plan = plan;
    this.colliders = world.colliders;
    this.lights = []; // fontes de luz derramadas no chão: { x, z, radius, intensity, color }
    this.rnd = mulberry(4242);
    this.owner = owner;

    this.buildBuildings();
    this.buildStreets();
    this.buildSignals();
    this.buildBlocks();
    this.buildSigns();
    this.traffic = new StreetTraffic(this.scene);
    this.mapCanvas = this.createMapCanvas();
  }

  /* ---------- utilitários ---------- */
  addInstanced(meshes, homes) {
    this.scene.add(...meshes);
    this.world.instanced.push(new WrappedInstances(meshes, homes));
  }

  circle(x, z, r) {
    this.colliders.push({ x: wrapCoord(x), z: wrapCoord(z), r });
  }

  box(x, z, hx, hz) {
    this.colliders.push({ x: wrapCoord(x), z: wrapCoord(z), hx, hz });
  }

  light(x, z, radius, intensity, color) {
    this.lights.push({ x: wrapCoord(x), z: wrapCoord(z), radius, intensity, color: new THREE.Color(color) });
  }

  pick(list) {
    return list[Math.floor(this.rnd() * list.length)];
  }

  /** Ponto (x, z) a partir de "lateral" (eixo fixo da rua) e "along" (ao longo dela). */
  static at(axis, lateral, along) {
    return axis === 'x' ? [lateral, along] : [along, lateral];
  }

  locate(x, z) {
    return locate(this.plan, x, z);
  }

  /* ================================================================== */
  /*  Prédios e coisas no topo                                           */
  /* ================================================================== */
  buildBuildings() {
    const rnd = this.rnd;
    const accents = ['#00f0ff', '#ff2a9d', '#b26bff', '#ffd319', '#39ff88'];
    // art déco: paleta "Miami" (rosa, água, lavanda, pêssego, menta)
    const decoAccents = ['#ff7ac8', '#5ff0e8', '#a98bff', '#ffa77a', '#6dffb0'];
    const specs = this.plan.buildings;
    let lastDeco = null;
    for (const b of specs) {
      if (b.deco) {
        // o degrau do topo (y > 0) vem logo depois do prédio de baixo e herda a cor dele
        b.accent = b.y && lastDeco ? lastDeco : this.pick(decoAccents);
        lastDeco = b.accent;
      } else b.accent = rnd() < 0.65 ? DISTRICTS[b.district].color : this.pick(accents);
    }
    const mesh = createBuildings(specs);
    this.addInstanced([mesh], specs.map((b) => [b.x, b.z]));
    for (const b of specs) if (!b.y) this.box(b.x, b.z, b.w / 2, b.d / 2);

    const antennas = createAntennas(specs);
    this.addInstanced(antennas.meshes, antennas.homes);

    // Caixas de ar-condicionado e caixas d'água nos telhados planos
    const ac = new Batch();
    const tanks = new Batch();
    for (const b of specs) {
      if (b.roof !== 'flat' || b.crown || b.deco || b.h < 8 || b.w < 11 || b.d < 11) continue;
      const top = (b.y || 0) + b.h;
      const n = 1 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const x = b.x + (rnd() - 0.5) * (b.w - 5);
        const z = b.z + (rnd() - 0.5) * (b.d - 5);
        if (Math.hypot(x - (b.x + b.w * 0.2), z - (b.z - b.d * 0.15)) < 2.5) continue; // lugar da antena
        if (rnd() < 0.7) ac.add(x, z, { y: top, yaw: rnd() < 0.5 ? 0 : Math.PI / 2 });
        else tanks.add(x, z, { y: top });
      }
    }
    const roofMetal = new THREE.MeshStandardMaterial({ color: '#2a2238', metalness: 0.6, roughness: 0.5 });
    ac.build(this, [
      {
        geometry: mergeGeometries([
          new THREE.BoxGeometry(2.2, 1.1, 1.6).translate(0, 0.55, 0),
          new THREE.CylinderGeometry(0.5, 0.5, 0.06, 12).translate(0, 1.13, 0),
        ]),
        material: roofMetal,
        shadow: true,
      },
    ]);
    tanks.build(this, [
      {
        geometry: mergeGeometries([
          new THREE.CylinderGeometry(1.1, 1.1, 2, 12).translate(0, 2.2, 0),
          new THREE.ConeGeometry(1.15, 0.6, 12).translate(0, 3.5, 0),
          ...[[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]].map(([x, z]) => new THREE.CylinderGeometry(0.07, 0.07, 1.2, 5).translate(x, 0.6, z)),
        ]),
        material: roofMetal,
        shadow: true,
      },
    ]);

    // Torre-símbolo do centro: agulha com luz de aviso
    for (const b of specs.filter((s) => s.crown)) {
      const g = new THREE.Group();
      const top = b.y + b.h;
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.6, 22, 8).translate(0, 11, 0), metalMat());
      spire.position.y = top;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.08, 6, 32).rotateX(Math.PI / 2), ledMaterial(DISTRICTS[D.CENTRO].color, 0.9));
      ring.position.y = top + 6;
      const ring2 = ring.clone();
      ring2.scale.setScalar(0.6);
      ring2.position.y = top + 12;
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), ledMaterial('#ff2040', 1.1));
      beacon.position.y = top + 22.3;
      g.add(spire, ring, ring2, beacon);
      this.world.addWrapped(g, b.x, b.z);
      this.world.animated.push((dt, t) => {
        beacon.visible = Math.sin(t * 3.2) > 0.2;
      });
    }

    // Containers coloridos no pátio dos galpões
    const containers = new Batch();
    const contColors = ['#8a2a1a', '#1a4a8a', '#1a7a6a', '#c86a10', '#6a2a8a'].map((c) => new THREE.Color(c));
    for (const row of this.plan.blocks) {
      for (const block of row) {
        if (block.kind !== 'warehouse') continue;
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const along = (k - (n - 1) / 2) * 7.5;
          const alongX = specs.some((b) => b.cx === block.cx && b.cz === block.cz && b.w > b.d);
          const x = block.cx + (alongX ? along : (rnd() - 0.5) * 0.6);
          const z = block.cz + (alongX ? (rnd() - 0.5) * 0.6 : along);
          const stack = rnd() < 0.3 ? 2 : 1;
          for (let s = 0; s < stack; s++) containers.add(x, z, { yaw: alongX ? 0 : Math.PI / 2, y: s * 2.6, color: this.pick(contColors) });
          this.box(x, z, alongX ? 3 : 1.25, alongX ? 1.25 : 3);
        }
      }
    }
    containers.build(this, [
      {
        geometry: new THREE.BoxGeometry(6, 2.6, 2.44).translate(0, 1.3, 0),
        material: new THREE.MeshStandardMaterial({ metalness: 0.4, roughness: 0.6 }),
        shadow: true,
        color: true,
      },
    ]);
  }

  /* ================================================================== */
  /*  Ruas: postes, árvores, mobiliário urbano e carros estacionados     */
  /* ================================================================== */
  buildStreets() {
    const rnd = this.rnd;
    const lamps = [];
    const trees = new Batch();
    const planters = new Batch();
    const benches = new Batch();
    const bins = new Batch();
    const hydrants = new Batch();
    const orelhoes = new Batch();
    const shelters = new Batch();
    this.parked = Object.fromEntries(CAR_MODELS.map((name) => [name, new Batch()]));
    const treeColors = ['#1f4a4a', '#2c2350', '#3a1f4f', '#1d3b3d', '#46204a', '#24433a'].map((c) => new THREE.Color(c));
    const TREE_P = { [D.CENTRO]: 0.5, [D.VILA]: 0.7, [D.JARDIM]: 0.95, [D.ARCADE]: 0.45, [D.ORLA]: 0.35 };
    const PARK_P = { [D.CENTRO]: 0.38, [D.VILA]: 0.42, [D.JARDIM]: 0.28, [D.ARCADE]: 0.5, [D.ORLA]: 0.22 };
    const block = (axis, lateralCell, alongCell) =>
      axis === 'x' ? this.plan.blocks[lateralCell][alongCell] : this.plan.blocks[alongCell][lateralCell];

    for (const axis of ['x', 'z']) {
      STREET_LINES.forEach((line) => {
        // postes dos dois lados, a cada 30 (meio do caminho entre cruzamentos e no meio do quarteirão)
        for (let a = -HALF_WORLD + STREET_LAMP_SPACING / 2; a < HALF_WORLD; a += STREET_LAMP_SPACING) {
          for (const s of [-1, 1]) {
            const [x, z] = City.at(axis, line + s * STREET_LAMP_OFFSET, a);
            const [ax, az] = City.at(axis, -s, 0);
            lamps.push({ x: wrapCoord(x), z: wrapCoord(z), ax, az, color: STREET_LAMP_COLOR });
            this.circle(x, z, 0.25);
          }
        }

        // trechos entre cruzamentos
        for (let m = 0; m < GRID_N; m++) {
          const start = streetLine(m) + CURB_OUT;
          const alongCell = cellOf(start + LOT_HALF);
          const avenueSegment = alongCell === AVENUE_CELL;
          for (const s of [-1, 1]) {
            const lot = block(axis, cellOf(line + s * BLOCK * 0.33), alongCell);
            const district = lot.district;
            const promenade = district < 0;
            const P = (u, lateral, opts) => {
              const [x, z] = City.at(axis, line + s * lateral, start + u);
              return [x, z, opts];
            };
            // virado para a rua
            const faceStreet = Math.atan2(...City.at(axis, -s, 0));
            const busStop = !promenade && !avenueSegment && rnd() < 0.09;
            const orelhao = !promenade && !avenueSegment && rnd() < 0.12;
            let hydrantAt = -99;

            if (!promenade && !avenueSegment) {
              for (const u of [11.5, 21.5, 31.5]) {
                if (busStop && u === 21.5) continue;
                if (rnd() > TREE_P[district]) continue;
                const [x, z] = P(u, 7.2);
                const k = 0.85 + rnd() * 0.4;
                trees.add(x, z, { yaw: rnd() * Math.PI * 2, sx: k, sy: k, sz: k, color: this.pick(treeColors) });
                planters.add(x, z);
                this.circle(x, z, 0.55);
              }
              if (!busStop && rnd() < 0.3) {
                const [x, z] = P(rnd() < 0.5 ? 16.5 : 26.5, 7.6);
                benches.add(x, z, { yaw: faceStreet });
                this.circle(x, z, 0.75);
              }
              if (rnd() < 0.45) {
                const [x, z] = P(8, 5.9);
                bins.add(x, z);
                this.circle(x, z, 0.35);
              }
              if (rnd() < 0.35) {
                hydrantAt = 2.6;
                const [x, z] = P(2.6, 5.7);
                hydrants.add(x, z, { yaw: rnd() * 6 });
                this.circle(x, z, 0.25);
              }
              if (orelhao) {
                const [x, z] = P(34, 6.9);
                orelhoes.add(x, z, { yaw: faceStreet, color: new THREE.Color(rnd() < 0.7 ? '#ff7a29' : '#2a6aff') });
                this.circle(x, z, 0.45);
              }
              if (busStop) {
                const [x, z] = P(21.5, 7.3);
                shelters.add(x, z, { yaw: faceStreet, attrs: { aCell: Math.floor(rnd() * 6) } });
                const [hx, hz] = axis === 'x' ? [0.95, 2.6] : [2.6, 0.95];
                this.box(x, z, hx, hz);
                this.light(x, z, 3.2, 0.06, '#9ff6ff');
              }
            }

            // carros estacionados (virados no sentido do trânsito daquele lado);
            // no trecho que atravessa o calçadão dos projetos a faixa fica livre
            if (avenueSegment) continue;
            const pp = promenade ? 0.3 : PARK_P[district];
            const f = axis === 'x' ? [0, -s] : [s, 0];
            const yaw = Math.atan2(-f[0], -f[1]);
            for (let j = 0; j < 6; j++) {
              const u = 7.5 + j * 5.6 + (rnd() - 0.5) * 0.8;
              if (busStop && u > 15.5 && u < 27.5) continue;
              if (Math.abs(u - hydrantAt) < 3.5) continue;
              if (rnd() > pp) continue;
              const [x, z] = P(u, PARK_OFFSET);
              this.parkCar(x, z, yaw + (rnd() - 0.5) * 0.03);
            }
          }
        }
      });
    }

    const [lp, lh] = createLamps(lamps, { scale: STREET_LAMP_SCALE, shadows: false });
    this.addInstanced([lp, lh], lamps.map((l) => [l.x, l.z]));

    trees.build(this, [
      { geometry: treeTrunkGeometry(), material: new THREE.MeshStandardMaterial({ color: '#2a1520', roughness: 0.9 }), shadow: true },
      {
        geometry: treeCanopyGeometry(),
        material: new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true, emissive: '#0a0414' }),
        shadow: true,
        color: true,
      },
    ]);
    planters.build(this, [
      {
        geometry: mergeGeometries([
          new THREE.BoxGeometry(1.5, 0.3, 1.5).translate(0, 0.15, 0),
          new THREE.BoxGeometry(1.2, 0.02, 1.2).translate(0, 0.31, 0),
        ]),
        material: new THREE.MeshStandardMaterial({ color: '#1a1424', roughness: 0.8 }),
      },
    ]);
    benches.build(this, [{ geometry: benchGeometry(), material: new THREE.MeshStandardMaterial({ color: '#3a2030', roughness: 0.7, metalness: 0.2 }), shadow: true }]);
    bins.build(this, [
      { geometry: new THREE.CylinderGeometry(0.3, 0.26, 0.9, 10).translate(0, 0.45, 0), material: new THREE.MeshStandardMaterial({ color: '#1e3a2e', metalness: 0.4, roughness: 0.5 }) },
      { geometry: new THREE.TorusGeometry(0.3, 0.025, 4, 16).rotateX(Math.PI / 2).translate(0, 0.86, 0), material: ledMaterial('#39ff88', 1.6) },
    ]);
    hydrants.build(this, [{ geometry: hydrantGeometry(), material: new THREE.MeshStandardMaterial({ color: '#c8283c', roughness: 0.5, metalness: 0.3 }) }]);
    orelhoes.build(this, [
      {
        geometry: orelhaoGeometry(),
        material: new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide }),
        shadow: true,
        color: true,
      },
    ]);
    const billboard = this.billboardTex();
    shelters.build(this, [
      { geometry: shelterGeometry(), material: metalMat(), shadow: true },
      {
        geometry: twoSidedPlane(4.2, 1.57).translate(0, 1.5, -0.86),
        material: atlasMaterial(billboard.tex, { rows: billboard.count, intensity: 0.9 }),
        attrs: { aCell: 1 },
      },
    ]);
  }

  parkCar(x, z, yaw) {
    // sorteio próprio para o modelo: não altera a sequência aleatória do resto da cidade
    this.carRnd ??= mulberry(31);
    this.parked[pickCarModel(this.carRnd)].add(x, z, { yaw, color: new THREE.Color(this.pick(CAR_PAINTS)) });
    const hl = CAR_LENGTH / 2;
    const hw = CAR_WIDTH / 2;
    const facingZ = Math.abs(Math.cos(yaw)) > 0.7;
    this.box(x, z, facingZ ? hw : hl, facingZ ? hl : hw);
  }

  /* ================================================================== */
  /*  Semáforos (com a placa azul da rua transversal no braço)           */
  /* ================================================================== */
  buildSignals() {
    const names = [];
    const row = new Map();
    const nameRow = (name) => {
      if (!row.has(name)) {
        row.set(name, names.length);
        names.push(name);
      }
      return row.get(name);
    };
    const poles = new Batch();
    for (const lane of laneLayout()) {
      for (const cr of lane.crossings) {
        const [cx, cz] = lane.axis === 'x' ? [lane.line, cr.at] : [cr.at, lane.line];
        const back = cr.avenue ? 11.2 : 6.6;
        const x = cx - lane.f[0] * back + lane.r[0] * 6.4;
        const z = cz - lane.f[1] * back + lane.r[1] * 6.4;
        // nome da rua que vai ser cruzada
        let name;
        const m = STREET_LINES.indexOf(cr.at);
        if (cr.avenue) name = lane.axis === 'x' ? AVENUE_NAMES.ew : AVENUE_NAMES.ns;
        else name = lane.axis === 'x' ? streetName('z', m) : streetName('x', m);
        poles.add(x, z, {
          yaw: Math.atan2(lane.f[0], lane.f[1]),
          attrs: { aAxis: lane.signalAxis, aOffset: cr.offset, aCell: nameRow(name) },
        });
        this.circle(x, z, 0.22);
      }
    }
    // poste + braço sobre a pista + caixa do semáforo (frente = -z, de cara para quem chega)
    const pole = mergeGeometries([
      new THREE.CylinderGeometry(0.11, 0.15, 6.1, 8).translate(0, 3.05, 0),
      new THREE.BoxGeometry(5.0, 0.14, 0.14).translate(2.5, 5.95, 0),
      new THREE.BoxGeometry(0.5, 1.3, 0.42).translate(4.4, 5.25, 0),
      new THREE.BoxGeometry(0.8, 1.6, 0.04).translate(4.4, 5.25, 0.22),
      new THREE.BoxGeometry(0.34, 0.5, 0.3).translate(0.0, 2.7, -0.2),
    ]);
    const lens = mergeGeometries(
      [0, 1, 2].map((slot) => {
        const g = new THREE.CircleGeometry(0.15, 14).rotateY(Math.PI).translate(4.4, 5.25 + (1 - slot) * 0.4, -0.215);
        g.setAttribute('aSlot', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count).fill(slot), 1));
        return g;
      }),
    );
    const lensMat = new THREE.ShaderMaterial({
      uniforms: { uTime: ledTime },
      vertexShader: /* glsl */ `
        #include <bend_pars>
        attribute float aSlot; attribute float aAxis; attribute float aOffset;
        varying float vSlot; varying float vAxis; varying float vOffset;
        void main() {
          vSlot = aSlot; vAxis = aAxis; vOffset = aOffset;
          gl_Position = projectionMatrix * bendView(modelViewMatrix * instanceMatrix * vec4(position, 1.0));
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying float vSlot; varying float vAxis; varying float vOffset;
        ${SIGNAL_GLSL}
        void main() {
          // slot 0 = vermelho (em cima), 1 = amarelo, 2 = verde; estado 0 = verde, 1 = amarelo, 2 = vermelho
          float state = signalState(vAxis, vOffset, uTime);
          float on = 1.0 - step(0.5, abs((2.0 - state) - vSlot));
          vec3 c = vSlot < 0.5 ? vec3(1.0, 0.08, 0.1) : (vSlot < 1.5 ? vec3(1.0, 0.65, 0.05) : vec3(0.1, 1.0, 0.45));
          gl_FragColor = vec4(c * mix(0.08, 2.6, on), 1.0);
        }
      `,
    });
    const blade = twoSidedPlane(3.0, 0.56).translate(2.3, 6.4, 0);
    const bladePost = new THREE.BoxGeometry(0.06, 0.4, 0.06).translate(2.3, 6.1, 0);
    poles.build(this, [
      { geometry: mergeGeometries([pole, bladePost]), material: metalMat(), shadow: true },
      { geometry: lens, material: lensMat, attrs: { aAxis: 1, aOffset: 1 } },
      { geometry: blade, material: atlasMaterial(streetSignAtlas(names), { rows: names.length, intensity: 0.92 }), attrs: { aCell: 1 } },
    ]);
  }

  /* ================================================================== */
  /*  Quarteirões especiais: parques, estacionamentos, casas, fliperama  */
  /* ================================================================== */
  buildBlocks() {
    const rnd = this.rnd;
    const trees = new Batch();
    const parkLamps = new Batch();
    const benches = new Batch();
    const palms = [];
    const pyramids = [];
    const parkingLamps = [];
    const treeColors = ['#1f4a4a', '#2c2350', '#3a1f4f', '#1d3b3d', '#46204a', '#24433a'].map((c) => new THREE.Color(c));
    const addTree = (x, z, k = 1) => {
      const s = k * (0.9 + rnd() * 0.45);
      trees.add(x, z, { yaw: rnd() * 6.28, sx: s, sy: s, sz: s, color: this.pick(treeColors) });
      this.circle(x, z, 0.5);
    };

    for (const row of this.plan.blocks) {
      for (const block of row) {
        const { cx, cz, kind, district, variant } = block;
        if (kind === 'park' || kind === 'monument') {
          const path = (x, z) => parkPathAt(variant, x, z);
          const placed = [];
          const far = (x, z, d) => placed.every((p) => Math.hypot(p[0] - x, p[1] - z) >= d);
          // postes de praça na beira dos caminhos
          for (let i = 0; i < 160 && placed.length < 7; i++) {
            const x = (rnd() * 2 - 1) * 19;
            const z = (rnd() * 2 - 1) * 19;
            if (path(x, z)) continue;
            const near = [[1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]].some(([dx, dz]) => path(x + dx, z + dz));
            if (!near || !far(x, z, 10)) continue;
            placed.push([x, z]);
            parkLamps.add(cx + x, cz + z);
            this.circle(cx + x, cz + z, 0.2);
            this.light(cx + x, cz + z, 4.5, 0.07, '#ffc89a');
          }
          // bancos de frente para os caminhos
          let nb = 0;
          for (let i = 0; i < 160 && nb < 5; i++) {
            const x = (rnd() * 2 - 1) * 18;
            const z = (rnd() * 2 - 1) * 18;
            if (path(x, z) || !far(x, z, 3.5)) continue;
            const dir = [[0, 1.4], [0, -1.4], [1.4, 0], [-1.4, 0]].find(([dx, dz]) => path(x + dx, z + dz));
            if (!dir) continue;
            placed.push([x, z]);
            benches.add(cx + x, cz + z, { yaw: Math.atan2(dir[0], dir[1]) });
            this.circle(cx + x, cz + z, 0.75);
            nb++;
          }
          // árvores (e palmeiras nos bairros mais "praianos")
          const target = kind === 'monument' ? 10 : 16;
          let nt = 0;
          for (let i = 0; i < 300 && nt < target; i++) {
            const x = (rnd() * 2 - 1) * 19.5;
            const z = (rnd() * 2 - 1) * 19.5;
            if (path(x, z) || path(x + 1.6, z) || path(x - 1.6, z) || path(x, z + 1.6) || path(x, z - 1.6)) continue;
            if (!far(x, z, 4.2)) continue;
            placed.push([x, z]);
            if ((district === D.JARDIM || district === D.ORLA) && rnd() < 0.35) {
              palms.push([cx + x, cz + z]);
              this.circle(cx + x, cz + z, 0.6);
            } else addTree(cx + x, cz + z, 1.15);
            nt++;
          }
          if (variant === PARK.FOUNTAIN) this.addFountain(cx, cz, DISTRICTS[district].color);
          if (variant === PARK.POND) this.circle(cx, cz, 9.6); // ninguém anda na água
          if (kind === 'monument') {
            const big = Math.abs(cx) >= HALF_WORLD - 1 && Math.abs(cz) >= HALF_WORLD - 1;
            const r = big ? 11 : 8 + rnd() * 2;
            pyramids.push({ x: cx, z: cz, r, h: r * (big ? 1.6 : 1.3), rot: Math.PI / 4 });
            this.circle(cx, cz, r * 0.85);
            this.light(cx, cz, 14, 0.06, DISTRICTS[D.ORLA].color);
          }
        } else if (kind === 'parking') {
          const rows = [[-16, Math.PI], [-5.5, 0], [5.5, Math.PI], [16, 0]];
          for (const [rz, yaw] of rows) {
            for (let k = 0; k < 15; k++) {
              if (rnd() > 0.55) continue;
              const x = cx - 19.5 + 1.3 + k * 2.6;
              const z = cz + rz + (rnd() - 0.5) * 0.3;
              this.parkCar(x, z, yaw + (rnd() - 0.5) * 0.06);
            }
          }
          for (const lx of [-10, 10]) {
            for (const lz of [-10.75, 10.75]) {
              for (const s of [-1, 1]) parkingLamps.push({ x: wrapCoord(cx + lx), z: wrapCoord(cz + lz), ax: 0, az: s, color: '#fff0d8' });
              this.circle(cx + lx, cz + lz, 0.25);
              this.light(cx + lx, cz + lz, 7, 0.06, '#fff0d8');
            }
          }
        } else if (kind === 'houses') {
          addTree(cx, cz, 1.4);
          for (const [x, z] of [[-4, -4], [4, 4], [-4, 4], [4, -4]]) if (rnd() < 0.6) addTree(cx + x, cz + z, 0.85);
          parkLamps.add(cx + 3, cz - 1);
          this.light(cx + 3, cz - 1, 4, 0.06, '#ffc89a');
        } else if (kind === 'arcade') {
          const arcade = createArcade();
          arcade.group.rotation.y = block.arcade.rotY;
          this.world.addWrapped(arcade.group, block.arcade.x, block.arcade.z);
          this.box(block.arcade.x, block.arcade.z, 10, 7);
          this.light(block.arcade.x, block.arcade.z - 9, 9, 0.1, '#ff2a9d');
        }
      }
    }

    trees.build(this, [
      { geometry: treeTrunkGeometry(), material: new THREE.MeshStandardMaterial({ color: '#2a1520', roughness: 0.9 }), shadow: true },
      {
        geometry: treeCanopyGeometry(),
        material: new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true, emissive: '#0a0414' }),
        shadow: true,
        color: true,
      },
    ]);
    parkLamps.build(this, [
      { geometry: new THREE.CylinderGeometry(0.06, 0.1, 3.2, 6).translate(0, 1.6, 0), material: metalMat() },
      { geometry: new THREE.SphereGeometry(0.3, 12, 8).translate(0, 3.4, 0), material: new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.7, 1.1) }) },
    ]);
    benches.build(this, [{ geometry: benchGeometry(), material: new THREE.MeshStandardMaterial({ color: '#3a2030', roughness: 0.7, metalness: 0.2 }), shadow: true }]);
    if (parkingLamps.length) {
      const meshes = createLamps(parkingLamps, { scale: 1.05, shadows: false });
      this.addInstanced(meshes, parkingLamps.map((l) => [l.x, l.z]));
    }
    if (palms.length) {
      const mesh = createPalms(palms);
      mesh.castShadow = true;
      this.addInstanced([mesh], palms);
    }
    // carros estacionados (ruas + estacionamentos) num único draw call
    const carMat = createCarMaterial();
    for (const name of CAR_MODELS) this.parked[name].build(this, [{ geometry: createCarGeometry(name), material: carMat, color: true }]);
    if (pyramids.length) {
      const pyr = createPyramids(pyramids);
      pyr[0].castShadow = true;
      this.addInstanced(pyr, pyramids.map((p) => [p.x, p.z]));
    }
  }

  /** Fonte luminosa no centro da praça: bacia, jatos d'água e luz colorida. */
  addFountain(x, z, color) {
    const g = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: '#2a2038', roughness: 0.6, metalness: 0.2 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.35, 8, 48).rotateX(Math.PI / 2), stone);
    rim.position.y = 0.45;
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(5.2, 5.4, 0.6, 48, 1, true), stone);
    wall.position.y = 0.3;
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(5.0, 48).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        uniforms: { uTime: ledTime, uColor: { value: new THREE.Color(color) } },
        vertexShader: /* glsl */ `
          #include <bend_pars>
          varying vec2 vP;
          void main() { vP = position.xz; gl_Position = projectionMatrix * bendView(modelViewMatrix * vec4(position, 1.0)); }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime; uniform vec3 uColor; varying vec2 vP;
          void main() {
            float r = length(vP);
            float ripple = pow(0.5 + 0.5 * sin(r * 5.0 - uTime * 3.0), 6.0);
            vec3 c = vec3(0.0, 0.02, 0.06) + uColor * (0.18 + ripple * 0.35) * smoothstep(5.0, 1.0, r);
            gl_FragColor = vec4(c, 1.0);
          }
        `,
      }),
    );
    water.position.y = 0.5;
    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 1.8, 16), stone);
    column.position.y = 0.9;
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 0.6, 0.4, 24), stone);
    bowl.position.y = 1.9;
    const glow = ledMaterial(color, 1.0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(5.05, 0.06, 6, 64).rotateX(Math.PI / 2), glow);
    ring.position.y = 0.82;
    g.add(rim, wall, water, column, bowl, ring);
    // jatos: cones aditivos que "respiram"
    const jetMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.6).multiplyScalar(0.55),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const jets = [];
    const center = new THREE.Mesh(new THREE.ConeGeometry(0.35, 4.5, 12, 1, true).translate(0, 2.25, 0), jetMat);
    center.position.y = 2.1;
    jets.push(center);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const j = new THREE.Mesh(new THREE.ConeGeometry(0.16, 2.4, 8, 1, true).translate(0, 1.2, 0), jetMat);
      j.position.set(Math.cos(a) * 3.4, 0.5, Math.sin(a) * 3.4);
      j.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35);
      jets.push(j);
    }
    g.add(...jets);
    this.world.addWrapped(g, x, z);
    this.world.animated.push((dt, t) => {
      jets.forEach((j, k) => {
        j.scale.y = 0.75 + 0.25 * Math.sin(t * 2.2 + k * 1.3);
      });
    });
    this.circle(x, z, 5.7);
    this.light(x, z, 9, 0.12, color);
  }

  /* ================================================================== */
  /*  Letreiros verticais nas lojas e outdoors nos telhados              */
  /* ================================================================== */
  billboardTex() {
    if (!this._billboard) this._billboard = billboardAtlas(this.owner);
    return this._billboard;
  }

  /** Faces de um prédio que dão para a rua: [{ n: [nx, nz], center: [x, z], len }] */
  streetFaces(b) {
    const out = [];
    if (Math.abs(b.x + b.w / 2 - (b.cx + E)) < 0.6) out.push({ n: [1, 0], center: [b.x + b.w / 2, b.z], len: b.d });
    if (Math.abs(b.x - b.w / 2 - (b.cx - E)) < 0.6) out.push({ n: [-1, 0], center: [b.x - b.w / 2, b.z], len: b.d });
    if (Math.abs(b.z + b.d / 2 - (b.cz + E)) < 0.6) out.push({ n: [0, 1], center: [b.x, b.z + b.d / 2], len: b.w });
    if (Math.abs(b.z - b.d / 2 - (b.cz - E)) < 0.6) out.push({ n: [0, -1], center: [b.x, b.z - b.d / 2], len: b.w });
    return out;
  }

  buildSigns() {
    const rnd = this.rnd;
    const blades = new Batch();
    const boards = new Batch();
    const boardFrames = new Batch();
    const boardLegs = new Batch();
    const boardTrim = new Batch();
    const billboard = this.billboardTex();
    let nBoards = 0;
    for (const b of this.plan.buildings) {
      if (b.y || b.deco || b.warehouse || b.crown) continue;
      const faces = this.streetFaces(b);
      if (!faces.length) continue;
      // letreiro vertical saindo da fachada, perto de uma quina
      if (b.shop && b.h >= 12.5 && rnd() < 0.5) {
        const f = this.pick(faces);
        const t = [-f.n[1], f.n[0]];
        const side = rnd() < 0.5 ? 1 : -1;
        const off = f.len / 2 - 1.3;
        const x = f.center[0] + t[0] * side * off + f.n[0] * 0.95;
        const z = f.center[1] + t[1] * side * off + f.n[1] * 0.95;
        blades.add(x, z, { y: 9.2, yaw: Math.atan2(t[0], t[1]), attrs: { aCell: Math.floor(rnd() * SHOP_SIGNS.length) } });
      }
      // outdoor no telhado, virado para a rua
      if (!b.capped && b.h >= 14 && b.h <= 40 && b.w >= 14 && b.d >= 14 && nBoards < 7 && rnd() < 0.3) {
        const f = this.pick(faces);
        const w = Math.min(13, f.len - 2);
        const h = w * 0.375;
        const x = f.center[0] - f.n[0] * 1.6;
        const z = f.center[1] - f.n[1] * 1.6;
        const yaw = Math.atan2(f.n[0], f.n[1]);
        const y = b.h + 1.6 + h / 2;
        boards.add(x, z, { y, yaw, sx: w, sy: h, attrs: { aCell: nBoards % billboard.count } });
        boardFrames.add(x - f.n[0] * 0.2, z - f.n[1] * 0.2, { y, yaw, sx: w + 0.5, sy: h + 0.5 });
        boardTrim.add(x + f.n[0] * 0.05, z + f.n[1] * 0.05, { y: y + h / 2 + 0.25, yaw, sx: w + 0.5, color: new THREE.Color(b.accent).multiplyScalar(0.9) });
        const t = [-f.n[1], f.n[0]];
        for (const s of [-1, 1]) boardLegs.add(x + t[0] * s * w * 0.32 - f.n[0] * 0.3, z + t[1] * s * w * 0.32 - f.n[1] * 0.3, { y: b.h, sy: 1.6 + 0.25 });
        nBoards++;
      }
    }
    blades.build(this, [
      { geometry: twoSidedPlane(1.4, 5.5), material: atlasMaterial(shopSignAtlas(), { cols: SHOP_SIGNS.length, intensity: 0.9 }), attrs: { aCell: 1 } },
    ]);
    boards.build(this, [
      { geometry: new THREE.PlaneGeometry(1, 1), material: atlasMaterial(billboard.tex, { rows: billboard.count, intensity: 0.95 }), attrs: { aCell: 1 } },
    ]);
    boardFrames.build(this, [{ geometry: new THREE.BoxGeometry(1, 1, 0.3), material: metalMat(), shadow: true }]);
    boardLegs.build(this, [{ geometry: new THREE.BoxGeometry(0.3, 1, 0.3).translate(0, 0.5, 0), material: metalMat() }]);
    boardTrim.build(this, [{ geometry: new THREE.BoxGeometry(1, 0.12, 0.12), material: new THREE.MeshBasicMaterial(), color: true }]);
  }

  /* ================================================================== */
  /*  Minimapa: planta da cidade desenhada uma vez numa imagem           */
  /* ================================================================== */
  createMapCanvas() {
    const S = WORLD_SIZE;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const ctx = c.getContext('2d');
    const X = (v) => v + HALF_WORLD;
    ctx.fillStyle = '#1a0830';
    ctx.fillRect(0, 0, S, S);
    const lotColor = {
      [LOT.PAVED]: '#170828',
      [LOT.PARK]: '#0c2a28',
      [LOT.PARKING]: '#120d1e',
      [LOT.HOUSES]: '#0f2320',
      [LOT.CONCRETE]: '#1c1426',
    };
    // quarteirões (com as cópias nas bordas, para fechar a volta)
    const rect = (x, z, w, d, fill) => {
      ctx.fillStyle = fill;
      for (const ox of [-S, 0, S]) for (const oz of [-S, 0, S]) ctx.fillRect(X(x - w / 2) + ox, X(z - d / 2) + oz, w, d);
    };
    for (const row of this.plan.blocks) {
      for (const b of row) {
        if (b.ground === LOT.NONE) continue;
        rect(b.cx, b.cz, LOT_HALF * 2, LOT_HALF * 2, lotColor[b.ground]);
        if (b.ground === LOT.PARK && b.variant === PARK.POND) {
          ctx.fillStyle = '#0a2a5a';
          ctx.beginPath();
          ctx.arc(X(b.cx), X(b.cz), 9.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    // ruas
    ctx.fillStyle = '#07030d';
    for (const line of STREET_LINES) {
      for (const o of [-S, 0, S]) {
        ctx.fillRect(X(line - 5) + o, 0, 10, S);
        ctx.fillRect(0, X(line - 5) + o, S, 10);
      }
    }
    // prédios
    for (const b of this.plan.buildings) {
      if (b.y) continue;
      const color = DISTRICTS[b.district].color;
      rect(b.x, b.z, b.w, b.d, '#2d1050');
      ctx.strokeStyle = color + '88';
      ctx.lineWidth = 1;
      ctx.strokeRect(X(b.x - b.w / 2), X(b.z - b.d / 2), b.w, b.d);
    }
    return c;
  }

  /* ================================================================== */
  update(dt, t, cam, player) {
    this.traffic.update(dt, t, cam, player);
  }
}
