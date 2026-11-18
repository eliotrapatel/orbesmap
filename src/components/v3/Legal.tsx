import type { ReactNode } from "react";
import Shell from "./Shell";
import { getLang, t } from "../../lib/i18n";

export type LegalKind = "cgu" | "confidentialite";
export const legalKind = (v: string | null): LegalKind | null => (v === "cgu" || v === "confidentialite" ? v : null);
/** The legal pages have their own address (?p=cgu, ?p=confidentialite), readable without an account */
export const legalHref = (k: LegalKind) => `${location.pathname}?p=${k}`;

const EDITOR = "CONGLOMERAT LLC, 30 N Gould St Ste N, Sheridan, WY 82801, États-Unis";
const CONTACT = "hello@joinentity.com";
const VERSION = "18 novembre 2026";
const EDITOR_EN = "CONGLOMERAT LLC, 30 N Gould St Ste N, Sheridan, WY 82801, USA";
const VERSION_EN = "November 18, 2026";

/** Conditions d'utilisation and Politique de confidentialité, short and plain */
export default function Legal({ kind, onClose }: { kind: LegalKind; onClose: () => void }) {
  const en = getLang() === "en";
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onClose} aria-label={t("Fermer")}>✕</button>
      <span className="v3-grow" />
      <a className="v3-toplink" href={legalHref(kind === "cgu" ? "confidentialite" : "cgu")}>{kind === "cgu" ? t("Confidentialité") : t("Conditions")}</a>
    </div>
  );
  return (
    <Shell className="v3-legal" ring={false} top={top}>
      <p className="v3-lbl" style={{ marginTop: 18 }}>{t("ORBES Trips · version du {date}", { date: en ? VERSION_EN : VERSION })}</p>
      {kind === "cgu" ? (en ? <TermsEn /> : <Terms />) : en ? <PrivacyEn /> : <Privacy />}
      <p className="v3-fine" style={{ marginTop: 40 }}>{t("Une question :")} <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
    </Shell>
  );
}

function Sec({ t, children }: { t: string; children: ReactNode }) {
  return (
    <section className="legal-sec">
      <h2>{t}</h2>
      {children}
    </section>
  );
}

