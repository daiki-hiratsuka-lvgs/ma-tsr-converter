const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const ssa=JSON.parse(fs.readFileSync(path.join(__dirname,"output/dummy89_ssa.json"),"utf8"));
const fix=new Map();ssa.filter(o=>o.corp&&["SS","S","A"].includes(o.level)).forEach(o=>fix.set(String(o.tsr),o.corp));
console.log("置換対象(SS/S/A):",fix.size,"件");
const F=path.join(__dirname,"output/final_deliverables/更新.csv");
const TMP=F+".tmp";
const ws=fs.createWriteStream(TMP,{encoding:"utf8"});
let fields=null,n=0,corpI=-1,tsrI=-1;
Papa.parse(fs.createReadStream(F,{encoding:"utf8"}),{header:false,skipEmptyLines:false,
 step:(row)=>{const d=row.data;
  if(fields===null){fields=d.map(x=>x.replace(/^﻿/,""));corpI=fields.indexOf("houjinbangou__c");tsrI=fields.indexOf("TSR_companyno__c");ws.write(Papa.unparse([d],{header:false,quotes:true})+"\n");return;}
  if(d.length<=1&&(d[0]===""||d[0]==null))return; // skip blank
  const c=fix.get(String(d[tsrI]));if(c){d[corpI]=c;n++;}
  ws.write(Papa.unparse([d],{header:false,quotes:true})+"\n");
 },
 complete:()=>{ws.end(()=>{fs.renameSync(TMP,F);console.log("更新.csv 置換完了:",n,"行");});},
 error:e=>console.error(e)});
