// 不明(法人番号なし)の候補を gBizINFO 詳細API の項目(代表者/設立/郵便/カナ/住所)で裏取りし、
// どの候補が最も確からしいかを「候補」情報として付与する。
// ※方針: 番地一致(SS/S/A)でないB以下は確定させない。法人番号の付与・移動はせず、候補提示のみ。
//   ここではあくまで手動確認を助けるための「gBiz一致項目」列を追加するだけ。
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));
const { normName, bestAddrLevel, parseTsrAddresses } = require(path.join(__dirname, "match_util"));

const ROOT = __dirname;
const OUT = path.join(ROOT, "output/final_deliverables");
const UNK = path.join(OUT, "不明_法人番号なし.csv");
const DELAY_MS = process.env.DELAY_MS ? Number(process.env.DELAY_MS) : 90;
const token = fs.existsSync(path.join(os.homedir(), ".gbiz_token")) ? fs.readFileSync(path.join(os.homedir(), ".gbiz_token"), "utf8").trim() : "";

const nrep = (s) => (s || "").normalize("NFKC").replace(/[\s　・,，.．]/g, "");
const nkana = (s) => (s || "").normalize("NFKC").replace(/[\s　ｰ\-－・]/g, "");
const ym = (s) => { const m = (s || "").replace(/[^0-9]/g, ""); return m.length >= 6 ? m.slice(0, 6) : ""; };
const yy = (s) => { const m = (s || "").match(/\d{4}/); return m ? m[0] : ""; };
const dg = (s) => (s || "").replace(/[^0-9]/g, "");
const prefOf = (a) => { const m = (a || "").normalize("NFKC").match(/^.*?[都道府県]/); return m ? m[0] : ""; };
const cityOf = (a) => { const r = (a || "").normalize("NFKC").replace(/[\s　]/g, "").replace(/^.*?[都道府県]/, ""); const m = r.match(/^(.+?郡.+?[町村]|.+?市.+?区|.+?[市区町村])/); return m ? m[1] : ""; };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const detail = (corp) => new Promise((resolve) => {
  https.get(`https://api.info.gbiz.go.jp/hojin/v2/hojin/${corp}`, { headers: { "X-hojinInfo-api-token": token, Accept: "application/json" } }, (res) => {
    let d = ""; res.on("data", (c) => (d += c));
    res.on("end", () => { if (res.statusCode !== 200) return resolve(null); try { const j = JSON.parse(d); resolve((j["hojin-infos"] || [])[0] || null); } catch (e) { resolve(null); } });
  }).on("error", () => resolve(null));
});

