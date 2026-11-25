// Pruebas de la API con el almacén en memoria (misma interfaz que el de MongoDB).
const test = require('node:test');
const assert = require('node:assert/strict');
const { crearApp, preparar, datosValidos } = require('../servidor.js');
const { aplanar } = require('../almacen-mongo.js');

let base, server, admin, personal;
const pedir = async (metodo, ruta, cuerpo, cookie) => {
  const r = await fetch(base + ruta, { method: metodo, headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
};
test.before(async () => {
  const almacen = await require('../almacen-memoria.js').crear();
  await preparar(almacen, { adminUsuario: 'Admin', adminPassword: 'secreto123' });
  const app = await crearApp(almacen);
  await new Promise((ok) => { server = app.listen(0, ok); });
  base = `http://127.0.0.1:${server.address().port}`;
  admin = (await pedir('POST', '/api/login', { usuario: 'admin', password: 'secreto123' })).cookie;
  await pedir('POST', '/api/usuarios', { nombre: 'Caja', usuario: 'caja', password: 'cajacaja1', rol: 'personal' }, admin);
  personal = (await pedir('POST', '/api/login', { usuario: 'caja', password: 'cajacaja1' })).cookie;
});
test.after(() => { server.closeAllConnections(); server.close(); });

test('acceso: sin sesión 401, contraseña mala 401, primer arranque exige administrador', async () => {
  assert.equal((await pedir('GET', '/api/datos')).status, 401);
  assert.equal((await pedir('POST', '/api/login', { usuario: 'admin', password: 'mala' })).status, 401);
  assert.equal((await pedir('POST', '/api/login', { usuario: { $ne: '' }, password: 'x' })).status, 401);
  const vacio = await require('../almacen-memoria.js').crear();
  await assert.rejects(preparar(vacio, {}));
  assert.ok(admin.startsWith('sid=') && personal.startsWith('sid='));
});
test('catálogos iniciales cargados y sin filtrar contraseñas', async () => {
  const d = (await pedir('GET', '/api/datos', null, personal)).json.cols;
  assert.equal(d.conceptos.length, 11);
  assert.equal(d.usuarios, undefined);
  const us = (await pedir('GET', '/api/usuarios', null, admin)).json;
  assert.equal(us.length, 2);
  assert.ok(us.every((u) => !('clave' in u)));
  assert.equal((await pedir('GET', '/api/usuarios', null, personal)).status, 403);
});
test('permisos: personal opera pero no cambia catálogos ni folios', async () => {
  assert.equal((await pedir('PUT', '/api/doc/precios/x1', { conceptoId: 'a', precio: 1 }, personal)).status, 403);
  assert.equal((await pedir('PUT', '/api/doc/precios/x1', { conceptoId: 'a', precio: 1 }, admin)).status, 200);
  assert.equal((await pedir('PUT', '/api/doc/config/folios', { cargo: 0 }, admin)).status, 403);
  assert.equal((await pedir('PUT', '/api/doc/usuarios/x', { rol: 'admin' }, admin)).status, 400);
  assert.equal((await pedir('PUT', '/api/doc/clientes/c1', { nombre: 'Ana', creadoPor: 'falso' }, personal)).status, 200);
  const c = (await pedir('GET', '/api/datos', null, admin)).json.cols.clientes.find((x) => x.id === 'c1');
  assert.ok(c.creadoPor.startsWith('u_') && c.creadoPor !== 'falso');
});
test('validación: rechaza operadores y rutas de Mongo', async () => {
  assert.equal(datosValidos({ a: { $gt: 1 } }), false);
  assert.equal(datosValidos({ 'a.b': 1 }), false);
  assert.equal(datosValidos({ a: [{ b: 'ok' }], c: null }), true);
  assert.equal((await pedir('PATCH', '/api/doc/clientes/c1', { $set: { rol: 'x' } }, personal)).status, 400);
  assert.equal((await pedir('PUT', '/api/doc/clientes/..%2Fx', { a: 1 }, personal)).status, 400);
});
test('actualización parcial: mezcla anidada, crea el día de asistencia, 404 si no existe', async () => {
  assert.deepEqual(aplanar({ a: 1, e: { x: { h: '08:00', ok: true } }, l: [1, 2] }), { a: 1, 'e.x.h': '08:00', 'e.x.ok': true, l: [1, 2] });
  assert.equal((await pedir('PATCH', '/api/doc/clientes/nadie', { a: 1 }, personal)).status, 404);
  await pedir('PATCH', '/api/doc/asistenciasDia/2026-11-10', { fecha: '2026-11-10', entradas: { e1: { clienteId: 'c1' } } }, personal);
  await pedir('PATCH', '/api/doc/asistenciasDia/2026-11-10', { fecha: '2026-11-10', entradas: { e2: { clienteId: 'c2' } } }, personal);
  const dia = (await pedir('GET', '/api/datos', null, personal)).json.cols.asistenciasDia[0];
  assert.deepEqual(Object.keys(dia.entradas).sort(), ['e1', 'e2']);
  await pedir('PUT', '/api/doc/cargos/k1', { folio: 1, clienteId: 'c1', fecha: '2026-11-10', precioLista: 100, descuento: 0, total: 100 }, personal);
  await pedir('PUT', '/api/doc/pagos/p1', { folio: 1, cargoId: 'k1', clienteId: 'c1', fecha: '2026-11-10', monto: 100, cancelado: false }, personal);
  await pedir('PATCH', '/api/doc/pagos/p1', { cancelado: true, motivoCancelacion: 'error', canceladoPor: 'falso' }, personal);
  const p = (await pedir('GET', '/api/datos', null, personal)).json.cols.pagos[0];
  assert.equal(p.monto, 100); assert.equal(p.cancelado, true); assert.ok(p.canceladoPor.startsWith('u_'));
});
test('pedidos especiales: el personal los levanta y agrega renglones sin pisar los de otro equipo', async () => {
  assert.equal((await pedir('PUT', '/api/doc/pedidos/pd1', { nombre: 'Sudaderas invierno', fecha: '2026-11-10', estado: 'abierto', lineas: {} }, personal)).status, 200);
  await pedir('PATCH', '/api/doc/pedidos/pd1', { lineas: { l1: { articulo: 'Sudadera', talla: 'M', cantidad: 2, precio: 45000 } } }, personal);
  await pedir('PATCH', '/api/doc/pedidos/pd1', { lineas: { l2: { articulo: 'Chamarra', talla: 'G', cantidad: 1, precio: 90000 } } }, personal);
  const pd = (await pedir('GET', '/api/datos', null, personal)).json.cols.pedidos.find((x) => x.id === 'pd1');
  assert.deepEqual(Object.keys(pd.lineas).sort(), ['l1', 'l2']);
  assert.ok(pd.creadoPor.startsWith('u_'));
});
test('folios: consecutivos únicos aunque lleguen 25 a la vez; sesiones se descuentan de una en una', async () => {
  const ns = (await Promise.all(Array.from({ length: 25 }, () => pedir('POST', '/api/folio/cargo', null, personal)))).map((r) => r.json.n).sort((a, b) => a - b);
  assert.deepEqual(ns, Array.from({ length: 25 }, (_, i) => i + 1));
  assert.equal((await pedir('POST', '/api/folio/otro', null, personal)).status, 400);
  await pedir('PUT', '/api/doc/membresias/m1', { sesionesTotales: 10, sesionesUsadas: 0 }, personal);
  await Promise.all(Array.from({ length: 5 }, () => pedir('POST', '/api/sesion/m1', null, personal)));
  assert.equal((await pedir('GET', '/api/datos', null, personal)).json.cols.membresias[0].sesionesUsadas, 5);
  assert.equal((await pedir('POST', '/api/sesion/nadie', null, personal)).status, 404);
});
test('cargos y pagos: el servidor valida importes, cliente y saldo', async () => {
  await pedir('PUT', '/api/doc/clientes/c5', { nombre: 'Luis' }, personal);
  const cargo = { folio: 90, clienteId: 'c5', conceptoId: 'x', fecha: '2026-11-10', precioLista: 50000, descuento: 0, total: 50000 };
  assert.equal((await pedir('PUT', '/api/doc/cargos/k5', { ...cargo, total: 'mil' }, personal)).status, 400);
  assert.equal((await pedir('PUT', '/api/doc/cargos/k5', { ...cargo, total: 1 }, personal)).status, 400);
  assert.equal((await pedir('PUT', '/api/doc/cargos/k5', { ...cargo, fecha: 5 }, personal)).status, 400);
  assert.equal((await pedir('PUT', '/api/doc/cargos/k5', { ...cargo, clienteId: 'nadie' }, personal)).status, 400);
  assert.equal((await pedir('PUT', '/api/doc/cargos/k5', { ...cargo, cantidad: 0 }, personal)).status, 400);
  assert.equal((await pedir('PUT', '/api/doc/cargos/k5', { ...cargo, cantidad: 3, precioUnitario: 20000 }, personal)).status, 400);
  assert.equal((await pedir('PUT', '/api/doc/cargos/k6', { ...cargo, folio: 91, cantidad: 2, precioUnitario: 25000 }, personal)).status, 200);
  assert.equal((await pedir('PUT', '/api/doc/cargos/k5', cargo, personal)).status, 200);
  const pago = { folio: 90, cargoId: 'k5', clienteId: 'c5', fecha: '2026-11-10', monto: 20000, formaPagoId: 'efectivo' };
  assert.equal((await pedir('PUT', '/api/doc/pagos/p5', { ...pago, monto: 'mil' }, personal)).status, 400);
  assert.equal((await pedir('PUT', '/api/doc/pagos/p5', { ...pago, monto: -5 }, personal)).status, 400);
  assert.equal((await pedir('PUT', '/api/doc/pagos/p5', { ...pago, monto: 50001 }, personal)).status, 400);
  assert.equal((await pedir('PUT', '/api/doc/pagos/p5', { ...pago, cargoId: 'nadie' }, personal)).status, 400);
  assert.equal((await pedir('PUT', '/api/doc/pagos/p5', { ...pago, cancelado: true, canceladoPor: 'u_otro' }, personal)).status, 200);
  const p5 = (await pedir('GET', '/api/datos', null, admin)).json.cols.pagos.find((x) => x.id === 'p5');
  assert.equal(p5.cancelado, false); assert.equal(p5.canceladoPor, undefined);
  assert.equal((await pedir('PUT', '/api/doc/pagos/p6', { ...pago, monto: 30001 }, personal)).status, 400);
  assert.equal((await pedir('PUT', '/api/doc/pagos/p6', { ...pago, monto: 30000 }, personal)).status, 200);
});
test('cargos y pagos: no se reescriben ni se reactivan, solo se cancelan con motivo', async () => {
  const pago = { folio: 90, cargoId: 'k5', clienteId: 'c5', fecha: '2026-11-10', monto: 1 };
  assert.equal((await pedir('PUT', '/api/doc/pagos/p5', pago, personal)).status, 403);
  assert.equal((await pedir('PUT', '/api/doc/pagos/p5', pago, admin)).status, 403);
  assert.equal((await pedir('PATCH', '/api/doc/pagos/p5', { monto: 1 }, personal)).status, 400);
  assert.equal((await pedir('PATCH', '/api/doc/pagos/p5', { cancelado: true }, personal)).status, 400);
  assert.equal((await pedir('PATCH', '/api/doc/cargos/k5', { cancelado: true, motivoCancelacion: 'error' }, personal)).status, 400);
  assert.equal((await pedir('PATCH', '/api/doc/pagos/p5', { cancelado: true, motivoCancelacion: 'error' }, personal)).status, 200);
  assert.equal((await pedir('PATCH', '/api/doc/pagos/p5', { cancelado: false }, personal)).status, 400);
  assert.equal((await pedir('PATCH', '/api/doc/pagos/p5', { cancelado: true, motivoCancelacion: 'otra vez' }, personal)).status, 400);
  const p5 = (await pedir('GET', '/api/datos', null, admin)).json.cols.pagos.find((x) => x.id === 'p5');
  assert.equal(p5.monto, 20000); assert.equal(p5.cancelado, true); assert.equal(p5.motivoCancelacion, 'error');
});
test('membresías: sesiones enteras y nunca más usadas que el total', async () => {
  assert.equal((await pedir('PUT', '/api/doc/membresias/m2', { sesionesTotales: 'dos', sesionesUsadas: 0 }, personal)).status, 400);
  assert.equal((await pedir('PUT', '/api/doc/membresias/m2', { sesionesTotales: 2, sesionesUsadas: 0 }, personal)).status, 200);
  assert.equal((await pedir('PATCH', '/api/doc/membresias/m2', { sesionesUsadas: -1 }, personal)).status, 400);
  const usos = (await Promise.all(Array.from({ length: 5 }, () => pedir('POST', '/api/sesion/m2', null, personal)))).map((r) => r.status).sort();
  assert.deepEqual(usos, [200, 200, 400, 400, 400]);
  assert.equal((await pedir('GET', '/api/datos', null, personal)).json.cols.membresias.find((x) => x.id === 'm2').sesionesUsadas, 2);
});
test('validación: una llave __proto__ no contamina el prototipo', async () => {
  const malo = JSON.parse('{"__proto__":{"contaminado":"si"}}');
  assert.equal(datosValidos(malo), false);
  assert.equal((await pedir('PATCH', '/api/doc/clientes/c1', malo, personal)).status, 400);
  assert.equal(({}).contaminado, undefined);
  delete Object.prototype.contaminado;
});
test('contraseña nueva cierra las otras sesiones del usuario', async () => {
  const { id } = (await pedir('POST', '/api/usuarios', { nombre: 'Ana', usuario: 'ana', password: 'anaanaana1', rol: 'personal' }, admin)).json;
  const esta = (await pedir('POST', '/api/login', { usuario: 'ana', password: 'anaanaana1' })).cookie;
  const otra = (await pedir('POST', '/api/login', { usuario: 'ana', password: 'anaanaana1' })).cookie;
  assert.equal((await pedir('POST', '/api/password', { actual: 'anaanaana1', nueva: 'anaanaana2' }, esta)).status, 200);
  assert.equal((await pedir('GET', '/api/yo', null, otra)).status, 401);
  assert.equal((await pedir('GET', '/api/yo', null, esta)).status, 200);
  assert.equal((await pedir('PATCH', `/api/usuarios/${id}`, { password: 'anaanaana3' }, admin)).status, 200);
  assert.equal((await pedir('GET', '/api/yo', null, esta)).status, 401);
});
test('usuarios: no se auto-degrada, desactivado no entra, cambio de contraseña', async () => {
  const us = (await pedir('GET', '/api/usuarios', null, admin)).json;
  const yo = us.find((u) => u.usuario === 'admin'), caja = us.find((u) => u.usuario === 'caja');
  assert.equal((await pedir('PATCH', `/api/usuarios/${yo.id}`, { rol: 'personal' }, admin)).status, 400);
  assert.equal((await pedir('POST', '/api/password', { actual: 'mala', nueva: 'nuevaclave1' }, personal)).status, 400);
  assert.equal((await pedir('POST', '/api/password', { actual: 'cajacaja1', nueva: 'corta' }, personal)).status, 400);
  assert.equal((await pedir('POST', '/api/password', { actual: 'cajacaja1', nueva: 'nuevaclave1' }, personal)).status, 200);
  assert.equal((await pedir('POST', '/api/login', { usuario: 'caja', password: 'nuevaclave1' })).status, 200);
  await pedir('PATCH', `/api/usuarios/${caja.id}`, { activo: false }, admin);
  assert.equal((await pedir('GET', '/api/datos', null, personal)).status, 401);
  assert.equal((await pedir('POST', '/api/login', { usuario: 'caja', password: 'nuevaclave1' })).status, 401);
  await pedir('PATCH', `/api/usuarios/${caja.id}`, { activo: true }, admin);
  const salir = await pedir('POST', '/api/logout', null, personal);
  assert.equal(salir.status, 200);
  assert.equal((await pedir('GET', '/api/yo', null, personal)).status, 401);
});
test('tiempo real: un cambio llega a otro navegador conectado', async () => {
  const r = await fetch(base + '/api/eventos', { headers: { cookie: admin } });
  const lector = r.body.getReader();
  await lector.read();
  await pedir('PUT', '/api/doc/clientes/c9', { nombre: 'Nuevo' }, admin);
  let texto = '';
  while (!texto.includes('"c9"')) texto += new TextDecoder().decode((await lector.read()).value);
  assert.match(texto, /"col":"clientes","id":"c9"/);
  await lector.cancel();
});
test('límite de intentos: los fallos de un usuario no bloquean a los demás de la misma dirección', async () => {
  const cods = [];
  for (let i = 0; i < 11; i++) cods.push((await pedir('POST', '/api/login', { usuario: 'intruso', password: 'mala' })).status);
  assert.deepEqual(cods, [...Array(10).fill(401), 429]);
  assert.equal((await pedir('POST', '/api/login', { usuario: 'admin', password: 'secreto123' })).status, 200);
});
test('un fallo de la base responde 500 y el servidor sigue atendiendo', async () => {
  const almacen = await require('../almacen-memoria.js').crear();
  const app = await crearApp({ ...almacen, buscarUno: async () => { throw new Error('base caída'); } });
  const s = await new Promise((ok) => { const x = app.listen(0, () => ok(x)); });
  const url = `http://127.0.0.1:${s.address().port}`;
  const error = console.error; console.error = () => {};
  try {
    const r = await fetch(url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"usuario":"admin","password":"x"}', signal: AbortSignal.timeout(3000) });
    assert.equal(r.status, 500);
    assert.equal((await fetch(url + '/login.html')).status, 200);
  } finally { console.error = error; s.closeAllConnections(); s.close(); }
});
test('rutinas: una por fecha y tipo, el personal las captura y los socios solo ven las de hoy', async () => {
  const { hoy } = require('../servidor.js');
  await pedir('POST', '/api/usuarios', { nombre: 'Coach', usuario: 'coach', password: 'coachcoach1', rol: 'personal' }, admin);
  const coach = (await pedir('POST', '/api/login', { usuario: 'coach', password: 'coachcoach1' })).cookie;
  const h = hoy(), r = { fecha: h, tipo: 'cross', titulo: 'WOD', texto: '21-15-9\nThrusters' };
  assert.equal((await pedir('PUT', `/api/doc/rutinas/${h}_cross`, r, coach)).status, 200);
  assert.equal((await pedir('PUT', `/api/doc/rutinas/${h}_gym-hombres`, r, coach)).status, 400); // el id no corresponde al tipo
  assert.equal((await pedir('PUT', `/api/doc/rutinas/${h}_yoga`, { ...r, tipo: 'yoga' }, coach)).status, 400);
  assert.equal((await pedir('PUT', `/api/doc/rutinas/${h}_cross`, { ...r, texto: 'x'.repeat(4001) }, coach)).status, 400);
  assert.equal((await pedir('PATCH', `/api/doc/rutinas/${h}_cross`, { texto: 'otro' }, coach)).status, 400);
  await pedir('PUT', '/api/doc/rutinas/2020-01-01_cross', { ...r, fecha: '2020-01-01', texto: 'vieja' }, coach);
  const pub = await pedir('GET', '/api/publico/rutinas'); // sin sesión
  assert.equal(pub.status, 200);
  assert.equal(pub.json.fecha, h);
  const { fraseDe } = require('../servidor.js'), frases = require('../frases-del-dia.json');
  assert.equal(pub.json.frase, fraseDe(h));
  assert.ok(frases.includes(pub.json.frase) && new Set(frases).size === frases.length);
  assert.notEqual(fraseDe('2026-11-13'), fraseDe('2026-11-14')); // cambia cada día
  assert.ok(frases.includes(fraseDe('2020-02-29'))); // fechas anteriores al inicio de la lista
  assert.deepEqual(pub.json.rutinas.map((x) => x.tipo), ['gym-hombres', 'gym-mujeres', 'cross', 'drills-pitchers']);
  assert.deepEqual(pub.json.rutinas[2], { tipo: 'cross', nombre: 'Cross', titulo: 'WOD', texto: '21-15-9\nThrusters' });
  assert.equal(pub.json.rutinas[0].texto, '');
  assert.equal((await pedir('GET', '/api/datos', null, coach)).json.cols.rutinas.length, 2);
});
