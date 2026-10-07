import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ledTime, ledMaterial, FOG_GLSL, frameGeometry, createMarquee } from './neon.js';
import { HALF_WORLD, ROAD_WIDTH } from '../core/Planet.js';
import { BLOCK } from '../core/CityPlan.js';
import { canvasTexture } from '../utils/textures.js';

/* ================================================================== */
/*  Postes de luz ao longo das estradas                                */
/* ================================================================== */
export const LAMP_OFFSET = ROAD_WIDTH / 2 + 1.6; // poste fora da pista
export const LAMP_ARM = 2.0; // braço avança sobre a pista
// no meio de cada quarteirão: os cruzamentos com as ruas ficam livres e os pedestais também
export const LAMP_FIRST = BLOCK;
export const LAMP_SPACING = BLOCK;
export const LAMP_LAST = HALF_WORLD - 20; // não invade o arco do antípoda
export const STREET_LAMP_SCALE = 0.8; // postes das ruas: menores que os da avenida
export const STREET_LAMP_ARM = LAMP_ARM * STREET_LAMP_SCALE;

/** Posições dos postes: [{ x, z, ax, az, road }] (ax, az = direção do braço) */
export function lampLayout(arms) {
  const out = [];
  for (const arm of arms) {
    const [dx, dz] = arm.dir;
    const px = -dz;
    const pz = dx;
    for (let s = LAMP_FIRST; s <= LAMP_LAST; s += LAMP_SPACING) {
      for (const side of [-1, 1]) {
        out.push({
          x: dx * s + px * side * LAMP_OFFSET,
          z: dz * s + pz * side * LAMP_OFFSET,
          ax: -px * side,
          az: -pz * side,
          road: dx === 0 ? 'ns' : 'ew',
        });
      }
    }
  }
  return out;
}

/**
 * Postes com braço. Cada item: { x, z, ax, az } + `color` opcional (senão, a cor da avenida).
 * `scale` encolhe o poste inteiro (os das ruas são menores que os das avenidas).
 */
export function createLamps(layout, { scale = 1, shadows = true } = {}) {
  const pole = new THREE.CylinderGeometry(0.09, 0.15, 7, 8).translate(0, 3.5, 0);
  const arm = new THREE.BoxGeometry(LAMP_ARM + 0.3, 0.1, 0.12).translate((LAMP_ARM + 0.3) / 2, 7, 0);
  const cap = new THREE.BoxGeometry(1.5, 0.22, 0.42).translate(LAMP_ARM, 6.95, 0);
  const metal = new THREE.MeshStandardMaterial({ color: '#1b1430', metalness: 0.8, roughness: 0.35 });
  const poles = new THREE.InstancedMesh(mergeGeometries([pole, arm, cap]), metal, layout.length);
  poles.castShadow = shadows;

  // barra de LED embaixo da luminária; algumas lâmpadas estão "com defeito" e piscam
  const head = new THREE.BoxGeometry(1.3, 0.06, 0.28).translate(LAMP_ARM, 6.82, 0);
  const tint = new Float32Array(layout.length * 3);
  layout.forEach((l, i) => {
    const c = new THREE.Color(l.color || (l.road === 'ns' ? '#9ff6ff' : '#ffa6dd'));
    tint.set([c.r, c.g, c.b], i * 3);
  });
  head.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  const headMat = new THREE.ShaderMaterial({
    uniforms: { uTime: ledTime },
    vertexShader: /* glsl */ `
      #include <bend_pars>
      attribute vec3 aTint;
      varying vec3 vTint; varying float vI;
      void main() {
        vTint = aTint; vI = float(gl_InstanceID);
        gl_Position = projectionMatrix * bendView(modelViewMatrix * instanceMatrix * vec4(position, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec3 vTint; varying float vI;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        float broken = step(0.94, hash(vI * 3.7));
        float k = floor(uTime * 18.0 + vI * 7.0);
        float flick = mix(1.0, step(0.35, hash(k)) * step(0.2, fract(uTime * 0.3 + vI)), broken);
        gl_FragColor = vec4(vTint * (0.25 + 2.4 * flick), 1.0);
      }
    `,
  });
  const heads = new THREE.InstancedMesh(head, headMat, layout.length);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const s = new THREE.Vector3(scale, scale, scale);
  layout.forEach((l, i) => {
    q.setFromAxisAngle(up, Math.atan2(-l.az, l.ax));
    m.compose(new THREE.Vector3(l.x, 0, l.z), q, s);
    poles.setMatrixAt(i, m);
    heads.setMatrixAt(i, m);
  });
  return [poles, heads];
}

