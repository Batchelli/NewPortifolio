import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FOG_GLSL } from './neon.js';

/**
 * ============================================================
 *  Carros de rua anos 80 (frente = -z), 100% procedurais.
 * ============================================================
 * A carroceria é o perfil lateral do carro extrudado na largura (com chanfro),
 * com as caixas de roda recortadas no próprio perfil. Por cima entram a estufa
 * de vidro, teto, colunas, frisos, retrovisores, placa Mercosul etc.
 *
 * Tudo usa um único material com cor por vértice + máscara aMat:
 *   0 = pintura (recebe a cor da instância, verniz/clearcoat)
 *   1 = brilhante sem pintura (vidro, cromado, lentes)
 *   2 = fosco sem pintura (pneu, borracha, plástico)
 *
 * As rodas são uma malha à parte para poderem girar enquanto a carroceria
 * balança na suspensão; os carros estacionados recebem tudo já fundido.
 */

export const CAR_LENGTH = 4.4; // comprimento lógico (colisão e espaçamento no trânsito)
export const CAR_WIDTH = 1.9;
export const WHEEL_R = 0.34;

/** Pinturas que conversam com o pôr do sol retrowave (rosa, ciano, roxo, laranja, cromado). */
export const CAR_PAINTS = [
  '#ff2a8a', '#e9e4f4', '#14111d', '#30237a', '#00b4d0', '#ff6a3d',
  '#7b2fd0', '#c41e3a', '#f2b632', '#9ca2b8', '#167f8c', '#ff9ec8',
];
/** Cores de neon (frisos e luz sob o carro). */
export const NEON_TINTS = ['#ff2a9d', '#00f0ff', '#b26bff', '#ff7a3d', '#3dffb0'];

const MAT_PAINT = 0;
const MAT_GLOSS = 1;
const MAT_MATTE = 2;

/** Tipos de luz (atributo aKind). */
const L_HEAD = 0;
const L_TAIL = 1;
const L_NEON = 2;
const L_AMBER = 3;

/* ------------------------------------------------------------------ */
/*  Utilitários de geometria                                           */
/* ------------------------------------------------------------------ */
function clean(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const key of Object.keys(g.attributes)) if (!['position', 'normal'].includes(key)) g.deleteAttribute(key);
  return g;
}

/** Pinta a peça (cor por vértice) e marca o tipo de superfície. */
function part(geo, rgb, mat = MAT_PAINT) {
  const g = clean(geo);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < col.length; i += 3) col.set(rgb, i);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aMat', new THREE.BufferAttribute(new Float32Array(n).fill(mat), 1));
  return g;
}

const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);

/**
 * Perfil lateral (x = longitudinal, + = frente; y = altura) extrudado na largura.
 * offsetX desloca a peça para o lado (painéis laterais finos).
 */
function profile(points, width, { bevel = 0.05, offsetX = 0 } = {}) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const b = Math.min(bevel, width * 0.3);
  const depth = Math.max(width - 2 * b, 0.005);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: b > 0,
    bevelThickness: b,
    bevelSize: b * 0.7,
    bevelOffset: -b * 0.7, // o chanfro fica para dentro: o contorno do perfil é a superfície real
    bevelSegments: 1,
    curveSegments: 1,
  });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2); // x do perfil (+ = frente) vira -z do mundo; a extrusão vira x
  g.translate(offsetX, 0, 0);
  return g;
}

