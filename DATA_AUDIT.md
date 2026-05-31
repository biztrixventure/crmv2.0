# Data Audit — BizTrix CRM v2.0

Audit date: 2026-05-30
Audit method: full table scan via service-role REST against production Supabase.

---

## Headline

**~1252 field-level dirty values across 7165 customer-facing rows** (transfers + sales + callbacks). No row deletions recommended — every record represents a real customer interaction. Cleanup is field-level (NULL the junk, leave the row).

| Table | Total rows | Dirty fields | % of rows |
|---|---|---|---|
| `transfers` | 5,175 | 754 | ~14% |
| `sales` | 354 | 475 | many rows have >1 issue |
| `callbacks` | 1,636 | 23 | ~1% |
| `callback_numbers` | 0 | 0 | empty |

---

## What "dirty" means here

A field is dirty if it carries one of:

- Placeholder text where a real value belongs (`-`, single character, empty after trim)
- Pure-digit string in a name / state / city field (zip-prefix junk pasted into the wrong slot)
- 2-letter code in a state field that isn't a real USPS abbreviation (`Tu`, `St`, `Nw`, `Ae`, `Za`)
- Phone number that doesn't normalize to exactly 10 digits
- Zip that isn't exactly 5 digits
- VIN that isn't exactly 17 chars
- Email with no `@`
- Person name containing digits

---

## Breakdown by table + field

### transfers (5,175 rows)

| Field | Dirty | Notes |
|---|---|---|
| `State` (in form_data) | **5** | `Tu`, `St`, `Nw`, `Ae`, `Za` — 4 from bulk, 1 manual. Migration 067 didn't catch them (look like USPS codes but aren't). |
| `Phone` | 14 | Examples: `"8474455874 801"` (digits + extra), `"302287209"` (9-digit), `"196 000 miles"` (someone pasted mileage), `"09174806115"` (11-digit) |
| `Zip` | **622** | The big one. Many imported as 4-digit (`"5678"` instead of `"05678"`) or with non-digit chars. |
| `Email` | 110 | Missing `@`. Mix of bulk and manual. |
| `Name` | 3 | Contained digits (`"John1"`). |
| **Source split** | 2611 bulk · 2564 manual | Roughly 50/50 entry vector |

### sales (354 rows)

| Field | Dirty | Notes |
|---|---|---|
| `client_name` | **345 / 354** | **100% of bulk-uploaded sales** carry placeholder client_name. Almost certainly the bulk template defaulted to `-` or empty. Manual sales = 0 dirty. |
| `customer_email` | 128 | Missing `@`. |
| `car_vin` | 2 | Not 17 chars. |
| `customer_phone` | 0 | Clean — backend normalization caught these. |
| `customer_name` | 0 | Clean. |
| **Source split** | 345 bulk · 9 manual | 97% bulk. |

### callbacks (1,636 rows)

| Field | Dirty | Notes |
|---|---|---|
| `customer_state` | 0 | Clean — typed column, validated on insert. |
| `customer_phone` | 10 | Don't normalize to 10 digits. |
| `customer_name` | 13 | Contain digits. |

### callback_numbers (0 rows)
Empty table. Nothing to audit.

---

## Where the dirty data came from

### Source 1: Bulk CSV uploads — biggest contributor
- `2611 / 5175` transfers (50%) came in via bulk uploader (`upload_batch_id` set).
- `345 / 354` sales (97%) came in via bulk.
- Bulk imports bypass the browser form entirely → zip autofill never runs → state dropdown never seen → backend trusts the CSV row as written.
- Pattern: agents (or their data brokers) export from external systems → CSV → upload. Source systems often default empty fields to `-`, or store zip as a number that loses the leading 0.

### Source 2: Manual form entry — meaningful minority
- `2564 / 5175` transfers (50%) entered via browser form.
- Even with zip-autofill + normalize, agents could:
  - Type over the autofilled state with junk (`"Ae"`)
  - Skip zip and type state directly (no autofill triggers)
  - Backspace fields after autofill, leaving stale data
- 1 of the 5 state orphans is manual entry — pattern is rare but real.

### Source 3: Legacy data — predates current safeguards
- ~1000 transfers carried the old `-` placeholder, numeric junk, `"District Of Columbia"` casing variant, `"Taxas"` typo. Migration **067 already cleaned these to NULL** so they show in the Unspecified bucket of the Data Analyzer instead of being orphaned.
- These rows date back to before the form had zip autofill / field normalizers.

### Source 4: API / integration writes — likely zero
- No evidence yet of direct API hits, but the door is open: any POST to `/api/transfers` from Postman / scripts skips the browser form. Backend validators don't currently reject malformed state / zip / phone. Add this as a defense layer.

---

## Recommendation: clean, don't delete

**Delete is wrong** — every dirty row is a real customer call / lead / sale. The DB row exists because something happened in the business. Losing it means losing the audit trail.

