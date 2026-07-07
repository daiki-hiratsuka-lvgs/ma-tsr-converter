// 照合共通ユーティリティ（kokuzei_assign / gbiz_assign / final_assign から使用）
// - 会社名/住所の正規化
// - TSRの複数住所（本社・オーナー・営業所）対応
// - SS/S/A の住所一致深度判定

const normName = (s) =>
  (s || "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[（）()・,．.、,]/g, "")
    .toLowerCase();

const kanjiToArabic = (str) => {
  const digit = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const unit = { 十: 10, 百: 100, 千: 1000 };
  return str.replace(/[〇零一二三四五六七八九十百千]+/g, (seq) => {
    let total = 0;
    let current = 0;
    for (const ch of seq) {
      if (digit[ch] !== undefined) {
        current = digit[ch];
      } else if (unit[ch] !== undefined) {
        current = (current === 0 ? 1 : current) * unit[ch];
        total += current;
        current = 0;
      }
    }
    return String(total + current);
  });
};

// 住所に現れる旧字体・異体字 → 新字体（NFKCで畳めないもの）
const KYUJITAI = {
  "國": "国", "惠": "恵", "眞": "真", "萬": "万", "萊": "莱", "彌": "弥",
  "螢": "蛍", "雞": "鶏", "假": "仮", "澤": "沢", "齋": "斎", "齊": "斉",
  "濱": "浜", "濵": "浜", "邊": "辺", "邉": "辺", "龍": "竜", "廣": "広",
  "冨": "富", "嶋": "島", "嶌": "島", "舘": "館", "儘": "侭", "槇": "槙",
};
const KD = { "〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
// 大字（正式表記の数字）→ 標準漢数字（例: 参番越=三番越, 拾=十）
const DAIJI = { "壱": "一", "弌": "一", "弐": "二", "貳": "二", "参": "三", "參": "三", "肆": "四", "伍": "五", "陸": "六", "漆": "七", "捌": "八", "玖": "九", "拾": "十" };
// 建物名の記述子（この語を含む末尾を建物名として除去する）
const BLD = "ビルディング|ビル|マンション|タワー|レジデンス|ハイツ|コーポラス|コーポ|ハウス|プラザ|ヒルズ|テラス|パレス|メゾン|アパート|ハイム|コート|スクエア|アネックス|ANNEX|サーパス|ホームズ|荘|棟|館";

const normAddr = (s) => {
  if (!s) return "";
  // (1) 全角/半角・英字大小を統一（NFKC + 大文字化）
  let a = s.normalize("NFKC").toUpperCase();
  // (2) 旧字体・異体字 → 新字体、大字数字 → 標準漢数字
  a = a.replace(/[國惠眞萬萊彌螢雞假澤齋齊濱濵邊邉龍廣冨嶋嶌舘儘槇]/g, (ch) => KYUJITAI[ch] || ch);
  a = a.replace(/[壱弌弐貳参參肆伍陸漆捌玖拾]/g, (ch) => DAIJI[ch] || ch);
  // (3) 「十」＋算用数字の混在を数値化（純漢数字は後段の kanjiToArabic に委ねる）
  const toN = (c, def) => (c == null ? def : (KD[c] !== undefined ? KD[c] : Number(c)));
  a = a.replace(/([一二三四五六七八九\d])?十(\d)/g, (_, t, o) => String(toN(t, 1) * 10 + Number(o)));
  a = a.replace(/(\d)十(?![一二三四五六七八九\d])/g, (_, t) => String(Number(t) * 10));
  // (4) 純漢数字 → 算用数字
  a = kanjiToArabic(a);
  // (5) 大字/小字/字 を除去（イロハ・甲乙丙等の小字符号は別地点識別子なので残す）
  a = a.replace(/大字|小字|字/g, "");
  // (6) 重複地名（同一市名の二重記載）を除去（反復時のみ・誤爆しない）
  a = a.replace(/((.{2,4}市)[^\d]{1,4}区)\2[東西南北中央]{1,3}区/g, "$1"); // 大阪市中央区大阪市南区→大阪市中央区
  a = a.replace(/([^\d\s市区町村]{2,6})市\1/g, "$1市"); // 寒河江市寒河江→寒河江市, 長野市長野→長野市
  // (7) 表記ゆれ: が丘/ヶ丘/ヵ→ケ, ノ/之→の(有無は保持), 第N地割の「第」除去
  a = a.replace(/[がヶヵ]/g, "ケ");
  a = a.replace(/[ノ之]/g, "の");
  a = a.replace(/第(?=\d)/g, "");
  // (8) 地域特化: 北海道「N線」「N条通M左/右」、石川「N部/Nの部」、「N番耕地」、丁目直後の方角
  a = a.replace(/(\d)線/g, "$1-");
  a = a.replace(/(\d)[左右](?=\d)/g, "$1-"); // 2条通4左5 → 4-5
  a = a.replace(/(\d)の?部(?=\d)/g, "$1-"); // 石川: 57部30→57-30, 10の部2→10-2
  a = a.replace(/([ァ-ヶ])部(?=\d)/g, "$1"); // カ部10→カ10
  a = a.replace(/(\d+)番耕地/g, "$1耕地");
  a = a.replace(/(\d+)丁目(?=[東西南北])/g, "$1"); // 2丁目北→2北(方角は町名の一部)
  a = a.replace(/番地内(?=\d)/g, "-");
  // (9) 丁目/番地/番/号 等の区画表記 → ハイフン
  a = a.replace(/丁目|丁|番地|番|号|地割|街区|区画/g, "-");
  // (10) 番地の後ろの建物名（記述子を含む末尾）＋階/部屋を、直前の番地数字まで遡って除去。
  //      直前の数字は lookbehind で保持するため番地は壊さない。ダッシュ統一より前に実行し、
  //      建物記述子(サーパス/コーポ 等)の長音「ー」がハイフン化される前に判定する。
  a = a.replace(new RegExp(`(?<=\\d)-?[^0-9-]*(?:${BLD})[^-]*.*$`), "");
  a = a.replace(/(?<=\d)[ァ-ヶ][ァ-ヶー・]+.*$/, ""); // 記述子なしのカタカナ建物名
  a = a.replace(/\d+(F|階|号室).*$/, "");
  // (11) 各種ダッシュ/ハイフン → 半角ハイフン、「〜の3」の「の」もハイフン化
  a = a.replace(/[ー―‐‑–—−ｰ－]/g, "-");
  a = a.replace(/の(?=\d)/g, "-");
  // (12) 括弧・空白・記号を除去し、連続ハイフンを圧縮
  a = a.replace(/[()（）\s　.,、。・]/g, "");
  a = a.replace(/-+/g, "-").replace(/^-|-$/g, "");
  return a;
};

const choChomeLevel = (a) => a.replace(/[\d-]+$/g, "");

// 単一の住所ペアの一致レベル
const addrLevelSingle = (tsrAddr, targetAddr) => {
  const a = normAddr(tsrAddr);
  const b = normAddr(targetAddr);
  if (!a || !b) return null;
  if (a === b) return "SS";
  if (a.startsWith(b) || b.startsWith(a)) return "S";
  const ca = choChomeLevel(a);
  const cb = choChomeLevel(b);
  if (ca && ca === cb) return "A";
  return null;
};

const levelScore = { SS: 3, S: 2, A: 1 };

// TSRの複数住所のうち最良の一致レベルを返す
const bestAddrLevel = (tsrAddrList, targetAddr) => {
  let best = null;
  let bestScore = 0;
  for (const addr of tsrAddrList) {
    const lv = addrLevelSingle(addr, targetAddr);
    if (lv && levelScore[lv] > bestScore) {
      best = lv;
      bestScore = levelScore[lv];
    }
  }
  return best;
};

// TSRレコードから住所配列を作る（本社・オーナー・営業所[複数]）
const parseTsrAddresses = (record) => {
  const list = [];
  const push = (v) => {
    const s = (v || "").trim();
    if (s) list.push(s);
  };
  push(record["CompanyAddress__c"]);
  push(record["OwnerAddress__c"]);
  // 営業所: 〔種別〕住所1，住所2，... の形式
  const eig = (record["Eigyosho__c"] || "").trim();
  if (eig) {
    eig
      .replace(/〔[^〕]*〕/g, "")
      .split(/[，,]/)
      .forEach((a) => push(a));
  }
  // 重複除去
  return [...new Set(list)];
};

module.exports = {
  normName,
  normAddr,
  addrLevelSingle,
  bestAddrLevel,
  parseTsrAddresses,
  levelScore,
};
