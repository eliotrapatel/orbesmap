-- ORBES Trips — Eliot and his father become a normal account with two normal trips (Nov 2026).
-- Run once AFTER saas-8.sql, in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- Safe to run twice. Nothing is deleted: a full copy of everything is saved first (tables backup_20261118_*),
-- the former shared-space access stays in place as a fallback, and nothing an existing phone relies on is removed.
--
-- 1. a backup of the two trips and everything attached to them
-- 2. each trip's full content on the server (what was only in the app's code until now: days, flights, phrases,
--    emergency, check-list, practical info…), the changes already made in the app always winning
-- 3. Eliot owner, his father "can edit" (like any shared trip), Pro for life for both
-- 4. the two trips are no longer excluded from sharing, public links, figures or account deletion

-- 0. the previous file must have run first
do $$
begin
  perform 'public.admin_people(uuid)'::regprocedure;
exception when undefined_function then
  raise exception 'Lancez d''abord supabase/saas-8.sql, puis ce fichier.';
end $$;

-- 1. Backup (made once; a second run keeps the first copy)
create table if not exists public.backup_20261118_trips as select * from public.trips where id in ('sha-2026', 'gz-2026');
create table if not exists public.backup_20261118_places as select * from public.places where trip_id in ('sha-2026', 'gz-2026');
create table if not exists public.backup_20261118_place_states as select * from public.place_states where trip_id in ('sha-2026', 'gz-2026');
create table if not exists public.backup_20261118_contacts as select * from public.contacts where trip_id in ('sha-2026', 'gz-2026');
create table if not exists public.backup_20261118_pins as select * from public.pins where trip_id in ('sha-2026', 'gz-2026');
create table if not exists public.backup_20261118_photos as select * from public.photos where trip_id in ('sha-2026', 'gz-2026');
create table if not exists public.backup_20261118_trip_members as select * from public.trip_members where trip_id in ('sha-2026', 'gz-2026');
create table if not exists public.backup_20261118_members as select * from public.members;
alter table public.backup_20261118_trips enable row level security;
alter table public.backup_20261118_places enable row level security;
alter table public.backup_20261118_place_states enable row level security;
alter table public.backup_20261118_contacts enable row level security;
alter table public.backup_20261118_pins enable row level security;
alter table public.backup_20261118_photos enable row level security;
alter table public.backup_20261118_trip_members enable row level security;
alter table public.backup_20261118_members enable row level security;

