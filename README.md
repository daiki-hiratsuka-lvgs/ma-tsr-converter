# TSR → DataLoader 変換ツール

TSR（東京商工リサーチ）の企業 PDF を、Salesforce DataLoader 用 CSV（新規/更新）に変換し、新規企業へ**法人番号**を厳密に付与する。

## 全体の流れ

**基本パイプライン（step1〜step7）** — PDF から4種の成果物まで

| step | 内容 | 主なスクリプト |
| --- | --- | --- |
| 1 | PDF → CSV | `step1.py` |
| 2 | 名寄せ（重複排除） | `step2.js` |
| 3 | SF 既存と突合 → 新規/更新に振り分け | `step3.js` |
| 4 | 国税庁 法人番号データ準備 | `step4.js` |
| 5 | 新規に法人番号付与（国税庁/gBiz、SS/S/A） | `kokuzei_assign.js` / `gbiz_assign.js` / `final_assign.js` / `produce_final.js` |
| 6 | 法人番号から SF Id 付与（既存は更新へ） | `step6.js` |
| 7 | 成果物を4種に集約 | `consolidate_deliverables.js` |

**回収パート（任意・随時）** — 「不明」「ダミー」を厳密に減らす

| 章 | 内容 | 主なスクリプト |
| --- | --- | --- |
| 不明の回収 | SF照合・AI登記調査・各種新手法で不明に法人番号を付与 | `sf_recover.js` ほか（→手法カタログ） |
| 更新側ダミーの回収 | SF既存のダミー番号（仮番号）を実番号に修正 | `match_dummy89.js` / `cand_dummy36.js` / `fix_dummy*.js` |
| 精度の見直し | 過去採用を敵対的監査し、誤付与を不明へ差し戻し | `revert_misassign.js` |
| 成果物の整形 | フィールド内改行を除去し1レコード=1行に | `sanitize_deliverables.js` |

## 精度の鉄則（誤付与は禁止）

- **確定は「登記（国税庁）の現/旧 社名＋住所が TSR と一致」した場合のみ。** 代表者・電話・公式サイト等の外部情報は補強で、単独では確定にしない
- AI/新手法で拾った候補は**必ず別エージェントの敵対的監査**（別会社の証拠を探す立場）を通してから採用。次を除外する:
  - 同名別法人（社名は同じだが別の市区町村/番地）
  - 共用/バーチャルオフィス・同居ビルの別法人（番地一致でも別会社）
  - グループ代表電話の共用・同一代表者が兼任する別会社
- 判定が割れるもの・裏取り不足は**不明のまま据え置く**（確定より不明を優先）
- 誤付与を1件出すより、不明を1件残す方が良い

## セットアップ

- 動作確認: Python 3.13.2 / Node v22.18.0
- Python: `python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`
- Node: `nvm use && npm install`
- 大きな CSV を扱うため Node は `--max-old-space-size=8192` を付けて実行（`NODE_OPTIONS=--max-old-space-size=8192 node ...`）

## 一括実行（run_all.sh）

step2〜step7 を一括実行する。

    bash run_all.sh [作成・更新日] [SalesForceのCSV]
    # 例: bash run_all.sh 2026-6-22 extract.csv

**事前準備（一度だけ）**

- `output/step1.csv`（step1 の出力）
- `output/step4.csv`（step4 の出力）
- SalesForce エクスポート CSV（既定 `extract.csv`。`Id` / `TSR_companyno__c` / `houjinbangou__c` を含む）
- `~/.gbiz_token`（gBizINFO API トークン）

## データソースと突合レベル

新規企業は法人番号を持たない（SF 登録に必須）。外部の公的データと **会社名＋住所** で突合して特定する。

**データソース**

