import './styles.css';
import * as THREE from 'three';
import { OWNER, PROJECTS } from './config.js';
import { Engine } from './core/Engine.js';
import { World } from './world/World.js';
import { Player } from './player/Player.js';
import { TouchControls } from './player/TouchControls.js';
import { Synth } from './audio/Synth.js';
import { UI } from './ui/UI.js';
import { Tablet } from './ui/Tablet.js';
import './ui/tablet.css';
import { installPlanetShaders, wrapCoord, wrapDelta, WORLD_SIZE, PLAZA_RADIUS } from './core/Planet.js';

// curvatura do horizonte em todos os materiais (precisa vir antes de compilar qualquer shader)
installPlanetShaders();

const DISCOVERED_KEY = 'portimax-discovered';
const LAPS_KEY = 'portimax-laps';
const isTouch = window.matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
if (isTouch) document.body.classList.add('touch');

/**
 * Estados:
 *  loading → title → menu → entering → play ⇄ paused
 *  menu e paused = tablet aberto na frente da câmera (NEON OS);
 *  resuming = tablet guardando, esperando o pointer lock voltar
 */
let state = 'loading';
let engine, world, player, ui, touch, tablet;
let tabletTimer = null;
let tabletOpenedAt = 0;
let escGuardUntil = 0;
let resumedAt = -Infinity;
let leavingMenu = false; // JOGAR/viajar a partir do menu: o tablet pode descer
const synth = new Synth();
let started = false;
let transition = null;
let attractTime = 0;
let lastFocused = null;
let playTime = 0;
let hintsFaded = false;
let introScanDone = false;
let trackedId = null;
let markerState = null;
const discovered = loadDiscovered();
/** voltas ao mundo: quantas vezes o jogador cruzou a borda em cada eixo desde a última vez na praça */
const lap = { x: 0, z: 0 };
let totalLaps = loadLaps();

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

boot().catch((err) => {
  console.error(err);
  document.getElementById('loading-text').textContent =
    'Não foi possível iniciar o WebGL neste navegador. Tente o Chrome, Edge ou Firefox atualizados.';
});

async function boot() {
  const setLoading = (p, t) => {
    document.getElementById('loading-fill').style.width = `${p}%`;
    document.getElementById('loading-text').textContent = t;
  };

  setLoading(10, 'carregando fontes...');
  await Promise.race([
    Promise.all([
      document.fonts.load('900 64px "Orbitron"'),
      document.fonts.load('700 20px "Orbitron"'),
      document.fonts.load('20px "Share Tech Mono"'),
      document.fonts.load('20px "Press Start 2P"'),
    ]),
    new Promise((r) => setTimeout(r, 4000)),
  ]);

  setLoading(35, 'construindo o mundo...');
  await nextFrame();
  engine = new Engine(document.getElementById('app'));
  world = new World(engine, OWNER, PROJECTS);

  player = new Player(engine.camera, document.body);
  player.setColliders(world.colliders);
  player.onWrap = (axis, dir) => {
    lap[axis] += dir;
  };
  player.onStep = (land) => synth.step(land);
  player.onJump = () => synth.jump();
  world.city.traffic.onHonk = () => synth.horn();

  const projectItems = world.pedestals
    .filter((p) => p.item.kind === 'project')
    .map((p) => p.item)
    .sort((a, b) => a.index - b.index);

  ui = new UI({
    owner: OWNER,
    projects: projectItems,
    synth,
    handlers: {
      onPlay,
      onResume: resume,
      onQuit: goToMenu,
      onTravel,
      onTrack,
      onSettings: applySettings,
      getMap,
      getStats: () => ({ discovered: discovered.size, laps: totalLaps }),
      onAccent: (hex) => tablet?.setAccent(hex),
      onBump: () => tablet?.bump(),
    },
  });
  // o tablet do jogador: modelo 3D na frente da câmera, com o NEON OS projetado no vidro
  tablet = new Tablet(engine, ui.os.el);
  tablet.setEnvironment(engine.scene.environment);
  ui.setDiscovered(discovered);
  // o mundo lê o mesmo Set: faróis e marcadores sabem o que já foi visitado
  world.discovered = discovered;
  ui.initMarkers(world.pedestals, world.plan.buildings);
  markerState = { isFound: (item) => world.isFound(item), trackedId: null, scan: 0 };
  applySettings(ui.settings);

  if (isTouch) touch = new TouchControls(player, { onInteract: interact, onPause: pause, onScan: scan });

  setupPointerLock();
  setupInput();
  onResize();
  window.addEventListener('resize', onResize);

  setLoading(70, 'compilando shaders...');
  await nextFrame();
  updateAttract(0);
  world.update(0, 0, engine.camera, 'menu');
  await engine.renderer.compileAsync(engine.scene, engine.camera);

  // Gancho para depuração: acesse com ?debug na URL
  if (new URLSearchParams(location.search).has('debug')) {
    window.__portimax = { engine, world, player, ui, tablet, get state() { return state; } };
  }

  setLoading(100, 'pronto!');
  engine.onUpdate(update);
  engine.start();
  await new Promise((r) => setTimeout(r, 350));

  ui.show('loading', false);
  ui.show('menu', true);
  state = 'title';
}

