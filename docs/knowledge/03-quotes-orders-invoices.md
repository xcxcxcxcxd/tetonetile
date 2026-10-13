---
title: Quotes, orders, proformas and invoices
summary: Step by step - building a quote with product images, sending it, the order gates, releasing to production, deposits, invoices, payments and credit notes.
system: crm
tags: quote, order, proforma, invoice, credit note, payment, deposit, gates, overage, packing, vat, pdf
order: 4
---

# Quotes, orders, proformas and invoices

All sales documents share one editor. A document is copied forward along the chain - nothing is typed twice:

**Quote → Sales order → (Deposit proforma) → Invoice → (Credit note)**

## 1. Build the quote

[Quotes](/docs?type=quote) → **New**, or **New quote** from a client or an opportunity.

1. **Add products** opens the visual catalogue: pick by colour and format. Each line shows the **product picture**, which is also printed on the PDF - the client sees exactly which colour and format is quoted. You can replace the picture of one line (for a custom piece or a mock-up) by clicking it; *reset* goes back to the product picture.
2. Enter the **net area** the client measured (m², or pieces / linear metres for trim). The editor adds the **overage** (15 % by default, 20–30 % for selected appearance or contrasting grout), rounds up to **full boxes**, and shows pieces, boxes, weight and pallets.
3. The **price** comes automatically: contract price for this client → fixed tier price → cost × tier multiplier × colour adjustment, in the client's currency. A changed price is kept; **Reprice** recalculates all lines.
4. **Free line** adds anything else: mounting on mesh, sample box, freight, handling.
5. Check the side panel: **packing** (pallets per family, the container or groupage suggestion), the **tier minimum** warning, totals, deposit, VAT (Moroccan clients only; export sales carry the exemption note).
6. Terms: incoterm and place (FCA Tanger Med by default - avoid DDP), payment terms, lead time in weeks, validity. The sale conditions from Settings print at the bottom.

**Save** (Ctrl S). **Print / PDF** gives the A4 document with pictures, packing, conditions and a QR code linking to the public installation & care guide.

## 2. Send it

**Send** → copy the prepared message, attach the PDF, send it by email or WhatsApp, then press **Sent by email / Sent by WhatsApp**. The quote is marked *sent*, the opportunity moves to *Quoted* and the send is logged on the client timeline. Create a follow-up task.

## 3. Accepted → sales order

On the quote: **Sales order**. The order copies every line, price and term, and the quote becomes *accepted*. Edit the order if the client changed quantities.

The order now shows the **gates**:

| Gate | How it is recorded |
|---|---|
| **Written colour approval** | **Record** with the date of the email / signed approval. Attach the email under Files |
| **Deposit** | Opens **automatically** when the payments on the order reach the deposit % - or **Record** it by hand |
| **Promised ready date** | Calculated: the later of the two gates + the lead time |

> Production cannot start until both gates are green. Only an admin can override, and only with the owner's agreement - colours cannot be changed once glazing starts.

For the deposit, **Deposit proforma** creates a proforma for the client to pay against.

## 4. Release to production

On the order, **Production & stock** → **Release to production**. For each tile line the system:

1. Reserves the boxes from **one lot in stock** if a single lot can cover the whole line - the smallest lot that fits, so bigger lots stay available for bigger orders - or
2. Creates **one manufacturing order = one new lot** for the missing boxes, due one week before the promised date.

The result window shows what was reserved and which MOs were created. The table below the gates tracks each line: reserved, in production (with the current stage), shipped, the lots, and a **blend** warning if a line ended up on several lots.

**Reserve stock** re-runs the reservation only (for example after a lot was released from QC hold). The **Pick list** prints the pallets to collect, in walking order.

When everything is reserved the order becomes **Ready to ship**: **Plan shipment** creates the shipment with the right document pack (see [Shipping](kb:shipping)).

## 5. Payments

**Record payment** on the order (or on its invoice - payments of an order chain are always kept on the order):

- Choose **deposit**, **balance**, **payment** or **refund**, the method and the bank reference.
- Invoices of the order are settled **oldest first** from the order's payments, so a deposit paid before the invoice existed is counted automatically.
- Statuses update by themselves: *part paid*, *paid*, and **overdue** when the due date passes with a balance left.

## 6. Invoice

After loading (or on the agreed date), on the order: **Invoice**. Check it, then **Issue** it (Send → or the ⋯ menu). An **issued invoice cannot be edited**. To correct it, open the invoice and create a **Credit note**, then issue a new invoice if needed. An invoice with payments cannot be cancelled - use a credit note.

Moroccan invoices carry the legal identifiers of the issuing company (ICE, IF, RC, Patente, CNSS) and the bank details - fill them in once in Settings → Company.

## Statuses at a glance

| Document | Statuses |
|---|---|
| Quote | draft → sent → accepted / rejected / expired |
| Sales order | draft → confirmed → in production → ready to ship → shipped → delivered → closed (or cancelled) |
| Proforma | draft → issued → paid |
| Invoice | draft → issued → part paid → paid; *overdue* when past due |
| Credit note | draft → issued |

## Good practice

- Quote **every colour as one lot** and include the overage for future repairs; a re-order will not match.
- Never quote below the tier minimum without a small-order fee or a reason in the internal notes.
- Use **Internal notes** for anything the client must not see - they never print.
- Put the client's PO number in **Client reference** - it prints on every document of the chain.
