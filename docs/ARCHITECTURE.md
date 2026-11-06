# Organisation et actualisation

## Modules

Le dépôt contient deux packages npm avec leurs lockfiles indépendants. Le
`package.json` racine orchestre `install:all`, `test`, `build`, `check`, `start`
et `dev:frontend`. Le Dockerfile reste multi-stage : frontend Vite compilé,
API Fastify et assets statiques servis par un seul processus Node 24.

| Dossier | Responsabilité |
| --- | --- |
| `backend/src/domain` | Quotas, coûts, périodes, agrégations et contrat de réponse |
| `backend/src/integrations` | Lecture des logs et des caches natifs, transports HTTP et fournisseurs |
| `backend/src/storage` | SQLite versionné, transactions, requêtes et cache des fichiers |
| `backend/src/config` | Configuration corporate et identité des datasets |
| `backend/src/services` | Collecteurs autonomes et composition des dashboards à partir du stockage |
| `backend/src/routes` | Validation des paramètres et exposition HTTP |
| `backend/src/app.js` | Construction Fastify, assets statiques et hooks de cycle de vie |
| `backend/src/server.js` | Écoute HTTP, SIGINT/SIGTERM et fermeture propre |
| `frontend/src/hooks` | Chargement, annulation, actualisation et visibilité |
| `frontend/src/components` | Affichage et interaction |

Les notes de conception, de reprise et d’étude restent locales et sont exclues
de Git et du contexte Docker. Le suivi du travail est conservé dans le ticket.
L'intégration Claude Code Monitor et SSE restent une deuxième phase.

## Collecte autonome

La collecte commence au démarrage du serveur, même sans navigateur. Chaque source
possède sa boucle et une seule tâche en cours ; les erreurs gardent les dernières
données et appliquent une temporisation progressive bornée à 15 minutes. Les
contraintes supplémentaires des API personnelles (cache, 429) restent appliquées.

| Variable | Défaut |
| --- | --- |
| `LOCAL_COLLECT_MS` | 60 000 ms |
| `QUOTA_COLLECT_MS` | 60 000 ms |
| `CORPORATE_COLLECT_MS` | 300 000 ms |

Les durées sont des délais après la fin d'un cycle, pas une garantie temps réel.
La valeur minimale configurable est 1 000 ms. Corporate réconcilie les 30 derniers
jours et relève le budget du mois courant. Aucun service extérieur de scheduling
n'est nécessaire ; l'image et le processus restent uniques.

SQLite schéma 4 ajoute `collection_state` et conserve le nombre exact de tokens sans tarif par modèle : dernière tentative, dernière réussite,
prochaine tentative, erreur générique et dernier résultat normalisé. Cette migration
préserve les données et caches existants. Aucun token, prompt ou réponse HTTP brute
n'est ajouté au stockage. Les observations de quotas restent dans leurs JSON
persistants (8 jours) ; les agrégats de consommation n'expirent pas.

`GET /api/collection/status` expose la santé des trois collecteurs. Une réussite de
collecte n'est pas une garantie de fraîcheur fournisseur : les quotas gardent leur
`observedAt`, provenance et statut périmé. À l'arrêt, les timers sont annulés, les
tâches en cours sont attendues puis SQLite est fermé. Compose laisse 30 secondes.

## Consultation et périodes

`GET /api/dashboard?source=local|enterprise|enterprise-local&range=...` consulte SQLite ; il ne lance
aucune ingestion ni appel fournisseur. `GET /api/history/yearly` reste une lecture
indexée. Les métriques locales conservent le coût connu et sa couverture.

`range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD` définit des bornes inclusives fixes.
Les dates impossibles, inversées ou futures renvoient HTTP 400. Les sélections
relatives (`week`, `month`, `today`, etc.) sont résolues dans le fuseau du backend.
`week` inclut aujourd'hui et les six jours précédents. Les changements de jour
utilisent le calendrier local, y compris les changements d'heure.

