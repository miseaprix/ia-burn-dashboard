# Collecte Monitoring — premier lot

Le récepteur local alimente **la SQLite de Burn**, dans le volume Docker existant.
Il ne lit pas la base du monitor historique et ne partage aucune base entre les
utilisateurs. Les premiers écrans Monitoring sont disponibles ; l’import des
données anciennes reste reporté à un lot ultérieur.

## Pipeline commun

```text
Claude Code / Codex / OpenCode
        → adaptateur de harnais
        → POST /api/monitor/events
        → transaction SQLite : événement + session + snapshot de tokens
```

L’identité d’une source est le triplet **harnais + environnement + machine**.
Les mêmes identifiants de session/événement peuvent exister sur deux machines,
dans Perso et Enterprise, ou sur deux harnais, sans fusionner leurs données.
Le fournisseur ou le nom du modèle ne sert pas à deviner l’environnement.

- Harnais : `claude`, `codex`, `opencode`.
- Environnement : `personal`, `enterprise`, `unclassified` (`accorgpt` reste accepté comme alias historique).
- Chaque adaptateur doit fournir un `event_id` stable pour les tentatives de renvoi.
- Les tokens sont des snapshots cumulatifs : dernier bilan final, sinon dernier
  provisoire. Les catégories absentes restent inconnues. Ils ne sont jamais
  additionnés aux agrégats de consommation déjà présents dans Burn.
- Les tables `monitor_sessions`, `monitor_events` et `monitor_usage` sont ajoutées
  par la migration 6 ; les tables existantes et leur historique restent conservés.

## Activation explicite

Dans `.env`, définir `MONITOR_INGEST_ENABLED=1`, puis lancer `./deploy.sh`.
La réception est **désactivée par défaut**. Aucun hook n’est installé ou redirigé
par le déploiement. Les routes Monitoring sont réservées à localhost, comme Admin.
Cette première version ne fournit pas de réception distante authentifiée.

### Contrat v1

```json
{
  "schema_version": 1,
  "event_id": "demo-event-1",
  "harness": "claude",
  "dataset": "personal",
  "machine_id": "demo-machine",
  "session_id": "demo-session",
  "type": "PostToolUse",
  "timestamp": "2026-10-11T10:00:00Z",
  "project": "demo-project",
  "ticket": "DEMO-1",
  "tool_name": "Read",
  "usage_snapshot": {
    "model": "demo-model",
    "usage": {
      "input_tokens": 100,
      "output_tokens": 20,
      "cache_creation_input_tokens": 0,
      "cache_read_input_tokens": 80
    }
  }
}
```

Types : `SessionStart`, `SessionEnd`, `PreToolUse`, `PostToolUse`,
`PostToolUseFailure`, `Stop`, `Notification`, `UserPromptSubmit`,
`SubagentStart`, `SubagentStop`, `Usage`. Un `Stop` peut fournir `final_usage`,
mais seul `SessionEnd` ferme la session. Les dates doivent préciser leur fuseau.

### Adaptateurs

`scripts/send-monitor-event.mjs` est un client commun Node 24+, lisant un événement
JSON sur stdin. Son appel doit définir explicitement `BURN_MONITOR_HARNESS` et
`BURN_MONITOR_DATASET`. `BURN_MONITOR_MACHINE` peut fournir une identité stable ;
le défaut est le hostname. `BURN_MONITOR_URL` pointe uniquement sur localhost
(défaut `http://localhost:4095/api/monitor/events` ; adapter au port installé).

Le client enlève les contenus bruts avant envoi et effectue au plus deux tentatives
avec le même ID. Une panne du récepteur ne fait pas échouer la commande du harnais.
Il n’y a pas encore de file d’attente persistante : un événement peut être perdu
si Burn est arrêté. `BURN_MONITOR_DEBUG=1` expose uniquement une erreur générique.

