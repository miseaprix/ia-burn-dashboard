// This is the explicitly published synthetic benchmark, not any account history.
import snapshot from '../../../backend/data/model-calibration-reference.json' with {type:'json'};
const date=snapshot.generatedAt.slice(0,10);
export const demoReferenceCatalog={
 reference:true,updatedAt:snapshot.generatedAt,defaultModel:'example-large',
 models:snapshot.models.map(({cells,...m})=>({...m,source:'Référence catalogue du '+date+' · tarifs déclarés au catalogue, non garantis aujourd’hui'}))
};
export const demoReferenceMatrix={
 busy:false,updatedAt:snapshot.generatedAt,
 reference:{generatedAt:snapshot.generatedAt,measurements:snapshot.models.reduce((n,m)=>n+m.cells.length,0)},
 efforts:['default','low','medium','high'],
 models:snapshot.models.map(m=>({...m,cells:['default','low','medium','high'].map(effort=>{
  const cell=m.cells.find(c=>c.effort===effort);
  if(cell)return {...cell,provenance:'reference',referenceDate:snapshot.generatedAt};
  const eligible=m.kind==='text' && m.limitParameter && m.rates.input!=null && m.rates.output!=null && (effort==='default' || m.effort===true);
  return {effort,status:eligible?'untested':'not_applicable',measuredCost:null};
 })}))
};
