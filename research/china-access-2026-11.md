# Accès à l'app depuis la Chine — analyse du 10/11/2026 (mise de côté)

On ne peut pas garantir « zéro problème » en Chine, mais on peut s'en approcher pour très peu d'argent. Il faut trois couches. D'abord, des données mobiles qui sortent hors de Chine sur les deux iPhone (forfait français en itinérance ou eSIM de voyage) : le pare-feu ne s'applique plus, et l'app marche comme en France. Ensuite, un sous-domaine à toi (carnet.theorbes.com) sur le projet orbesmap. Il corrige les deux blocages sûrs, vercel.app et Nominatim, pour le Wi-Fi de l'hôtel, et le VPN sert de secours sur ce Wi-Fi. Enfin, l'app préparée hors ligne avant le départ. Le petit serveur proxy (VPS) est optionnel : il ne vaut le coup que si les tests depuis la Chine montrent que Supabase passe mal.

## Dépendances

- **Page via theorbes.com/maps (Vercel, autre projet)** — Instable. Le nom est sain (DNS testé le 10/11), mais il pointe sur 216.198.79.1, vérifié aujourd'hui. Cette plage d'IP est signalée injoignable chez China Mobile depuis le 23/09/2026 : 92 nœuds sur 92 en échec. Chez Telecom et Unicom, on voit seulement quelques échecs. Vercel n'a pas répondu. Correction d'un rapport : l'apex est un enregistrement A, pas un CNAME.
  - Impact : Si ça bloque, l'app ne s'ouvre pas du tout. Il n'y a aucun service worker sur ce domaine (main.tsx:10 ne l'active que sur .vercel.app), et must-revalidate oblige à joindre le serveur. À ne pas utiliser comme adresse principale en Chine.
- **orbesmap.vercel.app (page + service worker)** — Bloqué. Mesure du 10/11 : le DNS chinois renvoie des IP Twitter ou Dropbox, signe d'empoisonnement. GreatFire bloque tout *.vercel.app depuis 2021. Vercel le reconnaît dans son guide de septembre 2026.
  - Impact : L'app s'ouvre seulement depuis le cache du service worker, après 6 s d'attente à chaque ouverture (stratégie « réseau d'abord »). Aucune mise à jour possible. Il faut que l'app ait été ouverte avant le départ.
- **Relais IA /api/ai (DeepSeek côté serveur)** — Bloqué partout, y compris depuis theorbes.com : src/lib/ai.ts:7 appelle toujours https://orbesmap.vercel.app/api/ai. DeepSeek lui-même est accessible, mais c'est sans objet : le téléphone ne lui parle jamais directement.
  - Impact : Traduction photo, interprète, Ajouter un lieu et Demander au carnet tombent en panne sur le Wi-Fi de l'hôtel. Défaut possible : si le jeton ne se renouvelle pas faute de réseau, l'app affiche « Connectez-vous » au lieu de « réseau » (plausible, non testé).
- **Supabase ifugaqjneprbtigvegeb.supabase.co (connexion, base, temps réel, photos)** — Intermittent. Le DNS est sain (Cloudflare). GreatFire classe 26 URL *.supabase.co sur 35 comme intermittentes. Contradiction entre les rapports : l'un dit « intermittent », l'autre « inconnu ». Aucun rapport chinois précis sur le temps réel. Des blocages réels ont visé supabase.co ailleurs (Inde, Émirats, Indonésie).
  - Impact : La première connexion en Chine est risquée. La synchro avec papa est lente ou en retard, le websocket décroche, et les photos de l'autre téléphone (URL signées valables 12 h) ne s'affichent pas hors ligne. Bonne nouvelle : les données restent d'abord sur le téléphone, avec une file d'envoi qui réessaie toutes les 20 s, donc rien n'est perdu.
- **Tuiles OpenFreeMap** — Intermittent. DNS sain (Cloudflare), mais GreatFire voit 4 URL perturbées sur 7.
  - Impact : Faible si « Préparer hors ligne » est fait (cache sans expiration). Limites : pas de zoom 15 et plus, et un lieu ajouté sur place n'a pas ses tuiles détaillées.
- **Géocodage nominatim.openstreetmap.org** — Bloqué. DNS empoisonné, mesuré le 10/11. GreatFire le classe bloqué, mais sur un seul test récent.
  - Impact : Dans « Ajouter un lieu », la position par nom échoue. Il faut placer l'épingle à la main.
