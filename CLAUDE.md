# CLAUDE.md — context handoff

Briefing for an AI coding session (Claude Code or similar) picking up this repo.
Read this first, then `docs/DECISIONS.md` for the deeper "why."

## What this is

A hands-free voice-review plugin for **AnkiDroid**, implemented as a single
JavaScript file (`_ankivoice.js`) that card templates load from
`collection.media`. It reads cards aloud (Android TTS) and takes voice commands
(Android SpeechRecognizer) through AnkiDroid's JS API. It is **AnkiDroid-only**;
on Desktop/AnkiWeb the API is absent and the script hides itself.

## The hard constraint (read before proposing anything)

**You cannot run or test the plugin from the CLI.** It depends on AnkiDroid's
WebView JS API, which only exists on-device. The dev loop is:

1. Edit `_ankivoice.js`.
2. `npm test` — `node --check`, then `test/test.js` (pure functions, no deps),
   then `test/smoke.js` (whole plugin against a fake DOM + fake JS API; needs
   jsdom, skips without it).
3. Manual verification on a physical AnkiDroid device by the maintainer.

The smoke test raises the floor but does not replace step 3: jsdom is not the
Android System WebView, and the fake API is a guess at the real one's shape.

Do **not** assume browser/Node behavior maps to AnkiDroid's WebView. Several
past bugs came from exactly that. See `docs/DECISIONS.md` → "Dead ends" and
"Environment facts."

## Architecture

One IIFE in `_ankivoice.js`, roughly in this order:

- **Header comment**: version + changelog + usage + platform note.
- **`CFG`** — all settings + their defaults. Right after, defaults are captured
  into `CFG_DEFAULTS`, then overrides are loaded (cookie first, then
  `localStorage`), then any empty `words_*` list is refilled from defaults.
- **UI elements** (all ids are `av-*`, all excluded from spoken text):
  - `av-root` — the bottom status bar; it's also the on/off toggle (tap it).
  - `av-heard` — the Voice-test readout (hidden unless `CFG.voiceTest`).
  - `av-gear` — the ⚙ settings button (far right).
  - `av-settings` — the settings panel overlay (built lazily).
- **Persistence helpers**: `lsGet/lsSet`, `getCookie/setCookie`. Settings save to
  the cookie (survives the random server port; see DECISIONS).
- **Keep-awake**: `keepAwake()/letSleep()` — screen wake lock + a muted 1px
  looping video (belt and suspenders), held only while actively reviewing.
- **Text extraction**: `textWithBreaks` → `extractLines` → `speechJoin`
  (line breaks become spoken pauses; `<small>` and `av-*` excluded);
  `subtractLines` (answer = card lines minus question lines); `hrLines` fallback.
- **Normalization**: `normalize` (lowercase, NFKD, drop combining marks, strip
  punctuation via `AV_PUNCT`) — accent-folding but script-preserving. Everything
  that compares heard speech to text goes through it.
- **Interval → speech**: `expandIvl` (+ `unwrapValue`, `AV_UNITS`).
- **Vocab matching**: `said(heard, key)` — `heard` is the recognizer's *array of
  hypotheses* (a bare string is also accepted). A command fires if any single
  hypothesis contains any word from `CFG.words_<key>`. Testing hypotheses
  separately matters: see DECISIONS.
- **Spoken answers**: `readAttempts` / `anyAnswerMatches` / `answerMatches` —
  again, per hypothesis. `rememberHeard` / `recentHeard` keep the last 24 heard
  words so the settings panel can offer one-tap "add this mis-hear" chips.
- **`commandsText`** — spoken command help / first-card prompt.
- **`startFlow(resume)`** — the per-card state machine. Uses a generation counter
  (`window.__avGen` + local `myGen`, `dead()`) to invalidate stale async work, a
  per-flow `listening` flag to guarantee one recognizer at a time, `speak`,
  `grade`, `countdown`, `listen`, `pauseMic`, and the `window.ankiSttResult`
  handler. Two counters decide when to park the mic: `tries` (silence) and
  `noMatch` (heard something, recognised nothing). **`resume === true` skips the
  reading phase** and opens the mic immediately — used when un-pausing by tap and
  when closing the settings panel.
- **`stopFlow`, `onTap`** — toggle/stop logic.
- **Settings panel** — `AV_SETTINGS` (spec list), `saveCfg/resetCfg`,
  `buildPanel`, `openSettings/closeSettings`. Setting types: `bool`, `num`,
  `text` (plain field, e.g. language) and `words` (tappable chips + a text
  field). `saveCfg` refuses to write a cookie over ~3.8 KB and reports it via
  `setNote`.
- **`visibilitychange`** — stop everything when Anki backgrounds; re-acquire wake
  lock on return.
