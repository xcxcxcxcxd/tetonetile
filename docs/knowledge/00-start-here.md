---
title: Start here - how the system fits together
summary: One database, three systems (CRM, Factory, Stock). What each one does, who uses it, and how to get started.
system: general
tags: overview, roles, setup, getting started
order: 1
---

# Start here

Zelligerar runs on **one shared database** with **three working systems** on top of it. Everything a person does in one system is immediately visible in the others - a quote becomes an order, the order becomes a manufacturing order, the manufacturing order becomes labelled pallets on a rack, and the pallets become a shipment.

| System | What it covers | Main screens |
|---|---|---|
| **Database** | Products (format × colour), colours, formats, prices, clients, lots, warehouse positions, users | [Catalogue](/catalog), [Settings](/settings) |
| **CRM · Sales** | Enquiry → samples → quote → order → gates → invoice → payment, and claims after delivery | [Clients](/clients), [Pipeline](/pipeline), [Quotes](/docs?type=quote), [Orders](/docs?type=order), [Invoices](/docs?type=invoice) |
| **Factory · Production** | Manufacturing orders, lots, the stage route, kilns, quality control, raw materials, purchasing | [Production board](/production), [Kilns](/production/kilns), [Quality & lots](/production/qc), [Raw materials](/materials) |
| **Stock · Logistics** | Where every pallet is (warehouse → zone → rack → level → position), put-away, picking, counting, shipments | [Warehouse map](/warehouse), [Stock](/stock), [Put away](/warehouse/putaway), [Shipments](/shipments) |

**QR labels connect the physical factory to the records.** Every pallet, rack position, kiln, material bay, production card and carton carries one. Scanning it with any phone opens the right screen. See [QR codes](kb:qr-codes).

## The whole cycle in one picture

```
Enquiry ─► Samples ─► Quote ─► Sales order ─► Gates: written colour approval + deposit
                                                   │
                                                   ▼
                         Release to production: reserve ONE lot from stock, or make ONE new lot
                                                   │
       MO card ─► clay ─► shaping ─► drying ─► glazing ─► KILN LOAD ─► chiselling ─► SORT / QC ─► PACK
                                                                                                  │
                         Pallets with QR labels ─► put away at a rack position ─► reserved for the order
                                                                                                  │
                         Shipment ─► pick list ─► scan-to-load ─► document pack ─► invoice ─► payment
```

Each article in this knowledge base explains one part:

- [The database](kb:database) - what is stored and the rules that keep it clean
- [CRM](kb:crm) and [Quotes, orders and invoices](kb:quotes-orders-invoices) - the sales side
- [The production cycle](kb:production-cycle), [Quality control](kb:quality-control), [Raw materials](kb:raw-materials) - the factory
- [Stock positioning](kb:stock-positioning), [QR codes](kb:qr-codes), [Shipping](kb:shipping) - stock and logistics
- [Claims](kb:claims) - after delivery
- [Product knowledge](kb:product-knowledge) and [Installation & care](kb:installation-care) - what we sell and how it is installed
- [Daily routines](kb:daily-routines) - who does what, every day
- [Glossary](kb:glossary) - the words we use

## Who does what (roles)

| Role | Can do |
|---|---|
| **Admin** | Everything, including Settings, users, prices, backups |
| **Sales** | Clients, quotes, orders, invoices, payments, samples, claims, shipments. Sees costs and prices |
| **Production** | Manufacturing orders, the shop-floor screen, kilns, QC, lots, raw materials, purchasing |
| **Warehouse** | Stock, put-away, moves, counts, picking, scan-to-load, receiving deliveries |
| **Viewer** | Reads everything except costs; changes nothing |

Each person has their own sign-in (Settings → Users). Changes are recorded in the activity log (Settings → Data & backup) and every stock movement in [Movements](/stock/moves).

## Finding your way

- **How this works** (top right of every page, or the book icon) opens the procedure for the page you are on, in this panel, without leaving the page.
- **Ctrl K** (or the search bar) finds any client, document, product, lot, pallet or location. You can type a code like `PAL-000123`, `A01-2B` or `L26-0012`.
- **Scan** (camera icon, or the round button at the bottom on a phone) reads any QR label.
- Coloured dots in the menu tell you which system a screen belongs to: blue = CRM, orange = Factory, green = Stock, purple = Database & knowledge.

## First-time setup checklist (admin)

Do these once, in this order. Each step has its own screen in [Settings](/settings).

1. **Company** - legal name, address, ICE, IF, RC, Patente, CNSS, bank (RIB / IBAN / SWIFT). They print on every quote and invoice. Set the **public address** used in QR codes *before* printing any label.
2. **Document library** - upload the Technical Data Sheet, Material Specification and Installation Guide PDFs. Installers download them from the public page of every carton label.
3. **Sales defaults** - currency, overage (15 % minimum), deposit, lead time, VAT, payment terms, exchange rates, the sale conditions printed on quotes.
4. **Catalogue** - import the full 36-colour range from the Colour Range sheet (CSV), then **Create missing products** so every colour exists in every format. Enter or import the **cost** of each product: list prices are computed from it.
5. **Production** - check the stage instructions, kiln capacities, the workers list (they are picked on the shop-floor screen) and the bill of materials figures.
6. **Warehouse** - check the zones of each building and **Add positions** for every rack, lane and shelf. Print the location labels and stick them on the beams.
7. **Users** - one account per person, with the right role.
8. **QR labels** - print and place: locations, kiln doors, material bays, procedure posters. See [QR codes](kb:qr-codes).
9. **Backups** - the server keeps a daily copy by itself; download a first backup and keep copies off the server every week.

> Golden rule: **one colour = one lot = one kiln batch, shipped together.** Most of the rules in this system exist to protect that.