/* ------------------------------------------------------------------ */
/*  Loop principal                                                     */
/* ------------------------------------------------------------------ */
function update(dt, t) {
  const cam = engine.camera;

  if (state === 'title' || state === 'menu') {
    updateAttract(dt);
  } else if (state === 'entering') {
    updateTransition(dt);
  } else if (state === 'play') {
    player.update(dt);
    playTime += dt;
    if (!hintsFaded && playTime > 14) {
      hintsFaded = true;
      ui.fadeHints();
    }
  }

  world.update(dt, t, cam, state === 'play' || state === 'entering' ? 'play' : 'menu');

  if (state === 'play' || state === 'entering' || state === 'paused' || state === 'resuming') {
    const yaw = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ').y;
    ui.drawMinimap(world, player.position, yaw);
    markerState.trackedId = trackedId;
    markerState.scan = world.scan.level;
    ui.updateMarkers(cam, markerState);
    ui.setRadarBusy(world.scan.running);
    if (trackedId) {
      const p = world.pedestals.find((x) => x.item.id === trackedId);
      if (p) ui.setRouteDistance(p.dist);
    }
  }

  if (state === 'play') {
    handleFocus();
    checkLap();
    updateLocation();
  }
  // tablet na mão: acompanha a câmera; o mundo ao fundo escurece e perde cor
  syncTablet();
  tablet.update(dt);
  if (tablet.visible) {
    ui.os.setGlare(tablet.parX.x, tablet.parY.x);
    ui.os.update(t);
  }
  const focus = state === 'play' && world.focused ? world.focused.reveal : 0;
  engine.setFocus(Math.max(focus, tablet.amount * 0.6), dt);
  if (state === 'play' || state === 'entering') ui.setCoords(player.position.x / WORLD_SIZE, player.position.z / WORLD_SIZE);
}

/** Rua e bairro onde o jogador está (HUD), com um letreiro ao chegar num bairro novo. */
let lastDistrict = null;
let locateTimer = 0;
function updateLocation() {
  locateTimer -= 1;
  if (locateTimer > 0) return;
  locateTimer = 6; // não precisa ser a cada frame
  const { district, street } = world.locate(player.position.x, player.position.z);
  ui.setLocation(street, district);
  // no calçadão das avenidas o bairro não muda (é a "fronteira" entre eles)
  if (district >= 0 && district !== lastDistrict) {
    if (lastDistrict !== null) synth.district();
    ui.showDistrict(district);
    lastDistrict = district;
  }
}

/** Voltou à praça depois de cruzar a borda do mundo? Então deu a volta no planeta. */
function checkLap() {
  if (lap.x === 0 && lap.z === 0) return;
  const p = player.position;
  if (Math.hypot(wrapCoord(p.x), wrapCoord(p.z)) > PLAZA_RADIUS) return;
  lap.x = 0;
  lap.z = 0;
  totalLaps++;
  saveLaps();
  synth.achievement();
  if (totalLaps === 1) {
    ui.toast('🌍 VOLTA AO MUNDO!', 'Este mundo é um planeta sem bordas: andando reto, você sempre volta para cá.');
  } else {
    ui.toast(`🌍 ${totalLaps}ª VOLTA AO MUNDO`, 'O planeta não tem fim. Continue explorando!');
  }
}

