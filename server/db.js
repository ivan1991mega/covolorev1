import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;

// Railway fornisce DATABASE_URL automaticamente quando colleghi un database Postgres.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

// Crea le tabelle se non esistono e inserisce un admin iniziale.
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      email      TEXT UNIQUE NOT NULL,
      pw_hash    TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS requests (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tipo        TEXT NOT NULL,           -- permesso | ferie | assenza
      mode        TEXT NOT NULL,           -- ore | giorni
      data_inizio DATE NOT NULL,
      data_fine   DATE NOT NULL,
      ora_inizio  TEXT,
      ora_fine    TEXT,
      note        TEXT DEFAULT '',
      stato       TEXT NOT NULL DEFAULT 'in_attesa',  -- in_attesa | approvata | respinta
      created_at  TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS worklogs (
      id       SERIAL PRIMARY KEY,
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      data     DATE NOT NULL,
      inizio   TEXT NOT NULL,
      fine     TEXT NOT NULL,
      pausa    INTEGER DEFAULT 0,
      ore      NUMERIC(5,2) NOT NULL,
      straordinari NUMERIC(5,2) DEFAULT 0,
      cantiere BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS detected (
      id       SERIAL PRIMARY KEY,
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      data     DATE NOT NULL,
      ore      NUMERIC(5,2) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (user_id, data)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id         SERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject    TEXT NOT NULL,
      body       TEXT NOT NULL,
      read       BOOLEAN DEFAULT false,
      archived   BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    -- Timbratura in corso: una sessione attiva per utente.
    CREATE TABLE IF NOT EXISTS punch (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      entrata       TIMESTAMPTZ NOT NULL,        -- momento dell'entrata
      stato         TEXT NOT NULL DEFAULT 'attivo', -- attivo | in_pausa
      pausa_totale  INTEGER DEFAULT 0,           -- minuti di pausa già accumulati
      pausa_inizio  TIMESTAMPTZ                  -- se in pausa, quando è iniziata
    );
  `);

  // Migrazione: aggiunge la colonna straordinari se il database è di una versione precedente.
  await pool.query(`ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS straordinari NUMERIC(5,2) DEFAULT 0;`);
  await pool.query(`ALTER TABLE worklogs ADD COLUMN IF NOT EXISTS cantiere BOOLEAN DEFAULT false;`);
  // Migrazione: aggiunge la colonna archived ai messaggi.
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;`);

  // Seed admin se il database è vuoto.
  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM users");
  if (rows[0].n === 0) {
    const adminEmail = process.env.ADMIN_EMAIL || "admin@azienda.it";
    const adminPw = process.env.ADMIN_PASSWORD || "admin";
    const hash = await bcrypt.hash(adminPw, 10);
    await pool.query(
      "INSERT INTO users (name, email, pw_hash, role) VALUES ($1, $2, $3, 'admin')",
      ["Amministratore", adminEmail, hash]
    );
    console.log(`✓ Admin iniziale creato: ${adminEmail} / ${adminPw}`);
  }
}
