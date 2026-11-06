import {useEnterpriseLabel} from '../lib/enterprise.js';
import React from 'react';

export default function HelpPage() {
  const label=useEnterpriseLabel();
  return (
    <article className="help-page" lang="fr" aria-label="Aide sur les sources et les harnais">
      <section className="card"><h2>Activer les niveaux d’intégration</h2><p>Les menus restent visibles même sans données. Leurs aperçus sont <strong>illustratifs</strong> ; ils ne représentent jamais votre consommation.</p>
        <div className="integration-levels"><div><span className="activation-eyebrow">NIVEAU 1</span><h3>{label}</h3><p>Ajoutez votre <strong>clé API dans Admin</strong>, définissez le budget puis renseignez l’URL de la passerelle (<code>ANTHROPIC_BASE_URL</code> ou <code>ENTERPRISE_BASE_URL</code>). Pour la distinction par harnais, utilisez des environnements dédiés et montez leurs journaux en lecture seule.</p></div>
        <div><span className="activation-eyebrow">NIVEAU 2</span><h3>Perso</h3><p>Connectez Claude Code ou Codex à votre abonnement. Montez les <strong>journaux et données de quota personnels</strong> en lecture seule dans Burn. La formule et les fenêtres disponibles viennent du fournisseur ; certains prix nécessitent un réglage de déploiement.</p></div>
        <div><span className="activation-eyebrow">NIVEAU 3</span><h3>Métriques étendues</h3><p>Activez le récepteur Burn et les collecteurs des harnais.</p></div></div>
        <p className="help-note"><strong>Collecteurs niveau 3 disponibles :</strong> Claude Code, Codex et OpenCode 2.0.25+, avec installation manuelle. Pour Codex, <strong>validez les nouveaux hooks avec /hooks dans le CLI</strong> ; pour OpenCode, <strong>rechargez la configuration</strong>. Activer le récepteur seul n’installe pas les collecteurs. L’enrichissement des workflows reste à compléter. Les niveaux sont indépendants : le niveau 3 peut enrichir Perso comme {label}.</p>
      </section>
      <section className="card">
        <h2>Quelle source choisir ?</h2>
        <p>Un <strong>harnais</strong> est l’application utilisée pour travailler : Claude Code, Codex ou OpenCode. Le <strong>fournisseur</strong> est le service qui répond aux appels. Un même harnais peut utiliser un compte personnel ou {label}.</p>
        <div className="help-table-wrap">
          <table>
            <thead><tr><th>Source</th><th>Données affichées</th><th>Portée</th></tr></thead>
            <tbody>
              <tr><th><span className="help-personal">Perso</span></th><td>Usage des dossiers personnels Claude Code et Codex ; quotas personnels lorsqu’ils sont disponibles.</td><td>Ce poste et son historique collecté.</td></tr>
              <tr><th><span className="help-corporate">{label} local</span></th><td>Usage des environnements entreprise de Claude Code, Codex et OpenCode, détaillé par harnais.</td><td>Ce poste et son historique collecté.</td></tr>
              <tr><th><span className="help-api">{label}</span></th><td>Dépenses, tokens et modèles retournés par la passerelle {label}. Budget mensuel comparé à une limite configurée dans Burn.</td><td>Couverture fournie par l’API, dépendante de sa disponibilité.</td></tr>
            </tbody>
          </table>
        </div>
        <p className="help-note">Ces sources sont des vues séparées. <strong>Ne pas additionner {label} local et {label}</strong> : les mêmes appels peuvent être présents dans les deux.</p>
      </section>
      <section className="card">
        <h2>Comment Codex personnel et {label} sont-ils distingués ?</h2>
        <p>Burn classe actuellement les sessions Codex selon leur <strong>dossier de stockage</strong>. Définissez <code>CODEX_HOME</code> pour utiliser un environnement dédié.</p>
        <div className="help-table-wrap">
          <table>
            <thead><tr><th>Utilisation</th><th>Dossier par défaut</th><th>Vue dans Burn</th></tr></thead>
            <tbody>
              <tr><th>Codex personnel</th><td><code>~/.codex</code></td><td><strong className="help-personal">Perso → Codex</strong></td></tr>
              <tr><th>Codex entreprise</th><td><code>~/.codex-enterprise</code></td><td><strong className="help-corporate">{label} local → Codex</strong></td></tr>
            </tbody>
          </table>
        </div>
        <p className="help-note"><strong>Limite actuelle :</strong> <strong>le fournisseur de chaque session Codex n’est pas vérifié.</strong> Un appel {label} enregistré dans le dossier personnel sera classé dans Perso, et inversement. <strong>Gardez les deux environnements séparés.</strong> Le nom du modèle ne suffit pas pour les distinguer.</p>
        <p>Une vérification du fournisseur enregistré dans les sessions serait un renforcement futur ; elle n’est pas encore implémentée.</p>
      </section>
      <section className="card">
        <h2>Et pour les autres harnais ?</h2>
        <p><strong>Claude Code :</strong> même <strong>séparation par dossier</strong> : <code>~/.claude</code> pour le personnel, <code>~/.claude-enterprise</code> pour {label} via <code>CLAUDE_CONFIG_DIR</code>. La classification se fie à cette racine dédiée.</p>
        <p><strong>OpenCode :</strong> les messages sont stockés dans une base partagée, <code>~/.local/share/opencode/opencode.db</code>. Burn retient uniquement les <strong>messages assistant terminés</strong> dont le fournisseur figure dans <code>ENTERPRISE_OPENCODE_PROVIDERS</code> (liste séparée par des virgules, vide par défaut). Les autres fournisseurs sont exclus de cette vue.</p>
        <p>Les chemins ci-dessus sont les valeurs par défaut. Les montages peuvent être adaptés au déploiement. Burn lit les sources en <strong>lecture seule</strong> et ne modifie pas les configurations des harnais.</p>
      </section>
      <section className="card">
        <h2>Coûts, quotas et actualisation</h2>
        <p>Le menu <strong>Admin</strong>, en bas de la barre latérale, permet d’enregistrer une clé {label}, de modifier le budget et les fréquences de collecte. Les réglages persistent dans le volume Docker et prennent priorité sur la configuration de démarrage. L’administration est réservée à <strong>localhost</strong>.</p>
        <p>Dans <strong className="help-api">{label}</strong>, les dépenses proviennent de la passerelle. La limite mensuelle est <strong>configurée dans Burn (300 USD par défaut)</strong> ; elle n’est pas une limite de compte découverte auprès de l’API. La collecte rapproche les <strong>30 derniers jours</strong> ; les périodes plus anciennes dépendent de l’historique déjà collecté.</p>
        <p>Les montants locaux représentent une <strong className="help-corporate">valeur équivalente API</strong>, <strong>pas une facture</strong> d’abonnement ni la facture {label}. Ils utilisent les coûts présents dans les journaux ou les tarifs des modèles. Pour OpenCode, un coût nul retourné par la passerelle est remplacé par une estimation à partir des tokens.</p>
        <p>Si un tarif manque, <strong>les tokens restent comptés</strong> mais la dépense est signalée <strong className="help-corporate">incomplète</strong>. {label} local <strong>ne couvre pas les appels effectués sur d’autres postes ou applications</strong>, et n’affiche pas les quotas des abonnements personnels.</p>
        <p>Le backend collecte les journaux locaux et les quotas personnels <strong>toutes les minutes</strong>, et l’API {label} <strong>toutes les cinq minutes</strong> par défaut. L’interface se met à jour toutes les minutes pour une <strong>période incluant aujourd’hui</strong>, lorsque l’onglet est visible.</p>
        <p><strong>« Last 7 days » inclut aujourd’hui</strong> : les jours passés restent dans l’historique et le jour courant évolue au fil des collectes. Une <strong>période fixe entièrement passée ne s’actualise pas automatiquement</strong>. Les agrégats sont conservés dans SQLite, dans le <strong>volume Docker persistant</strong> ; leur couverture dépend des données effectivement collectées.</p>
      </section>
    </article>
  );
}
