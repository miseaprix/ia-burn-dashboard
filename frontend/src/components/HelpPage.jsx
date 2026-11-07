import {useEnterpriseLabel} from '../lib/enterprise.js';
import React from 'react';

export default function HelpPage() {
  const label=useEnterpriseLabel();
  return (
    <article className="help-page" lang="fr" aria-label="Aide sur les sources et les harnais">
      <section className="card"><h2>Activer les niveaux d’intégration</h2><p>Les menus restent visibles même sans données. Leurs aperçus sont <strong>illustratifs</strong> ; ils ne représentent jamais votre consommation.</p>
        <div className="integration-levels"><div><span className="activation-eyebrow">NIVEAU 1</span><h3>{label}</h3><p>Ajoutez votre <strong>clé API dans Admin</strong>, définissez le budget puis renseignez l’URL de la passerelle (<code>ANTHROPIC_BASE_URL</code> ou <code>ENTERPRISE_BASE_URL</code>). Pour la distinction par harnais, utilisez des environnements dédiés et montez leurs journaux en lecture seule.</p></div>
        <div><span className="activation-eyebrow">NIVEAU 2</span><h3>Perso</h3><p>Connectez Claude Code ou Codex à votre abonnement. Montez les <strong>journaux et données de quota personnels</strong> en lecture seule dans Burn. La formule et les fenêtres disponibles viennent du fournisseur ; certains prix nécessitent un réglage de déploiement.</p></div>
        <div><span className="activation-eyebrow">NIVEAU 3</span><h3>Métriques étendues</h3><p>Activez le récepteur Burn et configurez les sources de vos harnais.</p><a href="#monitoring-setup">Configuration par harnais</a></div></div>
      </section>
      <section className="card monitoring-setup" id="monitoring-setup">
        <h2>Niveau 3 · Configuration par harnais</h2>
        <p>Depuis le dépôt IA Burn, ajoutez <code>MONITOR_INGEST_ENABLED=1</code> dans <code>.env</code>, puis relancez <code>./deploy.sh --port 4095</code>. Les exemples ci-dessous utilisent ce port. Installez Node.js 24 ou plus récent sur le poste où tournent les harnais.</p>
        <p>Les hooks et plugins envoient l’activité. Pour les compteurs du modèle et le contexte, renseignez <code>collector.json</code> avec vos sources, la date <code>since</code> et le récepteur <code>http://127.0.0.1:4095/api/monitor/model-requests</code>. Lancez <code>node scripts/collect-model-requests.mjs /chemin/collector.json</code> comme service utilisateur pour le garder actif. Le guide <code>docs/MONITORING.md</code> du dépôt contient un exemple complet.</p>
        <details>
          <summary>Claude Code · Hooks, compteurs et requête capturée</summary>
          <p><strong>Événements.</strong> Installez les hooks, puis ouvrez une nouvelle session.</p>
          <pre><code>node scripts/install-claude-monitor.mjs --dataset personal --apply</code></pre>
          <p><strong>Compteurs.</strong> Ajoutez la racine du profil à <code>claudeLogs</code>, par exemple <code>~/.claude</code> pour Perso. Pour un profil {label} dédié, utilisez sa racine <code>CLAUDE_CONFIG_DIR</code> et le dataset <code>enterprise</code>.</p>
          <p><strong>Contexte.</strong> Créez un dossier privé (mode <code>0700</code>), ajoutez-le à <code>claudeCaptures</code>, puis fusionnez ces clés dans <code>env</code> du <code>settings.json</code> utilisateur du profil. Remplacez le chemin par votre chemin absolu.</p>
          <pre><code>{`{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_LOGS_EXPORTER": "console",
    "OTEL_LOG_RAW_API_BODIES": "file:/chemin/prive/claude-capture/direct"
  }
}`}</code></pre>
          <p>Redémarrez la session. L’import automatique utilise l’index de capture de Claude Code, disponible à partir de la version 2.1.274.</p>
        </details>
        <details>
          <summary>Paperclip · Agents locaux Claude Code via ACP</summary>
          <p>Dans les variables d’environnement de l’adaptateur de chaque agent, définissez <code>CLAUDE_CODE_EXECUTABLE</code> sur le chemin absolu de <code>scripts/claude-paperclip-capture.mjs</code>. Sur macOS, ce lanceur utilise le binaire <code>~/.local/bin/claude</code> et le dossier privé <code>~/.local/state/ia-burn/claude-capture/paperclip</code> (mode <code>0700</code>).</p>
          <p>Ajoutez ce dossier à <code>claudeCaptures</code> avec <code>paperclip: true</code>. Renseignez <code>paperclip</code> avec l’URL de l’API locale, par exemple <code>http://127.0.0.1:3100/api/</code>. <code>paperclipDatasets</code> permet de classer les sociétés par dataset. Burn retrouve le ticket et l’exécution grâce à la session Claude et à l’horodatage.</p>
        </details>
        <details>
          <summary>Codex · Journal local et hooks facultatifs</summary>
          <p>Ajoutez la racine <code>CODEX_HOME</code> du profil à <code>codexLogs</code>, par exemple <code>~/.codex</code> pour Perso. Le collecteur lit les compteurs et le contexte observable dans les journaux. Le backend peut aussi construire la chronologie depuis le journal monté en lecture seule quand aucun hook n’a remonté d’événement. Le corps complet de la requête reste indisponible.</p>
          <pre><code>node scripts/install-codex-monitor.mjs --dataset personal --apply</code></pre>
          <p>Pour activer aussi les hooks, gardez <code>features.hooks</code> activé et approuvez-les avec <code>/hooks</code> dans le CLI Codex. Pour {label}, utilisez <code>--dataset enterprise</code> et la racine du profil dédié.</p>
        </details>
        <details>
          <summary>OpenCode 2 · Plugin, base locale et contexte de requête</summary>
          <pre><code>node scripts/install-opencode-monitor.mjs --datasets personal,enterprise --apply</code></pre>
          <p>Dans <code>collector.json</code>, configurez <code>openCodeDb</code> (par défaut <code>~/.local/share/opencode/opencode.db</code>) et classez chaque identifiant fournisseur avec <code>openCodeProviders</code>. Pour le contexte, ajoutez <code>captureDirectory</code> aux options du plugin dans <code>~/.config/opencode/opencode.json</code>. Utilisez le même dossier privé (mode <code>0700</code>) pour <code>openCodeCapture</code>.</p>
          <pre><code>{`{
  "captureDirectory": "/chemin/prive/opencode-capture",
  "providers": { "personal": ["deepseek"], "enterprise": [] }
}`}</code></pre>
          <p>Fusionnez ces options avec les options existantes et adaptez la liste à vos fournisseurs, par exemple <code>deepseek</code> pour une connexion directe. Rechargez OpenCode. Les compteurs des messages et le contexte des requêtes apparaissent comme des mesures distinctes.</p>
        </details>
        <p>Pour vérifier, lancez une courte session, puis ouvrez <strong>Monitoring → Sessions avec mesures</strong>. Le détail de la session indique si la mesure provient d’une capture, d’un journal ou de compteurs seuls.</p>
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
        <p>Les chemins ci-dessus sont les valeurs par défaut. Les montages du tableau de bord sont en lecture seule. Les installateurs du niveau 3 mettent à jour les réglages des harnais à la demande.</p>
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
