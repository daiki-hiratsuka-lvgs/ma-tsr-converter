// 新視点: 残不明の「電話番号」をSF全社と広域突合（市区町村の制約なし）。
// 改称・移転で社名も住所も変わっても、電話番号+代表者が同じなら同一企業を捕捉できる。
// 採用条件(厳密): 電話一致 かつ (社名一致 or 代表者一致) で、収束する法人番号が一意。
//   ※電話のみ(社名も代表者も不一致)は不採用（グループ代表電話の共用を排除）。
const fs = require("fs");
const path = require("path");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));
const { normName } = require(path.join(__dirname, "match_util"));
const ROOT = __dirname;
const UNK = path.join(ROOT, "output/final_deliverables/不明_法人番号なし.csv");
const SF = path.join(ROOT, "extract.csv");
const OUT = path.join(ROOT, "output/phone_rep_candidates.csv");
const nrep = (s) => (s || "").normalize("NFKC").replace(/[\s　・,，.．]/g, "");
const nphone = (s) => { const d = (s || "").replace(/[^0-9]/g, ""); return d.length >= 9 && d.length <= 11 && !/^(\d)\1+$/.test(d) ? d : ""; };
const prefOf = (a) => { const m = (a || "").normalize("NFKC").match(/^.*?[都道府県]/); return m ? m[0] : ""; };
const validCorp = (s) => { const d = (s || "").replace(/[^0-9]/g, ""); return d.length === 13 && !/^(\d)\1{12}$/.test(d) ? d : ""; };

const unk = Papa.parse(fs.readFileSync(UNK, "utf8"), { header: true, skipEmptyLines: true }).data;
const targets = unk.map((r) => ({ tsr: r["TSR_companyno__c"], name: r["Name"], key: normName(r["Name"]), rep: nrep(r["Representative__c"]), phone: nphone(r["Phone"]), pref: prefOf(r["CompanyAddress__c"]) }))
  .filter((t) => t.phone);
const byPhone = new Map();
targets.forEach((t) => { if (!byPhone.has(t.phone)) byPhone.set(t.phone, []); byPhone.get(t.phone).push(t); });
console.log(`不明で電話あり ${targets.length}件 / 電話キー ${byPhone.size}`);

const SF_PHONE = ["Phone", "CompanyPhnoe__c", "lbc_company_tel__c", "Syachotyakuden__c"];
const SF_CORP = ["houjinbangou__c", "HJBG_CorporateNumber__c", "lbc_corporate_number__c"];
const hits = new Map();
let n = 0;
Papa.parse(fs.createReadStream(SF, { encoding: "utf8" }), {
  header: true, skipEmptyLines: true,
  step: (row) => {
    const r = row.data; n++;
    let corp = ""; for (const c of SF_CORP) { corp = validCorp(r[c]); if (corp) break; }
    if (!corp) return;
    const phones = SF_PHONE.map((f) => nphone(r[f])).filter(Boolean);
    if (!phones.length) return;
    const sfKey = normName(r["Name"] || r["lbc_company_name__c"]);
    const sfRep = nrep(r["Representative__c"] || r["lbc_representative__c"]);
    const sfPref = prefOf(r["CompanyAddress__c"] || r["BillingState"] || "");
    for (const p of phones) {
      const ts = byPhone.get(p); if (!ts) continue;
      ts.forEach((t) => {
        const nameM = t.key && sfKey && t.key === sfKey;
        const repM = t.rep && sfRep && t.rep === sfRep;
        if (!nameM && !repM) return; // 電話のみは不採用
        const prefM = t.pref && sfPref && t.pref === sfPref;
        if (!hits.has(t.tsr)) hits.set(t.tsr, []);
        hits.get(t.tsr).push({ corp, sfName: r["Name"], sfRep: r["Representative__c"] || r["lbc_representative__c"], nameM, repM, prefM });
      });
    }
  },
  complete: () => {
    console.log(`SF走査 ${n}行`);
    const out = [];
    let adopt = 0;
    for (const t of targets) {
      const hs = hits.get(t.tsr); if (!hs) continue;
      const corps = [...new Set(hs.map((h) => h.corp))];
      // 採用: 電話+(社名 or 代表者) で一意
      const uniq = corps.length === 1 ? corps[0] : "";
      const best = hs[0];
      out.push({ TSR_companyno__c: t.tsr, Name: t.name, 電話一致法人番号: uniq, 候補一覧: corps.join(";"), 一致: (best.nameM ? "社名" : "") + (best.repM ? "+代表者" : "") + (best.prefM ? "+同県" : ""), SF側社名: best.sfName || "", SF側代表者: best.sfRep || "" });
      if (uniq) adopt++;
    }
    fs.writeFileSync(OUT, Papa.unparse(out, { quotes: true }));
    console.log("=== 電話+社名/代表者 広域リンク ===");
    console.log("電話+(社名/代表者)一致した不明:", out.length, "/ うち法人番号が一意(採用候補):", adopt);
    console.log("出力:", OUT);
    out.filter((o) => o.電話一致法人番号).forEach((o) => console.log("  " + (o.Name || "").slice(0, 18).padEnd(18) + " → " + o.電話一致法人番号 + " [" + o.一致 + "] SF:" + (o.SF側社名 || "").slice(0, 16)));
  },
  error: (e) => console.error("ERR", e.message),
});
