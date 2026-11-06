// A generation with unsettled billing must never be replayed by a matrix resume.
export function calibrationPlan(matrix,{maxTokens,force=false}){
 const cases=[],blocked=[];
 for(const model of matrix.models){
  if(model.kind!=='text' || !model.limitParameter || !Number.isFinite(model.rates.input) || !Number.isFinite(model.rates.output))continue;
  const unavailable=model.cells.some(cell=>cell.httpStatus===404 || cell.errorCode==='gateway_not_found');
  for(const cell of model.cells){
   if(cell.status==='not_applicable' || cell.status==='observed' && !force)continue;
   if(unavailable){blocked.push({model:model.id,effort:cell.effort,status:cell.status,reason:'gateway_not_found'});continue;}
   const selected=cell.status==='untested' || cell.status==='observed' && force || cell.status==='api_error' && cell.retrySafe===true;
   if(selected)cases.push({model:model.id,effort:cell.effort,reserve:512*model.rates.input+maxTokens*model.rates.output});
   else blocked.push({model:model.id,effort:cell.effort,status:cell.status});
  }
 }
 return {cases,blocked};
}
