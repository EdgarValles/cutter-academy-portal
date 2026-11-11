// Reglas de negocio de Cutter Academy. Funciones puras: sin interfaz ni base de datos.
// Fechas como 'YYYY-MM-DD'; importes en centavos enteros.
const R = (function () {
  const GENERAL = 'general';
  const CREA_MEMBRESIA = ['mensualidad', 'paquete', 'visita'];

  function addDias(fecha, n) {
    const [y, m, d] = fecha.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return t.toISOString().slice(0, 10);
  }
  function diasEntre(a, b) {
    const p = (f) => { const [y, m, d] = f.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((p(b) - p(a)) / 86400000);
  }

  // Precio vigente para (concepto, tipo de cliente). Respaldo: lista general.
  function precioDe(precios, conceptoId, tipoId, hoy) {
    const pick = (tipo) => precios
      .filter((p) => p.conceptoId === conceptoId && p.tipoClienteId === tipo && p.desde <= hoy)
      .sort((a, b) => {
        if (a.desde !== b.desde) return a.desde < b.desde ? 1 : -1;
        const ca = a.creado || '', cb = b.creado || '';
        if (ca !== cb) return ca < cb ? 1 : -1;
        return (a.id || '') < (b.id || '') ? 1 : -1;
      })[0];
    const propio = pick(tipoId);
    if (propio) return { precio: propio.precio, respaldo: false };
    const gen = pick(GENERAL);
    if (gen) return { precio: gen.precio, respaldo: tipoId !== GENERAL };
    return null;
  }

  function finVigencia(inicio, vigenciaDias) { return addDias(inicio, vigenciaDias || 0); }

  // Inicio propuesto: día siguiente al fin de la membresía vigente del mismo concepto.
  function inicioRenovacion(membresias, clienteId, conceptoId, hoy) {
    const fines = membresias
      .filter((m) => m.clienteId === clienteId && m.conceptoId === conceptoId && m.estadoManual !== 'cancelada' && m.fin >= hoy)
      .map((m) => m.fin).sort();
    return fines.length ? addDias(fines[fines.length - 1], 1) : hoy;
  }

  function estadoMembresia(m, hoy, diasAviso) {
    if (m.estadoManual === 'cancelada') return 'cancelada';
    if (m.estadoManual === 'suspendida') return 'suspendida';
    if (hoy > m.fin) return 'vencida';
    if (m.sesionesTotales > 0 && (m.sesionesUsadas || 0) >= m.sesionesTotales) return 'agotada';
    if (hoy < m.inicio) return 'programada';
    const duracion = diasEntre(m.inicio, m.fin);
    if (duracion > diasAviso && diasEntre(hoy, m.fin) <= diasAviso) return 'por_vencer';
    return 'activa';
  }
  const daAcceso = (estado) => estado === 'activa' || estado === 'por_vencer';

  function totalCargo(precioLista, descuento) {
    const d = descuento || 0;
    if (d < 0 || d > precioLista) throw new Error('El descuento no puede ser negativo ni mayor al precio.');
    return precioLista - d;
  }
  function pagadoDe(cargoId, pagos) {
    return pagos.filter((p) => p.cargoId === cargoId && !p.cancelado).reduce((s, p) => s + p.monto, 0);
  }
  function saldoCargo(cargo, pagos) {
    if (cargo.cancelado) return 0;
    return Math.max(0, cargo.total - pagadoDe(cargo.id, pagos));
  }
  function estadoCargo(cargo, pagos) {
    if (cargo.cancelado) return 'cancelado';
    const pagado = pagadoDe(cargo.id, pagos);
    if (pagado >= cargo.total) return 'pagado';
    return pagado > 0 ? 'parcial' : 'pendiente';
  }
  function montoPatrocinado(cargo) {
    if (cargo.cancelado || !cargo.patrocinado) return 0;
    return Math.max(0, (cargo.precioGeneral || 0) - cargo.precioLista);
  }

  function adeudos(cargos, pagos, hoy) {
    const porCliente = {};
    for (const c of cargos) {
      const saldo = saldoCargo(c, pagos);
      if (saldo <= 0) continue;
      const a = porCliente[c.clienteId] || (porCliente[c.clienteId] = { clienteId: c.clienteId, saldo: 0, cargos: [], antiguedad: 0 });
      a.saldo += saldo;
      a.cargos.push({ cargo: c, saldo });
      a.antiguedad = Math.max(a.antiguedad, diasEntre(c.fecha, hoy));
    }
    return Object.values(porCliente).sort((a, b) => b.saldo - a.saldo);
  }

  // Valida la entrada de un cliente a un área. Prefiere mensualidad sobre paquete o visita,
  // y entre iguales la que vence primero.
  function validarEntrada({ clienteId, areaId, membresias, conceptos, hoy, diasAviso, tieneAdeudoVencido }) {
    const cubre = (m) => {
      const c = conceptos.find((x) => x.id === m.conceptoId);
      return c && (c.areaIds || []).includes(areaId);
    };
    const validas = membresias
      .filter((m) => m.clienteId === clienteId && cubre(m) && daAcceso(estadoMembresia(m, hoy, diasAviso)))
      .sort((a, b) => ((a.sesionesTotales ? 1 : 0) - (b.sesionesTotales ? 1 : 0)) || (a.fin < b.fin ? -1 : 1));
    if (!validas.length) return { ok: false, motivo: 'Sin membresía vigente que cubra esta área.' };
    if (tieneAdeudoVencido) return { ok: false, membresia: validas[0], motivo: 'Tiene un adeudo pendiente de días anteriores.' };
    return { ok: true, membresia: validas[0] };
  }

  function corteCaja(pagos, fecha) {
    const delDia = pagos.filter((p) => p.fecha === fecha);
    const vigentes = delDia.filter((p) => !p.cancelado);
    const agrupa = (campo) => {
      const o = {};
      for (const p of vigentes) o[p[campo] || ''] = (o[p[campo] || ''] || 0) + p.monto;
      return o;
    };
    return {
      total: vigentes.reduce((s, p) => s + p.monto, 0),
      porForma: agrupa('formaPagoId'),
      porUsuario: agrupa('creadoPor'),
      vigentes,
      cancelados: delDia.filter((p) => p.cancelado),
    };
  }

  // Ingresos (pagos vigentes) en un periodo, repartidos por área y por tipo de cliente.
  // Un concepto con varias áreas reparte el pago en partes iguales; sin área va a 'general'.
  function ingresos(pagos, cargos, clientes, desde, hasta) {
    const cargoDe = Object.fromEntries(cargos.map((c) => [c.id, c]));
    const tipoDe = Object.fromEntries(clientes.map((c) => [c.id, c.tipoClienteId]));
    const porArea = {}, porTipo = {};
    let total = 0;
    for (const p of pagos) {
      if (p.cancelado || p.fecha < desde || p.fecha > hasta) continue;
      total += p.monto;
      const areas = (cargoDe[p.cargoId] && cargoDe[p.cargoId].areaIds) || [];
      if (!areas.length) porArea.general = (porArea.general || 0) + p.monto;
      else areas.forEach((a) => { porArea[a] = (porArea[a] || 0) + p.monto / areas.length; });
      const t = tipoDe[p.clienteId] || GENERAL;
      porTipo[t] = (porTipo[t] || 0) + p.monto;
    }
    return { total, porArea, porTipo };
  }

  function patrocinioPeriodo(cargos, desde, hasta) {
    return cargos.filter((c) => c.fecha >= desde && c.fecha <= hasta).reduce((s, c) => s + montoPatrocinado(c), 0);
  }

  // Reservaciones activas que chocan con la nueva en el mismo recurso o con el mismo entrenador.
  function traslapes(reservaciones, nueva) {
    return reservaciones.filter((r) => r.id !== nueva.id && r.estado !== 'cancelada' && r.fecha === nueva.fecha
      && r.inicio < nueva.fin && nueva.inicio < r.fin
      && ((r.recursoId && r.recursoId === nueva.recursoId) || (r.entrenadorId && r.entrenadorId === nueva.entrenadorId)
        || (r.grupo && nueva.grupo && r.grupo.trim().toLowerCase() === nueva.grupo.trim().toLowerCase())));
  }

  function edad(nacimiento, hoy) {
    if (!nacimiento) return null;
    let e = Number(hoy.slice(0, 4)) - Number(nacimiento.slice(0, 4));
    if (hoy.slice(5) < nacimiento.slice(5)) e--;
    return e;
  }

  return { GENERAL, CREA_MEMBRESIA, addDias, diasEntre, precioDe, finVigencia, inicioRenovacion, estadoMembresia, daAcceso,
    totalCargo, pagadoDe, saldoCargo, estadoCargo, montoPatrocinado, adeudos, validarEntrada, corteCaja, ingresos,
    patrocinioPeriodo, traslapes, edad };
})();
if (typeof module !== 'undefined') module.exports = R;
