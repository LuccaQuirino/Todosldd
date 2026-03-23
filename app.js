import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// ==========================================
// CONFIGURACIÓN DE SUPABASE Y DIAGNÓSTICO
// ==========================================
const SUPABASE_URL = (typeof process !== 'undefined' && process.env.SUPABASE_URL) || (import.meta && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : null) || 'https://makchqjswyuuxuxvrake.supabase.co/';
const SUPABASE_ANON_KEY = (typeof process !== 'undefined' && process.env.SUPABASE_ANON_KEY) || (import.meta && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : null) || 'sb_publishable_KGdTd-AG8v3EOueOVumNYA_WDoCaICL';

let supabase = null;
if (SUPABASE_URL) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ==========================================
// ESTADO DE LA APLICACIÓN (SHADE & SHIFT)
// ==========================================
let state = {
    tasks: [],
    tags: [],
    filters: { search: '', tagId: '' },
    formSelectedTags: [],
};

// Estado efímero local para interacciones UI complejas
const localState = {
    expandedCards: new Set(),
    editingTaskId: null,
    timers: {}, 
    dragSourceTask: null
};

// ==========================================
// REFERENCIAS DOM Y FEEDBACK (TOASTS)
// ==========================================
const DOM = {
    searchInput: document.getElementById('searchInput'),
    tagFilter: document.getElementById('tagFilter'),
    manageTagsBtn: document.getElementById('manageTagsBtn'),
    
    taskForm: document.getElementById('taskForm'),
    titleInput: document.getElementById('titleInput'),
    tagSearchInput: document.getElementById('tagSearchInput'),
    tagCustomDropdown: document.getElementById('tagCustomDropdown'),
    selectedTagsContainer: document.getElementById('selectedTagsContainer'),
    submitTaskBtn: document.getElementById('submitTaskBtn'),
    
    tasksGrid: document.getElementById('tasksGrid'),
    
    tagsModal: document.getElementById('tagsModal'),
    closeTagsModalBtn: document.getElementById('closeTagsModalBtn'),
    newTagName: document.getElementById('newTagName'),
    saveNewTagBtn: document.getElementById('saveNewTagBtn'),
    
    toastContainer: document.getElementById('toastContainer')
};

function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = type === 'success' ? `✓ ${msg}` : `⚠️ ${msg}`;
    if(DOM.toastContainer) DOM.toastContainer.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function setBtnLoading(btn, isLoading, originalHtml = '') {
    if(!btn) return;
    if (isLoading) {
        btn.disabled = true;
        btn.dataset.original = btn.innerHTML;
        btn.innerHTML = `<svg class="spinner icon" viewBox="0 0 24 24" style="stroke-width:3; color:currentColor"><circle cx="12" cy="12" r="10" stroke="currentColor" fill="none" stroke-dasharray="31.4" stroke-linecap="round"></circle></svg>`;
    } else {
        btn.disabled = false;
        btn.innerHTML = btn.dataset.original || originalHtml;
    }
}

// ==========================================
// INICIALIZACIÓN
// ==========================================
async function init() {
    setupEventListeners();
    if (!supabase) return;
    await fetchTags();
    await fetchTasks();
}

// ==========================================
// SERVICIOS DATABASE (SUPABASE)
// ==========================================
async function fetchTags() {
    try {
        const { data, error } = await supabase.from('tags').select('*').order('name');
        if (error) throw error;
        state.tags = data || [];
        renderTagFilters();
        renderManageTagsList();
    } catch (error) { 
        showToast("Error al cargar Tags", "error"); 
    }
}

async function fetchTasks() {
    try {
        const { data, error } = await supabase
            .from('tasks')
            .select(`*, task_steps(*), task_tags(tags(*))`)
            .order('sort_order', { ascending: true, nullsFirst: false })
            .order('created_at', { ascending: false });

        if (error) throw error;
        
        state.tasks = (data || []).map(task => ({
            ...task,
            task_steps: task.task_steps.sort((a,b) => a.order - b.order),
            tags: task.task_tags.map(tt => tt.tags).filter(Boolean)
        }));
        
        renderTasks();
    } catch (error) { 
        showToast("Error al cargar tareas principales", "error");
    }
}

