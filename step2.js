// 必要なライブラリをインポート
const path = require("path");
const fs = require("fs");
const Papa = require("papaparse");

// ユーザー定義のコンバーターをインポート（このファイルが別途必要です）
// const { convertFullWidthSymbols } = require("./converters.js");
// convertFullWidthSymbols がない場合は、一旦以下のダミー関数で代替できます
const convertFullWidthSymbols = (str) => str;

// コマンドライン引数を取得
const args = process.argv;

let mainCsvFilePath = "output/step1.csv";
let outputCsvFilePath = "output/step2.csv";
let LAST_UPDATE_TSR_DATE = "";
// 名寄せ(重複排除): 同一 TSR番号 の行は1件に統合する(既定ON)。
// 同一企業が複数行あると後続の突合で重複コピーが新規に紛れるため、ここで排除する。
let DEDUPE = true;

// 引数をパース
for (let i = 0; i < args.length; i++) {
  if (args[i] === "-i") {
    mainCsvFilePath = args[i + 1];
    i++;
  } else if (args[i] === "-o") {
    outputCsvFilePath = args[i + 1];
    i++;
  } else if (args[i] === "-u") {
    LAST_UPDATE_TSR_DATE = args[i + 1];
    i++;
  } else if (args[i] === "--keep-duplicates") {
    // 重複排除を無効化したい場合のエスケープハッチ
    DEDUPE = false;
  }
}

// -----------------------------------------------------------
// 変換メソッド群
// -----------------------------------------------------------

// 株式会社、合資会社、合名会社を変換するメソッド
const convertStructure = (structure) => {
  if (!structure) return "";
  return String(structure)
    .replace(/（株）/g, "株式会社")
    .replace(/㈱/g, "株式会社")
    .replace(/\(株\)/g, "株式会社")
    .replace(/（有）/g, "有限会社")
    .replace(/（資）/g, "合資会社")
    .replace(/（名）/g, "合名会社");
};

// 上場区分を変換するメソッド
const classificationMap = new Map([
  ["プライム", "プライム"],
  ["スタンダード", "スタンダード"],
  ["グロース", "グロース"],
  ["未上場", "未上場"],
  ["9", "未上場"],
  ["他上場", "上場（未分類）"],
  ["東ＰＲＯ", "東PRO"],
  ["札証", "札幌証券"],
  ["札アンビ", "札幌ア"],
  ["名プレミ", "名プレミ"],
  ["名メイン", "名メイン"],
  ["名ネクス", "名ネクス"],
  ["福証", "福岡証券"],
  ["福ＱＢｏ", "福QBo"],
  ["Ｊリート", "Jリート"],
]);
const convertClassification = (classification) => {
  if (!classification) return null;
  const strClassification = String(classification);
  for (const [key, value] of classificationMap) {
    if (strClassification.includes(key)) return value;
  }
  return null;
};

// 日付を変換するメソッド
const convertDate = (date) => {
  if (!date) return "";
  const strDate = String(date);
  const parts = strDate.split("/");
  if (parts.length === 2) return `${parts[0]}/${parts[1]}/01`;
  if (parts.length === 3) return strDate;
  return "";
};

// 生年月日を変換し、日付形式(YYYY/MM/DD)を検証するメソッド
const convertAndValidateBirthDay = (birthDay) => {
  if (!birthDay) return "";
  const cleanedDate = String(birthDay).replace(/\s*生$/, "");
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(cleanedDate)) {
    return cleanedDate;
  }
  return "";
};

// 都道府県を変換するメソッド
const convertPrefecture = (prefecture) => {
  if (!prefecture) return "";
  const strPrefecture = String(prefecture);
  const parts = strPrefecture.split(" ");
  return parts.length > 1 ? parts[1] : strPrefecture;
};

// エリアを変換するメソッド
const areaMap = new Map([
  [["北海道"], "北海道"],
  [["青森県", "岩手県", "秋田県", "宮城県", "山形県", "福島県"], "東北地方"],
  [["群馬県", "栃木県", "茨城県"], "関東地方（その他）"],
  [["埼玉県", "千葉県", "東京都", "神奈川県"], "関東地方（1都3県）"],
  [["新潟県", "長野県", "山梨県"], "甲信越地方"],
  [["静岡県", "愛知県", "岐阜県", "三重県"], "東海地方"],
  [["富山県", "石川県", "福井県"], "北陸地方"],
  [["滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"], "関西地方"],
  [["岡山県", "広島県", "鳥取県", "島根県", "山口県"], "中国地方"],
  [["徳島県", "香川県", "愛媛県", "高知県"], "四国地方"],
  [
    ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県"],
    "九州地方",
  ],
  [["沖縄県"], "沖縄県"],
]);
const convertArea = (pref) => {
  if (!pref) return null;
  const strPref = String(pref);
  for (const [keys, area] of areaMap) {
    if (keys.some((key) => strPref.includes(key))) return area;
  }
  return null;
};

