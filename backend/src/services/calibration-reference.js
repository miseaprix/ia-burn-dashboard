import {readFileSync} from 'node:fs';
const numeric=n=>typeof n==='number' && Number.isFinite(n) && n>=0?n:null;
export function buildCalibrationReference(matrix,{generatedAt=new Date().toISOString()}={}){
 return {schemaVersion:1,generatedAt,protocol:'synthetic-arithmetic-v1',currency:'USD',rateUnit:'USD per token',catalogUpdatedAt:matrix.updatedAt || null,scenario:{prompt:'Calcule 103 × 107. Vérifie ton calcul en deux étapes courtes.',measurement:'Cost of one completed synthetic request; effort application and quality not verified'},description:'Direct enterprise gateway calls; isolated request/token/cost concordance. Not a fixed effort tariff or quality benchmark.',
 models:matrix.models.map(m=>({
  id:m.id,kind:m.kind,limitParameter:m.limitParameter,effort:m.effort,
  rates:Object.fromEntries(['input','output','cacheRead','cacheWrite','cacheWrite1h'].map(k=>[k,numeric(m.rates?.[k])])),
  source:'Enterprise catalogue (declared reference)',
  cells:m.cells.filter(c=>c.provenance!=='reference' && c.status==='observed' && numeric(c.measuredCost)!=null && numeric(c.usage?.prompt_tokens)!=null && numeric(c.usage?.completion_tokens)!=null).map(c=>({
   effort:c.effort,status:'observed',testedAt:c.testedAt?.slice(0,10) || generatedAt.slice(0,10),maxTokens:c.maxTokens,
   usage:Object.fromEntries(['prompt_tokens','completion_tokens','total_tokens','cacheRead','reasoning'].map(k=>[k,numeric(c.usage?.[k])])),
   measuredCost:numeric(c.measuredCost),predictedCost:numeric(c.predictedCost),
   ...(c.responseCacheSuspected?{responseCacheSuspected:true}:{})
  }))
 }))};
}
export const calibrationReference=JSON.parse(readFileSync(new URL('../../data/model-calibration-reference.json',import.meta.url),'utf8'));