async function handleTaskSubmit(e) {
    e.preventDefault();
    if (!supabase) return;

    const titleVal = DOM.titleInput.value.trim();
    if (!titleVal) { showToast("El título es requerido", "error"); return; }

    const taskData = {
        title: titleVal,
        description: null, // Minimalist init
        sort_order: state.tasks.length > 0 ? state.tasks.length : 0 
    };

    setBtnLoading(DOM.submitTaskBtn, true);

    try {
        const { data: insertedTasks, error: taskError } = await supabase.from('tasks').insert([taskData]).select();
        if (taskError) throw taskError;
        if (!insertedTasks || insertedTasks.length === 0) throw new Error("Error RLS: No se obtuvo ID");

        const taskId = insertedTasks[0].id;

        if (state.formSelectedTags.length > 0) {
            const tagsToInsert = state.formSelectedTags.map(tagId => ({ task_id: taskId, tag_id: tagId }));
            await supabase.from('task_tags').insert(tagsToInsert);
        }

        showToast("Sombra creada correctamente");
        resetForm();
        await fetchTasks();
    } catch (error) {
        showToast(`No se pudo generar el Destino`, "error");
        console.error("Detalle Supabase Insert:", error);
    } finally {
        setBtnLoading(DOM.submitTaskBtn, false, 'Crear Destino');
    }
}