/* ================================================================== */
/*  Prédios neon (um único draw call para todos)                       */
/* ================================================================== */
const BUILDING_KIND = { normal: 0, deco: 1, warehouse: 2, crown: 3 };
const ACCENTS = ['#00f0ff', '#ff2a9d', '#b26bff', '#ffd319'];

/**
 * Prédios (um único draw call para todos).
 * Cada spec: { x, z, w, d, h, y?, accent?, shop?, deco?, warehouse?, crown? }
 *  - shop: térreo comercial com vitrines acesas e uma faixa luminosa em cima
 *  - deco / warehouse / crown: muda o desenho da fachada
 *
 * Hierarquia de luz: a cidade é o pano de fundo. Os LEDs dela ficam ABAIXO do limiar
 * do bloom (nítidos, sem halo) e parados; brilho forte e movimento são dos projetos.
 */
export function createBuildings(specs) {
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const accent = new Float32Array(specs.length * 3);
  const info = new Float32Array(specs.length * 2);
  const c = new THREE.Color();
  specs.forEach((b, i) => {
    c.set(b.accent || ACCENTS[i % ACCENTS.length]);
    accent.set([c.r, c.g, c.b], i * 3);
    const kind = b.crown ? BUILDING_KIND.crown : b.deco ? BUILDING_KIND.deco : b.warehouse ? BUILDING_KIND.warehouse : 0;
    info.set([b.shop ? 1 : 0, kind], i * 2);
  });
  geo.setAttribute('aAccent', new THREE.InstancedBufferAttribute(accent, 3));
  geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 2));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: ledTime },
    vertexShader: /* glsl */ `
      #include <bend_pars>
      attribute vec3 aAccent;
      attribute vec2 aInfo;
      varying vec3 vLocal; varying vec3 vN; varying vec3 vWorld; varying vec3 vScale; varying float vId;
      varying vec3 vAccent; varying vec2 vInfo;
      void main() {
        vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vScale = sc;
        vLocal = position * sc;
        vN = normal;
        vId = float(gl_InstanceID);
        vAccent = aAccent;
        vInfo = aInfo;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * bendView(viewMatrix * wp);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vLocal; varying vec3 vN; varying vec3 vWorld; varying vec3 vScale; varying float vId;
      varying vec3 vAccent; varying vec2 vInfo;
      ${FOG_GLSL}
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        float h = vScale.y;
        bool shop = vInfo.x > 0.5;
        float kind = vInfo.y;
        bool deco = abs(kind - 1.0) < 0.5;
        bool warehouse = abs(kind - 2.0) < 0.5;
        bool crown = abs(kind - 3.0) < 0.5;
        vec3 accent = mix(vAccent, vec3(1.0), 0.25);
        vec3 col = mix(vec3(0.02, 0.004, 0.045), vec3(0.075, 0.014, 0.12), clamp(vLocal.y / 70.0, 0.0, 1.0));
        // art déco: reboco em tom pastel (escurecido pela noite), puxado para a cor do prédio
        vec3 pastel = mix(vec3(0.07, 0.035, 0.1), vAccent * 0.16, 0.45);
        if (deco) col = pastel * (0.55 + 0.45 * clamp(vLocal.y / 14.0, 0.0, 1.0));
        if (warehouse) col = vec3(0.045, 0.03, 0.06);
        if (abs(vN.y) < 0.5) {
          bool xFace = abs(vN.x) > 0.5;
          float u = xFace ? vLocal.z : vLocal.x;
          float halfW = (xFace ? vScale.z : vScale.x) * 0.5;
          float base = shop ? 4.8 : 1.0; // onde começam as janelas
          // janelas: acendem e apagam devagar, como uma cidade de verdade à noite
          vec2 cell = vec2(u / 1.9, (vLocal.y - (shop ? 4.8 : 0.0)) / 3.0);
          vec2 f = fract(cell);
          vec2 id = floor(cell);
          float win = step(0.28, f.x) * step(f.x, 0.72) * step(0.36, f.y) * step(f.y, 0.7);
          win *= step(base, vLocal.y) * step(vLocal.y, h - 1.2) * step(1.2, halfW - abs(u));
          float r = hash(id + vec2(vId * 13.1, vN.x * 3.0 + vN.z * 5.0));
          float lit = step(0.66, r) * step(0.1, fract(uTime * 0.015 + r * 7.0));
          // brilho varia de janela para janela (luz de abajur, TV, luz branca...)
          lit *= 0.55 + 0.45 * hash(id * 1.31 + vId);
          vec3 wc = r > 0.92 ? vec3(0.45, 0.9, 1.0) : (r > 0.84 ? vec3(1.0, 0.5, 0.85) : vec3(1.0, 0.78, 0.52));
          if (warehouse) {
            // galpão: chapa ondulada, faixa de janelas no alto e portões de carga
            col *= 0.8 + 0.2 * step(0.5, fract(u * 1.4));
            win = step(h - 2.6, vLocal.y) * step(vLocal.y, h - 1.6) * step(0.15, fract(u / 3.0)) * step(1.0, halfW - abs(u));
            lit = 0.7;
            wc = vec3(0.9, 0.8, 0.55);
            float gateCol = step(abs(fract(u / 12.0) - 0.5), 0.18) * step(2.0, halfW - abs(u));
            float gate = gateCol * step(vLocal.y, 4.5);
            col = mix(col, vec3(0.08, 0.06, 0.1) * (0.7 + 0.3 * step(0.5, fract(vLocal.y * 2.5))), gate);
            col += vec3(1.0, 0.55, 0.1) * gateCol * smoothstep(0.12, 0.0, abs(vLocal.y - 4.65)) * 1.6;
          }
          if (deco) {
            // Streamline Moderne: janelas em fita, frisos horizontais e uma coluna de tijolo de vidro no centro
            float fl = fract(vLocal.y / 3.2);
            float floorId = floor(vLocal.y / 3.2);
            float glassCol = step(abs(u), 0.75) * step(1.4, vLocal.y) * step(vLocal.y, h - 0.9) * step(3.5, halfW);
            float ribbon = step(0.36, fl) * step(fl, 0.7) * step(1.1, halfW - abs(u)) * step(1.2, vLocal.y) * step(vLocal.y, h - 1.0) * (1.0 - glassCol);
            float mullion = step(0.08, fract(u / 1.5));
            float rr = hash(vec2(floorId, vId + vN.x * 3.0 + vN.z * 5.0));
            vec3 ribbonLight = rr > 0.7 ? vec3(0.4, 0.85, 1.0) : vec3(1.0, 0.62, 0.8);
            col = mix(col, vec3(0.03, 0.015, 0.06), ribbon);
            col += ribbonLight * ribbon * mullion * step(0.4, rr) * 0.4;
            // frisos: sombra embaixo, luz em cima (relevo)
            float brow = smoothstep(0.05, 0.0, abs(fl - 0.8)) * step(1.2, vLocal.y) * step(vLocal.y, h - 0.8);
            col += pastel * brow * 1.2;
            col = mix(col, accent * (0.22 + 0.08 * step(0.5, fract(vLocal.y * 1.6))), glassCol);
            win = 0.0;
          }
          col += wc * win * lit * 0.5;
          if (shop) {
            // térreo comercial: vitrines acesas, porta e uma faixa luminosa na cor do bairro
            float seg = u / 3.4;
            float fs = fract(seg);
            float pane = step(0.08, fs) * step(fs, 0.92) * step(0.35, vLocal.y) * step(vLocal.y, 3.6) * step(0.6, halfW - abs(u));
            float rs = hash(vec2(floor(seg), vId + vN.x * 2.0 + vN.z * 7.0));
            vec3 glass = rs > 0.7 ? vec3(0.35, 0.8, 0.9) : (rs > 0.4 ? vec3(0.95, 0.62, 0.42) : vec3(0.85, 0.45, 0.75));
            float inner = 0.55 + 0.35 * smoothstep(3.6, 0.6, vLocal.y);
            float closed = step(0.85, rs);
            col = mix(col, glass * inner * mix(0.48, 0.1, closed), pane);
            // faixa luminosa com o mesmo brilho em qualquer cor (o amarelo não estoura o bloom)
            float sign = step(3.95, vLocal.y) * step(vLocal.y, 4.55) * step(0.3, halfW - abs(u));
            float lum = dot(accent, vec3(0.2126, 0.7152, 0.0722));
            col = mix(col, accent * (0.7 / max(lum, 0.3)), sign);
          }
          float roof = smoothstep(0.3, 0.0, h - vLocal.y);
          if (deco) {
            // coroamento: um fio de neon fino, de identidade (não de destaque)
            col += accent * roof * 0.85;
          } else if (!warehouse) {
            // LED parado nas quinas de só uma parte dos prédios; faixas em poucos
            float hasLed = step(0.45, hash(vec2(vId, 7.0)));
            float corner = smoothstep(0.22, 0.06, halfW - abs(u)) * step(shop ? 4.6 : 0.0, vLocal.y) * hasLed;
            float bands = step(0.75, hash(vec2(vId, 3.0))) * smoothstep(0.05, 0.0, abs(fract(vLocal.y / 11.0) - 0.5));
            col += accent * (corner * 0.75 + bands * 0.55 + roof * 0.9);
            if (crown) {
              // torre-símbolo: coroa de LED com anéis subindo devagar (marco da cidade, mas sem gritar)
              float top = smoothstep(h - 14.0, h, vLocal.y);
              float rings = smoothstep(0.12, 0.0, abs(fract(vLocal.y / 2.0 - uTime * 0.15) - 0.5) - 0.38);
              float stripes = smoothstep(0.1, 0.0, abs(fract(u / 4.0) - 0.5) - 0.42);
              col += accent * top * (rings * 0.7 + stripes * 0.45);
            }
          } else col += vec3(1.0, 0.55, 0.1) * roof * 0.8;
        } else if (vN.y > 0.5) {
          vec2 q = abs(vLocal.xz) - (vScale.xz * 0.5 - 0.35);
          float border = smoothstep(0.14, 0.0, abs(max(q.x, q.y)));
          col = (deco ? pastel * 0.35 : vec3(0.02, 0.0, 0.04)) + accent * border * (deco ? 0.6 : 0.5);
        }
        col = mix(col, FOG_COLOR, fogAmount(vWorld) * 0.9);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, specs.length);
  mesh.castShadow = true;
  const m = new THREE.Matrix4();
  specs.forEach((b, i) => {
    m.makeScale(b.w, b.h, b.d);
    m.setPosition(b.x, b.y || 0, b.z);
    mesh.setMatrixAt(i, m);
  });
  return mesh;
}

/** Antenas no topo dos prédios mais altos, com luz de aviso piscando. */
export function createAntennas(specs) {
  const tall = specs.filter((b) => (b.y || 0) + b.h > 38 && !b.crown);
  const mast = new THREE.CylinderGeometry(0.08, 0.2, 9, 6).translate(0, 4.5, 0);
  const masts = new THREE.InstancedMesh(
    mast,
    new THREE.MeshStandardMaterial({ color: '#1b1430', metalness: 0.8, roughness: 0.4 }),
    tall.length,
  );
  const beaconMat = new THREE.ShaderMaterial({
    uniforms: { uTime: ledTime },
    vertexShader: /* glsl */ `
      #include <bend_pars>
      varying float vI;
      void main() {
        vI = float(gl_InstanceID);
        gl_Position = projectionMatrix * bendView(modelViewMatrix * instanceMatrix * vec4(position, 1.0));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying float vI;
      void main() {
        float ph = fract(uTime * 0.55 + vI * 0.37);
        float on = smoothstep(0.0, 0.05, ph) * smoothstep(0.3, 0.12, ph);
        gl_FragColor = vec4(vec3(1.0, 0.12, 0.2) * (0.15 + 0.85 * on), 1.0);
      }
    `,
  });
  const beacons = new THREE.InstancedMesh(new THREE.SphereGeometry(0.35, 10, 8).translate(0, 9.2, 0), beaconMat, tall.length);
  const m = new THREE.Matrix4();
  tall.forEach((b, i) => {
    m.makeTranslation(b.x + b.w * 0.2, (b.y || 0) + b.h, b.z - b.d * 0.15);
    masts.setMatrixAt(i, m);
    beacons.setMatrixAt(i, m);
  });
  return { meshes: [masts, beacons], homes: tall.map((b) => [b.x + b.w * 0.2, b.z - b.d * 0.15]) };
}

/* ================================================================== */
/*  Fliperama: ponto de referência perto da praça                      */
/* ================================================================== */
function neonSignCanvas(text, sub) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 300;
  const ctx = c.getContext('2d');
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.font = `italic 900 150px "Orbitron", sans-serif`;
  // "tubo" de neon: contorno grosso claro (o material multiplica a cor => bloom)
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#ff9ad8';
  ctx.strokeText(text, 512, 175);
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(text, 512, 175);
  if (sub) {
    ctx.font = `34px "Press Start 2P", monospace`;
    ctx.fillStyle = '#9ff6ff';
    ctx.fillText(sub, 512, 262);
  }
  return c;
}

/** Vitrine: silhuetas de máquinas de fliperama com telas coloridas (tudo abaixo de 1 => sem bloom). */
function arcadeWindowCanvas(seed) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 240;
  const ctx = c.getContext('2d');
  const bg = ctx.createLinearGradient(0, 0, 0, 240);
  bg.addColorStop(0, '#12042a');
  bg.addColorStop(1, '#2a0838');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, 512, 240);
  const colors = ['#00c8d8', '#d82a8a', '#d8b419', '#8a5ad8', '#3ad87a'];
  for (let i = 0; i < 5; i++) {
    const x = 18 + i * 100;
    ctx.fillStyle = '#07010f';
    ctx.fillRect(x, 50, 78, 190);
    ctx.fillStyle = colors[(i + seed) % colors.length];
    ctx.fillRect(x + 10, 66, 58, 46);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let k = 0; k < 4; k++) ctx.fillRect(x + 16 + k * 12, 80 + ((k * 7 + i * 5) % 20), 6, 6);
    ctx.fillStyle = colors[(i + seed + 2) % colors.length];
    ctx.fillRect(x + 8, 130, 62, 6);
  }
  return c;
}

export function createArcade() {
  const g = new THREE.Group();
  const W = 20;
  const H = 9;
  const D = 14;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(W, H, D).translate(0, H / 2, 0),
    new THREE.MeshStandardMaterial({ color: '#0e0420', metalness: 0.1, roughness: 0.85, envMapIntensity: 0.3 }),
  );
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);

  // faixa de LED em volta do telhado e nas quinas
  const pink = ledMaterial('#ff2a9d', 2.2);
  const cyan = ledMaterial('#00f0ff', 2.0);
  const roofStrip = new THREE.Mesh(frameGeometry(W + 0.2, 0.25, 0.25), pink);
  roofStrip.position.set(0, H - 0.2, D / 2 + 0.02);
  g.add(roofStrip);
  for (const sx of [-1, 1]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.18, H, 0.18), cyan);
    strip.position.set((sx * W) / 2, H / 2, D / 2);
    g.add(strip);
  }

  // porta de vidro escuro com moldura de LED e uma luz interna suave
  const door = new THREE.Mesh(new THREE.PlaneGeometry(4, 3.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.04, 0.01, 0.07) }));
  door.position.set(0, 1.7, D / 2 + 0.03);
  const doorFrame = new THREE.Mesh(frameGeometry(4.3, 3.7, 0.12), ledMaterial('#00f0ff', 2.0));
  doorFrame.position.set(0, 1.85, D / 2 + 0.05);
  // vitrines laterais com "telas de fliperama" coloridas
  for (const sx of [-1, 1]) {
    const win = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 2.4),
      new THREE.MeshBasicMaterial({ map: canvasTexture(arcadeWindowCanvas(sx > 0 ? 1 : 3)), color: new THREE.Color(0.85, 0.85, 0.85) }),
    );
    win.position.set(sx * 6.5, 2.6, D / 2 + 0.03);
    const wf = new THREE.Mesh(frameGeometry(5.2, 2.6, 0.08), ledMaterial('#ff2a9d', 1.8));
    wf.position.set(sx * 6.5, 2.6, D / 2 + 0.05);
    g.add(win, wf);
  }
  g.add(door, doorFrame);

  // letreiro em neon + lâmpadas correndo em volta
  const sign = new THREE.Group();
  sign.position.set(0, H + 3.4, D / 2 - 1);
  const signBack = new THREE.Mesh(new THREE.PlaneGeometry(17, 5.2), new THREE.MeshBasicMaterial({ color: '#0b0216' }));
  signBack.position.z = -0.05;
  const tex = canvasTexture(neonSignCanvas('ARCADE', 'INSERT COIN · 24H'));
  const letters = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 4.7),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: new THREE.Color(1.5, 1.5, 1.5) }),
  );
  sign.add(signBack, letters, createMarquee(17.4, 5.6, 0.75, '#ffd319', { radius: 0.16 }));
  const legs = new THREE.Mesh(
    mergeGeometries([new THREE.BoxGeometry(0.3, 3.4, 0.3).translate(-6, -2.6, -0.2), new THREE.BoxGeometry(0.3, 3.4, 0.3).translate(6, -2.6, -0.2)]),
    new THREE.MeshStandardMaterial({ color: '#1b1430', metalness: 0.8, roughness: 0.4 }),
  );
  sign.add(legs);
  g.add(sign);
  return { group: g, radius: 11 };
}
