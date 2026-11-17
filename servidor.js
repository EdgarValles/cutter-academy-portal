// Servidor del portal Cutter Academy: sirve la página, autentica usuarios y guarda los datos en MongoDB.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const R = require('./public/rules.js');

const OPERACION = ['clientes', 'membresias', 'cargos', 'pagos', 'clases', 'reservaciones', 'asistenciasDia', 'pedidos', 'rutinas'];
const CATALOGOS = ['areas', 'tiposCliente', 'conceptos', 'precios', 'equipos', 'entrenadores', 'formasPago', 'recursos', 'config'];
const COLECCIONES = [...OPERACION, ...CATALOGOS];
const ID_OK = /^[A-Za-z0-9_\-~:@+][A-Za-z0-9_\-.~:@+]{0,99}$/;
const SESION_HORAS = 12;
const CONTABLES = ['cargos', 'pagos']; // una vez registrados no se modifican: solo se cancelan
const CANCELACION = ['cancelado', 'motivoCancelacion', 'canceladoPor', 'canceladoEl'];
const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/;
const entero = (v, min = 0) => Number.isInteger(v) && v >= min;
// Colecciones que crecen cada día: al portal solo se mandan las más recientes (el id empieza con la fecha).
const RECIENTES = { asistenciasDia: 180, rutinas: 600 };
const ZONA = 'America/Mexico_City';
const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
// Frase del día para la pantalla de socios: la lista se recorre en orden, una por día, y vuelve a empezar al terminar.
const FRASES = JSON.parse(fs.readFileSync(path.join(__dirname, 'frases-del-dia.json'), 'utf8'));
const fraseDe = (fecha) => FRASES[((R.diasEntre('2026-01-01', fecha) % FRASES.length) + FRASES.length) % FRASES.length] || '';

