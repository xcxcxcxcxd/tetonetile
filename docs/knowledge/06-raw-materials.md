---
title: Raw materials, bill of materials and purchasing
summary: Clay, glazes, olive pits, cartons, sawdust and pallets - stock by lot with QR bay labels, the bill of materials, shortages before a batch starts, and purchase orders.
system: factory
tags: materials, clay, glaze, olive pits, fuel, packaging, bill of materials, BOM, purchasing, purchase order, supplier
order: 7
---

# Raw materials and purchasing

A batch stops if one input is missing: clay, the glaze of its colour, olive pits for the kiln, cartons, sawdust or pallets. The system keeps the stock of each material and warns **before** a batch is released.

## Materials and where they are

[Raw materials](/materials) lists every material with its stock, minimum, quantity on order and supplier. Categories: clay, glazes, pigments, kiln fuel, packaging, consumables.

- Every **delivery** becomes a **lot** with its own QR label (`MAT-…`) and a position in the raw-material zone (bays `M01`, `M02`…). The oldest lot is used first.
- Each **glaze** is linked to its **colour** (Glaze 03 → colour 03 Marrakech red), so the bill of materials picks the right glaze for every batch.
- Each bay has a **bay label** (QR labels → Raw material bays). Scanning it shows the stock and lets you receive or record use.
- Below the **minimum stock** a material shows in red, on the dashboard and in Planning.

## The bill of materials (BOM)

Settings → Production → **Bill of materials** says how much of each material one m², one piece or one box consumes, and at which stage. The defaults are **estimates** - replace them with your measured figures:

| Stage | Material | Default |
|---|---|---|
| Hand shaping | Clay | 24 kg / m² (squares), 42 kg / m² (bejmat), 30 kg / m² (plint) |
| Glazing | Glaze of the product colour | 1.2 kg / m² |
| Kiln firing | Olive pits | 5 kg / m² |
| Packing | Carton, sawdust, pallet | 1 carton / box, 0.5 kg sawdust / box, 1 pallet / 78 boxes (60 for cement) |

The BOM is used three ways:

1. **Release check** - when an MO is released, the materials it still needs are compared with stock; shortages are shown immediately (and on the MO page).
2. **Planning** - [Materials needed](/production/planning) adds up what all open MOs still need for their unfinished stages, against stock, with an **Order** button.
3. **Automatic deduction** (optional, Settings → Production) - when work is recorded at a stage, the materials of that stage are deducted from the oldest lots. Switch it on once the BOM figures are measured; until then record use by hand.

## Receiving a delivery

1. With a purchase order: open it → **Receive delivery** → quantity per line, supplier lot / delivery note, the bay. Partial deliveries are fine - the PO stays *part received*.
2. Without a PO: [Raw materials](/materials) → **Receive delivery** (or the material page → **Receive**).
3. **Print the lot labels** (the screen opens them) and stick one on each bag stack, drum or pallet of the delivery.

## Recording use by hand

Material page → **Record use**: quantity, what it was for (MO number, kiln load), notes. Use it for tests, repairs, waste, or for all use while automatic deduction is off. A **count** of a bay (Stock → Count) corrects the stock when it drifts.

## Purchasing

[Purchasing](/purchase-orders) → **New purchase order**: supplier, lines (material, quantity, unit cost), expected delivery.

- From a shortage, **Order** pre-fills the material and the quantity missing; from the low-stock warning it pre-fills every low material.
- **Save draft** or **Mark as ordered**. Overdue deliveries show in red.
- Suppliers are kept in Settings → Production → Suppliers (or **New** in the PO form).

## Good practice

- Measure the real consumption of clay, glaze and olive pits on three batches and enter it in the BOM - it makes planning and costing reliable.
- One **glaze batch** per colour lot when possible; note the glaze lot in the MO notes. A bad glaze batch is then traced in minutes.
- Keep olive-pit stock for at least two weeks of firings - deliveries are seasonal.
- Count the raw-material bays monthly.
