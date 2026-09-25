/*
 * Regenerates the two tables in the README's "What counts as a right answer"
 * section, straight from the shipped matcher.
 *
 *   node tools/gen_answer_tables.js
 *
 * Paste the output between the ANSWER-CASES / ANSWER-QUICK markers in README.md.
 * test/test.js re-checks every row of those tables against the matcher, so they
 * cannot drift silently - if you change the matching rules and forget to
 * regenerate, the suite fails.
 */
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "_ankivoice.js"), "utf8");
function grab(n){const s=src.indexOf("function "+n+"(");const o=src.indexOf("{",s);let d=0,i=o;
for(;i<src.length;i++){if(src[i]==="{")d++;else if(src[i]==="}"&&--d===0){i++;break;}}return src.slice(s,i);}
function grabVar(n){return src.match(new RegExp("var "+n+" = [\\s\\S]*?;\\n"))[0];}
eval(grabVar("AV_PUNCT")); eval(grabVar("AV_STOPWORDS"));
eval(grab("normalize")); eval(grab("spellKey")); eval(grab("contentWords")); eval(grab("hasAll")); eval(grab("answerMatches"));

const yn = (b) => (b ? "yes" : "no");
const groups = [
  { answer: "Bamako", attempts: ["Bamako", "bamako", "it's Bamako", "the capital is Bamako", "Mali"] },
  { answer: "Marie Curie", attempts: ["Marie Curie", "it was Marie Curie", "Curie", "Marie", "Pierre Curie"] },
  { answer: "The United States of America",
    attempts: ["the United States of America", "United States of America", "United States", "America", "United"] },
  { answer: "Harry Potter and the Goblet of Fire",
    attempts: ["Harry Potter and the Goblet of Fire", "the Goblet of Fire", "Goblet of Fire",
               "Harry Potter", "Goblet", "the Half Blood Prince"] },
  { answer: "Flag similar to Guinea and red flipped darker",
    attempts: ["flag similar to Guinea and red flipped darker", "Guinea red flipped darker", "Guinea red", "Guinea"] },
];

let out = "";
out += "| The card's answer | You say | Content words you covered | Accepted at 60% (default) | at 50% |\n";
out += "|---|---|---|---|---|\n";
for (const g of groups) {
  const lw = contentWords(g.answer);
  for (let i = 0; i < g.attempts.length; i++) {
    const a = g.attempts[i], aw = contentWords(a);
    const whole = hasAll(aw, lw);
    let covered = 0;
    for (const w of lw) if (hasAll(aw, [w])) covered++;
    const frac = whole ? "all " + lw.length + " (+ extra)" : covered + " of " + lw.length;
    const shown = i === 0 ? "**" + g.answer + "**<br>(" + lw.length + " content word" + (lw.length > 1 ? "s" : "") + ")" : "";
    out += "| " + shown + " | " + a + " | " + frac + " | " +
           yn(answerMatches(a, [g.answer], 60)) + " | " + yn(answerMatches(a, [g.answer], 50)) + " |\n";
  }
}

let quick = "";
quick += "| Content words in the answer | Must say at 60% (default) | at 50% | at 80% |\n";
quick += "|---|---|---|---|\n";
for (let n = 1; n <= 8; n++) {
  const need = (pct) => {
    for (let k = 1; k <= n; k++) if (k * 100 >= n * pct) return k === n ? "all " + n : k + " of " + n;
    return "all " + n;
  };
  quick += "| " + n + " | " + need(60) + " | " + need(50) + " | " + need(80) + " |\n";
}
console.log(out);
console.log();
console.log(quick);