**Clean instead**: null-out the dirty field on each row, leave the rest intact. Three-tier plan:

### Tier 1 — Field-level cleanup (one-shot migration)

A new migration 068 should:

1. Tighten the state junk detector — flag 2-3 char strings that fail USPS expansion AND canonical lookup. Catches `Tu`, `St`, `Nw`, `Ae`, `Za`.
2. Normalize zip: strip non-digits, blank to NULL if not exactly 5.
3. Normalize phone: strip non-digits, blank to NULL if not exactly 10.
4. Blank `client_name` to NULL when value matches junk pattern (`-`, single char, empty).
5. Blank email to NULL when missing `@`.
6. Strip digits from name fields → blank if result < 2 chars.

After 068: dirty data is gone from active queries (Data Analyzer, filters), original rows still present (no INSERT/DELETE — just field UPDATEs with `IS DISTINCT FROM` guards).

### Tier 2 — Backend validation (prevent future)

Add express-validator middleware to every write path:

- `transfers` POST, PUT
- `sales` POST, PATCH
- `callbacks` POST, PUT
- Bulk upload validation phase (reject the bad CSV row, surface to UI, don't silent-skip)

Rules:
- State must be in canonical 51 set OR null
- Phone must match `/^\d{10}$/` OR null
- Zip must match `/^\d{5}$/` OR null
- Email must match `/^[^@\s]+@[^@\s]+\.[^@\s]+$/` OR null
- VIN must match `/^[A-HJ-NPR-Z0-9]{17}$/` OR null

400 on violation, with field name so the UI / uploader can surface it inline.

### Tier 3 — Frontend constrained inputs (close the source)

- State field → replace text input with `<select>` of 51 canonical (and `null`/blank for international). Kill free-text state everywhere — SaleForm, TransferFormModal, StaffShell inline form.
- Phone field → already digit-stripping. Keep.
- Zip field → already 5-digit cap. Keep.
- Email field → add `type="email"` + browser HTML5 validation.
- VIN field → already 17-char A-HJ-NPR-Z 0-9 cap. Keep.

### Tier 4 — Database CHECK constraints (last line of defense)

After Tier 1 cleanup completes:

```sql
ALTER TABLE callbacks
  ADD CONSTRAINT callbacks_state_canonical
  CHECK (customer_state IS NULL OR customer_state IN ('Alabama', /*…51*/));

ALTER TABLE sales
  ADD CONSTRAINT sales_phone_format
  CHECK (customer_phone IS NULL OR customer_phone ~ '^\d{10}$');

ALTER TABLE sales
  ADD CONSTRAINT sales_vin_format
  CHECK (car_vin IS NULL OR car_vin ~ '^[A-HJ-NPR-Z0-9]{17}$');
```

For JSONB fields (transfers.form_data, sales.form_data) — CHECK can't directly enforce, but a BEFORE INSERT/UPDATE trigger can call the same cleaner functions as migration 067 on every write. That makes the DB itself reject or auto-clean any bad value, no matter what app code does.

---

## Suggested execution order

1. Migration 068 (cleanup) — runs once, takes seconds.
2. Backend validators — ship to backend routes.
3. Frontend state dropdown — ship to form components.
4. DB CHECK + trigger — last, after data is clean. Constraints will reject anything in violation, so they MUST come after Tier 1.

Tier 1 is non-destructive (only updates dirty fields to NULL). Tier 2 + 3 prevent the next 12 months of accumulation. Tier 4 makes accidents impossible at the storage layer.

---

## What NOT to do

- ❌ Don't `DELETE FROM transfers WHERE …`. Every row is a real customer event.
- ❌ Don't blanket-replace junk with a guess (e.g., setting `"Tu"` → `"Texas"` because they start the same). Wrong > NULL.
- ❌ Don't add CHECK constraints before running 068 — every existing row violates them, ALTER fails.
- ❌ Don't trust the browser-side normalizers as a defense. They protect ~50% of writes (manual form entries). Bulk + API hits bypass them entirely.

---

## Open questions for the team

1. The 622 bad zips — was there ever a bulk import that lost leading zeros (Excel auto-formats `"05678"` to `5678`)? If yes, future imports need a CSV parser that reads everything as text.
2. The 345 sales with placeholder client_name — should the field be required on bulk submission, or is `-` legitimate for sales without an originating client?
3. Should backend validators reject or silently fix? Reject is safer (forces caller to provide good data) but harder for bulk uploads.

---

## Files this audit references

- `backend/migrations/067_state_cleanup.sql` — already applied, cleans state field junk
- `backend/utils/titleCase.js` — name normalization
- `backend/utils/stateMap.js` — state code expansion
- `backend/routes/dataAnalyzer.js` — handles Unspecified bucket
- `frontend/src/utils/formFieldNorm.js` — central frontend field rules
- `backend/utils/uploadService.js` / `saleUploadService.js` — bulk insert paths (entry point for most dirty data)
