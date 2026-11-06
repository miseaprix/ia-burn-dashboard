import React,{useId,useState} from 'react';
import {cacheMaintenanceCycles} from '../lib/context-cost.mjs';
const usd=n=>n==null?'Tarif non fourni':`${n.toLocaleString('fr-FR',{maximumFractionDigits:4})} $`;
const number=n=>n.toLocaleString('fr-FR',{maximumFractionDigits:2});
const compact=n=>n.toLocaleString('fr-FR',{notation:'compact',maximumFractionDigits:1});
export default function CacheMaintenance({rates,ttl,a,b}){
 const [tokens,setTokens]=useState(150000),[minutes,setMinutes]=useState(30),[cap,setCap]=useState(12),[cycles,setCycles]=useState(1);
 const id=useId(),ttlMinutes=ttl==='1h'?60:5;
 const r=cacheMaintenanceCycles({tokens,minutes,ttlMinutes,cap,cycles},rates);
 const max=Math.max(r.total??0,r.without??0,.001),x=t=>44+t/Math.max(r.totalMinutes,1)*676,y=c=>176-c/max*140;
 const curve=points=>points.slice(1).reduce((path,p)=>`${path} H ${x(p.minute)} V ${y(p.cost??0)}`,'M 44 176');
 const selected=n=>setTokens(n.cacheRead||n.cacheWrite);
 return <section className="card cache-maintenance" aria-labelledby={`${id}-title`}>
 <div className="context-model-header"><h2 id={`${id}-title`}>Combien coûte le maintien du cache ?</h2><span className="cache-ttl">Cache de {ttlMinutes} minutes</span></div>
 <p>Alternez pauses et reprises dans la même conversation. Comparez le coût cumulé des maintiens à celui des rechargements du contexte.</p>
 <div className="cache-controls">
 <label>Contexte à conserver<strong>{compact(tokens)} tokens</strong><input aria-label="Contexte à conserver en tokens" type="range" min="0" max="1000000" step="1000" value={tokens} onChange={e=>setTokens(Number(e.target.value))}/><span className="cache-presets"><button type="button" onClick={()=>selected(a)}>Reprendre A · {compact(a.cacheRead||a.cacheWrite)}</button><button type="button" onClick={()=>selected(b)}>Reprendre B · {compact(b.cacheRead||b.cacheWrite)}</button></span></label>
 <label>Durée de la pause<strong>{minutes} minutes</strong><input aria-label="Durée de la pause en minutes" type="range" min="1" max="240" step="1" value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/><span className="cache-presets">{[5,15,30,60,120].map(n=><button type="button" key={n} aria-pressed={minutes===n} onClick={()=>setMinutes(n)}>{n} min</button>)}</span></label>
 <label>Nombre de cycles pause → reprise<strong>{cycles} cycle{cycles>1?'s':''}</strong><input aria-label="Nombre de cycles pause → reprise" type="range" min="1" max="100" step="1" value={cycles} onChange={e=>setCycles(Number(e.target.value))}/><span className="cache-presets">{[1,5,10,20].map(n=><button type="button" key={n} aria-pressed={cycles===n} onClick={()=>setCycles(n)}>{n} cycle{n>1?'s':''}</button>)}</span></label>
 <label>Plafond de maintiens par pause<select aria-label="Plafond de maintiens" value={String(cap)} onChange={e=>setCap(Number(e.target.value))}>{[0,3,6,12,Infinity].map(n=><option key={n} value={String(n)}>{n===Infinity?'Sans plafond (simulation)':n===0?'Désactivé':`${n} envois`}</option>)}</select><span>Un appel toutes les {number(r.interval)} min, avant expiration. Le plafond repart à zéro après chaque reprise.</span></label>
 </div>
 <p className="cache-cycle-summary"><strong>Coûts cumulés · {cycles} cycle{cycles>1?'s':''}</strong> · {minutes} min de pause par cycle · {number(r.totalMinutes)} min d’inactivité au total. Le travail entre les pauses est exclu.</p>
 <div className="cache-results" aria-live="polite">
 <div className="cache-result"><h3>Maintenir, puis reprendre</h3><strong>{usd(r.total)}</strong><p>{r.refreshCount} maintien{r.refreshCount>1?'s':''} · {usd(r.maintenance)}<br/>Reprises : {usd(r.resume)} · {r.warm?'lecture du cache':'cache expiré, réécriture'}</p></div>
 <div className="cache-result"><h3>Laisser expirer, puis reprendre</h3><strong>{usd(r.without)}</strong><p>Aucun appel pendant la pause · 0 $<br/>{cycles} reprise{cycles>1?'s':''} · {r.idleWarm?'lecture du cache encore chaud':'réécriture du contexte'}</p></div>
 <div className={`cache-result cache-verdict ${r.difference>0?'saving':''}`}><h3>{r.difference==null?'Comparaison indisponible':r.difference>0?'Économie si vous reprenez':r.difference<0?'Surcoût du maintien':'Même coût à la reprise'}</h3><strong>{usd(r.difference==null?null:Math.abs(r.difference))}</strong><p>{usd(r.perCycle.total)} avec maintien contre {usd(r.perCycle.without)} sans maintien, par cycle. Une pause sans reprise coûte {usd(r.perCycle.maintenance)} de maintien sans réutilisation.</p></div>
 </div>
 <figure className="cache-chart"><figcaption>Coût cumulé sur {cycles} cycle{cycles>1?'s':''} pause → reprise</figcaption>
 {r.total!=null && r.without!=null ? <svg viewBox="0 0 760 218" role="img" aria-label={`Sur ${cycles} cycles de ${minutes} minutes : ${r.refreshCount} maintiens, total ${usd(r.total)} contre ${usd(r.without)} sans maintien.`}>
 {[0,.5,1].map(p=><g key={p}><line x1="44" y1={y(max*p)} x2="720" y2={y(max*p)} stroke="currentColor" opacity=".15"/><text x="42" y={y(max*p)-7} fill="currentColor" fontSize="11">{usd(max*p)}</text></g>)}
 <path d={curve(r.withoutPoints)} fill="none" stroke="#bf5af2" strokeWidth="3" strokeDasharray="7 5"/>
 <path d={curve(r.points)} fill="none" stroke="#13cad4" strokeWidth="3"/>
 {r.points.filter(p=>p.kind==='refresh').map(p=><circle key={p.minute} cx={x(p.minute)} cy={y(p.cost??0)} r="2" fill="#13cad4"/>)}
 <text x="44" y="207" fill="currentColor" fontSize="12">Début des pauses</text><text x="720" y="207" textAnchor="end" fill="currentColor" fontSize="12">{number(r.totalMinutes)} min · dernière reprise</text>
 </svg> : <p>Courbe indisponible : certains tarifs ne sont pas fournis.</p>}<div className="cache-chart-legend"><span><i style={{background:'#13cad4'}}/>Avec maintien</span><span><i style={{background:'#bf5af2'}}/>Sans maintien</span><span>Chaque point = un appel de maintien</span></div></figure>
 <p className="cache-detail"><strong>Un maintien : {usd(r.perRefresh)}</strong> = {compact(tokens)} tokens lus en cache + 10 tokens d’entrée + 2 tokens de sortie. Sur {cycles} cycle{cycles>1?'s':''} : {compact(r.readTokens)} tokens lus, {number(r.promptTokens)} tokens d’entrée et {number(r.outputTokens)} tokens de sortie.</p>
 {!r.warm && r.times.length>0 && <p className="cache-warning">Le plafond est atteint et le cache expire avant la reprise : vous payez les maintiens, puis la réécriture.</p>}
 {(tokens<20000 || cap>12) && <p className="cache-warning">Simulation théorique : le bandeau wcod ne maintient automatiquement qu’à partir de 20 000 tokens et propose au maximum 12 envois.</p>}
 {(r.total==null || r.without==null) && <p className="error-banner">Tarifs incomplets : le coût total et la comparaison restent inconnus.</p>}
 <details><summary>Hypothèses du calcul</summary><p>Les cycles sont identiques : même contexte et même durée de pause. La reprise réchauffe le cache et réinitialise le plafond avant la pause suivante. Les périodes de travail ne figurent pas sur l’axe du temps ni dans les coûts. Aucun grossissement ou compactage du contexte n’est simulé. Cache déjà chaud au début ; sa création initiale, identique dans les deux cas, est exclue. Préfixe stable intégralement réutilisable, appels réussis et brefs. Les maintiens sont simulés par pas de 15 secondes dès qu’il reste moins de 30 % du TTL, comme le bandeau wcod. Le dernier maintien n’est pas envoyé si la reprise a lieu au même instant.</p><p>Le TTL repart à chaque lecture réussie, sans nouvelle écriture du préfixe. Après expiration, la reprise est supposée réécrire ce préfixe au tarif du TTL choisi. Le message utile de reprise et sa réponse, communs aux deux options, sont exclus. Les 10 tokens d’entrée et 2 de sortie par maintien sont illustratifs ; un fork qui réutilise moins de contexte peut coûter davantage et ne pas maintenir tout le cache.</p><p>Les tarifs sont ceux du modèle sélectionné ci-dessus. Aucune requête payante n’est envoyée. Le TTL est une hypothèse, pas une garantie du fournisseur. <a href="https://platform.claude.com/docs/en/build-with-claude/prompt-caching" target="_blank" rel="noreferrer">Règles de cache Anthropic</a>.</p></details>
 </section>;
}
