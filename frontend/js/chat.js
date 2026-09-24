/* Private event chat: one authenticated Realtime channel for the workspace. */
(function () {
    const MAX_LENGTH = 2000;
    const DRAFT_PREFIX = 'tshow_chat_draft:';
    const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

    class ChatApp {
        constructor() {
            this.events = new Map();
            this.messages = new Map();
            this.drafts = new Map();
            this.selectedProjectId = document.body.dataset.projectId || new URLSearchParams(location.search).get('project') || '';
            window.Auth.currentUser?.().then(user => { this.currentUserId = user?.id || ''; }).catch(() => {});
            this.channel = null;
            this.realtimeReady = false;
            this.refreshing = null;
            this.sending = false;
            this.soundEnabled = false;
            this.init();
        }

        init() {
            if (!document.body.matches('.live-body, [data-workspace-page]')) return;
            this.mount();
            this.bind();
            document.body.classList.add('chat-ready');
            if (!window.Auth?.api) {
                this.eventList.innerHTML = '<p class="chat-empty chat-error">El chat no está disponible en este momento.</p>';
                return;
            }
            this.refreshSummary();
            this.refreshNotices();
            this.startRealtime();
            this.summaryTimer = setInterval(() => this.refreshSummary(), 30000);
            this.noticeTimer = setInterval(() => this.refreshNotices(), 30000);
            this.pollTimer = setInterval(() => { if (document.visibilityState === 'visible' && !this.realtimeReady) this.refreshSummary(true); }, 10000);
            document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') this.refreshSummary(true); });
            window.addEventListener('focus', () => this.refreshSummary(true));
        }

        async refreshNotices() {
            try {
                const result=await window.Auth.api('/api/operational-inbox');
                this.notices=Array.isArray(result.data)?result.data:(result.data?.data||[]);
                const count=Number(result.unreadCount ?? result.data?.unreadCount ?? this.notices.length);
                const badge=document.getElementById('workspaceNoticeBadge');
                if(badge){badge.textContent=count>99?'99+':String(count);badge.hidden=count<1;}
                if(this.noticeDialog?.open)this.renderNotices();
            } catch(error) { if(error.status!==401&&error.status!==403)this.noticeError=error.message; }
        }

        renderNotices() {
            if(!this.noticeList)return;
            const list=this.notices||[];
            this.noticeList.innerHTML=list.length?list.map(notice=>`<article class="operational-notice-item"><span class="chat-kicker">${esc(notice.eventName||'Evento')}</span><strong>${esc(notice.title)}</strong><p>${esc(notice.body)}</p><small>${new Date(notice.created_at).toLocaleString('es-CL')}</small><button type="button" data-notice-seen="${esc(notice.project_id)}" data-notice-id="${esc(notice.id)}">Marcar visto</button></article>`).join(''):'<p class="chat-empty">No tienes avisos pendientes.</p>';
        }

        openNotices() { this.renderNotices(); this.noticeDialog?.showModal(); }

        mount() {
            if (!document.getElementById('chatLauncher')) document.body.insertAdjacentHTML('beforeend', `
                <button id="chatLauncher" class="chat-launcher" type="button" aria-haspopup="dialog" aria-controls="chatPanel" aria-expanded="false">
                    <span class="chat-launcher-icon" aria-hidden="true">✦</span><span>Chat</span><b id="chatGlobalBadge" class="chat-badge" hidden>0</b>
                </button>
                <div id="chatScrim" class="chat-scrim" hidden></div>
                <aside id="chatPanel" class="chat-panel" role="dialog" aria-modal="true" aria-labelledby="chatTitle" hidden>
                    <header class="chat-panel-header"><div><span class="chat-kicker">Comunicación interna</span><h2 id="chatTitle">Chat del equipo</h2></div><button id="chatClose" class="chat-close" type="button" aria-label="Cerrar chat">×</button></header>
                    <div class="chat-panel-body">
                        <section class="chat-events" aria-labelledby="chatEventsTitle"><div class="chat-section-heading"><h3 id="chatEventsTitle">Eventos</h3><span id="chatEventCount"></span></div><div id="chatEventList" class="chat-event-list"><p class="chat-empty">Cargando eventos…</p></div></section>
                        <section class="chat-conversation" aria-labelledby="chatConversationTitle"><header class="chat-conversation-header"><div><span class="chat-kicker">Conversación</span><h3 id="chatConversationTitle">Selecciona un evento</h3></div><button id="chatSound" class="chat-sound" type="button" aria-pressed="false" title="Activar sonido de notificaciones">Sonido apagado</button></header><div id="chatMessages" class="chat-messages" role="log" aria-live="polite" aria-relevant="additions"><p class="chat-empty">Selecciona un evento para ver sus mensajes.</p></div><button id="chatNewMessages" class="chat-new-messages" type="button" hidden>Nuevos mensajes</button><form id="chatComposer" class="chat-composer"><label class="chat-label" for="chatDraft">Mensaje para <strong id="chatComposerEvent">el equipo</strong></label><textarea id="chatDraft" maxlength="2000" rows="3" placeholder="Escribe un mensaje para el equipo…" disabled></textarea><label class="chat-association"><input id="chatAssociateBlock" type="checkbox" disabled><span>Asociar al bloque actual</span><small id="chatBlockContext">No hay un bloque activo</small></label><div class="chat-composer-footer"><span id="chatSendStatus" class="chat-send-status" role="status" aria-live="polite"></span><button id="chatSend" class="chat-send" type="submit" disabled>Enviar</button></div></form></section>
                    </div>
                </aside>
                <div id="chatNotice" class="chat-notice" role="status" aria-live="polite" hidden></div>`);
            if (!document.getElementById('operationalNoticeDialog')) document.body.insertAdjacentHTML('beforeend', `
                <dialog id="operationalNoticeDialog" class="operational-notice-dialog" aria-labelledby="operationalNoticeTitle">
                  <header><div><span class="chat-kicker">Comunicación interna</span><h2 id="operationalNoticeTitle">Avisos pendientes</h2></div><button id="operationalNoticeClose" class="chat-close" type="button" aria-label="Cerrar avisos">×</button></header>
                  <div id="operationalNoticeList" class="operational-notice-list"><p class="chat-empty">Cargando avisos…</p></div>
                </dialog>`);
            this.mountWorkspaceEntry();
        }

        mountWorkspaceEntry() {
            const nav = document.querySelector('.workspace-sidebar-nav');
            if (!nav || document.getElementById('workspaceChatButton')) return;
            const label = document.createElement('div');
            label.className = 'workspace-sidebar-label workspace-chat-label';
            label.textContent = 'Comunicación';
            const button = document.createElement('button');
            button.id = 'workspaceChatButton';
            button.className = 'workspace-chat-entry';
            button.type = 'button';
            button.setAttribute('aria-haspopup', 'dialog');
            button.setAttribute('aria-controls', 'chatPanel');
            button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-7l-4.5 3v-3H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"/><path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01"/></svg><span>Chat</span><b id="workspaceChatBadge" class="chat-badge" hidden>0</b>';
            button.addEventListener('click', () => this.open());
            const noticeButton=document.createElement('button');
            noticeButton.id='workspaceNoticeButton'; noticeButton.className='workspace-chat-entry'; noticeButton.type='button'; noticeButton.setAttribute('aria-haspopup','dialog'); noticeButton.setAttribute('aria-controls','operationalNoticeDialog');
            noticeButton.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/></svg><span>Avisos</span><b id="workspaceNoticeBadge" class="chat-badge" hidden>0</b>';
            noticeButton.addEventListener('click', () => this.openNotices());
            nav.append(label, button, noticeButton);
        }

        bind() {
            this.launcher = document.getElementById('chatLauncher'); this.panel = document.getElementById('chatPanel'); this.scrim = document.getElementById('chatScrim');
            this.closeButton = document.getElementById('chatClose'); this.eventList = document.getElementById('chatEventList'); this.messagesNode = document.getElementById('chatMessages'); this.noticeDialog=document.getElementById('operationalNoticeDialog'); this.noticeList=document.getElementById('operationalNoticeList');
            this.composer = document.getElementById('chatComposer'); this.draftNode = document.getElementById('chatDraft'); this.sendButton = document.getElementById('chatSend'); this.soundButton = document.getElementById('chatSound');
            this.launcher.onclick = () => this.open(); this.closeButton.onclick = () => this.close(); this.scrim.onclick = () => this.close();
            document.getElementById('operationalNoticeClose').onclick=()=>this.noticeDialog.close();
            this.noticeList.addEventListener('click',async event=>{const button=event.target.closest('[data-notice-seen]');if(!button)return;button.disabled=true;try{await window.Auth.api(`/api/projects/${encodeURIComponent(button.dataset.noticeSeen)}/notices/${encodeURIComponent(button.dataset.noticeId)}/seen`,{method:'POST'});this.notices=(this.notices||[]).filter(item=>item.id!==button.dataset.noticeId);this.renderNotices();this.refreshNotices();}catch(_){button.disabled=false;}});
            this.soundButton.onclick = () => this.toggleSound();
            this.composer.onsubmit = event => { event.preventDefault(); this.send(); };
            this.draftNode.oninput = () => { if (this.selectedProjectId) this.saveDraft(this.selectedProjectId, this.draftNode.value); this.updateComposer(); };
            this.draftNode.onkeydown = event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); this.send(); } };
            document.getElementById('chatNewMessages').onclick = () => { this.messagesNode.scrollTop = this.messagesNode.scrollHeight; this.markRead(); };
            this.messagesNode.onscroll = () => { document.getElementById('chatNewMessages').hidden = this.atBottom(); if (this.atBottom()) this.markRead(); };
            document.addEventListener('keydown', event => { if (event.key === 'Escape' && this.panel && !this.panel.hidden) this.close(); });
        }

        async refreshSummary(silent = false) {
            if (this.refreshing) return this.refreshing;
            this.refreshing = window.Auth.api('/api/chat/summary').then(result => {
                this.soundEnabled = Boolean(result.data?.soundEnabled);
                this.events = new Map((result.data?.events || []).map(event => [event.id, event]));
                if (!this.selectedProjectId || !this.events.has(this.selectedProjectId)) this.selectedProjectId = document.body.dataset.projectId && this.events.has(document.body.dataset.projectId) ? document.body.dataset.projectId : (this.events.keys().next().value || '');
                this.renderSummary();
                if (this.panel && !this.panel.hidden && this.selectedProjectId && !this.messages.has(this.selectedProjectId)) this.loadMessages(this.selectedProjectId);
                return result;
            }).catch(error => { if (!silent && error.status !== 401 && error.status !== 403) this.showNotice(error.message || 'No pudimos cargar el chat.'); }).finally(() => { this.refreshing = null; });
            return this.refreshing;
        }

        renderSummary() {
            const total = [...this.events.values()].reduce((sum, event) => sum + Number(event.unreadCount || 0), 0);
            const badge = document.getElementById('chatGlobalBadge'); badge.textContent = total > 99 ? '99+' : String(total); badge.hidden = total < 1;
            const sidebarBadge = document.getElementById('workspaceChatBadge'); if (sidebarBadge) { sidebarBadge.textContent = total > 99 ? '99+' : String(total); sidebarBadge.hidden = total < 1; }
            document.getElementById('chatEventCount').textContent = this.events.size ? `${this.events.size} evento${this.events.size === 1 ? '' : 's'}` : '';
            this.eventList.replaceChildren();
            if (!this.events.size) { this.eventList.innerHTML = '<p class="chat-empty">No tienes eventos disponibles.</p>'; this.updateComposer(); return; }
            for (const event of this.events.values()) {
                const button = document.createElement('button'); button.type = 'button'; button.className = `chat-event-option${event.id === this.selectedProjectId ? ' is-selected' : ''}`; button.dataset.projectId = event.id; button.setAttribute('aria-pressed', String(event.id === this.selectedProjectId));
                button.innerHTML = `<span class="chat-event-dot" aria-hidden="true"></span><span class="chat-event-copy"><strong>${esc(event.name)}</strong><small>${event.canWrite ? 'Puedes escribir' : 'Solo lectura'}</small></span>${event.unreadCount ? `<b class="chat-badge">${event.unreadCount > 99 ? '99+' : event.unreadCount}</b>` : ''}`;
                button.onclick = () => this.selectEvent(event.id);
                this.eventList.append(button);
            }
            const selected = this.events.get(this.selectedProjectId); if (selected) { document.getElementById('chatConversationTitle').textContent = selected.name; document.getElementById('chatComposerEvent').textContent = selected.name; }
            this.soundButton.setAttribute('aria-pressed', String(this.soundEnabled)); this.soundButton.textContent = this.soundEnabled ? 'Sonido encendido' : 'Sonido apagado';
            this.updateComposer();
        }

        open(projectId = this.selectedProjectId) { this.launcher.setAttribute('aria-expanded', 'true'); this.panel.hidden = false; this.scrim.hidden = false; document.body.classList.add('chat-open'); if (projectId && this.events.has(projectId)) this.selectEvent(projectId); else if (this.selectedProjectId) this.loadMessages(this.selectedProjectId); this.closeButton.focus(); }
        close() { this.panel.hidden = true; this.scrim.hidden = true; document.body.classList.remove('chat-open'); this.launcher.setAttribute('aria-expanded', 'false'); this.launcher.focus(); }

        async selectEvent(projectId) {
            this.selectedProjectId = projectId; this.renderSummary(); this.loadMessages(projectId); this.draftNode.value = await this.loadDraftAsync(projectId); this.updateComposer();
        }

        async loadMessages(projectId) {
            if (!projectId) return;
            this.messagesNode.setAttribute('aria-busy', 'true');
            try {
                const result = await window.Auth.api(`/api/projects/${encodeURIComponent(projectId)}/chat/messages`);
                this.messages.set(projectId, new Map((result.data?.messages || []).map(message => [message.id, message])));
                if (projectId === this.selectedProjectId) { this.renderMessages(); this.draftNode.value = await this.loadDraftAsync(projectId); this.updateComposer(); this.markRead(); }
            } catch (error) { if (projectId === this.selectedProjectId) this.messagesNode.innerHTML = `<p class="chat-empty chat-error">${esc(error.message || 'No pudimos cargar los mensajes.')}</p>`; }
            finally { this.messagesNode.removeAttribute('aria-busy'); }
        }

        renderMessages() {
            const list = [...(this.messages.get(this.selectedProjectId)?.values() || [])].sort((a, b) => a.sequence - b.sequence); this.messagesNode.replaceChildren();
            if (!list.length) { this.messagesNode.innerHTML = '<p class="chat-empty">Aún no hay mensajes. Comparte la primera actualización.</p>'; return; }
            for (const message of list) {
                const article = document.createElement('article'); article.className = `chat-message${message.senderId === this.currentUserId ? ' is-own' : ''}`;
                const date = new Date(message.createdAt); const event = this.events.get(this.selectedProjectId); let dateText = date.toLocaleString('es-CL', { dateStyle:'short', timeStyle:'short', timeZone:event?.timeZone || 'America/Santiago' });
                article.innerHTML = `<header><strong>${esc(message.senderName)}</strong><time datetime="${esc(message.createdAt)}">${esc(dateText)}</time></header><p></p>${message.block ? `<small class="chat-message-block">Bloque ${esc(message.block.number || '')}${message.block.title ? ` · ${esc(message.block.title)}` : ''}</small>` : ''}`; article.querySelector('p').textContent = message.body; this.messagesNode.append(article);
            }
            this.messagesNode.scrollTop = this.messagesNode.scrollHeight;
        }

        updateComposer() {
            const event = this.events.get(this.selectedProjectId); const canWrite = Boolean(event?.canWrite); this.draftNode.disabled = !canWrite; this.sendButton.disabled = !canWrite || this.sending || !this.draftNode.value.trim();
            const context = this.blockContext(); const checkbox = document.getElementById('chatAssociateBlock'); checkbox.disabled = !canWrite || !context; document.getElementById('chatBlockContext').textContent = context ? `Bloque ${context.number || ''} · ${context.title}` : 'No hay un bloque activo';
            if (!canWrite && event) document.getElementById('chatSendStatus').textContent = 'Solo lectura';
        }

        blockContext() { const item = window.liveApp?.snapshot?.currentItem; return item ? { key:item.key, number:item.num, title:item.title } : null; }
        async send() {
            const body = this.draftNode.value; const event = this.events.get(this.selectedProjectId); if (this.sending || !event?.canWrite || !body.trim() || body.length > MAX_LENGTH) return;
            this.sending = true; this.sendButton.disabled = true; document.getElementById('chatSendStatus').textContent = 'Enviando…'; const clientMessageId = crypto.randomUUID(); const checkbox = document.getElementById('chatAssociateBlock'); const block = checkbox.checked ? this.blockContext() : null;
            try { const result = await window.Auth.api(`/api/projects/${encodeURIComponent(this.selectedProjectId)}/chat/messages`, { method:'POST', body:JSON.stringify({ body, clientMessageId, block }) }); const map = this.messages.get(this.selectedProjectId) || new Map(); map.set(result.data.id, result.data); this.messages.set(this.selectedProjectId, map); this.draftNode.value = ''; this.saveDraft(this.selectedProjectId, ''); this.renderMessages(); document.getElementById('chatSendStatus').textContent = 'Enviado'; await this.refreshSummary(true); }
            catch (error) { document.getElementById('chatSendStatus').textContent = error.code === 'CHAT_RATE_LIMITED' ? `Espera ${error.retryAfterSeconds || 60}s` : 'No enviado · Reintentar'; }
            finally { this.sending = false; this.updateComposer(); }
        }

        async markRead() { if (!this.panel || this.panel.hidden || !document.hasFocus() || !this.selectedProjectId || !this.atBottom()) return; const list = [...(this.messages.get(this.selectedProjectId)?.values() || [])]; const last = list.sort((a,b) => b.sequence-a.sequence)[0]; if (!last) return; const event = this.events.get(this.selectedProjectId); if (event && event.lastReadSequence >= last.sequence) return; try { await window.Auth.api(`/api/projects/${encodeURIComponent(this.selectedProjectId)}/chat/read`, { method:'PUT', body:JSON.stringify({ sequence:last.sequence }) }); if (event) event.lastReadSequence = last.sequence; if (event) event.unreadCount = 0; this.renderSummary(); } catch (_) {} }
        atBottom() { return this.messagesNode.scrollHeight - this.messagesNode.scrollTop - this.messagesNode.clientHeight < 48; }

        async startRealtime() { try { const client = await window.Auth.client(); const token = await window.Auth.token(); if (token) client.realtime.setAuth(token); const user = await client.auth.getUser(); this.currentUserId = user.data?.user?.id || this.currentUserId || ''; this.channel = client.channel('tshow-chat-workspace').on('postgres_changes', { event:'INSERT', schema:'public', table:'tshow_chat_messages' }, payload => this.receive(payload.new)).on('postgres_changes', { event:'*', schema:'public', table:'tshow_operational_notice_recipients', filter:`user_id=eq.${this.currentUserId}` }, () => this.refreshNotices()).subscribe(status => { this.realtimeReady = status === 'SUBSCRIBED'; }); } catch (_) { this.realtimeReady = false; } }
        receive(row) { if (!row?.id || !this.events.has(row.project_id)) { this.refreshSummary(true); return; } const message = { id:row.id, projectId:row.project_id, sequence:Number(row.sequence), senderId:row.sender_id, senderName:row.sender_name, body:row.body, block:row.block_key ? {key:row.block_key,number:row.block_number,title:row.block_title || ''} : null, createdAt:row.created_at, clientMessageId:row.client_message_id }; const map = this.messages.get(row.project_id) || new Map(); if (map.has(message.id)) return; map.set(message.id, message); this.messages.set(row.project_id, map); const own = row.sender_id === this.currentUserId; const active = row.project_id === this.selectedProjectId && !this.panel.hidden; let wasBottom = false; if (active) { wasBottom = this.atBottom(); this.renderMessages(); if (!wasBottom) document.getElementById('chatNewMessages').hidden = false; if (wasBottom && document.hasFocus()) this.markRead(); } const beingRead = active && wasBottom && document.hasFocus(); if (!own && !beingRead) { const event = this.events.get(row.project_id); event.unreadCount = Number(event.unreadCount || 0) + 1; this.renderSummary(); if (!this.notificationsSuppressed()) { this.showNotice(`${event.name} · ${row.sender_name}: ${String(row.body).slice(0, 90)}`); if (this.soundEnabled) this.playSound(); } } }
        notificationsSuppressed() { return document.body.classList.contains('stage-open') || document.body.classList.contains('camarines-open'); }
        showNotice(text) { const notice = document.getElementById('chatNotice'); notice.textContent = text; notice.hidden = false; clearTimeout(this.noticeTimer); this.noticeTimer = setTimeout(() => { notice.hidden = true; }, 5000); }
        async toggleSound() { this.soundEnabled = !this.soundEnabled; this.soundButton.setAttribute('aria-pressed', String(this.soundEnabled)); this.soundButton.textContent = this.soundEnabled ? 'Sonido encendido' : 'Sonido apagado'; try { await window.Auth.api('/api/chat/preferences', { method:'PATCH', body:JSON.stringify({ soundEnabled:this.soundEnabled }) }); if (this.soundEnabled) this.playSound(); } catch (_) { this.soundEnabled = !this.soundEnabled; } }
        playSound() { if (!this.soundEnabled) return; try { const context = new (window.AudioContext || window.webkitAudioContext)(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.frequency.value = 760; gain.gain.setValueAtTime(.035, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .14); oscillator.connect(gain).connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .14); } catch (_) {} }
        saveDraft(projectId, value) { try { sessionStorage.setItem(DRAFT_PREFIX + projectId, value); } catch (_) {} window.TShowOffline?.saveDraft(`chat:${projectId}`, value).catch(() => {}); }
        loadDraft(projectId) { try { return sessionStorage.getItem(DRAFT_PREFIX + projectId) || ''; } catch (_) { return ''; } }
        async loadDraftAsync(projectId) { try { const saved=await window.TShowOffline?.readDraft(`chat:${projectId}`); if(typeof saved==='string') return saved; } catch (_) {} return this.loadDraft(projectId); }
    }

    const boot = () => {
        if (!window.ChatApp) window.ChatApp = new ChatApp();
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})();