// ==========================================
// RENDER Y LOGICA SHADE & SHIFT UI
// ==========================================
function renderTasks() {
    DOM.tasksGrid.innerHTML = ''; // Regla 1: Limpieza Estricta
    
    let filtered = [...state.tasks];
    
    // Buscador Real-Time
    if (state.filters.search) {
        const term = state.filters.search.toLowerCase();
        filtered = filtered.filter(t => t.title.toLowerCase().includes(term));
    }
    // Tag Filters
    if (state.filters.tagId) {
        filtered = filtered.filter(t => t.tags.some(tag => tag.id === state.filters.tagId));
    }

    if (filtered.length === 0) {
        DOM.tasksGrid.innerHTML = `<p class="empty-msg">No se encontraron sombras por aquí... intenta otra búsqueda</p>`;
        return;
    }

    // Sort order manual override
    filtered.sort((a,b) => {
        if(a.sort_order !== undefined && b.sort_order !== undefined && a.sort_order !== null && b.sort_order !== null) return a.sort_order - b.sort_order;
        return new Date(b.created_at) - new Date(a.created_at);
    });

    filtered.forEach((task) => {
        const card = document.createElement('div');
        const isExpanded = localState.expandedCards.has(task.id);
        const isEditing = localState.editingTaskId === task.id;
        
        card.className = `task-card ${task.is_completed ? 'completed' : ''} ${isExpanded ? 'expanded' : ''} ${isEditing ? 'editing' : ''}`;
        card.dataset.id = task.id;
        
        // Drag solo si está colapsado y no se está editando
        card.draggable = !isExpanded && !isEditing;
        app.setupDragAndDrop(card, task);

        // -- MODO EDICIÓN IN-SITU --
        if (isEditing) {
            card.innerHTML = `
                <div class="edit-in-situ">
                    <input type="text" id="editTitle_${task.id}" class="input-field title-edit" value="${task.title.replace(/"/g, '&quot;')}">
                    <textarea id="editDesc_${task.id}" class="input-field" placeholder="Información Adicional (Opcional)...">${task.description || ''}</textarea>
                    
                    <div style="margin-top: 1rem; display: flex; gap: 1rem; justify-content: flex-end;">
                        <button class="btn" onclick="app.cancelEdit(event)">Cancelar</button>
                        <button class="btn btn-primary" onclick="app.saveEdit('${task.id}', event)">Guardar Sombra</button>
                    </div>
                </div>
            `;
            DOM.tasksGrid.appendChild(card);
            return;
        }

        // -- RENDER NORMAL CARD --
        let tagsHtml = '';
        if (task.tags && task.tags.length > 0) {
            tagsHtml = `<div class="tags-container">` + 
                task.tags.map(t => `<span class="tag-chip" style="background:${t.color}20; color:${t.color};">${t.name}</span>`).join('') +
            `</div>`;
        }

        // Timer de Pomodoro
        if (!localState.timers[task.id]) {
            localState.timers[task.id] = { active: false, seconds: 1500, interval: null };
        }
        const timer = localState.timers[task.id];
        const mins = String(Math.floor(timer.seconds / 60)).padStart(2, '0');
        const secs = String(timer.seconds % 60).padStart(2, '0');

        // Body Elements (Barra Progreso y Pasos)
        let bodyHtml = '';
        const stepsCount = task.task_steps?.length || 0;
        const compCount = task.task_steps?.filter(s => s.is_completed).length || 0;
        const progressPercent = stepsCount === 0 ? 0 : (compCount / stepsCount) * 100;

        let stepsStr = (task.task_steps || []).map(s => `
            <label style="display:flex; align-items:center; gap:0.5rem; ${s.is_completed ? 'text-decoration:line-through; opacity:0.6;' : ''}" onclick="event.stopPropagation()">
                <input type="checkbox" class="step-checkbox" ${s.is_completed ? 'checked' : ''} onchange="app.toggleStep('${s.id}', this.checked, '${task.id}')">
                <span>${s.step_text}</span>
            </label>
        `).join('');

        bodyHtml = `
            ${task.description ? `<p style="color:var(--c-text-muted); font-size: 0.95rem;">${task.description}</p>` : ''}
            
            <div class="progress-bar-container">
                <div class="progress-bar-fill" style="width: ${progressPercent}%"></div>
            </div>
            
            <div style="margin-top: 1rem; display: flex; flex-direction: column; gap: 0.75rem;">
                <h4 style="font-size: 0.8rem; color: var(--c-text-muted); text-transform:uppercase;">Pasos (${compCount}/${stepsCount})</h4>
                ${stepsStr}
                
                <div style="display:flex; gap:0.5rem; align-items:center;">
                    <input type="text" id="newStep_${task.id}" class="input-field" style="padding:0.4rem 0.8rem; font-size:0.9rem; flex:1;" placeholder="Agrega un nuevo paso..." onclick="event.stopPropagation()">
                    <button class="btn btn-primary" style="padding:0.4rem 0.8rem;" onclick="app.addStep('${task.id}', event)">+</button>
                </div>
            </div>
        `;

        card.innerHTML = `
            <div class="task-header" onclick="app.toggleAccordion('${task.id}', event)">
                <div class="task-title-group">
                    <input type="checkbox" class="task-checkbox" onchange="app.toggleTaskCompletion('${task.id}', this.checked, event)" ${task.is_completed ? 'checked' : ''} onclick="event.stopPropagation()">
                    <h3 class="task-title" style="${task.is_completed ? 'text-decoration:line-through; opacity:0.6;' : ''}">${task.title}</h3>
                    ${tagsHtml}
                </div>
                
                <div style="display:flex; align-items:center; gap: 1rem;">
                    <div class="pomodoro-badge ${timer.active ? 'active' : ''}" onclick="app.togglePomodoro('${task.id}', event)">
                        <svg class="icon" style="width:14px;height:14px;" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                        <span id="timerTxt_${task.id}">${mins}:${secs}</span>
                    </div>
                    
                    <div class="task-actions" style="position:relative;" onclick="event.stopPropagation()">
                        <button class="btn btn-icon dropdown-trigger" onclick="app.toggleDropdown(this)">
                            <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
                        </button>
                        <div class="dropdown-menu">
                            <button class="dropdown-item" onclick="app.startEdit('${task.id}')">Editar In-Situ</button>
                            <button class="dropdown-item" style="color:var(--c-salmon);" onclick="app.deleteTask('${task.id}')">Eliminar</button>
                        </div>
                    </div>
                </div>
            </div>
            
            <div class="task-body">
                ${bodyHtml}
            </div>
        `;
        DOM.tasksGrid.appendChild(card);
    });
}

