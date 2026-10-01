import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import ExcelJS from "exceljs";
import { pool, initDb } from "./db.js";
import { sendMail } from "./mailer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "cambia-questa-chiave-in-produzione";

app.use(cors());
app.use(express.json());

// ---------- Helpers ----------
function sign(user) {
  return jwt.sign(
    { id: user.id, role: user.role, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: "30d" }
  );
}

function auth(req, res, next) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Non autenticato." });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Sessione scaduta, effettua di nuovo l'accesso." });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Riservato all'amministratore." });
  next();
}

// Le richieste modificabili sono solo quelle in attesa e con data di inizio futura (o oggi).
function canEdit(r) {
  const today = new Date().toISOString().slice(0, 10);
  const di = (r.data_inizio instanceof Date ? r.data_inizio.toISOString().slice(0,10) : String(r.data_inizio).slice(0,10));
  return r.stato === "in_attesa" && di >= today;
}

// "Oggi" secondo il fuso orario italiano (gestisce anche l'ora legale), in formato YYYY-MM-DD.
function todayItaly() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()); // en-CA produce direttamente "YYYY-MM-DD"
}
// Vero se la data passata (stringa o Date) è la giornata odierna italiana.
function isTodayItaly(v) {
  const d = (v instanceof Date) ? v.toISOString().slice(0,10) : String(v).slice(0,10);
  return d === todayItaly();
}

// ============================================================
//  AUTENTICAZIONE
// ============================================================
app.post("/api/register", async (req, res) => {
  const { name, email, password } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "Inserisci il nome." });
  if (!/^\S+@\S+\.\S+$/.test(email || "")) return res.status(400).json({ error: "Email non valida." });
  if ((password || "").length < 4) return res.status(400).json({ error: "Password troppo corta (min 4)." });

  try {
    const exists = await pool.query("SELECT 1 FROM users WHERE lower(email)=lower($1)", [email]);
    if (exists.rowCount) return res.status(409).json({ error: "Email già registrata." });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      "INSERT INTO users (name, email, pw_hash, role) VALUES ($1,$2,$3,'user') RETURNING id, name, email, role",
      [name.trim(), email.trim(), hash]
    );
    res.json({ token: sign(rows[0]), user: rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore durante la registrazione." });
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query("SELECT * FROM users WHERE lower(email)=lower($1)", [email || ""]);
    const u = rows[0];
    if (!u) return res.status(401).json({ error: "Nessun account con questa email." });
    const ok = await bcrypt.compare(password || "", u.pw_hash);
    if (!ok) return res.status(401).json({ error: "Password errata." });
    const safe = { id: u.id, name: u.name, email: u.email, role: u.role };
    res.json({ token: sign(safe), user: safe });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore durante l'accesso." });
  }
});

app.get("/api/me", auth, (req, res) => {
  res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role } });
});

// ============================================================
//  RICHIESTE (permessi / ferie / assenze)
// ============================================================
app.get("/api/requests", auth, async (req, res) => {
  // utente: solo le proprie; admin: tutte
  const q = req.user.role === "admin"
    ? await pool.query(`SELECT r.*, u.name AS user_name, u.email AS user_email
                        FROM requests r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC`)
    : await pool.query(`SELECT * FROM requests WHERE user_id=$1 ORDER BY created_at DESC`, [req.user.id]);
  res.json(q.rows);
});

app.post("/api/requests", auth, async (req, res) => {
  const { tipo, mode, dataInizio, dataFine, oraInizio, oraFine, note } = req.body;
  if (!["permesso", "ferie", "assenza"].includes(tipo)) return res.status(400).json({ error: "Tipo non valido." });
  if (!["ore", "giorni"].includes(mode)) return res.status(400).json({ error: "Modalità non valida." });
  const df = mode === "giorni" ? dataFine : dataInizio;
  try {
    const { rows } = await pool.query(
      `INSERT INTO requests (user_id, tipo, mode, data_inizio, data_fine, ora_inizio, ora_fine, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.user.id, tipo, mode, dataInizio, df,
       mode === "ore" ? oraInizio : null, mode === "ore" ? oraFine : null, (note || "").trim()]
    );

    // Notifica agli amministratori: in-app + email (se SMTP configurato).
    try {
      const admins = (await pool.query("SELECT id, email FROM users WHERE role='admin'")).rows;
      const richiedente = (await pool.query("SELECT name FROM users WHERE id=$1", [req.user.id])).rows[0];
      const tipoLabel = { permesso: "Permesso", ferie: "Ferie", assenza: "Assenza" }[tipo];
      const periodo = mode === "ore"
        ? `${String(dataInizio).slice(0,10)} (${oraInizio}-${oraFine})`
        : (String(dataInizio).slice(0,10) === String(df).slice(0,10)
            ? String(dataInizio).slice(0,10)
            : `dal ${String(dataInizio).slice(0,10)} al ${String(df).slice(0,10)}`);
      const subject = `Nuova richiesta ${tipoLabel} da ${richiedente?.name || "un dipendente"}`;
      const body = `${richiedente?.name || "Un dipendente"} ha inviato una richiesta di ${tipoLabel.toLowerCase()} per ${periodo}.${(note||"").trim() ? ` Note: ${note.trim()}` : ""} Accedi all'app per approvarla o respingerla.`;
      for (const a of admins) {
        await pool.query("INSERT INTO messages (user_id, subject, body) VALUES ($1,$2,$3)", [a.id, subject, body]);
        sendMail(a.email, subject, body).catch(() => {}); // non blocco la risposta se la mail fallisce
      }
    } catch (notifyErr) {
      console.error("Errore invio notifica admin:", notifyErr.message);
      // la richiesta è comunque salvata: non fallisco la chiamata per un problema di notifica
    }

    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore nel salvataggio della richiesta." });
  }
});

