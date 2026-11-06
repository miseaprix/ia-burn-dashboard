// Entirely synthetic, deterministic examples. No logs, credentials, filesystem or network.
import {quotaWindow} from '../../../backend/src/domain/quota.js';
import {computeBudgetBurndown, cumulativeFromDaily, monthBounds, localIsoDate} from '../../../backend/src/domain/burndown.js';
const DAY=86400000;
const day=d=>localIsoDate(new Date(d));
const modelNames=['Example Sonnet','Example GPT','Example Gemini'];
// Enterprise demo (fictional Acme AI gateway) uses the calibration sample models.
const enterpriseModels=['example-large','example-medium'];
export function integrations(level=3) {
  const observed={claude:level>=2,codex:level>=2,opencode:level>=2};
  return {corporate:{configured:true},personal:{observed,configured:observed},corporateLocal:{observed},
    monitoring:{configured:level>=3,events:level>=3 ? 120 : 0,requests:level>=3 ? 40 : 0}};
}
function quota(now,weekly,used) {
  const duration=(weekly ? 7*24 : 5)*3600000;
  const elapsed=duration*(weekly ? .5 : .4),reset=now.getTime()-elapsed+duration;
  const raw={usedPercent:used,windowMinutes:duration/60000,resetsAt:new Date(reset).toISOString()};
  const samples=[0,.2,.5,.8].map((f,i)=>({t:new Date(now.getTime()-elapsed+f*elapsed).toISOString(),remaining:100-used*[0,.25,.5,.75][i],windowMinutes:raw.windowMinutes,resetsAt:raw.resetsAt}));
  return {...quotaWindow(raw,now.toISOString(),now.getTime(),samples),dollarsPerPercent:1};
}
function requested(query,now) {
  const today=day(now),start=day(new Date(now.getFullYear(),now.getMonth(),1,12));
  const range=query.get('range') || 'all';
  const offsets={today:0,yesterday:1,week:6,month:29,wtd:(now.getDay()+6)%7,rtd:6};
  if(range==='custom')return {from:query.get('from') || today,to:query.get('to') || today};
  if(range==='mtd')return {from:start,to:today};
  if(range==='ytd')return {from:`${now.getFullYear()}-01-01`,to:today};
  if(range in offsets)return {from:day(now.getTime()-offsets[range]*DAY),to:range==='yesterday' ? day(now.getTime()-DAY) : today};
  return {from:day(now.getTime()-29*DAY),to:today};
}
function totals(daily,models=3) {
  return {spend:daily.reduce((n,d)=>n+d.spend,0),tokens:daily.reduce((n,d)=>n+d.tokens,0),requests:daily.reduce((n,d)=>n+d.requests,0),days:daily.length,models,costComplete:true};
}
export function dashboard(query=new URLSearchParams(),{now=new Date(),budget=300,level=3}={}) {
  const source=query.get('source') || 'local',corporate=source==='enterprise';
  const today=day(now),{monthStart,monthEnd}=monthBounds(now),period=requested(query,now);
  const all=Array.from({length:30},(_,i)=>{
    const date=day(now.getTime()-(29-i)*DAY),spend=corporate ? [0,10,20][new Date(date).getUTCDate()%3] : [0,5,10][i%3];
    return {date,spend,tokens:spend*100000,requests:spend*10,costComplete:true,
      byGroup:corporate ? null : {codex:spend,claude:spend,opencode:source==='enterprise-local' ? spend : 0},
      byModel:corporate ? {[enterpriseModels[0]]:spend/2,[enterpriseModels[1]]:spend/2} : {[modelNames[0]]:spend,[modelNames[1]]:0}};
  });
  const daily=all.filter(d=>d.date>=period.from && d.date<=period.to);
  const harnessKeys=corporate ? [] : source==='enterprise-local' ? ['codex','claude','opencode'] : ['codex','claude'];
  // Per-harness costs sum exactly to the overview, in simple $5 increments.
  if(!corporate)for(const rows of [all])for(const d of rows){
    d.byGroup=Object.fromEntries(harnessKeys.map((h,i)=>[h,i===(new Date(d.date).getUTCDate()%harnessKeys.length) ? d.spend : 0]));
  }
  const makeModels=(rows,names=modelNames)=>names.slice(0,2).map(model=>({model,spend:rows.reduce((n,d)=>n+(d.byModel?.[model] || 0),0),tokens:rows.reduce((n,d)=>n+(d.byModel?.[model] || 0)*100000,0),costComplete:true}));
  const harnesses=Object.fromEntries(harnessKeys.map(h=>{
    const rows=daily.map(d=>({...d,spend:d.byGroup?.[h] || 0,tokens:(d.byGroup?.[h] || 0)*100000,requests:(d.byGroup?.[h] || 0)*10,byGroup:{[h]:d.byGroup?.[h] || 0}}));
    const historical=all.map(d=>({...d,spend:d.byGroup[h],tokens:d.byGroup[h]*100000,requests:d.byGroup[h]*10,byGroup:{[h]:d.byGroup[h]}}));
    const t=totals(rows,2),weekly=quota(now,true,h==='codex' ? 40 : 60);
    return [h,{totals:t,daily:rows,models:makeModels(rows.map(d=>({...d,byModel:{[modelNames[0]]:d.spend,[modelNames[1]]:0}}))),groups:[{key:h,spend:t.spend,tokens:t.tokens}],
      ...(source==='local' ? {subscription:{plan:h==='codex' ? 'Plus' : 'Pro',pricePerMonth:20},burndown:{observedAt:now.toISOString(),historyPersisted:true,source:'Synthetic demo',weekly,session:quota(now,false,20),resetCreditsAvailable:2,scoped:[]}} : {}),
      tokenBreakdown:{input:t.tokens*.2,output:t.tokens*.1,cacheWrite:0,cacheRead:t.tokens*.7},
      economics:{apiEquivalent30d:totals(historical).spend,valueMultiple:totals(historical).spend/20,fullQuotaValue:100,monthlyValue:200},
      usageDetails:{daily30d:historical,period30d:{from:all[0].date,to:today},spendMix:[{key:'input',tokens:t.tokens*.2,cost:t.spend*.2,costPercent:20},{key:'output',tokens:t.tokens*.1,cost:t.spend*.2,costPercent:20},{key:'cacheRead',tokens:t.tokens*.7,cost:t.spend*.6,costPercent:60}],imageGenerations:{count:0,estimatedCost:0,pricePerImageEstimate:0}},
      surfaceBreakdown:{totalPercent:70,days:all.slice(-7).map(d=>({date:d.date,usedPercent:10,surfaces:[{label:'CLI',usedPercent:10}],models:[{model:'Example GPT',usedPercent:10}]}))}}];
  }));
  const t=totals(daily,2);
  const groups=corporate ? [{key:'acme-ai-gateway',label:'Acme AI gateway',spend:t.spend,tokens:t.tokens,color:'#ff9f43'}] : harnessKeys.map((h,i)=>({key:h,spend:daily.reduce((n,d)=>n+d.byGroup[h],0),tokens:daily.reduce((n,d)=>n+d.byGroup[h]*100000,0),color:['#35cf60','#ff9f43','#0a84ff'][i]}));
  const monthly=all.filter(d=>d.date>=day(monthStart)),spent=totals(monthly).spend;
  return {source,requested:period,daily,totals:t,models:makeModels(daily,corporate ? enterpriseModels : modelNames),groups,harnesses:level>=2 ? harnesses : {},
    subscriptions:source==='local' && level>=2 ? harnessKeys.map(h=>({harness:h,plan:h==='codex' ? 'Plus' : 'Pro',pricePerMonth:20})) : [],
    capabilities:{tokens:true,groups:corporate ? 'provider' : 'harness',budget:corporate},granularityDefault:'daily',warnings:[],footnote:'Démonstration — données fictives, aucune consommation réelle.',
    refresh:{today,includesToday:period.from<=today && period.to>=today,relative:false,intervalMs:60000},collection:{usage:{lastSuccess:now.toISOString()}},
    ...(corporate ? {budget:{monthStart:day(monthStart),limit:budget,spent,remaining:budget-spent,resetsAt:monthEnd.toISOString()},budgetBurndown:computeBudgetBurndown({spent,limit:budget,now,monthStart,monthEnd,dailyCumulative:cumulativeFromDaily(monthly,monthStart,now)})} : {})};
}
export function monitoring(level=3) {
  const sessions=level>=3 ? ['codex','claude','opencode'].map((h,i)=>({id:`demo-${i}`,source:'synthetic',project:['demo-shop','demo-api','demo-docs'][i],ticket:`DEMO-${10+i}`,harness:h,eventCount:40})) : [];
  return {configured:level>=3,summary:{sessions:sessions.length,events:sessions.length*40},sessions};
}
export function requests(level=3) {
  return {summary:{requests:level>=3 ? 40 : 0,unknownHarness:0},requests:level>=3 ? modelNames.map((model,i)=>({machine_id:'demo',request_id:`demo-request-${i}`,model,harness:['claude','codex','opencode'][i],status:200,response_headers_ms:200})) : []};
}
