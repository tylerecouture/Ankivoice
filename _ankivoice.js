/* AnkiVoice - hands-free reviewing for AnkiDroid.

   FILE: _ankivoice.js  -- filename is STABLE; never rename it. To update, replace
   THIS FILE'S CONTENTS in collection.media (desktop) and sync. Versions below.

   VERSION: 31

   SETTINGS: see the CFG block below.

   CHANGELOG:
     v31 - spoken answers: the word limit that decides whether a phrase counts as
           an answer was 3, so anything longer ("the Half Blood Prince") was
           dropped in silence - it looked like the app heard you and ignored you.
           The default is now 8 (adjustable to 20), and a phrase dropped purely
           for length now says so on screen instead of nothing. On the answer
           side the bar now shows "you said: ...", because the question side's
           readout is destroyed by the page reload - so "Answer not recognized"
           no longer arrives with no clue what was misheard.
     v30 - the running version is now visible on the phone: the bar reads
           "AnkiVoice v30" before a card starts, the off state shows it, and the
           settings panel header carries it. Without this there was no way to
           tell which script was actually loaded - and importing the demo .apkg
           over an existing install does NOT replace _ankivoice.js (Anki renames
           the colliding media file), so the old one keeps running silently.
     v29 - fixes: "detect spoken answers" now tests each recognizer hypothesis
           separately (joining them made a word salad that matched nothing, and
           overshot the word limit - the feature never really worked); a bad
           result from the recognizer can no longer kill the flow silently;
           recognized-but-unknown replies now count towards the auto-pause, so a
           noisy room can't loop the mic forever; command matching ignores
           punctuation and folds accents. Tapping to un-pause, or closing the
           settings, now resumes listening instead of re-reading the whole card.
           Word lists are editable by tapping chips (no keyboard needed), with
           one-tap "heard recently" suggestions. New settings: speech/recognition
           language, announce-next-interval, unknown-replies-before-pausing. The
           bar no longer covers the bottom of a card.
     v28 - countdowns for delays >=1s show in the bar (reveal wait, "pause"); the
           per-command word fields now list the full default vocabulary (editable,
           reset restores it); voice test no longer blocks - it shows heard words
           while reviewing normally; settings button now says "Save".
     v27 - each command's trigger words are now editable in the settings ("Extra
           words -> Hard", etc.); your additions merge with the built-in list and
           persist, so recognition can be tuned without editing the script.
     v26 - settings now persist across app restarts (stored in a host-scoped
           cookie, not just localStorage, since AnkiDroid's server port changes
           each launch). New "Voice test" setting: shows the recognizer's full list
           of heard words (without acting) so mis-hears can be identified/added.
     v25 - fixed AnkiVoice's own UI being read aloud: the gear icon (spoken as
           "gear") and the hidden settings panel are now excluded from the card
           text, so a re-read no longer appends "gear" or reads the settings.
     v24 - spoken-answer auto-marking is now OFF by default (it was unreliable);
           still available as "Detect spoken answers" in the settings. With it
           off, stray sounds after the question no longer trigger a reveal.
     v23 - reveal ("answer") is now recognised from any word starting with "answ"
           (answer/answers/answered) plus phonetic variants, so it triggers on the
           first try instead of falling through to the answer-attempt path.
     v22 - more tolerant grade matching: accepts the recognizer's common mis-hears
           of "hard" (heart/hart/hardt/harder) and a few of the others, so short
           grade words don't need over-articulating.
     v21 - settings panel: a gear button on the far right of the bar opens an
           on-screen settings screen for all the CFG options; choices are saved
           (localStorage) and applied to the current card on close.
     v20 - halved the answer-side wait before the grade mic (250 ms); the question
           wait is kept at 3 s.
     v19 - stops reading/listening when Anki goes to
           the background (app switch); NEW: on the question side it also tries to
           recognise a spoken answer - a short phrase that matches the answer is
           confirmed ("Correct") and marked Good automatically; otherwise it says
           "Answer not recognized" and reads the answer for normal grading.
     v18 - says "Card buried" on skip; on the answer side always speaks a "Mark
           it" cue then waits markMicDelayMs before opening the mic (so the beep
           is distinct from the answer); pause-not-heard message now adds "tap the
           button to listen again"; says "There's nothing for me to read on this
           card." when a card has no readable text.
     v17 - new "off" voice command: turns the voice off (persists across cards)
           until you tap the bar to turn it back on - same as tapping off.
     v16 - on the answer side, the first-run prompt and "help" now describe ONLY
           the grading options (again/hard/good/easy), not the full command list.
     v15 - strict single-mic guard (never run two recognizers at once; stop any
           leftover mic when a new card starts) - fixes overlapping beeps; first
           card of a session now lists all voice commands; new commands: "pause"
           (mic off for CFG.pauseSeconds, then resume) and "help" (replay commands).
     v14 - no delay before the grade mic after the answer is read; when the mic
           auto-pauses after the listen window, it now says aloud that the
           command wasn't heard and the mic is paused.
     v13 - keeps the SCREEN ON while actively reading/listening (screen wake lock
           + muted looping video) and RELEASES it when it pauses, so the screen
           can still sleep if you stop answering. The bar now shows an action hint
           in every state ("tap to turn off" while active).
     v12 - answer = everything not already on the question side (handles Ultimate
           Geography etc.); quiet "thinking delay" before the mic opens.
     v11 - bottom bar is the on/off button (big/bold).
     v10 - <small> not spoken; line-break pauses; hides UI off-AnkiDroid.
     v5  - session prompts; speaks grade + next interval.
     v1  - read question; "answer" to reveal; read answer; grade by voice.

   USAGE: tap the bottom bar to turn voice ON/OFF (remembered, default ON).
   Screen stays awake only while a card is being read or the mic is listening; if
   you do not answer within the listening window it pauses and the screen may
   sleep normally.

   PLATFORM: needs AnkiDroid's JS API; on Desktop/AnkiWeb the bar hides itself. */
