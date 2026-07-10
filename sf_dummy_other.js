// 除外していた「その他(法人格プレフィクスなし)」非4444ダミーを国税庁step4へ名称+住所照合し、
// 実は法人だったものを検出(一意SS/Sのみ確定候補)。extract/step4とも streaming。
const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const {normName,bestAddrLevel,parseTsrAddresses,levelScore}=require(path.join(__dirname,"match_util"));
const dg=s=>(s||"").replace(/[^0-9]/g,"");
const isDummy=d=>d.length>0&&/^(\d)\1*$/.test(d);
const corpPref=/株式会社|有限会社|合同会社|合資会社|合名会社|㈱|㈲|一般社団|一般財団|医療法人|学校法人|社会福祉法人|宗教法人|協同組合|特定非営利|ＮＰＯ|NPO|合同会社|㈾|㈿/;
const testRe=/テスト|ﾃｽﾄ|ダミー|サンプル|確認用|検証|井村/i;
const done=new Set();
["sf932_strong","sf932_mid","sf932_multi","sf932_zero"].forEach(n=>JSON.parse(fs.readFileSync(path.join(__dirname,"output/"+n+".json"),"utf8")).forEach(x=>done.add(String(x.SF_Id))));

// pass1: extract その他 targets
const targets=[];
Papa.parse(fs.createReadStream(path.join(__dirname,"extract.csv"),{encoding:"utf8"}),{header:true,skipEmptyLines:true,
 step:row=>{const r=row.data;const h=dg(r["houjinbangou__c"]);if(!isDummy(h)||h==="4444444444444")return;
  const id=String(r["Id"]||"");if(done.has(id))return;
  const nm=(r["Name"]||"").trim();if(!nm||corpPref.test(nm)||testRe.test(nm))return; // 法人格あり/テストは除外(別途処理済/対象外)
  const ad=(r["CompanyAddress__c"]||"").trim();if(!ad)return;
  targets.push({Id:id,Name:nm,addr:ad,owner:r["OwnerAddress__c"]||"",eig:r["Eigyosho__c"]||"",dummy:h,rep:r["Representative__c"]||"",est:r["establishmentDate__c"]||r["Sogyonengetsu__c"]||"",gyo:r["Eigyosyumoku__c"]||"",phone:r["Phone"]||""});
 },
 complete:()=>{
  console.log("その他(法人格プレフィクスなし)ダミー対象:",targets.length);
  const T=targets.map(t=>({...t,key:normName(t.Name),addrs:parseTsrAddresses({CompanyAddress__c:t.addr,OwnerAddress__c:t.owner,Eigyosho__c:t.eig})}));
  const nameSet=new Set(T.map(t=>t.key).filter(Boolean));
  const byName=new Map();let idx=null,n=0;
  Papa.parse(fs.createReadStream(path.join(__dirname,"output/step4.csv"),{encoding:"utf8"}),{header:false,skipEmptyLines:true,step:row=>{
   const d=row.data;if(idx===null){const hh=d.map(x=>x.replace(/^﻿/,"").replace(/"/g,"").trim());idx={corp:hh.indexOf("corporate_number"),name:hh.indexOf("company_name"),pref:hh.indexOf("prefecture"),a1:hh.indexOf("address1"),a2:hh.indexOf("address2"),a3:hh.indexOf("address3")};return;}
   n++;const k=normName(d[idx.name]||"");if(!k||!nameSet.has(k))return;
   const loc=(d[idx.pref]||"")+(d[idx.a1]||"")+(d[idx.a2]||"")+(d[idx.a3]||"");
   if(!byName.has(k))byName.set(k,[]);const a=byName.get(k);if(a.length<50)a.push({corp:d[idx.corp],loc});
  },complete:()=>{
   let ss=0,s=0,a=0,nameOnly=0,none=0;const out=[];
   for(const t of T){const cands=byName.get(t.key)||[];if(!cands.length){none++;continue;}
    cands.forEach(c=>c.lv=bestAddrLevel(t.addrs,c.loc));
    const wa=cands.filter(c=>c.lv&&["SS","S","A"].includes(c.lv));
    if(!wa.length){nameOnly++;continue;}
    const best=Math.max(...wa.map(c=>levelScore[c.lv]));const top=wa.filter(c=>levelScore[c.lv]===best);
    if(top.length===1){const lv=top[0].lv;if(lv==="SS")ss++;else if(lv==="S")s++;else a++;out.push({SF_Id:t.Id,社名:t.Name,本社住所:t.addr,旧ダミー番号:t.dummy,修正後法人番号:top[0].corp,一致レベル:lv,登記住所:top[0].loc,代表者:t.rep});}
   }
   fs.writeFileSync(path.join(__dirname,"output/sf_other_ssa.json"),JSON.stringify(out,null,1));
   console.log("step4走査",n,"/ その他で名称一致あり:",T.length-none,"(名称のみ"+nameOnly+")");
   console.log("★実は法人だった(SS/S/A一意):",out.length,"(SS"+ss+"/S"+s+"/A"+a+") → output/sf_other_ssa.json");
   out.filter(o=>["SS","S"].includes(o.一致レベル)).slice(0,12).forEach(o=>console.log("  ["+o.一致レベル+"] "+(o.社名||"").slice(0,22).padEnd(22)+" → "+o.修正後法人番号+" ("+(o.登記住所||"").slice(0,18)+")"));
  }});
 },error:e=>console.error(e)});
