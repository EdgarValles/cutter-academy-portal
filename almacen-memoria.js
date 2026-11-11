// Almacén en memoria con la misma interfaz que almacen-mongo.js.
// Solo para pruebas y demostración: los datos se pierden al apagar el servidor.
const { aplanar } = require('./almacen-mongo.js');
const copia = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const cumple = (d, filtro) => Object.entries(filtro).every(([k, v]) => d[k] === v);

function ponerRuta(doc, ruta, valor) {
  const partes = ruta.split('.');
  let o = doc;
  for (let i = 0; i < partes.length - 1; i++) { if (!o[partes[i]] || typeof o[partes[i]] !== 'object') o[partes[i]] = {}; o = o[partes[i]]; }
  o[partes[partes.length - 1]] = valor;
}

async function crear() {
  const bd = {};
  const c = (col) => bd[col] || (bd[col] = new Map());
  const sale = (id, d) => (d ? { id, ...copia(d) } : null);
  return {
    async listar(col, { limite = 0, descendente = false, filtro = {} } = {}) {
      let ids = [...c(col).keys()].filter((id) => cumple(c(col).get(id), filtro)).sort();
      if (descendente) ids.reverse();
      if (limite) ids = ids.slice(0, limite);
      return ids.map((id) => sale(id, c(col).get(id)));
    },
    async obtener(col, id) { return sale(id, c(col).get(id)); },
    async buscarUno(col, filtro) {
      for (const [id, d] of c(col)) if (cumple(d, filtro)) return sale(id, d);
      return null;
    },
    async contar(col) { return c(col).size; },
    async reemplazar(col, id, datos) { const nuevo = !c(col).has(id); c(col).set(id, copia(datos)); return nuevo; },
    async fusionar(col, id, parche, { crear = false } = {}) {
      if (!c(col).has(id)) { if (!crear) return null; c(col).set(id, {}); }
      const d = c(col).get(id);
      for (const [ruta, v] of Object.entries(aplanar(parche))) ponerRuta(d, ruta, copia(v));
      return sale(id, d);
    },
    async incrementar(col, id, campo, n = 1, { crear = false, menorQue = '' } = {}) {
      if (!c(col).has(id)) { if (!crear) return null; c(col).set(id, {}); }
      const d = c(col).get(id);
      if (menorQue && !((d[campo] || 0) < d[menorQue])) return null;
      d[campo] = (d[campo] || 0) + n;
      return sale(id, d);
    },
    async eliminar(col, id) { c(col).delete(id); },
    async eliminarDonde(col, filtro) { for (const [id, d] of c(col)) if (cumple(d, filtro)) c(col).delete(id); },
    async cerrar() {},
  };
}

module.exports = { crear };
