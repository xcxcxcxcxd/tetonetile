// Generates a product image (SVG) from a colour + format so that every product,
// quote line and invoice line has a picture before real photos are uploaded.
// Hand-made look: per-tile shade jitter, chiselled (slightly irregular) edges,
// glaze sheen on glazed tiles, iron speckles on natural clay.

function hashStr(s) {
  let h = 2166136261;
  for (const ch of String(s)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x888888;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.min(1, Math.max(0, s));
  l = Math.min(1, Math.max(0, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

const f1 = (n) => Math.round(n * 10) / 10;

function polygon(points) {
  return `M${points.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L')}Z`;
}

/**
 * opts: { hex, shape: square|hexagon|rect|custom, finish: glazed|natural, painted, tileCm, seed, size }
 */
export function swatchSvg(opts = {}) {
  const size = opts.size || 240;
  const finish = opts.finish === 'natural' ? 'natural' : 'glazed';
  const painted = !!opts.painted;
  const shape = opts.shape || 'square';
  const r = rng(hashStr(opts.seed || `${opts.hex}${shape}`));
  const [h0, s0, l0] = hexToHsl(opts.hex || '#8a8a8a');
  const grout = finish === 'natural' ? '#d8cdbf' : '#ebe5dc';
  const jit = finish === 'natural' ? 0.05 : 0.09;
  const shade = () => hslToHex(h0 + (r() - 0.5) * 6, s0 + (r() - 0.5) * 0.1, l0 + (r() - 0.5) * jit * (l0 > 0.85 ? 0.5 : 1));
  const wob = (v) => v + (r() - 0.5) * 1.6;
  const shapes = [];

  const addTile = (pts, cx, cy, w) => {
    const d = polygon(pts.map(([x, y]) => [wob(x), wob(y)]));
    if (painted) {
      shapes.push(`<path d="${d}" fill="${hslToHex(40, 0.35, 0.93 + (r() - 0.5) * 0.03)}"/>`);
      const s = w * 0.3;
      const sq = (rot) => {
        const pts2 = [0, 1, 2, 3].map((k) => {
          const a = rot + (Math.PI / 2) * k + Math.PI / 4;
          return [cx + Math.cos(a) * s * Math.SQRT2 * 0.72, cy + Math.sin(a) * s * Math.SQRT2 * 0.72];
        });
        return polygon(pts2);
      };
      const ink = shade();
      shapes.push(`<path d="${sq(0)}" fill="${ink}"/><path d="${sq(Math.PI / 4)}" fill="${ink}"/>`);
      shapes.push(`<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(s * 0.32)}" fill="#f4efe6"/>`);
      shapes.push(`<path d="${d}" fill="url(#sheen)" opacity=".45"/>`);
      return;
    }
    shapes.push(`<path d="${d}" fill="${shade()}"/>`);
    if (finish === 'natural') {
      const n = 3 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) {
        shapes.push(`<circle cx="${f1(cx + (r() - 0.5) * w * 0.7)}" cy="${f1(cy + (r() - 0.5) * w * 0.7)}" r="${f1(0.5 + r() * 1.1)}" fill="#5a2e16" opacity=".28"/>`);
      }
    } else {
      shapes.push(`<path d="${d}" fill="url(#sheen)" opacity="${f1(0.35 + r() * 0.35)}"/>`);
      if (r() < 0.35) {
        const x = cx + (r() - 0.5) * w * 0.6;
        const y = cy + (r() - 0.5) * w * 0.6;
        shapes.push(`<path d="M${f1(x)} ${f1(y)}l${f1((r() - 0.5) * w * 0.4)} ${f1((r() - 0.5) * w * 0.4)}" stroke="#000" stroke-opacity=".08" stroke-width=".6" fill="none"/>`);
      }
    }
  };

  const gap = 3;
  if (shape === 'hexagon') {
    const R = size / 7.2;
    const w = Math.sqrt(3) * R;
    for (let row = -1; row < 6; row++) {
      for (let col = -1; col < 6; col++) {
        const cx = col * w + (row % 2 ? w / 2 : 0);
        const cy = row * R * 1.5 + R * 0.4;
        const rr = R - gap / 1.6;
        const pts = [0, 1, 2, 3, 4, 5].map((k) => {
          const a = (Math.PI / 3) * k - Math.PI / 2;
          return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
        });
        addTile(pts, cx, cy, rr * 2);
      }
    }
  } else if (shape === 'rect') {
    const rowH = size / 7;
    const brickW = rowH * 3;
    for (let row = 0; row < 8; row++) {
      const off = row % 2 ? -brickW / 2 : 0;
      for (let col = -1; col < 4; col++) {
        const x = col * brickW + off;
        const y = row * rowH;
        const pts = [
          [x + gap / 2, y + gap / 2],
          [x + brickW - gap / 2, y + gap / 2],
          [x + brickW - gap / 2, y + rowH - gap / 2],
          [x + gap / 2, y + rowH - gap / 2],
        ];
        addTile(pts, x + brickW / 2, y + rowH / 2, rowH);
      }
    }
  } else {
    const cm = Number(opts.tileCm) || 10;
    const n = painted ? (cm >= 15 ? 2 : 3) : cm <= 5 ? 6 : cm <= 7 ? 5 : cm >= 15 ? 3 : 4;
    const cell = size / n;
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const x = col * cell;
        const y = row * cell;
        const pts = [
          [x + gap / 2, y + gap / 2],
          [x + cell - gap / 2, y + gap / 2],
          [x + cell - gap / 2, y + cell - gap / 2],
          [x + gap / 2, y + cell - gap / 2],
        ];
        addTile(pts, x + cell / 2, y + cell / 2, cell);
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img"><defs><linearGradient id="sheen" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".38" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".16"/></linearGradient></defs><rect width="${size}" height="${size}" fill="${grout}"/>${shapes.join('')}</svg>`;
}
