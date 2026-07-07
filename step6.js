// 必要なライブラリをインポート
const path = require("path");
const fs = require("fs");
const Papa = require("papaparse");

// コマンドライン引数を取得
const args = process.argv;

let mainCsvFilePath = "";
let outputCsvFilePath = "output";
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

let outputWithIdCsvFileName = "update.csv";
let outputWithoutIdCsvFileName = "insert.csv";
let duplicateCsvFileName = "duplicate.csv";
let unknownCsvFileName = "unknown_no_corp.csv";

// -----------------------------------------------------------
// メイン処理
// -----------------------------------------------------------

/**
 * スクリプトのメイン処理を実行する非同期関数
 */
const main = async () => {
  try {
    // 日時別の出力ディレクトリを作成（例: output/20260629123016）
    const currentDate = new Date();
    const monthString = String(currentDate.getMonth() + 1).padStart(2, "0");
    const dateString = String(currentDate.getDate()).padStart(2, "0");
    const hourString = String(currentDate.getHours()).padStart(2, "0");
    const minuteString = String(currentDate.getMinutes()).padStart(2, "0");
    const secondString = String(currentDate.getSeconds()).padStart(2, "0");
    const dateDir = `step6_${currentDate.getFullYear()}${monthString}${dateString}${hourString}${minuteString}${secondString}`;
    const outputDir = path.join(outputCsvFilePath, dateDir);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 出力ファイルのフルパスを組み立てる
    outputWithIdCsvFileName = path.join(outputDir, outputWithIdCsvFileName);
    outputWithoutIdCsvFileName = path.join(
      outputDir,
      outputWithoutIdCsvFileName,
    );
    duplicateCsvFileName = path.join(outputDir, duplicateCsvFileName);
    unknownCsvFileName = path.join(outputDir, unknownCsvFileName);

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

    // Salesforceのデータと突合する
    const updateCompanyData = [];
    const insertCompanyData = [];
    const duplicateData = [];
    const salesForceHeaderData = [];

    const companyDataCorpIndex = headerData.indexOf("houjinbangou__c");

    // 出力ヘッダー
    const outputUpdateHeaderData = ["Id", ...headerData];
    const outputInsertHeaderData = [...headerData];

    // 法人番号として有効か（空欄・0・非数値は無効=-1）
    const parseCorp = (raw) => {
      if (raw == null) return -1;
      const s = String(raw).trim();
      if (s.length === 0 || isNaN(s)) return -1;
      const n = Number(s);
      return n > 0 ? n : -1;
    };

    // TSR側の法人番号の出現数（一意性判定用）
    const tsrCorpCount = new Map();
    companyData.forEach((company) => {
      const corp = parseCorp(company[companyDataCorpIndex]);
      if (corp !== -1) {
        tsrCorpCount.set(corp, (tsrCorpCount.get(corp) || 0) + 1);
      }
    });
    const tsrCorpSet = new Set(tsrCorpCount.keys());

    // SF側：TSRに存在する法人番号のSFのIdのみ収集
    const sfMatchesByCorp = new Map(); // corpId -> [id, ...]

    await new Promise((resolve, reject) => {
      console.log("📋 SalesforceのCSVを読み込み中...");

      const salesForceReadStream = fs.createReadStream(salesForceCsvFilePath, {
        encoding: "utf8",
      });

      let rowCounter = 0;
      let salesForceIdIndex = -1;
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
            corpIdIndex = salesForceHeaderData.indexOf("houjinbangou__c");
          } else {
            const salesForceId = row.data[salesForceIdIndex];
            const corpId = parseCorp(row.data[corpIdIndex]);
            if (
              salesForceId.length > 0 &&
              corpId !== -1 &&
              tsrCorpSet.has(corpId)
            ) {
              if (!sfMatchesByCorp.has(corpId)) {
                sfMatchesByCorp.set(corpId, []);
              }
              sfMatchesByCorp.get(corpId).push(salesForceId);
            }
          }
          rowCounter++;
        },
        complete: () => {
          console.log(`✅ SalesforceのCSV読み込み完了: ${rowCounter - 1}件`);
          resolve();
        },
        error: (error) => {
          console.error("❌ SalesforceのCSV読み込みエラー:", error);
          reject(error);
        },
      });
    });

    // 突合結果の採否を判定する
    console.log("📋 突合結果を判定中...");
    let adopted = 0;
    let duplicate = 0;
    let noMatch = 0;
    let noCorp = 0;
    // 法人番号が特定できていない行（新規として登録できない＝要確認に隔離）
    const noCorpData = [];

    companyData.forEach((company) => {
      const corpId = parseCorp(company[companyDataCorpIndex]);

      const buildRow = () =>
        outputInsertHeaderData.map((columnName) => {
          const tsrIndex = headerData.indexOf(columnName);
          return tsrIndex !== -1 ? company[tsrIndex] : null;
        });

      if (corpId === -1) {
        // 法人番号なし → 新規に分類しない。Salesforceは法人番号なしで登録不可のため
        // 「不明(要確認)」として隔離し、手動確認/別途の突合(名称・電話・住所)に回す。
        noCorpData.push(buildRow());
        noCorp++;
        return;
      }

      const sfList = sfMatchesByCorp.get(corpId) || [];
      const sfCount = sfList.length;
      const tsrCount = tsrCorpCount.get(corpId) || 0;

      if (sfCount === 0) {
        // SFに該当なし → 新規
        insertCompanyData.push(buildRow());
        noMatch++;
        return;
      }

      const isUnique = tsrCount === 1 && sfCount === 1;
      if (!isUnique) {
        // SF側で一意に紐づけられない（SF重複）→ 重複ファイルへ（要手動確認）
        duplicateData.push([...buildRow(), sfList.join(";")]);
        duplicate++;
        return;
      }

      // 法人番号がSFに一意に存在 = 既存 → 取引先Idを採用してupdate
      const updateRow = outputUpdateHeaderData.map((columnName) => {
        if (columnName === "Id") return sfList[0];
        const tsrIndex = headerData.indexOf(columnName);
        return tsrIndex !== -1 ? company[tsrIndex] : null;
      });
      updateCompanyData.push(updateRow);
      adopted++;
    });

    console.log(
      `✅ 判定完了: 更新(一意)=${adopted} / 重複(SF側複数)=${duplicate} / 新規(SF該当なし)=${noMatch} / 不明(法人番号なし・要確認)=${noCorp}`,
    );

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

    // SF側重複データ（一意に紐づけられない）を書き出す
    await new Promise((resolve, reject) => {
      try {
        console.log("📋 SF重複データのCSVを書き出し中...");
        const writeStream = fs.createWriteStream(duplicateCsvFileName, {
          encoding: "utf8",
        });
        writeStream.write(
          Papa.unparse([[...outputInsertHeaderData, "SF候補Id"]], {
            header: false,
            quotes: false,
          }),
        );
        writeStream.write("\n");
        duplicateData.forEach((company) => {
          writeStream.write(
            Papa.unparse([company], { header: false, quotes: false }),
          );
          writeStream.write("\n");
        });
        console.log(
          `✅ SF重複データのCSV書き出し完了: ${duplicateData.length}件`,
        );
        resolve();
      } catch (error) {
        console.error("❌ SF重複データのCSV書き出しエラー:", error);
        reject(error);
      }
    });

    // 法人番号なし（新規登録不可・要確認）データを書き出す
    await new Promise((resolve, reject) => {
      try {
        console.log("📋 不明(法人番号なし)データのCSVを書き出し中...");
        const writeStream = fs.createWriteStream(unknownCsvFileName, {
          encoding: "utf8",
        });
        writeStream.write(
          Papa.unparse([outputInsertHeaderData], {
            header: false,
            quotes: false,
          }),
        );
        writeStream.write("\n");
        noCorpData.forEach((company) => {
          writeStream.write(
            Papa.unparse([company], { header: false, quotes: false }),
          );
          writeStream.write("\n");
        });
        console.log(
          `✅ 不明(法人番号なし)データのCSV書き出し完了: ${noCorpData.length}件`,
        );
        resolve();
      } catch (error) {
        console.error("❌ 不明データのCSV書き出しエラー:", error);
        reject(error);
      }
    });
  } catch (error) {
    throw error;
  }
};

// スクリプトのメイン処理を実行
main();
