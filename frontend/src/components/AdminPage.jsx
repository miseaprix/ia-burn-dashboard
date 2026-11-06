import {useEnterpriseLabel} from '../lib/enterprise.js';
import CalibrationAdmin from './CalibrationAdmin.jsx';
import AdminPanel from './AdminPanel.jsx';
import {DEMO} from '../lib/demo-mode.js';
import {apiFetch} from '../lib/api.js';
import React, {useEffect,useState} from 'react';

export default function AdminPage({integrations,onHelp,enterpriseEnabled=true}) {
  const label=useEnterpriseLabel();
  const [settings,setSettings] = useState(null),[apiKey,setApiKey] = useState(''),[fallback,setFallback] = useState(false);
  const [message,setMessage] = useState(''),[error,setError] = useState(''),[busy,setBusy] = useState(false);
  useEffect(()=>{
    let active=true;
    apiFetch('/api/admin/settings').then(async r=>{const x=await r.json();if(!r.ok)throw new Error(x.error?.message);if(active)setSettings(x);})
      .catch(()=>{if(active)setError('Impossible de charger la configuration Admin. Accédez à l’application via localhost.');});
    return ()=>{active=false;};
  },[]);
  async function save(e) {
    e.preventDefault();setBusy(true);setError('');setMessage('');
    try {
      const {budget,localSeconds,quotaSeconds,corporateSeconds}=settings;
      const r=await apiFetch('/api/admin/settings',{method:'PUT',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({budget,localSeconds,quotaSeconds,corporateSeconds,...(apiKey ? {apiKey} : {}),useEnvironmentKey:fallback})});
      const x=await r.json();if(!r.ok)throw new Error(x.error?.message);
      setSettings(x);setApiKey('');setFallback(false);
      setMessage(DEMO ? 'Simulation enregistrée en mémoire pour cette visite. Aucun serveur ni compte modifié.' : 'Configuration enregistrée. Les collectes ont été relancées ; les métriques seront actualisées à leur prochaine lecture.');
    } catch { setError('Enregistrement impossible. Vérifiez les valeurs et réessayez.'); }
    finally { setBusy(false); }
  }
  const activeLevels=[integrations?.corporate?.configured,Object.values(integrations?.personal?.observed || {}).some(Boolean) || Object.values(integrations?.personal?.configured || {}).some(Boolean),integrations?.monitoring?.configured].filter(Boolean).length;
  const number = (key,value) => setSettings(s=>({...s,[key]:Number(value)}));
  return <article className="help-page admin-page" lang="fr" aria-label="Configuration Admin">
    <AdminPanel title="Vos niveaux d’intégration" subtitle="Configuration et disponibilité des sources" badge={integrations?`${activeLevels} / ${enterpriseEnabled ? 3 : 2} activés`:"Vérification…"} defaultOpen={false} className="integration-admin"><p>Chaque niveau apporte une vue complémentaire. La configuration Perso et Monitoring se fait aussi dans les harnais et le déploiement.</p><div className="integration-levels">{[
      [1,`${label}`,'Clé API et budget',integrations?.corporate?.configured],
      [2,'Perso','Abonnements et sources locales',Object.values(integrations?.personal?.observed || {}).some(Boolean) || Object.values(integrations?.personal?.configured || {}).some(Boolean)],
      [3,'Métriques étendues','Collecteurs et contexte',integrations?.monitoring?.configured]
    ].filter(([level])=>enterpriseEnabled || level!==1).map(([level,title,description,ready])=><div key={level}><div className="integration-card-head"><span className="activation-eyebrow">NIVEAU {level}</span><span className={`status-badge ${!integrations?"neutral":ready?"active":"waiting"}`}>{!integrations?"Vérification…":ready?"Activé":"À configurer"}</span></div><h3>{title}</h3><p>{description}</p><strong>{integrations ? ready ? level===2 && !Object.values(integrations.personal?.observed || {}).some(Boolean) ? 'En attente de données' : level===3 && !integrations.monitoring?.events && !integrations.monitoring?.requests ? 'En attente de données' : level===3 ? 'Récepteur activé' : 'Source détectée' : 'À configurer' : 'Vérification…'}</strong>{level>1 && <button type="button" className="activation-secondary" onClick={onHelp}>Guide d’activation →</button>}</div>)}</div><p className="catalog-note">Le badge confirme la configuration du niveau ; les détails indiquent si des données ont été reçues.</p></AdminPanel>
    {enterpriseEnabled && <CalibrationAdmin />}
    {error && <p className="error-banner" role="alert">{error}</p>}
    {!settings && !error && <p>Chargement…</p>}
    {settings && <AdminPanel title={`Configuration ${label} et collecte`} subtitle="Clé, budget mensuel et fréquences" badge={settings.hasApiKey?"Clé configurée":"Clé absente"} defaultOpen={false}><form onSubmit={save}>
      <p>{DEMO ? 'Vous pouvez simuler les réglages pendant cette visite. Aucune clé API ne peut être saisie ; les réglages sont réinitialisés au rechargement.' : 'Les réglages enregistrés ici sont conservés dans le volume Docker et prennent priorité sur les valeurs de démarrage.'}</p>
      <p>Passerelle : <code>{settings.baseUrl}</code></p>
      <label className="admin-field">Nouvelle clé API
        <input type="password" autoComplete="new-password" value={apiKey} disabled={DEMO || fallback || busy} onChange={e=>setApiKey(e.target.value)} placeholder="Laisser vide pour conserver la clé actuelle" />
      </label>
      <p>État : <strong>{settings.hasApiKey ? 'Clé configurée' : 'Aucune clé'}</strong> · Origine : {settings.keySource === 'admin' ? 'Admin' : settings.keySource === 'environment' ? 'configuration de démarrage' : 'aucune'}.</p>
      <p>La clé enregistrée est chiffrée sur le serveur et n’est jamais retournée dans ce formulaire. Les sauvegardes du volume doivent rester privées. Une clé différente ouvre un historique {label} séparé pour éviter de mélanger les comptes ; les anciennes données sont conservées.</p>
      {settings.keySource === 'admin' && <label className="admin-checkbox"><input type="checkbox" checked={fallback} onChange={e=>{setFallback(e.target.checked);setApiKey('');}} /> Retirer la clé Admin et utiliser la configuration de démarrage, si disponible</label>}
      <label className="admin-field">Budget mensuel (USD)
        <input type="number" min="1" max="1000000" step="0.01" required value={settings.budget} onChange={e=>number('budget',e.target.value)} />
      </label>
      <p>Cette limite sert au suivi et aux prévisions dans Burn. Elle ne modifie pas le budget de votre compte auprès de la passerelle.</p>
      <h2>Fréquences de collecte</h2>
      <div className="admin-intervals">
        {[['localSeconds',`Journaux locaux (Perso et ${label} local)`,15,3600],['quotaSeconds','Quotas personnels',30,3600],['corporateSeconds',`API ${label}`,60,86400]].map(([key,label,min,max])=>
          <label className="admin-field" key={key}>{label} · secondes
            <input type="number" required min={min} max={max} step="1" value={settings[key]} onChange={e=>number(key,e.target.value)} />
          </label>)}
      </div>
      <p>L’actualisation du dashboard reste d’une minute pour les périodes incluant aujourd’hui. Une collecte plus fréquente augmente les appels aux fournisseurs.</p>
      <button className="help-back admin-save" disabled={busy} type="submit">{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      {message && <p role="status" className="admin-success">{message}</p>}
    </form></AdminPanel>}
  </article>;
}
