const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const {normName,bestAddrLevel,parseTsrAddresses,levelScore}=require(path.join(__dirname,"match_util"));
const targets=JSON.parse(fs.readFileSync(path.join(__dirname,"output/sf_dummy_targets.json"),"utf8"));
const done=new Set(JSON.parse(fs.readFileSync(path.join(__dirname,"output/sf_dummy_ssa.json"),"utf8")).map(o=>String(o.SF_Id)+"|"+o.社名));
const prefOf=a=>{const m=(a||"").normalize("NFKC").match(/^.*?[都道府県]/);return m?m[0]:"";};
const T=targets.filter(t=>!done.has(String(t.Id)+"|"+t.Name)).map(t=>({...t,key:normName(t.Name),pref:prefOf(t.addr),addrs:parseTsrAddresses({CompanyAddress__c:t.addr,OwnerAddress__c:t.owner,Eigyosho__c:t.eig})}));
const nameSet=new Set(T.map(t=>t.key));
const byName=new Map();
let idx=null,n=0;
Papa.parse(fs.createReadStream(path.join(__dirname,"output/step4.csv"),{encoding:"utf8"}),{header:false,skipEmptyLines:true,step:row=>{
 const d=row.data;if(idx===null){const h=d.map(x=>x.replace(/^﻿/,"").replace(/"/g,"").trim());idx={corp:h.indexOf("corporate_number"),name:h.indexOf("company_name"),pref:h.indexOf("prefecture"),a1:h.indexOf("address1"),a2:h.indexOf("address2"),a3:h.indexOf("address3")};return;}
 n++;const k=normName(d[idx.name]||"");if(!nameSet.has(k))return;
 const loc=(d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||"")+(d[idx.a3]||"");
 if(!byName.has(k))byName.set(k,[]);const a=byName.get(k);if(a.length<60)a.push({corp:d[idx.corp],pref:d[idx.pref]||"",loc});
},complete:()=>{
 const uniqSamePref=[],uniqDiffPref=[],multi=[],zero=[];
 for(const t of T){const c=byName.get(t.key)||[];
  if(c.length===0){zero.push(t);continue;}
  if(c.length===1){ (t.pref&&c[0].pref&&t.pref===c[0].pref?uniqSamePref:uniqDiffPref).push({t,cand:c[0]}); continue;}
  // 複数: 同県の候補が1つに絞れるか
  const samePref=c.filter(x=>t.pref&&x.pref===t.pref);
  if(samePref.length===1)uniqSamePref.push({t,cand:samePref[0],note:"複数中同県唯一"});
  else multi.push({t,cands:c});
 }
 console.log("残(932想定):",T.length);
 console.log("  ①一意or同県唯一(移転強候補):",uniqSamePref.length);
 console.log("  ②全国唯一だが別県(中候補):",uniqDiffPref.length);
 console.log("  ③同名複数・同県も複数(要属性照合):",multi.length);
 console.log("  ④国税庁に同名なし(改称/異体字→AI):",zero.length);
 fs.writeFileSync(path.join(__dirname,"output/sf932_strong.json"),JSON.stringify(uniqSamePref.map(x=>({SF_Id:x.t.Id,社名:x.t.Name,本社:x.t.addr,県:x.t.pref,rep:x.t.rep,est:x.t.est,cap:x.t.cap,gyo:x.t.gyo,phone:x.t.phone,owner:x.t.owner,eig:x.t.eig,dummy:x.t.dummy,候補番号:x.cand.corp,登記:x.cand.loc,note:x.note||"一意"})),null,1));
 fs.writeFileSync(path.join(__dirname,"output/sf932_mid.json"),JSON.stringify(uniqDiffPref.map(x=>({SF_Id:x.t.Id,社名:x.t.Name,本社:x.t.addr,県:x.t.pref,rep:x.t.rep,est:x.t.est,dummy:x.t.dummy,候補番号:x.cand.corp,登記:x.cand.loc})),null,1));
 fs.writeFileSync(path.join(__dirname,"output/sf932_multi.json"),JSON.stringify(multi.map(x=>({SF_Id:x.t.Id,社名:x.t.Name,本社:x.t.addr,県:x.t.pref,rep:x.t.rep,est:x.t.est,cap:x.t.cap,gyo:x.t.gyo,dummy:x.t.dummy,候補:x.cands.slice(0,10).map(c=>c.corp+"/"+c.loc)})),null,1));
 fs.writeFileSync(path.join(__dirname,"output/sf932_zero.json"),JSON.stringify(zero.map(t=>({SF_Id:t.Id,社名:t.Name,本社:t.addr,オーナー:t.owner,営業所:(t.eig||"").slice(0,100),県:t.pref,rep:t.rep,est:t.est,cap:t.cap,gyo:t.gyo,phone:t.phone,dummy:t.dummy})),null,1));
 console.log("→ sf932_strong/mid/multi/zero.json 出力");
}});
