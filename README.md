# TSR → DataLoader 変換ツール

TSR（東京商工リサーチ）の企業 PDF を、Salesforce DataLoader 用 CSV（新規/更新）に変換する。

**処理の流れ**

- step1: PDF → CSV
- step2: 名寄せ（重複排除）
- step3: SF 既存と突合 → 新規/更新に振り分け
- step4: 国税庁 法人番号データ準備
- step5: 新規に法人番号付与（国税庁/gBiz、SS/S/A）
- step6: 法人番号から SF Id 付与（既存企業は更新へ回す）
- step7: 成果物を4種（更新/新規/要確認_重複/不明）に集約

## セットアップ

- 動作確認: Python 3.13.2 / Node v22.18.0
- Python: `python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`
- Node: `nvm use && npm install`

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
  - ほぼ全法人の「法人番号・商号・所在地」を網羅。社名＋住所のみ（代表者・設立等は持たない）
  - 上記から CSV・Unicode 形式でダウンロード
- **[経済産業省 gBizINFO](https://info.gbiz.go.jp/)**（`gbiz_assign.js` / `gbiz_confirm.js`）
  - 代表者名・設立年月・資本金・従業員数・郵便番号・カナ 等を付加（ただし全法人網羅ではなく、空が多い）
  - Web API 利用。上記サイトで登録したトークンを `~/.gbiz_token` に配置

**一致レベル**（会社名の完全一致が前提。住所の一致深度でレベル付け）

| レベル | 住所の一致範囲 | 扱い |
| --- | --- | --- |
| SS | 番地まで完全一致 | 確定 |
| S | 市区町村一致＋住所前半一致（ビル名以降は不問） | 確定 |
| A | 町丁まで一致（番地以降は不問） | 確定 |
| B | 市区町村まで一致 | 不明（候補のみ） |
| C | 都道府県まで一致 | 不明（候補のみ） |
| D | 会社名のみ一致 | 不明（候補のみ） |

- **SS/S/A のみ確定採用**。B 以下は同名別法人の恐れがあり確定しない（不明。候補提示のみ）
- TSR の複数住所（本社/オーナー/営業所）は全て照合し、最良レベルを採用

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

**出力**

- `insert.csv`: SF に存在しない新規
- `update.csv`: SF に存在する更新
- `duplicate.csv`: SF 側で一意に紐づかない（要確認）
- `unknown_no_corp.csv`: 法人番号なしの隔離（新規に混ぜない）

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

- 4ファイルの合計 = step2 のユニーク TSR 総数（検算に使える）
- 不明は候補列（`候補_*` / `候補_gBiz_*`）を手動確認の手掛かりに

**DataLoader 投入時の注意**

- 登録するのは `更新.csv`（更新）と `新規.csv`（新規）のみ。`要確認_重複.csv` / `不明_法人番号なし.csv` は登録しない
- `step3_insert.csv` を直接読み込まない（法人番号・SF Id の確認前のため）。必ず集約済みの `新規.csv` を使う
