import * as THREE from 'three';
import { PROJECTS } from '../config.js';

/**
 * ============================================================
 *  O "PLANETA": mundo sem bordas
 * ============================================================
 * Duas técnicas trabalham juntas:
 *
 * 1) Mundo toroidal (world wrapping, como em Manifold Garden / Defender)
 *    O mapa é um quadrado de WORLD_SIZE que se repete nas duas direções.
 *    Quem cruza uma borda reaparece do lado oposto. Para não haver
 *    "teleporte" visível, cada objeto é sempre desenhado na sua cópia
 *    mais próxima do jogador (nearest image).
 *
 * 2) Curvatura de horizonte (o "rolling log" de Animal Crossing)
 *    Um vertex shader global abaixa cada vértice conforme a distância
 *    horizontal até a câmera (parábola). O chão "cai" no horizonte
 *    como num pequeno planeta, e a costura do mundo fica sempre
 *    escondida atrás da curvatura.
 */

export const ROAD_WIDTH = 12;
export const PLAZA_RADIUS = 20;
export const FIRST_SLOT = PLAZA_RADIUS + 24; // distância do 1º pedestal até a praça
export const SLOT_SPACING = 30; // distância entre pedestais ao longo da estrada

// O planeta cresce sozinho se houver muitos projetos (4 braços de estrada; +1 terminal em 2 deles).
// Sempre múltiplo de 120: a malha de ruas (quarteirões de 60) fecha certinho ao dar a volta no mundo
// e o ponto oposto à praça cai no meio de um quarteirão (nunca em cima de uma rua).
const itemsPerArm = Math.ceil(PROJECTS.length / 4) + 1;
const neededHalf = FIRST_SLOT + (itemsPerArm - 1) * SLOT_SPACING + 90;
export const WORLD_SIZE = Math.max(480, Math.ceil((neededHalf * 2) / 120) * 120);
export const HALF_WORLD = WORLD_SIZE / 2;

/** Intensidade da curvatura (queda = CURVATURE * distância²). */
export const CURVATURE = 0.0003;
/** Perto da costura, os objetos "afundam" de vez, para nunca se ver um objeto trocar de lado. */
const SINK_START = HALF_WORLD - 75;
const SINK_END = HALF_WORLD - 12;
const SINK_DEPTH = 45;

/** Menor diferença entre duas coordenadas num mundo que se repete. */
export function wrapDelta(d) {
  return d - WORLD_SIZE * Math.round(d / WORLD_SIZE);
}

/** Coordenada equivalente dentro do quadrado central [-HALF, HALF]. */
export const wrapCoord = wrapDelta;

/** Cópia de `home` (x, z) mais próxima da referência `ref`. */
export function nearestImage(homeX, homeZ, ref, out) {
  out.x = ref.x + wrapDelta(homeX - ref.x);
  out.z = ref.z + wrapDelta(homeZ - ref.z);
  return out;
}

/** Queda vertical da curvatura a uma distância horizontal `d` da câmera (igual ao shader). */
export function bendDrop(d) {
  const s = Math.min(Math.max((d - SINK_START) / (SINK_END - SINK_START), 0), 1);
  return CURVATURE * d * d + s * s * (3 - 2 * s) * SINK_DEPTH;
}

const f = (n) => n.toFixed(6);

const DROP = /* glsl */ `${f(CURVATURE)} * bD * bD + smoothstep(${f(SINK_START)}, ${f(SINK_END)}, bD) * ${f(SINK_DEPTH)}`;

/** Função GLSL para os shaders customizados: aplica a curvatura em view space. */
const BEND_PARS = /* glsl */ `
vec4 bendView(vec4 mv) {
  vec3 bUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
  vec3 bH = mv.xyz - bUp * dot(mv.xyz, bUp);
  float bD = length(bH);
  mv.xyz -= bUp * (${DROP});
  return mv;
}
`;

let installed = false;

/**
 * Registra o chunk <bend_pars> e injeta a curvatura em TODOS os materiais
 * nativos do Three (MeshBasic, MeshStandard, Points...) via project_vertex.
 * Precisa rodar antes de qualquer material ser compilado.
 */
export function installPlanetShaders() {
  if (installed) return;
  installed = true;
  THREE.ShaderChunk.bend_pars = BEND_PARS;
  THREE.ShaderChunk.project_vertex = THREE.ShaderChunk.project_vertex.replace(
    'mvPosition = modelViewMatrix * mvPosition;',
    // Na passada de sombra (DEPTH_PACKING) a "câmera" é a luz: ali o mundo fica plano.
    // As sombras são calculadas no mundo plano e só a imagem final é curvada.
    /* glsl */ `mvPosition = modelViewMatrix * mvPosition;
    #ifndef DEPTH_PACKING
    {
      vec3 bUp = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
      vec3 bH = mvPosition.xyz - bUp * dot(mvPosition.xyz, bUp);
      float bD = length(bH);
      mvPosition.xyz -= bUp * (${DROP});
    }
    #endif`,
  );
}

/**
 * Ângulo (rad) em que o horizonte curvo fica abaixo da linha dos olhos.
 * Usado para "assentar" o cenário de fundo (montanhas, cidade) no horizonte.
 */
export function horizonDip(eyeHeight = 1.7) {
  return 2 * Math.sqrt(eyeHeight * CURVATURE);
}
