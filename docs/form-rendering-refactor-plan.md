# Dynamic form-field rendering — consolidation plan

**Status:** planned (not started). Documented per decision on 2026-07-26.

## Problem
The "render dynamic sale/transfer fields" logic (the `field.field_type` switch)
is copy-pasted across multiple form components, each with its own copy of the
behaviour for `sale_client`, `sale_plan`, `select`, `text`, `zip`, vehicle, date,
etc. They drift, and every per-field behaviour must be re-implemented in each copy.

Real symptom this caused: the per-user **client access** filter was added to
`SaleForm` + `TransferFormModal` but not to `StaffShell`'s own inline dropdown, so
a restricted closer still saw all clients. Same root cause makes `StaffShell`'s
plan dropdown NOT cascade by client while `SaleForm`'s does.

## Duplicated render sites (field_type switch)
Form-facing (should share one renderer):
- `frontend/src/components/Closer/SaleForm.jsx` (~23 field renders)
- `frontend/src/components/Transfers/TransferFormModal.jsx` (~7)
- `frontend/src/components/Closer/ManualEntryModal.jsx` (~7)
- `frontend/src/shells/StaffShell.jsx` (~6, inline)

Legitimately separate (do NOT merge — different jobs):
- `Admin/FormBuilder/FormBuilder.jsx` (the field *editor*)
- `Admin/DataAnalyzer/DataAnalyzer.jsx` (a *filter* builder)

## Load-bearing contracts to preserve (do NOT change)
- `useSaleConfigs` hook signature (`{ clients, plans, fetchConfigs }`).
- `sale_configs` value strings + the `sale_plan` field's `options` shape
  `[{ client, plans: [] }]` (the cascade).
- `field_type` values.
- Per-user `client_access` on the auth user (null = unrestricted).

## Phase 1 — shared "smart field" renderer (small, high ROI)
Extract just the two behaviour-heavy fields into one shared module, e.g.
`frontend/src/components/Form/SaleClientPlanFields.jsx` (or a `useClientPlanField`
hook) that owns:
- `sale_client`: filter by `user.client_access` (null = all) + preserve current
  value via a stale `<option>`.
- `sale_plan`: cascade by the selected client from `field.options`, + stale option.

Then route all four form-facing components through it. Result: client access +
plan cascade behave identically everywhere; StaffShell's plan cascade is fixed;
future rules are a one-line change.

Order (one at a time, behaviour-identical, build+test each):
1. Build the shared component with the exact current SaleForm behaviour.
2. Swap `SaleForm` to use it (should be a no-op visually).
3. Swap `StaffShell` (also gains the plan cascade).
4. Swap `TransferFormModal`, then `ManualEntryModal`.

## Phase 2 — unify the whole field renderer (bigger, later)
One `<DynamicField field value onChange context />` that renders every
`field_type`. All four form components delegate to it. FormBuilder / DataAnalyzer
stay separate.

## Guardrails
- Pure frontend consolidation — no DB, schema, or endpoint changes.
- Convert one component at a time; unconverted ones keep working.
- Verify each with `npm run build` + a manual pass of the sale + transfer forms.

## Database note (separate concern)
Sale fields are stored in BOTH `form_data` (JSONB) and denormalized typed columns.
This is intentional (columns power fast queries/exports/reporting). Do NOT collapse
it. The only improvement worth making is ensuring a single write-path always keeps
both in sync (mostly true already) — a separate, smaller task from this UI refactor.