-- 2. Each trip's full content: the code's version of every field the server record does not have yet, stamped at
--    1 ms so any change made in the app (now or later) always wins
alter table public.trips disable trigger trips_keep_owner;
with code(id, data) as (values
  ('sha-2026', $orbes${"code": "SHA 2026", "title": "Shanghai", "subtitle": "Voyage", "dateLabel": "24 – 29 novembre 2026", "start": "2026-11-24", "end": "2026-11-29", "timezone": "Asia/Shanghai", "hotel": {"name": "Renaissance Shanghai Caohejing", "lat": 31.16705, "lng": 121.39224, "placeId": "renaissance-caohejing"}, "center": [121.462, 31.214], "days": [{"key": "base", "short": "Hôtel", "title": "Hôtel", "theme": "Base du séjour", "color": "#f6f2ea", "glyph": "H", "scheduled": false}, {"key": "d1", "short": "Mar 24", "title": "Jour 1", "theme": "Arrivée", "dates": ["2026-11-24"], "glyph": "1", "scheduled": true, "color": "#8CB4E8"}, {"key": "d2", "short": "Mer 25", "title": "Jour 2", "theme": "Tailleur, vieille ville, art du Bund", "dates": ["2026-11-25"], "glyph": "2", "scheduled": true, "color": "#B7A3E6"}, {"key": "d3", "short": "Jeu 26", "title": "Jour 3", "theme": "Suzhou", "dates": ["2026-11-26"], "glyph": "3", "scheduled": true, "color": "#E8B07A"}, {"key": "d4", "short": "Ven 27", "title": "Jour 4", "theme": "Concept stores, puis soirée à Fuxing Lu", "dates": ["2026-11-27"], "glyph": "4", "scheduled": true, "color": "#7FD1B9"}, {"key": "d5", "short": "Sam 28", "title": "Jour 5", "theme": "Pudong, puis Columbia Circle et Taian Table", "dates": ["2026-11-28"], "glyph": "5", "scheduled": true, "color": "#EE8F8F"}, {"key": "d6", "short": "Dim 29", "title": "Jour 6", "theme": "West Bund, Longhua, jardin botanique, départ", "dates": ["2026-11-29"], "glyph": "6", "scheduled": true, "color": "#D8C47E"}, {"key": "lifestyle", "short": "Sorties", "title": "Sorties", "theme": "Bars, restaurants, adresses du soir", "glyph": "♦", "scheduled": false, "color": "#D8C47E"}, {"key": "ideas", "short": "Pistes", "title": "Pistes", "theme": "À voir si le temps le permet", "glyph": "+", "scheduled": false, "color": "#9A958D"}], "flights": [{"airline": "Air France", "code": "AF116", "from": "CDG", "to": "PVG", "fromCity": "Paris", "toCity": "Shanghai", "at": "2026-11-24T19:00:00+08:00", "departAt": "2026-11-23T23:20:00+01:00", "arriveAt": "2026-11-24T19:00:00+08:00", "terminal": "CDG 2E → PVG T1", "kind": "arrival"}, {"airline": "Air France", "code": "AF111", "from": "PVG", "to": "CDG", "fromCity": "Shanghai", "toCity": "Paris", "at": "2026-11-29T22:15:00+08:00", "departAt": "2026-11-29T22:15:00+08:00", "arriveAt": "2026-11-30T05:50:00+01:00", "terminal": "PVG T1 → CDG 2E", "kind": "departure"}], "phrases": [{"title": "Musées et réservations", "items": [{"zh": "我想买两张门票", "pinyin": "Wǒ xiǎng mǎi liǎng zhāng ménpiào", "fr": "Je voudrais deux billets d'entrée"}, {"zh": "需要提前预约吗？", "pinyin": "Xūyào tíqián yùyuē ma?", "fr": "Faut-il réserver à l'avance ?"}, {"zh": "我用护照预约了", "pinyin": "Wǒ yòng hùzhào yùyuē le", "fr": "J'ai réservé avec mon passeport"}, {"zh": "可以拍照吗？", "pinyin": "Kěyǐ pāizhào ma?", "fr": "Je peux prendre des photos ?"}, {"zh": "老人有优惠吗？", "pinyin": "Lǎorén yǒu yōuhuì ma?", "fr": "Y a-t-il un tarif senior ?"}]}, {"title": "Restaurant et paiement", "items": [{"zh": "我想订今晚七点，两位", "pinyin": "Wǒ xiǎng dìng jīnwǎn qī diǎn, liǎng wèi", "fr": "Je voudrais réserver ce soir à 19h pour deux"}, {"zh": "有英文菜单吗？", "pinyin": "Yǒu Yīngwén càidān ma?", "fr": "Avez-vous un menu en anglais ?"}, {"zh": "你们的招牌菜是什么？", "pinyin": "Nǐmen de zhāopái cài shì shénme?", "fr": "Quel est votre plat signature ?"}, {"zh": "不要太辣", "pinyin": "Bú yào tài là", "fr": "Pas trop épicé, s'il vous plaît"}, {"zh": "买单，可以用支付宝吗？", "pinyin": "Mǎidān, kěyǐ yòng Zhīfùbǎo ma?", "fr": "L'addition ; je peux payer avec Alipay ?"}, {"zh": "我扫你还是你扫我？", "pinyin": "Wǒ sǎo nǐ háishì nǐ sǎo wǒ?", "fr": "Je scanne votre QR code ou vous scannez le mien ?"}, {"zh": "我有预订，名字是……", "pinyin": "Wǒ yǒu yùdìng, míngzi shì…", "fr": "J'ai une réservation au nom de…"}]}, {"title": "Tailleur, cuir et textile", "items": [{"zh": "这是真皮吗？什么皮？", "pinyin": "Zhè shì zhēnpí ma? Shénme pí?", "fr": "C'est du vrai cuir ? Quel cuir ?"}, {"zh": "这是什么面料？羊绒还是羊毛？", "pinyin": "Zhè shì shénme miànliào? Yángróng háishì yángmáo?", "fr": "Quel est ce tissu ? Cachemire ou laine ?"}, {"zh": "可以定做吗？要多久？", "pinyin": "Kěyǐ dìngzuò ma? Yào duōjiǔ?", "fr": "Vous faites du sur-mesure ? Il faut combien de temps ?"}, {"zh": "请帮我量一下尺寸", "pinyin": "Qǐng bāng wǒ liáng yíxià chǐcùn", "fr": "Pouvez-vous prendre mes mesures ?"}, {"zh": "能便宜一点吗？", "pinyin": "Néng piányi yìdiǎn ma?", "fr": "Vous pouvez faire un meilleur prix ?"}]}, {"title": "Trains et aéroport", "items": [{"zh": "师傅，去虹桥火车站", "pinyin": "Shīfu, qù Hóngqiáo huǒchēzhàn", "fr": "Chauffeur, à la gare de Hongqiao s'il vous plaît"}, {"zh": "检票口在哪里？", "pinyin": "Jiǎnpiàokǒu zài nǎlǐ?", "fr": "Où est le contrôle des billets ?"}, {"zh": "我要去浦东机场一号航站楼", "pinyin": "Wǒ yào qù Pǔdōng jīchǎng yī hào hángzhànlóu", "fr": "Je vais à l'aéroport de Pudong, terminal 1"}]}, {"title": "Taxi / DiDi", "items": [{"zh": "请带我去这个地址", "pinyin": "Qǐng dài wǒ qù zhège dìzhǐ", "fr": "Emmenez-moi à cette adresse"}, {"zh": "请打表", "pinyin": "Qǐng dǎ biǎo", "fr": "Mettez le compteur s'il vous plaît"}, {"zh": "在这里停车，谢谢", "pinyin": "Zài zhèlǐ tíngchē, xièxie", "fr": "Arrêtez-vous ici, merci"}, {"zh": "还要多久？", "pinyin": "Hái yào duōjiǔ?", "fr": "Combien de temps encore ?"}, {"zh": "我赶时间", "pinyin": "Wǒ gǎn shíjiān", "fr": "Je suis pressé"}]}, {"title": "Général", "items": [{"zh": "你好", "pinyin": "Nǐ hǎo", "fr": "Bonjour"}, {"zh": "谢谢", "pinyin": "Xièxie", "fr": "Merci"}, {"zh": "对不起", "pinyin": "Duìbuqǐ", "fr": "Désolé / Excusez-moi"}, {"zh": "我不会说中文", "pinyin": "Wǒ bú huì shuō zhōngwén", "fr": "Je ne parle pas chinois"}, {"zh": "请用微信付款", "pinyin": "Qǐng yòng wēixìn fùkuǎn", "fr": "Paiement par WeChat svp"}, {"zh": "洗手间在哪里？", "pinyin": "Xǐshǒujiān zài nǎlǐ?", "fr": "Où sont les toilettes ?"}, {"zh": "可以用英文吗？", "pinyin": "Kěyǐ yòng yīngwén ma?", "fr": "Peut-on parler anglais ?"}]}], "zones": [{"label": "Bund & Lujiazui", "center": [121.493, 31.238], "zoom": 14}, {"label": "Jing'an · Nanjing Xi Lu", "center": [121.452, 31.229], "zoom": 15}, {"label": "Concession française", "center": [121.448, 31.215], "zoom": 14.5}, {"label": "West Bund · Longhua", "center": [121.455, 31.172], "zoom": 14}, {"label": "Caohejing (hôtel)", "center": [121.392, 31.167], "zoom": 14.5}, {"label": "Changning · Columbia Circle", "center": [121.425, 31.217], "zoom": 15}, {"label": "Suzhou", "center": [120.612, 31.322], "zoom": 13}], "practical": [{"title": "Arrivée et aéroport", "text": "AF116 décolle de CDG 2E le lundi 23/11 à 23h20 et atterrit à PVG T1 le mardi 24/11 à 19h00. Compte 30 à 60 min d'immigration. Taxi officiel ou DiDi (panneaux « 网约车 ») jusqu'à l'hôtel : ~48 km, 50-70 min, 150-210 ¥ ; arrivée vers 21h, room service ou bar de l'hôtel. Ignore les rabatteurs du hall. Retour : AF111 part de PVG T1 le dimanche 29/11 à 22h15 (arrivée CDG 05h50 le lundi 30) ; enregistrement fermé vers 21h15, quitte l'hôtel à 18h30."}, {"title": "Entrée en Chine", "text": "Exemption de visa de 30 jours pour les passeports français jusqu'au 31/12/2026, pour toi comme pour ton père. Passeport valable au moins 6 mois après la sortie. Remplis la carte d'arrivée électronique avant le départ (s.nia.gov.cn, appli NIA 12367 ou mini-programme WeChat/Alipay ; c'est gratuit, méfie-toi des faux sites). Pas d'assurance exigée à l'entrée sans visa, mais prends-en une qui couvre les frais médicaux et le rapatriement, surtout pour ton père. Franchise : 2 000 ¥ de marchandises, 1,5 l d'alcool, 400 cigarettes."}, {"title": "Paiement", "text": "Presque tout se paie par QR code. Lie ta Visa/Mastercard à Alipay (et WeChat Pay) avant de partir, avec ton passeport ; garde l'itinérance active pour le SMS. Frais Alipay : 3 % au-delà de 200 ¥ par paiement. Garde 500-1 000 ¥ en liquide pour le marché aux tissus et une carte physique pour les hôtels et boutiques de luxe. Pas de pourboire, sauf service déjà inclus (10-15 %) dans le haut de gamme."}, {"title": "Internet et VPN", "text": "Gmail, WhatsApp, Instagram et Google Maps sont bloqués sur le réseau chinois. Le plus simple : une eSIM de voyage routée hors de Chine (Airalo, Holafly, Nomad…) ou l'itinérance de ton opérateur, qui passent sans VPN. Installe quand même un VPN avant de partir pour le Wi-Fi de l'hôtel. Applis à télécharger avant : Alipay, WeChat, DiDi, Amap, Metro大都会, 12306, Trip.com, Dianping, un traducteur hors ligne."}, {"title": "Transports et trains", "text": "DiDi (appli internationale ou via Alipay) : colle toujours l'adresse en chinois. Métro de 5h30 à 23h environ, 3-10 ¥, sans contact Visa/Mastercard accepté partout depuis juin 2025. TGV pour Suzhou : réserve sur 12306 (appli en anglais) ou Trip.com dès l'ouverture des ventes, 15 jours avant ; le passeport sert de billet, sécurité à l'entrée, prévois 30-45 min à Hongqiao. Prends la 1re classe pour ton père."}, {"title": "Météo et automne", "text": "Fin novembre : 8-16 °C, humide, quelques jours de pluie fine, soirées vers 8-12 °C sur les rooftops. Veste chaude, pull, parapluie, bonnes chaussures. Coucher du soleil vers 16h50. C'est le pic des ginkgos et des érables : jardin botanique, West Bund, Wukang Lu, Fenyang Lu, Suzhou. Regarde l'indice de qualité de l'air avant la Shanghai Tower."}, {"title": "Urgences", "text": "Police 110, ambulance 120, pompiers 119, hotline municipale en anglais 12345. Consulat général de France : Soho Zhongshan Plaza, 18e étage, 1055 Zhongshan Xi Lu (Changning), +86 21 6010 6300. Inscris-toi sur Ariane, ton père aussi. Hôtel : +86 21 3325 8888. Prises 220 V types A, C et I : prends un adaptateur universel."}, {"title": "Réservations et fermetures", "text": "Dès maintenant : Taian Table (sam. 28, 19h55, arrivée avant 20h), Canton Table (mer. 25, 18h15), Fu He Hui (jeu. 26, 19h40), Old Jesse (dim. 29, 13h15), Lei Garden et Lao Zheng Xing : fais passer la conciergerie du Renaissance. Dès l'ouverture des ventes : TGV Hongqiao → Suzhou le jeu. 26 vers 7h45, retour Suzhou → gare de Shanghai vers 16h30 (ventes 15 jours avant, donc dès le 11/11, au passeport), Suzhou Museum (créneau du 26 vers 10h30, ouvre 7 jours avant), The Louis (« My LV », ven. 27 vers 17h05). La semaine d'avant, au passeport sur WeChat : West Bund Museum, Fotografiska, Shanghai Tower, Shanghai Museum de People's Square (mer. 25, 9h), Science and Technology Museum (sam. 28, 12h40, compte sstm01). Tailleur : commande mer. 25 vers 11h10, essayage sam. 28, retrait dim. 29. Fermetures à connaître : Shanghai Museum East fermé le mardi, Terrace 9:15 ouverte lun.–jeu., Perrotin mar.–sam., Rockbund mer.–dim., Taian Table fermé dim. et lun. Bar Leone ne prend pas de réservation. Check-out le dim. 29 à 12h : bagages à la conciergerie."}], "emergency": {"numbers": [{"label": "Police", "number": "110", "note": "Gratuit, 24h/24. Opérateurs surtout sinophones : faites parler la réception de l'hôtel ou un passant si possible."}, {"label": "Ambulance (SAMU)", "number": "120", "note": "Gratuit, 24h/24. L'ambulance publique va en général vers l'hôpital public le plus proche. Pour un hôpital international, appelez directement sa ligne d'urgence (Jiahui, United Family, SEIMC) ou prenez un taxi / DiDi."}, {"label": "Pompiers", "number": "119", "note": "Gratuit, 24h/24."}, {"label": "Accident de la route", "number": "122", "note": "Police de la circulation, 24h/24."}, {"label": "Hotline municipale de Shanghai (langues étrangères)", "number": "12345", "note": "Service public 24h/24. Taper 7 pour les langues étrangères (anglais, français et une quinzaine d'autres, selon la mairie). Pour l'anglais : 7 puis #. Pour démarches, plaintes, aide pratique, pas pour une urgence vitale."}, {"label": "Consulat de France, astreinte soir et week-end", "number": "+86 136 0160 7871", "note": "Après 18h et le week-end, urgences graves uniquement (décès, arrestation, agression, hospitalisation). Source : cn.diplomatie.gouv.fr/fr/urgence."}, {"label": "Consulat de France, urgence en journée (depuis la Chine)", "number": "+852 3057 9000", "note": "Numéro d'urgence consulaire pour Shanghai pendant les heures ouvrées (numéro de Hong Kong). Depuis la France : +33 2 14 69 00 03. Ou appel internet gratuit : https://teletech.fr/webrtcbtn?consulat=shanghai."}, {"label": "Shanghai Health Hotline", "number": "12320", "note": "Informations santé (hôpitaux, pharmacies de garde), surtout en chinois."}], "consulate": {"name": "Consulat général de France à Shanghai", "address": "Soho Zhongshan Plaza, bâtiment A, 18e étage, 1055 Zhongshan Xi Lu (West Zhongshan Road), Changning, Shanghai 200051", "cn": "上海市长宁区中山西路1055号 SOHO中山广场A座18楼", "lat": 31.2004555, "lng": 121.4105573, "phone": "+86 21 6010 6300", "emergency": "+86 136 0160 7871", "hours": "Lundi à vendredi, 8h40–12h15 et 13h30–16h30 (administration des Français sur rendez-vous uniquement). Vérifier les fermetures pour jours fériés sur le site. · Soir après 18h et week-end : +86 136 0160 7871. En journée : +852 3057 9000 depuis la Chine, +33 2 14 69 00 03 depuis la France, ou appel internet gratuit (https://teletech.fr/webrtcbtn?consulat=shanghai). France Consulaire : lun.–ven. 7h–14h heure de Paris (14h–21h à Shanghai en novembre).", "website": "https://cn.diplomatie.gouv.fr/fr/consulat-general-de-france-shanghai"}, "hospitals": [{"name": "Jiahui International Hospital", "cn": "上海嘉会国际医院", "address": "689 Guiping Road (près de Qinjiang Road), Xuhui, Shanghai", "addressCn": "上海市徐汇区桂平路689号（近钦江路）", "lat": 31.177234, "lng": 121.3957357, "phone": "400 868 3000", "er24": true, "english": true, "directBilling": "Oui : tiers payant avec plus de 70 assureurs selon le site officiel (dont Cigna, Bupa, Allianz, APRIL, AXA, International SOS). Vérifier son assureur avant.", "note": "Le plus proche de l'hôtel : environ 1,2 km à vol d'oiseau, 5 min en taxi. Hôpital privé international, urgences 24h/24 et 7j/7, ouvert pendant les fêtes. Numéro 400 : à composer tel quel depuis un téléphone chinois, sans +86. Coordonnées OSM (nœud « 上海嘉会国际医院 », 桂平路)."}, {"name": "Shanghai United Family Hospital (Changning)", "cn": "上海和睦家医院（长宁）", "address": "699 Pingtang Road, Changning, Shanghai 200335", "addressCn": "上海市长宁区平塘路699号", "lat": 31.2085452, "lng": 121.3602478, "phone": "+86 21 2216 3999", "er24": true, "english": true, "directBilling": "Oui : tiers payant avec les grands assureurs internationaux (plus de 40 selon des annuaires tiers). À confirmer avec son assureur.", "note": "Environ 5,5 km de l'hôtel à vol d'oiseau, 15–20 min en taxi. Urgences 24h/24 avec pédiatre et obstétricien de garde, bloc opératoire et réanimation néonatale. Rendez-vous 24h/24 : 400 639 3900. Certains annuaires anciens donnent 1139 Xianxia Road : pour une urgence, aller au 699 Pingtang Road (adresse du site officiel). Coordonnées OSM."}, {"name": "Huashan Worldwide Medical Center (hôpital Huashan, université Fudan)", "cn": "复旦大学附属华山医院 国际医疗中心", "address": "Bâtiment 1, 8e étage, 12 Wulumuqi Middle Road, Jing'an, Shanghai", "addressCn": "上海市静安区乌鲁木齐中路12号 1号楼8层（华山医院国际医疗中心）", "lat": 31.2178862, "lng": 121.4383771, "phone": "+86 21 6248 3986", "er24": true, "english": true, "directBilling": "Partiel : accepte certains assureurs internationaux, à confirmer avec l'assureur. Sinon, paiement sur place puis remboursement.", "note": "Environ 7,2 km de l'hôtel à vol d'oiseau, proche de Jing'an et Xintiandi. Grand hôpital public de référence (neurologie, traumatologie). Les urgences générales de l'hôpital sont ouvertes 24h/24, mais le département international anglophone NE l'est PAS : consultations 8h–17h (8e étage, bâtiment 1), soirée jusqu'à 21h selon China Daily. Téléphones du centre international : +86 21 6248 3986 et +86 21 5288 9998, jours ouvrés de 8h à 17h. La nuit, aller directement aux urgences générales (rez-de-chaussée du bâtiment 1). Coordonnées OSM du campus."}, {"name": "Shanghai East International Medical Center (SEIMC), Pudong", "cn": "上海东方国际医院", "address": "Bâtiment B, 23e–24e étages, 551 South Pudong Road (Pudong Nan Lu), Pudong, Shanghai 200120", "addressCn": "上海市浦东新区浦东南路551号B楼23–24层", "lat": 31.238, "lng": 121.508, "phone": "+86 21 5879 9999", "er24": true, "english": true, "directBilling": "Oui : tiers payant avec de nombreux assureurs internationaux (plus de 40 selon l'annuaire AustCham). À confirmer.", "note": "Pour Pudong (Lujiazui, musée des Sciences et Technologies) : environ 13,5 km de l'hôtel à vol d'oiseau. Médecins occidentaux et chinois, urgences et hospitalisation 24h/24 (urgences de nuit au 23e étage). Seconde ligne : +86 150 0019 0899. Ne pas confondre avec l'hôpital public Shanghai East Hospital (东方医院, 150 Jimo Rd), tout proche. Coordonnées approchées (±150 m), car le n° 551 n'existe pas dans OSM : en face du n° 588 (immeuble SPDB, 31.2373, 121.5073). Appeler à l'arrivée pour l'accès exact."}]}, "checklist": [{"id": "tgv", "text": "Billets TGV Hongqiao → Suzhou jeu. 26 (~7h45) et retour Suzhou → gare de Shanghai (~16h30), au passeport", "due": "2026-11-12", "group": "Réservations"}, {"id": "taian", "text": "Taian Table · sam. 28 à 19h55 (arrivée avant 20h)", "due": "2026-11-14", "group": "Réservations"}, {"id": "fuhehui", "text": "Fu He Hui · jeu. 26 à 19h40", "due": "2026-11-16", "group": "Réservations"}, {"id": "canton", "text": "Canton Table · mer. 25 à 18h15", "due": "2026-11-16", "group": "Réservations"}, {"id": "oldjesse", "text": "Old Jesse · dim. 29 à 13h15", "due": "2026-11-18", "group": "Réservations"}, {"id": "suzhoumuseum", "text": "Suzhou Museum · créneau du jeu. 26 vers 10h30 (ouvre 7 jours avant)", "due": "2026-11-19", "group": "Réservations"}, {"id": "louis", "text": "LV The Louis · créneau « My LV » ven. 27 vers 17h05 (mini-programme WeChat)", "due": "2026-11-20", "group": "Réservations"}, {"id": "museums", "text": "Billets WeChat au passeport : Shanghai Museum (mer. 25, 9h), Science and Technology Museum (sam. 28), West Bund Museum, Fotografiska, Shanghai Tower", "due": "2026-11-21", "group": "Réservations"}, {"id": "nia", "text": "Carte d'arrivée électronique (s.nia.gov.cn ou appli NIA 12367), pour chacun", "due": "2026-11-22", "group": "Entrée en Chine"}, {"id": "passport", "text": "Passeports valides au moins 6 mois après le retour", "due": "2026-11-15", "group": "Entrée en Chine"}, {"id": "ariane", "text": "Inscription Ariane (France Diplomatie), pour chacun", "due": "2026-11-22", "group": "Entrée en Chine"}, {"id": "insurance", "text": "Assurance voyage (frais médicaux + rapatriement) : la noter dans la fiche Urgence", "due": "2026-11-20", "group": "Entrée en Chine"}, {"id": "alipay", "text": "Alipay : carte bancaire liée et identité vérifiée au passeport", "due": "2026-11-20", "group": "Paiement et téléphone"}, {"id": "wechat", "text": "WeChat Pay activé (carte liée)", "due": "2026-11-20", "group": "Paiement et téléphone"}, {"id": "cash", "text": "500 à 1 000 ¥ en liquide (tailleur, petits stands)", "due": "2026-11-22", "group": "Paiement et téléphone"}, {"id": "esim", "text": "eSIM de voyage installée (ou itinérance activée) : Google et WhatsApp passent sans VPN", "due": "2026-11-21", "group": "Paiement et téléphone"}, {"id": "vpn", "text": "VPN installé (pour le Wi-Fi de l'hôtel)", "due": "2026-11-21", "group": "Paiement et téléphone"}, {"id": "apps", "text": "Applis : Amap, DiDi, Metro大都会, Trip.com, Dianping, un traducteur hors ligne", "due": "2026-11-21", "group": "Paiement et téléphone"}, {"id": "offline", "text": "Carte hors ligne préparée dans l'app (onglet Infos, en Wi-Fi)", "due": "2026-11-22", "group": "Paiement et téléphone"}, {"id": "login", "text": "Connecté à l'app (onglet Compte) sur chaque téléphone", "due": "2026-11-20", "group": "Paiement et téléphone"}, {"id": "adapter", "text": "Adaptateur universel et batterie externe", "due": "2026-11-22", "group": "Valise"}, {"id": "tailor", "text": "Veste de référence et photos pour le tailleur", "due": "2026-11-22", "group": "Valise"}, {"id": "warm", "text": "Veste chaude, pull, parapluie, bonnes chaussures (8–16 °C, pluie fine)", "due": "2026-11-22", "group": "Valise"}], "country": "cn", "travellers": ["Eliot", "Papa"]}$orbes$::jsonb),
  ('gz-2026', $orbes${"code": "GZ 2026", "title": "Guangzhou", "subtitle": "Voyage de sourcing", "dateLabel": "7 – 13 juin 2026", "start": "2026-06-07", "end": "2026-06-13", "timezone": "Asia/Shanghai", "hotel": {"name": "Sofitel Guangzhou Sunrich", "lat": 23.1393, "lng": 113.3163, "placeId": "hotel"}, "center": [113.28, 23.125], "days": [{"key": "base", "short": "Hôtel", "title": "Hôtel", "theme": "Base du séjour", "color": "#f6f2ea", "glyph": "H", "scheduled": false}, {"key": "d1", "short": "Jour 1", "title": "Jour 1", "theme": "Zhanqian, marchés de gros", "dates": ["2026-06-07"], "color": "#8CB4E8", "glyph": "1", "scheduled": true}, {"key": "d2", "short": "Jour 2", "title": "Jour 2", "theme": "Liwan, fabricants et pierres", "dates": ["2026-06-08"], "color": "#B7A3E6", "glyph": "2", "scheduled": true}, {"key": "d3", "short": "Dongguan", "title": "Jour 3", "theme": "Dongguan Chang'an, usines", "dates": ["2026-06-09"], "color": "#E8B07A", "glyph": "3", "scheduled": true}, {"key": "d45", "short": "Style GZ", "title": "Jours 4 et 5", "theme": "Salon Style GZ, Canton Fair", "dates": ["2026-06-10", "2026-06-11"], "color": "#7FD1B9", "glyph": "4", "scheduled": true}, {"key": "d6", "short": "Jour 6", "title": "Jour 6", "theme": "Hongmian et Dongshankou", "dates": ["2026-06-12"], "color": "#EE8F8F", "glyph": "6", "scheduled": true}, {"key": "lifestyle", "short": "Sorties", "title": "Sorties", "theme": "Bars, restaurants, inspiration", "color": "#D8C47E", "glyph": "♦", "scheduled": false}, {"key": "ideas", "short": "Pistes", "title": "Pistes", "theme": "À voir si le temps le permet", "color": "#9A958D", "glyph": "+", "scheduled": false}], "flights": [{"code": "CX950", "airline": "Cathay Pacific", "from": "HKG", "to": "CAN", "fromCity": "Hong Kong", "toCity": "Guangzhou", "at": "2026-06-07T02:20:00+08:00", "arriveAt": "2026-06-07T02:20:00+08:00", "kind": "arrival"}, {"code": "CX953", "airline": "Cathay Pacific", "from": "CAN", "to": "HKG", "fromCity": "Guangzhou", "toCity": "Hong Kong", "at": "2026-06-13T05:00:00+08:00", "departAt": "2026-06-13T05:00:00+08:00", "kind": "departure"}], "phrases": [{"title": "Taxi / DiDi", "items": [{"zh": "请带我去这个地址", "pinyin": "Qǐng dài wǒ qù zhège dìzhǐ", "fr": "Emmenez-moi à cette adresse"}, {"zh": "请打表", "pinyin": "Qǐng dǎ biǎo", "fr": "Mettez le compteur s'il vous plaît"}, {"zh": "在这里停车，谢谢", "pinyin": "Zài zhèlǐ tíngchē, xièxie", "fr": "Arrêtez-vous ici, merci"}, {"zh": "还要多久？", "pinyin": "Hái yào duōjiǔ?", "fr": "Combien de temps encore ?"}, {"zh": "我赶时间", "pinyin": "Wǒ gǎn shíjiān", "fr": "Je suis pressé"}]}, {"title": "Négociation / Achat", "items": [{"zh": "这个多少钱？", "pinyin": "Zhège duōshao qián?", "fr": "Combien ça coûte ?"}, {"zh": "太贵了，能便宜一点吗？", "pinyin": "Tài guì le, néng piányi yìdiǎn ma?", "fr": "C'est trop cher, un peu moins ?"}, {"zh": "最小起订量是多少？", "pinyin": "Zuìxiǎo qǐdìng liàng shì duōshao?", "fr": "Quel est le MOQ ?"}, {"zh": "可以定制吗？", "pinyin": "Kěyǐ dìngzhì ma?", "fr": "Pouvez-vous faire du sur-mesure ?"}, {"zh": "可以做我们的品牌吗？", "pinyin": "Kěyǐ zuò wǒmen de pǐnpái ma?", "fr": "Faites-vous le private label ?"}, {"zh": "交货期多久？", "pinyin": "Jiāohuò qī duōjiǔ?", "fr": "Quel est le délai de livraison ?"}, {"zh": "可以发样品吗？", "pinyin": "Kěyǐ fā yàngpǐn ma?", "fr": "Pouvez-vous envoyer un échantillon ?"}, {"zh": "加我微信", "pinyin": "Jiā wǒ wēixìn", "fr": "Ajoutez-moi sur WeChat"}]}, {"title": "Sourcing / Usine", "items": [{"zh": "你们用316不锈钢吗？", "pinyin": "Nǐmen yòng 316 bùxiùgāng ma?", "fr": "Utilisez-vous de l'acier 316L ?"}, {"zh": "你们做PVD电镀吗？", "pinyin": "Nǐmen zuò PVD diàndù ma?", "fr": "Faites-vous le placage PVD ?"}, {"zh": "我可以参观工厂吗？", "pinyin": "Wǒ kěyǐ cānguān gōngchǎng ma?", "fr": "Puis-je visiter l'usine ?"}, {"zh": "你们能根据3D文件生产吗？", "pinyin": "Nǐmen néng gēnjù 3D wénjiàn shēngchǎn ma?", "fr": "Produisez-vous à partir de fichiers 3D ?"}, {"zh": "我在开发一个新品牌", "pinyin": "Wǒ zài kāifā yí gè xīn pǐnpái", "fr": "Je développe une nouvelle marque"}]}, {"title": "Général", "items": [{"zh": "你好", "pinyin": "Nǐ hǎo", "fr": "Bonjour"}, {"zh": "谢谢", "pinyin": "Xièxie", "fr": "Merci"}, {"zh": "对不起", "pinyin": "Duìbuqǐ", "fr": "Désolé / Excusez-moi"}, {"zh": "我不会说中文", "pinyin": "Wǒ bú huì shuō zhōngwén", "fr": "Je ne parle pas chinois"}, {"zh": "请用微信付款", "pinyin": "Qǐng yòng wēixìn fùkuǎn", "fr": "Paiement par WeChat svp"}, {"zh": "洗手间在哪里？", "pinyin": "Xǐshǒujiān zài nǎlǐ?", "fr": "Où sont les toilettes ?"}, {"zh": "可以用英文吗？", "pinyin": "Kěyǐ yòng yīngwén ma?", "fr": "Peut-on parler anglais ?"}]}], "zones": [{"label": "Guangzhou", "center": [113.27, 23.125], "zoom": 11.5}, {"label": "Dongguan", "center": [113.734, 22.817], "zoom": 13}, {"label": "Shenzhen", "center": [113.93, 22.534], "zoom": 11.5}], "country": "cn", "travellers": ["Eliot", "Papa"]}$orbes$::jsonb)
)
insert into public.trips (id, data, updated_at)
select c.id, c.data || jsonb_build_object('fieldsAt', (select jsonb_object_agg(k, 1) from jsonb_object_keys(c.data) k), 'updatedAt', 1), now() from code c
on conflict (id) do update set
  data = (select c.data from code c where c.id = excluded.id) || public.trips.data || jsonb_build_object('fieldsAt',
           coalesce((select jsonb_object_agg(k, 1) from code c, jsonb_object_keys(c.data) k where c.id = excluded.id and not public.trips.data ? k), '{}'::jsonb)
           || coalesce(public.trips.data -> 'fieldsAt', '{}'::jsonb)),
  updated_at = now();

