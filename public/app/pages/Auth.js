import { useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { post, get } from '../lib/api.js';
import { useTitle } from '../lib/hooks.js';
import { Button, Field, Callout, Check } from '../components/ui.js';
import { BrandMark } from '../components/icons.js';

// Product swatches make the sign-in art: a wall of the factory's own tiles.
function Art() {
  const ids = Array.from({ length: 36 }, (_, i) => (i * 7) % 48 + 1);
  return html`<div class="auth-art">
    <div class="tiles">${ids.map((id) => html`<img src=${`/api/products/${id}/swatch.svg?size=160`} alt="" />`)}</div>
    <div class="art-shade"></div>
    <div class="art-text">
      <div class="overline" style="color:#d9a441">Fès · Tétouan · est. 1974</div>
      <h2>From the clay pit to the container.</h2>
      <p>Clients and quotes, every production stage, every pallet's position and every QR label - one system for the whole factory.</p>
    </div>
  </div>`;
}

export function Login() {
  useTitle('Sign in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const next = new URLSearchParams(location.search).get('next') || '/';
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/login', { email, password });
      location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return html`<div class="auth">
    <${Art} />
    <div class="auth-form">
      <form class="auth-box" onSubmit=${submit}>
        <div class="brand-line"><${BrandMark} size=${38} /><div><div class="strong" style="letter-spacing:.2em">ZELLIGERAR</div><div class="muted small">Factory CRM</div></div></div>
        <h1 class="mb-1">Sign in</h1>
        <p class="muted mb-3">Use the account your administrator gave you.</p>
        ${error && html`<div class="mb-2"><${Callout} tone="danger">${error}<//></div>`}
        <div class="stack">
          <${Field} label="Email"><input class="input lg" style="font-size:15px;height:44px" type="email" autoComplete="username" value=${email} onInput=${(e) => setEmail(e.target.value)} required autoFocus /><//>
          <${Field} label="Password"><input class="input lg" style="font-size:15px;height:44px" type="password" autoComplete="current-password" value=${password} onInput=${(e) => setPassword(e.target.value)} required /><//>
          <${Button} type="submit" variant="primary" size="lg" block loading=${busy}>Sign in<//>
        </div>
        <p class="muted small mt-3">Forgot your password? An administrator can reset it in Settings → Users.</p>
      </form>
    </div>
  </div>`;
}

export function Setup() {
  useTitle('Set up');
  const [v, setV] = useState({ name: '', email: '', password: '', demo: true });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const st = await get('/auth/state');
      if (!st.setupNeeded) {
        location.href = '/login';
        return;
      }
      await post('/auth/setup', v);
      location.href = '/';
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };
  return html`<div class="auth">
    <${Art} />
    <div class="auth-form">
      <form class="auth-box" onSubmit=${submit}>
        <div class="brand-line"><${BrandMark} size=${38} /><div><div class="strong" style="letter-spacing:.2em">ZELLIGERAR</div><div class="muted small">First start</div></div></div>
        <h1 class="mb-1">Create the administrator</h1>
        <p class="muted mb-3">This account manages users, settings and the catalogue. Formats, packing data, colours, production stages, kilns and warehouse locations are already loaded from the Zelligerar specifications.</p>
        ${error && html`<div class="mb-2"><${Callout} tone="danger">${error}<//></div>`}
        <div class="stack">
          <${Field} label="Your name"><input class="input" value=${v.name} onInput=${set('name')} required autoFocus /><//>
          <${Field} label="Email"><input class="input" type="email" value=${v.email} onInput=${set('email')} required /><//>
          <${Field} label="Password" hint="At least 8 characters"><input class="input" type="password" value=${v.password} onInput=${set('password')} required minLength="8" /><//>
          <${Check} label="Load demo data (sample clients, quotes, production and stock) to explore the system" checked=${v.demo} onChange=${(c) => setV({ ...v, demo: c })} />
          <${Button} type="submit" variant="primary" size="lg" block loading=${busy}>Create account and start<//>
        </div>
      </form>
    </div>
  </div>`;
}
