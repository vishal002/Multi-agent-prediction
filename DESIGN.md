# AI Cricket War Room — UI design spec

**Use this document before changing layout, color, typography, or components.** Implementation lives in `ai_cricket_war_room.css` (tokens and rules), `ai_cricket_war_room.html` (structure), and `ai_cricket_war_room.js` (behavior and dynamic markup).

---

## 1. Visual direction

- **Dark default (“war room”):** Deep navy page (`#070b12`), card surfaces (`#0d1420` / `#111928`), hex borders (`#1e2d42`), **neon accent / success** `#00e87a` for CTAs, live, intel highlights, and bull framing; **coral red** `#ff3d5a` for errors / bear; **amber** `#ffb830` reserved for warnings where needed. Optional **tactical grid** and soft radial glow on `body` (toned down in light mode for readability).
- **Light mode:** Slate page (`#f1f5f9`), white elevated cards, **blue** `#2563eb` for many interactive tokens (search, links); brand accent span can use **green** `#059669` for continuity. Body grid/glow use low-opacity green tints so type stays crisp.
- **Display typography:** **Rajdhani** for wordmarks, section labels, primary CTA, pipeline, ticker; **Barlow Condensed** for UI body; **Space Mono** for numeric / score emphasis (live inputs, win-prob percentages). **Inter** remains loaded as a fallback in the stack.
- **Brand title:** Dark — solid uppercase Rajdhani with **“War Room”** in accent green (no gradient). Light — solid dark text with the same accent span on “War Room”.

The product should feel like a **dense analytics / scorecard** tool: readable at ~15px base, clear hierarchy, minimal chrome noise.

---

## 2. Source files & conventions

| Area | File |
|------|------|
| Design tokens (dark) | `:root` at top of `ai_cricket_war_room.css` |
| Design tokens (light) | `[data-theme="light"] { ... }` block (same file, ~3197) |
| Theme switch | `document.documentElement` attribute `data-theme` = `dark` \| `light`; persist with `localStorage` key `acwr-theme` (see `ai_cricket_war_room.html` inline script + `#themeToggle` in JS) |
| Layout shell | `.app`, `.app-header`, `.ticker`, `.pipeline--flow`, `.war-room__grid`, `.command-bar`, `#livePanel`, `.dashboard` |
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
| `--font-sans` | Alias → `--font-ui` (Barlow Condensed + Inter fallbacks) |
| `--font-display` | Rajdhani — titles, pipeline, CTAs |
| `--font-ui` | Barlow Condensed — body UI |
| `--font-mono` | Space Mono — numbers, win-prob |
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

- **Base:** `body` — Barlow Condensed (`--font-ui`), **~15px**, line-height **1.5**, weight **500**, `color: var(--color-text-primary)`.
- **Eyebrow (`.brand__eyebrow`):** Rajdhani, uppercase, small size, weight **600**, wide letter-spacing, accent color.
- **Title (`.brand__title`):** Rajdhani, clamped size, weight **700**, uppercase; **`.brand__title-accent`** uses accent green (see §1).
- **Section / card titles (`.dash-col__label`, pipeline):** Rajdhani, uppercase, **700**, letter-spacing for scanability.
- **Verdict winner / over-card run emphasis:** Rajdhani where specified in CSS.

Avoid introducing an additional display family without updating this doc and the Google Fonts link in HTML.

---

## 6. Major UI regions (HTML)

Use these as anchors when designing or refactoring:

1. **Header** — `.app-header`: `.brand--war-room`, tagline, optional `.header-badge`, `#themeToggle`.
2. **Toasts** — `#toastRegion` (live region).
3. **Ticker** — `.ticker` (decorative strip; duplicated content for seamless scroll).
4. **Flow pipeline** — `.pipeline.pipeline--flow` (full-width Data → … → Judge strip).
5. **War room grid** — `.war-room__grid`: **left** `.war-room__col--controls` (`.command-bar` + `#livePanel`); **right** `.war-room__col--intel` (`.dashboard`: verdict / match stage, intel agents, debate).
6. **Command bar** — live score bar, fixture `.g-search`, `#ctaRow` (Run / Reset / status pill).
7. **Live panel** — `#livePanel` (expandable live match / ground truth).
8. **Intel column** — phase stepper, debate bubbles, verdict cards, footers (see HTML).

New sections should follow the same **max-width** behavior as `.app` (`min(1200px, 100%)`) unless full-bleed is intentional.

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
