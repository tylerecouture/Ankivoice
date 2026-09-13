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
  const cfg = Object.assign({ thinkDelayQuestionMs: 0, markMicDelayMs: 0, restartGapMs: 0 }, opts.cfg || {});
  win.localStorage.setItem("av_cfg", JSON.stringify(cfg));
  for (const [k, v] of Object.entries(opts.storage || {})) win.localStorage.setItem(k, v);
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
    ok("the command list was read on the first card", state.spoken.join(" ").includes("Voice commands"));
    ok("the bar does not cover the card", /\d+px/.test(doc.body.style.paddingBottom));
    ok("the mic opened after the question", state.micStarts >= 1);

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
    ok("tapping it again removes the word", JSON.parse(win.localStorage.getItem("av_cfg")).words_hard.indexOf("harv") < 0);
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
