import type { ReactNode } from "react";
import Shell from "./Shell";

export type LegalKind = "cgu" | "confidentialite";
export const legalKind = (v: string | null): LegalKind | null => (v === "cgu" || v === "confidentialite" ? v : null);
/** The legal pages have their own address (?p=cgu, ?p=confidentialite), readable without an account */
export const legalHref = (k: LegalKind) => `${location.pathname}?p=${k}`;

const EDITOR = "CONGLOMERAT LLC, 30 N Gould St Ste N, Sheridan, WY 82801, États-Unis";
const CONTACT = "hello@joinentity.com";
const VERSION = "18 novembre 2026";

/** Conditions d'utilisation and Politique de confidentialité, short and plain */
export default function Legal({ kind, onClose }: { kind: LegalKind; onClose: () => void }) {
  const top = (
    <div className="v3-bar">
      <button className="v3-tool" onClick={onClose} aria-label="Fermer">✕</button>
      <span className="v3-grow" />
      <a className="v3-toplink" href={legalHref(kind === "cgu" ? "confidentialite" : "cgu")}>{kind === "cgu" ? "Confidentialité" : "Conditions"}</a>
    </div>
  );
  return (
    <Shell className="v3-legal" ring={false} top={top}>
      <p className="v3-lbl" style={{ marginTop: 18 }}>ORBES Trips · version du {VERSION}</p>
      {kind === "cgu" ? <Terms /> : <Privacy />}
      <p className="v3-fine" style={{ marginTop: 40 }}>Une question : <a href={`mailto:${CONTACT}`}>{CONTACT}</a></p>
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
        <p>Nous utilisons vos données pour faire fonctionner votre carnet de voyage et pour l'améliorer. Pas de publicité, pas de revente, aucun partage avec des annonceurs.</p>
        <p>Responsable : {EDITOR}. Contact : <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.</p>
      </Sec>
      <Sec t="Ce que nous enregistrons">
        <ul>
          <li><b>Votre compte</b> : adresse e-mail, prénom, et ce que vous indiquez à l'inscription (façon de voyager, goûts, rythme, budget, langue).</li>
          <li><b>Vos voyages</b> : destinations, dates, vols et hôtel, lieux, notes, photos, contacts et check-lists que vous ajoutez, et les personnes que vous invitez.</li>
          <li><b>Votre position</b>, seulement si vous l'autorisez : elle sert à afficher les distances sur votre téléphone, et accompagne une question posée à l'assistant pour qu'il réponde depuis où vous êtes.</li>
          <li><b>L'usage de l'IA</b> : le nombre de demandes et leur coût, pour appliquer les limites.</li>
          <li><b>Votre utilisation de l'application</b> : les étapes de votre parcours (page d'accueil vue, inscription, connexions, voyages créés, ouverts et validés, lieux ajoutés, invitations, exports, écran Pro), avec la date, le type d'appareil (téléphone ou ordinateur) et le site d'où vous venez. Elles sont liées à votre compte ; avant l'inscription, elles sont liées à un identifiant aléatoire gardé sur votre appareil, puis rattachées à votre compte quand vous vous connectez.</li>
        </ul>
      </Sec>
      <Sec t="Pourquoi">
        <p>Pour fournir le service que vous demandez (préparer et afficher vos voyages, les synchroniser entre vos appareils, les partager), pour appliquer les limites et Pro, pour vous aider si vous nous écrivez, et pour comprendre comment l'application est utilisée afin de l'améliorer.</p>
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
      </Sec>
      <Sec t="Sur votre téléphone">
        <p>L'application garde sur votre appareil une copie de vos voyages et votre session, pour fonctionner sans réseau, ainsi que l'identifiant aléatoire qui relie votre utilisation à votre compte. Il n'y a aucun cookie publicitaire ni outil de suivi d'un autre site.</p>
      </Sec>
      <Sec t="Combien de temps">
        <p>Tant que votre compte existe. Quand vous le supprimez, votre compte, les voyages que vous avez créés et votre historique d'utilisation sont effacés. L'historique d'utilisation est gardé au plus 13 mois.</p>
      </Sec>
      <Sec t="Vos droits">
        <p>Vous pouvez accéder à vos données, les corriger, les exporter (menu du compte, « Exporter mes données ») et les supprimer (« Supprimer mon compte »), ou vous opposer à un traitement. Pour toute demande : <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. Si vous résidez dans l'Union européenne, vous pouvez aussi vous adresser à l'autorité de protection des données de votre pays (en France, la CNIL).</p>
      </Sec>
    </>
  );
}
