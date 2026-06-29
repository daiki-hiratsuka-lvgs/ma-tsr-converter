// 必要なライブラリをインポート
const path = require("path");
const fs = require("fs");
const Papa = require("papaparse");

// コマンドライン引数を取得
const args = process.argv;

let mainCsvFilePath = "";
let outputCsvFilePath = "output/corporate_number_validated.csv";

// 引数をパース
for (let i = 0; i < args.length - 1; i++) {
  if (args[i] === "-i") {
    mainCsvFilePath = args[i + 1];
    i++;
  } else if (args[i] === "-o") {
    outputCsvFilePath = args[i + 1];
    i++;
  }
}

// -----------------------------------------------------------
// 変換メソッド群
// -----------------------------------------------------------

// 名寄せ用の会社名を正規化するコアのメソッド
const convertFullWidthNameForDeduplication = (name) => {
  if (!name) return "";
  let normalizedName = String(name).normalize("NFKC");
  normalizedName = normalizedName.replace(/[\s\u3000]/g, ""); // 全角半角スペースを削除
  normalizedName = normalizedName.toUpperCase(); // アルファベットを大文字に
  normalizedName = normalizedName.replace(/[.,:;!?・'"`~-]/g, ""); // 記号を削除
  normalizedName = normalizedName.replace(/（株）|㈱|\(株\)/g, "株式会社"); // 法人格表記を統一
  return normalizedName;
};

// デバッグログを表示幅を揃えて出力
const isFullWidth = (ch) => /[^\u0020-\u007E]/.test(ch);

const displayWidth = (s) => {
  let w = 0;
  for (const ch of String(s)) w += isFullWidth(ch) ? 2 : 1;
  return w;
};

const padDisplay = (s, width) => {
  s = String(s);
  const w = displayWidth(s);
  if (w >= width) return s;
  return s + " ".repeat(width - w);
};

// 住所の番地部分を分割する関数
const splitAddressAndNumber = (address) => {
  if (!address) return ["", ""];

  const match = address.match(/^(.+?)([０-９]+.*)$/);
  if (match) {
    const baseAddress = match[1];
    const numberPart = match[2];
    return [baseAddress, numberPart];
  }

  // 数字部分が見つからない場合は全体を住所として返す
  return [address, ""];
};

// 丁目以降を名寄せする (マンション・ビル名以降は判定に使わない)
const validateChomeAddress = (address, debugLog = false) => {
  const matchList = [
    [
      /^(.+?)(?:第)?([０-９]+)(?:号)([０-９]+)(?:番地|番|蕃地|番地の|番の|蕃地の|番地ノ|番ノ|蕃地ノ|ー|―|‐|－)([０-９]+)$/,
      "{1}{2}－{3}－{4}",
      false,
    ],
    [
      /^(.+?)(?:第)?([０-９]+)(?:号)([０-９]+)(?:番地|番|蕃地|番地の|番の|蕃地の|番地ノ|番ノ|蕃地ノ|ー|―|‐|－)([０-９]+)(.*)$/,
      "{1}{2}－{3}－{4}",
      false,
    ],
    [
      /^(.+?)(?:第)?([０-９]+)(?:号)([０-９]+)(?:番地|番|蕃地)$/,
      "{1}{2}－{3}",
      false,
    ],
    [
      /^(.+?)(?:第)?([０-９]+)(?:号)([０-９]+)(?:番地|番|蕃地)(.*)$/,
      "{1}{2}－{3}",
      false,
    ],
    [
      /^(.+?)([０-９]+)(?:丁目|丁|ー|―|‐|－)([０-９]+)(?:番地|番|蕃地|番地の|番の|蕃地の|番地ノ|番ノ|蕃地ノ|ー|―|‐|－)([０-９]+)(?:ー|―|‐|－)([０-９]+)(?:号)$/,
      "{1}{2}－{3}－{4}－{5}",
      false,
    ],
    [
      /^(.+?)([０-９]+)(?:丁目|丁|ー|―|‐|－)([０-９]+)(?:番地|番|蕃地|番地の|番の|蕃地の|番地ノ|番ノ|蕃地ノ|ー|―|‐|－)([０-９]+)(?:ー|―|‐|－)([０-９]+)(?:号)(.*)$/,
      "{1}{2}－{3}－{4}－{5}",
      true,
    ],
    [
      /^(.+?)([０-９]+)(?:丁目|丁|ー|―|‐|－)([０-９]+)(?:番地|番|蕃地|番地の|番の|蕃地の|番地ノ|番ノ|蕃地ノ|ー|―|‐|－)([０-９]+)(?:ー|―|‐|－)([０-９]+)(?![FＦf階])(.*)$/,
      "{1}{2}－{3}－{4}－{5}",
      true,
    ],
    [
      /^(.+?)([０-９]+)(?:丁目|丁|ー|―|‐|－)([０-９]+)(?:番地|番|蕃地|番地の|番の|蕃地の|番地ノ|番ノ|蕃地ノ|ー|―|‐|－)([０-９]+)(?:号)$/,
      "{1}{2}－{3}－{4}",
      false,
    ],
    [
      /^(.+?)([０-９]+)(?:丁目|丁|ー|―|‐|－)([０-９]+)(?:番地|番|蕃地|番地の|番の|蕃地の|番地ノ|番ノ|蕃地ノ|ー|―|‐|－)([０-９]+)(?:号)(.*)$/,
      "{1}{2}－{3}－{4}",
      true,
    ],
    [
      /^(.+?)([０-９]+)(?:丁目|丁|ー|―|‐|－)([０-９]+)(?:番地|番|蕃地|番地の|番の|蕃地の|番地ノ|番ノ|蕃地ノ|ー|―|‐|－)([０-９]+)(?![FＦf階])(.*)$/,
      "{1}{2}－{3}－{4}",
      true,
    ],
    [
      /^(.+?)([０-９]+)(?:丁目|丁|ー|―|‐|－)([０-９]+)(?:番地|番|蕃地)$/,
      "{1}{2}－{3}",
      false,
    ],
    [
      /^(.+?)([０-９]+)(?:丁目|丁|ー|―|‐|－)([０-９]+)(?:番地|番|蕃地)(.*)$/,
      "{1}{2}－{3}",
      true,
    ],
    [
      /^(.+?)([０-９]+)(?:丁目|丁|ー|―|‐|－)(?:左|右)([０-９]+)(?:号)(.*)$/,
      "{1}{2}－{3}",
      true,
    ],
    [
      /^(.+?)([０-９]+)(?:番地|番|蕃地|番地の|番の|蕃地の|番地ノ|番ノ|蕃地ノ|ー|―|‐|－)([０-９]+)(?:号|地)$/,
      "{1}{2}－{3}",
      false,
    ],
    [
      /^(.+?)([０-９]+)(?:番地|番|蕃地|番地の|番の|蕃地の|番地ノ|番ノ|蕃地ノ|ー|―|‐|－)([０-９]+)(?:号|地)(.*)$/,
      "{1}{2}－{3}",
      true,
    ],
    [
      /^(.+?)([０-９]+)(?:丁目|丁|番地|番|蕃地|番地の|番の|蕃地の|番地ノ|番ノ|蕃地ノ|ー|―|‐|－)([０-９]+)(?![FＦf])$/,
      "{1}{2}－{3}",
      false,
    ],
    [
      /^(.+?)([０-９]+)(?:丁目|丁|番地|番|蕃地|番地の|番の|蕃地の|番地ノ|番ノ|蕃地ノ|ー|―|‐|－)([０-９]+)(?![FＦf])(.*)$/,
      "{1}{2}－{3}",
      true,
    ],
    [/^(.+?)([０-９]+)の([０-９]+)(?![FＦf])$/, "{1}{2}－{3}", false],
    [/^(.+?)([０-９]+)の([０-９]+)(?![FＦf])(.*)$/, "{1}{2}－{3}", true],
    [/^(.+?)([０-９]+)(?:丁目|丁|番地|番|蕃地|号)$/, "{1}{2}", false],
    [/^(.+?)([０-９]+)(?:番地|番|蕃地|号)(.*)$/, "{1}{2}", true],
    [/^(.+?)([０-９]+)(?![FＦfー―‐－])$/, "{1}{2}", false],
    [/^(.+?)([０-９]+)(?![FＦf])(.*)$/, "{1}{2}", true],
    [/^(.+?)(?:無番地|番外地|無号地)(.*)$/, "{1}", true],
  ];

  // 漢数字を数字に変換する関数
  const convertKanjiToNumbers = (text, suffixPattern) => {
    if (!text) return text;

    // 漢数字のマッピング
    const kanjiMap = {
      〇: "０",
      零: "０",
      一: "１",
      壱: "１",
      二: "２",
      弐: "２",
      三: "３",
      参: "３",
      四: "４",
      肆: "４",
      五: "５",
      伍: "５",
      六: "６",
      陸: "６",
      七: "７",
      漆: "７",
      八: "８",
      捌: "８",
      九: "９",
      玖: "９",
    };

    let result = text;

    // 複合パターン（十の位を含む）の変換
    const patterns = [
      // 二十七など
      {
        regex: new RegExp(`([一-九])十([一-九])${suffixPattern}`, "g"),
        replace: (match, tens, ones, suffix) =>
          (kanjiMap[tens] || tens) + (kanjiMap[ones] || ones) + suffix,
      },
      // 十七など
      {
        regex: new RegExp(`十([一-九])${suffixPattern}`, "g"),
        replace: (match, ones, suffix) =>
          "１" + (kanjiMap[ones] || ones) + suffix,
      },
      // 二十など
      {
        regex: new RegExp(`([一-九])十${suffixPattern}`, "g"),
        replace: (match, tens, suffix) =>
          (kanjiMap[tens] || tens) + "０" + suffix,
      },
      // 十
      {
        regex: new RegExp(`十${suffixPattern}`, "g"),
        replace: (match, suffix) => "１０" + suffix,
      },
    ];

    // パターンマッチング処理
    patterns.forEach((pattern) => {
      result = result.replace(pattern.regex, pattern.replace);
    });

    // 単独の漢数字を変換
    Object.keys(kanjiMap).forEach((kanji) => {
      const regex = new RegExp(`${kanji}${suffixPattern}`, "g");
      result = result.replace(
        regex,
        (match, suffix) => kanjiMap[kanji] + suffix
      );
    });

    return result;
  };

  // 文章中のカッコを外す
  // 半角数字を全角数字にする
  // 文頭の「大字」を削除する
  // 「ケ」（ひらがな・カタカナ）を「ヶ」に置換する
  // 漢数字を数字に変換する
  const extractedAddress = convertKanjiToNumbers(
    address
      .replace(/[()（）]/g, "")
      .replace(/[0-9]/g, (s) => String.fromCharCode(s.charCodeAt(0) + 0xfee0))
      .replace(/^大字/g, "")
      .replace(/[ケケ]/g, "ヶ"),
    "(条)"
  );

  // 第１２号を全て「１２」に置換
  // const extractedAddress = validatedAddress.replace(/第([０-９]+)号/g, "$1");

  for (let matchData of matchList) {
    const match = extractedAddress.match(matchData[0]);
    if (match) {
      let result = matchData[1];
      for (let i = 0; i < match.length; i++) {
        result = result.replace(`{${i}}`, match[i]);
      }
      if (debugLog && matchData[2]) {
        console.log(padDisplay(result, 40), address);
      }
      return result;
    }
  }

  return extractedAddress;
};

// -----------------------------------------------------------
// メイン処理
// -----------------------------------------------------------

// 法人番号のデータリスト
const corporateNumberDataList = [];

// 法人番号のCSVを読み込む
const main = async () => {
  // 出力先ディレクトリを作成（なければ）
  const outputDir = path.dirname(outputCsvFilePath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  await new Promise((resolve, reject) => {
    console.log("📋 法人番号のCSVを名寄せ中...");

    const readStream = fs.createReadStream(mainCsvFilePath, {
      encoding: "utf8",
    });
    const writeStream = fs.createWriteStream(outputCsvFilePath, {
      encoding: "utf8",
    });

    // ヘッダーを出力する
    const outputHeaders = [
      "corporate_number",
      "company_name",
      "prefecture",
      "address1",
      "address2",
      "address3",
    ];
    writeStream.write("\ufeff");
    writeStream.write(
      Papa.unparse([outputHeaders], { header: false, quotes: true })
    );
    writeStream.write("\n");

    let rowCounter = 0;
    Papa.parse(readStream, {
      header: false,
      skipEmptyLines: true,
      step: (row) => {
        const orignal = row.data;

        const corporateNumber = orignal[1];
        const companyName = convertFullWidthNameForDeduplication(orignal[6]);
        const [prefecture, address1, rawChomeAddress] = [
          orignal[9],
          orignal[10],
          orignal[11],
        ];
        const chomeAddress = validateChomeAddress(rawChomeAddress);
        const [address2, address3] = splitAddressAndNumber(chomeAddress);
        writeStream.write(
          Papa.unparse(
            [
              [
                corporateNumber,
                companyName,
                prefecture,
                address1,
                address2,
                address3,
              ],
            ],
            { header: false, quotes: true }
          )
        );
        writeStream.write("\n");
        rowCounter++;
      },
      complete: () => {
        console.log(`✅ 法人番号のCSVの名寄せ完了: ${rowCounter}件`);
        resolve();
      },
      error: (error) => {
        console.error("❌ 法人番号のCSVの名寄せエラー:", error);
        reject(error);
      },
    });
  });
};

main();
