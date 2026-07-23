# UI Change Doc Generator

A personal Chrome extension (Manifest V3) for capturing UI change requests against internal web apps — built with FIU's PeopleSoft HR screens in mind, but designed to work more broadly.

You browse to a page you're already logged into, point at a real element, describe the change you want, and the extension **mutates the live page to show a realistic "after" preview**, captures before/after screenshots, and exports a **Word (`.docx`) spec** you can hand to a developer.

> **Note on the name/folder:** this lives under a `playwright/` directory and started as a "Playwright app" idea. It is **not** a Playwright app at runtime — see [Why not Playwright at runtime?](#why-not-playwright-at-runtime). Playwright *was* used heavily during development; that's a separate thing, covered below.

---

## What it does

1. You log into the target page yourself (the extension never automates login or navigation).
2. Click the toolbar icon to open the side panel.
3. Choose a **change type**, click **Activate picker**, and click the target element on the page.
4. Fill in the details (new field/column name, position, notes).
5. **Capture "before"**, then **Apply change & capture "after"** — the extension injects a real "ghost" DOM change so the after-shot is a genuine preview, not a hand-drawn box.
6. **Generate `.docx`** — a single document with the structured request plus both screenshots (the changed area highlighted).

### Supported change types

| Change type | What it does | Works on |
|---|---|---|
| **Insert table column** | Inserts a new column (header + a cell in every row) next to the one you pick, emulating the grid's existing style. Handles grids split across a sticky-header table + a data table. | Real `<table>` grids |
| **Insert field (form)** | Clones an existing form field (label + input) as a proposed new field, clears its value, and relabels it. Native styling for free, since it's a clone. | Form fields (e.g. search criteria) |

---

## How it works

Pure client-side MV3 extension. No backend, no network calls, no API keys.

```
┌─────────────────┐   executeScript / messages   ┌──────────────────┐
│  Side panel      │ ───────────────────────────▶ │  Content picker   │
│  (coordinator)   │ ◀─────────────────────────── │  (per frame)      │
│                  │        picked / bounds        │                  │
│  • form UI       │                               │  • hover + pick   │
│  • captureVisible│                               │  • apply change   │
│  • canvas highlight                              │  • measure bounds │
│  • docx export   │                               └──────────────────┘
└─────────────────┘
        ▲
        │ opens on toolbar click
┌─────────────────┐
│ Service worker   │  (near no-op: just sets openPanelOnActionClick)
└─────────────────┘
```

- **Service worker** ([src/background/service-worker.js](src/background/service-worker.js)) — minimal; opens the side panel when the icon is clicked. Kept trivial to avoid MV3's ~30s idle-termination affecting anything stateful.
- **Side panel** ([src/sidepanel/sidepanel.js](src/sidepanel/sidepanel.js)) — the coordinator. Renders the form, injects the picker via `chrome.scripting.executeScript`, captures screenshots via `chrome.tabs.captureVisibleTab`, draws the highlight box on a `<canvas>`, and builds the `.docx`. Uses `sender.frameId` on incoming messages to know exactly which frame the user picked in.
- **Content picker** ([src/content/picker.js](src/content/picker.js)) — injected on demand into all frames. Handles hover-outline + click selection (winning over the page's own click handlers), applies the DOM change, and reports the changed region's bounds **after paint** (double `requestAnimationFrame`) so the screenshot isn't taken mid-reflow.
- **Shared libs** ([src/lib/](src/lib/)):
  - [messages.js](src/lib/messages.js) — the message-type contract shared by both bundles.
  - [tableColumn.js](src/lib/tableColumn.js) — generic column insertion; keys off the header label to insert into every grid table (sticky header clone + data table).
  - [cloneField.js](src/lib/cloneField.js) — the universal clone-and-insert-field logic.
  - [geometry.js](src/lib/geometry.js) — translates an element's rect into top-frame viewport coordinates (walking ancestor iframes) and computes the union rect for the highlight box.
  - [docxBuilder.js](src/lib/docxBuilder.js) — builds the `.docx` with `docx` and embeds the PNG screenshots.

### Why not Playwright at runtime?

Playwright drives a browser from **outside** (a Node.js process over the DevTools Protocol). A Chrome extension runs **inside** the browser with no Node access. They're incompatible runtimes — you can't ship "a Playwright app" as an extension. The original idea was reconciled to a pure extension. (Playwright's role here is purely a development aid; see below.)

---

## Project structure

```
doc-generator/
├── extension/                 # "Load unpacked" points here
│   ├── manifest.json
│   ├── icons/                 # generated placeholder icons
│   ├── sidepanel/             # sidepanel.html + sidepanel.css
│   └── dist/                  # esbuild output (gitignored)
├── src/
│   ├── background/service-worker.js
│   ├── sidepanel/sidepanel.js
│   ├── content/picker.js
│   └── lib/{messages,tableColumn,cloneField,geometry,docxBuilder}.js
├── scripts/generate-icons.mjs # one-off placeholder PNG generator (no deps)
├── esbuild.config.mjs         # bundles the 3 entry points
├── package.json
├── VISION.md                  # roadmap toward an AI-assisted version
└── README.md
```

---

## Build & install

Requires Node.js (built with v26; anything modern works).

```bash
npm install          # esbuild + docx
npm run build        # bundles src/ into extension/dist/
# (npm run watch for a rebuild-on-change loop)
```

Then load it in Chrome:

1. Go to `chrome://extensions`, enable **Developer mode** (top right).
2. **Load unpacked** → select the `extension/` folder.
3. After any rebuild, hit the **reload** button on the extension card.

Icons are generated placeholders (a solid brand-blue square) via `node scripts/generate-icons.mjs` — no image dependencies.

---

## Usage

1. Log into the target page and get to the screen you want to change.
2. Click the extension's toolbar icon → the side panel opens.
3. Pick the **Change type** first (this sets what the picker snaps to).
4. **Activate picker** → click the target (a column header, or a form field).
5. Enter the new **field/column name**, **position** (before/after), and any **notes**.
6. **Capture "before"** → **Apply change & capture "after"**.
7. **Generate .docx** → it downloads. **Reset** removes the injected ghost from the page.

---

## Permissions

Declared in [manifest.json](extension/manifest.json):

- `sidePanel`, `scripting`, `tabs` — open the panel, inject the picker, read tab URL/title.
- `host_permissions: ["<all_urls>"]` — required literally by `chrome.tabs.captureVisibleTab` (host patterns alone don't satisfy it), and lets the picker work on any site without a per-navigation `activeTab` grant. Appropriate for a personal, unpacked, single-user tool.

---

## Known limitations

- **Column insertion** aligns cells by summed `colSpan`; grids with `rowSpan` on earlier columns can drift. Fine for simple grids.
- **Highlight box** needs same-origin access up the frame chain; if it can't resolve (cross-origin nested frame), it falls back to a full-viewport screenshot with no box, and the `.docx` notes this.
- **Insert field** clones the picked field's unit — great for PeopleSoft `.ps_box-edit` fields; on other sites it falls back to "nearest ancestor containing an input," which may grab too much/little. It's a visual mock (ids/values stripped), not wired to data.

See [VISION.md](VISION.md) for the roadmap toward an AI-assisted version.

---

## How this was built — and the role of Playwright MCP

The trickiest part of this project wasn't the extension plumbing, it was **not knowing the target page's DOM**. The target is a live, authenticated internal PeopleSoft app; its markup is generated and non-obvious, and guessing at it produces subtly wrong code. So the development approach was **"verify against reality, don't guess,"** and the tool that made that possible was **Playwright MCP**.

**What Playwright MCP is:** a [Model Context Protocol](https://modelcontextprotocol.io) server that exposes a real Chromium browser to the AI coding assistant as callable tools. It is a **development-time aid only** — it is *not* a dependency of the shipped extension, which has zero Playwright code.

**Why it was used:** instead of assuming how the PeopleSoft grid and search form were built, the assistant drove a real browser — logging in with the developer's test credentials, navigating to the actual screen, and inspecting the live DOM directly.

**How it helped, concretely:**

- **De-risked the whole approach.** A quick inspection confirmed the grid is a genuine `<table>` (not a div-grid), so the `.closest('table')`-based column logic was viable at all.
- **Found the bug that mattered.** The "new column has no cells below it" problem turned out to be a PeopleSoft quirk: the grid is **two `<table>` elements** — a sticky-header clone with *no body rows* and the real data table. Inspecting the live DOM revealed both tables share the same header label ("Trip Description"), which is exactly the key the fix uses to insert into both.
- **Tested algorithms before writing them.** The exact column-insertion and field-clone logic were run against the live page via `browser_evaluate` and screenshotted **before** being committed to code — catching layout issues without a build → reload-extension → click-through cycle each time.
- **Grounded the "universal" work.** The clone-a-form-field feature was designed only after inspecting the real search-criteria markup (`.ps_box-edit` = label + control), then validated live on the actual fields.

**MCP browser tools leveraged during development:**

- `browser_navigate` — load the login page and the target screen
- `browser_snapshot` — accessibility snapshot of page structure
- `browser_type` / `browser_click` — log in with test credentials
- `browser_evaluate` — inspect the live DOM and prototype/verify the insertion algorithms
- `browser_take_screenshot` — visually confirm the injected changes looked native

---

## Tools & libraries

**Runtime (shipped in the extension):**

- [**docx**](https://github.com/dolanmiu/docx) (dolanmiu/docx) — isomorphic `.docx` generation in the browser; `Packer.toBlob()` → download.
- **Chrome Extension MV3 APIs** — `chrome.sidePanel`, `chrome.scripting`, `chrome.tabs.captureVisibleTab`, `chrome.runtime` messaging.

**Build / tooling:**

- [**esbuild**](https://esbuild.github.io/) — bundles the three entry points (service worker, side panel, content script) into `extension/dist/`.
- **Node.js `zlib`** — used by `scripts/generate-icons.mjs` to hand-encode placeholder PNG icons with no image dependency.

**Development-time only (not shipped):**

- **Playwright MCP** — real-browser inspection and live verification against the target app, as described above.
