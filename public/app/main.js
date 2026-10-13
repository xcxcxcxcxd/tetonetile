import { useEffect, useState } from 'preact/hooks';
import { html, render } from './lib/html.js';
import { get, onUnauthorized } from './lib/api.js';
import { match, navigate, useLocation } from './lib/router.js';
import { setState, useStore, applyTheme, getState } from './lib/store.js';
import { Layout, Bare } from './components/Layout.js';
import { Loading, ErrorBox, EmptyState, LinkButton } from './components/ui.js';

applyTheme(getState().theme);

// [pattern, module, export, options]
const ROUTES = [
  ['/login', 'Auth', 'Login', { bare: true, public: true }],
  ['/setup', 'Auth', 'Setup', { bare: true, public: true }],
  ['/q/:code', 'Scan', 'Resolve', { bare: true, public: true }],
  ['/print/doc/:id', 'PrintDoc', 'PrintDoc', { bare: true }],
  ['/print/packing-list/:id', 'PrintDoc', 'PrintPackingList', { bare: true }],
  ['/print/origin/:id', 'PrintDoc', 'PrintOriginFile', { bare: true }],
  ['/print/picklist/:id', 'PrintDoc', 'PrintPickList', { bare: true }],
  ['/print/labels', 'Labels', 'PrintLabels', { bare: true }],
  ['/', 'Dashboard', 'Dashboard'],
  ['/scan', 'Scan', 'ScanPage'],
  ['/tasks', 'Pipeline', 'Tasks'],
  ['/clients', 'Clients', 'Clients'],
  ['/clients/:id', 'Clients', 'ClientDetail'],
  ['/pipeline', 'Pipeline', 'Pipeline', { wide: true }],
  ['/docs', 'Docs', 'DocsList'],
  ['/docs/new', 'Docs', 'DocNew'],
  ['/docs/:id', 'DocEditor', 'DocEditor', { wide: true }],
  ['/samples', 'Samples', 'Samples'],
  ['/claims', 'Samples', 'Claims'],
  ['/claims/:id', 'Samples', 'ClaimDetail'],
  ['/catalog', 'Catalog', 'Catalog'],
  ['/catalog/:id', 'Catalog', 'ProductDetail'],
  ['/production', 'Production', 'Board', { wide: true }],
  ['/production/mos', 'Production', 'MoList'],
  ['/production/mo/:id', 'Production', 'MoDetail'],
  ['/production/kilns', 'Kilns', 'Kilns'],
  ['/production/kilns/load/:id', 'Kilns', 'KilnLoad'],
  ['/production/qc', 'Quality', 'Quality'],
  ['/production/planning', 'Quality', 'Planning'],
  ['/lots/:id', 'Quality', 'LotDetail'],
  ['/floor/mo/:id', 'Floor', 'FloorMo'],
  ['/warehouse', 'Warehouse', 'WarehouseMap', { wide: true }],
  ['/warehouse/location/:id', 'Warehouse', 'LocationDetail'],
  ['/warehouse/putaway', 'Warehouse', 'Putaway'],
  ['/stock', 'Stock', 'Stock'],
  ['/stock/units/:id', 'Stock', 'UnitDetail'],
  ['/stock/moves', 'Stock', 'Moves'],
  ['/stock/count', 'Stock', 'Count'],
  ['/materials', 'Materials', 'Materials'],
  ['/materials/:id', 'Materials', 'MaterialDetail'],
  ['/purchase-orders', 'Materials', 'PurchaseOrders'],
  ['/purchase-orders/:id', 'Materials', 'PoDetail'],
  ['/shipments', 'Shipments', 'Shipments'],
  ['/shipments/:id', 'Shipments', 'ShipmentDetail'],
  ['/shipments/:id/load', 'Shipments', 'LoadScreen'],
  ['/labels', 'Labels', 'LabelCenter'],
  ['/knowledge', 'Knowledge', 'Knowledge'],
  ['/knowledge/:id', 'Knowledge', 'Knowledge'],
  ['/settings', 'Settings', 'Settings'],
  ['/settings/:tab', 'Settings', 'Settings'],
];

const modules = new Map();
function loadModule(name) {
  if (!modules.has(name)) modules.set(name, import(`./pages/${name}.js`));
  return modules.get(name);
}

function Page({ route, params }) {
  const [Comp, setComp] = useState(null);
  const [err, setErr] = useState(null);
  const [mod, exp] = route;
  useEffect(() => {
    let alive = true;
    setErr(null);
    loadModule(mod)
      .then((m) => alive && setComp(() => m[exp]))
      .catch((e) => alive && setErr(e));
    return () => {
      alive = false;
    };
  }, [mod, exp]);
  if (err) return html`<${ErrorBox} error=${err} retry=${() => location.reload()} />`;
  if (!Comp) return html`<${Loading} />`;
  return html`<${Comp} ...${params} />`;
}

const NotFound = () =>
  html`<${EmptyState} icon="map" title="Page not found" text="This address does not exist. Use search (Ctrl K) or go back to the dashboard." action=${html`<${LinkButton} href="/" variant="primary">Dashboard<//>`} />`;

function App() {
  const loc = useLocation();
  const bootData = useStore((s) => s.boot);
  const [authState, setAuthState] = useState(null);
  const path = loc.split('?')[0];
  const m = match(ROUTES.map((r) => [r[0], r]), path);
  const route = m?.component;
  const opts = route?.[3] || {};

  useEffect(() => {
    onUnauthorized(() => {
      setState({ boot: null });
      if (!location.pathname.startsWith('/login')) navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
    });
    get('/auth/state')
      .then(async (st) => {
        setAuthState(st);
        if (st.setupNeeded) {
          if (location.pathname !== '/setup') navigate('/setup', { replace: true });
          return;
        }
        if (st.user) setState({ boot: await get('/bootstrap') });
        else if (!(match(ROUTES.map((r) => [r[0], r]), location.pathname)?.component?.[3] || {}).public) {
          navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
        }
      })
      .catch((e) => setAuthState({ error: e }));
  }, []);

  if (!authState) return html`<${Loading} />`;
  if (authState.error) return html`<div class="content"><${ErrorBox} error=${authState.error} retry=${() => location.reload()} /></div>`;
  if (!route) return bootData ? html`<${Layout}><${NotFound} /><//>` : html`<div class="content"><${NotFound} /></div>`;
  if (opts.bare) return html`<${Bare}><${Page} route=${[route[1], route[2]]} params=${m.params} key=${path} /><//>`;
  if (!bootData) return html`<${Loading} />`;
  return html`<${Layout} wide=${opts.wide}><${Page} route=${[route[1], route[2]]} params=${m.params} key=${path} /><//>`;
}

render(html`<${App} />`, document.getElementById('app'));
