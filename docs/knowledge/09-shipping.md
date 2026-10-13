---
title: Shipping - containers, groupage and the document pack
summary: Planning a shipment, container fill and payload, booking, picking, scan-to-load, photos and seal, the document pack per destination, packing list and US origin file.
system: stock
tags: shipping, shipment, container, groupage, pallet, payload, loading, seal, documents, packing list, certificate of origin, EUR.1, ISF, FTA, incoterm
order: 10
---

# Shipping

A shipment is one truck or container leaving the factory - for one order or several. The system plans the load, builds the **document pack for the destination**, and checks **every pallet** at the dock.

## 1. Plan the shipment

When an order is **ready to ship** (every line reserved), on the order: **Plan shipment** - or [Shipments](/shipments) → **New shipment** and choose the orders.

- **Transport**: 20 ft or 40 ft container, groupage truck, courier or client pickup. The quote already suggested one from the pallet count.
- **Region** decides the document pack (from the client: US, EU, UK, GCC, Morocco, other).
- **Incoterm and place**: FCA Tanger Med by default. CFR when we book the sea freight. **Avoid DDP**.
- **Ready date**, forwarder, booking reference.

### Container fill

| | 20 ft | 40 ft |
|---|---|---|
| Zellige pallets (78 boxes) | 10 | 18 |
| Cement pallets (60 boxes) | 20 | 22 |
| Payload limit (set in Settings → Logistics) | 21.5 t | 26.5 t |

Zellige fills the floor before the weight limit; cement hits the weight limit first. A full 40 ft of zellige approaches 28 t gross, which is over the payload of many routes - **the weight decides, not the floor**. The shipment page shows floor space and payload as bars and warns when either is over 100 %. Small loads: **groupage** for up to about 4 pallets.

Book the transport about **3 weeks before the ready date** (Settings → Logistics).

## 2. The document pack

Each shipment gets a checklist of documents for its region. Mark each **Ready**, **Sent** or **Not needed**, and attach the file (scan or PDF).

| Every export | Plus for the US | Plus EU / UK | Plus GCC |
|---|---|---|---|
| Commercial invoice | Bill of lading | EUR.1 (EU) / origin statement (UK) | Arab certificate of origin (GAFTA) |
| Packing list (SKU with glaze suffix, lots, boxes, m², weights per pallet) | **ISF data to the buyer's broker - before loading** | CMR (road) or bill of lading | Bill of lading |
| Certificate of origin (Chamber of Commerce) | US–Morocco FTA origin file | | |
| Manufacturer's declaration of conformity | Prop 65 labels on cartons and pallets | | |
| Technical Data Sheet + Material Specification | CPSC labels; SDS for each glaze in the container | | |
| Loading photos + seal number | | | |

Moroccan clients: invoice with VAT, delivery note (*bon de livraison*) signed by the receiver, loading photos.

The **Technical Data Sheet and Material Specification** you uploaded in Settings → Company are linked on that line.

- **Packing list** (button on the shipment): one row per pallet - code, SKU, colour, lot, grade, boxes, pieces, m², net and gross weight, HS code - with totals.
- **Origin file** (US): the **batch production record** of every lot on board - stages with dates, kiln loads with fuel, QC - for the FTA origin claim.

## 3. Pick and load

1. Print the **pick list** from each order, or pick with **Scan → Pick an order** (pallets go to the dispatch bay).
2. Print the **Loading sheet** (QR labels → Loading sheets, or the shipment page) and take it to the dock.
3. **Scan to load**: scan the loading sheet QR (or open the shipment), press **Scan to load**, and scan **every pallet label** as it goes in.
   - Pallets of this shipment's orders are accepted, with a beep and a green flash.
   - **Free stock, another client's pallet, or a pallet on QC hold is refused** with the reason - it stays on the dock.
   - The counter shows loaded / total; the list shows what is left and where it is.
4. Photograph **each row of pallets** and the **closed doors with the seal**. Add the photos on the shipment (camera button) - they protect us against transit-breakage claims.
5. **Loading finished** - enter the **seal number** for a container.

A wrongly loaded pallet can be taken off (**Unload**) - it goes back to dispatch as picked.

## 4. Ship

**Mark shipped** when the truck leaves. The system checks and warns if:

- reserved pallets of the orders are not loaded,
- documents in the pack are still *to do*,
- a container has no seal number.

You can ship anyway after reading the warnings. Shipping moves the pallets out of stock (status *shipped*), updates the orders to *shipped*, and sets the ETD. Then **invoice** the balance (see [Quotes, orders and invoices](kb:quotes-orders-invoices)), send the document pack, and **Mark delivered** on arrival.

## Rules

- **Nothing loads without a scan.** The loading scan is the last check that the right lot reaches the right client.
- **ISF for the US is sent before loading**, never after.
- **One lot per line** also on the truck: the packing list shows the lot of each pallet so the installer can keep batches together.
- Keep the **seal number and photos** of every container - claims for breakage are answered with them.