- **init IIFE** — waits up to 2s for `AnkiDroidJS` (bare name!); if absent, hides
  the UI (Desktop/AnkiWeb) and returns; else starts the flow (or paints "off").

## Flow summary

Question side: read the question (+ full command list on the first card of a
session) → countdown → listen. Heard "answer" reveals. Answer side: read the
answer → say "Mark it" → short delay → listen → a grade word calls
`ankiAnswerEaseN`, speaks the next interval, advances. Session state
(`av_qdone`/`av_adone`) resets after 5 min idle.

## Conventions

- **ES5 *style*, not ES5 *target*.** The shipped file uses `var`, function
  declarations, no arrow functions and no optional chaining — keep it that way.
  But it does rely on `async`/`await`, `Promise`, `String.prototype.normalize`,
  `navigator.wakeLock` and CSS `inset`, so the real floor is about Chrome 87 /
  Android 10 WebView. The style rule is for readability and safe `eval`, not for
  supporting ancient devices; don't "fix" it by rewriting promises into
  callbacks.
- **The shipped file is pure ASCII.** Every non-ASCII character is a `\uXXXX`
  escape (CI enforces this), because the file is fetched and `eval`'d and has
  been mangled by encoding round-trips before.
- **Fixed filename `_ankivoice.js`.** Never rename — templates reference it.
- **Version** lives in the header comment (`VERSION:`) and `CHANGELOG.md`. Bump
  both on any change.
- **All injected DOM uses `av-*` ids** so `textWithBreaks` excludes it from
  speech. If you add UI, use an `av-` id.
- Unicode in strings is written as `\uXXXX` escapes (or literal) — be careful
  when generating the file so escapes survive.

## Known gotchas (each cost real time)

- `AnkiDroidJS` is a **lexical global class**, not `window.AnkiDroidJS`. Check the
  bare name.
- `ankiGetNextTimeN` returns **raw response text**; `JSON.parse` it, read
  `.value`.
- Intervals need Reviewing → "Show next review time above answer buttons" ON.
- `SpeechRecognizer` is leaked by AnkiDroid — never start a second mic without
  stopping the first; the `listening` flag + stop-on-new-flow handle it.
- Each card side is a **full page reload** — no memory persists across sides.
- Server port is **random per launch** — `localStorage` is not durable; settings
  use a cookie (which has a ~4 KB ceiling shared by all the word lists).
- `ankiSttResult` receives a **list of competing hypotheses**, not one string.
  Never join them before matching — that was a real, long-lived bug.
- The handler is `async`, so **anything it throws vanishes** into an unhandled
  rejection and the mic never reopens. Guard every parse.
- **Never let a default get saved.** `cfgJson` stores only non-default values.
  If you change a default, add the old value to `AV_OLD_DEFAULTS`, or everyone who
  saved settings on the old version keeps the old value.
- The grade **buttons are invisible to card JS** (native UI, no callback). Anything
  that must react to "the user graded this" works for voice grades only, unless
  it gives button users their own on-page control (see `offerKeep`).
- The reviewer's CSS sets `user-select:none` on the card body, which appears to
  block the **on-screen keyboard** in our settings inputs. Word lists must stay
  editable without typing (the chip UI).

## How to make and ship a change

1. Edit `_ankivoice.js`; bump `VERSION:` and add a `CHANGELOG.md` entry (and the
   header changelog). A test asserts these three agree, so drift fails CI.
2. `npm test` (or `node test/test.js` alone if jsdom isn't installed).
3. Deploy: replace `_ankivoice.js` in `collection.media` (desktop), sync desktop,
   sync AnkiDroid. Verify on device.
4. Merging the version bump to `main` publishes a GitHub release automatically
   (tag `v<N>`, notes from that `CHANGELOG.md` section, with `_ankivoice.js` and
   the built `.apkg` attached). Nothing to do by hand; re-running on an
   unchanged version is a no-op. CI fails the PR if the bumped version has no
   `CHANGELOG.md` section, so the release can never have empty notes.

## Open threads / roadmap

- Optional raw-URL loader for auto-deploy-on-commit (CORS already works).
- Verify on-device (v29 changes that CLI tests cannot reach): does the keyboard
  now open in the settings text fields? does `ankiSttSetLanguage` exist on this
  JS API version? does "detect spoken answers" behave now that hypotheses are
  matched separately?
- Per-side TTS language for language decks (`ankiTtsSetLanguage`).
- Upstream AnkiDroid patch to reduce beeps (silence-length extras + recognizer
  `destroy()`), and a bigger one to enable `getUserMedia`
  (`MODIFY_AUDIO_SETTINGS` + `AudioManager` mode). Details in DECISIONS.
