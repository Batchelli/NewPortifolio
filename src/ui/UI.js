import { DISTRICTS } from '../core/CityPlan.js';
import { Markers } from './Markers.js';

const $ = (id) => document.getElementById(id);

const SETTINGS_KEY = 'portimax-settings';
const DEFAULT_SETTINGS = { quality: 'high', music: true, sfx: true, crt: true, sensitivity: 1 };

/** Menu navegável por teclado (↑ ↓ ENTER) e mouse, no estilo arcade. */
class Menu {
  constructor(nav, onAction, synth) {
    this.nav = nav;
    this.items = [...nav.querySelectorAll('button')];
    this.index = 0;
    this.synth = synth;
    this.items.forEach((btn, i) => {
      btn.addEventListener('mouseenter', () => this.select(i));
      btn.addEventListener('click', () => {
        this.select(i, true);
        synth.select();
        onAction(btn.dataset.action);
      });
    });
    this.onAction = onAction;
    this.select(0, true);
  }

  select(i, silent = false) {
    if (i === this.index && !silent) return;
    this.index = (i + this.items.length) % this.items.length;
    this.items.forEach((b, k) => b.classList.toggle('selected', k === this.index));
    if (!silent) this.synth.blip();
  }

  handleKey(e) {
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this.select(this.index + 1);
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') this.select(this.index - 1);
    else if (e.code === 'Enter' || e.code === 'Space') {
      this.synth.select();
      this.onAction(this.items[this.index].dataset.action);
    } else return false;
    e.preventDefault();
    return true;
  }
}

export class UI {
  constructor({ owner, projects, synth, handlers }) {
    this.owner = owner;
    this.projects = projects;
    this.synth = synth;
    this.h = handlers;
    this.modalStack = [];
    this.activeMenu = null;
    this.settings = this.loadSettings();
    this.discovered = new Set();
    this.trackedId = null;
    this.minimap = $('minimap').getContext('2d');

    $('owner-line').textContent = `${owner.name.toUpperCase()} · ${owner.role.toUpperCase()}`;
    $('footer-year').textContent = `© ${new Date().getFullYear()} ${owner.name.toUpperCase()}`;

    this.mainMenu = new Menu($('main-menu'), (a) => this.h.onMenuAction(a), synth);
    this.pauseMenu = new Menu($('pause-menu'), (a) => this.h.onPauseAction(a), synth);

    document.querySelectorAll('[data-back]').forEach((b) =>
      b.addEventListener('click', () => {
        synth.back();
        this.closeModal();
      }),
    );
    // clicar fora do painel fecha o modal
    document.querySelectorAll('.modal').forEach((m) =>
      m.addEventListener('click', (e) => {
        if (e.target === m) this.closeModal();
      }),
    );

    this.renderAbout();
    this.renderSettings();
  }

  /* ---------------- Telas ---------------- */
  show(id, on = true) {
    $(id).classList.toggle('active', on);
  }

  setLoading(pct, text) {
    $('loading-fill').style.width = `${pct}%`;
    if (text) $('loading-text').textContent = text;
  }

  revealMainMenu() {
    $('press-start').hidden = true;
    const nav = $('main-menu');
    nav.hidden = false;
    nav.classList.add('reveal');
    this.activeMenu = this.mainMenu;
  }

  openModal(id) {
    if (id === 'panel-projects') this.renderProjects();
    this.modalStack.push(id);
    this.show(id, true);
  }

  closeModal() {
    const id = this.modalStack.pop();
    if (id) this.show(id, false);
    this.h.onModalClosed?.(id);
  }

  closeAllModals() {
    while (this.modalStack.length) this.show(this.modalStack.pop(), false);
  }

  get modalOpen() {
    return this.modalStack.length > 0;
  }

  handleMenuKey(e) {
    if (this.modalOpen) {
      if (e.code === 'Escape' || e.code === 'Backspace') {
        e.preventDefault();
        this.synth.back();
        this.closeModal();
        return true;
      }
      return false;
    }
    return this.activeMenu ? this.activeMenu.handleKey(e) : false;
  }