/** Câmera cinematográfica do menu: percorre a avenida principal rumo ao sol. */
function updateAttract(dt) {
  attractTime += dt;
  // percorre a avenida para sempre: o mundo dá a volta e a câmera nunca chega ao fim
  const z = wrapCoord(18 - attractTime * 5.5);
  const cam = engine.camera;
  cam.position.set(Math.sin(attractTime * 0.21) * 3.5, 5.2 + Math.sin(attractTime * 0.37) * 0.8, z);
  cam.lookAt(Math.sin(attractTime * 0.13) * 5, 4.2, z - 40);
}

function updateTransition(dt) {
  const tr = transition;
  tr.t = Math.min(tr.t + dt / tr.duration, 1);
  const k = tr.t < 0.5 ? 4 * tr.t ** 3 : 1 - (-2 * tr.t + 2) ** 3 / 2;
  const cam = engine.camera;
  cam.position.lerpVectors(tr.from.position, tr.to.position, k);
  cam.quaternion.slerpQuaternions(tr.from.quaternion, tr.to.quaternion, k);
  if (tr.t >= 1) {
    state = 'play';
    player.enabled = true;
    player.controls.enabled = true;
    // primeira entrada: um pulso de radar apresenta onde ficam os projetos
    if (!introScanDone) {
      introScanDone = true;
      scan();
      ui.toast('◎ RADAR DE PROJETOS', isTouch ? 'Siga os feixes de luz. Toque em ◎ para revelar os projetos.' : 'Siga os feixes de luz. Aperte Q para revelar os projetos.');
    }
  }
}

function handleFocus() {
  const f = world.focused;
  if (f !== lastFocused) {
    lastFocused = f;
    if (f) {
      synth.powerUp();
      const item = f.item;
      // chegou ao destino da rota marcada
      if (item.id === trackedId) setTracked(null);
      if (item.kind === 'project' && !discovered.has(item.id)) {
        discovered.add(item.id);
        saveDiscovered();
        ui.setDiscovered(discovered);
        synth.discover();
        ui.toast('PROJETO DESCOBERTO!', item.title);
        if (discovered.size === ui.projects.length) {
          setTimeout(() => {
            synth.achievement();
            ui.toast('🏆 CONQUISTA DESBLOQUEADA', 'Você explorou todos os projetos!');
          }, 1400);
        }
      }
    }
    ui.setPrompt(!!f, f ? actionLabel(f.item) : null);
    touch?.setReady(!!f);
  }
}

function actionLabel(item) {
  if (item.kind === 'about') return 'VER PERFIL';
  if (item.kind === 'contact') return 'VER CONTATOS';
  return item.url ? 'ABRIR PROJETO' : 'EM BREVE';
}

/* ------------------------------------------------------------------ */
/*  Ações                                                              */
/* ------------------------------------------------------------------ */
function startFromTitle() {
  synth.init();
  synth.setSfx(ui.settings.sfx);
  synth.setMusic(ui.settings.music);
  synth.select();
  ui.hidePressStart();
  state = 'menu';
  openTablet('menu');
}

/* ---------------- Tablet ---------------- */
/** Ergue o tablet e liga a tela (home ou direto num app). */
function openTablet(mode, app = null) {
  clearTimeout(tabletTimer);
  leavingMenu = false;
  document.body.classList.add('tablet-open');
  ui.setPrompt(false);
  ui.os.setLocation(currentStreet());
  if (tablet.isOpen && ui.os.powered) {
    // já está na mão e ligado: só troca o que está na tela
    if (app) ui.os.openApp(app);
    else if (mode !== ui.os.mode) ui.os.reboot(mode);
    return;
  }
  // estava guardado, ou foi reaberto no meio da descida: liga a tela de novo
  const quick = tablet.visible && tablet.amount > 0.6;
  ui.os.prepare(mode, app);
  tablet.open();
  tabletOpenedAt = performance.now();
  synth.tabletOpen();
  tabletTimer = setTimeout(() => ui.os.boot(), quick ? 90 : 420);
}

