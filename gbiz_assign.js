// gBizINFO(経産省) で 新規全件(step3_insert.csv) に法人番号を厳密突合
// - 国税庁で SS/S 確定済みの企業は上位確定のためスキップ（API節約）
// - 判定は SS/S/A（会社名完全一致 + 住所の一致深度）
// - TSRの複数住所（本社・オーナー・営業所）のいずれか一致でOK
// - 一意に付与できたもののみ採用
// - トークンは ~/.gbiz_token から読み取る
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const Papa = require(path.join(__dirname, "node_modules/papaparse"));
const {
  normName,
  bestAddrLevel,
  parseTsrAddresses,
  levelScore,
} = require(path.join(__dirname, "match_util"));

const token = fs.readFileSync(path.join(os.homedir(), ".gbiz_token"), "utf8").trim();
const inputPath = path.join(__dirname, "output/step3_insert.csv");
const kokuzeiPath = path.join(__dirname, "output/kokuzei_assigned.csv");
const outPath = path.join(__dirname, "output/gbiz_assigned.csv");
const DELAY_MS = process.env.DELAY_MS ? Number(process.env.DELAY_MS) : 120;

// 国税庁で SS/S 確定済み（=上位確定でスキップ対象）の TSR番号
const skipSet = new Set();
Papa.parse(fs.readFileSync(kokuzeiPath, "utf8"), { header: true, skipEmptyLines: true }).data.forEach(
  (r) => {
    if (
      (r["住所一致レベル"] === "SS" || r["住所一致レベル"] === "S") &&
      (r["判定"] || "").startsWith("付与")
    ) {
      skipSet.add(r["TSR_companyno__c"]);
    }
  },
);

// 対象（新規全件）
const targets = Papa.parse(fs.readFileSync(inputPath, "utf8"), {
  header: true,
  skipEmptyLines: true,
}).data
  .filter((r) => r["TSR_companyno__c"] || r["Name"])
  .map((r) => ({
    tsrNo: r["TSR_companyno__c"] || "",
    name: r["Name"] || "",
    addresses: parseTsrAddresses(r),
  }));

console.log(
  `対象(新規): ${targets.length}件 / 国税庁SS/S確定でスキップ: ${targets.filter((t) => skipSet.has(t.tsrNo)).length}件`,
);

// ---- API（非200はバックオフでリトライ）----
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 検索クエリの無害化（NFKC + 記号類を空白化）。gBiz APIは全角記号で404を返すため
const sanitizeQuery = (name) =>
  (name || "")
    .normalize("NFKC")
    .replace(/[^0-9A-Za-z\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3005\u30FC]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const searchOnce = (name) =>
  new Promise((resolve) => {
    const url = `https://api.info.gbiz.go.jp/hojin/v2/hojin?name=${encodeURIComponent(name)}`;
    https
      .get(
        url,
        { headers: { "X-hojinInfo-api-token": token, Accept: "application/json" } },
        (res) => {
          let data = "";
          res.on("data", (c) => (data += c));
          res.on("end", () => {
            if (res.statusCode !== 200) {
              resolve({ status: res.statusCode, infos: [] });
              return;
            }
            try {
              const j = JSON.parse(data);
              resolve({ status: 200, infos: j["hojin-infos"] || [] });
            } catch (e) {
              resolve({ status: -1, infos: [] });
            }
          });
        },
      )
      .on("error", () => resolve({ status: -2, infos: [] }));
  });
const searchByName = async (name) => {
  const q = sanitizeQuery(name);
  let last = { status: 0, infos: [] };
  for (let attempt = 0; attempt < 4; attempt++) {
    last = await searchOnce(q);
    if (last.status === 200) return last;
    // 4xx（404等）は「該当なし」として扱い、リトライしない
    if (last.status >= 400 && last.status < 500) return { status: 200, infos: [] };
    // 5xx / ネットワークエラーはバックオフでリトライ
    await sleep(500 * Math.pow(2, attempt));
  }
  return last;
};

// ---- メイン ----
(async () => {
  const out = [];
  const stat = { SS: 0, S: 0, A: 0, multi: 0, addrNg: 0, none: 0, skip: 0, err: 0 };
  let called = 0;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];

    if (skipSet.has(t.tsrNo)) {
      stat.skip++;
      out.push([t.tsrNo, t.name, "", "", "", t.addresses.join(" | "), "", 0, "スキップ(国税庁SS/S確定)"]);
      continue;
    }

    const { status, infos } = await searchByName(t.name);
    if (status !== 200) stat.err++;
    called++;

    const tName = normName(t.name);
    const exact = infos.filter((h) => normName(h.name) === tName);
    exact.forEach((h) => (h._level = bestAddrLevel(t.addresses, h.location)));
    const withAddr = exact.filter((h) => h._level);

    let chosen = null;
    let level = "";
    let judge;
    if (status !== 200) {
      judge = "エラー(要再実行)";
    } else if (withAddr.length > 0) {
      const best = Math.max(...withAddr.map((h) => levelScore[h._level]));
      const bestCands = withAddr.filter((h) => levelScore[h._level] === best);
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
    } else if (exact.length > 0) {
      chosen = exact[0];
      judge = "該当なし(住所がA未満)";
      stat.addrNg++;
    } else {
      judge = "該当なし(名称不一致)";
      stat.none++;
    }

    out.push([
      t.tsrNo,
      t.name,
      judge.startsWith("付与") && chosen ? chosen.corporate_number : "",
      chosen ? chosen.name : "",
      chosen ? chosen.location : "",
      t.addresses.join(" | "),
      level,
      exact.length,
      judge,
    ]);

    if (called % 50 === 0) {
      console.log(
        `処理:${i + 1}/${targets.length} API呼:${called} SS:${stat.SS} S:${stat.S} A:${stat.A} 複数:${stat.multi} 住所NG:${stat.addrNg} なし:${stat.none} err:${stat.err}`,
      );
    }
    await sleep(DELAY_MS);
  }

  const header = [
    "TSR_companyno__c",
    "会社名",
    "gBiz法人番号",
    "gBiz会社名",
    "gBiz住所",
    "TSR住所(全)",
    "住所一致レベル",
    "名称一致候補数",
    "判定",
  ];
  fs.writeFileSync(outPath, Papa.unparse({ fields: header, data: out }, { quotes: true }));
  console.log("=== gBiz 完了 ===");
  console.log({ total: targets.length, apiCalled: called, ...stat });
  console.log("出力:", outPath);
})();