  /* ---------------- Conteúdo dos painéis ---------------- */
  renderProjects() {
    const grid = $('project-grid');
    grid.innerHTML = '';
    for (const p of this.projects) {
      const found = this.discovered.has(p.id);
      const tracked = this.trackedId === p.id;
      const card = document.createElement('article');
      card.className = 'project-card';
      card.style.setProperty('--c', p.color);
      card.innerHTML = `
        <img alt="" loading="lazy" />
        <span class="status ${found ? 'found' : ''}">${found ? '✔ DESCOBERTO' : '? NÃO VISITADO'}</span>
        <h3></h3>
        <p></p>
        <div class="card-actions">
          <button type="button" data-track class="${tracked ? 'on' : ''}">${tracked ? '◉ RASTREANDO' : '◎ MARCAR ROTA'}</button>
          <button type="button" data-travel>▶ IR ATÉ</button>
          ${p.url ? '<a target="_blank" rel="noopener">ABRIR SITE ↗</a>' : ''}
        </div>`;
      card.querySelector('img').src = p.thumb || '';
      card.querySelector('h3').textContent = p.title;
      card.querySelector('p').textContent = p.subtitle;
      const link = card.querySelector('a');
      if (link) link.href = p.url;
      card.querySelector('[data-travel]').addEventListener('click', () => {
        this.synth.select();
        this.h.onTravel(p.id);
      });
      card.querySelector('[data-track]').addEventListener('click', () => {
        this.synth.select();
        this.h.onTrack(tracked ? null : p.id);
      });
      grid.appendChild(card);
    }
  }

  renderAbout() {
    const o = this.owner;
    const el = $('about-content');
    el.innerHTML = '';
    const h = document.createElement('h3');
    h.className = 'orbitron';
    h.style.cssText = 'margin:0 0 4px;font-size:22px;color:#fff';
    h.textContent = o.name;
    const role = document.createElement('p');
    role.style.cssText = 'color:var(--pink);margin:0 0 16px';
    role.textContent = o.role;
    el.append(h, role);
    for (const para of o.about) {
      const p = document.createElement('p');
      p.textContent = para;
      el.appendChild(p);
    }
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const s of o.skills) {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = s;
      chips.appendChild(c);
    }
    const links = document.createElement('div');
    links.className = 'links';
    for (const l of o.links) {
      const a = document.createElement('a');
      a.href = l.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = `${l.label} ↗`;
      links.appendChild(a);
    }
    el.append(chips, links);
  }

  renderSettings() {
    const s = this.settings;
    const el = $('settings');
    el.innerHTML = '';
    const row = (label, control) => {
      const r = document.createElement('div');
      r.className = 'setting-row';
      const l = document.createElement('span');
      l.textContent = label;
      r.append(l, control);
      el.appendChild(r);
    };
    const toggle = (key, labels) => {
      const b = document.createElement('button');
      const sync = () => (b.textContent = labels[s[key] === true || s[key] === 'high' ? 0 : 1]);
      sync();
      b.addEventListener('click', () => {
        s[key] = typeof s[key] === 'boolean' ? !s[key] : s[key] === 'high' ? 'low' : 'high';
        sync();
        this.synth.blip();
        this.saveSettings();
      });
      return b;
    };
    row('Qualidade gráfica', toggle('quality', ['ALTA', 'BAIXA']));
    row('Música', toggle('music', ['LIGADA', 'DESLIGADA']));
    row('Efeitos sonoros', toggle('sfx', ['LIGADOS', 'DESLIGADOS']));
    row('Efeito CRT', toggle('crt', ['LIGADO', 'DESLIGADO']));
    const range = document.createElement('input');
    range.type = 'range';
    range.min = '0.3';
    range.max = '2.5';
    range.step = '0.1';
    range.value = String(s.sensitivity);
    range.addEventListener('input', () => {
      s.sensitivity = parseFloat(range.value);
      this.saveSettings();
    });
    row('Sensibilidade do mouse', range);
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