/** Linha de baixo da carroceria, de trás para a frente, com as caixas de roda em arco. */
function archedBottom(rear, front, yb, wheelXs, { r = 0.43, cy = 0.37, steps = 7 } = {}) {
  const pts = [[rear, yb]];
  const a = Math.asin(THREE.MathUtils.clamp((yb - cy) / r, -1, 1));
  for (const xc of [...wheelXs].sort((p, q) => p - q)) {
    const t0 = Math.PI - a;
    const t1 = a;
    for (let i = 0; i <= steps; i++) {
      const t = t0 + ((t1 - t0) * i) / steps; // passa por π/2: arco por cima da roda
      pts.push([xc + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  }
  pts.push([front, yb]);
  return pts;
}

/* ------------------------------------------------------------------ */
/*  Cores das peças                                                    */
/* ------------------------------------------------------------------ */
const PAINT = [1, 1, 1];
const GLASS = [0.05, 0.055, 0.1];
const TRIM = [0.035, 0.03, 0.045];
const CHROME = [0.62, 0.62, 0.7];
const PLATE = [0.82, 0.82, 0.86];
const PLATE_BLUE = [0.05, 0.12, 0.55];
const LENS = {
  [L_HEAD]: [0.55, 0.56, 0.62],
  [L_TAIL]: [0.32, 0.02, 0.05],
  [L_NEON]: [0.04, 0.035, 0.06],
  [L_AMBER]: [0.45, 0.22, 0.02],
};

/* ------------------------------------------------------------------ */
/*  As três carrocerias                                                */
/* ------------------------------------------------------------------ */
/**
 * Cada modelo descreve: perfis (carroceria, estufa, teto, colunas), detalhes
 * (caixas), luzes, posição das rodas e a largura. As luzes são caixas com tipo:
 * a carroceria recebe a lente "apagada" e a malha de luzes desenha a acesa por cima.
 */
const MODELS = {
  /* Cupê cunha (Testarossa / Countach): baixo, largo, tomadas laterais e aerofólio */
  wedge: {
    width: 1.92,
    wheelZ: [-1.38, 1.36], // posição z (mundo) das rodas dianteira e traseira
    track: 0.8,
    build() {
      const wx = [1.38, -1.36]; // x do perfil = -z do mundo
      const body = [
        ...archedBottom(-2.18, 2.12, 0.22, wx),
        [2.22, 0.3], [2.27, 0.43], [2.15, 0.55], [0.8, 0.79],
        [-1.6, 0.87], [-2.12, 0.93], [-2.25, 0.85], [-2.25, 0.4],
      ];
      const glass = [[1.05, 0.74], [0.02, 1.16], [-0.72, 1.18], [-1.72, 0.86], [-1.72, 0.74]];
      const roof = [[0.05, 1.14], [-0.78, 1.16], [-0.8, 1.22], [0.02, 1.2]];
      const sail = [[-0.5, 0.82], [-0.66, 1.17], [-0.78, 1.17], [-1.74, 0.86], [-1.74, 0.82]];
      const parts = [
        part(profile(body, 1.92, { bevel: 0.07 }), PAINT),
        part(profile(glass, 1.44, { bevel: 0.05 }), GLASS, MAT_GLOSS),
        part(profile(roof, 1.36, { bevel: 0.03 }), PAINT),
      ];
      for (const s of [-1, 1]) {
        parts.push(part(profile(sail, 0.05, { bevel: 0, offsetX: s * 0.735 }), PAINT));
        // tomadas laterais "fatiador de queijo" (Testarossa): fundo escuro + aletas pintadas
        parts.push(part(box(0.03, 0.3, 0.86, s * 0.955, 0.55, 0.42), TRIM, MAT_MATTE));
        for (let k = 0; k < 5; k++) parts.push(part(box(0.05, 0.028, 0.84, s * 0.97, 0.43 + k * 0.06, 0.42), PAINT));
        // retrovisor
        parts.push(part(box(0.2, 0.1, 0.16, s * 0.82, 0.86, -0.78), PAINT));
        // saia lateral escura
        parts.push(part(box(0.03, 0.08, 1.75, s * 0.965, 0.27, 0), TRIM, MAT_MATTE));
        // faróis escamoteáveis (fechados): só as frestas da tampa no capô
        for (const dz of [-0.15, 0.15]) {
          parts.push(part(new THREE.BoxGeometry(0.44, 0.012, 0.014).translate(s * 0.55, 0.626 + dz * 0.178, -1.78 + dz), TRIM, MAT_MATTE));
        }
      }
      // grade traseira preta sobre as lanternas, para-choques, aerofólio
      parts.push(part(box(1.82, 0.26, 0.04, 0, 0.68, 2.255), TRIM, MAT_MATTE));
      parts.push(part(box(1.86, 0.14, 0.1, 0, 0.36, 2.22), TRIM, MAT_MATTE));
      parts.push(part(box(1.7, 0.1, 0.1, 0, 0.3, -2.22), TRIM, MAT_MATTE));
      parts.push(part(box(1.86, 0.045, 0.36, 0, 1.15, 1.98).rotateX(0.06), PAINT));
      for (const s of [-1, 1]) {
        parts.push(part(box(0.06, 0.2, 0.18, s * 0.62, 1.02, 2.0), TRIM, MAT_MATTE));
        parts.push(part(box(0.04, 0.14, 0.4, s * 0.93, 1.15, 1.98), PAINT));
        parts.push(part(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8).rotateX(Math.PI / 2).translate(s * 0.35, 0.3, 2.27), CHROME, MAT_GLOSS));
      }
      return parts;
    },
    lights: [
      // faixa de LED na boca do para-choque + lanterna de ponta a ponta atrás das aletas
      { size: [0.5, 0.05, 0.04], pos: [-0.56, 0.42, -2.255], kind: L_HEAD },
      { size: [0.5, 0.05, 0.04], pos: [0.56, 0.42, -2.255], kind: L_HEAD },
      { size: [0.14, 0.05, 0.04], pos: [-0.88, 0.42, -2.255], kind: L_AMBER },
      { size: [0.14, 0.05, 0.04], pos: [0.88, 0.42, -2.255], kind: L_AMBER },
      { size: [1.74, 0.07, 0.03], pos: [0, 0.72, 2.27], kind: L_TAIL },
      { size: [1.74, 0.03, 0.03], pos: [0, 0.63, 2.27], kind: L_TAIL },
      { size: [0.025, 0.03, 1.7], pos: [-0.985, 0.33, 0.0], kind: L_NEON },
      { size: [0.025, 0.03, 1.7], pos: [0.985, 0.33, 0.0], kind: L_NEON },
    ],
  },

  /* Sedã três volumes (Opala / Santana / Monza): retão, frisos cromados */
  sedan: {
    width: 1.84,
    wheelZ: [-1.36, 1.32],
    track: 0.77,
    build() {
      const wx = [1.36, -1.32];
      const body = [
        ...archedBottom(-2.18, 2.14, 0.24, wx),
        [2.22, 0.3], [2.25, 0.52], [2.2, 0.8], [0.9, 0.86],
        [-1.5, 0.9], [-2.16, 0.9], [-2.24, 0.8], [-2.25, 0.36],
      ];
      const glass = [[1.0, 0.82], [0.32, 1.35], [-0.86, 1.37], [-1.52, 0.88], [-1.52, 0.82]];
      const roof = [[0.36, 1.33], [-0.9, 1.35], [-0.92, 1.41], [0.32, 1.4]];
      const cPillar = [[-0.62, 0.86], [-0.84, 1.36], [-0.95, 1.36], [-1.53, 0.88], [-1.53, 0.86]];
      const parts = [
        part(profile(body, 1.84, { bevel: 0.06 }), PAINT),
        part(profile(glass, 1.56, { bevel: 0.05 }), GLASS, MAT_GLOSS),
        part(profile(roof, 1.48, { bevel: 0.03 }), PAINT),
      ];
      for (const s of [-1, 1]) {
        parts.push(part(profile(cPillar, 0.05, { bevel: 0, offsetX: s * 0.79 }), PAINT));
        parts.push(part(box(0.05, 0.48, 0.12, s * 0.79, 1.1, 0.12), PAINT)); // coluna B
        parts.push(part(box(0.02, 0.035, 1.8, s * 0.925, 0.62, -0.04), CHROME, MAT_GLOSS)); // friso cromado
        parts.push(part(box(0.02, 0.4, 0.02, s * 0.922, 0.58, -0.62), TRIM, MAT_MATTE)); // vãos das portas
        parts.push(part(box(0.02, 0.4, 0.02, s * 0.922, 0.58, 0.48), TRIM, MAT_MATTE));
        parts.push(part(box(0.18, 0.11, 0.14, s * 0.86, 0.95, -0.72), TRIM, MAT_MATTE)); // retrovisor
      }
      parts.push(part(box(1.0, 0.22, 0.04, 0, 0.62, -2.25), TRIM, MAT_MATTE)); // grade
      for (let k = 0; k < 4; k++) parts.push(part(box(0.98, 0.012, 0.05, 0, 0.54 + k * 0.055, -2.26), CHROME, MAT_GLOSS));
      parts.push(part(box(1.9, 0.14, 0.14, 0, 0.36, -2.24), CHROME, MAT_GLOSS)); // para-choques cromados
      parts.push(part(box(1.9, 0.14, 0.14, 0, 0.38, 2.24), CHROME, MAT_GLOSS));
      parts.push(part(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 8).rotateX(Math.PI / 2).translate(-0.55, 0.26, 2.2), CHROME, MAT_GLOSS));
      return parts;
    },
    lights: [
      { size: [0.4, 0.15, 0.03], pos: [-0.66, 0.62, -2.255], kind: L_HEAD },
      { size: [0.4, 0.15, 0.03], pos: [0.66, 0.62, -2.255], kind: L_HEAD },
      { size: [0.06, 0.15, 0.2], pos: [-0.9, 0.62, -2.13], kind: L_AMBER },
      { size: [0.06, 0.15, 0.2], pos: [0.9, 0.62, -2.13], kind: L_AMBER },
      { size: [0.55, 0.16, 0.03], pos: [-0.6, 0.66, 2.255], kind: L_TAIL },
      { size: [0.55, 0.16, 0.03], pos: [0.6, 0.66, 2.255], kind: L_TAIL },
      { size: [0.025, 0.025, 1.6], pos: [-0.93, 0.36, -0.03], kind: L_NEON },
      { size: [0.025, 0.025, 1.6], pos: [0.93, 0.36, -0.03], kind: L_NEON },
    ],
  },

  /* Hatch esportivo (Golf GTI / Gol GTS): curto, alto, faixa de neon na grade */
  hatch: {
    width: 1.8,
    wheelZ: [-1.3, 1.26],
    track: 0.76,
    build() {
      const wx = [1.3, -1.26];
      const body = [
        ...archedBottom(-2.02, 2.02, 0.24, wx),
        [2.08, 0.3], [2.1, 0.52], [2.06, 0.8], [0.9, 0.87],
        [-1.86, 0.93], [-2.07, 0.9], [-2.09, 0.36],
      ];
      const glass = [[0.98, 0.84], [0.3, 1.38], [-1.56, 1.39], [-1.98, 0.93], [-1.98, 0.84]];
      const roof = [[0.33, 1.36], [-1.6, 1.37], [-1.64, 1.43], [0.28, 1.42]];
      const cPillar = [[-0.95, 0.88], [-1.15, 1.38], [-1.58, 1.38], [-1.99, 0.93], [-1.99, 0.88]];
      const parts = [
        part(profile(body, 1.8, { bevel: 0.06 }), PAINT),
        part(profile(glass, 1.54, { bevel: 0.05 }), GLASS, MAT_GLOSS),
        part(profile(roof, 1.46, { bevel: 0.03 }), PAINT),
        part(box(1.3, 0.05, 0.3, 0, 1.43, 1.55), PAINT), // spoiler de teto
      ];
      for (const s of [-1, 1]) {
        parts.push(part(profile(cPillar, 0.05, { bevel: 0, offsetX: s * 0.78 }), PAINT));
        parts.push(part(box(0.05, 0.5, 0.1, s * 0.78, 1.12, 0.15), TRIM, MAT_MATTE)); // coluna B black-out
        parts.push(part(box(0.03, 0.16, 1.65, s * 0.905, 0.33, -0.02), TRIM, MAT_MATTE)); // borrachão lateral
        parts.push(part(box(0.02, 0.44, 0.02, s * 0.902, 0.6, 0.38), TRIM, MAT_MATTE)); // vão da porta
        parts.push(part(box(0.18, 0.11, 0.14, s * 0.85, 0.96, -0.68), PAINT)); // retrovisor
      }
      parts.push(part(box(1.5, 0.2, 0.04, 0, 0.66, -2.105), TRIM, MAT_MATTE)); // grade
      parts.push(part(box(1.86, 0.18, 0.12, 0, 0.36, -2.06), TRIM, MAT_MATTE)); // para-choques pretos
      parts.push(part(box(1.86, 0.18, 0.12, 0, 0.38, 2.06), TRIM, MAT_MATTE));
      parts.push(part(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 8).rotateX(Math.PI / 2).translate(0.55, 0.27, 2.05), CHROME, MAT_GLOSS));
      return parts;
    },
    lights: [
      // faróis redondos duplos (em caixa) + faixa de neon na grade (detalhe GTI)
      { size: [0.2, 0.18, 0.03], pos: [-0.6, 0.66, -2.11], kind: L_HEAD },
      { size: [0.2, 0.18, 0.03], pos: [0.6, 0.66, -2.11], kind: L_HEAD },
      { size: [0.14, 0.14, 0.03], pos: [-0.36, 0.66, -2.11], kind: L_HEAD },
      { size: [0.14, 0.14, 0.03], pos: [0.36, 0.66, -2.11], kind: L_HEAD },
      { size: [1.5, 0.025, 0.03], pos: [0, 0.57, -2.11], kind: L_NEON },
      { size: [0.12, 0.08, 0.03], pos: [-0.82, 0.36, -2.125], kind: L_AMBER },
      { size: [0.12, 0.08, 0.03], pos: [0.82, 0.36, -2.125], kind: L_AMBER },
      { size: [0.38, 0.2, 0.03], pos: [-0.66, 0.7, 2.1], kind: L_TAIL },
      { size: [0.38, 0.2, 0.03], pos: [0.66, 0.7, 2.1], kind: L_TAIL },
      { size: [0.5, 0.04, 0.03], pos: [0, 1.4, 1.71], kind: L_TAIL }, // brake light no spoiler
    ],
  },
};

