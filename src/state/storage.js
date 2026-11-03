/* Chili — Persistenz (IndexedDB). Projekte und Original-Audiodateien getrennt gespeichert. */
const DB = 'chili', VER = 1;
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('projects')) d.createObjectStore('projects', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('samples')) d.createObjectStore('samples', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode), s = t.objectStore(store); let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const listProjects = () => tx('projects', 'readonly', (s) => req(s.getAll())).then((a) => a.sort((x, y) => y.updated - x.updated));
export const getProject = (id) => tx('projects', 'readonly', (s) => req(s.get(id)));
export const putProject = (p) => tx('projects', 'readwrite', (s) => req(s.put(p)));
export const getSample = (id) => tx('samples', 'readonly', (s) => req(s.get(id)));
export const putSample = (rec) => tx('samples', 'readwrite', (s) => req(s.put(rec)));

/** Löscht ein Projekt und alle Samples, die kein anderes Projekt mehr verwendet. */
export async function deleteProject(id) {
  const all = await listProjects(), p = all.find((x) => x.id === id); if (!p) return;
  const used = new Set(all.filter((x) => x.id !== id).flatMap((x) => (x.samples || []).map((s) => s.id)));
  await tx('projects', 'readwrite', (s) => req(s.delete(id)));
  for (const s of p.samples || []) if (!used.has(s.id)) await tx('samples', 'readwrite', (st) => req(st.delete(s.id)));
}

/* ---- Export/Import als .chili (JSON mit eingebetteten Audiodateien) */
const b64 = (buf) => { const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u.buffer; };

export async function exportProject(p) {
  const files = {};
  for (const s of p.samples || []) { const rec = await getSample(s.id); if (rec) files[s.id] = { name: rec.name, type: rec.type, data: b64(rec.bytes) }; }
  return new Blob([JSON.stringify({ chili: 1, project: p, files })], { type: 'application/json' });
}
export async function importProjectFile(file, newId) {
  const j = JSON.parse(await file.text());
  if (!j.chili || !j.project) throw new Error('Not a valid .chili file');
  for (const [id, f] of Object.entries(j.files || {})) await putSample({ id, name: f.name, type: f.type, bytes: unb64(f.data) });
  const p = { ...j.project, id: newId, updated: Date.now() };
  await putProject(p);
  return p;
}
