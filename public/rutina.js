// Pantalla de socios: muestra las rutinas de hoy y se actualiza sola cada minuto (sirve para una tele o el celular).
(function () {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fechaLarga = (f) => { const t = new Intl.DateTimeFormat('es-MX', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${f}T12:00:00Z`)); return t[0].toUpperCase() + t.slice(1); };
  let visto = '';
  async function cargar() {
    try {
      const r = await fetch('api/publico/rutinas', { cache: 'no-store' });
      if (!r.ok) throw new Error();
      const texto = await r.text();
      $('#estado').textContent = '';
      if (texto === visto) return;
      const { fecha, frase, rutinas } = JSON.parse(texto);
      visto = texto;
      $('#fecha').textContent = fechaLarga(fecha);
      $('#frase').textContent = frase || ''; $('#frase').hidden = !frase;
      $('#saltos').innerHTML = rutinas.map((x) => `<a class="btn" href="#${esc(x.tipo)}">${esc(x.nombre)}</a>`).join('');
      $('#rutinas').innerHTML = rutinas.map((x) => `<section class="panel" id="${esc(x.tipo)}"><h2>${esc(x.nombre)}</h2>${x.texto.trim()
        ? `${x.titulo ? `<b>${esc(x.titulo)}</b>` : ''}<div class="rutina-txt">${esc(x.texto)}</div>`
        : '<div class="empty">Aún no hay rutina para hoy.</div>'}</section>`).join('');
    } catch (e) {
      $('#estado').textContent = visto ? 'Sin conexión. Se muestra lo último que se cargó.' : 'No se pudieron cargar las rutinas. Se vuelve a intentar en un minuto.';
      if (!visto) $('#rutinas').innerHTML = '';
    }
  }
  cargar();
  setInterval(cargar, 60000);
})();
