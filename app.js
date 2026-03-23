import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

// ==========================================
// CONFIGURACIÓN DE SUPABASE Y DIAGNÓSTICO
// ==========================================
// Prioriza process.env, luego import.meta (Vite), y finalmente el fallback estático.
const SUPABASE_URL = (typeof process !== 'undefined' && process.env.SUPABASE_URL) || (import.meta && import.meta.env ? import.meta.env.VITE_SUPABASE_URL : null) || 'https://makchqjswyuuxuxvrake.supabase.co/';
const SUPABASE_ANON_KEY = (typeof process !== 'undefined' && process.env.SUPABASE_ANON_KEY) || (import.meta && import.meta.env ? import.meta.env.VITE_SUPABASE_ANON_KEY : null) || 'sb_publishable_KGdTd-AG8v3EOueOVumNYA_WDoCaICL';

console.log("=== DIAGNÓSTICO DE CONEXIÓN A SUPABASE ===");
console.log("URL Registrada:", SUPABASE_URL);
if (!SUPABASE_URL || !SUPABASE_URL.startsWith('http')) {
    console.error("URL Invalida. Faltan variables de entorno o error en fallback.");
}

let supabase = null;
if (SUPABASE_URL) {
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ==========================================
// ESTADO DE LA APLICACIÓN
// ==========================================
let state = {
    tasks: [],
    tags: [],
    filters: { search: '', tagId: '' },
    formSteps: [],
    formSelectedTags: [],
    editingTaskId: null,
    deletingTaskId: null,
    pendingNewTagName: '',
    pendingNewTagColor: null
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
    dateInput: document.getElementById('dateInput'),
    tagSearchInput: document.getElementById('tagSearchInput'),
    tagCustomDropdown: document.getElementById('tagCustomDropdown'),
    selectedTagsContainer: document.getElementById('selectedTagsContainer'),
    submitTaskBtn: document.getElementById('submitTaskBtn'),
    cancelEditBtn: document.getElementById('cancelEditBtn'),
    
    toggleDetailsBtn: document.getElementById('toggleDetailsBtn'),
    toggleIcon: document.getElementById('toggleIcon'),
    extendedDetails: document.getElementById('extendedDetails'),
    descInput: document.getElementById('descInput'),
    stepsContainer: document.getElementById('stepsContainer'),
    addStepBtn: document.getElementById('addStepBtn'),
    
    tasksGrid: document.getElementById('tasksGrid'),
    emptyState: document.getElementById('emptyState'),
    
    tagsModal: document.getElementById('tagsModal'),
    closeTagsModalBtn: document.getElementById('closeTagsModalBtn'),
    newTagName: document.getElementById('newTagName'),
    newTagColor: document.getElementById('newTagColor'),
    saveNewTagBtn: document.getElementById('saveNewTagBtn'),
    tagsList: document.getElementById('tagsList'),
    deleteModal: document.getElementById('deleteModal'),
    cancelDeleteBtn: document.getElementById('cancelDeleteBtn'),
    confirmDeleteBtn: document.getElementById('confirmDeleteBtn'),
    
    quickTagModal: document.getElementById('quickTagModal'),
    quickTagNameDisplay: document.getElementById('quickTagNameDisplay'),
    cancelQuickTagBtn: document.getElementById('cancelQuickTagBtn'),
    submitQuickTagBtn: document.getElementById('submitQuickTagBtn'),
    colorPills: document.querySelectorAll('.color-pill'),

    toastContainer: document.getElementById('toastContainer')
};

// ==========================================
// UTILIDADES UI: TOASTS & SPINNERS
// ==========================================
function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = type === 'success' ? `✓ ${msg}` : `⚠️ ${msg}`;
    DOM.toastContainer.appendChild(toast);
    
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function setBtnLoading(btn, isLoading, originalHtml = '') {
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
    if (!supabase) {
        showEmptyState("No olvides configurar SUPABASE_URL. El cliente no inicializó.");
        showToast("Error de inicialización de Supabase", "error");
        return;
    }
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
        console.error('Error fetchTags:', error);
        showToast("No pudimos actualizar los Tags.", "error"); 
    }
}