// ---- Contraseñas (scrypt, sin dependencias nativas) ----
function cifrar(password) {
  const sal = crypto.randomBytes(16);
  return `${sal.toString('hex')}:${crypto.scryptSync(password, sal, 64).toString('hex')}`;
}
function coincide(password, guardado) {
  const [sal, hash] = String(guardado || '').split(':');
  if (!sal || !hash) return false;
  const a = crypto.scryptSync(password, Buffer.from(sal, 'hex'), 64), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const huella = (token) => crypto.createHash('sha256').update(token).digest('hex');

// Rechaza llaves que Mongo interpretaría como operadores o rutas, y las que alcanzan el prototipo de los objetos.
const LLAVES_PROHIBIDAS = ['__proto__', 'constructor', 'prototype'];
function datosValidos(v, nivel = 0) {
  if (nivel > 8) return false;
  if (Array.isArray(v)) return v.every((x) => datosValidos(x, nivel + 1));
  if (v && typeof v === 'object') return Object.entries(v).every(([k, x]) => k && !k.startsWith('$') && !k.includes('.') && !k.includes('\0') && !LLAVES_PROHIBIDAS.includes(k) && datosValidos(x, nivel + 1));
  return ['string', 'number', 'boolean'].includes(typeof v) || v === null;
}

function errorRutina(d, id) {
  if (!FECHA_OK.test(d.fecha) || !R.TIPOS_RUTINA.some(([t]) => t === d.tipo) || id !== R.idRutina(d.fecha, d.tipo)) return 'La rutina no tiene fecha o tipo válidos.';
  if (typeof d.texto !== 'string' || d.texto.length > 4000 || typeof d.titulo !== 'string' || d.titulo.length > 80) return 'La rutina admite hasta 4000 caracteres y el título hasta 80.';
  return '';
}

function errorMembresia(d) {
  if (['sesionesTotales', 'sesionesUsadas'].some((k) => k in d && !entero(d[k]))) return 'Las sesiones deben ser números enteros, no negativos.';
  if (['inicio', 'fin'].some((k) => k in d && !FECHA_OK.test(d[k]))) return 'Las fechas de la membresía no son válidas.';
  return '';
}

async function crearApp(almacen, { cookieSegura = false } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Express 4 no atrapa los errores de rutas async: sin esto, un fallo de la base apaga el proceso.
  const seguro = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);
  for (const m of ['get', 'post', 'put', 'patch']) { const original = app[m].bind(app); app[m] = (ruta, ...pasos) => original(ruta, ...pasos.map(seguro)); }
  app.use(express.json({ limit: '300kb' }));
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-ancestors 'none'" });
    next();
  });

  // ---- Sesiones ----
  const cookieDe = (req) => (String(req.headers.cookie || '').split(';').map((x) => x.trim().split('=')).find(([k]) => k === 'sid') || [])[1];
  const ponerCookie = (res, token, segundos) => res.set('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${segundos}${cookieSegura ? '; Secure' : ''}`);
  const publico = (u) => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, activo: u.activo !== false });
  async function autenticar(req, res, next) {
    const token = cookieDe(req);
    const ses = token && await almacen.obtener('sesiones', huella(token));
    const u = ses && new Date(ses.expira) > new Date() && await almacen.obtener('usuarios', ses.usuarioId);
    if (!u || u.activo === false) return res.status(401).json({ error: 'Inicia sesión.' });
    req.usuario = u; req.sesion = ses; next();
  }
  const soloAdmin = (req, res, next) => (req.usuario.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo un administrador puede hacer esto.' }));

  // Límite de intentos fallidos en 10 minutos: 10 por dirección y usuario, para que los fallos de uno
  // no dejen fuera a los demás de la misma red, y 100 por dirección.
  const intentos = new Map(), VENTANA = 10 * 60000;
  const fallos = (clave, ahora) => { const r = intentos.get(clave); return r && ahora - r.t <= VENTANA ? r.n : 0; };
  const anotar = (clave, ahora) => { const n = fallos(clave, ahora); intentos.set(clave, { n: n + 1, t: n ? intentos.get(clave).t : ahora }); };
  app.post('/api/login', async (req, res) => {
    const ip = req.ip, ahora = Date.now();
    const usuario = String(req.body.usuario || '').trim().toLowerCase().slice(0, 40), password = String(req.body.password || '');
    const clave = `${ip}|${usuario}`;
    if (fallos(clave, ahora) >= 10 || fallos(ip, ahora) >= 100) return res.status(429).json({ error: 'Demasiados intentos. Espera 10 minutos.' });
    const u = usuario && await almacen.buscarUno('usuarios', { usuario });
    if (!u || u.activo === false || !coincide(password, u.clave)) {
      if (intentos.size > 2000) for (const [k, r] of intentos) if (ahora - r.t > VENTANA) intentos.delete(k);
      anotar(clave, ahora); anotar(ip, ahora);
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    intentos.delete(clave);
    const token = crypto.randomBytes(32).toString('hex');
    await almacen.reemplazar('sesiones', huella(token), { usuarioId: u.id, expira: new Date(ahora + SESION_HORAS * 3600000) });
    ponerCookie(res, token, SESION_HORAS * 3600);
    res.json(publico(u));
  });
  app.post('/api/logout', async (req, res) => {
    const token = cookieDe(req);
    if (token) await almacen.eliminar('sesiones', huella(token));
    ponerCookie(res, '', 0); res.json({ ok: true });
  });

  // ---- Tiempo real: cada cambio se avisa a los navegadores conectados ----
  const oyentes = new Set();
  const avisar = (col, id, data) => { const m = `data: ${JSON.stringify({ col, id, data })}\n\n`; oyentes.forEach((r) => r.write(m)); };
  app.get('/api/eventos', autenticar, (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders(); res.write('retry: 3000\n\n');
    oyentes.add(res);
    const latido = setInterval(() => res.write(': ok\n\n'), 25000);
    req.on('close', () => { clearInterval(latido); oyentes.delete(res); });
  });

  // ---- Datos ----
  app.get('/api/yo', autenticar, (req, res) => res.json(publico(req.usuario)));
  app.get('/api/nombres', autenticar, async (req, res) => res.json(Object.fromEntries((await almacen.listar('usuarios')).map((u) => [u.id, u.nombre]))));
  app.get('/api/datos', autenticar, async (req, res) => {
    const cols = {};
    for (const col of COLECCIONES) cols[col] = await almacen.listar(col, RECIENTES[col] ? { limite: RECIENTES[col], descendente: true } : {});
    res.json({ cols });
  });

  function revisar(req, res, next) {
    const { col, id } = req.params;
    if (!COLECCIONES.includes(col) || !ID_OK.test(id)) return res.status(400).json({ error: 'Ruta no válida.' });
    if (col === 'config' && id === 'folios') return res.status(403).json({ error: 'Los folios los asigna el servidor.' });
    if (CATALOGOS.includes(col) && req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede cambiar catálogos y precios.' });
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body) || !datosValidos(req.body)) return res.status(400).json({ error: 'Datos no válidos.' });
    delete req.body.id; delete req.body._id;
    next();
  }
  // Reglas que no pueden depender del navegador: importes, saldos y sesiones. Devuelven el mensaje de error o ''.
  const pagadoDe = async (cargoId) => (await almacen.listar('pagos', { filtro: { cargoId } })).filter((p) => !p.cancelado).reduce((s, p) => s + p.monto, 0);
  async function errorDeAlta(col, d, id) {
    if (col === 'membresias') return errorMembresia(d);
    if (col === 'rutinas') return errorRutina(d, id);
    if (col === 'cargos') {
      const descuento = d.descuento ?? 0;
      if (!entero(d.folio, 1) || !FECHA_OK.test(d.fecha) || !entero(d.precioLista) || !entero(descuento) || descuento > d.precioLista || d.total !== d.precioLista - descuento) return 'El cargo tiene folio, fecha o importes no válidos.';
      if (typeof d.clienteId !== 'string' || !(await almacen.obtener('clientes', d.clienteId))) return 'El cliente del cargo no existe.';
    }
    if (col === 'pagos') {
      if (!entero(d.folio, 1) || !FECHA_OK.test(d.fecha) || !entero(d.monto, 1)) return 'El pago tiene folio, fecha o monto no válidos.';
      const cargo = typeof d.cargoId === 'string' && await almacen.obtener('cargos', d.cargoId);
      if (!cargo || cargo.cancelado) return 'El cargo de este pago no existe o está cancelado.';
      if (d.monto > cargo.total - await pagadoDe(cargo.id)) return 'El pago no puede ser mayor al saldo del cargo.';
    }
    return '';
  }

  app.put('/api/doc/:col/:id', autenticar, revisar, async (req, res) => {
    const { col, id } = req.params;
    const previo = await almacen.obtener(col, id);
    if (CONTABLES.includes(col)) {
      if (previo) return res.status(403).json({ error: 'Los cargos y pagos registrados no se modifican: cancélalo y regístralo de nuevo.' });
      CANCELACION.forEach((k) => delete req.body[k]); req.body.cancelado = false;
    }
    const error = await errorDeAlta(col, req.body, id);
    if (error) return res.status(400).json({ error });
    // La autoría la fija el servidor: no se puede falsear ni cambiar después.
    const datos = { ...req.body, creadoPor: previo ? previo.creadoPor || '' : req.usuario.id, creado: previo ? previo.creado || '' : new Date().toISOString() };
    await almacen.reemplazar(col, id, datos);
    avisar(col, id, datos); res.json({ ok: true });
  });
  app.patch('/api/doc/:col/:id', autenticar, revisar, async (req, res) => {
    const { col, id } = req.params;
    delete req.body.creadoPor; delete req.body.creado;
    if (col === 'membresias' && errorMembresia(req.body)) return res.status(400).json({ error: errorMembresia(req.body) });
    if (col === 'rutinas') return res.status(400).json({ error: 'La rutina se guarda completa.' });
    if (CONTABLES.includes(col)) {
      const motivo = typeof req.body.motivoCancelacion === 'string' ? req.body.motivoCancelacion.trim() : '';
      if (Object.keys(req.body).some((k) => !CANCELACION.includes(k)) || req.body.cancelado !== true || !motivo) return res.status(400).json({ error: 'Un cargo o pago solo se puede cancelar, y con motivo.' });
      const previo = await almacen.obtener(col, id);
      if (!previo) return res.status(404).json({ error: 'El registro no existe.' });
      if (previo.cancelado) return res.status(400).json({ error: 'Ya estaba cancelado.' });
      if (col === 'cargos' && await pagadoDe(id) > 0) return res.status(400).json({ error: 'Cancela primero los pagos de este cargo.' });
      req.body = { cancelado: true, motivoCancelacion: motivo };
    }
    if (req.body.cancelado === true) { req.body.canceladoPor = req.usuario.id; req.body.canceladoEl = new Date().toISOString(); }
    const doc = await almacen.fusionar(col, id, req.body, { crear: col === 'asistenciasDia' });
    if (!doc) return res.status(404).json({ error: 'El registro no existe.' });
    const { id: _x, ...datos } = doc;
    avisar(col, id, datos); res.json({ ok: true });
  });
  app.post('/api/folio/:tipo', autenticar, async (req, res) => {
    if (!['cargo', 'pago'].includes(req.params.tipo)) return res.status(400).json({ error: 'Tipo de folio no válido.' });
    const doc = await almacen.incrementar('config', 'folios', req.params.tipo, 1, { crear: true });
    res.json({ n: doc[req.params.tipo] });
  });
  app.post('/api/sesion/:id', autenticar, async (req, res) => {
    if (!ID_OK.test(req.params.id)) return res.status(400).json({ error: 'Ruta no válida.' });
    const doc = await almacen.incrementar('membresias', req.params.id, 'sesionesUsadas', 1, { menorQue: 'sesionesTotales' });
    if (!doc) return (await almacen.obtener('membresias', req.params.id)) ? res.status(400).json({ error: 'Esta membresía ya no tiene sesiones disponibles.' }) : res.status(404).json({ error: 'La membresía no existe.' });
    const { id, ...datos } = doc;
    avisar('membresias', id, datos); res.json({ ok: true });
  });

  // ---- Pantalla de socios: las rutinas de hoy, sin sesión. Solo hoy y solo título y texto. ----
  app.get('/api/publico/rutinas', async (req, res) => {
    const fecha = hoy(), rutinas = [];
    for (const [tipo, nombre] of R.TIPOS_RUTINA) {
      const r = await almacen.obtener('rutinas', R.idRutina(fecha, tipo)) || {};
      rutinas.push({ tipo, nombre, titulo: r.titulo || '', texto: r.texto || '' });
    }
    res.set('Cache-Control', 'no-store').json({ fecha, frase: fraseDe(fecha), rutinas });
  });

  // ---- Usuarios ----
  const claveValida = (p) => typeof p === 'string' && p.length >= 8;
  app.post('/api/password', autenticar, async (req, res) => {
    if (!coincide(String(req.body.actual || ''), req.usuario.clave)) return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
    if (!claveValida(req.body.nueva)) return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
    await almacen.fusionar('usuarios', req.usuario.id, { clave: cifrar(req.body.nueva) });
    // Cierra las demás sesiones del usuario; la de esta petición sigue.
    await almacen.eliminarDonde('sesiones', { usuarioId: req.usuario.id });
    await almacen.reemplazar('sesiones', req.sesion.id, { usuarioId: req.usuario.id, expira: new Date(req.sesion.expira) });
    res.json({ ok: true });
  });
  app.get('/api/usuarios', autenticar, soloAdmin, async (req, res) => res.json((await almacen.listar('usuarios')).map(publico)));
  app.post('/api/usuarios', autenticar, soloAdmin, async (req, res) => {
    const usuario = String(req.body.usuario || '').trim().toLowerCase(), nombre = String(req.body.nombre || '').trim();
    const rol = req.body.rol === 'admin' ? 'admin' : 'personal';
    if (!/^[a-z0-9._-]{3,40}$/.test(usuario) || !nombre) return res.status(400).json({ error: 'Escribe nombre y un usuario de 3 a 40 letras, números, punto o guion.' });
    if (!claveValida(req.body.password)) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    if (await almacen.buscarUno('usuarios', { usuario })) return res.status(400).json({ error: 'Ese usuario ya existe.' });
    const id = 'u_' + crypto.randomBytes(8).toString('hex');
    await almacen.reemplazar('usuarios', id, { usuario, nombre, rol, activo: true, clave: cifrar(req.body.password), creado: new Date().toISOString() });
    res.json({ id });
  });
  app.patch('/api/usuarios/:id', autenticar, soloAdmin, async (req, res) => {
    const u = await almacen.obtener('usuarios', req.params.id);
    if (!u) return res.status(404).json({ error: 'El usuario no existe.' });
    const p = {};
    if (typeof req.body.nombre === 'string' && req.body.nombre.trim()) p.nombre = req.body.nombre.trim();
    if (['admin', 'personal'].includes(req.body.rol)) p.rol = req.body.rol;
    if (typeof req.body.activo === 'boolean') p.activo = req.body.activo;
    if (req.body.password != null) { if (!claveValida(req.body.password)) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' }); p.clave = cifrar(req.body.password); }
    if (u.id === req.usuario.id && (p.activo === false || p.rol === 'personal')) return res.status(400).json({ error: 'No puedes desactivarte ni quitarte el rol de administrador.' });
    await almacen.fusionar('usuarios', u.id, p);
    if ((p.clave || p.activo === false) && u.id !== req.usuario.id) await almacen.eliminarDonde('sesiones', { usuarioId: u.id });
    res.json({ ok: true });
  });

  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'No existe.' }));
  app.use((err, req, res, _next) => { console.error(err); res.status(err.status === 400 || err.type === 'entity.too.large' ? 400 : 500).json({ error: 'Error del servidor.' }); });
  return app;
}

