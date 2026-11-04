# Resume after a Windows reinstall

Written 2026-11-05, before a clean Windows install. Open Claude Code in the
restored folder and say **"continue the setup"** — this file is the handover.

Repo: `https://github.com/biztrixventure/crmv2.0.git` (branch `main`)

---

## 1. WHAT THE GITHUB ZIP DOES NOT CONTAIN

A ZIP (or a fresh clone) carries only what is tracked. These are **gitignored on
purpose** and will NOT come back on their own. Copy them to a USB stick or cloud
drive **before wiping the machine** — nothing below can be regenerated from the
repo:

| Item | Size | Why it cannot be recovered from git |
|---|---|---|
| `.env` | ~1 KB | Live Supabase URL + service-role key, VAPID keys, superadmin emails. **The backend will not start without it.** |
| `backend/.env.local` | ~1 KB | Backend-local overrides. |
| `.claude/settings.local.json` | ~1 KB | Local Claude Code settings. |
| `.mcp.json` (if present) | small | MCP server config — holds the Supabase service key and GitHub PAT. |
| Root spreadsheets / CSV / JSON dumps | ~10 MB total | Dialer exports, scorecard sheets, debug dumps. **Contain real customer PII**, which is exactly why they are not in git. |

`.env.example` IS tracked and is a safe placeholder template — use it as the
shape of `.env`, then paste the real values back from the backup.

**Do NOT restore these by committing them.** Copy the files into place.

### Safe to leave behind (rebuildable)
- `graphify-out/` — **616 MB**. Rebuild with `graphify update .` (AST-only, no API cost).
- `node_modules/` in both `backend/` and `frontend/` — `npm install`.
- `frontend/dist/` — `npm run build`.
- `backend/coverage/`, `.playwright-mcp/`, `backend/scratch/` — throwaway.

---

## 2. Toolchain that was in use

- Node **v25.9.0**, npm **11.12.1** (anything on Node 20+ should be fine)
- Git, and a GitHub credential for `biztrixventure/crmv2.0`
- Python 3 (only used ad hoc for scripted edits)

## 3. Restore steps

```bash
# 1. the code
git clone https://github.com/biztrixventure/crmv2.0.git
cd crmv2.0

# 2. the secrets — copy from your backup, do not recreate by guessing
#    ./.env            ./backend/.env.local
#    ./.claude/settings.local.json     ./.mcp.json (if you had one)

# 3. dependencies
cd backend  && npm install && cd ..
cd frontend && npm install && cd ..

# 4. prove it works before changing anything
cd backend  && npm test          # expect: 24 suites, 432 tests passing
cd ../frontend && npm run build  # expect: a clean vite build
```

Run it:
- backend `cd backend && npm run dev` (nodemon) or `npm start` — port 3001
- frontend `cd frontend && npm run dev` (vite)

**The backend has no hot reload for a stale process** — if behaviour looks old,
check the `node server.js` start time against the latest commit.

## 4. Database — nothing to restore

Supabase is hosted; the reinstall does not touch it. The repo's
`backend/migrations/` are applied **by hand** in the Supabase SQL editor.

- Highest applied is tracked in `CLAUDE.md` → "Database Migrations".
- `223_compliance_manager_qa_scoring.sql` is still marked **pending**.
- Post-apply check: `node backend/verify_migrations.js`

## 5. Where the work was left (2026-11-05)

Everything is committed and pushed; the working tree was clean apart from the
untracked files listed in section 1. Recent shipped work, newest first:

- `340eabb` a refused sale now tells the closer why — a 409 was rendering under
  the sale modal, so the closer saw nothing and re-submitted three times.
- `c3866c7` live list refresh — the notification bell was already instant but
  every list only loaded on mount. `utils/liveEvents.js` +
  `hooks/useLiveRefresh.js`, no new polling.
- `3bec794` download a batch's numbers (+ `egressAudit` on
  `/api/distribution-batches`).
- `63a2cf8` ManagerShell had tabs with no renderer (Customer Lookup, DNC, Card
  Validator).
- `e57f0e2` compliance Export CSV now exports what the filters are showing.

**Open, deliberately not done** (each is noted in `CLAUDE.md` with its reason):
- `TRANSFER_EVENTS` is declared in `utils/liveEvents.js` and unwired — the
  transfer lists have the same staleness the sale lists just had.
- Review Queue + Call Reviews still open the old `ExportModal` filter dialog.
- The "My Numbers" tab in `StaffShell` has a nav entry and no renderer.
- Client-name drift to clean by hand: `Moxy Mtm`/`Moxy MTM`, `Steve Mtm`/
  `Steve MTM`, `James Mtm`, `James Vsc`.

## 5b. Four files left untracked, and how to get them back

Not losses — recorded here so nothing has to be remembered:

- **`.claude/settings.json`** — local Claude Code settings (hooks, permissions).
  Back it up with the other local files in section 1; it is not in git because
  staging it was refused as a credential-leak risk and it is not worth arguing
  with that guard over a settings file.
- **`mcp-github.bat`** and **`mcp-supabase.bat`** — two-line launchers, no
  secrets in them. Recreate verbatim if missing:

  ```bat
  @echo off
  npx -y @modelcontextprotocol/server-github
  ```

  ```bat
  @echo off
  npx -y @supabase/mcp-server-supabase
  ```

  The credentials these servers need live in `.mcp.json`, which is gitignored —
  see section 1.
- **`SKILL (1).md`** — a byte-identical duplicate of the tracked `SKILL.md`.
  Safe to delete.

## 6. Read this before touching code

`CLAUDE.md` at the repo root is the real guide — stack, role hierarchy, the
multi-tenant model, and a long list of traps that each cost a production
incident to learn. It is tracked, so it survives the reinstall. Read the section
matching whatever you are about to change.
