import './styles.css';
import * as THREE from 'three';
import { OWNER, PROJECTS } from './config.js';
import { Engine } from './core/Engine.js';
import { World } from './world/World.js';
import { Player } from './player/Player.js';
import { TouchControls } from './player/TouchControls.js';
import { Synth } from './audio/Synth.js';
import { UI } from './ui/UI.js';
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
 *  "modal" = painel aberto a partir do jogo (ex.: terminal Sobre mim)
 */
let state = 'loading';
let engine, world, player, ui, touch;
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
    handlers: { onMenuAction, onPauseAction, onTravel, onTrack, onSettings: applySettings, onModalClosed },
  });
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
    window.__portimax = { engine, world, player, ui, get state() { return state; } };
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

  if (state === 'play' || state === 'entering' || state === 'paused' || state === 'modal') {
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
  engine.setFocus(state === 'play' && world.focused ? world.focused.reveal : 0, dt);
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
  ui.revealMainMenu();
  state = 'menu';
}

function onMenuAction(action) {
  if (action === 'play') enterGame();
  else if (action === 'projects') ui.openModal('panel-projects');
  else if (action === 'controls') ui.openModal('panel-controls');
  else if (action === 'about') ui.openModal('panel-about');
  else if (action === 'settings') ui.openModal('panel-settings');
}

function onPauseAction(action) {
  if (action === 'resume') resume();
  else if (action === 'projects') ui.openModal('panel-projects');
  else if (action === 'controls') ui.openModal('panel-controls');
  else if (action === 'settings') ui.openModal('panel-settings');
  else if (action === 'quit') goToMenu();
}

function enterGame(spawn) {
  synth.init();
  ui.closeAllModals();
  ui.show('menu', false);
  ui.show('pause', false);
  ui.activeMenu = null;

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

function resume() {
  ui.closeAllModals();
  if (isTouch) {
    ui.show('pause', false);
    ui.activeMenu = null;
    state = 'play';
    player.enabled = true;
    return;
  }
  player.controls.lock();
}

function pause() {
  if (state !== 'play' && state !== 'entering') return;
  if (state === 'entering') updateTransitionToEnd();
  state = 'paused';
  player.enabled = false;
  player.releaseKeys();
  ui.setPrompt(false);
  lastFocused = null;
  ui.show('pause', true);
  ui.pauseMenu.select(0, true);
  ui.activeMenu = ui.pauseMenu;
}

function updateTransitionToEnd() {
  transition.t = 1;
  updateTransition(0);
}

/** Abre um painel a partir do jogo (Tab, terminal Sobre mim / Contato). */
function openFromGame(id) {
  state = 'modal';
  player.enabled = false;
  player.releaseKeys();
  ui.setPrompt(false);
  lastFocused = null;
  ui.openModal(id);
  if (player.controls.isLocked) player.controls.unlock();
}

function onModalClosed() {
  if (state === 'modal' && !ui.modalOpen) {
    if (isTouch) resume();
    else ui.setClickToPlay(true);
  }
}

function goToMenu() {
  state = 'menu';
  player.enabled = false;
  ui.closeAllModals();
  ui.show('pause', false);
  ui.show('hud', false);
  ui.setClickToPlay(false);
  ui.show('menu', true);
  ui.mainMenu.select(0, true);
  ui.activeMenu = ui.mainMenu;
  if (player.controls.isLocked) player.controls.unlock();
}

function onTravel(id) {
  const vp = world.viewpointFor(id);
  if (!vp) return;
  flash();
  if (state === 'menu' || state === 'title') {
    enterGame(vp);
    return;
  }
  player.spawn(vp.x, vp.z, vp.yaw);
  lap.x = 0;
  lap.z = 0;
  lastFocused = null;
  if (state === 'paused') ui.show('pause', false);
  state = 'modal';
  ui.closeAllModals();
  ui.activeMenu = null;
  if (isTouch) resume();
  else {
    ui.setClickToPlay(true);
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

/** Marca (ou desmarca) a rota até um projeto e volta para o jogo. */
function onTrack(id) {
  const item = setTracked(id);
  if (state === 'menu' || state === 'title') enterGame();
  else {
    if (state === 'paused') ui.show('pause', false);
    state = 'modal';
    ui.closeAllModals();
    ui.activeMenu = null;
    if (isTouch) resume();
    else {
      ui.setClickToPlay(true);
      player.controls.lock();
    }
  }
  if (item) ui.toast('◎ ROTA MARCADA', `${item.title} · siga o feixe de luz`);
}

function interact() {
  if (state !== 'play' || !world.focused) return;
  const item = world.focused.item;
  if (item.kind === 'about') {
    synth.select();
    openFromGame('panel-about');
  } else if (item.kind === 'contact') {
    synth.select();
    openFromGame('panel-about');
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
    if (state === 'paused' || state === 'modal') {
      ui.show('pause', false);
      ui.closeAllModals();
      ui.activeMenu = null;
      state = 'play';
      player.enabled = true;
    }
  });
  controls.addEventListener('unlock', () => {
    if (state === 'play' || state === 'entering') pause();
  });
  document.addEventListener('pointerlockerror', () => {
    if (state === 'entering' || state === 'paused' || state === 'modal') ui.setClickToPlay(true);
  });
  document.getElementById('click-to-play').addEventListener('click', () => controls.lock());
  document.getElementById('app').addEventListener('click', () => {
    if (!isTouch && ['modal', 'entering', 'play'].includes(state) && !controls.isLocked && !ui.modalOpen) controls.lock();
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
      ui.renderSettings();
      ui.toast(ui.settings.music ? '♪ MÚSICA LIGADA' : '♪ MÚSICA DESLIGADA');
      return;
    }
    if (state === 'menu' || state === 'paused' || state === 'modal') {
      if (ui.handleMenuKey(e)) return;
    }
    if (state === 'play') {
      if (e.code === 'KeyE') interact();
      else if (e.code === 'KeyQ') scan();
      else if (e.code === 'Tab') {
        e.preventDefault();
        openFromGame('panel-projects');
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
