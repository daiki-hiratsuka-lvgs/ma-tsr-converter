// 確定540件の修正後法人番号を国税庁step4で照合し、登記の都道府県/社名がTSRと大きく食い違うもの(=同名別法人の誤付与疑い)を検出。
const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const {normName}=require(path.join(__dirname,"match_util"));
const D=path.join(__dirname,"output/final_deliverables");
const prefOf=a=>{const m=(a||"").normalize("NFKC").match(/^.*?[都道府県]/);return m?m[0]:"";};
const rows=Papa.parse(fs.readFileSync(path.join(D,"ダミー番号修正リスト.csv"),"utf8"),{header:true,skipEmptyLines:true}).data;
const corpSet=new Set(rows.map(r=>(r["修正後法人番号"]||"").replace(/\D/g,"")).filter(c=>c.length===13));
const reg=new Map();let idx=null,n=0;
Papa.parse(fs.createReadStream(path.join(__dirname,"output/step4.csv"),{encoding:"utf8"}),{header:false,skipEmptyLines:true,step:row=>{
 const d=row.data;if(idx===null){const h=d.map(x=>x.replace(/^﻿/,"").replace(/"/g,"").trim());idx={corp:h.indexOf("corporate_number"),name:h.indexOf("company_name"),pref:h.indexOf("prefecture"),a1:h.indexOf("address1"),a2:h.indexOf("address2"),a3:h.indexOf("address3")};return;}
 n++;const c=d[idx.corp];if(!corpSet.has(c))return;
 reg.set(c,{name:d[idx.name]||"",pref:d[idx.pref]||"",loc:(d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||"")+(d[idx.a3]||"")});
},complete:()=>{
 let notInStep4=0,prefMismatch=0,ok=0;const flags=[];
 rows.forEach(r=>{const c=(r["修正後法人番号"]||"").replace(/\D/g,"");if(c.length!==13)return;const rg=reg.get(c);
  if(!rg){notInStep4++;flags.push({t:"step4に無し",社名:r["社名"],corp:c,取得元:r["取得元"]});return;}
  const tp=prefOf(r["本社住所"]);const rp=rg.pref;
  if(tp&&rp&&tp!==rp){prefMismatch++;flags.push({t:"都道府県不一致",社名:r["社名"],corp:c,TSR県:tp,登記県:rp,登記名:rg.name,取得元:r["取得元"]});}
  else ok++;
 });
 console.log("step4走査",n,"/ 確定"+rows.length+"件の照合:");
 console.log("  登記県=TSR県 一致:",ok);
 console.log("  ★都道府県不一致(要再確認):",prefMismatch);
 console.log("  step4に該当番号なし(gBiz/新規登記等):",notInStep4);
 fs.writeFileSync(path.join(__dirname,"output/verify540_flags.json"),JSON.stringify(flags,null,1));
 console.log("--- 都道府県不一致の例(同名別法人 or 県外移転) ---");
 flags.filter(f=>f.t==="都道府県不一致").slice(0,20).forEach(f=>console.log("  "+(f.社名||"").slice(0,18).padEnd(18)+" "+f.corp+" TSR:"+f.TSR県+" vs 登記:"+f.登記県+" ["+(f.登記名||"").slice(0,14)+"] 取得元:"+(f.取得元||"").slice(0,12)));
},error:e=>console.error(e)});
