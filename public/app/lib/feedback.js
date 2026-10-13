// Sound + vibration so warehouse staff know a scan worked without looking at the screen.
let ctx = null;
export function beep(ok = true) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = ok ? 'sine' : 'square';
    o.frequency.value = ok ? 1046 : 196;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(ok ? 0.12 : 0.08, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.14 : 0.4));
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (ok ? 0.16 : 0.42));
  } catch {
    /* audio not available */
  }
  if (navigator.vibrate) navigator.vibrate(ok ? 50 : [90, 60, 90]);
}
