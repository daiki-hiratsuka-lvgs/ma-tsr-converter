# TSR → DataLoader 変換ツール

TSR の企業データを SalesForce の DataLoader 向けに高速変換します。

## 初回セットアップ

### A. python の仮想環境を構築する

動作確認済みの python のバージョンは 3.13.2 です。

    python3 -m venv .venv
    source .venv/bin/activate (MacOSの場合)
    pip install -r requirements.txt

### B. node の実行環境を構築する

動作確認済みの node のバージョンは v22.18.0 です。

    nvm use
    npm install

## step1 TSR の PDF データを CSV に変換する

    python step1.py -d <PDFがあるディレクトリ名>

デフォルトの出力ファイル名は`output/tsr_converted_from_pdf.csv`が生成されます。<br/>出力ファイル名を変更する場合は`-o`オプションを使ってください。<br/>
デフォルトでは出力ファイル名に「追記」する挙動をします。<br/>出力ファイルの中身を初期化してから書き出したい場合は`--reset-output`オプションを付けてください。

## step2 CSV を名寄せする

    node step2.js -u <TSRのバックナンバー (例: 2025年12月1日なら "2025-12-1")>

デフォルトの入力ファイル名は`output/tsr_converted_from_pdf.csv`です。<br/>入力ファイル名を変更する場合は`-i`オプションを使ってください。<br/>
デフォルトの出力ファイル名は`output/tsr_validated.csv`です。<br/>出力ファイル名を変更する場合は`-o`オプションを使ってください。

## step3 Salesforce の CSV と統合する

あらかじめ M&A の Salesforce から会社データを CSV 形式で出力しておいてください。
※ SF のデータには、必ず「**Id**, **TSR_companyno\_\_c**, **houjinbangou\_\_c**」の三つのカラムを含めてください。

    node step3.js -s <Salesforceの会社データのファイル名>

デフォルトの入力ファイル名は`output/tsr_validated.csv`です。<br/>入力ファイル名を変更する場合は`-i`オプションを使ってください。<br/>

### 生成されるファイル

2 つの CSV ファイルが生成されます。<br/>SalesForce の会社データと TSR の会社データに共通して TSR コードが存在するか（**TSR_companyno\_\_c の有無**）で新規追加か更新かを振り分けています。

#### A: 更新用の企業情報

デフォルトのファイル名: `output/tsr_update_companies.csv`<br/>
出力ファイル名を変更する場合は、step3 で`--output-update`オプションを使ってください。

空文字を取り除けば DataLoader に Update として入力することができます。<br/>
下記のコマンドを実行してから DataLoader に入力してください。

    node remove_empty_quotes.js -i <入力ファイル名>

#### B: 新規追加の企業情報

デフォルトのファイル名: `output/tsr_new_companies.csv`<br/>
出力ファイル名を変更する場合は、step3 で`--output-new`オプションを使ってください。

## step4 法人番号の CSV ファイルを名寄せする

あらかじめ、[国税庁のウェブサイト](https://www.houjin-bangou.nta.go.jp/download/zenken/)から法人番号の一覧ファイルを**CSV 形式・Unicode**でダウンロードしてください。

    node step4.js -i <国税庁の法人番号一覧ファイルのパス>

デフォルトの出力ファイル名は`output/corporate_number_validated.csv`です。<br/>出力ファイル名を変更する場合は`-o`オプションを使ってください。<br/>

## step5 新規追加の企業情報に法人番号を付加する

    node step5.js

デフォルトの**新規追加の企業リスト**のファイル名は`output/tsr_new_companies.csv`です。<br/>ファイル名を変更する場合は`-i`オプションを使ってください。<br/>

デフォルトの**名寄せした法人番号リスト**のファイル名は`output/corporate_number_validated.csv`です。<br/>ファイル名を変更する場合は`-c`オプションを使ってください。<br/>

デフォルトの出力ファイル名は`output/tsr_with_corporate_number.csv`です。<br/>ファイル名を変更する場合は`-o`オプションを使ってください。<br/>

### どんな処理をしているのか

step3 で作成した新規追加の企業リストに step4 で名寄せした法人番号のリストを統合させます。なお、統合は会社名・住所の一致度合いで統合させているので、必ずしも正しい法人番号が付与させるとは限りません。そこで、一致度合いを表す「**信頼度**」別で出力ファイルを分けるようにしました。高い信頼度順に検索していって、一致結果が一件に絞り込めなかった場合は低い信頼度で再検索します。

#### 信頼度のパラメータと意味

- 「SS」会社名、都道府県、市区町村、住所が完全一致
- 「S」会社名、都道府県、市区町村が完全一致、住所の前半が部分一致（ビル名以降は判断しない）
- 「A」会社名、都道府県、市区町村が完全一致、住所の町丁が部分一致（番地以降は判断しない）
- 「B」会社名、都道府県、市区町村が完全一致
- 「C」会社名、都道府県が完全一致
- 「D」会社名が完全一致
- 「F」どれにも一致しなかった（法人番号は付与されない）

## step6 新規追加の企業情報に SalesForce の ID を付与する

    node step6.js -i <step5で出力されたファイル名> -s <SalesForceのファイル名> -o <出力ファイル名>

法人番号が付与された企業のうち、SalesForce に法人番号などが既に登録されている企業が存在するかチェックする。SF のデータと照合して、SF の ID・法人番号が存在してかつ、TSR データがない新規追加の企業を探して、法人番号をキーに SF の ID を付与する処理を動かす。
※ SF のデータには、必ず「**Id**, **TSR_companyno\_\_c**, **houjinbangou\_\_c**」の三つのカラムを含めてください。

### 生成されるファイル

2 つの CSV ファイルが生成されます。<br/>SF の ID が存在しない新規追加のデータ `<出力ファイル名>_insert.csv` と、SF の ID が存在したデータ `<出力ファイル名>_update.csv` の二つが出力されるので、それぞれ DataLoader の Insert と Update 操作を行なってください。
