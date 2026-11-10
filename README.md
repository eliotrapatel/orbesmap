# ORBES — carte de sourcing Guangzhou 2026

Application web (carte + carnet de voyage) publiée sur https://theorbes.com/maps et https://orbesmap.vercel.app.

## Ce qu'il y a dedans

- `src/data/` : le voyage (lieux, jours, vols, phrases). C'est ici qu'on modifie le contenu.
- `src/components/` : les écrans (carte, liste, fiche d'un lieu, agenda, outils, compte).
- `src/lib/store.ts` : l'enregistrement des données (sur l'appareil + Supabase).
- `supabase/schema.sql` : les tables et règles d'accès Supabase.
- `legacy/v1.html` : la version de juin 2026, gardée pour référence.

La construction produit **un seul fichier** `dist/index.html` (tout est intégré), parce que
theorbes.com/maps ne sert qu'un fichier.

## Travailler dessus

```bash
npm install
npm run dev      # http://localhost:5178
npm run build    # produit dist/index.html
```

## Brancher Supabase

1. Dans Supabase : SQL → New query → coller `supabase/schema.sql` → Run.
2. Authentication → URL Configuration : ajouter `https://theorbes.com/maps`, `https://orbesmap.vercel.app` et `http://localhost:5178` dans les « Redirect URLs ».
3. (Conseillé) Authentication → Email Templates → Magic Link : ajouter `{{ .Token }}` pour recevoir aussi un code à 6 chiffres (pratique si le lien s'ouvre dans un autre navigateur).
4. Dans Vercel (projet orbesmap) → Settings → Environment Variables : `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`, puis redéployer.
   Pour le local : les mettre dans un fichier `.env.local`.

Sans ces variables, l'app fonctionne entièrement sur l'appareil (comme avant).

## Données de la version de juin

Au premier lancement, l'app reprend automatiquement ce qui avait été saisi dans l'ancienne version
sur le même navigateur (statuts, notes, RDV, fiches fournisseurs, contacts, photos, lieux épinglés, taux).
