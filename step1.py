import glob
import os
import pprint
import sys
import re
import json
import csv
import time
import datetime
from typing import Tuple
from pdfminer.high_level import extract_pages
from pdfminer.layout import LTTextContainer

def check_range_in_square(position: Tuple[float, float, float, float], offset: Tuple[float, float, float, float]) -> bool:
    x0, y0, x1, y1 = position
    o_x0, o_y0, o_x1, o_y1 = offset
    return o_x0 <= x0 <= o_x1 and o_x0 <= x1 <= o_x1 and o_y0 <= y0 <= o_y1 and o_y0 <= y1 <= o_y1

def extract_fiscal_date(column: int, text: str, position: Tuple[float, float, float, float]) -> str:
    """決算年月の情報を抽出"""
    
    if ("決算年月 売上（千円） 税込引 利益（千円）配当 取引銀行" in text):
        if (text.count("\n") == 3):
            # 3年分の場合
            split_text = text.split("\n")
            return split_text[column]
    else:
        if check_range_in_square(position, (151, 163, 207, 182)):
            if column == 3:
                # 1年分の場合
                return text
        elif check_range_in_square(position, (151, 163, 207, 195)):
            if column == 2 or column == 3:
                # 2年分の場合
                split_text = text.split("\n")
                return split_text[column - 2]

    return ""

def extract_revenue(column: int, text: str, position: Tuple[float, float, float, float]) -> str:
    """売上の情報を抽出"""
    
    newline_count = text.count("\n")
    if newline_count == 2:
        split_text = text.split("\n")
        if 0 <= column - 1 < len(split_text):
            return split_text[column - 1]
    elif newline_count == 1:
        if check_range_in_square(position, (201, 176, 286, 206)):
            split_text = text.split("\n")
            if 0 <= column - 1 < len(split_text):
                return split_text[column - 1]
        elif check_range_in_square(position, (201, 163, 286, 195)):
            split_text = text.split("\n")
            if 0 <= column - 2 < len(split_text):
                return split_text[column - 2]
    elif newline_count == 0:
        if check_range_in_square(position, (201, 189, 286, 206)):
            if column == 1:
                return text
        elif check_range_in_square(position, (201, 176, 286, 194)):
            if column == 2:
                return text
        elif check_range_in_square(position, (201, 163, 286, 182)):
            if column == 3:
                return text
    
    return ""

def extract_income(column: int, text: str, position: Tuple[float, float, float, float]) -> str:
    """利益の情報を抽出"""
    
    newline_count = text.count("\n")
    if newline_count == 2:
        split_text = text.split("\n")
        if 0 <= column - 1 < len(split_text):
            return split_text[column - 1]
    elif newline_count == 1:
        if check_range_in_square(position, (317, 176, 385, 206)):
            split_text = text.split("\n")
            if 0 <= column - 1 < len(split_text):
                return split_text[column - 1]
        elif check_range_in_square(position, (317, 163, 385, 195)):
            split_text = text.split("\n")
            if 0 <= column - 2 < len(split_text):
                return split_text[column - 2]
    elif newline_count == 0:
        if check_range_in_square(position, (317, 189, 385, 206)):
            if column == 1:
                return text
        elif check_range_in_square(position, (317, 176, 385, 194)):
            if column == 2:
                return text
        elif check_range_in_square(position, (317, 163, 385, 182)):
            if column == 3:
                return text
    
    return ""

def extract_revenue_growth_rate(text: str) -> str:
    """売上伸長率を抽出"""

    split_text = text.split(" ")
    if "売上伸長率" in split_text:
        growth_rate_index = split_text.index("売上伸長率") + 1
        if growth_rate_index < len(split_text):
            return split_text[growth_rate_index]
    
    return ""
    
def extract_income_growth_rate(text: str) -> str:
    """利益伸長率を抽出"""

    split_text = text.split(" ")
    if "利益伸長率" in split_text:
        growth_rate_index = split_text.index("利益伸長率") + 1
        if growth_rate_index < len(split_text):
            return split_text[growth_rate_index]
    
    return ""
    
