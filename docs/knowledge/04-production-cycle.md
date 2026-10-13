---
title: The production cycle - from order to labelled pallet
summary: Manufacturing orders and lots, the stage route, the production card, recording work on the shop floor, kiln loads, sorting, packing and the production board.
system: factory
tags: production, manufacturing order, MO, lot, stages, shop floor, kiln, firing, packing, board, card, traveller
order: 5
---

# The production cycle

**One manufacturing order (MO) = one lot = one colour batch.** The lot code (for example `L26-0012`) follows the batch from clay to the client's site: it is printed on every carton, every pallet label and the packing list. Different kiln loads give different shades, so a colour is produced and shipped as one batch.

## The route

Each product follows the stages that apply to it (Settings → Production → Production stages):

| Glazed zellige | Natural (unglazed) zellige | Hand-painted | Cement tiles |
|---|---|---|---|
| Clay preparation | Clay preparation | Clay preparation | Moulding & pressing |
| Hand shaping | Hand shaping | Hand shaping | Curing |
| Sun drying | Sun drying | Sun drying | Sorting & QC |
| Glazing | - | Glazing | Packing |
| - | - | Hand painting | |
| Kiln firing | Kiln firing | Kiln firing | |
| Hand chiselling | Hand chiselling | Hand chiselling | |
| Sorting & QC | Sorting & QC | Sorting & QC | |
| Packing & palletising | Packing & palletising | Packing & palletising | |

Pieces flow stage to stage: what was recorded *good* at one stage is what waits at the next. Scrap is recorded where it happens, with a reason.

## 1. Where MOs come from

- **Client orders** - on the order, **Release to production** (after colour approval and deposit). One MO per line that stock cannot cover from a single lot; due one week before the promised date.
- **Stock and export reserve** - [Production board](/production) → **New MO**, or [Planning → Export reserve](/production/planning?tab=reserve) → **Create MO** for fast-selling colours below their target.
- **Samples** and **rework / replacement** (for an accepted claim) - New MO with that purpose.

The MO calculates the **pieces to start**: boxes × pieces per box × (1 + production loss %). The loss % is set per format (10–12 % by default) so the batch ends with full boxes.

## 2. Release and print the production card

A new MO is *planned*. **Release** sends it to the workshop: the system checks the raw materials the batch still needs (clay, glaze of that colour, olive pits, cartons, pallets) and warns if any is short (see [Raw materials](kb:raw-materials)).

Print the **Production card** (A5, from the MO page). It carries the MO number, a picture of the product, colour, lot, quantities, due date, a **QR code** and the route as a table (date, good, scrap, worker) that can be filled in by hand if the network is down. The card travels **with the batch**: drying racks, glazing table, kiln trolley, chiselling bench, sorting table.

## 3. Record work on the shop floor

At the end of each stage or shift, the team leader **scans the production card** (any phone or tablet). The shop-floor screen opens on the current stage:

1. Check the stage - it is pre-selected; tap another one if needed.
2. Tap **Good pieces** and type the number on the big keypad (**All waiting** fills the rest). Tap **Scrap** for broken pieces and choose the **reason** (cracked, warped, glaze defect…).
3. Tap **who did the work** - the workers of that stage's team are listed first. Piece-work pay is calculated from these entries (Planning → Labour).
4. Tick **"stage finished for the whole batch"** when nothing more will come; it is ticked automatically when the count equals what was waiting.
5. **Save**. The screen confirms the next stage. Move the batch and its card there.

The system refuses more pieces than are waiting. Closing a stage with pieces still unaccounted for asks to record them as a **shortfall** - count again before accepting.

Office staff can record the same thing from the MO page (click a stage in the route).

## 4. Firing = kiln loads

Firing is recorded **per kiln load**, because colour varies between loads and the lot record must show which firings it went through.

1. At the kiln, scan the **kiln door label** (or open [Kilns](/production/kilns)) → **Start a load**.
2. **Add** the batches on the trolley with their piece counts. The system suggests how many pieces still **fit** the kiln's capacity (m²) and asks for confirmation before overloading it - an overloaded kiln fires unevenly.
3. **Start firing**. When the fire is out: **Firing finished** - record the peak temperature and the olive pits used.
4. **Cooling**. Then **Unload & count**: good and defective pieces per batch (good + defective = loaded).

Unloading writes the firing stage on every MO in the load. A large batch is fired over several loads; the firing stage closes when its last pieces come out.

## 5. Sorting, QC and packing

- **Sorting & QC** - every piece is graded **A**, **B** or **reject**, and the batch is checked against the Variation & Imperfection standard. Outside the standard, the lot goes on **QC hold** automatically. See [Quality control](kb:quality-control).
- **Packing** - full boxes only, packed in sawdust, **78 boxes per pallet** (zellige) or **60** (cement). Saving creates the **pallets and box groups** with their QR codes at the packing-out area (`TET-IN01`): print **two labels per pallet** (front and side) and the **carton labels** of the lot (one per carton). Loose pieces stay with the last unit.
- Pallets made for a client order are **reserved for that order line automatically**. If the lot is on hold, they go to **quarantine** instead and are reserved only when the lot is released.
- Then put the pallets away by scanning (see [Stock positioning](kb:stock-positioning)).

When the last stage closes the MO is **completed** and the lot is **released**.

## The production board

[Production board](/production) shows every open MO as a card in the column of its current stage, with the pieces waiting there, the lot, the order and the due date. Red border = late; amber = on hold. **Release to workshop** sits on planned cards. Filter by purpose (client order, stock, export reserve…) or search a SKU, lot or client.

Other actions on the MO page: **Hold** (stop work, with a reason), **Resume**, **Cancel**, **Close** (after completion).

## Planning

[Planning](/production/planning):

- **Materials needed** - what every open MO still needs for its unfinished stages, against stock. **Order** creates a purchase order.
- **Export reserve** - fast-selling colours kept in stock for small export buyers: target, in reserve, in production, and what to make.
- **Labour & piece work** - good pieces and scrap per worker and stage over a period, with pay where a piece rate is set.

## Rules on the floor

- **Never mix two MOs on one rack or trolley without their cards.** No card, no record.
- **One colour per glazing session.** Check the colour code on the card against the colour reference board before glazing.
- **Record at the end of every shift**, not at the end of the week - the board and the promised dates depend on it.
- **Do not fire damp pieces.** Sun drying is finished only when the pieces are dry through.
- **Scrap is not a failure, unrecorded scrap is.** The scrap rate per stage is how the process gets better.
