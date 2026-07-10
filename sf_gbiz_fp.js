// gBiz基本情報バルクで「代表者名+都道府県(+設立/資本金/業種)」フィンガープリント照合。
// 対象=未確定のcorp-eligibleダミー(sf932_*でダミー番号修正リストに未掲載)。候補提示のみ(後で監査)。
const fs=require("fs"),path=require("path"),Papa=require(path.join(__dirname,"node_modules/papaparse"));
const GB=process.env.HOME+"/Downloads/Kihonjoho_UTF-8.csv";
const nrep=s=>(s||"").normalize("NFKC").replace(/(代表取締役社長|代表取締役|代表理事|理事長|代表社員|取締役社長|代表者|社長|会長|CEO|院長|園長|校長|理事|所長)/g,"").replace(/[\s　・,，.．\-－]/g,"");
const prefOf=a=>{const m=(a||"").normalize("NFKC").match(/^.*?[都道府県]/);return m?m[0]:"";};
const yr=s=>{const m=(s||"").match(/(\d{4})/);return m?m[1]:"";};
const capN=s=>{const d=(s||"").replace(/[^0-9]/g,"");return d?parseInt(d,10):0;};
// 確定済SF_Id
const done=new Set(Papa.parse(fs.readFileSync(path.join(__dirname,"output/final_deliverables/ダミー番号修正リスト.csv"),"utf8"),{header:true,skipEmptyLines:true}).data.map(r=>String(r.SF_Id)));
// 残(corp-eligible未確定)
const T=[];
["sf932_strong","sf932_mid","sf932_multi","sf932_zero"].forEach(n=>JSON.parse(fs.readFileSync(path.join(__dirname,"output/"+n+".json"),"utf8")).forEach(x=>{const id=String(x.SF_Id);if(done.has(id))return;const rep=nrep(x.rep);const pref=prefOf(x.本社);if(!rep||!pref)return;T.push({id,Name:x.社名,addr:x.本社,rep,pref,est:yr(x.est),cap:capN(x.cap),gyo:x.gyo||"",dummy:x.dummy});}));
const keySet=new Set(T.map(t=>t.rep+"|"+t.pref));
console.log("残(代表者+県あり)対象:",T.length,"/ キー",keySet.size);
// gBizをstream、対象キーに一致する行だけ収集
const gb=new Map();let n=0,idx={corp:0,name:1,pref:8,city:10,ban:12,rep:17,cap:18,gyo:25,est:26,url:23};
let header=true;
Papa.parse(fs.createReadStream(GB,{encoding:"utf8"}),{header:false,skipEmptyLines:true,step:row=>{
 const d=row.data;if(header){header=false;return;}
 n++;const rp=nrep(d[idx.rep]);if(!rp)return;const pf=d[idx.pref]||"";const k=rp+"|"+pf;if(!keySet.has(k))return;
 if(!gb.has(k))gb.set(k,[]);const a=gb.get(k);if(a.length<40)a.push({corp:d[idx.corp],name:d[idx.name],city:d[idx.city]||"",ban:d[idx.ban]||"",cap:capN(d[idx.cap]),est:yr(d[idx.est]),gyo:d[idx.gyo]||"",url:d[idx.url]||"",addr:(d[idx.pref]||"")+(d[idx.city]||"")+(d[idx.ban]||"")});
},complete:()=>{
 const out=[];let uniq=0,multi=0,none=0;
 for(const t of T){const c=gb.get(t.rep+"|"+t.pref)||[];if(!c.length){none++;continue;}
  // 設立年 or 資本金 一致で絞る
  let f=c;
  if(t.est){const e=c.filter(x=>x.est&&x.est===t.est);if(e.length)f=e;}
  if(f.length>1&&t.cap){const cc=f.filter(x=>x.cap&&x.cap===t.cap);if(cc.length)f=cc;}
  if(f.length===1){uniq++;out.push({SF_Id:t.id,社名:t.Name,本社住所:t.addr,dummy:t.dummy,代表者:t.rep,設立:t.est,gBiz法人番号:f[0].corp,gBiz社名:f[0].name,gBiz住所:f[0].addr,gBiz設立:f[0].est,gBiz業種:(f[0].gyo||"").slice(0,20)});}
  else multi++;
 }
 fs.writeFileSync(path.join(__dirname,"output/sf_gbiz_fp.json"),JSON.stringify(out,null,1));
 console.log("gBiz走査",n,"/ 代表者+県+設立/資本で一意:",uniq,"(複数",multi,"/ 該当なし",none,") → sf_gbiz_fp.json");
 out.slice(0,15).forEach(o=>console.log("  "+(o.社名||"").slice(0,16).padEnd(16)+" 代表"+o.代表者.slice(0,8)+" → "+o.gBiz法人番号+" ["+(o.gBiz社名||"").slice(0,16)+"] "+(o.gBiz住所||"").slice(0,18)));
},error:e=>console.error(e)});
