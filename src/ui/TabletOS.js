import { DISTRICTS } from '../core/CityPlan.js';

/**
 * ============================================================
 *  NEON OS: o sistema que roda na tela do tablet
 * ============================================================
 * HTML de verdade (projetado no vidro pelo Tablet/CSS3DRenderer), com:
 *  - boot em CRT, home com apps e um card principal (JOGAR / CONTINUAR);
 *  - apps que abrem "crescendo" a partir do ícone e voltam para ele;
 *  - navegação espacial por teclado (setas/WASD, ENTER, ESC) e por mouse/toque;
 *  - micro-animações: entrada em cascata, texto que se "decifra", varredura de luz.
 */

const ICONS = {
  projects:
    '<svg viewBox="0 0 48 48"><path d="M24 4 44 24 24 44 4 24Z"/><path d="M24 14 34 24 24 34 14 24Z"/><circle cx="24" cy="24" r="2.5" class="fill"/></svg>',
  map: '<svg viewBox="0 0 48 48"><path d="M6 12 18 7l12 5 12-5v29l-12 5-12-5-12 5Z"/><path d="M18 7v29M30 12v29"/><circle cx="34" cy="20" r="3.5" class="fill"/></svg>',
  about:
    '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="19"/><circle cx="24" cy="19" r="7"/><path d="M11 37c3-6 8-9 13-9s10 3 13 9"/></svg>',
  contact:
    '<svg viewBox="0 0 48 48"><path d="M7 10h34v22H22l-9 7v-7H7Z"/><path d="M14 18h20M14 24h13"/></svg>',
  controls:
    '<svg viewBox="0 0 48 48"><path d="M14 15h20c6 0 9 5 10 12s-1 11-5 11-6-6-10-6h-10c-4 0-6 6-10 6s-6-4-5-11 4-12 10-12Z"/><path d="M15 21v8M11 25h8"/><circle cx="32" cy="23" r="1.8" class="fill"/><circle cx="36" cy="27" r="1.8" class="fill"/></svg>',
  settings:
    '<svg viewBox="0 0 48 48"><path d="M8 14h32M8 24h32M8 34h32"/><circle cx="17" cy="14" r="4" class="fill"/><circle cx="31" cy="24" r="4" class="fill"/><circle cx="21" cy="34" r="4" class="fill"/></svg>',
  play: '<svg viewBox="0 0 48 48"><path d="M16 10 38 24 16 38Z" class="fill"/></svg>',
  home: '<svg viewBox="0 0 48 48"><path d="M8 22 24 8l16 14"/><path d="M13 19v21h22V19"/></svg>',
  back: '<svg viewBox="0 0 48 48"><path d="M28 10 14 24l14 14"/></svg>',
  route: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="16"/><circle cx="24" cy="24" r="6" class="fill"/></svg>',
  travel: '<svg viewBox="0 0 48 48"><path d="M8 24h26M24 12l12 12-12 12"/></svg>',
  link: '<svg viewBox="0 0 48 48"><path d="M20 8H8v32h32V28"/><path d="M28 8h12v12M40 8 22 26"/></svg>',
  copy: '<svg viewBox="0 0 48 48"><rect x="15" y="15" width="24" height="26" rx="3"/><path d="M9 33V9h22"/></svg>',
  github:
    '<svg viewBox="0 0 48 48"><path d="M24 5a19 19 0 0 0-6 37c1 0 1-1 1-2v-4c-5 1-6-2-7-4-1-1-2-2 0-2s3 2 3 2c2 3 5 2 6 1 0-1 1-2 1-3-4 0-9-2-9-9 0-2 1-4 2-5 0-1-1-3 0-5 0 0 2 0 5 2a16 16 0 0 1 8 0c3-2 5-2 5-2 1 2 0 4 0 5 1 1 2 3 2 5 0 7-5 9-9 9 1 1 1 2 1 4v6c0 1 0 2 1 2A19 19 0 0 0 24 5Z"/></svg>',
  linkedin:
    '<svg viewBox="0 0 48 48"><rect x="6" y="6" width="36" height="36" rx="5"/><path d="M15 21v13M15 14v1M22 34V21M22 27c0-4 2-6 5-6s5 2 5 6v7"/></svg>',
  mail: '<svg viewBox="0 0 48 48"><rect x="6" y="11" width="36" height="26" rx="3"/><path d="m7 13 17 13 17-13"/></svg>',
};

const APPS = [
  { id: 'projects', title: 'PROJETOS', color: '#00f0ff' },
  { id: 'map', title: 'MAPA', color: '#39ff88' },
  { id: 'about', title: 'SOBRE MIM', color: '#ff2a9d' },
  { id: 'contact', title: 'CONTATO', color: '#ffd319' },
  { id: 'controls', title: 'CONTROLES', color: '#b26bff' },
  { id: 'settings', title: 'AJUSTES', color: '#ff7a3d' },
];

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const linkIcon = (l) => (/github/i.test(l.url) ? 'github' : /linkedin/i.test(l.url) ? 'linkedin' : /^mailto:/i.test(l.url) ? 'mail' : 'link');

