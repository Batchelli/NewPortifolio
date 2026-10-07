import * as THREE from 'three';
import { ledTime, ledMaterial } from './neon.js';

/** Textura do letreiro: texto branco sobre preto, que o shader transforma em pontos de LED. */
function marqueeTexture(text) {
  const c = document.createElement('canvas');
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '40px "Press Start 2P", monospace';
  c.width = Math.min(8192, Math.ceil(ctx.measureText(text).width) + 64);
  ctx.font = '40px "Press Start 2P", monospace';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return { tex, aspect: c.width / c.height };
}

/**
 * Dirigível que circula a praça com um painel de LED rolando o seu nome.
 * O painel imita uma matriz de LEDs: cada "pixel" é um ponto redondo que acende.
 */
export function createBlimp(text) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: '#221338', metalness: 0.6, roughness: 0.45 });

  const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), metal);
  hull.scale.set(15, 4.4, 4.4);
  hull.castShadow = true;
  g.add(hull);
  const gondola = new THREE.Mesh(new THREE.BoxGeometry(5, 1.2, 1.8), metal);
  gondola.position.y = -4.6;
  g.add(gondola);
  for (const [y, z, rx] of [[2.6, 0, 0], [-2.6, 0, 0], [0, 2.6, Math.PI / 2], [0, -2.6, Math.PI / 2]]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.6, 0.18), metal);
    fin.position.set(-13, y, z);
    fin.rotation.x = rx;
    g.add(fin);
  }
  // faixa de LED ao longo do casco (raio = casco em x = ±6, para ficar colada nele e atrás do painel)
  const stripe = new THREE.Mesh(new THREE.TorusGeometry(4.4 * Math.sqrt(1 - (6 / 15) ** 2) + 0.04, 0.08, 6, 64), ledMaterial('#ff2a9d', 2.2));
  stripe.rotation.y = Math.PI / 2;
  stripe.position.x = 6;
  g.add(stripe);
  const stripe2 = stripe.clone();
  stripe2.position.x = -6;
  g.add(stripe2);

  // luzes de navegação piscando (vermelha / verde)
  const nav = (hex, z, phase) => {
    const mat = ledMaterial(hex, 3);
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6), mat);
    m.position.set(-14.2, 0, z);
    m.userData.phase = phase;
    m.userData.base = mat.color.clone();
    g.add(m);
    return m;
  };
  const navLights = [nav('#ff2040', 2.6, 0), nav('#20ff80', -2.6, 0.5)];

  // painéis de LED (um de cada lado; os dois leem da esquerda para a direita)
  // ficam à frente do ponto mais largo do casco (raio 4.4) para nada atravessar o letreiro
  const { tex, aspect } = marqueeTexture(text);
  const PW = 18;
  const PH = 2.4;
  const ledMat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex },
      uTime: ledTime,
      uRepeat: { value: (PW / PH) / aspect },
      uColor: { value: new THREE.Color('#ffb347') },
    },
    vertexShader: /* glsl */ `
      #include <bend_pars>
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * bendView(modelViewMatrix * vec4(position, 1.0)); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap; uniform float uTime, uRepeat; uniform vec3 uColor;
      varying vec2 vUv;
      void main() {
        vec2 grid = vec2(180.0, 24.0);
        vec2 cellId = floor(vUv * grid);
        vec2 cellUv = fract(vUv * grid) - 0.5;
        vec2 center = (cellId + 0.5) / grid;
        // amostra o texto no centro de cada "LED" (fica pixelado como um painel de verdade)
        float on = texture2D(uMap, vec2(center.x * uRepeat + uTime * 0.035, center.y)).r;
        float dotMask = smoothstep(0.48, 0.3, length(cellUv));
        vec3 col = uColor * dotMask * (0.06 + on * 2.6);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  for (const side of [1, -1]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), ledMat);
    panel.position.set(0, 0.2, side * 4.7);
    panel.rotation.y = side > 0 ? 0 : Math.PI;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(PW + 0.6, PH + 0.6), new THREE.MeshBasicMaterial({ color: '#07010f' }));
    back.position.set(0, 0.2, side * 4.66);
    back.rotation.y = panel.rotation.y;
    g.add(back, panel);
  }

  return {
    group: g,
    update(t) {
      for (const n of navLights) {
        const on = (t * 0.8 + n.userData.phase) % 1 < 0.15 ? 1 : 0.15;
        n.material.color.copy(n.userData.base).multiplyScalar(on);
      }
    },
  };
}

/** Vaga-lumes / poeira de luz flutuando em volta do jogador (o volume acompanha a câmera). */
export function createFireflies(count = 360, box = 110) {
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(count * 3);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: ledTime, uBox: { value: box }, uPR: { value: Math.min(window.devicePixelRatio, 1.5) } },
    vertexShader: /* glsl */ `
      #include <bend_pars>
      uniform float uTime, uBox, uPR;
      attribute vec3 aSeed;
      varying float vA; varying vec3 vCol;
      void main() {
        vec3 p;
        p.xz = aSeed.xz * uBox + vec2(sin(uTime * 0.21 + aSeed.y * 40.0), cos(uTime * 0.17 + aSeed.x * 40.0)) * 3.0;
        // volume repetido em volta da câmera: sempre há partículas perto, sem nunca acabar
        p.xz = cameraPosition.xz + mod(p.xz - cameraPosition.xz + uBox * 0.5, uBox) - uBox * 0.5;
        p.y = 0.6 + aSeed.y * 10.0 + sin(uTime * 0.6 + aSeed.z * 30.0) * 0.7;
        float edge = smoothstep(uBox * 0.5, uBox * 0.3, length(p.xz - cameraPosition.xz));
        vA = edge * (0.4 + 0.6 * abs(sin(uTime * (0.8 + aSeed.x) + aSeed.z * 20.0)));
        vCol = aSeed.z > 0.5 ? vec3(1.0, 0.45, 0.85) : vec3(0.45, 0.95, 1.0);
        vec4 mv = bendView(viewMatrix * vec4(p, 1.0));
        gl_PointSize = (6.0 + aSeed.x * 8.0) * uPR * 10.0 / max(-mv.z, 1.0);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA; varying vec3 vCol;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vCol * a * vA * 1.5, 1.0);
      }
    `,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}
