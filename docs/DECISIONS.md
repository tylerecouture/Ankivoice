# Decision log & findings

Technical notes for future maintainers. The user-facing version of much of this
is the FAQ in the README; this file is the engineering detail, including things
verified by reading the AnkiDroid source (branch `v2.24.0`).

## The core constraint: AnkiDroid's speech engine

- Recognition and TTS come from AnkiDroid's JS API (`AnkiDroidJS`,
  `ankiTtsSpeak`, `ankiSttStart`, `ankiAnswerEaseN`, `ankiGetNextTimeN`, …).
- `ankiSttStart` drives Android's stock `SpeechRecognizer` with
  `LANGUAGE_MODEL_FREE_FORM` and **no other tuning** (verified in
  `JavaScriptSTT.kt`). No silence-length extras are set.
- The recognizer is session-based and plays start/end **earcons** we can't
  disable from a card. "Continuous" listening = restart loop = repeated beeps.

## Dead ends (do not re-litigate)

- **Web Speech API** (`webkitSpeechRecognition`) — not implemented in Android
  WebView (Blink ships the interface, not the engine). Also would route to the
  same beeping Google service.
- **`getUserMedia` + in-browser recognition (TF.js / Vosk)** — blocked. Raw
  capture fails with `NotReadableError: Could not start audio source`, reproduced
  on a *clean* card (no other mic user). Root cause is app-level: AnkiDroid's
  manifest requests `RECORD_AUDIO` but **not `MODIFY_AUDIO_SETTINGS`**, and the
  reviewer never sets `AudioManager.mode` for capture. Without those, Android
  refuses to hand the mic to the WebView even though `onPermissionRequest` grants
  `RESOURCE_AUDIO_CAPTURE`. Card JS can't fix this. (Tracking: AnkiDroid #16319.)
  Note: media autoplay *is* allowed and CORS on `raw.githubusercontent.com` is
  open, so those aren't the blockers — the audio subsystem is.

## Environment facts that shape the code

