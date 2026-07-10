// SF全件(extract.csv)で同一法人番号が複数レコードに付く重複をリスト化。
// ダミー修正リスト(確定)を反映した「修正後」の状態で判定する。ダミー(全桁同一)は除外。
const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const D=path.join(__dirname,"output/final_deliverables");
const dg=s=>(s||"").replace(/[^0-9]/g,"");
const valid=d=>d.length===13&&!/^(\d)\1{12}$/.test(d);
// 確定ダミー修正: SF_Id -> 修正後法人番号
const fix=new Map();
["ダミー番号修正リスト.csv","ダミー番号修正リスト_法人番号重複.csv"].forEach(f=>{if(fs.existsSync(path.join(D,f)))Papa.parse(fs.readFileSync(path.join(D,f),"utf8"),{header:true,skipEmptyLines:true}).data.forEach(r=>{const c=dg(r["修正後法人番号"]);if(valid(c))fix.set(String(r["SF_Id"]),c);});});
const byCorp=new Map();
let n=0;
Papa.parse(fs.createReadStream(path.join(__dirname,"extract.csv"),{encoding:"utf8"}),{header:true,skipEmptyLines:true,
 step:row=>{const r=row.data;n++;const id=String(r["Id"]||"");
  let corp=dg(r["houjinbangou__c"]);
  if(fix.has(id))corp=fix.get(id);        // ダミー修正を反映
  if(!valid(corp))return;                 // 空/ダミーは対象外
  if(!byCorp.has(corp))byCorp.set(corp,[]);
  const a=byCorp.get(corp);if(a.length<20)a.push({SF_Id:id,社名:r["Name"]||"",住所:(r["CompanyAddress__c"]||"").slice(0,28),現番号:dg(r["houjinbangou__c"]),修正:fix.has(id)?"◯":""});
 },
 complete:()=>{
  const dups=[...byCorp.entries()].filter(([c,a])=>a.length>1);
  console.log("SF全件:",n,"/ 有効法人番号(修正反映後)のユニーク:",byCorp.size);
  console.log("★同一法人番号が複数SFレコードに付く重複:",dups.length,"法人番号 /",dups.reduce((s,[c,a])=>s+a.length,0),"レコード");
  const withFix=dups.filter(([c,a])=>a.some(x=>x.修正==="◯")).length;
  console.log("  うちダミー修正が関与:",withFix,"法人番号");
  // 出力
  const fields=["法人番号","レコード数","ダミー修正関与","SF_Id","社名","住所","現番号","今回修正"];
  const rows=[];
  dups.sort((a,b)=>b[1].length-a[1].length).forEach(([c,a])=>{const involved=a.some(x=>x.修正==="◯")?"◯":"";a.forEach(x=>rows.push({法人番号:c,レコード数:a.length,ダミー修正関与:involved,SF_Id:x.SF_Id,社名:x.社名,住所:x.住所,現番号:x.現番号,今回修正:x.修正}));});
  fs.writeFileSync(path.join(D,"SF法人番号_重複リスト.csv"),Papa.unparse({fields,data:rows.map(r=>fields.map(f=>r[f]??""))},{quotes:true})+"\n");
  console.log("→ SF法人番号_重複リスト.csv ("+rows.length+"行)");
  console.log("重複件数上位:");dups.sort((a,b)=>b[1].length-a[1].length).slice(0,8).forEach(([c,a])=>console.log("  "+c+" ×"+a.length+" : "+a[0].社名.slice(0,20)));
 },error:e=>console.error(e)});
