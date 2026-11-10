# ORBES — carnets de voyage (Guangzhou 2026, Shanghai 2026)

Application web publiée sur https://theorbes.com/maps et https://orbesmap.vercel.app.
Carte sombre (MapLibre + OpenFreeMap), programme jour par jour, fiches lieux, phrases avec lecture vocale,
convertisseur avec taux du jour, vols, infos pratiques, export PDF / CSV / calendrier, carnet partagé.

## Organisation

- `src/data/trips/` : un fichier par voyage (`gz2026.ts`, `sha2026.ts`) + `index.ts` (liste des voyages).
  Pour ajouter un voyage : copier un fichier, remplir lieux / jours / vols / phrases, l'ajouter dans `index.ts`.
- `src/components/` : écrans (accueil, barre du haut, liste, fiche lieu, outils, recherche ⌘K).
- `src/lib/store.ts` : enregistrement (appareil + Supabase), file d'envoi hors connexion, synchro en direct.
- `supabase/schema.sql` : tables, accès réservé aux membres, photos privées.
- `legacy/v1.html` : la version de juin 2026, gardée pour référence (non publiée).

La construction produit **un seul fichier** `dist/index.html` (tout est intégré), parce que
theorbes.com/maps ne sert qu'un fichier.

## Travailler dessus

```bash
npm install
npm run dev      # http://localhost:5178
npm run build    # produit dist/index.html
```

## Supabase (sauvegarde en ligne + partage avec papa)

Projet : `https://ifugaqjneprbtigvegeb.supabase.co`. L'adresse et la clé publique sont dans
`src/lib/supabase.ts` (publiques par conception ; l'accès est protégé par les règles de `supabase/schema.sql`).
Des variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` peuvent les remplacer.

Mise en place (déjà faite le 10/11/2026) :
1. SQL Editor → coller `supabase/schema.sql` → Run, puis ajouter les adresses dans `public.members`.
2. Authentication → Users → Add user → Create new user : e-mail + mot de passe, cocher « Auto Confirm User ».
   Une fois par personne. On se connecte ensuite dans l'app (onglet Compte) avec cet e-mail et ce mot de passe.
   Aucun e-mail n'est envoyé (l'envoi d'e-mails par défaut de Supabase est limité aux membres de l'équipe, 2 par heure).
3. Mot de passe oublié : Authentication → Users → la personne → modifier le mot de passe.

Sans réseau, l'app fonctionne sur l'appareil et envoie les changements au retour de la connexion.

## Fonctions IA (traduction photo, interprète, lieu depuis un lien)

Elles passent par `api/ai.ts`, une fonction Vercel du projet orbesmap (`https://orbesmap.vercel.app/api/ai`).
La clé reste sur le serveur ; seuls les membres connectés (table `members`) peuvent l'utiliser.

- **DeepSeek V4.1 Flash** (`deepseek-flash`) par défaut : variable Vercel `DEEPSEEK_API_KEY` (ajoutée le 10/11/2026).
  Images, réponses JSON, recherche et lecture de pages via l'API Search/Fetch de DeepSeek.
- **Claude** en secours : variable `ANTHROPIC_API_KEY` ; `AI_PROVIDER=claude` pour l'utiliser en priorité.

Sans aucune clé, l'app marche normalement ; ces trois fonctions affichent un message.

## Hors ligne

- Carte : onglet Infos → « Préparer hors ligne » (en Wi-Fi, ~25–40 Mo). Les tuiles restent sur le téléphone.
- App entière sans réseau : seulement sur `orbesmap.vercel.app` ajoutée à l'écran d'accueil (service worker `public/sw.js`) ;
  theorbes.com/maps ne sert qu'un fichier, il faut du réseau pour ouvrir la page.

## Données de la version de juin

Au premier lancement, l'app reprend automatiquement ce qui avait été saisi dans l'ancienne version
sur le même navigateur (statuts, notes, RDV, fiches fournisseurs, contacts, photos, lieux épinglés, taux),
sans doublon et sans écraser des modifications plus récentes.
