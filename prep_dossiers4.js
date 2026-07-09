// round-4: 残不明(90)を新情報源で攻めるための資料。前回理由＋電話リンク候補＋監査示唆を同梱。
const fs = require("fs");
const path = require("path");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));
const SCR = path.join(__dirname, "output/dossiers4");
fs.rmSync(SCR, { recursive: true, force: true });
fs.mkdirSync(SCR, { recursive: true });

const rows = Papa.parse(fs.readFileSync(path.join(__dirname, "output/final_deliverables/不明_法人番号なし.csv"), "utf8"), { header: true, skipEmptyLines: true }).data;
// round-3 の判定/理由
const V = new Map();
for (let i = 1; i <= 9; i++) { const p = path.join(__dirname, "output/dossiers3/cres_" + String(i).padStart(2, "0") + ".json"); if (fs.existsSync(p)) JSON.parse(fs.readFileSync(p, "utf8")).forEach((v) => { if (v && v.tsr) V.set(String(v.tsr), v); }); }
// 電話リンク候補
const PR = new Map();
if (fs.existsSync(path.join(__dirname, "output/phone_rep_candidates.csv"))) Papa.parse(fs.readFileSync(path.join(__dirname, "output/phone_rep_candidates.csv"), "utf8"), { header: true, skipEmptyLines: true }).data.forEach((r) => PR.set(String(r["TSR_companyno__c"]), r));

const dossiers = [];
for (const r of rows) {
  const tsr = String(r["TSR_companyno__c"]);
  const v = V.get(tsr) || {};
  const pr = PR.get(tsr);
  dossiers.push({
    tsr, 社名: r["Name"], カナ: r["Kaisyameikana__c"], 代表者カナ: r["Daihyosyameikana__c"] || "",
    本社住所: r["CompanyAddress__c"], オーナー住所: r["OwnerAddress__c"] || "", 営業所: (r["Eigyosho__c"] || "").slice(0, 120),
    代表者: r["Representative__c"], 電話: r["Phone"] || "", 設立: r["establishmentDate__c"] || r["Sogyonengetsu__c"] || "",
    資本金: r["Shihonkin__c"] || "", 従業員: r["NumberOfEmployees"] || "", 業種: r["Eigyosyumoku__c"] || "", URL: r["URL__c"] || "",
    役員: (r["Yakuin__c"] || "").slice(0, 120), 取引銀行: (r["Torihikiginko__c"] || "").slice(0, 80), 大株主: (r["Daikabunushi__c"] || "").slice(0, 80),
    前回結果: v.result || "", 前回理由: (v.reason || "").slice(0, 260),
    電話リンク候補: pr ? { 法人番号: pr["電話一致法人番号"] || pr["候補一覧"], 一致: pr["一致"], SF側社名: pr["SF側社名"], SF側代表者: pr["SF側代表者"] } : null,
  });
}

const BATCH = 15;
const manifest = [];
for (let i = 0; i < dossiers.length; i += BATCH) { const idx = manifest.length + 1; fs.writeFileSync(path.join(SCR, "d" + String(idx).padStart(2, "0") + ".json"), JSON.stringify(dossiers.slice(i, i + BATCH), null, 1)); manifest.push(idx); }
console.log("round-4 対象:", dossiers.length, "→", manifest.length, "バッチ(各≤" + BATCH + ")");
