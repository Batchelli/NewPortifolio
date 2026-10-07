import * as THREE from 'three';

export const FONT_HEAD = '"Orbitron", sans-serif';
export const FONT_MONO = '"Share Tech Mono", monospace';
export const FONT_PIXEL = '"Press Start 2P", monospace';

/** Gerador pseudo-aleatório determinístico (mesmo projeto = mesma prévia). */
export function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvasTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8; // leitura nítida mesmo vendo o painel em ângulo
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Canvas com supersampling: desenha em coordenadas lógicas w×h numa resolução `scale` vezes maior. */
function makeCanvas(w, h, scale = 1) {
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d');
  ctx.scale(scale, scale);
  return [c, ctx];
}

/** Texto com contorno escuro: legível sobre qualquer fundo, sem brilho borrado. */
function outlinedText(ctx, text, x, y, outline = 'rgba(8, 0, 20, 0.9)', width = 6) {
  ctx.save();
  ctx.shadowBlur = 0;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = width;
  ctx.strokeText(text, x, y);
  ctx.restore();
  ctx.fillText(text, x, y);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function hexA(hex, a) {
  const c = new THREE.Color(hex);
  return `rgba(${(c.r * 255) | 0},${(c.g * 255) | 0},${(c.b * 255) | 0},${a})`;
}

export function wrapText(ctx, text, maxWidth) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function fitFont(ctx, text, weight, family, maxSize, maxWidth) {
  let size = maxSize;
  do {
    ctx.font = `${weight} ${size}px ${family}`;
    size -= 2;
  } while (ctx.measureText(text).width > maxWidth && size > 12);
}

/* ------------------------------------------------------------------ */
/*  Prévia de projeto: um "print" de site gerado proceduralmente        */
/* ------------------------------------------------------------------ */
export function createPreviewCanvas(item) {
  const W = 1280;
  const H = 720;
  const [c, ctx] = makeCanvas(W, H);
  const rnd = seeded(item.id || item.title);
  const accent = item.color || '#ff2a9d';

  // Fundo
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#0d0221');
  bg.addColorStop(1, hexA(accent, 0.18));
  ctx.fillStyle = '#0d0221';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Grade sutil
  ctx.strokeStyle = hexA(accent, 0.07);
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 56);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 56; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // Barra do navegador
  ctx.fillStyle = '#170a2c';
  ctx.fillRect(0, 0, W, 56);
  ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(30 + i * 26, 28, 8, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.fillStyle = '#25133f';
  roundRect(ctx, 130, 14, 560, 28, 14);
  ctx.fill();
  ctx.fillStyle = '#a796c7';
  ctx.font = `18px ${FONT_MONO}`;
  ctx.fillText(`https://${(item.id || 'projeto').toLowerCase()}.dev`, 150, 34);

  // Navegação
  ctx.fillStyle = accent;
  roundRect(ctx, 60, 88, 34, 34, 8);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `700 22px ${FONT_HEAD}`;
  ctx.fillText(item.title.toUpperCase(), 108, 114);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 4; i++) {
    roundRect(ctx, W - 520 + i * 110, 98, 80, 12, 6);
    ctx.fill();
  }

  // Hero
  ctx.fillStyle = hexA(accent, 0.18);
  roundRect(ctx, 60, 170, 250, 36, 18);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.font = `18px ${FONT_MONO}`;
  ctx.fillText(`● ${item.year || ''} · ${(item.tags && item.tags[0]) || 'WEB'}`, 80, 194);

  ctx.fillStyle = '#ffffff';
  fitFont(ctx, item.title, 900, FONT_HEAD, 74, 600);
  ctx.fillText(item.title, 60, 290);

  ctx.fillStyle = '#cbbbe6';
  ctx.font = `28px ${FONT_MONO}`;
  wrapText(ctx, item.subtitle || '', 560)
    .slice(0, 2)
    .forEach((l, i) => ctx.fillText(l, 60, 345 + i * 36));

  ctx.fillStyle = accent;
  roundRect(ctx, 60, 420, 210, 58, 10);
  ctx.fill();
  ctx.fillStyle = '#0d0221';
  ctx.font = `700 18px ${FONT_HEAD}`;
  ctx.fillText('VER PROJETO', 92, 456);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  roundRect(ctx, 290, 420, 170, 58, 10);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.fillText('SAIBA MAIS', 312, 456);

  // Cartão principal (varia conforme o projeto)
  const cx = 700;
  const cy = 160;
  const cw = 520;
  const ch = 330;
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  roundRect(ctx, cx, cy, cw, ch, 18);
  ctx.fill();
  ctx.strokeStyle = hexA(accent, 0.5);
  ctx.lineWidth = 2;
  ctx.stroke();

  const variant = Math.floor(rnd() * 3);
  if (variant === 0) {
    // Gráfico de barras + linha
    const n = 9;
    const bw = (cw - 80) / n;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const h = 60 + rnd() * 190;
      const x = cx + 40 + i * bw;
      const grad = ctx.createLinearGradient(0, cy + ch - 30 - h, 0, cy + ch - 30);
      grad.addColorStop(0, accent);
      grad.addColorStop(1, hexA(accent, 0.1));
      ctx.fillStyle = grad;
      roundRect(ctx, x + 6, cy + ch - 30 - h, bw - 12, h, 6);
      ctx.fill();
      pts.push([x + bw / 2, cy + ch - 50 - h * (0.6 + rnd() * 0.3)]);
    }
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  } else if (variant === 1) {
    // Conversa / mensagens
    for (let i = 0; i < 5; i++) {
      const mine = i % 2 === 1;
      const w = 180 + rnd() * 200;
      const x = mine ? cx + cw - 30 - w : cx + 30;
      const y = cy + 28 + i * 60;
      ctx.fillStyle = mine ? accent : 'rgba(255,255,255,0.12)';
      roundRect(ctx, x, y, w, 44, 16);
      ctx.fill();
      ctx.fillStyle = mine ? 'rgba(13,2,33,0.5)' : 'rgba(255,255,255,0.35)';
      roundRect(ctx, x + 16, y + 16, w - 60, 12, 6);
      ctx.fill();
    }
  } else {
    // Grade de cards
    for (let r = 0; r < 2; r++) {
      for (let col = 0; col < 3; col++) {
        const x = cx + 26 + col * 160;
        const y = cy + 24 + r * 152;
        ctx.fillStyle = hexA(accent, 0.15 + rnd() * 0.25);
        roundRect(ctx, x, y, 144, 92, 10);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        roundRect(ctx, x, y + 104, 110, 10, 5);
        ctx.fill();
        ctx.fillStyle = accent;
        roundRect(ctx, x, y + 122, 60, 10, 5);
        ctx.fill();
      }
    }
  }

  // Cards de features
  for (let i = 0; i < 3; i++) {
    const x = 60 + i * 400;
    const y = 540;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(ctx, x, y, 370, 130, 14);
    ctx.fill();
    ctx.fillStyle = hexA(accent, 0.8);
    ctx.beginPath();
    ctx.arc(x + 46, y + 46, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `20px ${FONT_MONO}`;
    ctx.fillText((item.tags && item.tags[i]) || 'Feature', x + 82, y + 54);
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    roundRect(ctx, x + 26, y + 88, 300, 10, 5);
    ctx.fill();
    roundRect(ctx, x + 26, y + 106, 200, 10, 5);
    ctx.fill();
  }

  return c;
}

