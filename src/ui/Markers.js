import * as THREE from 'three';
import { bendDrop, wrapDelta } from '../core/Planet.js';

/**
 * Marcadores de HUD sobre os projetos.
 *
 * Quem sinaliza os projetos é o próprio mundo (feixe + emblema). O HUD fica limpo e só
 * aparece quando acrescenta algo:
 *  - ao mirar num emblema: um cartão ao lado do losango com nome, subtítulo e distância;
 *  - no pulso de radar (Q): cartões em todos os projetos na tela, e os não visitados fora
 *    da tela grudam na borda com uma seta apontando o caminho;
 *  - com uma rota marcada: o destino sempre visível (na tela ou na borda).
 * De perto o emblema some e o marcador vira um losango pequeno acima do holograma.
 */

const PIN_Y = 11.5; // acima do holograma (quando o emblema já sumiu)
const NEAR_HIDE = 20;
const NEAR_FULL = 30;
const AIM_RADIUS = 140; // px da mira para abrir o cartão
const EDGE_MARGIN = 56;
// geometria do emblema (ver emblemTexture): centro do losango e ponta direita, em fração do tamanho
const EM_DIAMOND_DY = 60 / 512;
const EM_DIAMOND_RX = 150 / 512;

const _v = new THREE.Vector3();
const _up = new THREE.Vector3();
const _h = new THREE.Vector3();

/** O segmento o → o + d (t de 0 a 1) atravessa a caixa [min, max]? (teste de "slabs") */
function segmentHitsBox(o, d, min, max) {
  let t0 = 0;
  let t1 = 1;
  for (const a of ['x', 'y', 'z']) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < min[a] || o[a] > max[a]) return false;
      continue;
    }
    let ta = (min[a] - o[a]) / d[a];
    let tb = (max[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta);
    t1 = Math.min(t1, tb);
    if (t0 > t1) return false;
  }
  return true;
}

export class Markers {
  /**
   * @param {HTMLElement} container
   * @param {Pedestal[]} pedestals
   * @param {{ x, z, w, d, h, y }[]} buildings  caixas dos prédios (para saber se o emblema está escondido)
   */
  constructor(container, pedestals, buildings = []) {
    this.root = container;
    this.buildings = buildings;
    this.items = pedestals.map((p) => {
      const it = p.item;
      const el = document.createElement('div');
      el.className = `wp ${it.kind === 'project' ? '' : 'wp-terminal'}`;
      el.style.setProperty('--c', it.color);
      const num = it.kind === 'project' ? String(it.index + 1).padStart(2, '0') : it.kind === 'about' ? 'i' : '@';
      el.innerHTML = `
        <span class="wp-arrow"></span>
        <span class="wp-pin"><i></i><b></b></span>
        <span class="wp-info"><strong></strong><small></small><em></em></span>
        <span class="wp-dist"></span>`;
      el.querySelector('.wp-pin b').textContent = num;
      el.querySelector('.wp-info strong').textContent = it.title;
      el.querySelector('.wp-info small').textContent = it.subtitle || '';
      container.appendChild(el);
      return {
        p,
        el,
        info: el.querySelector('.wp-info'),
        dist: el.querySelector('.wp-dist'),
        infoDist: el.querySelector('.wp-info em'),
        arrow: el.querySelector('.wp-arrow'),
        lastDist: -1,
        cls: '',
      };
    });
  }

  /** Algum prédio fica entre a câmera e o ponto (x, y, z)? Aproximação no mundo plano. */
  occluded(cam, x, y, z) {
    const o = cam;
    const d = { x: x - o.x, y: y - o.y, z: z - o.z };
    const minX = Math.min(o.x, x);
    const maxX = Math.max(o.x, x);
    const minZ = Math.min(o.z, z);
    const maxZ = Math.max(o.z, z);
    const bmin = { x: 0, y: 0, z: 0 };
    const bmax = { x: 0, y: 0, z: 0 };
    for (const b of this.buildings) {
      const bx = o.x + wrapDelta(b.x - o.x);
      const bz = o.z + wrapDelta(b.z - o.z);
      if (bx + b.w / 2 < minX || bx - b.w / 2 > maxX || bz + b.d / 2 < minZ || bz - b.d / 2 > maxZ) continue;
      bmin.x = bx - b.w / 2;
      bmax.x = bx + b.w / 2;
      bmin.z = bz - b.d / 2;
      bmax.z = bz + b.d / 2;
      bmin.y = b.y || 0;
      bmax.y = bmin.y + b.h;
      if (segmentHitsBox(o, d, bmin, bmax)) return true;
    }
    return false;
  }

  /** Projeta um ponto do mundo na tela, com a mesma curvatura do shader. */
  project(camera, x, y, z, W, H, out, bend = true) {
    _v.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    if (bend) {
      const h = _h.copy(_v).addScaledVector(_up, -_v.dot(_up)).length();
      _v.addScaledVector(_up, -bendDrop(h));
    }
    out.depth = -_v.z;
    out.behind = _v.z > -0.1;
    _v.applyMatrix4(camera.projectionMatrix);
    let nx = _v.x;
    let ny = _v.y;
    if (out.behind) {
      nx = -nx;
      ny = -ny;
    }
    out.sx = (nx * 0.5 + 0.5) * W;
    out.sy = (-ny * 0.5 + 0.5) * H;
    out.onScreen = !out.behind && Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
  }

  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {{ isFound: (item) => boolean, trackedId: string|null, scan: number }} state
   */
  update(camera, { isFound, trackedId, scan }) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    _up.set(0, 1, 0).transformDirection(camera.matrixWorldInverse);
    const pxPerUnit = (H / 2) * camera.projectionMatrix.elements[5]; // dividido pela profundidade
    const radar = scan > 0.02;

