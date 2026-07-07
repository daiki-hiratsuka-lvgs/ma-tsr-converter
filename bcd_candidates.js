// 不明(法人番号なし)に、国税庁 + 経産省gBiz の緩い一致(B/C/D)で「候補法人番号」を付す。
//   B=会社名+都道府県+市区町村 一致 / C=会社名+都道府県 一致 / D=会社名のみ一致
// ※ B/C/D は誤りの恐れがあるため自動付与はせず、要確認の「候補列」として併記する。
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));
const { normName } = require(path.join(__dirname, "match_util"));

const OUT = path.join(__dirname, "output/final_deliverables");
const TARGET = path.join(OUT, "不明_法人番号なし.csv");
const KOKUZEI = path.join(__dirname, "output/step4.csv");
const DELAY_MS = process.env.DELAY_MS ? Number(process.env.DELAY_MS) : 100;

const nz = (s) => (s || "").normalize("NFKC").replace(/[\s　]/g, "");
const prefOf = (a) => { const m = (a || "").normalize("NFKC").match(/^.*?[都道府県]/); return m ? m[0] : ""; };
const cityOf = (a) => {
  const r = (a || "").normalize("NFKC").replace(/[\s　]/g, "").replace(/^.*?[都道府県]/, "");
  const m = r.match(/^(.+?郡.+?[町村]|.+?市.+?区|.+?[市区町村])/);
  return m ? m[1] : "";
};
// B/C/D 判定
const bcdLevel = (tPref, tCity, cPref, cCity) => {
  if (!tPref || !cPref) return "D";
  if (nz(tPref) !== nz(cPref)) return "D";
  const a = nz(tCity), b = nz(cCity);
  if (a && b && (a === b || a.startsWith(b) || b.startsWith(a))) return "B";
  return "C";
};
const score = { B: 3, C: 2, D: 1 };

// ---- 対象(不明) ----
const parsed = Papa.parse(fs.readFileSync(TARGET, "utf8"), { header: true, skipEmptyLines: true });
const targets = parsed.data.map((r, i) => ({
  i, tsr: r["TSR_companyno__c"] || "", name: r["Name"] || "",
  key: normName(r["Name"]), pref: prefOf(r["CompanyAddress__c"]), city: cityOf(r["CompanyAddress__c"]),
  cands: new Map(), // corp -> {corp,name,addr,level,source}
}));
const byKey = new Map();
targets.forEach((t) => { if (t.key) { if (!byKey.has(t.key)) byKey.set(t.key, []); byKey.get(t.key).push(t); } });

const addCand = (t, c) => {
  const ex = t.cands.get(c.corp);
  if (!ex || score[c.level] > score[ex.level]) t.cands.set(c.corp, c);
};

