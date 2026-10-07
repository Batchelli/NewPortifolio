import { WORLD_SIZE, HALF_WORLD, wrapDelta } from './Planet.js';
import { mulberry } from '../world/Scenery.js';

/**
 * ============================================================
 *  PLANTA DA CIDADE
 * ============================================================
 * As duas avenidas dos projetos (Av. Meridiano em x = 0 e Bulevar Equador em z = 0)
 * continuam iguais. Em volta delas nasce uma malha de ruas paralelas, uma a cada
 * BLOCK unidades (x ou z ≡ BLOCK/2 mod BLOCK), que também dá a volta no planeta.
 *
 *   |  calçadão  | calç. |  rua  | calç. |   quarteirão   | calç. |  rua  | ...
 *   0 (avenida)  21.5    25      30      35  38.5        81.5    85      90
 *
 * Entre duas ruas fica um quarteirão (LOT_HALF para cada lado do centro). A "célula"
 * da malha que contém a avenida vira o calçadão dos projetos (pedestais e palmeiras).
 * Tudo aqui é só dado (determinístico): o chão, os prédios, o trânsito e o minimapa
 * leem a mesma planta.
 */

export const BLOCK = 60;
export const STREET_HALF = 5; // meia largura da rua (faixa de rolamento + faixa de estacionamento)
export const SIDEWALK = 3.5;
export const CURB_OUT = STREET_HALF + SIDEWALK; // da linha da rua até o fim da calçada
export const LOT_HALF = BLOCK / 2 - CURB_OUT; // meia largura útil do quarteirão (21.5)
export const GRID_N = WORLD_SIZE / BLOCK; // ruas por eixo (= células por eixo)
export const LANE_OFFSET = 1.4; // centro da faixa de rolamento, a partir da linha da rua
export const PARK_OFFSET = 3.9; // centro da faixa de estacionamento
export const STREET_LAMP_OFFSET = STREET_HALF + 0.6; // poste na beira da calçada
export const STREET_LAMP_SPACING = 30; // postes em along ≡ 15 (mod 30)
export const AVENUE_CROSS_STOP = 10; // faixa de retenção antes de cruzar a avenida
export const STREET_CROSS_STOP = 9.4; // faixa de retenção antes de um cruzamento de ruas

/** Tipos de chão de um quarteirão (lidos pelo shader do chão). */
export const LOT = { NONE: 0, PAVED: 1, PARK: 2, PARKING: 3, HOUSES: 4, CONCRETE: 5 };
/** Variantes de praça/parque (desenho dos caminhos no chão). */
export const PARK = { CROSS: 0, DIAGONAL: 1, POND: 2, FOUNTAIN: 3, MONUMENT: 4 };

export const DISTRICTS = [
  { id: 'centro', name: 'CENTRO NEON', tagline: 'Arranha-céus e letreiros que nunca dormem', color: '#00f0ff' },
  { id: 'vila', name: 'VILA SYNTH', tagline: 'Comércio de rua e prédios residenciais', color: '#ff2a9d' },
  { id: 'jardim', name: 'JARDIM VAPOR', tagline: 'Prédios art déco, praças e muito verde', color: '#39ff88' },
  { id: 'arcade', name: 'DISTRITO ARCADE', tagline: 'Fliperamas, bares e vida noturna', color: '#ffd319' },
  { id: 'orla', name: 'ZONA 180°', tagline: 'Galpões e monumentos do outro lado do mundo', color: '#ff7a29' },
];
export const D = { CENTRO: 0, VILA: 1, JARDIM: 2, ARCADE: 3, ORLA: 4 };

const NS_NAMES = [
  'R. DOS PIXELS', 'R. VAPORWAVE', 'R. DO CASSETE', 'R. DISQUETE', 'R. DO VHS', 'R. SINTETIZADOR',
  'R. DO FLIPERAMA', 'R. DOS NEONS', 'R. TURBO', 'R. CROMADA', 'R. DO MODEM', 'R. 8 BITS',
];
const EW_NAMES = [
  'AL. LASER', 'AL. PÔR DO SOL', 'AL. HOLOGRAMA', 'AL. CROMO', 'AL. GAME OVER', 'AL. HI-SCORE',
  'AL. JOYSTICK', 'AL. FITA K7', 'AL. GALÁXIA', 'AL. ARCO-ÍRIS', 'AL. ESTRELA', 'AL. COMETA',
];
export const AVENUE_NAMES = { ns: 'AV. MERIDIANO', ew: 'BULEVAR EQUADOR' };

/* ------------------------------------------------------------------ */
/*  Geometria da malha                                                  */
/* ------------------------------------------------------------------ */
const mod = (a, n) => ((a % n) + n) % n;

