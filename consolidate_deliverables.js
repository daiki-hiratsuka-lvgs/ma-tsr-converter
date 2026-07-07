// 成果物を4種類に集約する（厳密正規化版パイプライン: 国税庁/gBiz SS/S/A のみ採用）。
//   ① 更新  = step3_update(既存TSR一致) + step6(確定→SF既存)
//   ② 新規  = step6(確定→SF未存在)
//   ③ 要確認_重複 = step6(SF側で一意化不可)
//   ④ 不明_法人番号なし = 4段階で確定できなかった新規(B/C/D候補列付き)  ← 既に配置済み
// 更新.csv は事前に step3_update.csv をコピー(ヘッダ列=UPDATE_FIELDS)しておくこと。
const fs = require("fs");
const path = require("path");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));
const ROOT = __dirname;
const OUT = path.join(ROOT, "output/final_deliverables");
const CF = process.argv[2]; // 確定分の step6 出力ディレクトリ

const insHeaderLine = fs.readFileSync(path.join(ROOT, "output/step3_insert.csv"), "utf8").split("\n")[0];
const INSERT_FIELDS = Papa.parse(insHeaderLine).data[0].map((h) => h.replace(/^﻿/, "").replace(/"/g, "").trim());
const UPDATE_FIELDS = ["Id", ...INSERT_FIELDS];
const DUP_FIELDS = [...INSERT_FIELDS, "SF候補Id"];

const readObjs = (p) => Papa.parse(fs.readFileSync(p, "utf8"), { header: true, skipEmptyLines: true }).data;
const line = (o, f) => Papa.unparse([f.map((x) => o[x] ?? "")], { header: false, quotes: true }) + "\n";
const writeCsv = (file, fields, rows) => fs.writeFileSync(file, Papa.unparse([fields], { header: false, quotes: true }) + "\n" + rows.map((o) => line(o, fields)).join(""));

// ① 更新: 種(step3_update)へ step6/update を追記（3列の追跡列は落として UPDATE_FIELDS に整形）
const upRows = readObjs(path.join(CF, "update.csv"));
fs.appendFileSync(path.join(OUT, "更新.csv"), upRows.map((o) => line(o, UPDATE_FIELDS)).join(""));
// ② 新規
const insRows = readObjs(path.join(CF, "insert.csv"));
writeCsv(path.join(OUT, "新規.csv"), INSERT_FIELDS, insRows);
// ③ 要確認_重複
const dupRows = readObjs(path.join(CF, "duplicate.csv"));
writeCsv(path.join(OUT, "要確認_重複.csv"), DUP_FIELDS, dupRows);

console.log("① 更新 += step6/update", upRows.length, "(+ step3_update 489,863)");
console.log("② 新規:", insRows.length);
console.log("③ 要確認_重複:", dupRows.length);
console.log("④ 不明_法人番号なし: (bcd注釈済みのまま)");