def execute_function(key: str, text: str, position: Tuple[float, float, float, float]) -> str:
    """文字列から特定の情報を抽出"""

    if (key == "kessannengetsu_1_c"):
        return extract_fiscal_date(1, text, position)
    if (key == "kessannengetsu_2_c"):
        return extract_fiscal_date(2, text, position)
    if (key == "kessannengetsu_3_c"):
        return extract_fiscal_date(3, text, position)
    if (key == "uriage_1_c"):
        return extract_revenue(1, text, position)
    if (key == "uriage_2_c"):
        return extract_revenue(2, text, position)
    if (key == "uriage_3_c"):
        return extract_revenue(3, text, position)
    if (key == "rieki_1_c"):
        return extract_income(1, text, position)
    if (key == "rieki_2_c"):
        return extract_income(2, text, position)
    if (key == "rieki_3_c"):
        return extract_income(3, text, position)
    if (key == "uriagesinchoritsu_c"):
        return extract_revenue_growth_rate(text)
    if (key == "riekishinchoritsu_c"):
        return extract_income_growth_rate(text)

def format_string(text: str) -> str:
    """テキストをフォーマットする"""
    
    text = text.replace("\n", "")
    text = text.replace("\u3000", " ")
    return text

def contert_pdf_page_to_dict(config: json, page_layout: list, replace_pattern: dict) -> dict:
    """PDFのページから辞書に変換"""

    detected_text = {}

    for item in config:
        detected_text[item["name_bq"]] = ""

    for element in page_layout:
        if isinstance(element, LTTextContainer):
            
            for item in config:
                text_parts = []

                if (detected_text[item["name_bq"]] == "" and check_range_in_square(element.bbox, item["rect"])):

                    text = element.get_text()

                    if item["name_bq"] in replace_pattern:
                        text = re.sub(replace_pattern[item["name_bq"]], "", text).strip()
                    
                    if "func" in item:
                        text = execute_function(item["name_bq"], text, element.bbox)
                    
                    text_parts.append(text)
        
                if len(text_parts) > 0:
                    detected_text[item["name_bq"]] = format_string(" ".join(text_parts))
    
    return detected_text

def extract_with_pdfminer(filename: str, config: json, page_list: list, csv_filename: str, is_need_header: bool = True) -> int:
    """PDFから情報を抽出"""

    try:
        pages_data = list(extract_pages(filename))
        total_pages = len(pages_data)

        if (page_list == None or page_list == []):
            page_list = range(total_pages)

        # 正規表現のパターンオブジェクトを作成しておく
        replace_pattern = {}
        for item in config:
            if "exclude" in item:
                replace_pattern[item["name_bq"]] = re.compile("|".join(item["exclude"]))

        if csv_filename == None:
            
            # コンソール出力の場合
            for page_num in page_list:
                detected_text = contert_pdf_page_to_dict(config, pages_data[page_num], replace_pattern)
                pprint.pprint(detected_text)
                print(f"page {page_num + 1}/{total_pages} is finished...")
        
        else:

            # ファイル出力の場合
            write_header = False
            if (is_need_header):
                try:
                    with open(csv_filename, "r") as f:
                        content = f.readline().strip() # 1行目だけ読み込んでファイルチェック
                        if len(content) == 0:
                            write_header = True
                except FileNotFoundError:
                    write_header = True
            
            with open(csv_filename, "a") as f:
                
                column_name_list = [item["name_bq"] for item in config]
                writer = csv.DictWriter(f, column_name_list)
                
                if write_header:
                    writer.writeheader()
            
                for page_num in page_list:
                    detected_text = contert_pdf_page_to_dict(config, pages_data[page_num], replace_pattern)
                    writer.writerow(detected_text)
                    print(f"page {page_num + 1}/{total_pages} is finished...")
    
        return 0
        
    except Exception as e:
        print(e)
        return 1

