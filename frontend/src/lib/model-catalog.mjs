export const resultStateLabels={untested:'À tester',not_applicable:'Non applicable',observed:'Mesuré',skipped:'Non testé',contaminated:'Non isolé',unconfirmed:'Non confirmé',api_error:'Erreur API',pending:'En cours'};
export const tiers={economy:'Économique',balanced:'Équilibré',advanced:'Avancé',unknown:'Non classé'};
export const capabilities={text:'Texte / code',image:'Image',video:'Vidéo',audio:'Audio',embedding:'Embeddings',unknown:'Non renseigné'};
// Editorial families, not benchmark scores. Unrecognised families remain unclassified.
export function modelTier(model){
 if(model.kind!=='text')return 'unknown';
 const id=model.id.toLowerCase();
 if(/haiku|(?:^|[-.])(mini|nano|flash|luna)(?:[-.]|$)/.test(id))return 'economy';
 if(/sonnet|mistral-medium|gpt-4\.1|terra/.test(id))return 'balanced';
 if(/opus|^gpt-5(?:[.-]|$)/.test(id))return 'advanced';
 return 'unknown';
}
export function filterModels(models,{search='',tier='',capability=''}={}){
 return models.filter(m=>m.id.toLowerCase().includes(search.trim().toLowerCase()) && (!tier || modelTier(m)===tier) && (!capability || (m.kind || 'unknown')===capability));
}
export function sortMatrixRows(rows,key,direction='asc'){
 const effortOrder={default:0,low:1,medium:2,high:3};
 const value=r=>({source:r.cell.provenance || null,model:r.model.id,tier:tiers[modelTier(r.model)],kind:capabilities[r.model.kind] || capabilities.unknown,effort:effortOrder[r.cell.effort],status:resultStateLabels[r.cell.status] || r.cell.status,limit:r.cell.maxTokens,input:r.cell.usage?.prompt_tokens,output:r.cell.usage?.completion_tokens,estimate:r.cell.predictedCost,cost:r.cell.status==='observed'?r.cell.measuredCost:null,date:r.cell.testedAt?Date.parse(r.cell.testedAt):null})[key];
 return [...rows].sort((a,b)=>{
  const av=value(a),bv=value(b),missing=v=>v==null || typeof v==='number' && !Number.isFinite(v);
  if(missing(av)||missing(bv))return missing(av)===missing(bv)?0:missing(av)?1:-1;
  const c=typeof av==='number' ? av-bv:String(av).localeCompare(String(bv),'fr',{numeric:true});
  return (direction==='asc'?c:-c) || a.model.id.localeCompare(b.model.id) || (effortOrder[a.cell.effort]-effortOrder[b.cell.effort]);
 });
}
