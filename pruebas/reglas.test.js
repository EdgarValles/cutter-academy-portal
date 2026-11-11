const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/rules.js');

const precios = [
  { conceptoId: 'mens', tipoClienteId: 'general', precio: 60000, desde: '2026-01-01' },
  { conceptoId: 'mens', tipoClienteId: 'general', precio: 70000, desde: '2026-11-01' },
  { conceptoId: 'mens', tipoClienteId: 'general', precio: 90000, desde: '2027-01-01' },
  { conceptoId: 'mens', tipoClienteId: 'equipo', precio: 0, desde: '2026-01-01' },
  { conceptoId: 'insc', tipoClienteId: 'general', precio: 30000, desde: '2026-01-01' },
];

test('precio: toma la fecha vigente más reciente y no la futura', () => {
  assert.deepEqual(R.precioDe(precios, 'mens', 'general', '2026-11-10'), { precio: 70000, respaldo: false });
  assert.deepEqual(R.precioDe(precios, 'mens', 'general', '2026-10-31'), { precio: 60000, respaldo: false });
});
test('precio: $0 de patrocinado es válido', () => {
  assert.deepEqual(R.precioDe(precios, 'mens', 'equipo', '2026-11-10'), { precio: 0, respaldo: false });
});
test('precio: desempata por creación más reciente si coinciden en fecha desde', () => {
  const lista = [
    { id: 'p1', conceptoId: 'mens', tipoClienteId: 'equipo', precio: 0, desde: '2026-11-01', creado: '2026-11-01T10:00:00.000Z' },
    { id: 'p2', conceptoId: 'mens', tipoClienteId: 'equipo', precio: 50000, desde: '2026-11-10', creado: '2026-11-10T12:00:00.000Z' },
    { id: 'p3', conceptoId: 'mens', tipoClienteId: 'equipo', precio: 25000, desde: '2026-11-10', creado: '2026-11-10T15:00:00.000Z' },
  ];
  assert.deepEqual(R.precioDe(lista, 'mens', 'equipo', '2026-11-10'), { precio: 25000, respaldo: false });
});
test('precio: respaldo a lista general y null si no existe', () => {
  assert.deepEqual(R.precioDe(precios, 'insc', 'equipo', '2026-11-10'), { precio: 30000, respaldo: true });
  assert.equal(R.precioDe(precios, 'otro', 'general', '2026-11-10'), null);
});

test('vigencia y renovación', () => {
  assert.equal(R.finVigencia('2026-11-10', 30), '2026-12-10');
  assert.equal(R.finVigencia('2026-11-10', 0), '2026-11-10');
  assert.equal(R.addDias('2026-12-31', 1), '2027-01-01');
  const ms = [{ clienteId: 'c1', conceptoId: 'mens', inicio: '2026-10-20', fin: '2026-11-19' }];
  assert.equal(R.inicioRenovacion(ms, 'c1', 'mens', '2026-11-10'), '2026-11-20');
  assert.equal(R.inicioRenovacion(ms, 'c1', 'mens', '2026-12-01'), '2026-12-01');
  assert.equal(R.inicioRenovacion(ms, 'c2', 'mens', '2026-11-10'), '2026-11-10');
});

test('estados de membresía', () => {
  const m = { inicio: '2026-11-01', fin: '2026-12-01' };
  assert.equal(R.estadoMembresia(m, '2026-11-10', 7), 'activa');
  assert.equal(R.estadoMembresia(m, '2026-11-24', 7), 'por_vencer');
  assert.equal(R.estadoMembresia(m, '2026-12-01', 7), 'por_vencer');
  assert.equal(R.estadoMembresia(m, '2026-12-02', 7), 'vencida');
  assert.equal(R.estadoMembresia(m, '2026-10-30', 7), 'programada');
  assert.equal(R.estadoMembresia({ ...m, estadoManual: 'suspendida' }, '2026-11-10', 7), 'suspendida');
  assert.equal(R.estadoMembresia({ ...m, estadoManual: 'cancelada' }, '2026-12-30', 7), 'cancelada');
  assert.equal(R.estadoMembresia({ ...m, sesionesTotales: 10, sesionesUsadas: 10 }, '2026-11-10', 7), 'agotada');
  // una visita de un día no se marca "por vencer"
  assert.equal(R.estadoMembresia({ inicio: '2026-11-10', fin: '2026-11-10', sesionesTotales: 1, sesionesUsadas: 0 }, '2026-11-10', 7), 'activa');
});