async function fetchTasks() {
    try {
        const { data, error } = await supabase
            .from('tasks')
            .select(`*, task_steps(*), task_tags(tags(*))`)
            .order('created_at', { ascending: false });

        if (error) throw error;
        
        state.tasks = (data || []).map(task => ({
            ...task,
            task_steps: task.task_steps.sort((a,b) => a.order - b.order),
            tags: task.task_tags.map(tt => tt.tags).filter(Boolean)
        }));
        
        renderTasks();
    } catch (error) { 
        console.error('Error fetchTasks [CÓDIGO', error?.code, ']:', error); 
        showToast("Error al cargar tareas", "error");
    }
}

async function handleTaskSubmit(e) {
    e.preventDefault();
    if (!supabase) return;

    // Validación Manual (adicional al HTML required)
    const titleVal = DOM.titleInput.value.trim();
    if (!titleVal) {
        showToast("El título de la tarea es requerido.", "error");
        DOM.titleInput.focus();
        return;
    }

    const taskData = {
        title: titleVal,
        description: DOM.descInput.value.trim() || null,
        due_date: DOM.dateInput.value || null,
    };

    setBtnLoading(DOM.submitTaskBtn, true);

    try {
        if (state.editingTaskId) {
            await updateTask(state.editingTaskId, taskData);
            showToast("Tarea actualizada con éxito");
        } else {
            await createTask(taskData);
            showToast("Tarea creada correctamente");
        }
        resetForm();
        await fetchTasks();
    } catch (error) {
        console.error('Error al guardar tarea:', error);
        showToast(`No se pudo guardar la tarea. HTTP ${error?.code || error?.status || 'Error'}`, "error");
    } finally {
        setBtnLoading(DOM.submitTaskBtn, false, '<svg class="icon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>');
    }
}

async function createTask(taskData) {
    const { data: insertedTask, error: taskError } = await supabase.from('tasks').insert([taskData]).select().single();
    if (taskError) throw taskError;

    const taskId = insertedTask.id;

    if (state.formSteps.length > 0) {
        const stepsToInsert = state.formSteps.filter(s => s.text.trim()).map((step, idx) => ({
            task_id: taskId, step_text: step.text.trim(), order: idx, is_completed: false
        }));
        if(stepsToInsert.length > 0){
            const { error: stepsError } = await supabase.from('task_steps').insert(stepsToInsert);
            if (stepsError) throw stepsError;
        }
    }

    if (state.formSelectedTags.length > 0) {
        const tagsToInsert = state.formSelectedTags.map(tagId => ({ task_id: taskId, tag_id: tagId }));
        const { error: tagsError } = await supabase.from('task_tags').insert(tagsToInsert);
        if (tagsError) throw tagsError;
    }
}

async function updateTask(taskId, taskData) {
    const { error: taskError } = await supabase.from('tasks').update(taskData).eq('id', taskId);
    if (taskError) throw taskError;

    await supabase.from('task_steps').delete().eq('task_id', taskId);
    if (state.formSteps.length > 0) {
        const stepsToInsert = state.formSteps.filter(s => s.text.trim()).map((step, idx) => ({
            task_id: taskId, step_text: step.text.trim(), order: idx, is_completed: step.is_completed || false
        }));
        if(stepsToInsert.length > 0){
            await supabase.from('task_steps').insert(stepsToInsert);
        }
    }

    await supabase.from('task_tags').delete().eq('task_id', taskId);
    if (state.formSelectedTags.length > 0) {
        const tagsToInsert = state.formSelectedTags.map(tagId => ({ task_id: taskId, tag_id: tagId }));
        await supabase.from('task_tags').insert(tagsToInsert);
    }
}