-- 3. The travellers: Eliot owner (the admin), his father "can edit"; the trips' owner; Pro for life
insert into public.trip_members (trip_id, user_id, role)
select v.tid, u.id, case when exists (select 1 from public.admins a where a.user_id = u.id) then 'owner' else 'editor' end
from (values ('sha-2026'), ('gz-2026')) v(tid)
join public.members m on true
join auth.users u on lower(u.email) = lower(m.email)
on conflict (trip_id, user_id) do update set role = excluded.role;
update public.trips x set owner = (select m.user_id from public.trip_members m where m.trip_id = x.id and m.role = 'owner' limit 1)
where x.id in ('sha-2026', 'gz-2026');
alter table public.trips enable trigger trips_keep_owner;
insert into public.pro_grants (user_id, until, source, updated_at)
select u.id, null, 'migration', now() from public.members m join auth.users u on lower(u.email) = lower(m.email)
on conflict (user_id) do update set until = null, source = 'migration', updated_at = now();

-- 4. No more exceptions for the two trips
drop policy if exists "invites create" on public.trip_invites;
create policy "invites create" on public.trip_invites for insert to authenticated
  with check (
    (select public.can_manage_trip(trip_id))
    and email = lower(trim(email)) and position('@' in email) > 1
    and invited_by = auth.uid() and (select public.invites_left(trip_id))
  );