// Primer arranque: crea el administrador y carga los catálogos de ejemplo.
async function preparar(almacen, { adminUsuario, adminPassword }) {
  if (!(await almacen.contar('usuarios'))) {
    if (!adminUsuario || !adminPassword || adminPassword.length < 8) throw new Error('Primer arranque: define ADMIN_USUARIO y ADMIN_PASSWORD (mínimo 8 caracteres) para crear al administrador.');
    await almacen.reemplazar('usuarios', 'u_' + crypto.randomBytes(8).toString('hex'), { usuario: adminUsuario.trim().toLowerCase(), nombre: 'Administrador', rol: 'admin', activo: true, clave: cifrar(adminPassword), creado: new Date().toISOString() });
    console.log(`Administrador "${adminUsuario}" creado.`);
  }
  if (!(await almacen.contar('areas'))) {
    const semilla = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalogos-iniciales.json'), 'utf8'));
    for (const d of semilla) await almacen.reemplazar(d.collection, d.doc_id, d.data);
    console.log(`Catálogos de ejemplo cargados (${semilla.length} registros).`);
  }
}

async function main() {
  // "npm run demo": mismo arranque en Windows, macOS y Linux, sin depender de la sintaxis de la terminal.
  const e = process.argv.includes('--demo') ? { ...process.env, ALMACEN: 'memoria', ADMIN_USUARIO: 'admin', ADMIN_PASSWORD: 'cambiame123' } : process.env;
  const almacen = e.ALMACEN === 'memoria'
    ? await require('./almacen-memoria.js').crear()
    : await require('./almacen-mongo.js').crear({ uri: e.MONGODB_URI || 'mongodb://127.0.0.1:27017', nombreBd: e.MONGODB_DB || 'cutter_academy' });
  if (e.ALMACEN === 'memoria') console.log('MODO DEMOSTRACIÓN: los datos se pierden al apagar el servidor.');
  await preparar(almacen, { adminUsuario: e.ADMIN_USUARIO, adminPassword: e.ADMIN_PASSWORD });
  const app = await crearApp(almacen, { cookieSegura: e.COOKIE_SEGURA === '1' });
  if (e.PROXY === '1') app.set('trust proxy', 1);
  const puerto = Number(e.PUERTO || e.PORT) || 3000; // PORT: el que asignan Render, Railway y similares
  app.listen(puerto, () => console.log(`Portal Cutter Academy en http://localhost:${puerto}`));
}

if (require.main === module) main().catch((err) => { console.error(err.message); process.exit(1); });
module.exports = { crearApp, preparar, datosValidos, cifrar, coincide, hoy, fraseDe };
