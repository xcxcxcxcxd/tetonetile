// Labels, statuses and business rules shared by the server and the browser.

export const ROLES = {
  admin: { label: 'Admin', note: 'Everything, including settings and users' },
  sales: { label: 'Sales', note: 'Clients, quotes, orders, invoices; reads production and stock' },
  production: { label: 'Production', note: 'Manufacturing orders, kilns, QC, materials' },
  warehouse: { label: 'Warehouse', note: 'Stock, locations, putaway, picking, loading' },
  viewer: { label: 'Viewer', note: 'Read-only' },
};

// tone: neutral | info | progress | success | warning | danger
export const DOC_TYPES = {
  quote: {
    label: 'Quote', plural: 'Quotes', prefix: 'Q',
    statuses: { draft: ['Draft', 'neutral'], sent: ['Sent', 'info'], accepted: ['Accepted', 'success'], rejected: ['Rejected', 'danger'], expired: ['Expired', 'warning'] },
  },
  order: {
    label: 'Sales order', plural: 'Sales orders', prefix: 'SO',
    statuses: { draft: ['Draft', 'neutral'], confirmed: ['Confirmed', 'info'], in_production: ['In production', 'progress'], ready: ['Ready to ship', 'success'], shipped: ['Shipped', 'success'], delivered: ['Delivered', 'success'], closed: ['Closed', 'neutral'], cancelled: ['Cancelled', 'danger'] },
  },
  proforma: {
    label: 'Proforma invoice', plural: 'Proformas', prefix: 'PF',
    statuses: { draft: ['Draft', 'neutral'], issued: ['Issued', 'info'], paid: ['Paid', 'success'], cancelled: ['Cancelled', 'danger'] },
  },
  invoice: {
    label: 'Invoice', plural: 'Invoices', prefix: 'INV',
    statuses: { draft: ['Draft', 'neutral'], issued: ['Issued', 'info'], partially_paid: ['Part paid', 'warning'], paid: ['Paid', 'success'], overdue: ['Overdue', 'danger'], cancelled: ['Cancelled', 'danger'] },
  },
  credit: {
    label: 'Credit note', plural: 'Credit notes', prefix: 'CN',
    statuses: { draft: ['Draft', 'neutral'], issued: ['Issued', 'info'], cancelled: ['Cancelled', 'danger'] },
  },
};

export const OPP_STAGES = {
  new: { label: 'New enquiry', probability: 10, tone: 'neutral' },
  qualified: { label: 'Qualified', probability: 25, tone: 'info' },
  samples: { label: 'Samples sent', probability: 40, tone: 'info' },
  quoted: { label: 'Quoted', probability: 55, tone: 'progress' },
  negotiation: { label: 'Negotiation', probability: 75, tone: 'warning' },
  won: { label: 'Won', probability: 100, tone: 'success' },
  lost: { label: 'Lost', probability: 0, tone: 'danger' },
};

export const CLIENT_TYPES = {
  end_user: 'End user',
  trade: 'Architect / trade',
  wholesale: 'Wholesale',
  programme: 'Programme',
  distributor: 'Distributor',
};

export const REGIONS = {
  US: 'United States',
  EU: 'European Union',
  UK: 'United Kingdom',
  GCC: 'Gulf (GCC)',
  MA: 'Morocco (domestic)',
  OTHER: 'Other export',
};

export const CURRENCIES = ['EUR', 'USD', 'MAD', 'GBP', 'AED'];

export const INCOTERMS = {
  FCA: { label: 'FCA', note: 'Default. We truck, clear export and hand over at the port; buyer books ocean freight.' },
  CFR: { label: 'CFR', note: 'We book ocean freight through our forwarder; buyer imports. Add freight + handling fee.' },
  EXW: { label: 'EXW', note: 'Only for buyers who already have a Moroccan forwarder.' },
  DAP: { label: 'DAP', note: 'Delivered (groupage) price; buyer clears import.' },
  DDP: { label: 'DDP', note: 'Avoid: we would become the importer of record and pay import duties.', warn: true },
};

export const UNITS = {
  m2: 'm²',
  pc: 'pcs',
  lm: 'lm',
  box: 'boxes',
  unit: 'unit',
};

export const MO_STATUSES = {
  planned: ['Planned', 'neutral'],
  released: ['Released', 'info'],
  in_progress: ['In progress', 'progress'],
  hold: ['On hold', 'warning'],
  completed: ['Completed', 'success'],
  closed: ['Closed', 'neutral'],
  cancelled: ['Cancelled', 'danger'],
};

export const MO_PURPOSES = {
  order: 'Client order',
  stock: 'Stock',
  export_reserve: 'Reserved export stock',
  samples: 'Samples',
  rework: 'Rework / replacement',
};

export const KILN_STATUSES = {
  loading: ['Loading', 'info'],
  firing: ['Firing', 'danger'],
  cooling: ['Cooling', 'warning'],
  unloaded: ['Unloaded', 'success'],
};

export const UNIT_STATUSES = {
  in_stock: ['In stock', 'success'],
  reserved: ['Reserved', 'info'],
  picked: ['Picked', 'progress'],
  loaded: ['Loaded', 'progress'],
  shipped: ['Shipped', 'neutral'],
  consumed: ['Consumed', 'neutral'],
  scrapped: ['Scrapped', 'danger'],
  hold: ['On hold', 'warning'],
};

export const POOLS = {
  general: 'General stock',
  export_reserve: 'Reserved export stock',
  samples: 'Samples',
};

