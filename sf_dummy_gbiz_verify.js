// ①強候補(sf932_strong)の候補番号をgBizで引き、代表者/設立をTSRと照合して裏取り。
const fs=require("fs"),path=require("path");
const TOKEN=fs.readFileSync(require("os").homedir()+"/.gbiz_token","utf8").trim();
const nrep=s=>(s||"").normalize("NFKC").replace(/[\s　・,，.．]/g,"");
const yr=s=>{const m=(s||"").match(/(\d{4})/);return m?m[1]:"";};
const rows=JSON.parse(fs.readFileSync(path.join(__dirname,"output/sf932_strong.json"),"utf8"));
const fetchG=async corp=>{try{const r=await fetch("https://info.gbiz.go.jp/hojin/v1/hojin/"+corp,{headers:{"X-hojinInfo-api-token":TOKEN}});if(!r.ok)return null;const j=await r.json();return (j["hojin-infos"]||[])[0]||null;}catch(e){return null;}};
(async()=>{
 const out=[];let i=0,done=0;
 const CONC=6;
 const worker=async()=>{while(i<rows.length){const idx=i++;const t=rows[idx];const info=await fetchG(t.候補番号);done++;
   const gRep=nrep(info&&info.representative_name);const gEst=yr(info&&(info.date_of_establishment||info.founding_date));const gName=(info&&info.name)||"";
   const tRep=nrep(t.rep),tEst=yr(t.est);
   const repM=tRep&&gRep&&tRep===gRep;const estM=tEst&&gEst&&tEst===gEst;
   out[idx]={...t,gBiz社名:gName,gBiz代表:info&&info.representative_name||"",gBiz設立:gEst,代表一致:repM,設立一致:estM,判定:repM?"代表一致":estM?"設立一致":(info?"gBiz代表なし/不一致":"gBiz無")};
   if(done%50===0)console.error(done+"/"+rows.length);
 }};
 await Promise.all(Array.from({length:CONC},worker));
 fs.writeFileSync(path.join(__dirname,"output/sf932_strong_verified.json"),JSON.stringify(out,null,1));
 const repM=out.filter(o=>o.代表一致).length,estOnly=out.filter(o=>!o.代表一致&&o.設立一致).length,noRep=out.filter(o=>!o.代表一致&&!o.設立一致&&/gBiz代表なし/.test(o.判定)).length,noG=out.filter(o=>o.判定==="gBiz無").length;
 console.log("①328 gBiz照合: 代表一致",repM,"/ 設立のみ一致",estOnly,"/ gBiz代表なしor不一致",noRep,"/ gBiz掲載なし",noG);
})().catch(e=>console.error(e));