// ==========================================
// RENDER Y FUNCIONES WINDOW GLOBALES
// ==========================================
window.app = {
    toggleTaskCompletion: async (taskId, is_completed) => {
        const t = state.tasks.find(t=>t.id === taskId);
        try {
            if(t) t.is_completed = is_completed;
            renderTasks();
            const {error} = await supabase.from('tasks').update({ is_completed }).eq('id', taskId);
            if(error) throw error;
        } catch(e) { fetchTasks(); showToast("Error al completar tarea", "error"); }
    },
    toggleStep: async (stepId, is_completed, taskId) => {
        const t = state.tasks.find(t=>t.id === taskId);
        try {
            if(t) {
                const s = t.task_steps.find(s=>s.id === stepId);
                if(s) s.is_completed = is_completed;
            }
            renderTasks();
            const {error} = await supabase.from('task_steps').update({ is_completed }).eq('id', stepId);
            if(error) throw error;
        } catch(e) { fetchTasks(); showToast("Error al completar paso", "error");}
    },
    toggleDropdown: (btn) => {
        document.querySelectorAll('.dropdown-menu').forEach(menu => {
            if (menu !== btn.nextElementSibling) menu.classList.remove('active');
        });
        btn.nextElementSibling.classList.toggle('active');
    },
    startEditTask: (taskId) => {
        const task = state.tasks.find(t => t.id === taskId);
        if(!task) return;
        state.editingTaskId = task.id;
        DOM.titleInput.value = task.title;
        DOM.descInput.value = task.description || '';
        DOM.dateInput.value = task.due_date || '';
        
        state.formSteps = task.task_steps.map(s => ({ text: s.step_text, is_completed: s.is_completed }));
        renderFormSteps();

        state.formSelectedTags = task.tags.map(t => t.id);
        renderFormTags();

        DOM.submitTaskBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        DOM.cancelEditBtn.classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        if (state.formSteps.length > 0 || task.description) {
            DOM.extendedDetails.classList.remove('hidden');
            DOM.toggleIcon.style.transform = 'rotate(180deg)';
        }
    },
    requestDeleteTask: (taskId) => {
        state.deletingTaskId = taskId;
        DOM.deleteModal.classList.add('active');
    },
    removeFormStep: (idx) => {
        state.formSteps.splice(idx, 1);
        renderFormSteps();
    },
    updateFormStep: (idx, val) => {
        state.formSteps[idx].text = val;
    },
    removeFormTag: (tagId) => {
        state.formSelectedTags = state.formSelectedTags.filter(id => id !== tagId);
        renderFormTags();
    },
    deleteTag: async (tagId) => {
        if(!confirm("¿Seguro que quieres borrar este tag? Se removerá de todas las tareas.")) return;
        try {
            const {error} = await supabase.from('tags').delete().eq('id', tagId);
            if(error) throw error;
            showToast("Tag eliminado", "success");
            await fetchTags();
            await fetchTasks();
        } catch (e) { showToast("Error al borrar tag", "error"); console.error(e); }
    },
    
    // --- LÓGICA SEARCH TAGS INLINE ---
    handleTagSearch: () => {
        const term = DOM.tagSearchInput.value.trim().toLowerCase();
        DOM.tagCustomDropdown.innerHTML = ''; 
        
        let matches = state.tags.filter(t => t.name.toLowerCase().includes(term) && !state.formSelectedTags.includes(t.id));
        
        if (matches.length > 0) {
            matches.forEach(t => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'dropdown-item';
                btn.innerHTML = `<span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${t.color}; margin-right:8px;"></span>${t.name}`;
                btn.onclick = () => {
                    state.formSelectedTags.push(t.id);
                    renderFormTags();
                    DOM.tagSearchInput.value = '';
                    DOM.tagCustomDropdown.classList.remove('active');
                };
                DOM.tagCustomDropdown.appendChild(btn);
            });
        }
    
        if (term !== '' && !state.tags.some(t => t.name.toLowerCase() === term)) {
            const createBtn = document.createElement('button');
            createBtn.type = 'button';
            createBtn.className = 'dropdown-item';
            createBtn.style.color = 'var(--c-secondary)';
            createBtn.style.fontWeight = '600';
            createBtn.innerHTML = `+ Crear tag "${DOM.tagSearchInput.value.trim()}"`;
            createBtn.onclick = () => {
                 state.pendingNewTagName = DOM.tagSearchInput.value.trim();
                 // Limpiamos color previo visualmente
                 DOM.colorPills.forEach(p => p.classList.remove('selected'));
                 state.pendingNewTagColor = null;

                 DOM.quickTagNameDisplay.textContent = state.pendingNewTagName;
                 DOM.quickTagModal.classList.add('active');
                 DOM.tagCustomDropdown.classList.remove('active');
            };
            DOM.tagCustomDropdown.appendChild(createBtn);
        }
        
        if (DOM.tagCustomDropdown.children.length > 0) {
            DOM.tagCustomDropdown.classList.add('active');
        } else {
            DOM.tagCustomDropdown.classList.remove('active');
        }
    },
    
    // CREAR EL NUEVO TAG - MODAL QUICK ACTION
    createNewTagQuick: async () => {
        if (!state.pendingNewTagName || !state.pendingNewTagColor) {
            showToast("Verifica que haya un nombre y color elegidos.", "error");
            return;
        }
        
        setBtnLoading(DOM.submitQuickTagBtn, true);
        try {
            const { data, error } = await supabase.from('tags')
                .insert([{ name: state.pendingNewTagName, color: state.pendingNewTagColor }])
                .select()
                .single();
            if (error) throw error;
            
            showToast("Tag creado con éxito");
            await fetchTags();
            state.formSelectedTags.push(data.id);
            renderFormTags();
            
            DOM.tagSearchInput.value = '';
            DOM.quickTagModal.classList.remove('active');
            state.pendingNewTagName = '';
            state.pendingNewTagColor = null;
        } catch (e) {
            console.error(e);
            showToast(`Error al crear tag: ${e?.message || 'Revisa duplicados'}`, "error");
        } finally {
            setBtnLoading(DOM.submitQuickTagBtn, false, 'Guardar Tag');
        }
    }
};