(function () {
  // Must match the VERSION in the header comment above; a test asserts they agree.
  // The point is to be able to tell, on the phone, which script is actually
  // running - media-name collisions make that genuinely ambiguous otherwise.
  var AV_VERSION = 31;

  // ---------------- settings ----------------
  var CFG = {
    thinkDelayQuestionMs: 3000, // quiet time after the question before the mic opens
    markMicDelayMs: 250,        // gap after the spoken "Mark it" cue before the grade mic
    restartGapMs: 150,          // pause between listening restarts after silence
    maxListenTries: 6,          // silent listen windows before auto-pausing (also
                                //   when the screen is allowed to sleep again)
    keepScreenAwake: true,      // hold a screen wake lock while actively reviewing
    pauseSeconds: 10,           // "pause" command: mic off this long, then resume
    detectAnswer: false,        // question side: also try to recognise a spoken answer (off by default)
    maxAnswerWords: 8,          // longest phrase that still counts as a spoken answer
    voiceTest: false,           // diagnostic: show what the recognizer heard, without acting on it
    maxNoMatchTries: 12,        // recognized-but-unmatched replies before auto-pausing (noise guard)
    announceInterval: true,     // speak the next review interval after grading
    ttsLang: "en-US",           // spoken language, BCP-47 (ankiTtsSetLanguage)
    sttLang: "en-US",           // recognition language, if this AnkiDroid build can set it
    ttsStartGraceMs: 900,       // how long to wait for TTS to report "speaking" (not in the panel)
    words_answer: "answer, answers, answered, anser, ansa, ansr, show, reveal, flip",
    words_again:  "again, agin, wrong, incorrect, forgot, missed, failed, fail, nope, no",
    words_hard:   "hard, harder, difficult, heart, hart, hardt",
    words_good:   "good, goods, correct, right, yes, yeah, yep, okay, ok, got it",
    words_easy:   "easy, simple, easey, eazy",
    words_skip:   "skip, bury, pass",
    words_pause:  "pause",
    words_help:   "help",
    words_off:    "off",
    words_stop:   "stop, quit, exit, cancel",
    words_repeat: "repeat"
  };
  var CFG_DEFAULTS = {}; for (var _dk in CFG) CFG_DEFAULTS[_dk] = CFG[_dk];
  try {
    var _raw = null;
    try { var _cm = document.cookie.match(/(?:^|; )av_cfg=([^;]*)/); if (_cm) _raw = decodeURIComponent(_cm[1]); } catch (_ce) {}
    if (!_raw) { try { _raw = localStorage.getItem("av_cfg"); } catch (_le) {} }
    var _sv = JSON.parse(_raw || "{}");
    for (var _sk in _sv) if (CFG.hasOwnProperty(_sk)) CFG[_sk] = _sv[_sk];
    for (var _wk in CFG_DEFAULTS) if (_wk.indexOf("words_") === 0 && !String(CFG[_wk] || "").trim()) CFG[_wk] = CFG_DEFAULTS[_wk];
  } catch (_e) {}
  // -------------------------------------------

  if (document.getElementById("av-root")) return;   // deduped per render (FrontSide)
  if (typeof window.__avGen !== "number") window.__avGen = 0;

  var stat = document.createElement("div");
  stat.id = "av-root";
  stat.style.cssText = "position:fixed;left:0;right:0;bottom:0;padding:12px 52px;" +
    "font-size:17px;font-weight:600;text-align:center;z-index:10000;" +
    "background:rgba(35,35,35,.94);color:#fff;pointer-events:auto;cursor:pointer;" +
    "user-select:none;-webkit-user-select:none;box-shadow:0 -1px 6px rgba(0,0,0,.4);";
  stat.textContent = "\uD83D\uDD0A  AnkiVoice v" + AV_VERSION;
  (document.body || document.documentElement).appendChild(stat);

  // Voice-test readout (shows what the recognizer heard); hidden unless enabled.
  var heardBar = document.createElement("div");
  heardBar.id = "av-heard";
  heardBar.style.cssText = "position:fixed;left:0;right:0;bottom:56px;padding:9px 12px;font-size:15px;" +
    "font-family:monospace;text-align:center;z-index:10000;background:rgba(150,110,0,.96);color:#fff;display:none;";
  (document.body || document.documentElement).appendChild(heardBar);
  // Normally the readout is a Voice-test-only diagnostic. force === true shows it
  // regardless, for messages the user would otherwise never see - notably what the
  // recognizer heard on the QUESTION side, which is gone by the time the answer
  // side renders (every card side is a full page reload).
  function showBar(txt, force) {
    if (!force && !CFG.voiceTest) { heardBar.style.display = "none"; return; }
    heardBar.style.display = "block";
    if (txt != null) heardBar.textContent = txt;
  }
  function showHeard(txt) { showBar(txt, false); }

  // The bar is position:fixed, so without this it sits on top of the last line of
  // a full-height card. Reserve its height at the bottom of the document instead.
  var padOwner = null;
  function reserveBarSpace() {
    try {
      var b = document.body;
      if (!b) return;
      var h = stat.offsetHeight || 52;
      padOwner = b;
      b.style.paddingBottom = (h + 8) + "px";
      heardBar.style.bottom = (h + 4) + "px";
    } catch (e) {}
  }
  function releaseBarSpace() { try { if (padOwner) padOwner.style.paddingBottom = ""; } catch (e) {} }
  reserveBarSpace();

  function on() { try { return localStorage.getItem("av_on") !== "0"; } catch (e) { return true; } }
  function S(m) { stat.textContent = (on() ? "\uD83D\uDD0A  " : "\uD83D\uDD07  ") + m; }
  function paintOff() { stat.style.display = ""; stat.textContent = "\uD83D\uDD07  Voice off (v" + AV_VERSION + ") \u2014 tap to turn on"; }

  window.addEventListener("error", function (e) { S("AV ERR: " + e.message + " ln" + e.lineno); });
  window.addEventListener("unhandledrejection", function (e) { S("AV REJ: " + e.reason); });

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function getCookie(n) { try { var m = document.cookie.match(new RegExp("(?:^|; )" + n + "=([^;]*)")); return m ? decodeURIComponent(m[1]) : null; } catch (e) { return null; } }
  function setCookie(n, v) { try { document.cookie = n + "=" + encodeURIComponent(v) + ";path=/;max-age=31536000"; } catch (e) {} }

  var api = null;
  var paused = false;

  // ---------------- keep screen awake (only while active) ----------------
  var wakeLock = null, awake = false, keepVid = null;
  function makeVid() {
    if (keepVid) return keepVid;
    var v = document.createElement("video");
    v.muted = true; v.defaultMuted = true; v.loop = true;
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    v.style.cssText = "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1;";
    var s1 = document.createElement("source"); s1.type = "video/webm"; s1.src = "data:video/webm;base64,GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAHnEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggEeTbuMU6uEHFO7a1OsggHR7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjAuMTYuMTAwV0GNTGF2ZjYwLjE2LjEwMESJiEBpAAAAAAAAFlSua8GuAQAAAAAAADjXgQFzxYh4cglXP5g/Y5yBACK1nIN1bmSIgQCGhVZfVlA5g4EBI+ODhAvrwgDgibCBQLqBQJqBAhJUw2dAgHNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjAuMTYuMTAwc3PaY8CLY8WIeHIJVz+YP2NnyKVFo4dFTkNPREVSRIeYTGF2YzYwLjMxLjEwMiBsaWJ2cHgtdnA5Z8ihRaOIRFVSQVRJT05Eh5MwMDowMDowMC4yMDAwMDAwMDAAH0O2dajngQCjo4EAAICCSYNCAAPwA/YAOCQcGEIAADBgAABnP///Wa8RO7MAHFO7a5G7j7OBALeK94EB8YIBpPCBAw==";
    var s2 = document.createElement("source"); s2.type = "video/mp4"; s2.src = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAMWbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAMgAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAkB0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAMgAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAEAAAABAAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAADIAAAAAAABAAAAAAG4bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAoAAAACABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABY21pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAASNzdGJsAAAAv3N0c2QAAAAAAAAAAQAAAK9hdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAEAAQABIAAAASAAAAAAAAAABFUxhdmM2MC4zMS4xMDIgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANWF2Y0MBZAAK/+EAGGdkAAqs2UQmwEQAAAMABAAAAwAoPEiWWAEABmjr48siwP34+AAAAAAQcGFzcAAAAAEAAAABAAAAFGJ0cnQAAAAAAABxcAAAcXAAAAAYc3R0cwAAAAAAAAABAAAAAQAACAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAEAAAABAAAAFHN0c3oAAAAAAAAC1gAAAAEAAAAUc3RjbwAAAAAAAAABAAADRgAAAGJ1ZHRhAAAAWm1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAALWlsc3QAAAAlqXRvbwAAAB1kYXRhAAAAAQAAAABMYXZmNjAuMTYuMTAwAAAACGZyZWUAAALebWRhdAAAAq0GBf//qdxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjQgcjMxMDggMzFlMTlmOSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjMgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0zIGRlYmxvY2s9MTowOjAgYW5hbHlzZT0weDM6MHgxMTMgbWU9aGV4IHN1Ym1lPTcgcHN5PTEgcHN5X3JkPTEuMDA6MC4wMCBtaXhlZF9yZWY9MSBtZV9yYW5nZT0xNiBjaHJvbWFfbWU9MSB0cmVsbGlzPTEgOHg4ZGN0PTEgY3FtPTAgZGVhZHpvbmU9MjEsMTEgZmFzdF9wc2tpcD0xIGNocm9tYV9xcF9vZmZzZXQ9LTIgdGhyZWFkcz0xIGxvb2thaGVhZF90aHJlYWRzPTEgc2xpY2VkX3RocmVhZHM9MCBucj0wIGRlY2ltYXRlPTEgaW50ZXJsYWNlZD0wIGJsdXJheV9jb21wYXQ9MCBjb25zdHJhaW5lZF9pbnRyYT0wIGJmcmFtZXM9MyBiX3B5cmFtaWQ9MiBiX2FkYXB0PTEgYl9iaWFzPTAgZGlyZWN0PTEgd2VpZ2h0Yj0xIG9wZW5fZ29wPTAgd2VpZ2h0cD0yIGtleWludD0yNTAga2V5aW50X21pbj01IHNjZW5lY3V0PTQwIGludHJhX3JlZnJlc2g9MCByY19sb29rYWhlYWQ9NDAgcmM9Y3JmIG1idHJlZT0xIGNyZj0yMy4wIHFjb21wPTAuNjAgcXBtaW49MCBxcG1heD02OSBxcHN0ZXA9NCBpcF9yYXRpbz0xLjQwIGFxPTE6MS4wMACAAAAAIWWIhAA///73aJ8Cm15hqoDklcUjrO6CviqTy2WCsRZdgQ==";
    v.appendChild(s1); v.appendChild(s2);
    (document.body || document.documentElement).appendChild(v);
    keepVid = v; return v;
  }
  async function keepAwake() {
    if (!CFG.keepScreenAwake) return;
    awake = true;
    try {
      if (navigator.wakeLock && !wakeLock) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", function () { wakeLock = null; });
      }
    } catch (e) { wakeLock = null; }
    try { var v = makeVid(); if (v.paused) { var p = v.play(); if (p && p.catch) p.catch(function () {}); } } catch (e) {}
  }
  function letSleep() {
    awake = false;
    try { if (wakeLock) { wakeLock.release(); wakeLock = null; } } catch (e) {}
    try { if (keepVid && !keepVid.paused) keepVid.pause(); } catch (e) {}
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      // Anki moved to the background (app switch) - stop reading/listening. The
      // native TTS/STT keep running otherwise, so stop them explicitly.
      window.__avGen++;
      try { if (api) api.ankiSttStop(); } catch (e) {}
      try { if (api) api.ankiTtsStop(); } catch (e) {}
      letSleep();
      paused = true;
      if (on()) { try { S("Paused (app in background) \u2014 tap to listen again"); } catch (e) {} }
    } else if (awake) {
      keepAwake();                                 // re-acquire wake lock after returning to view
    }
  });

  // ---------------- text extraction ----------------
  var AV_BLOCK = {
    DIV:1, P:1, LI:1, UL:1, OL:1, TR:1, TD:1, TH:1, TABLE:1, THEAD:1, TBODY:1,
    H1:1, H2:1, H3:1, H4:1, H5:1, H6:1, BLOCKQUOTE:1, PRE:1, HR:1,
    SECTION:1, ARTICLE:1, HEADER:1, FOOTER:1, DD:1, DT:1, FIGURE:1, FIGCAPTION:1
  };
  function textWithBreaks(root) {
    var out = "";
    (function walk(node) {
      for (var i = 0; i < node.childNodes.length; i++) {
        var c = node.childNodes[i];
        if (c.nodeType === 3) { out += c.nodeValue.replace(/[ \t\r\n\f\u00A0]+/g, " "); continue; }
        if (c.nodeType !== 1) continue;
        var tag = c.tagName;
        if (tag === "SMALL" || tag === "SCRIPT" || tag === "STYLE" || tag === "VIDEO" || (c.id && c.id.indexOf("av-") === 0)) continue;
        if (tag === "BR") { out += "\n"; continue; }
        var block = AV_BLOCK[tag];
        if (block) out += "\n";
        walk(c);
        if (block) out += "\n";
      }
    })(root);
    return out;
  }
  function extractLines(root) {
    var raw = textWithBreaks(root).split(/\r\n|\r|\n/), out = [];
    for (var i = 0; i < raw.length; i++) {
      var ln = raw[i].replace(/[ \t\u00A0\u2000-\u200A\u205F\u3000]+/g, " ").trim();
      if (ln) out.push(ln);
    }
    return out;
  }
  function speechJoin(lines) {
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      if (!/[.!?;:,\u2026]$/.test(ln)) ln += ".";
      out.push(ln);
    }
    return out.join(" ");
  }
  function subtractLines(all, front) {
    var pool = {};
    for (var i = 0; i < front.length; i++) { var k = front[i]; pool[k] = (pool[k] || 0) + 1; }
    var out = [];
    for (var j = 0; j < all.length; j++) {
      var L = all[j];
      if (pool[L] > 0) { pool[L]--; continue; }
      out.push(L);
    }
    return out;
  }
  function hrLines() {
    var hr = document.getElementById("answer");
    if (!hr) return [];
    var tmp = document.createElement("div"), n = hr.nextSibling;
    while (n) { tmp.appendChild(n.cloneNode(true)); n = n.nextSibling; }
    return extractLines(tmp);
  }

  // Punctuation only: ASCII symbols plus the common Unicode punctuation blocks.
  // Letters are deliberately NOT stripped, so non-English decks survive; accents
  // are folded (NFKD + drop combining marks) so "cafe" still matches "cafe" accented.
  var AV_PUNCT = /[!-\/:-@\[-`{-~\u00A1\u00BF\u2010-\u2027\u2030-\u205E\u3000-\u303F\uFF01-\uFF0F\uFF1A-\uFF20]+/g;
  function normalize(s) {
    s = String(s).toLowerCase();
    try { s = s.normalize("NFKD").replace(/[\u0300-\u036F]/g, ""); } catch (e) {}
    return s.replace(AV_PUNCT, " ").replace(/\s+/g, " ").trim();
  }
  // Conservative match: attempt equals an answer line, or is contained (whole
  // phrase) in a SHORT answer line - avoids false hits inside longer sentences.
  function answerMatches(attempt, answerLines) {
    var a = normalize(attempt);
    if (!a || a.length < 2) return false;
    for (var i = 0; i < answerLines.length; i++) {
      var ln = normalize(answerLines[i]);
      if (!ln) continue;
      if (ln === a) return true;
      if (ln.split(" ").length <= 4 && (" " + ln + " ").indexOf(" " + a + " ") >= 0) return true;
    }
    return false;
  }
  // The recognizer hands back a LIST of competing hypotheses ("bamako", "bam ako",
  // "bamboo"). Each has to be tested on its own: concatenating them makes a word
  // salad that matches no answer line and blows straight past the word-count gate,
  // which is what made "detect spoken answers" look broken before v29.
  function anyAnswerMatches(attempts, answerLines) {
    for (var i = 0; i < attempts.length; i++) if (answerMatches(attempts[i], answerLines)) return true;
    return false;
  }
  function isArr(v) { return Object.prototype.toString.call(v) === "[object Array]"; }
  // Split the recognizer's hypotheses into those short enough to count as a spoken
  // answer, and the longest one rejected purely for length - so the UI can say why
  // nothing happened instead of silently listening again.
  function answerAttempts(hyps, maxWords) {
    var out = { attempts: [], tooLongText: "", tooLongWords: 0 };
    for (var i = 0; i < hyps.length; i++) {
      var norm = normalize(hyps[i]);
      if (!norm) continue;
      var wc = norm.split(" ").length;
      if (wc <= maxWords) out.attempts.push(norm);
      else if (wc > out.tooLongWords) { out.tooLongWords = wc; out.tooLongText = norm; }
    }
    return out;
  }
  // Recently heard words, kept so the settings panel can offer one-tap "add this
  // mis-hear" chips - typing into the panel is unreliable in AnkiDroid's WebView.
  function recentHeard() {
    try { var a = JSON.parse(lsGet("av_heard_recent") || "[]"); if (isArr(a)) return a; } catch (e) {}
    return [];
  }
  function rememberHeard(hyps) {
    try {
      var pool = [], i, j;
      for (i = 0; i < hyps.length; i++) {
        var parts = normalize(hyps[i]).split(" ");
        for (j = 0; j < parts.length; j++) if (parts[j]) pool.push(parts[j]);
      }
      var prev = recentHeard();
      for (i = 0; i < prev.length; i++) pool.push(prev[i]);
      var seen = {}, keep = [];
      for (i = 0; i < pool.length && keep.length < 24; i++) {
        if (pool[i] && !seen[pool[i]]) { seen[pool[i]] = 1; keep.push(pool[i]); }
      }
      lsSet("av_heard_recent", JSON.stringify(keep));
    } catch (e) {}
  }
  function readAttempts() {
    var raw = lsGet("av_attempt") || "";
    if (!raw) return [];
    try { var a = JSON.parse(raw); if (isArr(a)) return a; } catch (e) {}
    return [raw];                                  // legacy pre-v29 single-string value
  }

  // ---------------- interval -> speech ----------------
  var AV_UNITS = {
    s: "second", sec: "second", secs: "second",
    m: "minute", min: "minute", mins: "minute",
    h: "hour", hr: "hour", hrs: "hour", hour: "hour",
    d: "day", dy: "day", day: "day", days: "day",
    w: "week", wk: "week", wks: "week", week: "week",
    mo: "month", mon: "month", mth: "month", mths: "month", month: "month",
    y: "year", yr: "year", yrs: "year", year: "year"
  };
  function expandIvl(s) {
    if (s == null) return "";
    s = String(s);
    try { s = s.normalize("NFKC"); } catch (e) {}
    s = s.replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF\u00AD]/g, "");
    s = s.replace(/[\u00A0\u2000-\u200A\u205F\u3000]/g, " ");
    s = s.trim().replace(/^["']+|["']+$/g, "").trim();
    if (!s) return "";
    var approx = /[<~\u2248\u2264]/.test(s);
    s = s.replace(/[<~\u2248\u2264]/g, " ");
    s = s.replace(/(\d+(?:[.,]\d+)?)[^0-9A-Za-z]*([A-Za-z]+)/g, function (m0, num, unit) {
      var word = AV_UNITS[unit.toLowerCase()];
      if (!word) return num + " " + unit;
      var val = parseFloat(num.replace(",", "."));
      if (!isNaN(val) && val !== 1) word += "s";
      return num + " " + word;
    });
    s = s.replace(/([A-Za-z])(\d)/g, "$1 $2");
    s = s.replace(/\s+/g, " ").trim();
    return (approx ? "less than " : "") + s;
  }
  function unwrapValue(r) {
    if (r == null) return "";
    if (typeof r === "object") return r.value || "";
    var s = String(r);
    try { var o = JSON.parse(s); if (o && typeof o === "object" && "value" in o) return o.value; } catch (e) {}
    return s;
  }
  async function nextTimeFor(ease) {
    try {
      var r;
      if (ease === 1) r = await api.ankiGetNextTime1();
      else if (ease === 2) r = await api.ankiGetNextTime2();
      else if (ease === 3) r = await api.ankiGetNextTime3();
      else r = await api.ankiGetNextTime4();
      return unwrapValue(r);
    } catch (e) { return ""; }
  }

  function commandsText(onAns) {
    if (onAns) return "Mark it: again, hard, good, or easy.";
    return "Voice commands. Say answer, to reveal the answer." +
      (CFG.detectAnswer ? " Or just say the answer itself, and if it's right I'll mark it good." : "") +
      " Say skip, to bury the card and come back to it later." +
      " Say pause, to pause the microphone for " + CFG.pauseSeconds + " seconds while you think." +
      " Say off, to turn the voice off until you tap the bar." +
      " Say help, to hear these commands again.";
  }

  // A command triggers if the heard text contains any word from its editable list
  // (CFG.words_<cmd>, seeded with defaults above and adjustable/resettable in Settings).
  function said(heard, key) {
    var hyps = (Object.prototype.toString.call(heard) === "[object Array]") ? heard : [heard];
    var list = String(CFG["words_" + key] || "").split(",");
    for (var i = 0; i < hyps.length; i++) {
      var h = " " + normalize(hyps[i]) + " ";     // punctuation-tolerant on both sides
      for (var j = 0; j < list.length; j++) {
        var w = normalize(list[j]);
        if (w && h.indexOf(" " + w + " ") >= 0) return true;
      }
    }
    return false;
  }

  // ---------------- per-card flow ----------------
  // resume === true: the current side has already been read aloud (the user tapped
  // to un-pause, or closed the settings panel), so go straight to the microphone
  // instead of reading the whole card again.
  function startFlow(resume) {
    paused = false;
    var myGen = ++window.__avGen;
    function dead() { return myGen !== window.__avGen; }
    var mainText = "", onAnswer = false, tries = 0, noMatch = 0, listening = false;

    try { if (api) api.ankiSttStop(); } catch (e) {}   // stop any mic left over from a previous flow

    function listen() {
      if (dead()) return;
      if (listening) return;                            // never run two recognizers at once
      listening = true;
      keepAwake();
      S("Listening\u2026 \u2014 tap to turn off");
      try { api.ankiSttStart(); } catch (e) { listening = false; }
    }

    async function countdown(ms, label) {                // show N, N-1, ... in the bar
      var whole = Math.floor(ms / 1000), rem = ms - whole * 1000;
      if (rem > 0) { if (dead()) return false; S(label + " " + (whole + 1) + "\u2026 \u2014 tap to turn off"); await sleep(rem); }
      for (var i = whole; i >= 1; i--) {
        if (dead()) return false;
        S(label + " " + i + "\u2026 \u2014 tap to turn off");
        await sleep(1000);
      }
      return !dead();
    }

    async function speak(text) {
      if (!text) return;
      try {
        await api.ankiTtsSpeak(text);
        // Poll straight away rather than sleeping a flat 700ms per utterance, but
        // allow a grace window for TTS to report "speaking" before giving up, and
        // keep polling as long as it is speaking (a long answer used to fall
        // through the old 60s cap and open the mic over its own voice).
        var t0 = Date.now(), started = false;
        while (!dead()) {
          var speaking = String(unwrapValue(await api.ankiTtsIsSpeaking())) === "true";
          if (speaking) started = true;
          else if (started || (Date.now() - t0) > CFG.ttsStartGraceMs) break;
          if ((Date.now() - t0) > 600000) break;             // hard stop; never hang
          await sleep(120);
        }
      } catch (e) { S("AV tts err: " + e); }
    }

    async function pauseMic(kind) {
      paused = true; letSleep();
      S("Paused \u2014 tap to listen again");
      var why = (kind === "noise")
        ? "I keep hearing words I don't know."
        : (onAnswer ? "Grade not heard." : "Answer command not heard.");
      await speak(why + " Microphone paused. Tap the button to listen again.");
    }

    async function grade(ease, label) {
      var spoken = "";
      if (CFG.announceInterval) {
        var ivl = await nextTimeFor(ease);
        if (dead()) return;
        spoken = ivl ? expandIvl(ivl) : "";
      }
      var phrase = "Marked " + label + (spoken ? ", next review in " + spoken : "");
      S("\u2713 " + label + (spoken ? " \u2192 " + spoken : ""));
      await speak(phrase);
      if (dead()) return;
      if (ease === 1) api.ankiAnswerEase1();
      else if (ease === 2) api.ankiAnswerEase2();
      else if (ease === 3) api.ankiAnswerEase3();
      else api.ankiAnswerEase4();
    }

    window.ankiSttResult = async function (raw) {
      if (dead()) return;
      if (!listening) return;                           // ignore stale / duplicate callbacks
      listening = false;                                // this mic session has ended
      var res;
      try { res = JSON.parse(raw); } catch (e) { res = { success: false, value: String(raw) }; }
      if (!res.success) {
        if (/permission/i.test(res.value)) {
          S("\u26A0 Grant AnkiDroid the Microphone permission");
          await speak("Microphone permission is missing.");
          return;
        }
        if (++tries >= CFG.maxListenTries) return pauseMic("silence");
        await sleep(CFG.restartGapMs);
        return listen();
      }
      tries = 0;
      // res.value is a JSON array of competing hypotheses, produced by native code
      // we don't control. An exception here becomes an unhandled rejection, which
      // kills the flow silently and never reopens the mic - so never let it throw.
      var hyps;
      try { hyps = JSON.parse(res.value); } catch (e) { hyps = [String(res.value == null ? "" : res.value)]; }
      if (!isArr(hyps)) hyps = [String(hyps == null ? "" : hyps)];
      rememberHeard(hyps);
      if (CFG.voiceTest) showHeard("heard:  " + hyps.join("   |   "));   // show, but keep working normally
      S("heard: " + (hyps[0] || ""));   // full list goes to the voice-test bar
      var matched = function (key) { if (!said(hyps, key)) return false; noMatch = 0; return true; };
      if (matched("stop")) { paused = true; letSleep(); S("Paused \u2014 tap to listen again"); return; }
      if (matched("off")) { lsSet("av_on", "0"); stopFlow(); paintOff(); try { if (api) api.ankiTtsSpeak("Voice off."); } catch (e) {} return; }
      if (matched("help")) { await speak(commandsText(onAnswer)); if (dead()) return; return listen(); }
      if (matched("pause")) {
        if (!(await countdown(CFG.pauseSeconds * 1000, "Resuming in"))) return;
        return listen();
      }
      if (matched("repeat")) { await speak(mainText); if (dead()) return; return listen(); }
      if (matched("skip")) { S("Card buried"); await speak("Card buried."); if (dead()) return; api.ankiBuryCard(); return; }
      if (!onAnswer) {
        if (matched("answer")) { api.ankiShowAnswer(); return; }
        if (CFG.detectAnswer) {
          // Gate on EACH hypothesis, not on all of them joined: five alternatives
          // for a one-word answer used to count as five words and fail the gate.
          var att = answerAttempts(hyps, CFG.maxAnswerWords);
          if (att.attempts.length) {
            noMatch = 0;
            lsSet("av_attempt", JSON.stringify(att.attempts));
            S("Checking your answer\u2026");
            api.ankiShowAnswer();
            return;
          }
          if (att.tooLongWords) {
            // Heard clearly, dropped only for length. Saying so beats appearing to
            // ignore the user, which is what this used to do.
            showBar("too long for an answer: \"" + att.tooLongText + "\" (" +
                    att.tooLongWords + " words, max " + CFG.maxAnswerWords + ")", true);
          }
        }
      } else {
        // Grade words are only matched on the answer side, so these homophones are
        // safe: they're what the recognizer tends to hear for the intended grade.
        if (matched("easy")) return grade(4, "easy");
        if (matched("hard")) return grade(2, "hard");
        if (matched("again")) return grade(1, "again");
        if (matched("good")) return grade(3, "good");
      }
      // Heard something, recognised nothing. A television or a conversation in the
      // room produces these indefinitely, so they must count towards the auto-pause
      // as well - otherwise the mic restart loop (and the wake lock) runs forever.
      if (++noMatch >= CFG.maxNoMatchTries) return pauseMic("noise");
      await sleep(CFG.restartGapMs);
      listen();
    };

    (async function () {
      try {
        keepAwake();
        var d = await api.ankiIsDisplayingAnswer();
        onAnswer = String(unwrapValue(d)) === "true";
        if (dead()) return;
        try { await api.ankiTtsSetLanguage(CFG.ttsLang || "en-US"); } catch (e) {}
        // Not in every AnkiDroid build; harmless where it is missing.
        try {
          if (typeof api.ankiSttSetLanguage === "function") await api.ankiSttSetLanguage(CFG.sttLang || CFG.ttsLang || "en-US");
        } catch (e) {}
        if (!resume) S("Reading\u2026 \u2014 tap to turn off");
        if (CFG.voiceTest) showHeard("Voice test on \u2014 say a word to see what's heard");

        var thinkMs;
        if (!onAnswer) {
          var qLines = extractLines(document.body);
          lsSet("av_qlines", JSON.stringify(qLines));
          mainText = speechJoin(qLines).replace(/\[\.\.\.\]/g, ", blank,") || "There's nothing for me to read on this card.";
          if (resume) {
            thinkMs = 0;                        // already read; go straight to the mic
          } else {
            lsSet("av_attempt", "");            // clear any stale answer attempt
            var qDone = lsGet("av_qdone") === "1";
            lsSet("av_qdone", "1");
            await speak(mainText + (qDone ? "" : " . . . " + commandsText(false)));
            thinkMs = CFG.thinkDelayQuestionMs;
          }
        } else {
          var allLines = extractLines(document.body);
          var ql = [];
          try { ql = JSON.parse(lsGet("av_qlines") || "[]"); } catch (e) {}
          var ansLines = subtractLines(allLines, ql);
          if (!ansLines.length) ansLines = hrLines();
          if (!ansLines.length) ansLines = allLines;
          mainText = speechJoin(ansLines) || "There's nothing for me to read on this card.";

          if (resume) {
            thinkMs = 0;                        // already read; go straight to the mic
          } else {
            var attempts = readAttempts();
            lsSet("av_attempt", "");
            // The question side's readout died with the page reload, so "Answer not
            // recognized" would otherwise arrive with no clue what was misheard.
            if (attempts.length) showBar("you said: " + attempts.join("   |   "), true);
            if (CFG.detectAnswer && attempts.length && anyAnswerMatches(attempts, ansLines)) {
              await speak("Correct.");
              if (dead()) return;
              api.ankiAnswerEase3();                              // recognised -> Good, skip grading
              return;
            }

            var aDone = lsGet("av_adone") === "1";
            lsSet("av_adone", "1");
            if (CFG.detectAnswer && attempts.length) {
              await speak("Answer not recognized.");              // attempted but no match
              if (dead()) return;
            }
            await speak(mainText);                                // read the answer
            if (dead()) return;
            await speak(aDone ? "Mark it." : commandsText(true)); // distinct grade cue
            thinkMs = CFG.markMicDelayMs;
          }
        }
        if (dead()) return;
        if (thinkMs >= 1000) {
          if (!(await countdown(thinkMs, "Get ready"))) return;
        } else if (thinkMs > 0) {
          S("Get ready\u2026 \u2014 tap to turn off");
          await sleep(thinkMs);
          if (dead()) return;
        }
        listen();
      } catch (e) { S("AV CAUGHT: " + e); }
    })();
  }

  function stopFlow() {
    window.__avGen++;
    letSleep();
    try { if (api) api.ankiSttStop(); } catch (e) {}
    try { if (api) api.ankiTtsStop(); } catch (e) {}
  }

  function onTap(e) {
    if (e) { try { e.stopPropagation(); e.preventDefault(); } catch (x) {} }
    if (!api) return;
    if (!on()) { lsSet("av_on", "1"); startFlow(); }
    else if (paused) { startFlow(true); }   // resume listening, don't re-read the card
    else { lsSet("av_on", "0"); stopFlow(); paintOff(); }
  }
  stat.addEventListener("click", onTap);
  stat.addEventListener("touchstart", function (e) { try { e.stopPropagation(); } catch (x) {} }, { passive: true });

  var nowTs = Date.now();
  var lastTs = parseInt(lsGet("av_ts") || "0", 10);
  if (!lastTs || (nowTs - lastTs) > 300000) { lsSet("av_qdone", ""); lsSet("av_adone", ""); }
  lsSet("av_ts", String(nowTs));

  // ---------------- settings panel (gear on the far right) ----------------
  var AV_SETTINGS = [
    { k: "detectAnswer",        label: "Detect spoken answers",       type: "bool" },
    { k: "keepScreenAwake",     label: "Keep screen awake",           type: "bool" },
    { k: "thinkDelayQuestionMs", label: "Pause before answer mic",    type: "num", min: 0, max: 10000, step: 250, unit: "ms" },
    { k: "markMicDelayMs",      label: "Pause before grade mic",      type: "num", min: 0, max: 3000,  step: 50,  unit: "ms" },
    { k: "pauseSeconds",        label: "'Pause' command length",      type: "num", min: 2, max: 60,    step: 1,   unit: "s" },
    { k: "maxListenTries",      label: "Retries before pausing",      type: "num", min: 1, max: 20,    step: 1,   unit: "" },
    { k: "maxAnswerWords",      label: "Max words for answer match",  type: "num", min: 1, max: 20,    step: 1,   unit: "" },
    { k: "restartGapMs",        label: "Mic restart gap",             type: "num", min: 0, max: 1000,  step: 50,  unit: "ms" },
    { k: "voiceTest",           label: "Voice test (show heard words)", type: "bool" },
    { k: "announceInterval",    label: "Announce next interval",       type: "bool" },
    { k: "maxNoMatchTries",     label: "Unknown replies before pausing", type: "num", min: 2, max: 40, step: 1, unit: "" },
    { k: "ttsLang",  label: "Speech language", type: "text", ph: "e.g. en-US, fr-FR, de-DE" },
    { k: "sttLang",  label: "Recognition language", type: "text", ph: "e.g. en-US (ignored if unsupported)" },
    { k: "words_answer", label: "Extra words \u2192 Answer", type: "words" },
    { k: "words_again",  label: "Extra words \u2192 Again",  type: "words" },
    { k: "words_hard",   label: "Extra words \u2192 Hard",   type: "words" },
    { k: "words_good",   label: "Extra words \u2192 Good",   type: "words" },
    { k: "words_easy",   label: "Extra words \u2192 Easy",   type: "words" },
    { k: "words_skip",   label: "Extra words \u2192 Skip",   type: "words" },
    { k: "words_pause",  label: "Extra words \u2192 Pause",  type: "words" },
    { k: "words_help",   label: "Extra words \u2192 Help",   type: "words" },
    { k: "words_off",    label: "Extra words \u2192 Off",    type: "words" },
    { k: "words_stop",   label: "Extra words \u2192 Stop",   type: "words" },
    { k: "words_repeat", label: "Extra words \u2192 Repeat", type: "words" }
  ];
  var panel = null, refreshers = [], panelNote = null;
  var AV_COOKIE_MAX = 3800;      // real limit is ~4096 bytes per cookie; leave headroom
  function setNote(msg) {
    if (!panelNote) return;
    panelNote.textContent = msg || "";
    panelNote.style.display = msg ? "block" : "none";
  }
  function cfgJson() {
    var out = {};
    for (var i = 0; i < AV_SETTINGS.length; i++) out[AV_SETTINGS[i].k] = CFG[AV_SETTINGS[i].k];
    return JSON.stringify(out);
  }
  // Silently overflowing the cookie means the settings quietly revert on the next
  // app start (localStorage dies with the port), so say so instead. Checked when the
  // panel opens as well as on every edit, because the stored config may already have
  // been too big before this page loaded.
  function checkCfgSize() {
    if (encodeURIComponent(cfgJson()).length > AV_COOKIE_MAX) {
      setNote("\u26A0 These settings are too long to store permanently. Shorten a word " +
              "list, or they will be lost when AnkiDroid restarts.");
      return false;
    }
    setNote("");
    return true;
  }
  function saveCfg() {
    var json = cfgJson();
    lsSet("av_cfg", json);
    if (!checkCfgSize()) return false;
    setCookie("av_cfg", json);   // host-scoped + flushed to disk -> survives app restarts
    return true;
  }
  // Word lists are edited as chips as well as text, because the on-screen keyboard
  // does not reliably open for inputs inside AnkiDroid's reviewer WebView.
  function wordList(key) {
    var raw = String(CFG[key] || "").split(","), out = [];
    for (var i = 0; i < raw.length; i++) { var w = raw[i].trim(); if (w) out.push(w); }
    return out;
  }
  function setWordList(key, arr) { CFG[key] = arr.join(", "); }
  function hasWord(key, w) {
    var l = wordList(key), n = normalize(w);
    for (var i = 0; i < l.length; i++) if (normalize(l[i]) === n) return true;
    return false;
  }
  function mkChip(txt, css) {
    var c = document.createElement("span");
    c.textContent = txt;
    c.style.cssText = "display:inline-block;padding:8px 11px;border-radius:15px;font-size:14px;" +
      "line-height:1;cursor:pointer;user-select:none;-webkit-user-select:none;" + css;
    return c;
  }
  function resetCfg() {
    for (var k in CFG_DEFAULTS) CFG[k] = CFG_DEFAULTS[k];
    saveCfg();
    for (var i = 0; i < refreshers.length; i++) refreshers[i]();
  }
  function mkBtn(txt, css) { var b = document.createElement("button"); b.textContent = txt; b.style.cssText = css; return b; }
  function buildPanel() {
    if (panel) return panel;
    var ov = document.createElement("div");
    ov.id = "av-settings";
    ov.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:100000;display:none;overflow:auto;padding:16px;box-sizing:border-box;";
    var box = document.createElement("div");
    box.style.cssText = "max-width:520px;margin:0 auto;background:#1e1e1e;color:#fff;border-radius:12px;padding:16px;";
    var h = document.createElement("div"); h.textContent = "AnkiVoice settings \u00B7 v" + AV_VERSION;
    h.style.cssText = "font-size:20px;font-weight:700;margin-bottom:8px;text-align:center;";
    box.appendChild(h);
    var hint = document.createElement("div");
    hint.textContent = "Tap a word to remove it. Turn on Voice test, say the stubborn " +
      "word, then come back here and tap it under \u201Cheard recently\u201D to add it \u2014 no typing needed.";
    hint.style.cssText = "font-size:13px;opacity:.65;line-height:1.45;margin-bottom:6px;text-align:center;";
    box.appendChild(hint);
    panelNote = document.createElement("div");
    panelNote.id = "av-note";
    panelNote.style.cssText = "display:none;margin:8px 0;padding:10px;border-radius:8px;" +
      "background:#5d4037;color:#fff;font-size:14px;line-height:1.4;";
    box.appendChild(panelNote);
    AV_SETTINGS.forEach(function (s) {
      var isWords = (s.type === "words" || s.type === "text");
      var row = document.createElement("div");
      row.style.cssText = "display:flex;gap:10px;padding:11px 0;border-top:1px solid #333;font-size:16px;" +
        (isWords ? "flex-direction:column;align-items:stretch;" : "align-items:center;justify-content:space-between;");
      var lab = document.createElement("div"); lab.textContent = s.label; lab.style.cssText = isWords ? "opacity:.85;" : "flex:1;";
      row.appendChild(lab);
      if (isWords) {
        var inp = document.createElement("input");
        inp.type = "text"; inp.value = CFG[s.k] || "";
        inp.setAttribute("placeholder", s.ph || "comma-separated words");
        inp.setAttribute("autocapitalize", "none"); inp.setAttribute("autocomplete", "off"); inp.setAttribute("spellcheck", "false");
        // AnkiDroid's reviewer stylesheet sets user-select:none on the card body to
        // keep swipe gestures from selecting text; inherited, that stops the caret
        // (and therefore the keyboard) in our own inputs. Opt back in explicitly.
        inp.style.cssText = "padding:12px;border-radius:8px;border:1px solid #555;background:#2a2a2a;" +
          "color:#fff;font-size:16px;-webkit-user-select:text;user-select:text;" +
          "-webkit-touch-callout:default;touch-action:manipulation;";
        var focusIt = function () { try { inp.focus(); if (inp.setSelectionRange) inp.setSelectionRange(inp.value.length, inp.value.length); } catch (x) {} };
        inp.oninput = (function (el, key) { return function () { CFG[key] = el.value; saveCfg(); if (el.__chips) el.__chips(); }; })(inp, s.k);
        inp.addEventListener("click", function (e) { e.stopPropagation(); focusIt(); });
        inp.addEventListener("touchend", function (e) { e.stopPropagation(); focusIt(); });
        inp.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });

        if (s.type === "text") {                       // plain field, no vocabulary chips
          var pT = (function (el, key) { return function () { el.value = CFG[key] || ""; }; })(inp, s.k);
          refreshers.push(pT); row.appendChild(inp); box.appendChild(row); return;
        }

        var chipsOn = document.createElement("div");
        chipsOn.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;";
        var chipsAdd = document.createElement("div");
        chipsAdd.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;align-items:center;";
        var renderChips = (function (key) {
          return function () {
            chipsOn.textContent = ""; chipsAdd.textContent = "";
            var cur = wordList(key), i;
            for (i = 0; i < cur.length; i++) {
              (function (word) {
                var c = mkChip(word + "  \u00D7", "background:#37474f;color:#fff;");
                c.onclick = function (e) {
                  e.stopPropagation();
                  var l = wordList(key), keep = [], j;
                  for (j = 0; j < l.length; j++) if (l[j] !== word) keep.push(l[j]);
                  setWordList(key, keep); saveCfg(); renderChips(); inp.value = CFG[key] || "";
                };
                chipsOn.appendChild(c);
              })(cur[i]);
            }
            var recent = recentHeard(), shown = 0;
            for (i = 0; i < recent.length && shown < 10; i++) {
              if (hasWord(key, recent[i])) continue;
              shown++;
              (function (word) {
                var c = mkChip("+ " + word, "background:#1565c0;color:#fff;");
                c.onclick = function (e) {
                  e.stopPropagation();
                  var l = wordList(key); l.push(word);
                  setWordList(key, l); saveCfg(); renderChips(); inp.value = CFG[key] || "";
                };
                chipsAdd.appendChild(c);
              })(recent[i]);
            }
            if (shown) {
              var lbl = document.createElement("span");
              lbl.textContent = "heard recently:";
              lbl.style.cssText = "opacity:.6;font-size:13px;margin-right:2px;";
              chipsAdd.insertBefore(lbl, chipsAdd.firstChild);
            }
          };
        })(s.k);
        inp.__chips = renderChips;
        var pW = (function (el, key) { return function () { el.value = CFG[key] || ""; renderChips(); }; })(inp, s.k);
        renderChips();
        refreshers.push(pW);
        row.appendChild(chipsOn); row.appendChild(chipsAdd); row.appendChild(inp);
        box.appendChild(row); return;
      }
      if (s.type === "bool") {
        var tb = mkBtn("", "min-width:66px;padding:9px 12px;border:none;border-radius:8px;color:#fff;font-size:16px;font-weight:600;");
        var pB = function () { tb.textContent = CFG[s.k] ? "On" : "Off"; tb.style.background = CFG[s.k] ? "#2e7d32" : "#555"; };
        tb.onclick = function (e) { e.stopPropagation(); CFG[s.k] = !CFG[s.k]; pB(); saveCfg(); };
        pB(); refreshers.push(pB); row.appendChild(tb);
      } else {
        var wrap = document.createElement("div"); wrap.style.cssText = "display:flex;align-items:center;gap:8px;";
        var mn = mkBtn("\u2212", "width:42px;height:42px;border:none;border-radius:8px;background:#444;color:#fff;font-size:22px;line-height:1;");
        var vv = document.createElement("div"); vv.style.cssText = "min-width:82px;text-align:center;font-variant-numeric:tabular-nums;";
        var pl = mkBtn("+", "width:42px;height:42px;border:none;border-radius:8px;background:#444;color:#fff;font-size:22px;line-height:1;");
        var pV = function () { vv.textContent = CFG[s.k] + (s.unit ? " " + s.unit : ""); };
        var clamp = function (v) { return Math.max(s.min, Math.min(s.max, v)); };
        mn.onclick = function (e) { e.stopPropagation(); CFG[s.k] = clamp(CFG[s.k] - s.step); pV(); saveCfg(); };
        pl.onclick = function (e) { e.stopPropagation(); CFG[s.k] = clamp(CFG[s.k] + s.step); pV(); saveCfg(); };
        pV(); refreshers.push(pV);
        wrap.appendChild(mn); wrap.appendChild(vv); wrap.appendChild(pl); row.appendChild(wrap);
      }
      box.appendChild(row);
    });
    var foot = document.createElement("div"); foot.style.cssText = "display:flex;gap:10px;margin-top:16px;";
    var rst = mkBtn("Reset defaults", "flex:1;padding:13px;border:none;border-radius:8px;background:#555;color:#fff;font-size:16px;");
    rst.onclick = function (e) { e.stopPropagation(); resetCfg(); };
    var cls = mkBtn("Save", "flex:1;padding:13px;border:none;border-radius:8px;background:#1976d2;color:#fff;font-size:16px;font-weight:700;");
    cls.onclick = function (e) { e.stopPropagation(); closeSettings(); };
    foot.appendChild(rst); foot.appendChild(cls); box.appendChild(foot);
    ov.appendChild(box);
    ov.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });
    ov.addEventListener("click", function (e) { e.stopPropagation(); if (e.target === ov) closeSettings(); });
    (document.body || document.documentElement).appendChild(ov);
    panel = ov; return ov;
  }
  function openSettings(e) {
    if (e) { try { e.stopPropagation(); e.preventDefault(); } catch (x) {} }
    window.__avGen++;                       // pause the running flow while settings are open
    try { if (api) api.ankiSttStop(); } catch (x) {}
    try { if (api) api.ankiTtsStop(); } catch (x) {}
    letSleep(); paused = true;
    var p = buildPanel();
    for (var i = 0; i < refreshers.length; i++) refreshers[i]();   // pick up words heard since it was built
    checkCfgSize();
    p.style.display = "block";
  }
  function closeSettings() {
    if (panel) panel.style.display = "none";
    if (!CFG.voiceTest) heardBar.style.display = "none";
    if (on()) startFlow(true); else paintOff();  // apply new settings, don't re-read the card
  }
  var gear = document.createElement("div");
  gear.id = "av-gear";
  gear.textContent = "\u2699";
  gear.style.cssText = "position:fixed;right:8px;bottom:7px;width:38px;height:38px;line-height:38px;text-align:center;font-size:22px;border-radius:19px;background:rgba(70,70,70,.96);color:#fff;z-index:10001;pointer-events:auto;cursor:pointer;user-select:none;-webkit-user-select:none;";
  (document.body || document.documentElement).appendChild(gear);
  gear.addEventListener("click", openSettings);
  gear.addEventListener("touchstart", function (e) { try { e.stopPropagation(); } catch (x) {} }, { passive: true });

  (async function () {
    var waited = 0;
    while (typeof AnkiDroidJS === "undefined") {
      await sleep(200); waited += 200;
      if (waited >= 2000) {   // no JS API: Desktop / AnkiWeb -> leave the card untouched
        stat.style.display = "none"; heardBar.style.display = "none";
        if (gear) gear.style.display = "none";
        releaseBarSpace(); return;
      }
    }
    if (!api) api = new AnkiDroidJS({ version: "0.0.3", developer: "ankivoice@example.com" });
    if (on()) startFlow();
    else paintOff();
  })();
})();
