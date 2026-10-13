import { post } from './api.js';

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('This image could not be read. Try a JPG or PNG.'));
    img.src = url;
  });
}

/** Shrinks photos in the browser (max 1600 px, JPEG) so uploads stay small on factory Wi-Fi. */
export async function prepareFile(file, { maxDim = 1600, quality = 0.84 } = {}) {
  if (file.type === 'application/pdf') {
    if (file.size > 12 * 1024 * 1024) throw new Error('PDF is larger than 12 MB.');
    return { mime: file.type, data: await toBase64(file), filename: file.name };
  }
  if (!file.type.startsWith('image/')) throw new Error('Choose an image (JPG, PNG, WebP) or a PDF.');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 1_200_000 && ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      return { mime: file.type, data: await toBase64(file), filename: file.name };
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return { mime: 'image/jpeg', data: await toBase64(blob), filename: `${file.name.replace(/\.[^.]+$/, '')}.jpg` };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadFile(file, target) {
  const prepared = await prepareFile(file);
  return post('/files', { ...prepared, ...target });
}
