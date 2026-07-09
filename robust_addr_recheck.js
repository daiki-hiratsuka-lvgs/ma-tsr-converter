const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const {normAddr,normName,parseTsrAddresses}=require(path.join(__dirname,"match_util"));
const cho=a=>a.replace(/[\d-]+$/g,"");
const rows=Papa.parse(fs.readFileSync(path.join(__dirname,"output/final_deliverables/不明_法人番号なし.csv"),"utf8"),{header:true,skipEmptyLines:true}).data;
const T=rows.map(r=>{const addrs=parseTsrAddresses(r);const norm=addrs.map(normAddr).filter(Boolean);return{tsr:r["TSR_companyno__c"],name:r["Name"],key:normName(r["Name"]),norm,chos:[...new Set(norm.map(cho))]};});
const bucket=new Map();T.forEach(t=>t.chos.forEach(c=>{if(c&&c.length>2){if(!bucket.has(c))bucket.set(c,[]);bucket.get(c).push(t);}}));
const lvl=(bN,t)=>{if(t.norm.includes(bN))return"SS";for(const a of t.norm)if(a.startsWith(bN)||bN.startsWith(a))return"S";const bc=cho(bN);for(const a of t.norm)if(cho(a)===bc)return"A";return null;};
let n=0,idx=null;const found=new Map();
Papa.parse(fs.createReadStream(path.join(__dirname,"output/step4.csv"),{encoding:"utf8"}),{header:false,skipEmptyLines:true,step:(row)=>{
 const d=row.data;if(idx===null){const h=d.map(x=>x.replace(/^﻿/,"").replace(/"/g,"").trim());idx={corp:h.indexOf("corporate_number"),name:h.indexOf("company_name"),pref:h.indexOf("prefecture"),a1:h.indexOf("address1"),a2:h.indexOf("address2"),a3:h.indexOf("address3")};return;}
 n++;const loc=(d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||"")+(d[idx.a3]||"");const bN=normAddr(loc);if(!bN)return;const c=cho(bN);const b=bucket.get(c);if(!b)return;
 b.forEach(t=>{const l=lvl(bN,t);if(l==="SS"||l==="S"){if(!found.has(t.tsr))found.set(t.tsr,[]);found.get(t.tsr).push({corp:d[idx.corp],name:d[idx.name],loc,level:l,nameMatch:normName(d[idx.name])===t.key});}});
},complete:()=>{
 console.log("step4走査",n,"行 / 番地(SS/S)一致corpが見つかった不明:",found.size,"件");
 let nmun=0;for(const [tsr,hs] of found){if(!hs.some(h=>h.nameMatch))nmun++;}
 console.log("  社名一致あり:",found.size-nmun,"/ 社名不一致のみ(改称候補):",nmun);
 let k=0;for(const [tsr,hs] of found){if(k++>=15)break;const t=T.find(x=>x.tsr===tsr);console.log("  "+(t.name||"").slice(0,16).padEnd(16)+" ["+hs[0].level+(hs[0].nameMatch?"/社名一致":"/社名不一致")+"] → "+hs[0].corp+" "+(hs[0].name||"").slice(0,16));}
 fs.writeFileSync(path.join(__dirname,"output/robust_addr_found.json"),JSON.stringify([...found],null,1));
},error:e=>console.error(e)});
