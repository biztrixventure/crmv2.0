# BizTrix CRM — UI Design System

One design language for the whole app. The reference implementation is
`frontend/src/shells/ComplianceShell.jsx`; the shared primitives live in
`frontend/src/components/UI/kit/`.

Rollout status: kit built, SuperAdmin surfaces migrating tab-by-tab (see
[superadmin-ui-unification-plan.md](superadmin-ui-unification-plan.md)). Other
shells follow later.

---

## The five rules

1. **Never hardcode a color.** Every color comes from a CSS variable in
   `styles/global.css` (`--color-*`, `--gradient-*`, `--shadow-*`). A hex literal
   is a dark-mode bug waiting to be filed. Need a translucent tint? Use
   `color-mix(in srgb, var(--color-x) 12%, transparent)` — or better, take it from
   `kit/tokens.js` `ACCENT[tone].soft`.
2. **One loading treatment.** `<Loading />` from the kit. Never a bespoke spinner.
3. **One empty state.** `<EmptyState />`. Never a bare `<p>No items yet.</p>`.
4. **No native `<select>` / `<input type="date">`.** Use `UI/Select.jsx`
   (ThemedSelect) and `UI/ThemedDate.jsx`.
5. **Surfaces come from `<Panel>`.** No ad-hoc `rounded-xl p-4 style={{background…}}`.

---

## Tokens

### Radius (`--radius-*`, global.css:128)

| Token | px | Use for |
|---|---|---|
| `lg` | 8 | controls, chips, small buttons, skeleton bars |
| `xl` | 12 | **nested / inset panels**, action rows |
| `2xl` | 16 | **top-level page cards**, modals, KPI tiles, empty states |
| `full` | 9999 | pills, avatars, badges |

`sm`/`md`/`xs` exist but are legacy — don't reach for them in new work.

### Spacing (`--spacing-*`, global.css:118) → `PAD` in `kit/tokens.js`

| `pad` | class | Use for |
|---|---|---|
| `none` | — | panel lays out its own padding |
| `sm` | `p-3` | dense rows, compact cards |
| `md` | `p-4` | **default** — nested panels |
| `lg` | `p-5` | top-level page cards |

Vertical rhythm between blocks: `space-y-4` inside a panel, `space-y-5`/`gap-3`
between panels. Shell padding is the Compliance one:
`px-4 sm:px-6 lg:px-8 xl:px-10 py-6 sm:py-8`, full width, **no `max-w` cap**.

### Surface tones → `TONE`

- `surface` — `--color-surface` + border. A top-level card.
- `inset` — `--color-bg` + border. A block *inside* a surface card.
- `ghost` — transparent.

**Nesting rule:** `surface` contains `inset`. Never surface-in-surface (they
disappear against each other), never inset-in-inset.

### Accents → `ACCENT` / `accent(tone)`

`default` · `muted` · `primary` · `success` · `warn` · `danger` · `info`.
Each gives `{ fg, soft }` — `fg` for text/icons, `soft` for the tinted chip
behind an icon. Add a tone here rather than inlining a color at a call site.

---

## Components

```jsx
import { Panel, SectionHeader, Loading, EmptyState, KpiTile,
         PillTabs, Field, ActionRow, Toggle, CheckRow, useFlash } from '../../UI/kit';
```

### `<Panel>` — the rounded surface
`tone='surface'|'inset'|'ghost'` · `pad='none'|'xs'|'sm'|'md'|'lg'` ·
`radius='lg'|'xl'|'2xl'|'full'` · `as='div'` · `className` · `style`

```jsx
<Panel pad="lg">                          {/* page card */}
  <SectionHeader icon={Lock} title="Governance" />
  <Panel tone="inset" radius="xl">…</Panel>  {/* nested block */}
</Panel>
```

### `<SectionHeader>` — the heading
`icon` · `title` · `subtitle` · `actions` · `level='page'|'section'|'sub'` · `tone`

| level | Looks like | Use for |
|---|---|---|
| `page` | gradient icon chip + `h1` (font-display) + subtitle + right actions | a superadmin tab's title |
| `section` | `h3 text-sm font-bold` + tinted icon | a block inside a page card |
| `sub` | `h4 text-xs uppercase tracking-wider` | a label above a control group |

`level="page"` **replaces the old full-bleed gradient banner cards** — the
Compliance shell has none, and neither do admin tabs now. The gradient survives
only as the small 10×10 icon chip.

### `<Loading>` — the loading treatment
`variant='rows'|'cards'|'table'|'block'|'inline'` · `rows=3` · `cards=3` ·
`height=160` · `size=16` · `label='Loading…'`

