import React, { useState, useEffect, useMemo, useCallback } from "react";
import { api, getToken, setToken, clearToken } from "./api.js";

/* ============================================================
   GESTIONE ORE — versione full-stack (dati condivisi via database)
   ============================================================ */

const MESI = ["Gennaio","Febbraio","Marzo","Aprile","Maggio","Giugno","Luglio","Agosto","Settembre","Ottobre","Novembre","Dicembre"];
const GIORNI = ["Lun","Mar","Mer","Gio","Ven","Sab","Dom"];

const TIPI = {
  lavoro:   { label: "Ore lavorate", color: "#2f6f4f", bg: "#e4f0e9", short: "L" },
  permesso: { label: "Permesso",     color: "#b3701c", bg: "#f7ecd9", short: "P" },
  ferie:    { label: "Ferie",        color: "#2b5f8a", bg: "#e0ebf4", short: "F" },
  assenza:  { label: "Assenza",      color: "#9a3b3b", bg: "#f4e3e3", short: "A" },
};
const STATI = {
  in_attesa: { label: "In attesa", color: "#b3701c", bg: "#f7ecd9" },
  approvata: { label: "Approvata", color: "#2f6f4f", bg: "#e4f0e9" },
  respinta:  { label: "Respinta",  color: "#9a3b3b", bg: "#f4e3e3" },
};

// ---------- utilità ----------
const todayISO = () => new Date().toISOString().slice(0, 10);
const iso = (v) => (v ? String(v).slice(0, 10) : "");
const fmtDate = (v) => { const s = iso(v); if (!s) return ""; const [y,m,d]=s.split("-"); return `${d}/${m}/${y}`; };
const isFuture = (v) => iso(v) >= todayISO();
const round2 = (n) => Math.round(n * 100) / 100;
const initials = (name) => name.split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase();
function hoursBetween(a,b){ const [h1,m1]=a.split(":").map(Number),[h2,m2]=b.split(":").map(Number); return ((h2*60+m2)-(h1*60+m1))/60; }
function eachDay(start,end){ const out=[]; let d=new Date(iso(start)), e=new Date(iso(end)); while(d<=e){ out.push(d.toISOString().slice(0,10)); d.setDate(d.getDate()+1);} return out; }
function canEdit(r){ return r.stato==="in_attesa" && isFuture(r.data_inizio); }
function describeReq(r){
  if (r.mode==="ore") return `${fmtDate(r.data_inizio)} · ${r.ora_inizio}–${r.ora_fine}`;
  const days = eachDay(r.data_inizio, r.data_fine).length;
  return iso(r.data_inizio)===iso(r.data_fine) ? `${fmtDate(r.data_inizio)} (1 giorno)` : `${fmtDate(r.data_inizio)} → ${fmtDate(r.data_fine)} (${days} giorni)`;
}
// Link per comporre l'email direttamente in Gmail web (nessun client di sistema richiesto).
function buildGmail(email, subject, body){
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ============================================================
//  APP
// ============================================================
export default function App() {
  const [me, setMe] = useState(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("tema") || "light");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("tema", theme);
  }, [theme]);
  const toggleTheme = () => setTheme(t => t === "light" ? "dark" : "light");

  useEffect(() => {
    (async () => {
      if (getToken()) {
        try { const { user } = await api.get("/api/me"); setMe(user); }
        catch { clearToken(); }
      }
      setReady(true);
    })();
  }, []);

  const logout = () => { clearToken(); setMe(null); };

  if (!ready) return <div className="wrap"><div className="center">Caricamento…</div><style>{CSS}</style></div>;
  if (!me) return <Auth onLogin={setMe} theme={theme} toggleTheme={toggleTheme} />;
  return me.role === "admin"
    ? <AdminApp me={me} onLogout={logout} theme={theme} toggleTheme={toggleTheme} />
    : <UserApp me={me} onLogout={logout} theme={theme} toggleTheme={toggleTheme} />;
}

// ============================================================
//  AUTENTICAZIONE
// ============================================================
function Auth({ onLogin, theme, toggleTheme }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(""); setBusy(true);
    try {
      const payload = mode==="login" ? { email, password: pw } : { name, email, password: pw };
      const { token, user } = await api.post(mode==="login" ? "/api/login" : "/api/register", payload);
      setToken(token); onLogin(user);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="wrap authwrap">
      <button className="btn ghost tiny themebtn corner" onClick={toggleTheme} title={theme==="dark"?"Modalità chiara":"Modalità scura"}>{theme==="dark"?"☀":"☾"}</button>
      <div className="authcard">
        <div className="brand">
          <span className="brandmark">◷</span>
          <div><h1>Gestione ore</h1><p className="muted">Presenze · permessi · ferie · assenze</p></div>
        </div>
        <div className="tabs">
          <button className={mode==="login"?"tab on":"tab"} onClick={()=>{setMode("login");setErr("");}}>Accedi</button>
          <button className={mode==="register"?"tab on":"tab"} onClick={()=>{setMode("register");setErr("");}}>Registrati</button>
        </div>
        {mode==="register" && (
          <label className="field"><span>Nome e cognome</span>
            <input value={name} onChange={e=>setName(e.target.value)} placeholder="Es. Giulia Bianchi" /></label>
        )}
        <label className="field"><span>Email</span>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@azienda.it" /></label>
        <label className="field"><span>Password</span>
          <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="••••••"
            onKeyDown={e=>{if(e.key==="Enter")submit();}} /></label>
        {err && <div className="alert">{err}</div>}
        <button className="btn primary big" onClick={submit} disabled={busy}>
          {busy ? "Attendere…" : (mode==="login" ? "Accedi" : "Crea account")}
        </button>
      </div>
      <style>{CSS}</style>
    </div>
  );
}

