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
      "INSERT INTO users (name, email, pw_hash, role, stato) VALUES ($1,$2,$3,'user','in_attesa') RETURNING id, name, email, role, stato",
      [name.trim(), email.trim(), hash]
    );
    // Notifica admin
    try {
      const admins = await pool.query("SELECT email FROM users WHERE role='admin'");
      const subject = "Nuova registrazione in attesa di approvazione";
      const body = `È arrivata una nuova registrazione:\n\nNome: ${name.trim()}\nEmail: ${email.trim()}\n\nAccedi all'area admin per approvare o rifiutare.`;
      for (const a of admins.rows) {
        await sendMail(a.email, subject, body);
      }
    } catch (e) { console.error("Notifica registrazione:", e.message); }
    res.json({ pending: true, message: "Registrazione ricevuta. L'amministratore deve approvarla prima che tu possa accedere." });
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
    if (u.stato && u.stato !== "attivo") {
      return res.status(403).json({ error: u.stato === "in_attesa" 
        ? "Il tuo account è in attesa di approvazione da parte dell'amministratore." 
        : "Il tuo account è stato rifiutato." });
    }
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

// ... (il resto del file è identico all'originale fino alla funzione export)

//  EXPORT EXCEL (riepilogo mensile di tutti gli utenti, solo admin)
// ============================================================
function splitOre8(totale) {
  const t = Math.round(Number(totale || 0) * 100) / 100;
  const ore = Math.round(Math.min(t, 8) * 100) / 100;
  const straordinari = Math.round(Math.max(0, t - 8) * 100) / 100;
  return { ore, straordinari };
}
function toISO(v) {
  if (!v) return "";
  if (v instanceof Date) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, "0"), d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}
function eachDayISO(start, end) {
  const out = []; let d = new Date(toISO(start)), e = new Date(toISO(end));
  while (d <= e) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
}
function allDaysOfMonth(year, month) {
  const days = [];
  const last = new Date(year, month, 0).getDate();
  for (let d = 1; d <= last; d++) {
    const mm = String(month).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    days.push(`${year}-${mm}-${dd}`);
  }
  return days;
}

