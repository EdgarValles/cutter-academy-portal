const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(metodo, url, cuerpo) {
  const r = await fetch(url, { method: metodo, credentials: 'same-origin', headers: cuerpo ? { 'Content-Type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  if (r.status === 401) { location.href = 'login.html'; throw new Error('Sesión terminada.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'No se pudo completar la acción.');
  return j;
}
function aviso(t) { const e = $('#toast'); e.textContent = t; e.hidden = false; setTimeout(() => { e.hidden = true; }, 3000); }
let yo = null;
async function lista() {
  const us = await api('GET', 'api/usuarios');
  $('#lista').innerHTML = us.map((u) => `<tr><td>${esc(u.nombre)}</td><td>${esc(u.usuario)}</td><td>${u.rol === 'admin' ? 'Administrador' : 'Personal'}</td>
    <td><span class="chip ${u.activo ? 'ok' : 'off'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
    <td class="n">${u.id === yo.id ? '<span class="muted small">Tú</span>' : `<button class="mini" data-a="rol" data-id="${u.id}" data-v="${u.rol === 'admin' ? 'personal' : 'admin'}">Hacer ${u.rol === 'admin' ? 'personal' : 'administrador'}</button> <button class="mini" data-a="clave" data-id="${u.id}">Nueva contraseña</button> <button class="mini${u.activo ? ' danger' : ''}" data-a="activo" data-id="${u.id}" data-v="${u.activo ? '0' : '1'}">${u.activo ? 'Desactivar' : 'Activar'}</button>`}</td></tr>`).join('');
}
(async () => {
  yo = await api('GET', 'api/yo');
  $('#quien').textContent = `${yo.nombre} · ${yo.usuario} · ${yo.rol === 'admin' ? 'Administrador' : 'Personal'}`;
  if (yo.rol === 'admin') { $('#admin').hidden = false; lista(); }
})();
$('#salir').addEventListener('click', async () => { await api('POST', 'api/logout'); location.href = 'login.html'; });
$('#fClave').addEventListener('submit', async (ev) => {
  ev.preventDefault(); $('#errClave').textContent = '';
  try { await api('POST', 'api/password', { actual: $('#actual').value, nueva: $('#nueva').value }); ev.target.reset(); aviso('Contraseña cambiada.'); }
  catch (e) { $('#errClave').textContent = e.message; }
});
$('#fNuevo').addEventListener('submit', async (ev) => {
  ev.preventDefault(); $('#errNuevo').textContent = '';
  try { await api('POST', 'api/usuarios', { nombre: $('#nNombre').value, usuario: $('#nUsuario').value, password: $('#nClave').value, rol: $('#nRol').value }); ev.target.reset(); aviso('Usuario creado.'); lista(); }
  catch (e) { $('#errNuevo').textContent = e.message; }
});
$('#lista').addEventListener('click', async (ev) => {
  const b = ev.target.closest('button[data-a]'); if (!b) return;
  $('#errLista').textContent = '';
  try {
    if (b.dataset.a === 'rol') await api('PATCH', `api/usuarios/${b.dataset.id}`, { rol: b.dataset.v });
    if (b.dataset.a === 'activo') await api('PATCH', `api/usuarios/${b.dataset.id}`, { activo: b.dataset.v === '1' });
    if (b.dataset.a === 'clave') {
      const p = window.prompt('Nueva contraseña para este usuario (mínimo 8 caracteres):');
      if (!p) return;
      await api('PATCH', `api/usuarios/${b.dataset.id}`, { password: p }); aviso('Contraseña actualizada.');
    }
    lista();
  } catch (e) { $('#errLista').textContent = e.message; }
});