export const CAR_MODELS = Object.keys(MODELS);
/** Probabilidade de cada modelo aparecer. */
export const CAR_MODEL_WEIGHTS = { wedge: 0.3, sedan: 0.4, hatch: 0.3 };

export function pickCarModel(rnd) {
  let r = rnd();
  for (const name of CAR_MODELS) {
    r -= CAR_MODEL_WEIGHTS[name];
    if (r <= 0) return name;
  }
  return CAR_MODELS[0];
}

export function carSpec(name) {
  return MODELS[name];
}

/** Placa Mercosul (branca com a faixa azul) na traseira. */
function plateParts(rearZ, y) {
  return [
    part(box(0.52, 0.16, 0.02, 0, y, rearZ), PLATE, MAT_GLOSS),
    part(box(0.52, 0.035, 0.022, 0, y + 0.062, rearZ), PLATE_BLUE, MAT_GLOSS),
  ];
}

const bodyCache = new Map();
/** Carroceria sem rodas (as lentes das luzes entram "apagadas"). */
export function createCarBodyGeometry(name) {
  if (bodyCache.has(name)) return bodyCache.get(name);
  const spec = MODELS[name];
  const parts = spec.build();
  const [rear, y] = { wedge: [2.29, 0.5], sedan: [2.265, 0.5], hatch: [2.13, 0.52] }[name];
  parts.push(...plateParts(rear, y));
  for (const l of spec.lights) parts.push(part(box(...l.size, ...l.pos), LENS[l.kind], MAT_GLOSS));
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  bodyCache.set(name, geo);
  return geo;
}