test('cargos: total, saldo y estado con pagos parciales y cancelados', () => {
  assert.equal(R.totalCargo(70000, 10000), 60000);
  assert.throws(() => R.totalCargo(70000, 80000));
  assert.throws(() => R.totalCargo(70000, -1));
  const cargo = { id: 'k1', total: 60000 };
  const pagos = [
    { cargoId: 'k1', monto: 20000 },
    { cargoId: 'k1', monto: 40000, cancelado: true },
    { cargoId: 'k2', monto: 99999 },
  ];
  assert.equal(R.saldoCargo(cargo, pagos), 40000);
  assert.equal(R.estadoCargo(cargo, pagos), 'parcial');
  assert.equal(R.estadoCargo(cargo, []), 'pendiente');
  assert.equal(R.estadoCargo(cargo, [{ cargoId: 'k1', monto: 60000 }]), 'pagado');
  assert.equal(R.estadoCargo({ id: 'k0', total: 0 }, []), 'pagado');
  assert.equal(R.saldoCargo({ ...cargo, cancelado: true }, []), 0);
  assert.equal(R.estadoCargo({ ...cargo, cancelado: true }, pagos), 'cancelado');
});

test('patrocinio', () => {
  assert.equal(R.montoPatrocinado({ patrocinado: true, precioGeneral: 70000, precioLista: 0 }), 70000);
  assert.equal(R.montoPatrocinado({ patrocinado: false, precioGeneral: 70000, precioLista: 50000 }), 0);
  assert.equal(R.montoPatrocinado({ patrocinado: true, precioGeneral: 70000, precioLista: 0, cancelado: true }), 0);
  const cs = [
    { fecha: '2026-11-05', patrocinado: true, precioGeneral: 70000, precioLista: 0 },
    { fecha: '2026-10-05', patrocinado: true, precioGeneral: 70000, precioLista: 0 },
  ];
  assert.equal(R.patrocinioPeriodo(cs, '2026-11-01', '2026-11-30'), 70000);
});

test('adeudos por cliente con antigüedad', () => {
  const cargos = [
    { id: 'a', clienteId: 'c1', total: 50000, fecha: '2026-11-01' },
    { id: 'b', clienteId: 'c1', total: 20000, fecha: '2026-11-08' },
    { id: 'c', clienteId: 'c2', total: 10000, fecha: '2026-11-09' },
    { id: 'd', clienteId: 'c3', total: 10000, fecha: '2026-11-09', cancelado: true },
  ];
  const pagos = [{ cargoId: 'a', monto: 10000 }, { cargoId: 'c', monto: 10000 }];
  const r = R.adeudos(cargos, pagos, '2026-11-10');
  assert.equal(r.length, 1);
  assert.equal(r[0].clienteId, 'c1');
  assert.equal(r[0].saldo, 60000);
  assert.equal(r[0].antiguedad, 9);
});

test('entrada: valida área, prefiere mensualidad y detecta adeudo', () => {
  const conceptos = [
    { id: 'mensPesas', areaIds: ['pesas'] },
    { id: 'paqBateo', areaIds: ['beisbol'] },
    { id: 'total', areaIds: ['pesas', 'crossfit', 'beisbol'] },
  ];
  const base = { conceptos, hoy: '2026-11-10', diasAviso: 7, tieneAdeudoVencido: false };
  const ms = [
    { id: 'm1', clienteId: 'c1', conceptoId: 'mensPesas', inicio: '2026-11-01', fin: '2026-12-01' },
    { id: 'm2', clienteId: 'c1', conceptoId: 'paqBateo', inicio: '2026-11-01', fin: '2026-12-31', sesionesTotales: 10, sesionesUsadas: 9 },
    { id: 'm3', clienteId: 'c2', conceptoId: 'paqBateo', inicio: '2026-11-01', fin: '2026-12-31', sesionesTotales: 10, sesionesUsadas: 10 },
    { id: 'm4', clienteId: 'c3', conceptoId: 'paqBateo', inicio: '2026-11-01', fin: '2026-12-31', sesionesTotales: 10, sesionesUsadas: 0 },
    { id: 'm5', clienteId: 'c3', conceptoId: 'total', inicio: '2026-11-01', fin: '2026-12-01' },
  ];
  assert.equal(R.validarEntrada({ ...base, membresias: ms, clienteId: 'c1', areaId: 'pesas' }).membresia.id, 'm1');
  assert.equal(R.validarEntrada({ ...base, membresias: ms, clienteId: 'c1', areaId: 'beisbol' }).membresia.id, 'm2');
  assert.equal(R.validarEntrada({ ...base, membresias: ms, clienteId: 'c1', areaId: 'crossfit' }).ok, false);
  assert.equal(R.validarEntrada({ ...base, membresias: ms, clienteId: 'c2', areaId: 'beisbol' }).ok, false);
  assert.equal(R.validarEntrada({ ...base, membresias: ms, clienteId: 'c3', areaId: 'beisbol' }).membresia.id, 'm5');
  const deuda = R.validarEntrada({ ...base, tieneAdeudoVencido: true, membresias: ms, clienteId: 'c1', areaId: 'pesas' });
  assert.equal(deuda.ok, false);
  assert.equal(deuda.membresia.id, 'm1');
});

