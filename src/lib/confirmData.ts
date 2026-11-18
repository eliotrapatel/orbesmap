// The « Vérifiez vos e-mails » screen after a sign-up (lot acquisition, R07): which mailbox buttons to show for an
// address, and the wait before the e-mail can be sent again. Pure functions (read by the offline simulation).

export type Mailer = { id: "gmail" | "outlook" | "icloud" | "yahoo" | "mail"; label: string; href: string };

const GMAIL: Mailer = { id: "gmail", label: "Ouvrir Gmail", href: "https://mail.google.com/mail/" };
const OUTLOOK: Mailer = { id: "outlook", label: "Ouvrir Outlook", href: "https://outlook.live.com/mail/" };
const ICLOUD: Mailer = { id: "icloud", label: "Ouvrir iCloud Mail", href: "https://www.icloud.com/mail/" };
const YAHOO: Mailer = { id: "yahoo", label: "Ouvrir Yahoo Mail", href: "https://mail.yahoo.com/" };
const MAIL: Mailer = { id: "mail", label: "Ouvrir Mail", href: "message://" };

/** The mailbox buttons for an address (an unknown domain: Gmail and Outlook, plus Mail on an iPhone or iPad) */
export function mailersFor(email: string, apple: boolean): Mailer[] {
  const d = (email.split("@")[1] || "").toLowerCase().trim();
  if (d === "gmail.com" || d === "googlemail.com") return [GMAIL];
  if (/^(outlook|hotmail|live|msn)\.[a-z.]+$/.test(d)) return [OUTLOOK];
  if (d === "icloud.com" || d === "me.com" || d === "mac.com") return apple ? [MAIL, ICLOUD] : [ICLOUD];
  if (/^(yahoo|ymail)\.[a-z.]+$/.test(d)) return [YAHOO];
  return apple ? [GMAIL, OUTLOOK, MAIL] : [GMAIL, OUTLOOK];
}

/** Seconds before « Renvoyer l'e-mail » works again (60 s after the last e-mail) */
export const RESEND_WAIT = 60;
export const resendLeft = (sentAt: number, now: number) => Math.max(0, Math.ceil((sentAt + RESEND_WAIT * 1000 - now) / 1000));
