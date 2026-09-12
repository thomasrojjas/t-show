/* Login and invitation are separate steps. A failed acceptance keeps the session. */
(() => {
    const invite = Auth.pendingInvitation();
    const $ = id => document.getElementById(id);
    let busy = false;
    function message(text) {
        const node = $('loginError') || $('message') || $('inviteMessage');
        node.textContent = text; node.style.display = 'block'; node.setAttribute('role', 'status');
    }
    function recovery(error) {
        message(error.message + (error.requestId ? ' Referencia: ' + error.requestId : ''));
        let actions = $('acceptRecovery');
        if (!actions) { actions = document.createElement('div'); actions.id = 'acceptRecovery'; actions.className = 'invite-actions'; document.querySelector('.auth-card').append(actions); }
        actions.replaceChildren();
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn'; retry.textContent = 'Reintentar aceptación'; retry.onclick = finish; actions.append(retry);
        const change = document.createElement('button'); change.type = 'button'; change.className = 'btn'; change.textContent = 'Cambiar de cuenta';
        change.onclick = async () => { await Auth.logout(false); location.href = 'login.html?invite=' + encodeURIComponent(invite); }; actions.append(change);
        const projects = document.createElement('a'); projects.href = '/projects'; projects.textContent = 'Ir a mis proyectos'; projects.onclick = () => { try { sessionStorage.removeItem('tshow_pending_invite'); } catch (_) {} }; actions.append(projects);
        if (error.code === 'PROFILE_NOT_FOUND') profileForm(actions);
    }
    function profileForm(parent) {
        const form = document.createElement('form'); form.className = 'auth-form';
        for (const [name,label] of [['firstName','Nombre'],['lastName','Apellido'],['rut','RUT'],['phone','Teléfono']]) {
            const wrap = document.createElement('label'); wrap.textContent = label;
            const input = document.createElement('input'); input.name = name; input.required = true; input.className = 'form-control'; wrap.append(input); form.append(wrap);
        }
        const submit = document.createElement('button'); submit.className = 'btn'; submit.textContent = 'Completar perfil y continuar'; form.append(submit);
        form.onsubmit = async event => { event.preventDefault(); submit.disabled = true;
            try { await Auth.completeProfile(Object.fromEntries(new FormData(form))); await finish(); }
            catch (error) { message(error.message); } finally { submit.disabled = false; }
        };
        parent.append(form);
    }
    async function finish() {
        if (busy) return;
        busy = true;
        const buttons = [...document.querySelectorAll('button[type=submit], #loginBtn, #acceptRecovery button')];
        buttons.forEach(button => { button.disabled = true; });
        try {
            if (invite) {
                message('Sesión iniciada. Aceptando invitación…');
                const result = await Auth.acceptInvitation(invite);
                location.href = '/summary?project=' + encodeURIComponent(result.projectId);
            } else {
                const target = new URL(new URLSearchParams(location.search).get('redirect') || '/projects', location.origin);
                location.href = target.origin === location.origin ? target.href : '/projects';
            }
        } catch (error) { recovery(error); }
        finally { busy = false; buttons.forEach(button => { button.disabled = false; }); }
    }
    async function details() {
        const response = await fetch((window.SHOWTIME_API_URL || location.origin) + '/api/invitations/' + encodeURIComponent(invite));
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'No se pudo consultar la invitación.');
        return result.data;
    }
    if ($('inviteDetails')) {
        if (!invite) { $('inviteDetails').textContent = 'No se encontró una invitación en este enlace.'; message('El enlace está incompleto. Solicita una nueva invitación.'); return; }
        details().then(data => {
            const target = $('inviteDetails'); target.replaceChildren();
            for (const text of [data.project_name, data.email, data.role === 'editor' ? 'Director' : 'Observador']) {
                const line = document.createElement('p'); line.textContent = text; target.append(line);
            }
            $('existingAccount').href = 'login.html?invite=' + encodeURIComponent(invite);
            $('newAccount').href = 'register.html?invite=' + encodeURIComponent(invite);
            $('inviteActions').hidden = false;
        }).catch(error => { $('inviteDetails').textContent = 'No se pudo validar la invitación.'; message(error.message); });
    }
    if ($('loginForm')) {
        if (invite) $('registerLink').href = 'register.html?invite=' + encodeURIComponent(invite);
        Auth.currentUser().then(user => { if (user) finish(); });
        $('loginForm').onsubmit = async event => {
            event.preventDefault(); if (busy) return;
            $('loginBtn').disabled = true;
            try { await Auth.login($('email').value.trim(), $('password').value); await finish(); }
            catch (error) { message(error.message); } finally { $('loginBtn').disabled = false; }
        };
        $('resetLink').onclick = async event => {
            event.preventDefault();
            if (!$('email').value.trim()) return message('Ingresa tu correo para recuperar la contraseña.');
            try { await Auth.forgotPassword($('email').value.trim()); message('Revisa tu correo para continuar.'); }
            catch (error) { message(error.message); }
        };
    }
    if ($('registerForm')) {
        RegistrationValidation.setup();
        if (invite) {
            $('loginLink').href = 'login.html?invite=' + encodeURIComponent(invite);
            details().then(data => { $('email').value = data.email; $('email').readOnly = true; })
                .catch(error => { message(error.message); $('registerForm').querySelector('button[type=submit]').disabled = true; });
        }
        $('registerForm').onsubmit = async event => {
            event.preventDefault();
            if (busy || !RegistrationValidation.validateAll()) return;
            const button = event.currentTarget.querySelector('button[type=submit]');
            button.disabled = true; busy = true;
            try {
                const values = Object.fromEntries(['firstName','lastName','rut','email','phone','password'].map(key => [key,$(key).value]));
                const data = await Auth.register({ ...values, invite });
                busy = false;
                if (data.session) await finish();
                else message('Cuenta creada. Confirma tu correo y continúa desde el enlace para aceptar la invitación.');
            } catch (error) { message(error.message); }
            finally { busy = false; button.disabled = false; }
        };
    }
})();
