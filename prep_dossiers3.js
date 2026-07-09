// 残る不明(129)を round-3 最大深度調査用の資料に。前回(round-2)の判定・推奨番号・理由を同梱し、
// AIが「何を試して駄目だったか」を踏まえ別ルート(官報/EDINET/各種許可名簿/企業DB/電話帳逆引き)で攻める。
const fs = require("fs");
const path = require("path");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));
const SCR = path.join(__dirname, "output/dossiers3");
fs.rmSync(SCR, { recursive: true, force: true });
fs.mkdirSync(SCR, { recursive: true });

const rows = Papa.parse(fs.readFileSync(path.join(__dirname, "output/final_deliverables/不明_法人番号なし.csv"), "utf8"), { header: true, skipEmptyLines: true }).data;
const addrCand = JSON.parse(fs.readFileSync(path.join(__dirname, "output/address_candidates.json"), "utf8"));
const parseName = (s) => (s || "").split(" ; ").map((x) => { const m = x.match(/^(\d{13})\[([^\]]*)\](.+?)\/(.+)$/); return m ? { 法人番号: m[1], 登記社名: m[3], 登記住所: m[4] } : null; }).filter(Boolean);
// round-2 の判定(verdicts2)を tsr で引けるように
const V = new Map();
for (let i = 1; i <= 15; i++) { const p = path.join(__dirname, "output/dossiers2/verdicts2_" + String(i).padStart(2, "0") + ".json"); if (fs.existsSync(p)) JSON.parse(fs.readFileSync(p, "utf8")).forEach((v) => { if (v && v.tsr) V.set(String(v.tsr), v); }); }

const dossiers = [];
for (const r of rows) {
  const tsr = r["TSR_companyno__c"];
  const cands = new Map();
  parseName(r["候補_詳細"]).forEach((c) => cands.set(c.法人番号, c));
  (addrCand[tsr] || []).forEach((c) => { if (!cands.has(c.corp)) cands.set(c.corp, { 法人番号: c.corp, 登記社名: c.name, 登記住所: c.addr }); });
  const v = V.get(String(tsr)) || {};
  dossiers.push({
    tsr, 社名: r["Name"], カナ: r["Kaisyameikana__c"],
    本社住所: r["CompanyAddress__c"], オーナー住所: r["OwnerAddress__c"] || "", 営業所: (r["Eigyosho__c"] || "").slice(0, 120),
    代表者: r["Representative__c"], 電話: r["Phone"] || "", 設立: r["establishmentDate__c"] || r["Sogyonengetsu__c"] || "",
    資本金: r["Shihonkin__c"] || "", 従業員: r["NumberOfEmployees"] || "", 業種: r["Eigyosyumoku__c"] || "", URL: r["URL__c"] || "",
    役員: (r["Yakuin__c"] || "").slice(0, 100), 取引銀行: (r["Torihikiginko__c"] || "").slice(0, 80),
    候補: [...cands.values()].slice(0, 12),
    前回判定: v.verdict || r["AI判定_結果"] || "", 前回推奨番号: v.corp || "", 前回理由: (v.reason || r["AI判定_理由"] || "").slice(0, 260),
  });
}

const BATCH = 16;
const manifest = [];
for (let i = 0; i < dossiers.length; i += BATCH) { const idx = manifest.length + 1; fs.writeFileSync(path.join(SCR, "c" + String(idx).padStart(2, "0") + ".json"), JSON.stringify(dossiers.slice(i, i + BATCH), null, 1)); manifest.push(idx); }
console.log("round-3 対象:", dossiers.length, "→", manifest.length, "バッチ(各≤" + BATCH + ") -> output/dossiers3/");
