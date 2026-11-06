export const categories=[['cacheRead','Lecture cache','#13cad4'],['cacheWrite','Écriture cache','#bf5af2'],['input','Entrée non cachée','#0a84ff'],['output','Sortie','#ff9f43']];
export const presets={
 heavyLow:{label:'Contexte lourd · low',turns:100,cacheRead:150000,cacheWrite:8000,input:3000,output:1500,effort:'low'},
 heavyHigh:{label:'Contexte lourd · high',turns:100,cacheRead:150000,cacheWrite:8000,input:3000,output:15000,effort:'high'},
 cleanLow:{label:'Contexte ciblé · low',turns:100,cacheRead:40000,cacheWrite:3000,input:1000,output:1500,effort:'low'},
 cleanHigh:{label:'Contexte ciblé · high',turns:100,cacheRead:40000,cacheWrite:3000,input:1000,output:15000,effort:'high'},
 expired:{label:'Cache expiré',turns:100,cacheRead:0,cacheWrite:158000,input:3000,output:1500,effort:'low'},
 marathon:{label:'Session de 300 tours',turns:300,cacheRead:150000,cacheWrite:8000,input:3000,output:1500,effort:'low'}
};
export function contextCost(s,rates){
 if(!Number.isInteger(s.turns) || s.turns<1 || s.turns>1000)throw new Error('Invalid turns');
 const parts=categories.map(([key,label,color])=>{
  const amount=s[key];if(!Number.isFinite(amount) || amount<0)throw new Error('Invalid token count');
  const tokens=amount*s.turns,rate=rates[key];
  const cost=tokens===0 ? 0 : typeof rate==='number' && Number.isFinite(rate) && rate>=0 ? tokens*rate/1e6:null;
  return {key,label,color,tokens,cost};
 });
 const knownCost=parts.reduce((n,p)=>n+(p.cost || 0),0),complete=parts.every(p=>p.cost!=null);
 return {parts,tokens:parts.reduce((n,p)=>n+p.tokens,0),complete,cost:complete ? knownCost:null,knownCost,perTurn:complete ? knownCost/s.turns:null};
}

// The catalogue stores USD per token; the simulator displays USD per million.
export function modelRates(model){
 return Object.fromEntries(['input','output','cacheRead','cacheWrite','cacheWrite1h'].map(key=>{
  const rate=model?.rates?.[key];
  return [key,typeof rate==='number' && Number.isFinite(rate) && rate>=0 ? rate*1e6:null];
 }));
}

export function costBudgetStatus(cost,budget){
 if(budget==null)return {state:'unknown',percent:null,fill:0};
 if(!Number.isFinite(budget) || budget<=0)throw new Error('Invalid budget');
 if(cost==null || !Number.isFinite(cost) || cost<0)return {state:'unknown',percent:null,fill:0};
 const ratio=cost/budget;
 return {state:ratio>1?'over':ratio>=.8?'near':'within',percent:Math.round(ratio*100),fill:Math.min(100,ratio*100)};
}

export function dailyBudget(monthlyBudget,workdays=20){
 if(typeof monthlyBudget!=='number' || !Number.isFinite(monthlyBudget) || monthlyBudget<=0)return null;
 if(!Number.isInteger(workdays) || workdays<1 || workdays>31)throw new Error('Invalid workdays');
 return monthlyBudget/workdays;
}

export function matchingPreset(value){
 return Object.keys(presets).find(key=>['turns','cacheRead','cacheWrite','input','output','effort'].every(field=>value[field]===presets[key][field]))??null;
}

// Stable cached prefix, initially warm. Quarter-minute ticks match the wcod band.
// Common initial write and useful reply tokens are excluded from both strategies.
export function cacheMaintenance({tokens,minutes,ttlMinutes=5,cap=12,promptTokens=10,outputTokens=2},rates){
 for(const n of [tokens,minutes,promptTokens,outputTokens])if(!Number.isFinite(n)||n<0)throw new Error('Invalid maintenance input');
 if(minutes>1440 || ![5,60].includes(ttlMinutes) || ![0,3,6,12,Infinity].includes(cap))throw new Error('Invalid maintenance settings');
 const interval=(Math.floor(ttlMinutes*.7/.25)+1)*.25;
 const times=[];
 for(let t=interval;t<minutes && times.length<cap;t+=interval)times.push(t);
 const price=(count,rate)=>count===0?0:typeof rate==='number'&&Number.isFinite(rate)&&rate>=0?count*rate/1e6:null;
 const sum=(...v)=>v.some(n=>n===null)?null:v.reduce((a,b)=>a+b,0);
 const writeRate=ttlMinutes===60?rates.cacheWrite1h:rates.cacheWrite;
 const read=price(tokens,rates.cacheRead),write=price(tokens,writeRate);
 const perRefresh=sum(read,price(promptTokens,rates.input),price(outputTokens,rates.output));
 const warm=minutes<(times.at(-1)??0)+ttlMinutes;
 const idleWarm=minutes<ttlMinutes;
 const maintenance=times.length===0?0:perRefresh===null?null:times.length*perRefresh;
 const resume=warm?read:write,without=idleWarm?read:write,total=sum(maintenance,resume);
 return {interval,times,warm,idleWarm,perRefresh,maintenance,resume,total,without,
  difference:total===null||without===null?null:without-total,
  readTokens:times.length*tokens,promptTokens:times.length*promptTokens,outputTokens:times.length*outputTokens,
  points:[{minute:0,cost:0},...times.map((minute,i)=>({minute,cost:perRefresh===null?null:(i+1)*perRefresh})),{minute:minutes,cost:total}],
 };
}

// Each useful resumption starts a fresh pause with the same warm prefix and cap.
export function cacheMaintenanceCycles({cycles=1,...settings},rates){
 if(!Number.isInteger(cycles)||cycles<1||cycles>100)throw new Error('Invalid cycle count');
 const perCycle=cacheMaintenance(settings,rates);
 const scale=n=>n===null?null:n*cycles;
 const points=[{minute:0,cost:0}],withoutPoints=[{minute:0,cost:0}];
 for(let i=0;i<cycles;i++){
  for(const p of perCycle.points.slice(1))points.push({...p,minute:i*settings.minutes+p.minute,cost:p.cost===null||perCycle.total===null?null:i*perCycle.total+p.cost,kind:p.minute===settings.minutes?'resume':'refresh'});
  withoutPoints.push({minute:(i+1)*settings.minutes,cost:perCycle.without===null?null:(i+1)*perCycle.without});
 }
 return {...perCycle,cycles,perCycle,totalMinutes:settings.minutes*cycles,refreshCount:perCycle.times.length*cycles,
  ...Object.fromEntries(['maintenance','resume','total','without','difference','readTokens','promptTokens','outputTokens'].map(key=>[key,scale(perCycle[key])])),
  points,withoutPoints};
}
