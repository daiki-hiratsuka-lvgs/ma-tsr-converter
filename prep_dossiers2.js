// 残る不明(493)を「より深い多面調査」用の資料に再編。
// 前回の判定(AI判定_結果/理由)・社名候補(候補_詳細)・住所候補(address_candidates)・SF候補 を同梱し、
// AIが前回の続きから、複数の独立情報源で法人番号を厳密特定できるようにする。
const fs = require("fs");
const path = require("path");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));
const SCR = path.join(__dirname, "output/dossiers2");
fs.rmSync(SCR, { recursive: true, force: true });
fs.mkdirSync(SCR, { recursive: true });

const rows = Papa.parse(fs.readFileSync(path.join(__dirname, "output/final_deliverables/不明_法人番号なし.csv"), "utf8"), { header: true, skipEmptyLines: true }).data;
const addrCand = JSON.parse(fs.readFileSync(path.join(__dirname, "output/address_candidates.json"), "utf8"));
const parseName = (s) => (s || "").split(" ; ").map((x) => { const m = x.match(/^(\d{13})\[([^\]]*)\](.+?)\/(.+)$/); return m ? { 法人番号: m[1], 登記社名: m[3], 登記住所: m[4] } : null; }).filter(Boolean);

const dossiers = [];
for (const r of rows) {
  const tsr = r["TSR_companyno__c"];
  const cands = new Map();
  parseName(r["候補_詳細"]).forEach((c) => cands.set(c.法人番号, c));
  (addrCand[tsr] || []).forEach((c) => { if (!cands.has(c.corp)) cands.set(c.corp, { 法人番号: c.corp, 登記社名: c.name, 登記住所: c.addr }); });
  dossiers.push({
    tsr, 社名: r["Name"], カナ: r["Kaisyameikana__c"],
    本社住所: r["CompanyAddress__c"], オーナー住所: r["OwnerAddress__c"] || "", 営業所: (r["Eigyosho__c"] || "").slice(0, 120),
    代表者: r["Representative__c"], 電話: r["Phone"] || "", 設立: r["establishmentDate__c"] || r["Sogyonengetsu__c"] || "",
    資本金: r["Shihonkin__c"] || "", 従業員: r["NumberOfEmployees"] || "", 業種: r["Eigyosyumoku__c"] || "", URL: r["URL__c"] || "",
    社名候補: [...cands.values()].slice(0, 15),
    SF候補: r["SF候補_一致項目"] || "",
    前回判定: r["AI判定_結果"] || "(未判定)", 前回理由: (r["AI判定_理由"] || "").slice(0, 220),
  });
}

const BATCH = 33;
const manifest = [];
for (let i = 0; i < dossiers.length; i += BATCH) {
  const idx = manifest.length + 1;
  fs.writeFileSync(path.join(SCR, `b${String(idx).padStart(2, "0")}.json`), JSON.stringify(dossiers.slice(i, i + BATCH), null, 1));
  manifest.push({ batch: idx, count: Math.min(BATCH, dossiers.length - i) });
}
console.log(`再調査対象 ${dossiers.length}件 → ${manifest.length}バッチ(各≤${BATCH}) を output/dossiers2/ に出力`);