- **Itinéraires routing.openstreetmap.de** — Inconnu. DNS sain, mais serveur unique en Allemagne, sans CDN : lent aux heures de pointe.
  - Impact : Faible : l'app se rabat sur une estimation à vol d'oiseau après 7 s. Le cache (40 entrées, 7 jours) est trop court pour un pré-chargement.
- **Météo Open-Meteo** — Accessible selon GreatFire (test du 07/11). DNS sain.
  - Impact : Quasi nul : 16 jours de prévisions en cache, et l'app affiche la dernière copie même périmée.
- **Taux api.frankfurter.dev** — Inconnu (Cloudflare, DNS sain).
  - Impact : Nul : cache de 6 h, puis repli sur le taux enregistré.
- **Liens sortants Google Maps et wa.me** — Bloqués sans itinérance ni VPN. Amap (uri.amap.com) fonctionne.
  - Impact : Faible : l'app propose déjà Amap, avec conversion GCJ-02.

## Options (classées)

### 1. Données mobiles qui sortent hors de Chine (itinérance française ou eSIM de voyage)

Sur chaque iPhone, utiliser pour la data soit le forfait français en itinérance (Free 5G+ : 35 Go en Chine ; Free Max : illimité ; pass voyage chez Orange, SFR ou Bouygues), soit une eSIM de voyage (Holafly 10 jours ≈ 34 €, Airalo 10 Go ≈ 26,50 $). Le trafic sort par la France, Hong Kong ou Singapour, donc le pare-feu ne s'applique pas.

- Résout : Presque tout, sur données mobiles : vercel.app, IA, Nominatim, Supabase et son temps réel, Google, WhatsApp. Couvre le métro et le TGV. Sert aussi de solution de repli sur le Wi-Fi de l'hôtel : on coupe le Wi-Fi.
- Coût : 0 € si Free 5G+ ou Max est déjà en place. Sinon 25 à 35 € par personne pour la semaine. · Effort : 30 min par téléphone, sans code.
- Risques : Les fournisseurs d'eSIM ne publient pas leur passerelle : le routage est affirmé par des blogs souvent affiliés. Une eSIM en « local breakout » ne contourne rien. Free en Chine : un comparatif (mezabo) dit « Non », à vérifier sur mobile.free.fr. Hors forfait ruineux : 9,70 €/Mo chez Free au-delà du quota, 13 à 15 €/Mo ailleurs sans pass. Le partage de connexion d'un iPhone à l'autre est contradictoire selon les sources (limitation TTL, plafond Holafly) : chacun doit avoir son propre forfait. Latence de 150 à 300 ms : le temps réel marche, avec un léger retard.
- Étapes :
  - Vérifier l'opérateur réel d'Eliot et celui de son père, et si la Chine est incluse dans le forfait (espace abonné).
  - Si Free : passer sur Free Max pour novembre (sans engagement), ou vérifier que les 35 Go suffisent. Sinon, acheter une eSIM d'au moins 10 Go ou illimitée.
  - Installer l'eSIM en France sur un Wi-Fi, la laisser inactive, activer « Itinérance des données » sur cette ligne.
  - Réglages > Données cellulaires : choisir la ligne voyage et couper « Autoriser le changement de données cellulaires ». Couper l'itinérance de la ligne française si une eSIM tierce est utilisée.
  - Garder la ligne française active pour recevoir les SMS (banque).

### 2. Sous-domaine carnet.theorbes.com sur le projet orbesmap (page, service worker, IA et géocodage sous un seul nom propre)

Ajouter carnet.theorbes.com au projet Vercel orbesmap, avec un A chez Amen vers 76.76.21.21, l'ancienne IP Vercel que les tests itdog voient joignable. Petites modifications de code : IA en relatif (/api/ai) sur ce domaine, ce domaine ajouté aux ORIGINS de api/ai.ts, géocodage Nominatim passé par le relais Vercel, service worker activé sur ce domaine.