// ============================================================
//  APP UTENTE
// ============================================================
function UserApp({ me, onLogout, theme, toggleTheme }) {
  const [tab, setTab] = useState("ore");
  const [cursor, setCursor] = useState(new Date());
  const [reqs, setReqs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [detected, setDetected] = useState([]);
  const [msgs, setMsgs] = useState([]);
  const [openReq, setOpenReq] = useState(null); // richiesta da aprire in modifica dal calendario

  const openRequestFromCalendar = (r) => { setOpenReq(r); setTab("richieste"); };

  const reload = useCallback(async () => {
    const [r, l, d, m] = await Promise.all([
      api.get("/api/requests"), api.get("/api/worklogs"),
      api.get("/api/detected"), api.get("/api/messages"),
    ]);
    setReqs(r); setLogs(l); setDetected(d); setMsgs(m);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const unread = msgs.filter(m=>!m.read && !m.archived).length;

  return (
    <div className="wrap">
      <Header me={me} onLogout={onLogout} right={<span className="rolechip user">Utente</span>} theme={theme} toggleTheme={toggleTheme} />
      <nav className="nav">
        <button className={tab==="ore"?"navbtn on":"navbtn"} onClick={()=>setTab("ore")}>Ore lavorate</button>
        <button className={tab==="riepilogo"?"navbtn on":"navbtn"} onClick={()=>setTab("riepilogo")}>Riepilogo</button>
        <button className={tab==="richieste"?"navbtn on":"navbtn"} onClick={()=>setTab("richieste")}>Richieste</button>
        <button className={tab==="calendario"?"navbtn on":"navbtn"} onClick={()=>setTab("calendario")}>Calendario</button>
        <button className={tab==="messaggi"?"navbtn on":"navbtn"} onClick={()=>setTab("messaggi")}>
          Comunicazioni{unread>0 && <span className="badge">{unread}</span>}</button>
      </nav>
      <main className="main">
        {tab==="calendario" && <UserCalendar cursor={cursor} setCursor={setCursor} reqs={reqs} logs={logs} onOpenRequest={openRequestFromCalendar} />}
        {tab==="richieste" && <UserRequests me={me} reqs={reqs} reload={reload} openReq={openReq} clearOpenReq={()=>setOpenReq(null)} />}
        {tab==="ore" && <><PunchClock reload={reload} /><UserWorklogs logs={logs} detected={detected} reload={reload} /></>}
        {tab==="riepilogo" && <MonthlySummary reqs={reqs} logs={logs} detected={detected} cursor={cursor} setCursor={setCursor} showCompare />}
        {tab==="messaggi" && <Messages msgs={msgs} me={me} reload={reload} />}
      </main>
      <style>{CSS}</style>
    </div>
  );
}

function UserCalendar({ cursor, setCursor, reqs, logs, onOpenRequest }) {
  const events = useMemo(()=>buildEventMap(reqs, logs), [reqs, logs]);
  const [dayDetail, setDayDetail] = useState(null);
  // richieste che toccano un dato giorno
  const reqsOnDay = (day) => reqs.filter(r => r.stato!=="respinta" && eachDay(r.data_inizio,r.data_fine).includes(day));
  // finestra consentita: mese corrente (max) e due mesi indietro (min)
  const oggiD = new Date();
  const maxMonth = new Date(oggiD.getFullYear(), oggiD.getMonth(), 1);
  const minMonth = new Date(oggiD.getFullYear(), oggiD.getMonth()-2, 1);

  return (
    <div className="card">
      <MonthNav cursor={cursor} setCursor={setCursor} minMonth={minMonth} maxMonth={maxMonth} />
      <CalendarGrid cursor={cursor} onDayClick={(day)=>{ if(events[day]) setDayDetail(day); }} render={(day)=>{
        const ev = events[day]; if (!ev) return null;
        return <div className="daytags">{ev.map((e,i)=>(
          <span key={i} className="daytag" style={{background:e.bg,color:e.color}} title={e.title}>{e.short}{e.hours?` ${e.hours}h`:""}</span>
        ))}</div>;
      }} />
      <Legend />
      <p className="muted small">Il calendario mostra il mese corrente e i due precedenti.</p>
      {dayDetail && (
        <Modal onClose={()=>setDayDetail(null)} title={`Giorno ${fmtDate(dayDetail)}`}>
          {reqsOnDay(dayDetail).length===0 && <div className="muted small">Nessuna richiesta in questo giorno (solo ore lavorate).</div>}
          <div className="list">
            {reqsOnDay(dayDetail).map(r=>(
              <div key={r.id} className="reqrow">
                <span className="pill" style={{background:TIPI[r.tipo].bg,color:TIPI[r.tipo].color}}>{TIPI[r.tipo].label}</span>
                <div className="reqmain"><div className="reqtitle">{describeReq(r)}</div>{r.note && <div className="muted small">{r.note}</div>}</div>
                <span className="pill" style={{background:STATI[r.stato].bg,color:STATI[r.stato].color}}>{STATI[r.stato].label}</span>
                {canEdit(r) && <button className="btn tiny" onClick={()=>{ setDayDetail(null); onOpenRequest(r); }}>Modifica</button>}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function UserRequests({ me, reqs, reload, openReq, clearOpenReq }) {
  const [form, setForm] = useState(null);
  const [err, setErr] = useState("");
  const empty = { tipo:"permesso", mode:"ore", dataInizio:todayISO(), dataFine:todayISO(), oraInizio:"09:00", oraFine:"13:00", note:"" };

  const openNew = () => { setErr(""); setForm({ ...empty, id:null }); };
  const openEdit = (r) => { setErr(""); setForm({ id:r.id, tipo:r.tipo, mode:r.mode, dataInizio:iso(r.data_inizio), dataFine:iso(r.data_fine), oraInizio:r.ora_inizio||"09:00", oraFine:r.ora_fine||"13:00", note:r.note||"" }); };

  // se arrivo dal calendario con una richiesta da modificare, apro il form
  useEffect(() => { if (openReq) { openEdit(openReq); clearOpenReq(); } }, [openReq]);

  const save = async () => {
    setErr("");
    if (form.mode==="ore" && form.oraFine<=form.oraInizio) return setErr("L'ora di fine deve essere dopo l'inizio.");
    if (form.mode==="giorni" && form.dataFine<form.dataInizio) return setErr("La data di fine deve essere uguale o dopo l'inizio.");
    try {
      if (form.id) await api.put(`/api/requests/${form.id}`, form);
      else await api.post("/api/requests", form);
      setForm(null); reload();
    } catch (e) { setErr(e.message); }
  };
  const remove = async (r) => { if (!confirm("Eliminare questa richiesta?")) return; try { await api.del(`/api/requests/${r.id}`); reload(); } catch(e){ alert(e.message); } };

  return (
    <div className="stack">
      <div className="rowbetween"><h2>Le mie richieste</h2><button className="btn primary" onClick={openNew}>+ Nuova richiesta</button></div>
      {form && (
        <div className="card formcard">
          <h3>{form.id?"Modifica richiesta":"Nuova richiesta"}</h3>
          <div className="grid2">
            <label className="field"><span>Tipo</span>
              <select value={form.tipo} onChange={e=>setForm({...form,tipo:e.target.value})}>
                <option value="permesso">Permesso</option><option value="ferie">Ferie</option><option value="assenza">Assenza</option>
              </select></label>
            <label className="field"><span>Base</span>
              <select value={form.mode} onChange={e=>setForm({...form,mode:e.target.value})}>
                <option value="ore">Oraria</option><option value="giorni">Giornaliera</option>
              </select></label>
          </div>
          {form.mode==="ore" ? (
            <div className="grid3">
              <label className="field"><span>Data</span><input type="date" value={form.dataInizio} onChange={e=>setForm({...form,dataInizio:e.target.value})} /></label>
              <label className="field"><span>Dalle</span><input type="time" value={form.oraInizio} onChange={e=>setForm({...form,oraInizio:e.target.value})} /></label>
              <label className="field"><span>Alle</span><input type="time" value={form.oraFine} onChange={e=>setForm({...form,oraFine:e.target.value})} /></label>
            </div>
          ) : (
            <div className="grid2">
              <label className="field"><span>Dal</span><input type="date" value={form.dataInizio} onChange={e=>setForm({...form,dataInizio:e.target.value})} /></label>
              <label className="field"><span>Al</span><input type="date" value={form.dataFine} onChange={e=>setForm({...form,dataFine:e.target.value})} /></label>
            </div>
          )}
          <label className="field"><span>Note (facoltative)</span><textarea rows={2} value={form.note} onChange={e=>setForm({...form,note:e.target.value})} placeholder="Motivazione, dettagli…" /></label>
          {err && <div className="alert">{err}</div>}
          <div className="rowend"><button className="btn ghost" onClick={()=>setForm(null)}>Annulla</button><button className="btn primary" onClick={save}>{form.id?"Salva modifiche":"Invia richiesta"}</button></div>
        </div>
      )}
      {reqs.length===0 && <div className="empty">Nessuna richiesta ancora.</div>}
      <div className="list">
        {reqs.map(r=>(
          <div key={r.id} className="reqrow">
            <span className="pill" style={{background:TIPI[r.tipo].bg,color:TIPI[r.tipo].color}}>{TIPI[r.tipo].label}</span>
            <div className="reqmain"><div className="reqtitle">{describeReq(r)}</div>{r.note && <div className="muted small">{r.note}</div>}</div>
            <span className="pill" style={{background:STATI[r.stato].bg,color:STATI[r.stato].color}}>{STATI[r.stato].label}</span>
            <div className="reqactions">
              {canEdit(r) ? (<><button className="btn tiny" onClick={()=>openEdit(r)}>Modifica</button><button className="btn tiny danger" onClick={()=>remove(r)}>Elimina</button></>) : <span className="muted small locked">Bloccata</span>}
            </div>
          </div>
        ))}
      </div>
      <p className="muted small">Puoi modificare o eliminare solo le richieste <b>in attesa</b> e con data futura.</p>
    </div>
  );
}

// ---------- Timbratura live ----------
function PunchClock({ reload }) {
  const [punch, setPunch] = useState(undefined); // undefined=caricamento, null=nessuna sessione
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [cantiere, setCantiere] = useState(false);

  const load = useCallback(async () => {
    try { setPunch(await api.get("/api/punch")); } catch { setPunch(null); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // aggiorna il cronometro ogni secondo mentre è attivo
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const act = async (path) => {
    setBusy(true); setMsg("");
    try {
      const body = path === "uscita" ? { cantiere } : undefined;
      const res = await api.post(`/api/punch/${path}`, body);
      if (path === "uscita") {
        setMsg(res.straordinari > 0
          ? `Uscita registrata. Attenzione: ${res.straordinari}h di STRAORDINARIO.`
          : "Uscita registrata.");
        setCantiere(false);
        await reload();
      }
      await load();
    } catch (e) { setMsg(e.message); }
    finally { setBusy(false); }
  };

  if (punch === undefined) return <div className="card"><div className="muted">Caricamento timbratura…</div></div>;

  // calcolo tempo trascorso
  let elapsed = "";
  let straordFlag = false;
  if (punch) {
    const start = new Date(punch.entrata).getTime();
    let pausaMs = (punch.pausa_totale || 0) * 60000;
    if (punch.stato === "in_pausa" && punch.pausa_inizio) pausaMs += now - new Date(punch.pausa_inizio).getTime();
    const workedMs = Math.max(0, now - start - pausaMs);
    const h = Math.floor(workedMs / 3600000);
    const m = Math.floor((workedMs % 3600000) / 60000);
    const s = Math.floor((workedMs % 60000) / 1000);
    elapsed = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    straordFlag = workedMs > 8 * 3600000;
  }

  return (
    <div className={punch ? "card punchcard active" : "card punchcard"}>
      <div className="punchhead">
        <h3>Timbratura</h3>
        {punch && <span className={punch.stato==="in_pausa" ? "punchstate pausestate" : "punchstate"}>
          {punch.stato==="in_pausa" ? "In pausa" : "Al lavoro"}
        </span>}
      </div>

      {!punch ? (
        <>
          <p className="muted small">Clicca “Entrata” quando arrivi. Il tempo viene registrato in automatico, arrotondato al quarto d'ora.</p>
          <button className="btn primary big" onClick={()=>act("entrata")} disabled={busy}>▶ Entrata</button>
        </>
      ) : (
        <>
          <div className={straordFlag ? "punchtimer straord" : "punchtimer"}>{elapsed}</div>
          {straordFlag && <div className="straordbanner">Oltre le 8 ore: sei in STRAORDINARIO</div>}
          <label className="checkfield punchcheck">
            <input type="checkbox" checked={cantiere} onChange={e=>setCantiere(e.target.checked)} />
            <span>In cantiere <span className="muted small">(spunta prima di uscire)</span></span>
          </label>
          <div className="punchbtns">
            {punch.stato === "attivo"
              ? <button className="btn" onClick={()=>act("pausa")} disabled={busy}>⏸ Pausa</button>
              : <button className="btn ok" onClick={()=>act("riprendi")} disabled={busy}>▶ Riprendi</button>}
            <button className="btn danger" onClick={()=>act("uscita")} disabled={busy}>⏹ Uscita</button>
          </div>
          <div className="muted small punchinfo">
            Entrata: {new Date(punch.entrata).toLocaleTimeString("it-IT",{hour:"2-digit",minute:"2-digit"})}
            {punch.pausa_totale > 0 && ` · pausa accumulata: ${punch.pausa_totale} min`}
          </div>
        </>
      )}
      {msg && <div className={msg.includes("STRAORDINARIO")||msg.includes("Errore") ? "alert" : "okmsg"}>{msg}</div>}
    </div>
  );
}


function UserWorklogs({ logs, detected, reload }) {
  const oggi = todayISO();
  const empty = { id:null, data:oggi, inizio:"09:00", fine:"18:00", pausa:"60", straordinari:"0", cantiere:false };
  const [f, setF] = useState(empty);
  const [err, setErr] = useState("");

  const editing = f.id !== null;
  const startEdit = (l) => { setErr(""); setF({ id:l.id, data:iso(l.data), inizio:l.inizio, fine:l.fine, pausa:String(l.pausa), straordinari:String(l.straordinari||0), cantiere:!!l.cantiere }); };
  const cancel = () => { setErr(""); setF(empty); };

  const save = async () => {
    setErr("");
    if (f.fine<=f.inizio) return setErr("L'orario di fine deve essere dopo l'inizio.");
    const oreLorde = hoursBetween(f.inizio, f.fine) - (parseInt(f.pausa||"0",10)/60);
    if (oreLorde<=0) return setErr("La pausa è più lunga del turno.");
    // straordinario automatico oltre le 8 ore; l'utente può comunque forzare un valore
    const straordManuale = parseFloat(f.straordinari||"0");
    const oreNormali = Math.min(oreLorde, 8);
    const straordAuto = Math.max(0, oreLorde - 8);
    const straord = straordManuale > 0 ? straordManuale : round2(straordAuto);
    const oreDaSalvare = straordManuale > 0 ? round2(oreLorde - straordManuale) : round2(oreNormali);
    const payload = { data:oggi, inizio:f.inizio, fine:f.fine, pausa:parseInt(f.pausa||"0",10), ore:oreDaSalvare, straordinari:straord, cantiere:f.cantiere };
    try {
      if (editing) await api.put(`/api/worklogs/${f.id}`, payload);
      else await api.post("/api/worklogs", payload);
      cancel(); reload();
    } catch(e){ setErr(e.message); }
  };
  const remove = async (l) => { if(!confirm("Eliminare questa registrazione?"))return; try { await api.del(`/api/worklogs/${l.id}`); reload(); } catch(e){ alert(e.message); } };

  return (
    <div className="stack">
      <h2>Ore lavorate</h2>
      <div className="card formcard">
        {editing && <div className="editbanner">Stai modificando la registrazione del {fmtDate(f.data)}</div>}
        <div className="grid5">
          <label className="field"><span>Data (oggi)</span><input type="date" value={oggi} disabled title="Puoi registrare solo la giornata di oggi" /></label>
          <label className="field"><span>Entrata</span><input type="time" value={f.inizio} onChange={e=>setF({...f,inizio:e.target.value})} /></label>
          <label className="field"><span>Uscita</span><input type="time" value={f.fine} onChange={e=>setF({...f,fine:e.target.value})} /></label>
          <label className="field"><span>Pausa (min)</span><input type="number" min="0" step="15" value={f.pausa} onChange={e=>setF({...f,pausa:e.target.value})} /></label>
          <label className="field"><span>Straordinari (h)</span><input type="number" min="0" step="0.25" value={f.straordinari} onChange={e=>setF({...f,straordinari:e.target.value})} placeholder="auto se >8h" /></label>
        </div>
        <label className="checkfield">
          <input type="checkbox" checked={f.cantiere} onChange={e=>setF({...f,cantiere:e.target.checked})} />
          <span>In cantiere <span className="muted small">(se non spuntato: in sede)</span></span>
        </label>
        {err && <div className="alert">{err}</div>}
        <div className="rowend">
          {editing && <button className="btn ghost" onClick={cancel}>Annulla</button>}
          <button className="btn primary" onClick={save}>{editing?"Salva modifiche":"Registra ore"}</button>
        </div>
      </div>
      {logs.length===0 && <div className="empty">Nessuna giornata registrata.</div>}
      <div className="list">
        {logs.map(l=>{
          const det = detected.find(x=>iso(x.data)===iso(l.data));
          const diff = det ? round2(Number(l.ore)-Number(det.ore)) : null;
          const straord = Number(l.straordinari||0);
          const modificabile = iso(l.data) === oggi; // solo oggi è modificabile dall'utente
          return (
            <div key={l.id} className="logrow">
              <div className="logdate">{fmtDate(l.data)}</div>
              <div className="logtimes">{l.inizio}–{l.fine} · pausa {l.pausa}′ {l.cantiere ? <span className="sitetag cantiere">In cantiere</span> : <span className="sitetag sede">In sede</span>}</div>
              <div className="loghours">{round2(Number(l.ore))}h {straord>0 && <span className="straordtag">+{straord}h str.</span>}</div>
              <div className="logcompare">{det ? <span className={diff===0?"cmp ok":"cmp warn"}>Rilevate {round2(Number(det.ore))}h {diff!==0&&`(Δ ${diff>0?"+":""}${diff}h)`}</span> : <span className="muted small">nessun rilevamento</span>}</div>
              <div className="logactions">
                {modificabile ? (
                  <>
                    <button className="btn tiny" onClick={()=>startEdit(l)}>Modifica</button>
                    <button className="btn tiny danger" onClick={()=>remove(l)}>Elimina</button>
                  </>
                ) : <span className="muted small locked">🔒 Bloccata</span>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="muted small">Puoi inserire e modificare le ore solo per la giornata di oggi. Dalla mezzanotte le ore del giorno si bloccano.</p>
    </div>
  );
}

// ============================================================
//  APP ADMIN
// ============================================================
function AdminApp({ me, onLogout, theme, toggleTheme }) {
  const [tab, setTab] = useState("richieste");
  const [cursor, setCursor] = useState(new Date());
  const [selected, setSelected] = useState(null);
  const [reqs, setReqs] = useState([]);
  const [users, setUsers] = useState([]);
  const [logs, setLogs] = useState([]);
  const [detected, setDetected] = useState([]);

  const reload = useCallback(async () => {
    const [r, u, l, d] = await Promise.all([
      api.get("/api/requests"), api.get("/api/users"),
      api.get("/api/worklogs"), api.get("/api/detected"),
    ]);
    setReqs(r); setUsers(u); setLogs(l); setDetected(d);
  }, []);
  useEffect(()=>{ reload(); }, [reload]);

  const pending = reqs.filter(r=>r.stato==="in_attesa");

  const decide = async (r, stato) => {
    // Apro SUBITO una nuova scheda (collegata al clic) così il browser non la blocca
    // né la apre nella stessa finestra. La riempio dopo la risposta del server.
    let mailTab = null;
    if (stato === "approvata") {
      mailTab = window.open("about:blank", "_blank");
    }
    try {
      const res = await api.post(`/api/requests/${r.id}/decide`, { stato });
      reload();
      if (stato==="approvata" && !res.emailSent) {
        const subject = `Esito richiesta ${TIPI[r.tipo].label}`;
        const body = `Ciao ${r.user_name}, la tua richiesta di ${TIPI[r.tipo].label.toLowerCase()} del ${fmtDate(r.data_inizio)} è stata APPROVATA.`;
        const url = buildGmail(r.user_email, subject, body);
        if (mailTab) mailTab.location.href = url;   // riempio la scheda già aperta
        else window.open(url, "_blank", "noopener");  // fallback
      } else if (mailTab) {
        mailTab.close(); // email già inviata dal server: chiudo la scheda vuota
      }
    } catch(e){
      if (mailTab) mailTab.close();
      alert(e.message);
    }
  };

  const removeRequest = async (r) => {
    if (!confirm(`Eliminare definitivamente la richiesta di ${TIPI[r.tipo].label.toLowerCase()} di ${r.user_name}?`)) return;
    try { await api.del(`/api/requests/${r.id}`); reload(); }
    catch(e){ alert(e.message); }
  };

  return (
    <div className="wrap">
      <Header me={me} onLogout={onLogout} right={<span className="rolechip admin">Amministratore</span>} theme={theme} toggleTheme={toggleTheme} />
      <nav className="nav">
        <button className={tab==="richieste"?"navbtn on":"navbtn"} onClick={()=>setTab("richieste")}>Richieste{pending.length>0 && <span className="badge">{pending.length}</span>}</button>
        <button className={tab==="calendario"?"navbtn on":"navbtn"} onClick={()=>setTab("calendario")}>Calendario team</button>
        <button className={tab==="utenti"?"navbtn on":"navbtn"} onClick={()=>setTab("utenti")}>Utenti</button>
        <button className={tab==="rilevazioni"?"navbtn on":"navbtn"} onClick={()=>setTab("rilevazioni")}>Rilevazione ore</button>
      </nav>
      <main className="main">
        {tab==="richieste" && <AdminRequests pending={pending} allReqs={reqs} decide={decide} removeRequest={removeRequest} users={users} setTab={setTab} />}
        {tab==="calendario" && <TeamCalendar reqs={reqs} cursor={cursor} setCursor={setCursor} />}
        {tab==="utenti" && <AdminUsers users={users} reqs={reqs} logs={logs} detected={detected} selected={selected} setSelected={setSelected} cursor={cursor} setCursor={setCursor} reload={reload} />}
        {tab==="rilevazioni" && <AdminDetected users={users} logs={logs} detected={detected} reload={reload} />}
      </main>
      <style>{CSS}</style>
    </div>
  );
}

function AdminRequests({ pending, allReqs, decide, removeRequest, users, setTab }) {
  const overlaps = useMemo(()=>findOverlaps(allReqs), [allReqs]);
  const approvate = allReqs.filter(r=>r.stato==="approvata").length;
  return (
    <div className="stack">
      <div className="dash">
        <button className="dashcard" onClick={()=>setTab("richieste")}>
          <div className="dashnum">{pending.length}</div><div className="dashlbl">In attesa</div>
        </button>
        <button className="dashcard" onClick={()=>setTab("utenti")}>
          <div className="dashnum">{users.length}</div><div className="dashlbl">Utenti →</div>
        </button>
        <button className="dashcard" onClick={()=>setTab("calendario")}>
          <div className="dashnum">{approvate}</div><div className="dashlbl">Approvate · Calendario →</div>
        </button>
        <button className="dashcard accent" onClick={()=>setTab("rilevazioni")}>
          <div className="dashnum">⏱</div><div className="dashlbl">Rilevazione ore →</div>
        </button>
      </div>
      <h2>Richieste da gestire</h2>
      {pending.length===0 && <div className="empty">Nessuna richiesta in attesa. Tutto in ordine.</div>}
      <div className="list">
        {pending.map(r=>{
          const ov = overlaps[r.id];
          return (
            <div key={r.id} className="reqrow admin">
              <div className="reqwho"><div className="avatar">{initials(r.user_name)}</div>
                <div><div className="reqtitle">{r.user_name}</div><div className="muted small">{describeReq(r)}</div></div></div>
              <span className="pill" style={{background:TIPI[r.tipo].bg,color:TIPI[r.tipo].color}}>{TIPI[r.tipo].label}</span>
              {ov && <span className="pill warnpill">⚠ Sovrapposta</span>}
              <div className="reqactions"><button className="btn tiny ok" onClick={()=>decide(r,"approvata")}>Approva</button><button className="btn tiny danger" onClick={()=>decide(r,"respinta")}>Respingi</button></div>
            </div>
          );
        })}
      </div>
      {pending.some(r=>overlaps[r.id]) && <p className="muted small">⚠ Alcune richieste si sovrappongono nello stesso periodo: controlla il calendario team.</p>}

      <AllRequests allReqs={allReqs} decide={decide} removeRequest={removeRequest} users={users} />
    </div>
  );
}

// Tutte le richieste: l'admin può cambiare stato (anche rimettere in attesa) ed eliminare.
function AllRequests({ allReqs, decide, removeRequest, users }) {
  const [filtroStato, setFiltroStato] = useState("");
  const [filtroUtente, setFiltroUtente] = useState("");

  const lista = allReqs.filter(r =>
    (!filtroStato || r.stato===filtroStato) &&
    (!filtroUtente || r.user_id===Number(filtroUtente))
  );

  return (
    <div className="card">
      <div className="rowbetween">
        <h3>Tutte le richieste</h3>
        <div className="filterrow">
          <label className="field inlinefilter"><span>Stato</span>
            <select value={filtroStato} onChange={e=>setFiltroStato(e.target.value)}>
              <option value="">Tutti</option>
              <option value="in_attesa">In attesa</option>
              <option value="approvata">Approvate</option>
              <option value="respinta">Respinte</option>
            </select>
          </label>
          <label className="field inlinefilter"><span>Utente</span>
            <select value={filtroUtente} onChange={e=>setFiltroUtente(e.target.value)}>
              <option value="">Tutti</option>
              {users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        </div>
      </div>
      {lista.length===0 && <div className="empty">Nessuna richiesta con questi filtri.</div>}
      <div className="list">
        {lista.map(r=>(
          <div key={r.id} className="reqrow admin">
            <div className="reqwho"><div className="avatar">{initials(r.user_name)}</div>
              <div><div className="reqtitle">{r.user_name}</div><div className="muted small">{describeReq(r)}</div></div></div>
            <span className="pill" style={{background:TIPI[r.tipo].bg,color:TIPI[r.tipo].color}}>{TIPI[r.tipo].label}</span>
            <span className="pill" style={{background:STATI[r.stato].bg,color:STATI[r.stato].color}}>{STATI[r.stato].label}</span>
            <div className="reqactions">
              {r.stato!=="approvata" && <button className="btn tiny ok" onClick={()=>decide(r,"approvata")}>Approva</button>}
              {r.stato!=="respinta" && <button className="btn tiny warn" onClick={()=>decide(r,"respinta")}>Respingi</button>}
              {r.stato!=="in_attesa" && <button className="btn tiny" onClick={()=>decide(r,"in_attesa")}>In attesa</button>}
              <button className="btn tiny danger" onClick={()=>removeRequest(r)}>Elimina</button>
            </div>
          </div>
        ))}
      </div>
      <p className="muted small">Puoi cambiare lo stato di qualsiasi richiesta o eliminarla del tutto. Ogni cambio di stato invia una notifica al dipendente.</p>
    </div>
  );
}

function TeamCalendar({ reqs, cursor, setCursor }) {
  const [dayDetail, setDayDetail] = useState(null); // { day, list }
  const active = reqs.filter(r=>r.stato!=="respinta");
  const byDay = useMemo(()=>{ const m={}; active.forEach(r=>{ eachDay(r.data_inizio,r.data_fine).forEach(day=>{ (m[day] ||= []).push(r); }); }); return m; }, [active]);
  const [exporting, setExporting] = useState(false);
  const doExport = async () => {
    setExporting(true);
    const y = cursor.getFullYear(), mo = cursor.getMonth()+1;
    try { await api.download(`/api/export?year=${y}&month=${mo}`, `riepilogo_${y}_${String(mo).padStart(2,"0")}.xlsx`); }
    catch(e){ alert(e.message); }
    finally { setExporting(false); }
  };

  return (
    <div className="card">
      <div className="rowbetween">
        <h2>Calendario del team</h2>
        <button className="btn primary" onClick={doExport} disabled={exporting}>{exporting?"Genero…":"⭳ Esporta mese in Excel"}</button>
      </div>
      <p className="muted small">Ogni giorno mostra chi è in permesso / ferie / assenza. Clicca un giorno per vederne il dettaglio. L'export genera il riepilogo di <b>tutti</b> gli utenti per il mese mostrato qui sotto.</p>
      <MonthNav cursor={cursor} setCursor={setCursor} />
      <CalendarGrid cursor={cursor} onDayClick={(day)=>{ if(byDay[day]) setDayDetail({ day, list:byDay[day] }); }} render={(day)=>{
        const list = byDay[day]; if (!list) return null;
        const many = list.length>=2;
        return (
          <div className={many?"teamday many":"teamday"}>
            {list.slice(0,3).map((r,i)=>(<span key={i} className="teamtag" style={{background:TIPI[r.tipo].bg,color:TIPI[r.tipo].color}}>{firstName(r.user_name)} · {TIPI[r.tipo].short}</span>))}
            {list.length>3 && <span className="teamtag more">+{list.length-3}</span>}
          </div>
        );
      }} />
      <Legend />
      {dayDetail && (
        <Modal onClose={()=>setDayDetail(null)} title={`Giorno ${fmtDate(dayDetail.day)}`}>
          <div className="list">
            {dayDetail.list.map(r=>(
              <div key={r.id} className="reqrow">
                <span className="pill" style={{background:TIPI[r.tipo].bg,color:TIPI[r.tipo].color}}>{TIPI[r.tipo].label}</span>
                <div className="reqmain"><div className="reqtitle">{r.user_name}</div><div className="muted small">{describeReq(r)}{r.note?` · ${r.note}`:""}</div></div>
                <span className="pill" style={{background:STATI[r.stato].bg,color:STATI[r.stato].color}}>{STATI[r.stato].label}</span>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function AdminUsers({ users, reqs, logs, detected, selected, setSelected, cursor, setCursor, reload }) {
  if (selected) {
    const u = users.find(x=>x.id===selected);
    const uReqs = reqs.filter(r=>r.user_id===u.id);
    const uLogs = logs.filter(w=>w.user_id===u.id);
    const uDet = detected.filter(d=>d.user_id===u.id);
    return (
      <div className="stack">
        <button className="btn ghost" onClick={()=>setSelected(null)}>← Tutti gli utenti</button>
        <div className="rowbetween"><h2>{u.name}</h2><span className="muted">{u.email}</span></div>
        <MonthlySummary reqs={uReqs} logs={uLogs} detected={uDet} cursor={cursor} setCursor={setCursor} showCompare />
        <AdminUserWorklogs user={u} logs={uLogs} detected={uDet} reload={reload} />
        <div className="card">
          <h3>Storico richieste</h3>
          {uReqs.length===0 && <div className="empty">Nessuna richiesta.</div>}
          <div className="list">{uReqs.map(r=>(
            <div key={r.id} className="reqrow"><span className="pill" style={{background:TIPI[r.tipo].bg,color:TIPI[r.tipo].color}}>{TIPI[r.tipo].label}</span>
              <div className="reqmain"><div className="reqtitle">{describeReq(r)}</div></div>
              <span className="pill" style={{background:STATI[r.stato].bg,color:STATI[r.stato].color}}>{STATI[r.stato].label}</span></div>
          ))}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="stack">
      <h2>Utenti</h2>
      <div className="usergrid">
        {users.map(u=>{
          const pend = reqs.filter(r=>r.user_id===u.id && r.stato==="in_attesa").length;
          return (
            <button key={u.id} className="usercard" onClick={()=>setSelected(u.id)}>
              <div className="avatar big">{initials(u.name)}</div>
              <div className="usercardbody"><div className="reqtitle">{u.name}</div><div className="muted small">{u.email}</div></div>
              {pend>0 && <span className="badge solid">{pend}</span>}
            </button>
          );
        })}
        {users.length===0 && <div className="empty">Nessun utente registrato.</div>}
      </div>
    </div>
  );
}

// Modifica/eliminazione delle ore di un dipendente da parte dell'admin.
function AdminUserWorklogs({ user, logs, detected, reload }) {
  const [f, setF] = useState(null); // registrazione in modifica
  const [err, setErr] = useState("");

  const startEdit = (l) => { setErr(""); setF({ id:l.id, data:iso(l.data), inizio:l.inizio, fine:l.fine, pausa:String(l.pausa), ore:String(round2(Number(l.ore))), straordinari:String(round2(Number(l.straordinari||0))), cantiere:!!l.cantiere }); };
  const cancel = () => { setErr(""); setF(null); };

  const save = async () => {
    setErr("");
    if (f.fine<=f.inizio) return setErr("L'orario di fine deve essere dopo l'inizio.");
    const payload = { data:f.data, inizio:f.inizio, fine:f.fine, pausa:parseInt(f.pausa||"0",10), ore:round2(parseFloat(f.ore||"0")), straordinari:round2(parseFloat(f.straordinari||"0")), cantiere:f.cantiere };
    try { await api.put(`/api/worklogs/${f.id}`, payload); cancel(); reload(); }
    catch(e){ setErr(e.message); }
  };
  const remove = async (l) => { if(!confirm("Eliminare questa registrazione del dipendente?"))return; try { await api.del(`/api/worklogs/${l.id}`); reload(); } catch(e){ alert(e.message); } };

  const sorted = [...logs].sort((a,b)=> iso(a.data)<iso(b.data)?1:-1);

  return (
    <div className="card">
      <h3>Ore registrate del dipendente</h3>
      <p className="muted small">Puoi correggere o eliminare le registrazioni in caso di incongruenza. Le modifiche sono immediate.</p>
      {f && (
        <div className="card formcard editcard">
          <div className="editbanner">Modifica registrazione del {fmtDate(f.data)}</div>
          <div className="grid3">
            <label className="field"><span>Data</span><input type="date" value={f.data} onChange={e=>setF({...f,data:e.target.value})} /></label>
            <label className="field"><span>Entrata</span><input type="time" value={f.inizio} onChange={e=>setF({...f,inizio:e.target.value})} /></label>
            <label className="field"><span>Uscita</span><input type="time" value={f.fine} onChange={e=>setF({...f,fine:e.target.value})} /></label>
          </div>
          <div className="grid3">
            <label className="field"><span>Pausa (min)</span><input type="number" min="0" step="15" value={f.pausa} onChange={e=>setF({...f,pausa:e.target.value})} /></label>
            <label className="field"><span>Ore</span><input type="number" min="0" step="0.25" value={f.ore} onChange={e=>setF({...f,ore:e.target.value})} /></label>
            <label className="field"><span>Straordinari (h)</span><input type="number" min="0" step="0.25" value={f.straordinari} onChange={e=>setF({...f,straordinari:e.target.value})} /></label>
          </div>
          <label className="checkfield">
            <input type="checkbox" checked={f.cantiere} onChange={e=>setF({...f,cantiere:e.target.checked})} />
            <span>In cantiere</span>
          </label>
          {err && <div className="alert">{err}</div>}
          <div className="rowend"><button className="btn ghost" onClick={cancel}>Annulla</button><button className="btn primary" onClick={save}>Salva modifiche</button></div>
        </div>
      )}
      {sorted.length===0 && <div className="empty">Nessuna registrazione ore.</div>}
      <div className="list">
        {sorted.map(l=>{
          const det = detected.find(x=>iso(x.data)===iso(l.data));
          const diff = det ? round2(Number(l.ore)-Number(det.ore)) : null;
          const straord = Number(l.straordinari||0);
          return (
            <div key={l.id} className="logrow">
              <div className="logdate">{fmtDate(l.data)}</div>
              <div className="logtimes">{l.inizio}–{l.fine} · pausa {l.pausa}′ {l.cantiere ? <span className="sitetag cantiere">In cantiere</span> : <span className="sitetag sede">In sede</span>}</div>
              <div className="loghours">{round2(Number(l.ore))}h {straord>0 && <span className="straordtag">+{straord}h str.</span>}</div>
              <div className="logcompare">{det ? <span className={diff===0?"cmp ok":"cmp warn"}>Rilevate {round2(Number(det.ore))}h {diff!==0&&`(Δ ${diff>0?"+":""}${diff}h)`}</span> : <span className="muted small">nessun rilevamento</span>}</div>
              <div className="logactions">
                <button className="btn tiny" onClick={()=>startEdit(l)}>Modifica</button>
                <button className="btn tiny danger" onClick={()=>remove(l)}>Elimina</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdminDetected({ users, logs, detected, reload }) {
  const [userId, setUserId] = useState("");
  const [d, setD] = useState(todayISO());
  const [ore, setOre] = useState("8");
  const [err, setErr] = useState("");
  const [filtro, setFiltro] = useState("");      // filtra la lista per utente ("" = tutti)
  const [aperti, setAperti] = useState({});      // quali gruppi sono espansi
  useEffect(()=>{ if(!userId && users[0]) setUserId(users[0].id); }, [users, userId]);

  const add = async () => {
    setErr("");
    const val = parseFloat(ore);
    if (!userId) return setErr("Seleziona un utente.");
    if (isNaN(val)||val<0) return setErr("Ore non valide.");
    try { await api.post("/api/detected", { userId, data:d, ore:val }); reload(); }
    catch(e){ setErr(e.message); }
  };
  const remove = async (x) => { await api.del(`/api/detected/${x.id}`); reload(); };
  const toggle = (id) => setAperti(a => ({ ...a, [id]: !a[id] }));

  // raggruppo le rilevazioni per utente
  const gruppi = useMemo(() => {
    const map = {};
    detected.forEach(x => { (map[x.user_id] ||= []).push(x); });
    Object.values(map).forEach(list => list.sort((a,b)=> iso(a.data)<iso(b.data)?1:-1));
    return map;
  }, [detected]);

  const utentiDaMostrare = users.filter(u => (!filtro || u.id===Number(filtro)) && gruppi[u.id]);

  return (
    <div className="stack">
      <h2>Rilevazione ore</h2>
      <p className="muted small">Inserisci le ore effettivamente rilevate. L'utente le vedrà confrontate con quelle dichiarate.</p>
      <div className="card formcard">
        <div className="grid3">
          <label className="field"><span>Utente</span><select value={userId} onChange={e=>setUserId(Number(e.target.value))}>{users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label>
          <label className="field"><span>Data</span><input type="date" value={d} onChange={e=>setD(e.target.value)} /></label>
          <label className="field"><span>Ore rilevate</span><input type="number" min="0" step="0.25" value={ore} onChange={e=>setOre(e.target.value)} /></label>
        </div>
        {err && <div className="alert">{err}</div>}
        <div className="rowend"><button className="btn primary" onClick={add}>Salva rilevazione</button></div>
      </div>

      <div className="rowbetween">
        <h3>Rilevazioni registrate</h3>
        <label className="field inlinefilter"><span>Mostra</span>
          <select value={filtro} onChange={e=>setFiltro(e.target.value)}>
            <option value="">Tutti gli utenti</option>
            {users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </label>
      </div>

      {utentiDaMostrare.length===0 && <div className="empty">Nessuna rilevazione inserita.</div>}

      {utentiDaMostrare.map(u => {
        const list = gruppi[u.id];
        const aperto = aperti[u.id] || filtro; // se filtri un utente, aprilo di default
        const totale = round2(list.reduce((s,x)=>s+Number(x.ore),0));
        return (
          <div key={u.id} className="usergroup">
            <button className="grouphead" onClick={()=>toggle(u.id)}>
              <div className="grouptitle">
                <div className="avatar">{initials(u.name)}</div>
                <div><div className="reqtitle">{u.name}</div><div className="muted small">{list.length} registrazioni · {totale}h totali</div></div>
              </div>
              <span className="chevron">{aperto ? "▾" : "▸"}</span>
            </button>
            {aperto && (
              <div className="list groupbody">
                {list.map(x=>{
                  const log = logs.find(w=>w.user_id===x.user_id && iso(w.data)===iso(x.data));
                  const diff = log ? round2(Number(log.ore)-Number(x.ore)) : null;
                  return (
                    <div key={x.id} className="logrow">
                      <div className="logdate">{fmtDate(x.data)}</div>
                      <div className="loghours">{round2(Number(x.ore))}h <span className="muted small">rilevate</span></div>
                      <div className="logcompare">{log ? <span className={diff===0?"cmp ok":"cmp warn"}>Dichiarate {round2(Number(log.ore))}h {diff!==0&&`(Δ ${diff>0?"+":""}${diff}h)`}</span> : <span className="muted small">nessuna dichiarazione</span>}</div>
                      <button className="btn tiny danger" onClick={()=>remove(x)}>Elimina</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
//  COMPONENTI CONDIVISI
// ============================================================
function Header({ me, onLogout, right, theme, toggleTheme }) {
  return (
    <header className="topbar">
      <div className="brand small"><span className="brandmark">◷</span><strong>Gestione ore</strong></div>
      <div className="topright">{right}
        <button className="btn ghost tiny themebtn" onClick={toggleTheme} title={theme==="dark"?"Modalità chiara":"Modalità scura"}>{theme==="dark"?"☀":"☾"}</button>
        <div className="whoami"><div className="avatar">{initials(me.name)}</div><span className="hidemobile">{me.name}</span></div>
        <button className="btn ghost tiny" onClick={onLogout}>Esci</button>
      </div>
    </header>
  );
}
function MonthNav({ cursor, setCursor, minMonth, maxMonth }) {
  const go = (delta) => { const c = new Date(cursor); c.setMonth(c.getMonth()+delta); setCursor(c); };
  // confronto per anno-mese (primo giorno del mese) per capire se una freccia è ammessa
  const ym = (d) => d.getFullYear()*12 + d.getMonth();
  const cur = ym(cursor);
  const canPrev = minMonth ? cur > ym(minMonth) : true;
  const canNext = maxMonth ? cur < ym(maxMonth) : true;
  return (<div className="monthnav">
    <button className="btn ghost tiny" onClick={()=>canPrev&&go(-1)} disabled={!canPrev}>‹</button>
    <span className="monthlabel">{MESI[cursor.getMonth()]} {cursor.getFullYear()}</span>
    <button className="btn ghost tiny" onClick={()=>canNext&&go(1)} disabled={!canNext}>›</button>
  </div>);
}
function CalendarGrid({ cursor, render, onDayClick }) {
  const y=cursor.getFullYear(), m=cursor.getMonth();
  const startDow=(new Date(y,m,1).getDay()+6)%7;
  const days=new Date(y,m+1,0).getDate();
  const cells=[]; for(let i=0;i<startDow;i++)cells.push(null); for(let d=1;d<=days;d++)cells.push(d);
  return (
    <div className="calendar">
      <div className="calhead">{GIORNI.map(g=><div key={g} className="calheadcell">{g}</div>)}</div>
      <div className="calbody">{cells.map((d,i)=>{
        if(d===null) return <div key={i} className="calcell empty" />;
        const day=`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
        const today=day===todayISO();
        const clickable = !!onDayClick;
        return <div key={i} className={`calcell${today?" today":""}${clickable?" clickable":""}`} onClick={clickable?()=>onDayClick(day):undefined}><span className="calnum">{d}</span>{render(day)}</div>;
      })}</div>
    </div>
  );
}

function firstName(name){ return (name||"").split(" ")[0]; }

function Modal({ title, children, onClose }) {
  return (
    <div className="modalback" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modalhead"><h3>{title}</h3><button className="btn ghost tiny" onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  );
}
function Legend() {
  return <div className="legend">{Object.entries(TIPI).map(([k,v])=>(
    <span key={k} className="legenditem">
      <span className="legtag" style={{background:v.bg,color:v.color}}>{v.short}</span>
      {v.label}
    </span>
  ))}</div>;
}
function MonthlySummary({ reqs, logs, detected, cursor, setCursor, showCompare }) {
  const y=cursor.getFullYear(), m=cursor.getMonth();
  const inMonth=(v)=>{ const s=iso(v); return s && Number(s.slice(0,4))===y && Number(s.slice(5,7))===m+1; };
  const oreLav=logs.filter(l=>inMonth(l.data)).reduce((s,l)=>s+Number(l.ore),0);
  const oreStr=logs.filter(l=>inMonth(l.data)).reduce((s,l)=>s+Number(l.straordinari||0),0);
  const oreRil=(detected||[]).filter(x=>inMonth(x.data)).reduce((s,x)=>s+Number(x.ore),0);
  let oreP=0, gF=0, gA=0;
  reqs.filter(r=>r.stato==="approvata").forEach(r=>{
    const giorni=eachDay(r.data_inizio,r.data_fine).filter(inMonth);
    if(r.tipo==="permesso"){ if(r.mode==="ore" && inMonth(r.data_inizio)) oreP+=hoursBetween(r.ora_inizio,r.ora_fine); else oreP+=giorni.length*8; }
    else if(r.tipo==="ferie") gF+=giorni.length;
    else if(r.tipo==="assenza") gA+=giorni.length;
  });
  return (
    <div className="card">
      <MonthNav cursor={cursor} setCursor={setCursor} />
      <div className="stats stats5">
        <Stat label="Ore lavorate" value={`${round2(oreLav)}h`} color={TIPI.lavoro.color} />
        <Stat label="Straordinari" value={`${round2(oreStr)}h`} color="#b3701c" />
        <Stat label="Permessi" value={`${round2(oreP)}h`} color={TIPI.permesso.color} />
        <Stat label="Ferie" value={`${gF}g`} color={TIPI.ferie.color} />
        <Stat label="Assenze" value={`${gA}g`} color={TIPI.assenza.color} />
      </div>
      {showCompare && (
        <div className="comparebar">
          <span>Ore dichiarate: <b>{round2(oreLav)}h</b></span>
          <span>Ore rilevate: <b>{round2(oreRil)}h</b></span>
          <span className={round2(oreLav)===round2(oreRil)?"cmp ok":"cmp warn"}>Δ {round2(oreLav-oreRil)>0?"+":""}{round2(oreLav-oreRil)}h</span>
        </div>
      )}
    </div>
  );
}
function Stat({label,value,color}) { return <div className="stat"><div className="statval" style={{color}}>{value}</div><div className="statlabel">{label}</div></div>; }
function Messages({ msgs, me, reload }) {
  const [mostraArchiviati, setMostraArchiviati] = useState(false);
  const [busy, setBusy] = useState(false);

  const markRead = async (m) => { if(m.read)return; await api.post(`/api/messages/${m.id}/read`); reload(); };
  const archivia = async (m) => { await api.post(`/api/messages/${m.id}/archive`); reload(); };
  const ripristina = async (m) => { await api.post(`/api/messages/${m.id}/unarchive`); reload(); };
  const elimina = async (m) => { if(!confirm("Eliminare questa comunicazione?"))return; await api.del(`/api/messages/${m.id}`); reload(); };

  const archiviaLette = async () => {
    setBusy(true);
    try { const r = await api.post("/api/messages/archive-read"); reload(); if(r.count===0) alert("Nessuna comunicazione letta da archiviare."); }
    catch(e){ alert(e.message); } finally { setBusy(false); }
  };
  const eliminaLette = async () => {
    if(!confirm("Eliminare definitivamente TUTTE le comunicazioni già lette?"))return;
    setBusy(true);
    try { const r = await api.post("/api/messages/delete-read"); reload(); if(r.count===0) alert("Nessuna comunicazione letta da eliminare."); }
    catch(e){ alert(e.message); } finally { setBusy(false); }
  };

  // di default mostro solo i NON archiviati; con l'interruttore vedo gli archiviati
  const visibili = msgs.filter(m => mostraArchiviati ? m.archived : !m.archived);
  const nonLette = msgs.filter(m => !m.archived && !m.read).length;
  const letteAttive = msgs.filter(m => !m.archived && m.read).length;
  const archiviateTot = msgs.filter(m => m.archived).length;

  return (
    <div className="stack">
      <div className="rowbetween">
        <h2>Comunicazioni {nonLette>0 && <span className="badge">{nonLette}</span>}</h2>
        <div className="filterrow">
          {!mostraArchiviati && letteAttive>0 && (
            <>
              <button className="btn tiny" onClick={archiviaLette} disabled={busy}>Archivia lette</button>
              <button className="btn tiny danger" onClick={eliminaLette} disabled={busy}>Elimina lette</button>
            </>
          )}
          <button className="btn tiny ghost" onClick={()=>setMostraArchiviati(v=>!v)}>
            {mostraArchiviati ? "← Torna ai messaggi" : `Archiviati${archiviateTot>0?` (${archiviateTot})`:""}`}
          </button>
        </div>
      </div>

      {visibili.length===0 && (
        <div className="empty">{mostraArchiviati ? "Nessuna comunicazione archiviata." : "Nessuna comunicazione da leggere."}</div>
      )}

      <div className="list">{visibili.map(m=>(
        <div key={m.id} className={m.read?"msgrow":"msgrow unreadrow"} onClick={()=>markRead(m)}>
          <div className="msgmain"><div className="reqtitle">{m.subject} {!m.read && <span className="dot" />}</div><div className="muted small">{m.body}</div></div>
          <div className="msgside"><span className="muted small">{fmtDate(m.created_at)}</span>
            <div className="mailbtns" onClick={e=>e.stopPropagation()}>
              <a className="btn tiny" href={buildGmail(me.email, m.subject, m.body)} target="_blank" rel="noreferrer">Gmail</a>
              {mostraArchiviati
                ? <button className="btn tiny" onClick={()=>ripristina(m)}>Ripristina</button>
                : <button className="btn tiny" onClick={()=>archivia(m)}>Archivia</button>}
              <button className="btn tiny danger" onClick={()=>elimina(m)}>Elimina</button>
            </div></div>
        </div>
      ))}</div>
      <p className="muted small">Le conferme arrivano qui in tempo reale. Puoi archiviare o eliminare le comunicazioni già lette, singolarmente o tutte insieme, così resti con in vista solo quelle nuove.</p>
    </div>
  );
}

// ---------- funzioni dati ----------
function buildEventMap(reqs, logs){
  const map={};
  logs.forEach(l=>{ (map[iso(l.data)] ||= []).push({ short:TIPI.lavoro.short, ...TIPI.lavoro, hours:round2(Number(l.ore)), title:`${round2(Number(l.ore))}h lavorate` }); });
  reqs.filter(r=>r.stato!=="respinta").forEach(r=>{ eachDay(r.data_inizio,r.data_fine).forEach(day=>{ const t=TIPI[r.tipo]; (map[day] ||= []).push({ short:t.short, color:t.color, bg:t.bg, title:t.label, hours:r.mode==="ore"?round2(hoursBetween(r.ora_inizio,r.ora_fine)):null }); }); });
  return map;
}
function findOverlaps(requests){
  const active=requests.filter(r=>r.stato!=="respinta");
  const res={};
  for(let i=0;i<active.length;i++){ for(let j=0;j<active.length;j++){ if(i===j)continue; const a=active[i],b=active[j]; if(a.user_id===b.user_id)continue;
    const aDays=eachDay(a.data_inizio,a.data_fine); const bDays=new Set(eachDay(b.data_inizio,b.data_fine));
    if(aDays.some(d=>bDays.has(d))) (res[a.id] ||= []).push(b.user_id); } }
  return res;
}

// ============================================================
//  STILI
// ============================================================
const CSS = `
* { box-sizing:border-box; }
:root{ --bg:#f6f4ef; --panel:#fff; --ink:#1f2724; --muted:#7c857f; --line:#e7e3da; --accent:#3a7d6b; --accent-ink:#245a4c; --radius:14px; --shadow:0 1px 3px rgba(30,40,35,.06),0 6px 20px rgba(30,40,35,.05); --panel2:#fafaf8; --todaybg:#eef6f2; }
:root[data-theme="dark"]{ --bg:#161a19; --panel:#1f2523; --ink:#e8eae8; --muted:#9aa39d; --line:#333b38; --accent:#4f9d87; --accent-ink:#7bc0ac; --shadow:0 1px 3px rgba(0,0,0,.3),0 6px 20px rgba(0,0,0,.25); --panel2:#242b28; --todaybg:#232e2a; }
/* Adattamenti dark per banner ed etichette con colori fissi */
:root[data-theme="dark"] .alert{ background:#3a2323; color:#f0b8b8; }
:root[data-theme="dark"] .editbanner{ background:#22323f; color:#a9cee8; }
:root[data-theme="dark"] .straordbanner{ background:#3a3020; color:#e8c58a; }
:root[data-theme="dark"] .straordtag{ background:#3a3020; color:#e8c58a; }
:root[data-theme="dark"] .warnpill{ background:#3a3020; color:#e8c58a; }
:root[data-theme="dark"] .cmp.ok{ background:#22322b; color:#8ed3b6; }
:root[data-theme="dark"] .cmp.warn{ background:#3a3020; color:#e8c58a; }
:root[data-theme="dark"] .btn.ok{ background:#22322b; border-color:#2f4a3d; color:#8ed3b6; }
:root[data-theme="dark"] .btn.danger{ background:#3a2323; border-color:#4d2f2f; color:#f0b8b8; }
:root[data-theme="dark"] .btn.warn{ background:#3a3020; border-color:#4d4028; color:#e8c58a; }
:root[data-theme="dark"] .rolechip.admin{ background:#312a44; color:#c3b0e6; }
:root[data-theme="dark"] .rolechip.user{ background:#22322b; color:#8ed3b6; }
/* Le pill di tipo/stato usano colori inline chiari: in dark riduco la loro luminosità sfondo via mix */
:root[data-theme="dark"] .pill{ filter:brightness(.9) saturate(1.1); }
html{ background:var(--bg); overflow-x:hidden; }
body{ margin:0; background:var(--bg); color:var(--ink); font-family:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; overflow-x:hidden; max-width:100vw; }
/* i controlli di default nei browser non ereditano il colore: lo forzo dove non è già impostato */
h1,h2,h3,h4,h5,p,label,li,td,th{ color:var(--ink); }
select,input,textarea,option{ color:var(--ink); }
.reqtitle,.logdate,.loghours,.monthlabel,.statval,.calnum,.punchtimer{ color:var(--ink); }
.wrap{ min-height:100vh; background:var(--bg); color:var(--ink); font-family:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }
.center{ max-width:400px; margin:20vh auto; text-align:center; }
.authwrap{ display:flex; align-items:center; justify-content:center; padding:24px; }
.authcard{ background:var(--panel); border:1px solid var(--line); border-radius:20px; box-shadow:var(--shadow); padding:28px; width:100%; max-width:400px; }
.brand{ display:flex; gap:12px; align-items:center; margin-bottom:22px; }
.brand.small{ margin:0; gap:8px; }
.brandmark{ font-size:26px; color:var(--accent); }
.brand h1{ margin:0; font-size:22px; letter-spacing:-.02em; }
.tabs{ display:flex; gap:6px; background:var(--bg); padding:4px; border-radius:12px; margin-bottom:18px; }
.tab{ flex:1; border:0; background:transparent; padding:9px; border-radius:9px; cursor:pointer; font-weight:600; color:var(--muted); font-size:14px; }
.tab.on{ background:var(--panel); color:var(--ink); box-shadow:var(--shadow); }
.topbar{ display:flex; justify-content:space-between; align-items:center; padding:14px 20px; background:var(--panel); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:10; }
.topright{ display:flex; align-items:center; gap:12px; }
.whoami{ display:flex; align-items:center; gap:8px; font-weight:600; font-size:14px; }
.rolechip{ font-size:11px; font-weight:700; padding:4px 10px; border-radius:20px; }
.rolechip.admin{ background:#eae2f4; color:#5b3f86; }
.rolechip.user{ background:#e4f0e9; color:var(--accent-ink); }
.nav{ display:flex; gap:4px; padding:10px 16px; background:var(--panel); border-bottom:1px solid var(--line); overflow-x:auto; position:sticky; top:57px; z-index:9; }
.navbtn{ border:0; background:transparent; padding:8px 14px; border-radius:10px; cursor:pointer; font-weight:600; font-size:14px; color:var(--muted); white-space:nowrap; }
.navbtn.on{ background:var(--bg); color:var(--ink); }
.badge{ display:inline-flex; align-items:center; justify-content:center; min-width:18px; height:18px; padding:0 5px; margin-left:6px; font-size:11px; font-weight:700; border-radius:9px; background:#d9534f; color:#fff; }
.badge.solid{ background:var(--accent); }
.main{ max-width:920px; margin:0 auto; padding:20px 16px 60px; }
.stack{ display:flex; flex-direction:column; gap:16px; }
.card{ background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); box-shadow:var(--shadow); padding:18px; max-width:100%; overflow:hidden; }
h2{ font-size:19px; margin:2px 0; letter-spacing:-.01em; }
h3{ font-size:16px; margin:0 0 10px; }
.muted{ color:var(--muted); } .small{ font-size:12.5px; }
.rowbetween{ display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; }
.rowend{ display:flex; justify-content:flex-end; gap:8px; margin-top:12px; }
.field{ display:flex; flex-direction:column; gap:5px; font-size:13px; font-weight:600; color:var(--muted); margin-bottom:12px; }
.field input,.field select,.field textarea{ border:1px solid var(--line); border-radius:10px; padding:10px 12px; font-size:14px; font-family:inherit; color:var(--ink); background:var(--panel); font-weight:500; }
.field input:disabled,.field select:disabled{ opacity:.6; cursor:not-allowed; background:var(--panel2); }
.field input:focus,.field select:focus,.field textarea:focus{ outline:2px solid var(--accent); border-color:transparent; }
.grid2{ display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.grid3{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; }
.grid4{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
.grid5{ display:grid; grid-template-columns:repeat(5,1fr); gap:12px; }
.btn{ border:1px solid var(--line); background:var(--panel); border-radius:10px; padding:9px 16px; font-weight:600; font-size:14px; cursor:pointer; color:var(--ink); font-family:inherit; transition:transform .05s,background .15s; }
.btn:active{ transform:translateY(1px); } .btn:disabled{ opacity:.6; cursor:default; }
.btn.primary{ background:var(--accent); border-color:var(--accent); color:#fff; }
.btn.primary:hover:not(:disabled){ background:var(--accent-ink); }
.btn.big{ width:100%; padding:12px; font-size:15px; }
.btn.ghost{ background:transparent; }
.btn.tiny{ padding:6px 11px; font-size:13px; }
.btn.ok{ background:#e4f0e9; border-color:#c7e0d3; color:var(--accent-ink); }
.btn.danger{ background:#f9e9e9; border-color:#f0d3d3; color:#9a3b3b; }
.btn.warn{ background:#f7ecd9; border-color:#e8d3b0; color:#8a5410; }
.filterrow{ display:flex; gap:10px; flex-wrap:wrap; }
.alert{ background:#f9e9e9; color:#9a3b3b; padding:10px 12px; border-radius:10px; font-size:13px; margin-bottom:12px; font-weight:500; }
.empty{ text-align:center; color:var(--muted); padding:28px; font-size:14px; background:var(--bg); border-radius:12px; }
.list{ display:flex; flex-direction:column; gap:8px; }
.reqrow{ display:flex; align-items:center; gap:12px; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px 14px; flex-wrap:wrap; }
.reqmain{ flex:1; min-width:120px; }
.reqwho{ display:flex; align-items:center; gap:10px; flex:1; min-width:160px; }
.reqtitle{ font-weight:600; font-size:14.5px; }
.reqactions{ display:flex; gap:6px; margin-left:auto; }
.locked{ font-style:italic; }
.pill{ font-size:12px; font-weight:700; padding:5px 11px; border-radius:20px; white-space:nowrap; }
.warnpill{ background:#f7ecd9; color:#b3701c; }
.avatar{ width:34px; height:34px; border-radius:50%; background:var(--accent); color:#fff; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; flex-shrink:0; }
.avatar.big{ width:46px; height:46px; font-size:16px; }
.logrow{ display:flex; align-items:center; gap:14px; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px 14px; flex-wrap:wrap; }
.logdate{ font-weight:700; min-width:90px; }
.logtimes{ color:var(--muted); font-size:13px; }
.loghours{ font-weight:600; }
.logcompare{ margin-left:auto; }
.cmp{ font-size:12.5px; font-weight:700; padding:4px 10px; border-radius:20px; }
.cmp.ok{ background:#e4f0e9; color:var(--accent-ink); }
.cmp.warn{ background:#f7ecd9; color:#b3701c; }
.monthnav{ display:flex; align-items:center; justify-content:center; gap:16px; margin-bottom:14px; }
.monthlabel{ font-weight:700; font-size:16px; min-width:150px; text-align:center; }
.calendar{ border:1px solid var(--line); border-radius:12px; overflow:hidden; width:100%; max-width:100%; }
.calhead{ display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); background:var(--bg); }
.calheadcell{ padding:8px 2px; text-align:center; font-size:12px; font-weight:700; color:var(--muted); min-width:0; overflow:hidden; }
.calbody{ display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); }
.calcell{ min-height:76px; min-width:0; border-top:1px solid var(--line); border-left:1px solid var(--line); padding:5px; position:relative; overflow:hidden; }
.calcell:nth-child(7n+1){ border-left:0; }
.calcell.empty{ background:var(--panel2); }
.calcell.today{ background:var(--todaybg); }
.calnum{ font-size:12px; font-weight:700; color:var(--muted); }
.calcell.today .calnum{ color:var(--accent); }
.daytags{ display:flex; flex-direction:column; gap:3px; margin-top:3px; }
.daytag{ font-size:10.5px; font-weight:700; padding:2px 4px; border-radius:5px; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.teamday{ display:flex; flex-direction:column; gap:2px; margin-top:3px; }
.teamday.many{ outline:2px solid #e6b566; outline-offset:-4px; border-radius:6px; }
.teamtag{ font-size:9.5px; font-weight:700; padding:2px 3px; border-radius:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.teamtag.more{ background:var(--line); color:var(--muted); }
.legend{ display:flex; gap:14px; flex-wrap:wrap; margin-top:12px; }
.legenditem{ display:flex; align-items:center; gap:6px; font-size:12.5px; color:var(--muted); font-weight:600; }
.legdot{ width:10px; height:10px; border-radius:3px; }
.legtag{ display:inline-flex; align-items:center; justify-content:center; width:20px; height:20px; border-radius:5px; font-size:11px; font-weight:800; }
.stats{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-top:4px; }
.stats5{ grid-template-columns:repeat(5,1fr); }
.stat{ background:var(--bg); border-radius:12px; padding:16px 12px; text-align:center; }
.statval{ font-size:24px; font-weight:800; letter-spacing:-.02em; }
.statlabel{ font-size:12.5px; color:var(--muted); font-weight:600; margin-top:4px; }
.comparebar{ display:flex; gap:18px; flex-wrap:wrap; align-items:center; margin-top:14px; padding:12px 14px; background:var(--bg); border-radius:10px; font-size:13.5px; }
.usergrid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; }
.usercard{ display:flex; align-items:center; gap:12px; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:14px; cursor:pointer; text-align:left; position:relative; font-family:inherit; transition:box-shadow .15s; }
.usercard:hover{ box-shadow:var(--shadow); }
.usercardbody{ flex:1; }
.usercard .badge.solid{ position:absolute; top:10px; right:10px; }
.msgrow{ display:flex; gap:14px; justify-content:space-between; align-items:flex-start; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px; cursor:pointer; }
.unreadrow{ border-color:var(--accent); background:var(--todaybg); }
.msgmain{ flex:1; }
.msgside{ display:flex; flex-direction:column; align-items:flex-end; gap:6px; }
.dot{ display:inline-block; width:8px; height:8px; border-radius:50%; background:#d9534f; margin-left:4px; }
.hidemobile{ display:inline; }
.themebtn{ font-size:16px; line-height:1; }
.themebtn.corner{ position:absolute; top:18px; right:18px; }
.dash{ display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
.dashcard{ background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px; cursor:pointer; text-align:left; font-family:inherit; box-shadow:var(--shadow); transition:transform .05s, border-color .15s; }
.dashcard:hover{ border-color:var(--accent); }
.dashcard:active{ transform:translateY(1px); }
.dashcard.accent{ background:var(--accent); border-color:var(--accent); }
.dashcard.accent .dashnum,.dashcard.accent .dashlbl{ color:#fff; }
.dashnum{ font-size:26px; font-weight:800; color:var(--ink); letter-spacing:-.02em; }
.dashlbl{ font-size:12.5px; color:var(--muted); font-weight:600; margin-top:2px; }
.okmsg{ background:var(--panel2); color:var(--accent-ink); padding:10px 12px; border-radius:10px; font-size:13px; margin-top:12px; font-weight:600; border:1px solid var(--line); }
/* timbratura */
.punchcard{ text-align:center; }
.punchcard.active{ border-color:var(--accent); }
.punchhead{ display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:6px; }
.punchhead h3{ margin:0; }
.punchstate{ font-size:12px; font-weight:700; padding:3px 10px; border-radius:20px; background:var(--panel2); color:var(--accent-ink); border:1px solid var(--line); }
.punchstate.pausestate{ color:#b3701c; }
.punchtimer{ font-size:44px; font-weight:800; letter-spacing:.02em; font-variant-numeric:tabular-nums; margin:10px 0; color:var(--ink); }
.punchtimer.straord{ color:#b3701c; }
.straordbanner{ background:#f7ecd9; color:#8a5410; font-weight:700; font-size:13px; padding:8px 12px; border-radius:9px; margin-bottom:12px; display:inline-block; }
.punchbtns{ display:flex; gap:10px; justify-content:center; margin:14px 0 8px; }
.punchbtns .btn{ min-width:120px; padding:12px 18px; font-size:15px; }
.punchinfo{ margin-top:6px; }
/* nav e filtri più cliccabili */
.navbtn{ padding:10px 16px; }
/* ===== Tablet (fino a 900px) ===== */
@media (max-width:900px){
  .main{ max-width:100%; }
  .grid4,.grid5{ grid-template-columns:repeat(3,1fr); }
  .stats,.stats5{ grid-template-columns:repeat(3,1fr); }
  .dash{ grid-template-columns:repeat(2,1fr); }
  .usergrid{ grid-template-columns:repeat(2,1fr); }
}

/* ===== Telefono (fino a 640px) ===== */
@media (max-width:640px){
  .grid2,.grid3,.grid4,.grid5{ grid-template-columns:1fr 1fr; }
  .stats,.stats5{ grid-template-columns:1fr 1fr; }
  .hidemobile{ display:none; }
  .main{ padding:14px 10px 60px; }
  .card{ padding:14px; }
  .topbar{ padding:12px 14px; }
  .topright{ gap:8px; }
  .nav{ gap:4px; padding:8px 10px; }
  .navbtn{ padding:9px 12px; font-size:13px; }
  .dash{ grid-template-columns:1fr 1fr; gap:8px; }
  .usergrid{ grid-template-columns:1fr; }

  /* righe ore/richieste: impilano in blocco leggibile invece di spezzarsi male */
  .logrow{ gap:6px 10px; }
  .logrow .logdate{ min-width:auto; width:100%; font-size:15px; }
  .logcompare{ margin-left:0; width:100%; }
  .logactions{ width:100%; }
  .logactions .btn{ flex:1; }
  .reqrow{ gap:8px; }
  .reqactions{ width:100%; margin-left:0; }
  .reqactions .btn{ flex:1; }

  /* calendario: numeri più leggibili, tag compatti */
  .calcell{ min-height:58px; padding:3px; }
  .calheadcell{ font-size:11px; padding:6px 2px; }
  .daytag{ font-size:9.5px; padding:2px 3px; }
  .teamtag{ font-size:9px; }

  /* timbratura */
  .punchtimer{ font-size:40px; }
  .punchbtns{ flex-wrap:wrap; } .punchbtns .btn{ flex:1; min-width:100px; }

  /* filtri e modali a tutta larghezza */
  .inlinefilter,.inlinefilter select{ min-width:0; width:100%; }
  .rowbetween{ gap:8px; }
  .modal{ max-width:100%; padding:16px; }
  .comparebar{ gap:10px; font-size:13px; }
}

/* ===== Telefono piccolo (fino a 400px) ===== */
@media (max-width:400px){
  .grid2,.grid3,.grid4,.grid5{ grid-template-columns:1fr; }
  .stats,.stats5{ grid-template-columns:1fr 1fr; }
  .dash{ grid-template-columns:1fr; }
  .brand h1{ font-size:20px; }
  .punchtimer{ font-size:34px; }
}
.straordtag{ font-size:11px; font-weight:700; color:#b3701c; background:#f7ecd9; padding:2px 7px; border-radius:20px; margin-left:6px; }
.checkfield{ display:flex; align-items:center; gap:8px; font-size:14px; font-weight:600; color:var(--ink); margin:4px 0 12px; cursor:pointer; }
.checkfield input[type=checkbox]{ width:18px; height:18px; accent-color:var(--accent); cursor:pointer; }
.punchcheck{ justify-content:center; margin:12px 0; }
.sitetag{ font-size:10.5px; font-weight:700; padding:2px 7px; border-radius:20px; margin-left:4px; }
.sitetag.cantiere{ background:#e0ebf4; color:#2b5f8a; }
.sitetag.sede{ background:var(--panel2); color:var(--muted); }
:root[data-theme="dark"] .sitetag.cantiere{ background:#22323f; color:#a9cee8; }
.editbanner{ background:#e0ebf4; color:#2b5f8a; padding:8px 12px; border-radius:9px; font-size:13px; font-weight:600; margin-bottom:12px; }
.editcard{ border-color:var(--accent); }
.usergroup{ background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
.grouphead{ display:flex; align-items:center; justify-content:space-between; width:100%; background:transparent; border:0; padding:12px 14px; cursor:pointer; font-family:inherit; text-align:left; }
.grouphead:hover{ background:var(--panel2); }
.grouptitle{ display:flex; align-items:center; gap:10px; }
.chevron{ color:var(--muted); font-size:14px; }
.groupbody{ padding:0 12px 12px; }
.inlinefilter{ margin-bottom:0; min-width:180px; }
.inlinefilter select{ min-width:180px; }
.logactions{ display:flex; gap:6px; }
.calcell.clickable{ cursor:pointer; }
.calcell.clickable:hover{ background:var(--todaybg); }
.mailbtns{ display:flex; gap:6px; }
.modalback{ position:fixed; inset:0; background:rgba(20,25,22,.45); display:flex; align-items:center; justify-content:center; padding:20px; z-index:50; }
.modal{ background:var(--panel); border-radius:16px; box-shadow:0 12px 40px rgba(0,0,0,.25); padding:20px; width:100%; max-width:520px; max-height:80vh; overflow:auto; }
.modalhead{ display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; }
.modalhead h3{ margin:0; }
`;
