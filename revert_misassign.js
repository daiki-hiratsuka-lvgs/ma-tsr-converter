const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const D=path.join(__dirname,"output/final_deliverables");
const V=JSON.parse(fs.readFileSync(path.join(__dirname,"output/reaudit91_verdicts.json"),"utf8"));
const revert=new Set(V.filter(a=>a.verdict==="wrong"||a.verdict==="uncertain").map(a=>String(a.tsr)));
console.log("差し戻し:",[...revert]);
// 新規.csv 読み込み
const nP=Papa.parse(fs.readFileSync(path.join(D,"新規.csv"),"utf8"),{header:true,skipEmptyLines:true});
const nFields=nP.meta.fields;
const removed=[],keep=[];
nP.data.forEach(r=>{(revert.has(String(r["TSR_companyno__c"]))?removed:keep).push(r);});
console.log("新規から除去:",removed.length,"/ 残",keep.length);
// 不明.csv スキーマへマップ
const uP=Papa.parse(fs.readFileSync(path.join(D,"不明_法人番号なし.csv"),"utf8"),{header:true,skipEmptyLines:true});
const uFields=uP.meta.fields;
const mapped=removed.map(r=>{const o={};uFields.forEach(f=>o[f]=r[f]??"");if("houjinbangou__c" in o)o["houjinbangou__c"]="";o["法人番号_確定状況"]="不明(監査差戻)";o["AI判定_結果"]="wrong/uncertain";return o;});
const newUnk=uP.data.concat(mapped);
// 書き出し
fs.writeFileSync(path.join(D,"新規.csv"),Papa.unparse({fields:nFields,data:keep.map(r=>nFields.map(f=>r[f]??""))},{quotes:true})+"\n");
fs.writeFileSync(path.join(D,"不明_法人番号なし.csv"),Papa.unparse({fields:uFields,data:newUnk.map(r=>uFields.map(f=>r[f]??""))},{quotes:true})+"\n");
console.log("新規:",nP.data.length,"→",keep.length," / 不明:",uP.data.length,"→",newUnk.length);
