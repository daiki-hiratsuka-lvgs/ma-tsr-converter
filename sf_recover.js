// 不明(法人番号なし)を、Salesforce 既存レコード(extract.csv)の項目で特定/候補抽出する。
// 国税庁/gBizは「社名+住所」しか持たないが、SF は 電話・代表者・郵便・設立年月・資本金・法人番号 を保持。
// TSR側の各項目を SF と突合し、法人番号(houjinbangou__c 等)を継承する。
//
// 出力は2種:
//  【自動採用（厳密特定）】同一市区町村 を必須とし、一意な法人番号に収束したもの
//     Path1(社名一致):   市区町村 + 社名一致   + (電話 or 代表者 or 郵便)
//     Path2(改称疑い):   市区町村 + 設立年月一致 + (電話 or 代表者)     ← 社名が変わっていても同定
//     （設立年月は不変で、グループ各社/別会社とも異なるため、グループ代表電話の共用を弾ける）
//  【候補（要確認）】M&A・買収等で社名/代表者/電話などが変わっている可能性があるため、
//     決め手に欠けるが部分一致するものを候補として提示（自動採用しない）。
//     一致スコア>=4 の組合せ（例: 設立年月+市区町村, 設立年月+資本金, 電話+市区町村 等）。
const fs = require("fs");
const path = require("path");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));
const { normName } = require(path.join(__dirname, "match_util"));

const ROOT = __dirname;
const UNK = path.join(ROOT, "output/final_deliverables/不明_法人番号なし.csv");
const SF = path.join(ROOT, process.argv[2] || "extract.csv");
const OUT = path.join(ROOT, "output/sf_recovered.csv");

const nrep = (s) => (s || "").normalize("NFKC").replace(/[\s　・,，.．]/g, "");
const nphone = (s) => { const d = (s || "").replace(/[^0-9]/g, ""); return d.length >= 9 && d.length <= 11 && !/^(\d)\1+$/.test(d) ? d : ""; };
const dg7 = (s) => { const d = (s || "").replace(/[^0-9]/g, ""); return d.length === 7 ? d : ""; };
const ym = (s) => { const m = (s || "").normalize("NFKC").match(/(\d{4})\D*(\d{1,2})(?!\d)/); return m ? m[1] + m[2].padStart(2, "0") : ""; }; // YYYYMM
const capOf = (s) => { const d = (s || "").replace(/[^0-9]/g, ""); return d && Number(d) > 0 ? d : ""; };
const cityOf = (a) => { const r = (a || "").normalize("NFKC").replace(/[\s　]/g, "").replace(/^.*?[都道府県]/, ""); const m = r.match(/^(.+?郡.+?[町村]|.+?市.+?区|.+?[市区町村])/); return m ? m[1] : ""; };
const validCorp = (s) => { const d = (s || "").replace(/[^0-9]/g, ""); return d.length === 13 && !/^(\d)\1{12}$/.test(d) ? d : ""; };

// ---- 不明(対象) ----
const unk = Papa.parse(fs.readFileSync(UNK, "utf8"), { header: true, skipEmptyLines: true }).data;
const targets = unk.map((r, i) => ({
  i, tsr: r["TSR_companyno__c"] || "", name: r["Name"] || "", key: normName(r["Name"]),
  rep: nrep(r["Representative__c"]), phone: nphone(r["Phone"]), postal: dg7(r["CompanyPostalCode__c"]),
  city: cityOf(r["CompanyAddress__c"]), ym: ym(r["establishmentDate__c"] || r["Sogyonengetsu__c"]), cap: capOf(r["Shihonkin__c"]),
}));
// 逆引き（社名変更・電話変更などに備え、選択性のあるキーで候補を拾う。
// 設立年月だけの結合は「同月創業×同一市区町村」が多すぎてノイズになるため使わない）
const byPhone = new Map(), byRep = new Map(), byName = new Map(), byPostal = new Map();
const add = (m, k, t) => { if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(t); };
targets.forEach((t) => { add(byPhone, t.phone, t); add(byRep, t.rep, t); add(byName, t.key, t); add(byPostal, t.postal, t); });
console.log(`不明 ${targets.length}件 を SF と照合`);

