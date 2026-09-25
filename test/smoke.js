/*
 * DOM-level smoke test for _ankivoice.js.
 *
 * test/test.js covers the pure functions. This one loads the WHOLE plugin into a
 * fake DOM with a fake AnkiDroid JS API and drives a review: read the question,
 * hear a command, reveal, grade. It cannot prove anything about a real device
 * (see docs/DECISIONS.md), but it does catch the class of bug that used to reach
 * the phone - a typo in the settings panel, an exception that silently kills the
 * flow, a handler that never reopens the microphone.
 *
 *   npm install --no-save jsdom && node test/smoke.js
 *
 * Skips (exit 0) if jsdom is not installed, so the dependency stays optional.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch (e) {
  console.log("jsdom not installed - skipping DOM smoke test (npm install --no-save jsdom)");
  process.exit(0);
}

const SRC = fs.readFileSync(path.join(__dirname, "..", "_ankivoice.js"), "utf8");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let passed = 0;
function ok(label, cond) { assert.ok(cond, "FAILED: " + label); passed++; console.log("  ok  " + label); }

// --- a fake AnkiDroid JS API that records what the plugin asked for ----------
function makeApi(state) {
  const Api = makeApiClass(state);
  if (state.noAddTag) delete Api.prototype.ankiAddTagToNote;   // an older/newer build without it
  return Api;
}
function makeApiClass(state) {
  const reply = (v) => Promise.resolve({ success: true, value: String(v) });
  return class AnkiDroidJS {
    constructor() { state.constructed = true; }
    // Real TTS reports "speaking" shortly after the call returns and stops a
    // moment later; the plugin's grace window exists for exactly that gap.
    ankiTtsSpeak(t) {
      state.spoken.push(t);
      state.speaking = true;
      setTimeout(() => { state.speaking = false; }, 40);
      return reply("true");
    }
    ankiTtsIsSpeaking() { return reply(state.speaking ? "true" : "false"); }
    ankiTtsStop() { state.speaking = false; return reply("true"); }
    ankiTtsSetLanguage(l) { state.ttsLang = l; return reply("true"); }
    ankiSttStart() { state.micStarts++; return reply("true"); }
    ankiSttStop() { return reply("true"); }
    ankiIsDisplayingAnswer() { return reply(state.onAnswer ? "true" : "false"); }
    ankiShowAnswer() { state.showAnswer++; return reply("true"); }
    ankiBuryCard() { state.buried++; return reply("true"); }
    // returns RAW response text, as the real API does
    ankiGetNextTime1() { return Promise.resolve('{"success":true,"value":"1m"}'); }
    ankiGetNextTime2() { return Promise.resolve('{"success":true,"value":"8m"}'); }
    ankiGetNextTime3() { return Promise.resolve('{"success":true,"value":"4d"}'); }
    ankiGetNextTime4() { return Promise.resolve('{"success":true,"value":"9d"}'); }
    ankiGetCardNid() { return reply(state.nid); }
    ankiGetNoteTags() {
      state.tagReads++;
      if (state.tagsBroken) return Promise.resolve({ success: false, value: "boom" });
      return Promise.resolve({ success: true, value: state.tags.slice() });
    }
    ankiAddTagToNote(nid, tag) { state.added.push([nid, tag]); state.tags.push(tag); return reply("true"); }
    ankiSetNoteTags(tags) { state.tagWrites.push(tags.slice()); state.tags = tags.slice(); return reply("true"); }
    ankiAnswerEase1() { state.graded.push(1); }
    ankiAnswerEase2() { state.graded.push(2); }
    ankiAnswerEase3() { state.graded.push(3); }
    ankiAnswerEase4() { state.graded.push(4); }
  };
}

async function boot(html, opts) {
  opts = opts || {};
  const state = {
    spoken: [], graded: [], micStarts: 0, showAnswer: 0, buried: 0,
    speaking: false, onAnswer: !!opts.onAnswer, errors: [],
    nid: "1234", tags: (opts.tags || []).slice(), tagWrites: [], added: [],
    tagReads: 0, tagsBroken: !!opts.tagsBroken, noAddTag: !!opts.noAddTag,
  };
  const dom = new JSDOM("<!doctype html><html><body>" + html + "</body></html>", {
    url: "http://127.0.0.1:41234/",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const win = dom.window;
  win.AnkiDroidJS = makeApi(state);
  win.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  win.addEventListener("error", (e) => state.errors.push("error: " + e.message));
  win.addEventListener("unhandledrejection", (e) => state.errors.push("rejection: " + e.reason));
  // Real timings make the suite sleep for minutes; the delays themselves are not
  // what this test is checking.
  // _cfgv marks these as deliberate, current-format settings. opts.legacyCfg
  // writes a pre-v37 blob instead (no marker, every value dumped).
  const cfg = opts.legacyCfg
    ? Object.assign({}, opts.legacyCfg)
    : Object.assign({ _cfgv: 2, thinkDelayQuestionMs: 0, markMicDelayMs: 0, restartGapMs: 0 }, opts.cfg || {});
  win.localStorage.setItem("av_cfg", JSON.stringify(cfg));
  for (const [k, v] of Object.entries(opts.storage || {})) win.localStorage.setItem(k, v);
  for (const [k, v] of Object.entries(opts.cookies || {})) {
    win.document.cookie = k + "=" + encodeURIComponent(v) + ";path=/";
  }
  win.eval(SRC);
  await wait(opts.settle == null ? 400 : opts.settle);
  return { win, state, doc: win.document };
}

// A recognition result in the shape the real API delivers.
const heard = (...hyps) => JSON.stringify({ success: true, value: JSON.stringify(hyps) });
const silence = () => JSON.stringify({ success: false, value: "No speech input" });

(async function run() {
  // ---------- question side: reads, then opens the mic ----------
  {
    const { win, state, doc } = await boot("<div>Capital of Mali?</div>");
    ok("the bar is injected", !!doc.getElementById("av-root"));
    ok("the gear is injected", !!doc.getElementById("av-gear"));
    ok("the question was read", state.spoken.join(" ").includes("Capital of Mali"));
    ok("the first card is greeted, not lectured", state.spoken.join(" ").includes("AnkiVoice is on"));
    ok("the full command list is NOT read out unprompted", !state.spoken.join(" ").includes("Voice commands"));
    ok("the greeting comes before the question", /AnkiVoice is on[\s\S]*Capital of Mali/.test(state.spoken.join(" ")));
    ok("the bar does not cover the card", /\d+px/.test(doc.body.style.paddingBottom));
    ok("the mic opened after the question", state.micStarts >= 1);

    // "help" still reads the full list on demand
    win.ankiSttResult(heard("help"));
    await wait(300);
    ok("help still lists every command", state.spoken.join(" ").includes("Voice commands"));

    // "answer" reveals, whichever hypothesis carries it
    win.ankiSttResult(heard("and sir", "answer"));
    await wait(60);
    ok("a matching hypothesis reveals the answer", state.showAnswer === 1);
  }

  // ---------- a malformed result must not kill the flow ----------
  {
    const { win, state } = await boot("<div>Q</div>");
    const before = state.micStarts;
    win.ankiSttResult('{"success":true,"value":"not json at all"}');
    await wait(40);
    ok("a malformed result raises no unhandled rejection", state.errors.length === 0);
    ok("the mic reopens after a malformed result", state.micStarts > before);

    win.ankiSttResult("total garbage, not even an envelope");
    await wait(40);
    ok("a malformed envelope raises no unhandled rejection", state.errors.length === 0);
  }

  // ---------- answer side: grade by voice, interval announced ----------
  {
    const { win, state } = await boot(
      '<div>Capital of Mali?</div><hr id="answer"><div>Bamako</div>',
      { onAnswer: true, storage: { av_qlines: JSON.stringify(["Capital of Mali?"]), av_adone: "1" } }
    );
    ok("only the answer text is read", state.spoken.some((t) => t.includes("Bamako")));
    ok("the question is not re-read", !state.spoken.some((t) => t.startsWith("Capital of Mali?.")));
    ok("a grade cue is spoken", state.spoken.some((t) => t.indexOf("Mark it") >= 0));

    win.ankiSttResult(heard("heart", "art"));       // a classic mis-hear of "hard"
    await wait(400);                                // grading speaks before it advances
    ok("a mis-heard grade still grades Hard", state.graded[0] === 2);
    ok("the next interval is announced", state.spoken.join(" ").includes("8 minutes"));
  }

  // ---------- noise must not loop the microphone forever ----------
  {
    const { win, state } = await boot("<div>Q</div>", { cfg: { maxNoMatchTries: 3 } });
    for (let i = 0; i < 6; i++) { win.ankiSttResult(heard("the weather is nice today")); await wait(40); }
    await wait(300);
    ok("unknown speech parks the mic", state.spoken.join(" ").includes("Microphone paused"));
    ok("the mic stopped restarting", state.micStarts <= 4);
  }

  // ---------- silence also parks the mic ----------
  {
    const { win, state } = await boot("<div>Q</div>", { cfg: { maxListenTries: 2 } });
    for (let i = 0; i < 4; i++) { win.ankiSttResult(silence()); await wait(40); }
    await wait(300);
    ok("silence parks the mic", state.spoken.join(" ").includes("Microphone paused"));
  }

  // ---------- spoken-answer detection (the v29 fix) ----------
  {
    const { win, state } = await boot("<div>Capital of Mali?</div>",
      { cfg: { detectAnswer: true } });
    win.ankiSttResult(heard("bamboo", "bamako", "bam ako"));
    await wait(80);
    ok("a short spoken answer is taken as an attempt", state.showAnswer === 1);
    const stored = JSON.parse(win.localStorage.getItem("av_attempt"));
    ok("every hypothesis is stored separately", Array.isArray(stored) && stored.length === 3);

    const back = await boot('<div>Capital of Mali?</div><hr id="answer"><div>Bamako</div>', {
      onAnswer: true,
      cfg: { detectAnswer: true },
      storage: {
        av_qlines: JSON.stringify(["Capital of Mali?"]),
        av_attempt: JSON.stringify(stored),
      },
    });
    await wait(300);
    ok("the right hypothesis auto-grades Good", back.state.graded[0] === 3);
    ok("it says so", back.state.spoken.includes("Correct."));
  }

  // ---------- a too-long answer explains itself instead of going quiet ----------
  {
    // Voice test OFF on purpose: the explanation must show anyway, or the user
    // sees the app hear them and do nothing (the v31 report).
    const { win, state, doc } = await boot("<div>Capital of Mali?</div>",
      { cfg: { detectAnswer: true, maxAnswerWords: 3, voiceTest: false } });
    const before = state.micStarts;
    win.ankiSttResult(heard("the Half Blood Prince"));
    await wait(60);
    const bar = doc.getElementById("av-heard");
    ok("a too-long answer does not reveal", state.showAnswer === 0);
    ok("the readout is forced visible even with Voice test off", bar.style.display === "block");
    ok("it says the phrase was too long", bar.textContent.indexOf("too long for an answer") >= 0);
    ok("it quotes what was heard", bar.textContent.indexOf("the half blood prince") >= 0);
    ok("it names the limit", bar.textContent.indexOf("max 3") >= 0);
    ok("and it keeps listening", state.micStarts > before);
  }
  {
    // the same phrase under the v31 default sails through
    const { win, state } = await boot("<div>Capital of Mali?</div>",
      { cfg: { detectAnswer: true, maxAnswerWords: 8 } });
    win.ankiSttResult(heard("the Half Blood Prince"));
    await wait(60);
    ok("the v31 default accepts a 4-word answer", state.showAnswer === 1);
  }

  // ---------- the answer side shows what it thought you said ----------
  {
    const { doc } = await boot('<div>Capital of Mali?</div><hr id="answer"><div>Bamako</div>', {
      onAnswer: true,
      cfg: { detectAnswer: true, voiceTest: false },
      storage: {
        av_qlines: JSON.stringify(["Capital of Mali?"]),
        av_attempt: JSON.stringify(["timbuktu"]),
      },
    });
    await wait(300);
    const bar = doc.getElementById("av-heard");
    ok("the attempt survives the page reload", bar.textContent.indexOf("you said: timbuktu") >= 0);
    ok("shown even with Voice test off", bar.style.display === "block");
  }

  // ---------- settings panel builds, and chips edit without typing ----------
  {
    const { win, doc, state } = await boot("<div>Q</div>", { storage: { av_heard_recent: JSON.stringify(["harv", "hardt"]) } });
    doc.getElementById("av-gear").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await wait(20);
    const panel = doc.getElementById("av-settings");
    ok("the settings panel builds", !!panel && panel.style.display === "block");
    ok("the panel is excluded from spoken text", panel.id.indexOf("av-") === 0);

    // every word row offers the same "heard recently" chips, so work inside the
    // Hard row specifically rather than taking the first chip on the screen
    const hardRow = [...panel.querySelectorAll("div")]
      .find((d) => d.firstChild && d.firstChild.textContent === "Extra words \u2192 Hard");
    ok("the Hard row is rendered", !!hardRow);
    const chipsIn = (row) => [...row.querySelectorAll("span")].map((c) => c.textContent);
    ok("existing words render as chips", chipsIn(hardRow).some((t) => t.indexOf("hard ") === 0));
    ok("recently heard words are offered", chipsIn(hardRow).indexOf("+ harv") >= 0);

    const chip = (row, text) => [...row.querySelectorAll("span")].find((c) => c.textContent === text);
    chip(hardRow, "+ harv").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await wait(20);
    ok("tapping a chip adds the word", JSON.parse(win.localStorage.getItem("av_cfg")).words_hard.indexOf("harv") >= 0);
    ok("the text field stays in sync", hardRow.querySelector("input").value.indexOf("harv") >= 0);
    ok("the suggestion disappears once added", chipsIn(hardRow).indexOf("+ harv") < 0);

    const remove = [...hardRow.querySelectorAll("span")].find((c) => c.textContent.indexOf("harv ") === 0);
    remove.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await wait(20);
    const wh = JSON.parse(win.localStorage.getItem("av_cfg")).words_hard;
    // back to the default list, so (since v37) it is simply not stored any more
    ok("tapping it again removes the word", !wh || wh.indexOf("harv") < 0);
    ok("the settings are written to the cookie too", win.document.cookie.indexOf("av_cfg=") >= 0);
    ok("no errors while editing settings", state.errors.length === 0);

    // closing resumes listening rather than re-reading the card
    const spokenBefore = state.spoken.length;
    [...panel.querySelectorAll("button")].find((b) => b.textContent === "Save")
      .dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await wait(200);
    ok("closing the panel does not re-read the card", state.spoken.length === spokenBefore);
    ok("closing the panel reopens the mic", state.micStarts >= 2);
  }

  // ---------- remembering an accepted answer (off unless asked for) ----------
  const backWithAttempt = (extra) => Object.assign({
    onAnswer: true,
    cfg: { detectAnswer: true },
    storage: {
      av_qlines: JSON.stringify(["Which book?"]),
      av_attempt: JSON.stringify(["the goblet of fire"]),
      av_adone: "1",
    },
  }, extra || {});
  const BACK = '<div>Which book?</div><hr id="answer"><div>Bamako</div>';
  const ON = { detectAnswer: true, rememberAnswers: true };
  const asked = (state) => state.spoken.some((t) => t.indexOf("Should I remember") >= 0);
  const tap = (win, el) => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));

  {
    // default: never touches tags, never asks, no button
    const { state, doc } = await boot(BACK, backWithAttempt());
    await wait(400);
    ok("off by default: no question", !asked(state));
    ok("off by default: no remember button", !doc.getElementById("av-keep"));
    ok("off by default: tags are never even read", state.tagReads === 0 && state.added.length === 0);
  }
  {
    // THE v36 REGRESSION: nothing is asked before you have graded
    const { state } = await boot(BACK, backWithAttempt({ cfg: ON }));
    await wait(400);
    ok("no question before grading (v36 asked about every wrong answer)", !asked(state));
    ok("it goes straight to the grade cue", state.spoken.some((t) => t.indexOf("Mark it") >= 0));
  }
  {
    // voice grader, positive grade -> asked, then graded
    const { win, state, doc } = await boot(BACK, backWithAttempt({ cfg: ON, tags: ["leech"] }));
    await wait(400);
    win.ankiSttResult(heard("good"));
    await wait(400);
    ok("a spoken Good is followed by the question", asked(state));
    ok("the question no longer says 'say yes or no'",
       !state.spoken.some((t) => /say yes/i.test(t)));
    ok("grading waits for the answer", state.graded.length === 0);
    win.ankiSttResult(heard("yes"));
    await wait(400);
    ok("yes adds one tag", state.added.length === 1);
    ok("the tag encodes the phrase", state.added[0][1] === "AnkiVoice::ok::the-goblet-of-fire");
    ok("it uses the additive call, never a wholesale rewrite", state.tagWrites.length === 0);
    ok("existing tags are untouched", state.tags.indexOf("leech") >= 0);
    ok("it confirms out loud", state.spoken.indexOf("Saved.") >= 0);
    ok("then grades Good", state.graded[0] === 3);
    ok("and the on-screen button agrees", doc.getElementById("av-keep").textContent.indexOf("Remembered") >= 0);
  }
  {
    // a spoken Again means you were wrong: never asked
    const { win, state } = await boot(BACK, backWithAttempt({ cfg: ON }));
    await wait(400);
    win.ankiSttResult(heard("again"));
    await wait(400);
    ok("Again is never followed by the question", !asked(state));
    ok("Again just grades", state.graded[0] === 1);
  }
  {
    const { win, state } = await boot(BACK, backWithAttempt({ cfg: ON }));
    await wait(400);
    win.ankiSttResult(heard("hard"));
    await wait(400);
    win.ankiSttResult(heard("no"));
    await wait(400);
    ok("no saves nothing", state.added.length === 0 && state.tagWrites.length === 0);
    ok("but still grades", state.graded[0] === 2);
  }
  {
    // silence at the question must not strand a card that was already graded
    const { win, state } = await boot(BACK, backWithAttempt({ cfg: ON }));
    await wait(400);
    win.ankiSttResult(heard("easy"));
    await wait(400);
    win.ankiSttResult(silence());
    await wait(400);
    ok("no reply still grades the card", state.graded[0] === 4);
    ok("and saves nothing", state.added.length === 0);
  }
  {
    // button grader: our own button, silent, no question at all
    const { win, state, doc } = await boot(BACK, backWithAttempt({ cfg: ON }));
    await wait(400);
    const btn = doc.getElementById("av-keep");
    ok("an unrecognised answer gets a remember button", !!btn && btn.style.display === "block");
    ok("the button names the phrase", btn.textContent.indexOf("the goblet of fire") >= 0);
    ok("the button is never read aloud", btn.id.indexOf("av-") === 0);
    tap(win, btn);
    await wait(100);
    ok("tapping it saves the tag", state.added.length === 1);
    ok("silently - no spoken question", !asked(state));
    ok("the button confirms", btn.textContent.indexOf("Remembered") >= 0);
    tap(win, btn);
    await wait(100);
    ok("a second tap does not save twice", state.added.length === 1);
    // having tapped it, a spoken grade must not ask again
    win.ankiSttResult(heard("good"));
    await wait(400);
    ok("no question after the button was used", !asked(state));
    ok("the card grades straight away", state.graded[0] === 3);
  }
  {
    // a recognised answer has nothing to teach: no button, no question
    const { win, state, doc } = await boot(BACK, {
      onAnswer: true, cfg: ON,
      storage: { av_qlines: JSON.stringify(["Which book?"]), av_attempt: JSON.stringify(["bamako"]), av_adone: "1" },
    });
    await wait(400);
    ok("a matched answer gets no remember button", !doc.getElementById("av-keep"));
    ok("it just says Correct", state.spoken.indexOf("Correct.") >= 0);
  }
  {
    // a tag saved earlier makes the same answer count next time
    const { state } = await boot(BACK,
      backWithAttempt({ cfg: ON, tags: ["AnkiVoice::ok::the-goblet-of-fire"] }));
    await wait(400);
    ok("a remembered answer is accepted on the next review", state.spoken.indexOf("Correct.") >= 0);
    ok("and auto-grades Good", state.graded[0] === 3);
  }
  {
    // the additive call never needs to READ tags, so a broken read can't hurt it
    const { win, state, doc } = await boot(BACK, backWithAttempt({ cfg: ON, tagsBroken: true }));
    await wait(400);
    tap(win, doc.getElementById("av-keep"));
    await wait(150);
    ok("with the additive call, a broken read still saves safely", state.added.length === 1);
    ok("...without ever rewriting the tag list", state.tagWrites.length === 0);
  }
  {
    // no additive call AND a broken read: the replace-all fallback must refuse
    const { win, state, doc } = await boot(BACK,
      backWithAttempt({ cfg: ON, tagsBroken: true, noAddTag: true }));
    await wait(400);
    tap(win, doc.getElementById("av-keep"));
    await wait(150);
    ok("a failed read never leads to a rewrite", state.tagWrites.length === 0);
    ok("the button owns up to the failure", doc.getElementById("av-keep").textContent.indexOf("Could not save") >= 0);
  }
  {
    // no additive call but a GOOD read: the fallback keeps every existing tag
    const { win, state, doc } = await boot(BACK,
      backWithAttempt({ cfg: ON, noAddTag: true, tags: ["leech", "geo"] }));
    await wait(400);
    tap(win, doc.getElementById("av-keep"));
    await wait(150);
    ok("the fallback rewrites exactly once", state.tagWrites.length === 1);
    ok("...keeping every existing tag", ["leech", "geo"].every((t) => state.tagWrites[0].indexOf(t) >= 0));
    ok("...plus the new one", state.tagWrites[0].indexOf("AnkiVoice::ok::the-goblet-of-fire") >= 0);
  }

  // ---------- saved settings no longer freeze old defaults (v37) ----------
  {
    // the reported case: settings saved back on v30 dumped maxAnswerWords: 3
    const legacy = { thinkDelayQuestionMs: 0, markMicDelayMs: 0, restartGapMs: 0,
                     detectAnswer: true, maxAnswerWords: 3, voiceTest: true };
    const { win, state, doc } = await boot("<div>In morse code, what is:</div><div>end of work</div>",
      { legacyCfg: legacy });
    win.ankiSttResult(heard("it is the end of work"));   // 6 words
    await wait(80);
    ok("a stale saved limit of 3 no longer blocks a 6-word answer", state.showAnswer === 1);
    ok("...so no 'too long' complaint", doc.getElementById("av-heard").textContent.indexOf("too long") < 0);
  }
  {
    // ...but a real choice saved in the new format is respected
    const { win, state, doc } = await boot("<div>Q</div>",
      { cfg: { detectAnswer: true, maxAnswerWords: 3 } });
    win.ankiSttResult(heard("it is the end of work"));
    await wait(80);
    ok("a deliberately saved 3 still applies", state.showAnswer === 0);
    ok("and says so", doc.getElementById("av-heard").textContent.indexOf("max 3") >= 0);
  }
  {
    // saving writes only what differs from the defaults
    const { win, doc } = await boot("<div>Q</div>", { cfg: { voiceTest: false } });
    tap(win, doc.getElementById("av-gear"));
    await wait(20);
    const row = [...doc.getElementById("av-settings").querySelectorAll("div")]
      .find((d) => d.firstChild && d.firstChild.textContent === "Voice test (show heard words)");
    tap(win, row.querySelector("button"));                // turn Voice test on
    await wait(20);
    const saved = JSON.parse(win.localStorage.getItem("av_cfg"));
    ok("the saved blob is marked current-format", saved._cfgv === 2);
    ok("the changed setting is saved", saved.voiceTest === true);
    ok("untouched defaults are NOT saved", !("maxAnswerWords" in saved) && !("words_hard" in saved));
  }

  // ---------- adding vocabulary survives a restart, and says so when empty ----
  {
    // localStorage is wiped by the port change on restart; the cookie is not.
    // Simulate a restart by supplying ONLY the cookie.
    const { win, doc } = await boot("<div>Q</div>", { cookies: { av_heard: JSON.stringify(["harv"]) } });
    doc.getElementById("av-gear").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await wait(20);
    const panel = doc.getElementById("av-settings");
    const hardRow = [...panel.querySelectorAll("div")]
      .find((d) => d.firstChild && d.firstChild.textContent === "Extra words \u2192 Hard");
    const texts = [...hardRow.querySelectorAll("span")].map((c) => c.textContent);
    ok("heard words survive a restart via the cookie", texts.indexOf("+ harv") >= 0);
  }
  {
    // and with nothing heard, the panel explains where words come from rather
    // than silently offering no way to add any
    const { win, doc } = await boot("<div>Q</div>");
    doc.getElementById("av-gear").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await wait(20);
    const panel = doc.getElementById("av-settings");
    const hardRow = [...panel.querySelectorAll("div")]
      .find((d) => d.firstChild && d.firstChild.textContent === "Extra words \u2192 Hard");
    ok("the empty state explains itself", hardRow.textContent.indexOf("nothing new heard yet") >= 0);
    ok("removal chips are still there", [...hardRow.querySelectorAll("span")].some((c) => /^hard\s/.test(c.textContent)));
  }
  {
    // a word heard while reviewing is written to the durable store
    const { win, state } = await boot("<div>Q</div>");
    win.ankiSttResult(heard("harvey"));
    await wait(60);
    ok("a heard word reaches the cookie", win.document.cookie.indexOf("av_heard") >= 0);
    ok("...and includes the word", decodeURIComponent(win.document.cookie).indexOf("harvey") >= 0);
  }

  // ---------- every setting is reachable without a keyboard ----------
  {
    const { win, doc } = await boot("<div>Q</div>", { cfg: { ttsLang: "en-US" } });
    doc.getElementById("av-gear").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await wait(20);
    const panel = doc.getElementById("av-settings");
    const rowFor = (label) => [...panel.querySelectorAll("div")]
      .find((d) => d.firstChild && d.firstChild.textContent === label);

    const lang = rowFor("Speech language");
    ok("the language row exists", !!lang);
    const chip = (row, text) => [...row.querySelectorAll("span")].find((c) => c.textContent === text);
    ok("languages are offered as chips", !!chip(lang, "fr-FR"));
    chip(lang, "fr-FR").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await wait(20);
    ok("tapping a language sets it", JSON.parse(win.localStorage.getItem("av_cfg")).ttsLang === "fr-FR");
    ok("the field follows along", lang.querySelector("input").value === "fr-FR");

    // nothing in the panel should require typing
    const typed = [...panel.querySelectorAll("input")].filter((i) => {
      const r = i.closest ? i.closest("div") : null;
      return r && ![...r.querySelectorAll("span")].length;
    });
    ok("no setting is text-entry only", typed.length === 0);
  }

  // ---------- an oversized word list is reported, not silently dropped ----------
  {
    const big = new Array(700).fill("wordy").join(", ");
    const { win, doc } = await boot("<div>Q</div>", { cfg: { words_hard: big } });
    doc.getElementById("av-gear").dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
    await wait(20);
    const note = doc.getElementById("av-note");
    ok("an oversized settings blob warns in the panel",
       !!note && note.style.display === "block" && note.textContent.indexOf("too long to store") >= 0);
    ok("the oversized blob is not written to the cookie", win.document.cookie.indexOf("av_cfg=") < 0);
  }

  // ---------- off-AnkiDroid: hide, and leave the card alone ----------
  {
    const dom = new JSDOM("<!doctype html><html><body><div>Q</div></body></html>",
      { url: "http://127.0.0.1:41234/", runScripts: "outside-only", pretendToBeVisual: true });
    dom.window.HTMLMediaElement.prototype.play = () => Promise.resolve();
    dom.window.eval(SRC);
    await wait(2400);
    ok("the bar hides with no JS API", dom.window.document.getElementById("av-root").style.display === "none");
    ok("the reserved space is given back", !dom.window.document.body.style.paddingBottom);
  }

  console.log("\nAll " + passed + " smoke assertions passed.");
})().catch((e) => { console.error(e); process.exit(1); });