create or replace function public.my_owned_trip_ids()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select m.trip_id from public.trip_members m
  where m.user_id = auth.uid() and m.role = 'owner';
$$;

create or replace function public.open_trip_link(p_trip text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  s text;
begin
  if not public.can_manage_trip(p_trip) then
    raise exception 'owner only' using errcode = '42501';
  end if;
  select slug into s from public.trip_links where trip_id = p_trip;
  if s is null then
    s := substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 14);
    insert into public.trip_links (trip_id, slug) values (p_trip, s);
  else
    update public.trip_links set active = true where trip_id = p_trip;
  end if;
  return s;
end;
$$;

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'accounts', (select count(*) from auth.users),
    'accounts7', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'trips', (select count(*) from public.trips),
    'trips7', (select count(*) from public.trips where created_at > now() - interval '7 days'),
    'prepared30', (select count(*) from public.prepared_trips where at > now() - interval '30 days'),
    'pro', (select count(*) from public.pro_grants where until is null or until > now()),
    'waitlist', (select count(*) from public.waitlist),
    'aiToday', (select count(*) from public.ai_usage where at > now() - interval '24 hours'),
    'usdToday', (select coalesce(sum(usd), 0) from public.ai_usage where at > now() - interval '24 hours'),
    'usd30', (select coalesce(sum(usd), 0) from public.ai_usage where at > now() - interval '30 days'),
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'calls', n, 'usd', u) order by d)
      from (select date_trunc('day', at)::date d, count(*) n, sum(usd) u from public.ai_usage
            where at > now() - interval '30 days' group by 1) s), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_people(p_user uuid default null)