app.put("/api/requests/:id", auth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM requests WHERE id=$1", [req.params.id]);
    const r = rows[0];
    if (!r) return res.status(404).json({ error: "Richiesta non trovata." });
    if (r.user_id !== req.user.id) return res.status(403).json({ error: "Non puoi modificare questa richiesta." });
    if (!canEdit(r)) return res.status(400).json({ error: "Modificabile solo se in attesa e futura." });

    const { tipo, mode, dataInizio, dataFine, oraInizio, oraFine, note } = req.body;
    const df = mode === "giorni" ? dataFine : dataInizio;
    const { rows: upd } = await pool.query(
      `UPDATE requests SET tipo=$1, mode=$2, data_inizio=$3, data_fine=$4, ora_inizio=$5, ora_fine=$6, note=$7
       WHERE id=$8 RETURNING *`,
      [tipo, mode, dataInizio, df, mode === "ore" ? oraInizio : null, mode === "ore" ? oraFine : null,
       (note || "").trim(), req.params.id]
    );
    res.json(upd[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore nella modifica." });
  }
});

app.delete("/api/requests/:id", auth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM requests WHERE id=$1", [req.params.id]);
    const r = rows[0];
    if (!r) return res.status(404).json({ error: "Richiesta non trovata." });
    // L'admin può eliminare qualsiasi richiesta; l'utente solo le proprie in attesa e future.
    if (req.user.role !== "admin") {
      if (r.user_id !== req.user.id) return res.status(403).json({ error: "Non puoi eliminare questa richiesta." });
      if (!canEdit(r)) return res.status(400).json({ error: "Eliminabile solo se in attesa e futura." });
    }
    await pool.query("DELETE FROM requests WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore nell'eliminazione." });
  }
});

// Admin: cambia stato (approva / respingi / rimetti in attesa) + notifica
app.post("/api/requests/:id/decide", auth, adminOnly, async (req, res) => {
  const { stato } = req.body; // approvata | respinta | in_attesa
  if (!["approvata", "respinta", "in_attesa"].includes(stato)) return res.status(400).json({ error: "Stato non valido." });
  try {
    const { rows } = await pool.query(
      `UPDATE requests SET stato=$1 WHERE id=$2 RETURNING *`, [stato, req.params.id]
    );
    const r = rows[0];
    if (!r) return res.status(404).json({ error: "Richiesta non trovata." });

    const { rows: us } = await pool.query("SELECT name, email FROM users WHERE id=$1", [r.user_id]);
    const u = us[0];
    const tipoLabel = { permesso: "Permesso", ferie: "Ferie", assenza: "Assenza" }[r.tipo];
    const esito = { approvata: "APPROVATA", respinta: "RESPINTA", in_attesa: "rimessa IN ATTESA" }[stato];
    const subject = `Aggiornamento richiesta ${tipoLabel}`;
    const body = `Ciao ${u.name}, la tua richiesta di ${tipoLabel.toLowerCase()} del ${String(r.data_inizio).slice(0,10)} è stata ${esito}.`;

    await pool.query(
      "INSERT INTO messages (user_id, subject, body) VALUES ($1,$2,$3)",
      [r.user_id, subject, body]
    );
    // email reale se configurata (solo per approvata/respinta, non per il rimettere in attesa)
    const emailSent = stato === "in_attesa" ? false : await sendMail(u.email, subject, body);
    res.json({ request: r, emailSent });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore nella decisione." });
  }
});

// ============================================================
//  TIMBRATURA LIVE (entrata / pausa / riprendi / uscita)
// ============================================================

