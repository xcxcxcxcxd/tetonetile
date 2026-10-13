// Which knowledge article opens when someone presses "How this works" on a page.
// First match wins: specific screens (workstation procedures) before whole sections.
const MAP = [
  [/^\/floor\//, 'sop-record-work'],
  [/^\/production\/kilns/, 'sop-kiln'],
  [/^\/shipments\/[^/]+\/load/, 'sop-loading'],
  [/^\/warehouse\/putaway|^\/stock\/count/, 'sop-put-away-count'],
  [/^\/production\/qc|^\/lots\//, 'quality-control'],
  [/^\/production|^\/floor/, 'production-cycle'],
  [/^\/materials|^\/purchase-orders/, 'raw-materials'],
  [/^\/warehouse|^\/stock/, 'stock-positioning'],
  [/^\/scan|^\/labels/, 'qr-codes'],
  [/^\/shipments/, 'shipping'],
  [/^\/docs/, 'quotes-orders-invoices'],
  [/^\/claims/, 'claims'],
  [/^\/samples|^\/clients|^\/pipeline|^\/tasks/, 'crm'],
  [/^\/catalog/, 'product-knowledge'],
  [/^\/settings/, 'database'],
  [/^\/knowledge/, 'start-here'],
];

export function articleFor(path) {
  const p = path.split('?')[0];
  for (const [re, id] of MAP) if (re.test(p)) return id;
  return 'start-here';
}
