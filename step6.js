// 必要なライブラリをインポート
const path = require("path");
const fs = require("fs");
const Papa = require("papaparse");

// コマンドライン引数を取得
const args = process.argv;

let mainCsvFilePath = "";
let outputCsvFilePath = "";
let salesForceCsvFilePath = "";

// 引数をパース
for (let i = 0; i < args.length - 1; i++) {
  if (args[i] === "-i") {
    mainCsvFilePath = args[i + 1];
    i++;
  } else if (args[i] === "-o") {
    outputCsvFilePath = args[i + 1];
    i++;
  } else if (args[i] === "-s") {
    salesForceCsvFilePath = args[i + 1];
    i++;
  }
}

let outputWithIdCsvFileName = `${outputCsvFilePath.replace(".csv", "")}_update.csv`;
let outputWithoutIdCsvFileName = `${outputCsvFilePath.replace(".csv", "")}_insert.csv`;

// -----------------------------------------------------------
// メイン処理
// -----------------------------------------------------------

/**
 * スクリプトのメイン処理を実行する非同期関数
 */
const main = async () => {
  try {
    // 出力先ディレクトリを作成（なければ）
    [outputWithIdCsvFileName, outputWithoutIdCsvFileName].forEach(
      (fileName) => {
        const outputDir = path.dirname(fileName);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }
      },
    );

    // TSRのCSVを先に読み込んでマップ化
    const headerData = [];
    const companyData = [];

    await new Promise((resolve, reject) => {
      console.log("📋 TSRのCSVを読み込み中...");

      const tsrReadStream = fs.createReadStream(mainCsvFilePath, {
        encoding: "utf8",
      });

      let rowCounter = 0;
      Papa.parse(tsrReadStream, {
        header: false,
        skipEmptyLines: true,
        step: (row) => {
          if (rowCounter == 0) {
            headerData.push(...row.data.map((h) => h.replace(/"/g, "").trim()));
          } else if (row.data.length > 0) {
            companyData.push(row.data);
          }
          rowCounter++;
        },
        complete: () => {
          console.log(`✅ TSRのCSV読み込み完了: ${companyData.length}件`);
          resolve();
        },
        error: (error) => {
          console.error("❌ TSRのCSV読み込みエラー:", error);
          reject(error);
        },
      });
    });

    // Salesforceのデータと統合させる
    const updateCompanyData = [];
    const insertCompanyData = [];
    const salesForceHeaderData = [];

    // 出力用のヘッダーを指定する
    const outputUpdateHeaderData = ["Id", ...headerData];
    const outputInsertHeaderData = [...headerData];

    await new Promise((resolve, reject) => {
      console.log("📋 SalesforceのCSVを読み込み中...");

      const companyDataCorpIndex = headerData.indexOf("houjinbangou__c");
      const corpIdList = companyData.map((company) =>
        Number(company[companyDataCorpIndex]),
      );

      const salesForceReadStream = fs.createReadStream(salesForceCsvFilePath, {
        encoding: "utf8",
      });

      let rowCounter = 0;
      let salesForceIdIndex = -1;
      let tsrIdIndex = -1;
      let corpIdIndex = -1;
      Papa.parse(salesForceReadStream, {
        header: false,
        skipEmptyLines: true,
        step: (row) => {
          if (rowCounter == 0) {
            salesForceHeaderData.push(
              ...row.data.map((h) => h.replace(/"/g, "").trim()),
            );
            salesForceIdIndex = salesForceHeaderData.indexOf("Id");
            tsrIdIndex = salesForceHeaderData.indexOf("TSR_companyno__c");
            corpIdIndex = salesForceHeaderData.indexOf("houjinbangou__c");
          } else {
            // SalesForceIdが存在するか判定
            const salesForceId = row.data[salesForceIdIndex];
            // 法人番号が存在するか判定
            const corpId =
              row.data[corpIdIndex].length > 0 && !isNaN(row.data[corpIdIndex])
                ? Number(row.data[corpIdIndex])
                : -1;
            const corpIdListIndex = corpIdList.indexOf(corpId);

            if (salesForceId.length > 0 && corpIdListIndex != -1) {
              // 法人番号が既に割り振られている新規TSRデータ
              console.log(`${rowCounter} found`);

              const matchTSRCompanyData = companyData.find(
                (company) => Number(company[companyDataCorpIndex]) === corpId,
              );
              const salesForceData = row.data;
              const updateInputData = outputUpdateHeaderData.map(
                (columnName) => {
                  const tsrIndex = headerData.indexOf(columnName);
                  if (tsrIndex != -1) {
                    // TSRにデータがある場合
                    return matchTSRCompanyData[tsrIndex];
                  }

                  const salesForceIndex =
                    salesForceHeaderData.indexOf(columnName);
                  if (salesForceIndex != -1) {
                    // SalesForceにデータがある場合
                    return salesForceData[salesForceIndex];
                  }

                  return null;
                },
              );

              updateCompanyData.push(updateInputData);
              corpIdList.splice(corpIdListIndex, 1);
              companyData.splice(corpIdListIndex, 1);
            } else {
              console.log(`${rowCounter} not found`);
            }
          }
          rowCounter++;
        },
        complete: () => {
          // 法人番号がまた無い新規TSRデータ
          companyData.forEach((company) => {
            const newInsertData = outputInsertHeaderData.map((columnName) => {
              const tsrIndex = headerData.indexOf(columnName);
              if (tsrIndex != -1) {
                // TSRにデータがある場合
                return company[tsrIndex];
              }
              return null;
            });
            insertCompanyData.push(newInsertData);
          });
          console.log(`✅ SalesforceのCSV読み込み完了: ${rowCounter - 1}件`);
          resolve();
        },
        error: (error) => {
          console.error("❌ SalesforceのCSV読み込みエラー:", error);
          reject(error);
        },
      });
    });

    // Id付き既存データを書き出す
    await new Promise((resolve, reject) => {
      try {
        console.log("📋 Id付き既存データのCSVを書き出し中...");
        const writeStream = fs.createWriteStream(outputWithIdCsvFileName, {
          encoding: "utf8",
        });
        writeStream.write(
          Papa.unparse([outputUpdateHeaderData], {
            header: false,
            quotes: false,
          }),
        );
        writeStream.write("\n");
        updateCompanyData.forEach((company) => {
          writeStream.write(
            Papa.unparse([company], {
              header: false,
              quotes: false,
            }),
          );
          writeStream.write("\n");
        });
        console.log(
          `✅ Id付き既存データのCSV書き出し完了: ${updateCompanyData.length}件`,
        );
        resolve();
      } catch (error) {
        console.error("❌ Id付き既存データのCSV書き出しエラー:", error);
        reject(error);
      }
    });

    // Id無し既存データを書き出す
    await new Promise((resolve, reject) => {
      try {
        console.log("📋 Id無し既存データのCSVを書き出し中...");
        const writeStream = fs.createWriteStream(outputWithoutIdCsvFileName, {
          encoding: "utf8",
        });
        writeStream.write(
          Papa.unparse([outputInsertHeaderData], {
            header: false,
            quotes: false,
          }),
        );
        writeStream.write("\n");
        insertCompanyData.forEach((company) => {
          writeStream.write(
            Papa.unparse([company], {
              header: false,
              quotes: false,
            }),
          );
          writeStream.write("\n");
        });
        console.log(
          `✅ Id無し既存データのCSV書き出し完了: ${insertCompanyData.length}件`,
        );
        resolve();
      } catch (error) {
        console.error("❌ Id無し既存データのCSV書き出しエラー:", error);
        reject(error);
      }
    });
  } catch (error) {
    throw error;
  }
};

// スクリプトのメイン処理を実行
main();
