import React from 'react';

function Source({ children }) {
  return <p className="setup-source"><strong>Sur quoi repose la collecte</strong> {children}</p>;
}

function Step({ title, location, children }) {
  return <li>
    <h4>{title}</h4>
    <p className="setup-location"><strong>Où</strong> {location}</p>
    {children}
  </li>;
}

// Tokenize the literals, commands and options used in these static examples.
const codePatterns = {
  bash: /^(?<command>[^\s-]\S*)|(?<option>(?<!\S)--?[\w-]+\b)|(?<path>(?<=\s)(?:[~.]?\/|[\w.-]+\/)[^\s]+)|(?<number>(?<=\s)\d+(?=\s|$))/gm,
  json: /(?<key>"(?:\\.|[^"\\])*"(?=\s*:))|(?<string>"(?:\\.|[^"\\])*")|(?<literal>\b(?:true|false|null)\b)|(?<number>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
  dotenv: /^(?<key>[A-Za-z_]\w*)(?==)|(?<number>(?<==)\d+$)/gm,
};

function SyntaxCode({ children, language = 'bash' }) {
  const parts = [];
  let offset = 0;
  for (const match of children.matchAll(codePatterns[language])) {
    const kind = Object.keys(match.groups).find(key => match.groups[key] !== undefined);
    parts.push(children.slice(offset, match.index));
    parts.push(<span key={match.index} className={`syntax-${kind}`}>{match[0]}</span>);
    offset = match.index + match[0].length;
  }
  parts.push(children.slice(offset));
  return <code className={`language-${language}`}>{parts}</code>;
}

function Code({ children, language }) {
  return <pre className="setup-code"><SyntaxCode language={language}>{children}</SyntaxCode></pre>;
}

function FilePath({ children }) {
  return <code className="syntax-path">{children}</code>;
}

const collector = <>Poste hôte → <FilePath>~/.local/state/ia-burn/collector.json</FilePath></>;
const paperclipVariables = <strong>Paperclip → Agents → votre agent → Secrets &amp; variables → Environment variables</strong>;
const openCodeSources = `{
  "openCodeDb": "/Users/alice/.local/share/opencode/opencode.db",
  "openCodeProviders": { "deepseek": "personal" },
  "openCodeCapture": "/Users/alice/.local/state/ia-burn/opencode-capture"
}`;

export default function MonitoringSetup() {
  return <section className="card monitoring-setup" id="monitoring-setup">
    <h2>Niveau 3 · Configuration par harnais</h2>
    <Source>Les hooks et plugins décrivent l’activité. Les journaux ou la base du harnais fournissent les compteurs de jetons. Les captures ajoutent le détail du contexte lorsque le harnais l’expose.</Source>
    <figure className="setup-flow" aria-labelledby="setup-flow-caption">
      <figcaption id="setup-flow-caption"><strong>Une déclaration, deux circuits de collecte</strong></figcaption>
      <div className="setup-flow-config"><FilePath>collector.json</FilePath><span>Dossier, harnais et dataset de chaque profil</span></div>
      <div className="setup-flow-branches">
        <div>
          <span className="setup-flow-arrow" aria-hidden="true">↓</span>
          <strong>Docker</strong><span>Lit les journaux montés en lecture seule</span>
          <span className="setup-flow-arrow" aria-hidden="true">↓</span>
          <strong>Dashboard</strong><span>Historique, consommation et coûts</span><span>Secours Monitoring pour la chronologie Codex</span>
        </div>
        <div>
          <span className="setup-flow-arrow" aria-hidden="true">↓</span>
          <strong>Collecteur sur le poste hôte</strong><span>Lit les journaux et captures. Les hooks envoient les événements.</span>
          <span className="setup-flow-arrow" aria-hidden="true">↓</span>
          <strong>Monitoring niveau 3</strong><span>Événements, mesures par appel et contexte</span>
        </div>
      </div>
    </figure>
    <p>Faites la préparation commune une fois, puis ouvrez la procédure de votre harnais. Les exemples utilisent le port <code>4095</code>, le compte <code>alice</code> et le dataset <code>personal</code>. Adaptez les chemins absolus à votre compte et utilisez <code>enterprise</code> pour un profil entreprise.</p>

    <details>
      <summary>1 · Préparation commune</summary>
      <h3>Installation guidée sur macOS</h3>
      <p>Depuis le dépôt IA Burn, lancez cet aperçu pour les profils Claude Code et Codex personnels. Ajoutez <SyntaxCode>--apply</SyntaxCode> pour créer ou compléter <FilePath>collector.json</FilePath>, configurer les profils choisis et charger le service <code>launchd</code>. L’option <SyntaxCode>--deploy</SyntaxCode> active et redéploie aussi le récepteur Docker.</p>
      <Code>node scripts/install-monitoring.mjs --claude --codex --deploy</Code>
      <p>Pour des profils personnalisés, indiquez leurs dossiers. Répétez les options autant de fois que nécessaire pour un même dataset.</p>
      <Code>node scripts/install-monitoring.mjs --dataset enterprise --claude-profile ~/.claude-accor --codex-profile ~/.codex-accor</Code>
      <p>Si les hooks Burn d’un profil pointent vers un autre clone, ajoutez <SyntaxCode>--replace-hooks</SyntaxCode> pour préparer leur migration. Le script sauvegarde les fichiers modifiés. Après une migration Codex, approuvez les nouvelles commandes dans <code>/hooks</code>.</p>
      <h3>Partager les profils avec Docker</h3>
      <p>Après avoir renseigné <FilePath>collector.json</FilePath>, vérifiez les montages. Relancez la commande sans <SyntaxCode>--check</SyntaxCode> pour les activer. Docker continue à lire les journaux si le collecteur hôte est arrêté.</p>
      <Code>./deploy.sh --port 4095 --profiles ~/.local/state/ia-burn/collector.json --check</Code>
      <p>Pour revenir aux montages définis dans <FilePath>.env</FilePath>, redéployez avec la commande suivante.</p>
      <Code>./deploy.sh --port 4095</Code>
      <h3>Configuration manuelle</h3>
      <ol className="setup-steps">
        <Step title="Activer la réception des métriques" location={<>Dépôt IA Burn → fichier <FilePath>.env</FilePath></>}>
          <p>Ajoutez cette ligne, puis relancez le déploiement depuis le dépôt.</p>
          <Code language="dotenv">MONITOR_INGEST_ENABLED=1</Code>
          <Code>./deploy.sh --port 4095</Code>
        </Step>
        <Step title="Créer la configuration du collecteur" location={collector}>
          <p><code>~</code> désigne le dossier personnel du compte qui lance le collecteur sur le poste hôte. Le collecteur lit ce fichier et envoie les mesures au conteneur IA Burn via l’adresse HTTP <code>receiver</code>.</p>
          <p>Créez le fichier avec ces deux clés. Remplacez la date d’exemple par le début de collecte souhaité, puis ajoutez les clés de votre harnais au même objet JSON.</p>
          <Code>mkdir -p -m 700 ~/.local/state/ia-burn</Code>
          <Code language="json">{`{
  "receiver": "http://127.0.0.1:4095/api/monitor/model-requests",
  "since": "2026-11-07T20:00:00Z"
}`}</Code>
        </Step>
        <Step title="Démarrer la collecte en continu" location="Terminal du poste qui exécute les agents → dépôt IA Burn">
          <p>Le déploiement Docker démarre le récepteur. Pour démarrer le collecteur à la connexion, configurez une fois un service utilisateur sur le poste hôte, par exemple <code>launchd</code> sur macOS. Relancez le service après toute modification de <FilePath>collector.json</FilePath>.</p>
          <p>Pour un premier essai, vous pouvez lancer la commande au premier plan depuis le dépôt avec Node.js 24 ou plus récent. Si le service tourne déjà, il assure la collecte.</p>
          <Code>node scripts/collect-model-requests.mjs ~/.local/state/ia-burn/collector.json</Code>
        </Step>
      </ol>
    </details>

    <details id="setup-claude">
      <summary>2 · Claude Code en direct</summary>
      <Source>Les hooks envoient les événements. Le journal fournit les compteurs du modèle. À partir de Claude Code 2.1.274, la capture native fournit le contexte des requêtes.</Source>
      <ol className="setup-steps">
        <Step title="Ajouter les hooks Burn" location={<>Terminal → dépôt IA Burn. L’installateur écrit dans <FilePath>~/.claude/settings.json</FilePath> → clé <code>hooks</code>.</>}>
          <Code>node scripts/install-claude-monitor.mjs --dataset personal --apply</Code>
          <p>Pour un autre profil, ajoutez <SyntaxCode>--settings /chemin/du/profil/settings.json</SyntaxCode>. L’installateur conserve les hooks existants.</p>
          <details>
            <summary>JSON à ajouter manuellement pour SessionStart</summary>
            <p>Dans <FilePath>~/.claude/settings.json</FilePath>, ajoutez cet objet à la liste <code>hooks.SessionStart</code>. Créez la liste si elle manque ou conservez ses entrées si elle existe. Adaptez les deux chemins absolus, le dataset et le port. Cette règle couvre le démarrage de session. L’installateur configure les dix événements Burn.</p>
            <Code language="json">{`{
  "matcher": "*",
  "hooks": [
    {
      "type": "command",
      "command": "'/opt/homebrew/bin/node' '/Users/alice/dev/ia-burn-dashboard/scripts/claude-monitor-hook.mjs' '--dataset' 'personal' '--url' 'http://localhost:4095/api/monitor/events'",
      "timeout": 5
    }
  ]
}`}</Code>
          </details>
        </Step>
        <Step title="Activer la capture des requêtes" location={<>Profil Claude Code → <FilePath>settings.json</FilePath> → objet <code>env</code></>}>
          <p>Créez le dossier privé depuis le terminal, puis fusionnez ces trois variables avec celles déjà présentes dans <code>env</code>.</p>
          <Code>mkdir -p -m 700 ~/.local/state/ia-burn/claude-capture/direct</Code>
          <Code language="json">{`{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_LOGS_EXPORTER": "console",
    "OTEL_LOG_RAW_API_BODIES": "file:/Users/alice/.local/state/ia-burn/claude-capture/direct"
  }
}`}</Code>
        </Step>
        <Step title="Déclarer le journal et le dossier de capture" location={collector}>
          <Code language="json">{`{
  "claudeLogs": [
    { "directory": "/Users/alice/.claude", "dataset": "personal" }
  ],
  "claudeCaptures": [
    { "directory": "/Users/alice/.local/state/ia-burn/claude-capture/direct", "dataset": "personal" }
  ]
}`}</Code>
          <p>Ajoutez les entrées aux listes déjà présentes. Ouvrez une nouvelle session Claude Code.</p>
        </Step>
      </ol>
    </details>

    <details id="setup-codex">
      <summary>3 · Codex en direct</summary>
      <Source>Les journaux <FilePath>sessions</FilePath> et <FilePath>archived_sessions</FilePath> du <code>CODEX_HOME</code> donnent les compteurs et le contexte journalisé. Ils peuvent aussi alimenter la chronologie si le dossier est monté en lecture seule dans Burn. Les hooks approuvés envoient les événements en direct. Le journal ne contient pas le corps complet de la requête.</Source>
      <ol className="setup-steps">
        <Step title="Déclarer la racine des journaux" location={collector}>
          <Code language="json">{`{
  "codexLogs": [
    { "directory": "/Users/alice/.codex", "dataset": "personal" }
  ]
}`}</Code>
        </Step>
        <Step title="Installer et approuver les hooks (facultatif)" location={<>Terminal → dépôt IA Burn. L’installateur ajoute les entrées dans <FilePath>~/.codex/hooks.json</FilePath>.</>}>
          <Code>node scripts/install-codex-monitor.mjs --dataset personal --apply</Code>
          <p>Pour une autre racine, ajoutez <SyntaxCode>--settings /chemin/du/profil/hooks.json</SyntaxCode>. Dans le CLI Codex ouvert avec ce profil, lancez <code>/hooks</code> et approuvez les commandes Burn. Gardez <code>features.hooks</code> activé.</p>
        </Step>
      </ol>
    </details>

    <details id="setup-opencode">
      <summary>4 · OpenCode 2 en direct</summary>
      <Source>La base <FilePath>opencode.db</FilePath> donne les compteurs des messages assistant terminés. Le plugin Burn envoie les événements et peut écrire un résumé des requêtes HTTP ou trames WebSocket sortantes. Burn affiche compteurs et contexte comme mesures distinctes.</Source>
      <ol className="setup-steps">
        <Step title="Installer le plugin Burn" location={<>Terminal → dépôt IA Burn. L’installateur ajoute une entrée à <FilePath>~/.config/opencode/opencode.json</FilePath> → <code>plugins</code>.</>}>
          <Code>node scripts/install-opencode-monitor.mjs --datasets personal --apply</Code>
          <p>Pour un autre profil, ajoutez <SyntaxCode>--config /chemin/du/profil/opencode.json</SyntaxCode>.</p>
        </Step>
        <Step title="Activer le résumé des requêtes" location={<>Profil OpenCode → <FilePath>opencode.json</FilePath> → <code>plugins</code> → entrée Burn → <code>options</code></>}>
          <p>Créez le dossier privé, puis ajoutez ces options à l’entrée installée. Gardez les options <code>datasets</code> et <code>url</code> déjà présentes et adaptez les identifiants des fournisseurs.</p>
          <Code>mkdir -p -m 700 ~/.local/state/ia-burn/opencode-capture</Code>
          <Code language="json">{`{
  "captureDirectory": "/Users/alice/.local/state/ia-burn/opencode-capture",
  "providers": { "personal": ["deepseek"], "enterprise": [] }
}`}</Code>
        </Step>
        <Step title="Déclarer la base, les fournisseurs et le dossier de capture" location={collector}>
          <Code language="json">{openCodeSources}</Code>
          <p>Utilisez le même dossier pour <code>openCodeCapture</code> et <code>captureDirectory</code>, puis rechargez OpenCode.</p>
        </Step>
      </ol>
    </details>

    <details id="setup-paperclip">
      <summary>5 · Paperclip · Configuration par agent</summary>
      <Source>Le harnais de l’agent produit les mesures. L’API locale de Paperclip sert à retrouver l’exécution et le ticket quand la session et l’horodatage donnent une correspondance unique.</Source>
      <h3>Claude Code local via ACP</h3>
      <Source>Le lanceur ci-dessous active la capture native de Claude Code pour l’agent. Burn lit ensuite les fichiers de requête et de réponse.</Source>
      <ol className="setup-steps">
        <Step title="Préparer le dossier de capture" location="Terminal du poste Paperclip">
          <Code>mkdir -p -m 700 ~/.local/state/ia-burn/claude-capture/paperclip</Code>
          <p>Le lanceur macOS utilise ce dossier, Node.js et le binaire <FilePath>~/.local/bin/claude</FilePath> du compte qui lance l’agent.</p>
        </Step>
        <Step title="Ajouter la variable à l’agent" location={paperclipVariables}>
          <p>Cliquez sur <strong>Add variable</strong>. Saisissez séparément le nom et la valeur, puis cliquez sur <strong>Save</strong>.</p>
          <dl className="setup-fields">
            <div><dt>Nom</dt><dd><code>CLAUDE_CODE_EXECUTABLE</code></dd></div>
            <div><dt>Valeur · chemin absolu</dt><dd><FilePath>/Users/alice/dev/ia-burn-dashboard/scripts/claude-paperclip-capture.mjs</FilePath></dd></div>
          </dl>
        </Step>
        <Step title="Déclarer la capture et l’API Paperclip" location={collector}>
          <p>Ajoutez l’entrée à la liste <code>claudeCaptures</code> et adaptez le port de l’API Paperclip.</p>
          <Code language="json">{`{
  "claudeCaptures": [
    {
      "directory": "/Users/alice/.local/state/ia-burn/claude-capture/paperclip",
      "dataset": "personal",
      "paperclip": true
    }
  ],
  "paperclip": "http://127.0.0.1:3100/api/"
}`}</Code>
          <p>Si plusieurs sociétés utilisent des datasets différents, ajoutez <code>paperclipDatasets</code> avec leur UUID comme clé et <code>personal</code> ou <code>enterprise</code> comme valeur.</p>
        </Step>
      </ol>

      <h3>Codex local</h3>
      <Source>Burn lit les compteurs et le contexte observable dans les journaux Codex de l’agent.</Source>
      <ol className="setup-steps">
        <Step title="Repérer le CODEX_HOME de l’agent" location={paperclipVariables}>
          <p>Si <code>CODEX_HOME</code> est renseigné, relevez sa valeur. Sinon, cherchez le dossier <FilePath>codex-home</FilePath> géré par Paperclip pour cet agent.</p>
        </Step>
        <Step title="Ajouter cette racine au collecteur" location={collector}>
          <Code language="json">{`{
  "codexLogs": [
    { "directory": "/Users/alice/.paperclip/instances/INSTANCE/companies/COMPANY/agents/AGENT/codex-home", "dataset": "personal" }
  ]
}`}</Code>
          <p>Remplacez les identifiants d’exemple par le chemin réel. Burn doit pouvoir lire les journaux de cette racine.</p>
        </Step>
      </ol>

      <h3>OpenCode local</h3>
      <Source>Burn lit les compteurs dans la base OpenCode de l’agent. Le plugin fournit les événements et le résumé des requêtes.</Source>
      <ol className="setup-steps">
        <Step title="Configurer le profil OpenCode 2 utilisé par l’agent" location={<>Paperclip → Agents → votre agent → <strong>Harness / Runtime</strong> pour vérifier le harnais. Pour le profil, vérifiez les chemins dans <strong>Secrets &amp; variables → Environment variables</strong>.</>}>
          <p>Appliquez la procédure <a href="#setup-opencode">OpenCode 2</a> à ce profil. Si l’agent définit <code>XDG_CONFIG_HOME</code>, ciblez son fichier <FilePath>opencode/opencode.json</FilePath> avec <SyntaxCode>--config</SyntaxCode>. Configurez le plugin dans le profil global chargé par l’agent.</p>
        </Step>
        <Step title="Pointer vers la base de l’agent" location={collector}>
          <p>Si l’agent définit <code>XDG_DATA_HOME</code>, prenez <FilePath>opencode/opencode.db</FilePath> sous ce dossier. Adaptez les fournisseurs au modèle de l’agent.</p>
          <Code language="json">{openCodeSources}</Code>
        </Step>
      </ol>
      <p className="help-note"><strong>Couverture vérifiée.</strong> Claude Code via ACP a été testé de bout en bout. Codex et OpenCode via Paperclip restent à valider. Pour OpenCode, seul le résumé du plugin passe par le rapprochement Paperclip. Gemini, Cursor, Pi, Grok, Kimi, Hermes, OpenClaw et les agents distants n’ont pas d’intégration dédiée au niveau 3.</p>
    </details>

    <details id="setup-retention">
      <summary>Que deviennent les journaux et captures ?</summary>
      <ul className="setup-retention">
        <li><strong>Captures brutes Claude Code.</strong> Burn supprime la paire requête/réponse après confirmation de l’import et sauvegarde de la progression. L’index <FilePath>index.jsonl</FilePath> reste sur disque. En cas de panne, les fichiers en attente restent disponibles pour une reprise. Les captures rejetées restent aussi sur disque.</li>
        <li><strong>Résumés OpenCode.</strong> Burn supprime chaque fichier de résumé après confirmation de l’import. Si l’envoi échoue, le fichier reste en attente.</li>
        <li><strong>Journaux d’origine et base OpenCode.</strong> Burn les lit. Leur conservation dépend du harnais qui les écrit.</li>
        <li><strong>Historique IA Burn.</strong> Les événements et mesures importés restent dans SQLite. Le niveau 3 n’applique aucune purge automatique à cet historique.</li>
      </ul>
    </details>

    <p className="setup-check"><strong>Vérifier la collecte.</strong> Lancez une courte session, puis ouvrez <strong>Monitoring → Sessions avec mesures</strong>. Dans le détail, vérifiez le harnais, le dataset et la provenance de la mesure.</p>
  </section>;
}