const hits = new Map();
const pushHit = (t, h) => { if (!hits.has(t.i)) hits.set(t.i, []); hits.get(t.i).push(h); };
const W = { 社名: 3, 電話: 3, 設立: 3, 代表者: 2, 郵便: 2, 資本金: 1, 市区町村: 1 };

const SF_PHONE = ["Phone", "CompanyPhnoe__c", "lbc_company_tel__c", "Syachotyakuden__c"];
const SF_CORP = ["houjinbangou__c", "HJBG_CorporateNumber__c", "lbc_corporate_number__c"];
let n = 0, withCorp = 0;
Papa.parse(fs.createReadStream(SF, { encoding: "utf8" }), {
  header: true, skipEmptyLines: true,
  step: (row) => {
    const r = row.data; n++;
    let corp = ""; for (const c of SF_CORP) { corp = validCorp(r[c]); if (corp) break; }
    if (!corp) return;
    withCorp++;
    const sfKey = normName(r["Name"] || r["lbc_company_name__c"]);
    const sfRep = nrep(r["Representative__c"] || r["lbc_representative__c"]);
    const sfPhones = SF_PHONE.map((f) => nphone(r[f])).filter(Boolean);
    const sfPostal = dg7(r["CompanyPostalCode__c"] || r["lbc_company_zip__c"]);
    const sfCity = cityOf(r["CompanyAddress__c"] || "");
    const sfYm = ym(r["establishmentDate__c"] || r["Setsuritsunengetsu__c"] || r["Sogyonengetsu__c"] || r["lbc_setup_date__c"]);
    const sfCap = capOf(r["Shihonkin__c"] || r["lbc_capital__c"]);

    const cand = new Set();
    sfPhones.forEach((p) => (byPhone.get(p) || []).forEach((t) => cand.add(t)));
    (byRep.get(sfRep) || []).forEach((t) => cand.add(t));
    (byName.get(sfKey) || []).forEach((t) => cand.add(t));
    (byPostal.get(sfPostal) || []).forEach((t) => cand.add(t));
    if (!cand.size) return;

    cand.forEach((t) => {
      const cityMatch = t.city && sfCity && (t.city === sfCity || t.city.includes(sfCity) || sfCity.includes(t.city));
      const nameMatch = t.key && sfKey && t.key === sfKey;
      const phoneMatch = t.phone && sfPhones.includes(t.phone);
      const repMatch = t.rep && sfRep && t.rep === sfRep;
      const postalMatch = t.postal && sfPostal && t.postal === sfPostal;
      const foundMatch = t.ym && sfYm && t.ym === sfYm;
      const capMatch = t.cap && sfCap && t.cap === sfCap;
      const fields = [nameMatch && "社名", phoneMatch && "電話", repMatch && "代表者", postalMatch && "郵便", foundMatch && "設立", capMatch && "資本金", cityMatch && "市区町村"].filter(Boolean);
      const score = fields.reduce((s, f) => s + (W[f] || 0), 0);
      const corrob = phoneMatch || repMatch || postalMatch;
      const eligible = cityMatch && ((nameMatch && corrob) || (foundMatch && (phoneMatch || repMatch)));
      // 候補として拾う条件: 識別/所在の強項目(社名/電話/代表者/設立/郵便)が2つ以上一致、または 社名+市区町村。
      // （郵便+資本金+市区町村 のような所在・弱項目だけの偶然一致はノイズなので拾わない）
      const strong = [nameMatch, phoneMatch, repMatch, foundMatch, postalMatch].filter(Boolean).length;
      if (!eligible && !(strong >= 2 || (nameMatch && cityMatch))) return;
      pushHit(t, { corp, sfId: r["Id"] || "", eligible, fields, score, sfName: r["Name"] });
    });
  },
  complete: () => {
    console.log(`SF走査 ${n}行 / 法人番号あり ${withCorp}行`);
    const INSERT_FIELDS = Papa.parse(fs.readFileSync(path.join(ROOT, "output/step3_insert.csv"), "utf8").split("\n")[0]).data[0].map((h) => h.replace(/^﻿/, "").replace(/"/g, "").trim());
    const UPDATE_FIELDS = ["Id", ...INSERT_FIELDS];
    const NEWCOLS = ["SF候補_法人番号", "SF候補_一致項目"];
    const unkFields = (unk.length ? Object.keys(unk[0]) : []).filter((f) => !NEWCOLS.includes(f)).concat(NEWCOLS);

    const audit = [], updateRows = [], keepUnknown = [];
    const stat = { 採用_社名一致: 0, 採用_改称疑い: 0, 候補: 0, 該当なし: 0 };
    targets.forEach((t) => {
      const src = unk[t.i];
      const hs = hits.get(t.i) || [];
      const elig = hs.filter((h) => h.eligible);
      const corps = [...new Set(elig.map((h) => h.corp))];
      const adopt = corps.length === 1;
      const byCorp = new Map();
      hs.forEach((h) => { const cur = byCorp.get(h.corp); if (!cur || h.score > cur.score) byCorp.set(h.corp, h); });
      const candDetail = [...byCorp.values()].sort((a, b) => b.score - a.score).map((h) => `${h.corp}(${h.fields.join("+")})`).join("; ");
      const nameHit = elig.some((h) => h.fields.includes("社名"));
      audit.push({ TSR_companyno__c: t.tsr, Name: t.name, 特定法人番号: adopt ? corps[0] : "", SF_Id: adopt ? (elig.find((h) => h.corp === corps[0]).sfId || "") : "", 判定: adopt ? (nameHit ? "採用_社名一致" : "採用_改称疑い(設立年月)") : (elig.length ? "候補_複数法人番号(要確認)" : (hs.length ? "候補_部分一致(M&A等・要確認)" : "該当なし")), 候補法人番号と一致項目: candDetail, SF側社名例: (elig[0] || hs[0] || {}).sfName || "" });

      if (adopt) {
        // SF既存(Id付き)の重複 → 更新へ
        const row = {}; INSERT_FIELDS.forEach((f) => (row[f] = src[f] ?? "")); row["houjinbangou__c"] = corps[0]; row["Id"] = audit[audit.length - 1].SF_Id;
        updateRows.push(UPDATE_FIELDS.map((f) => row[f] ?? ""));
        stat[nameHit ? "採用_社名一致" : "採用_改称疑い"]++;
      } else {
        // 候補 or 該当なし → 不明に残し、SF候補列を付与
        src["SF候補_法人番号"] = [...byCorp.keys()].join(";");
        src["SF候補_一致項目"] = candDetail;
        keepUnknown.push(src);
        if (hs.length) stat.候補++; else stat.該当なし++;
      }
    });

    // 監査ログ
    fs.writeFileSync(OUT, Papa.unparse(audit, { quotes: true }));
    // 採用分を 更新.csv へ追記（run_all は毎回 step3_update から作り直すので二重追記にならない）
    if (updateRows.length) {
      const upPath = path.join(ROOT, "output/final_deliverables/更新.csv");
      fs.appendFileSync(upPath, updateRows.map((r) => Papa.unparse([r], { header: false, quotes: true })).join("\n") + "\n");
    }
    // 不明を書き戻し（採用分は除外・SF候補列付与）
    keepUnknown.forEach((src) => NEWCOLS.forEach((c) => { if (src[c] === undefined) src[c] = ""; }));
    fs.writeFileSync(UNK, Papa.unparse({ fields: unkFields, data: keepUnknown.map((src) => unkFields.map((f) => src[f] ?? "")) }, { quotes: true }));

    console.log("=== SF照合による特定/候補抽出 ===");
    console.log(stat);
    console.log(`厳密特定→更新へ: ${updateRows.length}件 / 候補列付与で不明に残す: ${keepUnknown.length}件`);
    console.log("監査:", OUT, "/ 更新.csv 追記 / 不明_法人番号なし.csv 更新");
  },
  error: (e) => console.error("ERR", e.message),
});