// ==========================================
// MÉTODOS WINDOW.APP GLOBALES (INTERACCIÓN)
// ==========================================
window.app = {
    toggleAccordion: (taskId, e) => {
        if(e.target.closest('button') || e.target.closest('input')) return;
        if(localState.expandedCards.has(taskId)) {
            localState.expandedCards.delete(taskId);
        } else {
            localState.expandedCards.add(taskId);
        }
        renderTasks();
    },

    toggleTaskCompletion: async (taskId, is_completed, e) => {
        e.stopPropagation();
        const backup = [...state.tasks];
        
        // Optimistic UI Revert Pattern
        const t = state.tasks.find(t=>t.id === taskId);
        if(t) t.is_completed = is_completed;
        renderTasks();
        
        try {
            const {error} = await supabase.from('tasks').update({ is_completed }).eq('id', taskId);
            if(error) throw error;
        } catch(err) { 
            state.tasks = backup; renderTasks();
            showToast("Reversión: Supabase falló la actualización", "error"); 
        }
    },

    deleteTask: async (taskId) => {
        if(!confirm("¿Eliminar sombra permanentemente?")) return;
        const backup = [...state.tasks];
        
        state.tasks = state.tasks.filter(t => t.id !== taskId);
        renderTasks();
        
        try {
            const { error } = await supabase.from('tasks').delete().eq('id', taskId);
            if (error) throw error;
            showToast("Sombra enviada al vacío", "success");
        } catch(e) {
            state.tasks = backup; renderTasks();
            showToast("Error de borrado", "error");
        }
    },

    // --- Edicion In-Situ ---
    startEdit: (taskId) => {
        localState.editingTaskId = taskId;
        renderTasks();
    },
    cancelEdit: (e) => {
        e.stopPropagation();
        localState.editingTaskId = null;
        renderTasks();
    },
    saveEdit: async (taskId, e) => {
        e.stopPropagation();
        const newTitle = document.getElementById(`editTitle_${taskId}`).value.trim();
        const newDesc = document.getElementById(`editDesc_${taskId}`).value.trim();
        
        if(!newTitle) { showToast("Título obligatorio", "error"); return; }
        
        setBtnLoading(e.target, true);
        try {
            const { error } = await supabase.from('tasks').update({title: newTitle, description: newDesc}).eq('id', taskId);
            if(error) throw error;
            
            showToast("Sombra actualizada");
            localState.editingTaskId = null;
            await fetchTasks();
        } catch(err) { showToast("Error al guardar parche", "error"); }
    },

    // --- Steps logic ---
    addStep: async (taskId, e) => {
        e.stopPropagation();
        const val = document.getElementById(`newStep_${taskId}`).value.trim();
        if(!val) return;
        
        const task = state.tasks.find(t=>t.id === taskId);
        const nextOrder = task.task_steps?.length || 0;
        
        try {
            const {error} = await supabase.from('task_steps').insert([{task_id: taskId, step_text: val, order: nextOrder}]);
            if(error) throw error;
            await fetchTasks();
        } catch(err) { showToast("Fallo insertando el paso", "error"); }
    },
    toggleStep: async (stepId, is_completed, taskId) => {
        const backup = [...state.tasks];
        const t = state.tasks.find(x=>x.id === taskId);
        if(t) {
            const s = t.task_steps.find(x=>x.id === stepId);
            if(s) s.is_completed = is_completed;
        }
        renderTasks();
        try {
            const {error} = await supabase.from('task_steps').update({ is_completed }).eq('id', stepId);
            if(error) throw error;
        } catch(err) { state.tasks = backup; renderTasks(); showToast("Error red Supabase", "error"); }
    },

    // --- Pomodoro Realtime ---
    togglePomodoro: (taskId, e) => {
        e.stopPropagation();
        const p = localState.timers[taskId];
        if (p.active) {
            clearInterval(p.interval);
            p.active = false;
        } else {
            p.active = true;
            p.interval = setInterval(() => {
                p.seconds--;
                
                // Direct DOM write para evitar el full re-render
                const txt = document.getElementById(`timerTxt_${taskId}`);
                if(txt) {
                    const m = String(Math.floor(p.seconds / 60)).padStart(2, '0');
                    const s = String(p.seconds % 60).padStart(2, '0');
                    txt.textContent = `${m}:${s}`;
                }
                
                if(p.seconds <= 0) {
                    clearInterval(p.interval);
                    p.active = false;
                    p.seconds = 1500; // Reset manual
                    showToast("¡Sesión Pomodoro Finalizada!", "success");
                    renderTasks();
                }
            }, 1000);
        }
        renderTasks(); // Render initial state of badge toggle
    },

    toggleDropdown: (btn) => {
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            if (menu !== btn.nextElementSibling) menu.classList.remove('active');
        });
        btn.nextElementSibling.classList.toggle('active');
    },

    // --- HTML5 Drag & Drop Nativo ---
    setupDragAndDrop: (card, task) => {
        card.addEventListener('dragstart', (e) => {
            if(localState.expandedCards.has(task.id) || localState.editingTaskId) { e.preventDefault(); return; }
            localState.dragSourceTask = task;
            setTimeout(() => card.classList.add('dragging'), 0);
            e.dataTransfer.effectAllowed = 'move';
        });
        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            if(localState.dragSourceTask && localState.dragSourceTask.id !== task.id) {
                card.classList.add('drop-target');
            }
        });
        card.addEventListener('dragleave', () => card.classList.remove('drop-target'));
        card.addEventListener('drop', async (e) => {
            e.preventDefault();
            card.classList.remove('drop-target');
            if (localState.dragSourceTask && localState.dragSourceTask.id !== task.id) {
                await app.handleDropReorder(localState.dragSourceTask, task);
            }
        });
        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            localState.dragSourceTask = null;
            document.querySelectorAll('.drop-target').forEach(el => el.classList.remove('drop-target'));
        });
    },

    handleDropReorder: async (dragged, target) => {
        let currentTasks = [...state.tasks];
        const dragIdx = currentTasks.findIndex(t => t.id === dragged.id);
        const targetIdx = currentTasks.findIndex(t => t.id === target.id);
        
        currentTasks.splice(dragIdx, 1);
        currentTasks.splice(targetIdx, 0, dragged);
        
        currentTasks.forEach((t, i) => t.sort_order = i);
        state.tasks = currentTasks;
        renderTasks(); // Optimistic
        
        try {
            await Promise.all(currentTasks.map(t => supabase.from('tasks').update({ sort_order: t.sort_order }).eq('id', t.id)));
        } catch(e) {
            showToast("Error Supabase al guardar redimensionamiento", "error");
        }
    },

    // --- PANEl DE GESTIÓN TAGS COMPLEX ---
    updateTagName: async (tagId) => {
        const newName = document.getElementById(`editTagName_${tagId}`).value.trim();
        if(!newName) return;
        try {
            await supabase.from('tags').update({name: newName}).eq('id', tagId);
            showToast("Nombre de tag actualizado");
            await fetchTags(); await fetchTasks();
        } catch(e) { showToast("Fallo nombre de Tag", "error"); }
    },

    updateTagColor: async (tagId, hex) => {
        try {
            await supabase.from('tags').update({color: hex}).eq('id', tagId);
            showToast("Color cromático asignado");
            await fetchTags(); await fetchTasks();
        } catch(e) { showToast("Fallo asignación de color", "error"); }
    },
    
    deleteTag: async (tagId) => {
        if(!confirm("¿Eliminar este tag globalmente?")) return;
        try {
             await supabase.from('tags').delete().eq('id', tagId);
             showToast("Tag fulminado");
             await fetchTags(); await fetchTasks();
        } catch(e) { showToast("Error al borrar el Tag", "error"); }
    }
};

