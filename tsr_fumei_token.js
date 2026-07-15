// TSR不明68に、SFダミーで有効だった「同一町丁×名称部分一致」+「core完全一致×同市」をstep4適用。
const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const {normName,normAddr,parseTsrAddresses}=require(path.join(__dirname,"match_util"));
const D=path.join(__dirname,"output/final_deliverables");
const cho=a=>normAddr(a).replace(/[0-9\-－]+$/,"").replace(/[0-9\-－]/g,"");
const city=a=>{const m=(a||"").normalize("NFKC").match(/^(.+?[都道府県])(.+?[市区町村])/);return m?normName(m[1]+m[2]):"";};
const stripK=s=>normName(s).replace(/^(株式会社|有限会社|合同会社|合資会社|合名会社)/,"").replace(/(株式会社|有限会社)$/,"");
const rows=Papa.parse(fs.readFileSync(path.join(D,"不明_法人番号なし.csv"),"utf8"),{header:true,skipEmptyLines:true}).data;
const T=rows.map(r=>{const addrs=parseTsrAddresses(r);return {tsr:r["TSR_companyno__c"],name:r["Name"],core:stripK(r["Name"]),rep:r["Representative__c"]||"",gyo:r["Eigyosyumoku__c"]||"",addr:r["CompanyAddress__c"]||"",chos:[...new Set(addrs.map(cho).filter(c=>c&&c.length>=4))],cities:[...new Set(addrs.map(city).filter(Boolean))]};}).filter(t=>t.core.length>=2&&(t.chos.length||t.cities.length));
const choSet=new Set();T.forEach(t=>t.chos.forEach(c=>choSet.add(c)));
const citySet=new Set();T.forEach(t=>t.cities.forEach(c=>citySet.add(c)));
console.log("TSR不明 対象:",T.length);
let idx=null,n=0;const byCho=new Map(),byCity=new Map();
Papa.parse(fs.createReadStream(path.join(__dirname,"output/step4.csv"),{encoding:"utf8"}),{header:false,skipEmptyLines:true,step:row=>{
 const d=row.data;if(idx===null){const h=d.map(x=>x.replace(/^﻿/,"").replace(/"/g,"").trim());idx={corp:h.indexOf("corporate_number"),name:h.indexOf("company_name"),pref:h.indexOf("prefecture"),a1:h.indexOf("address1"),a2:h.indexOf("address2"),a3:h.indexOf("address3")};return;}
 n++;const loc=(d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||"")+(d[idx.a3]||"");const ch=cho((d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||""));const ci=city((d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||""));const core=stripK(d[idx.name]||"");if(!core)return;
 const rec={corp:d[idx.corp],name:d[idx.name],core,loc};
 if(ch&&choSet.has(ch)){if(!byCho.has(ch))byCho.set(ch,[]);const a=byCho.get(ch);if(a.length<300)a.push(rec);}
 if(ci&&citySet.has(ci)){if(!byCity.has(ci))byCity.set(ci,[]);const a=byCity.get(ci);if(a.length<500)a.push(rec);}
},complete:()=>{
 const out=[];
 for(const t of T){const seen=new Map();
  // 町丁×部分名称
  t.chos.forEach(ch=>(byCho.get(ch)||[]).forEach(c=>{if(!c.core)return;const ov=(t.core.length>=c.core.length)?t.core.includes(c.core):c.core.includes(t.core);if(ov&&Math.min(t.core.length,c.core.length)>=2&&c.core!==t.core&&!seen.has(c.corp))seen.set(c.corp,{...c,k:"町丁×部分名称"});}));
  // core完全一致×同市(名称一致は既済だが不明は別処理経路なので念のため)
  t.cities.forEach(ci=>(byCity.get(ci)||[]).forEach(c=>{if(c.core===t.core&&!seen.has(c.corp))seen.set(c.corp,{...c,k:"社名core一致×同市"});}));
  if(seen.size&&seen.size<=4)out.push({tsr:t.tsr,社名:t.name,代表者:t.rep,本社住所:t.addr,候補:[...seen.values()].map(c=>c.corp+"["+c.name+"]/"+c.loc.slice(0,22)+" ("+c.k+")")});
 }
 fs.writeFileSync(path.join(__dirname,"output/tsr_fumei_token_cand.json"),JSON.stringify(out,null,1));
 console.log("step4走査",n,"/ 不明68で候補(1-4):",out.length,"→ tsr_fumei_token_cand.json");
 out.forEach(o=>console.log("  "+(o.社名||"").slice(0,16).padEnd(16)+" → "+o.候補.slice(0,2).join(" | ")));
},error:e=>console.error(e)});
