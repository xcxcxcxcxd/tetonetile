-- Zelligerar Factory CRM — initial schema
-- One SQLite file holds the three systems:
--   1. CRM (clients, pipeline, samples, quotes, orders, invoices, payments, claims)
--   2. Factory (manufacturing orders, stages, kilns, QC, lots, materials, purchasing)
--   3. Stock & logistics (warehouses, zones, locations, stock units, moves, shipments)
-- Dates are stored as 'YYYY-MM-DD' (dates) or 'YYYY-MM-DD HH:MM:SS' UTC (timestamps).

-- =====================================================================
-- SYSTEM
-- =====================================================================
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer'
                CHECK (role IN ('admin','sales','production','warehouse','viewer')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,               -- sha256 of the cookie token
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  user_agent TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL                        -- JSON
);

CREATE TABLE counters (
  name   TEXT NOT NULL,
  period TEXT NOT NULL,
  value  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (name, period)
);

CREATE TABLE audit_log (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL DEFAULT (datetime('now')),
  user_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  entity    TEXT NOT NULL,
  entity_id INTEGER,
  action    TEXT NOT NULL,
  summary   TEXT
);
CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id);
CREATE INDEX idx_audit_at ON audit_log(at);

CREATE TABLE attachments (
  id          INTEGER PRIMARY KEY,
  entity      TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'file' CHECK (kind IN ('image','photo','document','file')),
  filename    TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime        TEXT,
  size        INTEGER,
  caption     TEXT,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_attachments_entity ON attachments(entity, entity_id);

-- Issuing companies (the legal entity printed on quotes and invoices)
CREATE TABLE entities (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  brand        TEXT,
  address      TEXT,
  city         TEXT,
  country      TEXT,
  phone        TEXT,
  email        TEXT,
  website      TEXT,
  ice          TEXT,      -- Identifiant Commun de l'Entreprise (MA)
  if_number    TEXT,      -- Identifiant fiscal (MA)
  rc           TEXT,      -- Registre du commerce (MA)
  patente      TEXT,
  cnss         TEXT,
  vat_number   TEXT,
  capital      TEXT,
  bank_name    TEXT,
  bank_account TEXT,      -- RIB
  iban         TEXT,
  swift        TEXT,
  footer_note  TEXT,
  is_default   INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1
);

-- =====================================================================
-- CATALOGUE
-- =====================================================================
CREATE TABLE formats (
  id                  INTEGER PRIMARY KEY,
  code                TEXT NOT NULL UNIQUE,     -- ZR10, HX09, BE, BB ...
  name                TEXT NOT NULL,
  family              TEXT NOT NULL DEFAULT 'zellige'
                      CHECK (family IN ('zellige','cement','terracotta','other')),
  shape               TEXT NOT NULL DEFAULT 'square'
                      CHECK (shape IN ('square','hexagon','rect','custom')),
  width_cm            REAL,
  length_cm           REAL,
  thickness_cm        REAL,
  pcs_per_m2          REAL,
  pcs_per_box         INTEGER,
  m2_per_box          REAL,
  kg_per_box          REAL,
  boxes_per_pallet    INTEGER NOT NULL DEFAULT 78,
  box_dims            TEXT,
  sell_unit           TEXT NOT NULL DEFAULT 'm2' CHECK (sell_unit IN ('m2','pc','lm','box')),
  painted             INTEGER NOT NULL DEFAULT 0,
  production_loss_pct REAL NOT NULL DEFAULT 10, -- extra pieces started to cover losses in making
  packing_confirmed   INTEGER NOT NULL DEFAULT 1,
  notes               TEXT,
  sort                INTEGER NOT NULL DEFAULT 0,
  active              INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE colours (
  id               INTEGER PRIMARY KEY,
  code             TEXT NOT NULL UNIQUE,        -- '01', '39', 'NAT'
  name             TEXT NOT NULL,               -- 'Casablanca white'
  hex              TEXT NOT NULL DEFAULT '#cccccc',
  finish           TEXT NOT NULL DEFAULT 'glazed' CHECK (finish IN ('glazed','natural')),
  glaze_family     TEXT,
  lead_free        INTEGER NOT NULL DEFAULT 0,
  colour_group     TEXT NOT NULL DEFAULT 'A',
  price_adjust_pct REAL NOT NULL DEFAULT 0,     -- e.g. +9 for the lead-free premium
  fast_seller      INTEGER NOT NULL DEFAULT 0,  -- part of the reserved export stock range
  sds_available    INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  sort             INTEGER NOT NULL DEFAULT 0,
  active           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE products (
  id                   INTEGER PRIMARY KEY,
  sku                  TEXT NOT NULL UNIQUE,    -- ZR10-01
  kind                 TEXT NOT NULL DEFAULT 'tile' CHECK (kind IN ('tile','custom','sample','service')),
  format_id            INTEGER REFERENCES formats(id),
  colour_id            INTEGER REFERENCES colours(id),
  name                 TEXT NOT NULL,
  description          TEXT,
  unit                 TEXT NOT NULL DEFAULT 'm2' CHECK (unit IN ('m2','pc','lm','box','unit')),
  cost                 REAL NOT NULL DEFAULT 0, -- cost per unit, base currency
  image_id             INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  reserve_target_boxes INTEGER NOT NULL DEFAULT 0,
  hs_code              TEXT,
  active               INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX idx_products_tile ON products(format_id, colour_id) WHERE kind = 'tile';

CREATE TABLE price_tiers (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  multiplier  REAL NOT NULL,                 -- price = cost x multiplier
  min_pallets REAL,
  max_pallets REAL,
  notes       TEXT,
  sort        INTEGER NOT NULL DEFAULT 0
);

-- =====================================================================
-- CRM
-- =====================================================================
CREATE TABLE clients (
  id             INTEGER PRIMARY KEY,
  code           TEXT UNIQUE,
  company        TEXT NOT NULL,
  type           TEXT NOT NULL DEFAULT 'end_user'
                 CHECK (type IN ('end_user','trade','wholesale','programme','distributor')),
  tier_id        INTEGER REFERENCES price_tiers(id),
  currency       TEXT NOT NULL DEFAULT 'EUR',
  region         TEXT NOT NULL DEFAULT 'EU' CHECK (region IN ('US','EU','UK','GCC','MA','OTHER')),
  country        TEXT,
  city           TEXT,
  address        TEXT,
  contact_name   TEXT,
  email          TEXT,
  phone          TEXT,
  website        TEXT,
  vat_number     TEXT,
  incoterm       TEXT,
  incoterm_place TEXT,
  payment_terms  TEXT,
  deposit_pct    REAL,
  source         TEXT,
  owner_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  tags           TEXT,
  notes          TEXT,
  archived       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_clients_company ON clients(company);

CREATE TABLE contacts (
  id         INTEGER PRIMARY KEY,
  client_id  INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  role       TEXT,
  email      TEXT,
  phone      TEXT,
  whatsapp   TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  notes      TEXT
);
CREATE INDEX idx_contacts_client ON contacts(client_id);

-- Client contract prices and tier price-list overrides
CREATE TABLE price_list (
  id          INTEGER PRIMARY KEY,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  tier_id     INTEGER REFERENCES price_tiers(id) ON DELETE CASCADE,
  client_id   INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  currency    TEXT NOT NULL,
  price       REAL NOT NULL,
  valid_until TEXT,
  notes       TEXT
);
CREATE INDEX idx_price_list_product ON price_list(product_id);

CREATE TABLE opportunities (
  id             INTEGER PRIMARY KEY,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  project        TEXT,
  stage          TEXT NOT NULL DEFAULT 'new'
                 CHECK (stage IN ('new','qualified','samples','quoted','negotiation','won','lost')),
  value          REAL,
  currency       TEXT,
  area_m2        REAL,
  expected_close TEXT,
  probability    INTEGER,
  lost_reason    TEXT,
  owner_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_opps_client ON opportunities(client_id);

-- =====================================================================
-- SALES DOCUMENTS (quote -> order -> proforma / invoice -> credit note)
-- =====================================================================
CREATE TABLE sales_docs (
  id                  INTEGER PRIMARY KEY,
  type                TEXT NOT NULL CHECK (type IN ('quote','order','proforma','invoice','credit')),
  number              TEXT NOT NULL UNIQUE,
  entity_id           INTEGER REFERENCES entities(id),
  client_id           INTEGER NOT NULL REFERENCES clients(id),
  opportunity_id      INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  source_id           INTEGER REFERENCES sales_docs(id) ON DELETE SET NULL,
  order_id            INTEGER REFERENCES sales_docs(id) ON DELETE SET NULL,
  status              TEXT NOT NULL DEFAULT 'draft',
  issue_date          TEXT NOT NULL,
  valid_until         TEXT,                  -- quote validity, invoice due date
  currency            TEXT NOT NULL DEFAULT 'EUR',
  tier_id             INTEGER REFERENCES price_tiers(id),
  incoterm            TEXT,
  incoterm_place      TEXT,
  payment_terms       TEXT,
  deposit_pct         REAL,
  lead_time_weeks     REAL,
  overage_pct         REAL NOT NULL DEFAULT 15,
  project             TEXT,
  client_ref          TEXT,
  delivery_address    TEXT,
  discount_pct        REAL NOT NULL DEFAULT 0,
  freight             REAL NOT NULL DEFAULT 0,
  handling_fee        REAL NOT NULL DEFAULT 0,
  vat_rate            REAL NOT NULL DEFAULT 0,
  vat_note            TEXT,
  notes               TEXT,                  -- printed on the document
  internal_notes      TEXT,                  -- never printed
  subtotal            REAL NOT NULL DEFAULT 0,
  total               REAL NOT NULL DEFAULT 0,
  colour_approved_at  TEXT,                  -- gate 1 before production
  deposit_received_at TEXT,                  -- gate 2 before production
  promised_date       TEXT,
  sent_at             TEXT,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_docs_client ON sales_docs(client_id);
CREATE INDEX idx_docs_type_status ON sales_docs(type, status);
CREATE INDEX idx_docs_order ON sales_docs(order_id);

CREATE TABLE doc_lines (
  id             INTEGER PRIMARY KEY,
  doc_id         INTEGER NOT NULL REFERENCES sales_docs(id) ON DELETE CASCADE,
  position       INTEGER NOT NULL DEFAULT 0,
  product_id     INTEGER REFERENCES products(id),
  description    TEXT,
  unit           TEXT NOT NULL DEFAULT 'm2',
  net_qty        REAL,                       -- net measured quantity (m2 surface or linear metres) before overage
  overage_pct    REAL,
  qty            REAL NOT NULL DEFAULT 0,    -- billed quantity (full boxes)
  boxes          INTEGER,
  pieces         INTEGER,
  weight_kg      REAL,
  unit_price     REAL NOT NULL DEFAULT 0,
  price_source   TEXT,
  discount_pct   REAL NOT NULL DEFAULT 0,
  line_total     REAL NOT NULL DEFAULT 0,
  image_id       INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  source_line_id INTEGER,
  notes          TEXT
);
CREATE INDEX idx_lines_doc ON doc_lines(doc_id);
CREATE INDEX idx_lines_product ON doc_lines(product_id);

CREATE TABLE payments (
  id         INTEGER PRIMARY KEY,
  doc_id     INTEGER NOT NULL REFERENCES sales_docs(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  amount     REAL NOT NULL,
  currency   TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('deposit','balance','payment','refund')),
  method     TEXT DEFAULT 'bank_transfer',
  reference  TEXT,
  notes      TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_payments_doc ON payments(doc_id);

CREATE TABLE activities (
  id             INTEGER PRIMARY KEY,
  client_id      INTEGER REFERENCES clients(id) ON DELETE CASCADE,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  doc_id         INTEGER REFERENCES sales_docs(id) ON DELETE SET NULL,
  type           TEXT NOT NULL DEFAULT 'note'
                 CHECK (type IN ('note','call','email','meeting','whatsapp','task')),
  subject        TEXT NOT NULL,
  body           TEXT,
  due_date       TEXT,
  done           INTEGER NOT NULL DEFAULT 0,
  done_at        TEXT,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_to    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_activities_client ON activities(client_id);
CREATE INDEX idx_activities_due ON activities(done, due_date);

CREATE TABLE samples (
  id             INTEGER PRIMARY KEY,
  number         TEXT NOT NULL UNIQUE,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  opportunity_id INTEGER REFERENCES opportunities(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'requested'
                 CHECK (status IN ('requested','prepared','sent','delivered','approved','rejected')),
  items          TEXT,                       -- JSON [{product_id, pieces}]
  method         TEXT NOT NULL DEFAULT 'groupage' CHECK (method IN ('courier','groupage','hand','pickup')),
  tracking       TEXT,
  charge         REAL,
  currency       TEXT,
  paid           INTEGER NOT NULL DEFAULT 0,
  sent_at        TEXT,
  follow_up      TEXT,
  feedback       TEXT,
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =====================================================================
-- FACTORY: production
-- =====================================================================
CREATE TABLE stages (
  id                INTEGER PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  sort              INTEGER NOT NULL,
  applies_to        TEXT NOT NULL DEFAULT 'all'
                    CHECK (applies_to IN ('all','zellige','glazed','natural','painted','cement')),
  daily_capacity_m2 REAL,
  typical_days      REAL,
  is_kiln           INTEGER NOT NULL DEFAULT 0,
  is_qc             INTEGER NOT NULL DEFAULT 0,
  is_packing        INTEGER NOT NULL DEFAULT 0,
  instructions      TEXT,
  color             TEXT,
  active            INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE workers (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  team       TEXT,                           -- stage code they usually work at
  phone      TEXT,
  piece_rate REAL,
  active     INTEGER NOT NULL DEFAULT 1,
  notes      TEXT
);

CREATE TABLE manufacturing_orders (
  id               INTEGER PRIMARY KEY,
  number           TEXT NOT NULL UNIQUE,
  product_id       INTEGER NOT NULL REFERENCES products(id),
  order_id         INTEGER REFERENCES sales_docs(id) ON DELETE SET NULL,
  order_line_id    INTEGER REFERENCES doc_lines(id) ON DELETE SET NULL,
  purpose          TEXT NOT NULL DEFAULT 'order'
                   CHECK (purpose IN ('order','stock','export_reserve','samples','rework')),
  workshop         TEXT,
  qty_m2           REAL,
  boxes_required   INTEGER,
  target_pcs       INTEGER NOT NULL,
  loss_pct         REAL,
  lot_id           INTEGER REFERENCES lots(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'planned'
                   CHECK (status IN ('planned','released','in_progress','completed','closed','cancelled','hold')),
  priority         INTEGER NOT NULL DEFAULT 2,
  planned_start    TEXT,
  due_date         TEXT,
  released_at      TEXT,
  completed_at     TEXT,
  current_stage_id INTEGER REFERENCES stages(id),
  good_pcs         INTEGER NOT NULL DEFAULT 0,
  grade_b_pcs      INTEGER NOT NULL DEFAULT 0,
  notes            TEXT,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mo_status ON manufacturing_orders(status);
CREATE INDEX idx_mo_order ON manufacturing_orders(order_id);

-- A lot is one production batch of one colour+format. Batch continuity:
-- an order line should be supplied from a single lot.
CREATE TABLE lots (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  mo_id       INTEGER REFERENCES manufacturing_orders(id) ON DELETE SET NULL,
  workshop    TEXT,
  produced_at TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','released','hold','closed')),
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_lots_product ON lots(product_id);

CREATE TABLE kilns (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  workshop    TEXT,
  capacity_m2 REAL,
  fuel        TEXT DEFAULT 'Olive pits',
  notes       TEXT,
  active      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE kiln_loads (
  id          INTEGER PRIMARY KEY,
  number      TEXT NOT NULL UNIQUE,
  kiln_id     INTEGER NOT NULL REFERENCES kilns(id),
  status      TEXT NOT NULL DEFAULT 'loading' CHECK (status IN ('loading','firing','cooling','unloaded')),
  loaded_at   TEXT,
  fire_start  TEXT,
  fire_end    TEXT,
  unloaded_at TEXT,
  fuel_kg     REAL,
  peak_temp_c REAL,
  operator    TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE kiln_load_items (
  id           INTEGER PRIMARY KEY,
  kiln_load_id INTEGER NOT NULL REFERENCES kiln_loads(id) ON DELETE CASCADE,
  mo_id        INTEGER NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
  pcs_loaded   INTEGER NOT NULL DEFAULT 0,
  pcs_good     INTEGER,
  pcs_defect   INTEGER,
  defect_notes TEXT
);
CREATE INDEX idx_kli_load ON kiln_load_items(kiln_load_id);
CREATE INDEX idx_kli_mo ON kiln_load_items(mo_id);

CREATE TABLE stage_logs (
  id              INTEGER PRIMARY KEY,
  mo_id           INTEGER NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
  stage_id        INTEGER NOT NULL REFERENCES stages(id),
  worker_id       INTEGER REFERENCES workers(id) ON DELETE SET NULL,
  operator        TEXT,
  started_at      TEXT,
  finished_at     TEXT,
  qty_in          INTEGER,
  qty_good        INTEGER NOT NULL DEFAULT 0,
  qty_scrap       INTEGER NOT NULL DEFAULT 0,
  grade_a         INTEGER,                   -- sorting & packing: grade A pieces
  grade_b         INTEGER,                   -- sorting & packing: grade B (second choice) pieces
  scrap_reason    TEXT,
  kiln_load_id    INTEGER REFERENCES kiln_loads(id) ON DELETE SET NULL,
  completes_stage INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_stage_logs_mo ON stage_logs(mo_id);

CREATE TABLE qc_inspections (
  id             INTEGER PRIMARY KEY,
  mo_id          INTEGER REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
  lot_id         INTEGER REFERENCES lots(id) ON DELETE CASCADE,
  at             TEXT NOT NULL DEFAULT (datetime('now')),
  inspector      TEXT,
  sample_size    INTEGER,
  colour_var     INTEGER,   -- 1 low .. 5 extreme
  texture_var    INTEGER,   -- 1 smooth .. 4 heavy
  size_var       INTEGER,   -- 1 slight .. 4 extreme
  pits_chips     INTEGER,   -- 1 will occur .. 3 heavy
  crazing        INTEGER,   -- 1 will occur .. 3 heavy
  iron_spots     INTEGER,   -- 1 will occur .. 3 heavy
  matches_reference INTEGER,
  grade_a        INTEGER,
  grade_b        INTEGER,
  rejects        INTEGER,
  result         TEXT NOT NULL DEFAULT 'pass' CHECK (result IN ('pass','hold','fail')),
  notes          TEXT,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_qc_mo ON qc_inspections(mo_id);

-- =====================================================================
-- FACTORY: raw materials and purchasing
-- =====================================================================
CREATE TABLE suppliers (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  category     TEXT,
  contact_name TEXT,
  phone        TEXT,
  email        TEXT,
  address      TEXT,
  notes        TEXT,
  active       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE materials (
  id          INTEGER PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'other'
              CHECK (category IN ('clay','glaze','pigment','fuel','packaging','consumable','other')),
  unit        TEXT NOT NULL DEFAULT 'kg',
  min_stock   REAL NOT NULL DEFAULT 0,
  reorder_qty REAL,
  supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  unit_cost   REAL,
  colour_id   INTEGER REFERENCES colours(id) ON DELETE SET NULL,
  notes       TEXT,
  active      INTEGER NOT NULL DEFAULT 1
);

-- Bill of materials rules: how much of each material one m2 / piece / box consumes
CREATE TABLE bom_rules (
  id              INTEGER PRIMARY KEY,
  material_id     INTEGER REFERENCES materials(id) ON DELETE CASCADE,
  stage_id        INTEGER REFERENCES stages(id) ON DELETE SET NULL,
  format_id       INTEGER REFERENCES formats(id) ON DELETE CASCADE,
  family          TEXT NOT NULL DEFAULT 'all' CHECK (family IN ('all','zellige','cement')),
  finish          TEXT NOT NULL DEFAULT 'all' CHECK (finish IN ('all','glazed','natural')),
  per             TEXT NOT NULL DEFAULT 'm2' CHECK (per IN ('m2','piece','box')),
  qty             REAL NOT NULL,
  colour_specific INTEGER NOT NULL DEFAULT 0,   -- use the glaze material of the product colour
  notes           TEXT
);

CREATE TABLE purchase_orders (
  id            INTEGER PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  supplier_id   INTEGER NOT NULL REFERENCES suppliers(id),
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','ordered','partial','received','cancelled')),
  order_date    TEXT,
  expected_date TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE po_lines (
  id           INTEGER PRIMARY KEY,
  po_id        INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  material_id  INTEGER NOT NULL REFERENCES materials(id),
  qty          REAL NOT NULL,
  unit_cost    REAL,
  qty_received REAL NOT NULL DEFAULT 0
);

-- =====================================================================
-- STOCK POSITIONING
-- warehouse -> zone -> location (rack / level / position) -> stock unit
-- =====================================================================
CREATE TABLE warehouses (
  id      INTEGER PRIMARY KEY,
  code    TEXT NOT NULL UNIQUE,
  name    TEXT NOT NULL,
  address TEXT,
  notes   TEXT,
  active  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE zones (
  id           INTEGER PRIMARY KEY,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  name         TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'rack'
               CHECK (kind IN ('rack','floor','shelf','raw','quarantine','dispatch','receiving','samples')),
  color        TEXT,
  sort         INTEGER NOT NULL DEFAULT 0,
  notes        TEXT,
  UNIQUE (warehouse_id, code)
);

CREATE TABLE locations (
  id            INTEGER PRIMARY KEY,
  zone_id       INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  code          TEXT NOT NULL UNIQUE,         -- TET-A01-2B (unique everywhere)
  label         TEXT NOT NULL,                -- A01-2B (printed big)
  rack          TEXT,
  level         INTEGER,
  position      TEXT,
  capacity      INTEGER,
  capacity_unit TEXT NOT NULL DEFAULT 'pallet' CHECK (capacity_unit IN ('pallet','box','kg','any')),
  notes         TEXT,
  blocked       INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_locations_zone ON locations(zone_id);

CREATE TABLE shipments (
  id             INTEGER PRIMARY KEY,
  number         TEXT NOT NULL UNIQUE,
  client_id      INTEGER REFERENCES clients(id),
  mode           TEXT NOT NULL DEFAULT 'container_40'
                 CHECK (mode IN ('container_20','container_40','groupage','courier','pickup')),
  region         TEXT,
  incoterm       TEXT,
  incoterm_place TEXT,
  forwarder      TEXT,
  booking_ref    TEXT,
  container_no   TEXT,
  seal_no        TEXT,
  bl_no          TEXT,
  vessel         TEXT,
  port_loading   TEXT,
  port_discharge TEXT,
  ready_date     TEXT,
  etd            TEXT,
  eta            TEXT,
  max_payload_kg REAL,
  status         TEXT NOT NULL DEFAULT 'planning'
                 CHECK (status IN ('planning','booked','loading','loaded','shipped','delivered','cancelled')),
  notes          TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE shipment_orders (
  shipment_id INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  order_id    INTEGER NOT NULL REFERENCES sales_docs(id) ON DELETE CASCADE,
  PRIMARY KEY (shipment_id, order_id)
);

CREATE TABLE shipment_docs (
  id            INTEGER PRIMARY KEY,
  shipment_id   INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  code          TEXT NOT NULL,
  name          TEXT NOT NULL,
  hint          TEXT,
  status        TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','ready','sent','na')),
  attachment_id INTEGER REFERENCES attachments(id) ON DELETE SET NULL,
  notes         TEXT,
  sort          INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT
);
CREATE INDEX idx_shipment_docs ON shipment_docs(shipment_id);

-- A stock unit is anything with a label: a pallet, a group of boxes on a shelf,
-- a bag/drum of raw material, or an outbound shipping pallet.
CREATE TABLE stock_units (
  id            INTEGER PRIMARY KEY,
  code          TEXT NOT NULL UNIQUE,         -- PAL-000123, BX-000045, MAT-000012
  kind          TEXT NOT NULL DEFAULT 'pallet' CHECK (kind IN ('pallet','boxes','material','shipping')),
  product_id    INTEGER REFERENCES products(id),
  material_id   INTEGER REFERENCES materials(id),
  lot_id        INTEGER REFERENCES lots(id) ON DELETE SET NULL,
  supplier_lot  TEXT,
  grade         TEXT NOT NULL DEFAULT 'A' CHECK (grade IN ('A','B','C')),
  boxes         INTEGER NOT NULL DEFAULT 0,
  loose_pcs     INTEGER NOT NULL DEFAULT 0,
  qty           REAL NOT NULL DEFAULT 0,      -- materials, in material unit
  location_id   INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  parent_id     INTEGER REFERENCES stock_units(id) ON DELETE SET NULL,
  pool          TEXT NOT NULL DEFAULT 'general' CHECK (pool IN ('general','export_reserve','samples')),
  status        TEXT NOT NULL DEFAULT 'in_stock'
                CHECK (status IN ('in_stock','reserved','picked','loaded','shipped','consumed','scrapped','hold')),
  order_line_id INTEGER REFERENCES doc_lines(id) ON DELETE SET NULL,
  shipment_id   INTEGER REFERENCES shipments(id) ON DELETE SET NULL,
  mo_id         INTEGER REFERENCES manufacturing_orders(id) ON DELETE SET NULL,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_su_location ON stock_units(location_id);
CREATE INDEX idx_su_product ON stock_units(product_id, status);
CREATE INDEX idx_su_material ON stock_units(material_id, status);
CREATE INDEX idx_su_lot ON stock_units(lot_id);
CREATE INDEX idx_su_line ON stock_units(order_line_id);
CREATE INDEX idx_su_shipment ON stock_units(shipment_id);

CREATE TABLE stock_moves (
  id               INTEGER PRIMARY KEY,
  at               TEXT NOT NULL DEFAULT (datetime('now')),
  user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  unit_id          INTEGER REFERENCES stock_units(id) ON DELETE SET NULL,
  unit_code        TEXT,
  type             TEXT NOT NULL,
  from_location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  to_location_id   INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  boxes            INTEGER,
  qty              REAL,
  ref              TEXT,
  notes            TEXT
);
CREATE INDEX idx_moves_unit ON stock_moves(unit_id);
CREATE INDEX idx_moves_at ON stock_moves(at);

-- =====================================================================
-- CLAIMS
-- =====================================================================
CREATE TABLE claims (
  id                  INTEGER PRIMARY KEY,
  number              TEXT NOT NULL UNIQUE,
  client_id           INTEGER NOT NULL REFERENCES clients(id),
  order_id            INTEGER REFERENCES sales_docs(id) ON DELETE SET NULL,
  shipment_id         INTEGER REFERENCES shipments(id) ON DELETE SET NULL,
  lot_id              INTEGER REFERENCES lots(id) ON DELETE SET NULL,
  reported_at         TEXT NOT NULL,
  in_writing          INTEGER NOT NULL DEFAULT 1,
  before_installation INTEGER NOT NULL DEFAULT 1,
  category            TEXT NOT NULL DEFAULT 'breakage'
                      CHECK (category IN ('breakage','shortage','wrong_item','colour','quality','other')),
  description         TEXT,
  qty_affected        REAL,
  unit                TEXT DEFAULT 'm2',
  status              TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','investigating','accepted','rejected','resolved')),
  resolution          TEXT,
  credit_amount       REAL,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