// ==========================================
// FORMULARIOS MENORES / SETUP
// ==========================================
function resetForm() {
    DOM.taskForm.reset();
    DOM.titleInput.value = '';
    DOM.tagSearchInput.value = '';
    state.formSelectedTags = [];
    DOM.selectedTagsContainer.innerHTML = '';
}

function setupEventListeners() {
    DOM.taskForm.addEventListener('submit', handleTaskSubmit);

    // Búsqueda Real-time global
    DOM.searchInput.addEventListener('input', (e) => {
        state.filters.search = e.target.value;
        renderTasks();
    });
    DOM.tagFilter.addEventListener('change', (e) => {
        state.filters.tagId = e.target.value;
        renderTasks();
    });

    // Modal de Gestión Tags
    DOM.manageTagsBtn.addEventListener('click', () => DOM.tagsModal.classList.add('active'));
    DOM.closeTagsModalBtn.addEventListener('click', () => DOM.tagsModal.classList.remove('active'));
    
    DOM.saveNewTagBtn.addEventListener('click', async () => {
        const name = DOM.newTagName.value.trim();
        if (!name) return;
        setBtnLoading(DOM.saveNewTagBtn, true);
        try {
            // Pick sage green defectivamente si crean rápido desde acá (o se permite update)
            await supabase.from('tags').insert([{ name, color: '#9DB395' }]);
            DOM.newTagName.value = '';
            await fetchTags();
        } catch (e) { showToast("Este tag ya existe", "error"); }
        finally { setBtnLoading(DOM.saveNewTagBtn, false, 'Añadir'); }
    });

    // Tag Search Input Frontend logic simplificada
    DOM.tagSearchInput.addEventListener('input', () => {
        const val = DOM.tagSearchInput.value.toLowerCase().trim();
        DOM.tagCustomDropdown.innerHTML = '';
        if(val === ''){ DOM.tagCustomDropdown.classList.remove('active'); return; }

        let matches = state.tags.filter(t => t.name.toLowerCase().includes(val) && !state.formSelectedTags.includes(t.id));
        matches.forEach(t => {
            const b = document.createElement('button');
            b.type='button'; b.className='dropdown-item';
            b.innerHTML = `<span style="background:${t.color}; width:10px; height:10px; display:inline-block; border-radius:50%; margin-right:5px;"></span>${t.name}`;
            b.onclick = () => {
                state.formSelectedTags.push(t.id);
                const chip = document.createElement('span');
                chip.className = 'tag-chip';
                chip.style.background = `${t.color}20`; chip.style.color = t.color;
                chip.innerHTML = `${t.name} <button type="button" onclick="this.parentElement.remove(); state.formSelectedTags = state.formSelectedTags.filter(id=>id!=='${t.id}')">X</button>`;
                DOM.selectedTagsContainer.appendChild(chip);
                DOM.tagSearchInput.value = '';
                DOM.tagCustomDropdown.classList.remove('active');
            };
            DOM.tagCustomDropdown.appendChild(b);
        });
        
        DOM.tagCustomDropdown.classList.add('active');
    });

    // Click outside utilities
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.task-actions')) {
            document.querySelectorAll('.task-actions .dropdown-menu').forEach(m => m.classList.remove('active'));
        }
        if (!e.target.closest('#tagCustomDropdown') && !e.target.closest('#tagSearchInput')) {
            if(DOM.tagCustomDropdown) DOM.tagCustomDropdown.classList.remove('active');
        }
    });
}