(async () => {
  const NEWCOLS = ["候補_gBiz推奨法人番号", "候補_gBiz一致項目", "候補_gBiz詳細"];
  const parsed = Papa.parse(fs.readFileSync(UNK, "utf8"), { header: true, skipEmptyLines: true });
  const fields = parsed.meta.fields.filter((f) => !NEWCOLS.includes(f)).concat(NEWCOLS);
  if (!token) {
    console.log("⚠ gBizトークンなし。gbiz_confirm スキップ（列のみ空で付与）");
    parsed.data.forEach((r) => NEWCOLS.forEach((c) => (r[c] = "")));
    fs.writeFileSync(UNK, Papa.unparse({ fields, data: parsed.data.map((r) => fields.map((f) => r[f] ?? "")) }, { quotes: true }));
    return;
  }

  const cache = new Map();
  const stat = { withSuggest: 0, rep: 0, found: 0, postal: 0, kana: 0, addr: 0 };
  let calls = 0;

  for (let i = 0; i < parsed.data.length; i++) {
    const r = parsed.data[i];
    const corps = (r["候補_法人番号"] || "").split(";").map((x) => x.trim()).filter((x) => /^\d{13}$/.test(x)).slice(0, 8);
    r["候補_gBiz推奨法人番号"] = ""; r["候補_gBiz一致項目"] = ""; r["候補_gBiz詳細"] = "";
    if (!corps.length) continue;

    const tRep = nrep(r["Representative__c"]);
    const tYm = ym(r["establishmentDate__c"] || r["Sogyonengetsu__c"]);
    const tYy = yy(r["establishmentDate__c"] || r["Sogyonengetsu__c"]);
    const tPostal = dg(r["CompanyPostalCode__c"]);
    const tKana = nkana(r["Kaisyameikana__c"]);
    const tPref = prefOf(r["CompanyAddress__c"]);
    const tAddrs = parseTsrAddresses(r);
    const tName = normName(r["Name"]);

    const scored = [];
    for (const corp of corps) {
      let h = cache.get(corp);
      if (h === undefined) { h = await detail(corp); calls++; cache.set(corp, h); await sleep(DELAY_MS); }
      if (!h || normName(h.name) !== tName) continue;
      const matches = [];
      const gRep = nrep(h.representative_name);
      if (tRep && gRep && tRep === gRep) matches.push("代表者");
      const gYm = ym(h.date_of_establishment), gYy = yy(h.date_of_establishment) || (h.founding_year ? String(h.founding_year) : "");
      if ((tYm && gYm && tYm === gYm) || (tYy && gYy && tYy === gYy)) matches.push("設立");
      const gPostal = dg(h.postal_code);
      if (tPostal && gPostal && tPostal === gPostal) matches.push("郵便");
      const gKana = nkana(h.kana);
      if (tKana && gKana && tKana === gKana) matches.push("カナ");
      const gPref = prefOf(h.location);
      const lvl = bestAddrLevel(tAddrs, h.location || "");
      if (lvl) matches.push("住所" + lvl);
      else if (tPref && gPref && tPref === gPref) matches.push("同県");
      // スコア: 代表者/設立を重く、郵便/カナ次点、住所は既存判定の再掲
      const w = { 代表者: 5, 設立: 4, 郵便: 3, カナ: 2, 住所SS: 3, 住所S: 3, 住所A: 3, 同県: 1 };
      const score = matches.reduce((s, m) => s + (w[m] || 0), 0);
      scored.push({ corp, matches, score });
    }
    if (!scored.length) continue;
    scored.sort((a, b) => b.score - a.score);
    r["候補_gBiz詳細"] = scored.map((s) => `${s.corp}(${s.matches.join("・") || "一致項目なし"})`).join("; ");
    const top = scored[0];
    // 代表者/設立/郵便/カナのいずれか実データ一致がある候補のみ「推奨」として提示（住所/同県だけなら推奨しない）
    const strong = top.matches.filter((m) => ["代表者", "設立", "郵便", "カナ"].includes(m));
    if (strong.length && (scored.length === 1 || top.score > (scored[1]?.score || 0))) {
      r["候補_gBiz推奨法人番号"] = top.corp;
      r["候補_gBiz一致項目"] = top.matches.join("・");
      stat.withSuggest++;
      if (top.matches.includes("代表者")) stat.rep++;
      if (top.matches.includes("設立")) stat.found++;
      if (top.matches.includes("郵便")) stat.postal++;
      if (top.matches.includes("カナ")) stat.kana++;
    }
    if ((i + 1) % 100 === 0) console.log(`  ${i + 1}/${parsed.data.length} 推奨付与${stat.withSuggest} API${calls}`);
  }

  fs.writeFileSync(UNK, Papa.unparse({ fields, data: parsed.data.map((r) => fields.map((f) => r[f] ?? "")) }, { quotes: true }));
  console.log("=== gBiz詳細による候補の裏取り（確定はしない・候補提示のみ） ===");
  console.log("推奨候補を付与:", stat.withSuggest, "件", stat, "/ API呼:", calls);
  console.log("※ 全件 不明 のまま。番地一致(SS/S/A)でないB以下は候補提示に留める。");
})();