/** Luzes do modelo (um pouco maiores que as lentes, para cobri-las sem brigar no z-buffer). */
export function createCarLightsGeometry(name) {
  const parts = MODELS[name].lights.map((l) => {
    const g = clean(box(l.size[0] + 0.012, l.size[1] + 0.012, l.size[2] + 0.012, ...l.pos));
    g.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(l.kind), 1));
    return g;
  });
  return mergeGeometries(parts);
}

/** Roda com a face externa em +x: pneu com ombro arredondado, aro cromado de 5 raios. */
export function createWheelGeometry() {
  const prof = [
    [0.2, -0.13], [0.3, -0.135], [WHEEL_R, -0.08], [WHEEL_R, 0.08], [0.3, 0.135], [0.2, 0.13],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const tire = new THREE.LatheGeometry(prof, 16).rotateZ(-Math.PI / 2);
  const parts = [
    part(tire, [0.03, 0.028, 0.035], MAT_MATTE),
    part(new THREE.CylinderGeometry(0.215, 0.215, 0.22, 16, 1, true).rotateZ(Math.PI / 2), [0.05, 0.045, 0.06], MAT_MATTE),
    part(new THREE.CircleGeometry(0.215, 16).rotateY(Math.PI / 2).translate(0.1, 0, 0), [0.05, 0.045, 0.06], MAT_MATTE),
    part(new THREE.TorusGeometry(0.205, 0.022, 3, 16).rotateY(Math.PI / 2).translate(0.11, 0, 0), CHROME, MAT_GLOSS),
    part(new THREE.CylinderGeometry(0.055, 0.055, 0.04, 8).rotateZ(Math.PI / 2).translate(0.125, 0, 0), CHROME, MAT_GLOSS),
  ];
  for (let k = 0; k < 5; k++) {
    parts.push(part(box(0.03, 0.055, 0.19, 0.118, 0, 0.1).rotateX((k * Math.PI * 2) / 5), CHROME, MAT_GLOSS));
  }
  return mergeGeometries(parts);
}

/** Roda simplificada (carros estacionados: parada e quase toda escondida na caixa de roda). */
function createParkedWheelGeometry() {
  return mergeGeometries([
    part(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.26, 10).rotateZ(Math.PI / 2), [0.03, 0.028, 0.035], MAT_MATTE),
    part(new THREE.CircleGeometry(0.2, 8).rotateY(Math.PI / 2).translate(0.132, 0, 0), CHROME, MAT_GLOSS),
  ]);
}

