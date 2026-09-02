// Invio email REALE opzionale.
// Se imposti le variabili SMTP_* su Railway, le conferme partono davvero via email.
// Se non le imposti, l'app funziona lo stesso: le comunicazioni restano in-app.
//
// nodemailer viene importato in modo "lazy" così l'app parte anche senza SMTP configurato.

let transporter = null;
let attempted = false;

async function getTransporter() {
  if (attempted) return transporter;
  attempted = true;

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.log("ℹ SMTP non configurato: le email non verranno inviate (solo comunicazioni in-app).");
    return null;
  }

  try {
    const nodemailer = (await import("nodemailer")).default;
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT || 587),
      secure: Number(SMTP_PORT) === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
    console.log("✓ SMTP configurato: le email verranno inviate.");
  } catch (e) {
    console.error("Errore init SMTP:", e.message);
    transporter = null;
  }
  return transporter;
}

export async function sendMail(to, subject, text) {
  const t = await getTransporter();
  if (!t) return false; // nessun SMTP: si affida solo all'in-app
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
    });
    return true;
  } catch (e) {
    console.error("Errore invio email:", e.message);
    return false;
  }
}