// Cerrar dropdowns outside click
document.addEventListener('click', (e) => {
    if (!e.target.closest('.task-actions')) {
        document.querySelectorAll('.task-actions .dropdown-menu').forEach(m => m.classList.remove('active'));
    }
    if (!e.target.closest('.tag-selector-wrapper')) {
        DOM.tagCustomDropdown.classList.remove('active');
    }
});


// ==========================================
// RENDERIZADO DE LA VISTA
// ==========================================

function renderTasks() {
    DOM.tasksGrid.innerHTML = '';
    
    let filtered = state.tasks;
    if (state.filters.search) {
        const term = state.filters.search.toLowerCase();
        filtered = filtered.filter(t => t.title.toLowerCase().includes(term) || (t.description && t.description.toLowerCase().includes(term)));
    }
    if (state.filters.tagId) {
        filtered = filtered.filter(t => t.tags.some(tag => tag.id === state.filters.tagId));
    }

    if (filtered.length === 0) {
        showEmptyState("No se encontraron tareas.");
        return;
    }
    hideEmptyState();

    filtered.forEach(task => {
        const card = document.createElement('div');
        card.className = `task-card ${task.is_completed ? 'completed' : ''}`;
        
        let tagsHtml = '';
        if (task.tags && task.tags.length > 0) {
            tagsHtml = `<div class="tags-container" style="margin-bottom: 0.75rem;">` + 
                task.tags.map(t => `<span class="tag-chip" style="background:${t.color}20; color:${t.color}; border-color:${t.color}40">${t.name}</span>`).join('') +
            `</div>`;
        }

        let stepsHtml = '';
        if (task.task_steps && task.task_steps.length > 0) {
            stepsHtml = `<div class="task-steps">` + 
                task.task_steps.map(step => `
                    <label class="step-item ${step.is_completed ? 'completed' : ''}">
                        <input type="checkbox" class="step-checkbox" onchange="window.app.toggleStep('${step.id}', this.checked, '${task.id}')" ${step.is_completed ? 'checked' : ''}>
                        <span>${step.step_text}</span>
                    </label>
                `).join('') +
            `</div>`;
        }

        let dateHtml = '';
        if (task.due_date) {
            const dateStr = new Date(task.due_date).toLocaleDateString();
            dateHtml = `<div class="task-meta"><span class="task-due-date"><svg class="icon" style="width:14px;height:14px" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg> ${dateStr}</span></div>`;
        }

        card.innerHTML = `
            <div class="task-header">
                <div class="task-title-group">
                    <input type="checkbox" class="task-checkbox" onchange="window.app.toggleTaskCompletion('${task.id}', this.checked)" ${task.is_completed ? 'checked' : ''}>
                    <h3 class="task-title">${task.title}</h3>
                </div>
                <div class="task-actions">
                    <button class="btn btn-icon dropdown-trigger" onclick="window.app.toggleDropdown(this)">
                        <svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>
                    </button>
                    <div class="dropdown-menu">
                        <button class="dropdown-item" onclick="window.app.startEditTask('${task.id}')">Editar</button>
                        <button class="dropdown-item text-danger" onclick="window.app.requestDeleteTask('${task.id}')">Eliminar</button>
                    </div>
                </div>
            </div>
            ${tagsHtml}
            ${task.description ? `<p class="task-info">${task.description}</p>` : ''}
            ${dateHtml}
            ${stepsHtml}
        `;
        DOM.tasksGrid.appendChild(card);
    });
}