const parkedWheel = createParkedWheelGeometry();
const _wm = new THREE.Matrix4();
/** Rodas do modelo na posição de repouso (para os carros estacionados). */
export function placedWheels(name) {
  const spec = MODELS[name];
  const out = [];
  for (const z of spec.wheelZ) {
    for (const s of [-1, 1]) {
      _wm.makeRotationY(s < 0 ? Math.PI : 0).setPosition(s * spec.track, WHEEL_R, z);
      out.push(parkedWheel.clone().applyMatrix4(_wm));
    }
  }
  return out;
}

/** Carro inteiro, rodas incluídas (estacionados). */
export function createCarGeometry(name = 'sedan') {
  return mergeGeometries([createCarBodyGeometry(name), ...placedWheels(name)]);
}

/** Material único dos carros: pintura com verniz, vidro/cromo lisos, borracha fosca. */
export function createCarMaterial() {
  const mat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    metalness: 0.45,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    envMapIntensity: 0.9,
  });
  mat.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMat;\nvarying float vMat;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMat = aMat;')
      .replace(
        '#include <color_vertex>',
        THREE.ShaderChunk.color_vertex.replace('vColor.rgb *= instanceColor.rgb;', 'vColor.rgb *= mix(instanceColor.rgb, vec3(1.0), step(0.5, aMat));'),
      );
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vMat;')
      .replace(
        '#include <metalnessmap_fragment>',
        /* glsl */ `#include <metalnessmap_fragment>
        if (vMat > 1.5) { metalnessFactor = 0.0; roughnessFactor = 0.78; }
        else if (vMat > 0.5) { metalnessFactor = 0.85; roughnessFactor = 0.1; }`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        /* glsl */ `#include <lights_physical_fragment>
        #ifdef USE_CLEARCOAT
          if (vMat > 1.5) material.clearcoat = 0.0;
        #endif`,
      );
  };
  mat.customProgramCacheKey = () => 'car-paint-v1';
  return mat;
}

