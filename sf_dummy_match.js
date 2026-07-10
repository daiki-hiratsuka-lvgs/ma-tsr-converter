// SF既存のダミー(非4444)で法人格ありの企業を、国税庁step4へ SS/S/A(社名+住所)で厳密照合。
// 一意なSS/S/Aのみ採用。SF Id付きの修正リストを出力(SFデータクレンジング用)。
const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const {normName,bestAddrLevel,parseTsrAddresses,levelScore}=require(path.join(__dirname,"match_util"));
const targets=JSON.parse(fs.readFileSync(path.join(__dirname,"output/sf_dummy_targets.json"),"utf8"));
// parseTsrAddresses用にキーを合わせる
const T=targets.map(t=>({...t,key:normName(t.Name),addrs:parseTsrAddresses({CompanyAddress__c:t.addr,OwnerAddress__c:t.owner,Eigyosho__c:t.eig})}));
const nameSet=new Set(T.map(t=>t.key));
const byName=new Map();
let idx=null,n=0;
Papa.parse(fs.createReadStream(path.join(__dirname,"output/step4.csv"),{encoding:"utf8"}),{header:false,skipEmptyLines:true,step:row=>{
 const d=row.data;if(idx===null){const h=d.map(x=>x.replace(/^﻿/,"").replace(/"/g,"").trim());idx={corp:h.indexOf("corporate_number"),name:h.indexOf("company_name"),pref:h.indexOf("prefecture"),a1:h.indexOf("address1"),a2:h.indexOf("address2"),a3:h.indexOf("address3")};return;}
 n++;const k=normName(d[idx.name]||"");if(!nameSet.has(k))return;
 const loc=(d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||"")+(d[idx.a3]||"");
 if(!byName.has(k))byName.set(k,[]);const a=byName.get(k);if(a.length<50)a.push({corp:d[idx.corp],loc});
},complete:()=>{
 let conf=0;const out=[];const lvc={};
 for(const t of T){const cands=byName.get(t.key)||[];cands.forEach(c=>c.lv=bestAddrLevel(t.addrs,c.loc));
  const withA=cands.filter(c=>c.lv&&["SS","S","A"].includes(c.lv));
  if(withA.length){const best=Math.max(...withA.map(c=>levelScore[c.lv]));const top=withA.filter(c=>levelScore[c.lv]===best);
   if(top.length===1){out.push({SF_Id:t.Id,TSR番号:t.tsr,社名:t.Name,本社住所:t.addr,旧ダミー番号:t.dummy,修正後法人番号:top[0].corp,一致レベル:top[0].lv,登記住所:top[0].loc});conf++;lvc[top[0].lv]=(lvc[top[0].lv]||0)+1;}
  }
 }
 out.sort((a,b)=>({SS:0,S:1,A:2})[a.一致レベル]-({SS:0,S:1,A:2})[b.一致レベル]);
 const fields=["SF_Id","TSR番号","社名","本社住所","旧ダミー番号","修正後法人番号","一致レベル","登記住所"];
 fs.writeFileSync(path.join(__dirname,"output/sf_dummy_ssa.json"),JSON.stringify(out,null,1));
 fs.writeFileSync(path.join(__dirname,"output/final_deliverables/SFダミー修正候補_SSA.csv"),Papa.unparse({fields,data:out.map(r=>fields.map(f=>r[f]??""))},{quotes:true})+"\n");
 console.log("step4走査",n,"/ 対象",T.length,"→ SS/S/A一意確定:",conf,JSON.stringify(lvc));
 out.slice(0,12).forEach(o=>console.log("  ["+o.一致レベル+"] "+(o.社名||"").slice(0,20).padEnd(20)+o.旧ダミー番号+"→"+o.修正後法人番号));
}});
