# Portal de administración — Cutter Academy by Gallo Gardea

Aplicación web independiente para administrar el gimnasio: clientes, membresías y paquetes, cobros, adeudos y corte de caja, asistencia, horarios y reservaciones, reportes y catálogos. Funciona con **Node.js** y guarda todo en **MongoDB**.

## Requisitos

- Node.js 22.9 o superior
- MongoDB 6 o superior (local, en otro servidor o MongoDB Atlas)

## Instalación

```bash
npm install
cp .env.ejemplo .env      # en Windows: copy .env.ejemplo .env
# edita .env: pon ADMIN_PASSWORD y, si aplica, MONGODB_URI
npm start
```

Abre `http://localhost:3000` y entra con el usuario y la contraseña que pusiste en `.env`.

En el primer arranque el servidor crea al administrador y carga catálogos de ejemplo (áreas, tipos de cliente, 11 conceptos de cobro y precios ficticios). Ajusta los precios en **Catálogos → Listas de precios**. Después de entrar, cambia tu contraseña en **Cuenta** y borra `ADMIN_PASSWORD` de `.env`.

### Con Docker (portal y MongoDB juntos)

```bash
ADMIN_PASSWORD=una-clave-segura docker compose up -d
```

### Solo para verlo, sin MongoDB

```bash
npm run demo     # usuario admin, contraseña cambiame123; los datos se pierden al apagar
```

## Usuarios y permisos

Se administran en **Cuenta** (enlace en el menú).

| Rol | Puede |
|---|---|
| Personal | Clientes, ventas, pagos, cancelaciones con motivo, asistencia, horarios, reportes |
| Administrador | Todo lo anterior, más catálogos, precios, configuración y usuarios |

Cada cargo, pago y entrada guarda quién lo registró; el servidor asigna ese dato y los folios, no el navegador.

Un cargo o pago ya registrado no se modifica ni se reactiva, sin importar el rol: se cancela con motivo y se registra de nuevo. El servidor también revisa importes, saldo del cargo y sesiones disponibles.

## Uso en varios equipos

Cualquier computadora o celular de la misma red puede entrar con `http://IP-DEL-SERVIDOR:3000`. Los cambios aparecen en todos los equipos al instante.

Para usarlo desde internet, ponlo detrás de HTTPS (por ejemplo con Caddy o nginx) y define `COOKIE_SEGURA=1` y `PROXY=1`. No lo expongas a internet sin HTTPS: las contraseñas viajarían sin cifrar.

## Respaldos

Todo está en la base `cutter_academy` de MongoDB:

```bash
mongodump --uri="mongodb://127.0.0.1:27017" --db=cutter_academy --out=respaldo-$(date +%F)
mongorestore --uri="mongodb://127.0.0.1:27017" respaldo-AAAA-MM-DD
```

Programa un respaldo diario; el portal no los hace solo.

## Estructura

| Archivo | Qué hace |
|---|---|
| `servidor.js` | API, sesiones, permisos y avisos en tiempo real |
| `almacen-mongo.js` | Acceso a MongoDB (una colección por catálogo o tipo de registro) |
| `almacen-memoria.js` | Almacén en memoria para pruebas y modo demostración |
| `catalogos-iniciales.json` | Catálogos de ejemplo del primer arranque |
| `public/rules.js` | Reglas de negocio: precios, vigencias, saldos, entradas, corte |
| `public/app.js` | Pantallas del portal |
| `public/datos.js` | Conexión de la página con el servidor |
| `public/cuenta.html` | Contraseña y administración de usuarios |
| `pruebas/` | Pruebas automáticas (`npm test`) |

## Limitaciones conocidas

- No cobra con tarjeta en línea ni emite facturas (CFDI); solo registra pagos.
- Los avisos en tiempo real suponen un solo proceso del servidor (no varios en paralelo).
- El reporte de asistencia cubre los últimos 180 días con registro.
- La tipografía se carga de Google Fonts; sin internet se usa una fuente del sistema.