def natural_sort_key(filename: str) -> list:
    """自然順ソート用のキーを生成"""

    parts = re.split(r'(\d+)', filename)
    return [int(part) if part.isdigit() else None for part in parts]

def get_sorted_pdf_files(dirname: str) -> list:
    """ディレクトリ内の全てのPDFファイルを取得してソート"""
    
    try:
        if not os.path.exists(dirname):
            print(f"Error: Directory '{dirname}' does not exist.")
            return []
        
        if not os.path.isdir(dirname):
            print(f"Error: '{dirname}' is not a directory.")
            return []
        
        # 再帰的にPDFファイルを検索
        pdf_files = []
        for root, _, files in os.walk(dirname):
            for file in files:
                if file.lower().endswith('.pdf'):
                    pdf_files.append(os.path.join(root, file))
        
        pdf_files.sort(key=natural_sort_key)
        
        pdf_basenames = [os.path.basename(f) for f in pdf_files]
        
        print(f"Found {len(pdf_files)} PDF files in '{dirname}':")
        for i, filename in enumerate(pdf_basenames, 1):
            print(f"  {i}. {filename}")
        print()
        
        return pdf_files
        
    except Exception as e:
        print(f"Error while scanning directory: {e}")
        return []

def string_to_number_list(text: str) -> list:
    """文字列から数字のリストを作成"""

    try:
        number_list = json.loads(text)
        return [n - 1 for n in number_list]
    except json.JSONDecodeError:
        return []

if __name__ == "__main__":
    
    argv = sys.argv
    argc = len(argv)

    config_filename = "config_pdfminer.json"
    with open(config_filename, "rb") as f:
        config = json.load(f)

    reset_flag = False
    filename = None
    dirname = None
    page_list = None
    csv_filename = "output/step1.csv"
    for index, item in enumerate(argv):
        if argv[index] == "--reset-output":
            reset_flag = True
        if index + 1 >= argc:
            break
        elif item == "-f":
            filename = argv[index + 1]
        elif item == "-d":
            dirname = argv[index + 1]
        elif item == "-p":
            page_list = string_to_number_list(argv[index + 1])
        elif item == "-o":
            csv_filename = argv[index + 1]
    
    if filename != None and dirname != None:
        print("Error: both a file name and a directory name is not allowed.")
        print('Argument Usage: python3 step1.py (-f: filename | -d directory name) (-p: pagelist ex."[1,2,10,4]") (-o: output csv filename)')
        sys.exit(1)

    if not os.path.exists(csv_filename):
        os.makedirs(os.path.dirname(csv_filename), exist_ok=True)

    if reset_flag:
        try:
            os.remove(csv_filename)
            print(f"Output file delete successfully: {csv_filename}")
        except Exception as e:
            print(f"Error: Could not delete output file {e}")
            sys.exit(1)

    start_time = time.time()
    print("---pdf to csv convert process started successfully---")
    print()

    if dirname == None:
        # 一つのファイルを入力にする
        extract_with_pdfminer(filename, config, page_list, csv_filename, True)
    else:
        # ディレクトリ内の全てのファイルを入力にする
        filename_list = get_sorted_pdf_files(dirname)
        total_files = len(filename_list)
        error_file_list = []
        
        for filecount, filename in enumerate(filename_list, 1):
            print(f"---{filecount}/{total_files} loading {filename}...---")
            result = extract_with_pdfminer(filename, config, page_list, csv_filename, filecount == 1)
            
            if result != 0:
                error_file_list.append(filename)

    end_time = time.time()    
    print("---pdf to csv convert process finished successfully---")
    print()
    print("---summary---")
    print(f"start time: {datetime.datetime.fromtimestamp(start_time)}")
    print(f"end time: {datetime.datetime.fromtimestamp(end_time)}")
    print(f"process time: {end_time - start_time} seconds")
    print()
    
    if len(error_file_list) > 0:
        print("---error file list---")
        pprint.pprint(error_file_list)
        print()
    
    sys.exit(0)
