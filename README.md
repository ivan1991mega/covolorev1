# Gestione ore

App per gestire presenze, permessi, ferie e assenze di un team. Frontend React + backend Node/Express + database Postgres. I dati sono **condivisi**: l'amministratore approva una richiesta e il dipendente la vede sul suo dispositivo.

---

## Cosa fa

**Lato dipendente**
- Calendario personale con presenze e richieste; i giorni sono cliccabili per vedere/modificare la richiesta
- Richieste di permesso / ferie / assenza (orarie o giornaliere)
- Modifica ed eliminazione solo delle richieste in attesa e future
- Registrazione ore lavorate **con straordinari separati**; nessuna approvazione richiesta, ma modificabili in caso di incongruenza
- Riepilogo mensile: ore lavorate, straordinari, permessi, ferie, assenze
- Casella comunicazioni con le conferme, con pulsante **Gmail** (compone la mail nel browser) o client di sistema

**Lato amministratore**
- Richieste da gestire in prima pagina, con avviso sulle sovrapposizioni
- Calendario del team con **nome** dei dipendenti; giorni cliccabili per il dettaglio
- **Esporta in Excel**: riepilogo mensile di tutti i dipendenti in un unico .xlsx da inviare all'ufficio paga
- Navigazione utente per utente, con riepilogo e storico
- Inserimento delle ore rilevate e correzione delle ore dei dipendenti

---

## Struttura del progetto

```
.
├── package.json          → avvio del server e build del client
├── server/               → backend Express + Postgres
│   ├── index.js          → API
│   ├── db.js             → connessione e tabelle
│   └── mailer.js         → invio email (opzionale)
├── client/               → frontend React (Vite)
│   └── src/App.jsx        → l'applicazione
├── .env.example          → variabili d'ambiente di esempio
└── .gitignore
```

---

## Passo 1 — Carica il progetto su GitHub

1. Vai su GitHub e crea un nuovo repository vuoto (es. `gestione-ore`). Non aggiungere README o .gitignore, li abbiamo già.
2. Sul tuo computer, apri il terminale nella cartella del progetto ed esegui:

   ```bash
   git init
   git add .
   git commit -m "Prima versione"
   git branch -M main
   git remote add origin https://github.com/TUO-UTENTE/gestione-ore.git
   git push -u origin main
   ```

   Sostituisci `TUO-UTENTE` con il tuo nome utente GitHub.

   > Se non usi il terminale, puoi trascinare i file nella pagina "uploading an existing file" del repository su GitHub — ma **non caricare** la cartella `node_modules` né `client/node_modules`.

---

## Passo 2 — Crea il progetto su Railway

1. Entra su Railway e scegli **New Project → Deploy from GitHub repo**.
2. Autorizza Railway ad accedere al repository e seleziona `gestione-ore`.
3. Railway rileva Node.js e comincia il primo deploy. All'inizio fallirà: manca ancora il database. È normale, lo aggiungiamo ora.

---

## Passo 3 — Aggiungi il database Postgres

1. Dentro il progetto Railway, clicca **New → Database → Add PostgreSQL**.
2. Railway crea il database e imposta **da solo** la variabile `DATABASE_URL` nel tuo servizio. Non devi copiarla a mano.

---

## Passo 4 — Imposta le variabili

Nel servizio dell'app (non nel database), apri la scheda **Variables** e aggiungi:

| Nome             | Valore                                   |
|------------------|------------------------------------------|
| `JWT_SECRET`     | una stringa lunga e casuale a tua scelta |
| `ADMIN_EMAIL`    | l'email dell'amministratore              |
| `ADMIN_PASSWORD` | la password iniziale dell'admin          |

`DATABASE_URL` c'è già (l'ha messa Railway al passo 3). `PORT` la gestisce Railway automaticamente.

Al primo avvio, l'app crea le tabelle e l'account amministratore con l'email e la password che hai indicato.

---

## Passo 5 — Deploy e primo accesso

1. Railway rifà il deploy da solo dopo aver aggiunto le variabili (altrimenti premi **Deploy**).
2. Nella scheda **Settings → Networking**, genera un dominio pubblico (**Generate Domain**).
3. Apri il dominio: vedrai la schermata di accesso. Entra con `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
4. I dipendenti si registrano da soli con "Registrati", usando la propria email.

Ogni volta che fai `git push`, Railway aggiorna l'app automaticamente.

---

## (Opzionale) Email reali

Senza configurazione, le conferme restano dentro l'app (casella "Comunicazioni") e l'admin ha un pulsante "Apri email" per inviarle a mano dal proprio client.

Per far partire **email automatiche vere**, aggiungi anche queste variabili su Railway e reinstalla la dipendenza `nodemailer`:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tuoindirizzo@gmail.com
SMTP_PASS=password-per-le-app
SMTP_FROM=tuoindirizzo@gmail.com
```

Con Gmail devi creare una "password per le app" nelle impostazioni di sicurezza Google (la password normale non funziona). Poi, nel `package.json` della root, aggiungi `"nodemailer": "^6.9.14"` tra le dipendenze e fai un nuovo push: da quel momento le conferme partono via email.

---

## Provare in locale (facoltativo)

Serve Node 20+ e un Postgres locale.

```bash
cp .env.example .env      # poi compila DATABASE_URL e JWT_SECRET
npm run install:all
npm run build             # builda il frontend
npm start                 # server su http://localhost:3000
```

Per sviluppare con ricarica automatica del frontend, in un secondo terminale:

```bash
npm run dev --prefix client   # frontend su http://localhost:5173
```

---

## Note sulla sicurezza

- Le password sono cifrate con bcrypt e le sessioni firmate con JWT: va bene per uso interno di un team.
- Cambia `ADMIN_PASSWORD` dopo il primo accesso e usa un `JWT_SECRET` lungo e casuale.
- Per dati personali di dipendenti in un contesto reale, valuta backup del database (Railway li offre) e una policy sulla privacy adeguata.
