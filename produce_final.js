// 確定版出力：新規全件(step3_insert.csv)に 4段階確定した法人番号を反映して出力
// - houjinbangou__c を確定法人番号で更新（未確定は空欄）
// - 末尾に採用ソース・採用レベル・確定状況を付与（追跡用）
const fs = require("fs");
const path = require("path");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));

const inputPath = path.join(__dirname, "output/step3_insert.csv");
const finalPath = path.join(__dirname, "output/final_assigned.csv");
const outAllPath = path.join(__dirname, "output/final_kakutei.csv");
const outConfirmedPath = path.join(__dirname, "output/final_kakutei_confirmed.csv");
const outUnknownPath = path.join(__dirname, "output/final_kakutei_unknown.csv");

// 確定情報を TSR番号 でマップ化
const finalRows = Papa.parse(fs.readFileSync(finalPath, "utf8"), {
  header: true,
  skipEmptyLines: true,
}).data;
const finalMap = new Map();
finalRows.forEach((r) =>
  finalMap.set(r["TSR_companyno__c"], {
    corp: r["確定法人番号"] || "",
    source: r["採用ソース"] || "",
    level: r["採用レベル"] || "",
    status: r["確定状況"] || "",
  }),
);

// step3_insert を読み込み（全列保持）
const parsed = Papa.parse(fs.readFileSync(inputPath, "utf8"), {
  header: true,
  skipEmptyLines: true,
});
const fields = parsed.meta.fields.slice();
const extra = ["法人番号_採用ソース", "法人番号_採用レベル", "法人番号_確定状況"];
const outFields = [...fields, ...extra];

const allRows = [];
const confirmedRows = [];
const unknownRows = [];
let confirmed = 0;
parsed.data.forEach((r) => {
  const info = finalMap.get(r["TSR_companyno__c"]) || {
    corp: "",
    source: "",
    level: "",
    status: "未確定",
  };
  // 確定法人番号を反映（未確定は空欄）
  r["houjinbangou__c"] = info.corp;
  r["法人番号_採用ソース"] = info.source;
  r["法人番号_採用レベル"] = info.level;
  r["法人番号_確定状況"] = info.corp ? "確定" : "未確定";
  allRows.push(r);
  if (info.corp) {
    confirmed++;
    confirmedRows.push(r);
  } else {
    unknownRows.push(r);
  }
});

const toCsv = (rows) =>
  Papa.unparse({ fields: outFields, data: rows.map((r) => outFields.map((f) => r[f] ?? "")) }, { quotes: true });

fs.writeFileSync(outAllPath, toCsv(allRows));
fs.writeFileSync(outConfirmedPath, toCsv(confirmedRows));
fs.writeFileSync(outUnknownPath, toCsv(unknownRows));

console.log("=== 確定版 出力完了 ===");
console.log(`全件: ${allRows.length} 件 -> ${outAllPath}`);
console.log(`確定のみ: ${confirmed} 件 -> ${outConfirmedPath}`);
console.log(`不明(法人番号なし): ${unknownRows.length} 件 -> ${outUnknownPath}`);
