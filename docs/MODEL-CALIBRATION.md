# Catalogue, tests directs et simulateur de contexte

La page **Contexte et coût** est disponible sans niveau d’intégration ni clé. Elle
reprend les vrais composants du dashboard et la comparaison A/B : contexte lourd
ou ciblé, effort envisagé, tours, lecture/écriture de cache, entrée non cachée et
sortie facturée. Les tarifs du modèle choisi sont affichés en lecture seule, en USD par million de tokens ; les prix
manquants restent inconnus. L’effort n’est jamais converti en multiplicateur.
Les catégories sont disjointes et les thinking tokens déjà inclus dans output ne
sont pas comptés deux fois. Les volumes sont des moyennes par tour, pas un modèle
automatique d’accumulation du contexte ni une garantie de qualité.

Un **tour** représente un appel au modèle, avec contexte envoyé et réponse produite.
Une demande utilisateur peut déclencher plusieurs tours via les outils de l’agent.
La légende de chaque scénario explique les catégories et affiche leurs tokens totaux,
leur tarif et leur coût estimé (tokens ÷ 1 000 000 × tarif). Le sélecteur de modèle
est identifié à droite du titre ; les volumes et la durée du cache restent ajustables.

Une jauge animée compare le coût total de chaque scénario à une journée de
budget Enterprise : budget mensuel configuré dans Admin ÷ jours ouvrés (20 par
défaut, ajustables dans le simulateur). Avec 300 USD/mois, le repère est 15 USD/jour.
Ce repère suppose que le scénario représente l’usage d’une journée. Le budget
mensuel se modifie uniquement dans Admin ; un chargement absent reste inconnu. Elle est verte sous 80 %, orange de 80 à 100 % et rouge au-delà.
Les coûts inconnus ne sont pas évalués. Cet indicateur ne mesure ni la qualité
ni l’utilité de la réponse ; l’animation respecte la préférence de mouvement réduit.

Référence publique Anthropic Opus5.5 datée du 12octobre2026 : input4, output20,
cache read0.2, cache write5m5, cache write1h8USD/MTok. Source :
https://platform.claude.com/docs/en/build-with-claude/prompt-caching .
Les métadonnées déclarées Enterprise sont une autre source sélectionnable ; les
prix des deux sources ne sont pas fusionnés silencieusement. Une lecture cache
moins chère ne rend pas le cache gratuit. L’expiration et les seuils d’éligibilité
au cache dépendent du modèle et de son fournisseur.

## Actualisation à la demande dans Admin

1. Configurer sa propre clé API Enterprise dans Admin.
2. **Actualiser les modèles et tarifs** : GET directs /v1/models et /model/info,
   sans génération ni proxy. Tous les identifiants, y compris audio/image/embedding,
   sont répertoriés ; seuls les modèles texte avec tarifs et limite de sortie
   non ambigus sont éligibles au pilote payant. Une erreur conserve le catalogue.
3. Sélectionner jusqu’à cinq modèles, fixer un budget0.01–1USD et confirmer la
   suspension des autres usages du même compte. L’endpoint user/daily/activity
   agrège par utilisateur ; une clé dédiée seule ne suffit pas à isoler le coût.
4. **Lancer les tests payants sélectionnés** : référence sans effort explicite,
   low/high lorsque le paramètre reasoning_effort est déclaré par tous les
   déploiements. Même prompt arithmétique synthétique, limite de sortie configurable (5120 tokens proposés, raisonnement inclus), un appel à
   la fois, maximum15appels. La campagne utilise directement HTTPS vers Enterprise,
   /v1/chat/completions ; aucun passage par le proxy local.
5. Avant et après CHAQUE appel : lecture paginée de user/daily/activity, contrôles
   des requêtes/tokens/spend bruts ; attente de delta puis deux relevés stables,
   toutes les10s, pendant120s, avec jusqu’à20s supplémentaires si la première mise à jour arrive au dernier relevé. Changement de date, API incomplète, erreur,
   réponse tronquée, délai ou consommation concurrente arrêtent la campagne.

Le budget est un **seuil d’arrêt avec réserve estimée**, pas une limite stricte
imposée à la passerelle. Les tokens d’entrée réservés sont512 ; la sortie est
bornée. Une facturation tardive, un tarif erroné ou des usages concurrents peuvent
faire dépasser le seuil. Un timeout de génération n’est jamais repris : son coût
est incertain. Le bouton Arrêter annule l’attente/l’appel local mais ne garantit
pas l’annulation d’une requête déjà reçue par le fournisseur.

## Résultats et limites