// ---- ① 国税庁(step4.csv) ストリーミング ----
const runKokuzei = () => new Promise((resolve, reject) => {
  console.log("📋 国税庁データで候補抽出中...");
  let idx = null, n = 0;
  Papa.parse(fs.createReadStream(KOKUZEI, { encoding: "utf8" }), {
    header: false, skipEmptyLines: true,
    step: (row) => {
      const d = row.data;
      if (idx === null) { const h = d.map((x) => x.replace(/^﻿/, "").replace(/"/g, "").trim()); idx = { corp: h.indexOf("corporate_number"), name: h.indexOf("company_name"), pref: h.indexOf("prefecture"), a1: h.indexOf("address1"), a2: h.indexOf("address2"), a3: h.indexOf("address3") }; return; }
      n++;
      const key = normName(d[idx.name] || "");
      const hits = byKey.get(key);
      if (!hits) return;
      const cPref = d[idx.pref] || "", cCity = d[idx.a1] || "";
      const addr = cPref + cCity + (d[idx.a2] || "") + (d[idx.a3] || "");
      const corp = (d[idx.corp] || "").trim();
      if (!corp) return;
      hits.forEach((t) => addCand(t, { corp, name: d[idx.name] || "", addr, level: bcdLevel(t.pref, t.city, cPref, cCity), source: "国税庁" }));
    },
    complete: () => { console.log(`✅ 国税庁 完了: ${n}行走査`); resolve(); },
    error: reject,
  });
});

// ---- ② gBiz API ----
const token = fs.existsSync(path.join(os.homedir(), ".gbiz_token")) ? fs.readFileSync(path.join(os.homedir(), ".gbiz_token"), "utf8").trim() : "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sanitize = (name) => (name || "").normalize("NFKC").replace(/[^0-9A-Za-z぀-ゟ゠-ヿ一-鿿々ー]+/g, " ").replace(/\s+/g, " ").trim();
const searchOnce = (name) => new Promise((resolve) => {
  const url = `https://api.info.gbiz.go.jp/hojin/v2/hojin?name=${encodeURIComponent(name)}`;
  https.get(url, { headers: { "X-hojinInfo-api-token": token, Accept: "application/json" } }, (res) => {
    let data = ""; res.on("data", (c) => (data += c));
    res.on("end", () => { if (res.statusCode !== 200) return resolve({ status: res.statusCode, infos: [] }); try { const j = JSON.parse(data); resolve({ status: 200, infos: j["hojin-infos"] || [] }); } catch (e) { resolve({ status: -1, infos: [] }); } });
  }).on("error", () => resolve({ status: -2, infos: [] }));
});
const searchByName = async (name) => {
  const q = sanitize(name);
  for (let a = 0; a < 4; a++) { const r = await searchOnce(q); if (r.status === 200) return r; if (r.status >= 400 && r.status < 500) return { status: 200, infos: [] }; await sleep(500 * 2 ** a); }
  return { status: -1, infos: [] };
};
const runGbiz = async () => {
  if (!token) { console.log("⚠ gBizトークンなし。gBiz候補はスキップ"); return; }
  console.log(`📋 gBiz APIで候補抽出中... (対象 ${targets.length})`);
  let called = 0, err = 0;
  for (const t of targets) {
    if (!t.name) continue;
    const { status, infos } = await searchByName(t.name);
    called++; if (status !== 200) err++;
    const tk = normName(t.name);
    infos.filter((h) => normName(h.name) === tk).forEach((h) => {
      const corp = (h.corporate_number || "").trim(); if (!corp) return;
      addCand(t, { corp, name: h.name || "", addr: h.location || "", level: bcdLevel(t.pref, t.city, prefOf(h.location), cityOf(h.location)), source: "gBiz" });
    });
    if (called % 100 === 0) console.log(`  gBiz ${called}/${targets.length} (err ${err})`);
    await sleep(DELAY_MS);
  }
  console.log(`✅ gBiz 完了: API呼 ${called} / err ${err}`);
};

// ---- 出力 ----
(async () => {
  await runKokuzei();
  await runGbiz();

  const extra = ["候補_最良レベル", "候補_件数", "候補_法人番号", "候補_詳細"];
  const outFields = [...parsed.meta.fields, ...extra];
  const stat = { B: 0, C: 0, D: 0, なし: 0 };

  parsed.data.forEach((r, i) => {
    const t = targets[i];
    const cands = [...t.cands.values()].sort((a, b) => score[b.level] - score[a.level]);
    if (cands.length === 0) { r["候補_最良レベル"] = ""; r["候補_件数"] = 0; r["候補_法人番号"] = ""; r["候補_詳細"] = ""; stat.なし++; return; }
    const best = cands[0].level; stat[best]++;
    const cap = cands.slice(0, 10);
    r["候補_最良レベル"] = best;
    r["候補_件数"] = cands.length;
    r["候補_法人番号"] = cap.map((c) => c.corp).join(";");
    r["候補_詳細"] = cap.map((c) => `${c.corp}[${c.level}/${c.source}]${c.name}/${c.addr}`).join(" ; ") + (cands.length > cap.length ? ` ; …他${cands.length - cap.length}件` : "");
  });

  fs.writeFileSync(TARGET, Papa.unparse({ fields: outFields, data: parsed.data.map((r) => outFields.map((f) => r[f] ?? "")) }, { quotes: true }));
  console.log("=== 不明への候補付与 完了 ===");
  console.log("最良レベル別:", stat, "/ 候補あり計:", stat.B + stat.C + stat.D, "/ 候補なし:", stat.なし);
})();
