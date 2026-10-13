---
title: CRM - from enquiry to won order
summary: Clients, the pipeline, samples, tasks and follow-ups. How an enquiry becomes a quote and an order, and the rules sales must respect.
system: crm
tags: crm, clients, pipeline, opportunities, samples, tasks, tiers, currency, incoterm
order: 3
---

# CRM - from enquiry to won order

The CRM keeps **every client, every conversation and every document** in one place, so anyone can pick up a client file and know where things stand.

## 1. Create the client once

[Clients](/clients) → **New client**. Fill in:

| Field | Why it matters |
|---|---|
| **Type** (end user, architect / trade, wholesale, programme, distributor) | Sets the default price tier |
| **Tier** | The price list used on quotes (End user × 1.7, Trade × 1.35, Wholesale × 1.25, Programme × 1.2 by default) |
| **Currency** | A buyer is quoted and invoiced in **one currency only**. Changing it later on a document shows a warning |
| **Region** (US, EU, UK, GCC, Morocco, other) | Decides the shipping document pack and VAT (Moroccan clients pay VAT, export sales are exempt) |
| **Incoterm + place** | FCA Tanger Med by default. **Avoid DDP**: we would become the importer of record and pay duties |
| **Contacts** | Who signs, who receives the goods, who pays |

Before creating a client, search first (Ctrl K) - duplicates split the history.

The client page shows everything: opportunities, quotes, orders, invoices with the open balance, samples, shipments, claims, contract prices and the activity timeline.

## 2. Track the opportunity

[Pipeline](/pipeline) is a board of opportunities by stage:

**New enquiry → Qualified → Samples sent → Quoted → Negotiation → Won / Lost**

- Create one opportunity per project ("Riad patio 140 m²"), not per client.
- Enter the **estimated value** and **expected close date** - the dashboard shows the open pipeline value per stage, and each stage carries a win probability.
- Sending samples linked to the opportunity moves it to *Samples sent*; sending a quote moves it to *Quoted*; an accepted quote (or converting it to an order) marks it *Won*.
- When you lose, record the **reason** (price, lead time, colour, competitor) - it is the most useful sales statistic you will have.

## 3. Samples

[Samples](/samples) → **New sample request**: choose the client, the colours (several pieces of each - one tile does not represent the range), the method and any charge.

1. **Requested** - the warehouse prepares the box from the samples shelf (zone X).
2. **Prepared → Sent** - enter the tracking number. A **follow-up date 10 days later** is set automatically and appears in tasks.
3. **Delivered → Colour approved / Not approved** - record the client's feedback.

> Samples are **indicative only**. Colour varies between kiln loads; the delivered order will not match a sample exactly. Say it before the client approves.

A colour approval on a sample is not yet the **written colour approval** the order needs - record that on the order itself (Gates), with the email or signed proforma attached.

## 4. Tasks and follow-ups

Every client and opportunity has an activity timeline: calls, emails, meetings, notes and tasks with due dates. [My tasks](/tasks) lists what is due, overdue first. The dashboard's *Needs attention* list adds quotes about to expire, samples to follow up, orders waiting for a gate, overdue invoices and claims.

Good habits:

- Log every call or meeting in two lines - what was said, what happens next.
- Every open quote has a follow-up task. Quotes are valid 30 days by default; expired quotes can be re-sent.
- Chase deposits with a task the day the proforma goes out.

## 5. Quote → order

The quote, order, proforma and invoice are covered step by step in [Quotes, orders and invoices](kb:quotes-orders-invoices). In short:

1. **Quote** with product pictures on every line, quantities including overage, packing (boxes, pallets, container suggestion) and the sale conditions.
2. **Send** it (PDF by email or WhatsApp) - it is logged on the client timeline.
3. **Accepted → Sales order.** The order waits for two gates: **written colour approval** and **the deposit**.
4. Production starts only when both are recorded. The promised ready date = the later gate + the lead time.

## Rules sales must respect

- **Overage**: at least **15 %** on every tile line (20–30 % for selected appearance or contrasting grout). It covers cutting, breakage and future repairs - a later order will not match.
- **Tier minimums**: a tier has a minimum order in pallets. The quote warns when an order is below its tier minimum; a small-order fee can be set in Settings.
- **One currency per buyer.**
- **Batch continuity**: quote enough to produce the full quantity of each colour as **one lot**. Never promise a top-up from another batch.
- **No production before the gates** - only the owner (admin) can override, and colours cannot be changed once glazing has started.
- **Lead time** is counted from the written colour approval and the deposit, whichever comes last - never from the quote date.