/**
 * Desliga a tela e guarda o tablet. A descida começa logo (a linha do CRT colapsa
 * enquanto ele já sai da frente). `then` roda quando ele já saiu da frente.
 */
function closeTablet(then) {
  clearTimeout(tabletTimer);
  document.body.classList.remove('tablet-open');
  if (!tablet.isOpen) {
    then?.();
    return;
  }
  ui.os.powerOff();
  synth.tabletClose();
  tablet.close(0.14);
  if (then) tabletTimer = setTimeout(then, 280);
}

/**
 * Rede de segurança: o tablet sempre combina com o estado do jogo.
 * No menu e na pausa ele precisa estar na mão (e ligado); jogando, guardado.
 */
function syncTablet() {
  if ((state === 'menu' && !leavingMenu) || state === 'paused') {
    if (!tablet.isOpen) openTablet(state === 'menu' ? 'menu' : 'game');
    else if (!ui.os.powered || (ui.os.waitingBoot && performance.now() - tabletOpenedAt > 1500)) {
      clearTimeout(tabletTimer);
      if (!ui.os.powered) ui.os.prepare(state === 'menu' ? 'menu' : 'game');
      ui.os.boot();
    }
  } else if ((state === 'play' || state === 'entering') && tablet.isOpen) {
    closeTablet();
  }
}

function currentStreet() {
  const p = state === 'menu' || state === 'title' ? engine.camera.position : player.position;
  return world.locate(p.x, p.z).street;
}

/** Dados do app Mapa (posições "de casa" no planeta). */
function getMap() {
  const inGame = state !== 'menu' && state !== 'title';
  const p = inGame ? player.position : engine.camera.position;
  const yaw = new THREE.Euler().setFromQuaternion(engine.camera.quaternion, 'YXZ').y;
  const loc = world.locate(p.x, p.z);
  return {
    size: WORLD_SIZE,
    mapCanvas: world.mapCanvas,
    player: { x: wrapCoord(p.x), z: wrapCoord(p.z), yaw },
    location: { street: loc.street, district: loc.district },
    pedestals: world.pedestals.map((ped) => ({
      id: ped.item.id,
      kind: ped.item.kind,
      index: ped.item.index,
      title: ped.item.title,
      subtitle: ped.item.subtitle,
      color: ped.item.color,
      x: ped.home.x,
      z: ped.home.y,
    })),
  };
}

/* ---------------- Ações ---------------- */
function onPlay() {
  leavingMenu = true;
  ui.show('menu', false);
  closeTablet(() => enterGame());
}

function enterGame(spawn) {
  synth.init();
  ui.show('menu', false);

  if (spawn) player.spawn(spawn.x, spawn.z, spawn.yaw);
  else if (!started) player.spawn(0, 8, 0);
  started = true;

  const cam = engine.camera;
  lap.x = 0;
  lap.z = 0;
  const to = player.getSpawnPose();
  // voa até a cópia mais próxima do ponto de entrada (nunca atravessa o mundo inteiro)
  to.position.x = cam.position.x + wrapDelta(to.position.x - cam.position.x);
  to.position.z = cam.position.z + wrapDelta(to.position.z - cam.position.z);
  transition = {
    t: 0,
    duration: spawn ? 1.2 : 1.8,
    from: { position: cam.position.clone(), quaternion: cam.quaternion.clone() },
    to,
  };
  state = 'entering';
  player.enabled = false;
  player.controls.enabled = false;
  lastFocused = null;
  ui.show('hud', true);
  if (!isTouch) player.controls.lock();
}

/** Guarda o tablet e volta a jogar (no PC, depende do pointer lock voltar). */
function resume(fromKey = false) {
  if (state !== 'paused') return;
  closeTablet();
  if (isTouch) {
    state = 'play';
    player.enabled = true;
    return;
  }
  state = 'resuming';
  resumedAt = performance.now();
  if (fromKey) {
    // No Chrome, a ação padrão do ESC (soltar o mouse) roda DEPOIS dos nossos handlers:
    // travar o mouse ainda dentro do keydown faria o mesmo ESC soltá-lo e reabrir o tablet.
    // Então o pedido de trava espera a tecla ser solta.
    window.addEventListener(
      'keyup',
      () => {
        if (state === 'resuming') player.controls.lock();
      },
      { once: true },
    );
  } else player.controls.lock();
}

