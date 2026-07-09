// 各成果物のフィールド値から埋め込み改行(\r,\n)を除去し、1レコード=1物理行に整える。
const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const D=path.join(__dirname,"output/final_deliverables");
const clean=v=>(v==null?"":String(v)).replace(/\r\n|\r|\n/g," ").replace(/ {2,}/g," ");
// 小ファイル: in-memory
for(const f of ["新規.csv","要確認_重複.csv","不明_法人番号なし.csv"]){
  const p=path.join(D,f);
  const parsed=Papa.parse(fs.readFileSync(p,"utf8"),{header:true,skipEmptyLines:true});
  const fields=parsed.meta.fields;
  const rows=parsed.data.filter(r=>fields.some(k=>(r[k]||"").trim()!==""));
  fs.writeFileSync(p,Papa.unparse({fields,data:rows.map(r=>fields.map(k=>clean(r[k])))},{quotes:true})+"\n");
  console.log(f,"→",rows.length,"行 (整形)");
}
// 大ファイル 更新.csv: streaming
const F=path.join(D,"更新.csv"),TMP=F+".tmp";
const ws=fs.createWriteStream(TMP,{encoding:"utf8"});
let hdr=null,n=0;
Papa.parse(fs.createReadStream(F,{encoding:"utf8"}),{header:false,skipEmptyLines:true,
  step:row=>{const d=row.data.map(clean);if(hdr===null){hdr=d;ws.write(Papa.unparse([d],{header:false,quotes:true})+"\n");return;}
    if(d.every(x=>x==="")) return; // 全列空はスキップ
    n++;ws.write(Papa.unparse([d],{header:false,quotes:true})+"\n");},
  complete:()=>{ws.end(()=>{fs.renameSync(TMP,F);console.log("更新.csv →",n,"行 (整形)");});},
  error:e=>console.error(e)});
