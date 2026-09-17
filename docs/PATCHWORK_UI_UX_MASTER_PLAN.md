# PATCHWORK UI/UX Master Plan

## Brand Foundations

PATCHWORK is premium developer infrastructure for agent testing, repair review and evidence-backed confirmation. The interface should feel precise, calm and technical: dense enough for researchers and engineering reviewers, but visually polished enough for an investor or enterprise demo.

Design principles:

- Evidence first: every major screen should make scope, status and provenance easy to scan.
- Controlled emphasis: orange is the PATCHWORK signal color, used for actions, active states and critical workflow markers.
- Technical warmth: use a warm neutral foundation with near-black ink, graphite dark mode and restrained data colors.
- Product over marketing: visuals should resemble real PATCHWORK workflows, not abstract AI decoration.
- Compact confidence: dashboards should be high-density, legible and calm.

## Semantic Color Tokens

Light mode:

- `--canvas`: `#f6f1e8`
- `--canvas-muted`: `#ebe3d5`
- `--canvas-raised`: `#fbf7f0`
- `--surface`: `#fffdf8`
- `--surface-hover`: `#fff8ef`
- `--surface-selected`: `#fff0df`
- `--surface-inverse`: `#171514`
- `--text-primary`: `#171514`
- `--text-secondary`: `#504a43`
- `--text-tertiary`: `#777069`
- `--accent`: `#f35a1b`
- `--accent-hover`: `#d94c11`
- `--accent-active`: `#b83f0f`
- `--success`: `#087f5b`
- `--warning`: `#ad6a00`
- `--error`: `#b42318`
- `--info`: `#2563eb`
- `--focus`: `#f35a1b`

Dark mode:

- `--canvas`: `#11100f`
- `--canvas-muted`: `#191715`
- `--canvas-raised`: `#1d1a17`
- `--surface`: `#211f1c`
- `--surface-hover`: `#292520`
- `--surface-selected`: `#38281e`
- `--surface-inverse`: `#fff8ef`
- `--text-primary`: `#fff8ef`
- `--text-secondary`: `#d9cfc1`
- `--text-tertiary`: `#a79d91`
- `--accent`: `#ff7a32`
- `--accent-hover`: `#ff914d`
- `--accent-active`: `#f35a1b`

## Typography

Primary stack: `Inter, Geist, SF Pro Display, system-ui, sans-serif`.

Monospace stack: `SF Mono, JetBrains Mono, Consolas, Liberation Mono, monospace`.

Scale:

- Display XL: `text-8xl`, black, tight line-height, used only for the homepage brand wordmark.
- Display LG: `text-6xl`, black, tight line-height for mobile hero.
- H1: `text-4xl`, black, workspace page titles.
- H2: `text-4xl`, black, public section headers.
- H3: `text-xl/base`, semibold or black for cards and workflow steps.
- Body: `text-base`, 1.7 line-height for product explanation.
- UI: `text-sm`, semibold for navigation, labels, rows.
- Caption: `text-xs`, uppercase for metadata and metric labels.
- Metric: monospace, tabular numbers.

## Spacing, Grid, Radius, Elevation

Spacing follows a 4px rhythm with page sections at 56-72px desktop and tighter mobile spacing. Public pages use a `max-w-7xl` layout with varied compositions instead of repeated equal-card grids. Dashboard pages use compact 4-6 column metrics and split panels.

Radius:

- Small controls: `6px`
- Cards and panels: `8-10px`
- Large product visuals: `14px`
- Pills: full radius

Elevation:

- Level 0: flat bands with subtle borders.
- Level 1: `.surface` cards with tonal separation.
- Level 2: `.surface-float` for hero visuals and important dashboard panels.
- Level 3: overlays and mobile drawers using `--shadow-overlay`.

## Key Surfaces

Public navigation:

- Sticky translucent header, compact centered link group, strong but small brand mark.
- Workspace CTA remains primary.
- Dark-mode toggle persists user choice and respects system preference on first load.

Homepage:

- First viewport introduces PATCHWORK as agent safety infrastructure.
- Hero visual shows an evidence run, violation, repair diff and confirmation progress.
- Workflow section explicitly maps Scan -> Test -> Localize -> Repair -> Confirm.
- Trust strip reinforces local replicas, audit evidence, safety gates and no production side effects.

Authenticated dashboard:

- Graphite sidebar distinguishes workspace mode from the public site.
- Top bar emphasizes organization, breadcrumb and pending review items.
- Metrics use monospace numbers and restrained signal dots.
- Control posture panel makes safety posture visible without adding fake functionality.
