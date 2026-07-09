// 追加で厳密確定した「不明」レコード（法人番号を付与）を成果物へ統合する。
// 使い方: node integrate_confirmed.js <confirmed1.csv> [confirmed2.csv ...]
//   各入力は「不明の全列 + 採用法人番号」を持つ。
// 処理: SF(extract.csv)を1回走査し、採用法人番号がSFに存在すれば更新(Id付与)、なければ新規(法人番号あり)へ。
//   統合したTSRは 不明_法人番号なし.csv から除外。
const fs = require("fs");
const path = require("path");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));

const ROOT = __dirname;
const DELIV = path.join(ROOT, "output/final_deliverables");
const UNK = path.join(DELIV, "不明_法人番号なし.csv");
const SF = path.join(ROOT, "extract.csv");
const validCorp = (s) => { const d = (s || "").replace(/[^0-9]/g, ""); return d.length === 13 && !/^(\d)\1{12}$/.test(d) ? d : ""; };

const INSERT_FIELDS = Papa.parse(fs.readFileSync(path.join(ROOT, "output/step3_insert.csv"), "utf8").split("\n")[0]).data[0].map((h) => h.replace(/^﻿/, "").replace(/"/g, "").trim());
const UPDATE_FIELDS = ["Id", ...INSERT_FIELDS];

// 追加確定分を読み込み（TSRでユニーク化）
const byTsr = new Map();
for (const p of process.argv.slice(2)) {
  Papa.parse(fs.readFileSync(p, "utf8"), { header: true, skipEmptyLines: true }).data.forEach((r) => {
    const tsr = r["TSR_companyno__c"], corp = validCorp(r["採用法人番号"]);
    if (tsr && corp && !byTsr.has(tsr)) byTsr.set(tsr, { corp, row: r });
  });
}
const corpSet = new Set([...byTsr.values()].map((v) => v.corp));
console.log(`追加確定: ${byTsr.size}件 / ユニーク法人番号 ${corpSet.size}`);

// SFを走査：採用法人番号がSFに存在するか（→更新Id）を調べる
const SF_CORP = ["houjinbangou__c", "HJBG_CorporateNumber__c", "lbc_corporate_number__c"];
const corpToId = new Map();
let n = 0;
Papa.parse(fs.createReadStream(SF, { encoding: "utf8" }), {
  header: true, skipEmptyLines: true,
  step: (row) => {
    n++; const r = row.data;
    for (const c of SF_CORP) { const cc = validCorp(r[c]); if (cc && corpSet.has(cc) && !corpToId.has(cc)) corpToId.set(cc, r["Id"] || ""); }
  },
  complete: () => {
    console.log(`SF走査 ${n}行 / 採用法人番号がSFに存在: ${corpToId.size}`);
    const upRows = [], insRows = [];
    for (const { corp, row } of byTsr.values()) {
      const base = {}; INSERT_FIELDS.forEach((f) => (base[f] = row[f] ?? "")); base["houjinbangou__c"] = corp;
      if (corpToId.has(corp)) { base["Id"] = corpToId.get(corp); upRows.push(UPDATE_FIELDS.map((f) => base[f] ?? "")); }
      else insRows.push(INSERT_FIELDS.map((f) => base[f] ?? ""));
    }
    // 追記
    const app = (file, rows) => {
      if (!rows.length) return;
      // 既存ファイルが改行で終わっていないと追記行が最終行に結合し破損するため、必ず改行境界を保証する
      try { const fd = fs.openSync(file, "r"); const st = fs.fstatSync(fd); if (st.size) { const b = Buffer.alloc(1); fs.readSync(fd, b, 0, 1, st.size - 1); if (b.toString() !== "\n") fs.appendFileSync(file, "\n"); } fs.closeSync(fd); } catch (e) {}
      fs.appendFileSync(file, rows.map((r) => Papa.unparse([r], { header: false, quotes: true })).join("\n") + "\n");
    };
    app(path.join(DELIV, "更新.csv"), upRows);
    app(path.join(DELIV, "新規.csv"), insRows);
    // 不明から統合分を除外
    const parsed = Papa.parse(fs.readFileSync(UNK, "utf8"), { header: true, skipEmptyLines: true });
    const remain = parsed.data.filter((r) => !byTsr.has(r["TSR_companyno__c"]));
    fs.writeFileSync(UNK, Papa.unparse({ fields: parsed.meta.fields, data: remain.map((r) => parsed.meta.fields.map((f) => r[f] ?? "")) }, { quotes: true }));
    console.log(`更新へ+${upRows.length} / 新規へ+${insRows.length} / 不明 ${parsed.data.length}→${remain.length}`);
  },
  error: (e) => console.error("ERR", e.message),
});
