// 不明を「自分たちの成果物(新規+更新)」へ突合。TSR内の重複(同一企業の別レコード)で
// 片方が法人番号を持つケースを、電話+(社名核 or 同一市区町村)で拾う。採用は監査後。
const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const {normName}=require(path.join(__dirname,"match_util"));
const D=path.join(__dirname,"output/final_deliverables");
const nphone=s=>{const d=(s||"").replace(/[^0-9]/g,"");return d.length>=9&&d.length<=11&&!/^(\d)\1+$/.test(d)?d:"";};
const core=s=>normName(s).replace(/^(株式会社|有限会社|合同会社|合資会社|合名会社)/,"").replace(/(株式会社|有限会社)$/,"");
const nrep=s=>(s||"").normalize("NFKC").replace(/[\s　・,，.．]/g,"");
const city=a=>{const m=(a||"").normalize("NFKC").match(/^(.+?[都道府県])(.+?[市区町村])/);return m?m[2]:"";};
const vc=s=>{const d=(s||"").replace(/[^0-9]/g,"");return d.length===13&&!/^(\d)\1{12}$/.test(d)?d:"";};

const unk=Papa.parse(fs.readFileSync(path.join(D,"不明_法人番号なし.csv"),"utf8"),{header:true,skipEmptyLines:true}).data;
const U=unk.map(r=>({tsr:String(r["TSR_companyno__c"]),name:r["Name"],core:core(r["Name"]),phone:nphone(r["Phone"]),rep:nrep(r["Representative__c"]),city:city(r["CompanyAddress__c"]),addr:r["CompanyAddress__c"]||""}));
const byPhone=new Map(),byRep=new Map();
U.forEach(u=>{if(u.phone){if(!byPhone.has(u.phone))byPhone.set(u.phone,[]);byPhone.get(u.phone).push(u);}if(u.rep){if(!byRep.has(u.rep))byRep.set(u.rep,[]);byRep.get(u.rep).push(u);}});

const hits=new Map();
const scanRows=(rows,src)=>{rows.forEach(r=>{const corp=vc(r["houjinbangou__c"]);if(!corp)return;
  const ph=nphone(r["Phone"]),rp=nrep(r["Representative__c"]),cr=core(r["Name"]),cty=city(r["CompanyAddress__c"]);
  const check=(u,key)=>{const nameM=u.core&&cr&&u.core===cr;const cityM=u.city&&cty&&u.city===cty;
    if(nameM||cityM){if(!hits.has(u.tsr))hits.set(u.tsr,[]);const h=hits.get(u.tsr);if(!h.find(x=>x.corp===corp))h.push({corp,src,key:key+(nameM?"+社名核":"")+(cityM?"+同市":""),sfName:r["Name"],sfAddr:(r["CompanyAddress__c"]||"").slice(0,24)});}};
  if(ph&&byPhone.has(ph))byPhone.get(ph).forEach(u=>check(u,"電話"));
  if(rp&&byRep.has(rp))byRep.get(rp).forEach(u=>check(u,"代表"));
});};

// 新規(小)
scanRows(Papa.parse(fs.readFileSync(path.join(D,"新規.csv"),"utf8"),{header:true,skipEmptyLines:true}).data,"新規");
// 更新(大=stream)
let hdr=null,buf=[];const upP=Papa.parse(fs.createReadStream(path.join(D,"更新.csv"),{encoding:"utf8"}),{header:true,skipEmptyLines:true,
 step:row=>{const r=row.data;const corp=vc(r["houjinbangou__c"]);if(!corp)return;
  const ph=nphone(r["Phone"]),rp=nrep(r["Representative__c"]),cr=core(r["Name"]),cty=city(r["CompanyAddress__c"]);
  const check=(u,key)=>{const nameM=u.core&&cr&&u.core===cr;const cityM=u.city&&cty&&u.city===cty;if(nameM||cityM){if(!hits.has(u.tsr))hits.set(u.tsr,[]);const h=hits.get(u.tsr);if(!h.find(x=>x.corp===corp))h.push({corp,src:"更新",key:key+(nameM?"+社名核":"")+(cityM?"+同市":""),sfName:r["Name"],sfAddr:(r["CompanyAddress__c"]||"").slice(0,24)});}};
  if(ph&&byPhone.has(ph))byPhone.get(ph).forEach(u=>check(u,"電話"));
  if(rp&&byRep.has(rp))byRep.get(rp).forEach(u=>check(u,"代表"));
 },
 complete:()=>{
  const out=[];for(const u of U){const h=hits.get(u.tsr);if(!h)continue;out.push({tsr:u.tsr,社名:u.name,TSR住所:u.addr.slice(0,24),候補:h});}
  fs.writeFileSync(path.join(__dirname,"output/cross_own.json"),JSON.stringify(out,null,1));
  console.log("自成果物と電話/代表+社名核/同市 で一致した不明:",out.length);
  out.forEach(o=>{console.log("● "+(o.社名||"").slice(0,18)+" TSR:"+o.TSR住所);o.候補.forEach(c=>console.log("    → "+c.corp+" ["+c.src+"/"+c.key+"] "+String(c.sfName).slice(0,16)+"/"+c.sfAddr));});
 },error:e=>console.error(e)});