**Claude Code** : le payload enrichi de `send-to-monitor.ts` est accepté par
`POST /api/hook`. Il conserve les métadonnées et `usage_snapshot` / `final_usage`.
Sans environnement déclaré, les anciennes commandes sont classées
`unclassified`, jamais automatiquement Perso. L’ancien format n’a pas d’ID
stable : sa déduplication est au mieux par empreinte des métadonnées/snapshot.
Préférer le contrat v1 pour distinguer les événements identiques répétés.

Le client commun accepte aussi le JSON brut d’un hook Claude, mais **ne lit pas
le transcript** : sans enrichissement, les tokens restent inconnus.

### Collecteur natif Claude Code (Perso et Enterprise)

Le collecteur **distinct** `scripts/claude-monitor-hook.mjs` reçoit les événements
natifs selon le [contrat des hooks Claude Code](https://code.claude.com/docs/en/hooks).
Il conserve le vrai `session_id`, les IDs outil/agent et les noms MCP, skills,
commandes et scripts. Il détecte le projet depuis la racine Git (sinon le nom du
dossier courant), la branche et un ticket Jira lorsque la branche contient un
seul ticket distinct. Aucun prompt, contenu d’outil ou transcript n’est envoyé.
Il ne lit pas l’ancienne base de monitoring et ne modifie pas son script.

Depuis le clone Burn, avec **Node.js 24+ sur l’hôte** :

```bash
# Aperçu uniquement : aucune modification, aucun contenu de settings affiché.
node scripts/install-claude-monitor.mjs --dataset personal
node scripts/install-claude-monitor.mjs --dataset enterprise

# Ajouter les hooks Burn en conservant tous les réglages et hooks existants.
node scripts/install-claude-monitor.mjs --dataset personal --apply
node scripts/install-claude-monitor.mjs --dataset enterprise --apply
```

Les cibles par défaut sont `~/.claude/settings.json` et
`~/.claude-enterprise/settings.json`. Utiliser `--settings /chemin/settings.json` si le
lanceur emploie un autre dossier et `--url http://localhost:4090/api/monitor/events`
pour un autre port. **Le dataset est explicite**, pas déduit de la clé, du modèle
ou du dossier de projet. Installer chaque dataset dans le bon environnement.

L’installateur ajoute dix types d’événement, sauvegarde le fichier d’origine avec
des permissions privées et remplace atomiquement les réglages. Le répéter avec
les mêmes arguments ne crée pas de doublons. Une configuration Burn différente
déjà installée est refusée pour éviter deux collectes concurrentes. Les fichiers
de réglages liés symboliquement doivent être désignés par leur cible réelle.

**Conserver le clone Burn et le chemin Node** : les commandes installées utilisent
leurs chemins absolus. Démarrer une nouvelle session Claude Code pour charger les
hooks ; le récepteur Burn doit être activé. Pour désinstaller, enlever seulement
les entrées dont la commande contient `claude-monitor-hook.mjs`. Restaurer une
sauvegarde entière uniquement si aucun réglage n’a changé depuis.

Pour retirer uniquement les hooks Burn du dataset choisi, avec sauvegarde :

```bash
node scripts/install-claude-monitor.mjs --dataset personal --remove --apply
node scripts/install-claude-monitor.mjs --dataset enterprise --remove --apply
```

`--replace --apply` actualise les commandes Burn du même dataset (chemin Node,
clone ou port) sans modifier les autres hooks. 

Les variables `BURN_MONITOR_PROJECT`, `BURN_MONITOR_TICKET`,
`BURN_MONITOR_WORKFLOW` et `BURN_MONITOR_WORKFLOW_RUN_ID` permettent au lanceur de
transmettre un contexte explicite. Un événement enrichi peut aussi le fournir.
Les workflows ne sont pas déduits des prompts ou d’un ancien état partagé.
Les compteurs de tokens restent inconnus dans ce collecteur. Sans file persistante côté hook, une panne peut perdre un événement.

### Collecteur natif Codex

Le collecteur utilise les [hooks natifs Codex](https://learn.chatgpt.com/docs/hooks),
vérifiés sur `codex-cli 0.161.0` : sessions, appels d’outils/MCP, prompts (événement
seulement), agents, interruptions et compactage. Il ne lit pas les transcripts ;
les tokens et les détails absents du hook restent inconnus. Il n’analyse pas le
texte d’une réponse outil pour deviner son statut.

```bash
node scripts/install-codex-monitor.mjs --dataset personal --apply
node scripts/install-codex-monitor.mjs --dataset enterprise --apply
```

Cibles : `~/.codex/hooks.json` et `~/.codex-enterprise/hooks.json`. `--settings` et
`--url` permettent des surcharges ; `--replace` et `--remove` ont la même
sémantique de sauvegarde/retrait limité que Claude. Le `CODEX_HOME` du lanceur
doit correspondre à la cible. Les commandes n’émettent ni décision ni contexte
vers Codex, et respectent le timeout de trois secondes de SessionEnd.

**L’installation ne valide pas les hooks à votre place.** Dans chaque
environnement Codex, ouvrir `/hooks` **dans le CLI** et approuver les nouveaux hooks Burn ; ils
sont ignorés tant qu’ils ne sont pas approuvés. Garder `features.hooks` activé.
Toute modification de la commande peut demander une nouvelle validation. Aucun
flag de contournement ni règle de confiance gérée n’est installé. Une politique
administrateur peut empêcher la collecte locale.

### Plugin OpenCode 2

Le plugin suit l’[API OpenCode 2](https://opencode.ai/v2/docs/build/plugins),
vérifiée sur **2.0.25**. Il observe les opérations natives et le flux public des
nouveaux événements : outils, erreurs, shell, skills, sessions, sous-agents,
interruptions et snapshots cumulatifs de tokens disponibles. Il ne parcourt ni
les sessions historiques ni les messages/prompts. Il n’écrit jamais dans les
arguments, résultats ou décisions des hooks natifs.

```bash
node scripts/install-opencode-monitor.mjs --datasets personal,enterprise --apply
# Enterprise seulement
node scripts/install-opencode-monitor.mjs --datasets enterprise --apply
# Retirer uniquement le plugin Burn
node scripts/install-opencode-monitor.mjs --datasets '' --apply
```

Le plugin est référencé dans la clé `plugins` de la configuration globale
`~/.config/opencode/opencode.json` (surcharge `--config`). Les autres réglages,
fournisseurs et plugins restent conservés ; sauvegarde privée avant modification.
Seuls les documents JSON sont pris en charge par l’installateur : un fichier
JSONC doit être configuré manuellement pour préserver ses commentaires.
Conserver le clone Burn, puis **recharger OpenCode** lorsque le travail en cours
le permet. Le script ne redémarre pas son service automatiquement. La version 1
d’OpenCode n’est pas couverte par ce plugin.

La base OpenCode étant partagée, **le fournisseur réel de la session** distingue
les datasets : les identifiants listés dans `ENTERPRISE_OPENCODE_PROVIDERS` (aucun par défaut) pour Enterprise ; `openai`, `chatgpt`,
`anthropic`, `opencode`, `opencode-go`, `github-copilot`, `openrouter` pour Perso.
Un fournisseur inconnu ou déclaré dans les deux groupes est ignoré. Un mapping
personnalisé est possible dans les options du plugin :

```json
{
  "providers": {
    "personal": ["openai", "anthropic"],
    "enterprise": ["my-enterprise-provider"]
  }
}
```

Chaque instance ignore les événements des autres emplacements. Aucun replay
n’est demandé au flux public. Les snapshots restent provisoires, les caches ne
sont pas ajoutés une seconde fois ; les snapshots d’agents sont exclus du bilan
parent. Si un changement Perso/Enterprise est observé dans une même session, ses
nouveaux snapshots cumulatifs sont ignorés car ils ne peuvent pas être séparés.
Les agents/commandes/MCP ne sont identifiés que lorsque le harnais fournit leurs
métadonnées. Les workflows demandent toujours un contexte explicite.
Le format OpenCode sépare les tokens de raisonnement : ils sont inclus dans la
catégorie output du snapshot Burn lorsqu’ils sont connus ; sinon output reste
inconnu. Le total respecte les catégories natives, sans estimation de coût.

La collecte est non bloquante : erreurs isolées, 128 transmissions simultanées
maximum, contexte borné à 4096 sessions par instance. Un événement peut être
perdu lors d’une panne, d’un déchargement ou d’une saturation ; aucun spool natif
persistant n’est encore fourni.

## Consultation technique

- `GET /api/monitor?range=all&project=...&ticket=...&machine=...&source=...`
  retourne des sessions paginées (50), leur résumé et les filtres disponibles.
- `range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` filtre la date UTC de démarrage.
- `GET /api/monitor/session?source=...&id=...` retourne les métadonnées et les
  500 premiers événements, ainsi que le nombre total d’événements.

Les filtres et requêtes ne déclenchent aucune collecte. Prompts, réponses,
arguments/sorties d’outils, chemins de transcripts et payloads bruts ne sont pas
stockés. Les données de test sont fictives et créées dans des fichiers temporaires.
Les événements/session sont conservés sans purge automatique dans ce premier lot.

## Dimensions d’activité

Les événements conservent projet, branche, ticket Jira, tool/parent IDs, nom CLI,
serveur/outil MCP, nom de skill, agent/parent/modèle et nom/ID de run de workflow.
La machine sert à qualifier l’identité, pas à produire un indicateur utilisateur
principal. Scripts et commandes Bash gardent seulement le nom de l’exécutable
et du script, sans arguments, secrets ou corps de script. Les commandes shell
complexes non reconnues restent non identifiées.

`GET /api/monitor` fournit aussi `metrics` : événements par type, outils, MCP,
CLI, commandes, scripts, skills, workflows et agents. Les paires Pre/Post d’un
même `tool_use_id` comptent **une invocation**, avec son état terminé/en échec.
Les événements sans cet ID sont signalés dans la couverture, sans inventer
leur appariement. Les runs de workflow sont distincts par ID de run ; les agents
sont identifiés par ID d’agent ou lien vers le parent. Les observations sans
identité suffisante sont signalées séparément. Les bilans de tokens restent
ceux des sessions : aucun coût par outil n’est attribué sans mesure explicite.

Un bilan attaché à un agent identifié ou à un événement Subagent reste dans
les métadonnées de cet événement avec `usageScope=agent` ; il ne remplace pas
le bilan de la session parente. Les coûts/tokens parent et enfant ne sont pas
additionnés sans établir leur couverture respective.

## Réception d’échanges API (compatibilité)

`POST /api/monitor/requests` accepte encore des échanges API version 1 (métadonnées
et compteurs `usage`, sans prompts ni réponses), stockés dans `monitor_requests`
(migration additive **7**, clé machine + request_id, renvoi idempotent).
`GET /api/monitor/requests` les expose paginés par 50. Aucun émetteur n’est fourni
par ce dépôt ; ce point d’entrée est conservé pour la compatibilité. Même protection
localhost et activation `MONITOR_INGEST_ENABLED=1` que les événements de hooks.

## Découverte et activation dans l’interface

Monitoring reste accessible dans la navigation. Sans événement ni échange,
la page présente un aperçu explicitement illustratif, les bénéfices du niveau 3
et les étapes de configuration. Le récepteur activé sans données est distingué
de la configuration manquante. Dès la première réception, la vue affiche les
compteurs observés et les dernières sessions/requêtes ; elle se relit chaque
minute lorsque l’onglet est visible. Les aperçus ne contiennent aucune métrique
fictive présentée comme réelle. Admin et Help expliquent les niveaux 1/2/3.

Les boutons conduisent à Admin et au guide. Ils ne modifient pas automatiquement
les montages de journaux ni les hooks. Les niveaux 2 et 3 demandent encore les
réglages du déploiement et des harnais décrits dans ces guides.
