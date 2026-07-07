// 国税庁データ(step4.csv 全件) で 新規全件(step3_insert.csv) に法人番号を厳密突合
// - 判定は SS/S/A（会社名完全一致 + 住所の一致深度）
// - TSRの複数住所（本社・オーナー・営業所）のいずれかが一致すれば同一企業とみなす
// - 一意に付与できたもののみ採用（複数候補・住所A未満は不採用）
const fs = require("fs");
const path = require("path");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));
const {
  normName,
  bestAddrLevel,
  parseTsrAddresses,
  levelScore,
} = require(path.join(__dirname, "match_util"));

const inputPath = path.join(__dirname, "output/step3_insert.csv");
const kokuzeiPath = path.join(__dirname, "output/step4.csv");
const outPath = path.join(__dirname, "output/kokuzei_assigned.csv");

// ---- 対象（新規全件）----
const rows = Papa.parse(fs.readFileSync(inputPath, "utf8"), {
  header: true,
  skipEmptyLines: true,
}).data;
const targets = rows
  .filter((r) => r["TSR_companyno__c"] || r["Name"])
  .map((r) => ({
    tsrNo: r["TSR_companyno__c"] || "",
    name: r["Name"] || "",
    addresses: parseTsrAddresses(r),
  }));
const targetNameSet = new Set(targets.map((t) => normName(t.name)));
console.log(`対象(新規): ${targets.length}件 / ユニーク名称 ${targetNameSet.size}`);

// ---- 国税庁データをストリーミングして対象名称のみ収集 ----
const kokuzeiByName = new Map();
(async () => {
  await new Promise((resolve, reject) => {
    console.log("📋 国税庁データ(step4.csv)を読み込み中...");
    const stream = fs.createReadStream(kokuzeiPath, { encoding: "utf8" });
    let rowCounter = 0;
    let idx = null;
    Papa.parse(stream, {
      header: false,
      skipEmptyLines: true,
      step: (row) => {
        const d = row.data;
        if (rowCounter === 0) {
          const h = d.map((x) => x.replace(/"/g, "").trim());
          idx = {
            corp: h.indexOf("corporate_number"),
            name: h.indexOf("company_name"),
            pref: h.indexOf("prefecture"),
            a1: h.indexOf("address1"),
            a2: h.indexOf("address2"),
            a3: h.indexOf("address3"),
          };
        } else {
          const name = d[idx.name] || "";
          const key = normName(name);
          if (targetNameSet.has(key)) {
            const location =
              (d[idx.pref] || "") +
              (d[idx.a1] || "") +
              (d[idx.a2] || "") +
              (d[idx.a3] || "");
            if (!kokuzeiByName.has(key)) kokuzeiByName.set(key, []);
            kokuzeiByName.get(key).push({ corp: d[idx.corp] || "", name, location });
          }
        }
        rowCounter++;
      },
      complete: () => {
        console.log(`✅ 国税庁読み込み完了: ${rowCounter - 1}行 / 対象名称ヒット ${kokuzeiByName.size}種`);
        resolve();
      },
      error: reject,
    });
  });

  const out = [];
  const stat = { SS: 0, S: 0, A: 0, multi: 0, addrNg: 0, none: 0 };
  targets.forEach((t) => {
    const cands = kokuzeiByName.get(normName(t.name)) || [];
    cands.forEach((c) => (c._level = bestAddrLevel(t.addresses, c.location)));
    const withAddr = cands.filter((c) => c._level);
    let chosen = null;
    let level = "";
    let judge;
    if (withAddr.length > 0) {
      const best = Math.max(...withAddr.map((c) => levelScore[c._level]));
      const bestCands = withAddr.filter((c) => levelScore[c._level] === best);
      if (bestCands.length === 1) {
        chosen = bestCands[0];
        level = chosen._level;
        judge = `付与(${level})`;
        stat[level]++;
      } else {
        chosen = bestCands[0];
        level = chosen._level;
        judge = `複数候補(${level}同点・要確認)`;
        stat.multi++;
      }
    } else if (cands.length > 0) {
      chosen = cands[0];
      judge = "該当なし(住所がA未満)";
      stat.addrNg++;
    } else {
      judge = "該当なし(名称不一致)";
      stat.none++;
    }
    out.push([
      t.tsrNo,
      t.name,
      judge.startsWith("付与") && chosen ? chosen.corp : "",
      chosen ? chosen.name : "",
      chosen ? chosen.location : "",
      t.addresses.join(" | "),
      level,
      cands.length,
      judge,
    ]);
  });

  const header = [
    "TSR_companyno__c",
    "会社名",
    "国税庁法人番号",
    "国税庁会社名",
    "国税庁住所",
    "TSR住所(全)",
    "住所一致レベル",
    "名称一致候補数",
    "判定",
  ];
  fs.writeFileSync(outPath, Papa.unparse({ fields: header, data: out }, { quotes: true }));
  console.log("=== 国税庁 完了 ===");
  console.log({ total: targets.length, ...stat });
  console.log("出力:", outPath);
})();