// Arrotonda un orario "HH:MM" al quarto d'ora più vicino.
function roundQuarter(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  let total = h * 60 + m;
  total = Math.round(total / 15) * 15;
  total = ((total % 1440) + 1440) % 1440; // resta nelle 24h
  const hh = Math.floor(total / 60), mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
function hhmmFromDate(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const PAUSA_FISSA_MIN = 150; // durata fissa della pausa pranzo

// Se una pausa fissa è scaduta, la converte in minuti accumulati e rimette "attivo".
// Restituisce la riga punch aggiornata. Va chiamata prima di leggere/usare lo stato.
async function normalizzaPausaFissa(p) {
  if (p && p.stato === "pausa_fissa" && p.pausa_fine && Date.now() >= new Date(p.pausa_fine).getTime()) {
    const { rows } = await pool.query(
      "UPDATE punch SET stato='attivo', pausa_fine=NULL, pausa_totale=pausa_totale+$2 WHERE user_id=$1 RETURNING *",
      [p.user_id, PAUSA_FISSA_MIN]
    );
    return rows[0];
  }
  return p;
}

const MAX_ORE_LAVORO = 12; // stop automatico raggiunte 12 ore di lavoro effettivo

// Calcola i minuti di pausa totali di una sessione a un dato istante.
function minutiPausaFinora(p, at) {
  let pausaMin = p.pausa_totale || 0;
  if (p.stato === "in_pausa" && p.pausa_inizio) {
    pausaMin += Math.round((at - new Date(p.pausa_inizio).getTime()) / 60000);
  }
  if (p.stato === "pausa_fissa" && p.pausa_fine) {
    const inizioPausa = new Date(p.pausa_fine).getTime() - PAUSA_FISSA_MIN * 60000;
    if (at >= new Date(p.pausa_fine).getTime()) pausaMin += PAUSA_FISSA_MIN;
    else pausaMin += Math.max(0, Math.round((at - inizioPausa) / 60000));
  }
  return pausaMin;
}

// Chiude una sessione punch creando il worklog. fineDate = momento di uscita.
async function chiudiTimbratura(p, fineDate, extra = {}) {
  const pausaMin = minutiPausaFinora(p, fineDate.getTime());
  const entrata = new Date(p.entrata);
  const inizioHHMM = roundQuarter(hhmmFromDate(entrata));
  const fineHHMM = roundQuarter(hhmmFromDate(fineDate));
  const pausaArr = Math.round(pausaMin / 15) * 15;
  const [hi, mi] = inizioHHMM.split(":").map(Number);
  const [hf, mf] = fineHHMM.split(":").map(Number);
  let minuti = (hf * 60 + mf) - (hi * 60 + mi) - pausaArr;
  if (minuti < 0) minuti = 0;
  const oreTotali = minuti / 60;
  const oreNormali = Math.min(oreTotali, 8);
  const straordinari = Math.max(0, oreTotali - 8);
  const dataISO = `${entrata.getFullYear()}-${String(entrata.getMonth()+1).padStart(2,"0")}-${String(entrata.getDate()).padStart(2,"0")}`;
  const cantiere = !!extra.cantiere;
  const nomeCantiere = cantiere ? String(extra.nomeCantiere || "").trim() : "";
  const { rows: log } = await pool.query(
    `INSERT INTO worklogs (user_id, data, inizio, fine, pausa, ore, straordinari, cantiere, nome_cantiere)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [p.user_id, dataISO, inizioHHMM, fineHHMM, pausaArr,
     Math.round(oreNormali*100)/100, Math.round(straordinari*100)/100, cantiere, nomeCantiere]
  );
  await pool.query("DELETE FROM punch WHERE user_id=$1", [p.user_id]);
  return { worklog: log[0], straordinari: Math.round(straordinari*100)/100 };
}

// Se il lavoro effettivo ha raggiunto le 12 ore, chiude in automatico la sessione
// fissando l'uscita al momento esatto del raggiungimento (entrata + 12h lavoro + pause).
async function autoStop12h(p) {
  if (!p) return { punch: p, autoStopped: false };
  const now = Date.now();
  const entrata = new Date(p.entrata).getTime();
  const pausaMs = minutiPausaFinora(p, now) * 60000;
  const lavoroMs = now - entrata - pausaMs;
  if (lavoroMs >= MAX_ORE_LAVORO * 3600000) {
    // istante in cui sono maturate esattamente 12h di lavoro
    const istanteStop = new Date(entrata + pausaMs + MAX_ORE_LAVORO * 3600000);
    const res = await chiudiTimbratura(p, istanteStop);
    return { punch: null, autoStopped: true, ...res };
  }
  return { punch: p, autoStopped: false };
}

// Stato della timbratura in corso
app.get("/api/punch", auth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM punch WHERE user_id=$1", [req.user.id]);
  let p = await normalizzaPausaFissa(rows[0]);
  const auto = await autoStop12h(p);
  if (auto.autoStopped) return res.json({ autoStopped: true, straordinari: auto.straordinari });
  res.json(auto.punch || null);
});

// Entrata: crea una sessione
app.post("/api/punch/entrata", auth, async (req, res) => {
  try {
    const exists = await pool.query("SELECT 1 FROM punch WHERE user_id=$1", [req.user.id]);
    if (exists.rowCount) return res.status(400).json({ error: "Hai già una timbratura in corso." });
    const { rows } = await pool.query(
      "INSERT INTO punch (user_id, entrata, stato, pausa_totale) VALUES ($1, now(), 'attivo', 0) RETURNING *",
      [req.user.id]
    );
    res.json(rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "Errore nell'entrata." }); }
});

// Pausa: sospende il conteggio
app.post("/api/punch/pausa", auth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM punch WHERE user_id=$1", [req.user.id]);
    const p = rows[0];
    if (!p) return res.status(400).json({ error: "Nessuna timbratura in corso." });
    if (p.stato === "in_pausa") return res.status(400).json({ error: "Sei già in pausa." });
    const { rows: upd } = await pool.query(
      "UPDATE punch SET stato='in_pausa', pausa_inizio=now() WHERE user_id=$1 RETURNING *", [req.user.id]
    );
    res.json(upd[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "Errore nella pausa." }); }
});

// Pausa fissa: ferma il conteggio per un tempo fisso (150 min), riprende da sola allo scadere.
app.post("/api/punch/pausa-fissa", auth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM punch WHERE user_id=$1", [req.user.id]);
    let p = await normalizzaPausaFissa(rows[0]);
    if (!p) return res.status(400).json({ error: "Nessuna timbratura in corso." });
    if (p.stato === "in_pausa") return res.status(400).json({ error: "Sei già in pausa manuale." });
    if (p.stato === "pausa_fissa") return res.status(400).json({ error: "Pausa fissa già in corso." });
    const { rows: upd } = await pool.query(
      `UPDATE punch SET stato='pausa_fissa', pausa_fine = now() + ($2 || ' minutes')::interval
       WHERE user_id=$1 RETURNING *`,
      [req.user.id, String(PAUSA_FISSA_MIN)]
    );
    res.json(upd[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: "Errore nell'avvio della pausa fissa." }); }
});

// Riprendi: chiude la pausa (manuale o fissa) e somma i minuti effettivi
app.post("/api/punch/riprendi", auth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM punch WHERE user_id=$1", [req.user.id]);
    let p = await normalizzaPausaFissa(rows[0]);
    if (!p) return res.status(400).json({ error: "Nessuna timbratura in corso." });
    // se la pausa fissa è appena scaduta, normalizzaPausaFissa l'ha già chiusa
    if (p.stato === "attivo") return res.json(p);
    if (p.stato === "in_pausa") {
      const minutiPausa = Math.round((Date.now() - new Date(p.pausa_inizio).getTime()) / 60000);
      const { rows: upd } = await pool.query(
        "UPDATE punch SET stato='attivo', pausa_inizio=NULL, pausa_totale=pausa_totale+$2 WHERE user_id=$1 RETURNING *",
        [req.user.id, minutiPausa]
      );
      return res.json(upd[0]);
    }
    if (p.stato === "pausa_fissa") {
      // rientro anticipato: conto i minuti realmente trascorsi (pausa_fine - 150min = inizio pausa)
      const inizioPausa = new Date(p.pausa_fine).getTime() - PAUSA_FISSA_MIN * 60000;
      const minutiPausa = Math.max(0, Math.round((Date.now() - inizioPausa) / 60000));
      const { rows: upd } = await pool.query(
        "UPDATE punch SET stato='attivo', pausa_fine=NULL, pausa_totale=pausa_totale+$2 WHERE user_id=$1 RETURNING *",
        [req.user.id, minutiPausa]
      );
      return res.json(upd[0]);
    }
    res.status(400).json({ error: "Non sei in pausa." });
  } catch (e) { console.error(e); res.status(500).json({ error: "Errore nel riprendere." }); }
});

// Uscita: chiude la sessione e crea la registrazione ore
app.post("/api/punch/uscita", auth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM punch WHERE user_id=$1", [req.user.id]);
    const p = rows[0];
    if (!p) return res.status(400).json({ error: "Nessuna timbratura in corso." });
    const result = await chiudiTimbratura(p, new Date(), { cantiere: req.body.cantiere, nomeCantiere: req.body.nomeCantiere });
    res.json(result);
  } catch (e) { console.error(e); res.status(500).json({ error: "Errore nell'uscita." }); }
});

// Annulla la timbratura in corso senza registrare
app.delete("/api/punch", auth, async (req, res) => {
  await pool.query("DELETE FROM punch WHERE user_id=$1", [req.user.id]);
  res.json({ ok: true });
});

// ============================================================
//  ORE LAVORATE (dichiarate dall'utente)
// ============================================================
app.get("/api/worklogs", auth, async (req, res) => {
  if (req.user.role === "admin") {
    const q = await pool.query(`SELECT w.*, u.name AS user_name FROM worklogs w JOIN users u ON u.id=w.user_id ORDER BY w.data DESC`);
    return res.json(q.rows);
  }
  // Utente: solo mese corrente + 2 mesi precedenti (finestra di 3 mesi).
  // Calcolo il primo giorno del mese di 2 mesi fa, in riferimento alla data italiana.
  const oggi = todayItaly(); // YYYY-MM-DD
  const [y, m] = oggi.split("-").map(Number);
  let anno = y, mese = m - 2;
  while (mese < 1) { mese += 12; anno -= 1; }
  const dataMin = `${anno}-${String(mese).padStart(2,"0")}-01`;
  const q = await pool.query(
    "SELECT * FROM worklogs WHERE user_id=$1 AND data >= $2 ORDER BY data DESC",
    [req.user.id, dataMin]
  );
  res.json(q.rows);
});

app.post("/api/worklogs", auth, async (req, res) => {
  const { data, inizio, fine, pausa, ore, straordinari, cantiere, nomeCantiere,
          mattinoInizio, mattinoFine, pomeriggioInizio, pomeriggioFine } = req.body;
  // L'utente può registrare ore solo per la giornata odierna (fuso Italia). L'admin senza vincoli.
  if (req.user.role !== "admin" && !isTodayItaly(data)) {
    return res.status(403).json({ error: "Puoi registrare le ore solo per la giornata di oggi. Le giornate passate può modificarle solo l'amministratore." });
  }
  const nomeCant = cantiere ? String(nomeCantiere || "").trim() : "";
  try {
    const { rows } = await pool.query(
      `INSERT INTO worklogs (user_id, data, inizio, fine, pausa, ore, straordinari, cantiere, nome_cantiere,
                             mattino_inizio, mattino_fine, pomeriggio_inizio, pomeriggio_fine)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [req.user.id, data, inizio, fine, Number(pausa || 0), Number(ore), Number(straordinari || 0), !!cantiere, nomeCant,
       mattinoInizio || "", mattinoFine || "", pomeriggioInizio || "", pomeriggioFine || ""]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore nel salvataggio delle ore." });
  }
});

// Modifica di una registrazione ore. L'utente può correggere le proprie;
// l'admin può correggere quelle di chiunque (in caso di incongruenza).
app.put("/api/worklogs/:id", auth, async (req, res) => {
  const { data, inizio, fine, pausa, ore, straordinari, cantiere, nomeCantiere,
          mattinoInizio, mattinoFine, pomeriggioInizio, pomeriggioFine } = req.body;
  try {
    const { rows } = await pool.query("SELECT * FROM worklogs WHERE id=$1", [req.params.id]);
    const w = rows[0];
    if (!w) return res.status(404).json({ error: "Registrazione non trovata." });
    if (w.user_id !== req.user.id && req.user.role !== "admin")
      return res.status(403).json({ error: "Non puoi modificare questa registrazione." });
    // L'utente può modificare solo le registrazioni della giornata odierna; l'admin sempre.
    if (req.user.role !== "admin" && !isTodayItaly(w.data)) {
      return res.status(403).json({ error: "Le ore dei giorni passati sono bloccate. Solo l'amministratore può modificarle." });
    }
    // Impedisce anche di spostare una registrazione odierna a una data passata.
    if (req.user.role !== "admin" && !isTodayItaly(data)) {
      return res.status(403).json({ error: "Puoi impostare solo la data di oggi." });
    }
    const { rows: upd } = await pool.query(
      `UPDATE worklogs SET data=$1, inizio=$2, fine=$3, pausa=$4, ore=$5, straordinari=$6, cantiere=$7, nome_cantiere=$8,
        mattino_inizio=$9, mattino_fine=$10, pomeriggio_inizio=$11, pomeriggio_fine=$12, updated_at=now()
       WHERE id=$13 RETURNING *`,
      [data, inizio, fine, Number(pausa || 0), Number(ore), Number(straordinari || 0), !!cantiere,
       cantiere ? String(nomeCantiere || "").trim() : "",
       mattinoInizio || "", mattinoFine || "", pomeriggioInizio || "", pomeriggioFine || "", req.params.id]
    );
    res.json(upd[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore nella modifica delle ore." });
  }
});

app.delete("/api/worklogs/:id", auth, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM worklogs WHERE id=$1", [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "Non trovato." });
    if (rows[0].user_id !== req.user.id && req.user.role !== "admin")
      return res.status(403).json({ error: "Non consentito." });
    // L'utente può eliminare solo le registrazioni odierne; l'admin sempre.
    if (req.user.role !== "admin" && !isTodayItaly(rows[0].data)) {
      return res.status(403).json({ error: "Le ore dei giorni passati sono bloccate. Solo l'amministratore può eliminarle." });
    }
    await pool.query("DELETE FROM worklogs WHERE id=$1", [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Errore nell'eliminazione." });
  }
});

// ============================================================
//  RILEVAZIONI (ore rilevate dall'admin)
// ============================================================
app.get("/api/detected", auth, async (req, res) => {
  const q = req.user.role === "admin"
    ? await pool.query(`SELECT d.*, u.name AS user_name FROM detected d JOIN users u ON u.id=d.user_id ORDER BY d.data DESC`)
    : await pool.query("SELECT * FROM detected WHERE user_id=$1 ORDER BY data DESC", [req.user.id]);
  res.json(q.rows);
});

app.post("/api/detected", auth, adminOnly, async (req, res) => {
  const { userId, data, ore } = req.body;
  try {
    const { rows } = await pool.query(
      `INSERT INTO detected (user_id, data, ore) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, data) DO UPDATE SET ore=EXCLUDED.ore RETURNING *`,
      [userId, data, Number(ore)]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore nel salvataggio della rilevazione." });
  }
});

app.delete("/api/detected/:id", auth, adminOnly, async (req, res) => {
  await pool.query("DELETE FROM detected WHERE id=$1", [req.params.id]);
  res.json({ ok: true });
});

// ============================================================
//  UTENTI (elenco per admin)
// ============================================================
app.get("/api/users", auth, adminOnly, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, email, role FROM users ORDER BY role, name"
  );
  res.json(rows);
});

// L'admin crea un account (dipendente o altro amministratore) senza passare dalla registrazione pubblica.
app.post("/api/users", auth, adminOnly, async (req, res) => {
  const { name, email, password, role, sendEmail } = req.body || {};
  const ruolo = role === "admin" ? "admin" : "user";
  if (!name?.trim()) return res.status(400).json({ error: "Inserisci il nome." });
  if (!/^\S+@\S+\.\S+$/.test(email || "")) return res.status(400).json({ error: "Email non valida." });
  if ((password || "").length < 4) return res.status(400).json({ error: "Password troppo corta (min 4)." });
  try {
    const exists = await pool.query("SELECT 1 FROM users WHERE lower(email)=lower($1)", [email]);
    if (exists.rowCount) return res.status(409).json({ error: "Email già registrata." });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      "INSERT INTO users (name, email, pw_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role",
      [name.trim(), email.trim().toLowerCase(), hash, ruolo]
    );
    const u = rows[0];
    const subject = "Account creato";
    const body = `Ciao ${u.name}, l'amministratore ha creato il tuo account su Gestione ore. Accedi con ${u.email} e la password che ti è stata comunicata.`;
    await pool.query("INSERT INTO messages (user_id, subject, body) VALUES ($1,$2,$3)", [u.id, subject, body]);
    let emailSent = false;
    if (sendEmail) {
      emailSent = await sendMail(
        u.email,
        "Il tuo account Gestione ore",
        `Ciao ${u.name},\n\nl'amministratore ha creato il tuo account.\n\nEmail: ${u.email}\nPassword iniziale: ${password}\nRuolo: ${ruolo === "admin" ? "amministratore" : "dipendente"}\n\nAccedi dall'app e conserva la password.`
      );
    }
    res.json({ user: u, emailSent });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore nella creazione dell'utente." });
  }
});

// Reimposta la password di un altro account (non la propria, per non chiudersi fuori per sbaglio).
app.put("/api/users/:id/password", auth, adminOnly, async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: "Per il tuo account usa la password attuale: non puoi reimpostarla da qui." });
  }
  const password = req.body?.password || "";
  if (password.length < 4) return res.status(400).json({ error: "Password troppo corta (min 4)." });
  try {
    const hash = await bcrypt.hash(password, 10);
    const { rowCount } = await pool.query("UPDATE users SET pw_hash=$1 WHERE id=$2", [hash, req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Utente non trovato." });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore nel cambio password." });
  }
});

