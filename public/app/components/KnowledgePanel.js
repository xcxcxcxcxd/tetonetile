import { useEffect, useState } from 'preact/hooks';
import { html } from '../lib/html.js';
import { get, qs } from '../lib/api.js';
import { useStore, setState, closeKb } from '../lib/store.js';
import { navigate, useLocation } from '../lib/router.js';
import { useAsync, useDebounced } from '../lib/hooks.js';
import { articleFor } from '../lib/kbmap.js';
import { Icon } from './icons.js';
import { IconButton, Loading } from './ui.js';
import { renderMarkdown } from './markdown.js';

/** Slide-over "knowledge panel": the procedure for the page you are on, without leaving it. */
export function KnowledgePanel() {
  const kb = useStore((s) => s.kb);
  const loc = useLocation();
  if (!kb.open) return null;
  const id = kb.id || articleFor(loc);
  return html`<${Panel} id=${id} />`;
}

function Panel({ id }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const list = useAsync(() => get(`/knowledge${qs({ q: dq })}`), [dq]);
  const art = useAsync(() => (id ? get(`/knowledge/${id}`) : null), [id]);
  const showList = !!dq || !id;

  useEffect(() => {
    const on = (e) => e.key === 'Escape' && closeKb();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const onClick = (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (href.startsWith('kb:')) {
      e.preventDefault();
      setQ('');
      setState({ kb: { open: true, id: href.slice(3).split('#')[0] } });
    } else if (href.startsWith('/')) {
      e.preventDefault();
      navigate(href);
    }
  };

  return html`<aside class="kb-panel" aria-label="Knowledge panel">
    <div class="kb-head">
      <div class="kb-title"><${Icon} name="book" size="18" /> Knowledge panel</div>
      ${id && html`<${IconButton} icon="external" label="Open as a full page" onClick=${() => (closeKb(), navigate(`/knowledge/${id}`))} />`}
      <${IconButton} icon="x" label="Close" onClick=${closeKb} />
    </div>
    <div class="kb-search">
      <input class="input" placeholder="Search procedures, rules, products…" value=${q} onInput=${(e) => setQ(e.target.value)} />
    </div>
    <div class="kb-body" onClick=${onClick}>
      ${showList
        ? html`<div class="kb-list">
            ${list.loading && !list.data ? html`<${Loading} />` : null}
            ${(list.data?.rows || []).map(
              (a) => html`<a href=${`kb:${a.id}`}>
                <div class="row"><span class=${`sys-pill ${a.system}`}>${a.system}</span><b>${a.title}</b></div>
                <div class="kb-sum">${a.snippet || a.summary}</div>
              </a>`,
            )}
          </div>`
        : art.loading && !art.data
          ? html`<${Loading} />`
          : art.data &&
            html`<div>
              <div class="row mb-2" style="justify-content:space-between">
                <span class=${`sys-pill ${art.data.system}`}>${art.data.system}</span>
                <a href="kb:start-here" class="small">All articles</a>
              </div>
              <div class="prose" dangerouslySetInnerHTML=${{ __html: renderMarkdown(art.data.body) }}></div>
            </div>`}
    </div>
  </aside>`;
}