Résultats séparés des tarifs : identifiant de campagne, modèle, effort demandé,
HTTP, durée, usage numérique, delta de requêtes/tokens global et par modèle facturé, coût constaté, estimation,
écart et présence de la réponse attendue. Aucun prompt utilisateur, sortie complète,
clé API ou paramètres de connexion sauvegardés. SQLite conserve le catalogue,
le dernier résultat et les campagnes, dans le volume existant, isolés par clé.
Pas de migration des anciennes métriques ni de suppression de volume.

Une concordance coût entrée/sortie (tolérance absolue1microUSD) est annotée sur le
modèle ; elle ne valide pas les tarifs de cache, l’application de l’effort ni la
qualité générale. On ne déduit pas de nouveaux tarifs unitaires d’un unique coût
agrégé. Les essais courts ne remplacent pas une campagne statistique répétée sur
contexte/cache/qualité. Audio, images et embeddings requièrent des fixtures et des
unités de facturation spécifiques : leur catalogue est actualisé, leurs tests
payants ne sont pas exécutés par ce pilote texte.

Aucun test payant ne démarre au lancement du serveur, au changement de modèle ou
à l’ouverture des pages. Après redémarrage, une campagne interrompue n’est pas
rejouée. Les routes de lancement, catalogue et statut sont réservées à localhost,
avec contrôle d’origine. Les réglages de clé sont verrouillés pendant une campagne.
Dans la démo statique, les actions Admin sont purement simulées en mémoire.

## Script relançable

```bash
node scripts/calibrate-models.mjs --catalog
node scripts/calibrate-models.mjs --models claude-sonnet-5-5,gpt-5.4 --max-tokens 5120 --budget 0.20 --confirm-isolation
node scripts/calibrate-models.mjs --status
node scripts/calibrate-models.mjs --stop
```

`--url http://localhost:PORT` adapte le port. Le script pilote l’API Admin locale ;
il ne reçoit et ne transmet aucune clé. Les scripts et le protocole sont livrés
avec Burn, les résultats de compte restent privés dans SQLite.

## Matrice globale dans Admin

La matrice modèles × effort consolide les derniers essais de toutes les campagnes
du compte actif. Elle affiche les tokens, estimation, coût mesuré, état et date
pour défaut/low/medium/high. Les cellules non testées restent « À tester » ; les
modalités ou paramètres incompatibles sont « Non applicable ». Un delta contaminé
ne s’affiche jamais comme coût mesuré du modèle. Les cellules sont des résultats
de scénario, pas des tarifs fixes par effort. Aucun chiffre réel n’est exporté
vers la démo statique, qui dispose de sa propre matrice fictive.

Pour remplir la matrice séquentiellement depuis le script, sans refaire les cellules
déjà mesurées ni les générations dont la facturation reste incertaine :

```bash
node scripts/calibrate-matrix.mjs --dry-run
node scripts/calibrate-matrix.mjs --max-tokens 5120 --budget 0.50 --confirm-isolation
```

Le script parcourt défaut/low/medium/high éligibles, un seul appel par campagne,
additionne les deltas observés et s’arrête dès qu’un résultat n’est pas confirmé.
`--force` permet de refaire les mesures ; il ne doit pas servir à relancer une
requête dont la facturation est incertaine. Ctrl-C demande l’arrêt au serveur.
Aucun appel payant n’est effectué par `--dry-run`.


## Budget et représentativité

Deux campagnes répondent à des questions différentes :

- **Pilote de facturation** : le runner utilise une tâche arithmétique et
  une limite de sortie configurable (5120 proposée). Le pilote initial de256tokens
  était trop limité pour le raisonnement Claude. Une enveloppe initiale de 0,50–1 USD permet de démarrer
  les contrôles de compatibilité et de rapprochement. Elle ne mesure pas la
  qualité générale ni un coût universel par effort. Une sortie tronquée invalide
  l'essai ; on ne la relance pas automatiquement.
- **Comparaison effort/coût/qualité** : prévoir une enveloppe initiale de **10 USD**,
  puis décider d'une extension jusqu'à **20 USD** après examen des résultats.
  Ce sont des enveloppes proposées, pas des prix garantis ni des seuils donnant
  automatiquement une significativité statistique.

La seconde campagne reste à implémenter : sélectionner quelques modèles
représentatifs, au moins trois tâches synthétiques vérifiables (calcul, code,
raisonnement), plusieurs efforts compatibles et trois à cinq répétitions par
couple tâche/effort. Varier l'ordre, laisser une sortie suffisante pour éviter
la censure par la limite, relever qualité, durée, tokens et coût. Les scénarios
cache froid/chaud et contexte court/long doivent être séparés et contrôlés.
Ne pas regrouper arbitrairement des alias ou des modèles facturés différents.