/** Coordenada da rua k (0..GRID_N-1), dentro de [-HALF, HALF). */
export const streetLine = (k) => wrapDelta(BLOCK / 2 + k * BLOCK);
export const STREET_LINES = Array.from({ length: GRID_N }, (_, k) => streetLine(k));

/** Índice da rua mais próxima da coordenada c. */
export const nearestLine = (c) => mod(Math.round((c - BLOCK / 2) / BLOCK), GRID_N);

/** Distância (sem sinal) até a rua mais próxima. */
export const streetDist = (c) => Math.abs(mod(c, BLOCK) - BLOCK / 2);

/** Célula da malha que contém c. A célula GRID_N-1 é a da avenida. */
export const cellOf = (c) => Math.floor(mod(c - BLOCK / 2, WORLD_SIZE) / BLOCK);
export const AVENUE_CELL = GRID_N - 1;

/** Centro da célula i, em [-HALF, HALF). */
export const cellCenter = (i) => wrapDelta(BLOCK * (i + 1));

/** Nomes das ruas: NS = ruas paralelas à Av. Meridiano (x fixo), EW = paralelas ao Bulevar (z fixo). */
export const streetName = (axis, k) => {
  const list = axis === 'x' ? NS_NAMES : EW_NAMES;
  return list[k] || `${axis === 'x' ? 'R.' : 'AL.'} ${k + 1}`;
};

/** Bairro de uma célula (i, j); -1 = calçadão das avenidas / praça central. */
export function districtOf(i, j) {
  if (i === AVENUE_CELL || j === AVENUE_CELL) return -1;
  const cx = cellCenter(i);
  const cz = cellCenter(j);
  if (Math.abs(cx) >= HALF_WORLD - 1e-6 || Math.abs(cz) >= HALF_WORLD - 1e-6) return D.ORLA;
  const east = cx > 0;
  const north = cz < 0;
  if (north) return east ? D.CENTRO : D.VILA;
  return east ? D.ARCADE : D.JARDIM;
}