test('corte de caja', () => {
  const pagos = [
    { fecha: '2026-11-10', monto: 50000, formaPagoId: 'efectivo', creadoPor: 'u1' },
    { fecha: '2026-11-10', monto: 30000, formaPagoId: 'tarjeta', creadoPor: 'u2' },
    { fecha: '2026-11-10', monto: 20000, formaPagoId: 'efectivo', creadoPor: 'u1', cancelado: true },
    { fecha: '2026-11-09', monto: 99999, formaPagoId: 'efectivo', creadoPor: 'u1' },
  ];
  const c = R.corteCaja(pagos, '2026-11-10');
  assert.equal(c.total, 80000);
  assert.deepEqual(c.porForma, { efectivo: 50000, tarjeta: 30000 });
  assert.deepEqual(c.porUsuario, { u1: 50000, u2: 30000 });
  assert.equal(c.cancelados.length, 1);
});

test('ingresos por área y tipo', () => {
  const cargos = [{ id: 'k1', areaIds: ['pesas', 'crossfit'] }, { id: 'k2', areaIds: [] }, { id: 'k3', areaIds: ['beisbol'] }];
  const clientes = [{ id: 'c1', tipoClienteId: 'general' }, { id: 'c2', tipoClienteId: 'equipo' }];
  const pagos = [
    { cargoId: 'k1', clienteId: 'c1', monto: 100000, fecha: '2026-11-03' },
    { cargoId: 'k2', clienteId: 'c1', monto: 30000, fecha: '2026-11-03' },
    { cargoId: 'k3', clienteId: 'c2', monto: 20000, fecha: '2026-11-04' },
    { cargoId: 'k3', clienteId: 'c2', monto: 20000, fecha: '2026-11-04', cancelado: true },
    { cargoId: 'k3', clienteId: 'c2', monto: 20000, fecha: '2026-10-04' },
  ];
  const r = R.ingresos(pagos, cargos, clientes, '2026-11-01', '2026-11-30');
  assert.equal(r.total, 150000);
  assert.deepEqual(r.porArea, { pesas: 50000, crossfit: 50000, general: 30000, beisbol: 20000 });
  assert.deepEqual(r.porTipo, { general: 130000, equipo: 20000 });
});

test('traslapes de reservación y edad', () => {
  const rs = [
    { id: 'r1', fecha: '2026-11-10', inicio: '16:00', fin: '17:00', recursoId: 'jaula1', estado: 'activa' },
    { id: 'r2', fecha: '2026-11-10', inicio: '17:00', fin: '18:00', recursoId: 'jaula1', estado: 'activa' },
    { id: 'r3', fecha: '2026-11-10', inicio: '16:30', fin: '17:30', recursoId: 'jaula2', entrenadorId: 'e1', estado: 'activa' },
    { id: 'r4', fecha: '2026-11-10', inicio: '16:00', fin: '17:00', recursoId: 'jaula1', estado: 'cancelada' },
  ];
  const n = { id: 'n', fecha: '2026-11-10', inicio: '16:30', fin: '17:00', recursoId: 'jaula1', entrenadorId: 'e1' };
  assert.deepEqual(R.traslapes(rs, n).map((r) => r.id), ['r1', 'r3']);
  assert.equal(R.traslapes(rs, { ...n, inicio: '18:00', fin: '19:00', entrenadorId: '' }).length, 0);
  // Un equipo o grupo externo no puede quedar reservado dos veces a la misma hora, aunque sea en otro espacio.
  const eq = [{ id: 'q1', fecha: '2026-11-10', inicio: '16:00', fin: '18:00', recursoId: 'campo', grupo: 'Halcones', estado: 'activa' }];
  assert.deepEqual(R.traslapes(eq, { id: 'n', fecha: '2026-11-10', inicio: '17:00', fin: '19:00', recursoId: 'jaula1', grupo: 'Halcones' }).map((r) => r.id), ['q1']);
  assert.equal(R.traslapes(eq, { id: 'n', fecha: '2026-11-10', inicio: '17:00', fin: '19:00', recursoId: 'jaula1', grupo: 'Otros' }).length, 0);
  assert.equal(R.traslapes(eq, { id: 'n', fecha: '2026-11-10', inicio: '17:00', fin: '19:00', recursoId: 'jaula1' }).length, 0);
  assert.equal(R.edad('2010-11-11', '2026-11-10'), 15);
  assert.equal(R.edad('2010-11-10', '2026-11-10'), 16);
  assert.equal(R.edad('', '2026-11-10'), null);
});