Default is a shimmer **skeleton**, not a spinner: it reserves the space the real
content will fill, so nothing jumps. `variant="inline"` is the only spinner —
for buttons and single rows where a skeleton would be bigger than the thing it
replaces.

```jsx
if (loading) return <Loading variant="rows" rows={4} />;      // panel body
<Button>{saving ? <Loading variant="inline" size={14} /> : <Save size={14} />} Save</Button>
```

Never re-introduce: `border-b-2` CSS spinners, ring spinners, italic
`Loading…` text, a different lucide icon, or a per-tab `py-*` value.

### `<EmptyState>`
`icon` · `title` · `hint` · `action` · `tone='muted'` · `compact=false`

Dashed `rounded-2xl` box, tinted icon circle, title, optional hint + action.
Use `compact` inside an already-small panel.

### `<KpiTile>`
`icon` · `label` · `value` · `sub` · `tone` · `onClick`

One number per tile; lay them out in your own grid
(`grid grid-cols-2 lg:grid-cols-4 gap-3`). Format numbers at the call site —
the tile never guesses a locale or currency. (`UI/StatCardTriple.jsx` remains
for the fixed 3-up composite it was built for.)

### `<PillTabs>` — sub-navigation
`items=[{ key, label, icon, count }]` · `value` · `onChange`

**Chrome vs pill:**

| | Component | Where |
|---|---|---|
| Primary shell nav | `ChromeTabs variant="chrome"` | ComplianceShell's 6 task groups. The AdminPanel's **sidebar** is its primary nav, so admin tabs don't use chrome. |
| Sub-nav inside a tab | `PillTabs` (pill, `sm`) | everything else — UCC sections, Clients & Plans, Chat Control, VICIdial, Egress Governance… |

Retired by this: the inset segmented track, the gradient pill row, and ad-hoc
`rounded-lg` button rows.

### `<Field>` — labelled control
`label` · `hint` · `error` · `required` · `as='label'`

Wraps ThemedSelect / ThemedDate / `.input` / a control group (`as="div"` when
wrapping many inputs). Not to be confused with `components/Form/FormField.jsx`,
the dynamic `form_fields`-driven renderer, which is unrelated.

### `<ActionRow>`
`icon` · `label` · `hint` · `onClick` · `busy` · `disabled` · `tone` · `trailing`

Full-width icon + label + hint button with a built-in busy spinner. `tone="danger"`
for destructive actions.

### `<Toggle>` / `<CheckRow>`
`checked` · `onChange(nextBoolean)` · `label` · `hint` · `busy` · `disabled`
(`CheckRow` also: `trailing`, `strong`).

`onChange` receives the **next boolean**, not an event. Both dim and go
non-interactive while `busy`.

### `useFlash()`
```jsx
const { msg, flash, clear } = useFlash();          // { ttl = 4000, stickyErrors = true }
flash('success', 'Profile saved.');
{msg && <Alert type={msg.type}>{msg.text}</Alert>}
```
Errors stay until replaced or dismissed — a failure the user never saw is worse
than a lingering banner. Timer clears on unmount.

---

## Alerts

`UI/Alert.jsx` renders the text from **`message` OR children** — either call
shape works. Types: `success` · `error` · `warning` · `info`, styled by
`.alert-*` in global.css (both themes). Don't hand-roll a colored div for a
message.

---

## Overlays

Portaled dropdowns and menus sit at `zIndex: 10000` so they can never open
behind a modal or drawer. If you add a new portaled popover, match that.

---

## Migration checklist (per surface)

- [ ] Page title → `<SectionHeader level="page">`; gradient banner removed
- [ ] Sub-nav → `<PillTabs>`
- [ ] Cards → `<Panel>` (surface outer, inset nested; `2xl` outer, `xl` nested)
- [ ] Every loading path → `<Loading>` (skeleton for bodies, `inline` for buttons)
- [ ] Every "nothing here" → `<EmptyState>`
- [ ] Checkboxes/switches → `<CheckRow>` / `<Toggle>`
- [ ] Labels → `<Field>`
- [ ] Flash messages → `useFlash()` + `<Alert>`
- [ ] No native `<select>` / `type="date"` left
- [ ] No hex literals left (`grep -n "#[0-9a-fA-F]\{3,6\}"`)
- [ ] `npx vite build --minify false` clean (the minifier OOMs on this machine —
      do the real minified production build where there's more RAM)
- [ ] Live check in **light and dark**, console clean, flow unbroken
