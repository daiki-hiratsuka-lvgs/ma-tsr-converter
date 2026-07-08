// AI判定(verdicts_*.json)を回収し、confirm(high) を統合用CSVに変換する。
//   - 採用: verdict=confirm かつ confidence=high のみ（medium/uncertain は不明に残す）
//   - 出力1: output/ai_confirmed.csv（不明の全列 + 採用法人番号 + 確定根拠）→ integrate_confirmed.js に渡す
//   - 出力2: 不明_法人番号なし.csv に AI判定_結果/AI判定_理由 列を付与（confirm(medium)/uncertain/reject の記録）
const fs = require("fs");
const path = require("path");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));

const ROOT = __dirname;
const SCR = path.join(ROOT, "output/dossiers");
const UNK = path.join(ROOT, "output/final_deliverables/不明_法人番号なし.csv");
const OUT = path.join(ROOT, "output/ai_confirmed.csv");
const validCorp = (s) => { const d = (s || "").replace(/[^0-9]/g, ""); return d.length === 13 && !/^(\d)\1{12}$/.test(d) ? d : ""; };

// verdicts を全部読み込み（tsr -> verdict、後勝ちしない=最初を採用）
const byTsr = new Map();
const files = fs.readdirSync(SCR).filter((f) => /^verdicts_\d+\.json$/.test(f)).sort();
let malformed = 0;
for (const f of files) {
  let arr;
  try { arr = JSON.parse(fs.readFileSync(path.join(SCR, f), "utf8")); } catch (e) { console.log(`⚠ ${f} parse失敗`); continue; }
  if (!Array.isArray(arr)) { console.log(`⚠ ${f} 配列でない`); continue; }
  for (const v of arr) {
    if (!v || !v.tsr) { malformed++; continue; }
    if (!byTsr.has(String(v.tsr))) byTsr.set(String(v.tsr), v);
  }
}
console.log(`verdictファイル ${files.length} / 判定 ${byTsr.size}件 / 不正 ${malformed}`);

const stat = { confirm_high: 0, confirm_medium: 0, confirm_low: 0, reject: 0, uncertain: 0, corp不正: 0 };
for (const v of byTsr.values()) {
  if (v.verdict === "confirm") {
    const c = validCorp(v.corp);
    if (!c) { stat.corp不正++; v.verdict = "uncertain"; v.reason = "(corp不正) " + (v.reason || ""); continue; }
    stat["confirm_" + (v.confidence || "low")] = (stat["confirm_" + (v.confidence || "low")] || 0) + 1;
  } else stat[v.verdict] = (stat[v.verdict] || 0) + 1;
}
console.log(stat);

// 不明を読み、confirm(high)を分離
const parsed = Papa.parse(fs.readFileSync(UNK, "utf8"), { header: true, skipEmptyLines: true });
const NEWCOLS = ["AI判定_結果", "AI判定_理由"];
const unkFields = parsed.meta.fields.filter((f) => !NEWCOLS.includes(f)).concat(NEWCOLS);
const confirmedRows = [], remain = [];
for (const r of parsed.data) {
  const v = byTsr.get(String(r["TSR_companyno__c"]));
  if (v && v.verdict === "confirm" && v.confidence === "high" && validCorp(v.corp)) {
    confirmedRows.push({ ...r, 採用法人番号: validCorp(v.corp), 確定根拠: "AI登記調査: " + (v.reason || "").slice(0, 200) });
  } else {
    r["AI判定_結果"] = v ? (v.verdict === "confirm" ? `confirm(${v.confidence})` : v.verdict) : "";
    r["AI判定_理由"] = v ? (v.reason || "").slice(0, 200) : "";
    remain.push(r);
  }
}
const outFields = [...parsed.meta.fields.filter((f) => !NEWCOLS.includes(f)), "採用法人番号", "確定根拠"];
fs.writeFileSync(OUT, Papa.unparse({ fields: outFields, data: confirmedRows.map((r) => outFields.map((f) => r[f] ?? "")) }, { quotes: true }));
fs.writeFileSync(UNK, Papa.unparse({ fields: unkFields, data: remain.map((r) => unkFields.map((f) => r[f] ?? "")) }, { quotes: true }));
console.log(`confirm(high)→統合用: ${confirmedRows.length}件 -> ${OUT}`);
console.log(`不明(残・AI判定列付き): ${remain.length}件`);
console.log("次: node integrate_confirmed.js output/ai_confirmed.csv");