// Elimina un account e i dati collegati (richieste, ore, messaggi). Non puoi eliminare te stesso.
app.delete("/api/users/:id", auth, adminOnly, async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: "Non puoi eliminare il tuo account." });
  }
  try {
    const { rowCount } = await pool.query("DELETE FROM users WHERE id=$1", [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "Utente non trovato." });
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore nell'eliminazione dell'utente." });
  }
});

// ============================================================
//  EXPORT EXCEL (riepilogo mensile di tutti gli utenti, solo admin)
// ============================================================
// Converte in "YYYY-MM-DD" sia le stringhe sia gli oggetti Date restituiti da Postgres.
function toISO(v) {
  if (!v) return "";
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, "0"), d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}
function hoursBetween(a, b) {
  if (!a || !b) return 0;
  const [h1, m1] = a.split(":").map(Number), [h2, m2] = b.split(":").map(Number);
  return ((h2 * 60 + m2) - (h1 * 60 + m1)) / 60;
}
function eachDayISO(start, end) {
  const out = []; let d = new Date(toISO(start)), e = new Date(toISO(end));
  while (d <= e) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
}

app.get("/api/export", auth, adminOnly, async (req, res) => {
  // parametri: ?year=2026&month=8  (month 1-12)
  const year = Number(req.query.year) || new Date().getFullYear();
  const month = Number(req.query.month) || (new Date().getMonth() + 1);
  const inMonth = (v) => { const s = toISO(v); return Number(s.slice(0,4)) === year && Number(s.slice(5,7)) === month; };
  const fmtD = (v) => { const s = toISO(v); if (!s) return ""; const [y,m,d]=s.split("-"); return `${d}/${m}/${y}`; };
  const weekday = (iso) => {
    if (!iso) return "";
    const [y,m,d] = iso.split("-").map(Number);
    return ["Dom","Lun","Mar","Mer","Gio","Ven","Sab"][new Date(y, m - 1, d).getDay()];
  };
  const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const MESI = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
  const COLORS = ["FF1F6B4A","FF2B5F8A","FF8A5410","FF5B3F86","FF9A3B3B","FF1D6A6A","FF3E5C3A","FF6B4C2A"];

  function sheetName(name, used) {
    let base = String(name || "Utente").replace(/[\\/*?:\[\]]/g, " ").replace(/\s+/g, " ").trim().slice(0, 28) || "Utente";
    let n = base;
    let i = 2;
    while (used.has(n)) { n = `${base.slice(0, 25)} ${i++}`; }
    used.add(n);
    return n;
  }
  function paintHeader(row, argb) {
    row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    row.alignment = { vertical: "middle" };
    row.height = 22;
  }

  try {
    const users = (await pool.query("SELECT id, name, email FROM users WHERE role='user' ORDER BY name")).rows;
    const worklogs = (await pool.query("SELECT * FROM worklogs")).rows;

    const wb = new ExcelJS.Workbook();
    wb.creator = "Gestione ore";
    const titolo = `${MESI[month - 1] || month} ${year}`;
    const usedNames = new Set(["Indice", "Foglio unico", "Giornaliero"]);

    const people = users.map(u => {
      const logs = worklogs
        .filter(w => w.user_id === u.id && inMonth(w.data))
        .sort((a, b) => toISO(a.data).localeCompare(toISO(b.data)) || String(a.inizio || "").localeCompare(String(b.inizio || "")));
      return { u, logs };
    });

    // --- Indice: una riga per dipendente, così i 16 nomi si vedono subito ---
    const idx = wb.addWorksheet("Indice", { views: [{ state: "frozen", ySplit: 2 }] });
    idx.columns = [
      { width: 28 }, { width: 32 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 22 },
    ];
    idx.mergeCells("A1:F1");
    idx.getCell("A1").value = `Dipendenti · ${titolo}`;
    paintHeader(idx.getRow(1), "FF1F4E3D");
    ["Dipendente", "Email", "Giorni", "Ore lavorate", "Straordinari (h)", "Foglio dettaglio"].forEach((h, i) => {
      idx.getCell(2, i + 1).value = h;
    });
    paintHeader(idx.getRow(2), "FF3A7D6B");
    people.forEach(({ u, logs }, i) => {
      const ore = round2(logs.reduce((s, w) => s + Number(w.ore || 0), 0));
      const straord = round2(logs.reduce((s, w) => s + Number(w.straordinari || 0), 0));
      const tab = sheetName(u.name, usedNames);
      const row = idx.addRow([u.name, u.email, logs.length, ore, straord, tab]);
      row.getCell(6).value = { text: tab, hyperlink: `#'${tab.replace(/'/g, "''")}'!A1` };
      row.getCell(6).font = { color: { argb: "FF1F4E8A" }, underline: true };
      if (i % 2 === 1) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7F5" } };
      row.alignment = { vertical: "middle" };
      u._sheet = tab;
    });
    idx.autoFilter = { from: "A2", to: "F2" };
    idx.getRow(2).height = 22;

    // --- Foglio unico: tutte le giornate di tutti, una riga per giornata, filtrabile ---
    const unico = wb.addWorksheet("Foglio unico", {
      views: [{ state: "frozen", ySplit: 2 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    });
    unico.columns = [
      { width: 26 }, { width: 30 }, { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 },
      { width: 14 }, { width: 16 }, { width: 16 }, { width: 28 },
    ];
    unico.mergeCells("A1:J1");
    unico.getCell("A1").value = `Tutti i dipendenti · ${titolo} · una riga per giornata`;
    paintHeader(unico.getRow(1), "FF1F4E3D");
    ["Dipendente", "Email", "Data", "Giorno", "Inizio", "Fine", "Pausa (min)", "Ore lavorate", "Straordinari (h)", "Sede / cantiere"].forEach((h, i) => {
      unico.getCell(2, i + 1).value = h;
    });
    paintHeader(unico.getRow(2), "FF3A7D6B");
    const flat = [];
    people.forEach(({ u, logs }) => {
      logs.forEach(w => flat.push({ u, w }));
    });
    flat.sort((a, b) => a.u.name.localeCompare(b.u.name, "it") || toISO(a.w.data).localeCompare(toISO(b.w.data)) || String(a.w.inizio || "").localeCompare(String(b.w.inizio || "")));
    let lastName = "";
    let band = 0;
    if (flat.length === 0) {
      unico.addRow(["Nessuna giornata registrata in questo mese"]);
    } else {
      flat.forEach(({ u, w }) => {
        if (u.name !== lastName) { band += 1; lastName = u.name; }
        const iso = toISO(w.data);
        const sede = w.cantiere ? `Cantiere${w.nome_cantiere ? ": " + w.nome_cantiere : ""}` : "Sede";
        const row = unico.addRow([
          u.name, u.email, fmtD(w.data), weekday(iso), w.inizio || "", w.fine || "",
          Number(w.pausa || 0), round2(w.ore), round2(w.straordinari), sede,
        ]);
        row.getCell(8).numFmt = "0.00";
        row.getCell(9).numFmt = "0.00";
        if (band % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F7F5" } };
        if (Number(w.straordinari) > 0) row.getCell(9).font = { bold: true, color: { argb: "FF8A5410" } };
      });
    }
    unico.autoFilter = { from: "A2", to: "J2" };
    unico.pageSetup.printTitlesRow = "1:2";

    // --- Giornaliero: un blocco colorato per persona, righe non sommate ---
    const ws = wb.addWorksheet("Giornaliero", {
      views: [{ state: "frozen", ySplit: 2 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    });
    ws.columns = [
      { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 18 }, { width: 14 }, { width: 28 },
    ];
    ws.mergeCells("A1:H1");
    ws.getCell("A1").value = `Ore giornaliere · ${titolo} · una riga per giornata, non il totale del mese`;
    paintHeader(ws.getRow(1), "FF1F4E3D");
    const headers = ["Data", "Giorno", "Inizio", "Fine", "Pausa (min)", "Ore lavorate", "Straordinari (h)", "Sede / cantiere"];
    headers.forEach((h, i) => { ws.getCell(2, i + 1).value = h; });
    paintHeader(ws.getRow(2), "FF3A7D6B");
    ws.autoFilter = { from: "A2", to: "H2" };
    ws.pageSetup.printTitlesRow = "1:2";

    people.forEach(({ u, logs }, i) => {
      const color = COLORS[i % COLORS.length];
      const banner = ws.addRow([`${u.name}  ·  ${u.email}`]);
      ws.mergeCells(banner.number, 1, banner.number, 8);
      paintHeader(banner, color);
      banner.height = 24;
      if (logs.length === 0) {
        const empty = ws.addRow(["Nessuna giornata registrata in questo mese"]);
        empty.font = { italic: true, color: { argb: "FF6B7280" } };
      } else {
        let ore = 0, straord = 0;
        logs.forEach(w => {
          const iso = toISO(w.data);
          const sede = w.cantiere ? `Cantiere${w.nome_cantiere ? ": " + w.nome_cantiere : ""}` : "Sede";
          const row = ws.addRow([
            fmtD(w.data), weekday(iso), w.inizio || "", w.fine || "",
            Number(w.pausa || 0), round2(w.ore), round2(w.straordinari), sede,
          ]);
          row.outlineLevel = 1;
          row.getCell(6).numFmt = "0.00";
          row.getCell(7).numFmt = "0.00";
          if (Number(w.straordinari) > 0) row.getCell(7).font = { bold: true, color: { argb: "FF8A5410" } };
          ore += Number(w.ore || 0);
          straord += Number(w.straordinari || 0);
        });
        const tot = ws.addRow(["Totale mese", "", "", "", "", round2(ore), round2(straord), `${logs.length} giornate`]);
        tot.font = { bold: true };
        tot.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7F0EC" } };
        tot.getCell(6).numFmt = "0.00";
        tot.getCell(7).numFmt = "0.00";
      }
      ws.addRow([]);
    });

    // --- Un foglio per dipendente, così con 16 persone ognuno sta da solo ---
    people.forEach(({ u, logs }, i) => {
      const tab = u._sheet;
      const sh = wb.addWorksheet(tab, { views: [{ state: "frozen", ySplit: 3 }] });
      sh.columns = [
        { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 28 },
      ];
      sh.mergeCells("A1:H1");
      sh.getCell("A1").value = `${u.name} · ${u.email} · ${titolo}`;
      paintHeader(sh.getRow(1), COLORS[i % COLORS.length]);
      sh.mergeCells("A2:H2");
      sh.getCell("A2").value = "Una riga per giornata. Le ore non sono sommate: il totale è solo nell'ultima riga.";
      sh.getRow(2).font = { italic: true, color: { argb: "FF4B5563" } };
      ["Data", "Giorno", "Inizio", "Fine", "Pausa (min)", "Ore lavorate", "Straordinari (h)", "Sede / cantiere"].forEach((h, c) => {
        sh.getCell(3, c + 1).value = h;
      });
      paintHeader(sh.getRow(3), "FF3A7D6B");
      if (logs.length === 0) {
        sh.addRow(["Nessuna giornata registrata in questo mese"]);
      } else {
        let ore = 0, straord = 0;
        logs.forEach(w => {
          const iso = toISO(w.data);
          const sede = w.cantiere ? `Cantiere${w.nome_cantiere ? ": " + w.nome_cantiere : ""}` : "Sede";
          const row = sh.addRow([
            fmtD(w.data), weekday(iso), w.inizio || "", w.fine || "",
            Number(w.pausa || 0), round2(w.ore), round2(w.straordinari), sede,
          ]);
          row.getCell(6).numFmt = "0.00";
          row.getCell(7).numFmt = "0.00";
          if (Number(w.straordinari) > 0) row.getCell(7).font = { bold: true, color: { argb: "FF8A5410" } };
          ore += Number(w.ore || 0);
          straord += Number(w.straordinari || 0);
        });
        const tot = sh.addRow(["Totale mese", "", "", "", "", round2(ore), round2(straord), `${logs.length} giornate`]);
        tot.font = { bold: true };
        tot.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7F0EC" } };
      }
      sh.autoFilter = { from: "A3", to: "H3" };
      sh.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="riepilogo_${year}_${String(month).padStart(2,"0")}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore nella generazione del file Excel." });
  }
});

// Export dettagliato di UN singolo utente (mese scelto): due fogli — rilevazioni e richieste.
app.get("/api/export-user/:userId", auth, adminOnly, async (req, res) => {
  const userId = Number(req.params.userId);
  const year = Number(req.query.year) || new Date().getFullYear();
  const month = Number(req.query.month) || (new Date().getMonth() + 1);
  const inMonth = (v) => { const s = toISO(v); return Number(s.slice(0,4)) === year && Number(s.slice(5,7)) === month; };

  // formatta un timestamp in "GG/MM/AAAA HH:MM" ora italiana
  const fmtDT = (v) => {
    if (!v) return "";
    const d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d)) return "";
    return new Intl.DateTimeFormat("it-IT", {
      timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    }).format(d).replace(",", "");
  };
  const fmtD = (v) => { const s = toISO(v); if (!s) return ""; const [y,m,d]=s.split("-"); return `${d}/${m}/${y}`; };

  try {
    const us = (await pool.query("SELECT name, email FROM users WHERE id=$1", [userId])).rows[0];
    if (!us) return res.status(404).json({ error: "Utente non trovato." });

    const worklogs = (await pool.query("SELECT * FROM worklogs WHERE user_id=$1 ORDER BY data", [userId])).rows
      .filter(w => inMonth(w.data));
    const requests = (await pool.query("SELECT * FROM requests WHERE user_id=$1 ORDER BY created_at", [userId])).rows;

    const wb = new ExcelJS.Workbook();
    wb.creator = "Gestione ore";
    const mm = String(month).padStart(2,"0");

    const headStyle = (row) => {
      row.font = { bold: true, color: { argb: "FFFFFFFF" } };
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3A7D6B" } };
    };

    // --- Foglio 1: Rilevazioni ore ---
    const ws1 = wb.addWorksheet("Rilevazioni ore");
    ws1.columns = [
      { header: "Data", key: "data", width: 12 },
      { header: "Entrata", key: "inizio", width: 10 },
      { header: "Uscita", key: "fine", width: 10 },
      { header: "Pausa (min)", key: "pausa", width: 12 },
      { header: "Ore", key: "ore", width: 10 },
      { header: "Straordinari", key: "straord", width: 12 },
      { header: "Cantiere", key: "cantiere", width: 10 },
      { header: "Nome cantiere", key: "nomecant", width: 24 },
      { header: "Registrata il", key: "creata", width: 20 },
      { header: "Ultima modifica", key: "modificata", width: 20 },
    ];
    headStyle(ws1.getRow(1));
    worklogs.forEach(w => {
      ws1.addRow({
        data: fmtD(w.data), inizio: w.inizio, fine: w.fine, pausa: w.pausa,
        ore: Number(w.ore), straord: Number(w.straordinari || 0),
        cantiere: w.cantiere ? "Sì" : "No", nomecant: w.nome_cantiere || "",
        creata: fmtDT(w.created_at), modificata: fmtDT(w.updated_at || w.created_at),
      });
    });
    if (worklogs.length === 0) ws1.addRow({ data: "Nessuna rilevazione nel mese" });

    // --- Foglio 2: Richieste ---
    const ws2 = wb.addWorksheet("Richieste");
    ws2.columns = [
      { header: "Tipo", key: "tipo", width: 14 },
      { header: "Modalità", key: "mode", width: 12 },
      { header: "Dal", key: "dal", width: 18 },
      { header: "Al", key: "al", width: 14 },
      { header: "Richiesta il", key: "richiesta", width: 20 },
      { header: "Esito", key: "esito", width: 14 },
    ];
    headStyle(ws2.getRow(1));
    const tipoLabel = { permesso: "Permesso", ferie: "Ferie", assenza: "Assenza" };
    const statoLabel = { in_attesa: "In attesa", approvata: "Approvata", respinta: "Respinta" };
    requests.forEach(r => {
      const dal = r.mode === "ore" ? `${fmtD(r.data_inizio)} ${r.ora_inizio}-${r.ora_fine}` : fmtD(r.data_inizio);
      const al = r.mode === "ore" ? "" : fmtD(r.data_fine);
      ws2.addRow({
        tipo: tipoLabel[r.tipo] || r.tipo, mode: r.mode === "ore" ? "Oraria" : "Giornaliera",
        dal, al, richiesta: fmtDT(r.created_at), esito: statoLabel[r.stato] || r.stato,
      });
    });
    if (requests.length === 0) ws2.addRow({ tipo: "Nessuna richiesta" });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    const safeName = us.name.replace(/[^a-zA-Z0-9]/g, "_");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_${year}_${mm}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Errore nella generazione del file Excel utente." });
  }
});

// ============================================================
//  MESSAGGI / COMUNICAZIONI
// ============================================================
app.get("/api/messages", auth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM messages WHERE user_id=$1 ORDER BY created_at DESC", [req.user.id]
  );
  res.json(rows);
});

app.post("/api/messages/:id/read", auth, async (req, res) => {
  await pool.query("UPDATE messages SET read=true WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// Archivia un singolo messaggio (lo nasconde dalla vista principale, resta recuperabile)
app.post("/api/messages/:id/archive", auth, async (req, res) => {
  await pool.query("UPDATE messages SET archived=true, read=true WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// Ripristina un messaggio archiviato
app.post("/api/messages/:id/unarchive", auth, async (req, res) => {
  await pool.query("UPDATE messages SET archived=false WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// Elimina un singolo messaggio
app.delete("/api/messages/:id", auth, async (req, res) => {
  await pool.query("DELETE FROM messages WHERE id=$1 AND user_id=$2", [req.params.id, req.user.id]);
  res.json({ ok: true });
});

// Azioni in blocco su tutte le comunicazioni GIÀ LETTE dell'utente
app.post("/api/messages/archive-read", auth, async (req, res) => {
  const { rowCount } = await pool.query("UPDATE messages SET archived=true WHERE user_id=$1 AND read=true AND archived=false", [req.user.id]);
  res.json({ ok: true, count: rowCount });
});
app.post("/api/messages/delete-read", auth, async (req, res) => {
  const { rowCount } = await pool.query("DELETE FROM messages WHERE user_id=$1 AND read=true", [req.user.id]);
  res.json({ ok: true, count: rowCount });
});

// ============================================================
//  SERVING DEL FRONTEND (build di Vite in client/dist)
// ============================================================
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

// ---------- Avvio ----------
initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`✓ Server in ascolto sulla porta ${PORT}`));
  })
  .catch((e) => {
    console.error("Errore inizializzazione DB:", e);
    process.exit(1);
  });