/** Desenha uma imagem real (print do projeto) num canvas 16:9 com corte central. */
export function imageToPreviewCanvas(img) {
  const [c, ctx] = makeCanvas(1280, 720);
  const s = Math.max(1280 / img.width, 720 / img.height);
  const w = img.width * s;
  const h = img.height * s;
  ctx.drawImage(img, (1280 - w) / 2, (720 - h) / 2, w, h);
  return c;
}

/* ------------------------------------------------------------------ */
/*  Cards especiais: Sobre mim / Contato                                */
/* ------------------------------------------------------------------ */
export function createProfileCanvas(owner, kind) {
  const W = 1280;
  const H = 720;
  const [c, ctx] = makeCanvas(W, H);
  const accent = kind === 'about' ? '#00f0ff' : '#ffd319';

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#12002a');
  bg.addColorStop(1, '#3a0244');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Sol retrô ao fundo
  const sx = 960;
  const sy = 330;
  const sg = ctx.createLinearGradient(0, sy - 230, 0, sy + 230);
  sg.addColorStop(0, '#ffd319');
  sg.addColorStop(1, '#ff2a9d');
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, 230, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = sg;
  ctx.fillRect(sx - 230, sy - 230, 460, 460);
  ctx.fillStyle = '#250134';
  for (let i = 0; i < 7; i++) ctx.fillRect(sx - 240, sy + 20 + i * 32, 480, 6 + i * 2.5);
  ctx.restore();

  ctx.fillStyle = accent;
  ctx.font = `28px ${FONT_PIXEL}`;
  ctx.fillText(kind === 'about' ? 'SOBRE MIM' : 'CONTATO', 80, 130);

  ctx.fillStyle = '#fff';
  fitFont(ctx, owner.name.toUpperCase(), 900, FONT_HEAD, 72, 760);
  ctx.fillText(owner.name.toUpperCase(), 80, 250);

  ctx.fillStyle = '#ff5ec4';
  ctx.font = `34px ${FONT_MONO}`;
  ctx.fillText(owner.role, 80, 310);

  if (kind === 'about') {
    let x = 80;
    let y = 400;
    ctx.font = `26px ${FONT_MONO}`;
    for (const s of owner.skills.slice(0, 8)) {
      const w = ctx.measureText(s).width + 36;
      if (x + w > 760) {
        x = 80;
        y += 64;
      }
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, w, 46, 6);
      ctx.stroke();
      ctx.fillStyle = accent;
      ctx.fillText(s, x + 18, y + 32);
      x += w + 14;
    }
  } else {
    ctx.font = `34px ${FONT_MONO}`;
    owner.links.forEach((l, i) => {
      ctx.fillStyle = accent;
      ctx.fillText('▶', 80, 420 + i * 70);
      ctx.fillStyle = '#fff';
      ctx.fillText(l.label, 130, 420 + i * 70);
    });
  }
  return c;
}