    // 1ª passada: projeção. Ancora no emblema enquanto ele está visível; de perto, acima do holograma.
    let aimed = null;
    let aimedD = AIM_RADIUS;
    for (const m of this.items) {
      const p = m.p;
      m.inworld = p.emblem.uniforms.uAlpha.value > 0.45;
      m.hidden = false;
      // o emblema é desenhado sem a curvatura do planeta; o pino acima do holograma, com ela
      this.project(camera, p.position.x, m.inworld ? p.emblem.mesh.position.y : PIN_Y, p.position.z, W, H, m, !m.inworld);
      m.emPx = m.inworld ? (p.emblem.uniforms.uSize.value * pxPerUnit) / Math.max(m.depth, 1) : 0;
      if (m.onScreen && p.dist > NEAR_HIDE) {
        // a "mira" acerta o centro do losango
        const d = Math.hypot(m.sx - W / 2, m.sy - EM_DIAMOND_DY * m.emPx - H / 2);
        if (d < aimedD) {
          aimedD = d;
          aimed = m;
        }
      }
    }

    // mirando um emblema escondido atrás de um prédio (sem radar/rota, não há raio-x):
    // o cartão ganha um losango pequeno, para não ficar flutuando no nada
    if (aimed && aimed.inworld && !radar && aimed.p.item.id !== trackedId) {
      aimed.hidden = this.occluded(camera.position, aimed.p.position.x, aimed.p.emblem.mesh.position.y, aimed.p.position.z);
    }

    // 2ª passada: posição final, visibilidade e quem quer mostrar o cartão
    for (const m of this.items) {
      const p = m.p;
      const tracked = p.item.id === trackedId;
      const found = isFound(p.item);
      const edge = !m.onScreen && (tracked || (radar && !found));
      let x = m.sx;
      let y = m.sy;
      let opacity = THREE.MathUtils.smoothstep(p.dist, NEAR_HIDE, NEAR_FULL);
      const flip = x > W - 320;
      const inworld = m.inworld && m.onScreen && !m.hidden;

      if (edge) {
        // gruda na borda (elipse), apontando para onde o projeto está
        const cx = W / 2;
        const cy = H / 2;
        let dx = x - cx;
        let dy = y - cy;
        if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
        const ang = Math.atan2(dy, dx);
        x = cx + Math.cos(ang) * (cx - EDGE_MARGIN);
        y = cy + Math.sin(ang) * (cy - EDGE_MARGIN);
        m.arrow.style.transform = `rotate(${ang}rad)`;
      } else if (!m.onScreen) {
        opacity = 0;
      } else if (inworld) {
        // cartão encostado na ponta do losango do emblema
        x += (flip ? -1 : 1) * (EM_DIAMOND_RX * m.emPx + 8);
        y -= EM_DIAMOND_DY * m.emPx;
      } else if (m.hidden) {
        y -= EM_DIAMOND_DY * m.emPx; // o pino fica onde estaria o losango
      }
      // HUD limpo: só aparece quando acrescenta informação
      if (!(tracked || radar || m === aimed)) opacity = 0;

      Object.assign(m, { x, y, opacity, edge, tracked, found, flip, inworldNow: inworld && !edge });
      m.wantsLabel = opacity > 0.05 && !edge;
      // prioridade: rota marcada > mira > mais perto
      m.prio = (tracked ? 0 : m === aimed ? 1 : 2) * 1e5 + p.dist;
    }

    // cartões não se atropelam: quem colide com um já aberto fica fechado
    const placed = [];
    const order = this.items.filter((m) => m.wantsLabel).sort((a, b) => a.prio - b.prio);
    for (const m of this.items) m.open = false;
    for (const m of order) {
      m.infoW ||= m.info.offsetWidth;
      const w = m.infoW || 220;
      const pad = m.inworldNow ? 0 : 22;
      const r = m.flip ? [m.x - pad - w, m.y - 26, m.x + 12, m.y + 30] : [m.x - 12, m.y - 26, m.x + pad + w, m.y + 30];
      if (placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1])) {
        // sem espaço para o cartão: no modo emblema ele some (o emblema já mostra o nome)
        if (m.inworldNow) m.opacity = 0;
        continue;
      }
      placed.push(r);
      m.open = true;
    }

    // 3ª passada: escreve no DOM
    for (const m of this.items) {
      const p = m.p;
      const cls = [
        m.found ? 'found' : '',
        m.open ? 'open' : '',
        m.edge ? 'edge' : '',
        m.tracked ? 'tracked' : '',
        m.inworldNow ? 'inworld' : '',
        radar ? 'radar' : '',
        m.flip ? 'flip' : '',
      ].join(' ');
      if (cls !== m.cls) {
        m.cls = cls;
        m.el.className = `wp ${p.item.kind === 'project' ? '' : 'wp-terminal'} ${cls}`;
      }
      m.el.style.opacity = m.opacity.toFixed(3);
      m.el.style.transform = `translate3d(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px, 0)`;
      m.el.style.zIndex = String(m.tracked ? 3 : m === aimed ? 2 : 1);

      const d = Math.round(p.dist);
      if (d !== m.lastDist) {
        m.lastDist = d;
        m.dist.textContent = `${d} m`;
        m.infoDist.textContent = `${d} m`;
      }
    }
  }
}