// 郵便番号から「〒」マークを取り除くメソッド
const removePostalMark = (postalCode) => {
  if (!postalCode) return "";
  return String(postalCode).replace(/〒/g, "");
};

// 業種を変換するメソッド
const convertIndustry = (industry) => {
  if (!industry) return "";
  return String(industry).replace(/\n/g, ", ");
};

// 代表者半角空白を全角に変換
const convertRepresentative = (representative) => {
  if (!representative) return "";
  return String(representative).replace(/ /g, "　");
};

// 従業員数から「人」を削除するメソッド
const converNumberOfEmployees = (number) => {
  if (!number) return "";
  return String(number).replace(/\s*人$/, "");
};

// 名寄せ用の会社名を正規化するコアのメソッド
const convertFullWidthNameForDeduplication = (name) => {
  if (!name) return "";
  let normalizedName = String(name).normalize("NFKC");
  normalizedName = normalizedName.replace(/[\s\u3000]/g, ""); // 全角半角スペースを削除
  normalizedName = normalizedName.toUpperCase(); // アルファベットを大文字に
  normalizedName = normalizedName.replace(/[.,:;!?・'"`~-]/g, ""); // 一部の記号を削除
  normalizedName = normalizedName.replace(/＆/g, "&").replace(/’/g, "'"); // 全角記号を半角にする
  normalizedName = normalizedName.replace(/（株）|㈱|\(株\)/g, "株式会社"); // 法人格表記を統一
  return normalizedName;
};

// -----------------------------------------------------------
// メイン処理
// -----------------------------------------------------------

/**
 * スクリプトのメイン処理を実行する非同期関数
 */
const main = async () => {
  try {
    // 出力先ディレクトリを作成（なければ）
    const outputDir = path.dirname(outputCsvFilePath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // メインのCSVをストリームで処理する
    const readStream = fs.createReadStream(mainCsvFilePath, {
      encoding: "utf8",
    });
    const writeStream = fs.createWriteStream(outputCsvFilePath, {
      encoding: "utf8",
    });

    let isFirstRow = true;
    let outputHeaders = [];
    let rowCounter = 0;

    // 名寄せ(重複排除)用: 既出の TSR番号 を記録。重複行はドロップして別ファイルに記録。
    const seenTSR = new Set();
    let dedupedCount = 0;
    const droppedCsvFilePath = outputCsvFilePath.replace(
      /\.csv$/i,
      "_dropped_duplicates.csv",
    );
    const droppedStream = DEDUPE
      ? fs.createWriteStream(droppedCsvFilePath, { encoding: "utf8" })
      : null;
    if (droppedStream) {
      droppedStream.write("TSR_companyno__c,Name,行番号\n");
    }

    console.log(
      `🚀 メインCSVファイルの変換処理を開始します...(名寄せ重複排除: ${DEDUPE ? "ON" : "OFF"})`,
    );

    Papa.parse(readStream, {
      header: true,
      skipEmptyLines: true,
      step: (row) => {
        rowCounter++;
        try {
          const original = row.data;

          const structuredCompanyName = convertStructure(original.company);

          const convertedRow = {
            TSR_companyno__c: original.tsr_companyno_c || null,
            Name: convertFullWidthSymbols(convertStructure(original.company)),
            CompanyNameForDuplicateIdentification__c: convertFullWidthSymbols(
              convertFullWidthNameForDeduplication(structuredCompanyName),
            ),
            NumberOfEmployees: converNumberOfEmployees(
              original.number_of_employees,
            ),
            BuyerList__c: convertClassification(original.buyer_listed_c),
            Kaisyameikana__c: original.kaisyameikana_c || null,
            Daihyosyameikana__c: original.daihyosyameikana_c || null,
            CompanyPostalCode__c:
              removePostalMark(original.owner_postal_code_c) || null,
            CompanyAddress__c:
              convertFullWidthSymbols(original.company_address_c) || null,
            Phone: original.company_phnoe_c || null,
            establishmentDate__c: convertDate(original.setsuritunengetsu_c),
            Sogyonengetsu__c: original.sogyonengetsu_c || null,
            Shihonkin__c: original.shihonkin_c || null,
            TSR_No__c: convertFullWidthSymbols(
              convertIndustry(original.industry),
            ),
            Eigyosyumoku__c:
              convertFullWidthSymbols(original.eigyosyumoku_c) || null,
            Eigyosho__c: convertFullWidthSymbols(original.eigyosho_c) || null,
            Yakuin__c: convertFullWidthSymbols(original.yakuin_c) || null,
            Shiiresaki__c:
              convertFullWidthSymbols(original.shiiresaki_c) || null,
            Daikabunushi__c:
              convertFullWidthSymbols(original.daikabunushi_c) || null,
            Hanbaisaki__c:
              convertFullWidthSymbols(original.hanbaisaki_c) || null,
            Torihikiginko__c:
              convertFullWidthSymbols(original.torihikiginko_c) || null,
            Gaikyo__c: convertFullWidthSymbols(original.gaikyo_c) || null,
            Uriagesinchoritsu__c: original.uriagesinchoritsu_c || null,
            FieRiekishichoritsu__c: original.riekishinchoritsu_c || null,
            Representative__c: convertRepresentative(original.representative_c),
            OwnerBirthDay__c: convertAndValidateBirthDay(original.owner_age_c),
            Eto__c: original.eto_c || null,
            Daihyosyasyusinchi__c: convertPrefecture(
              original.daihyousyasyushinchi_c,
            ),
            Syusshinko__c: original.syusshinko_c || null,
            CompanyArea__c: convertArea(original.company_address_c),
            OwnerPostalCode__c:
              removePostalMark(original.OwnerPostalCode__c) || null,
            OwnerAddress__c: original.OwnerAddress__c || null,
            Chosanengappi__c: original.chosanengappi_c || null,
            lastUpdateTSRDay__c: LAST_UPDATE_TSR_DATE,
          };

          // 年別の利益データを反映させる
          const yearsData = Object.keys(original)
            .filter((columnName) => columnName.includes("kessannengetsu_"))
            .map((columnName) => {
              const indexMatch = columnName.match(/\d+/);
              const index = indexMatch ? Number(indexMatch[0]) : null;
              const yearMatch = original[columnName].match(/^\d{4}/);
              const year = yearMatch ? Number(yearMatch[0]) : null;
              return {
                index: index,
                year: year,
              };
            });

          const backNumberYear = Number(LAST_UPDATE_TSR_DATE.split("-")[0]);
          for (let year = 2015; year <= backNumberYear; year++) {
            convertedRow[`Rieki_${year}__c`] = "";
            convertedRow[`Uriage_${year}__c`] = "";
            convertedRow[`Kessannengetsu_${year}__c`] = "";
            const yearMatch = yearsData.find((data) => data.year === year);
            if (!yearMatch) continue;
            convertedRow[`Rieki_${year}__c`] = original[
              `rieki_${yearMatch.index}_c`
            ].replace(/,/g, "");
            convertedRow[`Uriage_${year}__c`] = original[
              `uriage_${yearMatch.index}_c`
            ].replace(/,/g, "");
            convertedRow[`Kessannengetsu_${year}__c`] =
              original[`kessannengetsu_${yearMatch.index}_c`];
          }

          // 全データを出力（ComparisonResultとReferenceCompanyNameを含む）
          if (isFirstRow) {
            outputHeaders = Object.keys(convertedRow);
            // ヘッダーをUTF-8 BOM付きで書き込み、Excelでの文字化けを防ぐ
            writeStream.write("\ufeff");
            writeStream.write(
              Papa.unparse([outputHeaders], { header: false, quotes: true }),
            );
            writeStream.write("\n");
            isFirstRow = false;
          }

          // --- 名寄せ: 同一 TSR番号 の重複行を排除(先着優先) ---
          if (DEDUPE) {
            const tsrKey = String(convertedRow.TSR_companyno__c ?? "").trim();
            if (tsrKey) {
              if (seenTSR.has(tsrKey)) {
                dedupedCount++;
                droppedStream.write(
                  Papa.unparse([[tsrKey, convertedRow.Name ?? "", rowCounter]], {
                    header: false,
                    quotes: true,
                  }) + "\n",
                );
                return; // 重複はスキップ(出力しない)
              }
              seenTSR.add(tsrKey);
            }
            // TSR番号が無い行はキー不明のため排除せず残す(別企業の誤統合を回避)
          }

          const values = outputHeaders.map(
            (header) => convertedRow[header] ?? "",
          );
          writeStream.write(
            Papa.unparse([values], { header: false, quotes: true }),
          );
          writeStream.write("\n");
        } catch (err) {
          console.error(
            `🔴 ${rowCounter}行目の変換中にエラーが発生しました: ${err.message}`,
            row.data,
          );
        }
      },
      complete: () => {
        console.log(
          `✅ メインファイル ${rowCounter}行の変換処理が完了しました。`,
        );
        if (DEDUPE) {
          console.log(
            `🧹 名寄せ重複排除: ${dedupedCount}件を排除(ユニークTSR ${seenTSR.size}件)。排除分 -> ${droppedCsvFilePath}`,
          );
          if (droppedStream) droppedStream.end();
        }
        writeStream.end(() => {
          console.log(`🎉 CSVファイルを出力しました: ${outputCsvFilePath}`);
        });
      },
      error: (err) => {
        console.error(
          "❌ メインファイルのパース中に致命的なエラーが発生しました:",
          err.message,
        );
        readStream.destroy();
        writeStream.end();
      },
    });
  } catch (error) {
    console.error("🔴 プロセス全体でエラーが発生しました:", error);
  }
};

// スクリプトのメイン処理を実行
main();
