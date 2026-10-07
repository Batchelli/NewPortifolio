import * as THREE from 'three';

/**
 * Céu, estrelas e sol. O grupo acompanha a câmera em X/Z para que
 * o horizonte pareça estar no infinito (o sol nunca "chega perto").
 */
export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    // Cúpula com gradiente
    this.domeMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color('#05000f') },
        uMid: { value: new THREE.Color('#2b0a4d') },
        uHorizon: { value: new THREE.Color('#ff2a8a') },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop; uniform vec3 uMid; uniform vec3 uHorizon;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 col = mix(uMid, uTop, smoothstep(0.05, 0.55, h));
          col = mix(uHorizon * 0.9, col, smoothstep(-0.02, 0.18, h));
          // brilho extra na direção do sol (-Z)
          float sunGlow = pow(max(dot(normalize(vec3(vDir.x, vDir.y * 2.0, vDir.z)), vec3(0.0, 0.08, -1.0)), 0.0), 8.0);
          col += vec3(1.0, 0.25, 0.55) * sunGlow * 0.22;
          if (h < -0.02) col = mix(uHorizon * 0.35, vec3(0.04, 0.0, 0.08), smoothstep(-0.02, -0.2, h));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), this.domeMat);
    dome.renderOrder = -10;
    this.group.add(dome);

    this.addStars();
    this.addSun();
    this.addShootingStar();
  }

  /** Estrela cadente ocasional: um risco de luz que cruza o céu a cada poucos segundos. */
  addShootingStar() {
    this.shootMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uLife: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uLife; varying vec2 vUv;
        void main() {
          // cabeça brilhante (x = 1) e cauda que some; aparece e apaga suavemente
          float tail = pow(clamp(vUv.x, 0.0, 1.0), 3.0);
          float width = smoothstep(0.5, 0.0, abs(vUv.y - 0.5));
          float fade = sin(clamp(uLife, 0.0, 1.0) * 3.14159);
          gl_FragColor = vec4(vec3(1.0, 0.85, 1.0) * tail * width * fade * 2.5, 1.0);
        }
      `,
    });
    this.shoot = new THREE.Mesh(new THREE.PlaneGeometry(160, 2.2), this.shootMat);
    this.shoot.visible = false;
    this.group.add(this.shoot);
    this.nextShoot = 4;
    this.shootT = -1;
    this._dir = new THREE.Vector3();
  }

  updateShootingStar(dt, t) {
    if (this.shootT < 0) {
      if (t < this.nextShoot) return;
      // posição aleatória no alto do céu, longe do sol
      const az = Math.PI * (0.25 + Math.random() * 1.5);
      const el = 0.35 + Math.random() * 0.5;
      const r = 1250;
      this.shootStart = new THREE.Vector3(Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r, -Math.cos(az) * Math.cos(el) * r);
      this.shoot.position.copy(this.shootStart);
      this.shoot.lookAt(this.group.position.x, 0, this.group.position.z);
      this.shoot.rotateZ(-0.4 - Math.random() * 0.5);
      this._dir.set(1, 0, 0).applyQuaternion(this.shoot.quaternion);
      this.shoot.visible = true;
      this.shootT = 0;
    }
    this.shootT += dt / 1.1;
    this.shoot.position.copy(this.shootStart).addScaledVector(this._dir, this.shootT * 420);
    this.shootMat.uniforms.uLife.value = this.shootT;
    if (this.shootT >= 1) {
      this.shoot.visible = false;
      this.shootT = -1;
      this.nextShoot = t + 5 + Math.random() * 9;
    }
  }

  addStars() {
    const count = 1400;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const y = 0.08 + Math.pow(Math.random(), 0.8) * 0.92;
      const r = Math.sqrt(1 - y * y);
      pos.set([Math.cos(theta) * r * 1400, y * 1400, Math.sin(theta) * r * 1400], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.starMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uPR: { value: Math.min(window.devicePixelRatio, 1.5) } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uTime; uniform float uPR;
        varying float vA;
        void main() {
          vA = 0.35 + 0.65 * abs(sin(uTime * (0.5 + aSeed * 2.0) + aSeed * 40.0));
          gl_PointSize = (1.0 + aSeed * 2.2) * uPR;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vec3(1.0, 0.85, 1.0) * vA * 1.4, smoothstep(0.5, 0.0, d));
        }
      `,
    });
    const stars = new THREE.Points(geo, this.starMat);
    stars.renderOrder = -9;
    this.group.add(stars);
  }

  addSun() {
    this.sunMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vec2 p = vUv * 2.0 - 1.0;
          float r = length(p);
          float disc = smoothstep(1.0, 0.985, r);
          float halo = pow(smoothstep(1.5, 0.95, r), 3.0) * 0.3;
          vec3 top = vec3(1.0, 0.82, 0.1) * 1.25;
          vec3 bot = vec3(1.0, 0.08, 0.48) * 1.15;
          vec3 col = mix(bot, top, smoothstep(-0.7, 0.8, p.y));
          // faixas horizontais que descem e ficam mais grossas embaixo
          float stripes = 1.0;
          if (p.y < 0.35) {
            float t = (0.35 - p.y);
            float f = fract(t * 6.0 + uTime * 0.18);
            float w = 0.1 + t * 0.4;
            stripes = step(w, f);
          }
          halo *= smoothstep(0.97, 1.03, r);
          // as faixas mostram um roxo escuro, para contrastar com o disco
          vec3 gapCol = vec3(0.1, 0.01, 0.16);
          vec3 disk = mix(gapCol, col, stripes);
          vec3 glow = vec3(1.0, 0.2, 0.55) * halo;
          gl_FragColor = vec4(disk * disc + glow, max(disc * mix(0.85, 1.0, stripes), halo));
        }
      `,
    });
    const sun = new THREE.Mesh(new THREE.PlaneGeometry(520, 520), this.sunMat);
    sun.position.set(0, 215, -1350);
    sun.renderOrder = -8;
    this.group.add(sun);
  }

  update(dt, t, camera) {
    this.group.position.set(camera.position.x, 0, camera.position.z);
    this.starMat.uniforms.uTime.value = t;
    this.sunMat.uniforms.uTime.value = t;
    this.updateShootingStar(dt, t);
  }
}