- **[国税庁 法人番号システム](https://www.houjin-bangou.nta.go.jp/download/zenken/)**（step4 で取り込む）
  - ほぼ全法人の「法人番号・商号・所在地」を網羅。**社名＋住所のみ**（代表者・設立・変更履歴は持たない）
  - 上記から CSV・Unicode 形式でダウンロード
- **[経済産業省 gBizINFO](https://info.gbiz.go.jp/)**（`gbiz_assign.js` / `gbiz_confirm.js`）
  - 代表者名・設立年月・資本金・従業員数・郵便番号・カナ・事業所所在地 等を付加（全法人網羅ではなく空が多い）
  - Web API 利用。登録トークンを `~/.gbiz_token` に配置
- **Salesforce エクスポート**（`extract.csv`）— 回収パートで使用
  - 電話・代表者・郵便・設立・法人番号（`houjinbangou__c` / `HJBG_CorporateNumber__c` / `lbc_corporate_number__c` / `FSJP_custom_forcas_corporate_number__c`）・別名（`lbc_company_name__c` / `CompanyNameForDuplicateIdentification__c`）・カナ 等を保持
- **Web（AI調査で使用）**: `houjin.info`（登記の**変更履歴＝旧商号/旧所在地/閉鎖**）、公式サイト、電話帳逆引き、各種許可名簿、インボイス公表サイト、J-PlatPat、補助金/入札DB 等

**一致レベル**（会社名の完全一致が前提。住所の一致深度でレベル付け）

| レベル | 住所の一致範囲 | 扱い |
| --- | --- | --- |
| SS | 番地まで完全一致 | 確定 |
| S | 市区町村一致＋住所前半一致（ビル名以降は不問） | 確定 |
| A | 町丁まで一致（番地以降は不問） | 確定 |
| B | 市区町村まで一致 | 不明（候補のみ） |
| C | 都道府県まで一致 | 不明（候補のみ） |
| D | 会社名のみ一致 | 不明（候補のみ） |

- **SS/S/A のみ確定採用**。B 以下は同名別法人の恐れがあり確定しない（候補提示のみ）
- TSR の複数住所（本社/オーナー/営業所）は全て照合し、最良レベルを採用

---

# 基本パイプライン

## step1 PDF → CSV

    python step1.py -d <PDFディレクトリ>

- ディレクトリ配下の全 PDF を再帰探索して CSV 化

| オプション | 説明 | 既定 |
| --- | --- | --- |
| `-d` | PDF ディレクトリ | 必須 |
| `-o` | 出力ファイル | `output/tsr_converted_from_pdf.csv` |
| `--reset-output` | 出力を初期化（既定は追記） | 追記 |

## step2 名寄せ

    node step2.js -u <作成・更新日>

- 同一 TSR 番号の重複を排除（重複コピーが新規に紛れるのを防ぐ）。排除分は `output/step2_dropped_duplicates.csv`

| オプション | 説明 | 既定 |
| --- | --- | --- |
| `-u` | 作成・更新日（例 "2025-12-1"） | `""` |
| `-i` | 入力 CSV | `output/step1.csv` |
| `-o` | 出力 CSV | `output/step2.csv` |
| `--keep-duplicates` | 重複排除を無効化 | 排除する |

## step3 Salesforce と突合

    node step3.js -s <SalesForceのCSV>

- SF 既存データと突合し、新規/更新に振り分け
- SF CSV には `Id` / `TSR_companyno__c` / `houjinbangou__c` を必ず含める（DataLoader で出力）
- 出力: 更新 `output/step3_update.csv` / 新規 `output/step3_insert.csv`

| オプション | 説明 | 既定 |
| --- | --- | --- |
| `-s` | SF の CSV | 必須 |
| `-i` | step2 の CSV | `output/step2.csv` |
| `--output-update` | 更新の出力 | `output/step3_update.csv` |
| `--output-insert` | 新規の出力 | `output/step3_insert.csv` |

## step4 国税庁データ準備

    node step4.js -i <国税庁法人番号一覧CSV>

- 国税庁データの住所を名寄せ（step5 の突合精度が上がる）
- データは[国税庁](https://www.houjin-bangou.nta.go.jp/download/zenken/)から CSV・Unicode で取得
- 出力 `output/step4.csv` は「法人番号・商号・都道府県・住所1〜3」のみ（現在の登記。**変更履歴は持たない**点に注意）

| オプション | 説明 | 既定 |
| --- | --- | --- |
| `-i` | 国税庁 CSV | 必須 |
| `-o` | 出力 | `output/step4.csv` |

## step5 新規に法人番号付与（4段階カスケード）

- 国税庁 + gBiz の2ソースで **SS/S/A のみ採用**（B 以下は不明）
- 上位段で確定した紐付けは下位段で上書きしない（上位優先）

**実行順**

    node kokuzei_assign.js   # ① 国税庁で SS/S/A 突合
    node gbiz_assign.js      # ② gBiz で SS/S/A 突合（国税庁 SS/S 確定分はスキップ）
    node final_assign.js     # ③ 4段階で最終確定
    node produce_final.js    # ④ 確定/不明に分離

**③ 4段階の優先順**: 1. 国税庁 SS/S → 2. gBiz SS/S → 3. 国税庁 A → 4. gBiz A（一意に付与できたもののみ採用）

**④ 出力**

- `final_kakutei_confirmed.csv`: 確定分（step6 の入力）
- `final_kakutei_unknown.csv`: 不明（新規登録しない）
- `final_kakutei.csv`: 新規全件（確定分は houjinbangou 反映）

**⑤ 不明への候補ヒント付与（確定はしない・候補提示のみ）**

    node bcd_candidates.js   # B/C/D 候補（国税庁+gBiz の社名一致）を列で付与
    node gbiz_confirm.js     # gBiz 詳細で代表者/設立/郵便/カナを裏取りし一致項目を列で付与

- `bcd_candidates.js` → `候補_最良レベル / 候補_件数 / 候補_法人番号 / 候補_詳細`
- `gbiz_confirm.js` → `候補_gBiz推奨法人番号 / 候補_gBiz一致項目 / 候補_gBiz詳細`
- いずれも不明ファイルに列を追記するのみ（確定・移動はしない）

## step6 SF Id 付与

    node step6.js -i output/final_kakutei_confirmed.csv -s <SalesForceのCSV>

- 確定した法人番号で SF を再突合し、既存なら Id を付与（＝新規ではなく更新に回る）

| オプション | 説明 | 既定 |
| --- | --- | --- |
| `-i` | confirmed CSV | 必須 |
| `-s` | SF の CSV | 必須 |
| `-o` | 出力ディレクトリ | `output` |

**出力**: `insert.csv`（SF未存在＝新規） / `update.csv`（SF存在＝更新） / `duplicate.csv`（一意に紐づかない＝要確認） / `unknown_no_corp.csv`（法人番号なしの隔離）

## step7 4種に集約

    cp output/step3_update.csv "output/final_deliverables/更新.csv"
    node consolidate_deliverables.js output/step6_<日付>

`output/final_deliverables/` に4ファイルを出力。

| ファイル | 内容 | DataLoader |
| --- | --- | --- |
| `更新.csv` | 既存TSR一致(step3) ＋ 法人番号確定でSF既存(step6) | 更新 |
| `新規.csv` | 法人番号確定でSF未存在(step6) | 新規 |
| `要確認_重複.csv` | SF側で一意に紐づかない | 読み込ませない |
| `不明_法人番号なし.csv` | 法人番号を確定できず（候補列付き） | 読み込ませない |

- **4ファイルの合計 = step2 のユニーク TSR 総数**（毎回この検算を行う）

---

# 不明の回収（任意）

「不明_法人番号なし.csv」に残る企業へ、厳密性を保ったまま法人番号を付与する。株式/有限会社は必ず登記が存在するため、原理的には全て番号を持つ（不明の本質は「改称・移転・同名多数で"どの番号か"を一意化できない」こと）。

**回収の基本ループ**

1. **候補を集める**（プログラム）: 社名/住所/電話/代表者などを鍵に候補法人番号を列挙（下記カタログ）
2. **AIで調査**: `prep_dossiers*.js` で判定用バッチを生成 → AIエージェントが houjin.info の変更履歴・公式サイト・各種公開情報で1社ずつ判定
3. **敵対的監査**: 別エージェントが「別会社である証拠」を探して再検証（誤付与を防ぐ）
4. **確定分を統合**: 監査 ok のみを CSV 化し `integrate_confirmed.js` で更新/新規へ振り分け・不明から除外
5. **検算**: 4ファイル合計＝step2 ユニーク数を確認 →「成果物の整形」を実行

**確定分の統合**

    node integrate_confirmed.js <確定CSV1> [確定CSV2 ...]
    # 各入力は「不明の全列 + 採用法人番号」を持つ。SFを1回走査し、番号がSFに存在→更新(Id付与)、なければ新規へ。統合分は不明から除外

## 不明の回収手法カタログ

各手法は**候補を出すだけ**で、採用は必ず敵対的監査を通す。単独の弱い一致（電話のみ・社名唯一のみ・設立年のみ）は不採用。

| 手法 | スクリプト | 突合キー | 何を拾うか |
| --- | --- | --- | --- |
| 住所検索（改称対応） | `address_candidates.js` | 全TSR住所（社名不問） | 社名が変わったが同住所の企業 |
| 住所の堅牢再走査 | `robust_addr_recheck.js` | 正規化住所を町丁で束ね直し | 住所照合の見落とし監査 |
| gBiz 多項目裏取り | `gbiz_confirm.js` / `gbiz_strict.js` | 代表者/設立/資本金/郵便/カナ | 社名一致候補の裏付け／事業所所在地 |
| SF照合（市区町村内） | `sf_recover.js` | 電話/代表/郵便/設立（**同一市区町村必須**） | SF既存が持つ連絡先での特定＋M&A候補 |
| SF電話+代表 広域 | `sf_phone_rep.js` | 電話 ＋ (社名 or 代表者)（市制約なし） | 改称/移転しても電話+代表で追える企業 |
| SF全件 多キー横断 | `sf_crossmatch.js` / `sf_crossmatch2.js` | 社名/別名/カナ/代表+設立/郵便+社名核（**全corp列=Forcas含む**、電話不要・市制約なし） | SF内の別レコードが持つ番号（v2は住所照合付き） |
| 不明×自成果物 | `cross_own.js` | 電話/代表 ＋ 社名核/同一市区町村 | TSR内の**重複/改称の兄弟レコード**が持つ番号 |
| 属性フィンガープリント | AI調査（gBiz高度検索） | 設立年 ＋ 資本金 ＋ 都道府県 ＋ 業種 ＋ 代表者 | 社名も住所も変わった企業（属性は不変） |
| AI登記調査（改称/移転） | `prep_dossiers*.js` → `harvest_verdicts.js` | houjin.info の変更履歴（旧商号/旧所在地） | 改称・本社移転・買収を追跡して特定 |

**手法選択の指針**

- まず `address_candidates` / `bcd_candidates` / `gbiz_confirm` で候補を厚くする
- SF を持っているなら `sf_recover`（保守的）→ `sf_phone_rep` → `sf_crossmatch2`（住所照合付き）→ `cross_own` の順に広げる
- 残った難物は AI登記調査（`prep_dossiers*`）＋フィンガープリントで攻め、敵対的監査で絞る
- gBiz API の属性検索は**代表者名を結果に返さない**ため、フィンガープリントは AI が gBiz サイト/公表サイトで代表者照合する形で運用する

## 更新側ダミーの回収

SF 既存（＝更新側）には、法人番号が **ダミー（全桁同一の仮番号: `0000000000000` / `1111111111111` 等）** で登録された企業が紛れることがある。「番号あり」に見えて実質「なし」なので、実番号に修正する。

    # ① 更新.csv からダミー行を抽出（houjinbangou が全桁同一）
    # ② 国税庁 SS/S/A で厳密照合 → 実番号に置換
    node match_dummy89.js        # ダミー行 vs step4 を SS/S/A 照合
    node fix_dummy_update.js     # SS/S/A 一致分を 更新.csv で置換（ストリーミング）
    # ③ 残りは候補収集 → AI調査 → 敵対的監査 → 置換
    node cand_dummy36.js         # 残ダミーの国税庁 名称/住所候補を収集
    #   （AI調査 → 敵対的監査で ok のみ）
    node fix_dummy36.js          # 監査okを 更新.csv で置換
    node fix_dummy13.js          # 追加確定分を置換

- **確定できないダミーは、SF由来の値としてそのまま据え置く**（空欄化・0件化しない）
- 修正した企業は対応表 **`ダミー番号修正リスト.csv`**（TSR番号/SF_Id/社名/旧ダミー番号/修正後法人番号/確定方法/根拠）に出力して別途共有する

## 精度の見直し（敵対的監査）

過去の採用に誤付与や取りこぼしがないかを定期的に検証する。

- **横断検証**: 全採用（`ai*_adopt.csv` / `ai_confirmed*.csv`）を各ラウンドの verdict と突合し、「採用番号と verdict の不一致」「却下結論なのに採用が生存」を検出
- **敵対的再監査**: 疑わしい採用を別エージェントで再検証（登記の現/旧 社名＋住所で裏取り）
- **差し戻し**: 監査で wrong/uncertain（裏付け不能）となったものを不明へ戻す

    node revert_misassign.js     # 誤付与を新規/更新から不明へ差し戻し

- 経験則: 新情報源からの confirm の約 1〜2 割は同名別法人/共用オフィスの誤り。監査を省略しない
- SF の corp 列・住所は誤登録を含みうる（例: 実体は別市なのに住所だけ一致）。SF由来は候補提示のみとし、採用は必ず国税庁の一次情報で裏取りする

## 成果物の整形

    node sanitize_deliverables.js

- 各成果物のフィールド値から**埋め込み改行（`\r` / `\n`）を除去**し、1レコード=1物理行に整える（元データの役員欄等の改行がテキスト表示上「空行」に見える問題を解消）
- **`integrate_confirmed.js` の追記は、既存の複数行フィールドとの境界で CSV を破損させることがある。** 追記後は必ず本整形を実行するか、「クリーンな既存分＋確定分をソースから再生成して1回で `unparse`」する
- 整形後は「物理行 = 論理行 + ヘッダ1」を確認（断片行0）

---

# DataLoader 投入時の注意

- 登録するのは `更新.csv`（更新）と `新規.csv`（新規）のみ。`要確認_重複.csv` / `不明_法人番号なし.csv` は登録しない
- `step3_insert.csv` を直接読み込まない（法人番号・SF Id の確認前のため）。必ず集約済みの `新規.csv` を使う
- 投入前チェック: ①4ファイル合計＝step2 ユニーク数 ②新規/更新の法人番号が全て13桁・ダミー0（更新のSF由来ダミーは許容） ③新規∩更新の法人番号重複0 ④断片行0

# スクリプト一覧（付録）

- **基本**: `step2.js` `step3.js` `step4.js` `step6.js` `kokuzei_assign.js` `gbiz_assign.js` `final_assign.js` `produce_final.js` `consolidate_deliverables.js` `match_util.js`（共通: 社名/住所正規化・突合レベル判定）
- **候補付与**: `bcd_candidates.js` `gbiz_confirm.js` `gbiz_strict.js` `address_candidates.js` `robust_addr_recheck.js` `resolve_active.js`
- **SF照合**: `sf_recover.js` `sf_phone_rep.js` `sf_crossmatch.js` `sf_crossmatch2.js` `cross_own.js`
- **AI調査**: `prep_dossiers.js`〜`prep_dossiers4.js`（バッチ生成） `harvest_verdicts.js`（confirm採用）
- **統合・修正・整形**: `integrate_confirmed.js` `match_dummy89.js` `cand_dummy36.js` `fix_dummy_update.js` `fix_dummy36.js` `fix_dummy13.js` `revert_misassign.js` `sanitize_deliverables.js`
