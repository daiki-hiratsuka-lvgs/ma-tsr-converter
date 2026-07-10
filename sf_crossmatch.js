// 不明/ダミーを SF全件(extract.csv)へ 電話不要・市区町村制約なし・多キーで横断突合。
// 目的: 改称/移転や別レコード(LBC/Forcas等の補強)でSFに存在し法人番号を持つ企業を拾う。
// キー: 社名(Name/lbc/重複判定用) / カナ / 代表者+設立年 / 郵便+社名核。SF側corpは4列を参照。
// 採用はしない=候補提示のみ(後で敵対的監査)。
const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const {normName}=require(path.join(__dirname,"match_util"));
const D=path.join(__dirname,"output/final_deliverables");
const nkana=s=>(s||"").normalize("NFKC").replace(/[\s　・,，.．ー-]/g,"").replace(/株式会社|有限会社|合同会社|合資会社|合名会社/g,"");
const nrep=s=>(s||"").normalize("NFKC").replace(/[\s　・,，.．]/g,"");
const core=s=>normName(s).replace(/^(株式会社|有限会社|合同会社|合資会社|合名会社)/,"");
const yr=s=>{const m=(s||"").match(/(\d{4})/);return m?m[1]:"";};
const pc=s=>(s||"").replace(/[^0-9]/g,"").slice(0,7);
const validCorp=s=>{const d=(s||"").replace(/[^0-9]/g,"");return d.length===13&&!/^(\d)\1{12}$/.test(d)?d:"";};

// ターゲット: 不明 + 更新ダミー
const targets=[];
Papa.parse(fs.readFileSync(path.join(D,"不明_法人番号なし.csv"),"utf8"),{header:true,skipEmptyLines:true}).data.forEach(r=>targets.push({src:"不明",r}));
Papa.parse(fs.readFileSync(path.join(__dirname,"output/update_dummy13.json"),"utf8")?"[]":"[]"); // noop
JSON.parse(fs.readFileSync(path.join(__dirname,"output/update_dummy13.json"),"utf8")).forEach(d=>{
  // update_dummy13は簡易。更新.csvからは重いので、ダミーはTSR+社名+設立+代表+郵便が要る→簡易資料から
  targets.push({src:"ダミー",r:{TSR_companyno__c:d.tsr,Name:d.社名,Kaisyameikana__c:d.カナ,Representative__c:d.代表者,establishmentDate__c:d.設立,Sogyonengetsu__c:d.設立,CompanyPostalCode__c:""}});
});
const T=targets.map(({src,r})=>({src,tsr:String(r["TSR_companyno__c"]),name:r["Name"],key:normName(r["Name"]),kana:nkana(r["Kaisyameikana__c"]),rep:nrep(r["Representative__c"]),year:yr(r["establishmentDate__c"]||r["Sogyonengetsu__c"]),core:core(r["Name"]),postal:pc(r["CompanyPostalCode__c"])}));
const byName=new Map(),byKana=new Map(),byRepYear=new Map(),byPostCore=new Map();
const add=(m,k,t)=>{if(!k)return;if(!m.has(k))m.set(k,[]);m.get(k).push(t);};
T.forEach(t=>{add(byName,t.key,t);add(byKana,t.kana,t);if(t.rep&&t.year)add(byRepYear,t.rep+"|"+t.year,t);if(t.postal&&t.core)add(byPostCore,t.postal+"|"+t.core,t);});
console.log("ターゲット:",T.length,"(不明"+T.filter(t=>t.src==="不明").length+"/ダミー"+T.filter(t=>t.src==="ダミー").length+")");

const SF_CORP=["houjinbangou__c","HJBG_CorporateNumber__c","lbc_corporate_number__c","FSJP_custom_forcas_corporate_number__c"];
const hits=new Map(); // tsr -> [{corp,key,sfName}]
let n=0;
Papa.parse(fs.createReadStream(path.join(__dirname,"extract.csv"),{encoding:"utf8"}),{header:true,skipEmptyLines:true,
 step:row=>{const r=row.data;n++;
  let corp="";for(const c of SF_CORP){corp=validCorp(r[c]);if(corp)break;}
  if(!corp)return;
  const names=[r["Name"],r["lbc_company_name__c"],r["CompanyNameForDuplicateIdentification__c"],r["lbc_listed_name__c"]].map(normName).filter(Boolean);
  const kana=nkana(r["Kaisyameikana__c"]||r["lbc_company_name_kana__c"]);
  const rep=nrep(r["Representative__c"]||r["lbc_representative__c"]||r["establisherName__c"]||r["managerName__c"]);
  const year=yr(r["establishmentDate__c"]||r["Sogyonengetsu__c"]);
  const postal=pc(r["CompanyPostalCode__c"]||r["lbc_company_zip__c"]||r["BillingPostalCode"]);
  const cores=names.map(nm=>nm.replace(/^(株式会社|有限会社|合同会社|合資会社|合名会社)/,""));
  const rec=(t,key)=>{if(!hits.has(t.tsr))hits.set(t.tsr,[]);const h=hits.get(t.tsr);if(!h.find(x=>x.corp===corp&&x.key===key))h.push({corp,key,sfName:r["Name"]||r["lbc_company_name__c"]||"",src:t.src});};
  const seen=new Set();
  names.forEach(nm=>{(byName.get(nm)||[]).forEach(t=>rec(t,"社名"));});
  if(kana)(byKana.get(kana)||[]).forEach(t=>rec(t,"カナ"));
  if(rep&&year)(byRepYear.get(rep+"|"+year)||[]).forEach(t=>rec(t,"代表+設立"));
  cores.forEach(cr=>{if(postal&&cr)(byPostCore.get(postal+"|"+cr)||[]).forEach(t=>rec(t,"郵便+社名核"));});
 },
 complete:()=>{
  console.log("SF走査",n,"行 / 候補ヒットしたターゲット:",hits.size);
  const out=[];
  for(const t of T){const h=hits.get(t.tsr);if(!h)continue;
   const corps=[...new Set(h.map(x=>x.corp))];
   out.push({src:t.src,tsr:t.tsr,社名:t.name,候補数:corps.length,候補:h.map(x=>x.corp+"["+x.key+"]"+String(x.sfName).slice(0,14))});
  }
  fs.writeFileSync(path.join(__dirname,"output/sf_crossmatch.json"),JSON.stringify(out,null,1));
  console.log("候補あり:",out.length,"→ output/sf_crossmatch.json");
  out.forEach(o=>console.log("  ["+o.src+"] "+(o.社名||"").slice(0,20).padEnd(20)+" 候補"+o.候補数+": "+o.候補.slice(0,4).join(" / ")));
 },error:e=>console.error("ERR",e.message)});
