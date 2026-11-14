# Passation — ORBES Trips (carte de voyage ORBES)

> Prompt à coller en début de nouvelle session Claude Code, ouverte dans `~/orbesmap`.
> État au 14 novembre 2026. Voyage à Shanghai du 24 au 29 novembre 2026.

---

## 1. Qui, quoi, règles permanentes

Tu reprends le projet d'**Eliot** : **ORBES Trips**, l'app de carnet de voyage de la marque ORBES (theorbes.com).
Il l'utilise sur iPhone. Son père (Bertrand, « Papa » dans l'app) l'utilise sur un **Samsung Galaxy Z Fold**.

**Règles à respecter, sans exception :**
- **Langue** : réponds en **français**, simple, court et décidé. Les heures sont à l'**heure de Paris**.
- **`main` = production.** Ne pousse et ne fusionne jamais sur `main` sans un « go » explicite d'Eliot pour ce changement précis.
  - Un « go » ne vaut que pour le lot qu'il concerne.
  - « déploie en autonomie » valait pour un lot passé, pas pour la suite.
- **Branche de travail** : `refonte`. Sur `main`, on publie par avance rapide : `git checkout main && git merge --ff-only refonte && git push origin main && git push origin refonte && git checkout refonte`.
- **Méthode** : montre le plan avant un gros changement. On **ajoute, on ne dégrade jamais**. Ne supprime rien qu'il n'a pas demandé.
- **Dossiers interdits** : ne touche pas à `~/Documents/orbes map` ni à `~/orbes-index`.
- **Fournisseurs** : leurs noms sont publics, c'est sa décision. N'en reparle pas.
- **Build** : il doit rester **un seul fichier autonome** `dist/index.html`, pour theorbes.com/maps.
  - Les autres fichiers de `dist/` (sw.js, manifest, icons) ne servent que sur orbesmap.vercel.app.
- **Ne commite jamais** les e-mails des membres.
- **Secrets** : ne demande jamais un secret ni un mot de passe. Eliot colle lui-même les clés dans Vercel ou Supabase.
- **Goûts** :
  - premium, minimal, niveau SaaS haut de gamme ;
  - palette « vault » : fond `#0a0a0a`, ivoire `#f6f2ea`, gris doux `#a7a29a`, filet `rgba(246,242,234,.14)` ;
  - police **Gravesend Sans 500**, pas de Bodoni ;
  - outils en haut ;
  - refonte design v3 prévue **après** Shanghai.
- **Relectures** : après chaque fonctionnalité, Eliot apprécie une relecture adversariale par plusieurs agents (Workflow), puis les corrections.

## 2. Adresses et déploiement

- **Dépôt** : `github.com/eliotrapatel/orbesmap`, local `~/orbesmap`.
- **Production** : un push sur `main` déploie **orbesmap.vercel.app** (Vercel, environ 1 min) et **theorbes.com/maps**, qui sert le même build.
- **État actuel** : `main` = `refonte` = **`2e952c6`**, déployé et vérifié. Rien n'est en attente de commit en dehors de ce fichier.
- **Adresse d'installation recommandée** : **orbesmap.vercel.app**, ajoutée à l'écran d'accueil.
  - C'est une vraie PWA : manifest, icônes, service worker `public/sw.js`, ouverture sans réseau.
  - theorbes.com/maps n'ouvre pas sans réseau et ne s'installe pas sur Android.
- **Service worker** : il sert d'abord la copie locale puis met à jour en arrière-plan. **Une nouvelle version n'apparaît qu'à la 2e ouverture.**
- **Commandes** :
  - `npm run dev` (Vite) ;
  - `npm run build` (= `tsc --noEmit && tsc -p tsconfig.api.json && vite build`).
  - Le serveur de dev est configuré dans `.claude/launch.json` sous le nom « orbesmap-dev » (port 5178).

## 3. Stack et architecture

React 19, TypeScript 5.9, Vite 8 avec vite-plugin-singlefile, MapLibre 6.17.

- **Fonds de carte** : OpenFreeMap (style `dark`), via un protocole `ofm://` et la Cache API (hors ligne).
- **Synchronisation** : Supabase.
- **IA** : une fonction Vercel `api/ai.ts`.

**Fichiers clés :**
- `src/App.tsx` : mise en page, état principal, feuille liste mobile (crans peek/half/full).
- `src/lib/store.ts` : données par appareil plus Supabase.
  - File d'envoi hors connexion (pastille « Envoi (n)… »), synchro en direct.
  - Fusion champ par champ via la RPC `upsert_place_state`.
  - Enregistrements préfixés `_check:`, `_info:insurance`, `_pin:<id>`.
  - Journal IA sous trip_id `_ai_usage`.
- `src/lib/sheetDrag.ts` : **moteur de glisser des feuilles mobiles**.
  - Uniquement par transform. Crans choisis selon la vitesse, effet ressort, glisser possible depuis le contenu.
  - Utilisé par `useSheetDrag` (`src/components/ui.tsx`) pour les fiches lieu, épingles et outils, et par la liste dans App.
  - Contrat CSS : la feuille fait toute la hauteur et descend de `translateY(100% - var(--drag-h, var(--sheet-h)))`.
