# 🧪 Gherkin Test Recorder — Chrome Extension

> **Record browser interactions. Generate BDD test cases. Capture session videos. Zero AI. Zero dependencies.**

A Chrome extension that automatically converts every click, type, navigation, and form interaction into production-ready **Gherkin `.feature` files** — and simultaneously records your session as a real **H.264 `.mp4` video**. Built entirely on native browser APIs with no external libraries, no AI models, and no backend servers.

---

## Table of Contents

1. [What It Does](#1-what-it-does)
2. [Feature List](#2-feature-list)
3. [Architecture Overview](#3-architecture-overview)
4. [File Structure](#4-file-structure)
5. [How Each File Works](#5-how-each-file-works)
   - 5.1 [manifest.json](#51-manifestjson)
   - 5.2 [background.js — Service Worker](#52-backgroundjs--service-worker)
   - 5.3 [content.js — Page Event Recorder](#53-contentjs--page-event-recorder)
   - 5.4 [gherkin-generator.js — Rule Engine](#54-gherkin-generatorjs--rule-engine)
   - 5.5 [popup.html / popup.css — UI Shell](#55-popuphtml--popupcss--ui-shell)
   - 5.6 [popup.js — UI Controller](#56-popupjs--ui-controller)
   - 5.7 [offscreen.html / offscreen.js — Video Engine](#57-offscreenhtmloffscreenjs--video-engine)
6. [Gherkin Generation — Deep Dive](#6-gherkin-generation--deep-dive)
   - 6.1 [Element Label Resolution (12-level priority)](#61-element-label-resolution-12-level-priority)
   - 6.2 [Event Capture Strategy](#62-event-capture-strategy)
   - 6.3 [Step-to-Gherkin Rule Table](#63-step-to-gherkin-rule-table)
   - 6.4 [Smart URL Recognition](#64-smart-url-recognition)
   - 6.5 [Keyword Flow Logic](#65-keyword-flow-logic)
   - 6.6 [Deduplication Algorithm](#66-deduplication-algorithm)
7. [Video Recording — Deep Dive](#7-video-recording--deep-dive)
   - 7.1 [Why WebM Wasn't Good Enough](#71-why-webm-wasnt-good-enough)
   - 7.2 [WebCodecs + H.264 Pipeline](#72-webcodecs--h264-pipeline)
   - 7.3 [Inline MP4 Muxer (Zero Dependencies)](#73-inline-mp4-muxer-zero-dependencies)
   - 7.4 [Two-Pass stco Offset Resolution](#74-two-pass-stco-offset-resolution)
   - 7.5 [Fallback Path (MediaRecorder → WebM)](#75-fallback-path-mediarecorder--webm)
   - 7.6 [MV3 Offscreen Document Constraint](#76-mv3-offscreen-document-constraint)
8. [Message Passing Architecture](#8-message-passing-architecture)
9. [State Management](#9-state-management)
10. [UI Architecture](#10-ui-architecture)
11. [Data Storage](#11-data-storage)
12. [Tech Stack](#12-tech-stack)
13. [Permissions Explained](#13-permissions-explained)
14. [Installation Guide](#14-installation-guide)
15. [Usage Guide](#15-usage-guide)
16. [Extending the Extension](#16-extending-the-extension)
17. [Known Limitations](#17-known-limitations)
18. [Glossary](#18-glossary)

---

## 1. What It Does

When you install this extension and click **Start**, it injects a listener script into the current web page. Every interaction you make — clicking buttons, typing in fields, navigating between pages, selecting dropdowns, checking boxes — is captured and converted in real time into a **Gherkin BDD test scenario** using a deterministic rule engine (no AI involved).

At the same time, you can click **Video** to record a synchronized **H.264 MP4 video** of your browser tab, so you have both a written test specification and a visual proof of the user journey.

The produced Gherkin can be copied to clipboard, downloaded as a `.feature` file, or saved to a persistent library. The `.feature` file is directly consumable by test frameworks like **Cucumber**, **SpecFlow**, **Behave**, **Cypress (Cucumber plugin)**, **Playwright (BDD)**, and **Serenity**.

---

## 2. Feature List

### Step Recording
| Feature | Detail |
|---|---|
| Click capture | Buttons, links, tabs, menu items, ARIA roles, custom clickable elements |
| Text input capture | All `<input>` types, `<textarea>`, `contenteditable` — debounced at 1.2 s |
| Select/dropdown | Native `<select>` — captures the selected option text, not just value |
| Checkbox | Check and uncheck events, separate from click events |
| Radio buttons | `change` event on radio inputs |
| Form submit | `<form>` submit events with form name/label |
| File upload | `<input type="file">` with captured filenames |
| Keyboard shortcuts | Ctrl/Cmd + key combos (S, Z, Y, C, V, A) |
| Right-click assertions | Context menu on any element adds a `Then I should see` step |
| Page navigation | `chrome.tabs.onUpdated` catches cross-page navigations |
| Manual assertions | 7 assertion types insertable from the popup without interacting with the page |
| Pause / Resume | Freeze recording at any point without losing steps |

### Gherkin Generation
| Feature | Detail |
|---|---|
| Zero AI | Purely deterministic rule-based conversion |
| Smart URL names | `/login` → "I am on the login page" (9 common paths mapped) |
| Given / When / Then | Automatic keyword sequencing with `And` chaining |
| Tags | `@smoke`, `@regression`, `@login` — any Cucumber-style tags |
| Feature + Scenario naming | Editable from the popup in real time |
| Deduplication | Removes consecutive duplicate navigates, collapses click+input pairs |
| Syntax highlighting | Live color-coded preview in the popup |
| Copy to clipboard | One click with textarea fallback for older browsers |
| Download `.feature` | Sanitized filename derived from scenario name |
| Batch export | Export all saved scenarios into one combined `.feature` file |

### Video Recording
| Feature | Detail |
|---|---|
| Primary format | H.264 / AVC in ISO Base Media File Format (.mp4) |
| Fallback format | VP9 in WebM container (if WebCodecs unavailable) |
| Codec selection | Auto-selects H.264 High Profile → Baseline fallback |
| Pause / Resume video | Without stopping the session |
| Inline preview | Video player appears in popup after encoding |
| File size display | Shows encoded size in MB before download |
| Simultaneous recording | Steps + video captured at the same time |
| Resolution | Up to 1920×1080, 30 fps |

### Scenario Management
| Feature | Detail |
|---|---|
| Persistent library | `chrome.storage.local` — survives browser restarts |
| Load back | Reload any saved scenario's steps into the editor |
| Per-scenario copy | One-click Gherkin copy from the library |
| Per-scenario download | Individual `.feature` file download |
| Delete | Remove individual scenarios |
| Export all | Combined `.feature` file with all scenarios |
| Clear all | Wipe the entire library |

### UI
| Feature | Detail |
|---|---|
| Dark theme | Professional teal-on-dark colour scheme |
| Real-time step list | New steps appear instantly as you interact |
| Step search/filter | Live filter across all step summaries |
| Per-step edit | Edit label, value, and type of any step |
| Per-step delete | Animated removal with slide-out |
| Step type badges | Color-coded NAVIGATE / CLICK / INPUT / SELECT etc. |
| Live timer | mm:ss counter while recording |
| Toast notifications | Non-blocking feedback for every action |
| Modal dialogs | Edit step, add manual assertion |
| Tab navigation | Record / Gherkin / Saved / Settings — all in one 440px popup |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Web Page (any URL)                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  content.js (injected)                               │   │
│  │  • Listens: click, input, change, submit, keydown    │   │
│  │  • Resolves element labels (12-level priority)       │   │
│  │  • Debounces text input (1.2 s)                     │   │
│  │  • Sends RECORD_ACTION messages                      │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │  chrome.runtime.sendMessage
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  background.js (Service Worker — persistent)                │
│                                                             │
│  Global state: { steps[], isRecording, isPaused,           │
│                  isVideoRecording, tabId, startTime }        │
│                                                             │
│  • Receives RECORD_ACTION → pushes to steps[]               │
│  • Tracks navigation via chrome.tabs.onUpdated              │
│  • Routes all popup ↔ content script messages               │
│  • Manages offscreen document lifecycle                     │
│  • Relays VIDEO_READY from offscreen → popup                │
└──────────┬────────────────────────────┬─────────────────────┘
           │                            │
           │  chrome.runtime.sendMessage│  chrome.tabCapture
           │  (STATE_UPDATE broadcast)  │  .getMediaStreamId()
           ▼                            ▼
┌─────────────────────┐   ┌────────────────────────────────────┐
│  popup.html/js/css  │   │  offscreen.js (Offscreen Document) │
│                     │   │                                    │
│  Tab: Record        │   │  Path A — WebCodecs:               │
│  • Step list        │   │  • MediaStreamTrackProcessor       │
│  • Search/filter    │   │  • VideoEncoder (H.264/AVC)        │
│  • Edit / Delete    │   │  • onEncodedChunk → encodedChunks[]│
│                     │   │  • buildMP4() inline muxer         │
│  Tab: Gherkin       │   │  • Output: real .mp4               │
│  • Feature/Scenario │   │                                    │
│  • Tag input        │   │  Path B — Fallback:                │
│  • Live preview     │   │  • MediaRecorder (VP9)             │
│  • Copy/Download    │   │  • Output: .webm                   │
│                     │   │                                    │
│  Tab: Saved         │   │  → Sends VIDEO_READY to background │
│  Tab: Settings      │   └────────────────────────────────────┘
└─────────────────────┘
           │
           │  Shared with gherkin-generator.js (loaded in popup)
           ▼
┌─────────────────────────────────────────────────────────────┐
│  gherkin-generator.js (runs in popup context)               │
│                                                             │
│  • generateGherkin(steps, feature, scenario, tags)          │
│  • stepToGherkin(step, index, prevKeyword)                  │
│  • Smart URL path mapping                                   │
│  • Given/When/Then/And keyword sequencing                   │
│  • deduplicateSteps() — removes redundant entries           │
│  • getStepSummary() / getStepIcon() — for the step list UI  │
└─────────────────────────────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────┐
│  chrome.storage.local                                       │
│  Key: "scenarios" → Array of saved scenario objects        │
│  Each: { id, featureName, scenarioName, tags, steps[],     │
│           gherkin (string), stepCount, savedAt (ms) }       │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. File Structure

```
gherkin-recorder/
│
├── manifest.json          Chrome extension manifest (MV3)
│
├── background.js          Service worker — state, routing, video coordination
│
├── content.js             Injected into web pages — DOM event capture
│
├── gherkin-generator.js   Rule-based Gherkin generation engine (popup context)
│
├── popup.html             Extension popup UI shell (440 × 560–680 px)
├── popup.css              Dark theme styles (1050 lines)
├── popup.js               Popup controller — UI state, events, rendering
│
├── offscreen.html         Minimal HTML shell for the offscreen document
├── offscreen.js           Video engine — WebCodecs H.264 encoder + MP4 muxer
│
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 5. How Each File Works

### 5.1 `manifest.json`

Declares the extension under **Manifest Version 3** (Chrome's current standard).

```json
{
  "manifest_version": 3,
  "permissions": [
    "activeTab",    // Access the current tab's content
    "storage",      // chrome.storage.local for scenario persistence
    "tabs",         // chrome.tabs.onUpdated for navigation tracking
    "scripting",    // chrome.scripting.executeScript to inject content.js
    "tabCapture",   // Capture the tab's video stream for recording
    "offscreen"     // Create an offscreen document to host MediaRecorder/VideoEncoder
  ],
  "host_permissions": ["<all_urls>"]  // Allow content script on any page
}
```

**Key MV3 constraints this extension respects:**
- Service workers cannot hold `MediaRecorder` objects (they suspend after ~30 s of inactivity) → solved by the offscreen document
- `chrome.tabCapture.getMediaStreamId()` must be called from the service worker, but the stream ID is consumed in the offscreen document
- No persistent background pages — all state is stored in memory in the service worker (which the Chrome runtime keeps alive while messaging is active)

---

### 5.2 `background.js` — Service Worker

The central hub. Lives as a Chrome service worker — it persists as long as there are open message channels.

**Global state object:**
```js
let state = {
  isRecording:      false,   // Step recording active
  isPaused:         false,   // Step recording paused
  tabId:            null,    // ID of tab being tracked
  startTime:        null,    // Unix ms when recording started (for timer)
  steps:            [],      // Array of recorded action objects
  isVideoRecording: false,   // Video capture active
  isVideoPaused:    false,   // Video paused (stream still open)
  videoTabId:       null     // ID of tab being video-captured
}
```

**Responsibilities:**
1. **Navigation tracking** — `chrome.tabs.onUpdated` fires when a tab changes URL. The background checks if it matches `state.tabId` and appends a `navigate` step.
2. **Content script coordination** — sends `SET_RECORDING_STATE` to `content.js` when recording starts, stops, or pauses.
3. **State broadcast** — after every state change, broadcasts a `STATE_UPDATE` message to any open popup window.
4. **Offscreen document lifecycle** — calls `ensureOffscreenDocument()` before video starts and `closeOffscreenDocument()` after `VIDEO_READY` is received.
5. **Video relay** — `VIDEO_READY` from the offscreen document is forwarded to the popup (offscreen docs can't talk to popups directly).

**Full message type list handled by background.js:**

| Message Type | Direction | What it does |
|---|---|---|
| `GET_STATE` | popup → bg | Returns full state object |
| `GET_RECORDING_STATE` | content → bg | Returns `{ isRecording }` |
| `START_RECORDING` | popup → bg | Clears steps, injects content.js, records start URL |
| `STOP_RECORDING` | popup → bg | Sets recording=false, returns all steps |
| `PAUSE_RECORDING` | popup → bg | Toggles isPaused, notifies content script |
| `CLEAR_STEPS` | popup → bg | Empties steps array |
| `RECORD_ACTION` | content → bg | Appends one action to steps[] |
| `DELETE_STEP` | popup → bg | Splices one step by index |
| `UPDATE_STEP` | popup → bg | Merges updates into one step by index |
| `SAVE_SCENARIO` | popup → bg | Persists scenario to chrome.storage.local |
| `GET_SCENARIOS` | popup → bg | Returns saved scenarios array |
| `DELETE_SCENARIO` | popup → bg | Removes one scenario by id |
| `START_VIDEO_RECORDING` | popup → bg | Gets stream ID via tabCapture, creates offscreen doc, starts capture |
| `STOP_VIDEO_RECORDING` | popup → bg | Tells offscreen doc to stop; waits for VIDEO_READY |
| `PAUSE_VIDEO_RECORDING` | popup → bg | Tells offscreen doc to pause |
| `RESUME_VIDEO_RECORDING` | popup → bg | Tells offscreen doc to resume |
| `GET_VIDEO_STATE` | popup → bg | Returns `{ isVideoRecording, isVideoPaused }` |
| `VIDEO_READY` (relay) | offscreen → bg → popup | Forwards finished video dataURL |

---

### 5.3 `content.js` — Page Event Recorder

Injected into every web page via `chrome.scripting.executeScript`. Wrapped in an IIFE with a `window.__gherkinRecorderInjected` guard to prevent double-injection on page reloads.

**Events captured:**

| DOM Event | Capture Phase | Purpose |
|---|---|---|
| `click` | Capture (true) | Clicks on buttons, links, tabs, menu items |
| `input` | Capture (true) | Text input — debounced 1.2 s |
| `change` | Capture (true) | Select dropdowns, checkboxes, radio, file inputs |
| `submit` | Capture (true) | Form submissions |
| `keydown` | Capture (true) | Ctrl/Cmd keyboard shortcuts |
| `contextmenu` | Capture (true) | Right-click → produces `assert` step |

All events use **capture phase** (`addEventListener(..., true)`) to intercept before any `stopPropagation()` calls in the page's own JavaScript.

**Click handling — DOM walk-up:**
When a `click` fires on a deep element (e.g. an SVG icon inside a button), the code walks up the DOM tree up to 5 levels to find the most semantically relevant ancestor (button, link, ARIA role="button", etc.) before capturing.

**Input debouncing:**
A `Map<element, timeoutId>` tracks per-element debounce timers. Each keystroke resets the 1.2 s timer. Only the final value is sent. This avoids recording every intermediate character (e.g. typing "hello" generates 1 step, not 5).

---

### 5.4 `gherkin-generator.js` — Rule Engine

A pure JavaScript module loaded in the popup context (no service worker access needed). Contains ~380 lines of deterministic transformation logic.

**Exported functions:**
```js
generateGherkin(steps, featureName, scenarioName, tags)  // Full feature file
stepToGherkin(step, index, prevKeyword)                   // Single step line
getStepSummary(step)                                      // UI display text
getStepIcon(step)                                         // Emoji icon for UI
deduplicateSteps(steps)                                   // Removes redundant steps
```

No AI, no network calls, no randomness. Given the same inputs, always produces the same Gherkin. See [Section 6](#6-gherkin-generation--deep-dive) for the full rule breakdown.

---

### 5.5 `popup.html` / `popup.css` — UI Shell

`popup.html` defines the fixed 440 px wide popup with:
- **Header** — brand name + animated status badge (IDLE / REC / PAUSED / DONE)
- **Controls bar** — Start / Pause / Stop / Clear / Video buttons
- **Stats bar** — Step count, elapsed timer, PAUSED chip, REC VIDEO chip
- **Video preview panel** — hidden until video encoding completes; contains `<video>` player
- **Tab navigation** — Record / Gherkin / Saved / Settings
- **Tab panels** — each panel `display:none` when inactive
- **Toast** — fixed position notification (bottom-center, slide-in animation)
- **Edit step modal** — overlaid dialog for editing individual steps
- **Add assertion modal** — 7 assertion types selectable from a dropdown

`popup.css` is ~1050 lines of pure CSS with:
- CSS custom properties (`--bg-0` through `--bg-3`, `--accent`, `--red`, `--yellow`, `--blue`, `--purple`, etc.)
- No CSS frameworks
- `@keyframes` for recording pulse, blink, and step slide-in animations
- Scrollbar styling for the steps list and tab panels

---

### 5.6 `popup.js` — UI Controller

The largest file (~1000 lines). Runs exclusively in the popup context.

**Initialization sequence:**
1. `DOMContentLoaded` → resolve video DOM refs (must wait for DOM)
2. `loadState()` → sends `GET_STATE` to background, hydrates local variables
3. `bindEvents()` → attaches all button and input listeners
4. `loadSavedScenarios()` → sends `GET_SCENARIOS` to background

**Real-time update path:**
```
content.js fires event
  → RECORD_ACTION → background.js
  → background appends step, calls broadcastUpdate()
  → STATE_UPDATE → popup.js onMessage handler
  → renderSteps() → DOM update
  → updateGherkin() → re-runs gherkin-generator.js
```

**Video state machine in popup:**
```
idle ──[click Video]──► starting (button disabled)
                              │
              ◄─── success ───┘
              │
         recording ──[click Pause]──► paused
              │                          │
              │       ◄─── click Resume ─┘
              │
         [click badge "stop"]
              │
         processing (button disabled, "Processing...")
              │
         ◄─── VIDEO_READY ───
              │
           preview shown (video player + download)
```

---

### 5.7 `offscreen.html` / `offscreen.js` — Video Engine

The most technically complex part. See [Section 7](#7-video-recording--deep-dive) for full details.

`offscreen.html` is a minimal HTML shell. Chrome MV3 requires that `MediaRecorder` and `VideoEncoder` (which hold live media streams) live in an offscreen document, not the service worker.

`offscreen.js` (~550 lines) implements the complete video pipeline:
- `startCapture(streamId)` — converts the tabCapture stream ID into a real `MediaStream`
- `startWebCodecsPath(track)` — configures `VideoEncoder` for H.264 with AVCC output format
- `drainFrames()` — async loop reading `VideoFrame` objects from `MediaStreamTrackProcessor`
- `onEncodedChunk(chunk, meta)` — accumulates encoded chunks and extracts the `avcCBytes` (SPS + PPS) from the first keyframe's `decoderConfig.description`
- `stopCapture()` — flushes the encoder, then calls `buildMP4()`
- `buildMP4(chunks, avcCBytes, w, h)` — inline ISO Base Media File Format muxer

---

## 6. Gherkin Generation — Deep Dive

### 6.1 Element Label Resolution (12-level Priority)

When any DOM event fires, `content.js` calls `getElementLabel(el)` which tries 12 strategies in order, returning the first non-empty result:

| Priority | Strategy | Example result |
|---|---|---|
| 1 | `aria-label` attribute | `"Search products"` |
| 2 | `aria-labelledby` → text of referenced element | `"Email address"` |
| 3 | `<label for="id">` associated label | `"Password"` |
| 4 | Wrapping `<label>` text content | `"Remember me"` |
| 5 | `placeholder` attribute | `"Enter your name"` |
| 6 | `title` attribute | `"Close dialog"` |
| 7 | `name` attribute (prettified) | `"first_name"` → `"first name"` |
| 8 | Visible `textContent` (≤80 chars) | `"Submit Order"` |
| 9 | `value` of button-type inputs | `"Go"` |
| 10 | `alt` attribute (images) | `"Logo"` |
| 11 | `data-testid` / `data-cy` / `data-qa` / `data-test` | `"login-btn"` → `"login btn"` |
| 12 | Minimal CSS selector | `"button.primary"` |

Name prettification: `snake_case` and `kebab-case` and `camelCase` are all converted to space-separated words.

### 6.2 Event Capture Strategy

**Why capture phase?** Using `addEventListener(type, handler, true)` intercepts events before the page's own handlers. Many SPAs (React, Vue, Angular) call `e.stopPropagation()` on their synthetic events. Capture phase runs before bubbling, so it catches events before any `stopPropagation` can block them.

**Why not use `MutationObserver`?** Because DOM mutations don't tell you *what the user did*, only *what changed*. A click on a button that opens a modal would require reverse-engineering the intention from the mutation, which is unreliable. Direct event interception is accurate.

**The input debounce problem:** Without debouncing, typing `"hello"` generates 5 `input` events. A 1.2 s debounce means the step is only recorded after the user stops typing. A `Map<element, timeout>` tracks per-element timers so multiple fields can be typed in simultaneously without cross-interference.

### 6.3 Step-to-Gherkin Rule Table

| Recorded action | Generated Gherkin |
|---|---|
| `{ type: "navigate", url: "https://app.com/login" }` | `Given I am on the login page` |
| `{ type: "navigate", url: "https://app.com/orders/123" }` | `Given I navigate to "https://app.com/orders/123"` |
| `{ type: "click", elementType: "button", label: "Submit" }` | `When I click the "Submit" button` |
| `{ type: "click", elementType: "link", label: "Forgot password" }` | `When I click the "Forgot password" link` |
| `{ type: "click", elementType: "tab", label: "Settings" }` | `When I click the "Settings" tab` |
| `{ type: "click", elementType: "menuitem", label: "Export CSV" }` | `When I click the "Export CSV" menu item` |
| `{ type: "input", inputType: "email", label: "Email", value: "a@b.com" }` | `When I enter "a@b.com" in the "Email" email field` |
| `{ type: "input", inputType: "password", label: "Password" }` | `When I enter a password in the "Password" field` |
| `{ type: "input", inputType: "search", label: "Search", value: "laptop" }` | `When I search for "laptop" in the "Search" field` |
| `{ type: "input", inputType: "date", label: "Start Date", value: "2024-01-15" }` | `When I set the "Start Date" date to "2024-01-15"` |
| `{ type: "select", label: "Country", value: "India" }` | `When I select "India" from the "Country" dropdown` |
| `{ type: "checkbox", label: "Accept terms", checked: true }` | `When I check the "Accept terms" checkbox` |
| `{ type: "checkbox", label: "Mailing list", checked: false }` | `When I uncheck the "Mailing list" checkbox` |
| `{ type: "radio", label: "Express shipping" }` | `When I select the "Express shipping" option` |
| `{ type: "submit", label: "login" }` | `When I submit the "login" form` |
| `{ type: "file", label: "Avatar", value: "photo.jpg" }` | `When I upload "photo.jpg" via the "Avatar" file input` |
| `{ type: "hotkey", label: "Ctrl+S" }` | `When I press "Ctrl+S"` |
| `{ type: "assert", value: "Welcome, John!" }` | `Then I should see "Welcome, John!"` |

### 6.4 Smart URL Recognition

The `navigate()` function in `gherkin-generator.js` parses the URL and maps known pathname patterns to human-readable descriptions:

```
/           → "I am on the home page"
/login      → "I am on the login page"
/signin     → "I am on the login page"
/register   → "I am on the registration page"
/signup     → "I am on the registration page"
/dashboard  → "I am on the dashboard page"
/profile    → "I am on the profile page"
/settings   → "I am on the settings page"
/checkout   → "I am on the checkout page"
/cart       → "I am on the shopping cart page"
/search     → "I am on the search page"
anything else → I navigate to "<full URL>"
```

### 6.5 Keyword Flow Logic

The `resolveKeyword(prevKeyword, defaultKw)` function ensures correct Given/When/Then/And sequencing:

```
First step ever                → Given
Navigate after other steps     → And
Any action (click/type/etc.)   → When (or And if previous was also When)
Assert / Then                  → Then (always forced, regardless of previous)
Recording ends on a When step  → auto-appends "Then I verify the page state"
```

### 6.6 Deduplication Algorithm

`deduplicateSteps(steps)` runs two rules:

1. **Duplicate navigation** — if two consecutive steps are both `navigate` to the same URL (can happen when SPAs trigger `popstate` and `hashchange` simultaneously), the second is removed.

2. **Click before input** — if a `click` step is immediately followed by an `input` step on the same element (same `label`), the click is removed. The input step already implies the click.

---

## 7. Video Recording — Deep Dive

### 7.1 Why WebM Wasn't Good Enough

`MediaRecorder` (Chrome's built-in recording API) can only output VP8 or VP9 video inside a WebM container. WebM is not supported natively by:
- Windows Media Player
- QuickTime (macOS before Ventura)
- iOS Safari and all iOS browsers
- Most Android video players
- PowerPoint / Keynote (for embedding)
- WhatsApp, Telegram (attachment preview)

This extension solves that by bypassing `MediaRecorder` for video encoding and instead using the **WebCodecs API** to encode raw frames as **H.264**, then packaging them into a real **ISO Base Media File Format MP4** using a custom-built inline muxer — with zero external libraries.

### 7.2 WebCodecs + H.264 Pipeline

```
chrome.tabCapture.getMediaStreamId()
  → MediaStream (in offscreen document via getUserMedia chromeMediaSource)
  → MediaStreamTrackProcessor (raw VideoFrame stream)
  → ReadableStream<VideoFrame> (async iterator)
  → VideoEncoder
      codec: "avc1.640028" (H.264 High Profile Level 4.0)
      format: "avc"         ← AVCC format (length-prefixed NALUs, required for MP4)
      bitrate: 3 Mbps
      framerate: 30 fps
  → onEncodedChunk callback
      → first keyframe's meta.decoderConfig.description = SPS + PPS (AVCDecoderConfigurationRecord)
      → all chunks: { data: Uint8Array, isKey: bool, timestamp: µs, duration: µs }
  → stopCapture()
      → videoEncoder.flush()   ← drain any buffered frames
      → videoEncoder.close()
      → buildMP4(encodedChunks, avcCBytes, w, h)
  → Blob(mp4Bytes, { type: "video/mp4" })
  → FileReader.readAsDataURL()
  → chrome.runtime.sendMessage({ type: "VIDEO_READY", dataUrl, size })
```

**Codec string explained:**
- `avc1` = H.264 codec identifier
- `64` = profile `0x64` = High Profile
- `00` = constraint flags
- `28` = level `0x28` = Level 4.0 (supports up to 1080p @ 30fps)
- Fallback: `avc1.42001f` = Baseline Profile Level 3.1 (lowest common denominator)

**Why AVCC format?**
H.264 comes in two packaging formats:
- **Annex B** — used in raw `.h264` streams and by `MediaRecorder`. Uses `0x00 0x00 0x01` start codes.
- **AVCC (length-prefixed)** — used in MP4 and MOV. Each NALU is prefixed with its 4-byte length.

WebCodecs outputs AVCC when `avc: { format: 'avc' }` is specified. This is mandatory for MP4 compatibility — the `mdat` box in MP4 expects AVCC-formatted samples. Attempting to put Annex B data into an MP4 container produces a file that appears valid but will not decode correctly in most players.

### 7.3 Inline MP4 Muxer (Zero Dependencies)

The MP4 file format (ISO 14496-12) is a tree of **boxes** (also called atoms). Each box has:
- 4-byte big-endian size (including the 8-byte header)
- 4-byte FourCC type identifier
- Variable body

**FullBoxes** additionally have:
- 1-byte version
- 3-byte flags

The muxer implements 16 box constructors, all built from 6 binary helper functions (`u8arr`, `u16`, `u32`, `cc`, `cat`, `box`, `fbox`).

**Complete box tree produced:**
```
ftyp   (file type: isom / avc1 / mp41 brands)
moov
  mvhd (movie header: timescale=1000ms, duration)
  trak
    tkhd (track header: width, height, duration)
    mdia
      mdhd (media header: timescale=90000Hz, duration)
      hdlr (handler: "vide" + "VideoHandler")
      minf
        vmhd (video media header)
        dinf
          dref
            url  (data reference: same file, flags=1)
        stbl
          stsd
            avc1 (visual sample entry: w, h, 72dpi)
              avcC (AVCDecoderConfigurationRecord: SPS+PPS)
          stts (time-to-sample: run-length encoded durations at 90kHz)
          stss (sync sample table: keyframe indices, 1-based)
          stsc (sample-to-chunk: 1 chunk = all samples)
          stsz (sample sizes: per-sample byte lengths)
          stco (chunk offsets: single entry = mdat body start)
mdat   (raw H.264 sample data, AVCC format, concatenated)
```

**Key design decisions:**
- **Timescale split**: `mvhd` uses 1000 (ms precision), `mdhd` uses 90000 Hz (standard video timescale, avoids rounding drift on long recordings)
- **Single chunk**: All samples go into one `mdat` chunk (stsc has one entry). This is simplest and produces valid files — players don't require interleaved chunks for single-track video
- **stss is included**: Some strict decoders require an explicit keyframe table. Every 60th frame is forced as a keyframe (every ~2 seconds at 30fps)

### 7.4 Two-Pass stco Offset Resolution

The `stco` box must contain the byte offset of the `mdat` body from the start of the file. But `moov` (which contains `stco`) comes *before* `mdat` in the file. This is a classic chicken-and-egg problem in MP4 muxing.

**Solution — two assembly passes:**

```
Pass 1:
  Build ftyp
  Build moov with stco offset = 0 (placeholder)
  → measure moov.byteLength

Pass 2:
  mdatBodyOffset = ftyp.byteLength + moov.byteLength + 8  (8 = mdat box header)
  Build moov again with stco offset = mdatBodyOffset
  → moov size is identical (changing a u32 value doesn't change the box size)

Final file:
  cat(ftyp, moov, mdat)
```

Because `stco` contains a fixed-width `u32` value, changing the offset value doesn't affect `moov`'s total byte length. So Pass 1 and Pass 2 produce `moov` boxes of identical size, making the offset calculation exact.

### 7.5 Fallback Path (MediaRecorder → WebM)

If `VideoEncoder` or `MediaStreamTrackProcessor` are not available (Chrome < 94, or flags disabled), the code automatically falls back to:

```js
const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
  .find(t => MediaRecorder.isTypeSupported(t));

mediaRecorder = new MediaRecorder(captureStream, { mimeType: mime });
```

The fallback produces a `.webm` file. The popup's download button uses the correct extension based on the `mimeType` returned in `VIDEO_READY`.

### 7.6 MV3 Offscreen Document Constraint

Chrome Manifest V3 service workers are ephemeral — they suspend after ~30 seconds of no activity and can be killed at any time. `MediaRecorder` and `VideoEncoder` are stateful objects that hold live media stream references. If the service worker is killed mid-recording, the stream dies.

The **offscreen document** is a dedicated non-visible browser document (a hidden iframe equivalent) that Chrome guarantees will stay alive as long as it exists. It lives outside the service worker lifecycle.

```
background.js (service worker)
  → chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Tab capture for video recording'
    })
  → Sends stream ID to offscreen.js via chrome.runtime.sendMessage({ target: 'offscreen' })
  → offscreen.js holds the MediaStream and encoder in module-level variables
  → When VIDEO_READY fires, background.js closes the offscreen document
```

The `target: 'offscreen'` property in messages allows the offscreen doc's listener to filter only its own messages (since `chrome.runtime.onMessage` is broadcast to all extension contexts).

---

## 8. Message Passing Architecture

All communication uses `chrome.runtime.sendMessage` (for popup↔background and offscreen↔background) and `chrome.tabs.sendMessage` (for background↔content script).

**Flow diagram:**
```
popup.js  ──sendMessage──►  background.js  ──sendMessage──►  offscreen.js
                                  ▲                                │
                                  │         VIDEO_READY            │
                                  └────────────────────────────────┘
                                  │
                     ──sendMessage──►  popup.js
                                  │
                     ──tabs.sendMessage──►  content.js
```

**Important:** Offscreen documents cannot send messages directly to the popup. They can only send to `chrome.runtime` (the background). The background then relays `VIDEO_READY` to the popup.

**Async handling:** All `chrome.runtime.onMessage` listeners return `true` to keep the message channel open for asynchronous `sendResponse` calls.

---

## 9. State Management

There is no Redux, no reactive framework. State is managed with plain JavaScript module-level variables.

**Background state** (`background.js`) is the single source of truth. The popup synchronizes on open via `GET_STATE`, then stays in sync via `STATE_UPDATE` broadcasts.

**State reconciliation on popup open:**
```js
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (resp) => {
  steps            = resp.steps;
  isRecording      = resp.isRecording;
  isPaused         = resp.isPaused;
  startTime        = resp.startTime;
  isVideoRecording = resp.isVideoRecording;
  isVideoPaused    = resp.isVideoPaused;
  // then render
});
```

This means if you close and reopen the popup mid-recording, it picks up the live state correctly. The steps list, timer, and button states all restore accurately.

**Persistence:** Only scenario library data is persisted (`chrome.storage.local`). Recording state is in-memory only and is lost if Chrome is force-quit.

---

## 10. UI Architecture

The popup is a 440 px wide, 560–680 px tall fixed-size HTML document. No frameworks. No shadow DOM. Vanilla HTML + CSS + JS.

**Tab system:** Four tabs implemented with CSS `display: none/flex` toggling. No routing library. `switchTab(name)` sets `active` class on buttons and panels.

**Step list rendering:** Each call to `renderSteps()` wipes the steps list div and rebuilds it from the current `steps[]` array using `DocumentFragment` for performance (one DOM append, not N). Each step item is built with `innerHTML` template strings and then event listeners are attached via `querySelector`.

**Modals:** Positioned fixed with `display: none` by default. Shown by adding class `open`. No z-index stacking issues because the popup itself is an isolated `<iframe>`-like context.

**Toast system:** A single `<div id="toast">` at the bottom. Messages cycle through with a 2.4 s timeout. Classes (`success`, `error`, `info`) control color.

---

## 11. Data Storage

**`chrome.storage.local`** is used for scenario persistence. It is:
- Persistent across browser restarts (unlike `sessionStorage`)
- Synchronous-read capable (unlike IndexedDB)
- Up to 10 MB by default (enough for thousands of scenarios)
- Private to this extension

**Stored data schema:**
```js
{
  scenarios: [
    {
      id:           1704067200000,    // Date.now() — used as primary key
      featureName:  "User Login",
      scenarioName: "Successful login with valid credentials",
      tags:         "@smoke @regression",
      steps: [
        { type: "navigate", url: "https://app.com/login", timestamp: 1704067200123 },
        { type: "input", inputType: "email", label: "Email", value: "user@test.com", ... },
        // ...
      ],
      stepCount:    8,
      gherkin:      "Feature: User Login\n\n  Scenario: ...",
      savedAt:      1704067200000
    }
  ]
}
```

Nothing is sent to any external server. All data stays local to the browser.

---

## 12. Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Extension platform | Chrome Extension MV3 | Current standard, required for Chrome Web Store |
| Service worker | Vanilla JS (ES2022) | MV3 background script requirement |
| Content script | Vanilla JS (IIFE) | Maximum compatibility, no transpiler needed |
| Gherkin engine | Vanilla JS | Zero dependency, deterministic, testable |
| Popup UI | HTML5 + CSS3 + Vanilla JS | No framework = smaller bundle, faster load |
| Video encoding | WebCodecs API (VideoEncoder + MediaStreamTrackProcessor) | Only way to get H.264 output in a browser |
| MP4 muxing | Inline custom muxer (pure Uint8Array manipulation) | Zero dependencies, no WASM, no CDN |
| Tab capture | chrome.tabCapture API | Only Chrome API that can capture tab video |
| Offscreen document | chrome.offscreen API (MV3) | Required to host live media objects |
| Data persistence | chrome.storage.local | Extension-standard persistence |
| Clipboard | navigator.clipboard.writeText + execCommand fallback | Maximum browser compatibility |
| File download | Blob + URL.createObjectURL + `<a>` click | Standard browser download pattern |

**No external dependencies. No CDN calls. No npm. No build step required.** Load the folder directly into Chrome.

---

## 13. Permissions Explained

| Permission | Used for | Required? |
|---|---|---|
| `activeTab` | Access the current tab to inject content.js | Yes |
| `storage` | Save/load scenarios via chrome.storage.local | Yes |
| `tabs` | chrome.tabs.onUpdated for navigation tracking; chrome.tabs.query for getting active tab | Yes |
| `scripting` | chrome.scripting.executeScript to inject content.js on demand | Yes |
| `tabCapture` | chrome.tabCapture.getMediaStreamId() to get a stream ID for video capture | Only for video |
| `offscreen` | chrome.offscreen.createDocument() to host the video encoder | Only for video |
| `host_permissions: <all_urls>` | Allows content.js to run on any website | Yes — recorder must work everywhere |

---

## 14. Installation Guide

### From Source (Developer Mode)

1. Download and unzip `gherkin-recorder.zip`
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Select the unzipped `gherkin-recorder/` folder
6. The extension icon (🧪) appears in the Chrome toolbar
7. Pin it: click the puzzle icon → pin Gherkin Recorder

### Requirements
- **Chrome 94+** (for WebCodecs primary video path)
- **Chrome 109+** (for `chrome.offscreen` API)
- **Chrome 116+** recommended (for best WebCodecs stability)
- Any OS: Windows, macOS, Linux

---

## 15. Usage Guide

### Recording Steps

1. Navigate to the web application you want to test
2. Click the 🧪 extension icon
3. Click **Start** — recording begins, the status badge shows **REC**
4. Interact with the page normally: click, type, navigate, select
5. Right-click any element to add a `Then I should see` assertion
6. Click **Pause** to temporarily freeze recording (steps are preserved)
7. Click **Stop** to end recording

### Recording Video (simultaneously)

1. Click **Video** while on any page — Chrome will ask for tab capture permission
2. The badge shows **⏺ REC VIDEO** — video is being captured
3. Click **Pause** to pause the video stream (without stopping step recording)
4. Click the **⏺ REC VIDEO** badge to stop and encode the video
5. After a few seconds, the video preview panel appears
6. Click **Download** to save as `.mp4`

> ℹ️ Video and step recording are independent — you can run them together or separately.

### Generating Gherkin

1. Switch to the **Gherkin** tab
2. Enter your Feature name, Scenario name, and optional tags (`@smoke @regression`)
3. The Gherkin output updates in real time with syntax highlighting
4. Toggle **Remove duplicate steps** and **Smart URL names** as needed
5. Click **Copy** to copy to clipboard or **Download .feature** to save the file

### Managing Saved Scenarios

1. In the **Gherkin** tab, click **Save** to save the current scenario to the library
2. Switch to the **Saved** tab to see all saved scenarios
3. Per scenario actions: 📂 Load, 📋 Copy, 💾 Download, 🗑 Delete
4. **Export All** downloads a single `.feature` file with all scenarios concatenated

### Manual Assertions

1. In the **Record** tab, click **✅ Assert**
2. Choose an assertion type from the dropdown:
   - I should see text
   - I should see element
   - I should not see
   - URL should contain
   - Page title should be
   - Element should be enabled
   - Element should be disabled
3. Enter the value and click **Add Step**

### Editing Steps

1. Hover over any step in the list — edit (✏️) and delete (🗑) icons appear
2. Click ✏️ to open the edit modal — change label, value, and type
3. Click 🗑 to delete the step (animated slide-out)
4. Use the search bar to filter steps by text

---

## 16. Extending the Extension

### Adding a New Event Type

1. **`content.js`** — add an event listener and call `sendAction({ type: 'mytype', ... })`
2. **`gherkin-generator.js`** — add a case in `stepToGherkin()` and a converter function
3. **`popup.js`** — add a badge style in `buildBadge()` and a summary in `getStepSummary()`
4. **`popup.css`** — add `.badge-mytype { ... }` color rule

### Adding a New Smart URL Pattern

In `gherkin-generator.js`, in the `navigate()` function, add a new `path.includes()` branch:
```js
if (path.includes('/checkout/payment')) {
  return { line: `${kw} I am on the payment page`, keyword: kw };
}
```

### Adding a New Assertion Type

In `popup.html`, add an `<option>` to the `#assertType` select. In `popup.js`, add the template string to the `assertLabels` map in `addManualAssert()`.

### Adding Audio to Video

In `offscreen.js`, modify `startCapture()` to include `audio: true` in the `getUserMedia` constraints, then add a separate `AudioEncoder` path and mix into the MP4 as a second track with `stsd/mp4a/esds` boxes.

### Integrating with a Test Framework

The generated `.feature` file is standard Cucumber syntax. Drop it into:
- **Cucumber-JVM** (Java) — add step definitions in Java
- **Cucumber.js** (Node.js) — add step definitions in JS/TS
- **Behave** (Python) — add step definitions in Python
- **SpecFlow** (.NET) — add step definitions in C#
- **Cypress + cypress-cucumber-preprocessor** — works directly
- **Playwright + cucumber** — works directly with the `@cucumber/cucumber` package

---

## 17. Known Limitations

| Limitation | Detail | Workaround |
|---|---|---|
| `chrome://` pages | Content script cannot be injected into Chrome's own pages (extensions, settings, new tab) | Navigate to a real website first |
| iframes | Content script runs only on the top-level frame (`all_frames: false`) | Interactions inside cross-origin iframes are not captured |
| Canvas / WebGL elements | Click events on canvas fire but label resolution returns only the canvas element | Edit the step manually to add a meaningful label |
| Shadow DOM | Elements deep inside closed shadow roots may not have accessible labels | The CSS selector fallback is used |
| Video on `chrome://` tabs | tabCapture cannot capture Chrome's internal pages | Only works on regular `http://` and `https://` pages |
| MP4 file size | Large recordings (20+ minutes at 1080p) can produce files > 1 GB | Keep recordings under 10–15 minutes |
| Password values | Input type=password is captured as `••••••` by design | Cannot be disabled — it is a security feature |
| SPA navigation | Some SPAs use `history.pushState` without triggering `tabs.onUpdated` | Use right-click assertion to mark the new page instead |
| Multi-window recording | Only tracks the tab that was active when Start was clicked | Each window/tab session should be recorded separately |

---

## 18. Glossary

| Term | Definition |
|---|---|
| **BDD** | Behaviour-Driven Development — a software development approach where tests are written in plain language describing user behaviour |
| **Gherkin** | The plain-text language used by Cucumber for writing BDD tests (Feature / Scenario / Given / When / Then) |
| **Feature file** | A `.feature` text file containing one or more Gherkin scenarios |
| **MV3** | Chrome Extension Manifest Version 3 — the current extension platform (replaced MV2 in 2023) |
| **Service Worker** | A background script that runs independently of any browser tab, used as the MV3 replacement for background pages |
| **Offscreen Document** | A hidden non-visible page that can hold stateful browser APIs (MediaRecorder, VideoEncoder) which cannot run in a service worker |
| **WebCodecs** | A Chrome browser API (available since Chrome 94) that provides low-level access to media encoders and decoders |
| **AVCC** | Advanced Video Coding Configuration — the length-prefixed NALU packaging format used in MP4 files (as opposed to Annex B which uses start codes) |
| **NALU** | Network Abstraction Layer Unit — the basic building block of an H.264 bitstream (SPS, PPS, IDR, etc.) |
| **SPS** | Sequence Parameter Set — an H.264 NALU containing codec configuration (resolution, profile, level) |
| **PPS** | Picture Parameter Set — an H.264 NALU containing entropy coding and quantization parameters |
| **avcC** | AVCDecoderConfigurationRecord — the MP4 box that stores SPS + PPS, enabling players to initialize the H.264 decoder before the first frame |
| **ISO BMFF** | ISO Base Media File Format — the formal name for the MP4 container format (ISO 14496-12) |
| **stco** | Sample Table Chunk Offset — the MP4 box that tells the player where in the file the video data (`mdat`) begins |
| **mdat** | Movie Data — the MP4 box containing raw encoded video samples |
| **moov** | Movie box — the MP4 container for all metadata (headers, track info, sample tables) |
| **tabCapture** | A Chrome extension API that captures a MediaStream of a specific tab's screen content |
| **FourCC** | Four Character Code — a 4-byte identifier for box types in MP4 (e.g. `ftyp`, `moov`, `mdat`) |
| **Capture phase** | DOM event propagation phase that runs before bubbling, used to intercept events before page scripts can `stopPropagation` them |
| **Debounce** | A technique to delay processing until a burst of events has stopped (used here for text input — waits 1.2 s after last keystroke) |
