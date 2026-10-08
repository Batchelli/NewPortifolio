import { DISTRICTS } from '../core/CityPlan.js';
import { Markers } from './Markers.js';
import { TabletOS } from './TabletOS.js';

const $ = (id) => document.getElementById(id);

const SETTINGS_KEY = 'portimax-settings';
const DEFAULT_SETTINGS = { quality: 'high', music: true, sfx: true, crt: true, sensitivity: 1 };

export class UI {
  constructor({ owner, projects, synth, handlers }) {
    this.owner = owner;
    this.projects = projects;
    this.synth = synth;
    this.h = handlers;
    this.settings = this.loadSettings();
    this.discovered = new Set();
    this.trackedId = null;
    this.minimap = $('minimap').getContext('2d');

    $('owner-line').textContent = `${owner.name.toUpperCase()} · ${owner.role.toUpperCase()}`;
    $('footer-year').textContent = `© ${new Date().getFullYear()} ${owner.name.toUpperCase()}`;

    // menus, projetos, sobre mim, ajustes... tudo roda no sistema do tablet
    this.os = new TabletOS({
      owner,
      projects,
      synth,
      settings: this.settings,
      handlers: { ...handlers, onSettings: () => this.saveSettings() },
    });
  }

  /* ---------------- Telas ---------------- */
  show(id, on = true) {
    $(id).classList.toggle('active', on);
  }

  setLoading(pct, text) {
    $('loading-fill').style.width = `${pct}%`;
    if (text) $('loading-text').textContent = text;
  }

  /** Some com o "pressione qualquer tecla" (o tablet assume o menu). */
  hidePressStart() {
    $('press-start').hidden = true;
  }

  loadSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      /* armazenamento indisponível: segue só na memória */
    }
    this.h.onSettings(this.settings);
  }

  /* ---------------- HUD ---------------- */
  setDiscovered(set) {
    this.discovered = set;
    this.os.setDiscovered(set);
    const total = this.projects.length;
    $('hud-count').textContent = `${set.size}/${total}`;
    $('hud-progress-fill').style.width = `${total ? (set.size / total) * 100 : 0}%`;
  }

  /** Marcadores de HUD sobre os pedestais (criados depois que o mundo existe). */
  initMarkers(pedestals, buildings) {
    this.markers = new Markers($('hud-markers'), pedestals, buildings);
  }

  updateMarkers(camera, state) {
    this.markers?.update(camera, state);
  }

  /** Rota marcada pelo painel de projetos (null = nenhuma). */
  setTracked(item) {
    this.trackedId = item ? item.id : null;
    this.os.setTracked(this.trackedId);
    const el = $('hud-route');
    el.classList.toggle('visible', !!item);
    if (item) {
      el.style.setProperty('--c', item.color);
      $('hud-route-name').textContent = item.title.toUpperCase();
    }
    this.routeDist = -1;
  }

  setRouteDistance(d) {
    const v = Math.round(d);
    if (v === this.routeDist) return;
    this.routeDist = v;
    $('hud-route-dist').textContent = `${v} m`;
  }

  setRadarBusy(busy) {
    if (busy === this.radarBusy) return;
    this.radarBusy = busy;
    $('hud-radar').classList.toggle('busy', busy);
  }

  setPrompt(visible, text) {
    $('interact-prompt').classList.toggle('visible', visible);
    if (text) $('interact-text').textContent = text;
  }

  fadeHints() {
    $('hud-hints').classList.add('faded');
  }

  toast(title, sub) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = title;
    if (sub) {
      const s = document.createElement('small');
      s.textContent = sub;
      t.appendChild(s);
    }
    $('toasts').appendChild(t);
    setTimeout(() => t.remove(), 3300);
  }

  /** Latitude/longitude do jogador no planeta (u, v = posição / tamanho do mundo, de -0.5 a 0.5). */
  setCoords(u, v) {
    this.coordsEl ??= document.getElementById('hud-coords');
    const lon = u * 360;
    const lat = -v * 360;
    const fmt = (a, pos, neg) => `${Math.abs(a).toFixed(1).padStart(5, '0')}°${a >= 0 ? pos : neg}`;
    const text = `LAT ${fmt(lat, 'N', 'S')}  LON ${fmt(lon, 'L', 'O')}`;
    if (text !== this.coordsText) {
      this.coordsText = text;
      this.coordsEl.textContent = text;
    }
  }

  /** Rua/avenida atual (embaixo das coordenadas), na cor do bairro. */
  setLocation(street, district) {
    this.locEl ??= document.getElementById('hud-location');
    this.os.setLocation(street);
    const color = district >= 0 ? DISTRICTS[district].color : '#ffd319';
    if (street !== this.locText || color !== this.locColor) {
      this.locText = street;
      this.locColor = color;
      this.locEl.textContent = street;
      this.locEl.style.setProperty('--c', color);
    }
  }

  /** Letreiro grande ao entrar num bairro. */
  showDistrict(index) {
    const d = DISTRICTS[index];
    const el = $('district-banner');
    el.style.setProperty('--c', d.color);
    el.querySelector('strong').textContent = d.name;
    el.querySelector('small').textContent = d.tagline;
    el.classList.remove('show');
    void el.offsetWidth; // reinicia a animação
    el.classList.add('show');
  }

  setClickToPlay(visible) {
    $('click-to-play').classList.toggle('visible', visible);
  }

  /** Minimapa circular que gira com o jogador (frente sempre para cima). */
  drawMinimap(world, player, yaw) {
    const ctx = this.minimap;
    const W = 200;
    const scale = 0.55;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(yaw);
    ctx.scale(scale, scale);
    ctx.translate(-player.x, -player.z);

    // planta da cidade (quarteirões, ruas, prédios), repetida nas cópias do mundo por perto
    const S = world.size;
    const R = 250;
    if (world.mapCanvas) {
      for (let kx = Math.floor((player.x - R) / S + 0.5); (kx - 0.5) * S <= player.x + R; kx++) {
        for (let kz = Math.floor((player.z - R) / S + 0.5); (kz - 0.5) * S <= player.z + R; kz++) {
          ctx.drawImage(world.mapCanvas, kx * S - S / 2, kz * S - S / 2, S, S);
        }
      }
    }

    // estradas infinitas: o meridiano (x = k·W) e o equador (z = k·W) em todas as cópias por perto
    const road = (x1, z1, x2, z2, color) => {
      ctx.strokeStyle = 'rgba(40, 10, 70, 0.95)';
      ctx.lineWidth = 12;
      ctx.beginPath();
      ctx.moveTo(x1, z1);
      ctx.lineTo(x2, z2);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2 / scale;
      ctx.stroke();
    };
    for (let k = Math.ceil((player.x - R) / S); k * S <= player.x + R; k++) road(k * S, player.z - R, k * S, player.z + R, '#00f0ff');
    for (let k = Math.ceil((player.z - R) / S); k * S <= player.z + R; k++) road(player.x - R, k * S, player.x + R, k * S, '#ff2a9d');
    const px = Math.round(player.x / S) * S;
    const pz = Math.round(player.z / S) * S;
    ctx.fillStyle = 'rgba(40, 10, 70, 1)';
    ctx.strokeStyle = '#00f0ff';
    ctx.lineWidth = 2 / scale;
    ctx.beginPath();
    ctx.arc(px, pz, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // pedestais
    const pulse = (performance.now() / 1000) % 1.4;
    for (const p of world.pedestals) {
      const found = p.item.kind !== 'project' || this.discovered.has(p.item.id);
      if (p.item.id === this.trackedId) {
        ctx.strokeStyle = p.item.color;
        ctx.lineWidth = 2 / scale;
        ctx.globalAlpha = 1 - pulse / 1.4;
        ctx.beginPath();
        ctx.arc(p.position.x, p.position.z, 8 + pulse * 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = p.item.color;
      ctx.shadowColor = p.item.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.position.x, p.position.z, found ? 5 : 6.5, 0, Math.PI * 2);
      ctx.fill();
      if (!found) {
        ctx.shadowBlur = 0;
        ctx.save();
        ctx.translate(p.position.x, p.position.z);
        ctx.rotate(-yaw);
        ctx.fillStyle = '#0a0014';
        ctx.font = `bold ${10 / scale}px monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('?', 0, 1);
        ctx.restore();
      }
    }
    ctx.restore();

    // projetos fora do alcance do mapa: setinha na borda, na direção deles
    const RIM = 86;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    for (const p of world.pedestals) {
      const tracked = p.item.id === this.trackedId;
      if (!tracked && (p.item.kind !== 'project' || this.discovered.has(p.item.id))) continue;
      const dx = (p.position.x - player.x) * scale;
      const dz = (p.position.z - player.z) * scale;
      const rx = cos * dx - sin * dz;
      const ry = sin * dx + cos * dz;
      const len = Math.hypot(rx, ry);
      if (len < RIM) continue;
      const a = Math.atan2(ry, rx);
      ctx.save();
      ctx.translate(W / 2 + (rx / len) * RIM, W / 2 + (ry / len) * RIM);
      ctx.rotate(a);
      ctx.fillStyle = p.item.color;
      ctx.shadowColor = p.item.color;
      ctx.shadowBlur = 8;
      const s = tracked ? 1.4 : 1;
      ctx.beginPath();
      ctx.moveTo(6 * s, 0);
      ctx.lineTo(-4 * s, -5 * s);
      ctx.lineTo(-4 * s, 5 * s);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.shadowBlur = 0;

    // jogador
    ctx.shadowColor = '#ffd319';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#ffd319';
    ctx.beginPath();
    ctx.moveTo(W / 2, W / 2 - 9);
    ctx.lineTo(W / 2 + 6, W / 2 + 6);
    ctx.lineTo(W / 2, W / 2 + 3);
    ctx.lineTo(W / 2 - 6, W / 2 + 6);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    this.nLabel ??= document.querySelector('.minimap-n');
    this.nLabel.style.left = `${50 + Math.sin(yaw) * 40}%`;
    this.nLabel.style.top = `${50 - Math.cos(yaw) * 40}%`;
  }
}