/** ESC / perda do pointer lock durante o jogo: o personagem pega o tablet. */
function pause(app = null) {
  if (state !== 'play' && state !== 'entering' && state !== 'resuming') return;
  if (state === 'entering') updateTransitionToEnd();
  state = 'paused';
  player.enabled = false;
  player.releaseKeys();
  ui.setClickToPlay(false);
  lastFocused = null;
  openTablet('game', app);
}

function updateTransitionToEnd() {
  transition.t = 1;
  updateTransition(0);
}

/** Abre o tablet num app a partir do jogo (Tab, terminal Sobre mim / Contato). */
function openFromGame(app) {
  if (state === 'paused') {
    openTablet('game', app);
    return;
  }
  pause(app);
  if (player.controls.isLocked) player.controls.unlock();
}

/** Volta ao menu principal: o tablet continua na mão e reinicia no modo menu. */
function goToMenu() {
  state = 'menu';
  player.enabled = false;
  ui.show('hud', false);
  ui.setClickToPlay(false);
  ui.show('menu', true);
  ui.os.reboot('menu');
  if (player.controls.isLocked) player.controls.unlock();
}

function onTravel(id) {
  const vp = world.viewpointFor(id);
  if (!vp) return;
  if (state === 'menu' || state === 'title') {
    leavingMenu = true;
    closeTablet(() => {
      flash();
      enterGame(vp);
    });
    return;
  }
  closeTablet(() => flash());
  player.spawn(vp.x, vp.z, vp.yaw);
  lap.x = 0;
  lap.z = 0;
  lastFocused = null;
  if (isTouch) {
    state = 'play';
    player.enabled = true;
  } else {
    state = 'resuming';
    player.controls.lock();
  }
}

/** Pulso de radar: revela todos os projetos por alguns segundos. */
function scan() {
  if (state !== 'play') return;
  if (!world.triggerScan(player.position.x, player.position.z)) return;
  synth.scan();
}

function setTracked(id) {
  const item = id ? world.pedestals.find((p) => p.item.id === id)?.item : null;
  trackedId = item ? item.id : null;
  world.trackedId = trackedId;
  ui.setTracked(item);
  return item;
}

/** Marca (ou desmarca) a rota até um projeto; o tablet continua aberto. */
function onTrack(id) {
  const item = setTracked(id);
  if (item) ui.os.notify('◎ ROTA MARCADA', `${item.title} · siga o feixe de luz`);
  else ui.os.notify('ROTA DESMARCADA');
}

function interact() {
  if (state !== 'play' || !world.focused) return;
  const item = world.focused.item;
  if (item.kind === 'about') {
    synth.select();
    openFromGame('about');
  } else if (item.kind === 'contact') {
    synth.select();
    openFromGame('contact');
  } else if (item.url) {
    synth.open();
    ui.toast('ABRINDO PROJETO...', item.title);
    window.open(item.url, '_blank', 'noopener');
  } else {
    synth.back();
    ui.toast('EM BREVE', 'Este projeto ainda não está publicado');
  }
}

function flash() {
  const el = document.createElement('div');
  el.className = 'flash';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 700);
}

/* ------------------------------------------------------------------ */
/*  Entrada                                                            */
/* ------------------------------------------------------------------ */
function setupPointerLock() {
  const controls = player.controls;
  controls.addEventListener('lock', () => {
    ui.setClickToPlay(false);
    if (state === 'resuming' || state === 'paused') {
      if (state === 'paused') closeTablet();
      state = 'play';
      player.enabled = true;
    }
  });
  controls.addEventListener('unlock', () => {
    // o mouse caiu logo depois de voltar ao jogo (ex.: o navegador devolveu e tomou de volta):
    // não é o jogador pedindo o tablet, só pede um clique
    if (state === 'play' && performance.now() - resumedAt < 600) {
      state = 'resuming';
      player.enabled = false;
      player.releaseKeys();
      ui.setClickToPlay(true);
      return;
    }
    if (state === 'play' || state === 'entering') {
      // só o ESC que soltou o mouse é ignorado (ele pode chegar logo depois deste evento)
      escGuardUntil = performance.now() + 250;
      pause();
    }
  });
  document.addEventListener('pointerlockerror', () => {
    // o navegador recusou (ex.: ESC não conta como gesto): pede um clique
    if (state === 'entering' || state === 'resuming') ui.setClickToPlay(true);
  });
  document.getElementById('click-to-play').addEventListener('click', () => controls.lock());
  document.getElementById('app').addEventListener('click', () => {
    if (!isTouch && ['resuming', 'entering', 'play'].includes(state) && !controls.isLocked) controls.lock();
  });
}