/**
 * Luzes dos carros (bloom por HDR): faróis, lanternas que acendem forte na freada,
 * frisos de neon na cor do carro e piscas âmbar.
 * Por instância: aTint (cor do neon) e aLight (x = freio 0..1, y = ligado 0..1).
 */
export function createCarLightsMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: /* glsl */ `
      #include <bend_pars>
      attribute float aKind;
      attribute vec3 aTint;
      attribute vec2 aLight;
      varying vec3 vCol;
      varying vec3 vWorld;
      void main() {
        float on = aLight.y;
        vec3 c;
        if (aKind < 0.5) c = mix(vec3(0.55, 0.56, 0.62), vec3(2.4, 2.25, 2.0), on);
        else if (aKind < 1.5) c = mix(vec3(0.3, 0.02, 0.05), vec3(1.1, 0.05, 0.1) + vec3(2.3, 0.05, 0.12) * aLight.x, on);
        else if (aKind < 2.5) c = aTint * 1.5 * on;
        else c = mix(vec3(0.45, 0.22, 0.02), vec3(1.6, 0.7, 0.1), on);
        vCol = c;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * bendView(viewMatrix * wp);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying vec3 vWorld;
      ${FOG_GLSL}
      void main() {
        gl_FragColor = vec4(mix(vCol, FOG_COLOR, fogAmount(vWorld) * 0.85), 1.0);
      }
    `,
  });
}

