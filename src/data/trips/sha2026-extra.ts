// Structured opening hours and emergency data for Shanghai, from the research of 10 Nov 2026
// (research/sha2026/hours-emergency.json, verified against official sites and OpenStreetMap).
import type { Emergency } from "../types";
import type { Hours } from "../../lib/hours";

export const HOURS_SHA: Record<string, Hours> = {
 "southbund-fabric": {
  "always": false,
  "closed": [],
  "open": "09:00",
  "close": "18:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "probable",
  "note": "Tous les jours, week-end compris ; chaque échoppe a ses horaires, éviter 12h-14h."
 },
 "lao-zheng-xing": {
  "always": false,
  "closed": [],
  "open": "11:00",
  "close": "21:00",
  "lastEntry": "",
  "breaks": [
   {
    "from": "14:00",
    "to": "17:00"
   }
  ],
  "byDay": [],
  "reservation": "Conseillée : téléphone +86 21 6322 2624 ou conciergerie, la veille",
  "confidence": "probable",
  "note": "Service midi 11h-14h selon la presse locale : arriver à 14h, c'est trop tard ; viser 12h45 au plus tard."
 },
 "bund-waitan": {
  "always": true,
  "closed": [],
  "open": "",
  "close": "",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "sûr",
  "note": "Promenade ouverte 24h/24 ; façades illuminées environ 18h-22h en hiver."
 },
 "sir-ellys-terrace": {
  "always": false,
  "closed": [],
  "open": "17:00",
  "close": "24:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "Appeler le +86 21 2327 6756 pour savoir si la terrasse est ouverte",
  "confidence": "probable",
  "note": "Terrasse ouverte d'avril à novembre selon la météo : fermeture possible fin novembre, le bar intérieur prend le relais."
 },
 "suzhou-museum-pei": {
  "always": false,
  "closed": [
   1
  ],
  "open": "09:00",
  "close": "17:00",
  "lastEntry": "16:00",
  "breaks": [],
  "byDay": [],
  "reservation": "Obligatoire, gratuite : mini-programme WeChat « 苏州博物馆全预约 », au passeport, jusqu'à 7 j avant",
  "confidence": "sûr",
  "note": "Fermé le lundi."
 },
 "bulgari-hotel-shanghai": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "25:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "Il Bar sans réservation ; Il Ristorante – Niko Romito par téléphone",
  "confidence": "sûr",
  "note": "Horaires d'Il Bar (47e) ; La Terrazza (48e) ouvre 17h30-1h selon la météo."
 },
 "wukang-road": {
  "always": true,
  "closed": [],
  "open": "",
  "close": "",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "sûr",
  "note": "Rue en accès libre ; Wukang Mansion se voit de l'extérieur. Boutiques et cafés environ 10h-20h."
 },
 "lei-garden-xuhui": {
  "always": false,
  "closed": [],
  "open": "11:30",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [
   {
    "from": "15:00",
    "to": "17:30"
   }
  ],
  "byDay": [],
  "reservation": "Conseillée : +86 21 5425 2283 (pas de réservation en ligne)",
  "confidence": "probable",
  "note": "Midi 11h30-15h ; SmartShanghai (2020) indique un dîner de 18h à 23h30, l'heure du soir reste à confirmer."
 },
 "zhangyuan": {
  "always": true,
  "closed": [],
  "open": "",
  "close": "",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "sûr",
  "note": "Allées libres ; boutiques environ 10h-22h selon l'enseigne."
 },
 "lv-the-louis": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "Obligatoire, gratuite : mini-programme WeChat « My LV », créneau à réserver dès l'ouverture ; café à réserver séparément",
  "confidence": "probable",
  "note": "Ouvert en juin 2026 ; vérifier avant le départ qu'il est toujours ouvert fin novembre."
 },
 "coa-shanghai": {
  "always": false,
  "closed": [
   1
  ],
  "open": "18:30",
  "close": "25:30",
  "lastEntry": "",
  "breaks": [],
  "byDay": [
   {
    "day": 5,
    "open": "18:30",
    "close": "26:30"
   },
   {
    "day": 6,
    "open": "18:30",
    "close": "26:30"
   }
  ],
  "reservation": "Pas de réservation : liste d'attente sur place, venir tôt",
  "confidence": "probable",
  "note": "Horaires de la mezcaleria (guide officiel de Shanghai, 2026) ; ceux de la taqueria ne sont pas publiés. Fermeture du lundi probable."
 },
 "shanghai-museum-east": {
  "always": false,
  "closed": [
   2
  ],
  "open": "10:00",
  "close": "18:00",
  "lastEntry": "17:00",
  "breaks": [],
  "byDay": [],
  "reservation": "Mini-programme WeChat « 上海博物馆 », au passeport, quelques jours avant (le samedi part vite)",
  "confidence": "sûr",
  "note": "Fermé le mardi, ouvert le lundi."
 },
 "museum-of-art-pudong": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "21:00",
  "lastEntry": "20:00",
  "breaks": [],
  "byDay": [],
  "reservation": "Billet payant en ligne : mini-programme WeChat « 浦东美术馆 », au passeport, la veille",
  "confidence": "probable",
  "note": "Ouvert tous les jours selon le site officiel et SmartShanghai ; d'anciennes fiches annoncent une fermeture le mardi."
 },
 "maison-dongliang": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "probable",
  "note": "Source officielle d'oct. 2024 : vérifier sur Dianping la veille."
 },
 "long-museum-westbund": {
  "always": false,
  "closed": [
   1
  ],
  "open": "10:00",
  "close": "17:30",
  "lastEntry": "16:30",
  "breaks": [],
  "byDay": [],
  "reservation": "Billet via le mini-programme WeChat « 龙美术馆 », au passeport",
  "confidence": "probable",
  "note": "Horaires d'hiver (nov.-mars), fermé le lundi ; une source parle d'une fermeture à 20h du vendredi au dimanche, non confirmée."
 },
 "old-jesse": {
  "always": false,
  "closed": [],
  "open": "11:00",
  "close": "21:30",
  "lastEntry": "",
  "breaks": [
   {
    "from": "14:30",
    "to": "17:00"
   }
  ],
  "byDay": [],
  "reservation": "Indispensable : par la conciergerie, quelques jours avant (petite salle, file le soir)",
  "confidence": "probable",
  "note": "Horaires SmartShanghai déc. 2025, non revérifiés."
 },
 "upper-house-shanghai": {
  "always": false,
  "closed": [],
  "open": "11:30",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [
   {
    "from": "14:30",
    "to": "18:00"
   }
  ],
  "byDay": [],
  "reservation": "Conseillée : Café Gray Deluxe +86 21 3216 8088, Sui Tang Li +86 21 3216 8068",
  "confidence": "probable",
  "note": "Déjeuner au Café Gray 11h30-14h30 en semaine, brunch jusqu'à 15h le week-end ; heures du dîner approximatives."
 },
 "cafe-del-volcan": {
  "always": false,
  "closed": [],
  "open": "08:00",
  "close": "20:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [
   {
    "day": 0,
    "open": "10:00",
    "close": "20:00"
   },
   {
    "day": 6,
    "open": "10:00",
    "close": "20:00"
   }
  ],
  "reservation": "",
  "confidence": "probable",
  "note": "Ouvre à 10h le week-end."
 },
 "shanghai-watch-flagship": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "sûr",
  "note": ""
 },
 "arts-crafts-museum": {
  "always": false,
  "closed": [
   1
  ],
  "open": "09:00",
  "close": "16:30",
  "lastEntry": "16:00",
  "breaks": [
   {
    "from": "11:30",
    "to": "13:00"
   }
  ],
  "byDay": [],
  "reservation": "",
  "confidence": "sûr",
  "note": "Fermé le lundi ; pause à midi."
 },
 "humsuit": {
  "always": false,
  "closed": [],
  "open": "",
  "close": "",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "Rendez-vous conseillé pour une prise de mesures",
  "confidence": "inconnu",
  "note": "Horaires non publiés (boutique de Shaanxi Bei Lu) : vérifier sur Dianping ou appeler."
 },
 "haining-leather-city": {
  "always": false,
  "closed": [],
  "open": "09:00",
  "close": "17:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "probable",
  "note": "Horaires approximatifs ; tél. 0573-87010001."
 },
 "jia-jia-tang-bao": {
  "always": false,
  "closed": [],
  "open": "07:30",
  "close": "20:30",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "probable",
  "note": "Sans réservation, commande au comptoir. Ferme plus tôt quand la pâte est épuisée. Une source signale un changement de nom (佳乐汤包) : vérifier sur Dianping."
 },
 "yu-garden-city-god": {
  "always": false,
  "closed": [
   1
  ],
  "open": "09:00",
  "close": "16:30",
  "lastEntry": "16:00",
  "breaks": [],
  "byDay": [],
  "reservation": "Billet sur le mini-programme WeChat officiel du jardin Yu ou au guichet, passeport demandé. Réserver la veille conseillé le week-end.",
  "confidence": "probable",
  "note": "Jardin fermé le lundi sauf jours fériés. Le temple du Dieu de la ville (~8h30–16h30) et le bazar autour restent accessibles."
 },
 "rockbund-art-museum": {
  "always": false,
  "closed": [
   1,
   2
  ],
  "open": "11:00",
  "close": "18:00",
  "lastEntry": "17:30",
  "breaks": [],
  "byDay": [],
  "reservation": "Gratuit. Sans réservation du mercredi au vendredi ; le week-end, créneau facultatif (entrée prioritaire) sur le mini-programme WeChat « RAM上海外滩美术馆 ».",
  "confidence": "sûr",
  "note": "Mardi réservé aux membres (12h–18h). Vérifier qu'une exposition est en cours (fermé entre deux expositions)."
 },
 "terrace-915-peace-hotel": {
  "always": false,
  "closed": [],
  "open": "15:00",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [
   {
    "day": 5,
    "open": "15:00",
    "close": "23:30"
   },
   {
    "day": 6,
    "open": "15:00",
    "close": "23:30"
   },
   {
    "day": 0,
    "open": "15:00",
    "close": "23:30"
   }
  ],
  "reservation": "Conseillée pour le coucher du soleil, via la conciergerie du Fairmont Peace Hotel.",
  "confidence": "probable",
  "note": "Horaires de mai 2026. Terrasse en plein air : horaires d'hiver ou fermeture par pluie ou froid à confirmer."
 },
 "lingering-garden": {
  "always": false,
  "closed": [],
  "open": "07:30",
  "close": "17:00",
  "lastEntry": "16:30",
  "breaks": [],
  "byDay": [],
  "reservation": "Billet nominatif conseillé en ligne (mini-programme WeChat des jardins de Suzhou), passeport à l'entrée.",
  "confidence": "probable",
  "note": "Horaires d'hiver. Les sources hésitent entre une fermeture à 16h30 et à 17h : arriver avant 16h."
 },
 "fu-he-hui": {
  "always": false,
  "closed": [],
  "open": "11:00",
  "close": "21:00",
  "lastEntry": "",
  "breaks": [
   {
    "from": "13:00",
    "to": "17:30"
   }
  ],
  "byDay": [],
  "reservation": "Indispensable : par téléphone au +86 21 3980 9188, plusieurs jours avant (pas de réservation en ligne côté Michelin Chine). Menus uniquement, même menu pour toute la table.",
  "confidence": "probable",
  "note": "Horaires Michelin (11h–13h, 17h30–21h), sans doute des créneaux d'arrivée. Deux étoiles Michelin, végétarien."
 },
 "ffc-anfu-hengshan-walk": {
  "always": true,
  "closed": [],
  "open": "",
  "close": "",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "sûr",
  "note": "Rues ouvertes 24h/24. Boutiques et cafés environ 10h–21h ; Harmay (55 Wukang Lu) 9h30–22h30."
 },
 "songmont-huaihai": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "sûr",
  "note": "Tous les jours (site officiel)."
 },
 "unitree-jiuguang": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "probable",
  "note": "Horaires du grand magasin Jiuguang (les boutiques y ouvrent 10h–22h). Horaires propres à Unitree non publiés : vérifier sur Dianping."
 },
 "nanjing-west-watch-row": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "Rendez-vous en boutique conseillé pour voir des pièces rares (A. Lange & Söhne, Breguet).",
  "confidence": "probable",
  "note": "Tous les jours. Horaires indicatifs : ils peuvent varier d'une boutique à l'autre."
 },
 "speak-low": {
  "always": false,
  "closed": [],
  "open": "18:00",
  "close": "25:30",
  "lastEntry": "",
  "breaks": [],
  "byDay": [
   {
    "day": 5,
    "open": "18:00",
    "close": "26:30"
   },
   {
    "day": 6,
    "open": "18:00",
    "close": "26:30"
   }
  ],
  "reservation": "Conseillée : +86 21 6416 0133.",
  "confidence": "probable",
  "note": "Horaires de la mairie de Shanghai (oct. 2025) ; Time Out indique une fermeture vers 2h, ou 3h le week-end. Confirmer sur Instagram @speaklow_shanghai."
 },
 "sstm": {
  "always": false,
  "closed": [
   1
  ],
  "open": "09:00",
  "close": "17:00",
  "lastEntry": "16:00",
  "breaks": [],
  "byDay": [],
  "reservation": "Obligatoire : billet nominatif avec passeport sur WeChat sstm01 ou le mini-programme « 上海科技馆自然博物馆天文馆门票 », ouvert 7 jours avant. Les zones à réserver se réservent après l'entrée (créneaux du matin à 8h30, de l'après-midi à 12h30).",
  "confidence": "probable",
  "note": "Fermé le lundi en principe, mais le musée teste des fermetures à d'autres jours depuis sa réouverture : vérifier sur sstm01. Très fréquenté."
 },
 "shanghai-tower-118": {
  "always": false,
  "closed": [],
  "open": "08:30",
  "close": "22:00",
  "lastEntry": "21:30",
  "breaks": [],
  "byDay": [],
  "reservation": "Pas obligatoire. Billet (~180 ¥) au guichet B1 ou sur le mini-programme officiel du Shanghai Tower, passeport demandé.",
  "confidence": "probable",
  "note": "Peut fermer sans préavis en cas de typhon ou de météo extrême : vérifier le jour même."
 },
 "columbia-circle": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "probable",
  "note": "Site extérieur accessible en journée et en soirée ; boutiques et cafés environ 10h–22h selon l'enseigne (Seesaw ferme plus tôt)."
 },
 "westbund-central": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "inconnu",
  "note": "Aucun horaire publié trouvé. Probablement 10h–22h comme les autres centres de Shanghai : à vérifier sur Dianping."
 },
 "longhua-temple": {
  "always": false,
  "closed": [],
  "open": "07:00",
  "close": "16:30",
  "lastEntry": "16:30",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "probable",
  "note": "Billet d'environ 10 ¥ au guichet. Pagode visible de l'extérieur seulement."
 },
 "pony-up": {
  "always": false,
  "closed": [],
  "open": "13:00",
  "close": "26:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "Conseillée le soir pour le back bar : +86 184 6698 6722.",
  "confidence": "probable",
  "note": "Front bar 13h–21h, back bar 18h–2h."
 },
 "ins-land": {
  "always": false,
  "closed": [],
  "open": "20:00",
  "close": "26:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "Billet d'entrée unique pour tout le complexe, sur place. Prendre son passeport.",
  "confidence": "inconnu",
  "note": "Horaires non publiés et variables selon le club (certains jusqu'à 4h ou 5h). Plus animé du jeudi au samedi."
 },
 "huawei-nanjing-east": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "sûr",
  "note": "Tous les jours (site officiel Huawei)."
 },
 "hangzhou-lingyin-westlake": {
  "always": false,
  "closed": [],
  "open": "07:30",
  "close": "17:30",
  "lastEntry": "17:00",
  "breaks": [],
  "byDay": [],
  "reservation": "Obligatoire mais gratuite : mini-programme « 杭州灵隐飞来峰 » (WeChat ou Alipay), au nom et au numéro de passport, au plus tard la veille et jusqu'à 7 jours avant, impossible le jour même. Liste d'attente en ligne jusqu'à 20h la veille.",
  "confidence": "sûr",
  "note": "Gratuit depuis le 1er déc. 2025 (Lingyin, Feilai Feng, Yongfu, Taoguang). Une source mentionne encore une offrande de 30 ¥ au temple. Lac de l'Ouest en accès libre 24h/24."
 },
 "power-station-of-art": {
  "always": false,
  "closed": [
   1
  ],
  "open": "11:00",
  "close": "19:00",
  "lastEntry": "18:00",
  "breaks": [],
  "byDay": [],
  "reservation": "Entrée générale gratuite, sans réservation. Expositions payantes (dont la Biennale de Shanghai si elle est en cours) : billet sur le WeChat « PowerStationOfArt ».",
  "confidence": "probable",
  "note": "Fermé le lundi, ouvert les jours fériés."
 },
 "shanghai-museum-peoples-square": {
  "always": false,
  "closed": [
   1
  ],
  "open": "09:00",
  "close": "17:00",
  "lastEntry": "16:00",
  "breaks": [],
  "byDay": [],
  "reservation": "Entrée du musée libre sans réservation pour les visiteurs individuels (sauf jours d'affluence). L'expo « World Tree » (Amériques anciennes) exige un billet payant nominatif : mini-programme WeChat « 上海博物馆 », rubrique 人民广场馆参观预约, ou site officiel pour les étrangers, avec le passeport, jusqu'à 14 j avant.",
  "confidence": "probable",
  "note": "Fermé le lundi sauf jours fériés. En août 2026, nocturnes mar.–ven. jusqu'à 21h : horaires de novembre à confirmer sur WeChat."
 },
 "fosun-foundation": {
  "always": false,
  "closed": [
   1
  ],
  "open": "10:00",
  "close": "18:00",
  "lastEntry": "17:30",
  "breaks": [],
  "byDay": [
   {
    "day": 4,
    "open": "10:00",
    "close": "20:00"
   },
   {
    "day": 6,
    "open": "10:00",
    "close": "20:00"
   }
  ],
  "reservation": "Billet conseillé sur le compte WeChat « 复星艺术中心 » (nominatif, passeport) ; vente sur place possible.",
  "confidence": "sûr",
  "note": "Jusqu'à 20h le jeudi et le samedi. Expo « Gumshoe » du 10 nov. 2026 au 3 janv. 2027."
 },
 "perrotin-shanghai": {
  "always": false,
  "closed": [
   0,
   1
  ],
  "open": "11:00",
  "close": "19:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "probable",
  "note": "Entrée libre, 3e étage du 27 Huqiu Road. Dates de l'expo Chadwick non publiées : vérifie sur perrotin.com."
 },
 "canton-table": {
  "always": false,
  "closed": [],
  "open": "11:30",
  "close": "21:30",
  "lastEntry": "",
  "breaks": [
   {
    "from": "14:30",
    "to": "17:30"
   }
  ],
  "byDay": [],
  "reservation": "Conseillée : par téléphone au +86 21 6321 3737, en demandant une table côté fenêtre, quelques jours avant.",
  "confidence": "sûr",
  "note": "Déjeuner 11h30–14h30, dîner 17h30–21h30, tous les jours (Guide Michelin)."
 },
 "suzhou-humble-administrator": {
  "always": false,
  "closed": [],
  "open": "07:30",
  "close": "17:00",
  "lastEntry": "16:30",
  "breaks": [],
  "byDay": [],
  "reservation": "Billet nominatif obligatoire en ligne : compte WeChat officiel des jardins de Suzhou (拙政园 / 苏州园林), avec le passeport, quelques jours avant (environ 70 ¥ en basse saison).",
  "confidence": "sûr",
  "note": "Horaires d'hiver (après le 15 novembre) : 7h30–17h, dernière entrée 16h30."
 },
 "fotografiska-shanghai": {
  "always": false,
  "closed": [],
  "open": "10:30",
  "close": "23:00",
  "lastEntry": "22:00",
  "breaks": [],
  "byDay": [],
  "reservation": "Billet en ligne conseillé (mini-programme WeChat ou site Fotografiska Shanghai), nominatif avec le passeport : 80 ¥ en semaine, 100 ¥ le week-end.",
  "confidence": "sûr",
  "note": "Ouvert tous les jours, lundi compris. Café-bar 10h–22h, restaurant MONA 11h30–14h30."
 },
 "captain-george": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "19:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "probable",
  "note": "Une seule source (Eatbook, 2026) : horaires à revérifier sur Dianping."
 },
 "labelhood-pillar": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "probable",
  "note": "Pillar et House, tous les jours, lundi compris (sources secondaires)."
 },
 "haus-nowhere": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "sûr",
  "note": "Entrée libre, tous les jours (site Gentle Monster)."
 },
 "jingan-temple": {
  "always": false,
  "closed": [],
  "open": "07:30",
  "close": "17:00",
  "lastEntry": "16:30",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "probable",
  "note": "Billet 50 ¥ au guichet de Nanjing Xi Lu, sans réservation."
 },
 "xintiandi": {
  "always": true,
  "closed": [],
  "open": "",
  "close": "",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "sûr",
  "note": "Allées accessibles en permanence. Boutiques environ 10h–22h, bars et restaurants plus tard."
 },
 "bar-leone-shanghai": {
  "always": false,
  "closed": [],
  "open": "18:00",
  "close": "25:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "Pas de réservation : file d'attente sur place, plus longue le vendredi soir.",
  "confidence": "sûr",
  "note": "Tous les jours 18h–1h."
 },
 "ifc-mall-shanghai": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "22:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "probable",
  "note": "Horaires du mall ; certains restaurants ferment plus tard."
 },
 "flair-ritz-pudong": {
  "always": false,
  "closed": [],
  "open": "17:30",
  "close": "25:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [
   {
    "day": 0,
    "open": "14:00",
    "close": "25:00"
   },
   {
    "day": 6,
    "open": "14:00",
    "close": "25:00"
   }
  ],
  "reservation": "Conseillée pour la terrasse : +86 21 2020 1717 ou OpenTable ; consommation minimum en terrasse (environ 200 à 350 ¥ par personne).",
  "confidence": "probable",
  "note": "Lun.–ven. 17h30–1h, sam.–dim. 14h–1h selon SmartShanghai ; Time Out indique 17h–2h."
 },
 "taian-table": {
  "always": false,
  "closed": [
   0,
   1
  ],
  "open": "18:00",
  "close": "23:00",
  "lastEntry": "20:00",
  "breaks": [],
  "byDay": [],
  "reservation": "Obligatoire sur bookings.taian-table.com (ouverture 90 j avant), acompte non remboursable à moins de 6 j.",
  "confidence": "sûr",
  "note": "Dîner seulement, du mardi au samedi ; arrivées entre 18h et 20h, repas de 2 à 3 h."
 },
 "westbund-pompidou": {
  "always": false,
  "closed": [
   1
  ],
  "open": "11:00",
  "close": "17:00",
  "lastEntry": "16:00",
  "breaks": [],
  "byDay": [],
  "reservation": "Billet nominatif sur le mini-programme WeChat « 上海西岸美术馆预约 », avec le passeport, 1 à 2 j avant (le dimanche est chargé).",
  "confidence": "probable",
  "note": "Sources contradictoires : 10h–17h (fiche du musée) ou 11h–18h (communiqué « Computer Worlds »). Créneau prudent retenu : 11h–17h."
 },
 "shanghai-botanical-garden": {
  "always": false,
  "closed": [],
  "open": "07:00",
  "close": "17:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "probable",
  "note": "Serres, musée du penjing et salle des cymbidiums 8h30–16h30 (billet combiné, environ 40 ¥). Tarifs 2026 non confirmés."
 },
 "da-hu-chun": {
  "always": false,
  "closed": [],
  "open": "08:00",
  "close": "21:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "sûr",
  "note": "Tous les jours (Guide Michelin), sans réservation."
 },
 "heim": {
  "always": false,
  "closed": [
   0,
   1,
   2,
   3,
   4
  ],
  "open": "22:00",
  "close": "28:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "Pas de réservation ; programme et billets éventuels sur le WeChat « heimshanghai » ou SmartShanghai.",
  "confidence": "probable",
  "note": "Soirées ven.–sam. 22h–4h/5h. Le club principal est au B1, 154 Nanyang Lu ; Green Station (Changle Lu) abrite sa salle SAUNA. Adresse à vérifier."
 },
 "china-securities-museum": {
  "always": false,
  "closed": [
   1
  ],
  "open": "09:30",
  "close": "16:00",
  "lastEntry": "15:30",
  "breaks": [],
  "byDay": [],
  "reservation": "Gratuit, réservation probable sur le WeChat « 中国证券博物馆 » avec le passeport (règle actuelle non confirmée, tél. 021-6860 7526).",
  "confidence": "probable",
  "note": "Dernière entrée 15h30 d'après une source de 2019."
 },
 "chenshan-botanical-garden": {
  "always": false,
  "closed": [],
  "open": "08:00",
  "close": "17:00",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "Billet 60 ¥ sur le mini-programme WeChat officiel « 上海辰山植物园 », avec le passeport ; achat le jour même possible.",
  "confidence": "probable",
  "note": "Horaires de novembre à février ; heure de la dernière entrée non publiée."
 },
 "hongqiao-pearl-city": {
  "always": false,
  "closed": [],
  "open": "10:00",
  "close": "20:30",
  "lastEntry": "",
  "breaks": [],
  "byDay": [],
  "reservation": "",
  "confidence": "inconnu",
  "note": "Seule source : un avis de 2014 (10h–20h30, tous les jours). Vérifie sur Dianping avant d'y aller."
 }
};