/* ------------------------------------------------------------------ */
/*  Painel de informações que "desliza" para fora do holograma          */
/* ------------------------------------------------------------------ */
export const INFO_W = 800;
export const INFO_H = 760;

export function createInfoCanvas(item, actionLabel) {
  const [c, ctx] = makeCanvas(INFO_W, INFO_H, 1.5);
  const accent = item.color || '#ff2a9d';

  ctx.fillStyle = 'rgba(10, 2, 24, 0.95)';
  ctx.beginPath();
  ctx.moveTo(30, 0);
  ctx.lineTo(INFO_W, 0);
  ctx.lineTo(INFO_W, INFO_H - 30);
  ctx.lineTo(INFO_W - 30, INFO_H);
  ctx.lineTo(0, INFO_H);
  ctx.lineTo(0, 30);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = accent;
  ctx.fillRect(0, 96, INFO_W, 3);

  ctx.font = `20px ${FONT_PIXEL}`;
  ctx.fillStyle = accent;
  ctx.fillText(item.kind === 'project' ? `PROJETO #${String(item.index + 1).padStart(2, '0')}` : 'TERMINAL', 40, 62);
  if (item.year) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffd319';
    ctx.fillText(String(item.year), INFO_W - 40, 62);
    ctx.textAlign = 'left';
  }

  ctx.fillStyle = '#fff';
  fitFont(ctx, item.title, 900, FONT_HEAD, 58, INFO_W - 80);
  ctx.fillText(item.title, 40, 180);

  ctx.fillStyle = '#ff8fd8';
  ctx.font = `30px ${FONT_MONO}`;
  ctx.fillText(item.subtitle || '', 40, 230);

  ctx.fillStyle = '#ece4fa';
  ctx.font = `31px ${FONT_MONO}`;
  const lines = wrapText(ctx, item.description || '', INFO_W - 80).slice(0, 6);
  lines.forEach((l, i) => ctx.fillText(l, 40, 300 + i * 40));

  // Tags
  let x = 40;
  let y = 300 + lines.length * 40 + 30;
  ctx.font = `24px ${FONT_MONO}`;
  for (const t of item.tags || []) {
    const w = ctx.measureText(t).width + 28;
    if (x + w > INFO_W - 40) {
      x = 40;
      y += 54;
    }
    ctx.fillStyle = hexA(accent, 0.15);
    roundRect(ctx, x, y, w, 40, 4);
    ctx.fill();
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.fillText(t, x + 14, y + 28);
    x += w + 12;
  }

  // Ação
  const by = INFO_H - 120;
  ctx.fillStyle = '#ffd319';
  roundRect(ctx, 40, by, 64, 64, 8);
  ctx.fill();
  ctx.fillStyle = '#12002a';
  ctx.font = `30px ${FONT_PIXEL}`;
  ctx.fillText('E', 57, by + 48);
  ctx.fillStyle = '#ffd319';
  ctx.font = `22px ${FONT_PIXEL}`;
  ctx.fillText(actionLabel, 128, by + 44);

  return c;
}

