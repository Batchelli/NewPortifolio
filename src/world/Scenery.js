import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { wrapDelta } from '../core/Planet.js';

const HAZE = new THREE.Color('#3a0a4a');

/* ------------------------------------------------------------------ */
/*  Anel de montanhas em wireframe neon ao redor do mundo               */
/* ------------------------------------------------------------------ */
export function createMountains({ radius = 560, depth = 220, segU = 360, segV = 26 } = {}) {
  const noise = new SimplexNoise({ random: mulberry(7) });
  const positions = [];
  const grid = [];
  const heights = [];
  const indices = [];

  for (let j = 0; j <= segV; j++) {
    const v = j / segV;
    for (let i = 0; i <= segU; i++) {
      const u = i / segU;
      const theta = u * Math.PI * 2;
      const r = radius + v * depth;
      const x = Math.sin(theta) * r;
      const z = -Math.cos(theta) * r;
      // abertura ao norte (direção do sol e da avenida principal)
      const wrapped = Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta)));
      const gap = THREE.MathUtils.smoothstep(wrapped, 0.1, 0.55);
      const envelope = Math.sin(Math.PI * Math.min(v * 1.15, 1)) ** 0.8;
      let n = noise.noise(x * 0.006, z * 0.006) * 0.6 + noise.noise(x * 0.018, z * 0.018) * 0.3;
      n = Math.abs(n) * 1.4 + 0.15;
      const h = n * envelope * (60 + 70 * gap) * (0.25 + 0.75 * gap);
      positions.push(x, h, z);
      grid.push(i, j);
      heights.push(h);
    }
  }
  const row = segU + 1;
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aGrid', new THREE.Float32BufferAttribute(grid, 2));
  geo.setIndex(indices);

  const mat = new THREE.ShaderMaterial({
    fog: false,
    side: THREE.DoubleSide,
    uniforms: { uHaze: { value: HAZE } },
    vertexShader: /* glsl */ `
      attribute vec2 aGrid;
      varying vec2 vGrid; varying float vH; varying vec3 vWorld;
      void main() {
        vGrid = aGrid; vH = position.y;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uHaze;
      varying vec2 vGrid; varying float vH; varying vec3 vWorld;
      void main() {
        vec2 fw = fwidth(vGrid);
        vec2 g = abs(fract(vGrid - 0.5) - 0.5) / max(fw, 1e-4);
        float line = 1.0 - smoothstep(0.0, 1.2, min(g.x, g.y));
        float hN = clamp(vH / 110.0, 0.0, 1.0);
        vec3 lineCol = mix(vec3(1.0, 0.1, 0.7), vec3(0.0, 0.95, 1.0), hN);
        vec3 fill = mix(vec3(0.05, 0.0, 0.1), vec3(0.12, 0.02, 0.2), hN);
        // fundo: linhas abaixo do bloom e mergulhadas na névoa, para não competir com os projetos
        vec3 col = fill + lineCol * line * (0.26 + hN * 0.22);
        float dist = length(vWorld.xz - cameraPosition.xz);
        col = mix(col, uHaze, 0.25 + smoothstep(300.0, 900.0, dist) * 0.55);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return new THREE.Mesh(geo, mat);
}

/* ------------------------------------------------------------------ */
/*  Skyline da cidade com janelas acesas (1 draw call)                  */
/* ------------------------------------------------------------------ */
export function createCity({ count = 110, zNear = -780, zFar = -920, span = 520 } = {}) {
  const rnd = mulberry(42);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.ShaderMaterial({
    fog: false,
    uniforms: { uTime: { value: 0 }, uHaze: { value: HAZE } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vN; varying float vSeed; varying float vTop;
      void main() {
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vN = normal;
        vSeed = fract(instanceMatrix[3].x * 0.137 + instanceMatrix[3].z * 0.071);
        vTop = instanceMatrix[1].y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uHaze;
      varying vec3 vWorld; varying vec3 vN; varying float vSeed; varying float vTop;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        vec3 col = mix(vec3(0.03, 0.0, 0.07), vec3(0.12, 0.01, 0.16), clamp(vWorld.y / 160.0, 0.0, 1.0));
        if (abs(vN.y) < 0.5) {
          float h = abs(vN.x) > 0.5 ? vWorld.z : vWorld.x;
          vec2 cell = vec2(h / 3.2, vWorld.y / 4.0);
          vec2 f = fract(cell);
          vec2 id = floor(cell);
          float win = step(0.25, f.x) * step(f.x, 0.75) * step(0.3, f.y) * step(f.y, 0.75);
          float r = hash(id + vSeed * 91.0);
          float lit = step(0.78, r);
          // janelas acendem/apagam devagar (nada de pisca-pisca que cansa a vista)
          float blink = step(0.08, fract(uTime * 0.015 + r * 13.0));
          vec3 wc = r > 0.93 ? vec3(0.0, 0.9, 1.0) : (r > 0.86 ? vec3(1.0, 0.2, 0.7) : vec3(1.0, 0.75, 0.35));
          col += wc * win * lit * blink * 0.5;
          // contorno neon no topo de alguns prédios
          float edge = smoothstep(0.8, 0.0, vTop - vWorld.y) * step(0.6, vSeed);
          col += vec3(1.0, 0.15, 0.6) * edge * 0.4;
        }
        float dist = length(vWorld.xz - cameraPosition.xz);
        col = mix(col, uHaze, smoothstep(300.0, 1100.0, dist) * 0.4);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4();
  for (let i = 0; i < count; i++) {
    const x = (rnd() * 2 - 1) * span;
    const center = 1 - Math.abs(x) / span;
    // mais baixos no centro, para emoldurar o sol
    const h = 10 + rnd() * 26 + (1 - center) * 70 * rnd();
    const w = 12 + rnd() * 26;
    const d = 12 + rnd() * 26;
    m.makeScale(w, h, d);
    m.setPosition(x, 0, zNear + (zFar - zNear) * rnd());
    mesh.setMatrixAt(i, m);
  }
  mesh.frustumCulled = false;
  return mesh;
}

/* ------------------------------------------------------------------ */
/*  Palmeiras (geometria procedural + InstancedMesh)                    */
/* ------------------------------------------------------------------ */
function createPalmGeometry() {
  const parts = [];
  const H = 9;
  const trunk = new THREE.CylinderGeometry(0.16, 0.34, H, 7, 14, true);
  trunk.translate(0, H / 2, 0);
  const p = trunk.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = y / H;
    p.setX(i, p.getX(i) + t * t * 1.4);
    // anéis do tronco
    const ring = 1 + 0.08 * Math.sin(y * 9);
    p.setX(i, p.getX(i) * ring);
    p.setZ(i, p.getZ(i) * ring);
  }
  trunk.computeVertexNormals();
  parts.push(trunk.toNonIndexed());

  const top = new THREE.Vector3(1.4, H, 0);
  const fronds = 8;
  for (let f = 0; f < fronds; f++) {
    const len = 4.2 + (f % 3) * 0.5;
    const leaf = new THREE.PlaneGeometry(len, 1.1, 10, 2);
    leaf.translate(len / 2, 0, 0);
    const lp = leaf.attributes.position;
    for (let i = 0; i < lp.count; i++) {
      const x = lp.getX(i);
      const t = x / len;
      const width = Math.sin(Math.PI * Math.min(t * 1.1, 1)) * (1 - t * 0.4);
      lp.setY(i, lp.getY(i) * width);
      lp.setZ(i, -t * t * 2.4 + 0.6 * t); // curva para baixo
    }
    leaf.rotateX(-Math.PI / 2);
    leaf.rotateZ(0.1);
    leaf.rotateY((f / fronds) * Math.PI * 2 + (f % 2) * 0.2);
    leaf.translate(top.x, top.y, top.z);
    leaf.computeVertexNormals();
    parts.push(leaf.toNonIndexed());
  }
  parts.forEach((g) => {
    for (const key of Object.keys(g.attributes)) if (key !== 'position' && key !== 'normal') g.deleteAttribute(key);
  });
  return mergeGeometries(parts);
}

export function createPalms(points) {
  const geo = createPalmGeometry();
  const mat = new THREE.MeshStandardMaterial({
    color: '#26073a',
    emissive: '#1a0230',
    roughness: 0.85,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, points.length);
  const rnd = mulberry(3);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  points.forEach((pt, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
    const k = 0.85 + rnd() * 0.45;
    s.set(k, k, k);
    m.compose(new THREE.Vector3(pt[0], 0, pt[1]), q, s);
    mesh.setMatrixAt(i, m);
  });
  return mesh;
}

/* ------------------------------------------------------------------ */
/*  Pirâmides wireframe espalhadas pelos campos                         */
/* ------------------------------------------------------------------ */
export function createPyramids(items) {
  const geo = new THREE.ConeGeometry(1, 1, 4, 1);
  geo.translate(0, 0.5, 0);
  const fill = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#0d0019' }), items.length);
  const wire = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: '#ffffff', wireframe: true }), items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const palette = ['#00f0ff', '#ff2a9d', '#b26bff', '#ffd319'].map((c) => new THREE.Color(c).multiplyScalar(0.8));
  items.forEach((it, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot);
    m.compose(new THREE.Vector3(it.x, 0, it.z), q, new THREE.Vector3(it.r, it.h, it.r));
    fill.setMatrixAt(i, m);
    m.compose(new THREE.Vector3(it.x, 0, it.z), q, new THREE.Vector3(it.r * 1.01, it.h * 1.01, it.r * 1.01));
    wire.setMatrixAt(i, m);
    wire.setColorAt(i, palette[i % palette.length]);
  });
  return [fill, wire];
}

/**
 * Mantém cada instância de um InstancedMesh na cópia do mundo mais próxima da câmera.
 * Só reescreve as matrizes quando a câmera anda o suficiente.
 */
export class WrappedInstances {
  constructor(meshes, homes) {
    this.meshes = meshes;
    this.homes = homes; // [[x, z], ...] na mesma ordem das instâncias
    this.lastX = Infinity;
    this.lastZ = Infinity;
    for (const mesh of meshes) mesh.frustumCulled = false;
  }

  update(cam) {
    if (Math.abs(cam.x - this.lastX) < 2 && Math.abs(cam.z - this.lastZ) < 2) return;
    this.lastX = cam.x;
    this.lastZ = cam.z;
    for (const mesh of this.meshes) {
      const a = mesh.instanceMatrix.array;
      for (let i = 0; i < this.homes.length; i++) {
        const [hx, hz] = this.homes[i];
        a[i * 16 + 12] = cam.x + wrapDelta(hx - cam.x);
        a[i * 16 + 14] = cam.z + wrapDelta(hz - cam.z);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

export function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
