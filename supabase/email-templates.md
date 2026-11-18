# ORBES Trips — account e-mails in French and English (lot 6d, then "landing")

Supabase → Authentication → Emails → Templates. The language comes from the account (`lang` saved with the
account by the app: "fr" or "en"); an account without it gets French. Replace the subject and the whole body of
each template below, then Save.

Since the "landing" lot, accounts sign in with an e-mail + password: the app no longer sends sign-in links or codes.
What still leaves by e-mail: "Reset password" (3, "Mot de passe oublié"), and "Confirm signup" (2) only if
"Confirm email" is left on in Authentication → Providers → Email. "Magic Link" (1) is kept for reference.

## 1. "Magic Link" (no longer sent by the app)

Subject:
```
{{ if eq (print .Data.lang) "en" }}Sign in to ORBES Trips{{ else }}Votre connexion à ORBES Trips{{ end }}
```

Body:
```html
{{ if eq (print .Data.lang) "en" }}
<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0a0a0a">
  <p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 28px">ORBES Trips</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 24px">To sign in, tap this button on the phone where you use the app:</p>
  <p style="margin:0 0 28px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0a0a0a;color:#f6f2ea;text-decoration:none;padding:14px 22px;border-radius:12px;font-size:15px">Sign in</a></p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 6px">Or enter this code in the app:</p>
  <p style="font-size:28px;letter-spacing:.18em;font-weight:bold;margin:0 0 28px">{{ .Token }}</p>
  <p style="font-size:12.5px;color:#6f6b65;line-height:1.5;margin:0">If you didn't ask for this, simply ignore this email.</p>
</div>
{{ else }}
<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0a0a0a">
  <p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 28px">ORBES Trips</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 24px">Pour vous connecter, touchez ce bouton depuis le téléphone où vous utilisez l'app :</p>
  <p style="margin:0 0 28px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0a0a0a;color:#f6f2ea;text-decoration:none;padding:14px 22px;border-radius:12px;font-size:15px">Se connecter</a></p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 6px">Ou saisissez ce code dans l'app :</p>
  <p style="font-size:28px;letter-spacing:.18em;font-weight:bold;margin:0 0 28px">{{ .Token }}</p>
  <p style="font-size:12.5px;color:#6f6b65;line-height:1.5;margin:0">Si vous n'avez rien demandé, ignorez simplement cet e-mail.</p>
</div>
{{ end }}
```

## 2. "Confirm signup" (only if "Confirm email" is on)

Sent once, when an account is created, if Authentication → Providers → Email → "Confirm email" is on. With it off,
the account opens at once and this e-mail never leaves. The app has no field for a code any more: the e-mail only
carries the button (the link comes back to the app, signed in).

Subject:
```
{{ if eq (print .Data.lang) "en" }}Confirm your ORBES Trips account{{ else }}Confirmez votre compte ORBES Trips{{ end }}
```

Body:
```html
{{ if eq (print .Data.lang) "en" }}
<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0a0a0a">
  <p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 28px">ORBES Trips</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 24px">Welcome. To confirm your address and open your account, tap this button:</p>
  <p style="margin:0 0 28px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0a0a0a;color:#f6f2ea;text-decoration:none;padding:14px 22px;border-radius:12px;font-size:15px">Confirm my address</a></p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 28px">The button opens your account. On another device, sign in with your email and your password.</p>
  <p style="font-size:12.5px;color:#6f6b65;line-height:1.5;margin:0">If you didn't create an account, simply ignore this email.</p>
</div>
{{ else }}
<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0a0a0a">
  <p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 28px">ORBES Trips</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 24px">Bienvenue. Pour confirmer votre adresse et ouvrir votre compte, touchez ce bouton :</p>
  <p style="margin:0 0 28px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0a0a0a;color:#f6f2ea;text-decoration:none;padding:14px 22px;border-radius:12px;font-size:15px">Confirmer mon adresse</a></p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 28px">Le bouton ouvre votre compte. Sur un autre appareil, connectez-vous avec votre e-mail et votre mot de passe.</p>
  <p style="font-size:12.5px;color:#6f6b65;line-height:1.5;margin:0">Si vous n'avez pas créé de compte, ignorez simplement cet e-mail.</p>
</div>
{{ end }}
```

## 3. "Reset password" ("Mot de passe oublié")

Sent from "Mot de passe oublié ?" on the sign-in form. The button opens the app (…?reset=1), which asks for a new
password. Accounts created with a link (before passwords) choose their first password this way. The return address
must be listed in Authentication → URL Configuration → Redirect URLs: https://orbesmap.vercel.app/** and
https://theorbes.com/maps** (no "/" before "**": the app is served at /maps, with no trailing slash, so the reset link
returns to https://theorbes.com/maps?reset=1). Keep the Site URL on the app (https://orbesmap.vercel.app): if a
return address is ever refused, Supabase falls back to the Site URL, and the app still opens "Choisissez un nouveau
mot de passe" from the link's #…&type=recovery.

Subject:
```
{{ if eq (print .Data.lang) "en" }}Choose a new ORBES Trips password{{ else }}Choisissez un nouveau mot de passe ORBES Trips{{ end }}
```

Body:
```html
{{ if eq (print .Data.lang) "en" }}
<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0a0a0a">
  <p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 28px">ORBES Trips</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 24px">To choose a new password, tap this button on the device where you use the app:</p>
  <p style="margin:0 0 28px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0a0a0a;color:#f6f2ea;text-decoration:none;padding:14px 22px;border-radius:12px;font-size:15px">Choose a new password</a></p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 28px">The link works once and expires after an hour.</p>
  <p style="font-size:12.5px;color:#6f6b65;line-height:1.5;margin:0">If you didn't ask for this, ignore this email: your password stays the same.</p>
</div>
{{ else }}
<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0a0a0a">
  <p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 28px">ORBES Trips</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 24px">Pour choisir un nouveau mot de passe, touchez ce bouton depuis l'appareil où vous utilisez l'app :</p>
  <p style="margin:0 0 28px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0a0a0a;color:#f6f2ea;text-decoration:none;padding:14px 22px;border-radius:12px;font-size:15px">Choisir un nouveau mot de passe</a></p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 28px">Le lien ne sert qu'une fois et expire au bout d'une heure.</p>
  <p style="font-size:12.5px;color:#6f6b65;line-height:1.5;margin:0">Si vous n'avez rien demandé, ignorez cet e-mail : votre mot de passe ne change pas.</p>
</div>
{{ end }}
```
