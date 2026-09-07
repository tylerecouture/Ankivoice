# AnkiVoice

[![CI](https://github.com/tylerecouture/Ankivoice/actions/workflows/ci.yml/badge.svg)](https://github.com/tylerecouture/Ankivoice/actions/workflows/ci.yml)

Hands-free plugin for **AnkiDroid**. It reads each card aloud, listens for
your voice, and lets you drive a whole review session without touching the phone:

1. The **question** is read aloud.
2. You say **"answer"** → the answer is read aloud.
3. You say a grade: **again / hard / good / easy** and it schedules the card, announces the next interval, and moves on.

Plus **skip**, **repeat**, **pause** (a timed think-break), **help**, and **off**.
It also keeps the screen awake while you're actively reviewing and lets it sleep
when you stop.

It's a single JavaScript file loaded from your card templates — **no add-on, no
separate app**. It runs entirely inside AnkiDroid's built-in JavaScript API.

> **AnkiDroid only.** The voice engine is AnkiDroid's JS API (TTS + speech
> recognition). On Anki Desktop / AnkiWeb the script detects that the API is
> absent and hides itself — it does nothing there. See the [FAQ](#faq--why-is-it-like-this).

---

## Download

Every version is published as a [GitHub release](https://github.com/tylerecouture/Ankivoice/releases/latest),
with two files attached:

| File | For |
|---|---|
| `_ankivoice.js` | the plugin itself — what you put in `collection.media` |
| `AnkiVoice-test.apkg` | a 3-card test deck with the script bundled, to try it on the phone |

Releases are built automatically whenever the version changes, so the assets
always match the source at that tag.

---

## Requirements

- **AnkiDroid 2.18+** (uses JS API contract 0.0.3).
- AnkiDroid granted the **Microphone** permission (Android app settings).
- AnkiDroid setting **Reviewing → "Show next review time above answer buttons"**
  turned on (that's the data the plugin reads to announce intervals).
- English cards by default. The spoken and recognition languages are both
  settings now (⚙ → *Speech language* / *Recognition language*), so a French deck
  can be read in French; whether the *recognition* language can be changed
  depends on your AnkiDroid build, and it falls back to the device default.

## Install

The plugin is one file, `_ankivoice.js`, plus a tiny loader in your templates.
The easiest path uses **Anki Desktop** once, then syncs to your phone.

1. **Drop the script into your media folder.** Put `_ankivoice.js` in your
   collection's `collection.media` folder. On Linux it's usually
   `~/.local/share/Anki2/<profile>/collection.media/` (or under
   `~/.var/app/net.ankiweb.Anki/...` for the Flatpak); on Windows,
   `%APPDATA%\Anki2\<profile>\collection.media\`. Keep the leading underscore in
   the filename — it stops Anki from treating the file as "unused" media.
2. **Add the loader to your note types.** For each note type you want voiced,
   open **Tools → Manage Note Types → Cards…** and paste the contents of
   [`loader.html`](loader.html) at the very bottom of **both** the Front and Back
   templates.
3. **Sync.** Sync the desktop, then sync AnkiDroid. Study a voiced deck on the
   phone — the bar appears at the bottom and it starts reading.

### Updating

Because the templates just reference `_ankivoice.js` by name, **you never edit
templates again**. To update: replace `_ankivoice.js` in `collection.media`
(overwrite it), then sync. Sync propagates the changed file to the phone.

> Prefer to test first? `demo/build_apkg.py` builds a small `.apkg` test deck
> (with the script bundled as media) that you can import on the phone. Every CI
> run also attaches a freshly built one under **Artifacts**.
>
> **Caveat if you already have AnkiVoice installed:** importing the deck will
> *not* replace your existing `_ankivoice.js`. Anki renames a colliding media
> file rather than overwriting it, so the templates keep loading the copy you
> already had and you end up testing the old script without noticing. The deck
> is for a *first* look; to update an existing install, replace the file on
> desktop and sync. Check which version is actually running by looking at the
> bar ("AnkiVoice v30") or the settings panel header.

## Voice commands

| Say | Does |
|---|---|
| **answer** (or show / reveal / flip) | reveal the answer |
| **again** (or wrong / no) | grade Again |
| **hard** | grade Hard |
| **good** (or yes / correct) | grade Good |
| **easy** | grade Easy |
| **skip** (or bury / pass) | bury the card (returns later) |
| **repeat** | re-read the current side |
| **pause** | mute the mic for a few seconds to think, then resume |
| **help** | re-read the available commands |
| **off** | turn the voice off until you tap the bar |
| **stop** (or quit / cancel) | pause listening until you tap the bar |

Every trigger word above is **editable in Settings** (see below).

## The bar and the settings

- The bottom **status bar** is also the on/off button — tap it to toggle the
  voice. It shows the current state ("Reading…", "Listening…", countdowns, the
  grade result, etc.).
- The **⚙ gear** on the far right opens the settings panel:
  - Timing (wait before the mic, "pause" length, retries before it auto-pauses),
    "keep screen awake", and other toggles.
  - **Editable trigger words per command**, as tappable chips. Tap a word to
    remove it; tap a **+ word** chip under *heard recently* to add something the
    recognizer just misheard. No typing required — the on-screen keyboard does
    not reliably open inside AnkiDroid's reviewer WebView. There is still a text
    field for where it does, and **Reset defaults** restores the built-in lists.
  - **Voice test** — shows the recognizer's raw guesses for whatever you say,
    while still reviewing normally.
  - **Speech / recognition language** for non-English decks.
  - **Announce next interval** — turn it off to grade faster (it skips
    "next review in four days" after each card).
  - **Unknown replies before pausing** — how much unrecognized speech to tolerate
    before the mic parks itself, so background noise can't loop it forever.
- Settings are **persistent** across app restarts (stored in a cookie — see the
  FAQ for why not `localStorage`).

### Self-tuning recognition

AnkiDroid's speech engine sometimes mishears short words (see FAQ). You can fix
this yourself without editing the script:

1. Settings → turn on **Voice test**.
2. Say the stubborn word (e.g. "hard"). Read the yellow readout — it lists what
   the engine actually heard (e.g. `heart | art | harv`).
3. Settings → find **Extra words → Hard**. The words it just heard are waiting
   there as **+ chips** — tap `+ harv` to add it. (Tap an existing word to
   remove it.)
4. Turn Voice test off. That word now works for your voice.

## Development

- The deployable artifact is the single file `_ankivoice.js`. The version lives
  in its header comment and in [`CHANGELOG.md`](CHANGELOG.md).
- **Tests:** two suites, no build step.
  - `node test/test.js` — pure functions (interval speech, line-break handling,
    answer extraction, command matching, normalization), run against the real
    source, plus a check that the version in the file header matches
    `CHANGELOG.md`. No dependencies.
  - `node test/smoke.js` — loads the *whole* plugin into a fake DOM with a fake
    AnkiDroid JS API and drives a review: reads a question, hears a mis-heard
    grade, reveals, grades, parks the mic on noise, edits settings by tapping
    chips. Needs jsdom (`npm install`), and skips cleanly if it isn't there.
  - `npm test` runs both plus `node --check`. CI runs both on every push, along
    with a demo-deck build.

  None of this can stand in for a device: the speech engine, the WebView quirks
  and the keyboard behaviour only exist on the phone. It catches regressions in
  the parts that *can* be reasoned about off-device.
- Coding style is intentionally conservative ES5-ish — it runs inside whatever
  Android System WebView the user has.
- See [`CLAUDE.md`](CLAUDE.md) for an architecture + context handoff (useful for
  an AI coding session), and [`docs/DECISIONS.md`](docs/DECISIONS.md) for the
  technical decision log.

## Repository layout

```
_ankivoice.js        the plugin (the file you deploy)
loader.html          the one-time <script> snippet for card templates
README.md            this file
CHANGELOG.md         version history (mirrors the file header)
CLAUDE.md            architecture + context handoff
docs/DECISIONS.md    why the code is shaped the way it is (technical)
demo/build_apkg.py   builds a test .apkg with the script bundled as media
test/test.js         pure-function test suite (no dependencies)
test/smoke.js        whole-plugin test against a fake DOM + fake JS API (jsdom)
package.json         dev tooling only - nothing is bundled or shipped
tools/               release-notes helper used by the release workflow
.github/workflows/   CI (checks + both suites + demo build) and Release
                     (publishes _ankivoice.js + the test deck on a version bump)
LICENSE              MIT
```

---

## FAQ — why is it like this?

This plugin looks the way it does because of hard constraints in how AnkiDroid
exposes speech to card JavaScript. If something feels like a workaround, it
probably is — here's the reasoning.

**Why does the microphone beep on and off while I review?**
The beeps are Google's. AnkiDroid's speech recognition is Android's stock
`SpeechRecognizer`, which is strictly *session-based*: it plays a start tone,
listens for one utterance, plays an end tone, returns one result. There is no
flag to disable those tones, and the mute-around-the-beep trick lives in native
app code we can't reach from a card. To listen "continuously," the only option
is to restart the recognizer over and over — and each restart is a beep. We
minimized the gap and added think-delays so it beeps less, but it can't be
silent with this engine.

**Then why not capture the raw microphone and do recognition in JavaScript
(which would be beep-free)?**
We tried. Raw capture needs `getUserMedia`, and in AnkiDroid's WebView it fails
with `NotReadableError: Could not start audio source` — even on a clean card with
nothing else using the mic. The cause is app-level: AnkiDroid's manifest doesn't
request `MODIFY_AUDIO_SETTINGS` and it never sets the `AudioManager` capture
mode, so Android refuses to hand the mic to the WebView even though it grants the
permission. Card JavaScript cannot change an app's manifest or audio mode, so
this path is closed without a change to AnkiDroid itself. (It's a known issue —
AnkiDroid #16319.)

**Why does the plugin sometimes re-read things, and why is state stored so
carefully?**
AnkiDroid renders every card side by fully reloading the WebView page
(`loadDataWithBaseURL`). Showing the answer is a *new page* with a *fresh
JavaScript context* — nothing in memory survives from the question side. So
anything that must persist across sides (which lines were on the question, your
settings) is written to storage and re-read, and the recognizer is re-initialized
each side. It's also why we're careful to stop the previous side's microphone
when a new one starts.

**Why does it mishear short words like "hard" or "answer" when my keyboard's
voice typing gets them instantly?**
AnkiDroid uses the generic recognizer in *free-form dictation* mode with no
tuning. Dictation models lean on sentence context to disambiguate, and a lone
one-syllable word gives them none — so "hard" often comes back as "heart"/"art"
and "answer" as "answers"/"anser". Your keyboard (Gboard) and other apps use
better, purpose-built models. We can't switch AnkiDroid's model from a card, so
instead every command has an **editable list of trigger words** plus a **Voice
test** mode: you can see exactly what your device hears and add those spellings.

**Why can't I type in the settings panel?**
The on-screen keyboard often doesn't open for text fields inside AnkiDroid's
reviewer WebView — the reviewer's own stylesheet disables text selection on the
card body so that swipes don't select text, and that appears to take the caret
with it. v29 overrides that on its own inputs, but rather than depend on a fix
that can't be verified off-device, the word lists are fully editable by tapping:
each word is a chip you tap to delete, and words the recognizer recently heard
show up as **+ chips** to add. That's the intended way to tune vocabulary; the
text field is a bonus where the keyboard cooperates.

**Why do settings live in a cookie instead of `localStorage`?**
AnkiDroid's internal media server binds a **random port each launch**, so the
card's origin is `http://127.0.0.1:<random>`. `localStorage` is keyed to that
origin, so it's effectively wiped on the next app start (different port).
Cookies are keyed to the **host** (`127.0.0.1`), not the port, and AnkiDroid
flushes them to disk — so cookie-stored settings survive restarts. We mirror to
`localStorage` too, but the cookie is what makes them persistent.

**Why is it one big file with a fixed name, instead of something modular?**
The card templates reference the file by name (`_ankivoice.js`). Keeping the name
fixed means the templates **never** need editing again — updates are just a file
swap. Keeping it a single file means "install" is "drop one file into
`collection.media`." The version is tracked in comments and `CHANGELOG.md`
instead of in the filename.

**Why the desktop + sync workflow instead of hosting the script on the web?**
Updating a *used* media file directly on the phone is awkward — AnkiDroid's
importer renames a colliding media file rather than overwriting it, and the media
folder is hard to reach on modern Android. On desktop, `collection.media` is a
normal folder you can overwrite freely, and **sync** correctly propagates the
changed file to the phone. (Fetching the script from a raw GitHub URL is
technically possible — the CORS headers allow it — and would enable
auto-deploy-on-commit; it just wasn't needed.)

**Why does the answer read "everything that wasn't on the question" instead of
just the text after `<hr id="answer">`?**
Note types disagree on layout. The standard one puts the answer after the
separator, but others (e.g. Ultimate Geography) put the key answer *above* it.
Reading "the card minus the question side" gets the right text for all of them,
with the after-`<hr>` text as a fallback.

**Why is "detect the spoken answer and auto-grade" turned off by default?**
Partly caution — stray sounds can trigger a false reveal — but mostly it was
broken. The recognizer returns several competing guesses, and until v29 they were
mashed into one string before being compared to the answer, which matched nothing
and also blew past the "max words" limit. It was switched off in v24 because it
"didn't work"; v29 fixed the underlying bug, so it's worth another try if the
idea appeals. Still off by default until it has real mileage on it.

**Could this be fixed properly?**
Two upstream changes to AnkiDroid would help a lot: (1) add silence-length extras
to the recognition intent so each listening window is longer (far fewer beeps),
and (2) request `MODIFY_AUDIO_SETTINGS` / set the audio mode so `getUserMedia`
works (which would unlock a fully beep-free in-browser recognizer). Both are
small, well-scoped patches to `JavaScriptSTT` / the manifest. See
[`docs/DECISIONS.md`](docs/DECISIONS.md).
