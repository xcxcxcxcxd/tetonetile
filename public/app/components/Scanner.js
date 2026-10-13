import { useEffect, useRef, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { QrScanner, cameraSupported, codeFromScan } from '../lib/scanner.js';
import { Icon } from './icons.js';
import { Button, IconButton, Modal } from './ui.js';

/**
 * Camera viewfinder + manual / handheld-scanner input. Handheld (keyboard-wedge) scanners
 * type the code into the focused field and press Enter, so they work everywhere, even without https.
 */
export function ScannerView({ onCode, paused = false, flash = null, hint = 'Point the camera at a QR label' }) {
  const video = useRef();
  const scanner = useRef(null);
  const input = useRef();
  const [camOn, setCamOn] = useState(cameraSupported());
  const [error, setError] = useState(null);
  const [manual, setManual] = useState('');
  const [torch, setTorch] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (!camOn) return undefined;
    const s = new QrScanner(video.current, (raw) => {
      if (!pausedRef.current) onCode(codeFromScan(raw), raw);
    });
    scanner.current = s;
    s.start().catch((e) => {
      setError(
        e.name === 'NotAllowedError'
          ? 'Camera permission was refused. Allow the camera for this site, or type / scan the code below.'
          : e.name === 'NotFoundError' || e.name === 'OverconstrainedError'
            ? 'No camera found on this device. Type the code, or use a handheld scanner - it types into the box below.'
            : e.message,
      );
      setCamOn(false);
    });
    return () => s.stop();
  }, [camOn]);

  useEffect(() => {
    if (!camOn) setTimeout(() => input.current?.focus(), 50);
  }, [camOn]);

  const submit = (e) => {
    e.preventDefault();
    const v = manual.trim();
    if (!v) return;
    onCode(codeFromScan(v), v);
    setManual('');
  };

  return html`<div>
    ${camOn
      ? html`<div class=${`viewfinder ${flash === 'ok' ? 'flash-ok' : flash === 'bad' ? 'flash-bad' : ''}`}>
          <video ref=${video} playsinline muted></video>
          <div class="vf-frame"></div>
          ${!paused && html`<div class="vf-line"></div>`}
          <div class="vf-msg">${paused ? 'Paused' : hint}</div>
          <div style="position:absolute;top:10px;right:10px;display:flex;gap:6px">
            <${IconButton} icon="zap" label="Torch" variant="" onClick=${async () => {
              const ok = await scanner.current?.torch(!torch);
              if (ok) setTorch(!torch);
            }} />
            <${IconButton} icon="x" label="Stop camera" variant="" onClick=${() => setCamOn(false)} />
          </div>
        </div>`
      : html`<div class="callout ${error ? 'warning' : ''}" style="margin-bottom:10px">
          <${Icon} name=${error ? 'alert' : 'keyboard'} />
          <div class="callout-body">
            ${error ||
            (window.isSecureContext
              ? 'Camera is off. Type the code, or use a handheld scanner - it types into the box below.'
              : html`<b>Camera scanning needs a secure (https) address.</b> You can still scan labels with the phone's own camera app (they open this system), use a handheld scanner, or type the code.`)}
            ${cameraSupported() && html`<div class="mt-1"><${Button} size="sm" icon="camera" onClick=${() => (setError(null), setCamOn(true))}>Turn the camera on<//></div>`}
          </div>
        </div>`}
    <form class="row mt-2" onSubmit=${submit}>
      <input ref=${input} class="input lg" style="font-size:16px;height:46px;font-family:var(--mono)" placeholder="Type or scan a code: PAL-000123, A01-2B, L26-0012, MO-…" value=${manual} onInput=${(e) => setManual(e.target.value)} autoCapitalize="characters" autoComplete="off" spellcheck="false" />
      <${Button} type="submit" size="lg" variant="primary">Go<//>
    </form>
  </div>`;
}

export function ScanOverlay({ title = 'Scan', hint, onCode, onClose }) {
  return html`<${Modal} title=${title} onClose=${onClose} icon="scan">
    <${ScannerView} hint=${hint} onCode=${(c) => onCode(c)} />
  <//>`;
}

/** Text field with a scan button that fills it from a QR label. */
export function ScanInput({ value, onInput, placeholder, autoFocus, onEnter, title = 'Scan a label' }) {
  const [open, setOpen] = useState(false);
  return html`<div class="input-group">
    <input class="input" style="font-family:var(--mono)" value=${value} placeholder=${placeholder} autoFocus=${autoFocus} autoCapitalize="characters"
      onInput=${(e) => onInput(e.target.value)} onKeyDown=${(e) => e.key === 'Enter' && onEnter && (e.preventDefault(), onEnter(e.target.value))} />
    <button type="button" class="addon" style="cursor:pointer" title=${title} onClick=${() => setOpen(true)}><${Icon} name="scan" size="16" /></button>
    ${open && html`<${ScanOverlay} title=${title} onClose=${() => setOpen(false)} onCode=${(c) => {
      setOpen(false);
      onInput(c);
      if (onEnter) onEnter(c);
    }} />`}
  </div>`;
}