function Terms() {
  return (
    <>
      <h1 className="v3-d v3-h2">Conditions d'utilisation</h1>
      <Sec t="Qui sommes-nous">
        <p>ORBES Trips est édité par {EDITOR}. Contact : <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
        <p>L'application est hébergée par Vercel Inc. (États-Unis) ; les comptes et les données sont gérés avec Supabase Inc. (États-Unis).</p>
      </Sec>
      <Sec t="Le service">
        <p>ORBES Trips est un carnet de voyage : vous indiquez votre destination et ce que vous savez déjà, l'application prépare un programme jour par jour avec l'aide d'une intelligence artificielle, puis vous accompagne sur place (carte, fiches des lieux, agenda, outils).</p>
        <p>Un compte se crée avec une adresse e-mail. Vous êtes responsable de ce que vous saisissez et de ce que vous partagez avec les personnes que vous invitez.</p>
      </Sec>
      <Sec t="Gratuit et Pro">
        <p>L'application est gratuite, avec des limites : un voyage préparé par l'IA par mois, et le programme d'un voyage validé ne se modifie plus sans Pro. ORBES Trips Pro lève ces limites et ajoute des fonctions (carte hors ligne, exports, mode affaires).</p>
        <p>Pro s'obtient aujourd'hui uniquement avec un code d'accès, pour la durée attachée au code. Aucun paiement n'est demandé pour l'instant ; si Pro devient payant, les prix et conditions seront présentés avant tout achat.</p>
      </Sec>
      <Sec t="Les informations de l'IA">
        <p>Les programmes, horaires, adresses et conseils sont préparés automatiquement à partir de recherches sur internet. Ils peuvent être incomplets ou dépassés : vérifiez les informations importantes (horaires, réservations, conditions d'entrée) auprès des lieux avant de vous déplacer. ORBES Trips ne vend ni ne réserve aucune prestation de voyage.</p>
      </Sec>
      <Sec t="Usage correct">
        <p>N'utilisez pas le service pour enfreindre la loi, pour nuire à d'autres personnes, ni pour le perturber (envois automatisés, contournement des limites). Nous pouvons suspendre un compte qui le fait.</p>
      </Sec>
      <Sec t="Disponibilité et responsabilité">
        <p>Nous faisons de notre mieux pour que le service fonctionne en continu, y compris sans réseau pour ce qui est enregistré sur votre téléphone, sans pouvoir le garantir. Dans les limites permises par la loi, notre responsabilité ne couvre pas les conséquences d'une information inexacte, d'une interruption du service ou d'une perte de données, et elle est limitée aux sommes que vous nous avez versées.</p>
      </Sec>
      <Sec t="Vos données, profils et offres partenaires">
        <p>En créant un compte et en utilisant ORBES Trips, vous acceptez que nous utilisions les données décrites dans la page Confidentialité (profil, voyages, dépenses, vols, hôtels, utilisation de l'application, ville et appareil) pour améliorer le service, établir des profils de voyageurs, vous proposer des offres de partenaires adaptées et partager ces données avec nos partenaires commerciaux.</p>
        <p>Vous pouvez vous y opposer à tout moment, sans frais : menu du compte → Alertes → décochez « Offres de nos partenaires ». Vous ne recevez alors plus d'offres et vos données ne sont plus partagées avec nos partenaires.</p>
      </Sec>
      <Sec t="Votre compte">
        <p>Vous pouvez exporter vos données et supprimer votre compte à tout moment depuis l'application (menu du compte). La suppression efface votre compte et les voyages que vous avez créés.</p>
      </Sec>
      <Sec t="Changements et droit applicable">
        <p>Ces conditions peuvent évoluer ; la version en vigueur est toujours sur cette page, et un changement important vous sera signalé dans l'application. Elles sont régies par le droit de l'État du Wyoming (États-Unis), sans vous priver des protections impératives du pays où vous résidez si vous êtes un consommateur.</p>
      </Sec>
    </>
  );
}

function Privacy() {
  return (
    <>
      <h1 className="v3-d v3-h2">Confidentialité</h1>
      <Sec t="En bref">
        <p>Nous utilisons vos données pour faire fonctionner votre carnet de voyage, l'améliorer, établir des profils de voyageurs et vous proposer des offres de partenaires adaptées. Nous partageons ces données avec nos partenaires commerciaux, sauf si vous vous y opposez dans le menu du compte.</p>
        <p>Responsable : {EDITOR}. Contact : <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
      </Sec>
      <Sec t="Ce que nous enregistrons">
        <ul>
          <li><b>Votre compte</b> : adresse e-mail, prénom, et ce que vous indiquez à l'inscription (façon de voyager, goûts, rythme, budget, langue ; et, si vous les donnez, ville ou aéroport de départ, tranche d'âge, nombre de voyages par an, comment vous nous avez connus).</li>
          <li><b>Vos voyages</b> : destinations, dates, durée, vols (compagnie, trajet, classe, prix) et hôtels (nom, nuits, prix), lieux, notes, photos, contacts et check-lists que vous ajoutez, et les personnes que vous invitez.</li>
          <li><b>Vos dépenses</b> : montant, devise, valeur en euros, catégorie (vols, hébergement, transport, restaurants, activités, shopping, achats professionnels…), date, qui a payé, et le lieu ou fournisseur associé ; y compris les prix lus dans les réservations que vous nous transférez.</li>
          <li><b>Les réservations transférées</b> à votre adresse ORBES : l'e-mail reçu et ce que l'IA en extrait.</li>
          <li><b>Votre position</b>, seulement si vous l'autorisez : elle sert à afficher les distances sur votre téléphone, et accompagne une question posée à l'assistant pour qu'il réponde depuis où vous êtes.</li>
          <li><b>L'usage de l'IA</b> : le nombre de demandes et leur coût, pour appliquer les limites.</li>
          <li><b>Votre utilisation de l'application</b> : les étapes de votre parcours (page d'accueil vue, inscription, connexions, voyages créés, ouverts et validés, lieux ajoutés, invitations, exports, écran Pro), avec la date, le type d'appareil (téléphone ou ordinateur), son système et son navigateur, la ville et le pays approximatifs déduits de votre connexion, et le site d'où vous venez. Elles sont liées à votre compte ; avant l'inscription, elles sont liées à un identifiant aléatoire gardé sur votre appareil, puis rattachées à votre compte quand vous vous connectez.</li>
        </ul>
      </Sec>
      <Sec t="Pourquoi">
        <p>Pour fournir le service que vous demandez (préparer et afficher vos voyages, les synchroniser entre vos appareils, les partager), pour appliquer les limites et Pro, pour vous aider si vous nous écrivez, et pour comprendre comment l'application est utilisée afin de l'améliorer.</p>
        <p>Pour établir des profils de voyageurs (personas : façon de voyager, budget, destinations, centres d'intérêt, dépenses par catégorie) et vous proposer, à vous ou par nos partenaires, des offres adaptées. Ces usages reposent sur votre acceptation des conditions d'utilisation ; vous pouvez vous y opposer à tout moment (voir « Vos droits »).</p>
      </Sec>
      <Sec t="Avec qui">
        <p>Uniquement avec les prestataires nécessaires au service, qui traitent les données pour notre compte :</p>
        <ul>
          <li>Supabase (comptes, base de données, photos) et Vercel (hébergement de l'application) ;</li>
          <li>Resend (envoi des e-mails de connexion) ;</li>
          <li>DeepSeek, et Anthropic en secours : le texte de vos demandes à l'IA et les informations du voyage utiles pour y répondre ;</li>
          <li>OpenStreetMap / Nominatim, OpenFreeMap, Open-Meteo et Frankfurter : recherches de lieux, fonds de carte, météo et taux de change, sans vos données de compte.</li>
        </ul>
        <p>Ces prestataires peuvent se trouver hors de l'Union européenne, notamment aux États-Unis et, pour DeepSeek, en Chine.</p>
        <p><b>Nos partenaires commerciaux</b> (hôtels et hébergements, activités et visites, transport et location, assurance voyage, cartes SIM et eSIM, marques et commerces, agences de voyage) peuvent recevoir votre profil de voyageur : adresse e-mail, prénom, langue, ville et pays, tranche d'âge, façon de voyager, budget, goûts, destinations et dates, dépenses par catégorie, vols et hôtels, personas. Ils les utilisent pour vous adresser leurs offres. Ils ne les reçoivent pas si vous avez décoché « Offres de nos partenaires ».</p>
      </Sec>
      <Sec t="Sur votre téléphone">
        <p>L'application garde sur votre appareil une copie de vos voyages et votre session, pour fonctionner sans réseau, ainsi que l'identifiant aléatoire qui relie votre utilisation à votre compte. Il n'y a aucun cookie publicitaire ni outil de suivi d'un autre site.</p>
      </Sec>
      <Sec t="Combien de temps">
        <p>Tant que votre compte existe. Quand vous le supprimez, votre compte, les voyages que vous avez créés et votre historique d'utilisation sont effacés. L'historique d'utilisation est gardé au plus 13 mois.</p>
      </Sec>
      <Sec t="Vos droits">
        <p>Vous pouvez accéder à vos données, les corriger, les exporter (menu du compte, « Exporter mes données ») et les supprimer (« Supprimer mon compte »), ou vous opposer à un traitement. Pour ne plus recevoir d'offres ni figurer dans les données partagées avec nos partenaires : menu du compte → Alertes → décochez « Offres de nos partenaires ». Pour toute demande : <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. Si vous résidez dans l'Union européenne, vous pouvez aussi vous adresser à l'autorité de protection des données de votre pays (en France, la CNIL).</p>
      </Sec>
    </>
  );
}

// ---------- English version (same content and facts as the French pages above) ----------

function TermsEn() {
  return (
    <>
      <h1 className="v3-d v3-h2">Terms of use</h1>
      <Sec t="Who we are">
        <p>ORBES Trips is published by {EDITOR_EN}. Contact: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
        <p>The app is hosted by Vercel Inc. (USA); accounts and data are managed with Supabase Inc. (USA).</p>
      </Sec>
      <Sec t="The service">
        <p>ORBES Trips is a travel notebook: you enter your destination and what you already know, the app prepares a day-by-day itinerary with the help of artificial intelligence, then guides you on the ground (map, place details, schedule, tools).</p>
        <p>An account is created with an email address. You are responsible for what you enter and for what you share with the people you invite.</p>
      </Sec>
      <Sec t="Free and Pro">
        <p>The app is free, with limits: one trip prepared by the AI per month, and a confirmed trip's itinerary can no longer be changed without Pro. ORBES Trips Pro lifts these limits and adds features (offline map, exports, business mode).</p>
        <p>For now, Pro is only available with an access code, for the length of time attached to the code. No payment is requested at this time; if Pro becomes paid, prices and terms will be shown before any purchase.</p>
      </Sec>
      <Sec t="Information from the AI">
        <p>Itineraries, opening hours, addresses and tips are prepared automatically from searches on the internet. They may be incomplete or out of date: check important information (opening hours, bookings, entry requirements) with the places themselves before you go. ORBES Trips does not sell or book any travel service.</p>
      </Sec>
      <Sec t="Fair use">
        <p>Do not use the service to break the law, to harm other people, or to disrupt it (automated requests, getting around the limits). We may suspend an account that does.</p>
      </Sec>
      <Sec t="Availability and liability">
        <p>We do our best to keep the service running at all times, including without a connection for what is saved on your phone, but we cannot guarantee it. To the extent permitted by law, our liability does not cover the consequences of inaccurate information, an interruption of the service or a loss of data, and it is limited to the amounts you have paid us.</p>
      </Sec>
      <Sec t="Your data, profiles and partner offers">
        <p>By creating an account and using ORBES Trips, you agree that we use the data described in the Privacy page (profile, trips, expenses, flights, hotels, app usage, city and device) to improve the service, build traveler profiles, offer you tailored offers from partners, and share this data with our business partners.</p>
        <p>You can object at any time, free of charge: account menu → Alerts → untick “Offers from our partners”. You then stop receiving offers and your data is no longer shared with our partners.</p>
      </Sec>
      <Sec t="Your account">
        <p>You can export your data and delete your account at any time from the app (account menu). Deletion erases your account and the trips you created.</p>
      </Sec>
      <Sec t="Changes and governing law">
        <p>These terms may change; the current version is always on this page, and any significant change will be announced in the app. They are governed by the laws of the State of Wyoming (USA), without depriving you of the mandatory protections of the country where you live if you are a consumer.</p>
      </Sec>
    </>
  );
}

function PrivacyEn() {
  return (
    <>
      <h1 className="v3-d v3-h2">Privacy</h1>
      <Sec t="In short">
        <p>We use your data to run your travel notebook, improve it, build traveler profiles and offer you tailored offers from partners. We share this data with our business partners unless you object in the account menu.</p>
        <p>Data controller: {EDITOR_EN}. Contact: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
      </Sec>
      <Sec t="What we store">
        <ul>
          <li><b>Your account</b>: email address, first name, and what you tell us when you sign up (how you travel, tastes, pace, budget, language; and, if you give them, home city or airport, age range, trips per year, how you heard about us).</li>
          <li><b>Your trips</b>: destinations, dates, length, flights (airline, route, cabin, price) and hotels (name, nights, price), places, notes, photos, contacts and checklists you add, and the people you invite.</li>
          <li><b>Your expenses</b>: amount, currency, value in euros, category (flights, lodging, transport, food, activities, shopping, business purchases…), date, who paid, and the related place or supplier; including prices read from bookings you forward to us.</li>
          <li><b>Forwarded bookings</b> sent to your ORBES address: the email received and what the AI extracts from it.</li>
          <li><b>Your location</b>, only if you allow it: it is used to show distances on your phone, and is sent along with a question asked to the assistant so it can answer from where you are.</li>
          <li><b>AI usage</b>: the number of requests and their cost, to apply the limits.</li>
          <li><b>How you use the app</b>: the steps of your journey (home page viewed, sign-up, sign-ins, trips created, opened and confirmed, places added, invitations, exports, Pro screen), with the date, the type of device (phone or computer), its system and browser, the approximate city and country derived from your connection, and the site you came from. They are linked to your account; before sign-up, they are linked to a random identifier kept on your device, then attached to your account when you sign in.</li>
        </ul>
      </Sec>
      <Sec t="Why">
        <p>To provide the service you ask for (preparing and showing your trips, syncing them between your devices, sharing them), to apply the limits and Pro, to help you if you write to us, and to understand how the app is used in order to improve it.</p>
        <p>To build traveler profiles (personas: how you travel, budget, destinations, interests, spending by category) and to offer you, directly or through our partners, tailored offers. These uses are based on your acceptance of the terms of use; you can object at any time (see “Your rights”).</p>
      </Sec>
      <Sec t="Who we share it with">
        <p>Only with the providers needed for the service, who process the data on our behalf:</p>
        <ul>
          <li>Supabase (accounts, database, photos) and Vercel (app hosting);</li>
          <li>Resend (sending sign-in emails);</li>
          <li>DeepSeek, with Anthropic as a backup: the text of your requests to the AI and the trip information needed to answer them;</li>
          <li>OpenStreetMap / Nominatim, OpenFreeMap, Open-Meteo and Frankfurter: place searches, base maps, weather and exchange rates, without your account data.</li>
        </ul>
        <p>These providers may be located outside the European Union, in particular in the United States and, for DeepSeek, in China.</p>
        <p><b>Our business partners</b> (hotels and lodging, activities and tours, transport and rentals, travel insurance, SIM and eSIM cards, brands and retailers, travel agencies) may receive your traveler profile: email address, first name, language, city and country, age range, how you travel, budget, tastes, destinations and dates, spending by category, flights and hotels, personas. They use it to send you their offers. They do not receive it if you untick “Offers from our partners”.</p>
      </Sec>
      <Sec t="On your phone">
        <p>The app keeps a copy of your trips and your session on your device, so it works without a connection, as well as the random identifier that links your use to your account. There are no advertising cookies and no tracking tools from other sites.</p>
      </Sec>
      <Sec t="How long">
        <p>For as long as your account exists. When you delete it, your account, the trips you created and your usage history are erased. Usage history is kept for 13 months at most.</p>
      </Sec>
      <Sec t="Your rights">
        <p>You can access your data, correct it, export it (account menu, “Export my data”) and delete it (“Delete my account”), or object to its processing. To stop receiving offers and be left out of the data shared with our partners: account menu → Alerts → untick “Offers from our partners”. For any request: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. If you live in the European Union, you can also contact the data protection authority of your country (in France, the CNIL).</p>
      </Sec>
    </>
  );
}
