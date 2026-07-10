// 未解決ダミー(corp-eligible uncertain + その他)を step4 に「番地で逆引き」(名称非依存)。
// TSR住所(本社/オーナー/営業所)の番地に一意に登記される法人を検出(改称で名称が変わっても拾う)。
const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const {normName,normAddr,parseTsrAddresses}=require(path.join(__dirname,"match_util"));
const M=process.argv[2];
const dg=s=>(s||"").replace(/[^0-9]/g,"");
// 確定済SF_Id(除外)
const doneIds=new Set(Papa.parse(fs.readFileSync(path.join(__dirname,"output/final_deliverables/ダミー番号修正リスト.csv"),"utf8"),{header:true,skipEmptyLines:true}).data.map(r=>String(r.SF_Id)));
// 全対象データ(SF_Id->{社名,住所群,rep,gyo})を sf932_* と sf_other から
const src=new Map();
["sf932_strong","sf932_mid","sf932_multi","sf932_zero"].forEach(n=>JSON.parse(fs.readFileSync(path.join(__dirname,"output/"+n+".json"),"utf8")).forEach(x=>src.set(String(x.SF_Id),{Name:x.社名,addr:x.本社,owner:x.owner,eig:x.eig,rep:x.rep,gyo:x.gyo,dummy:x.dummy})));
// uncertain(未確定)= srcにあってdoneにないもの
const targets=[];
for(const [id,v] of src){ if(doneIds.has(id))continue; const addrs=parseTsrAddresses({CompanyAddress__c:v.addr,OwnerAddress__c:v.owner,Eigyosho__c:v.eig}); if(!addrs.length)continue; targets.push({id,...v,addrs,akeys:[...new Set(addrs.map(a=>normAddr(a)).filter(a=>a&&/\d/.test(a)))]}); }
const akeySet=new Set();targets.forEach(t=>t.akeys.forEach(a=>akeySet.add(a)));
console.log("番地逆引き対象(未確定ダミー):",targets.length,"/ 住所キー",akeySet.size);
// step4を走査: 登記住所(normAddr)が対象の番地キーに一致するcorpを集める
const byAddr=new Map();let idx=null,n=0;
Papa.parse(fs.createReadStream(path.join(__dirname,"output/step4.csv"),{encoding:"utf8"}),{header:false,skipEmptyLines:true,step:row=>{
 const d=row.data;if(idx===null){const h=d.map(x=>x.replace(/^﻿/,"").replace(/"/g,"").trim());idx={corp:h.indexOf("corporate_number"),name:h.indexOf("company_name"),pref:h.indexOf("prefecture"),a1:h.indexOf("address1"),a2:h.indexOf("address2"),a3:h.indexOf("address3")};return;}
 n++;const loc=normAddr((d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||"")+(d[idx.a3]||""));
 if(!loc||!akeySet.has(loc))return;
 if(!byAddr.has(loc))byAddr.set(loc,[]);const a=byAddr.get(loc);if(a.length<20)a.push({corp:d[idx.corp],name:d[idx.name]||""});
},complete:()=>{
 const out=[];let uniq=0,multi=0;
 for(const t of targets){const hits=[];t.akeys.forEach(k=>(byAddr.get(k)||[]).forEach(c=>{if(!hits.find(h=>h.corp===c.corp))hits.push({...c,akey:k});}));
  if(!hits.length)continue;
  if(hits.length===1){uniq++;out.push({SF_Id:t.id,社名:t.Name,本社住所:t.addr,rep:t.rep,gyo:t.gyo,dummy:t.dummy,番地一致法人番号:hits[0].corp,登記社名:hits[0].name});}
  else {multi++;}
 }
 fs.writeFileSync(M+"/addr_uniq.json",JSON.stringify(out,null,1));
 console.log("step4走査",n,"/ 番地に一意な登記法人あり:",uniq,"(複数corp番地",multi,") → addr_uniq.json");
 out.slice(0,15).forEach(o=>console.log("  "+(o.社名||"").slice(0,18).padEnd(18)+" @"+(o.本社住所||"").slice(0,20)+" → "+o.番地一致法人番号+" ["+(o.登記社名||"").slice(0,16)+"]"));
},error:e=>console.error(e)});
