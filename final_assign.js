// 新規全件(step3_insert.csv)の法人番号を 国税庁×gBiz の結果から4段階優先で最終確定
//   1. 国税庁 × SS/S
//   2. 経産省(gBiz) × SS/S
//   3. 国税庁 × A
//   4. 経産省(gBiz) × A
//   採用は「一意に付与」できたもののみ
const fs = require("fs");
const path = require("path");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));

const kokuzeiPath = path.join(__dirname, "output/kokuzei_assigned.csv");
const gbizPath = path.join(__dirname, "output/gbiz_assigned.csv");
const outPath = path.join(__dirname, "output/final_assigned.csv");

const parse = (p) =>
  Papa.parse(fs.readFileSync(p, "utf8"), { header: true, skipEmptyLines: true }).data;

const kokuzei = new Map();
parse(kokuzeiPath).forEach((r) => kokuzei.set(r["TSR_companyno__c"], r));
const gbiz = new Map();
parse(gbizPath).forEach((r) => gbiz.set(r["TSR_companyno__c"], r));

// 付与済みのときのみ (法人番号, レベル) を返す
const confKokuzei = (r) =>
  r && (r["判定"] || "").startsWith("付与")
    ? { corp: r["国税庁法人番号"], level: r["住所一致レベル"] }
    : { corp: "", level: "" };
const confGbiz = (r) =>
  r && (r["判定"] || "").startsWith("付与")
    ? { corp: r["gBiz法人番号"], level: r["住所一致レベル"] }
    : { corp: "", level: "" };

const out = [];
const stat = { "1_国税庁_SSS": 0, "2_gBiz_SSS": 0, "3_国税庁_A": 0, "4_gBiz_A": 0, 未確定: 0 };

for (const [tsr, kRow] of kokuzei) {
  const gRow = gbiz.get(tsr);
  const k = confKokuzei(kRow);
  const g = confGbiz(gRow);

  let finalCorp = "";
  let source = "";
  let level = "";
  let stage = "";
  if (k.level === "SS" || k.level === "S") {
    finalCorp = k.corp; source = "国税庁"; level = k.level; stage = "1"; stat["1_国税庁_SSS"]++;
  } else if (g.level === "SS" || g.level === "S") {
    finalCorp = g.corp; source = "経産省(gBiz)"; level = g.level; stage = "2"; stat["2_gBiz_SSS"]++;
  } else if (k.level === "A") {
    finalCorp = k.corp; source = "国税庁"; level = "A"; stage = "3"; stat["3_国税庁_A"]++;
  } else if (g.level === "A") {
    finalCorp = g.corp; source = "経産省(gBiz)"; level = "A"; stage = "4"; stat["4_gBiz_A"]++;
  } else {
    stat["未確定"]++;
  }

  out.push([
    tsr,
    kRow["会社名"],
    finalCorp,
    source,
    level,
    stage,
    k.corp,
    k.level,
    g.corp,
    g.level,
    finalCorp ? "確定" : "未確定",
  ]);
}

const header = [
  "TSR_companyno__c",
  "会社名",
  "確定法人番号",
  "採用ソース",
  "採用レベル",
  "採用段階",
  "国税庁法人番号",
  "国税庁レベル",
  "gBiz法人番号",
  "gBizレベル",
  "確定状況",
];
fs.writeFileSync(outPath, Papa.unparse({ fields: header, data: out }, { quotes: true }));

const confirmedTotal =
  stat["1_国税庁_SSS"] + stat["2_gBiz_SSS"] + stat["3_国税庁_A"] + stat["4_gBiz_A"];
console.log("=== 4段階 統合結果(新規全件) ===");
console.log(stat);
console.log(`確定合計: ${confirmedTotal} / ${out.length}`);
console.log("出力:", outPath);
