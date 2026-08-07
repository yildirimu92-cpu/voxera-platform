# Customer Design Foundation Contract

Date: 2026-08-04  
Branch: `refactor/customer-design-foundation`

## Purpose

This contract defines the only accepted ownership model for visual styling in the authenticated Customer Dashboard. It is the baseline for the staged migration toward one consistent portal design.

The first goal is not a visual redesign of every screen. The first goal is to stop creating additional style owners and to make every subsequent migration remove the legacy declarations it replaces.

## Canonical owners

### Global primitive owner

`customer-dashboard/shared/customer-design-system.css`

This file is the only owner for:

- typography scale and font stack;
- page canvas and content width;
- generic panels;
- generic buttons;
- shared focus-visible treatment;
- responsive primitive behavior.

### Token owner

`customer-dashboard/shared/customer-design-tokens.css`

This file is the only owner for color tokens, the spacing scale, radii,
shadows and the component contract tokens (`--vx-ui-card-*`,
`--vx-ui-tab-*`, `--vx-ui-badge-*`, `--vx-ui-skeleton-*`,
`--vx-ui-empty-*`, `--vx-ui-field-*`, `--vx-ui-appbar-*`). Every other
module resolves its values from here.

Known deviation: `customer-design-system.css` still declares its own
`:root` block with conflicting values for `--vx-muted`, `--vx-surface` and
`--vx-line`. It loads later and therefore wins. Merging the two token
blocks is outstanding work and must not be done alongside a screen
migration.

### Shared component owner

`customer-dashboard/shared/customer-ui-components.css`

This file is the only owner for the shared building blocks:

- the card shell and its inset;
- pill tabs, including the "Anfragen" status filters and the "Assistent"
  section switch;
- loading skeletons — no screen may render a text loading hint;
- status badges;
- empty states;
- form fields: input, select, textarea and their labels, including the
  `appearance` reset and chevron that stop selects from falling back to the
  native browser widget.

Its markup counterpart is `customer-ui-components.js`, which exposes the
`VoxeraUI` factory. That module must stay a pure markup builder: no DOM
mutation, no styling, no observers, no timers, no network access.

### Component owners

The following modules may own only their named component domain:

- `customer-assistant-components.css` — assistant-specific component layout and states;
- `customer-assistant-status.css` — assistant capability and technical status presentation;
- `customer-navigation-components.css` — root and local navigation
  presentation, and the single screen header (`.vx-appbar`) together with the
  meta card that receives what the header gives up (`.vx-screen-meta`);
- `customer-settings-components.css` — settings-specific component layout;
- `customer-support-components.css` — support modal and support-state presentation.

Component modules must not introduce a second generic button, card, input, typography or page-layout system, and must not redeclare the card, tab, skeleton, badge, empty-state or form-field contract owned by `customer-ui-components.css`. They may compose those classes and add layout or placement around them.

### Screen header

`customer-navigation-components.css` is the only owner of the screen header.
Every screen in the authenticated dashboard opens with the same bar:

- white surface, a hairline `0.5px` divider at the bottom, no radius, no
  shadow;
- exactly one title, 17px / 500, Night `#0D1F3C`;
- an optional back arrow to the left of the title.

The bar carries nothing else. No subline, no counter, no badge, no period
filter, no page action. Anything a screen wants to say beyond its own name
goes into the first card of its content area as an ordinary card — same
shell, same border, same radius as every other card, no special treatment.

The back arrow appears only on screens that were opened from a top-level
screen. The five top-level screens — Heute, Anfragen, Assistent, Bericht,
Einstellungen — never show one. The arrow is never a hard-coded destination:
it resolves the real origin through history (`vxScreenBack`, backed by
`customer-runtime-screen-navigation.js`) or, for the request detail, through
the detail's own origin stack (`vxHandleDetailBack`). Browser back, gesture
back and the arrow are therefore the same operation.

A screen-scoped override of `.vx-appbar` defeats the component's only
purpose and must fail review. The single exception in the product is the
request detail inside the Anfragen split, where the detail is a pane of the
Anfragen screen rather than a screen of its own and its bar is suppressed.

Markup comes from `VoxeraUI.appBar()`; static screens spell out the same
structure in `index.html`.

Superseded: `.vx-page-header` (the Night bar), `.vx-back-btn`,
`.vx-assistant-root-header`, `.vx-settings-subpage-header`,
`.vx-cal-page-header` and `.vx-notif-mobile-head`. All of them were deleted
with Navigation Etappe 2 (2026-08-07), not layered over.

