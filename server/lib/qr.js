import QRCode from 'qrcode';

const cache = new Map();

/** SVG markup for a QR code. Error correction M survives scuffs on warehouse labels. */
export async function qrSvg(text, { ecl = 'M', margin = 1 } = {}) {
  const key = `${ecl}|${margin}|${text}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const svg = await QRCode.toString(String(text), {
    type: 'svg',
    errorCorrectionLevel: ecl,
    margin,
    color: { dark: '#000000', light: '#ffffff' },
  });
  if (cache.size > 3000) cache.clear();
  cache.set(key, svg);
  return svg;
}
