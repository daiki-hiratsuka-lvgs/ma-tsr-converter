const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const clean=v=>(v==null?"":String(v)).replace(/\r\n|\r|\n/g," ").replace(/ {2,}/g," ").trim();
const fix={"8110020213584":"8110002013584","7012401041442":"7012401031442"};
const F=path.join(__dirname,"output/final_deliverables/更新.csv");const TMP=F+".tmp";
const ws=fs.createWriteStream(TMP,{encoding:"utf8"});
let fields=null,ci=-1,n=0;
Papa.parse(fs.createReadStream(F,{encoding:"utf8"}),{header:false,skipEmptyLines:true,
 step:row=>{const d=row.data.map(clean);if(fields===null){fields=d;ci=fields.indexOf("houjinbangou__c");ws.write(Papa.unparse([d],{header:false,quotes:true})+"\n");return;}
  const c=(d[ci]||"").replace(/[^0-9]/g,"");if(fix[c]){d[ci]=fix[c];n++;}ws.write(Papa.unparse([d],{header:false,quotes:true})+"\n");},
 complete:()=>ws.end(()=>{fs.renameSync(TMP,F);console.log("更新.csv チェックディジット訂正:",n,"行");}),error:e=>console.error(e)});
