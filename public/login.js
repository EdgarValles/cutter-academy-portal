document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = document.getElementById('err'); err.textContent = '';
  try {
    const r = await fetch('api/login', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usuario: document.getElementById('usuario').value, password: document.getElementById('password').value }) });
    if (r.ok) { location.href = './'; return; }
    err.textContent = (await r.json().catch(() => ({}))).error || 'No se pudo entrar.';
  } catch (e) { err.textContent = 'Sin conexión con el servidor.'; }
});