- `src/lib/offline.ts` : carte hors ligne.
  - `cachedFetch` : tuiles immuables servies d'abord depuis le cache, avec un délai max de 10 s. Le style et l'index de tuiles restent servis depuis le cache, et un nouveau style n'est gardé qu'avec ses icônes.
  - `tilesFor` : monde en z0–3, région en z4–6, environ 45 km autour de chaque lieu en z7–9, environ 12 km en z10–12, environ 2,5 km en z13–14.
  - `prepareOffline` / `verifyOffline` / `deleteOffline`. Environ 474 éléments, environ 57 Mo stockés pour SHA 2026.
- `src/lib/locate.ts`, `src/lib/route.ts` : position en direct, boussole, itinéraires OSRM (FOSSGIS) à pied et en voiture.
- `src/lib/ai.ts`, `src/lib/placeSearch.ts`, `src/lib/carnet.ts` : client IA, « Ajouter un lieu », contexte de « Demander au carnet » (lecture seule).
- `src/components/` :
  - `TopBar`, `Landing` (écran d'entrée : chaque ligne tient sur une ligne, textes `data-fit` réduits automatiquement) ;
  - `PlaceDetail`, `PinDetail`, `Tools` (Phrases, Convertisseur, Vols, Infos avec la carte hors ligne, Export) ;
  - `Agenda`, `Ask`, `Translate`, `Emergency`, `Checklist`, `Account` avec `AiCredit` ;
  - `AddPlace`, `Nav` ;
  - `OrbitMark` (le logo).
- `src/data/trips/` : `sha2026.ts` (généré par `research/sha2026/to-trip.mjs` depuis `research/sha2026/program.json`), `sha2026-extra.ts` (horaires et urgences vérifiés), `sha2026-checklist.ts`, `gz2026*.ts`, `index.ts`.
- `api/ai.ts` : fonction Vercel réservée aux membres (JWT Supabase + `is_member`).
  - Variable Vercel `DEEPSEEK_API_KEY` : DeepSeek `deepseek-flash` par défaut (JSON, Search/Fetch).
  - Variable Vercel `ANTHROPIC_API_KEY` : Claude `claude-opus-5-5` en secours ; `AI_PROVIDER=claude` le force.
  - Tâches : photo, interpret, place, ask, balance.
- `public/` : `sw.js` (orbes-shell-v2), `manifest.webmanifest` (nom « ORBES Trips »), `icons/` (icône Orbite ; références suffixées `?v=2`).
- `index.html` : écran de chargement noir avec le logo orbite en data URI, méta PWA.
- `supabase/schema.sql`, `README.md` : installation Supabase et IA.

**Supabase** :
- Projet `ifugaqjneprbtigvegeb`. La clé publique est dans `src/lib/supabase.ts`.
- Connexion par **e-mail + mot de passe**. Les utilisateurs sont créés par Eliot dans le dashboard (Auto Confirm), car l'envoi d'e-mails par défaut est limité.
- Membres dans `public.members` : Eliot et son père.

## 4. Fonctionnalités en place

- **Deux voyages** : SHA 2026 (Shanghai, sous-titre « Voyage », 68 lieux, 24–29 nov.) et GZ 2026 (Guangzhou, terminé).
- **Vols** : AF116 lun. 23/11 23:20 CDG, arrivée PVG mar. 24/11 19:00 ; AF111 dim. 29/11 22:15.
- **Lieux retirés à sa demande** : Hermès, Shang Xia, House of Rong.
- **Carte et programme** :
  - carte avec marqueurs par jour, liste, fiches lieu ;
  - horaires et alerte « fermé » ;
  - statut, notes **par personne** (`note_<auteur>`, l'ancienne `note` reste affichée comme « Note commune ») ;
  - photos, contacts.
- **Outils** : Aperçu, Agenda, Demander au carnet (IA en lecture seule), Traduire (photo et interprète), Urgence (numéros, consulat, hôpitaux, assurance), Phrases, Devises, Check-list partagée, Vols, Infos (avec la carte hors ligne), Export (PDF, calendrier), Compte (synchro, crédit IA DeepSeek et historique).
- **Ajouter un lieu** : depuis un lien, un texte libre, des suggestions ou une capture d'écran, avec détection des doublons.
- **Navigation** : position en direct et guidage à pied ou en voiture. Geste « retour » qui ferme la fiche ou l'outil ouvert. Feuilles glissables.

## 5. Identité visuelle (dernières décisions)

- **Logo de l'app et icône = « Orbite »** : le O de Gravesend avec un anneau incliné et un point.
  - Composant `OrbitMark.tsx`, dessiné avec des masques, donc propre sur n'importe quel fond.
  - Icônes générées à partir de `scratchpad/logos2/appicon` ; à refaire au besoin en SVG 1024 → PNG. La version Android adaptative est réduite à 80 %.
- **Lockup texte retenu** (pas encore utilisé dans l'app) : « Classique », soit ORBES à l'espacement exact du site (**0,62 em** ; la barre de navigation du site utilise 0,46 em) avec **TRIPS** dessous (0,30× la taille, gris `#a7a29a`).
- **Canevas des logos** (planches, anciennes propositions, icône choisie) : https://claude.ai/artifact/DGvnmpDhvCXGLJZvFifNoE
- **Écran du Z Fold à vérifier** à chaque changement d'interface : 344 px de large (plié) et environ 700 px (déplié).

## 6. Ce qui a été fait les derniers jours (10–14 nov.)

- `6d2022f` : app installable (manifest, icônes, écran de démarrage noir).
- `7a7aa4d` : icône Orbite, nom « ORBES Trips ».
- `10bf606` :
  - glisser des feuilles réécrit (suit le doigt, élan, ressort ; 9 corrections de relecture : encoche iPhone, pause avant de lâcher, deux doigts, animation d'ouverture, rotation) ;
  - logo orbite à la place du mot ORBES (barre, accueil, chargement) ;
  - accueil sur une ligne ;
  - « Voyage » ;
  - affichage vérifié sur le Z Fold.
- `2e952c6` : audit régressions et hors ligne, 6 corrections.
  - Un lieu lointain ne fait plus exploser le téléchargement (9 249 morceaux de carte ramenés à 712).
  - Délai de 10 s sur une tuile absente.
  - Nouveau style gardé seulement avec ses icônes.
  - Relief inutilisé retiré (−10 Mo).
  - Hauteur des fiches cohérente dans le navigateur.
  - Liste correcte sur écran très bas.
  - Téléchargement complet testé : « Complète, 474 éléments ».

## 7. À faire côté Eliot (lui rappeler si besoin)

- Sur les deux téléphones :
  1. ouvrir l'app deux fois ;
  2. Infos → Carte hors ligne → **Mettre à jour** (en Wi-Fi) ;
  3. **Vérifier**.
- Réinstaller l'icône pour voir la nouvelle : supprimer l'app de l'écran d'accueil, puis la rajouter depuis orbesmap.vercel.app.
- Installation sur le Z Fold : Chrome, orbesmap.vercel.app, menu ⋮, « Ajouter à l'écran d'accueil / Installer », puis se connecter dans Compte.
- Confirmer au doigt sur de vrais téléphones que le glisser est fluide. Le navigateur de test fige les animations, donc ça n'a pas pu être vu.
- La clé DeepSeek n'a jamais été testée avec de vrais appels par Eliot.

## 8. Pistes en attente (rien de commencé)

- **Recommandations UX restantes** :
  - ouvrir directement la carte du jour pendant le voyage ;
  - error boundary ;
  - bouton Hôtel ;
  - écran allumé pendant le guidage ;
  - outils ordonnés selon la phase du voyage ;
  - prochain arrêt en tête de liste ;
  - champs à 16 px partout ;
  - cibles tactiles de 44 px ;
  - contraste en plein soleil ;
  - check-list « téléphone prêt » ;
  - messages éphémères.
- **Accès depuis la Chine** : analyse mise de côté à sa demande, dans `research/china-access-2026-11.md`.
  - `*.vercel.app` et la plage IP de theorbes.com sont probablement bloqués ; Supabase est intermittent.
  - Pistes : eSIM/roaming, sous-domaine `carnet.theorbes.com`, VPN, proxy VPS seulement si les tests échouent.
- **Lockup « Classique »** (ORBES + TRIPS) : pas encore intégré, par exemple sur l'écran de lancement.
- **Refonte design v3** : après Shanghai.

## 9. Limites connues

- **Sans réseau** : l'app entière ne s'ouvre que sur orbesmap.vercel.app installée. Le relais IA est sur vercel.app, peut-être bloqué en Chine sans eSIM ou VPN.
- **Safari** : il peut effacer les données d'un site non ouvert pendant 7 jours. Les données restent dans Supabase.
- **Hors ligne, pas disponibles** : les itinéraires jamais calculés (l'app affiche une estimation) et l'IA.

## 10. Astuces de vérification (pièges déjà rencontrés)

- **Navigateur intégré** : il fige les animations et transitions (currentTime à 0).
  - Avant une capture, injecte `*{animation:none!important;transition:none!important}`.
  - Teste les gestes par événements synthétiques (`Touch`/`TouchEvent`, `PointerEvent`) en vérifiant `--drag-h` / `--sheet-h`.
- **Chrome headless** : il ne descend pas sous environ 500 px de large. Pour 344 ou 390 px, utilise l'émulation de taille du navigateur intégré.
- **Mode dev** : les erreurs « Rendered more hooks » qui apparaissent après un rechargement à chaud sont des artefacts. Vérifie toujours après un rechargement complet.
- **Après un déploiement** : recharge deux fois (service worker) avant de conclure que la nouvelle version est en ligne.
- **Mémoire persistante** : `~/.claude/projects/-Users-eliotrapatel-orbesmap/memory/`. Lis `MEMORY.md` et `project-orbes-map.md` au démarrage.

**Pour démarrer** : lis ce fichier, `README.md` et `git log --oneline -15`, puis demande à Eliot ce qu'il veut faire. Ne pousse rien sur `main` sans son « go ».