Estimer le budget depuis les tarifs du catalogue et les volumes retenus avant
le lancement ; réserver une marge et examiner la dispersion avant d'augmenter
le nombre de répétitions. Le runner actuel reste volontairement limité à
1 USD : augmenter seulement son plafond ne crée pas ce protocole comparatif.
Chaque appel nécessite encore le rapprochement du ledger et la suspension des
usages concurrents du même compte Enterprise.


## Diagnostic des refus liés au raisonnement

Le pilote initial de 256 tokens a été refusé par Haiku avec effort low : la
passerelle exige `max_tokens > thinking.budget_tokens`. Ce refus n'indique pas
une absence de support de l'effort. Pour les anciens modèles Claude, LiteLLM
traduit low/medium/high en budgets de raisonnement de 1024/2048/4096 tokens :
https://docs.litellm.ai/docs/providers/anthropic . Les modèles adaptatifs peuvent
suivre une autre traduction ; les réglages réels de la passerelle font autorité.

Admin et les scripts proposent désormais **5120 tokens**, configurables de64à8192
via l'API ou `--max-tokens`. Cette limite comprend le raisonnement et la réponse,
ce n'est pas une consommation imposée. Le budget d'arrêt reste inchangé ; la
réserve est recalculée avec la limite choisie, donc une enveloppe de0.50USD ne
promet pas de terminer toutes les cellules. Le runner affecte à chaque appel le
budget global restant, sans ancien sous-plafond implicite de0.05USD.

Le résultat conserve la limite utilisée : comparer des mesures faites avec des
limites différentes demande de vérifier l'absence de troncature. La matrice
n'aplatit pas ces mesures en prix par effort. L'erreur de limite est classée sans
conserver le message fournisseur brut, qui peut contenir du routage interne.


## Indisponibilité du relevé et reprise sûre

Seules les lectures GET de `user/daily/activity` peuvent être retentées,
jusqu'à trois tentatives par page, avec attente progressive : HTTP429/5xx,
timeout et erreur réseau. Un Retry-After compatible avec une attente maximale de
10secondes est respecté ; un délai supérieur interrompt le contrôle au lieu de
réessayer trop tôt. Une erreur401/403, une structure ou des métriques incomplètes
restent bloquantes. **Aucune génération POST n'est retentée automatiquement.**

En cas d'échec, Admin affiche le code de diagnostic, le statutHTTP lorsqu'il est
connu, le nombre de tentatives et l'étape. Aucun message fournisseur brut ou secret
n'est enregistré. Le relevé numérique d'avant l'appel et l'intention de génération
sont désormais conservés dans SQLite avant l'envoi, pour permettre un rapprochement
en lecture seule depuis Admin, y compris après interruption réseau.

Le runner de matrice exclut les cellules non confirmées, contaminées ou encore en
attente, même avec `--force`. Ce paramètre peut refaire une mesure confirmée ; il
ne débloque pas une génération incertaine. Un refus API n'est rejouable que si
les relevés ont confirmé explicitement zérocoût et zérotoken. Le dry-run liste
les cellules bloquées ; elles nécessitent une investigation distincte.

Pour les anciennes campagnes qui n'enregistraient ni le détail d'échec ni le
relevé d'avant l'appel, les seuls compteurs actuels ne suffisent pas à certifier
rétrospectivement le coût d'une génération interrompue. La cellule reste non
confirmée ; les autres essais non tentés peuvent être repris séparément.
Les mesures de compte restent privées et hors Git.


## Navigation Admin, filtres et comparaison

Les panneaux d'intégration, catalogue/campagne, matrice et configuration sont
repliables sans perdre les saisies. Les badges des niveaux indiquent leur
configuration ; ils ne prouvent pas que chaque collecteur est actuellement en ligne.

Catalogue et matrice proposent des filtres combinables par nom, gamme et type
(texte/code, image, vidéo, audio, embeddings). Une capacité absente donne une vue
vide ; elle n'est pas ajoutée artificiellement au catalogue. Les tests payants
restent réservés aux modèles texte/code éligibles. La sélection reste visible et
conservée même si un filtre masque temporairement un modèle sélectionné.

Les gammes Économique/Équilibré/Avancé sont des catégories éditoriales de familles,
pas des scores d'intelligence : petites variantes/Haiku/Flash, familles
intermédiaires/Sonnet, puis grandes variantes/Opus. Les familles sans règle connue
restent Non classé, de même que les modalités non textuelles. Le coût et un unique
scénario arithmétique ne suffisent pas pour mesurer la qualité générale.