- **Every card side is a full page reload.** `AbstractFlashcardViewer` renders
  question and answer via `card.loadDataWithBaseURL(...)`. Each side is a fresh
  JS context; nothing in memory persists across sides. Consequences:
  - Cross-side/session state goes to storage (`localStorage`, cookie) and is
    re-read. Keys: `av_qdone`, `av_adone`, `av_ts`, `av_qlines`, `av_attempt`,
    `av_on`, `av_cfg`.
  - Any in-browser recognizer would re-init per side (could be hidden behind the
    TTS read, but it's still per-side).
- **`SpeechRecognizer` is leaked.** `JavaScriptSTT.start()` calls
  `createSpeechRecognizer` every time without `destroy()`ing the previous one, so
  a second `ankiSttStart` while one is active orphans the first (it keeps
  listening → overlapping beeps). The plugin guards against this with a per-flow
  `listening` flag, a "stop the previous mic when a new flow starts" call, and a
  generation counter that invalidates stale async work.
- **Random server port each launch.** `AnkiServer` uses port `0` (ephemeral).
  Card origin is `http://127.0.0.1:<random>`, so `localStorage` is orphaned on
  restart. Settings are therefore stored in a **cookie** (host-scoped, not
  port-scoped) which AnkiDroid flushes to disk (`CookieManager.flush()`).
- **`AnkiDroidJS` is a global lexical binding**, not a `window` property. It's a
  `class` declared at the top of `js-api.js`, so it's reachable by bare name but
  `window.AnkiDroidJS` is `undefined`. (This cost real debugging time — the API
  presence check must use the bare name.)
- **`ankiGetNextTimeN` returns the raw response text**, not a parsed object.
  `js-api.js` special-cases `nextTime`/`deckName` to skip JSON parsing, so the
  caller must `JSON.parse` it and read `.value` itself.
- **Interval data requires a setting.** `nextTime1..4` are only populated when
  Reviewing → "Show next review time above answer buttons" is enabled; otherwise
  they return empty strings.
- **`ankiSttResult` hands back a LIST of competing hypotheses**, not one string
  (`["hard", "heart", "art"]`). Two bugs came out of treating it as one blob:
  command matching accidentally worked (any hypothesis matching is what you
  want), but the spoken-answer path did not — the joined string matched no
  answer line, and its word count was roughly *number of hypotheses* times the
  real length, so it failed the `maxAnswerWords` gate before it could even try.
  This is why "detect spoken answers" looked unreliable enough to disable in
  v24. Fixed in v29: hypotheses are kept as an array all the way through, and
  `said()` / `anyAnswerMatches()` test each one separately. A multi-word trigger
  must now match inside a single hypothesis, which also stops phrases being
  stitched together across two of them.
- **The callback is `async`, so anything it throws disappears.** An unguarded
  `JSON.parse` of the hypothesis list turned a malformed native result into an
  unhandled rejection: the flow stopped, `listen()` was never called again, and
  the only symptom was a status bar reading `AV REJ:`. Everything reachable from
  `window.ankiSttResult` has to be defensive.
- **A successful recognition is not the same as a useful one.** Only *silent*
  windows used to count towards `maxListenTries`, so a room with a television in
  it produced an unbounded recognize-restart loop that also pinned the wake lock.
  Recognized-but-unmatched results now have their own counter
  (`maxNoMatchTries`).
- **The reviewer's stylesheet sets `user-select: none` on the card body** so that
  swipe gestures don't select text. Inherited into our settings panel, that
  appears to be what stops the on-screen keyboard opening for the word-list text
  fields (reported on-device; the inputs take focus but no IME appears). The
  panel now sets `-webkit-user-select: text` / `user-select: text` and
  `touch-action: manipulation` on its inputs and forces `focus()` on tap — but
  because that fix is unverified, the word lists are *also* fully editable
  without typing (tap a chip to remove a word, tap a `+ word` chip under "heard
  recently" to add one). The chip path is the supported one; the text field is a
  convenience where the keyboard does appear.

## Design choices that follow

- **Single file, fixed name (`_ankivoice.js`), loaded via a template snippet.**
  Fixed name ⇒ templates never change; single file ⇒ trivial install. Version in
  the header + `CHANGELOG.md`.
- **Deploy via desktop `collection.media` + sync.** apkg re-import renames a
  colliding media file instead of overwriting; the on-phone media folder is hard
  to reach. Desktop overwrite + sync updates the phone cleanly.
- **All injected UI uses `av-*` ids and is excluded from text extraction.** Early
  bug: the ⚙ gear (character U+2699, spoken "gear") and the hidden settings panel
  were being read aloud. `textWithBreaks` skips any `av-*` element.
- **Answer text = card lines minus question lines.** Handles layouts that put the
  answer above `<hr id="answer">` (e.g. Ultimate Geography); after-`<hr>` text is
  the fallback.
- **Editable per-command vocab + Voice test.** Since AnkiDroid's model can't be
  changed and mishears short words, each command has a full editable word list
  and a mode that surfaces the recognizer's raw hypotheses so users can add their
  device's spellings.
- **Line breaks become spoken pauses via punctuation.** Android TTS pauses on
  punctuation, not raw newlines; `<br>`/blocks are turned into newlines and each
  line is ended with a period.
- **Resuming is not the same as starting.** `startFlow(resume)` exists because
  tapping the bar to un-pause, or closing the settings panel, used to re-read the
  entire side from the top. With `resume` the side's text is still recomputed
  (`mainText` is needed for the "repeat" command) but nothing is spoken and the
  mic opens immediately.
- **Normalization folds accents rather than stripping non-ASCII.** The old
  `normalize()` reduced text to `[a-z0-9 ]`, which quietly deleted every
  non-Latin script and turned "café" into "caf". It now lowercases, applies
  NFKD and drops combining marks (so "cafe" still matches "café"), and strips
  only punctuation ranges. Command matching runs through it on both sides, so a
  hypothesis that comes back as "Hard." matches the vocabulary word "hard".
- **The spoken-answer length gate needs a voice.** `maxAnswerWords` is a crude
  noise filter: without it, any stray speech on the question side would reveal
  the card. But a rejection used to be completely silent — the flow just reopened
  the microphone — so a user watching Voice test would see their answer heard and
  then ignored, with no way to tell that a word count was the reason. It defaulted
  to 3, which is shorter than a great many real answers ("Harry Potter and the
  Goblet of Fire" is 7). v31 raised the default to 8, the ceiling to 20, and made
  a length-only rejection report itself on screen. `answerAttempts()` returns the
  rejected phrase alongside the accepted ones precisely so the UI can say why.
- **A page reload destroys the evidence.** The recognizer's output is shown on the
  question side, but showing the answer is a *new page* — so "Answer not
  recognized", spoken on the answer side, used to arrive with no way to see what
  had actually been misheard. The attempt already crossed the reload in
  `av_attempt` for matching; v31 also renders it (`you said: ...`) on arrival.
  That readout is forced visible even with Voice test off, because it exists to
  explain a message the user is hearing regardless.
- **Cookie budget is finite.** All the word lists share one ~4 KB cookie. Going
  over it used to fail silently and the settings reverted at the next app start
  (because `localStorage` dies with the port); `saveCfg()` now refuses and says
  so in the panel.

## Proposed upstream patch (fewer beeps, no getUserMedia needed)

In `JavaScriptSTT.kt`, add silence-length extras to the recognition intent and
destroy the previous recognizer:

```kotlin
speechRecognizer?.destroy()                    // stop leaking recognizers
speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context)
val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 30000)
intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000)
intent.putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 4000)
```

These extras are advisory (Google's recognizer may cap them) but honored on many
devices, and would make each listening window much longer → far fewer restarts →
far fewer beeps, all without touching the audio subsystem. A larger, separate
change would add `MODIFY_AUDIO_SETTINGS` + set the `AudioManager` mode to unlock
`getUserMedia` for a fully beep-free in-browser recognizer.

## Open threads

- Optional GitHub raw-URL loader (fetch remote, fall back to local) for
  auto-deploy-on-commit. CORS is already permissive; the fetch works. Not yet
  wired because desktop+sync covers updates.
- **Is `<script src="_ankivoice.js">` enough?** `loader.html` uses fetch+eval.
  A plain script tag should resolve against `loadDataWithBaseURL`'s base URL and
  would be simpler, but the fetch form is the one verified on-device and it
  reports load failures visibly. Untested, so unchanged.
- **Does this AnkiDroid build expose a recognition-language setter?** v29 calls
  `api.ankiSttSetLanguage(CFG.sttLang)` behind a `typeof === "function"` guard,
  inferred from `JavaScriptSTT` passing a `language` into `EXTRA_LANGUAGE`. If
  the method does not exist the call is skipped silently and recognition stays on
  the device default. Needs checking against the JS API version in use.
- **Compatibility baseline.** The code is written in ES5 *style* (`var`, function
  declarations, no arrow functions or optional chaining) but it does use
  `async`/`await`, `Promise`, `String.prototype.normalize`, `navigator.wakeLock`
  and CSS `inset`, so the real floor is roughly Chrome 87 / Android 10 System
  WebView. The style rule is about staying easy to read and easy to eval, not
  about supporting genuinely ancient WebViews.
- Per-side TTS language (e.g. English front, French back) — the API supports
  `ankiTtsSetLanguage`; would help language decks.
- File / champion the upstream `JavaScriptSTT` patch above.