app.get("/api/export", auth, adminOnly, async (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const month = Number(req.query.month) || (new Date().getMonth() + 1);
  const inMonth = (v) => { const s = toISO(v); return Number(s.slice(0,4)) === year && Number(s.slice(5,7)) === month; };
  const fmtD = (v) => { const s = toISO(v); if (!s) return ""; const [y,m,d]=s.split("-"); return `${d}/${m}/${y}`; };
  const weekday = (iso) => {
    if (!iso) return "";
    const [y,m,d] = iso.split("-").map(Number);
    return ["Dom","Lun","Mar","Mer","Gio","Ven","Sab"][new Date(y, m - 1, d).getDay()];
  };
  const asDecimal = (cell) => {
    cell.numFmt = "0.00";
    cell.alignment = { horizontal: "center" };
  };
  const MESI = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
  const COLORS = ["FF1F6B4A","FF2B5F8A","FF8A5410","FF5B3F86","FF9A3B3B","FF1D6A6A","FF3E5C3A","FF6B4C2A"];
  function paintHeader(row, argb) {
    row.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    row.fill = { type: "pattern", pattern: "solid", fgColor: { argb } };
    row.alignment = { vertical: "middle" };
    row.height = 22;
  }

  try {
    const users = (await pool.query("SELECT id, name, email FROM users WHERE role='user' ORDER BY name")).rows;
    const worklogs = (await pool.query("SELECT * FROM worklogs")).rows;
    const detected = (await pool.query("SELECT * FROM detected")).rows;
    const requests = (await pool.query("SELECT * FROM requests WHERE stato = 'approvata'")).rows;
    const calendarDays = allDaysOfMonth(year, month);

    const people = users.map(u => {
      const logsMap = new Map();
      worklogs
        .filter(w => w.user_id === u.id && inMonth(w.data))
        .forEach(w => logsMap.set(toISO(w.data), { ...w, fonte: "worklog" }));
      detected
        .filter(d => d.user_id === u.id && inMonth(d.data) && !logsMap.has(toISO(d.data)))
        .forEach(d => {
          const s = splitOre8(d.ore);
          logsMap.set(toISO(d.data), {
            data: d.data, inizio: "", fine: "", pausa: 0, ore: s.ore, straordinari: s.straordinari,
            cantiere: false, nome_cantiere: "", fonte: "admin",
          });
        });
      const userReqs = requests.filter(r => r.user_id === u.id);
      return { u, logsMap, userReqs };
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = "Gestione ore";
    const titolo = `${MESI[month - 1] || month} ${year}`;
    const ws = wb.addWorksheet("Giornaliero", {
      views: [{ state: "frozen", ySplit: 2 }],
      pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 },
    });
    ws.columns = [
      { width: 12 }, { width: 10 }, { width: 10 }, { width: 10 }, { width: 12 },
      { width: 14 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 24 },
      { width: 12 }, { width: 12 }, { width: 14 },
    ];
    ws.mergeCells("A1:M1");
    ws.getCell("A1").value = `Riepilogo giornaliero · ${titolo} · Ore in decimali · Tutti i giorni del mese · gg Permesso / Ferie / Malattia`;
    paintHeader(ws.getRow(1), "FF1F4E3D");
    ["Data", "Giorno", "Inizio", "Fine", "Pausa (min)", "Ore lavorate", "Straordinari (min)", "Mattino", "Pomeriggio", "Sede / cantiere", "Permesso", "Ferie", "Malattia"].forEach((h, i) => {
      ws.getCell(2, i + 1).value = h;
    });
    paintHeader(ws.getRow(2), "FF3A7D6B");
    ws.pageSetup.printTitlesRow = "1:2";

    people.forEach(({ u, logsMap, userReqs }, i) => {
      const banner = ws.addRow([`${u.name}  ·  ${u.email}`]);
      ws.mergeCells(banner.number, 1, banner.number, 13);
      paintHeader(banner, COLORS[i % COLORS.length]);
      banner.height = 24;

      let totOre = 0, totStraord = 0, totPermesso = 0, totFerie = 0, totMalattia = 0;

      calendarDays.forEach(isoDay => {
        const w = logsMap.get(isoDay);
        const sede = w
          ? (w.fonte === "admin" ? "Inserita dall'amministratore" : (w.cantiere ? `Cantiere${w.nome_cantiere ? ": " + w.nome_cantiere : ""}` : "Sede"))
          : "";
        const mattino = (w && w.mattino_inizio && w.mattino_fine) ? `${w.mattino_inizio}–${w.mattino_fine}` : "";
        const pomeriggio = (w && w.pomeriggio_inizio && w.pomeriggio_fine) ? `${w.pomeriggio_inizio}–${w.pomeriggio_fine}` : "";
        const oreVal = w ? Math.round(Number(w.ore || 0) * 100) / 100 : 0;
        const straordMin = w ? Math.round(Number(w.straordinari || 0) * 60) : 0;

        let permesso = "", ferie = "", malattia = "";
        for (const r of userReqs) {
          if (eachDayISO(r.data_inizio, r.data_fine).includes(isoDay)) {
            if (r.tipo === "permesso") {
              permesso = r.mode === "giorni" ? "1" : "Orario";
              if (r.mode === "giorni") totPermesso += 1;
            } else if (r.tipo === "ferie") {
              ferie = r.mode === "giorni" ? "1" : "Orario";
              if (r.mode === "giorni") totFerie += 1;
            } else if (r.tipo === "assenza") {
              malattia = r.mode === "giorni" ? "1" : "Orario";
              if (r.mode === "giorni") totMalattia += 1;
            }
            break;
          }
        }

        const row = ws.addRow([
          fmtD(isoDay), weekday(isoDay),
          w ? (w.inizio || "") : "", w ? (w.fine || "") : "",
          w ? Number(w.pausa || 0) : "",
          oreVal, straordMin || "",
          mattino, pomeriggio, sede,
          permesso, ferie, malattia,
        ]);
        asDecimal(row.getCell(6));
        row.getCell(7).numFmt = "0";
        row.getCell(7).alignment = { horizontal: "center" };
        if (straordMin > 0) row.getCell(7).font = { bold: true, color: { argb: "FF8A5410" } };
        totOre += oreVal;
        totStraord += (w ? Number(w.straordinari || 0) : 0);
      });

      const tot = ws.addRow([
        "Totale mese", "", "", "", "",
        Math.round(totOre * 100) / 100,
        Math.round(totStraord * 60),
        "", "", "",
        totPermesso || "", totFerie || "", totMalattia || "",
      ]);
      tot.font = { bold: true };
      tot.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE7F0EC" } };
      asDecimal(tot.getCell(6));
      tot.getCell(7).numFmt = "0";
      tot.getCell(7).alignment = { horizontal: "center" };
      ws.addRow([]);
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

// Il resto del file (export-user e avvio) rimane invariato rispetto all'originale.