// ==========================================
// FORMULARIO LOGICA Y RENDERS MENORES
// ==========================================
function resetForm() {
    DOM.taskForm.reset();
    state.editingTaskId = null;
    state.formSteps = [];
    state.formSelectedTags = [];
    renderFormSteps();
    renderFormTags();
    DOM.submitTaskBtn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    DOM.cancelEditBtn.classList.add('hidden');
    DOM.extendedDetails.classList.add('hidden');
    DOM.toggleIcon.style.transform = 'rotate(0deg)';
}

function renderFormSteps() {
    DOM.stepsContainer.innerHTML = '';
    state.formSteps.forEach((step, idx) => {
        const item = document.createElement('div');
        item.className = 'dynamic-item';
        item.innerHTML = `
            <input type="text" class="input-field" style="padding: 0.5rem 1rem;" value="${step.text.replace(/"/g, '&quot;')}" oninput="window.app.updateFormStep(${idx}, this.value)" placeholder="Paso ${idx + 1}...">
            <button type="button" class="btn btn-icon" onclick="window.app.removeFormStep(${idx})" style="color:var(--c-salmon)">
                <svg class="icon" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        `;
        DOM.stepsContainer.appendChild(item);
    });
}

function renderFormTags() {
    DOM.selectedTagsContainer.innerHTML = '';
    state.formSelectedTags.forEach(tagId => {
        const tag = state.tags.find(t => t.id === tagId);
        if (!tag) return;
        const chip = document.createElement('span');
        chip.className = 'tag-chip';
        chip.style.background = `${tag.color}20`;
        chip.style.color = tag.color;
        chip.style.borderColor = `${tag.color}40`;
        chip.style.marginTop = '0.5rem';
        chip.innerHTML = `
            ${tag.name}
            <button type="button" onclick="window.app.removeFormTag('${tag.id}')"><svg class="icon" style="width:14px;height:14px" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></button>
        `;
        DOM.selectedTagsContainer.appendChild(chip);
    });
}


