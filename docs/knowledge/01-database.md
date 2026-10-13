---
title: The database - what is stored and the rules
summary: Master data (products, colours, formats, prices, clients, locations) and the transactions built on it. Numbering, data rules, imports, exports and backups.
system: database
tags: database, master data, catalogue, numbering, backup, import, export, settings
order: 2
---

# The database

All three systems read and write **one database**. There is no copy of the data in spreadsheets: if something is not in the database, the system cannot use it. Keep the master data clean and the rest follows.

## Master data (set up once, kept up to date)

| Record | What it is | Where |
|---|---|---|
| **Format** | Size and packing: pieces per m², pieces per box, m² and kg per box, boxes per pallet, production loss % | Settings → Catalogue |
| **Colour** | Glaze code and name (`03` Marrakech red), finish (glazed / natural), lead-free, price adjustment, fast seller | Settings → Catalogue |
| **Product** | One **format × colour** = one SKU, e.g. `ZR10-03` = 10 × 10 cm in colour 03. Also custom pieces, samples and services | [Catalogue](/catalog) |
| **Price tier** | End user, Trade, Wholesale, Programme - each a multiplier on cost, with a minimum order in pallets | Settings → Catalogue |
| **Fixed / contract price** | A price for one client (contract) or one tier (fixed list price) on one product | Product page → Prices |
| **Client** | Company, contacts, tier, currency, region (decides the shipping documents), incoterm | [Clients](/clients) |
| **Stage** | The production route: clay, shaping, drying, glazing, firing, chiselling, sorting, packing | Settings → Production |
| **Kiln, worker, supplier, material** | Factory resources | Settings → Production, [Raw materials](/materials) |
| **Warehouse → zone → location** | Every place stock can be: `TET-A01-2B` = Tétouan, zone A, rack 01, level 2, position B | Settings → Warehouse, [Warehouse map](/warehouse) |
| **Issuing company** | Legal identity printed on documents (ICE, IF, RC, Patente, CNSS, bank) | Settings → Company |

## Transactions (created by daily work)

Opportunities, samples, quotes, orders, proformas, invoices, credit notes, payments, manufacturing orders (MO), lots, stage records, kiln loads, QC inspections, stock units (pallets, box groups, material lots), stock movements, shipments, claims, purchase orders, activities and tasks.

## Numbers you will see

| Prefix | Example | Record |
|---|---|---|
| `Q` | Q-2026-0042 | Quote |
| `SO` | SO-2026-0011 | Sales order |
| `PF` / `INV` / `CN` | INV-2026-0013 | Proforma / invoice / credit note |
| `MO` | MO-2026-0008 | Manufacturing order (one batch) |
| `L` | L26-0012 | Lot = one colour batch, printed on every carton |
| `KL` | KL-2026-0029 | Kiln load (one firing) |
| `PAL` / `BX` / `MAT` | PAL-000123 | Pallet / box group on a shelf / raw material lot |
| `SH` | SH-2026-0001 | Shipment |
| `CL` / `SMP` / `PO` | CL-2026-0001 | Claim / sample / purchase order |

Yearly series restart in January. Numbers are never reused, so a printed document can always be found again: type the number in search (Ctrl K) or scan its QR code.

## Rules that keep the data trustworthy

- **One lot per order line.** A line is served from one lot in stock or produced as one new lot. Splitting a colour across lots shows as banding on the wall. If it cannot be avoided the order shows a **blend** warning.
- **Quantities in three units.** Lines are entered in m² (or pieces, linear metres, boxes); the system adds the overage, rounds up to **full boxes**, and works out pieces, weight and pallets. The net area is kept separately, so re-saving never adds the overage twice.
- **Prices come from one place.** Contract price for the client → fixed tier price → cost × tier multiplier × (1 + colour adjustment), converted with the exchange rates in Settings. A buyer is always invoiced in **one currency**.
- **Costs are private.** Only admin and sales see product costs; production, warehouse and viewers never do.
- **Issued invoices are final.** To correct one, create a credit note from it. Drafts can be edited or deleted.
- **Stock is only changed by movements.** Receiving, packing, moving, splitting, counting, loading - each writes a line in [Movements](/stock/moves) with who, when, from and to.
- **Deactivate, do not delete.** A colour, format, product, worker or location that has been used cannot be deleted; switch it to inactive and it disappears from the pickers.

## Imports and exports

- **Import** (Settings → Catalogue → Import from a spreadsheet): colours, products & costs, clients, opening stock. CSV with column names on the first line. Existing codes are updated, new ones created. Importing new colours creates their products in every format automatically.
- **Export** (Settings → Data & backup): clients, products, documents, lines, payments, stock by position, movements, production, materials - CSV files for Excel or Google Sheets.

## Backups

The database is a single file. The server keeps a **daily copy automatically** (the last 14 days, in its backups folder). That protects against mistakes, not against losing the machine: **download a backup** from Settings → Data & backup at least weekly and keep it off the server (USB key, cloud drive), or run `npm run backup -- <folder>` on the server, which also copies the photos and PDFs. A backup contains every record: clients, documents, payments, production history, lots and stock positions. Photos and PDFs are separate files in the uploads folder - back that folder up too.

## Who can change master data

Only **admin** changes Settings and prices. Production can edit stages, kilns, workers, materials and the bill of materials; warehouse can edit warehouses, zones and locations. Everyone can read.