La matrice peut regrouper par gamme ; les en-têtes trient les lignes en ordre
croissant/décroissant (au sein des groupes quand ils sont actifs). Les colonnes
Entrée/Sortie sont indépendantes ; les valeurs absentes et coûts non validés
restent en fin de tri. Le menu Ordre des colonnes déplace les colonnes ou rétablit
l'ordre initial. Ces préférences restent locales à la vue et ne modifient ni les
campagnes, ni les tarifs, ni les résultats conservés dans SQLite.


## Rapprocher une facturation tardive sans refaire l'appel

Une réponse HTTP200 peut précéder la mise à jour de `user/daily/activity`.
Un relevé encore inchangé ne prouve donc pas que l'appel est gratuit ou non facturé.
La campagne garde ce coût inconnu et s'arrête au terme du délai borné.

**Vérifier le relevé**, dans la dernière campagne ou sur une ligne non confirmée
de la matrice, lance uniquement des GET, sans génération. Burn relit deux fois
le jour du relevé initial, même si la date courante a changé. Il vérifie la stabilité
complète des compteurs, le delta d'une seule requête, les tokens rapportés, un seul
modèle facturé et la concordance de son coût avec le delta global. Sans ces preuves,
la mesure reste inconnue ou non isolée. La sortie doit être complète et une baseline
conservée doit exister. Les anciennes campagnes sans baseline ne sont pas recréées.

Le rapprochement est isolé par clé, réservé à localhost et sérialisé avec les
campagnes : impossible de lancer des générations ou de changer la clé pendant
la vérification. Il conserve la date de l'essai et ajoute la date du rapprochement ;
il n'annote pas comme actuels des tarifs qui auraient changé depuis l'appel.
API : POST `/api/admin/calibration/reconcile` avec `{"runId":"UUID"}`, réponse202
puis suivi du statut habituel. Ce POST local ne déclenche aucun appel LLM.

La lecture initiale des prochaines générations attend au maximum120secondes,
plus20secondes pour stabiliser une mise à jour arrivée au dernier relevé, hors
latence réseau et retries bornés. Le runner autorise sixminutes par campagne avant
annulation ; il ne relance jamais une génération dont le coût reste incertain.

## Modèle annoncé mais appel refusé (HTTP 404)

La présence dans /v1/models et /model/info ne garantit pas la disponibilité
du déploiement. Un 404 de génération est conservé comme erreur API explicite,
sans texte d’erreur fournisseur, sans prix validé et sans nouvelle génération.
Même avec un relevé stable prouvant zéro coût, la reprise automatique exclut
le modèle concerné, y compris avec --force, et peut traiter les autres modèles.
Un contrôle explicite de disponibilité côté passerelle est nécessaire avant
de retester ce modèle manuellement dans Admin. Les causes possibles (route,
déploiement ou fournisseur) ne sont pas déduites du seul code HTTP.

## Référence datée livrée avec Burn

Le fichier backend/data/model-calibration-reference.json est un **exemple fictif**
(4 modèles génériques, 8 mesures, prix inventés) à **remplacer par l’export de
votre propre passerelle** (voir plus bas). Il ne décrit aucun catalogue réel.
Il est livré dans l’image Docker et sert de référence dès la première installation,
sans clé, sans requête à la passerelle et sans import de données personnelles en
SQLite. Les mesures incertaines, contaminées et erreurs ne sont pas exportées.

La matrice distingue « Référence partagée » et « Mesure locale ». Une tentative
locale a priorité pour sa cellule, même si elle n’est pas confirmée ; elle ne peut
pas être présentée comme validée grâce à un ancien résultat partagé. Les tarifs
déclarés du snapshot restent datés et distincts des coûts réellement mesurés.
Aucune extrapolation en tarif universel d’effort ou de qualité n’est permise.
Il faut actualiser le catalogue vivant après configuration de la clé avant de
lancer une nouvelle campagne payante. Les campagnes manuelles permettent de
vérifier à nouveau les cellules de référence ; le runner complet utilise --force
pour refaire les mesures déjà validées, en conservant ses exclusions de sécurité.

Pour publier une nouvelle référence, une fois les tests terminés :
node scripts/export-calibration-reference.mjs --url http://localhost:4095
Puis relire le diff JSON et le versionner explicitement avec sa date. L’export
est limité aux identifiants de modèles, capacités/paramètres déclarés, tarifs,
date du test, effort, limite de sortie, tokens et coûts validés. Il exclut clés,
scopes de compte, runId/responseId, billingBefore, billedModels, prompts/réponses
personnels et journaux. Le protocole correspond au prompt arithmétique synthétique
fixe utilisé par Burn. La démo statique utilise ce même snapshot pour le catalogue et la matrice. Les
volumes du simulateur sont des hypothèses ajustables, les coûts de la matrice
sont des mesures datées ; les autres vues de consommation restent fictives.
La démo ne génère aucun appel réel et ne fabrique pas de nouveaux résultats.
