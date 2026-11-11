// Conecta la página con el servidor propio: misma interfaz de datos que usa app.js,
// respaldada por la API REST y por avisos en tiempo real (Server-Sent Events).
(function () {
  const cache = {}, subs = [];
  let listo = false, yo = null, nombres = {}, arranque = null;

  async function api(metodo, url, cuerpo) {
    let r;
    try { r = await fetch(url, { method: metodo, credentials: 'same-origin', headers: cuerpo ? { 'Content-Type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined }); }
    catch (e) { throw { code: 'unavailable', message: 'Sin conexión con el servidor.' }; }
    if (r.status === 401) { location.href = 'login.html'; return new Promise(() => {}); } // sesión terminada: la página ya está saliendo
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw { code: r.status === 403 ? 'forbidden' : r.status === 400 || r.status === 404 ? 'invalid_argument' : 'unavailable', message: j.error || '' };
    return j;
  }
  const foto = (col) => {
    const m = cache[col] || {};
    const docs = Object.keys(m).sort().map((id) => ({ id, exists: true, data: () => m[id] }));
    return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false } };
  };
  const notificar = (col) => subs.forEach((s) => { if (s.col === col) s.fn(foto(col)); });
  function aplicar(col, id, data) { (cache[col] || (cache[col] = {}))[id] = data; if (listo) notificar(col); }
  async function cargar() {
    for (;;) {
      try {
        const j = await api('GET', 'api/datos');
        Object.keys(j.cols).forEach((col) => { cache[col] = {}; j.cols[col].forEach(({ id, ...d }) => { cache[col][id] = d; }); });
        listo = true; [...new Set(subs.map((s) => s.col))].forEach(notificar); return;
      } catch (e) { await new Promise((r) => setTimeout(r, 5000)); }
    }
  }
  function iniciar() {
    return arranque || (arranque = (async () => {
      yo = await api('GET', 'api/yo');
      cargar();
      let conectado = false;
      const es = new EventSource('api/eventos');
      es.onopen = () => { if (conectado) cargar(); conectado = true; }; // al reconectar, recarga por si se perdió algún aviso
      es.onmessage = (ev) => { const m = JSON.parse(ev.data); aplicar(m.col, m.id, m.data); };
      const cuenta = document.createElement('a');
      cuenta.href = 'cuenta.html'; cuenta.className = 'cuenta'; cuenta.textContent = 'Cuenta';
      document.querySelector('.side').appendChild(cuenta);
    })());
  }

  const docRef = (col, id) => ({
    id, path: `${col}/${id}`,
    async get() { const d = (cache[col] || {})[id]; return { id, exists: !!d, data: () => d }; },
    async set(data) { await api('PUT', `api/doc/${col}/${encodeURIComponent(id)}`, data); },
    async update(data) { await api('PATCH', `api/doc/${col}/${encodeURIComponent(id)}`, data); },
  });
  const colRef = (col) => {
    const q = {
      path: col, doc: (id) => docRef(col, id), orderBy: () => q, limit: () => q, where: () => q,
      onSnapshot(fn) { const s = { col, fn }; subs.push(s); if (listo) setTimeout(() => fn(foto(col)), 0); return () => subs.splice(subs.indexOf(s), 1); },
    };
    return q;
  };
  const db = {
    collection: colRef,
    doc: (ruta) => { const [col, id] = ruta.split('/'); return docRef(col, id); },
    folio: async (tipo) => (await api('POST', `api/folio/${tipo}`)).n,
    usarSesion: (membresiaId) => api('POST', `api/sesion/${encodeURIComponent(membresiaId)}`),
  };
  const user = {
    me: async () => ({ id: yo.id, name: yo.nombre, isOwner: yo.rol === 'admin', canEdit: yo.rol === 'admin' }),
    can: async () => true,
    async profiles(ids) {
      if (ids.some((i) => !(i in nombres))) nombres = await api('GET', 'api/nombres').catch(() => nombres);
      return Object.fromEntries(ids.map((i) => [i, { id: i, name: nombres[i] || '' }]));
    },
  };
  const downloads = {
    async save({ filename, data }) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
      a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    },
  };
  window.claude = { use: async (nombre) => { await iniciar(); return { db, user, downloads }[nombre] || null; } };
})();
