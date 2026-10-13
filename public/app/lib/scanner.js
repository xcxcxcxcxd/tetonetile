// Camera QR scanning: native BarcodeDetector when the browser has it (Chrome/Android),
// otherwise jsQR (iOS Safari, Firefox). Needs HTTPS (or localhost) for camera access.
let jsqrPromise = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (!jsqrPromise) {
    jsqrPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/jsqr/jsQR.js';
      s.onload = () => resolve(window.jsQR);
      s.onerror = () => reject(new Error('Scanner library failed to load'));
      document.head.appendChild(s);
    });
  }
  return jsqrPromise;
}

export const cameraSupported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext;

export class QrScanner {
  constructor(video, onCode) {
    this.video = video;
    this.onCode = onCode;
    this.running = false;
    this.last = { code: null, at: 0 };
    this.canvas = document.createElement('canvas');
  }

  async start() {
    if (!cameraSupported()) throw new Error(window.isSecureContext ? 'This browser cannot use the camera.' : 'Camera scanning needs a secure (https) address.');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    await this.video.play();
    if ('BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats();
        if (formats.includes('qr_code')) this.detector = new window.BarcodeDetector({ formats: formats.filter((f) => ['qr_code', 'code_128', 'ean_13', 'data_matrix'].includes(f)) });
      } catch {
        this.detector = null;
      }
    }
    if (!this.detector) this.jsQR = await loadJsQR();
    this.running = true;
    this.loop();
  }

  async loop() {
    if (!this.running) return;
    try {
      const code = await this.detect();
      if (code) {
        const now = Date.now();
        if (code !== this.last.code || now - this.last.at > 2500) {
          this.last = { code, at: now };
          this.onCode(code);
        }
      }
    } catch {
      /* frame not ready */
    }
    this.timer = setTimeout(() => this.loop(), 120);
  }

  async detect() {
    const v = this.video;
    if (!v.videoWidth) return null;
    if (this.detector) {
      const found = await this.detector.detect(v);
      return found[0]?.rawValue || null;
    }
    const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(v, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const res = this.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
    return res?.data || null;
  }

  async torch(on) {
    const track = this.stream?.getVideoTracks()[0];
    if (!track?.getCapabilities?.().torch) return false;
    await track.applyConstraints({ advanced: [{ torch: !!on }] });
    return true;
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

/** Accepts a full QR URL (…/q/PAL-000123) or a bare code and returns the code. */
export function codeFromScan(raw) {
  let s = String(raw || '').trim();
  if (s.includes('/q/')) s = s.split('/q/').pop();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep */
  }
  return s.split(/[?#]/)[0].trim();
}
