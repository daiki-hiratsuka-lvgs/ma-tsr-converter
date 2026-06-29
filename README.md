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

`-d` で指定されたディレクトリ配下にある **全ての** PDF ファイルを再帰的に探索して CSV に変換します。

### コマンドのオプション

| オプション | 説明 | デフォルト |
| --- | --- | --- |
| `-d` | PDF があるディレクトリ名 | （必須） |
| `-o` | 出力ファイル名 | `output/tsr_converted_from_pdf.csv` |
| `--reset-output` | 出力ファイルを初期化してから書き出す（未指定時は追記） | 追記 |

## step2 CSV を名寄せする

    node step2.js -u <作成・更新日>

step1 で作成した CSV ファイルを名寄せします。

### コマンドのオプション

| オプション | 説明 | デフォルト |
| --- | --- | --- |
| `-u` | SalesForceのレコードに登録する作成・更新日<br/> (例: 2025年12月1日なら "2025-12-1") | `""` |
| `-i` | 入力ファイル名 (CSV) | `output/step1.csv` |
| `-o` | 出力ファイル名 (CSV) | `output/step2.csv` |

## step3 Salesforce の CSV と突合する

    node step3.js -s <Salesforceの入力ファイル名>

step2 で作成した CSV ファイルと SalesForce のデータを突合して、企業データが新規か更新かを自動的に振り分けます。

### SalesForce のデータの下準備
DataLoader を使って Salesforce から会社データを CSV 形式で出力する必要があります。<br/>
※ ただし、SalesForce の会社データには、必ず「**Id**, **TSR_companyno\_\_c**, **houjinbangou\_\_c**」の三つのカラムを含めてください。これを含めないと正しく突合できません。

### 生成されるファイル

CSV ファイルが 2 つ作成されます。<br/>
三つのカラムの有無（**Id**, **TSR_companyno\_\_c**, **houjinbangou\_\_c**）で、企業データが新規か更新かを自動的に振り分けます。
- 更新データのファイルパス（デフォルト値）：`output/step3_update.csv`
- 新規データのファイルパス（デフォルト値）：`output/step3_insert.csv`

### コマンドのオプション

| オプション | 説明 | デフォルト |
| --- | --- | --- |
| `-s` | SalesForce の入力ファイル名 (CSV) | （必須） |
| `-i` | step2 で作成したファイル名 (CSV) | `output/step2.csv` |
| `--output-update` | 更新データの出力ファイル名 (CSV) | `output/step3_update.csv` |
| `--output-insert` | 新規データの出力ファイル名 (CSV) | `output/step3_insert.csv` |

## step4 法人番号の CSV ファイルを名寄せする

    node step4.js -i <国税庁の法人番号の一覧ファイル名>

新規の企業データに対しては法人番号が付与されておらず、法人番号がないと SalesForce に登録できません。国税庁の法人番号の一覧データの住所部分を名寄せすることで、step5 でより高い精度で法人番号を突合することができます。

### 国税庁のデータの下準備
[国税庁のウェブサイト](https://www.houjin-bangou.nta.go.jp/download/zenken/)から法人番号の一覧ファイルを**CSV 形式・Unicode**でダウンロードしてください。

### コマンドのオプション

| オプション | 説明 | デフォルト |
| --- | --- | --- |
| `-i` | 国税庁の法人番号の一覧ファイル名 (CSV) | （必須） |
| `-o` | 出力ファイル名 (CSV) | `output/step4.csv` |

## step5 新規データに法人番号を付与する

    node step5.js

### コマンドのオプション

| オプション | 説明 | デフォルト |
| --- | --- | --- |
| `-i` | step3 で作成した新規データの出力ファイル名 (CSV) | `output/step3_insert.csv` |
| `-c` | step4 で作成したファイル名 (CSV) | `output/step4.csv` |
| `-o` | 出力ファイルのディレクトリ名 | `output` |

### どんな処理をしているのか

step3 で作成した新規データに step4 で名寄せした法人番号のリストを突合させて、法人番号を付与します。<br/>
突合結果の出力には、会社所在地で突合して「**信頼度**」別で出力ファイルを分けています。<br/>
高い信頼度の検索方法で検索していき、法人番号の一致結果が一件にならない場合は低い信頼度で再検索します。

#### 信頼度のパラメータと意味

- 「SS」会社名、都道府県、市区町村、住所が完全一致
- 「S」会社名、都道府県、市区町村が完全一致、住所の前半が部分一致（ビル名以降は判断しない）
- 「A」会社名、都道府県、市区町村が完全一致、住所の町丁が部分一致（番地以降は判断しない）
- 「B」会社名、都道府県、市区町村が完全一致
- 「C」会社名、都道府県が完全一致
- 「D」会社名が完全一致
- 「F」どれにも一致しなかった（法人番号は付与されない）

## step6 新規データに SalesForce の ID を付与する

    node step6.js -i <step5で作成した出力ファイル名> -s <SalesForceの入力ファイル名>

### コマンドのオプション

| オプション | 説明 | デフォルト |
| --- | --- | --- |
| `-i` | step5 で作成した出力ファイル名 (CSV) | （必須） |
| `-s` | SalesForce の入力ファイル名 (CSV) | （必須） |
| `-o` | 出力ファイルのディレクトリ名 | `output` |

### どんな処理をしているのか

step5 で新規データに法人番号を付与したら、法人番号をもとに SalesForce の Id を付与できる場合があります。（すなわち、**付与できた場合は新規データではなく更新データになる**）<br/>
再度、SalesForce の企業データを Id で突合することで、新規データが本当に新規データなのかをチェックします。

### 生成されるファイル

2 つの CSV ファイルが生成されます。
- SalesForce の ID が存在しない新規データ：`insert.csv`
- SalesForce の ID が存在する**更新データ**：`update.csv`

## どんなファイルを DataLoader に読み込ませるべきか

### 更新データ

次の２種類
- step3 で作成した更新データ（デフォルト名：`output/step3_update.csv`）
- step6 で作成した更新データ（デフォルト名：`output/step6_<日付>/update.csv`）

### 新規データ

※ step3 で作成した新規データを読み込ませないこと（step6 で ID の有無の確認をとること）
- step6 で作成した新規データ（デフォルト名：`output/step6_<日付>/insert.csv`）