export const EMERGENCY_SHA: Emergency = {
 "numbers": [
  {
   "label": "Police",
   "number": "110",
   "note": "Gratuit, 24h/24. Opérateurs surtout sinophones : faites parler la réception de l'hôtel ou un passant si possible."
  },
  {
   "label": "Ambulance (SAMU)",
   "number": "120",
   "note": "Gratuit, 24h/24. L'ambulance publique va en général vers l'hôpital public le plus proche. Pour un hôpital international, appelez directement sa ligne d'urgence (Jiahui, United Family, SEIMC) ou prenez un taxi / DiDi."
  },
  {
   "label": "Pompiers",
   "number": "119",
   "note": "Gratuit, 24h/24."
  },
  {
   "label": "Accident de la route",
   "number": "122",
   "note": "Police de la circulation, 24h/24."
  },
  {
   "label": "Hotline municipale de Shanghai (langues étrangères)",
   "number": "12345",
   "note": "Service public 24h/24. Taper 7 pour les langues étrangères (anglais, français et une quinzaine d'autres, selon la mairie). Pour l'anglais : 7 puis #. Pour démarches, plaintes, aide pratique, pas pour une urgence vitale."
  },
  {
   "label": "Consulat de France, astreinte soir et week-end",
   "number": "+86 136 0160 7871",
   "note": "Après 18h et le week-end, urgences graves uniquement (décès, arrestation, agression, hospitalisation). Source : cn.diplomatie.gouv.fr/fr/urgence."
  },
  {
   "label": "Consulat de France, urgence en journée (depuis la Chine)",
   "number": "+852 3057 9000",
   "note": "Numéro d'urgence consulaire pour Shanghai pendant les heures ouvrées (numéro de Hong Kong). Depuis la France : +33 2 14 69 00 03. Ou appel internet gratuit : https://teletech.fr/webrtcbtn?consulat=shanghai."
  },
  {
   "label": "Shanghai Health Hotline",
   "number": "12320",
   "note": "Informations santé (hôpitaux, pharmacies de garde), surtout en chinois."
  }
 ],
 "consulate": {
  "name": "Consulat général de France à Shanghai",
  "address": "Soho Zhongshan Plaza, bâtiment A, 18e étage, 1055 Zhongshan Xi Lu (West Zhongshan Road), Changning, Shanghai 200051",
  "cn": "上海市长宁区中山西路1055号 SOHO中山广场A座18楼",
  "lat": 31.2004555,
  "lng": 121.4105573,
  "phone": "+86 21 6010 6300",
  "emergency": "+86 136 0160 7871",
  "hours": "Lundi à vendredi, 8h40–12h15 et 13h30–16h30 (administration des Français sur rendez-vous uniquement). Vérifier les fermetures pour jours fériés sur le site. · Soir après 18h et week-end : +86 136 0160 7871. En journée : +852 3057 9000 depuis la Chine, +33 2 14 69 00 03 depuis la France, ou appel internet gratuit (https://teletech.fr/webrtcbtn?consulat=shanghai). France Consulaire : lun.–ven. 7h–14h heure de Paris (14h–21h à Shanghai en novembre).",
  "website": "https://cn.diplomatie.gouv.fr/fr/consulat-general-de-france-shanghai"
 },
 "hospitals": [
  {
   "name": "Jiahui International Hospital",
   "cn": "上海嘉会国际医院",
   "address": "689 Guiping Road (près de Qinjiang Road), Xuhui, Shanghai",
   "addressCn": "上海市徐汇区桂平路689号（近钦江路）",
   "lat": 31.177234,
   "lng": 121.3957357,
   "phone": "400 868 3000",
   "er24": true,
   "english": true,
   "directBilling": "Oui : tiers payant avec plus de 70 assureurs selon le site officiel (dont Cigna, Bupa, Allianz, APRIL, AXA, International SOS). Vérifier son assureur avant.",
   "note": "Le plus proche de l'hôtel : environ 1,2 km à vol d'oiseau, 5 min en taxi. Hôpital privé international, urgences 24h/24 et 7j/7, ouvert pendant les fêtes. Numéro 400 : à composer tel quel depuis un téléphone chinois, sans +86. Coordonnées OSM (nœud « 上海嘉会国际医院 », 桂平路)."
  },
  {
   "name": "Shanghai United Family Hospital (Changning)",
   "cn": "上海和睦家医院（长宁）",
   "address": "699 Pingtang Road, Changning, Shanghai 200335",
   "addressCn": "上海市长宁区平塘路699号",
   "lat": 31.2085452,
   "lng": 121.3602478,
   "phone": "+86 21 2216 3999",
   "er24": true,
   "english": true,
   "directBilling": "Oui : tiers payant avec les grands assureurs internationaux (plus de 40 selon des annuaires tiers). À confirmer avec son assureur.",
   "note": "Environ 5,5 km de l'hôtel à vol d'oiseau, 15–20 min en taxi. Urgences 24h/24 avec pédiatre et obstétricien de garde, bloc opératoire et réanimation néonatale. Rendez-vous 24h/24 : 400 639 3900. Certains annuaires anciens donnent 1139 Xianxia Road : pour une urgence, aller au 699 Pingtang Road (adresse du site officiel). Coordonnées OSM."
  },
  {
   "name": "Huashan Worldwide Medical Center (hôpital Huashan, université Fudan)",
   "cn": "复旦大学附属华山医院 国际医疗中心",
   "address": "Bâtiment 1, 8e étage, 12 Wulumuqi Middle Road, Jing'an, Shanghai",
   "addressCn": "上海市静安区乌鲁木齐中路12号 1号楼8层（华山医院国际医疗中心）",
   "lat": 31.2178862,
   "lng": 121.4383771,
   "phone": "+86 21 6248 3986",
   "er24": true,
   "english": true,
   "directBilling": "Partiel : accepte certains assureurs internationaux, à confirmer avec l'assureur. Sinon, paiement sur place puis remboursement.",
   "note": "Environ 7,2 km de l'hôtel à vol d'oiseau, proche de Jing'an et Xintiandi. Grand hôpital public de référence (neurologie, traumatologie). Les urgences générales de l'hôpital sont ouvertes 24h/24, mais le département international anglophone NE l'est PAS : consultations 8h–17h (8e étage, bâtiment 1), soirée jusqu'à 21h selon China Daily. Téléphones du centre international : +86 21 6248 3986 et +86 21 5288 9998, jours ouvrés de 8h à 17h. La nuit, aller directement aux urgences générales (rez-de-chaussée du bâtiment 1). Coordonnées OSM du campus."
  },
  {
   "name": "Shanghai East International Medical Center (SEIMC), Pudong",
   "cn": "上海东方国际医院",
   "address": "Bâtiment B, 23e–24e étages, 551 South Pudong Road (Pudong Nan Lu), Pudong, Shanghai 200120",
   "addressCn": "上海市浦东新区浦东南路551号B楼23–24层",
   "lat": 31.238,
   "lng": 121.508,
   "phone": "+86 21 5879 9999",
   "er24": true,
   "english": true,
   "directBilling": "Oui : tiers payant avec de nombreux assureurs internationaux (plus de 40 selon l'annuaire AustCham). À confirmer.",
   "note": "Pour Pudong (Lujiazui, musée des Sciences et Technologies) : environ 13,5 km de l'hôtel à vol d'oiseau. Médecins occidentaux et chinois, urgences et hospitalisation 24h/24 (urgences de nuit au 23e étage). Seconde ligne : +86 150 0019 0899. Ne pas confondre avec l'hôpital public Shanghai East Hospital (东方医院, 150 Jimo Rd), tout proche. Coordonnées approchées (±150 m), car le n° 551 n'existe pas dans OSM : en face du n° 588 (immeuble SPDB, 31.2373, 121.5073). Appeler à l'arrivée pour l'accès exact."
  }
 ]
};
