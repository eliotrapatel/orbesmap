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

## Brancher Supabase (sauvegarde en ligne + partage avec papa)

1. Créer un projet sur https://supabase.com (gratuit).
2. SQL Editor → New query → coller tout `supabase/schema.sql` → Run.
3. Ajouter les deux adresses autorisées (même SQL Editor) :
   ```sql
   insert into public.members (email, name) values
     ('votre-adresse@exemple.com', 'Eliot'),
     ('adresse-de-papa@exemple.com', 'Papa');
   ```
4. Authentication → URL Configuration → Redirect URLs : ajouter `https://theorbes.com/maps`,
   `https://orbesmap.vercel.app` et `http://localhost:5178`.
5. (Conseillé) Authentication → Email Templates → Magic Link : ajouter `{{ .Token }}` dans le texte,
   pour recevoir aussi un code à 6 chiffres (pratique si le lien s'ouvre dans un autre navigateur).
6. Vercel → projet orbesmap → Settings → Environment Variables :
   `VITE_SUPABASE_URL` (format `https://xxxx.supabase.co`) et `VITE_SUPABASE_ANON_KEY`, puis redéployer.
   En local : les mettre dans `.env.local`.

Sans ces variables, l'app fonctionne entièrement sur l'appareil.

## Données de la version de juin

Au premier lancement, l'app reprend automatiquement ce qui avait été saisi dans l'ancienne version
sur le même navigateur (statuts, notes, RDV, fiches fournisseurs, contacts, photos, lieux épinglés, taux),
sans doublon et sans écraser des modifications plus récentes.