/** Luz de neon sob o carro, derramada no asfalto (aditiva). Por instância: aTint já com a intensidade. */
export function createUnderglow(count) {
  const geo = new THREE.PlaneGeometry(2.9, 5.6).rotateX(-Math.PI / 2).translate(0, 0.04, 0);
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      #include <bend_pars>
      attribute vec3 aTint;
      varying vec2 vUv;
      varying vec3 vTint;
      void main() {
        vUv = uv;
        vTint = aTint;
        gl_Position = projectionMatrix * bendView(modelViewMatrix * instanceMatrix * vec4(position, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vTint;
      void main() {
        // retângulo arredondado que se apaga suavemente nas bordas
        vec2 q = abs(vUv - 0.5) * 2.0;
        vec2 e = max(q - vec2(0.42, 0.66), 0.0) / vec2(0.58, 0.34);
        float a = 1.0 - smoothstep(0.0, 1.0, length(e));
        gl_FragColor = vec4(vTint * a * a * 0.5, 1.0);
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.renderOrder = 1;
  return mesh;
}

/* ================================================================== */
/*  Carro voador (hover): cunha baixa, cápsula de vidro e dois         */
/*  propulsores laterais ligados por uma asa (frente = -z)             */
/* ================================================================== */
export const HOVER_PAINTS = ['#1c0b30', '#0c1a30', '#2a0a22', '#141020', '#20103a', '#0a2228'];
export const POD_X = 1.0;
export const POD_Y = -0.08;
export const NOZZLE_Z = 1.74;
const POD_Z = 0.3;
const POD_LEN = 2.8;

export function createHoverCarGeometry() {
  const body = [[-2.1, -0.22], [1.7, -0.24], [2.3, -0.06], [2.26, 0.04], [0.9, 0.22], [-1.5, 0.3], [-2.15, 0.26]];
  const canopy = [[1.0, 0.18], [0.15, 0.62], [-0.7, 0.64], [-1.55, 0.3], [-1.55, 0.18]];
  const parts = [
    part(profile(body, 1.6, { bevel: 0.08 }), PAINT),
    part(profile(canopy, 1.08, { bevel: 0.06 }), GLASS, MAT_GLOSS),
    part(box(2.0, 0.06, 1.3, 0, -0.06, 0.65), PAINT), // asa que liga os propulsores
  ];
  for (const s of [-1, 1]) {
    const x = s * POD_X;
    parts.push(part(new THREE.CylinderGeometry(0.24, 0.28, POD_LEN, 12).rotateX(Math.PI / 2).translate(x, POD_Y, POD_Z), PAINT));
    parts.push(part(new THREE.ConeGeometry(0.24, 0.55, 12).rotateX(-Math.PI / 2).translate(x, POD_Y, POD_Z - POD_LEN / 2 - 0.27), PAINT));
    // anel cromado do bocal e aleta vertical
    parts.push(part(new THREE.TorusGeometry(0.27, 0.035, 6, 16).translate(x, POD_Y, NOZZLE_Z - 0.03), CHROME, MAT_GLOSS));
    parts.push(part(new THREE.BoxGeometry(0.05, 0.5, 0.65).rotateZ(-s * 0.25).translate(x - s * 0.06, 0.32, 1.35), PAINT));
    parts.push(part(box(0.03, 0.04, 2.6, x + s * 0.27, POD_Y, POD_Z), TRIM, MAT_MATTE));
  }
  const geo = mergeGeometries(parts);
  geo.computeBoundingSphere();
  return geo;
}

/** Luzes do carro voador: 0 = farol, 1 = friso/lanterna na cor, 2 = bocal (potência), 3 = placas sob a nave. */
export function createHoverLightsGeometry() {
  const lit = (g, kind) => {
    const c = clean(g);
    c.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(c.attributes.position.count).fill(kind), 1));
    return c;
  };
  const parts = [
    lit(box(0.9, 0.035, 0.08, 0, -0.02, -2.22), 0),
    lit(box(1.3, 0.05, 0.04, 0, 0.17, 2.16), 1),
  ];
  for (const s of [-1, 1]) {
    const x = s * POD_X;
    parts.push(lit(new THREE.CylinderGeometry(0.23, 0.23, 0.04, 16).rotateX(Math.PI / 2).translate(x, POD_Y, NOZZLE_Z), 2));
    parts.push(lit(new THREE.SphereGeometry(0.06, 8, 6).translate(x, POD_Y, POD_Z - POD_LEN / 2 - 0.52), 0));
    parts.push(lit(box(0.025, 0.03, 3.4, s * 0.81, -0.12, -0.1), 1));
    parts.push(lit(new THREE.PlaneGeometry(0.34, 2.2).rotateX(Math.PI / 2).translate(x, POD_Y - 0.29, POD_Z), 3));
  }
  return mergeGeometries(parts);
}

export function createHoverLightsMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      #include <bend_pars>
      attribute float aKind;
      attribute vec3 aTint;
      attribute float aPower;
      varying vec3 vCol;
      varying vec3 vWorld;
      void main() {
        vec3 tint = mix(aTint, vec3(1.0), 0.25);
        vec3 c;
        if (aKind < 0.5) c = vec3(2.4, 2.3, 2.1);
        else if (aKind < 1.5) c = tint * 1.7;
        else if (aKind < 2.5) c = mix(tint, vec3(1.0), 0.35) * (0.9 + 1.4 * aPower);
        else c = tint * (0.5 + 0.7 * aPower);
        vCol = c;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * bendView(viewMatrix * wp);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      varying vec3 vWorld;
      ${FOG_GLSL}
      void main() {
        gl_FragColor = vec4(mix(vCol, FOG_COLOR, fogAmount(vWorld) * 0.6), 1.0);
      }
    `,
  });
}
