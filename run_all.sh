#!/bin/bash
# TSR→Salesforce 変換パイプラインを step2 以降まとめて実行する。
#   step2(名寄せ・重複排除) → step3(SF突合) → 法人番号付与(国税庁/gBiz 4段階)
#   → step6(SF Id付与) → 不明への候補付与(bcd/gbiz_confirm) → 4種集約
#
# 事前準備(一度だけ):
#   - output/step1.csv … step1(PDF→CSV) の出力
#   - output/step4.csv … step4(国税庁データ名寄せ) の出力
#   - Salesforce エクスポートCSV(既定 extract.csv。Id/TSR_companyno__c/houjinbangou__c を含むこと)
#   - ~/.gbiz_token … gBizINFO API トークン
#
# 使い方:
#   bash run_all.sh [作成・更新日] [SalesForceのCSV]
#   例: bash run_all.sh 2026-6-22 extract.csv
set -e
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export NODE_OPTIONS=--max-old-space-size=8192

UPDATE_DATE="${1:-2026-6-22}"   # SalesForceに登録する作成・更新日
SF_CSV="${2:-extract.csv}"      # Salesforce エクスポートCSV
STEP6_DIR="output/conffinal"    # step6(確定分)の出力先
DELIV_DIR="output/final_deliverables"

LOG() { echo "===== [$(date +%H:%M:%S)] $1 ====="; }
mkdir -p "$DELIV_DIR"
rm -rf "$STEP6_DIR"

LOG "STEP2 名寄せ(重複排除)"
node step2.js -u "$UPDATE_DATE" | tail -3

LOG "STEP3 SF突合(TSR番号)"
node step3.js -s "$SF_CSV" | tail -3

LOG "KOKUZEI 国税庁 SS/S/A 突合"
node kokuzei_assign.js | tail -2

LOG "GBIZ 経産省(gBiz) SS/S/A 突合(国税庁SS/S確定分はスキップ)"
node gbiz_assign.js | tail -3

LOG "FINAL_ASSIGN 4段階カスケードで最終確定"
node final_assign.js | grep -A7 "統合結果"

LOG "PRODUCE_FINAL 確定/不明 分離"
node produce_final.js | tail -3

# 4種集約の種を用意（更新=step3の更新データ、不明=確定できなかった新規）
cp output/final_kakutei_unknown.csv "$DELIV_DIR/不明_法人番号なし.csv"
cp output/step3_update.csv "$DELIV_DIR/更新.csv"

LOG "STEP6 確定分に SF Id を付与"
node step6.js -i output/final_kakutei_confirmed.csv -s "$SF_CSV" -o "$STEP6_DIR" | grep 判定完了

LOG "BCD 不明に B/C/D 候補列を付与(国税庁+gBiz)"
node bcd_candidates.js | tail -2

LOG "GBIZ_CONFIRM 不明の候補を gBiz詳細(代表者/設立/郵便/カナ)で裏取り（確定はせず候補提示のみ）"
node gbiz_confirm.js | tail -4

CF=$(ls -1dt "$STEP6_DIR"/step6_* | head -1)
LOG "CONSOLIDATE 4分類集約 ($CF)"
node consolidate_deliverables.js "$CF"

LOG "ALL DONE -> $DELIV_DIR/{更新,新規,要確認_重複,不明_法人番号なし}.csv"
