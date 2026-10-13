# Zelligerar Factory CRM

One system for a handmade-zellige workshop: **one shared database** and **three working systems** on top of it, connected to the physical factory by **QR labels**.

| System | What it does |
|---|---|
| **Database** | Products (format × colour), colours, formats, price tiers and contract prices, clients, lots, warehouse positions, users |
| **CRM · Sales** | Clients, pipeline, samples, tasks; quotes, orders, proformas, invoices and credit notes **with a product picture on every line**; colour-approval and deposit gates; payments; claims |
| **Factory · Production** | Manufacturing orders (one MO = one lot = one colour batch), the stage route, a big-button shop-floor screen, kiln loads, QC against the Variation & Imperfection standard, QC holds and quarantine, lot traceability, raw materials, bill of materials, purchasing, planning, piece-work report |
| **Stock · Logistics** | Every pallet, box group and material lot has an address (warehouse → zone → rack → level → position): warehouse map, put-away with suggestions, moves, splits, holds, cycle counts, picking, shipments with container fill, document packs by destination and scan-to-load |

A **knowledge panel** (book icon, or *How this works* on any page) explains each procedure without leaving the page; the same articles are a full knowledge base and print as workstation posters with a QR code. Installers who scan a carton label get a public page with the product, the lot and the installation & care guide.

## Quick start

Requirements: **Node.js 20 or newer** (22 recommended).

```bash
npm install
npm start            # http://localhost:3000
```

The first visit asks for the first admin account. Then follow **Knowledge base → Start here → First-time setup checklist**.

To try it with fictitious demo data (clients, orders, batches in production, stock, a shipment):

```bash
npm run demo         # only loads into an empty database
npm start
```

Run the tests with `npm test`.

## Configuration

Copy `.env.example` to `.env` (or set the variables in your service manager / Docker):

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Listen address |
| `DATA_DIR` | `./data` | Database, uploaded photos and PDFs, automatic backups |
| `PUBLIC_URL` | address used by the browser | Address printed in every QR label, e.g. `https://crm.example.com` - can also be set in Settings → Company |
| `SECURE_COOKIES` | off | Set `1` when the app is served over HTTPS |
| `TRUST_PROXY` | off | Set `1` behind a reverse proxy (Caddy, Nginx, Cloudflare) |
| `SESSION_DAYS` | `30` | How long a sign-in lasts |

## Phones, QR labels and the camera

- Phones must reach the app: on the factory Wi-Fi (`http://192.168.x.x:3000`) or on the internet.
- Set the **public address before printing labels** - it is encoded in every QR code.
- The **in-app camera scanner needs HTTPS**. Without HTTPS, scan labels with the phone's own camera app (they open the app) or use a handheld barcode scanner, which types the code into the scan box.
- Easiest HTTPS: a small server with a domain name and [Caddy](https://caddyserver.com) in front (automatic certificates), or a tunnel such as Cloudflare Tunnel or Tailscale Funnel.

Example `Caddyfile`:

```
crm.example.com {
  reverse_proxy localhost:3000
}
```

with `PUBLIC_URL=https://crm.example.com SECURE_COOKIES=1 TRUST_PROXY=1`.

## Docker

```bash
cp .env.example .env      # edit PUBLIC_URL
docker compose up -d      # data is kept in ./data
```

## Backups

- The server keeps a **daily copy** of the database by itself (last 14 days) in `data/backups/`.
- **Settings → Data & backup → Download a backup** gives a copy of the database at any time.
- `npm run backup -- /path/to/usb` writes a dated folder with the database **and** the uploaded photos and PDFs - schedule it daily, e.g. `0 2 * * * cd /opt/zelligerar && npm run backup -- /mnt/backup`.
- **Restore**: stop the app, copy `zelligerar.db` over `data/zelligerar.db` and the `uploads` folder over `data/uploads`, start the app.

Keep copies **off the server**.

## Roles

| Role | Can do |
|---|---|
| Admin | Everything, including settings, users, prices, backups |
| Sales | Clients, quotes, orders, invoices, payments, samples, claims, shipments; sees costs |
| Production | MOs, shop floor, kilns, QC and lots, raw materials, purchasing; production settings |
| Warehouse | Stock, put-away, moves, counts, picking, loading, receiving; warehouse layout |
| Viewer | Reads everything except costs |

## Before going live - what to fill in

The reference data shipped here comes from the product documentation (Material Specification, Technical Data Sheet, Installation Guide, packing sheet). Business data is **not** in this repository - enter it in the app:

1. **Colours**: only the colours named in the documents are pre-loaded (01, 03, 14, 25, 39 and natural). Import the full **36-colour range** from the Colour Range sheet (Settings → Catalogue → Import, CSV), then **Create missing products**.
2. **Costs** per product (list prices are computed from them) and the **price tiers** if they differ.
3. **Company legal IDs and bank details** (ICE, IF, RC, Patente, CNSS, RIB/IBAN/SWIFT) - printed on invoices.
4. **Exchange rates**, deposit %, lead time, sale conditions (Settings → Sales defaults).
5. **Forwarders** (Settings → Logistics).
6. **Kilns and their capacity**, **workers** and their piece rates, and your measured **bill of materials** figures (Settings → Production).
7. **Warehouse layout**: zones and positions of each building (Settings → Warehouse → Add positions), then print and stick the location labels.
8. Packing data marked *to confirm* (7 × 7 cm square and the plint).

## Knowledge base

Articles are Markdown files in `docs/knowledge/`. The front matter sets the title, summary, system (`general`, `database`, `crm`, `factory`, `stock`), order and tags; `public: true` makes an article readable without signing in (only the installation & care guide is public). Edit a file and the change shows within seconds. Numbered steps in an article become the steps of its workstation poster.

## Project layout

```
server/            Express API, SQLite (better-sqlite3), services for docs, production, stock, shipments
server/migrations  Database schema
shared/            Business rules used by the server and the browser (quantities, packing, pricing, QC standard)
public/            The web app (Preact + htm, no build step), styles, icons
docs/knowledge/    Knowledge base articles
test/              End-to-end tests (node --test)
data/              Your database, uploads and backups - never committed
```

## Privacy

This repository contains no client data. Everything you enter lives in `data/` (ignored by git). Do not commit `data/` or `.env`.
