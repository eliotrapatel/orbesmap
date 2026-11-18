#!/usr/bin/env bash
# ORBES Trips — checks everything visible from outside (no secret needed, nothing is changed).
# Run from the repo:  bash scripts/check.sh
# For what is only visible inside Supabase (wake-ups, members, Pro, backup): run supabase/check.sql in the SQL editor.
U=https://ifugaqjneprbtigvegeb.supabase.co
K=sb_publishable_0qPu_8XZTLk-l68k2kPUvQ_7UXk-fCu
APP=https://orbesmap.vercel.app
ok=0; ko=0
pass() { printf "  \033[32m✓\033[0m %s\n" "$1"; ok=$((ok+1)); }
fail() { printf "  \033[31m✗\033[0m %s  →  %s\n" "$1" "$2"; ko=$((ko+1)); }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }
body() { curl -s "$@"; }
rpc() { curl -s -X POST "$U/rest/v1/rpc/$1" -H "apikey: $K" -H "Content-Type: application/json" -d "$2" -w " %{http_code}"; }

echo "Site"
for u in "$APP/" "https://theorbes.com/maps" "$APP/?p=cgu" "$APP/?p=confidentialite"; do
  c=$(code -L "$u"); [ "$c" = 200 ] && pass "$u" || fail "$u" "HTTP $c"
done
body -L "$APP/" | grep -q "adm-select" && pass "dernière version en ligne (lot 7+)" || fail "dernière version" "ancienne version servie"
c=$(code "$APP/sw.js"); [ "$c" = 200 ] && pass "service worker (notifications)" || fail "service worker" "HTTP $c"

echo "Fonctions Vercel"
c=$(code -X POST "$APP/api/ai" -H "content-type: application/json" -d '{}'); [ "$c" = 401 ] && pass "api/ai répond (connexion exigée)" || fail "api/ai" "HTTP $c"
r=$(body -X POST "$APP/api/cron" -H "x-cron-secret: test" -w " %{http_code}")
case "$r" in *forbidden*403) pass "api/cron : clé Supabase lue, appels étrangers refusés";; *missing*) fail "api/cron" "SUPABASE_SERVICE_ROLE_KEY absente sur Vercel";; *) fail "api/cron" "$r";; esac
r=$(body -X POST "$APP/api/inbound" -H "content-type: application/json" -d '{"type":"email.received","data":{"email_id":"00000000-0000-0000-0000-000000000000"}}' -w " %{http_code}")
case "$r" in *unknown*200) pass "api/inbound : clés Supabase, Resend et IA présentes";; *configured*) fail "api/inbound" "clé manquante sur Vercel (SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY ou DEEPSEEK_API_KEY)";; *) fail "api/inbound" "$r";; esac
c=$(code -X POST "$APP/api/track" -H "content-type: application/json" -d '{"name":"none"}'); [ "$c" = 204 ] && pass "api/track (ville et appareil)" || fail "api/track" "HTTP $c"

echo "Supabase (fichiers SQL lancés)"
check_fn() { r=$(rpc "$1" "$2"); case "$r" in *PGRST202*) fail "$3" "fonction absente : lancer $4";; *) pass "$3";; esac; }
check_fn my_plan '{}' "Pro, codes, admin (saas-4)" saas-4.sql
check_fn track_event '{"p_name":"none"}' "suivi par compte (saas-5)" saas-5.sql
check_fn public_trip '{"p_slug":"aaaaaaaaaa"}' "lien public (saas-6)" saas-6.sql
check_fn my_inbound_token '{}' "alertes et réservations (saas-7)" saas-7.sql
check_fn track_event '{"p_name":"none","p_detail":null,"p_device":null,"p_ref":null,"p_visitor":null,"p_trip":null,"p_city":null,"p_country":null,"p_region":null,"p_os":null,"p_browser":null}' "ville et appareil (saas-8)" saas-8.sql
check_fn admin_people '{}' "profils et personas (saas-8)" saas-8.sql
for t in push_subscriptions inbound_items alert_log trip_links events; do
  c=$(code "$U/rest/v1/$t?select=*&limit=0" -H "apikey: $K"); [ "$c" = 200 ] && pass "table $t" || fail "table $t" "HTTP $c"
done
c=$(code "$U/rest/v1/backup_20261118_trips?select=*&limit=0" -H "apikey: $K"); [ "$c" = 200 ] && pass "sauvegarde de la migration (saas-9)" || fail "sauvegarde saas-9" "HTTP $c (lancer saas-9.sql)"

echo "DNS (e-mails)"
mx=$(dig +short MX in.theorbes.com); [ -n "$mx" ] && pass "réception in.theorbes.com : $mx" || fail "MX in.theorbes.com" "absent chez Amen"
[ -n "$(dig +short TXT resend._domainkey.in.theorbes.com)" ] && pass "DKIM in.theorbes.com" || fail "DKIM in.theorbes.com" "absent"
[ -n "$(dig +short MX send.in.theorbes.com)" ] && pass "retours d'envoi send.in.theorbes.com" || fail "MX send.in.theorbes.com" "absent"
[ -n "$(dig +short TXT resend._domainkey.auth.theorbes.com)" ] && pass "DKIM auth.theorbes.com (e-mails de connexion et du matin)" || fail "DKIM auth.theorbes.com" "absent"

echo "Clés des notifications"
F="$HOME/orbesmap/.claude/secrets/vapid.json"
if [ -f "$F" ]; then
  pub=$(node -e "process.stdout.write(require('$F').publicKey)")
  grep -q "$pub" api/cron.ts && grep -q "$pub" src/lib/alerts.ts && pass "clé publique identique dans l'app et le serveur" || fail "clé publique" "différente du fichier local"
  len=$(node -e "process.stdout.write(String(require('$F').privateKey.length))"); [ "$len" = 43 ] && pass "clé privée locale valide (43 caractères)" || fail "clé privée locale" "longueur $len"
else fail "fichier des clés" "$F absent"; fi
echo "  (la clé privée sur Vercel se vérifie dans supabase/check.sql : réveil sans « warnings »)"

echo
[ "$ko" = 0 ] && printf "\033[32mTout est bon (%s vérifications).\033[0m\n" "$ok" || printf "\033[31m%s problème(s)\033[0m sur %s vérifications.\n" "$ko" "$((ok+ko))"
