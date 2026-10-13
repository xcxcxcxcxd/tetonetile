---
title: Stock positioning - every pallet has an address
summary: Warehouses, zones and positions, pallet and box labels, put-away with suggestions, finding stock, moves, splits, holds, stock pools, cycle counts and picking.
system: stock
tags: stock, warehouse, positioning, location, rack, zone, putaway, put away, map, count, inventory, pick, pallet, box, label
order: 8
---

# Stock positioning

**Every pallet, box group and material lot has a QR label and an address.** The address is always:

```
Warehouse  →  Zone  →  Rack / lane  →  Level  →  Position
   TET     -    A        01             2          B        =  TET-A01-2B   (short label: A01-2B)
```

- **Racking**: `A01-2B` = zone A, rack (bay) 01, level 2 (level 1 is the floor), position B (from the left).
- **Floor lanes**: `B03-2` = zone B, lane 03, second pallet deep.
- **Single bays**: `M01`, `Q02`, `D04`, `IN01`.

The short label is printed big on the location label; the full code (with the warehouse) is in the QR.

## The zones

| Zone (Tétouan) | Kind | What goes there |
|---|---|---|
| **IN** | Receiving / packing out | New pallets from the packing station, deliveries - until put away |
| **A** | Pallet racking | Finished goods pallets, one per position |
| **B** | Floor stacking | Pallets in lanes, 2 high where safe |
| **S** | Shelving | Box groups (part pallets, small orders), up to 30 boxes per bin |
| **X** | Samples | Sample boxes and showroom stock |
| **M** | Raw materials | Clay, glazes, olive pits, cartons, sawdust, pallets |
| **Q** | Quarantine / QC hold | Pallets of lots on hold - **never** picked |
| **D** | Dispatch staging | Picked pallets waiting for the truck |

The Fès workshop has its own receiving area, racking and raw materials. Add or change zones and generate positions in Settings → Warehouse (**Add positions** builds a whole rack block in one go and its labels are ready to print).

## What a stock unit is

| Unit | Code | Holds |
|---|---|---|
| Pallet | `PAL-000123` | Full boxes of **one product, one lot, one grade** (78 boxes zellige, 60 cement) |
| Box group | `BX-000045` | Fewer boxes, on a shelf - part pallet, returns, small orders |
| Material lot | `MAT-000012` | One delivery of a raw material |

A unit never mixes two lots. Its label shows the SKU, colour, **lot**, boxes, grade, m², weight and - once reserved - the order it belongs to. Print **two labels per pallet** (front and side, on the stretch film).

## The warehouse map

[Warehouse map](/warehouse) draws every zone and rack. Each cell is a position: fill shows how full it is, small coloured squares show the glaze colours stored there, a blue border means reserved for an order, amber means QC hold, stripes mean blocked.

Type in **Where is…?** - a SKU, a colour name, a lot or a pallet code - and the matching positions light up. Click a cell to see what is there, move it, count it or print its label.

## Put-away (after packing or receiving)

New pallets sit in the packing-out area (`IN01`) until they are put away. [Put away](/warehouse/putaway) lists them, oldest first.

1. Open **Scan → Put away / move**.
2. Scan the **pallet label**. The system suggests positions: **same lot already there** first (keeps the batch together), then the same product, empty positions, ground level for fast sellers, never over capacity, quarantine for held lots.
3. Take the pallet to a suggested position (or any position) and scan the **location label**.
4. Done - the pallet's address is updated and the move is logged.

Without the app open: scan the pallet with the phone camera, tap **Next: I will scan the location label**, then scan the beam label - the app asks *"Put it here?"*.

## Finding stock

- **Stock → Where is…?** lists every unit of a SKU, colour or lot with its position, sorted for walking.
- **Ctrl K** finds any pallet or location code.
- The **product page** shows stock by lot with all positions.
- **Free (A)** = grade A, in stock, not reserved. Reserved and held boxes are never offered twice.

## Moving, splitting, correcting

From a unit (scan it, or open it from Stock):

- **Move** - to any position; capacity is checked (you can override with a confirmation).
- **Split** - take boxes off a pallet into a new box group (for a small order or a shelf); print the new label.
- **Correct qty** - after breakage in handling or a recount; a reason is required and logged.
- **Put on hold / Release hold** - block a damaged or doubtful unit.
- **Stock pool** - *general*, *reserved export stock* (fast sellers kept for small export buyers) or *samples*. Only general stock is offered to orders automatically.

Every action writes a line in [Movements](/stock/moves): who, when, from, to, how many.

## Counting (cycle counts)

Count a few locations every week instead of a yearly stocktake.

1. [Count](/stock/count) (or scan a location → **Count it**).
2. Scan the **location label**, then every unit label you see there; correct the boxes if they differ.
3. **Finish count**. The system reports: units confirmed, units found here that the system had elsewhere (moved here), quantities corrected, and units **missing** (their location is cleared - they appear in *Put away* until found).

## Picking for an order

1. On the order, print the **Pick list** - reserved pallets in walking order with their positions.
2. **Scan → Pick an order**: scan the order's QR (on the printed order or pick list), then the **dispatch bay label** (`D01`…) where the pallets will wait.
3. Scan each pallet as you take it. Pallets not reserved for this order are refused. Picked pallets are moved to the dispatch bay and loaded from there (see [Shipping](kb:shipping)).

## Rules

- **Scan, don't carry.** A pallet moved without scanning is a pallet lost. Put away within the shift.
- **One unit = one lot.** Never top up a pallet with boxes from another lot.
- **Quarantine is for held lots only**, and nothing leaves it without a QC release.
- **Labels stay readable.** Replace torn location labels (QR labels → Rack & floor locations) and re-print pallet labels from the unit page.
- **Blocked positions** (damaged beam, aisle works) are marked blocked in Settings → Warehouse and are never suggested.
