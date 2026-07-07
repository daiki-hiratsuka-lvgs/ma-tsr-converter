// ① gBiz詳細の多項目突合で「不明」を厳密確定する。
// 候補(候補_法人番号)は既に社名一致。そこへ次を課す:
//   同一市区町村 かつ 代表者/設立年月/郵便 のうち「2項目以上」一致 かつ 法人番号が一意 → 確定。
//   （単項目のみ・市区町村相違・複数法人番号に割れる は確定しない=候補のまま）
// 出力: output/gbiz_strict_confirmed.csv（確定分の 不明行 + 採用法人番号 + 根拠）。※検証用にまず出力のみ。
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));
const { normName } = require(path.join(__dirname, "match_util"));

const ROOT = __dirname;
const UNK = path.join(ROOT, "output/final_deliverables/不明_法人番号なし.csv");
const OUT = path.join(ROOT, "output/gbiz_strict_confirmed.csv");
const DELAY_MS = process.env.DELAY_MS ? Number(process.env.DELAY_MS) : 85;
const token = fs.existsSync(path.join(os.homedir(), ".gbiz_token")) ? fs.readFileSync(path.join(os.homedir(), ".gbiz_token"), "utf8").trim() : "";

const nrep = (s) => (s || "").normalize("NFKC").replace(/[\s　・,，.．]/g, "");
const ym = (s) => { const m = (s || "").normalize("NFKC").match(/(\d{4})\D*(\d{1,2})(?!\d)/); return m ? m[1] + m[2].padStart(2, "0") : ""; };
const dg7 = (s) => { const d = (s || "").replace(/[^0-9]/g, ""); return d.length === 7 ? d : ""; };
const cityOf = (a) => { const r = (a || "").normalize("NFKC").replace(/[\s　]/g, "").replace(/^.*?[都道府県]/, ""); const m = r.match(/^(.+?郡.+?[町村]|.+?市.+?区|.+?[市区町村])/); return m ? m[1] : ""; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const detail = (corp) => new Promise((resolve) => {
  https.get(`https://api.info.gbiz.go.jp/hojin/v2/hojin/${corp}`, { headers: { "X-hojinInfo-api-token": token, Accept: "application/json" } }, (res) => {
    let d = ""; res.on("data", (c) => (d += c));
    res.on("end", () => { if (res.statusCode !== 200) return resolve(null); try { const j = JSON.parse(d); resolve((j["hojin-infos"] || [])[0] || null); } catch (e) { resolve(null); } });
  }).on("error", () => resolve(null));
});

(async () => {
  if (!token) { console.log("⚠ gBizトークンなし"); return; }
  const parsed = Papa.parse(fs.readFileSync(UNK, "utf8"), { header: true, skipEmptyLines: true });
  const cache = new Map();
  const confirmed = [];
  const stat = { 確定: 0, 候補複数: 0, 単項目のみ: 0, 該当なし: 0 };
  let calls = 0;

  for (let i = 0; i < parsed.data.length; i++) {
    const r = parsed.data[i];
    const corps = (r["候補_法人番号"] || "").split(";").map((x) => x.trim()).filter((x) => /^\d{13}$/.test(x)).slice(0, 20);
    if (!corps.length) { stat.該当なし++; continue; }
    const tName = normName(r["Name"]);
    const tRep = nrep(r["Representative__c"]);
    const tYm = ym(r["establishmentDate__c"] || r["Sogyonengetsu__c"]);
    const tPostal = dg7(r["CompanyPostalCode__c"]);
    const tCity = cityOf(r["CompanyAddress__c"]);

    const ok = []; // {corp, matched:[], evidence}
    for (const corp of corps) {
      let h = cache.get(corp);
      if (h === undefined) { h = await detail(corp); calls++; cache.set(corp, h); await sleep(DELAY_MS); }
      if (!h || normName(h.name) !== tName) continue; // 社名一致は必須（候補の前提）
      const cityMatch = tCity && cityOf(h.location) && (tCity === cityOf(h.location) || tCity.includes(cityOf(h.location)) || cityOf(h.location).includes(tCity));
      if (!cityMatch) continue; // 同一市区町村 必須
      const repM = tRep && nrep(h.representative_name) && tRep === nrep(h.representative_name);
      const founM = tYm && ym(h.date_of_establishment) && tYm === ym(h.date_of_establishment);
      const postM = tPostal && dg7(h.postal_code) && tPostal === dg7(h.postal_code);
      const strong = [repM && "代表者", founM && "設立", postM && "郵便"].filter(Boolean);
      if (strong.length >= 2) ok.push({ corp, matched: ["社名", "市区町村", ...strong], rep: h.representative_name, est: h.date_of_establishment });
    }
    const uniq = [...new Set(ok.map((o) => o.corp))];
    if (uniq.length === 1) {
      const o = ok.find((x) => x.corp === uniq[0]);
      confirmed.push({ ...r, __corp: o.corp, __evidence: o.matched.join("+"), __rep: o.rep || "", __est: o.est || "" });
      stat.確定++;
    } else if (uniq.length > 1) stat.候補複数++;
    else stat.単項目のみ++;
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${parsed.data.length} 確定${stat.確定} API${calls}`);
  }

  // 確定分を出力（不明の全列 + 採用法人番号/根拠）
  const fields = [...parsed.meta.fields, "採用法人番号", "確定根拠", "gBiz代表者", "gBiz設立"];
  fs.writeFileSync(OUT, Papa.unparse({ fields, data: confirmed.map((r) => fields.map((f) => f === "採用法人番号" ? r.__corp : f === "確定根拠" ? r.__evidence : f === "gBiz代表者" ? r.__rep : f === "gBiz設立" ? r.__est : (r[f] ?? ""))) }, { quotes: true }));
  console.log("=== ① gBiz多項目突合による厳密確定 ===");
  console.log(stat, "/ API呼:", calls);
  console.log(`確定: ${stat.確定}件 -> ${OUT}`);
})();
