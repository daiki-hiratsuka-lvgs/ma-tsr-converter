// 「社名＝代表者姓(+商店/工業等)×同一市区町村」でstep4照合。屋号/個人名的社名の改称を厳密に拾う。
// 対象: SF残(corp-eligible未確定) + TSR不明68。候補提示のみ(後で監査)。
const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const {normName,normAddr,parseTsrAddresses}=require(path.join(__dirname,"match_util"));
const D=path.join(__dirname,"output/final_deliverables");
const city=a=>{const m=(a||"").normalize("NFKC").match(/^(.+?[都道府県])(.+?[市区町村])/);return m?normName(m[1]+m[2]):"";};
const stripK=s=>normName(s).replace(/^(株式会社|有限会社|合同会社|合資会社|合名会社)/,"").replace(/(株式会社|有限会社)$/,"");
const surname=r=>{const s=(r||"").normalize("NFKC").replace(/[A-Za-z0-9]/g,"").trim().split(/[\s　]/)[0]||"";return s.length>=2?normName(s):"";};
const suf=["","商店","工業","製作所","建設","興業","産業","店","組","運送","商事","工務店","電気","自動車","農園","水産","製作","鉄工","建材","土木"];
const done=new Set(Papa.parse(fs.readFileSync(path.join(D,"ダミー番号修正リスト.csv"),"utf8"),{header:true,skipEmptyLines:true}).data.map(r=>String(r.SF_Id)));
const T=[];
// SF残
["sf932_strong","sf932_mid","sf932_multi","sf932_zero"].forEach(n=>JSON.parse(fs.readFileSync(path.join(__dirname,"output/"+n+".json"),"utf8")).forEach(x=>{if(done.has(String(x.SF_Id)))return;const sn=surname(x.rep);const cities=[...new Set(parseTsrAddresses({CompanyAddress__c:x.本社,OwnerAddress__c:x.owner,Eigyosho__c:x.eig}).map(city).filter(Boolean))];if(!sn||!cities.length)return;T.push({id:String(x.SF_Id),src:"SFダミー",name:x.社名,rep:x.rep,sn,cities,dummy:x.dummy,addr:x.本社});}));
// TSR不明68
Papa.parse(fs.readFileSync(path.join(D,"不明_法人番号なし.csv"),"utf8"),{header:true,skipEmptyLines:true}).data.forEach(r=>{const sn=surname(r["Representative__c"]);const cities=[...new Set(parseTsrAddresses(r).map(city).filter(Boolean))];if(!sn||!cities.length)return;T.push({id:"TSR:"+r["TSR_companyno__c"],src:"TSR不明",name:r["Name"],rep:r["Representative__c"],sn,cities,dummy:"",addr:r["CompanyAddress__c"]});});
// 期待社名core集合(姓+接尾) × 市 のキー
const want=new Map(); // "core|city" -> [target]
T.forEach(t=>{suf.forEach(s=>{const core=normName(t.sn+s);t.cities.forEach(c=>{const k=core+"|"+c;if(!want.has(k))want.set(k,[]);want.get(k).push(t);});});});
console.log("対象:",T.length,"(SF残"+T.filter(t=>t.src==="SFダミー").length+"/TSR不明"+T.filter(t=>t.src==="TSR不明").length+") / 期待キー",want.size);
let idx=null,n=0;const hits=new Map();
Papa.parse(fs.createReadStream(path.join(__dirname,"output/step4.csv"),{encoding:"utf8"}),{header:false,skipEmptyLines:true,step:row=>{
 const d=row.data;if(idx===null){const h=d.map(x=>x.replace(/^﻿/,"").replace(/"/g,"").trim());idx={corp:h.indexOf("corporate_number"),name:h.indexOf("company_name"),pref:h.indexOf("prefecture"),a1:h.indexOf("address1"),a2:h.indexOf("address2"),a3:h.indexOf("address3")};return;}
 n++;const core=stripK(d[idx.name]||"");const cty=city((d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||""));if(!core||!cty)return;
 const k=core+"|"+cty;if(!want.has(k))return;
 want.get(k).forEach(t=>{if(!hits.has(t.id))hits.set(t.id,{t,c:[]});const h=hits.get(t.id);if(!h.c.find(x=>x.corp===d[idx.corp]))h.c.push({corp:d[idx.corp],name:d[idx.name],loc:(d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||"")+(d[idx.a3]||"")});});
},complete:()=>{
 const out=[];
 for(const {t,c} of hits.values()){if(c.length&&c.length<=3)out.push({id:t.id,src:t.src,社名:t.name,代表者:t.rep,本社住所:t.addr,dummy:t.dummy,候補:c.map(x=>x.corp+"["+x.name+"]/"+x.loc.slice(0,20))});}
 fs.writeFileSync(path.join(__dirname,"output/sf_surname_cand.json"),JSON.stringify(out,null,1));
 console.log("step4走査",n,"/ 社名=代表者姓(+接尾)×同市 の候補(1-3):",out.length,"→ sf_surname_cand.json");
 out.slice(0,20).forEach(o=>console.log("  ["+o.src+"] "+(o.社名||"").slice(0,14).padEnd(14)+" 代表"+(o.代表者||"").slice(0,8)+" → "+o.候補[0]));
},error:e=>console.error(e)});
