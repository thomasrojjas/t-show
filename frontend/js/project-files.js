/* Private event library using the existing upload/finalize and download APIs. */
window.ProjectFiles = (() => {
  const types = {pdf:'application/pdf',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'};
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let selected = null, busy = false, project = '', request = 0;
  function message(text, state = '') { $('fileFeedback').textContent = text; $('fileFeedback').dataset.status = state; }
  function markup() {
    return `<header class="shell-page-head"><span class="shell-eyebrow">Archivos del evento</span><h1>Documentos y fotografías</h1><p>Organiza informes, planos y material de producción para tu equipo.</p></header>
      <article class="glass-panel shell-projects"><div class="panel-title"><h2>Biblioteca del proyecto</h2><button id="fileAdd" type="button" class="btn btn-primary">+ Agregar archivo</button></div>
      <form id="fileForm" hidden><fieldset id="fileFields"><label class="form-label" for="fileTitle">Título del archivo</label><input id="fileTitle" class="form-control" required maxlength="120" placeholder="Ej. Informe de producción">
      <label class="file-drop" id="fileDrop" for="fileInput"><strong>Arrastra un archivo aquí</strong><span>o selecciónalo desde tu equipo</span><input id="fileInput" type="file" accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp"><small>PDF, Word, Excel, JPG, PNG o WebP · hasta 25 MB</small></label>
      <p id="fileSelection">Ningún archivo seleccionado.</p><div class="shell-actions"><button class="btn btn-primary" type="submit" id="fileSave">Guardar archivo</button><button class="btn btn-secondary" type="button" id="fileCancel">Cancelar</button></div></fieldset></form>
      <p id="fileFeedback" role="status" aria-live="polite"></p><div id="fileLibrary" class="file-library"></div></article>`;
  }
  function choose(file) {
    if (busy) return;
    selected = null;
    const ext = file?.name.split('.').pop().toLowerCase();
    if (!file || !types[ext] || file.size <= 0 || file.size > 25 * 1024 * 1024) {
      $('fileSelection').textContent = 'Ningún archivo válido seleccionado.';
      message('Selecciona un formato permitido, entre 1 byte y 25 MB.', 'error'); return;
    }
    selected = file;
    $('fileSelection').textContent = file.name + ' · ' + (file.size / 1048576).toFixed(2) + ' MB';
    message('Archivo preparado. Escribe el título y pulsa Guardar archivo.');
  }
  async function load() {
    const id = window.WorkspaceShell.projectId, token = ++request;
    if (project !== id) {
      project = id; selected = null; $('fileForm').reset(); $('fileForm').hidden = true;
      $('fileSelection').textContent = 'Ningún archivo seleccionado.'; message('');
    }
    $('fileAdd').hidden = !window.WorkspaceShell.canEdit;
    $('fileLibrary').textContent = 'Cargando archivos…';
    if (!id) { $('fileLibrary').textContent = 'Selecciona un evento para ver sus archivos.'; return; }
    try {
      const result = await Auth.api('/api/projects/' + encodeURIComponent(id) + '/files');
      if (token !== request || id !== window.WorkspaceShell.projectId) return;
      const files = (result.data || []).filter(file => file.category !== 'cover');
      $('fileLibrary').innerHTML = files.map(file => `<article class="file-library-row"><div><strong>${esc(file.filename)}</strong><small>${(Number(file.size_bytes) / 1048576).toFixed(2)} MB · ${esc(new Date(file.created_at).toLocaleDateString('es-CL'))}</small></div><button type="button" class="btn btn-secondary" data-download="${esc(file.id)}">Descargar</button></article>`).join('') || '<p>Todavía no hay archivos. Usa + Agregar archivo para guardar el primero.</p>';
    } catch (error) {
      if (token === request) { $('fileLibrary').textContent = 'No pudimos cargar la biblioteca.'; message(error.message, 'error'); }
    }
  }
  function bind() {
    $('fileAdd').onclick = () => { $('fileForm').hidden = false; $('fileTitle').focus(); };
    $('fileCancel').onclick = () => { if (!busy) $('fileForm').hidden = true; };
    $('fileInput').onchange = event => choose(event.target.files[0]);
    ['dragenter','dragover'].forEach(name => $('fileDrop').addEventListener(name, event => { event.preventDefault(); $('fileDrop').classList.add('is-dragging'); }));
    ['dragleave','drop'].forEach(name => $('fileDrop').addEventListener(name, event => { event.preventDefault(); $('fileDrop').classList.remove('is-dragging'); }));
    $('fileDrop').addEventListener('drop', event => {
      if (event.dataTransfer.files.length !== 1) { message('Agrega un archivo a la vez.', 'error'); return; }
      choose(event.dataTransfer.files[0]);
    });
    $('fileForm').onsubmit = async event => {
      event.preventDefault();
      if (busy) return;
      const title = $('fileTitle').value.trim(), file = selected, id = window.WorkspaceShell.projectId;
      if (!id || !window.WorkspaceShell.canEdit) { message('No tienes permisos para guardar archivos en este evento.', 'error'); return; }
      if (!title || !file) { message('Completa el título y selecciona un archivo.', 'error'); return; }
      busy = true; $('fileFields').disabled = true; $('fileSave').setAttribute('aria-busy','true');
      try {
        const ext = file.name.split('.').pop().toLowerCase(), contentType = types[ext];
        // Persist the user title as the downloadable filename; no local-only metadata.
        const filename = title.replace(/[\\/]/g, '-') + '.' + ext;
        message('Preparando carga…');
        const signed = await Auth.api('/api/uploads/sign', {method:'POST',body:JSON.stringify({projectId:id,category:'block_attachment',filename,contentType,size:file.size})});
        message('Subiendo archivo…');
        const response = await fetch(signed.uploadUrl, {method:'PUT',headers:{'Content-Type':contentType},body:file});
        if (!response.ok) throw new Error('La carga no se completó. Inténtalo nuevamente.');
        message('Verificando y guardando…');
        await Auth.api('/api/uploads/' + encodeURIComponent(signed.uploadId) + '/finalize', {method:'POST'});
        if (id === window.WorkspaceShell.projectId) {
          selected = null; $('fileForm').reset(); $('fileForm').hidden = true;
          $('fileSelection').textContent = 'Ningún archivo seleccionado.';
          await load(); message('Archivo guardado en este proyecto.', 'success');
        }
      } catch (error) {
        if (id === window.WorkspaceShell.projectId) message(error instanceof TypeError ? 'No se pudo conectar al almacenamiento. Revisa la conexión e inténtalo de nuevo; el archivo sigue seleccionado.' : error.message, 'error');
      } finally { busy = false; $('fileFields').disabled = false; $('fileSave').removeAttribute('aria-busy'); }
    };
    $('fileLibrary').onclick = async event => {
      const button = event.target.closest('[data-download]'); if (!button) return;
      button.disabled = true;
      try {
        const result = await Auth.api('/api/files/' + encodeURIComponent(button.dataset.download) + '/download', {method:'POST'});
        const link = document.createElement('a'); link.href = result.url; link.rel = 'noopener'; link.click();
      } catch (error) { message(error.message, 'error'); }
      finally { button.disabled = false; }
    };
  }
  return {markup, bind, load};
})();
