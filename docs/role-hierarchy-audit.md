# Role hierarchy audit — auto-warranty (VSC) fronter/closer CRM

Audit of the CRM's role/team hierarchy against auto-warranty tele-sales
call-center norms and RBAC/governance standards (ISO 27001:2022 A.5.3, NIST
SP 800-53 AC-6, NIST CSF v2.0). **Verdict: the hierarchy is sound and matches
standards — no restructuring needed.** The one real gap (a team-lead/supervisor
tier) is filled by the Teams feature (mig 211), which is the standards-preferred
way to model it (org via team scoping, not more role levels).

## Current → standard mapping
| Standard VSC role | CRM role (level) | Verdict |
|---|---|---|
| Owner / GM | superadmin (0) | ✅ |
| Director / company head | company_admin (2) | ✅ |
| Floor / Operations manager | operations_manager (3) | ✅ above the two managers |
| Fronter Manager | fronter_manager (4) | ✅ |
| Closer Manager | closer_manager (4) | ✅ |
| Team Lead / Supervisor (~1:10) | Teams "lead" (feature, not a role) | ✅ fills the one gap |
| Fronter (opener/qualifier) | fronter (6) — credited on the transfer | ✅ |
| Closer (sale + payment) | closer (5) — credited on the sale | ✅ |
| QA (independent of sales) | qa_manager / qa_agent | ✅ separate line |
| Compliance (TCPA/DNC, independent) | compliance_manager (sees all cos) | ✅ independent |
| Verifier / TPV (consent gate) | compliance `pending_review` flow | 🟡 implicit |

Two-company fronter↔closer split with `transfers` (fronter-attributed) →
`sales` (closer-attributed) is the exact industry model.

## What's already right (validated)
- **Separation of Duties (ISO 27001 A.5.3):** sales / QA / compliance / admin are
  distinct roles; one-role-per-company means a closer can't approve/QA their own
  sale. Compliance approves/returns (review ≠ execute). ✅
- **Least privilege (NIST AC-6):** default-OFF feature flags, per-user permission
  overrides, egress governance + audit, readonly-admin governance, PII/financial
  masking. ✅
- **Shallow management depth:** only ~4 levels are *management depth*
  (fronter/closer → managers → ops → company_admin → superadmin); readonly_admin,
  compliance_manager, qa_manager are **function/scope roles beside, not below** —
  the recommended design (express org via team scoping, not extra role levels).
- **Span of control:** front-line manager ~6–10 reports is the coaching-quality
  norm; use the Teams feature to keep team sizes sane.

## Recommendations (prioritized)
1. **Team-lead tier = Teams feature (DONE).** Assign team leads via Teams; do NOT
   add a `team_lead` role level (standards say a peer-lead gets lightly-elevated
   visibility, modelled by team membership — exactly what shipped).
2. **Optional business enhancements (net-new):**
   - **TCPA one-to-one consent on the lead** — 2024-25 FCC rule: store the specific
     consenting seller/closer-company on each transferred lead so a lead can't be
     silently reused across closer companies. Real legal-exposure reduction.
   - **Verification / TPV state** — formalize a "pending verification" gate before a
     sale counts as funded (you have `pending_review`), optionally a verifier role,
     so commission isn't paid on unverified sales.
   - **Comp gates** — transfer-acceptance quality gate (don't credit junk transfers)
     + chargeback clawback on sales (`chargeback_amount` already exists).
3. **Housekeeping** — dead legacy enum values (`manager`, `operations`) linger in
   `role_level` (Postgres can't drop enum values without recreating the type — low
   priority, cosmetic). Static-SoD at assignment is largely moot (one role/company).
4. **Process (no code):** quarterly access recertification; egress/activity audit
   already provides the evidence trail.

Sources: CallCentreHelper (outbound org, QA-vs-supervisor), NIST SP 800-53 AC-6 /
CSF v2.0, ISO 27001:2022 Annex A 5.3, FTC Telemarketing Sales Rule + FCC
one-to-one-consent, WarrantyWeek.
