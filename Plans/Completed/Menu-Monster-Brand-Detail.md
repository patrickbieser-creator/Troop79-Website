# Menu Monster — Brand Detail at Entry Time

**Status:** COMPLETE — shipped v1.201.0 (2026-10-07): the brand detail dialog (size / unit / price / store from the approved list) opens after a brand is typed and from the quantity row's size control; chip tap still picks; the brand is linked on the new package; store enforced server-side. qa-lead PASS-WITH-WARNINGS, the real ones fixed. Patrick's production eyes-on pending.
**Parked:** 2026-10-07
**Priority:** Medium

## Overview

When a scout types a brand on a menu ("Doritos", "Sour Cream & Onion") the brand exists with no package: no size, no price, no store. The quantity line then has nothing true to say after the number and falls back to the ingredient's name ("Sour Cream & Onion [4] Chips"). Patrick 2026-10-07: "Doritos and Sour Cream chips comes in bags with Oz, not 'chips'. Have Brad extend the prototypes to allow scouts to click on a brand and have a dialog / popup / inline to fill in more information that might be available at the time the brand is entered."

## Problem / Opportunity

- `brand-chooser.tsx` renders `x.pkg.sizeLabel ?? x.pkg.name` after the quantity; for a brand with no real package the placeholder package carries the ingredient's name, so the row reads "4 Chips". A number with a wrong noun is a data error on the shopping list.
- The facts a scout knows at the moment they type a brand (the bag says 12 oz, it cost $4.29 at Pick 'n Save) are lost unless they later find "No price yet" → the package form (v1.196.0).
- D-336 rule 4: a badge that asks for something is a control. "size?" in the noun slot must open the entry, never sit as grey text.

## Data model (read, not assumed — `src/lib/menu-monster/types.ts`)

- `Brand { id, ingredientId, name, isNew }` — `isNew` = nobody has priced it (no usable package).
- `Package { id, brandId, name (label text), sizeLabel ("12 oz"), yield + soldUnit (what one package holds, in the ingredient's unit), price, store, asOf }`.
- `BrandPick { brandId, qty }`, per ingredient per MENU (not per line).
- The live inline form that already collects a package: `menus/_components/add-package-form.tsx` (Name on the label, Store (optional), One package holds + Unit, Price "A best guess is fine.").

## Prototype

`prototypes/menu-monster-add-pattern/index.html` (Chips sub-card): tap a brand chip, or the quantity row's noun slot ("size?" on a brand with no package), to open size / unit / price / store. Inline panel under the chips row is the recommended surface; a Dialog variant is on the toggle at the top. Saving turns "New" off and the quantity row's noun becomes the real size ("4 × 12 oz bags").

## Acceptance Criteria

- [ ] A brand with no package never shows the ingredient's name in the quantity row; the noun slot is a control that opens the detail entry.
- [ ] Tapping a brand chip opens the same entry (one surface, one set of fields, Save greyed until something is typed, Cancel closes, focus returns to the chip).
- [ ] Saving creates the package through the existing path (the same RPC the "No price yet" form uses — scout-added packages wait for a leader where they do today) and the chooser, the shopping line and the price band update at once.
- [ ] Works on a scout's own menu and for a helping leader; a typed-in another scout shared follows the `addedBy` gate (BACKLOG, D-344–D-351 item 4).
- [ ] 390px: the panel fits without horizontal scroll; dom tests cover open / save / cancel / focus.

## Test Plan

- [ ] `Scout_SeesSizeControl_NotIngredientName_OnANewBrandsQuantityRow()`
- [ ] `Scout_TapsBrandChip_OpensDetailEntry_FocusInFirstField()`
- [ ] `Scout_SavesSizeAndPrice_QuantityRowShowsTheSize_AndNewIsGone()`
- [ ] `Scout_Cancels_FocusReturnsToTheChip()`
- [ ] `Save_IsGreyed_UntilSomethingIsTyped()`
- [ ] db: `NewBrandPackage_WaitsForALeader_LikeTheNoPricePath()`

## Technical Approach

Reuse `AddPackageForm` (compact mode) as the panel body; the chooser owns open/close state per brand id; the noun slot and the chip share one opener. No new tables: a saved detail is an `mm_packages` row via the existing scout-package RPC. Decide whether a brand chip's tap TOGGLES the pick (today) or opens detail — likely: tap = pick as today, a small "…" / the size control opens detail, so picking stays one tap.

## Implementation Steps

1. TBD after Patrick's decisions.

## Decisions (Patrick, 2026-10-07)

1. **Dialog.** ("dialog. build it.")
2. **Store is a pull-down from the approved stores** (the troop's `mm_stores` lookup, the one the admin Stores editor maintains) — never free text.
3. **Required fields (prototype behaviour, taken as spec):** Save is greyed until something is typed; a save with a price but no size marks size red in place (size is what makes the shopping math true). A brand may still exist with nothing known — the dialog can be dismissed.
4. **Chip tap semantics (orchestrator's call, say so to Patrick):** a chip tap still PICKS the brand in one tap, as today. The dialog opens (a) the moment a scout types a new brand — the facts are at hand right then — and (b) from the quantity row's noun slot: "size?" on a brand with no package, or the size text itself on one that has it. So "click a brand → dialog" holds for every brand that still needs its facts.

## Open Questions

None. Building 2026-10-07.
