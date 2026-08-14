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
        if (index >= 0 && index < this.blocks.length) {
            this.blocks.splice(index, 1);
            this.render();
            this.onChange();
        }
    }

    moveBlock(index, direction) {
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
        if (!this.blocks[index]) return;

        if (field === 'title' || field === 'type') {
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
            item.draggable = true;
            item.setAttribute('data-index', index);

            const isShow = block.type === 'SHOW';

            item.innerHTML = `
                <div class="block-header">
                    <div class="drag-handle" title="Arrastrar para reordenar">
                        <span>☰</span>
                        <span>#${index + 1}</span>
                    </div>
                    <div style="flex: 1; margin: 0 8px;">
                        <select class="form-control" style="padding: 4px 8px; font-size: 11px; font-weight: bold;" onchange="app.blocksManager.updateBlock(${index}, 'type', this.value)">
                            <option value="SHOW" ${block.type === 'SHOW' ? 'selected' : ''}>SHOW</option>
                            <option value="ANIMACIÓN" ${block.type === 'ANIMACIÓN' ? 'selected' : ''}>ANIMACIÓN</option>
                            <option value="PREPARACIÓN" ${block.type === 'PREPARACIÓN' ? 'selected' : ''}>PREPARACIÓN</option>
                            <option value="OTRO" ${block.type === 'OTRO' ? 'selected' : ''}>OTRO</option>
                        </select>
                    </div>
                    <div class="block-controls">
                        <button class="btn-icon" title="Mover arriba" onclick="app.blocksManager.moveBlock(${index}, -1)">▲</button>
                        <button class="btn-icon" title="Mover abajo" onclick="app.blocksManager.moveBlock(${index}, 1)">▼</button>
                        <button class="btn-icon" style="color: var(--accent-danger);" title="Eliminar bloque" onclick="app.blocksManager.removeBlock(${index})">✕</button>
                    </div>
                </div>

                <div class="form-group" style="margin-bottom: 0;">
                    <input type="text" class="form-control" value="${this.escapeHtml(block.title || '')}" oninput="app.blocksManager.updateBlock(${index}, 'title', this.value)" placeholder="Descripción o Nombre del Show">
                </div>

                <div class="${isShow ? 'grid-2' : ''}">
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">Duración (min)</label>
                        <input type="number" class="form-control" value="${block.duration || 0}" min="1" oninput="app.blocksManager.updateBlock(${index}, 'duration', this.value)">
                    </div>
                    ${isShow ? `
                    <div class="form-group" style="margin-bottom: 0;">
                        <label class="form-label">Bis / Encore (min)</label>
                        <input type="number" class="form-control" value="${block.bis || 0}" min="0" oninput="app.blocksManager.updateBlock(${index}, 'bis', this.value)">
                    </div>
                    ` : ''}
                </div>
            `;

            // Drag and drop listeners
            item.addEventListener('dragstart', (e) => {
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
