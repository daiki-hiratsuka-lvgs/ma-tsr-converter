const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const {normName,parseTsrAddresses,normAddr}=require(path.join(__dirname,"match_util"));
const choChomeLevel=a=>(a||"").replace(/[0-9\-－ー―]+$/g,"");
const ssa=JSON.parse(fs.readFileSync(path.join(__dirname,"output/dummy89_ssa.json"),"utf8"));
const done=new Set(ssa.filter(o=>o.corp&&["SS","S","A"].includes(o.level)).map(o=>String(o.tsr)));
const rows=Papa.parse(fs.readFileSync(path.join(__dirname,"output/update_dummy_corp.csv"),"utf8"),{header:true,skipEmptyLines:true}).data
 .filter(r=>!done.has(String(r["TSR_companyno__c"])));
console.log("残ダミー対象:",rows.length);
const T=rows.map(r=>({r,tsr:String(r["TSR_companyno__c"]),key:normName(r["Name"]),addrs:parseTsrAddresses(r).map(a=>choChomeLevel(normAddr(a))).filter(Boolean)}));
const nameSet=new Set(T.map(t=>t.key));
const townSet=new Set();T.forEach(t=>t.addrs.forEach(a=>townSet.add(a)));
const byName=new Map(),byTown=new Map();
let idx=null,n=0;
Papa.parse(fs.createReadStream(path.join(__dirname,"output/step4.csv"),{encoding:"utf8"}),{header:false,skipEmptyLines:true,step:(row)=>{
 const d=row.data;if(idx===null){const h=d.map(x=>x.replace(/^﻿/,"").replace(/"/g,"").trim());idx={corp:h.indexOf("corporate_number"),name:h.indexOf("company_name"),pref:h.indexOf("prefecture"),a1:h.indexOf("address1"),a2:h.indexOf("address2"),a3:h.indexOf("address3")};return;}
 n++;const nm=d[idx.name]||"";const k=normName(nm);const loc=(d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||"")+(d[idx.a3]||"");
 if(nameSet.has(k)){if(!byName.has(k))byName.set(k,[]);if(byName.get(k).length<8)byName.get(k).push({corp:d[idx.corp],name:nm,loc});}
 const town=choChomeLevel(normAddr(loc));
 if(town&&townSet.has(town)){if(!byTown.has(town))byTown.set(town,[]);if(byTown.get(town).length<40)byTown.get(town).push({corp:d[idx.corp],name:nm,loc});}
},complete:()=>{
 const out=T.map(t=>{
  const nameC=(byName.get(t.key)||[]);
  const addrC=[];t.addrs.forEach(a=>(byTown.get(a)||[]).forEach(c=>{if(!nameC.find(x=>x.corp===c.corp)&&!addrC.find(x=>x.corp===c.corp))addrC.push(c);}));
  return {tsr:t.tsr,社名:t.r["Name"],カナ:t.r["Kaisyameikana__c"]||"",本社住所:t.r["CompanyAddress__c"],代表者:t.r["Representative__c"]||"",電話:t.r["Phone"]||"",設立:t.r["establishmentDate__c"]||t.r["Sogyonengetsu__c"]||"",資本金:t.r["Shihonkin__c"]||"",業種:t.r["Eigyosyumoku__c"]||"",URL:t.r["URL__c"]||"",
   名称一致候補:nameC.map(c=>c.corp+"["+c.name+"]/"+c.loc),同町番地候補:addrC.slice(0,15).map(c=>c.corp+"["+c.name+"]/"+c.loc)};
 });
 fs.writeFileSync(path.join(__dirname,"output/dummy36_cand.json"),JSON.stringify(out,null,1));
 console.log("step4走査",n,"→ output/dummy36_cand.json");
 const c1=out.filter(o=>o.名称一致候補.length).length,c2=out.filter(o=>o.同町番地候補.length).length;
 console.log("名称一致候補あり",c1,"/ 同町番地候補あり",c2);
},error:e=>console.error(e)});
