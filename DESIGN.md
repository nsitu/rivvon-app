# Rivvon Design System

## Purpose

This document defines Rivvon-specific UI decisions that sit on top of PrimeVue. PrimeVue is the component library; this document is the product-level contract for how those components are configured, composed, and extended.

Keep this document focused on rules that affect implementation. Link to PrimeVue documentation for component APIs rather than duplicating it here.

## Core principles

- Prefer an existing PrimeVue component or shared Rivvon primitive before creating a new control.
- Prefer shared tokens and patterns over component-local visual values.
- Make responsive behavior, keyboard behavior, and loading/error/empty states part of the pattern definition.
- When an exception is necessary, document the reason in the component and keep its scope narrow.

## PrimeVue usage

PrimeVue is configured centrally in `apps/rivvon/src/main.js` using the Aura preset. Shared PrimeVue theme changes belong in that preset. Component-specific changes should be limited to layout or product-specific composition and should use the documented PrimeVue pass-through or CSS mechanisms.

Use PrimeVue first for buttons, inputs, selects, toggles, sliders, dialogs, panels, tabs, and scrolling. Native controls are allowed when they provide behavior that PrimeVue does not cover or when a specialized interaction requires them; those cases should be intentional and documented.

## Tokens and visual language

Use existing PrimeVue tokens such as `--p-primary-color` and `--p-text-color` where applicable. Rivvon-specific tokens should be CSS custom properties rather than repeated literals. Viewer chrome tokens currently live in `apps/rivvon/src/components/viewer/toolsPanelShared.css`.

When introducing a repeated color, spacing value, radius, elevation, or breakpoint, first decide whether it is a system token. Add the token centrally before reusing it across components.

## Standard scroll regions

Scrollable product panels must use PrimeVue's `ScrollPanel` component directly with the shared `rivvon-scroll-panel` class. The class is defined globally in `apps/rivvon/src/components/viewer/toolsPanelShared.css`.

Do not add `overflow-y: auto` directly to a product panel unless there is a documented exception. The shared class provides the standard PrimeVue scrollbar, flex sizing, horizontal overflow protection, and hover/focus behavior without hiding the PrimeVue component API behind another wrapper.

The parent panel must provide a constrained flex layout (`height: 100%`, `min-height: 0`) so the scroll region can calculate its viewport. Content-specific padding belongs on the slotted content, not on the scroll component itself.

## Panel composition

Full-screen viewer panels should use the `viewer-chrome-panel-container` layout class where appropriate. A panel should clearly separate:

- the constrained scroll region;
- the content area;
- persistent actions or footer controls;
- overlays, dialogs, or preview regions.

Persistent actions must not be placed inside a scrolling content region unless they are intentionally part of the scrollable content.

The shared shell owns the panel's title, context, and close action. Do not repeat that purpose with a second heading, eyebrow, description, or close button inside the panel content. Content headings should introduce a distinct task or subsection rather than restating the panel title.

## Controls and interaction

- Use PrimeVue controls for standard form interactions.
- Preserve visible focus states and accessible names for icon-only actions.
- Use tooltips only as supplemental context, not as the only accessible label.
- Keep destructive actions visually and behaviorally distinct from routine actions.
- Keep control density and spacing consistent within a panel.

## Icons

Material Symbols are loaded through the curated list in `apps/rivvon/src/main.js`. Whenever a new icon is used, add its exact name to that list as required by `AGENTS.md`.

## Responsive behavior

Components must define what happens at narrow widths instead of relying on accidental overflow. When a panel changes from side-by-side to replacement/overlay behavior, document that behavior in the component and preserve keyboard and close affordances in both modes.

## Contribution checklist

Before merging a UI change, check:

- Does an existing PrimeVue component or Rivvon primitive already cover this?
- Does this introduce a repeated visual value that should become a token?
- Does every scrollable panel use PrimeVue `ScrollPanel` with `rivvon-scroll-panel`?
- Are loading, empty, error, disabled, focus, and narrow-screen states handled where relevant?
- Are icon names registered in `main.js`?
- If this is an exception, is the reason documented close to the implementation?
