# ORBES Trips — sign-in e-mails in French and English (lot 6d)

Supabase → Authentication → Emails → Templates. The language comes from the account (`lang` saved with the
account by the app: "fr" or "en"); an account without it gets French. Replace the subject and the whole body of
each template below, then Save.

## 1. "Magic Link"

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

## 2. "Confirm signup" (first e-mail of a new account)

Subject:
```
{{ if eq (print .Data.lang) "en" }}Welcome to ORBES Trips{{ else }}Bienvenue sur ORBES Trips{{ end }}
```

Body:
```html
{{ if eq (print .Data.lang) "en" }}
<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0a0a0a">
  <p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 28px">ORBES Trips</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 24px">Welcome. To create your account, tap this button on the phone where you use the app:</p>
  <p style="margin:0 0 28px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0a0a0a;color:#f6f2ea;text-decoration:none;padding:14px 22px;border-radius:12px;font-size:15px">Create my account</a></p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 6px">Or enter this code in the app:</p>
  <p style="font-size:28px;letter-spacing:.18em;font-weight:bold;margin:0 0 28px">{{ .Token }}</p>
  <p style="font-size:12.5px;color:#6f6b65;line-height:1.5;margin:0">If you didn't ask for this, simply ignore this email.</p>
</div>
{{ else }}
<div style="font-family:Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#0a0a0a">
  <p style="font-size:13px;letter-spacing:.2em;text-transform:uppercase;margin:0 0 28px">ORBES Trips</p>
  <p style="font-size:16px;line-height:1.5;margin:0 0 24px">Bienvenue. Pour créer votre compte, touchez ce bouton depuis le téléphone où vous utilisez l'app :</p>
  <p style="margin:0 0 28px"><a href="{{ .ConfirmationURL }}" style="display:inline-block;background:#0a0a0a;color:#f6f2ea;text-decoration:none;padding:14px 22px;border-radius:12px;font-size:15px">Créer mon compte</a></p>
  <p style="font-size:15px;line-height:1.5;margin:0 0 6px">Ou saisissez ce code dans l'app :</p>
  <p style="font-size:28px;letter-spacing:.18em;font-weight:bold;margin:0 0 28px">{{ .Token }}</p>
  <p style="font-size:12.5px;color:#6f6b65;line-height:1.5;margin:0">Si vous n'avez rien demandé, ignorez simplement cet e-mail.</p>
</div>
{{ end }}
```