Les réponses ajoutent `refresh`, `collection` et `coverage`. La couverture décrit
les jours observés ; elle ne prétend pas que toutes les journées demandées sont
complètes. Les cartes de quotas actuels et la surface live sont masquées pour les
périodes entièrement passées. Le budget corporate courant n'est pas affiché comme
un budget historique.

Les détails modèle corporate collectés portent actuellement sur la fenêtre de
30 jours. Ils ne sont affichés que pour cette même fenêtre ; leur attribution à
une autre période n'est pas inventée. La consommation historique corporate dépend
des jours déjà retournés par le fournisseur. Un import rétroactif explicite avec
pagination, les modèles corporate par jour et les faits horaires/session restent
à développer ; la consultation d'une période ne tente pas cet import.

## Actualisation du navigateur

- Chargement immédiat à chaque nouvelle source ou sélection de dates.
- Toutes les 60 secondes lorsque la période inclut aujourd'hui.
- Pas de polling des périodes fixes entièrement passées.
- Les périodes relatives sont recalculées au prochain minuit fourni par le serveur,
  même si elles sont historiques (`yesterday`).
- Onglet masqué : timers suspendus ; au retour, actualisation si live, données
  absentes ou frontière de calendrier franchie.
- Une seule requête en cours ; les requêtes d'une ancienne sélection sont annulées.
- Une erreur conserve la dernière réponse de la même sélection avec un avertissement.
- Refresh relit les métriques collectées ; il ne contourne pas les cadences fournisseur.

La barre d'état indique la dernière collecte de consommation et le mode Live ou
Historical. Les données sont cohérentes avec le stockage au moment de lecture ;
le suivi n'est pas du temps réel strict. Aucun historique n'est collecté lorsque
la machine ou le conteneur est arrêté ; les logs disponibles sont repris au démarrage,
mais les lectures de quota manquées ne sont pas toujours reconstructibles.

## Price catalogs

The local collector calls `integrations/pricing-catalog.js` before aggregation.
It restores validated LiteLLM/models.dev snapshots from SQLite, refreshes only
when due (six hours by default), and retains each source independently on failure.
`domain/pricing.js` normalizes units and resolves rates. The local parser retains
pricing counters separately from reported costs, allowing each collection to
revalue unchanged/deleted logs. No browser request triggers catalog retrieval.
`/api/pricing/status` exposes refresh health. Historical API-equivalent estimates
use current catalog prices; date-effective tariff versioning is a future extension.


### Detailed personal metrics (schema 5)

Daily aggregates retain nullable `token_costs` components and `image_count`.
Schema 5 is additive. A versioned Codex parsed-log cache allows existing files to
be reparsed once for image call IDs; removed legacy files retain their token
history while image coverage stays unknown. No image output is retained.
`usageDetails` derives the rolling 30-day cost mix, chart rows and observed image
calls independently of the dashboard period. Existing `usageEconomics` supplies
plan/value and current-cycle quota estimates. The UI explicitly labels these
windows and unavailable allocations; reported totals are never redistributed
arbitrarily among token types.

## Monitoring — schéma 6

Le récepteur optionnel `routes/monitor.js` normalise les événements via
`domain/monitor-event.js`, puis `services/monitor-ingest.js` écrit sessions,
événements et snapshots dans une transaction. Ces données sont séparées des
agrégats de consommation. Voir [le contrat de collecte](MONITORING.md).

### Échanges API (schema 7, compatibilité)

`POST /api/monitor/requests` normalise une liste autorisée de métadonnées et de
compteurs via `services/proxy-ingest.js`. Les échanges individuels sont dans
`monitor_requests`, identifiés par machine + requête, séparément des snapshots
de session et des agrégats de dépenses. Aucun émetteur n’est fourni par ce dépôt ;
un renvoi ne crée pas de doublon.