export const ZONE_KINDS = {
  rack: { label: 'Pallet racking', unit: 'pallet', color: '#2f6f5e' },
  floor: { label: 'Floor stacking', unit: 'pallet', color: '#8a6d3b' },
  shelf: { label: 'Shelving (loose boxes)', unit: 'box', color: '#3d5a80' },
  samples: { label: 'Samples', unit: 'box', color: '#7b4b94' },
  raw: { label: 'Raw materials', unit: 'any', color: '#9c5a3c' },
  quarantine: { label: 'Quarantine / QC hold', unit: 'pallet', color: '#b23a3a' },
  dispatch: { label: 'Dispatch staging', unit: 'pallet', color: '#c27c0e' },
  receiving: { label: 'Receiving / packing out', unit: 'pallet', color: '#5b6770' },
};

export const SHIPMENT_MODES = {
  container_20: '20 ft container',
  container_40: '40 ft container',
  groupage: 'Groupage truck',
  courier: 'Courier',
  pickup: 'Client pickup',
};

export const SHIPMENT_STATUSES = {
  planning: ['Planning', 'neutral'],
  booked: ['Booked', 'info'],
  loading: ['Loading', 'progress'],
  loaded: ['Loaded', 'progress'],
  shipped: ['Shipped', 'success'],
  delivered: ['Delivered', 'success'],
  cancelled: ['Cancelled', 'danger'],
};

export const CLAIM_CATEGORIES = {
  breakage: 'Transit breakage',
  shortage: 'Quantity shortage',
  wrong_item: 'Wrong reference',
  colour: 'Colour / batch',
  quality: 'Quality (outside standard)',
  other: 'Other',
};

export const CLAIM_STATUSES = {
  open: ['Open', 'warning'],
  investigating: ['Investigating', 'info'],
  accepted: ['Accepted', 'progress'],
  rejected: ['Rejected', 'danger'],
  resolved: ['Resolved', 'success'],
};

export const SAMPLE_STATUSES = {
  requested: ['Requested', 'neutral'],
  prepared: ['Prepared', 'info'],
  sent: ['Sent', 'progress'],
  delivered: ['Delivered', 'info'],
  approved: ['Colour approved', 'success'],
  rejected: ['Not approved', 'danger'],
};

// Document pack per shipment, by destination (Logistics & Pricing plan; Material Spec §14).
const COMMON_DOCS = [
  ['commercial_invoice', 'Commercial invoice', 'From the agreed invoicing entity'],
  ['packing_list', 'Packing list', 'SKU codes incl. glaze suffix, lots, boxes, m², weights per pallet'],
  ['coo', 'Certificate of origin', 'Moroccan Chamber of Commerce and Industry'],
  ['conformity', "Manufacturer's declaration of conformity", 'Composition, production method and origin'],
  ['tds_spec', 'Technical Data Sheet + Material Specification', 'Issued with every shipment'],
  ['loading_photos', 'Loading photos + seal number', 'Photograph each pallet row and the sealed doors'],
];
export const DOC_PACKS = {
  US: [
    ...COMMON_DOCS,
    ['bl', 'Bill of lading', 'One ISF per bill of lading'],
    ['isf', 'ISF data to buyer\'s broker', 'Send BEFORE loading'],
    ['fta_origin', 'US–Morocco FTA origin file', 'Process flow + photos, BOM with HTS codes, supplier affidavits, batch production records, POs and proofs of payment'],
    ['prop65', 'Prop 65 labels on cartons and pallets', 'Short warning naming lead'],
    ['cpsc', 'CPSC labels', 'Cartons and pallets'],
    ['sds', 'SDS for each glaze in the container', 'One per glaze family'],
  ],
  EU: [...COMMON_DOCS, ['eur1', 'EUR.1 movement certificate', 'Duty-free entry into the EU'], ['cmr_bl', 'CMR (road) or bill of lading', '']],
  UK: [...COMMON_DOCS, ['eur1', 'EUR.1 / origin statement', 'UK buyer clears UK customs'], ['cmr_bl', 'CMR (road) or bill of lading', '']],
  GCC: [...COMMON_DOCS, ['arab_coo', 'Arab certificate of origin (GAFTA)', 'Confirm legalisation with the UAE broker'], ['bl', 'Bill of lading', '']],
  MA: [['invoice', 'Invoice with VAT', ''], ['delivery_note', 'Delivery note (bon de livraison)', 'Signed by the receiver'], ['loading_photos', 'Loading photos', '']],
  OTHER: [...COMMON_DOCS, ['bl', 'Bill of lading', '']],
};

// Quote / invoice conditions, condensed from the Material Specification.
export const DEFAULT_TERMS = [
  'Handmade material: variation in colour, shade, size, thickness and surface is inherent and is not a defect (Material Specification §06).',
  'Quantities include the stated overage for cutting, transit breakage and future repairs. Keep the overage on site.',
  'Samples are indicative only. Colour varies between kiln loads; each colour is produced and shipped as one batch. A later order will not match.',
  'Lead time is counted from written colour approval and receipt of the agreed deposit.',
  'Inspect the material on arrival. Claims must be made in writing before installation; installation constitutes acceptance.',
  'Prices exclude import duties and taxes at destination unless stated.',
];

export const SCRAP_REASONS = ['Cracked', 'Broken', 'Warped', 'Glaze defect', 'Under-fired', 'Over-fired', 'Chipped', 'Wrong size', 'Other'];

export function statusInfo(map, key) {
  const v = map?.[key];
  if (!v) return { label: key || '—', tone: 'neutral' };
  if (Array.isArray(v)) return { label: v[0], tone: v[1] };
  return { label: v.label || key, tone: v.tone || 'neutral' };
}
