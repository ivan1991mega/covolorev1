// Piccolo wrapper attorno a fetch che aggiunge il token JWT e gestisce gli errori.

const TOKEN_KEY = "gestore_token";

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function req(method, url, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try { data = await res.json(); } catch { /* risposta senza corpo */ }

  if (!res.ok) {
    const msg = (data && data.error) || `Errore ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

// Scarica un file da un endpoint protetto (allega il token e forza il download).
async function download(url, filename) {
  const token = getToken();
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let msg = `Errore ${res.status}`;
    try { const d = await res.json(); if (d.error) msg = d.error; } catch {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

export const api = {
  get: (u) => req("GET", u),
  post: (u, b) => req("POST", u, b),
  put: (u, b) => req("PUT", u, b),
  del: (u) => req("DELETE", u),
  download,
};
