const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const {normName,bestAddrLevel,parseTsrAddresses,levelScore}=require(path.join(__dirname,"match_util"));
const rows=Papa.parse(fs.readFileSync(path.join(__dirname,"output/update_dummy_corp.csv"),"utf8"),{header:true,skipEmptyLines:true}).data;
const T=rows.map(r=>({tsr:r["TSR_companyno__c"],name:r["Name"],key:normName(r["Name"]),addrs:parseTsrAddresses(r)}));
const nameSet=new Set(T.map(t=>t.key));
const byName=new Map();
let idx=null,n=0;
Papa.parse(fs.createReadStream(path.join(__dirname,"output/step4.csv"),{encoding:"utf8"}),{header:false,skipEmptyLines:true,step:(row)=>{
 const d=row.data;if(idx===null){const h=d.map(x=>x.replace(/^﻿/,"").replace(/"/g,"").trim());idx={corp:h.indexOf("corporate_number"),name:h.indexOf("company_name"),pref:h.indexOf("prefecture"),a1:h.indexOf("address1"),a2:h.indexOf("address2"),a3:h.indexOf("address3")};return;}
 n++;const k=normName(d[idx.name]||"");if(!nameSet.has(k))return;
 const loc=(d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||"")+(d[idx.a3]||"");
 if(!byName.has(k))byName.set(k,[]);byName.get(k).push({corp:d[idx.corp],loc});
},complete:()=>{
 let conf=0;const out=[];
 for(const t of T){const cands=byName.get(t.key)||[];cands.forEach(c=>c.lv=bestAddrLevel(t.addrs,c.loc));
  const withA=cands.filter(c=>c.lv);
  if(withA.length){const best=Math.max(...withA.map(c=>levelScore[c.lv]));const top=withA.filter(c=>levelScore[c.lv]===best);
   if(top.length===1){out.push({tsr:t.tsr,name:t.name,corp:top[0].corp,level:top[0].lv,loc:top[0].loc});conf++;}
   else out.push({tsr:t.tsr,name:t.name,corp:"",level:"複数"+top[0].lv,n:top.length});}
  else out.push({tsr:t.tsr,name:t.name,corp:"",level:cands.length?"名称のみ":"該当なし"});
 }
 fs.writeFileSync(path.join(__dirname,"output/dummy89_ssa.json"),JSON.stringify(out,null,1));
 console.log("step4走査",n,"/ 89件中 SS/S/A一意確定:",conf);
 const bl={};out.forEach(o=>{const k=o.corp?"確定("+o.level+")":o.level;bl[k]=(bl[k]||0)+1;});console.log(bl);
 out.filter(o=>o.corp).slice(0,10).forEach(o=>console.log("  "+(o.name||"").slice(0,20).padEnd(20)+" ["+o.level+"] → "+o.corp));
},error:e=>console.error(e)});
