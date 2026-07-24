# Vision: UI Change Doc Generator

## TODO — near-term (make change types dynamic; UI polish)

The current UI makes the user choose the change type ("Insert table column" vs "Insert element") *before* picking — but the user shouldn't have to say what they're modifying; the tool can detect it. PeopleSoft's DOM is highly consistent (see [[peoplesoft-dom-taxonomy]] and the PlaywrightTA best-practices doc), so a classifier can infer the element kind from the clicked element and pick the right operation automatically.

- [ ] **Auto-detect element kind on pick.** Add a single classifier (`src/lib/classifyElement.js`) that walks up from the clicked element and returns `{ kind, unit, operation }` by matching a small registry of PeopleSoft wrappers, in priority order:
  - `th`/`td` inside a `<table>` → **grid column** → `insert-column`
  - `.ps_grid-row.nuitile` / `[aria-roledescription="Tile"]` → **tile** → clone
  - `.ps_box-button` / `.PSPUSHBUTTONWRAPPER` / bare button → **button** → clone
  - `.ps_box-edit` (label + `.ps_box-control`) → **field** → clone
  - `.ps_box-group` / `fieldset` → **group box / section** → clone
  - fallback: nearest ancestor containing an input → generic clone
- [ ] **Collapse the two change-type options into one "Insert" (auto).** Keep `insert-column` vs clone as an internal routing detail, not a user choice. Show the detected kind as a read-only chip ("Detected: tile") with an optional override if the guess is wrong.
- [ ] **Reuse the field-type inference idea** from PlaywrightTA's `utils/dumpFieldType.js` (classify by `className`/`type`/`inputMode`, detect `${id}$prompt` `ps_icon-date` calendars, `$N` indexed grid ids) to enrich the `.docx` with the field's semantic kind (string/number/date).
- [ ] **UI polish pass** (deferred): the side panel layout, clearer step flow, detected-kind chip, and better empty/error states.

Later operations (from the earlier menu, not yet built): **Modify label/text**, **Remove element**, **Annotate/comment** — each slots into the same picker + interpreter pattern.

## Where this is today (v1)

Deterministic and user-driven, no AI, no network calls, no API key:

1. You browse to an internal page yourself and log in — the extension doesn't automate that.
2. Click the toolbar icon to open the side panel, click **Activate picker**, then click a real element on the page (e.g. a table column header).
3. Choose from a fixed change-type list (currently just "insert table column"), fill in a few structured fields.
4. The extension mutates the live DOM for a real preview (`src/lib/tableColumn.js` inserts a real ghost `<th>`/`<td>` column, colSpan-aware), captures before/after screenshots (`chrome.tabs.captureVisibleTab`, viewport only), and exports a `.docx` spec (`src/lib/docxBuilder.js`) a developer can act on.

The message contract between the side panel and the injected picker (`src/lib/messages.js`) and the "apply a structured change, safely" pattern in `tableColumn.js` are the two pieces meant to outlive v1's narrow scope.

## Where this is going (v2+)

Natural-language change requests. You type what you want in plain English instead of picking from a fixed dropdown. The extension sends a screenshot plus a trimmed serialized DOM (tag, classes, computed layout styles, text, bounding rect — scripts, SVG paths, and data URLs stripped to keep the token budget sane) plus your request to the Claude API, using tool use with a strict output schema, and gets back a **structured change proposal** — not prose to parse, not code to execute.

## Key design constraint (non-negotiable, carried over from v1)

The model's output must always be mediated through a fixed, safe interpreter — the same role `tableColumn.js` plays today for the one hardcoded change type — never `eval`'d and never injected as raw HTML/CSS/JS. This is both an MV3 CSP requirement (no remote code execution) and a real safety boundary, since the target is an internal HR system with real employee data. Generalizing means growing the interpreter's vocabulary — more structured change types, or a small allowlisted style-operation schema — not giving the model a code-execution escape hatch.

## Phased path from here

**Phase 2 — still no AI.** Broaden the fixed change-type list beyond "insert column" (e.g. modify a label, remove an element, generic annotation). Still user-picked and user-confirmed; extends the same message contract and interpreter pattern already in place.

**Phase 3 — AI-assisted description only.** Free-text notes get sent to the Claude API purely to help write clearer `.docx` prose. The AI never decides *what* changes on the page — only helps describe a change you already applied yourself.

**Phase 4 — AI-proposed changes.** The full loop: screenshot + serialized DOM + natural-language request → Claude API tool-use call → structured change proposal → the same safe interpreter applies it → the same before/after/`.docx` pipeline runs. Needs:
- A DOM-serialization module (new).
- A structured change-proposal schema (an extension of today's `{changeType, position, fieldName, notes}` shape).
- An Anthropic API key stored via `chrome.storage.local` — acceptable for personal-only use; if this ever leaves one machine, put a thin proxy in front, since extension bundles are trivially unpacked and inspected.
- Prompt caching on the DOM context (large, stable across iterations) to keep cost down.

## Prior art to reference, not adopt yet

[playwright-crx](https://github.com/ruifigueira/playwright-crx) (open source) runs actual Playwright inside a Chrome extension by implementing Playwright's `ConnectionTransport` over the `chrome.debugger` API (CDP), bundling Playwright's real recorder/selector engine client-side. Two takeaways for later phases:

- `chrome.debugger` + CDP's `Page.captureScreenshot` (with `captureBeyondViewport`) is the documented path to full-page/beyond-viewport screenshots, if `captureVisibleTab`'s viewport-only capture becomes limiting — at the cost of Chrome's "being debugged" infobar.
- Phase 4's "apply the AI-proposed change" step could drive real Playwright actions via this same `chrome.debugger`-as-CDP-transport pattern instead of hand-rolling a DOM-serialization/selector layer from scratch.

Not pulling this in now — v1's `captureVisibleTab` and `tableColumn.js` interpreter are sufficient for the current scope, and playwright-crx's own docs say not to lean on it for real test-style automation.

## Explicitly not adopted

- **WXT** as a build-tool swap — no functional need to justify the rewrite right now; the hand-rolled esbuild setup is small and works.
- **Representing changes as injected CSS rules.** Real DOM node insertion (as `tableColumn.js` already does) gives a more literal "this is what the grid will actually look like" preview than a stylesheet abstraction. Worth revisiting only if a future change type genuinely can't be expressed as a DOM mutation.

## Non-goals for now

None of Phase 3/4 is implemented yet. This is a roadmap to pick up from later, not a spec to build against today.
