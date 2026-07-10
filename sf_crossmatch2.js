// v2: 強キー(社名完全一致/代表+設立/郵便+社名核)のみ。SF住所を取得しTSR住所と市区町村・番地で照合。
const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const {normName,normAddr,parseTsrAddresses,bestAddrLevel}=require(path.join(__dirname,"match_util"));
const D=path.join(__dirname,"output/final_deliverables");
const nrep=s=>(s||"").normalize("NFKC").replace(/[\s　・,，.．]/g,"");
const core=s=>normName(s).replace(/^(株式会社|有限会社|合同会社|合資会社|合名会社)/,"");
const yr=s=>{const m=(s||"").match(/(\d{4})/);return m?m[1]:"";};
const pc=s=>(s||"").replace(/[^0-9]/g,"").slice(0,7);
const validCorp=s=>{const d=(s||"").replace(/[^0-9]/g,"");return d.length===13&&!/^(\d)\1{12}$/.test(d)?d:"";};
const cityOf=a=>{const m=(a||"").normalize("NFKC").match(/^(.+?[都道府県])(.+?[市区町村])/);return m?m[2]:"";};

const targets=[];
Papa.parse(fs.readFileSync(path.join(D,"不明_法人番号なし.csv"),"utf8"),{header:true,skipEmptyLines:true}).data.forEach(r=>targets.push({src:"不明",r}));
JSON.parse(fs.readFileSync(path.join(__dirname,"output/update_dummy13.json"),"utf8")).forEach(function(d){
  targets.push({src:"ダミー",r:{TSR_companyno__c:d.tsr,Name:d.社名,Representative__c:d.代表者,establishmentDate__c:d.設立,CompanyAddress__c:d.本社住所,OwnerAddress__c:d.オーナー住所,Eigyosho__c:d.営業所,CompanyPostalCode__c:""}});
});
const T=targets.map(({src,r})=>({src,tsr:String(r["TSR_companyno__c"]),name:r["Name"],key:normName(r["Name"]),rep:nrep(r["Representative__c"]),year:yr(r["establishmentDate__c"]||r["Sogyonengetsu__c"]),core:core(r["Name"]),postal:pc(r["CompanyPostalCode__c"]),addrs:parseTsrAddresses(r),cities:new Set(parseTsrAddresses(r).map(cityOf).filter(Boolean))}));
const byName=new Map(),byRepYear=new Map(),byPostCore=new Map();
const add=(m,k,t)=>{if(!k)return;if(!m.has(k))m.set(k,[]);m.get(k).push(t);};
T.forEach(t=>{add(byName,t.key,t);if(t.rep&&t.year)add(byRepYear,t.rep+"|"+t.year,t);if(t.postal&&t.core)add(byPostCore,t.postal+"|"+t.core,t);});

const SF_CORP=["houjinbangou__c","HJBG_CorporateNumber__c","lbc_corporate_number__c","FSJP_custom_forcas_corporate_number__c"];
const hits=new Map();let n=0;
Papa.parse(fs.createReadStream(path.join(__dirname,"extract.csv"),{encoding:"utf8"}),{header:true,skipEmptyLines:true,
 step:row=>{const r=row.data;n++;let corp="";for(const c of SF_CORP){corp=validCorp(r[c]);if(corp)break;}if(!corp)return;
  const names=[r["Name"],r["lbc_company_name__c"],r["CompanyNameForDuplicateIdentification__c"],r["lbc_listed_name__c"]].map(normName).filter(Boolean);
  const rep=nrep(r["Representative__c"]||r["lbc_representative__c"]||r["establisherName__c"]||r["managerName__c"]);
  const year=yr(r["establishmentDate__c"]||r["Sogyonengetsu__c"]);
  const postal=pc(r["CompanyPostalCode__c"]||r["lbc_company_zip__c"]||r["BillingPostalCode"]);
  const sfAddr=[r["CompanyAddress__c"],r["HJBG_Address__c"],r["lbc_office_name__c"]].filter(Boolean).join(" ");
  const sfName=r["Name"]||r["lbc_company_name__c"]||"";
  const cores=names.map(nm=>nm.replace(/^(株式会社|有限会社|合同会社|合資会社|合名会社)/,""));
  const rec=(t,key)=>{if(!hits.has(t.tsr))hits.set(t.tsr,new Map());const m=hits.get(t.tsr);if(!m.has(corp))m.set(corp,{corp,keys:new Set(),sfName,sfAddr,rep:r["Representative__c"]||""});m.get(corp).keys.add(key);};
  names.forEach(nm=>{(byName.get(nm)||[]).forEach(t=>rec(t,"社名"));});
  if(rep&&year){(byRepYear.get(rep+"|"+year)||[]).forEach(t=>rec(t,"代表+設立"));}
  cores.forEach(cr=>{if(postal&&cr)(byPostCore.get(postal+"|"+cr)||[]).forEach(t=>rec(t,"郵便+社名核"));});
 },
 complete:()=>{
  console.log("SF走査",n,"/ ヒット",hits.size);
  const out=[];
  for(const t of T){const m=hits.get(t.tsr);if(!m)continue;
   const cands=[...m.values()].map(c=>{const lv=bestAddrLevel(t.addrs,c.sfAddr);const cm=t.cities.has(cityOf(c.sfAddr));return {...c,keys:[...c.keys],addrLevel:lv||"",cityMatch:cm};});
   // 強い候補: 住所番地一致 or 市区町村一致 で 社名/代表+設立/郵便キー
   const strong=cands.filter(c=>c.addrLevel||c.cityMatch);
   out.push({src:t.src,tsr:t.tsr,社名:t.name,TSR住所:t.addrs[0]||"",全候補数:cands.length,強候補:strong.map(c=>({corp:c.corp,keys:c.keys,SF社名:c.sfName,SF住所:(c.sfAddr||"").slice(0,30),番地:c.addrLevel,市一致:c.cityMatch}))});
  }
  const withStrong=out.filter(o=>o.強候補.length);
  fs.writeFileSync(path.join(__dirname,"output/sf_crossmatch2.json"),JSON.stringify(out,null,1));
  console.log("=== 住所一致する強候補ありのターゲット:",withStrong.length,"===");
  withStrong.forEach(o=>{console.log("["+o.src+"] "+(o.社名||"").slice(0,18)+" | TSR:"+o.TSR住所.slice(0,20));o.強候補.forEach(c=>console.log("    → "+c.corp+" ["+c.keys.join(",")+"] "+(c.番地?"番地"+c.番地:"")+(c.市一致?"市一致":"")+" SF:"+c.SF社名.slice(0,14)+"/"+c.SF住所));});
 },error:e=>console.error("ERR",e.message)});