/** Texto que se "decifra" letra a letra (efeito hacker), em ~0,5 s. */
function scramble(node, text, duration = 520) {
  const glyphs = '!<>-_\\/[]{}=+*^?#01ABCDEFX';
  const start = performance.now();
  node.__scr = start;
  const tick = (now) => {
    if (node.__scr !== start) return;
    const p = Math.min((now - start) / duration, 1);
    const shown = Math.floor(p * text.length);
    let out = text.slice(0, shown);
    for (let i = shown; i < text.length; i++) out += text[i] === ' ' ? ' ' : glyphs[(Math.random() * glyphs.length) | 0];
    node.textContent = out;
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Posição de layout (sem as transformações 3D) relativa à raiz da tela. */
function layoutRect(node, root) {
  let x = 0;
  let y = 0;
  let n = node;
  while (n && n !== root) {
    x += n.offsetLeft;
    y += n.offsetTop;
    n = n.offsetParent;
  }
  return { x, y, w: node.offsetWidth, h: node.offsetHeight, cx: x + node.offsetWidth / 2, cy: y + node.offsetHeight / 2 };
}

export class TabletOS {
  /**
   * @param {object} o
   * @param {{ name, role, about: string[], skills: string[], links: {label,url}[] }} o.owner
   * @param {object[]} o.projects
   * @param {import('../audio/Synth.js').Synth} o.synth
   * @param {object} o.handlers  onPlay, onResume, onQuit, onTravel(id), onTrack(id), onSettings(s), getMap(), getStats(), onAccent(hex), onBump()
   */
  constructor({ owner, projects, synth, handlers, settings }) {
    this.owner = owner;
    this.projects = projects;
    this.synth = synth;
    this.h = handlers;
    this.settings = settings;
    this.discovered = new Set();
    this.trackedId = null;
    this.mode = 'menu';
    this.app = null;
    this.focusEl = null;
    this.projectIndex = 0;
    this.mapSel = null;

    this.el = el('div', 'tos off');
    this.el.id = 'tablet-screen';
    // o transform da raiz é do CSS3DRenderer; as animações de liga/desliga ficam no .tos-scr
    this.el.innerHTML = `<div class="tos-scr">
      <div class="tos-wall"><div class="tos-sun"></div><div class="tos-grid"></div></div>
      <header class="tos-bar">
        <div class="tos-bar-l"><span class="tos-brand">NEON<b>OS</b></span><span class="tos-crumb"></span></div>
        <div class="tos-bar-c"><span class="tos-loc"></span></div>
        <div class="tos-bar-r"><span class="tos-sig"><i></i><i></i><i></i><i></i></span><span class="tos-clock"></span><span class="tos-bat"><i></i></span></div>
      </header>
      <main class="tos-stage">
        <section class="tos-home"></section>
        <section class="tos-app"><div class="tos-app-head"></div><div class="tos-app-body"></div></section>
      </main>
      <footer class="tos-hints"></footer>
      <div class="tos-notes"></div>
      <div class="tos-boot"><div class="tos-boot-line"></div><div class="tos-boot-logo"><span>NEON<b>OS</b></span><small>PORTIMAX NX-84 · v8.4</small><div class="tos-boot-bar"><i></i></div></div></div>
      <div class="tos-fx"><div class="tos-glare"></div></div></div>`;
    this.q = (s) => this.el.querySelector(s);
    this.home = this.q('.tos-home');
    this.appEl = this.q('.tos-app');
    this.appHead = this.q('.tos-app-head');
    this.appBody = this.q('.tos-app-body');

    // mouse: o foco segue o cursor (com um "tick" de áudio); clique ativa
    this.el.addEventListener('pointerover', (e) => {
      if (!this.ready) return;
      const t = e.target.closest('[data-nav]');
      if (t && this.el.contains(t) && t !== this.focusEl) {
        this.setFocus(t, true);
        if (e.pointerType !== 'touch') this.synth.hover();
      }
    });
    // o clique não deixa foco "nativo" no botão (senão ENTER/ESPAÇO o ativariam de novo)
    this.el.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) e.preventDefault();
    });
    this.el.addEventListener('click', (e) => {
      if (!this.ready) {
        e.preventDefault();
        return;
      }
      const t = e.target.closest('[data-nav]');
      if (t && !t.matches('a')) {
        e.preventDefault();
        this.activate(t);
      } else if (t) this.activate(t, true);
    });
    this.updateClock();
    setInterval(() => this.updateClock(), 15000);
  }

  /* ================================================================ */
  /*  Ciclo de vida: boot / desligar                                   */
  /* ================================================================ */
  /** Prepara o conteúdo com a tela ainda apagada (o tablet está subindo). */
  prepare(mode, app = null) {
    clearTimeout(this._bootT);
    clearTimeout(this._rebootT);
    this.mode = mode;
    this.powered = true;
    this.waitingBoot = true;
    this.focusEl?.classList.remove('focus');
    this.focusEl = null;
    this.el.classList.remove('booted', 'boot', 'shutdown', 'in-app', 'glitch', 'closing-app');
    this.el.classList.add('off');
    this.app = null;
    this.renderHome();
    if (app) this.openApp(app, { instant: true });
    else this.setAccent('#00f0ff');
  }

  /** Liga a tela: linha de CRT, logo, e o conteúdo entra em cascata. */
  boot() {
    this.waitingBoot = false;
    this.el.classList.remove('off', 'shutdown');
    this.el.classList.add('boot');
    clearTimeout(this._bootT);
    this._bootT = setTimeout(() => {
      this.el.classList.remove('boot');
      this.el.classList.add('booted');
      this.focusFirst();
      if (this.app) this.animateApp();
      else this.animateHome();
    }, 1150);
  }

  /** Desliga a tela (colapsa numa linha e num ponto, como um CRT). */
  powerOff() {
    clearTimeout(this._bootT);
    clearTimeout(this._rebootT);
    this.powered = false;
    this.waitingBoot = false;
    this._typeToken = null;
    this.el.classList.remove('boot', 'glitch');
    this.el.classList.add('shutdown');
    this.mapRunning = false;
  }

  /** Tela ligada e pronta para receber toques / teclas. */
  get ready() {
    return this.powered && this.el.classList.contains('booted') && !this.el.classList.contains('glitch');
  }

  /** Reinicia em outro modo sem guardar o tablet (ex.: voltar ao menu principal). */
  reboot(mode) {
    clearTimeout(this._rebootT);
    this.el.classList.add('glitch');
    this._rebootT = setTimeout(() => {
      this.el.classList.remove('glitch');
      this.prepare(mode);
      this.boot();
    }, 260);
  }

  /* ================================================================ */
  /*  Home                                                             */
  /* ================================================================ */
  renderHome() {
    const game = this.mode === 'game';
    const stats = this.h.getStats();
    const total = this.projects.length;
    const pct = total ? stats.discovered / total : 0;
    const R = 46;
    const C = 2 * Math.PI * R;
    this.home.innerHTML = `
      <div class="tos-hero" style="--i:0">
        <div class="tos-hero-top">
          <span class="tos-kicker">${game ? 'SESSÃO PAUSADA' : 'BEM-VINDO AO MEU MUNDO'}</span>
          <h1 class="tos-chrome">PORTIMAX</h1>
          <p class="tos-owner"><b>${esc(this.owner.name)}</b><span>${esc(this.owner.role)}</span></p>
        </div>
        <div class="tos-progress">
          <svg viewBox="0 0 110 110"><circle cx="55" cy="55" r="${R}" class="trk"/><circle cx="55" cy="55" r="${R}" class="val" style="stroke-dasharray:${C};--off:${C * (1 - pct)}"/></svg>
          <div><strong>${stats.discovered}<small>/${total}</small></strong><span>PROJETOS<br/>DESCOBERTOS</span></div>
        </div>
        <button class="tos-primary" data-nav data-act="${game ? 'resume' : 'play'}">
          <span class="ic">${ICONS.play}</span>
          <span class="tx"><b>${game ? 'CONTINUAR' : 'JOGAR'}</b><small>${game ? 'voltar para a cidade' : 'explorar a cidade neon'}</small></span>
          <span class="kbd">ENTER</span>
        </button>
        ${game ? `<button class="tos-secondary" data-nav data-act="quit"><span class="ic">${ICONS.home}</span>MENU PRINCIPAL</button>` : ''}
      </div>
      <div class="tos-apps">
        ${APPS.map(
          (a, i) => `
          <button class="tos-tile" data-nav data-app="${a.id}" style="--c:${a.color};--i:${i + 1}">
            <span class="tile-glow"></span>
            <span class="ic">${ICONS[a.id]}</span>
            <span class="tile-t">${a.title}</span>
            <span class="tile-s">${this.tileSubtitle(a.id, stats)}</span>
          </button>`,
        ).join('')}
      </div>`;
    this.setCrumb('INÍCIO');
    this.setHints([['↑↓←→', 'navegar'], ['ENTER', 'abrir'], game ? ['ESC', 'continuar'] : null]);
  }

  tileSubtitle(id, stats) {
    const n = this.projects.length;
    if (id === 'projects') return `${stats.discovered}/${n} descobertos`;
    if (id === 'map') return this.trackedId ? 'rota ativa' : 'viagem rápida';
    if (id === 'about') return 'quem fez este mundo';
    if (id === 'contact') return 'vamos conversar?';
    if (id === 'controls') return 'teclado e toque';
    return 'som, vídeo e mouse';
  }

  animateHome() {
    this.home.classList.remove('enter');
    void this.home.offsetWidth;
    this.home.classList.add('enter');
  }

  /* ================================================================ */
  /*  Apps                                                             */
  /* ================================================================ */
  openApp(id, { instant = false, from = null } = {}) {
    const app = APPS.find((a) => a.id === id);
    if (!app) return;
    this.app = id;
    this.setAccent(app.color);
    this.el.style.setProperty('--app', app.color);
    this.appHead.innerHTML = `
      <button class="tos-back" data-nav data-act="back"><span class="ic">${ICONS.back}</span></button>
      <span class="ic head-ic" style="--c:${app.color}">${ICONS[id]}</span>
      <h2 class="tos-app-title"></h2>
      <span class="tos-app-sub"></span>`;
    this.appBody.innerHTML = '';
    this.appBody.className = `tos-app-body app-${id}`;
    this.mapRunning = false;
    this[`render_${id}`]();
    this.setCrumb(app.title);

    // "cresce" a partir do ícone (ou do centro)
    const tile = from || this.home.querySelector(`[data-app="${id}"]`);
    if (tile && !instant) {
      const r = layoutRect(tile, this.el);
      const s = layoutRect(this.appEl, this.el);
      this.appEl.style.setProperty('--ox', `${r.x - s.x}px`);
      this.appEl.style.setProperty('--oy', `${r.y - s.y}px`);
      this.appEl.style.setProperty('--ow', `${s.w - (r.x - s.x) - r.w}px`);
      this.appEl.style.setProperty('--oh', `${s.h - (r.y - s.y) - r.h}px`);
    } else {
      this.appEl.style.setProperty('--ox', '45%');
      this.appEl.style.setProperty('--oy', '45%');
      this.appEl.style.setProperty('--ow', '45%');
      this.appEl.style.setProperty('--oh', '45%');
    }
    this.el.classList.remove('closing-app');
    void this.appEl.offsetWidth; // o recorte parte do ícone recém-medido
    this.el.classList.add('in-app');
    if (!instant) {
      this.animateApp();
      this.focusFirst();
    }
    scramble(this.q('.tos-app-title'), app.title);
  }

  animateApp() {
    this.appEl.classList.remove('enter');
    void this.appEl.offsetWidth;
    this.appEl.classList.add('enter');
  }

  closeApp() {
    if (!this.app) return false;
    const id = this.app;
    this.app = null;
    this.mapRunning = false;
    this.el.classList.add('closing-app');
    this.el.classList.remove('in-app');
    this.setAccent('#00f0ff');
    this.setCrumb('INÍCIO');
    // atualiza contadores da home (rota marcada, descobertas)
    this.renderHome();
    this.animateHome();
    const tile = this.home.querySelector(`[data-app="${id}"]`);
    this.setFocus(tile || this.home.querySelector('[data-nav]'));
    return true;
  }

  setAccent(hex) {
    this.accent = hex;
    this.el.style.setProperty('--accent', hex);
    this.h.onAccent?.(hex);
  }

  setCrumb(text) {
    this.q('.tos-crumb').textContent = text;
  }

  setHints(list) {
    list = list.filter(Boolean);
    // no jogo o ESC guarda o tablet; dentro dos apps, voltar fica no ⌫
    if (this.mode === 'game') {
      list = list.map(([k, t]) => (k === 'ESC' && t === 'voltar' ? ['⌫', 'voltar'] : [k, t]));
      if (!list.some(([k]) => k === 'ESC')) list.push(['ESC', 'guardar tablet']);
    }
    this.q('.tos-hints').innerHTML = list
      .map(([k, t]) => `<span><kbd>${k}</kbd>${t}</span>`)
      .join('');
  }

  setAppSub(text) {
    const s = this.q('.tos-app-sub');
    if (s) s.textContent = text;
  }

  /* ---------------- PROJETOS ---------------- */
  render_projects() {
    const total = this.projects.length;
    this.setAppSub(`${this.discovered.size}/${total} DESCOBERTOS`);
    const list = el('div', 'pj-list');
    this.projects.forEach((p, i) => {
      const found = this.discovered.has(p.id);
      const b = el(
        'button',
        `pj-item${found ? ' found' : ''}${p.id === this.trackedId ? ' tracked' : ''}`,
        `<span class="num">${String(p.index + 1).padStart(2, '0')}</span>
         <span class="txt"><b>${esc(p.title)}</b><small>${esc(p.subtitle)}</small></span>
         <span class="st">${p.id === this.trackedId ? '◉' : found ? '✔' : '?'}</span>`,
      );
      b.dataset.nav = '';
      b.dataset.pj = i;
      b.style.setProperty('--c', p.color);
      b.style.setProperty('--i', i);
      list.appendChild(b);
    });
    const detail = el('div', 'pj-detail');
    this.appBody.append(list, detail);
    this.showProject(Math.min(this.projectIndex, total - 1), false);
    this.setHints([['↑↓', 'projeto'], ['ENTER', 'viajar'], ['R', 'marcar rota'], ['ESC', 'voltar']]);
  }

  showProject(i, animate = true) {
    this.projectIndex = i;
    const p = this.projects[i];
    if (!p) return;
    this.appBody.querySelectorAll('.pj-item').forEach((b, k) => b.classList.toggle('sel', k === i));
    this.setAccent(p.color);
    const found = this.discovered.has(p.id);
    const tracked = this.trackedId === p.id;
    const d = this.appBody.querySelector('.pj-detail');
    d.style.setProperty('--c', p.color);
    d.innerHTML = `
      <div class="pj-shot"><img alt="" /><span class="scan"></span><span class="tag">${found ? '✔ DESCOBERTO' : '? NÃO VISITADO'}</span><span class="yr">${p.year || ''}</span></div>
      <div class="pj-info">
        <span class="pj-num">PROJETO ${String(p.index + 1).padStart(2, '0')}</span>
        <h3 class="pj-title"></h3>
        <p class="pj-sub">${esc(p.subtitle)}</p>
        <p class="pj-desc">${esc(p.description || '')}</p>
        <div class="pj-tags">${(p.tags || []).map((t, k) => `<span style="--i:${k}">${esc(t)}</span>`).join('')}</div>
        <div class="pj-actions">
          <button data-nav data-act="travel" data-id="${p.id}" class="act-main"><span class="ic">${ICONS.travel}</span>VIAJAR ATÉ LÁ</button>
          <button data-nav data-act="track" data-id="${p.id}" class="${tracked ? 'on' : ''}"><span class="ic">${ICONS.route}</span>${tracked ? 'RASTREANDO' : 'MARCAR ROTA'}</button>
          ${p.url ? `<a data-nav href="${esc(p.url)}" target="_blank" rel="noopener"><span class="ic">${ICONS.link}</span>ABRIR SITE</a>` : ''}
        </div>
      </div>`;
    d.querySelector('img').src = p.thumb || '';
    scramble(d.querySelector('.pj-title'), p.title.toUpperCase(), animate ? 420 : 600);
    d.classList.remove('swap');
    void d.offsetWidth;
    d.classList.add('swap');
  }

  /* ---------------- MAPA ---------------- */
  render_map() {
    const wrap = el('div', 'map-wrap');
    const canvas = el('canvas', 'map-canvas');
    canvas.width = 1200;
    canvas.height = 1200;
    wrap.appendChild(canvas);
    const pins = el('div', 'map-pins');
    wrap.appendChild(pins);
    const side = el('div', 'map-side');
    this.appBody.append(wrap, side);
    this.mapCanvas = canvas;
    this.mapPins = pins;
    this.mapSide = side;
    const data = this.h.getMap();
    this.mapData = data;
    // pinos clicáveis (HTML por cima do canvas)
    data.pedestals.forEach((p, k) => {
      const u = (p.x + data.size / 2) / data.size;
      const v = (p.z + data.size / 2) / data.size;
      const b = el(
        'button',
        `map-pin${p.kind !== 'project' ? ' round' : ''}${this.discovered.has(p.id) || p.kind !== 'project' ? ' found' : ''}${p.id === this.trackedId ? ' tracked' : ''}`,
        `<i></i><span>${p.kind === 'project' ? String(p.index + 1).padStart(2, '0') : p.kind === 'about' ? 'i' : '@'}</span>`,
      );
      b.dataset.nav = '';
      b.dataset.pin = p.id;
      b.style.left = `${u * 100}%`;
      b.style.top = `${v * 100}%`;
      b.style.setProperty('--c', p.color);
      b.style.setProperty('--i', k);
      pins.appendChild(b);
    });
    this.mapSel = this.mapSel || this.trackedId || data.pedestals.find((p) => p.kind === 'project')?.id;
    this.renderMapSide();
    this.setAppSub(data.location.street);
    this.mapRunning = true;
    this.setHints([['←↑→↓', 'escolher'], ['ENTER', 'viajar'], ['R', 'marcar rota'], ['ESC', 'voltar']]);
  }

  renderMapSide() {
    const data = this.mapData;
    const p = data.pedestals.find((x) => x.id === this.mapSel);
    this.mapPins.querySelectorAll('.map-pin').forEach((b) => b.classList.toggle('sel', b.dataset.pin === this.mapSel));
    const dist = p ? Math.round(Math.hypot(wrapD(p.x - data.player.x, data.size), wrapD(p.z - data.player.z, data.size))) : 0;
    const loc = data.location;
    const dc = loc.district >= 0 ? DISTRICTS[loc.district] : null;
    this.mapSide.innerHTML = `
      <div class="map-you"><span>VOCÊ ESTÁ EM</span><b style="--c:${dc ? dc.color : '#ffd319'}">${esc(loc.street)}</b><small>${dc ? esc(dc.name) : 'AVENIDAS DOS PROJETOS'}</small></div>
      ${
        p
          ? `<div class="map-card" style="--c:${p.color}">
              <span class="pj-num">${p.kind === 'project' ? `PROJETO ${String(p.index + 1).padStart(2, '0')}` : 'PERFIL'}</span>
              <h3>${esc(p.title)}</h3>
              <p>${esc(p.subtitle || '')}</p>
              <div class="map-dist"><b>${dist}</b> m daqui</div>
              <div class="pj-actions">
                <button data-nav data-act="travel" data-id="${p.id}" class="act-main"><span class="ic">${ICONS.travel}</span>VIAJAR</button>
                <button data-nav data-act="track" data-id="${p.id}" class="${p.id === this.trackedId ? 'on' : ''}"><span class="ic">${ICONS.route}</span>${p.id === this.trackedId ? 'RASTREANDO' : 'ROTA'}</button>
              </div>
            </div>`
          : ''
      }
      <div class="map-legend">${DISTRICTS.map((d) => `<span style="--c:${d.color}"><i></i>${esc(d.name)}</span>`).join('')}</div>`;
  }

  /** Desenha o mapa (chamado a cada quadro enquanto o app está aberto). */
  drawMap(t) {
    const data = this.h.getMap();
    this.mapData = data;
    const c = this.mapCanvas;
    const ctx = c.getContext('2d');
    const W = c.width;
    const k = W / data.size;
    const X = (v) => (v + data.size / 2) * k;
    ctx.clearRect(0, 0, W, W);
    ctx.globalAlpha = 0.92;
    if (data.mapCanvas) ctx.drawImage(data.mapCanvas, 0, 0, W, W);
    ctx.globalAlpha = 1;
    // avenidas dos projetos
    ctx.lineWidth = 5;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = '#00f0ff';
    ctx.shadowColor = '#00f0ff';
    ctx.beginPath();
    ctx.moveTo(X(0), 0);
    ctx.lineTo(X(0), W);
    ctx.stroke();
    ctx.strokeStyle = '#ff2a9d';
    ctx.shadowColor = '#ff2a9d';
    ctx.beginPath();
    ctx.moveTo(0, X(0));
    ctx.lineTo(W, X(0));
    ctx.stroke();
    ctx.shadowBlur = 0;
    // grade de latitude/longitude
    ctx.strokeStyle = 'rgba(160, 120, 255, 0.12)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo((i * W) / 8, 0);
      ctx.lineTo((i * W) / 8, W);
      ctx.moveTo(0, (i * W) / 8);
      ctx.lineTo(W, (i * W) / 8);
      ctx.stroke();
    }
    const px = X(data.player.x);
    const pz = X(data.player.z);
    // rota marcada
    const tr = data.pedestals.find((p) => p.id === this.trackedId);
    if (tr) {
      ctx.setLineDash([14, 12]);
      ctx.lineDashOffset = -t * 40;
      ctx.strokeStyle = tr.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(px, pz);
      ctx.lineTo(X(tr.x), X(tr.z));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // radar varrendo a partir do jogador
    const a = t * 1.6;
    const g = ctx.createConicGradient(a, px, pz);
    g.addColorStop(0, 'rgba(57, 255, 136, 0.35)');
    g.addColorStop(0.12, 'rgba(57, 255, 136, 0)');
    g.addColorStop(1, 'rgba(57, 255, 136, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(px, pz, 260, 0, Math.PI * 2);
    ctx.fill();
    for (let r = 1; r <= 3; r++) {
      ctx.strokeStyle = `rgba(57, 255, 136, ${0.22 / r})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, pz, ((t * 60 + r * 90) % 270) + 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    // jogador
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(-data.player.yaw);
    ctx.fillStyle = '#ffd319';
    ctx.shadowColor = '#ffd319';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.lineTo(15, 16);
    ctx.lineTo(0, 8);
    ctx.lineTo(-15, 16);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* ---------------- SOBRE MIM ---------------- */
  render_about() {
    const o = this.owner;
    const stats = this.h.getStats();
    const initials = o.name
      .split(/\s+/)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
    this.setAppSub('PERFIL DO DESENVOLVEDOR');
    this.appBody.innerHTML = `
      <div class="ab-card">
        <div class="ab-avatar"><span class="r1"></span><span class="r2"></span><span class="r3"></span><b>${esc(initials)}</b></div>
        <h3 class="ab-name"></h3>
        <p class="ab-role">${esc(o.role)}</p>
        <div class="ab-stats">
          <div><b>${this.projects.length}</b><span>projetos</span></div>
          <div><b>${stats.discovered}</b><span>descobertos</span></div>
          <div><b>${stats.laps}</b><span>voltas ao mundo</span></div>
        </div>
        <div class="ab-links">${o.links
          .map((l) => `<a data-nav href="${esc(l.url)}" target="_blank" rel="noopener"><span class="ic">${ICONS[linkIcon(l)]}</span>${esc(l.label)}</a>`)
          .join('')}</div>
      </div>
      <div class="ab-term">
        <div class="ab-term-bar"><i></i><i></i><i></i><span>~/sobre-mim.txt</span></div>
        <div class="ab-term-body">
          <p class="cmd">$ cat sobre-mim.txt</p>
          ${o.about.map((p) => `<p class="ln" data-text="${esc(p)}"></p>`).join('')}
          <p class="cmd">$ ls habilidades/</p>
          <div class="ab-skills">${o.skills.map((s, i) => `<span style="--i:${i}">${esc(s)}</span>`).join('')}</div>
          <p class="cmd cursor">$ </p>
        </div>
      </div>`;
    scramble(this.appBody.querySelector('.ab-name'), o.name.toUpperCase(), 700);
    this.typeLines();
    this.setHints([['←→', 'links'], ['ENTER', 'abrir'], ['ESC', 'voltar']]);
  }

  /** Digita as linhas do terminal, uma depois da outra. */
  typeLines() {
    const lines = [...this.appBody.querySelectorAll('.ln')];
    const token = (this._typeToken = {});
    let li = 0;
    let ci = 0;
    const step = () => {
      if (this._typeToken !== token || li >= lines.length) {
        this.appBody.querySelector('.ab-term')?.classList.add('done');
        return;
      }
      const line = lines[li];
      const text = line.dataset.text;
      ci = Math.min(ci + 3, text.length);
      line.textContent = text.slice(0, ci);
      if (ci >= text.length) {
        li++;
        ci = 0;
        setTimeout(step, 120);
      } else setTimeout(step, 12);
    };
    setTimeout(step, 450);
  }

  /* ---------------- CONTATO ---------------- */
  render_contact() {
    const o = this.owner;
    this.setAppSub('RESPOSTA EM ATÉ 24H');
    this.appBody.innerHTML = `
      <div class="ct-hero">
        <span class="tos-kicker">CANAL ABERTO</span>
        <h3>Vamos construir algo<br/><em>juntos?</em></h3>
        <p>Projetos, freelas, oportunidades ou só trocar uma ideia sobre código e synthwave.</p>
      </div>
      <div class="ct-list">
        ${o.links
          .map((l, i) => {
            const mail = /^mailto:/i.test(l.url);
            const value = mail ? l.url.replace(/^mailto:/i, '') : l.url.replace(/^https?:\/\/(www\.)?/i, '');
            return `<div class="ct-item" style="--i:${i}">
              <span class="ic">${ICONS[linkIcon(l)]}</span>
              <span class="ct-txt"><b>${esc(l.label)}</b><small>${esc(value)}</small></span>
              ${mail ? `<button data-nav data-act="copy" data-value="${esc(value)}"><span class="ic">${ICONS.copy}</span>COPIAR</button>` : ''}
              <a data-nav href="${esc(l.url)}" target="_blank" rel="noopener"><span class="ic">${ICONS.link}</span>ABRIR</a>
            </div>`;
          })
          .join('')}
      </div>`;
    this.setHints([['↑↓←→', 'navegar'], ['ENTER', 'abrir'], ['ESC', 'voltar']]);
  }

  /* ---------------- CONTROLES ---------------- */
  render_controls() {
    const key = (k, w = 1, on = false) => `<span class="key${on ? ' on' : ''}" style="--w:${w}">${k}</span>`;
    this.setAppSub('TECLADO · MOUSE · TOQUE');
    this.appBody.innerHTML = `
      <div class="kb">
        <div class="kb-row">${key('ESC', 1.2, true)}${'1234567890'.split('').map((k) => key(k)).join('')}</div>
        <div class="kb-row">${key('TAB', 1.6, true)}${key('Q', 1, true)}${key('W', 1, true)}${key('E', 1, true)}${'RTYUIOP'.split('').map((k) => key(k)).join('')}</div>
        <div class="kb-row">${key('', 1.9)}${key('A', 1, true)}${key('S', 1, true)}${key('D', 1, true)}${'FGHJKL'.split('').map((k) => key(k)).join('')}</div>
        <div class="kb-row">${key('SHIFT', 2.4, true)}${'ZXCVBN'.split('').map((k) => key(k)).join('')}${key('M', 1, true)}</div>
        <div class="kb-row">${key('', 3)}${key('ESPAÇO', 6, true)}${key('', 3)}</div>
      </div>
      <ul class="kb-legend">
        <li><kbd>W A S D</kbd>mover</li>
        <li><kbd>MOUSE</kbd>olhar ao redor</li>
        <li><kbd>SHIFT</kbd>correr</li>
        <li><kbd>ESPAÇO</kbd>pular</li>
        <li><kbd>E</kbd>abrir projeto / interagir</li>
        <li><kbd>Q</kbd>radar de projetos</li>
        <li><kbd>TAB</kbd>tablet: projetos</li>
        <li><kbd>M</kbd>música liga/desliga</li>
        <li><kbd>ESC</kbd>tablet / pausar</li>
        <li class="touch"><kbd>CELULAR</kbd>joystick à esquerda, arraste à direita para olhar</li>
      </ul>`;
    this.setHints([['ESC', 'voltar']]);
  }

  /* ---------------- AJUSTES ---------------- */
  render_settings() {
    const s = this.settings;
    this.setAppSub('PREFERÊNCIAS DO SISTEMA');
    const sw = (key, label, sub) => `
      <button class="st-row" data-nav data-act="toggle" data-key="${key}">
        <span class="st-txt"><b>${label}</b><small>${sub}</small></span>
        <span class="switch ${s[key] === true || s[key] === 'high' ? 'on' : ''}"><i></i></span>
      </button>`;
    this.appBody.innerHTML = `
      <div class="st-list">
        ${sw('quality', 'Qualidade gráfica alta', 'sombras e resolução máximas')}
        ${sw('music', 'Música', 'trilha synthwave sintetizada ao vivo')}
        ${sw('sfx', 'Efeitos sonoros', 'passos, buzinas, interface')}
        ${sw('crt', 'Efeito CRT', 'scanlines e aberração cromática')}
        <div class="st-row st-range">
          <span class="st-txt"><b>Sensibilidade do mouse</b><small>quanto a câmera gira</small></span>
          <button data-nav data-act="sens" data-d="-1">−</button>
          <span class="bar"><i style="width:${((s.sensitivity - 0.3) / 2.2) * 100}%"></i></span>
          <b class="val">${s.sensitivity.toFixed(1)}×</b>
          <button data-nav data-act="sens" data-d="1">+</button>
        </div>
      </div>`;
    this.setHints([['↑↓', 'navegar'], ['ENTER', 'alternar'], ['ESC', 'voltar']]);
  }

  /* ================================================================ */
  /*  Ações                                                            */
  /* ================================================================ */
  activate(node, native = false) {
    if (!node) return;
    this.h.onBump?.();
    const act = node.dataset.act;
    if (node.matches('a')) {
      this.synth.select();
      if (!native) window.open(node.href, '_blank', 'noopener');
      return;
    }
    if (node.dataset.app) {
      this.synth.open();
      this.openApp(node.dataset.app, { from: node });
      return;
    }
    if (node.dataset.pj != null) {
      this.synth.blip();
      this.showProject(+node.dataset.pj);
      return;
    }
    if (node.dataset.pin) {
      this.synth.blip();
      this.mapSel = node.dataset.pin;
      this.renderMapSide();
      return;
    }
    this.synth.select();
    if (act === 'play') this.h.onPlay();
    else if (act === 'resume') this.h.onResume();
    else if (act === 'quit') this.h.onQuit();
    else if (act === 'back') {
      this.synth.back();
      this.closeApp();
    } else if (act === 'travel') this.h.onTravel(node.dataset.id);
    else if (act === 'track') {
      const id = node.dataset.id;
      this.h.onTrack(this.trackedId === id ? null : id);
    } else if (act === 'copy') {
      navigator.clipboard?.writeText(node.dataset.value).catch(() => {});
      this.notify('E-MAIL COPIADO', node.dataset.value);
    } else if (act === 'toggle') {
      const k = node.dataset.key;
      const s = this.settings;
      s[k] = typeof s[k] === 'boolean' ? !s[k] : s[k] === 'high' ? 'low' : 'high';
      node.querySelector('.switch').classList.toggle('on', s[k] === true || s[k] === 'high');
      this.h.onSettings(s);
    } else if (act === 'sens') {
      const s = this.settings;
      s.sensitivity = Math.round(Math.min(Math.max(s.sensitivity + +node.dataset.d * 0.1, 0.3), 2.5) * 10) / 10;
      const row = node.closest('.st-range');
      row.querySelector('.bar i').style.width = `${((s.sensitivity - 0.3) / 2.2) * 100}%`;
      row.querySelector('.val').textContent = `${s.sensitivity.toFixed(1)}×`;
      this.h.onSettings(s);
    }
  }

  /** Notificação que desce do topo da tela do tablet. */
  notify(title, sub = '') {
    const n = el('div', 'tos-note', `<b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`);
    this.q('.tos-notes').appendChild(n);
    setTimeout(() => n.classList.add('out'), 2400);
    setTimeout(() => n.remove(), 2900);
  }

  /* ================================================================ */
  /*  Foco e teclado                                                   */
  /* ================================================================ */
  get view() {
    return this.app ? this.appEl : this.home;
  }

  focusables() {
    return [...this.view.querySelectorAll('[data-nav]')].filter((n) => n.offsetParent !== null);
  }

  focusFirst() {
    let first = null;
    if (this.app === 'projects') first = this.appBody.querySelector('.pj-item.sel');
    else if (this.app === 'map') first = this.appBody.querySelector('.map-pin.sel') || this.appBody.querySelector('.map-pin');
    else if (this.app) first = this.appBody.querySelector('[data-nav]');
    else first = this.home.querySelector('.tos-primary');
    this.setFocus(first || this.focusables()[0], true);
  }

  setFocus(node, silent = false) {
    if (this.focusEl) this.focusEl.classList.remove('focus');
    this.focusEl = node || null;
    if (!node) return;
    node.classList.add('focus');
    if (!silent) this.synth.hover();
    // listas com rolagem: mantém o item visível (sem scrollIntoView, que rolaria a página toda)
    const list = node.closest('.pj-list, .st-list, .ct-list');
    if (list) {
      const top = node.offsetTop - list.offsetTop;
      if (top < list.scrollTop) list.scrollTop = top - 8;
      else if (top + node.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + node.offsetHeight - list.clientHeight + 8;
    }
  }

  /** Navegação espacial: o vizinho mais próximo na direção pedida. */
  move(dx, dy) {
    const cur = this.focusEl;
    const items = this.focusables();
    if (!cur || !items.includes(cur)) {
      this.focusFirst();
      return;
    }
    const a = layoutRect(cur, this.el);
    let best = null;
    let bestScore = Infinity;
    for (const n of items) {
      if (n === cur) continue;
      const b = layoutRect(n, this.el);
      const vx = b.cx - a.cx;
      const vy = b.cy - a.cy;
      const along = vx * dx + vy * dy;
      if (along <= 4) continue;
      const across = Math.abs(vx * dy - vy * dx);
      const score = along + across * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = n;
      }
    }
    if (best) {
      this.setFocus(best);
      // nas listas, mover já seleciona
      if (best.dataset.pj != null) this.showProject(+best.dataset.pj);
      if (best.dataset.pin) {
        this.mapSel = best.dataset.pin;
        this.renderMapSide();
      }
    }
  }

  /** @returns {boolean} se a tecla foi tratada */
  handleKey(e) {
    const c = e.code;
    // ligando / desligando: só o ESC (guardar) passa; o resto é engolido
    if (!this.ready) {
      if ((c === 'Escape' || c === 'Backspace') && this.mode === 'game' && this.powered) {
        e.preventDefault();
        this.h.onResume(true);
        return true;
      }
      if (['Tab', 'Escape', 'Backspace'].includes(c)) return false;
      e.preventDefault();
      return true;
    }
    if (c === 'ArrowDown' || c === 'KeyS') this.move(0, 1);
    else if (c === 'ArrowUp' || c === 'KeyW') this.move(0, -1);
    else if (c === 'ArrowLeft' || c === 'KeyA') this.move(-1, 0);
    else if (c === 'ArrowRight' || c === 'KeyD') this.move(1, 0);
    else if (c === 'Enter' || c === 'Space' || c === 'NumpadEnter') {
      // nas listas, ENTER viaja até o selecionado
      if (this.focusEl?.dataset.pj != null || this.focusEl?.dataset.pin) {
        const id = this.focusEl.dataset.pin || this.projects[this.projectIndex].id;
        this.synth.select();
        this.h.onBump?.();
        this.h.onTravel(id);
      } else this.activate(this.focusEl);
    } else if (c === 'KeyR' && (this.app === 'projects' || this.app === 'map')) {
      const id = this.app === 'map' ? this.mapSel : this.projects[this.projectIndex].id;
      if (id) {
        this.synth.select();
        this.h.onTrack(this.trackedId === id ? null : id);
      }
    } else if (c === 'Escape' && this.mode === 'game') {
      // no jogo, ESC guarda o tablet de qualquer tela (voltar é ⌫ ou o botão ◀)
      this.synth.back();
      this.h.onResume(true);
    } else if (c === 'Escape' || c === 'Backspace') {
      if (this.app) {
        this.synth.back();
        this.h.onBump?.();
        this.closeApp();
      } else if (this.mode === 'game') this.h.onResume(true);
      else {
        // menu inicial: o tablet não pode ser guardado (é por ele que se começa a jogar)
        this.h.onBump?.();
        this.setFocus(this.home.querySelector('.tos-primary'), true);
      }
    } else return false;
    e.preventDefault();
    return true;
  }

  /* ================================================================ */
  /*  Dados vindos do jogo                                             */
  /* ================================================================ */
  setDiscovered(set) {
    this.discovered = set;
  }

  /** Rota marcada: atualiza os botões abertos sem reconstruir a tela. */
  setTracked(id) {
    this.trackedId = id;
    if (this.app === 'projects') {
      this.appBody.querySelectorAll('.pj-item').forEach((b, i) => {
        const p = this.projects[i];
        const on = p.id === id;
        b.classList.toggle('tracked', on);
        b.querySelector('.st').textContent = on ? '◉' : this.discovered.has(p.id) ? '✔' : '?';
      });
      this.showProject(this.projectIndex, false);
      this.setFocus(this.appBody.querySelector('[data-act="track"]'), true);
    } else if (this.app === 'map') {
      this.mapPins.querySelectorAll('.map-pin').forEach((b) => b.classList.toggle('tracked', b.dataset.pin === id));
      this.renderMapSide();
      this.setFocus(this.appBody.querySelector('[data-act="track"]'), true);
    }
  }

  setLocation(text) {
    this.q('.tos-loc').textContent = text;
  }

  updateClock() {
    const d = new Date();
    this.q('.tos-clock').textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /** Reflexo do vidro acompanha a inclinação do aparelho. */
  setGlare(x, y) {
    this.el.style.setProperty('--gx', `${50 + x * 140}%`);
    this.el.style.setProperty('--gy', `${50 - y * 140}%`);
  }

  update(t) {
    if (this.mapRunning && this.mapCanvas) this.drawMap(t);
  }
}

function wrapD(d, size) {
  return d - size * Math.round(d / size);
}