/** Rótulo flutuante acima do holograma. */
export function createLabelCanvas(text, color, sub) {
  const [c, ctx] = makeCanvas(1024, 160, 1.5);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  fitFont(ctx, text.toUpperCase(), 900, FONT_HEAD, 64, 980);
  outlinedText(ctx, text.toUpperCase(), 512, 78, 'rgba(8, 0, 20, 0.85)', 8);
  if (sub) {
    ctx.fillStyle = color;
    ctx.font = `22px ${FONT_PIXEL}`;
    outlinedText(ctx, sub, 512, 136, 'rgba(8, 0, 20, 0.85)', 6);
  }
  return c;
}

/** Placas de sinalização e letreiros. */
/**
 * Placa-diretório da avenida: nome da via, sentido e a lista dos projetos daquele trecho,
 * cada um com o losango numerado na cor dele e a distância a partir da placa.
 * rows: [{ mark, title, color, dist, circle }]
 */
export const DIRECTORY_W = 1024;
export function directoryHeight(rows) {
  return 236 + rows * 92 + 24;
}
export function createDirectoryCanvas(road, subtitle, rows, color) {
  const w = DIRECTORY_W;
  const h = directoryHeight(rows.length);
  const [c, ctx] = makeCanvas(w, h, 1.5);
  ctx.fillStyle = 'rgba(10, 0, 24, 0.9)';
  roundRect(ctx, 6, 6, w - 12, h - 12, 22);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.stroke();

  // cabeçalho
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  fitFont(ctx, road, 900, FONT_HEAD, 84, w - 100);
  ctx.fillText(road, w / 2, 112);
  ctx.fillStyle = color;
  fitFont(ctx, subtitle, 400, FONT_PIXEL, 26, w - 100);
  ctx.fillText(subtitle, w / 2, 168);
  ctx.fillStyle = hexA(color, 0.45);
  ctx.fillRect(60, 202, w - 120, 3);

  // linhas: ◆01  NOME DO PROJETO ............ 12 m
  rows.forEach((r, i) => {
    const y = 236 + i * 92 + 46;
    const ix = 96;
    ctx.fillStyle = r.color;
    ctx.beginPath();
    if (r.circle) ctx.arc(ix, y, 30, 0, Math.PI * 2);
    else {
      ctx.moveTo(ix, y - 36);
      ctx.lineTo(ix + 36, y);
      ctx.lineTo(ix, y + 36);
      ctx.lineTo(ix - 36, y);
      ctx.closePath();
    }
    ctx.fill();
    ctx.fillStyle = '#0a0014';
    ctx.textAlign = 'center';
    ctx.font = `900 ${r.circle ? 30 : 24}px ${FONT_HEAD}`;
    ctx.fillText(r.mark, ix, y + (r.circle ? 11 : 9));

    ctx.textAlign = 'right';
    ctx.fillStyle = hexA(r.color, 0.95);
    ctx.font = `34px ${FONT_MONO}`;
    const dist = `${r.dist} m`;
    ctx.fillText(dist, w - 70, y + 12);
    const distW = ctx.measureText(dist).width;

    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    fitFont(ctx, r.title.toUpperCase(), 700, FONT_HEAD, 46, w - 160 - 70 - distW - 30);
    ctx.fillText(r.title.toUpperCase(), 160, y + 16);
  });
  return c;
}

export function createSignCanvas(lines, color, w = 1024, h = 256) {
  const [c, ctx] = makeCanvas(w, h, 1.5);
  ctx.fillStyle = 'rgba(10, 0, 24, 0.92)';
  roundRect(ctx, 6, 6, w - 12, h - 12, 18);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.stroke();
  // o brilho da borda vem do material neon (bloom); o texto fica limpo
  ctx.textAlign = 'center';
  const step = h / (lines.length + 1);
  lines.forEach((l, i) => {
    ctx.fillStyle = l.color || '#fff';
    fitFont(ctx, l.text, l.weight || 900, l.font || FONT_HEAD, l.size || 72, w - 80);
    ctx.fillText(l.text, w / 2, step * (i + 1) + (l.size || 72) * 0.35);
  });
  return c;
}