- Résout : Les deux blocages sûrs sur le Wi-Fi chinois : *.vercel.app, qui fait tomber l'IA et le service worker, et Nominatim. Évite aussi la plage 216.198.79.x de theorbes.com. C'est la recommandation officielle de Vercel : un domaine perso.
- Coût : 0 €. · Effort : DNS : 30 min. Code : environ 2 h avec moi, sur la branche refonte. Pas de push sur main sans ton « go ».
- Risques : Vercel ne garantit rien en Chine. 76.76.21.21 est l'IP « historique » : elle marche encore et reste documentée, mais Vercel conseille la valeur affichée dans le projet, et un modérateur déconseille de choisir son IP à la main. Un filtrage par IP reste possible. L'astuce cname-china.vercel-dns.com n'apparaît plus dans la doc de 2026 : ne pas s'y fier. Données séparées par domaine : session, données locales, file d'envoi et carte hors ligne sont à refaire sur cette adresse.
- Étapes :
  - Vercel > projet orbesmap > Domains : ajouter carnet.theorbes.com.
  - Amen : créer un A pour carnet vers 76.76.21.21 (ne pas toucher l'apex theorbes.com). Attendre que Vercel valide le domaine et son certificat HTTPS.
  - Code : dans ai.ts, ENDPOINT relatif sauf sur theorbes.com ; dans api/ai.ts, ajouter carnet.theorbes.com aux ORIGINS ; nouvelle action de géocodage dans le relais à la place de l'appel direct de placeSearch.ts:83 (User-Agent correct, 1 requête/s) ; dans main.tsx, enregistrer le service worker sur carnet.theorbes.com.
  - Tester carnet.theorbes.com avec itdog.cn et boce.com (HTTP, nœuds Mobile, Telecom et Unicom).

### 3. Préparation hors ligne des deux iPhone sur UNE seule adresse + service worker « cache d'abord »

Passer sw.js en « cache d'abord, mise à jour en arrière-plan » : l'app s'ouvre tout de suite au lieu d'attendre 6 s. Ensuite, sur chaque iPhone : ajouter carnet.theorbes.com à l'écran d'accueil, se connecter dans l'app installée, lancer Préparer hors ligne (Shanghai et Suzhou), vérifier que la file d'envoi est vide.

- Résout : L'app s'ouvre et reste utilisable même si tout le réseau tombe : carte, programme, notes, phrases, check-list. Supprime le risque d'une première connexion Supabase en Chine.
- Coût : 0 €. · Effort : 1 h de code, puis 20 min par téléphone.
- Risques : L'app de l'écran d'accueil a son propre stockage, distinct de Safari : il faut se connecter et préparer la carte DANS l'app installée. Une session Supabase très ancienne peut devoir se renouveler : se connecter le plus tard possible avant le départ. Des modifications non envoyées depuis theorbes.com ne partent pas depuis carnet.
- Étapes :
  - Code : sw.js en cache d'abord, avec un toast « nouvelle version » quand la page a changé.
  - Le 20 ou 21/11, en Wi-Fi : écran d'accueil, connexion, Préparer hors ligne, file vide, navigator.storage.persisted() à vrai.
  - Test en mode avion à la maison : l'app s'ouvre, la carte s'affiche, une note se met en file d'envoi.

### 4. VPN iPhone pour le Wi-Fi (Proton VPN Stealth + Windscribe gratuit en secours)

Deux VPN indépendants installés et testés en France. Proton VPN en protocole Stealth (serveurs Tokyo ou Taïwan, Alternative Routing activé). Windscribe gratuit en Stealth ou WStunnel (serveur HK) en secours.

- Résout : Le Wi-Fi filtré de l'hôtel, si l'on veut économiser les données mobiles ou si l'itinérance faiblit.
- Coût : Environ 10 € (Proton, remboursable sous 30 jours). Windscribe est gratuit (10 Go). · Effort : 30 min.
- Risques : Taux de réussite mesurés : 82 à 90 %, jamais 100 %. Contradiction sur Astrill : 100 % chez Top10VPN, 60 % dans un test indépendant, et Stealth peut-être absent sur iOS. À éviter : NordVPN, Surfshark, ExpressVPN, LetsVPN (a cessé de servir la Chine). Les apps VPN sont introuvables sur l'App Store chinois : tout installer avant de partir. Valider le portail Wi-Fi de l'hôtel avant d'allumer le VPN. Légalité floue, mais tolérée pour les touristes.
- Étapes :
  - Installer Proton VPN et Windscribe sur les deux iPhone, créer les comptes et noter les codes de récupération hors ligne.
  - Tester le mode Stealth de chacun en France.
  - Ne jamais désinstaller son seul VPN une fois en Chine.

### 5. Fiabilisation de l'app face à un réseau « en ligne mais filtré »

navigator.onLine reste vrai sur un Wi-Fi filtré. À faire : afficher « en attente » au lieu d'« erreur » dans store.ts quand l'envoi échoue ; délais croissants pour la file d'envoi (20 s, 1 min, 5 min) ; texte envoyé avant les photos ; corriger le faux « Connectez-vous » d'ai.ts ; petite pastille de connexion réelle ; pré-chargement des itinéraires du programme (cache plus long que 40 entrées et 7 jours) ; photos de papa copiées sur l'appareil.

- Résout : Le confort et la batterie quand le réseau rame. Ne règle aucun blocage, mais évite les messages trompeurs et les chargements sans fin.
- Coût : 0 €. · Effort : 6 à 10 h en tout. Le plus utile en 2 h : « en attente » au lieu d'« erreur », faux « Connectez-vous », texte avant photos.
- Risques : Plus de code juste avant un voyage, donc plus de risque de régression. À tester en mode avion et en réseau ralenti avant le 20/11. Ce n'est pas indispensable si les couches 1 à 4 sont en place.
- Étapes :
  - Corriger le faux « Connectez-vous » d'ai.ts et passer l'état à « en attente » dans store.ts.
  - Envoyer le texte avant les photos et ajouter des délais croissants dans la file d'envoi.
  - Si le temps le permet : pré-charger les itinéraires du programme et copier les photos sur l'appareil.

### 6. Petit serveur proxy (VPS Caddy à Tokyo, Singapour ou Hong Kong) + bascule automatique

Un VPS 1 vCPU sous Caddy sur cn.theorbes.com (page, /api, tuiles, géocodage) et sb.theorbes.com (Supabase, websockets compris, en-tête Host réécrit). HTTP/3 désactivé. Facturation à l'heure (Vultr ou Linode), à détruire après le voyage. Module net.ts côté app : accès direct d'abord, proxy en cas d'échec.

- Résout : Un blocage soudain de supabase.co ou de Cloudflare sur le Wi-Fi chinois, quand ni l'itinérance ni le VPN ne sont disponibles.
- Coût : Environ 5 $ pour le voyage (de 3,5 à 6 $/mois). · Effort : Serveur : 3 à 5 h. Bascule dans l'app : 4 à 6 h.
- Risques : Point unique de panne. Son IP peut être bloquée sans préavis. Les liaisons HK et Japon saturent le soir, et Alibaba comme Tencent avouent latence et pertes vers la Chine continentale. Vercel déconseille de mettre un proxy devant un déploiement. Basculer Supabase à chaud casse le temps réel : choisir la base au démarrage. Peu de gain si Supabase passe déjà : à décider seulement après les tests itdog.
- Étapes :
  - Ne lancer que si les tests itdog et boce du 14-15/11 montrent Supabase ou OpenFreeMap en échec fréquent.
  - Créer le VPS, installer Caddy et créer les deux A chez Amen.
  - Code net.ts + VITE_SUPABASE_URL alternative ; ajouter cn.theorbes.com aux ORIGINS.

### 7. Cloudflare Worker gratuit en proxy (déconseillé)

Même idée que le VPS, mais dans un Worker Cloudflare, sur un domaine à toi.

- Résout : Peu de chose : Supabase, OpenFreeMap et Frankfurter passent DÉJÀ par Cloudflare, et leurs noms sont sains. Le chemin réseau resterait le même.
- Coût : 0 €, ou environ 10 €/an pour un domaine séparé. · Effort : 2 à 4 h.
- Risques : Contradiction entre les rapports : l'un le recommande en premier, l'autre ne lui trouve aucun gain. Je retiens le second. *.workers.dev est bloqué ou instable, donc il faut un domaine sur Cloudflare : déplacer les DNS de theorbes.com (risque pour le site et les e-mails) ou acheter un domaine à part. Pas de nœud en Chine sans contrat Enterprise. Écartés aussi : CDN chinois et Cloudflare China Network (licence ICP impossible avant le 23/11), domaine perso Supabase (environ 35 $/mois pour aucun gain).
- Étapes :
  - Ne pas faire, sauf si le VPS est impossible.

## Plan proposé

- 10-11/11 (Eliot, 30 min) : vérifier les deux forfaits mobiles. Si Free, passer sur Free Max pour novembre. Sinon, acheter deux eSIM d'au moins 10 Go ou illimitées (Holafly 10 jours ou Airalo). Lever le doute « Free inclut-il la Chine ? » directement sur mobile.free.fr.
- 11/11 (Eliot, 30 min) : installer Proton VPN (Stealth) et Windscribe sur les deux iPhone, tester en France, noter les identifiants hors ligne.
- 11-12/11 (Eliot + moi, 30 min) : Vercel > orbesmap > Domains, ajouter carnet.theorbes.com ; chez Amen, A carnet vers 76.76.21.21. Ne pas toucher l'apex theorbes.com, qui porte le site principal.
- 12-14/11 (moi, sur la branche refonte, 3 à 4 h) : IA en relatif sur carnet ; ORIGINS mis à jour ; géocodage via le relais ; service worker actif sur carnet en « cache d'abord » ; faux « Connectez-vous » corrigé ; « en attente » au lieu d'« erreur ». Mise en production seulement après ton « go ».
- 14-15/11 : tester avec itdog.cn et boce.com (HTTP, nœuds China Mobile, Telecom et Unicom) carnet.theorbes.com, theorbes.com, ifugaqjneprbtigvegeb.supabase.co, tiles.openfreemap.org, routing.openstreetmap.de, api.open-meteo.com. Garder les captures.
- 15/11, décision : si Supabase ou les tuiles échouent souvent, monter le VPS Caddy (Tokyo ou HK, facturé à l'heure) et la bascule automatique. Sinon, ne pas le faire.
- 16-19/11, si le temps le permet : texte avant photos, délais croissants de la file d'envoi, pré-chargement des itinéraires du programme, photos de papa copiées sur l'appareil.
- 20-21/11 (Eliot, 20 min par téléphone, en Wi-Fi) : ajouter carnet.theorbes.com à l'écran d'accueil, se connecter DANS l'app installée, Préparer hors ligne (Shanghai et Suzhou), vérifier la file vide, puis tester en mode avion.
- 22/11 : refaire le test itdog, mettre à jour l'app une dernière fois, installer et vérifier les eSIM (ligne voyage choisie, itinérance activée sur cette ligne).
- Sur place, règle simple : données mobiles par défaut. Wi-Fi de l'hôtel seulement avec le VPN. Si ça rame, couper le Wi-Fi d'abord. Utiliser Amap pour la navigation.
- Points restés incertains, à surveiller : routage réel de l'eSIM choisie ; Supabase depuis la Chine (aucune mesure directe) ; tenue de 76.76.21.21 dans le temps ; FAI du Wi-Fi du Renaissance Caohejing (si c'est China Mobile, theorbes.com/maps est probablement injoignable) ; partage de connexion entre les deux iPhone (sources contradictoires).

## Sources

- /Users/eliotrapatel/orbesmap/src/lib/ai.ts (ligne 7 : relais IA toujours sur orbesmap.vercel.app hors .vercel.app)
- /Users/eliotrapatel/orbesmap/src/main.tsx (ligne 10 : service worker seulement sur .vercel.app)
- /Users/eliotrapatel/orbesmap/api/ai.ts (ligne 12 : ORIGINS)
- /Users/eliotrapatel/orbesmap/src/lib/placeSearch.ts (ligne 83 : Nominatim direct)
- /Users/eliotrapatel/orbesmap/public/sw.js
- /Users/eliotrapatel/orbesmap/src/lib/store.ts
- /Users/eliotrapatel/orbesmap/src/lib/offline.ts
- dig theorbes.com A = 216.198.79.1 (vérifié le 10/11/2026) ; dig via 114.114.114.114 et 180.76.76.76 : vercel.app, openstreetmap.org et nominatim empoisonnés
- https://vercel.com/kb/guide/accessing-vercel-hosted-sites-from-mainland-china
- https://community.vercel.com/t/issue-216-198-79-0-24-unreachable-from-china-mobile-cmcc-as9808/49600
- https://community.vercel.com/t/www-tzxstar-cn-intermittent-connection-failures-anycast-ip-216-198-79-65-resets-tls-sni/49924
- https://vercel.com/kb/guide/use-domain-vercel-a-records
- https://en.greatfire.org/vercel.app
- https://en.greatfire.org/supabase.co
- https://en.greatfire.org/openfreemap.org
- https://en.greatfire.org/nominatim.openstreetmap.org
- https://en.greatfire.org/open-meteo.com
- https://en.greatfire.org/deepseek.com
- https://supabase.com/blog/navigating-regional-network-blocks
- https://supabase.com/pricing
- https://webkit.org/blog/14403/updates-to-storage-policy/
- https://mobile.free.fr/fiche-forfait-free
- https://www.bonjourchine.com/voyage-chine/vivre-en-chine/forfait-mobile-en-chine/
- https://greatfirewallguide.com/esims
- https://simology.io/blog/china-esim-travel-guide-great-firewall-vpn-connectivity-2026
- https://support.apple.com/109317
- https://www.top10vpn.com/best-vpn/china/
- https://vpnoverview.com/vpn-reviews/astrill-vpn/
- https://www.alibabacloud.com/help/en/simple-application-server/latest/region-and-network-connectivity
- https://developers.cloudflare.com/china-network/reference/available-products
- https://circumvention-corpus.pages.dev/findings/2025-zohaib-quic-sni__gfw-decrypts-quic-initials-at-scale/