function setupInput() {
  window.addEventListener('keydown', (e) => {
    if (state === 'loading') return;
    if (state === 'title') {
      e.preventDefault();
      startFromTitle();
      return;
    }
    if (e.code === 'KeyM' && synth.ctx) {
      ui.settings.music = !ui.settings.music;
      ui.saveSettings();
      const msg = ui.settings.music ? '♪ MÚSICA LIGADA' : '♪ MÚSICA DESLIGADA';
      if (tablet.isOpen) ui.os.notify(msg);
      else ui.toast(msg);
      return;
    }
    // esperando o clique para voltar ao jogo: TAB pega o tablet de novo
    // (ESC não: apertar ESC duas vezes para fechar faria o tablet voltar)
    if (state === 'resuming' && e.code === 'Tab') {
      e.preventDefault();
      pause('projects');
      return;
    }
    if (state === 'menu' || state === 'paused') {
      // TAB com o tablet aberto: guarda e volta a jogar
      if (e.code === 'Tab' && state === 'paused') {
        e.preventDefault();
        resume();
        return;
      }
      // o mesmo ESC que soltou o pointer lock não pode fechar o tablet que acabou de abrir
      if (e.code === 'Escape' && performance.now() < escGuardUntil) return;
      if (ui.os.handleKey(e)) return;
    }
    if (state === 'play') {
      if (e.code === 'KeyE') interact();
      else if (e.code === 'KeyQ') scan();
      else if (e.code === 'Tab') {
        e.preventDefault();
        openFromGame('projects');
      }
    }
    if (e.code === 'Tab') e.preventDefault();
  });

  document.getElementById('menu').addEventListener('pointerdown', () => {
    if (state === 'title') startFromTitle();
  });

  document.addEventListener('visibilitychange', () => {
    if (!synth.ctx) return;
    if (document.hidden) synth.ctx.suspend();
    else synth.ctx.resume();
  });
}

function applySettings(s) {
  engine.setQuality(s.quality);
  engine.setCRT(s.crt);
  world?.setShadows(s.quality === 'high');
  player.sensitivity = s.sensitivity;
  if (synth.ctx) {
    synth.setMusic(s.music);
    synth.setSfx(s.sfx);
  } else {
    synth.musicOn = s.music;
    synth.sfxOn = s.sfx;
  }
}

function onResize() {
  const aspect = window.innerWidth / window.innerHeight;
  // no celular em pé, abre o FOV para os hologramas caberem na tela
  const fov = aspect < 1 ? THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(37)) / aspect)), 70, 100) : 70;
  player.baseFov = fov;
  engine.camera.fov = fov;
  engine.camera.updateProjectionMatrix();
  tablet?.resize();
}

/* ------------------------------------------------------------------ */
function loadDiscovered() {
  try {
    const ids = new Set(PROJECTS.map((p) => p.id));
    return new Set(JSON.parse(localStorage.getItem(DISCOVERED_KEY) || '[]').filter((id) => ids.has(id)));
  } catch {
    return new Set();
  }
}

function loadLaps() {
  try {
    return parseInt(localStorage.getItem(LAPS_KEY) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveLaps() {
  try {
    localStorage.setItem(LAPS_KEY, String(totalLaps));
  } catch {
    /* sem armazenamento */
  }
}

function saveDiscovered() {
  try {
    localStorage.setItem(DISCOVERED_KEY, JSON.stringify([...discovered]));
  } catch {
    /* sem armazenamento: progresso só nesta sessão */
  }
}