returns table (user_id uuid, email text, created_at timestamptz, last_seen timestamptz, profile jsonb, trips jsonb, spend jsonb,
               expenses int, flights jsonb, hotels jsonb, places jsonb, seen jsonb, pro boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  return query
  with mine as (
    select m.user_id as uid, t.id as tid, t.data as td
    from public.trip_members m join public.trips t on t.id = m.trip_id
    where (p_user is null or m.user_id = p_user)
  ),
  exp as (
    select mi.uid, coalesce(nullif(s.data ->> 'category', ''), 'other') as cat,
           case when s.data ->> 'eur' ~ '^-?\d+(\.\d+)?$' then (s.data ->> 'eur')::numeric
                when s.data ->> 'currency' = 'EUR' and s.data ->> 'amount' ~ '^-?\d+(\.\d+)?$' then (s.data ->> 'amount')::numeric else 0 end as eur
    from mine mi join public.place_states s on s.trip_id = mi.tid
    where s.place_id like '\_exp:%' and coalesce(s.data ->> 'deleted', 'false') <> 'true'
  )
  select u.id, u.email::text, u.created_at, u.last_sign_in_at,
         coalesce(p.data, '{}'::jsonb) - 'fieldsAt',
         coalesce((select jsonb_agg(jsonb_build_object('id', mi.tid, 'title', mi.td ->> 'title', 'country', mi.td ->> 'country',
                   'start', mi.td ->> 'start', 'end', mi.td ->> 'end', 'mode', coalesce(mi.td ->> 'mode', 'leisure'),
                   'days', case when mi.td ->> 'start' ~ '^\d{4}-\d{2}-\d{2}$' and mi.td ->> 'end' ~ '^\d{4}-\d{2}-\d{2}$'
                                then greatest(1, ((mi.td ->> 'end')::date - (mi.td ->> 'start')::date) + 1) else 1 end,
                   'travellers', jsonb_array_length(coalesce(mi.td -> 'travellers', '[]'::jsonb))))
                   from mine mi where mi.uid = u.id), '[]'::jsonb),
         coalesce((select jsonb_object_agg(cat, round(total, 2)) from (select e.cat, sum(e.eur) as total from exp e where e.uid = u.id group by e.cat) x), '{}'::jsonb),
         (select count(*)::int from exp e where e.uid = u.id),
         coalesce((select jsonb_agg(f || jsonb_build_object('trip', mi.tid)) from mine mi, jsonb_array_elements(coalesce(mi.td -> 'flights', '[]'::jsonb)) f where mi.uid = u.id), '[]'::jsonb),
         coalesce((select jsonb_agg((mi.td -> 'hotel') || jsonb_build_object('trip', mi.tid, 'country', mi.td ->> 'country')) from mine mi where mi.uid = u.id and mi.td -> 'hotel' is not null), '[]'::jsonb),
         coalesce((select jsonb_object_agg(typ, n) from (
                   select coalesce(pl.data ->> 'type', 'ajout') as typ, count(*) as n from mine mi join public.places pl on pl.trip_id = mi.tid
                   where mi.uid = u.id and coalesce(pl.data ->> 'deleted', 'false') <> 'true' group by 1) y), '{}'::jsonb),
         jsonb_build_object(
           'cities', coalesce((select jsonb_agg(jsonb_build_object('city', c.city, 'country', c.country, 'n', c.n) order by c.n desc) from (
                     select ev.city, ev.country, count(*) as n from public.events ev where ev.user_id = u.id and ev.city is not null group by 1, 2 order by 3 desc limit 5) c), '[]'::jsonb),
           'os', coalesce((select jsonb_object_agg(o.os, o.n) from (select ev.os, count(*) as n from public.events ev where ev.user_id = u.id and ev.os is not null group by 1) o), '{}'::jsonb),
           'browsers', coalesce((select jsonb_object_agg(b.browser, b.n) from (select ev.browser, count(*) as n from public.events ev where ev.user_id = u.id and ev.browser is not null group by 1) b), '{}'::jsonb),
           'firstRef', (select ev.ref from public.events ev where ev.user_id = u.id and ev.ref is not null order by ev.at limit 1),
           'steps', (select count(*) from public.events ev where ev.user_id = u.id)
         ),
         public.is_pro_user(u.id)
  from auth.users u
  left join public.profiles p on p.id = u.id
  where p_user is null or u.id = p_user
  order by u.created_at desc
  limit 2000;
end;
$$;

-- what this file did, and proof that nothing was lost: before (backup) / now, for each trip (read in "Results")
select x.id as voyage,
       x.owner is not null as proprietaire,
       (select string_agg(m.role, ', ' order by m.role desc) from public.trip_members m where m.trip_id = x.id) as voyageurs,
       (select count(*) from jsonb_object_keys(x.data)) as champs,
       (select count(*) from public.backup_20261118_places b where b.trip_id = x.id) || ' / ' || (select count(*) from public.places p where p.trip_id = x.id) as lieux_avant_apres,
       (select count(*) from public.backup_20261118_place_states b where b.trip_id = x.id) || ' / ' || (select count(*) from public.place_states s where s.trip_id = x.id) as suivis_notes_depenses_avant_apres,
       (select count(*) from public.backup_20261118_contacts b where b.trip_id = x.id) || ' / ' || (select count(*) from public.contacts c where c.trip_id = x.id) as contacts_avant_apres,
       (select count(*) from public.backup_20261118_photos b where b.trip_id = x.id) || ' / ' || (select count(*) from public.photos p where p.trip_id = x.id) as photos_avant_apres,
       (select count(*) from public.backup_20261118_pins b where b.trip_id = x.id) || ' / ' || (select count(*) from public.pins p where p.trip_id = x.id) as epingles_avant_apres
from public.trips x where x.id in ('sha-2026', 'gz-2026') order by x.id;
