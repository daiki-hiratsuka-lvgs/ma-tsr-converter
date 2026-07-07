// 必要なライブラリをインポート
const path = require("path");
const fs = require("fs");
const Papa = require("papaparse");

// コマンドライン引数を取得
const args = process.argv;

let outputUpdatedCsvFileName = "output/step3_update.csv";
let outputNewCsvFileName = "output/step3_insert.csv";
let mainCsvFilePath = "output/step2.csv";
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
  } else if (args[i] === "--output-insert") {
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
      // TSR番号 -> 企業行 のマップ（step2で名寄せ済みのため一意。念のため先着優先）。
      const companyByTSR = new Map();
      filteredCompanyData.forEach((company) => {
        const key = Number(company[TSRIdIndex]);
        if (!companyByTSR.has(key)) companyByTSR.set(key, company);
      });
      const matchedTSR = new Set();
      // 出力列の参照元を事前解決（毎行 indexOf しないための高速化）
      const insertColTsrIdx = outputNewHeaderData.map((c) =>
        headerData.indexOf(c)
      );
      let updateColTsrIdx = null;
      let updateColSfIdx = null;

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
            // update列の参照元（TSR側優先、無ければSF側、無ければ空）を確定
            updateColTsrIdx = outputUpdateHeaderData.map((c) =>
              headerData.indexOf(c)
            );
            updateColSfIdx = outputUpdateHeaderData.map((c) =>
              salesForceHeaderData.indexOf(c)
            );
          } else {
            // TSR番号が存在するか判定
            const raw = row.data[salesForceIdIndex];
            const salesForceId =
              raw && raw.length > 0 && !isNaN(raw) ? Number(raw) : -1;
            if (
              salesForceId !== -1 &&
              companyByTSR.has(salesForceId) &&
              !matchedTSR.has(salesForceId)
            ) {
              // 既存企業データ（TSR番号一致・先着のSF行を採用）
              matchedTSR.add(salesForceId);
              const matchTSRCompanyData = companyByTSR.get(salesForceId);
              const salesForceData = row.data;
              const updateInputData = outputUpdateHeaderData.map((c, i) => {
                const t = updateColTsrIdx[i];
                if (t !== -1) return matchTSRCompanyData[t];
                const s = updateColSfIdx[i];
                if (s !== -1) return salesForceData[s];
                return "";
              });
              updatedCompanyData.push(updateInputData);
            }
          }
          rowCounter++;
        },
        complete: () => {
          // 新規企業: どのSF行にも一致しなかった企業
          filteredCompanyData.forEach((company) => {
            if (matchedTSR.has(Number(company[TSRIdIndex]))) return;
            const newInputData = outputNewHeaderData.map((c, i) => {
              const t = insertColTsrIdx[i];
              return t !== -1 ? company[t] : "";
            });
            newCompanyData.push(newInputData);
          });
          console.log(`✅ SalesforceのCSV読み込み完了: ${rowCounter - 1}件`);
          console.log(
            `   更新(TSR一致): ${updatedCompanyData.length} / 新規: ${newCompanyData.length}`
          );
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
