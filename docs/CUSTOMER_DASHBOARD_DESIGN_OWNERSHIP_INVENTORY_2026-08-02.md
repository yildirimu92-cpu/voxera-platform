# Customer Dashboard Design Ownership Inventory

Date: 2026-08-02  
Tracking issue: #768

## Scope

This inventory covers frontend CSS, HTML and browser JavaScript below `customer-dashboard`. Netlify Functions, database logic and generated build directories are excluded.

No production styling or runtime behavior is changed by this inventory.

## Measured baseline

| Metric | Baseline |
|---|---:|
| Audited frontend files | 17 |
| Explicit CSS files | 5 |
| Canonical CSS modules | 5 |
| `font-family` declarations | 287 |
| `font-size` declarations | 1,905 |
| JavaScript-created style elements | 3 |
| JavaScript style text writes | 6 |
| Inline `style` attributes | 1,338 |
| Direct `.style.*` writes | 762 |
| `!important` uses | 6,100 |

The baseline is produced by `scripts/audit-customer-design-ownership.mjs` and is displayed in the GitHub Actions job summary.

## Main finding

The visual inconsistency is not mainly caused by the five new CSS modules. The dominant visual owner remains `customer-dashboard/index.html`.

`index.html` currently contains:

- 47,116 lines;
- 278 `font-family` declarations;
- 1,818 `font-size` declarations;
- 1,308 inline style attributes;
- 742 direct `.style.*` writes;
- all 6,100 current `!important` uses.

This file is therefore the primary source of conflicting typography, component sizing and specificity. Adding more global overrides would increase the problem. The main dashboard must be migrated section by section by replacing and deleting existing rules.

## Current canonical CSS owners

| File | Responsibility | Decision |
|---|---|---|
| `shared/customer-design-system.css` | tokens, global typography, controls, cards, responsive foundations | keep and make the only primitive owner |
| `shared/customer-assistant-components.css` | assistant-specific component layout and states | keep; remove generic button and typography ownership over time |
| `shared/customer-assistant-status.css` | assistant capability and technical status layout | keep; only component-specific layout and state |
| `shared/customer-navigation-components.css` | assistant/root navigation presentation | keep; navigation-only responsibility |
| `shared/customer-support-components.css` | support modal layout and states | keep; support-only responsibility |

The five modules contain 1,131 lines in total. They are not allowed to become another global override layer over `index.html`.

## Runtime-owned presentation debt

### Priority 1: `shared/customer-runtime-calendar-settings.js`

Measured debt:

- creates one `<style>` element;
- performs two style-text writes;
- contains 14 inline style attributes;
- performs eight direct `.style.*` writes;
- defines 12 independent font sizes.

Migration rule:

- move calendar presentation into an explicit component CSS owner;
- delete the injected style block and inline presentation in the same PR;
- preserve IDs, actions, API calls and navigation behavior;
- do not add an override-only file.

### Priority 2: `shared/customer-runtime-operational-updates.js`

Measured debt:

- creates one `<style>` element;
- performs three style-text writes;
- contains two inline style attributes;
- performs one direct `.style.*` write;
- defines 17 independent font sizes.

Migration rule:

- transfer existing rules to a canonical component owner;
- delete `addStyle()` and all inline presentation at the same time;
- keep create, edit, publish and withdraw behavior unchanged.

### Lower runtime debt

| File | Current presentation debt | Planned treatment |
|---|---|---|
| `shared/customer-runtime-unified-navigation.js` | four direct `.style.*` writes | replace only when navigation state can use `hidden`, ARIA and CSS classes without changing routing |
| `shared/customer-runtime-help-route.js` | two direct `.style.*` writes | remove during settings/help migration |
| `shared/offer-brand.js` | three inline styles in protected-audio markup | replace with existing semantic classes |
| `shared/offer-brand-core.js` | same three inline styles | determine canonical owner and remove duplicate presentation |

## Non-primary scope

`activate.html` contains a smaller independent activation design surface:

- 296 lines;
- five font-family declarations;
- 12 font-size declarations;
- eight inline styles;
- five direct style writes.

Activation is not part of the first dashboard migration because it is a separate route and should not be mixed with authenticated dashboard changes.

## Migration order

### Step 1 — primitives without another override layer

Target files:

- `shared/customer-design-system.css`;
- `shared/customer-assistant-components.css`;
- the exact conflicting assistant selectors inside `index.html`.

Required outcome:

- one font stack;
- one type scale;
- one button box model;
- correct horizontal padding and text containment for `Name speichern`;
- removal of the replaced legacy declarations from `index.html` or component CSS;
- no JavaScript changes;
- no new CSS module solely for overrides.

### Step 2 — calendar ownership

Target:

- remove presentation from `customer-runtime-calendar-settings.js`;
- move only the replaced calendar rules into a defined CSS owner;
- delete inline styles and injected CSS in the same PR.

### Step 3 — current information ownership

Target:

- remove presentation from `customer-runtime-operational-updates.js`;
- migrate its cards, forms, badges and statuses to the central scale;
- delete the runtime style injection.

### Step 4 — authenticated core screens in `index.html`

Migrate one complete screen per PR:

1. settings and subscription;
2. dashboard;
3. requests;
4. report;
5. shared empty states and notices.

For each screen:

- identify the existing selectors and inline styling;
- move or consolidate the necessary rules;
- remove the original rules and inline declarations;
- preserve markup IDs and behavioral JavaScript;
- prove a non-increasing or justified net line count.

### Step 5 — navigation structure

Navigation is handled separately after visual ownership is stable:

- five canonical root entries;
- remove or relocate Archive;
- remove duplicate Report access;
- align desktop and mobile;
- no concurrent typography or data changes.

### Step 6 — activation route

Migrate `activate.html` independently after the authenticated portal is stable.

## Merge gates for every design PR

A design PR must state:

- the old owner being removed;
- the new canonical owner;
- selectors or inline declarations deleted;
- additions, deletions and net line change;
- affected screens and viewport checks;
- confirmation that no API, auth, data or routing behavior changed.

The PR must fail if it introduces:

- a new JavaScript-created style element;
- new `!important` usage in canonical modules;
- a new local font family;
- a new generic button system outside `customer-design-system.css`;
- presentation-only observers or timers.

## Immediate next implementation

The first visual implementation after this inventory is limited to assistant typography and button primitives. It will fix the overflowing `Name speichern` control while removing the declarations it replaces. It must not touch routing, data loading, calendar logic, operational updates or navigation structure.
