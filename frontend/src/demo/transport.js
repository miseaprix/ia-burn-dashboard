import {dashboard,integrations,monitoring,requests} from './data.mjs';
import {demoReferenceCatalog,demoReferenceMatrix} from './calibration-reference.mjs';
let calibration=null;

let settings={budget:300,localSeconds:60,quotaSeconds:60,corporateSeconds:300,baseUrl:'https://example.invalid',hasApiKey:false,keySource:'none'};
export async function apiFetch(input,{method='GET',body,signal}={}) {
  if(signal?.aborted)throw new DOMException('Aborted','AbortError');
  const url=new URL(input,'https://demo.invalid');
  const level=Number(new URLSearchParams(window.location.search).get('level')) || 3;
  let result,status=200;
  if(url.pathname==='/api/dashboard')result=dashboard(url.searchParams,{budget:settings.budget,level});
  else if(url.pathname==='/api/config')result={enterprise:{label:'Acme AI',enabled:true}};
  else if(url.pathname==='/api/integrations')result=integrations(level);
  else if(url.pathname==='/api/monitor')result=monitoring(level);
  else if(url.pathname==='/api/monitor/requests')result=requests(level);
  else if(url.pathname==='/api/context/models' || url.pathname==='/api/admin/calibration/catalog')result=demoReferenceCatalog;
  else if(url.pathname==='/api/admin/calibration/matrix')result=demoReferenceMatrix;
  else if(url.pathname==='/api/admin/calibration' || url.pathname==='/api/admin/calibration/reconcile') {
    if(method==='POST'){status=403;result={error:{message:'La démo affiche les références publiées. Les appels et vérifications réels nécessitent une installation locale.'}};}
    else result=calibration;
  }
  else if(url.pathname==='/api/admin/calibration/stop'){calibration=null;result=null;}
  else if(url.pathname==='/api/admin/settings') {
    if(method==='PUT') {
      const values=JSON.parse(body);
      // Whitelist numeric settings only; credentials are never read or stored.
      for(const key of ['budget','localSeconds','quotaSeconds','corporateSeconds'])
        if(Number.isFinite(values[key]) && values[key]>0)settings[key]=values[key];
    }
    result=settings;
  } else {status=404;result={error:{message:'Endpoint unavailable in demonstration'}};}
  return new Response(JSON.stringify(result),{status,headers:{'Content-Type':'application/json'}});
}
