// 不明(法人番号なし)に対し、国税庁 step4.csv を「住所」で検索して候補を出す。
// 社名一致は問わない → 社名変更(改称)で現登記名がTSRと違っても、住所(番地)が同じなら拾える。
// TSRの複数住所(本社/オーナー/営業所)を全て使う。SS/S(番地一致)を主、A(町丁)も記録。
const fs = require("fs");
const path = require("path");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));
const { normAddr, normName, parseTsrAddresses } = require(path.join(__dirname, "match_util"));

const ROOT = __dirname;
const UNK = path.join(ROOT, "output/final_deliverables/不明_法人番号なし.csv");
const STEP4 = path.join(ROOT, "output/step4.csv");
const OUT = path.join(ROOT, "output/address_candidates.json");

const choChome = (a) => a.replace(/[\d-]+$/g, "");
const nfk = (s) => (s || "").normalize("NFKC").replace(/[\s　]/g, "");
const prefOf = (a) => { const m = (a || "").normalize("NFKC").match(/^.*?[都道府県]/); return m ? m[0] : ""; };
const cityOf = (a) => { const r = (a || "").normalize("NFKC").replace(/[\s　]/g, "").replace(/^.*?[都道府県]/, ""); const m = r.match(/^(.+?郡.+?[町村]|.+?市.+?区|.+?[市区町村])/); return m ? m[1] : ""; };

// 不明を読み、住所を正規化して市区町村バケットに登録
const rows = Papa.parse(fs.readFileSync(UNK, "utf8"), { header: true, skipEmptyLines: true }).data;
const bucket = new Map(); // pref+city -> [target]
const targets = rows.map((r) => {
  const addrs = parseTsrAddresses(r);
  const norm = addrs.map(normAddr).filter(Boolean);
  const t = { tsr: r["TSR_companyno__c"], name: r["Name"], key: normName(r["Name"]), norm, cho: norm.map(choChome), cities: [...new Set(addrs.map((a) => nfk(prefOf(a) + cityOf(a))).filter((k) => k.length > 2))], hits: [] };
  t.cities.forEach((c) => { if (!bucket.has(c)) bucket.set(c, []); bucket.get(c).push(t); });
  return t;
});
console.log(`不明 ${targets.length}件 / 市区町村バケット ${bucket.size}`);

const level = (bN, t) => {
  if (t.norm.includes(bN)) return "SS";
  for (const a of t.norm) if (a.startsWith(bN) || bN.startsWith(a)) return "S";
  const bc = choChome(bN);
  for (const c of t.cho) if (c && c === bc) return "A";
  return null;
};

let n = 0, idx = null, scanned = 0;
Papa.parse(fs.createReadStream(STEP4, { encoding: "utf8" }), {
  header: false, skipEmptyLines: true,
  step: (row) => {
    const d = row.data;
    if (idx === null) { const h = d.map((x) => x.replace(/^﻿/, "").replace(/"/g, "").trim()); idx = { corp: h.indexOf("corporate_number"), name: h.indexOf("company_name"), pref: h.indexOf("prefecture"), a1: h.indexOf("address1"), a2: h.indexOf("address2"), a3: h.indexOf("address3") }; return; }
    n++;
    const key = nfk((d[idx.pref] || "") + (d[idx.a1] || ""));
    const b = bucket.get(key); if (!b) return;
    const loc = (d[idx.pref] || "") + (d[idx.a1] || "") + (d[idx.a2] || "") + (d[idx.a3] || "");
    const bN = normAddr(loc); if (!bN) return;
    scanned++;
    const cname = d[idx.name] || "", corp = d[idx.corp] || "";
    for (const t of b) {
      const lv = level(bN, t);
      if (lv) t.hits.push({ corp, name: cname, addr: loc, level: lv, nameMatch: normName(cname) === t.key });
    }
  },
  complete: () => {
    const out = {};
    let withHit = 0, withRename = 0, ssS = 0;
    for (const t of targets) {
      if (!t.hits.length) continue;
      // SS/S/A 優先で整列、上位12件
      const rank = { SS: 3, S: 2, A: 1 };
      t.hits.sort((a, b2) => rank[b2.level] - rank[a.level]);
      const top = t.hits.slice(0, 12);
      out[t.tsr] = top;
      withHit++;
      if (top.some((h) => h.level === "SS" || h.level === "S")) ssS++;
      if (top.some((h) => !h.nameMatch && (h.level === "SS" || h.level === "S"))) withRename++;
    }
    fs.writeFileSync(OUT, JSON.stringify(out));
    console.log(`step4走査 ${n}行 / 同一市区町村で照合 ${scanned}`);
    console.log(`住所候補あり ${withHit}件 / うちSS-S(番地一致)あり ${ssS}件 / うち改称候補(番地一致だが社名不一致) ${withRename}件`);
    console.log("出力:", OUT);
  },
  error: (e) => console.error("ERR", e.message),
});
