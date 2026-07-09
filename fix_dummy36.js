const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const fix=JSON.parse(fs.readFileSync(path.join(__dirname,"output/dummy36_fix.json"),"utf8"));
const F=path.join(__dirname,"output/final_deliverables/更新.csv");const TMP=F+".tmp";
const ws=fs.createWriteStream(TMP,{encoding:"utf8"});
let fields=null,n=0,corpI=-1,tsrI=-1;
Papa.parse(fs.createReadStream(F,{encoding:"utf8"}),{header:false,skipEmptyLines:false,
 step:(row)=>{const d=row.data;
  if(fields===null){fields=d.map(x=>x.replace(/^﻿/,""));corpI=fields.indexOf("houjinbangou__c");tsrI=fields.indexOf("TSR_companyno__c");ws.write(Papa.unparse([d],{header:false,quotes:true})+"\n");return;}
  if(d.length<=1&&(d[0]===""||d[0]==null))return;
  const c=fix[String(d[tsrI])];if(c){d[corpI]=c;n++;}
  ws.write(Papa.unparse([d],{header:false,quotes:true})+"\n");},
 complete:()=>{ws.end(()=>{fs.renameSync(TMP,F);console.log("更新.csv ダミー→実番号 置換:",n,"行");});},
 error:e=>console.error(e)});
