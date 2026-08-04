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

- color tokens;
- typography scale and font stack;
- spacing scale;
- radii and shadows;
- page canvas and content width;
- generic panels and cards;
- generic buttons;
- generic inputs, selects and textareas;
- generic chips and filter controls;
- generic empty states;
- shared focus and disabled states;
- responsive primitive behavior.

### Component owners

The following modules may own only their named component domain:

- `customer-assistant-components.css` — assistant-specific component layout and states;
- `customer-assistant-status.css` — assistant capability and technical status presentation;
- `customer-navigation-components.css` — root and local navigation presentation;
- `customer-settings-components.css` — settings-specific component layout;
- `customer-support-components.css` — support modal and support-state presentation.

Component modules must not introduce a second generic button, card, input, typography or page-layout system.

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

- Cards: 18px radius desktop, 16px mobile.
- Controls: 12px radius.
- Standard control height: 46px desktop, 48px mobile.
- Standard page/card spacing must be token-based and shared.
- Decorative shadows must remain subtle and must not replace structural borders.

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
- a new generic button, card or input system outside `customer-design-system.css`;
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
8. Navigation alignment.
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
