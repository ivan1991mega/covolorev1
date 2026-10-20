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
      }
      // Email sempre a Caterina (indipendentemente dagli admin nel DB)
      sendMail("caterina@covolo.com", subject, body).catch(() => {});
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
