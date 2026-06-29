// 必要なライブラリをインポート
const path = require("path");
const fs = require("fs");
const Papa = require("papaparse");

// コマンドライン引数を取得
const args = process.argv;

let mainCsvFilePath = "output/tsr_new_companies.csv";
let corporateNumberCsvFilePath = "output/corporate_number_validated.csv";
let outputCsvFilePath = "output/tsr_with_corporate_number.csv";

// 引数をパース
for (let i = 0; i < args.length - 1; i++) {
  if (args[i] === "-i") {
    mainCsvFilePath = args[i + 1];
    i++;
  } else if (args[i] === "-c") {
    corporateNumberCsvFilePath = args[i + 1];
    i++;
  } else if (args[i] === "-o") {
    outputCsvFilePath = args[i + 1];
    i++;
  }
}

// -----------------------------------------------------------
// 変換メソッド群
// -----------------------------------------------------------

// csv拡張子を除いたファイル名を出力
const filenameWithoutCsv = (fp) => {
  if (!fp) return "";
  return fp.replace(/\.csv$/i, "");
};

// 法人番号のリストを都道府県別に分割する関数
// 処理速度を効率的にするため
const prefectureCorpolateNumberList = {
  北海道: [],
  青森県: [],
  岩手県: [],
  宮城県: [],
  秋田県: [],
  山形県: [],
  福島県: [],
  茨城県: [],
  栃木県: [],
  群馬県: [],
  埼玉県: [],
  千葉県: [],
  東京都: [],
  神奈川県: [],
  山梨県: [],
  長野県: [],
  新潟県: [],
  富山県: [],
  石川県: [],
  福井県: [],
  岐阜県: [],
  静岡県: [],
  愛知県: [],
  三重県: [],
  滋賀県: [],
  京都府: [],
  大阪府: [],
  兵庫県: [],
  奈良県: [],
  和歌山県: [],
  鳥取県: [],
  島根県: [],
  岡山県: [],
  広島県: [],
  山口県: [],
  徳島県: [],
  香川県: [],
  愛媛県: [],
  高知県: [],
  福岡県: [],
  佐賀県: [],
  長崎県: [],
  熊本県: [],
  大分県: [],
  宮崎県: [],
  鹿児島県: [],
  沖縄県: [],
  その他: [],
};

// -----------------------------------------------------------
// メイン処理
// -----------------------------------------------------------

