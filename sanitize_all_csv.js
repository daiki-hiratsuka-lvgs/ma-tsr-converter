// final_deliverables 内の全CSVで、フィールド値の改行(\r,\n)を除去し1レコード=1物理行に整形。全列空行は削除。
const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const D=path.join(__dirname,"output/final_deliverables");
const clean=v=>(v==null?"":String(v)).replace(/\r\n|\r|\n/g," ").replace(/ {2,}/g," ").trim();
const files=fs.readdirSync(D).filter(f=>f.endsWith(".csv"));
const small=files.filter(f=>fs.statSync(path.join(D,f)).size<400*1024*1024);
const big=files.filter(f=>!small.includes(f));
for(const f of small){
  const p=Papa.parse(fs.readFileSync(path.join(D,f),"utf8"),{header:true,skipEmptyLines:true});
  const fields=p.meta.fields;
  const rows=p.data.filter(r=>fields.some(k=>clean(r[k])!==""));
  fs.writeFileSync(path.join(D,f),Papa.unparse({fields,data:rows.map(r=>fields.map(k=>clean(r[k])))},{quotes:true})+"\n");
  console.log(f.padEnd(28),rows.length,"行 整形");
}
// 大ファイル(更新)は streaming
(function(){const f=big.find(x=>/更新/.test(x));if(!f)return;
 const F=path.join(D,f),TMP=F+".tmp";const ws=fs.createWriteStream(TMP,{encoding:"utf8"});
 let hdr=null,n=0;
 Papa.parse(fs.createReadStream(F,{encoding:"utf8"}),{header:false,skipEmptyLines:true,
  step:row=>{const d=row.data.map(clean);if(hdr===null){hdr=d;ws.write(Papa.unparse([d],{header:false,quotes:true})+"\n");return;}if(d.every(x=>x==="")) return;n++;ws.write(Papa.unparse([d],{header:false,quotes:true})+"\n");},
  complete:()=>ws.end(()=>{fs.renameSync(TMP,F);console.log(f.padEnd(28),n,"行 整形(stream)");}),
  error:e=>console.error(e)});
})();
