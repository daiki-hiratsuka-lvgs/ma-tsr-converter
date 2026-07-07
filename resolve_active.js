// 住所SS/S/A一致の候補が「同名・同住所で複数法人番号」に割れて不明化したものを、
// gBizの閉鎖状況で厳密に解決する。address(SS/S/A)+社名一致は同一企業を強く示すので、
// その中で「現存(閉鎖でない)法人番号が一意」なら確定する（閉鎖=旧登記を除外）。
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));
const { addrLevelSingle, parseTsrAddresses } = require(path.join(__dirname, "match_util"));

const ROOT = __dirname;
const UNK = path.join(ROOT, "output/final_deliverables/不明_法人番号なし.csv");
const OUT = path.join(ROOT, "output/resolve_active_confirmed.csv");
const token = fs.existsSync(path.join(os.homedir(), ".gbiz_token")) ? fs.readFileSync(path.join(os.homedir(), ".gbiz_token"), "utf8").trim() : "";
const S = { SS: 3, S: 2, A: 1 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const detail = (corp) => new Promise((resolve) => {
  https.get(`https://api.info.gbiz.go.jp/hojin/v2/hojin/${corp}`, { headers: { "X-hojinInfo-api-token": token, Accept: "application/json" } }, (res) => {
    let d = ""; res.on("data", (c) => (d += c));
    res.on("end", () => { try { resolve((JSON.parse(d)["hojin-infos"] || [])[0] || null); } catch (e) { resolve(null); } });
  }).on("error", () => resolve(null));
});
const parseCand = (s) => (s || "").split(" ; ").map((x) => { const m = x.match(/^(\d{13})\[([^\]]*)\](.+?)\/(.+)$/); return m ? { corp: m[1], name: m[3], addr: m[4] } : null; }).filter(Boolean);
const bestLv = (tsrAddrs, addr) => { let b = null; for (const a of tsrAddrs) { const l = addrLevelSingle(a, addr); if (l && (!b || S[l] > S[b])) b = l; } return b; };

(async () => {
  if (!token) { console.log("⚠ gBizトークンなし"); return; }
  const parsed = Papa.parse(fs.readFileSync(UNK, "utf8"), { header: true, skipEmptyLines: true });
  const cache = new Map();
  const confirmed = [];
  const stat = { 確定_一意現存: 0, 複数現存: 0, 現存なし: 0, 対象外: 0 };
  let calls = 0;

  for (const r of parsed.data) {
    const ta = parseTsrAddresses(r);
    const cands = parseCand(r["候補_詳細"]).map((c) => ({ ...c, alv: bestLv(ta, c.addr) })).filter((c) => c.alv);
    if (!cands.length) { stat.対象外++; continue; }
    // SS/S/A一致の候補について現存(閉鎖でない)を確認
    const active = [];
    for (const c of cands) {
      let h = cache.get(c.corp);
      if (h === undefined) { h = await detail(c.corp); calls++; cache.set(c.corp, h); await sleep(120); }
      const closed = h && (h.close_date || /閉鎖/.test(h.name || ""));
      if (h && !closed) active.push({ ...c, gname: h.name, loc: h.location });
    }
    const uniq = [...new Set(active.map((a) => a.corp))];
    if (uniq.length === 1) {
      const a = active.find((x) => x.corp === uniq[0]);
      confirmed.push({ ...r, __corp: a.corp, __evidence: `住所${a.alv}一致+社名一致+現存一意(他は閉鎖)`, __loc: a.loc });
      stat.確定_一意現存++;
    } else if (uniq.length > 1) stat.複数現存++;
    else stat.現存なし++;
  }

  const fields = [...parsed.meta.fields, "採用法人番号", "確定根拠", "登記住所"];
  fs.writeFileSync(OUT, Papa.unparse({ fields, data: confirmed.map((r) => fields.map((f) => f === "採用法人番号" ? r.__corp : f === "確定根拠" ? r.__evidence : f === "登記住所" ? r.__loc : (r[f] ?? ""))) }, { quotes: true }));
  console.log("=== 住所一致×現存で厳密解決 ===");
  console.log(stat, "/ API:", calls);
  console.log(`確定: ${stat.確定_一意現存}件 -> ${OUT}`);
  if (confirmed.length) confirmed.slice(0, 12).forEach((r) => console.log("  " + (r["Name"] || "").slice(0, 20).padEnd(20) + " → " + r.__corp));
})();