// ==========================================
// EVENT LISTENERS DE CONFIGURACIÓN
// ==========================================
function setupEventListeners() {
    DOM.taskForm.addEventListener('submit', handleTaskSubmit);
    DOM.cancelEditBtn.addEventListener('click', resetForm);
    
    DOM.addStepBtn.addEventListener('click', () => {
        state.formSteps.push({ text: '', is_completed: false });
        renderFormSteps();
        const inputs = DOM.stepsContainer.querySelectorAll('input');
        if (inputs.length > 0) inputs[inputs.length - 1].focus();
    });

    DOM.toggleDetailsBtn.addEventListener('click', () => {
        DOM.extendedDetails.classList.toggle('hidden');
        if (DOM.extendedDetails.classList.contains('hidden')) {
            DOM.toggleIcon.style.transform = 'rotate(0deg)';
        } else {
            DOM.toggleIcon.style.transform = 'rotate(180deg)';
        }
    });

    DOM.tagSearchInput.addEventListener('focus', window.app.handleTagSearch);
    DOM.tagSearchInput.addEventListener('input', window.app.handleTagSearch);
    
    DOM.searchInput.addEventListener('input', (e) => {
        state.filters.search = e.target.value;
        renderTasks();
    });
    DOM.tagFilter.addEventListener('change', (e) => {
        state.filters.tagId = e.target.value;
        renderTasks();
    });

    // Delete task
    DOM.cancelDeleteBtn.addEventListener('click', () => DOM.deleteModal.classList.remove('active'));
    DOM.confirmDeleteBtn.addEventListener('click', async () => {
        if (!supabase || !state.deletingTaskId) return;
        setBtnLoading(DOM.confirmDeleteBtn, true);
        try {
            await supabase.from('tasks').delete().eq('id', state.deletingTaskId);
            showToast("Tarea eliminada exitosamente");
            state.deletingTaskId = null;
            DOM.deleteModal.classList.remove('active');
            await fetchTasks();
        } catch (e) { 
            showToast("Error al borrar la tarea", "error"); 
            console.error(e);
        } finally {
            setBtnLoading(DOM.confirmDeleteBtn, false, 'Confirmar Eliminar');
        }
    });

    // Manage General Tags
    DOM.manageTagsBtn.addEventListener('click', () => DOM.tagsModal.classList.add('active'));
    DOM.closeTagsModalBtn.addEventListener('click', () => DOM.tagsModal.classList.remove('active'));
    DOM.saveNewTagBtn.addEventListener('click', async () => {
        const name = DOM.newTagName.value.trim();
        const color = DOM.newTagColor.value;
        if (!name) { showToast("El nombre de la categoría es requerido", "error"); return; }
        setBtnLoading(DOM.saveNewTagBtn, true);
        try {
            await supabase.from('tags').insert([{ name, color }]);
            showToast("Tag creado con éxito");
            DOM.newTagName.value = '';
            await fetchTags();
        } catch (e) { 
            showToast("Error al crear la categoría", "error"); 
        } finally {
            setBtnLoading(DOM.saveNewTagBtn, false, 'Crear');
        }
    });
    
    // Quick Tag Modal inline create
    DOM.cancelQuickTagBtn.addEventListener('click', () => {
        DOM.quickTagModal.classList.remove('active');
        state.pendingNewTagName = '';
    });
    
    DOM.submitQuickTagBtn.addEventListener('click', () => {
        if(!state.pendingNewTagColor) {
            showToast("Selecciona un color para continuar", "error");
            return;
        }
        window.app.createNewTagQuick();
    });

    DOM.colorPills.forEach(pill => {
        pill.addEventListener('click', (e) => {
            e.preventDefault();
            DOM.colorPills.forEach(p => p.classList.remove('selected'));
            pill.classList.add('selected');
            state.pendingNewTagColor = e.target.dataset.color;
        });
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
    DOM.tagsList.innerHTML = '';
    state.tags.forEach(t => {
        const li = document.createElement('li');
        li.style.display = 'flex'; li.style.justifyContent = 'space-between'; li.style.alignItems = 'center';
        li.style.padding = '0.5rem'; li.style.background = 'var(--c-bg)'; li.style.borderRadius = 'var(--radius-sm)';
        li.innerHTML = `
            <span style="font-weight:600; color:${t.color}; display:flex; align-items:center; gap:0.5rem">
                <span style="width:12px; height:12px; border-radius:50%; background:${t.color}; display:inline-block;"></span>
                ${t.name}
            </span>
            <button class="btn btn-icon" style="color:var(--c-salmon); padding:0.25rem" onclick="window.app.deleteTag('${t.id}')">
                <svg class="icon" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        `;
        DOM.tagsList.appendChild(li);
    });
}

function showEmptyState(msg) {
    DOM.emptyState.classList.remove('hidden');
    DOM.tasksGrid.classList.add('hidden');
    if(msg) DOM.emptyState.querySelector('p').textContent = msg;
}
function hideEmptyState() {
    DOM.emptyState.classList.add('hidden');
    DOM.tasksGrid.classList.remove('hidden');
}

document.addEventListener('DOMContentLoaded', init);
