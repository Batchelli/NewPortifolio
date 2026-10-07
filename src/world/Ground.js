import * as THREE from 'three';
import { WORLD_SIZE, ROAD_WIDTH, PLAZA_RADIUS } from '../core/Planet.js';
import {
  BLOCK,
  STREET_HALF,
  CURB_OUT,
  GRID_N,
  DISTRICTS,
  STREET_LAMP_OFFSET,
  STREET_LAMP_SPACING,
  AVENUE_CROSS_STOP,
  STREET_CROSS_STOP,
  LANE_OFFSET,
} from '../core/CityPlan.js';
import { LAMP_FIRST, LAMP_SPACING, LAMP_LAST, LAMP_OFFSET, LAMP_ARM, STREET_LAMP_ARM } from './Props.js';

const GROUND_SIZE = 420;
const GROUND_SEGMENTS = 210; // vértices a cada 2 unidades: a curvatura precisa de malha densa
export const MAX_LIGHT_POOLS = 24;

/** Planta dos quarteirões numa textura N×N: R = tipo de chão, G = bairro, B = variante do parque. */
function blockTexture(plan) {
  const data = new Uint8Array(GRID_N * GRID_N * 4);
  for (let i = 0; i < GRID_N; i++) {
    for (let j = 0; j < GRID_N; j++) {
      const b = plan.blocks[i][j];
      const k = (j * GRID_N + i) * 4;
      data[k] = b.ground;
      data[k + 1] = b.district < 0 ? 255 : b.district;
      data[k + 2] = b.variant;
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, GRID_N, GRID_N, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Chão do planeta: as avenidas dos projetos, a praça, a malha de ruas com calçadas,
 * quarteirões, parques e estacionamentos. Tudo calculado no shader em coordenadas
 * periódicas (o padrão se repete a cada WORLD_SIZE). A malha acompanha a câmera;
 * o desenho fica preso ao mundo.
 */
export class Ground {
  constructor(scene, plan) {
    this.material = new THREE.ShaderMaterial({
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uW: { value: WORLD_SIZE },
        uRoadW: { value: ROAD_WIDTH },
        uPlazaR: { value: PLAZA_RADIUS },
        uLine: { value: new THREE.Color('#ff2fd0') },
        uBase: { value: new THREE.Color('#0b0018') },
        uHaze: { value: new THREE.Color('#3a0a4a') },
        // poças de luz: (x, z, raio, intensidade) + cor, uma por fonte de luz próxima
        uPools: { value: Array.from({ length: MAX_LIGHT_POOLS }, () => new THREE.Vector4(0, 0, 1, 0)) },
        uPoolColors: { value: Array.from({ length: MAX_LIGHT_POOLS }, () => new THREE.Color()) },
        // postes das avenidas: posições periódicas, calculadas direto no shader (sem custo por poste)
        uLamp: { value: new THREE.Vector4(LAMP_FIRST, LAMP_SPACING, LAMP_LAST, LAMP_OFFSET - LAMP_ARM) },
        // malha urbana: (quarteirão, meia rua, fim da calçada, nº de células)
        uCity: { value: new THREE.Vector4(BLOCK, STREET_HALF, CURB_OUT, GRID_N) },
        // (distância da luz do poste até a linha da rua, espaçamento, retenção avenida, retenção rua)
        uStreet: {
          value: new THREE.Vector4(STREET_LAMP_OFFSET - STREET_LAMP_ARM, STREET_LAMP_SPACING, AVENUE_CROSS_STOP, STREET_CROSS_STOP),
        },
        uLaneOff: { value: LANE_OFFSET },
        uBlocks: { value: blockTexture(plan) },
        uDistrict: { value: DISTRICTS.map((d) => new THREE.Color(d.color)) },
      },
      vertexShader: /* glsl */ `
        #include <bend_pars>
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * bendView(viewMatrix * wp);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uW, uRoadW, uPlazaR, uLaneOff;
        uniform vec3 uLine, uBase, uHaze;
        uniform vec4 uPools[${MAX_LIGHT_POOLS}];
        uniform vec3 uPoolColors[${MAX_LIGHT_POOLS}];
        uniform vec4 uLamp; // (primeiro, espaçamento, último, distância da luz ao centro da pista)
        uniform vec4 uCity;
        uniform vec4 uStreet;
        uniform sampler2D uBlocks;
        uniform vec3 uDistrict[${DISTRICTS.length}];
        varying vec3 vWorld;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + 1.0), f.x), f.y);
        }

        float lampPool(float across, float along) {
          float a = abs(along);
          float k = clamp(floor((a - uLamp.x) / uLamp.y + 0.5), 0.0, floor((uLamp.z - uLamp.x) / uLamp.y));
          float ds = a - (uLamp.x + k * uLamp.y);
          float dx = abs(across) - uLamp.w;
          return exp(-(dx * dx + ds * ds * 0.55) / 11.0);
        }

        /* postes das ruas: dos dois lados, a cada uStreet.y, em along ≡ uStreet.y / 2 */
        float streetPool(float across, float along) {
          float ds = mod(along, uStreet.y) - uStreet.y * 0.5;
          float dx = abs(across) - uStreet.x;
          return exp(-(dx * dx + ds * ds * 0.6) / 8.0);
        }

        float aaLine(float x, float halfWidth) {
          float fw = fwidth(x) + 0.01;
          return 1.0 - smoothstep(halfWidth - fw, halfWidth + fw, abs(x));
        }

        /* 1 dentro (x < edge), 0 fora, com antisserrilhado */
        float inside(float x, float edge) {
          float fw = fwidth(x) + 0.005;
          return 1.0 - smoothstep(edge - fw, edge + fw, x);
        }

        float gridLine(vec2 p, float cell, float width) {
          vec2 c = p / cell;
          vec2 fw = fwidth(c);
          vec2 g = abs(fract(c - 0.5) - 0.5) / max(fw, 1e-4);
          float fade = 1.0 - smoothstep(0.15, 0.6, max(fw.x, fw.y));
          return (1.0 - smoothstep(0.0, width, min(g.x, g.y))) * fade;
        }

        /* rejunte de piso (placas de tamanho "size") */
        float tileSeam(vec2 p, float size, float width) {
          vec2 c = p / size;
          vec2 fw = fwidth(c) + 1e-4;
          vec2 g = abs(fract(c) - 0.5);
          vec2 s = smoothstep(0.5 - width / size - fw, 0.5 - width / size + fw, g);
          return max(s.x, s.y) * (1.0 - smoothstep(0.2, 0.5, max(fw.x, fw.y)));
        }

        vec3 road(float across, float along, vec3 edgeC, vec3 centerC, float cut) {
          float de = uRoadW * 0.5 - abs(across);
          float keep = 1.0 - cut;
          float edge = aaLine(de - 0.55, 0.14) * keep;
          float edgeGlow = smoothstep(1.6, 0.0, abs(de - 0.55)) * 0.12 * keep;
          float dash = aaLine(across, 0.11) * step(0.45, fract(along / 7.0)) * keep;
          // pulsos de luz correndo para longe da praça
          float pulse = smoothstep(0.9, 1.0, fract((abs(along) - uTime * 28.0) / 55.0));
          vec3 col = vec3(0.03, 0.008, 0.06);
          // bordas como fitas de LED (núcleo claro, entram no bloom)
          vec3 led = mix(edgeC, vec3(1.0), 0.3);
          col += edgeC * edgeGlow * (0.7 + pulse);
          col += led * edge * (1.6 + pulse * 2.2);
          col += centerC * dash * 1.3;
          return col;
        }

        vec3 plaza(vec2 p, float r) {
          float ang = atan(p.y, p.x);
          vec3 cyan = vec3(0.0, 0.94, 1.0);
          vec3 pink = vec3(1.0, 0.16, 0.62);
          vec3 col = vec3(0.03, 0.008, 0.06);
          col += cyan * aaLine(r - (uPlazaR - 0.6), 0.18) * 1.8;
          col += pink * aaLine(r - (uPlazaR - 1.6), 0.08) * 1.4;
          float dashes = step(0.5, fract((ang + uTime * 0.25) * 12.0 / 6.2832));
          col += pink * aaLine(r - uPlazaR * 0.62, 0.12) * dashes * 1.6;
          float spokes = smoothstep(0.47, 0.49, abs(fract(ang * 8.0 / 6.2832 + 0.0625) - 0.5));
          col += cyan * spokes * step(uPlazaR * 0.3, r) * step(r, uPlazaR * 0.6) * 0.9;
          // círculo central: luz girando em volta de cada anel (sentidos opostos), com cauda que some
          float turn = ang / 6.2832;
          float xo = fract(turn - uTime * 0.3);
          float xi = fract(-turn - uTime * 0.45);
          float spinO = pow(xo, 6.0) * smoothstep(1.0, 0.985, xo);
          float spinI = pow(xi, 6.0) * smoothstep(1.0, 0.985, xi);
          vec3 yellow = vec3(1.0, 0.83, 0.1);
          col += yellow * aaLine(r - 3.2, 0.12) * (0.55 + 1.4 * spinO);
          col += yellow * aaLine(r - 2.4, 0.06) * (0.55 + 1.4 * spinI);
          col += pink * smoothstep(3.0, 0.0, r) * 0.1;
          return col;
        }

        /* ---------------- cidade ---------------- */

        vec3 asphalt(vec2 p) {
          float n = vnoise(p * 0.9) * 0.6 + vnoise(p * 3.7) * 0.4;
          vec3 col = vec3(0.03, 0.02, 0.048) + (n - 0.5) * 0.012;
          // remendos de asfalto mais novo
          col *= 0.9 + 0.12 * step(0.78, vnoise(p * 0.12 + 7.0));
          return col;
        }

        vec3 grass(vec2 p) {
          float n = vnoise(p * 0.35) * 0.6 + vnoise(p * 2.3) * 0.4;
          vec3 col = mix(vec3(0.012, 0.038, 0.04), vec3(0.03, 0.07, 0.055), n);
          col += vec3(0.02, 0.05, 0.03) * step(0.93, hash(floor(p * 6.0))) * 0.6; // tufos
          return col;
        }

        vec3 paving(vec2 p, float size, vec3 base) {
          vec2 id = floor(p / size);
          vec3 col = base * (0.9 + 0.2 * hash(id));
          col = mix(col, base * 0.45, tileSeam(p, size, 0.05));
          return col;
        }

        /* Rua de mão dupla. across: distância com sinal até a linha da rua; along: ao longo dela;
           sCross: distância com sinal até a rua transversal mais próxima; avAlong: coordenada na avenida;
           dirSign: +1 rua NS, -1 rua EW (define de que lado fica a faixa de retenção) */
        vec3 street(vec2 world, float across, float along, float sCross, float avAlong, bool crossesAvenue, float dirSign) {
          vec3 col = asphalt(world);
          float aa = abs(across);
          float dCross = abs(sCross);
          float inX = 1.0 - inside(dCross, uCity.y); // fora do miolo do cruzamento
          // sarjeta
          col = mix(col, vec3(0.07, 0.055, 0.09), inside(uCity.y - aa, 0.22));
          // faixa dupla amarela no centro
          float center = aaLine(aa - 0.2, 0.06) * inX;
          // linha que separa a faixa de estacionamento
          float park = aaLine(aa - (uCity.y - 2.2), 0.05) * inX * step(0.45, fract(along / 2.8));
          // faixa de pedestres sobre a calçada da rua transversal
          float zebraBand = inside(abs(dCross - (uCity.y + uCity.z) * 0.5), (uCity.z - uCity.y) * 0.5 - 0.15);
          float zebra = zebraBand * step(0.5, fract(across / 1.1)) * inside(aa, uCity.y - 0.4);
          // faixa de retenção, só na mão que chega ao cruzamento
          float approaching = step(0.0, across * sCross * dirSign);
          float stop = aaLine(dCross - uStreet.w, 0.18) * approaching * inside(aa, uCity.y - 2.2);
          // cruzando a avenida dos projetos: faixa de pedestres + retenção
          if (crossesAvenue) {
            float da = abs(avAlong);
            zebra = max(zebra, inside(abs(da - (uRoadW * 0.5 + 2.0)), 1.4) * step(0.5, fract(across / 1.1)) * inside(aa, uCity.y - 0.4));
            float appA = step(0.0, across * avAlong * dirSign);
            stop = max(stop, aaLine(da - uStreet.z, 0.18) * appA * inside(aa, uCity.y - 2.2));
            center *= step(uStreet.z + 1.0, da);
          }
          col += vec3(0.95, 0.66, 0.12) * center * 0.55;
          col += vec3(0.6, 0.58, 0.7) * park * 0.35;
          col = mix(col, vec3(0.55, 0.52, 0.62), zebra * 0.85);
          col = mix(col, vec3(0.62, 0.6, 0.7), stop * 0.9);
          // bueiros perto do meio do quarteirão
          float m = mod(along + uCity.x * 0.5, uCity.x) - uCity.x * 0.5;
          float mh = length(vec2(aa - uLaneOff, m - 13.0));
          col = mix(col, vec3(0.05, 0.04, 0.07), inside(mh, 0.5));
          col += vec3(0.05, 0.04, 0.07) * aaLine(mh - 0.45, 0.04);
          return col;
        }

        /* desenho dos caminhos de cada tipo de parque: distância com sinal (< 0 = caminho) */
        float parkPath(float v, vec2 p) {
          float ax = abs(p.x), az = abs(p.y), r = length(p);
          if (v < 0.5) return min(min(ax, az) - 1.8, r - 5.5);
          if (v < 1.5) return min((abs(ax - az) - 2.4) * 0.7071, r - 5.5);
          if (v < 2.5) return min(min(abs(r - 13.0) - 1.5, max(min(ax, az) - 1.6, 14.0 - r)), r - 10.5);
          if (v < 3.5) return min(min(r - 10.5, min(ax, az) - 1.8), abs(r - 17.25) - 1.25);
          return min(max(ax, az) - 13.5, (abs(ax - az) - 2.2) * 0.7071);
        }

        vec3 parkGround(vec2 world, vec2 p, float variant, vec3 accent) {
          vec3 col = grass(world);
          float d = parkPath(variant, p);
          float path = inside(d, 0.0);
          vec3 tiles = paving(world, 1.2, vec3(0.085, 0.065, 0.11));
          col = mix(col, tiles, path);
          // borda iluminada dos caminhos
          col += accent * aaLine(d + 0.12, 0.05) * 0.9;
          float r = length(p);
          if (variant > 1.5 && variant < 2.5) {
            // lago: água escura com ondas e reflexos neon
            float water = inside(r, 9.5);
            float ripple = 0.5 + 0.5 * sin(r * 3.2 - uTime * 1.6 + vnoise(p * 0.6) * 4.0);
            vec3 w = vec3(0.0, 0.018, 0.05) + vec3(0.0, 0.3, 0.45) * pow(ripple, 8.0) * 0.18;
            w += vec3(1.0, 0.2, 0.6) * pow(vnoise(p * 1.5 + uTime * 0.3), 6.0) * 0.25;
            col = mix(col, w, water);
            col += vec3(1.0, 0.16, 0.62) * aaLine(r - 9.6, 0.08) * 1.4;
          } else if (variant > 2.5 && variant < 3.5) {
            // praça da fonte: piso radial
            float ang = atan(p.y, p.x);
            float rays = step(0.5, fract(ang * 16.0 / 6.2832));
            col = mix(col, col * (0.85 + 0.25 * rays), inside(r, 10.5));
            col += accent * aaLine(r - 10.2, 0.06) * 1.2;
          } else if (variant > 3.5) {
            // pedestal do monumento: piso escuro com moldura neon
            float sq = max(abs(p.x), abs(p.y));
            col = mix(col, vec3(0.03, 0.01, 0.05), inside(sq, 12.8));
            col += accent * aaLine(sq - 12.9, 0.1) * 1.5;
            col += accent * aaLine(sq - 11.9, 0.04) * 0.8;
          }
          return col;
        }

        vec3 parkingGround(vec2 world, vec2 p) {
          vec3 col = asphalt(world) * 1.15;
          float az = abs(p.y);
          // fileiras de vagas: centros em |z| = 5.5 e 16 (5 de profundidade)
          float row = max(inside(abs(az - 5.5), 2.5), inside(abs(az - 16.0), 2.5));
          float sep = aaLine(abs(fract((p.x + 19.5) / 2.6 + 0.5) - 0.5) * 2.6, 0.06) * inside(abs(p.x), 19.6);
          float ends = (aaLine(abs(az - 5.5) - 2.5, 0.06) + aaLine(abs(az - 16.0) - 2.5, 0.06)) * inside(abs(p.x), 19.6);
          col += vec3(0.55, 0.52, 0.62) * (sep * row + ends) * 0.4;
          // setas pintadas nos corredores
          float arrow = inside(abs(p.x), 0.25) * inside(abs(az - 10.75), 1.6);
          col += vec3(0.6, 0.55, 0.2) * arrow * 0.25;
          return col;
        }

        void main() {
          // coordenadas locais periódicas: a praça está em (0,0) de cada "cópia" do mundo
          vec2 L = mod(vWorld.xz + uW * 0.5, uW) - uW * 0.5;
          float r = length(L);
          float dist = length(vWorld.xz - cameraPosition.xz);

          // grade + onda de pulso saindo da praça
          float major = gridLine(vWorld.xz, 8.0, 1.4);
          // halo largo e fraco em volta das linhas: brilho suave sem depender do bloom
          float halo = gridLine(vWorld.xz, 8.0, 7.0) * 0.12;
          float minor = gridLine(vWorld.xz, 2.0, 1.0) * 0.12;
          float wave = smoothstep(6.0, 0.0, abs(r - mod(uTime * 45.0, uW * 0.55))) * 0.7;
          vec3 grid = uBase + uLine * (major * (1.15 + wave * 1.4) + halo + minor);

          /* ---------- malha urbana ---------- */
          float B = uCity.x;
          vec2 sAcross = mod(L, B) - B * 0.5;          // distância com sinal até a rua mais próxima (x e z)
          vec2 sd = abs(sAcross);
          vec2 cell = floor(mod(L - B * 0.5, uW) / B); // célula da malha
          vec2 lc = mod(L - B * 0.5, B) - B * 0.5;      // posição dentro do quarteirão (centro = 0)
          vec4 info = texture2D(uBlocks, (cell + 0.5) / uCity.w);
          float lotType = floor(info.r * 255.0 + 0.5);
          float district = floor(info.g * 255.0 + 0.5);
          float variant = floor(info.b * 255.0 + 0.5);
          bool avX = cell.x > uCity.w - 1.5; // faixa da Av. Meridiano
          bool avZ = cell.y > uCity.w - 1.5; // faixa do Bulevar Equador

          vec3 accent = avX ? vec3(0.0, 0.94, 1.0) : vec3(1.0, 0.16, 0.62);
          for (int k = 0; k < ${DISTRICTS.length}; k++) if (abs(district - float(k)) < 0.5) accent = uDistrict[k];

          // chão do quarteirão
          vec3 col;
          if (avX || avZ) col = grid; // calçadão dos projetos: a grade neon de sempre
          else if (lotType < 1.5) col = paving(vWorld.xz, 4.0, vec3(0.05, 0.034, 0.072)) + uLine * major * 0.18;
          else if (lotType < 2.5) col = parkGround(vWorld.xz, lc, variant, accent);
          else if (lotType < 3.5) col = parkingGround(vWorld.xz, lc);
          else if (lotType < 4.5) {
            // jardins das casas, com um caminho de pedra até cada porta
            col = grass(vWorld.xz);
            float ring = inside(abs(max(abs(lc.x), abs(lc.y)) - 7.6), 1.0);
            col = mix(col, paving(vWorld.xz, 0.9, vec3(0.08, 0.06, 0.1)), ring);
          } else col = paving(vWorld.xz, 6.0, vec3(0.075, 0.06, 0.085)) + uLine * major * 0.12;

          // calçadas
          float dStreet = min(sd.x, sd.y);
          float walk = inside(dStreet, uCity.z);
          vec3 sidewalk = paving(vWorld.xz, 1.6, vec3(0.075, 0.056, 0.1));
          sidewalk = mix(sidewalk, vec3(0.12, 0.1, 0.15), inside(dStreet - uCity.y, 0.3)); // meio-fio
          col = mix(col, sidewalk, walk);
          col = mix(col, col * 0.5, aaLine(dStreet - uCity.z, 0.05)); // borda do lote
          // filete neon no meio-fio, na cor do bairro (contorna as esquinas)
          col += mix(accent, vec3(1.0), 0.25) * aaLine(dStreet - uCity.y - 0.32, 0.045) * 0.5;

          // ruas
          float onX = inside(sd.x, uCity.y);
          float onZ = inside(sd.y, uCity.y);
          if (onX + onZ > 0.0) {
            vec3 sX = street(vWorld.xz, sAcross.x, L.y, sAcross.y, L.y, avZ, 1.0);
            vec3 sZ = street(vWorld.xz, sAcross.y, L.x, sAcross.x, L.x, avX, -1.0);
            vec3 s = onX > onZ ? sX : sZ;
            if (onX > 0.5 && onZ > 0.5) s = asphalt(vWorld.xz); // miolo do cruzamento
            col = mix(col, s, max(onX, onZ));
          }

          // Avenida Norte-Sul (meridiano) e Bulevar Leste-Oeste (equador): linhas que dão a volta no planeta
          vec3 ns = road(L.x, L.y, vec3(0.0, 0.94, 1.0), vec3(1.0, 0.83, 0.1), onZ);
          vec3 ew = road(L.y, L.x, vec3(1.0, 0.16, 0.62), vec3(0.0, 0.94, 1.0), onX);
          vec3 pz = plaza(L, r);

          float halfR = uRoadW * 0.5;
          float fx = fwidth(L.x) + 0.01;
          float fy = fwidth(L.y) + 0.01;
          float inNS = 1.0 - smoothstep(halfR - fx, halfR + fx, abs(L.x));
          float inEW = 1.0 - smoothstep(halfR - fy, halfR + fy, abs(L.y));
          float inPlaza = 1.0 - smoothstep(uPlazaR - 0.05, uPlazaR + 0.05, r);

          col = mix(col, ew, inEW);
          col = mix(col, ns, inNS);
          col = mix(col, pz, inPlaza);

          // luz colorida derramada no chão (pedestais, fontes, postes de praça...)
          vec3 pools = vec3(0.0);
          for (int i = 0; i < ${MAX_LIGHT_POOLS}; i++) {
            vec2 d = vWorld.xz - uPools[i].xy;
            float rr = uPools[i].z;
            pools += uPoolColors[i] * (uPools[i].w * exp(-dot(d, d) / (rr * rr)));
          }
          col += pools * (0.6 + 0.4 * major);
          // luz dos postes derramada na pista e na calçada
          col += vec3(0.62, 0.97, 1.0) * lampPool(L.x, L.y) * 0.3;
          col += vec3(1.0, 0.65, 0.87) * lampPool(L.y, L.x) * 0.3;
          float sp = streetPool(sAcross.x, L.y) + streetPool(sAcross.y, L.x);
          col += vec3(1.0, 0.6, 0.48) * sp * 0.16 * (1.0 - inPlaza);

          // névoa rosada chegando no horizonte curvo
          col = mix(col, uHaze, smoothstep(40.0, 160.0, dist) * 0.85);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_SEGMENTS, GROUND_SEGMENTS);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -5;
    scene.add(this.mesh);

    // Camada transparente que só recebe sombras, por cima do chão (mesma malha, mesma curvatura)
    this.shadowMesh = new THREE.Mesh(
      geo,
      new THREE.ShadowMaterial({
        color: '#05000c',
        opacity: 0.7,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -2,
      }),
    );
    this.shadowMesh.receiveShadow = true;
    this.shadowMesh.frustumCulled = false;
    this.shadowMesh.renderOrder = -4;
    scene.add(this.shadowMesh);
  }

  /** Atualiza as poças de luz. `sources`: [{ x, z, radius, intensity, color }] */
  setLightPools(sources) {
    const pools = this.material.uniforms.uPools.value;
    const colors = this.material.uniforms.uPoolColors.value;
    for (let i = 0; i < MAX_LIGHT_POOLS; i++) {
      const src = sources[i];
      if (src) {
        pools[i].set(src.x, src.z, src.radius, src.intensity);
        colors[i].copy(src.color);
      } else pools[i].w = 0;
    }
  }

  update(dt, t, camera) {
    this.material.uniforms.uTime.value = t;
    // acompanha a câmera em passos do tamanho da célula da malha (sem "nadar")
    const step = GROUND_SIZE / GROUND_SEGMENTS;
    this.mesh.position.x = Math.round(camera.position.x / step) * step;
    this.mesh.position.z = Math.round(camera.position.z / step) * step;
    this.shadowMesh.position.copy(this.mesh.position);
  }
}
