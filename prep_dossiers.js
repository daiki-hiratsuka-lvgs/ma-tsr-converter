// 不明を AIエージェント判定用の資料バッチに分割。
// 候補 = 社名ベース(候補_詳細) + 住所ベース(address_candidates.json) を統合。
// 住所ベースは社名不一致でも含める（改称=社名変更・住所同じ を拾うため）。
const fs = require("fs");
const path = require("path");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));
const SCR = "/private/tmp/claude-502/-Users-daiki-hiratsuka-Documents-dev-MA-ma-tsr-converter/5094ab0e-98b8-463d-90f1-1fee0c15468a/scratchpad/dossiers";
fs.rmSync(SCR, { recursive: true, force: true });
fs.mkdirSync(SCR, { recursive: true });

const rows = Papa.parse(fs.readFileSync(path.join(__dirname, "output/final_deliverables/不明_法人番号なし.csv"), "utf8"), { header: true, skipEmptyLines: true }).data;
const addrCand = JSON.parse(fs.readFileSync(path.join(__dirname, "output/address_candidates.json"), "utf8"));
const parseName = (s) => (s || "").split(" ; ").map((x) => { const m = x.match(/^(\d{13})\[([^\]]*)\](.+?)\/(.+)$/); return m ? { corp: m[1], lv: m[2], name: m[3], addr: m[4] } : null; }).filter(Boolean);
const RANK = { "住所SS": 5, "住所S": 4, "社名": 3, "住所A": 2 };

const dossiers = [];
for (const r of rows) {
  const tsr = r["TSR_companyno__c"];
  const byCorp = new Map();
  // 社名ベース候補
  parseName(r["候補_詳細"]).forEach((c) => { byCorp.set(c.corp, { 法人番号: c.corp, 登記社名: c.name, 登記住所: c.addr, 一致: ["社名(" + c.lv + ")"], _r: RANK["社名"] }); });
  // 住所ベース候補（社名不一致でも）
  (addrCand[tsr] || []).forEach((c) => {
    const tag = "住所" + c.level + (c.nameMatch ? "・社名一致" : "・社名不一致(改称?)");
    if (byCorp.has(c.corp)) { const e = byCorp.get(c.corp); e.一致.push("住所" + c.level); e._r = Math.max(e._r, RANK["住所" + c.level] || 0); }
    else byCorp.set(c.corp, { 法人番号: c.corp, 登記社名: c.name, 登記住所: c.addr, 一致: [tag], _r: RANK["住所" + c.level] || 0 });
  });
  const cands = [...byCorp.values()].sort((a, b) => b._r - a._r).slice(0, 8).map(({ _r, ...c }) => c);
  if (!cands.length) continue;
  dossiers.push({
    tsr, 社名: r["Name"], カナ: r["Kaisyameikana__c"],
    本社住所: r["CompanyAddress__c"], オーナー住所: r["OwnerAddress__c"] || "", 営業所: (r["Eigyosho__c"] || "").slice(0, 120),
    代表者: r["Representative__c"], 電話: r["Phone"] || "", 設立: r["establishmentDate__c"] || r["Sogyonengetsu__c"] || "",
    資本金: r["Shihonkin__c"] || "", 従業員: r["NumberOfEmployees"] || "", 業種: r["Eigyosyumoku__c"] || "",
    候補: cands,
  });
}

const BATCH = 45;
const manifest = [];
for (let i = 0; i < dossiers.length; i += BATCH) {
  const idx = manifest.length + 1;
  const p = path.join(SCR, `batch_${String(idx).padStart(2, "0")}.json`);
  fs.writeFileSync(p, JSON.stringify(dossiers.slice(i, i + BATCH), null, 1));
  manifest.push({ batch: idx, count: Math.min(BATCH, dossiers.length - i) });
}
console.log(`判定対象 ${dossiers.length}件 → ${manifest.length}バッチ(各≤${BATCH})`);
const rc = dossiers.filter((d) => d.候補.some((c) => c.一致.some((x) => x.includes("改称")))).length;
console.log(`うち改称候補(住所一致・社名不一致)を含む: ${rc}件`);
