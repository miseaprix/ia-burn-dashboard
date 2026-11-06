import {useEnterpriseLabel} from '../lib/enterprise.js';
import React from 'react';
const contentFor=label=>({
  corporate:{level:1,title:`Votre consommation ${label}, en un regard.`,intro:'Gardez le cap sur votre budget. Retrouvez les dépenses de la passerelle, les modèles utilisés et leur évolution au fil des jours.',features:['Budget et prévision de fin de mois','Dépenses par modèle et fournisseur','Requêtes et activité quotidienne'],steps:['Ajoutez votre clé API dans Admin.','Vérifiez le budget mensuel et la fréquence de collecte.','Renseignez l’URL de la passerelle pour recevoir les premières données.'],cta:`Configurer ${label}`},
  local:{level:1,title:`Retrouvez ${label} dans chaque harnais.`,intro:`Comprenez comment votre poste utilise ${label} avec Claude Code, Codex et OpenCode, indépendamment du suivi global de la passerelle.`,features:['Consommation par harnais','Modèles et répartition des tokens','Historique local conservé'],steps:['Configurez des environnements dédiés à la clé entreprise.','Montez leurs journaux en lecture seule dans Burn.',`Lancez une session ${label} pour démarrer la collecte.`],cta:'Voir la configuration locale'},
  personal:{level:2,title:'Prenez le pouls de vos abonnements.',intro:'Anticipez les limites de votre abonnement et découvrez où passent vos tokens. Vos données personnelles restent sur votre poste.',features:['Quotas disponibles et dates de réinitialisation','Consommation par modèle','Valeur équivalente API et tendances'],steps:['Installez et connectez votre harnais personnel.','Donnez à Burn accès aux journaux et aux données de quota en lecture seule.','Vérifiez la formule et le prix de votre abonnement, si nécessaire.'],cta:'Configurer le niveau 2'},
  monitoring:{level:3,title:'Comprenez votre façon de travailler.',intro:'Reliez vos sessions aux projets et tickets. Explorez les outils, MCP, commandes, scripts, agents, skills et workflows qui accompagnent votre travail.',features:['Sessions, projets et tickets Jira','Outils, MCP, commandes et scripts','Agents, skills et workflows'],steps:['Activez le récepteur Monitoring de Burn.','Installez les collecteurs natifs des harnais.','Transmettez les identifiants de session, projet et ticket pour relier les événements.'],cta:'Configurer le niveau 3'}
});
export default function ActivationPage({kind='personal',name,waiting=false,onAdmin,onHelp}) {
  const label=useEnterpriseLabel();
  const content=contentFor(label);
  const c=content[kind];
  return <article className="activation-page" lang="fr">
    <section className="card activation-hero">
      <div className="activation-copy"><span className="activation-eyebrow">NIVEAU {c.level} · {name || (kind==='monitoring' ? 'Métriques étendues' : kind==='personal' ? 'Perso' : `${label}`)}</span>
        <span className={`activation-state ${waiting ? 'waiting' : ''}`}>{waiting ? 'En attente de premières données' : 'Configuration requise'}</span>
        <h2>{c.title}</h2><p>{c.intro}</p>
        <div className="activation-actions"><button className="activation-primary" onClick={onAdmin}>{c.cta} <span aria-hidden="true">→</span></button><button className="activation-secondary" onClick={onHelp}>Comprendre le fonctionnement</button></div>
        <small>{waiting ? 'La réception est activée. Aucune donnée reçue pour le moment : vérifiez les connexions des collecteurs.' : 'Ce menu reste accessible. Les métriques apparaîtront après la configuration et la première collecte.'}</small>
      </div>
      <div className="activation-preview" aria-label="Aperçu illustratif sans métriques réelles">
        <div className="preview-label"><span className="preview-dot" /> APERÇU ILLUSTRATIF</div>
        <div className="preview-heading">{kind==='monitoring' ? 'Une session, tout son contexte' : 'Votre activité au fil du temps'}</div>
        <div className="preview-pills"><span>{kind==='monitoring' ? 'Projet' : 'Consommation'}</span><span>{kind==='monitoring' ? 'Ticket Jira' : 'Modèles'}</span><span>{kind==='monitoring' ? 'Session' : 'Historique'}</span></div>
        {kind==='monitoring' ? <div className="preview-flow">{['Session','Outils & MCP','Scripts & agents','Skills & workflows'].map((x,i)=><div key={x}><i>{i+1}</i><span>{x}</span><b aria-hidden="true">↗</b></div>)}</div> : <svg viewBox="0 0 360 155" role="img" aria-label="Illustration de tendance"><path className="preview-grid" d="M0 30H360 M0 75H360 M0 120H360"/><path className="preview-area" d="M0 135 L35 115 L70 120 L105 88 L140 99 L175 63 L210 70 L245 43 L280 55 L320 20 L360 30 V155 H0Z"/><path className="preview-line" d="M0 135 L35 115 L70 120 L105 88 L140 99 L175 63 L210 70 L245 43 L280 55 L320 20 L360 30"/></svg>}
        <p>Aucune donnée réelle affichée</p>
      </div>
    </section>
    <div className="activation-features">{c.features.map((f,i)=><section className="card" key={f}><span className="activation-feature-icon" aria-hidden="true">{['◷','▥','↗'][i]}</span><h3>{f}</h3><p>{['Une vue claire pour décider.','Des détails pour comprendre.','Un historique pour comparer.'][i]}</p></section>)}</div>
    <section className="card activation-steps"><div><span className="activation-eyebrow">PASSER À L’ACTION</span><h2>{waiting ? 'Connectez votre première source' : `Activer le niveau ${c.level}`}</h2><p>Les niveaux sont complémentaires. Activez ceux qui vous sont utiles.</p></div><ol>{c.steps.map((s,i)=><li key={s}><span>{i+1}</span>{s}</li>)}</ol></section>
  </article>;
}
