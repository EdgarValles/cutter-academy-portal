// Acceso a MongoDB. Cada colección del portal es una colección de Mongo; el _id es el id del registro.
const { MongoClient } = require('mongodb');

const sale = (d) => { if (!d) return null; const { _id, ...resto } = d; return { id: _id, ...resto }; };

// { a: { b: 1 } } -> { 'a.b': 1 } para que una actualización parcial no borre los demás campos anidados.
function aplanar(obj, prefijo = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const ruta = prefijo ? `${prefijo}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) { if (Object.keys(v).length) aplanar(v, ruta, out); else out[ruta] = {}; }
    else out[ruta] = v;
  }
  return out;
}

async function crear({ uri, nombreBd }) {
  const cliente = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  try { await cliente.connect(); } catch (e) { throw new Error(`No se pudo conectar a MongoDB (${e.message}). Revisa MONGODB_URI y que MongoDB esté encendido.`); }
  const bd = cliente.db(nombreBd);
  await bd.collection('usuarios').createIndex({ usuario: 1 }, { unique: true });
  await bd.collection('sesiones').createIndex({ expira: 1 }, { expireAfterSeconds: 0 });
  const c = (col) => bd.collection(col);
  return {
    async listar(col, { limite = 0, descendente = false, filtro = {} } = {}) {
      let cur = c(col).find(filtro).sort({ _id: descendente ? -1 : 1 });
      if (limite) cur = cur.limit(limite);
      return (await cur.toArray()).map(sale);
    },
    async obtener(col, id) { return sale(await c(col).findOne({ _id: id })); },
    async buscarUno(col, filtro) { return sale(await c(col).findOne(filtro)); },
    async contar(col) { return c(col).countDocuments({}); },
    // Reemplaza el documento completo. Devuelve true si se creó.
    async reemplazar(col, id, datos) {
      const r = await c(col).replaceOne({ _id: id }, datos, { upsert: true });
      return r.upsertedCount > 0;
    },
    // Mezcla campos. Devuelve el documento resultante, o null si no existe y no se pidió crearlo.
    async fusionar(col, id, parche, { crear = false } = {}) {
      const set = aplanar(parche);
      if (!Object.keys(set).length) return this.obtener(col, id);
      return sale(await c(col).findOneAndUpdate({ _id: id }, { $set: set }, { upsert: crear, returnDocument: 'after' }));
    },
    // Suma atómica a un campo numérico. Devuelve el documento resultante, o null si no existe
    // o si el campo ya alcanzó el valor de `menorQue` (otro campo del mismo documento).
    async incrementar(col, id, campo, n = 1, { crear = false, menorQue = '' } = {}) {
      const filtro = menorQue ? { _id: id, $expr: { $lt: [{ $ifNull: [`$${campo}`, 0] }, `$${menorQue}`] } } : { _id: id };
      return sale(await c(col).findOneAndUpdate(filtro, { $inc: { [campo]: n } }, { upsert: crear, returnDocument: 'after' }));
    },
    async eliminar(col, id) { await c(col).deleteOne({ _id: id }); },
    async eliminarDonde(col, filtro) { await c(col).deleteMany(filtro); },
    async cerrar() { await cliente.close(); },
  };
}

module.exports = { crear, aplanar };
