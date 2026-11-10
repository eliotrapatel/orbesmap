import json, os
D = os.path.dirname(os.path.abspath(__file__))
V = []
for p in ["partA.json", "partB.json", "partC.json"]:
    V += json.load(open(os.path.join(D, p), encoding="utf-8"))
ids = [p["id"] for p in V]
dups = {i for i in ids if ids.count(i) > 1}
assert not dups, dups
for p in V:
    p["lat"] = round(p["lat"], 5); p["lng"] = round(p["lng"], 5)
json.dump(V, open(os.path.join(D, "places-verified.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
BY = {p["id"]: p for p in V}

TYPES = {"bijoux","mode","fabricant","salon","lifestyle","bar","hotel","packaging","textile","landmark","restaurant","mall","cashmere","concept","luxe","montres","cuir","musee","galerie","jardin","design","tech","cafe","club","transport"}
TYPE_OVR = {"upper-house-shanghai": "restaurant", "bulgari-hotel-shanghai": "bar"}

# (id, day, time, tip override or None)
PLAN = [
 ("renaissance-caohejing", "base", "Check-in sam. 21 vers 21h30 · départ pour PVG dim. 29 à 18h30", None),
 ("pvg-t1", "d1", "Atterrissage 19h00 (AF116) · retour : comptoir AF111 vers 19h30 le 29", None),

 # d2 dimanche : Xuhui d'automne + West Bund
 ("shanghai-botanical-garden", "d2", "8h30–10h45", "Premier matin, idéal pour digérer le décalage avec ton père : DiDi de 15 min jusqu'à la porte n°1, file au jardin des érables (槭树园) puis au musée du penjing. Demande le plan à l'accueil."),
 ("longhua-temple", "d2", "11h–12h45 (déjeuner végétarien au temple)", "Déjeune au restaurant végétarien du temple (nouilles, plats simples, petit prix). Puis DiDi de 10 min vers le West Bund."),
 ("westbund-central", "d2", "13h15–13h50", "Commence le West Bund par ici (ligne 11, Longyao Road). Regarde les montures 3D Issey Miyake Eyes : bonne référence pour ton travail en titane. Songmont a aussi une boutique dans le centre."),
 ("westbund-pompidou", "d2", "14h–15h45", "Réserve sur le mini-programme WeChat « 上海西岸美术馆预约 » avec ton passeport (le dimanche est chargé). En sortant, traverse le parc de TANK puis remonte la berge vers le nord : ginkgos et platanes dorés."),
 ("long-museum-westbund", "d2", "16h–17h15", "Fermeture tôt en novembre : arrive avant 16h15. Ressors sur la berge pour le coucher du soleil (vers 16h50). Vérifie l'expo sur le WeChat « 龙美术馆 »."),
 ("old-jesse", "d2", "Dîner 18h30", "Premier dîner shanghaïen, à 15 min de l'hôtel. Fais réserver par la conciergerie du Renaissance et demande le crabe chevelu (pleine saison). Soirée courte : tu récupères du vol."),

 # d3 lundi : musées fermés -> Nanjing Xi Lu, luxe, montres, robotique ; soirée Suzhou Creek
 ("southbund-fabric", "d3", "Lun. 23 9h–10h30 (commande) · jeu. 26 essayage · sam. 28 retrait", "Commande le lundi matin (costume ou manteau pour toi et ton père), essayage le jeudi 26 en fin d'après-midi, retrait le samedi 28 au matin. Apporte une veste de référence et des photos. Négocie 20-40 % sauf chez Kate & Kevin (prix fixes)."),
 ("zhangyuan", "d3", "11h–12h", None),
 ("lv-the-louis", "d3", "12h–12h45 (créneau « My LV »)", "Réserve le créneau du lundi 23 vers 12h sur le mini-programme WeChat « My LV » dès l'ouverture des réservations, et vérifie avant le 21 que le lieu est toujours ouvert. Le café se réserve à part."),
 ("upper-house-shanghai", "d3", "Déjeuner 13h–14h30", "Déjeune au Café Gray Deluxe (réserve au +86 21 3216 8088) ou au Sui Tang Li pour la cuisine shanghaïenne (+86 21 3216 8068). Tenue smart casual."),
 ("shanghai-watch-flagship", "d3", "14h45–15h10", None),
 ("nanjing-west-watch-row", "d3", "15h10–16h05", "Lundi = vendeurs disponibles. Commence par Lange (n°1155) et Moser (n°1079), puis finis par Plaza 66 (1266 Nanjing Xi Lu) en marchant vers l'ouest. Repère la vitrine Zeitwerk : le site Lange donne tantôt le n°1155, tantôt le n°1169."),
 ("jingan-temple", "d3", "16h10–16h50", "Le temple ferme vers 17h (dernière entrée plus tôt) : entre avant 16h30, puis fais la photo des toits dorés depuis le trottoir sud de Nanjing Xi Lu à la nuit tombante."),
 ("unitree-jiuguang", "d3", "17h–17h45", "En face du temple, au 2e étage de Jiuguang. Apple Jing'an (gradins en pierre, rangée d'érables) est sur la place juste à côté si tu veux un arrêt de 10 min."),
 ("fotografiska-shanghai", "d3", "18h15–19h45", "Le lundi, presque tous les musées sont fermés mais Fotografiska ouvre jusqu'à 23h. Réserve ton billet en ligne avec ton passeport. Puis 15 min à pied le long de Suzhou Creek jusqu'au Bulgari."),
 ("bulgari-hotel-shanghai", "d3", "Dîner 20h · Il Bar ensuite", "Réserve Il Ristorante – Niko Romito (47e) par téléphone pour 20h, puis verre à Il Bar ou à La Terrazza (48e) si la météo le permet. Prends une veste."),

 # d4 mardi : Bund, Yuyuan, finance
 ("yu-garden-city-god", "d4", "9h–10h30", "Sois là à 9h pile (fermé le lundi, d'où le mardi). Demi-tarif pour ton père avec son passeport. Traverse le bazar sans t'arrêter."),
 ("fosun-foundation", "d4", "10h45–11h45", "À 10 min à pied du jardin Yu. Demande à l'accueil à quelle heure la façade de Heatherwick s'anime, et monte à la terrasse pour la vue sur Pudong."),
 ("lao-zheng-xing", "d4", "Déjeuner 12h15–13h30", "Réserve au +86 21 6322 2624 ou par l'hôtel. Crabe chevelu et poisson jaune à la lie de vin. DiDi de 5 min depuis Fosun."),
 ("huawei-nanjing-east", "d4", "13h45–14h30", None),
 ("china-securities-museum", "d4", "14h45–15h45", "Descends Nanjing Dong Lu jusqu'au Bund, puis traverse le pont Waibaidu (15 min à pied). Le musée ferme à 16h. Peu de textes en anglais : prépare Google Lens."),
 ("bund-waitan", "d4", "15h50–16h15 à pied, puis au crépuscule", "Redescends le Bund du pont Waibaidu au Peace Hotel. Après le coucher du soleil, reste pour l'allumage des façades vers 17h30 avant le dîner."),
 ("terrace-915-peace-hotel", "d4", "16h15–17h30 (coucher du soleil 16h50)", "Le verre de l'heure dorée avec ton père, face à Lujiazui. En partant, descends voir le hall Art déco et le Jazz Bar historique. Horaires relevés en mai 2026 : fais confirmer par la conciergerie que la terrasse ouvre encore fin novembre ; sinon, prends le verre au Jazz Bar ou au Sir Elly's du Peninsula."),
 ("canton-table", "d4", "Dîner 18h15", "Réserve au +86 21 6321 3737 une table côté fenêtre : Lujiazui illuminé en face. Garde de la place pour le biscuit « feuille d'érable »."),

 # d5 mercredi : Suzhou
 ("hongqiao-hsr", "d5", "TGV aller ~6h50 · retour ~17h30-19h", "DiDi de l'hôtel à 6h15. Réserve aller et retour sur 12306 dès l'ouverture des ventes (15 jours avant), en 1re classe pour ton père. Pour dîner à Shanghai, vise un retour vers 17h30."),
 ("suzhou-humble-administrator", "d5", "7h45–9h45", None),
 ("suzhou-museum-pei", "d5", "10h–12h (créneau réservé)", "Réserve le créneau gratuit du mercredi 25 vers 10h jusqu'à 7 jours avant (mini-programme « 苏州博物馆全预约 ») avec ton passeport. Puis déjeune dans le centre historique (Pingjiang Lu, à choisir sur Dianping)."),
 ("lingering-garden", "d5", "14h–16h", "DiDi de 15 min depuis le centre. Billet nominatif sur le compte WeChat des jardins de Suzhou. Ensuite, balade au crépuscule sur Pingjiang Lu ou TGV retour."),

 # d6 jeudi : Concession française, cuir, essayage
 ("arts-crafts-museum", "d6", "9h–10h15", "Arrive à 9h (pause de 11h30 à 13h). Monte direct au 3e voir les ateliers vivants. Puis marche sous les ginkgos de Fenyang Lu jusqu'à Taiyuan Lu."),
 ("captain-george", "d6", "10h20–11h", None),
 ("wukang-road", "d6", "11h15–11h45", "DiDi de 5 min ou 20 min à pied. Photo de la proue depuis le carrefour Huaihai/Xingguo, puis remonte Wukang Lu vers le nord."),
 ("ffc-anfu-hengshan-walk", "d6", "11h45–12h45", "Remonte Wukang Lu (Harmay au n°55, to summer à l'angle de Hunan Lu, ouvert dès 11h), puis Anfu Lu vers l'est jusqu'à Fumin Lu."),
 ("labelhood-pillar", "d6", "12h45–13h30", None),
 ("lei-garden-xuhui", "d6", "Déjeuner 13h45–15h", "Réserve au +86 21 5425 2283 : dim sum, rôtisserie et soupe du jour. Rapport qualité-prix rare pour un étoilé."),
 ("songmont-huaihai", "d6", "15h10–15h45", None),
 ("haus-nowhere", "d6", "15h45–16h10", "Juste en face de Songmont. 20 min suffisent : regarde la mécanique des installations (moteurs, cinématique, finitions métal), c'est de l'industrial design pur, pas un arrêt shopping."),
 ("pony-up", "d6", "16h15–16h45 (cocktail de jour)", "Le front bar sert des mini-cocktails l'après-midi, sans foule. Pars à 16h45 au plus tard : DiDi de 15-20 min jusqu'au marché de South Bund pour l'essayage (le marché ferme à 18h)."),
 ("fu-he-hui", "d6", "Dîner 19h15", "Réserve au +86 21 3980 9188 ou par la conciergerie. Prends l'accord thés. Essayage à South Bund avant (17h–17h45), puis file directement : 35-40 min en DiDi à l'heure de pointe, l'aller-retour à l'hôtel ne tient pas."),

 # d7 vendredi : People's Square, Huaihai, soirée Fuxing Lu
 ("shanghai-museum-peoples-square", "d7", "9h–11h30", "Arrive à l'ouverture. Pas de réservation pour les individuels en principe, mais vérifie sur WeChat la veille."),
 ("jia-jia-tang-bao", "d7", "Déjeuner 11h40–12h20", "Juste au nord de People's Square : arrive avant midi pour éviter la file. Commande le porc-crabe."),
 ("hermes-maison-shanghai", "d7", "13h30–14h30", "Appelle avant (+86 21 8013 7217) pour savoir quelle expo tourne. Ensuite SHANG XIA à deux pas, puis Xintiandi à 10 min à pied."),
 ("shangxia-maison", "d7", "14h30–15h15", "Statut 2026 confirmé par une seule source : vérifie sur Dianping avant. Ensuite, Xintiandi à 10 min à pied."),
 ("xintiandi", "d7", "15h30–16h30 (flânerie)", "Fais l'îlot nord, puis descends par Fuxing Park vers Sinan Mansions et Fuxing Zhong Lu, où tu dînes. Si ton père veut souffler, pause à l'hôtel entre 16h30 et 17h30."),
 ("coa-shanghai", "d7", "Dîner 18h (taqueria) · mezcaleria ensuite", "Dîne à la taqueria du rez-de-chaussée, puis monte à la mezcaleria (4e) pour un flight de mezcals."),
 ("speak-low", "d7", "20h–21h15", "Juste en face de Coa. Réserve au +86 21 6416 0133 ; commence par le 2e étage."),
 ("bar-leone-shanghai", "d7", "21h30–23h", "Sans réservation : la file peut être longue un vendredi. Si c'est trop, garde-le pour un autre soir dès 18h. INS Land (club) est à 10 min à pied si tu veux finir tard."),

 # d8 samedi : retrait, Pudong, Lujiazui, dîner Taian
 ("shanghai-museum-east", "d8", "10h30–13h", "Retrait des costumes à South Bund à 9h30 avant. Le samedi est chargé : arrive à l'ouverture des portes et vérifie la veille sur WeChat si l'expo bijoux du Met a ouvert. Le musée des sciences est juste à côté."),
 ("ifc-mall-shanghai", "d8", "Déjeuner 13h30–14h45", "Déjeune dans l'un des restaurants du mall, puis tour des horlogers et de la boutique Songmont « Tidal Moon »."),
 ("museum-of-art-pudong", "d8", "15h–16h", "Regarde sur le site quelles salles sont ouvertes (certaines en montage avant Damien Hirst). L'installation de Carolina Caycedo et le Mirror Hall suffisent à justifier l'heure."),
 ("shanghai-tower-118", "d8", "16h15–17h30 (coucher du soleil 16h50)", None),
 ("flair-ritz-pudong", "d8", "17h40–18h45", "Réserve une table en terrasse au +86 21 2020 1717 pour l'apéritif face au Bund illuminé. Pars à 18h45 pour Taian Table (35-40 min en DiDi)."),
 ("taian-table", "d8", "Dîner 19h30 (arrivée entre 18h et 20h)", "Le grand dîner du séjour, un samedi (ouvert du mardi au samedi). Réserve dès maintenant sur bookings.taian-table.com (90 jours avant). Menu 2 588 ¥ ou 2 888 ¥ hors vins ; acompte non remboursable à moins de 6 jours."),

 # d9 dimanche : Changning, déjeuner, départ
 ("columbia-circle", "d9", "10h–11h", "Valise faite avant de partir : check-out à 12h (demande un late check-out ou laisse les bagages à la conciergerie)."),
 ("maison-dongliang", "d9", "11h05–12h15", "À 400 m au nord de Columbia Circle, de l'autre côté de Yan'an Xi Lu. Compte 1h."),
 ("house-of-rong", "d9", "Déjeuner 12h45–14h30", "Dernier repas : réserve au +86 21 6289 1717 en confirmant qu'ils ouvrent le dimanche midi, et pré-commande le poisson jaune. Plan B si c'est fermé : Xin Rong Ji, Nanjing Xi Lu (même groupe, 1 étoile). Retour à l'hôtel vers 16h30, départ pour PVG à 18h30."),

 # lifestyle
 ("da-hu-chun", "lifestyle", "Tous les jours 8h–21h", "Parfait en petit-déjeuner avant le Bund, par exemple mardi à 8h15 avant le jardin Yu (5 min en DiDi)."),
 ("cafe-del-volcan", "lifestyle", "Lun-ven 8h–20h, sam-dim 10h–20h", None),
 ("sir-ellys-terrace", "lifestyle", "Tous les jours 17h–minuit (terrasse saisonnière, à confirmer)", None),
 ("ins-land", "lifestyle", "Jeu-sam, tard le soir", None),
 ("heim", "lifestyle", "Ven-sam, jusqu'à 3h-4h", None),

 # ideas
 ("hangzhou-lingyin-westlake", "ideas", "Lingyin 7h30–18h tous les jours ; lac en accès libre", None),
 ("chenshan-botanical-garden", "ideas", "Tous les jours 8h–17h", "Si les érables sont au pic et que tu as une demi-journée libre (le dimanche 29 au matin par exemple) : DiDi de 45 min, Jardin de la Carrière en fin de matinée."),
 ("perrotin-shanghai", "ideas", "Mar–sam 11h–19h", "À glisser mardi après le China Securities Museum (Huqiu Road est à 5 min à pied) si les dates de l'expo Chadwick se confirment."),
 ("humsuit", "ideas", "Horaires non publiés", "Si tu veux un vrai tailleur Fengbang en plus de South Bund : à 500 m de Zhangyuan, glisse-le lundi après The Louis."),
 ("sstm", "ideas", "Mar–dim 9h–17h (jours de fermeture à vérifier)", "Plan B tech du samedi 28 : à côté du Shanghai Museum East (même station de la ligne 2). Fonce à la zone IA et robotique, 1h suffit. Réserve sur le WeChat sstm01."),
 ("power-station-of-art", "ideas", "Mar–dim 11h–19h, fermé le lundi", None),
 ("rockbund-art-museum", "ideas", "Mer–dim 11h–18h, fermé lun. et mar.", "À combiner avec Perrotin (en face) mardi 24 après le China Securities Museum, si une expo est ouverte."),
 ("hongqiao-pearl-city", "ideas", "Tous les jours, en journée (horaires non publiés)", "Seule adresse bijoux du programme, strictement optionnelle : à 10 min de DiDi de l'hôtel, par exemple dimanche 29 au matin. Teste les perles (frottées contre les dents, elles doivent crisser) et négocie fort."),
 ("haining-leather-city", "ideas", "Tous les jours ~9h–17h", "Seulement si tu veux une veste en cuir pour toi ou ton père : journée Zhejiang avec Puyuan (cachemire) le matin. Sinon, pas de détour : la maroquinerie homme haut de gamme n'y est pas."),
]


# Opening hours shown first in the highlights of scheduled places (the app has no hours field)
HOURS = {
 "renaissance-caohejing": "réception 24h/24 ; check-in dès 15h, check-out 12h (à vérifier sur ta confirmation)",
 "pvg-t1": "aéroport 24h/24 ; enregistrement AF111 fermé vers 21h15",
 "shanghai-botanical-garden": "tous les jours ~7h–17h ; serres et musée du penjing jusqu'à ~16h30",
 "longhua-temple": "tous les jours ~7h–16h30",
 "westbund-central": "tous les jours ~10h–22h",
 "westbund-pompidou": "mar.–dim. 10h–17h (11h–18h selon le Pompidou), fermé le lundi",
 "long-museum-westbund": "mar.–dim. ~10h–17h30, fermé le lundi",
 "old-jesse": "tous les jours 11h–14h30 et 17h–21h30",
 "southbund-fabric": "tous les jours 9h–18h",
 "zhangyuan": "allées libres ; boutiques ~10h–22h tous les jours",
 "lv-the-louis": "tous les jours 10h–22h, sur réservation « My LV »",
 "upper-house-shanghai": "hôtel 24h/24 ; restaurants midi et soir (horaires non publiés)",
 "shanghai-watch-flagship": "tous les jours 10h–22h",
 "nanjing-west-watch-row": "boutiques tous les jours 10h–22h",
 "jingan-temple": "tous les jours ~7h30–17h",
 "unitree-jiuguang": "tous les jours ~10h–22h (horaires de Jiuguang)",
 "fotografiska-shanghai": "tous les jours 10h30–23h (dernière entrée 22h), lundi compris",
 "bulgari-hotel-shanghai": "Il Bar 10h–1h ; La Terrazza 17h30–1h",
 "yu-garden-city-god": "mar.–dim. 9h–16h30 (vente jusqu'à 16h), fermé le lundi",
 "fosun-foundation": "mar.–dim. 10h–18h (20h jeu. et sam.), fermé le lundi",
 "lao-zheng-xing": "midi et soir tous les jours (horaires précis non publiés)",
 "huawei-nanjing-east": "tous les jours 10h–22h",
 "china-securities-museum": "mar.–dim. 9h30–16h, fermé le lundi",
 "bund-waitan": "promenade 24h/24 ; façades allumées ~18h–22h",
 "terrace-915-peace-hotel": "lun.–jeu. 15h–22h, ven.–dim. 15h–23h30 (relevé de mai 2026)",
 "canton-table": "tous les jours 11h30–14h30 et 17h30–21h30",
 "hongqiao-hsr": "gare ~5h30–minuit ; trains ~6h–23h",
 "suzhou-humble-administrator": "tous les jours 7h30–17h (dernière entrée ~16h30)",
 "suzhou-museum-pei": "mar.–dim. 9h–17h (dernière entrée 16h), fermé le lundi",
 "lingering-garden": "tous les jours 7h30–17h (dernière entrée ~16h30)",
 "arts-crafts-museum": "mar.–dim. 9h–11h30 et 13h–16h30, fermé le lundi",
 "captain-george": "tous les jours 10h–19h",
 "wukang-road": "rue accessible en permanence ; boutiques ~10h–20h",
 "ffc-anfu-hengshan-walk": "rues 24h/24 ; boutiques ~10h–21h",
 "labelhood-pillar": "tous les jours 10h–22h",
 "lei-garden-xuhui": "midi (dim sum) et soir tous les jours",
 "songmont-huaihai": "tous les jours 10h–22h",
 "haus-nowhere": "tous les jours 10h–22h, entrée libre",
 "pony-up": "front bar 13h–21h, back bar 18h–2h, tous les jours",
 "fu-he-hui": "tous les jours 11h–13h et 17h30–21h",
 "shanghai-museum-peoples-square": "mar.–dim. 9h–17h (dernière entrée 16h), fermé le lundi",
 "jia-jia-tang-bao": "tous les jours ~7h30–20h30, ferme plus tôt quand la pâte est épuisée",
 "hermes-maison-shanghai": "en principe tous les jours ~10h–22h (non confirmé)",
 "shangxia-maison": "tous les jours 11h–21h30 (une seule source)",
 "xintiandi": "allées libres ; boutiques ~10h–22h, bars plus tard",
 "coa-shanghai": "tous les soirs (horaires précis non confirmés)",
 "speak-low": "tous les soirs (horaires à vérifier sur Instagram)",
 "bar-leone-shanghai": "tous les jours 18h–1h",
 "shanghai-museum-east": "10h–18h (dernière entrée 17h), fermé le mardi",
 "ifc-mall-shanghai": "tous les jours ~10h–22h",
 "museum-of-art-pudong": "10h–21h (dernière entrée 20h)",
 "shanghai-tower-118": "tous les jours 8h30–22h (vente jusqu'à 21h30)",
 "flair-ritz-pudong": "lun.–ven. 17h30–1h, sam.–dim. 14h–1h",
 "taian-table": "dîner mar.–sam., arrivées 18h–20h ; fermé dim. et lun.",
 "columbia-circle": "site accessible ; boutiques et cafés ~10h–22h",
 "maison-dongliang": "tous les jours 10h–22h",
 "house-of-rong": "midi et soir ; jour de fermeture non publié",
}

prog = []
seen = set()
for pid, day, time, tip in PLAN:
    assert pid in BY, pid
    assert pid not in seen, pid
    seen.add(pid)
    v = BY[pid]
    t = TYPE_OVR.get(pid, v["category"])
    assert t in TYPES, (pid, t)
    o = {"id": pid, "name": v["name"], "day": day, "type": t, "lat": v["lat"], "lng": v["lng"], "time": time,
         "address": v["address"], "cn": v["cn"], "metro": v.get("metro", ""), "website": v.get("website", ""),
         "desc": v["desc"], "highlights": ([f"Horaires : {HOURS[pid]}"] if pid in HOURS else []) + list(v["highlights"]), "tip": tip or v.get("tip", "")}
    assert day in ("lifestyle", "ideas") or pid in HOURS, ("hours missing", pid)
    prog.append(o)

hotel = BY["renaissance-caohejing"]
P = {
 "trip": {"id": "sha-2026", "title": "Shanghai", "subtitle": "Voyage d'inspiration", "start": "2026-11-21", "end": "2026-11-29",
          "timezone": "Asia/Shanghai", "hotel": {"name": "Renaissance Shanghai Caohejing", "lat": hotel["lat"], "lng": hotel["lng"]},
          "center": [121.462, 31.214]},
 "flights": [
  {"code": "AF116", "from": "CDG", "to": "PVG", "fromCity": "Paris", "toCity": "Shanghai", "at": "2026-11-21T19:00:00+08:00",
   "departAt": "2026-11-20T23:20:00+01:00", "arriveAt": "2026-11-21T19:00:00+08:00", "terminal": "CDG 2E → PVG T1", "kind": "arrival"},
  {"code": "AF111", "from": "PVG", "to": "CDG", "fromCity": "Shanghai", "toCity": "Paris", "at": "2026-11-29T22:15:00+08:00",
   "departAt": "2026-11-29T22:15:00+08:00", "arriveAt": "2026-11-30T05:50:00+01:00", "terminal": "PVG T1 → CDG 2E", "kind": "departure"},
 ],
 "days": [
  {"key": "d1", "short": "Sam 21", "title": "Jour 1", "theme": "Arrivée à Pudong (19h), installation", "dates": ["2026-11-21"], "glyph": "1", "scheduled": True},
  {"key": "d2", "short": "Dim 22", "title": "Jour 2", "theme": "Xuhui d'automne : jardin botanique, Longhua, musées du West Bund", "dates": ["2026-11-22"], "glyph": "2", "scheduled": True},
  {"key": "d3", "short": "Lun 23", "title": "Jour 3", "theme": "Tailleur, Zhangyuan, rue des montres, robotique ; Fotografiska le soir", "dates": ["2026-11-23"], "glyph": "3", "scheduled": True},
  {"key": "d4", "short": "Mar 24", "title": "Jour 4", "theme": "Jardin Yu, Bund, finance et Huawei ; crépuscule au Peace Hotel", "dates": ["2026-11-24"], "glyph": "4", "scheduled": True},
  {"key": "d5", "short": "Suzhou", "title": "Jour 5", "theme": "Day trip à Suzhou : jardins classiques et musée d'I.M. Pei", "dates": ["2026-11-25"], "glyph": "5", "scheduled": True},
  {"key": "d6", "short": "Jeu 26", "title": "Jour 6", "theme": "Concession française : artisanat, concept stores, cuir, HAUS NOWHERE ; essayage", "dates": ["2026-11-26"], "glyph": "6", "scheduled": True},
  {"key": "d7", "short": "Ven 27", "title": "Jour 7", "theme": "People's Square, Hermès, Shang Xia, Xintiandi ; tournée des bars de Fuxing Lu", "dates": ["2026-11-27"], "glyph": "7", "scheduled": True},
  {"key": "d8", "short": "Sam 28", "title": "Jour 8", "theme": "Pudong : musée de Shanghai Est, Lujiazui, Shanghai Tower ; dîner Taian Table", "dates": ["2026-11-28"], "glyph": "8", "scheduled": True},
  {"key": "d9", "short": "Dim 29", "title": "Jour 9", "theme": "Changning, dernier déjeuner, départ de l'hôtel à 18h30", "dates": ["2026-11-29"], "glyph": "9", "scheduled": True},
  {"key": "lifestyle", "short": "Sorties", "title": "Sorties", "theme": "Bars, restaurants, adresses du soir", "glyph": "♦", "scheduled": False},
  {"key": "ideas", "short": "Pistes", "title": "Pistes", "theme": "À voir si le temps le permet", "glyph": "+", "scheduled": False},
 ],
 "places": prog,
 "phrases": [
  {"title": "Musées et réservations", "items": [
   {"zh": "我想买两张门票", "pinyin": "Wǒ xiǎng mǎi liǎng zhāng ménpiào", "fr": "Je voudrais deux billets d'entrée"},
   {"zh": "需要提前预约吗？", "pinyin": "Xūyào tíqián yùyuē ma?", "fr": "Faut-il réserver à l'avance ?"},
   {"zh": "我用护照预约了", "pinyin": "Wǒ yòng hùzhào yùyuē le", "fr": "J'ai réservé avec mon passeport"},
   {"zh": "可以拍照吗？", "pinyin": "Kěyǐ pāizhào ma?", "fr": "Je peux prendre des photos ?"},
   {"zh": "老人有优惠吗？", "pinyin": "Lǎorén yǒu yōuhuì ma?", "fr": "Y a-t-il un tarif senior ?"}]},
  {"title": "Restaurant et paiement", "items": [
   {"zh": "我想订今晚七点，两位", "pinyin": "Wǒ xiǎng dìng jīnwǎn qī diǎn, liǎng wèi", "fr": "Je voudrais réserver ce soir à 19h pour deux"},
   {"zh": "有英文菜单吗？", "pinyin": "Yǒu Yīngwén càidān ma?", "fr": "Avez-vous un menu en anglais ?"},
   {"zh": "你们的招牌菜是什么？", "pinyin": "Nǐmen de zhāopái cài shì shénme?", "fr": "Quel est votre plat signature ?"},
   {"zh": "不要太辣", "pinyin": "Bú yào tài là", "fr": "Pas trop épicé, s'il vous plaît"},
   {"zh": "买单，可以用支付宝吗？", "pinyin": "Mǎidān, kěyǐ yòng Zhīfùbǎo ma?", "fr": "L'addition ; je peux payer avec Alipay ?"},
   {"zh": "我扫你还是你扫我？", "pinyin": "Wǒ sǎo nǐ háishì nǐ sǎo wǒ?", "fr": "Je scanne votre QR code ou vous scannez le mien ?"},
   {"zh": "我有预订，名字是……", "pinyin": "Wǒ yǒu yùdìng, míngzi shì…", "fr": "J'ai une réservation au nom de…"}]},
  {"title": "Tailleur, cuir et textile", "items": [
   {"zh": "这是真皮吗？什么皮？", "pinyin": "Zhè shì zhēnpí ma? Shénme pí?", "fr": "C'est du vrai cuir ? Quel cuir ?"},
   {"zh": "这是什么面料？羊绒还是羊毛？", "pinyin": "Zhè shì shénme miànliào? Yángróng háishì yángmáo?", "fr": "Quel est ce tissu ? Cachemire ou laine ?"},
   {"zh": "可以定做吗？要多久？", "pinyin": "Kěyǐ dìngzuò ma? Yào duōjiǔ?", "fr": "Vous faites du sur-mesure ? Il faut combien de temps ?"},
   {"zh": "请帮我量一下尺寸", "pinyin": "Qǐng bāng wǒ liáng yíxià chǐcùn", "fr": "Pouvez-vous prendre mes mesures ?"},
   {"zh": "能便宜一点吗？", "pinyin": "Néng piányi yìdiǎn ma?", "fr": "Vous pouvez faire un meilleur prix ?"}]},
  {"title": "Trains et aéroport", "items": [
   {"zh": "师傅，去虹桥火车站", "pinyin": "Shīfu, qù Hóngqiáo huǒchēzhàn", "fr": "Chauffeur, à la gare de Hongqiao s'il vous plaît"},
   {"zh": "检票口在哪里？", "pinyin": "Jiǎnpiàokǒu zài nǎlǐ?", "fr": "Où est le contrôle des billets ?"},
   {"zh": "我要去浦东机场一号航站楼", "pinyin": "Wǒ yào qù Pǔdōng jīchǎng yī hào hángzhànlóu", "fr": "Je vais à l'aéroport de Pudong, terminal 1"}]},
 ],
 "zones": [
  {"label": "Bund & Lujiazui", "center": [121.493, 31.238], "zoom": 14},
  {"label": "Jing'an · Nanjing Xi Lu", "center": [121.452, 31.229], "zoom": 15},
  {"label": "Concession française", "center": [121.448, 31.215], "zoom": 14.5},
  {"label": "West Bund · Longhua", "center": [121.455, 31.172], "zoom": 14},
  {"label": "Caohejing (hôtel)", "center": [121.392, 31.167], "zoom": 14.5},
  {"label": "Changning · Columbia Circle", "center": [121.425, 31.217], "zoom": 15},
  {"label": "Suzhou", "center": [120.612, 31.322], "zoom": 13},
 ],
 "practical": [
  {"title": "Arrivée et aéroport", "text": "AF116 décolle de CDG 2E le vendredi 20/11 à 23h20 et atterrit à PVG T1 le samedi 21/11 à 19h00 (horaire d'hiver). Compte 30 à 60 min d'immigration. Taxi officiel ou DiDi (panneaux « 网约车 ») jusqu'à l'hôtel : ~48 km, 50-70 min, 150-210 ¥. Ignore les rabatteurs du hall. Retour : AF111 part de PVG T1 à 22h15 (arrivée CDG 05h50 le lendemain) ; enregistrement fermé ~60 min avant, quitte l'hôtel vers 18h30. Vérifie la date du vol retour sur ta réservation."},
  {"title": "Entrée en Chine", "text": "Exemption de visa de 30 jours pour les passeports français jusqu'au 31/12/2026, pour toi comme pour ton père. Passeport valable au moins 6 mois après la sortie. Remplis la carte d'arrivée électronique avant le départ (s.nia.gov.cn, appli NIA 12367 ou mini-programme WeChat/Alipay ; c'est gratuit, méfie-toi des faux sites). Pas d'assurance exigée à l'entrée sans visa, mais prends-en une qui couvre les frais médicaux et le rapatriement, surtout pour ton père. Franchise : 2 000 ¥ de marchandises, 1,5 l d'alcool, 400 cigarettes."},
  {"title": "Paiement", "text": "Presque tout se paie par QR code. Lie ta Visa/Mastercard à Alipay (et WeChat Pay) avant de partir, avec ton passeport ; garde l'itinérance active pour le SMS. Frais Alipay : 3 % au-delà de 200 ¥ par paiement. Garde 500-1 000 ¥ en liquide pour le marché aux tissus et une carte physique pour les hôtels et boutiques de luxe. Pas de pourboire, sauf service déjà inclus (10-15 %) dans le haut de gamme."},
  {"title": "Internet et VPN", "text": "Gmail, WhatsApp, Instagram et Google Maps sont bloqués sur le réseau chinois. Le plus simple : une eSIM de voyage routée hors de Chine (Airalo, Holafly, Nomad…) ou l'itinérance de ton opérateur, qui passent sans VPN. Installe quand même un VPN avant de partir pour le Wi-Fi de l'hôtel. Applis à télécharger avant : Alipay, WeChat, DiDi, Amap, Metro大都会, 12306, Trip.com, Dianping, un traducteur hors ligne."},
  {"title": "Transports et trains", "text": "DiDi (appli internationale ou via Alipay) : colle toujours l'adresse en chinois. Métro de 5h30 à 23h environ, 3-10 ¥, sans contact Visa/Mastercard accepté partout depuis juin 2025. TGV pour Suzhou : réserve sur 12306 (appli en anglais) ou Trip.com dès l'ouverture des ventes, 15 jours avant ; le passeport sert de billet, sécurité à l'entrée, prévois 30-45 min à Hongqiao. Prends la 1re classe pour ton père."},
  {"title": "Météo et automne", "text": "Fin novembre : 8-16 °C, humide, quelques jours de pluie fine, soirées vers 8-12 °C sur les rooftops. Veste chaude, pull, parapluie, bonnes chaussures. Coucher du soleil vers 16h50. C'est le pic des ginkgos et des érables : jardin botanique, West Bund, Wukang Lu, Fenyang Lu, Suzhou. Regarde l'indice de qualité de l'air avant la Shanghai Tower."},
  {"title": "Urgences", "text": "Police 110, ambulance 120, pompiers 119, hotline municipale en anglais 12345. Consulat général de France : Soho Zhongshan Plaza, 18e étage, 1055 Zhongshan Xi Lu (Changning), +86 21 6010 6300. Inscris-toi sur Ariane, ton père aussi. Hôtel : +86 21 3325 8888. Prises 220 V types A, C et I : prends un adaptateur universel."},
  {"title": "Réservations et fermetures", "text": "Dès maintenant : Taian Table (sam. 28, en ligne, 90 jours avant), Il Ristorante – Niko Romito au Bulgari (lun. 23), Fu He Hui (jeu. 26), Canton Table (mar. 24), House of Rong (dim. 29, vérifie l'ouverture le midi), Old Jesse, Lao Zheng Xing, Lei Garden, Café Gray Deluxe, Speak Low et Flair : fais passer la conciergerie du Renaissance pour les restaurants. Dès l'ouverture des ventes : TGV Suzhou (15 jours avant le 25, donc dès le 10-11/11), Suzhou Museum et jardins de Suzhou (7 jours avant), The Louis (« My LV »). La semaine d'avant, au passeport sur WeChat : West Bund Museum, Fotografiska, Shanghai Tower. Fermetures : lundi 23, presque tous les musées (Shanghai Museum de People's Square, West Bund, Long, Fosun, arts et métiers, China Securities Museum) et le jardin Yu ; le Shanghai Museum East ferme le mardi ; Taian Table ferme dimanche et lundi. Bar Leone ne prend pas de réservation."},
 ],
}
json.dump(P, open(os.path.join(D, "program.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
from collections import Counter
c = Counter(p["day"] for p in prog)
print("verified", len(V), "program", len(prog), dict(c))
