---
title: QR codes - where they go and what scanning does
summary: The QR placement plan for the factory, warehouse, dispatch and showroom; what each label opens; printing, sizes and the public pages installers see.
system: general
tags: QR, labels, scan, scanner, printing, placement, poster, thermal, public page, installer
order: 9
---

# QR codes in the factory

A QR label turns any phone into a terminal: point the camera, and the right screen opens with the next action. Labels are printed from [QR labels](/labels).

## How a scan works

Every label encodes an address: `<public address>/q/<CODE>` - for example `https://crm.example.com/q/PAL-000123`. The public address is set in Settings → Company **before** printing.

- **Staff (signed in)** land on the record with its actions: move a pallet, record work on a batch, load a kiln, receive a material.
- **Anyone else** (installer, client, visitor) only sees public product information - never stock, prices or clients. Carton labels and showroom labels are made for them.
- In the app, **Scan** (camera icon, or the round button on a phone) reads labels continuously - beep and vibration confirm each scan. The in-app camera needs an **https** address; the phone's own camera app and **handheld barcode scanners** work everywhere (a handheld scanner simply types the code into the scan box).

## The placement plan

| Where | Label | Who scans | What opens |
|---|---|---|---|
| **Office & showroom** | *Showroom label* next to every sample on the wall and on sample boxes | Sales, visitors | Public product page: specs, applications, installation guide (staff also see stock) |
| | *Procedure poster* "Start here" | New staff | This knowledge base on the phone |
| **Clay preparation, shaping, drying racks** | *Production card* (MO traveller) clipped to the batch | Team leader | Shop-floor screen: good pieces, scrap, worker, stage finished |
| | Poster "Record work on the shop floor" | Everyone | The procedure |
| **Glazing** | Production card; *showroom labels* on the colour reference board | Glazer | Record work; check the colour code |
| **Kilns** | *Kiln door label* (`KILN-K1`) on each kiln | Kiln operator | Kiln station: start a load, add batches, fire, cool, unload |
| | Poster "Loading and unloading a kiln" | Operator | The procedure |
| **Chiselling, sorting & QC** | Production card; poster "Sorting & QC" with the standard | Sorters, inspector | Record grades A / B / reject and the QC check |
| **Packing station** | *Carton label* on **every carton** (lot QR) | Installers, clients, staff | Public: product, lot, installation & care guide. Staff: lot traceability |
| | *Pallet label* ×2 per pallet (front and side) | Warehouse | Pallet: move, split, pick, load |
| | Poster "Packing and labelling" | Packers | The procedure |
| **Warehouse racking, lanes, shelves** | *Location label* on the beam under every position, the front of every floor lane, every shelf bin | Warehouse | What is stored there; finishes a put-away; starts a count |
| | Poster "Put away and count" at the entrance | Warehouse | The procedure |
| **Quarantine (Q)** | Location labels + a red "QC hold" sign | Warehouse, QC | Held pallets and their lot |
| **Raw material store (M)** | *Bay label* per material (clay, glazes, olive pits, cartons…); *lot label* on each delivery | Storekeeper | Stock level; receive a delivery; record use |
| **Dispatch & loading dock (D)** | Dispatch bay labels; the *loading sheet* of the shipment | Loading team | Scan-to-load: every pallet checked against the shipment |
| | Poster "Loading a container" | Loading team | The procedure, incl. photos and seal |
| **On the documents** | Quotes and orders carry a QR to the installation & care guide; pick lists carry the order QR | Clients, warehouse | Public guide; picking mode |

Print the posters from QR labels → **Procedure posters** (A4, one per workstation) - each shows the steps and a QR to the full procedure.

## Label types and sheets

| Label | Default sheet | Notes |
|---|---|---|
| Locations | A4, 24 per sheet (70 × 37 mm) | Use polyester / outdoor labels on beams |
| Pallets & box groups | A4, 4 per sheet (A6) or thermal 100 × 150 mm | Thermal printer at the packing station is ideal |
| Carton labels | A4, 24 per sheet, or thermal 100 × 50 mm | One per carton: the number printed = the boxes of the lot |
| Production cards | A4, 2 per sheet (A5) | Slide into a plastic sleeve |
| Kiln doors | A4, 2 per sheet (A5) | Heat: place the label beside the door, not on it |
| Material bays | A4, 8 or 24 per sheet | One per bay, at eye level |
| Procedure posters, loading sheets | A4 | Laminate posters |

## Codes you can also type

The scan box and the search (Ctrl K) accept the code itself:

`PAL-000123` pallet · `BX-000045` box group · `MAT-000012` material lot · `A01-2B` position · `L26-0012` lot · `MO-2026-0008` batch · `KL-2026-0029` kiln load · `KILN-K1` kiln · `SO-2026-0011` order · `SH-2026-0001` shipment · `ZR10-03` product · `KB-qr-codes` procedure

## Making labels scan well

- **Size**: at least 20 mm for labels scanned at arm's length; 40 mm or more for beam labels scanned from the floor. For high levels, put the label on the lowest beam with an arrow, or use bigger labels.
- **Matte, not glossy** - glare under workshop lights stops cameras.
- **Test one label** from each print run with a phone before sticking a whole aisle.
- **Re-print damaged labels** straight away from the record (unit page, location page, MO page). The code never changes, so a re-printed label is identical.
- **Never** re-use a pallet label on another pallet. When a pallet is split, the new part gets a new label.
