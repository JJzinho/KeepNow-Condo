// www/script/checklist.js
import { supabase } from './supabaseClient.js';
import { getPredefinedChecklistData } from './preloaded_activities.js';
import PushNotificationManager from './PushNotificationManager.js';

document.addEventListener('DOMContentLoaded', async () => {
    console.log("Checklist JS (v12.0 - Modal de Realização) Loaded...");

    const state = {
        condoId: null,
        userId: null,
        activities: [],
        occurrenceTypes: [],
        currentEditingActivityId: null,
        currentRealizacaoActivity: null, // Novo estado para a atividade sendo realizada
    };

    const utils = {
        getById: (id) => document.getElementById(id),
        toggleModal: (modalId, show) => {
            const modal = utils.getById(modalId);
            if (modal) {
                modal.classList.toggle('hidden', !show);
                document.body.classList.toggle('modal-open', show);
            }
        },
        formatDate: (dateInput) => {
            if (!dateInput) return 'N/A';
            const date = new Date(dateInput);
            // Ajusta a data para a timezone local para garantir que seja exibida corretamente
            const userTimezoneOffset = date.getTimezoneOffset() * 60000;
            const adjustedDate = new Date(date.getTime() + userTimezoneOffset);
            return !isNaN(adjustedDate.getTime()) ? adjustedDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : 'Data inválida';
        },
        calculateNextDeadline: (periodicity, customPeriodVal, startDate = new Date()) => {
            const periodMap = {
                'Diaria': { value: 1, unit: 'day' }, 'Semanal': { value: 1, unit: 'week' }, 'Quinzenal': { value: 2, unit: 'week' },
                'Mensal': { value: 1, unit: 'month' }, 'Bimestral': { value: 2, unit: 'month' }, 'Trimestral': { value: 3, unit: 'month' },
                'Semestral': { value: 6, unit: 'month' }, 'Anual': { value: 1, unit: 'year' }, 'Bienal': { value: 2, unit: 'year' }
            };
            
            // Garante que startDate é um objeto Date válido
            const date = new Date(startDate);
            if (isNaN(date.getTime())) {
                console.error("Invalid startDate provided to calculateNextDeadline:", startDate);
                return null; 
            }

            if (periodicity === 'Customizado') {
                if (customPeriodVal === 'Conforme necessidade') return null;
                const match = customPeriodVal.match(/(\d+)\s*(ano|mes|semana|dia)s?/i);
                if (!match) return null;
                const [, value, unit] = match;
                switch (unit) {
                    case 'ano': date.setFullYear(date.getFullYear() + parseInt(value)); break;
                    case 'mes': date.setMonth(date.getMonth() + parseInt(value)); break;
                    case 'semana': date.setDate(date.getDate() + parseInt(value) * 7); break;
                    case 'dia': date.setDate(date.getDate() + parseInt(value)); break;
                }
            } else if (periodMap[periodicity]) {
                const { value, unit } = periodMap[periodicity];
                switch (unit) {
                    case 'year': date.setFullYear(date.getFullYear() + value); break;
                    case 'month': date.setMonth(date.getMonth() + value); break;
                    case 'week': date.setDate(date.getDate() + value * 7); break;
                    case 'day': date.setDate(date.getDate() + value); break;
                }
            } else { return null; }
            return date.toISOString().split('T')[0];
        },
        // Altera showRealizacaoPrompt para abrir um modal
        showRealizacaoPrompt: (activity) => {
            state.currentRealizacaoActivity = activity; // Armazena a atividade no estado
            utils.getById('realizacaoActivityTitle').textContent = activity.titulo; // Exibe o título da atividade no modal
            utils.getById('dataRealizacao').value = new Date().toISOString().split('T')[0]; // Preenche com a data atual
            utils.toggleModal('realizacaoActivityModal', true); // Abre o modal
        }
    };

    const db = {
        fetchOccurrenceTypes: async () => (await supabase.from('tipo_ocorrencia').select('*').eq('condominio_id', state.condoId)).data || [],
        fetchActivities: async () => (await supabase.from('checklist_activity').select('*, tipo_ocorrencia(id, nome)').eq('condominio_id', state.condoId).order('proximo_vencimento', { ascending: true, nullsFirst: false })).data || [],
        addActivity: async (data) => (await supabase.from('checklist_activity').insert([data]).select('*, tipo_ocorrencia(id, nome)').single()).data,
        updateActivity: async (id, data) => (await supabase.from('checklist_activity').update(data).eq('id', id).select('*, tipo_ocorrencia(id, nome)').single()).data,
        deleteActivity: async (id) => !(await supabase.from('checklist_activity').delete().eq('id', id)).error,
    };

    const ui = {
        populateOccurrenceSelect: (selectId, selectedId = null) => {
            const select = utils.getById(selectId);
            if (!select) return;
            select.innerHTML = `<option value="">Todos</option>`;
            if (selectId === 'occurrence-checklist') select.innerHTML = `<option value="">Selecione...</option>`;
            state.occurrenceTypes.sort((a, b) => a.nome.localeCompare(b.nome)).forEach(type => select.add(new Option(type.nome, type.id)));
            if (selectedId) select.value = selectedId;
        },
        renderChecklistItems: () => {
            const container = utils.getById('checklist-items-container');
            const filtered = state.activities.filter(act =>
                (!utils.getById('filter-equipe').value || act.equipe_responsavel === utils.getById('filter-equipe').value) &&
                (!utils.getById('filter-periodicidade').value || act.periodicidade === utils.getById('filter-periodicidade').value) &&
                (!utils.getById('filter-sistema').value || act.tipo_ocorrencia_id == utils.getById('filter-sistema').value)
            );
            container.innerHTML = filtered.length ? '' : `<p class="empty-list-message">Nenhuma atividade encontrada com os filtros atuais.</p>`;
            filtered.forEach(act => container.appendChild(ui.createChecklistItemElement(act)));
        },
        createChecklistItemElement: (activity) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'checklist-item';
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const deadline = activity.proximo_vencimento ? new Date(activity.proximo_vencimento + 'T00:00:00Z') : null;
            const isOverdue = deadline && deadline < today;
            if (isOverdue) itemDiv.classList.add('overdue-item');
            
            itemDiv.innerHTML = `
                <div class="checklist-item-header" title="Clique para expandir">
                    <h3>${activity.titulo}</h3>
                    <span class="checklist-item-deadline">Prazo: ${utils.formatDate(activity.proximo_vencimento)} ${isOverdue ? '<strong class="overdue-text-checklist">(Vencido!)</strong>' : ''}</span>
                    <button class="toggle-details-btn-checklist" title="Mostrar/Esconder Detalhes"><i class="material-icons">expand_more</i></button>
                </div>
                <div class="checklist-item-expandable-content hidden">
                    <div class="checklist-item-details">
                        <p><strong>Sistema:</strong> ${activity.tipo_ocorrencia?.nome || 'N/A'}</p>
                        <p><strong>Descrição:</strong> ${activity.descricao || 'N/A'}</p>
                        <p><strong>Ref/Norma:</strong> ${activity.norma_tecnica || 'N/A'}</p>
                        <p><strong>Equipe:</strong> ${activity.equipe_responsavel || 'N/A'}</p>
                        <p><strong>Tipo Manut.:</strong> ${activity.tipo_manutencao || 'N/A'}</p>
                        <p><strong>Periodicidade:</strong> ${activity.periodicidade || 'N/A'}</p>
                    </div>
                    <div class="checklist-item-actions">
                        <button class="btn btn-edit-activity"><i class="material-icons">edit</i> Editar</button>
                        <button class="btn btn-info"><i class="material-icons">check_circle</i> Já realizei</button>
                        ${activity.equipe_responsavel !== 'Local' ? `<button class="btn btn-abrir-chamado"><i class="material-icons">${isOverdue ? 'notification_important' : 'bug_report'}</i> ${isOverdue ? "Abrir Chamado (Vencida)" : "Abrir Chamado"}</button>` : ''}
                    </div>
                </div>`;
            
            const expandableContent = itemDiv.querySelector('.checklist-item-expandable-content');
            itemDiv.querySelector('.checklist-item-header').onclick = () => {
                 expandableContent.classList.toggle('hidden');
                 itemDiv.querySelector('.toggle-details-btn-checklist i').textContent = expandableContent.classList.contains('hidden') ? 'expand_more' : 'expand_less';
            };
            itemDiv.querySelector('.btn-edit-activity').onclick = (e) => { e.stopPropagation(); handlers.openEditModal(activity); };
            itemDiv.querySelector('.btn-abrir-chamado')?.addEventListener('click', (e) => {
                e.stopPropagation();
                handlers.redirectToTicketCreation(activity.id);
            });
            itemDiv.querySelector('.btn-info')?.addEventListener('click', (e) => {
                e.stopPropagation();
                utils.showRealizacaoPrompt(activity); // Agora abre o modal customizado
            });

            return itemDiv;
        }
    };

    const handlers = {
        openEditModal: (activity) => {
            handlers.openModal(activity);
        },
        openModal: (activity = null) => {
            const isEditing = activity !== null;
            state.currentEditingActivityId = isEditing ? activity.id : null;
            
            const form = utils.getById('activityForm');
            form.reset();
            
            utils.getById('createActivityModal').querySelector('h2').textContent = isEditing ? 'Editar Atividade' : 'Nova Atividade';
            form.querySelector('button[type="submit"]').textContent = isEditing ? 'Salvar Alterações' : 'Criar Atividade';

            ui.populateOccurrenceSelect('occurrence-checklist', isEditing ? activity.tipo_ocorrencia_id : null);
            
            if(isEditing){
                utils.getById('titulo-checklist').value = activity.titulo;
                utils.getById('description-checklist').value = activity.descricao;
                utils.getById('norm-checklist').value = activity.norma_tecnica;
                utils.getById('team-checklist').value = activity.equipe_responsavel;
                utils.getById('type-checklist').value = activity.tipo_manutencao;

                const periodSelect = utils.getById('period-checklist');
                const customInput = utils.getById('customPeriod-checklist');
                const periodOptions = Array.from(periodSelect.options).map(opt => opt.value);
                if (periodOptions.includes(activity.periodicidade)) {
                    periodSelect.value = activity.periodicidade;
                } else {
                    periodSelect.value = 'Customizado';
                    customInput.value = activity.periodicidade || '';
                }
            }
            handlers.toggleCustomPeriodInput();
            utils.toggleModal('createActivityModal', true);
        },
        removeActivity: async (activityId, activityTitle) => {
            if (confirm(`Tem certeza que deseja remover "${activityTitle}"?`)) {
                if (await db.deleteActivity(activityId)) {
                    state.activities = state.activities.filter(a => a.id !== activityId);
                    ui.renderChecklistItems();
                }
            }
        },
        handleSubmit: async (event) => {
            event.preventDefault();
            const periodSelectValue = utils.getById('period-checklist').value;
            const customPeriodVal = utils.getById('customPeriod-checklist').value.trim();
            const periodicityValue = periodSelectValue === 'Customizado' ? customPeriodVal : periodSelectValue;
            
            const activityData = {
                titulo: utils.getById('titulo-checklist').value.trim(),
                tipo_ocorrencia_id: utils.getById('occurrence-checklist').value,
                descricao: utils.getById('description-checklist').value.trim(),
                norma_tecnica: utils.getById('norm-checklist').value.trim(),
                equipe_responsavel: utils.getById('team-checklist').value,
                tipo_manutencao: utils.getById('type-checklist').value,
                periodicidade: periodicityValue,
                // Garante que customPeriod é salvo se a periodicidade for 'Customizado'
                customPeriod: periodSelectValue === 'Customizado' ? customPeriodVal : null, 
                proximo_vencimento: utils.calculateNextDeadline(periodSelectValue, customPeriodVal, new Date())
            };

            if (!activityData.titulo || !activityData.tipo_ocorrencia_id) { alert("Título e Sistema são obrigatórios."); return; }
            
            let result;
            if (state.currentEditingActivityId) {
                result = await db.updateActivity(state.currentEditingActivityId, activityData);
                if (result) {
                    const index = state.activities.findIndex(a => a.id === state.currentEditingActivityId);
                    if (index > -1) state.activities[index] = result;
                }
            } else {
                activityData.condominio_id = state.condoId;
                result = await db.addActivity(activityData);
                if(result) state.activities.push(result);
            }

            if (result) {
                state.activities.sort((a, b) => (new Date(a.proximo_vencimento) || Infinity) - (new Date(b.proximo_vencimento) || Infinity));
                ui.renderChecklistItems();
                utils.toggleModal('createActivityModal', false);
            }
        },
        // Novo handler para submissão do modal de realização
        handleRealizacaoSubmit: async (event) => {
            event.preventDefault();
            const activity = state.currentRealizacaoActivity;
            if (!activity) return; // Não há atividade armazenada

            const dataRealizacaoInput = utils.getById('dataRealizacao').value;

            // Validação da data
            if (!dataRealizacaoInput) {
                return alert("Por favor, informe a data da realização.");
            }
            const dataRealizacao = new Date(dataRealizacaoInput + 'T00:00:00'); // Adiciona T00:00:00 para evitar problemas de fuso horário
            if (isNaN(dataRealizacao.getTime())) {
                return alert("Data inválida. Por favor, verifique o dia, mês e ano.");
            }
            
            const novaData = utils.calculateNextDeadline(
                activity.periodicidade,
                activity.customPeriod,
                dataRealizacao
            );

            if (!novaData) {
                alert("Não foi possível calcular a nova data. Verifique a periodicidade ou o valor customizado.");
                return; // Não fecha o modal se houver falha no cálculo
            }
            
            const atualizada = await db.updateActivity(activity.id, { proximo_vencimento: novaData });

            if (atualizada) {
                const index = state.activities.findIndex(a => a.id === activity.id);
                if (index !== -1) {
                    state.activities[index] = atualizada;
                    ui.renderChecklistItems();
                }
            } else {
                alert("Falha ao atualizar a data de periodicidade.");
            }
            utils.toggleModal('realizacaoActivityModal', false); // Fecha o modal após a operação
            state.currentRealizacaoActivity = null; // Limpa a atividade armazenada
        },
        // Novo handler para cancelar o modal de realização
        cancelRealizacao: () => {
            utils.toggleModal('realizacaoActivityModal', false);
            state.currentRealizacaoActivity = null; // Limpa a atividade armazenada
        },
        redirectToTicketCreation: (activityId) => {
            sessionStorage.setItem('sourceActivityIdForTicket', activityId);
            window.location.href = '../pages/manutencao.html';
        },
        handleFilterChange: () => ui.renderChecklistItems(),
        toggleCustomPeriodInput: () => {
            const periodSelect = utils.getById('period-checklist');
            const customInput = utils.getById('customPeriod-checklist');
            customInput.style.display = periodSelect.value === 'Customizado' ? 'block' : 'none';
        }
    };

    const init = async () => {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) { window.location.href = '/www/index.html'; return; }
        
        state.condoId = sessionStorage.getItem('selectedCondoId');
        if (!state.condoId) {
            alert("Condomínio não selecionado! Redirecionando...");
            window.location.href = '/www/pages/inicio.html';
            return;
        }
        
        state.occurrenceTypes = await db.fetchOccurrenceTypes();
        state.activities = await db.fetchActivities();

        // Seed predefined data if no activities exist for the condo
        if (state.activities.length === 0 && state.occurrenceTypes.length === 0) {
            const predefinedData = getPredefinedChecklistData();
            const activitiesToInsert = predefinedData.activities.map(activity => ({
                ...activity,
                condominio_id: state.condoId,
                // Garante mapeamento correto para periodicidade e customPeriod
                periodicidade: activity.period, 
                customPeriod: activity.customPeriod || null, 
                // Define a data de próximo_vencimento inicial para hoje para preenchimento
                proximo_vencimento: utils.calculateNextDeadline(activity.period, activity.customPeriod, new Date())
            }));
            
            const occurrenceTypesToInsert = predefinedData.occurrenceTypes.map(type => ({
                condominio_id: state.condoId,
                nome: type.name,
                chave: type.key
            }));

            if (occurrenceTypesToInsert.length > 0) {
                const { error: occurrenceError } = await supabase.from('tipo_ocorrencia').insert(occurrenceTypesToInsert);
                if (occurrenceError) {
                    console.error("Erro ao inserir tipos de ocorrência padrão:", occurrenceError);
                } else {
                    state.occurrenceTypes = await db.fetchOccurrenceTypes(); // Busca a lista atualizada
                }
            }

            if (activitiesToInsert.length > 0) {
                const { error: activitiesError } = await supabase.from('checklist_activity').insert(activitiesToInsert);
                if (activitiesError) {
                    console.error("Erro ao inserir atividades padrão:", activitiesError);
                } else {
                    state.activities = await db.fetchActivities(); // Busca a lista atualizada
                }
            }
        }
        
        ui.populateOccurrenceSelect('filter-sistema');
        ui.renderChecklistItems();

        utils.getById('openCreateActivityModalButtonChecklist').addEventListener('click', () => handlers.openModal());
        utils.getById('activityForm').addEventListener('submit', handlers.handleSubmit);
        ['filter-equipe', 'filter-periodicidade', 'filter-sistema'].forEach(id => utils.getById(id).addEventListener('change', handlers.handleFilterChange));
        utils.getById('period-checklist').addEventListener('change', handlers.toggleCustomPeriodInput);
        utils.getById('createActivityModal').querySelector('.modal-dynamic-close').addEventListener('click', () => utils.toggleModal('createActivityModal', false));

        // Novos event listeners para o modal de realização
        utils.getById('realizacaoForm').addEventListener('submit', handlers.handleRealizacaoSubmit);
        utils.getById('cancelRealizacaoBtn').addEventListener('click', handlers.cancelRealizacao);
        utils.getById('realizacaoActivityModal').querySelector('.modal-dynamic-close').addEventListener('click', handlers.cancelRealizacao);


        try {
            await PushNotificationManager.register();
        } catch (e) {
            console.error("Falha ao registrar para notificações push:", e);
            // Nota: O erro "Capacitor is not defined" indica que o ambiente de execução pode não ter o Capacitor disponível,
            // o que é esperado se você estiver executando no navegador web em vez de um ambiente Capacitor nativo.
            // Isso não impede o funcionamento da lógica do checklist.
        }
    };

    init().catch(console.error);
});