function renderTagFilters() {
    const val = DOM.tagFilter.value;
    DOM.tagFilter.innerHTML = '<option value="">Todos los Tags</option>';
    state.tags.forEach(t => {
        const opt = document.createElement('option');
        opt.value = t.id; opt.textContent = t.name;
        DOM.tagFilter.appendChild(opt);
    });
    DOM.tagFilter.value = val;
}

function renderManageTagsList() {
    const list = document.getElementById('tagsList');
    if(!list) return;
    list.innerHTML = '';
    const palette = ['#9DB395', '#7A96B4', '#E8A090', '#4A3F35'];

    state.tags.forEach(t => {
        const li = document.createElement('li');
        li.style.background = 'var(--c-surface)';
        li.style.padding = '0.75rem 1rem';
        li.style.borderRadius = 'var(--radius-sm)';
        li.style.border = '1px solid var(--c-border)';
        
        const colorsHtml = palette.map(hex => `
            <button class="color-circle ${t.color === hex ? 'selected' : ''}" style="background:${hex};" onclick="app.updateTagColor('${t.id}', '${hex}')"></button>
        `).join('');

        li.innerHTML = `
            <div style="display:flex; gap: 1rem; align-items:center;">
                <input type="text" id="editTagName_${t.id}" value="${t.name}" class="input-field" style="flex:1; padding:0.5rem;">
                <div style="display:flex; gap:0.5rem; align-items:center;">
                    ${colorsHtml}
                </div>
                <button class="btn btn-primary" style="padding:0.4rem 0.8rem; font-size:0.9rem;" onclick="app.updateTagName('${t.id}')">Guarda</button>
                <button class="btn btn-icon" style="color:var(--c-salmon); font-size: 0.9rem;" onclick="app.deleteTag('${t.id}')">Borrar</button>
            </div>
        `;
        list.appendChild(li);
    });
}

document.addEventListener('DOMContentLoaded', init);