const main = async () => {
  // 出力先ディレクトリを作成（なければ）
  const outputDir = path.dirname(outputCsvFilePath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const corporateNumberHeaders = [];

  // 法人番号のデータを読み込む
  await new Promise((resolve, reject) => {
    console.log("📋 法人番号のCSVを読み込み中...");
    const readStream = fs.createReadStream(corporateNumberCsvFilePath, {
      encoding: "utf8",
    });
    let rowCounter = 0;
    Papa.parse(readStream, {
      header: false,
      skipEmptyLines: true,
      step: (row) => {
        if (rowCounter == 0) {
          corporateNumberHeaders.push(
            ...row.data.map((h) => h.replace(/"/g, "").trim())
          );
        } else {
          const prefecture =
            row.data[corporateNumberHeaders.indexOf("prefecture")];
          if (
            Object.keys(prefectureCorpolateNumberList).indexOf(prefecture) != -1
          ) {
            prefectureCorpolateNumberList[prefecture].push([...row.data]);
          } else {
            prefectureCorpolateNumberList["その他"].push([...row.data]);
          }
        }
        rowCounter++;
      },
      complete: () => {
        console.log(`✅ 法人番号のCSV読み込み完了: ${rowCounter}件`);
        resolve();
      },
      error: (error) => {
        console.error("❌ 法人番号のCSV読み込みエラー:", error);
        reject(error);
      },
    });
  });

  const TSRDataList = [];
  const TSRHeaders = [];

  // TSRのデータを読み込む
  let TSRdataCounter = 0;
  await new Promise((resolve, reject) => {
    console.log("📋 TSRのCSVを読み込み中...");
    const readStream = fs.createReadStream(mainCsvFilePath, {
      encoding: "utf8",
    });
    Papa.parse(readStream, {
      header: false,
      skipEmptyLines: true,
      step: (row) => {
        if (TSRHeaders.length === 0) {
          TSRHeaders.push(...row.data.map((h) => h.replace(/"/g, "").trim()));
        } else {
          TSRDataList.push([...row.data]);
          TSRdataCounter++;
        }
      },
      complete: () => {
        console.log(`✅ TSRのCSV読み込み完了: ${TSRdataCounter}件`);
        resolve();
      },
      error: (error) => {
        console.error("❌ TSRのCSV読み込みエラー:", error);
        reject(error);
      },
    });
  });

  // 信頼度に沿って法人番号を検索する
  const searchCorporateNumber = (reliability, TSRdata) => {
    let hitIndex = -1;
    const [TSRcompanyName, TSRaddress] = [
      TSRdata[TSRHeaders.indexOf("CompanyNameForDuplicateIdentification__c")],
      TSRdata[TSRHeaders.indexOf("CompanyAddress__c")],
    ];

    if (reliability == "D") {
      let hitTSRprefucture = "";

      // 全ての都道府県から探索する
      outerLoop: for (const TSRprefecture of Object.keys(
        prefectureCorpolateNumberList
      )) {
        for (
          let i = 0;
          i < prefectureCorpolateNumberList[TSRprefecture].length;
          i++
        ) {
          const companyName =
            prefectureCorpolateNumberList[TSRprefecture][i][
              corporateNumberHeaders.indexOf("company_name")
            ];
          if (companyName === TSRcompanyName) {
            if (hitIndex === -1) {
              hitIndex = i;
              hitTSRprefucture = TSRprefecture;
            } else {
              hitIndex = -1;
              break outerLoop;
            }
          }
        }
      }
      return [hitIndex, hitTSRprefucture];
    } else {
      const TSRprefecture =
        Object.keys(prefectureCorpolateNumberList).find((pref) =>
          TSRaddress.startsWith(pref)
        ) ?? "その他";
      for (
        let i = 0;
        i < prefectureCorpolateNumberList[TSRprefecture].length;
        i++
      ) {
        const [companyName, prefecture, address1, address2, address3] = [
          prefectureCorpolateNumberList[TSRprefecture][i][
            corporateNumberHeaders.indexOf("company_name")
          ],
          prefectureCorpolateNumberList[TSRprefecture][i][
            corporateNumberHeaders.indexOf("prefecture")
          ],
          prefectureCorpolateNumberList[TSRprefecture][i][
            corporateNumberHeaders.indexOf("address1")
          ],
          prefectureCorpolateNumberList[TSRprefecture][i][
            corporateNumberHeaders.indexOf("address2")
          ],
          prefectureCorpolateNumberList[TSRprefecture][i][
            corporateNumberHeaders.indexOf("address3")
          ],
        ];
        if (reliability === "SS") {
          if (
            companyName === TSRcompanyName &&
            prefecture + address1 + address2 + address3 === TSRaddress
          ) {
            if (hitIndex === -1) {
              hitIndex = i;
            } else {
              hitIndex = -1;
              break;
            }
          }
        } else if (reliability === "S") {
          const address = prefecture + address1 + address2 + address3;
          if (
            companyName === TSRcompanyName &&
            TSRaddress.startsWith(address)
          ) {
            if (hitIndex === -1) {
              hitIndex = i;
            } else {
              hitIndex = -1;
              break;
            }
          }
        } else if (reliability === "A") {
          const address = prefecture + address1 + address2;
          if (
            companyName === TSRcompanyName &&
            TSRaddress.startsWith(address)
          ) {
            if (hitIndex === -1) {
              hitIndex = i;
            } else {
              hitIndex = -1;
              break;
            }
          }
        } else if (reliability === "B") {
          const address = prefecture + address1;
          if (
            companyName === TSRcompanyName &&
            TSRaddress.startsWith(address)
          ) {
            if (hitIndex === -1) {
              hitIndex = i;
            } else {
              hitIndex = -1;
              break;
            }
          }
        } else if (reliability === "C") {
          if (
            companyName === TSRcompanyName &&
            TSRaddress.startsWith(prefecture)
          ) {
            if (hitIndex === -1) {
              hitIndex = i;
            } else {
              hitIndex = -1;
              break;
            }
          }
        }
      }
      return [hitIndex, TSRprefecture];
    }
  };

  const reliabilityList = ["SS", "S", "A", "B", "C", "D", "F"];
  const currentDate = new Date();

  const monthString = String(currentDate.getMonth() + 1).padStart(2, "0");
  const dateString = String(currentDate.getDate()).padStart(2, "0");

  let hitCounter = 0;
  for (let rIndex = 0; rIndex < reliabilityList.length; rIndex++) {
    // 法人番号を検索する
    console.log(
      `📋 TSRのCSVから 信頼度${reliabilityList[rIndex]} の法人番号を検索中...`
    );

    const outputFileName = `${filenameWithoutCsv(
      outputCsvFilePath
    )}_${currentDate.getFullYear()}${monthString}${dateString}_${
      reliabilityList[rIndex]
    }_.csv`;

    await new Promise(async (resolve, reject) => {
      try {
        const writeStream = fs.createWriteStream(outputFileName, {
          encoding: "utf8",
        });

        // ヘッダーを書き出す
        writeStream.write(
          Papa.unparse([TSRHeaders], { header: false, quotes: true })
        );
        writeStream.write("\n");

        for (let index = 0; index < TSRDataList.length; index++) {
          if (TSRDataList[index] === null) {
            // 既にヒットしている企業情報はスキップする
            continue;
          }

          if (reliabilityList[rIndex] === "F") {
            // 一致しなかった場合はそのまま出力する
            writeStream.write(
              Papa.unparse([[...TSRDataList[index]]], {
                header: false,
                quotes: true,
              })
            );
            writeStream.write("\n");
            TSRDataList[index] = null;

            hitCounter++;
            continue;
          }

          // 会社情報を検索する
          const [hitIndex, TSRprefecture] = searchCorporateNumber(
            reliabilityList[rIndex],
            TSRDataList[index]
          );

          // 検索状況をログで出力
          console.log(
            `${index}/${TSRdataCounter}`,
            reliabilityList[rIndex],
            hitIndex,
            TSRDataList[index][
              TSRHeaders.indexOf("CompanyNameForDuplicateIdentification__c")
            ]
          );

          if (hitIndex != -1) {
            // ヒットした会社情報を記録
            const writeData = [...TSRDataList[index]];
            writeData[TSRHeaders.indexOf("houjinbangou__c")] =
              prefectureCorpolateNumberList[TSRprefecture][hitIndex][
                corporateNumberHeaders.indexOf("corporate_number")
              ];
            writeStream.write(
              Papa.unparse([writeData], { header: false, quotes: true })
            );
            writeStream.write("\n");

            // ヒットした会社データを検索リストから削除
            prefectureCorpolateNumberList[TSRprefecture].splice(hitIndex, 1);
            TSRDataList[index] = null;

            hitCounter++;
          }
        }
        console.log(
          `✅ TSRの 信頼度${
            reliabilityList[rIndex]
          } の法人番号検索完了: ${hitCounter}件 (残り${
            TSRdataCounter - hitCounter
          }件)`
        );
        writeStream.end();
        resolve();
      } catch (error) {
        console.error("❌ TSRの法人番号検索エラー:", error);
        reject(error);
      }
    });
  }
};

main();