/* ------------------------------------------------------------------ */
/*  Caminhos dos parques (o mesmo desenho existe em GLSL no Ground.js)  */
/* ------------------------------------------------------------------ */
export function parkPathAt(variant, lx, lz) {
  const r = Math.hypot(lx, lz);
  const ax = Math.abs(lx);
  const az = Math.abs(lz);
  switch (variant) {
    case PARK.CROSS:
      return ax < 1.8 || az < 1.8 || r < 5.5;
    case PARK.DIAGONAL:
      return Math.abs(ax - az) < 2.4 || r < 5.5;
    case PARK.POND:
      return (r > 11.5 && r < 14.5) || (r > 14 && (ax < 1.6 || az < 1.6)) || r < 10.5;
    case PARK.FOUNTAIN:
      return r < 10.5 || ax < 1.8 || az < 1.8 || (r > 16 && r < 18.5);
    case PARK.MONUMENT:
      return (ax < 13.5 && az < 13.5) || Math.abs(ax - az) < 2.2;
    default:
      return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Geração dos quarteirões                                             */
/* ------------------------------------------------------------------ */
const WEIGHTS = {
  [D.CENTRO]: { tower: 5, quad: 4, split: 2, park: 1 },
  [D.VILA]: { quad: 4, split: 3, row: 3, park: 2 },
  [D.JARDIM]: { houses: 5, park: 4, row: 1 },
  [D.ARCADE]: { row: 4, quad: 3, split: 2, parking: 2, park: 1 },
  [D.ORLA]: { warehouse: 4, parking: 2, park: 2 },
};

/** Faixas de altura por bairro: [min, max] dos prédios "médios". */
const MID_H = {
  [D.CENTRO]: [24, 44],
  [D.VILA]: [14, 30],
  [D.JARDIM]: [10, 16],
  [D.ARCADE]: [9, 22],
  [D.ORLA]: [10, 16],
};

function pick(rnd, weights) {
  const entries = Object.entries(weights);
  let total = 0;
  for (const [, w] of entries) total += w;
  let x = rnd() * total;
  for (const [k, w] of entries) {
    x -= w;
    if (x <= 0) return k;
  }
  return entries[0][0];
}

/**
 * Gera a planta completa: tipo de cada quarteirão e os prédios.
 * blocks[i][j] = { i, j, cx, cz, district, kind, ground, variant }
 * buildings: [{ x, z, w, d, h, y, district, shop, roof, deco?, warehouse?, crown? }]
 */
export function createCityPlan() {
  const rnd = mulberry(2026);
  const blocks = [];
  const buildings = [];
  const N = GRID_N;
  const L = LOT_HALF;
  const E = L - 0.5; // face externa dos prédios (colados na calçada)
  const r = (a, b) => a + rnd() * (b - a);

  const farI = cellOf(HALF_WORLD); // coluna/linha do antípoda
  const arcadeBlock = { i: cellOf(60), j: cellOf(60) }; // fliperama: perto da praça, a sudeste
  const megaBlock = { i: cellOf(120), j: cellOf(-120) }; // torre símbolo do centro

  for (let i = 0; i < N; i++) {
    blocks.push([]);
    for (let j = 0; j < N; j++) {
      const cx = cellCenter(i);
      const cz = cellCenter(j);
      const district = districtOf(i, j);
      const block = { i, j, cx, cz, district, kind: 'avenue', ground: LOT.NONE, variant: 0 };
      blocks[i].push(block);
      if (i === AVENUE_CELL || j === AVENUE_CELL) continue;

      let kind = pick(rnd, WEIGHTS[district]);
      if (i === farI && j === farI) kind = 'monument';
      else if (i === arcadeBlock.i && j === arcadeBlock.j) kind = 'arcade';
      else if (i === megaBlock.i && j === megaBlock.j) kind = 'mega';
      block.kind = kind;
      const [hMin, hMax] = MID_H[district];
      const shopChance = { [D.CENTRO]: 0.5, [D.VILA]: 0.75, [D.JARDIM]: 0.3, [D.ARCADE]: 0.95, [D.ORLA]: 0.1 }[district];
      const add = (x, z, w, d, h, extra = {}) =>
        buildings.push({ x: cx + x, z: cz + z, w, d, h, y: 0, cx, cz, district, shop: rnd() < shopChance, roof: 'flat', ...extra });

      switch (kind) {
        case 'mega': {
          add(0, 0, 41, 41, 7, { shop: true });
          add(0, 0, 24, 24, 92, { y: 7, shop: false, crown: true });
          block.ground = LOT.PAVED;
          break;
        }
        case 'tower': {
          const podium = r(5.5, 8);
          add(0, 0, 41, 41, podium, { shop: true });
          add(r(-3, 3), r(-3, 3), r(22, 30), r(22, 30), r(42, 74), { y: podium, shop: false });
          block.ground = LOT.PAVED;
          break;
        }
        case 'quad': {
          // às vezes dois lotes viram um prédio comprido
          const merge = rnd() < 0.3 ? (rnd() < 0.5 ? 'x' : 'z') : null;
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
              const w = r(15, 19.5);
              const d = r(15, 19.5);
              if (merge === 'x' && sx === 1) {
                if (sz === -1) add(sx * (E - w / 2), 0, w, E * 2, r(hMin, hMax));
                continue;
              }
              if (merge === 'z' && sz === 1) {
                if (sx === -1) add(0, sz * (E - d / 2), E * 2, d, r(hMin, hMax));
                continue;
              }
              add(sx * (E - w / 2), sz * (E - d / 2), w, d, r(hMin, hMax));
            }
          }
          block.ground = LOT.PAVED;
          break;
        }
        case 'split': {
          const alongX = rnd() < 0.5;
          const side = rnd() < 0.5 ? 1 : -1;
          const depth = r(16, 19);
          const slabH = r(hMin, hMax) * 1.15;
          if (alongX) add(0, side * (E - depth / 2), E * 2, depth, slabH);
          else add(side * (E - depth / 2), 0, depth, E * 2, slabH);
          for (const s of [-1, 1]) {
            const w = r(16, 19.5);
            const d = r(14, 18);
            if (alongX) add(s * (E - w / 2), -side * (E - d / 2), w, d, r(hMin, hMax) * 0.8);
            else add(-side * (E - d / 2), s * (E - w / 2), d, w, r(hMin, hMax) * 0.8);
          }
          block.ground = LOT.PAVED;
          break;
        }
        case 'row': {
          // sobrados / lojas lado a lado em duas faces do quarteirão
          const alongX = rnd() < 0.5;
          for (const side of [-1, 1]) {
            let pos = -E;
            while (pos < E - 6) {
              const w = Math.min(r(10, 15), E - pos);
              const d = r(12, 15);
              const h = district === D.JARDIM ? r(7, 11) : r(hMin * 0.8, hMax * 0.75);
              const c = pos + w / 2;
              if (alongX) add(c, side * (E - d / 2), w - 0.4, d, h, { shop: rnd() < 0.85 });
              else add(side * (E - d / 2), c, d, w - 0.4, h, { shop: rnd() < 0.85 });
              pos += w;
            }
          }
          block.ground = LOT.PAVED;
          break;
        }
        case 'houses': {
          // prédios baixos art déco (estilo Miami) nas quinas, em volta de um jardim central;
          // alguns têm um "degrau" recuado no topo, típico do Streamline Moderne
          const deco = { shop: false, deco: true };
          for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
              const w = r(10.5, 12); // não invade o caminho em volta do jardim
              const d = r(10.5, 12);
              const x = sx * (E - w / 2);
              const z = sz * (E - d / 2);
              const h = r(9, 15);
              add(x, z, w, d, h, deco);
              if (rnd() < 0.5) add(x - sx * w * 0.12, z - sz * d * 0.12, w * 0.55, d * 0.55, r(2.4, 3.6), { ...deco, y: h });
            }
          }
          // um bloco menor no meio de duas faces
          const alongX = rnd() < 0.5;
          for (const s of [-1, 1]) {
            const h = r(6.5, 9);
            if (alongX) add(0, s * (E - 4.5), 7.5, 9, h, deco);
            else add(s * (E - 4.5), 0, 9, 7.5, h, deco);
          }
          block.ground = LOT.HOUSES;
          break;
        }
        case 'warehouse': {
          const alongX = rnd() < 0.5;
          for (const s of [-1, 1]) {
            const d = r(16, 19);
            if (alongX) add(0, s * (E - d / 2), E * 2 - r(0, 6), d, r(8, 12), { shop: false, warehouse: true });
            else add(s * (E - d / 2), 0, d, E * 2 - r(0, 6), r(8, 12), { shop: false, warehouse: true });
          }
          block.ground = LOT.CONCRETE;
          break;
        }
        case 'arcade': {
          // fliperama de frente para a rua ao norte, lojinhas dos lados e prédios atrás
          add(-(E - 5.5), -(E - 7), 11, 14, r(8, 12), { shop: true });
          add(E - 5.5, -(E - 7), 11, 14, r(10, 14), { shop: true });
          add(-(E - 9.5), E - 9, 19, 18, r(16, 22));
          add(E - 9.5, E - 9, 19, 18, r(14, 20));
          block.ground = LOT.PAVED;
          block.arcade = { x: cx, z: cz - (E - 7), rotY: Math.PI };
          break;
        }
        case 'parking':
          block.ground = LOT.PARKING;
          break;
        case 'monument':
          block.ground = LOT.PARK;
          block.variant = PARK.MONUMENT;
          break;
        case 'park':
        default: {
          block.kind = 'park';
          block.ground = LOT.PARK;
          const variants =
            district === D.CENTRO || district === D.ARCADE
              ? [PARK.FOUNTAIN, PARK.FOUNTAIN, PARK.CROSS, PARK.DIAGONAL]
              : district === D.ORLA
                ? [PARK.MONUMENT, PARK.DIAGONAL]
                : [PARK.POND, PARK.CROSS, PARK.DIAGONAL, PARK.FOUNTAIN];
          block.variant = variants[Math.floor(rnd() * variants.length)];
          if (block.variant === PARK.MONUMENT) block.kind = 'monument';
          break;
        }
      }
    }
  }

  // O dirigível circula a praça a ~42 de altura num raio de ~95: nada de prédio alto no caminho dele.
  for (const b of buildings) {
    const nx = Math.max(Math.abs(b.x) - b.w / 2, 0);
    const nz = Math.max(Math.abs(b.z) - b.d / 2, 0);
    const dMin = Math.hypot(nx, nz);
    const dMax = Math.hypot(Math.abs(b.x) + b.w / 2, Math.abs(b.z) + b.d / 2);
    if (dMin < 122 && dMax > 68 && b.y + b.h > 30) {
      if (b.y > 0) b.h = Math.max(30 - b.y, 6);
      else b.h = 30;
      b.capped = true;
    }
  }

  return { blocks, buildings, lines: STREET_LINES };
}

/** Bloco (ou faixa da avenida) que contém o ponto (x, z) do mundo. */
export function blockAt(plan, x, z) {
  return plan.blocks[cellOf(x)][cellOf(z)];
}

/** Onde o jogador está: bairro e rua/avenida mais próxima. */
export function locate(plan, x, z) {
  const lx = wrapDelta(x);
  const lz = wrapDelta(z);
  const block = blockAt(plan, lx, lz);
  const dx = streetDist(lx);
  const dz = streetDist(lz);
  const byStreet = () => (dx < dz ? streetName('x', nearestLine(lx)) : streetName('z', nearestLine(lz)));
  let street;
  if (Math.hypot(lx, lz) < 24) street = 'PRAÇA CENTRAL';
  else if (dx < CURB_OUT || dz < CURB_OUT) street = byStreet();
  else if (Math.abs(lx) < LOT_HALF && Math.abs(lx) < Math.abs(lz)) street = AVENUE_NAMES.ns;
  else if (Math.abs(lz) < LOT_HALF) street = AVENUE_NAMES.ew;
  else if (Math.abs(lx) < LOT_HALF) street = AVENUE_NAMES.ns;
  else street = byStreet();
  return { district: block.district, street };
}
