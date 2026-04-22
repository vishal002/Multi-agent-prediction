# AI Cricket War Room — UI design spec

**Use this document before changing layout, color, typography, or components.** Implementation lives in `ai_cricket_war_room.css` (tokens and rules), `ai_cricket_war_room.html` (structure), and `ai_cricket_war_room.js` (behavior and dynamic markup).

---

## 1. Visual direction

- **Dark default:** Google-style dark surfaces (`#202124` page, elevated grays), soft borders (`rgba(255,255,255,0.08)`), **accent blue** `#8ab4f8` (Material-like), **success green** for live / positive signals, **danger red** for errors / bear framing.
- **Light mode:** Slate page (`#f1f5f9`), white cards, blue accent `#2563eb`, same semantic roles via tokens.
- **Display typography:** **Plus Jakarta Sans** on hero title, verdict winner, architecture title, how-to title, info sheet title, and over-card run emphasis — paired with **Inter** for UI body.
- **Brand title:** Gradient text (dark: cool lavender → purple → pink; light: blue → violet → rose). Do not replace with flat fill without updating both themes.

The product should feel like a **dense analytics / scorecard** tool: readable at 14px base, clear hierarchy, minimal chrome noise.

---

## 2. Source files & conventions

| Area | File |
|------|------|
| Design tokens (dark) | `:root` at top of `ai_cricket_war_room.css` |
| Design tokens (light) | `[data-theme="light"] { ... }` block (same file, ~3197) |
| Theme switch | `document.documentElement` attribute `data-theme` = `dark` \| `light`; persist with `localStorage` key `acwr-theme` (see `ai_cricket_war_room.html` inline script + `#themeToggle` in JS) |
| Layout shell | `.app`, `.app-header`, `.command-bar`, sections in HTML |
| Components | BEM-style blocks: `.g-search__*`, `.live-panel__*`, `.bubble*`, `.verdict-*`, `.btn`, `.pipeline`, `.phase-*`, etc. |

**Rules for UI changes**

1. Prefer **CSS variables** (`var(--color-accent)`) over hard-coded hex in new rules.
2. Any new color must work in **both** themes: add or override tokens under `[data-theme="light"]` when needed.
3. Match **radius** (`--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-full`) and **shadow** (`--shadow-sm`, `--shadow-md`) before inventing new values.
4. Focus rings: `outline: 2px solid var(--color-accent)` (or existing `focus-visible` patterns on neighbors).
5. After visual edits, skim **light overrides** at the bottom of the CSS file so nothing regresses in `[data-theme="light"]`.

---

## 3. Tokens (dark — `:root`)

These are the canonical names; values are illustrative — trust the file if they drift.

| Token | Role |
|-------|------|
| `--font-sans` | Inter stack for body UI |
| `--gap` | Default spacing unit (12px) |
| `--color-text-primary` / `secondary` / `tertiary` | Text hierarchy |
| `--color-bg-page` / `elevated` / `muted` / `subtle` | Surfaces |
| `--color-border` / `strong` | Dividers and control edges |
| `--color-accent` / `accent-soft` | Links, focus, primary actions |
| `--color-success` (+ soft/border) | Live, wins, positive |
| `--color-danger` (+ soft/border) | Errors, destructive, bear |
| `--color-info-*` | Informational panels |
| `--color-live` | Live indicator dot / label |
| `--color-verdict-blue-mid` / `deep` | Verdict chrome |
| `--color-tab-active-border` | Active tab underline color |
| `--radius-sm` / `md` / `lg` / `full` | Corners |
| `--shadow-sm` / `md` | Elevation |
| `--ease-out` | Standard motion curve |

**Legacy aliases** in `:root` (e.g. `--color-background-primary`, `--color-border-primary`) exist for older rules — prefer the main `--color-*` names in new code.

---

## 4. Tokens (light — `[data-theme="light"]`)

Light mode **redefines the same variable names** (slate text, white elevated surfaces, darker borders on white). Component-specific tweaks (search shell, verdict card, bubbles, toasts) live in **additional** `[data-theme="light"]` selectors further down the stylesheet. When you add a new dark rule with hard-coded `rgba(255,255,255,…)` or dark-only backgrounds, add a **paired light rule** if the component is user-visible.

---

## 5. Typography

- **Base:** `body` — Inter, **14px**, line-height **1.5**, `color: var(--color-text-primary)`.
- **Eyebrow (`.brand__eyebrow`):** uppercase, **0.625rem**, weight **600**, letter-spacing **0.12em**, accent color.
- **Title (`.brand__title`):** clamped responsive size, weight **700**, Plus Jakarta, gradient fill (see §1).
- **Section / card titles:** follow existing neighbors (weights 600–700 common for emphasis).

Avoid introducing a third font family without updating this doc and the Google Fonts link in HTML.

---

## 6. Major UI regions (HTML)

Use these as anchors when designing or refactoring:

1. **Header** — `.app-header`: brand, tagline, nav slot, `#themeToggle`.
2. **Toasts** — `#toastRegion` (live region).
3. **Command bar** — `.command-bar`: live score bar, fixture `.g-search`, `#ctaRow` (Run / Reset / status pill).
4. **Live panel** — `#livePanel` (expandable live match / ground truth).
5. **Main flow** — pipeline, phase stepper, debate bubbles, verdict cards, footers (see full HTML for current sections).

New sections should follow the same **max-width** behavior as `.app` (`min(1180px, 100%)`) unless full-bleed is intentional.

---

## 7. Component notes

- **Buttons:** `.btn--primary`, `.btn--ghost`, `.text-btn` — keep hover/focus consistent; light mode has explicit overrides.
- **Search:** `.g-search` — shell border, focus ring using accent soft, keyboard hints in `.g-search__footer`.
- **Bubbles:** `.bubble.bull` / `.bubble.bear` — theme-specific border/background overrides in light block.
- **Verdict:** `.verdict-card`, `.verdict-card--final`, probability bars, stat cells — many light-mode color overrides; change carefully.
- **Live / over widgets:** `.live-dot`, `.over-card`, `.live-score-bar` — success green association for “live”.

---

## 8. Accessibility & motion

- Preserve **focus-visible** styles on interactive controls.
- Respect **`prefers-reduced-motion`** where transitions exist (follow patterns already in CSS).
- Keep **contrast** acceptable in light mode for blue-on-white and slate body text.

---

## 9. Checklist (copy for PRs / tasks)

- [ ] Tokens used or extended in `:root` / `[data-theme="light"]` as appropriate  
- [ ] Light theme spot-checked (`data-theme="light"`)  
- [ ] Focus states visible on new controls  
- [ ] No orphaned hard-coded dark colors in shared rules without light counterpart  
- [ ] `DESIGN.md` updated if tokens or regions changed meaningfully  

---

## 10. Optional external reference

An earlier version of this file documented the **Vercel / Geist** marketing system (shadow-as-border, Geist-only type). **This app does not follow that system** — it follows the tokens and patterns above. Borrow ideas only if they are mapped onto `DESIGN.md` tokens and both themes.
