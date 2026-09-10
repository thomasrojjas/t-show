/**
 * BlocksManager
 * Handles dynamic block list, reordering, drag & drop, adding and removing blocks
 */
class BlocksManager {
    constructor(containerId, onChangeCallback) {
        this.container = document.getElementById(containerId);
        this.onChange = onChangeCallback || (() => {});
        this.blocks = [];
        this.draggedIndex = null;
    }

    setBlocks(blocksList) {
        this.blocks = JSON.parse(JSON.stringify(blocksList || []));
        this.render();
        this.onChange();
    }

    canEdit() {
        return window.WorkspaceShell?.canEdit !== false;
    }

    canReorder() {
        return window.WorkspaceShell?.canReorder !== false;
    }

    getBlocks() {
        return this.blocks;
    }

    addBlock(typeCategory) {
        let type = 'SHOW';
        let title = 'Nuevo Show / Presentación';
        let duration = 45;
        let bis = 10;

        if (typeCategory === 'anim') {
            type = 'ANIMACIÓN';
            title = 'Animadores: Intervención';
            duration = 15;
            bis = 0;
        } else if (typeCategory === 'prep') {
            type = 'PREPARACIÓN';
            title = 'Prueba de Sonido / Preparación Escenario';
            duration = 20;
            bis = 0;
        } else if (typeCategory === 'other') {
            type = 'OTRO';
            title = 'Actividad / Protocolo';
            duration = 20;
            bis = 0;
        }

        const newBlock = {
            id: 'b_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            type,
            title,
            duration,
            bis
        };

        this.blocks.push(newBlock);
        this.render();
        this.onChange();
    }

    removeBlock(index) {
        if (!this.canEdit()) return;
        if (index >= 0 && index < this.blocks.length) {
            this.blocks.splice(index, 1);
            this.render();
            this.onChange();
        }
    }

    moveBlock(index, direction) {
        if (!this.canEdit() || !this.canReorder()) return;
        const newIndex = index + direction;
        if (newIndex >= 0 && newIndex < this.blocks.length) {
            const temp = this.blocks[index];
            this.blocks[index] = this.blocks[newIndex];
            this.blocks[newIndex] = temp;
            this.render();
            this.onChange();
        }
    }

    updateBlock(index, field, value) {
        if (!this.canEdit()) return;
        if (!this.blocks[index]) return;

        if (field === 'title' || field === 'type' || field === 'notes' || field === 'animator_script') {
            this.blocks[index][field] = value;
            if (field === 'type') {
                this.render();
            }
        } else {
            this.blocks[index][field] = Math.max(0, parseInt(value) || 0);
        }
        this.onChange();
    }

    render() {
        if (!this.container) return;
        this.container.innerHTML = '';

        if (this.blocks.length === 0) {
            this.container.innerHTML = `
                <div style="padding: 20px; text-align: center; color: var(--text-muted); font-size: 12px; border: 1px dashed var(--border-color); border-radius: 8px;">
                    No hay bloques configurados. Usa los botones inferiores para agregar shows o intervenciones.
                </div>
            `;
            return;
        }

        this.blocks.forEach((block, index) => {
            const item = document.createElement('div');
            item.className = 'block-item';
            const editable = this.canEdit();
            const reorderable = editable && this.canReorder();
            item.draggable = reorderable;
            item.setAttribute('data-index', index);

            const isShow = block.type === 'SHOW';

            item.innerHTML = `
                <div class="block-header">
                    <div class="drag-handle" title="Arrastrar para reordenar">
                        <span>☰</span>
                        <span>#${index + 1}</span>
                    </div>
                    <div style="flex: 1; margin: 0 8px;">
                        <select class="form-control" ${editable ? '' : 'disabled'} style="padding: 4px 8px; font-size: 11px; font-weight: bold;" onchange="app.blocksManager.updateBlock(${index}, 'type', this.value)">
                            <option value="SHOW" ${block.type === 'SHOW' ? 'selected' : ''}>SHOW</option>
                            <option value="ANIMACIÓN" ${block.type === 'ANIMACIÓN' ? 'selected' : ''}>ANIMACIÓN</option>
                            <option value="PREPARACIÓN" ${block.type === 'PREPARACIÓN' ? 'selected' : ''}>PREPARACIÓN</option>
                            <option value="OTRO" ${block.type === 'OTRO' ? 'selected' : ''}>OTRO</option>
                        </select>
                    </div>
                    <div class="block-controls">
                        ${reorderable ? `<button class="btn-icon" title="Subir bloque" aria-label="Subir bloque" onclick="app.blocksManager.moveBlock(${index}, -1)">↑</button>
                        <button class="btn-icon" title="Bajar bloque" aria-label="Bajar bloque" onclick="app.blocksManager.moveBlock(${index}, 1)">↓</button>
                        <button class="btn-icon" style="color: var(--accent-danger);" title="Eliminar bloque" aria-label="Eliminar bloque" onclick="app.blocksManager.removeBlock(${index})">×</button>` : ''}
                    </div>
                </div>

                <div class="form-group" style="margin-bottom: 0;">
                    <input type="text" class="form-control" ${editable ? '' : 'readonly'} value="${this.escapeHtml(block.title || '')}" oninput="app.blocksManager.updateBlock(${index}, 'title', this.value)" placeholder="Ej. Apertura de puertas y recepción">
                </div>

                <div class="${isShow ? 'grid-2' : ''}">
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">Duración (min)</label>
                        <input type="number" class="form-control" ${editable ? '' : 'readonly'} value="${block.duration || 0}" min="1" oninput="app.blocksManager.updateBlock(${index}, 'duration', this.value)">
                    </div>
                    ${isShow ? `
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">Bis / Encore (min)</label>
                        <input type="number" class="form-control" ${editable ? '' : 'readonly'} value="${block.bis || 0}" min="0" oninput="app.blocksManager.updateBlock(${index}, 'bis', this.value)">
                    </div>
                    ` : ''}
                </div>
                <details class="block-notes" ${block.notes || block.animator_script ? 'open' : ''}>
                    <summary>Notas y guion del animador</summary>
                    <div class="block-notes-fields">
                        <label class="form-label">Notas operativas
                            <textarea class="form-control" ${editable ? '' : 'readonly'} maxlength="4000" rows="2" oninput="app.blocksManager.updateBlock(${index}, 'notes', this.value)" placeholder="Ej. Confirmar audio, iluminación y acceso del equipo">${this.escapeHtml(block.notes || '')}</textarea>
                        </label>
                        <label class="form-label">Guion del animador
                            <textarea class="form-control" ${editable ? '' : 'readonly'} maxlength="8000" rows="3" oninput="app.blocksManager.updateBlock(${index}, 'animator_script', this.value)" placeholder="Ej. Buenas noches. Bienvenidas y bienvenidos a este evento…">${this.escapeHtml(block.animator_script || '')}</textarea>
                        </label>
                    </div>
                </details>
            `;

            // Drag and drop listeners
            item.addEventListener('dragstart', (e) => {
                if (!reorderable) { e.preventDefault(); return; }
                this.draggedIndex = index;
                item.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
            });

            item.addEventListener('dragend', () => {
                item.classList.remove('dragging');
                this.draggedIndex = null;
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                if (!reorderable) return;
                if (this.draggedIndex !== null && this.draggedIndex !== index) {
                    const moved = this.blocks.splice(this.draggedIndex, 1)[0];
                    this.blocks.splice(index, 0, moved);
                    this.render();
                    this.onChange();
                }
            });

            this.container.appendChild(item);
        });
    }

    escapeHtml(str) {
        return str
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
}
