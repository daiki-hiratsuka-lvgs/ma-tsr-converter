// 残493(corp-eligible未確定)を step4 に「同一町丁 × 名称トークン部分一致」で照合。
// 完全一致(既済)でも住所のみ(同居別会社)でもない中間。部分改称/接尾変更/表記ゆれを住所で絞って拾う。
const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const {normName,normAddr,parseTsrAddresses}=require(path.join(__dirname,"match_util"));
const D=path.join(__dirname,"output/final_deliverables");
const cho=a=>normAddr(a).replace(/[0-9\-－]+$/,"").replace(/[0-9\-－]/g,"");  // 町丁レベル(番地除去)
const stripK=s=>normName(s).replace(/^(株式会社|有限会社|合同会社|合資会社|合名会社)/,"").replace(/(株式会社|有限会社)$/,"");
const done=new Set(Papa.parse(fs.readFileSync(path.join(D,"ダミー番号修正リスト.csv"),"utf8"),{header:true,skipEmptyLines:true}).data.map(r=>String(r.SF_Id)));
const T=[];
["sf932_strong","sf932_mid","sf932_multi","sf932_zero"].forEach(n=>JSON.parse(fs.readFileSync(path.join(__dirname,"output/"+n+".json"),"utf8")).forEach(x=>{if(done.has(String(x.SF_Id)))return;const addrs=parseTsrAddresses({CompanyAddress__c:x.本社,OwnerAddress__c:x.owner,Eigyosho__c:x.eig});const chos=[...new Set(addrs.map(cho).filter(c=>c&&c.length>=4))];const core=stripK(x.社名);if(!chos.length||core.length<2)return;T.push({id:String(x.SF_Id),name:x.社名,core,chos,rep:x.rep,gyo:x.gyo,dummy:x.dummy,addr:x.本社});}));
const choSet=new Set();T.forEach(t=>t.chos.forEach(c=>choSet.add(c)));
console.log("対象:",T.length,"/ 町丁キー",choSet.size);
const byCho=new Map();let idx=null,n=0;
Papa.parse(fs.createReadStream(path.join(__dirname,"output/step4.csv"),{encoding:"utf8"}),{header:false,skipEmptyLines:true,step:row=>{
 const d=row.data;if(idx===null){const h=d.map(x=>x.replace(/^﻿/,"").replace(/"/g,"").trim());idx={corp:h.indexOf("corporate_number"),name:h.indexOf("company_name"),pref:h.indexOf("prefecture"),a1:h.indexOf("address1"),a2:h.indexOf("address2"),a3:h.indexOf("address3")};return;}
 n++;const c=cho((d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||""));if(!c||!choSet.has(c))return;
 if(!byCho.has(c))byCho.set(c,[]);const a=byCho.get(c);if(a.length<200)a.push({corp:d[idx.corp],name:d[idx.name]||"",core:stripK(d[idx.name]||""),loc:(d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||"")+(d[idx.a3]||"")});
},complete:()=>{
 const out=[];
 for(const t of T){const seen=new Map();
  t.chos.forEach(ch=>(byCho.get(ch)||[]).forEach(c=>{if(!c.core||c.core===t.core)return; // 完全一致は既済なので除外、部分のみ
   const overlap=(t.core.length>=c.core.length)?t.core.includes(c.core):c.core.includes(t.core);
   const distinctive=Math.min(t.core.length,c.core.length)>=2;
   if(overlap&&distinctive&&!seen.has(c.corp))seen.set(c.corp,c);}));
  if(seen.size&&seen.size<=3){out.push({SF_Id:t.id,社名:t.name,本社住所:t.addr,代表者:t.rep,dummy:t.dummy,候補:[...seen.values()].map(c=>c.corp+"["+c.name+"]/"+c.loc.slice(0,20))});}
 }
 fs.writeFileSync(path.join(__dirname,"output/sf_token_cand.json"),JSON.stringify(out,null,1));
 console.log("step4走査",n,"/ 同一町丁×名称部分一致(候補1-3)の残:",out.length,"→ sf_token_cand.json");
 out.slice(0,20).forEach(o=>console.log("  "+(o.社名||"").slice(0,16).padEnd(16)+" → "+o.候補.slice(0,2).join(" | ")));
},error:e=>console.error(e)});
