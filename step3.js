// 必要なライブラリをインポート
const path = require("path");
const fs = require("fs");
const Papa = require("papaparse");

// コマンドライン引数を取得
const args = process.argv;

let outputUpdatedCsvFileName = "output/tsr_update_companies.csv";
let outputNewCsvFileName = "output/tsr_new_companies.csv";
let mainCsvFilePath = "output/tsr_validated.csv";
let salesForceCsvFilePath = "";

// 引数をパース
for (let i = 0; i < args.length - 1; i++) {
  if (args[i] === "-i") {
    mainCsvFilePath = args[i + 1];
    i++;
  } else if (args[i] === "-s") {
    salesForceCsvFilePath = args[i + 1];
    i++;
  } else if (args[i] === "--output-update") {
    outputUpdatedCsvFileName = args[i + 1];
    i++;
  } else if (args[i] === "--output-new") {
    outputNewCsvFileName = args[i + 1];
    i++;
  }
}

// -----------------------------------------------------------
// メイン処理
// -----------------------------------------------------------

/**
 * スクリプトのメイン処理を実行する非同期関数
 */
const main = async () => {
  try {
    // 出力先ディレクトリを作成（なければ）
    [outputUpdatedCsvFileName, outputNewCsvFileName].forEach((fileName) => {
      const outputDir = path.dirname(fileName);
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
    });

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
          } else {
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
    const updatedCompanyData = [];
    const newCompanyData = [];
    const salesForceHeaderData = [];

    // 出力用のヘッダーを指定する
    const outputUpdateHeaderData = ["Id", "houjinbangou__c", ...headerData];
    const outputNewHeaderData = ["houjinbangou__c", ...headerData];

    await new Promise((resolve, reject) => {
      console.log("📋 SalesforceのCSVを読み込み中...");

      const TSRIdIndex = headerData.indexOf("TSR_companyno__c");
      const filteredCompanyData = companyData.filter(
        (company) =>
          company[TSRIdIndex].length > 0 && !isNaN(company[TSRIdIndex])
      );
      const TSRIdList = filteredCompanyData.map((company) =>
        Number(company[TSRIdIndex])
      );

      const salesForceReadStream = fs.createReadStream(salesForceCsvFilePath, {
        encoding: "utf8",
      });

      let rowCounter = 0;
      let salesForceIdIndex = -1;
      Papa.parse(salesForceReadStream, {
        header: false,
        skipEmptyLines: true,
        step: (row) => {
          if (rowCounter == 0) {
            salesForceHeaderData.push(
              ...row.data.map((h) => h.replace(/"/g, "").trim())
            );
            salesForceIdIndex =
              salesForceHeaderData.indexOf("TSR_companyno__c");
          } else {
            // TSR番号が存在するか判定
            const salesForceId =
              row.data[salesForceIdIndex].length > 0 &&
              !isNaN(row.data[salesForceIdIndex])
                ? Number(row.data[salesForceIdIndex])
                : -1;
            const tsrIdListIndex = TSRIdList.indexOf(salesForceId);
            if (salesForceId != -1 && tsrIdListIndex != -1) {
              // 既存企業データの場合
              console.log(`${rowCounter} found`);
              const matchTSRCompanyData = filteredCompanyData.find(
                (company) => Number(company[TSRIdIndex]) === salesForceId
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

                  return "";
                }
              );
              updatedCompanyData.push(updateInputData);
              TSRIdList.splice(tsrIdListIndex, 1);
              filteredCompanyData.splice(tsrIdListIndex, 1);
            } else {
              console.log(`${rowCounter} not found`);
            }
          }
          rowCounter++;
        },
        complete: () => {
          // 新規企業の場合
          filteredCompanyData.forEach((company) => {
            const newInputData = outputNewHeaderData.map((columnName) => {
              const tsrIndex = headerData.indexOf(columnName);
              if (tsrIndex != -1) {
                // TSRにデータがある場合
                return company[tsrIndex];
              }

              return "";
            });
            newCompanyData.push(newInputData);
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

    // 既存企業データを書き出す
    await new Promise((resolve, reject) => {
      try {
        console.log("📋 既存企業データのCSVを書き出し中...");
        const writeStream = fs.createWriteStream(outputUpdatedCsvFileName, {
          encoding: "utf8",
        });
        writeStream.write(
          Papa.unparse([outputUpdateHeaderData], {
            header: false,
            quotes: true,
          })
        );
        writeStream.write("\n");
        updatedCompanyData.forEach((company) => {
          writeStream.write(
            Papa.unparse([company], {
              header: false,
              quotes: true,
            })
          );
          writeStream.write("\n");
        });
        console.log(
          `✅ 既存企業データのCSV書き出し完了: ${updatedCompanyData.length}件`
        );
        resolve();
      } catch (error) {
        console.error("❌ 既存企業データのCSV書き出しエラー:", error);
        reject(error);
      }
    });

    // 新規企業を書き出す
    await new Promise((resolve, reject) => {
      try {
        console.log("📋 新規企業データのCSVを書き出し中...");
        const writeStream = fs.createWriteStream(outputNewCsvFileName, {
          encoding: "utf8",
        });
        writeStream.write(
          Papa.unparse([outputNewHeaderData], {
            header: false,
            quotes: true,
          })
        );
        writeStream.write("\n");
        newCompanyData.forEach((company) => {
          writeStream.write(
            Papa.unparse([company], {
              header: false,
              quotes: true,
            })
          );
          writeStream.write("\n");
        });
        console.log(
          `✅ 新規企業データのCSV書き出し完了: ${newCompanyData.length}件`
        );
        resolve();
      } catch (error) {
        console.error("❌ 新規企業データのCSV書き出しエラー:", error);
        reject(error);
      }
    });
  } catch (error) {
    throw error;
  }
};

// スクリプトのメイン処理を実行
main();
