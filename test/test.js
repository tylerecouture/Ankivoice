/*
 * Pure-function tests for _ankivoice.js.
 *
 * The bulk of the plugin depends on AnkiDroid's WebView JS API and can only be
 * verified on a device. But the text/interval/vocab logic is pure and testable.
 * This harness extracts those functions from ../_ankivoice.js (so tests always
 * run against the real source) and exercises them with a tiny DOM shim.
 *
 *   node test/test.js
 *
 * Exits non-zero on any failure.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "_ankivoice.js"), "utf8");
const changelog = fs.readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8");
const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");

// --- pull a top-level `function NAME(...) { ... }` out of the source ---
// Brace-matched rather than regex-terminated, so one-line helpers and nested
// blocks both come out whole. (Assumes no braces inside string/regex literals
// in the extracted functions; if that ever changes, eval below fails loudly.)
function grab(name) {
  const start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("could not find function " + name);
  const open = src.indexOf("{", start);
  if (open < 0) throw new Error("could not find body of " + name);
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { i++; break; }
  }
  if (depth !== 0) throw new Error("unbalanced braces in " + name);
  return src.slice(start, i);
}
function grabVar(name) {
  const m = src.match(new RegExp("var " + name + " = [\\s\\S]*?;\\n"));
  if (!m) throw new Error("could not extract var " + name);
  return m[0];
}

// Evaluate the extracted pieces in this scope. `CFG` is provided per-test.
let CFG = {};
eval(grabVar("AV_BLOCK"));
eval(grabVar("AV_UNITS"));
eval(grabVar("AV_PUNCT"));
eval(grabVar("AV_STOPWORDS"));
eval(grab("textWithBreaks"));
eval(grab("extractLines"));
eval(grab("speechJoin"));
eval(grab("subtractLines"));
eval(grab("normalize"));
eval(grab("spellKey"));
eval(grab("contentWords"));
eval(grab("hasAll"));
eval(grab("answerMatches"));
eval(grab("anyAnswerMatches"));
eval(grab("answerAttempts"));
eval(grab("expandIvl"));
eval(grab("unwrapValue"));
eval(grab("said"));

// --- tiny DOM node shim (nodeType 1 = element, 3 = text) ---
const E = (tag, kids, id) => ({ nodeType: 1, tagName: tag.toUpperCase(), id: id || "", childNodes: kids || [] });
const T = (text) => ({ nodeType: 3, nodeValue: text });
const heardOf = (t) => " " + t.toLowerCase() + " ";

let passed = 0;
function ok(label, cond) {
  assert.ok(cond, "FAILED: " + label);
  passed++;
}
function eq(label, a, b) {
  assert.deepStrictEqual(a, b, "FAILED: " + label + "\n  got:      " + JSON.stringify(a) + "\n  expected: " + JSON.stringify(b));
  passed++;
}

// ---------------- interval -> speech ----------------
eq("expandIvl 16m", expandIvl("16m"), "16 minutes");
eq("expandIvl 1d", expandIvl("1d"), "1 day");
eq("expandIvl <4m", expandIvl("<4m"), "less than 4 minutes");
eq("expandIvl 1.6mo", expandIvl("1.6mo"), "1.6 months");
eq("expandIvl 1y", expandIvl("1y"), "1 year");
eq("expandIvl zero-width", expandIvl("16​m"), "16 minutes");
eq("unwrapValue raw json", unwrapValue('{"success":true,"value":"10m"}'), "10m");
eq("unwrapValue bare", unwrapValue("10m"), "10m");
eq("unwrapValue object", unwrapValue({ success: true, value: "true" }), "true");
eq("unwrapValue false-ish", unwrapValue({ success: true, value: false }), "");

// ---------------- line-break -> pause ----------------
eq("br makes pause", speechJoin(extractLines(E("div", [T("Red"), E("br"), T("Blue")]))), "Red. Blue.");
eq("paragraphs pause", speechJoin(extractLines(E("div", [E("p", [T("A")]), E("p", [T("B")])]))), "A. B.");
eq("no phantom pause on inline whitespace",
   speechJoin(extractLines(E("div", [E("span", [T("foo")]), T("\n     "), E("span", [T("bar")])]))), "foo bar.");
eq("existing punctuation kept", speechJoin(extractLines(E("div", [T("apples,"), E("br"), T("oranges")]))), "apples, oranges.");
// table cells are separate spoken lines, not one run-on phrase
eq("table cells pause",
   speechJoin(extractLines(E("table", [E("tr", [E("td", [T("Paris")]), E("td", [T("France")])])]))),
   "Paris. France.");

// <small> and our own av-* UI are excluded from spoken text
eq("small + av-* excluded",
   extractLines(E("body", [
     E("div", [T("Q text")]),
     E("small", [T("hidden hint")]),
     E("div", [T("⚙")], "av-gear"),
     E("div", [T("AnkiVoice")], "av-root"),
   ])),
   ["Q text"]);

// ---------------- answer = card minus question ----------------
(() => {
  const front = E("div", [E("div", [T("FLAG")]), E("div", [T("hint.")])]);
  const back = E("div", [E("div", [T("Mali")]), E("hr", [], "answer"), E("div", [T("FLAG")]), E("div", [T("hint.")])]);
  eq("answer above hr (Ultimate Geography)",
     subtractLines(extractLines(back), extractLines(front)), ["Mali"]);
})();
(() => {
  const front = E("div", [T("Capital of BC?")]);
  const back = E("div", [T("Capital of BC?"), E("hr", [], "answer"), T("Victoria")]);
  eq("standard FrontSide layout",
     subtractLines(extractLines(back), extractLines(front)), ["Victoria"]);
})();

// ---------------- normalization ----------------
eq("normalize folds accents", normalize("Café"), "cafe");
eq("normalize strips punctuation", normalize("OK, yes!"), "ok yes");
eq("normalize keeps other scripts", normalize("Привет"), "привет");
eq("normalize keeps digits", normalize("Room 101."), "room 101");

// ---------------- spoken-answer matching (conservative) ----------------
ok("answerMatches exact", answerMatches("bamako", ["Bamako"]) === true);
ok("answerMatches wrong", answerMatches("mali", ["Bamako"]) === false);
ok("answerMatches not-in-long-sentence", answerMatches("guinea", ["Flag similar to Guinea and red flipped darker"]) === false);
ok("answerMatches accent-insensitive", answerMatches("cafe", ["Café"]) === true);

// Filler words are ignored, so an adequate answer need not be word-perfect.
eq("contentWords drops filler", contentWords("the capital is Bamako"), ["capital", "bamako"]);
eq("contentWords survives an all-filler answer", contentWords("the"), ["the"]);
ok("hasAll is a subset test", hasAll(["a", "b", "c"], ["c", "a"]) === true);
ok("hasAll rejects a missing word", hasAll(["a", "b"], ["a", "z"]) === false);

// Tier 1: you said at least every content word of the answer. Always accepted,
// at any coverage setting, because nothing is missing.
ok("filler added around the answer", answerMatches("it's Bamako", ["Bamako"]) === true);
ok("a whole sentence containing the answer", answerMatches("the capital is Bamako", ["Bamako"]) === true);
ok("leading article on the card", answerMatches("mitochondria", ["The mitochondria"]) === true);
ok("tier 1 ignores the coverage setting", answerMatches("it's Bamako", ["Bamako"], 0) === true);

// Tier 2: only PART of the answer, gated on how much of it you covered.
(() => {
  const book = ["Harry Potter and the Goblet of Fire"];   // 4 content words
  ok("half the title is rejected at the cautious default", answerMatches("goblet of fire", book, 60) === false);
  ok("...and accepted when lowered to 50", answerMatches("goblet of fire", book, 50) === true);
  // the reason the default is cautious: nothing distinguishes these two halves
  ok("the WRONG half is equally accepted at 50", answerMatches("harry potter", book, 50) === true);
  ok("...and equally rejected at 60", answerMatches("harry potter", book, 60) === false);
  ok("partial matching off entirely", answerMatches("goblet of fire", book, 0) === false);
})();
eq("two of three content words clears 60%",
   answerMatches("united states", ["The United States of America"], 60), true);

// Coverage alone keeps a lone word out of a long descriptive answer: 1 of 6
// content words is 17%, below any sane threshold, so no extra minimum-length
// rule is needed. Set the threshold below 17 and it does match - which is
// exactly what the number is for.
(() => {
  const flag = ["Flag similar to Guinea and red flipped darker"];
  ok("a lone word in a long answer is rejected at the default", answerMatches("guinea", flag, 60) === false);
  ok("...and at a lenient 50", answerMatches("guinea", flag, 50) === false);
  ok("...and at 20, just above its 17%", answerMatches("guinea", flag, 20) === false);
  ok("...but 10 lets it through, as the setting promises", answerMatches("guinea", flag, 10) === true);
})();

// ---------------- spelling variants of the same spoken word (v38) ----------------
// The recognizer has to pick one spelling; the card may use another. Reported
// case: "billy elliott" was rejected for "Billy Elliot".
[
  ["billy elliott", "Billy Elliot"],            // the reported case: doubled letter
  ["phillip", "Philip"], ["mathew", "Matthew"], ["alan", "Allan"],
  ["the color purple", "The Colour Purple"],    // -our / -or
  ["national theater", "National Theatre"],     // -re / -er
  ["realize", "Realise"], ["organization", "Organisation"],   // -ise / -ize
  ["catalog", "Catalogue"], ["program", "Programme"], ["gray", "Grey"],
].forEach(([said, card]) =>
  ok("spelling variant accepted: \"" + said + "\" for \"" + card + "\"", answerMatches(said, [card]) === true));

// ...but NOT by edit distance. In a geography deck the classic wrong answers are
// exactly as close to the right ones as Elliott is to Elliot, and a false match
// silently grades a wrong answer Good. These must stay rejected.
[
  ["gambia", "Zambia"], ["iceland", "Ireland"], ["iran", "Iraq"], ["mali", "Bali"],
  ["slovakia", "Slovenia"], ["austria", "Australia"], ["niger", "Nigeria"],
  ["sweden", "Swedes"], ["four", "Tour"],
].forEach(([said, card]) =>
  ok("one-letter-different WRONG answer rejected: \"" + said + "\" for \"" + card + "\"",
     answerMatches(said, [card]) === false));

// The known, accepted cost: different words that differ only by a doubled letter
// now match too. They SOUND different, so answering one for the other is an
// unlikely quiz mistake - unlike Gambia/Zambia. Pinned here so it stays a
// conscious choice rather than a surprise.
ok("known cost: diner matches Dinner", answerMatches("diner", ["Dinner"]) === true);
eq("spellKey leaves short words alone", [spellKey("four"), spellKey("acre"), spellKey("rise")], ["four", "acre", "rise"]);

// The recognizer returns competing hypotheses. Each must be tested on its own:
// concatenating them (pre-v29) produced a phrase that matched nothing.
(() => {
  const hyps = ["bamboo", "bamako", "bam ako"];
  ok("anyAnswerMatches picks the right hypothesis", anyAnswerMatches(hyps, ["Bamako"]) === true);
})();
// Joining the hypotheses is still wrong, though the v31 matcher changed HOW.
// It used to make a phrase that matched nothing; now it pools every guess's
// words together, so the pool can satisfy an answer that no single guess does.
(() => {
  const answer = ["Red Flag"];
  const hyps = ["red", "flag balloon"];
  ok("no single hypothesis is good enough", anyAnswerMatches(hyps, answer, 60) === false);
  ok("...but their pooled words would falsely match", answerMatches(hyps.join(" "), answer, 60) === true);
  ok("anyAnswerMatches stays wrong when it should", anyAnswerMatches(["mali", "molly"], ["Bamako"]) === false);
})();

// ---------------- the spoken-answer length gate ----------------
// The v31 report: "the Half Blood Prince" is four words, the limit defaulted to
// three, so it was dropped with no feedback at all.
(() => {
  const heard = ["the Half Blood Prince"];
  const tight = answerAttempts(heard, 3);
  eq("a 4-word answer fails a limit of 3", tight.attempts, []);
  eq("...and is reported as too long", tight.tooLongWords, 4);
  eq("...with the text, so the UI can show it", tight.tooLongText, "the half blood prince");

  const roomy = answerAttempts(heard, 8);
  eq("the same answer passes the v31 default of 8", roomy.attempts, ["the half blood prince"]);
  eq("nothing is reported as too long", roomy.tooLongWords, 0);
})();
(() => {
  // per hypothesis, so a long alternative never suppresses a short one
  const mixed = answerAttempts(["bamako", "bam ako well now then please"], 3);
  eq("short hypotheses survive a long sibling", mixed.attempts, ["bamako"]);
  eq("the long sibling is still reported", mixed.tooLongWords, 6);
})();
eq("empty hypotheses are ignored", answerAttempts(["", "   "], 8).attempts, []);
eq("punctuation does not inflate the word count",
   answerAttempts(["The Goblet of Fire!"], 4).attempts, ["the goblet of fire"]);
(() => {
  // the shipped default must actually clear a realistic long answer
  const def = /maxAnswerWords:\s*(\d+)/.exec(src);
  ok("maxAnswerWords has a default", !!def);
  const title = "Harry Potter and the Goblet of Fire";   // 7 words
  ok("the default clears a 7-word title",
     answerAttempts([title], Number(def[1])).attempts.length === 1);
})();

// ---------------- editable command vocab ----------------
CFG = { words_hard: "hard, harder, heart", words_answer: "answer, reveal", words_good: "good, yes" };
ok("said built-in hard", said(heardOf("hard"), "hard") === true);
ok("said homophone heart", said(heardOf("heart"), "hard") === true);
ok("said reveal->answer", said(heardOf("reveal"), "answer") === true);
ok("said no false match", said(heardOf("banana"), "hard") === false);
ok("said accepts a hypothesis array", said(["art", "heart"], "hard") === true);
ok("said array with no match", said(["banana", "bandana"], "hard") === false);
ok("said tolerates punctuation", said(["Hard."], "hard") === true);
ok("said tolerates case", said(["HARD"], "hard") === true);
CFG = { words_hard: "hard, harv, hard one" };
ok("said user-added word", said(heardOf("harv"), "hard") === true);
ok("said user-added phrase", said(heardOf("hard one"), "hard") === true);
// a multi-word trigger must live inside ONE hypothesis, not be stitched across two
CFG = { words_hard: "hard one" };
ok("said matches a phrase within one hypothesis", said(["hard one"], "hard") === true);
ok("said does not stitch hypotheses", said(["hard", "one"], "hard") === false);
CFG = { words_hard: "  hard , , heart  " };
ok("said ignores blank vocab entries", said(heardOf("heart"), "hard") === true);
ok("said blank entry matches nothing", said(heardOf("banana"), "hard") === false);

// ---------------- the README's documented behaviour is the real behaviour ----
// Both tables are generated by tools/gen_answer_tables.js; every row is
// re-derived here, so changing the matcher without regenerating fails the suite.
function tableBetween(startMarker, endMarker) {
  const a = readme.indexOf(startMarker);
  const b = readme.indexOf(endMarker);
  ok("README contains " + startMarker, a >= 0 && b > a);
  return readme.slice(a, b).split("\n")
    .filter((l) => l.trim().startsWith("|") && !/^\|[\s-]*\|[\s-]*\|/.test(l))
    .map((l) => l.split("|").slice(1, -1).map((c) => c.trim()));
}
(() => {
  const rows = tableBetween("<!-- ANSWER-CASES:START", "<!-- ANSWER-CASES:END");
  let answer = null, checked = 0;
  for (const cells of rows) {
    if (cells[0] === "The card's answer") continue;           // header
    const m = /\*\*(.+?)\*\*/.exec(cells[0]);
    if (m) answer = m[1];
    if (!answer || cells.length < 5) continue;
    const [, attempt, , at60, at50] = cells;
    assert.strictEqual(answerMatches(attempt, [answer], 60), at60 === "yes",
      "README row wrong at 60%: \"" + attempt + "\" vs \"" + answer + "\"");
    assert.strictEqual(answerMatches(attempt, [answer], 50), at50 === "yes",
      "README row wrong at 50%: \"" + attempt + "\" vs \"" + answer + "\"");
    checked++;
  }
  ok("every documented example row matches the matcher (" + checked + " rows)", checked >= 20);
})();
(() => {
  // the "how much must I say" table, re-derived with synthetic content words
  const WORDS = "alpha bravo charlie delta echo foxtrot golf hotel".split(" ");
  const need = (cell) => (/^all (\d+)$/.exec(cell) ? Number(/^all (\d+)$/.exec(cell)[1])
                                                   : Number(/^(\d+) of \d+$/.exec(cell)[1]));
  const rows = tableBetween("<!-- ANSWER-QUICK:START", "<!-- ANSWER-QUICK:END");
  let checked = 0;
  for (const cells of rows) {
    if (!/^\d+$/.test(cells[0])) continue;                   // skip the header
    const n = Number(cells[0]);
    const answer = WORDS.slice(0, n).join(" ");
    [[60, cells[1]], [50, cells[2]], [80, cells[3]]].forEach(([pct, cell]) => {
      const k = need(cell);
      ok("n=" + n + " at " + pct + "%: saying " + k + " is enough",
         answerMatches(WORDS.slice(0, k).join(" "), [answer], pct) === true);
      if (k > 1) {
        ok("n=" + n + " at " + pct + "%: saying " + (k - 1) + " is not",
           answerMatches(WORDS.slice(0, k - 1).join(" "), [answer], pct) === false);
      }
      checked++;
    });
  }
  ok("the quick-reference table was checked (" + checked + " cells)", checked >= 20);
})();

// ---------------- version consistency ----------------
(() => {
  const header = src.match(/^\s*VERSION:\s*(\d+)\s*$/m);
  ok("header declares a VERSION", !!header);
  const v = header[1];
  // the constant the UI displays must not drift from the header
  const inCode = src.match(/^\s*var AV_VERSION = (\d+);/m);
  ok("the script exposes AV_VERSION", !!inCode);
  eq("AV_VERSION matches the header", inCode[1], v);
  ok("header changelog leads with v" + v, new RegExp("CHANGELOG:\\s*\\n\\s*v" + v + " -").test(src));
  const cur = changelog.match(/^Current:\s*\*\*v(\d+)\*\*\s*$/m);
  ok("CHANGELOG.md declares a current version", !!cur);
  eq("CHANGELOG.md current matches the header", cur[1], v);
  const first = changelog.match(/^## v(\d+)\s*$/m);
  eq("CHANGELOG.md's newest entry matches the header", first[1], v);
})();

console.log("\nAll " + passed + " assertions passed.");