## Legacy owner

`customer-dashboard/index.html` remains the dominant legacy presentation owner. It contains inline style attributes, embedded `<style>` blocks, direct JavaScript `.style.*` writes and high-specificity selectors.

Migration rule:

1. identify the exact legacy declarations for one complete component or screen;
2. move only required presentation to the canonical owner;
3. remove the replaced legacy declarations in the same pull request;
4. preserve IDs, actions, API calls, auth, data loading and routing;
5. do not add a new override-only stylesheet or runtime patch.

## Design baseline

### Color

- Brand dark: `#0f2347`
- Brand action: `#3478ed`
- Ink: `#101828`
- Muted text: `#667085`
- Subtle text: `#8a98ae`
- Surface: `#ffffff`
- Canvas: `#f6f8fb`
- Border: `#e4eaf2`

New screen-specific colors are not allowed unless they represent a semantic state such as success, warning, error or information.

### Typography

- One UI font stack: Inter with system fallbacks.
- Body desktop: 15px.
- Body mobile: 16px.
- Buttons: 15px.
- Page title: 25–28px depending on context.
- Section title: 18–22px.
- Supporting metadata: 13–14px.

Local font-family declarations are not allowed outside explicitly independent documents or routes.

### Shape and spacing

- Cards: 12px radius, desktop and mobile.
- Card border: 0.5px, structural, never replaced by a shadow alone.
- Card inset: 16px desktop, 12px mobile. Cards that lay out their own
  head/body sections keep `padding: 0` so those sections own the inset.
- Controls (buttons): 12px radius.
- Standard control height: 46px desktop, 48px mobile.
- Form fields: 10px radius, 1px border, 44px height desktop / 48px mobile.
  Mobile font-size must stay at 16px or above so iOS does not zoom on focus.
- Checkbox, radio, range and file inputs keep their intrinsic box and are
  explicitly excluded from the field contract.
- Standard page/card spacing must be token-based and shared.
- Decorative shadows must remain subtle and must not replace structural borders.

Card shape, border, radius and inset are owned by
`customer-dashboard/shared/customer-ui-components.css` and resolve from the
`--vx-ui-card-*` tokens in `customer-design-tokens.css`. No other module may
declare them.

Superseded values: this section previously specified 18px radius desktop /
16px mobile. That was written before a single card shell existed and was
never applied consistently — the product carried 14px, 18px and 22px card
radii at the same time. The unified card component (Design-System Etappe 1,
2026-08-07) resolves the conflict at 12px.

### Interaction

- One focus-visible treatment.
- One disabled-state treatment.
- Primary action uses the brand hierarchy.
- Secondary action remains visually subordinate.
- Clickable cards and rows must have consistent hover, focus and selected states.
- Mobile interactions must not depend on hover.

## Prohibited changes

A design migration pull request must fail review if it introduces:

- a new `<style>` block in `index.html`;
- a new JavaScript-created style element;
- a new presentation-only MutationObserver, timer or DOM relocation patch;
- new `!important` usage in canonical modules;
- a new local font family;
- a new generic button or input system outside `customer-design-system.css`;
- a new card, tab, skeleton, badge, empty-state or form-field system outside `customer-ui-components.css`;
- a `<select>` without an `appearance` reset, which falls back to the native widget;
- a text loading hint such as "wird geladen …" where a skeleton belongs;
- a CSS file whose only purpose is to override another CSS file;
- unrelated API, auth, data or routing changes.

## Migration sequence

1. Global primitive contract and audit baseline.
2. Settings and subscription.
3. Dashboard / Today.
4. Requests.
5. Assistant.
6. Report.
7. Calendar and operational updates runtime styling.
8. Navigation alignment. — done, Etappe 2 (2026-08-07).
9. Activation route as an independent surface.

Each screen migration must be complete enough that the old declarations can be deleted instead of covered by another layer.

## Pull request evidence

Every design pull request must state:

- old owner removed;
- new canonical owner;
- selectors and inline declarations deleted;
- files changed;
- additions, deletions and net line change;
- desktop viewports tested;
- mobile viewports tested;
- confirmation that auth, API, data and routing behavior were not changed.

## First implementation scope

The first implementation after this contract is limited to shared primitives that can be changed without screen-specific redesign:

- token completion;
- shared page width and canvas rules;
- shared panel/card shell;
- shared button box model;
- shared field box model;
- shared chip and empty-state primitives;
- deletion of the exact replaced legacy declarations.

No complete screen redesign belongs in that first implementation pull request.
