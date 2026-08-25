/* OfficeFlow Pro v2 — Supabase-backed workspace */
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const defaultConfig = {
    supabaseUrl: 'https://qikxqtqpkgghmstliped.supabase.co',
    supabaseAnonKey: 'sb_publishable_y8mGbwlA89GOl5Mo7lDwVg_fXXfjtWS'
  };
  const cfg = { ...defaultConfig, ...(window.OFFICEFLOW_CONFIG || {}) };
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && !cfg.supabaseUrl.includes('YOUR-PROJECT') && !cfg.supabaseAnonKey.includes('YOUR-SUPABASE'));
  const sb = configured ? supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;

  const state = {
    user: null,
    profile: null,
    documents: [],
    tasks: [],
    approvals: [],
    audit: [],
    notifications: [],
    people: [],
    signatureTargetId: null,
    taskFilter: 'all',
    docFilter: 'all',
    selectedWorkflow: 'indent',
    lineItems: [
      { d: 'HP Heater gasket set', q: 6, u: 'Nos', r: 18000 },
      { d: 'Conical strainer set', q: 2, u: 'Nos', r: 42000 },
      { d: 'Labour / dismantling', q: 1, u: 'Lot', r: 65000 }
    ],
    sig: null,
    sigDrawing: false
  };

  const workflowCatalog = {
    indent: { title: 'Indent & Purchase Requisition', subtitle: 'Requirement → estimate → approval → SAP PR', steps: ['Capture requirement', 'Prepare estimate / basis', 'Route for approval', 'Create and release PR'], checks: ['Clear specification', 'Correct quantity/unit', 'Required date', 'Cost centre / account assignment', 'Supporting estimate attached', 'Approval authority identified'] },
    estimate: { title: 'Estimate Preparation', subtitle: 'Scope → BOQ → costing → sanction', steps: ['Define scope', 'Prepare line items', 'Add rate basis', 'Review total', 'Submit for approval'], checks: ['Rate basis recorded', 'Quantities verified', 'Contingency policy applied', 'Approval note attached'] },
    po: { title: 'Purchase Order', subtitle: 'Approved PR → RFQ → comparison → PO → receipt', steps: ['Approved PR', 'RFQ / quotation', 'Comparative statement', 'Approval', 'PO issue', 'Receipt / MIGO'], checks: ['PR reference verified', 'Vendor eligibility checked', 'Commercial comparison completed', 'PO terms approved', 'Receipt evidence retained'] },
    advance: { title: 'Temporary Advance', subtitle: 'Request → sanction → draw → utilisation → settlement', steps: ['Submit request', 'Sanction', 'Draw amount', 'Utilise and retain bills', 'Settle / refund balance'], checks: ['Purpose justified', 'Dates recorded', 'Bills retained', 'Actual spend reconciled', 'Balance returned / adjusted'] },
    'sap-pr': { title: 'SAP Purchase Requisition', subtitle: 'A guided checklist around common SAP MM PR touchpoints', steps: ['Collect requirement', 'ME51N create PR', 'Validate ME53N', 'Release strategy / approval', 'Handoff to sourcing'], checks: ['Material/service description', 'Quantity & unit', 'Delivery date', 'Account assignment', 'Text / specification', 'Supporting evidence'] }
  };

  function toast(message, type = 'info') {
    const box = $('#toastContainer');
    if (!box) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.innerHTML = `<span>${type === 'success' ? '✓' : type === 'danger' ? '!' : 'i'}</span><strong>${escapeHtml(message)}</strong>`;
    box.appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  const escapeHtml = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  const fmtMoney = n => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const initials = name => (String(name || 'OF').trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase() || 'OF');
  const todayISO = new Date().toISOString().slice(0, 10);

  function openModal(html, extra = '') {
    const m = $('#modal');
    if (!m) return;
    m.querySelector('.modal-card').className = `modal-card ${extra}`.trim();
    $('#modalContent').innerHTML = html;
    m.classList.remove('hidden');
    $$('[data-close-modal]', m).forEach(x => x.onclick = closeModal);
  }
  function closeModal() { $('#modal')?.classList.add('hidden'); }

  async function audit(action, entityType, entityId, detail, afterData = null, beforeData = null) {
    if (!sb || !state.user) return;
    try { await sb.from('audit_logs').insert({ actor_id: state.user.id, action, entity_type: entityType, entity_id: entityId || null, detail, before_data: beforeData, after_data: afterData }); }
    catch (e) { console.warn('audit', e); }
  }

  async function notify(userId, title, message, type = 'info', linkView = null) {
    if (!sb || !userId) return;
    await sb.from('notifications').insert({ user_id: userId, title, message, type, link_view: linkView });
  }

  async function getProfile() {
    let { data, error } = await sb.from('profiles').select('*').eq('id', state.user.id).maybeSingle();
    if (error) throw error;
    if (!data) {
      const meta = state.user.user_metadata || {};
      const payload = { id: state.user.id, full_name: meta.full_name || state.user.email?.split('@')[0] || '', employee_code: meta.employee_code || null, department: meta.department || '', designation: meta.designation || '', role: 'employee' };
      ({ data, error } = await sb.from('profiles').upsert(payload).select().single());
      if (error) throw error;
    }
    return data;
  }

  async function loadData() {
    const q = await Promise.all([
      sb.from('documents').select('*').order('updated_at', { ascending: false }).limit(300),
      sb.from('tasks').select('*').or(`created_by.eq.${state.user.id},assignee_id.eq.${state.user.id}`).order('updated_at', { ascending: false }).limit(300),
      sb.from('approvals').select('*, workflow_items(title,reference_no), documents(title,reference_no)').or(`requested_by.eq.${state.user.id},approver_id.eq.${state.user.id}`).order('created_at', { ascending: false }).limit(100),
      sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(50),
      sb.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(80)
    ]);
    state.documents = q[0].data || [];
    state.tasks = q[1].data || [];
    state.approvals = q[2].data || [];
    state.notifications = q[3].data || [];
    state.audit = q[4].data || [];
    if (state.profile?.role === 'admin' || state.profile?.role === 'manager') {
      const people = await sb.from('profiles').select('*').order('full_name');
      state.people = people.data || [];
    }
    renderAll();
  }

  function renderAll() {
    $('#todayLabel') && ($('#todayLabel').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase());
    const name = state.profile?.full_name || state.user?.email?.split('@')[0] || 'Office User';
    $$('.user-card strong').forEach(x => x.textContent = name);
    $$('.user-card small').forEach(x => x.textContent = state.profile?.designation || state.profile?.role || 'Office User');
    $$('.profile-btn:not(.small)').forEach(x => { const a = $('.avatar', x); if (a) a.textContent = initials(name); const spans = x.querySelectorAll('span'); if (spans[1]) spans[1].textContent = name; });
    const badge = $('#approvalBadge'); if (badge) badge.textContent = state.approvals.filter(a => a.status === 'pending_approval').length;
    const taskBadge = $('#taskBadge'); if (taskBadge) taskBadge.textContent = state.tasks.filter(t => t.status !== 'done').length;
    document.body.classList.toggle('role-admin', ['admin', 'manager'].includes(state.profile?.role));
    const open = state.tasks.filter(t => t.status !== 'done').length + state.approvals.filter(a => a.status === 'pending_approval').length;
    $('#openWorkCount') && ($('#openWorkCount').textContent = open);
    $('#pendingApprovalCount') && ($('#pendingApprovalCount').textContent = state.approvals.filter(a => a.status === 'pending_approval').length);
    $('#digitalFilesCount') && ($('#digitalFilesCount').textContent = state.documents.length);
    $('#processedCount') && ($('#processedCount').textContent = state.documents.filter(d => ['approved','completed'].includes(d.status)).length);
    renderActivity(); renderDocuments(); renderApprovals(); renderTasks(); renderSignatureQueue(); renderPeople(); renderWorkflows();
  }

  function renderActivity() {
    const el = $('#activityList'); if (!el) return;
    const rows = state.audit.slice(0, 8);
    el.innerHTML = rows.length ? rows.map(x => `<div class="activity-item"><div class="activity-dot">${escapeHtml((x.action || '•').slice(0,1).toUpperCase())}</div><div><strong>${escapeHtml(x.detail || x.action)}</strong><small>${fmtDate(x.created_at)}</small></div></div>`).join('') : '<div class="empty-state">No activity yet. Your first saved office record will appear here.</div>';
  }

  function renderDocuments(filter = state.docFilter, query = $('#docSearch')?.value || '') {
    state.docFilter = filter;
    const body = $('#documentsBody'); if (!body) return;
    const q = query.trim().toLowerCase();
    let rows = [...state.documents];
    if (filter === 'pdf') rows = rows.filter(x => String(x.mime_type || '').includes('pdf') || x.category === 'pdf');
    if (filter === 'office') rows = rows.filter(x => !String(x.mime_type || '').includes('pdf'));
    if (filter === 'signed') rows = rows.filter(x => x.status === 'approved' || x.metadata?.signed);
    if (filter === 'pending') rows = rows.filter(x => x.status === 'pending_approval');
    if (q) rows = rows.filter(x => `${x.title} ${x.reference_no || ''} ${x.category} ${x.tags?.join(' ') || ''}`.toLowerCase().includes(q));
    body.innerHTML = rows.length ? rows.map(d => `<tr><td><div class="doc-name"><span class="file-icon">${String(d.mime_type || '').includes('pdf') ? 'PDF' : 'DOC'}</span><div><strong>${escapeHtml(d.title)}</strong><small>${escapeHtml(d.category || 'office')} · v${d.version}</small></div></div></td><td>${escapeHtml(d.reference_no || '—')}</td><td>${d.owner_id === state.user?.id ? 'You' : 'Department'}</td><td><span class="pill ${pillClass(d.status)}">${escapeHtml(labelStatus(d.status))}</span></td><td>${fmtDate(d.updated_at)}</td><td><button class="row-action" data-doc-id="${d.id}" title="Document actions">•••</button></td></tr>`).join('') : `<tr><td colspan="6"><div class="empty-state">No documents found.</div></td></tr>`;
    $$('[data-doc-id]', body).forEach(b => b.onclick = () => openDocumentMenu(b.dataset.docId));
  }

  function openDocumentMenu(id) {
    const d = state.documents.find(x => x.id === id); if (!d) return;
    openModal(`<div class="eyebrow">DOCUMENT</div><h2 class="modal-title">${escapeHtml(d.title)}</h2><p class="modal-sub">${escapeHtml(d.reference_no || 'No reference')} · ${escapeHtml(d.category)}</p><div class="plain-list"><div><b>Status</b><span>${escapeHtml(labelStatus(d.status))}</span></div><div><b>Version</b><span>v${d.version}</span></div><div><b>Updated</b><span>${fmtDate(d.updated_at)}</span></div></div><div class="modal-actions"><button class="btn ghost" id="signThisDoc">✒ Sign</button><button class="btn ghost" id="previewThisDoc">View</button><button class="btn primary" id="approveThisDoc">Send for approval</button></div>`);
    $('#signThisDoc').onclick = () => { state.signatureTargetId = id; closeModal(); showView('signatures'); toast('Document selected for signing'); };
    $('#previewThisDoc').onclick = async () => { if (!d.storage_path) return toast('This record has no stored file yet.', 'danger'); const { data, error } = await sb.storage.from('office-documents').createSignedUrl(d.storage_path, 300); if (error) return toast(error.message, 'danger'); window.open(data.signedUrl, '_blank'); };
    $('#approveThisDoc').onclick = async () => { const { data, error } = await sb.from('documents').update({ status: 'pending_approval' }).eq('id', id).select().single(); if (error) return toast(error.message, 'danger'); await sb.from('approvals').insert({ document_id: id, requested_by: state.user.id, status: 'pending_approval' }); await audit('submitted_for_approval','document',id,`Document ${d.title} submitted for approval`,data); closeModal(); await loadData(); toast('Document sent for approval','success'); };
  }

  function renderApprovals() {
    const box = $('#approvalList'); const auditBox = $('#auditList'); if (!box || !auditBox) return;
    const pending = state.approvals.filter(a => a.status === 'pending_approval');
    box.innerHTML = pending.length ? pending.map(a => `<div class="approval-card"><div><span class="approval-type">${a.document_id ? 'DOCUMENT' : 'WORKFLOW'}</span><h3>${escapeHtml(a.documents?.title || a.workflow_items?.title || 'Office approval')}</h3><p>${escapeHtml(a.documents?.reference_no || a.workflow_items?.reference_no || 'Pending decision')} · requested ${fmtDate(a.created_at)}</p></div><div class="approval-actions"><button class="btn ghost small" data-return="${a.id}">Return</button><button class="btn primary small" data-approve="${a.id}">Approve</button></div></div>`).join('') : '<div class="empty-state">No approvals are waiting for your action.</div>';
    $$('[data-approve]', box).forEach(b => b.onclick = () => decideApproval(b.dataset.approve, 'approved'));
    $$('[data-return]', box).forEach(b => b.onclick = () => decideApproval(b.dataset.return, 'returned'));
    auditBox.innerHTML = state.audit.slice(0, 8).map(x => `<div class="audit-row"><div><strong>${escapeHtml(x.action)}</strong><small>${escapeHtml(x.detail || '')}</small></div><span>${fmtDate(x.created_at)}</span></div>`).join('') || '<div class="empty-state">No audit decisions yet.</div>';
  }

  async function decideApproval(id, decision) {
    const a = state.approvals.find(x => x.id === id); if (!a) return;
    const { error } = await sb.from('approvals').update({ status: decision, approver_id: state.user.id, decided_at: new Date().toISOString(), action_note: decision === 'returned' ? 'Returned for correction' : 'Approved' }).eq('id', id);
    if (error) return toast(error.message, 'danger');
    if (a.document_id) await sb.from('documents').update({ status: decision === 'approved' ? 'approved' : 'returned' }).eq('id', a.document_id);
    if (a.workflow_item_id) await sb.from('workflow_items').update({ status: decision === 'approved' ? 'approved' : 'returned' }).eq('id', a.workflow_item_id);
    await audit(decision, 'approval', id, `Approval ${decision}`);
    if (a.requested_by) await notify(a.requested_by, decision === 'approved' ? 'Approval completed' : 'Approval returned', `Your office item was ${decision}.`, decision === 'approved' ? 'success' : 'warning');
    await loadData(); toast(`Item ${decision === 'approved' ? 'approved' : 'returned'}`, 'success');
  }

  function renderTasks() {
    const el = $('#taskList'); if (!el) return;
    const q = ($('#taskSearch')?.value || '').trim().toLowerCase();
    let list = state.tasks.filter(t => state.taskFilter === 'all' || t.status === state.taskFilter);
    if (q) list = list.filter(t => `${t.title} ${t.description || ''} ${t.department || ''}`.toLowerCase().includes(q));
    el.innerHTML = list.length ? list.map(t => `<article class="task-card"><div class="task-top"><div><h3>${escapeHtml(t.title)}</h3><p>${escapeHtml(t.description || 'No description')}</p></div><span class="pill ${pillClass(t.status)}">${labelStatus(t.status)}</span></div><div class="task-meta"><span class="pill ${pillPriority(t.priority)}">${escapeHtml(t.priority)}</span><span class="inline-status">${t.due_date ? `Due ${fmtDate(t.due_date)}` : 'No due date'}</span></div><div class="task-foot"><span>${escapeHtml(t.assignee_id === state.user.id ? 'Assigned to you' : 'Created by you')}</span><div class="task-actions"><button class="btn ghost small" data-task-action="next" data-id="${t.id}">${t.status === 'done' ? 'Reopen' : 'Advance'}</button><button class="row-action" data-task-action="delete" data-id="${t.id}">×</button></div></div></article>`).join('') : '<div class="task-empty">No tasks match this filter. Create a task to start your work queue.</div>';
    $$('[data-task-action="next"]', el).forEach(b => b.onclick = () => cycleTask(b.dataset.id));
    $$('[data-task-action="delete"]', el).forEach(b => b.onclick = () => deleteTask(b.dataset.id));
  }

  function openTaskModal() {
    openModal(`<div class="eyebrow">WORK QUEUE</div><h2 class="modal-title">Create a task</h2><p class="modal-sub">Tasks remain in the database and can later be linked to a workflow or document.</p><form id="taskForm" class="form-grid"><label class="full-span">Task title<input id="taskTitle" required placeholder="e.g. Verify quotation comparison" /></label><label>Priority<select id="taskPriority"><option>normal</option><option>low</option><option>high</option><option>urgent</option></select></label><label>Due date<input id="taskDue" type="date" min="${todayISO}" /></label><label class="full-span">Description<textarea id="taskDescription" placeholder="Action, evidence needed, or next step"></textarea></label><div class="modal-actions full-span"><button type="button" class="btn ghost" data-close-modal>Cancel</button><button class="btn primary" type="submit">Create task</button></div></form>`,'wide');
    $('#taskForm').onsubmit = async e => { e.preventDefault(); const payload = { created_by: state.user.id, assignee_id: state.user.id, department: state.profile?.department || null, title: $('#taskTitle').value.trim(), priority: $('#taskPriority').value, due_date: $('#taskDue').value || null, description: $('#taskDescription').value.trim() || null }; const { data, error } = await sb.from('tasks').insert(payload).select().single(); if (error) return toast(error.message, 'danger'); await audit('created','task',data.id,`Created task: ${payload.title}`); closeModal(); await loadData(); toast('Task created','success'); };
  }

  async function cycleTask(id) {
    const t = state.tasks.find(x => x.id === id); if (!t) return; const next = { todo: 'in_progress', in_progress: 'done', blocked: 'in_progress', done: 'todo' }[t.status] || 'todo'; const { error } = await sb.from('tasks').update({ status: next }).eq('id', id); if (error) return toast(error.message, 'danger'); await audit('status_changed','task',id,`Task moved from ${t.status} to ${next}`); await loadData(); }
  async function deleteTask(id) { if (!confirm('Delete this task?')) return; const { error } = await sb.from('tasks').delete().eq('id',id); if(error) return toast(error.message,'danger'); await audit('deleted','task',id,'Task deleted'); await loadData(); }

  function renderPeople() {
    const body = $('#peopleBody'); if (!body || !['admin','manager'].includes(state.profile?.role)) return;
    body.innerHTML = state.people.length ? state.people.map(p => `<tr><td><div class="doc-name"><span class="avatar small">${escapeHtml(initials(p.full_name))}</span><div><strong>${escapeHtml(p.full_name || 'Unnamed')}</strong><small>${escapeHtml(p.employee_code || p.id.slice(0,8))}</small></div></div></td><td>${escapeHtml(p.department || '—')}</td><td>${escapeHtml(p.designation || '—')}</td><td><select class="people-role" data-person-role="${p.id}" ${p.id === state.user.id ? 'disabled' : ''}>${['employee','approver','manager','admin'].map(r => `<option ${p.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></td><td>${fmtDate(p.created_at)}</td><td>${p.id === state.user.id ? '<span class="inline-status">Current user</span>' : ''}</td></tr>`).join('') : '<tr><td colspan="6"><div class="empty-state">No users found.</div></td></tr>';
    $$('[data-person-role]', body).forEach(s => s.onchange = async () => { const id = s.dataset.personRole; const old = state.people.find(p => p.id === id); const { error } = await sb.from('profiles').update({ role: s.value }).eq('id', id); if(error){s.value=old.role;return toast(error.message,'danger')} await audit('role_changed','profile',id,`Role changed to ${s.value}`); await loadData(); toast('Role updated','success'); });
  }

  function renderSignatureQueue() {
    const el = $('#signatureQueue'); if (!el) return;
    const docs = state.documents.filter(d => ['pending_approval','draft','returned'].includes(d.status)).slice(0, 10);
    el.innerHTML = docs.length ? docs.map(d => `<div class="signature-queue-item"><strong>${escapeHtml(d.title)}</strong><small>${escapeHtml(labelStatus(d.status))} · ${escapeHtml(d.reference_no || 'No reference')}</small><button class="text-btn" data-sign-target="${d.id}">Select to sign →</button></div>`).join('') : '<div class="empty-state">No documents are currently queued for signing.</div>';
    $$('[data-sign-target]', el).forEach(b => b.onclick = () => { state.signatureTargetId = b.dataset.signTarget; toast('Signing target selected'); });
  }

  function initSignature() {
    const c = $('#signatureCanvas'); if (!c || state.sig) return;
    state.sig = c.getContext('2d'); state.sig.lineWidth = 3; state.sig.lineCap = 'round'; state.sig.lineJoin = 'round';
    const pos = e => { const r = c.getBoundingClientRect(), p = e.touches?.[0] || e; return { x:(p.clientX-r.left)*(c.width/r.width), y:(p.clientY-r.top)*(c.height/r.height) }; };
    c.addEventListener('pointerdown', e => { state.sigDrawing = true; const p=pos(e); state.sig.beginPath(); state.sig.moveTo(p.x,p.y); });
    c.addEventListener('pointermove', e => { if(!state.sigDrawing)return; const p=pos(e); state.sig.lineTo(p.x,p.y); state.sig.stroke(); });
    window.addEventListener('pointerup', () => state.sigDrawing = false);
    $('#clearSig').onclick = () => state.sig.clearRect(0,0,c.width,c.height);
    $('#saveSignature').onclick = saveSignature;
    $('#newSignatureBtn').onclick = () => { if (!state.documents.length) return toast('Upload or create a document first.'); openModal(`<div class="eyebrow">SELECT DOCUMENT</div><h2 class="modal-title">Choose a document to sign</h2><div class="plain-list">${state.documents.slice(0,15).map(d=>`<div class="signature-target"><div><strong>${escapeHtml(d.title)}</strong><small>${escapeHtml(d.reference_no || '')} · ${escapeHtml(labelStatus(d.status))}</small></div><button class="btn primary small" data-select-sign="${d.id}">Select</button></div>`).join('')}</div>`,'wide'); $$('[data-select-sign]').forEach(b=>b.onclick=()=>{state.signatureTargetId=b.dataset.selectSign;closeModal();toast('Document selected. Draw and apply the signature.');}); };
  }

  async function saveSignature() {
    if (!state.signatureTargetId) return toast('Select a document to sign first.','danger');
    const c=$('#signatureCanvas'), image=state.sig.getImageData(0,0,c.width,c.height).data; let has=false; for(let i=3;i<image.length;i+=4){if(image[i]>0){has=true;break;}} if(!has)return toast('Please draw a signature first.','danger');
    const signerName = $('#signerName').value.trim() || state.profile.full_name; const designation = $('.sign-meta input:nth-of-type(2)')?.value || state.profile.designation || '';
    const signatureData = c.toDataURL('image/png'); let hash=''; try { const bytes = new TextEncoder().encode(signatureData); const digest=await crypto.subtle.digest('SHA-256',bytes); hash=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join(''); } catch { hash = btoa(signatureData).slice(0,64); }
    const { data, error }=await sb.from('signatures').insert({ document_id:state.signatureTargetId, signer_id:state.user.id, signer_name:signerName, designation, signature_data:signatureData, signature_hash:hash }).select().single(); if(error)return toast(error.message,'danger'); await sb.from('documents').update({ status:'approved', metadata:{signed:true, signature_id:data.id} }).eq('id',state.signatureTargetId); await audit('signed','document',state.signatureTargetId,`Digitally signed by ${signerName}`,{signature_hash:hash}); await loadData(); state.sig.clearRect(0,0,c.width,c.height); state.signatureTargetId=null; toast('Signature saved with verification hash','success');
  }

  function renderEstimate() {
    const body=$('#estimateRows'); if(!body)return;
    body.innerHTML=state.lineItems.map((r,i)=>`<tr><td><input class="est-desc" data-i="${i}" value="${escapeHtml(r.d)}"></td><td><input class="est-qty" data-i="${i}" type="number" value="${r.q}"></td><td><input class="est-unit" data-i="${i}" value="${escapeHtml(r.u)}"></td><td><input class="est-rate" data-i="${i}" type="number" value="${r.r}"></td><td>${fmtMoney(r.q*r.r)}</td><td><button class="row-action" data-del-est="${i}">×</button></td></tr>`).join('');
    $$('input',body).forEach(inp=>inp.oninput=()=>{const i=+inp.dataset.i; const k=inp.classList.contains('est-desc')?'d':inp.classList.contains('est-qty')?'q':inp.classList.contains('est-unit')?'u':'r'; state.lineItems[i][k]=['q','r'].includes(k)?Number(inp.value):inp.value; updateEstimateTotals();});
    $$('[data-del-est]',body).forEach(b=>b.onclick=()=>{state.lineItems.splice(+b.dataset.delEst,1);renderEstimate();}); updateEstimateTotals();
  }
  function updateEstimateTotals(){const sub=state.lineItems.reduce((s,r)=>s+Number(r.q||0)*Number(r.r||0),0), cont=Math.round(sub*.05); $('#estimateSubtotal') && ($('#estimateSubtotal').textContent=fmtMoney(sub)); $('#estimateContingency') && ($('#estimateContingency').textContent=fmtMoney(cont)); $('#estimateGrand') && ($('#estimateGrand').textContent=fmtMoney(sub+cont));}

  async function submitEstimate() {
    const title=$('#estimateTitle').value.trim()||'Office Estimate', type=$('#estimateType').value, note=$('#estimateNote').value.trim(); const sub=state.lineItems.reduce((s,r)=>s+r.q*r.r,0),cont=Math.round(sub*.05),total=sub+cont;
    const wf = await sb.from('workflow_items').insert({owner_id:state.user.id,department:state.profile?.department,title,description:note||null,status:'pending_approval',priority:'normal',amount:total,current_step:3,total_steps:5,metadata:{estimate_type:type}}).select().single(); if(wf.error)return toast(wf.error.message,'danger');
    const est=await sb.from('estimates').insert({owner_id:state.user.id,workflow_item_id:wf.data.id,title,estimate_type:type,note,subtotal:sub,contingency:cont,total,status:'pending_approval'}).select().single(); if(est.error)return toast(est.error.message,'danger');
    const items=state.lineItems.map(r=>({estimate_id:est.data.id,description:r.d,quantity:r.q,unit:r.u,rate:r.r})); if(items.length) await sb.from('estimate_items').insert(items);
    await sb.from('approvals').insert({workflow_item_id:wf.data.id,requested_by:state.user.id,status:'pending_approval'}); await audit('submitted_for_approval','estimate',est.data.id,`Estimate ${title} submitted for approval`,{total}); await loadData(); toast('Estimate submitted for approval','success');
  }

  async function submitIndent(e) {
    e.preventDefault();
    const title=$('#indentTitle').value.trim(), department=$('#indentDepartment').value, priority=$('#indentPriority').value.toLowerCase(), dueDate=$('#indentDueDate').value, desc=$('#indentDescription').value.trim(), amount=Number($('#indentAmount').value||0);
    const ref=`REQ-${new Date().getFullYear()}-${Math.floor(10000+Math.random()*89999)}`;
    const wf=await sb.from('workflow_items').insert({owner_id:state.user.id,department,title,description:desc,status:'pending_approval',priority:priority==='urgent'?'urgent':priority==='emergency'?'urgent':priority,due_date:dueDate||null,amount,reference_no:ref,current_step:3,total_steps:4}).select().single(); if(wf.error)return toast(wf.error.message,'danger');
    const files=$('#indentForm input[type=file]')?.files || []; for(const f of files){const safe=`${state.user.id}/${Date.now()}-${f.name.replace(/[^\w.() -]/g,'_')}`;const up=await sb.storage.from('office-documents').upload(safe,f,{upsert:false});if(!up.error){await sb.from('documents').insert({owner_id:state.user.id,department,title:f.name,reference_no:ref,category:'office',storage_path:safe,mime_type:f.type||'application/octet-stream',file_size:f.size,status:'draft',metadata:{workflow_item_id:wf.data.id}});}}
    await sb.from('approvals').insert({workflow_item_id:wf.data.id,requested_by:state.user.id,status:'pending_approval'}); await audit('created','workflow',wf.data.id,`Created requirement ${title}`,wf.data); await loadData(); showView('workflows'); state.selectedWorkflow='indent'; renderWorkflows(); toast('Requirement saved and approval started','success');
  }

  async function submitAdvance(e) {
    e.preventDefault(); const f=e.target, purpose=f.querySelector('select').value, amount=Number(f.querySelector('input[type=number]').value), dates=f.querySelectorAll('input[type=date]'), justification=f.querySelector('textarea').value.trim();
    const wf=await sb.from('workflow_items').insert({owner_id:state.user.id,department:state.profile?.department,title:`Temporary Advance — ${purpose}`,description:justification,status:'pending_approval',priority:'normal',amount,current_step:2,total_steps:5}).select().single(); if(wf.error)return toast(wf.error.message,'danger');
    const adv=await sb.from('advance_requests').insert({owner_id:state.user.id,workflow_item_id:wf.data.id,purpose,amount,required_on:dates[0].value||null,expected_settlement_date:dates[1].value||null,justification,status:'pending_approval'}).select().single(); if(adv.error)return toast(adv.error.message,'danger'); await sb.from('approvals').insert({workflow_item_id:wf.data.id,requested_by:state.user.id,status:'pending_approval'}); await audit('created','advance_request',adv.data.id,`Created temporary advance request for ${fmtMoney(amount)}`); await loadData(); toast('Temporary advance request sent for sanction','success'); f.reset();
  }

  async function createPO() {
    openModal(`<div class="eyebrow">PROCUREMENT FLOW</div><h2 class="modal-title">Create PO tracker</h2><form id="poForm" class="form-grid"><label>PR reference<input id="poPR" required placeholder="PR-4500033159"></label><label>PO reference<input id="poRef" placeholder="PO-2026-xxx"></label><label>Vendor<input id="poVendor" required placeholder="Vendor name"></label><label>Amount<input id="poAmount" type="number" min="0" required placeholder="0"></label><label class="full-span">Description<textarea id="poDescription" required placeholder="What is being procured?"></textarea></label><label>Due date<input id="poDue" type="date"></label><label>Stage<select id="poStage"><option>RFQ</option><option>Comparison</option><option>PO issue</option><option>Vendor confirmed</option><option>Receipt</option></select></label><div class="modal-actions full-span"><button class="btn ghost" type="button" data-close-modal>Cancel</button><button class="btn primary">Create tracker</button></div></form>`,'wide');
    $('#poForm').onsubmit=async e=>{e.preventDefault();const p={owner_id:state.user.id,po_ref:$('#poRef').value.trim()||`PO-${new Date().getFullYear()}-${Math.floor(100+Math.random()*899)}`,pr_ref:$('#poPR').value.trim(),vendor_name:$('#poVendor').value.trim(),amount:Number($('#poAmount').value),description:$('#poDescription').value.trim(),due_date:$('#poDue').value||null,stage:$('#poStage').value,status:'in_progress'};const {data,error}=await sb.from('purchase_orders').insert(p).select().single();if(error)return toast(error.message,'danger');await audit('created','purchase_order',data.id,`Created PO tracker ${p.po_ref}`,p);closeModal();await loadData();toast('PO tracker created','success');};
  }

  async function loadNotifications() {
    const unread=state.notifications.filter(n=>!n.read_at); const items=state.notifications.slice(0,12); openModal(`<div class="eyebrow">NOTIFICATIONS</div><h2 class="modal-title">${unread.length} unread</h2><div class="plain-list">${items.length?items.map(n=>`<div><b>${escapeHtml(n.title)}</b><span>${escapeHtml(n.message||'')}</span><small>${fmtDate(n.created_at)}</small></div>`).join(''):'<div class="empty-state">No notifications.</div>'}</div><div class="modal-actions"><button class="btn primary" id="markReadAll">Mark all read</button></div>`,'wide'); $('#markReadAll').onclick=async()=>{await sb.from('notifications').update({read_at:new Date().toISOString()}).eq('user_id',state.user.id).is('read_at',null);closeModal();await loadData();toast('Notifications marked as read','success');};
  }

  function renderWorkflows(){const side=$('#workflowSidebar'),detail=$('#workflowDetail'); if(!side||!detail)return; const keys=Object.keys(workflowCatalog);side.innerHTML=keys.map(k=>`<button class="workflow-side-item ${state.selectedWorkflow===k?'active':''}" data-wf="${k}"><strong>${escapeHtml(workflowCatalog[k].title)}</strong><small>${escapeHtml(workflowCatalog[k].subtitle)}</small></button>`).join(''); const w=workflowCatalog[state.selectedWorkflow]||workflowCatalog.indent;detail.innerHTML=`<div class="panel workflow-hero"><div class="panel-kicker">GUIDED PROCESS</div><h2>${escapeHtml(w.title)}</h2><p>${escapeHtml(w.subtitle)}</p><div class="stepper">${w.steps.map((x,i)=>`<div class="stepper-item ${i===0?'active':''}"><b>${String(i+1).padStart(2,'0')}</b><span>${escapeHtml(x)}</span></div>`).join('<i>→</i>')}</div></div><div class="panel"><div class="panel-head"><div><div class="panel-kicker">WHAT TO CHECK</div><h2>Control checklist</h2></div></div><div class="checklist">${w.checks.map(x=>`<label><input type="checkbox"> ${escapeHtml(x)}</label>`).join('')}</div><div class="tip"><strong>OfficeFlow rule</strong><span>Do the step, store the supporting evidence, record the decision, and move the item only when the prerequisite is complete.</span></div></div>`;$$('[data-wf]',side).forEach(b=>b.onclick=()=>{state.selectedWorkflow=b.dataset.wf;renderWorkflows();});}

  function pillClass(status){return ['approved','completed','done'].includes(status)?'success':['pending_approval','in_progress','warning'].includes(status)?'warning':['returned','rejected','blocked','cancelled'].includes(status)?'danger':'info';}
  function pillPriority(p){return p==='urgent'||p==='high'?'danger':p==='normal'?'info':'success';}
  function labelStatus(s){return String(s||'draft').replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());}

  function showView(view){ $$('.view').forEach(v=>v.classList.remove('active')); $('#view-'+view)?.classList.add('active'); $$('.nav-item').forEach(n=>n.classList.toggle('active',n.dataset.view===view)); const titleMap={dashboard:'Dashboard',workflows:'Workflows',documents:'Documents',tasks:'My To-Do List',approvals:'Approvals',signatures:'Digital Signature',sap:'SAP Process Guide',indent:'Indent & PR',estimate:'Estimates',po:'Purchase Orders',advance:'Temporary Advance',people:'People & Roles'};$('#pageTitle').textContent=titleMap[view]||'Dashboard'; window.scrollTo({top:0,behavior:'smooth'});}

  async function initApp(){
    const gate=$('#authGate'); gate?.classList.remove('hidden');
    if(!configured){ gate?.classList.add('hidden'); openModal(`<div class="eyebrow">DATABASE SETUP</div><h2 class="modal-title">Connect OfficeFlow to Supabase</h2><p class="modal-sub">The UI is ready. Add your project URL and anon/publishable key to <strong>supabase-config.js</strong>, run <strong>supabase-schema.sql</strong> in Supabase SQL Editor, then reload.</p><div class="setup-inline">Never place a Supabase service-role/secret key in this website.</div><div class="modal-actions"><button class="btn primary" id="goLogin">Open sign in / register</button></div>`); $('#goLogin').onclick=()=>location.href='login.html'; return; }
    const {data,error}=await sb.auth.getSession(); if(error||!data.session){location.href='login.html';return;} state.user=data.session.user; state.profile=await getProfile(); if(state.profile?.role)document.body.classList.add(`role-${state.profile.role}`); gate?.classList.add('hidden'); await loadData(); bindUI(); initSignature(); renderEstimate();
    sb.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT')location.href='login.html';if(session){state.user=session.user;}});
  }

  function bindUI(){
    $$('.nav-item').forEach(b=>b.onclick=()=>{if(b.classList.contains('admin-only')&&!['admin','manager'].includes(state.profile?.role))return;showView(b.dataset.view);$('#sidebar')?.classList.remove('open');});
    $$('[data-view-link]').forEach(b=>b.onclick=()=>showView(b.dataset.viewLink));
    $$('[data-workflow]').forEach(b=>b.onclick=()=>{state.selectedWorkflow=b.dataset.workflow;showView('workflows');renderWorkflows();});
    $$('.quick-card').forEach(b=>b.onclick=()=>{const wf=b.dataset.workflow;showView(wf); if(wf!=='indent')state.selectedWorkflow=wf;});
    $('#mobileMenu').onclick=()=>$('#sidebar')?.classList.toggle('open');
    $('#globalSearchBtn').onclick=()=>openSearch();
    $('#notifBtn').onclick=loadNotifications;
    $('#profileBtn').onclick=openProfile;
    $('#settingsBtn').onclick=openSettings;
    $('#quickCreateBtn').onclick=()=>openCreateMenu();
    $('#docFilters')?.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;$$('#docFilters button').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderDocuments(b.dataset.filter,$('#docSearch').value)});
    $('#docSearch')?.addEventListener('input',e=>renderDocuments(state.docFilter,e.target.value));
    $('#uploadBtn').onclick=openUpload;
    $('#approveAllBtn').onclick=async()=>{for(const a of state.approvals.filter(x=>x.status==='pending_approval'))await decideApproval(a.id,'approved');};
    $('#addEstimateRow')?.addEventListener('click',()=>{state.lineItems.push({d:'New line item',q:1,u:'Nos',r:0});renderEstimate();});
    $('#submitEstimate')?.addEventListener('click',e=>{e.preventDefault();submitEstimate();});
    $('#indentForm')?.addEventListener('submit',submitIndent);
    $('#advanceForm')?.addEventListener('submit',submitAdvance);
    $('#newPOBtn')?.addEventListener('click',createPO);
    $('#newTaskBtn')?.addEventListener('click',openTaskModal);
    $('#taskFilters')?.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;state.taskFilter=b.dataset.taskFilter;$$('#taskFilters button').forEach(x=>x.classList.remove('active'));b.classList.add('active');renderTasks();});
    $('#taskSearch')?.addEventListener('input',renderTasks);
    $$('[data-close-modal]').forEach(b=>b.onclick=closeModal);
    $('#logoutBtn')?.addEventListener('click',async()=>{await sb.auth.signOut();});
    document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openSearch();}});
  }

  function openSearch(){openModal(`<div class="eyebrow">GLOBAL SEARCH</div><h2 class="modal-title">Search OfficeFlow</h2><p class="modal-sub">Search your database records by filename, reference, task or workflow.</p><div class="table-search" style="width:100%"><span>⌕</span><input id="globalSearchInput" autofocus placeholder="PR-4500033159, gasket, estimate…"></div><div id="globalResults" class="plain-list"></div>`,'wide'); const input=$('#globalSearchInput'); const run=()=>{const q=input.value.trim().toLowerCase();const docs=state.documents.filter(d=>`${d.title} ${d.reference_no||''}`.toLowerCase().includes(q)).slice(0,8);const tasks=state.tasks.filter(t=>`${t.title} ${t.description||''}`.toLowerCase().includes(q)).slice(0,8);$('#globalResults').innerHTML=q?(docs.map(d=>`<div><b>Document · ${escapeHtml(d.title)}</b><span>${escapeHtml(d.reference_no||'')}</span></div>`).join('')+tasks.map(t=>`<div><b>Task · ${escapeHtml(t.title)}</b><span>${labelStatus(t.status)}</span></div>`).join('')||'<div class="empty-state">No matching records.</div>'):'<div class="tip"><strong>Tip</strong><span>Use a reference number or keyword to search the records already loaded for your account.</span></div>';};input.addEventListener('input',run);run();}

  function openProfile(){const p=state.profile||{};openModal(`<div class="eyebrow">ACCOUNT</div><h2 class="modal-title">${escapeHtml(p.full_name||state.user.email)}</h2><p class="modal-sub">${escapeHtml(p.designation||'Office User')} · ${escapeHtml(p.department||'No department')}</p><div class="plain-list"><div><b>Email</b><span>${escapeHtml(state.user.email)}</span></div><div><b>Employee code</b><span>${escapeHtml(p.employee_code||'—')}</span></div><div><b>Role</b><span>${escapeHtml(p.role)}</span></div></div><div class="modal-actions"><button class="btn ghost" id="editProfileBtn">Edit profile</button><button class="btn primary" id="signOutBtn">Sign out</button></div>`);$('#signOutBtn').onclick=async()=>{await sb.auth.signOut();};$('#editProfileBtn').onclick=openEditProfile;}
  function openEditProfile(){const p=state.profile;openModal(`<div class="eyebrow">PROFILE</div><h2 class="modal-title">Update profile</h2><form id="profileForm" class="form-grid"><label>Full name<input id="pfName" required value="${escapeHtml(p.full_name)}"></label><label>Employee code<input id="pfCode" value="${escapeHtml(p.employee_code||'')}"></label><label>Department<input id="pfDept" value="${escapeHtml(p.department||'')}"></label><label>Designation<input id="pfDesignation" value="${escapeHtml(p.designation||'')}"></label><div class="modal-actions full-span"><button type="button" class="btn ghost" data-close-modal>Cancel</button><button class="btn primary">Save profile</button></div></form>`);$('#profileForm').onsubmit=async e=>{e.preventDefault();const payload={full_name:$('#pfName').value.trim(),employee_code:$('#pfCode').value.trim()||null,department:$('#pfDept').value.trim()||null,designation:$('#pfDesignation').value.trim()||null};const {data,error}=await sb.from('profiles').update(payload).eq('id',state.user.id).select().single();if(error)return toast(error.message,'danger');state.profile=data;closeModal();renderAll();toast('Profile updated','success');};}
  function openSettings(){openModal(`<div class="eyebrow">SETTINGS</div><h2 class="modal-title">Workspace settings</h2><div class="checklist"><label><input type="checkbox" checked> Approval notifications</label><label><input type="checkbox" checked> Save audit history</label><label><input type="checkbox" checked> Keep task reminders visible</label></div><div class="setup-inline">Database: Supabase · Auth: email/password · Row Level Security: ${configured?'configured in SQL schema':'pending setup'} </div>`);}
  function openCreateMenu(){openModal(`<div class="eyebrow">CREATE NEW WORK</div><h2 class="modal-title">Choose an office process</h2><p class="modal-sub">Each action creates a database record and can be connected to documents, approvals and tasks.</p><div class="quick-grid" style="grid-template-columns:1fr 1fr"><button class="quick-card" data-create-view="indent"><span class="quick-icon blue">≡</span><span><strong>Indent & PR</strong><small>Requirement → approval</small></span></button><button class="quick-card" data-create-view="estimate"><span class="quick-icon purple">▤</span><span><strong>Estimate</strong><small>BOQ → sanction</small></span></button><button class="quick-card" data-create-view="po"><span class="quick-icon orange">◫</span><span><strong>PO tracker</strong><small>PR → PO → receipt</small></span></button><button class="quick-card" data-create-view="advance"><span class="quick-icon green">₹</span><span><strong>Temporary advance</strong><small>Request → settlement</small></span></button><button class="quick-card" data-create-view="tasks"><span class="quick-icon blue">☑</span><span><strong>Task</strong><small>Personal work queue</small></span></button></div>`);$$('[data-create-view]').forEach(b=>b.onclick=()=>{closeModal();const v=b.dataset.createView;if(v==='tasks')openTaskModal();else showView(v);});}
  async function openUpload(){openModal(`<div class="eyebrow">DIGITAL RECORDS</div><h2 class="modal-title">Add document</h2><p class="modal-sub">Files are uploaded to the private <code>office-documents</code> storage bucket.</p><form id="uploadForm" class="form-grid"><label class="full-span">File<input id="docFile" type="file" required accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"></label><label>Title<input id="docTitle" required placeholder="Document title"></label><label>Reference<input id="docRef" placeholder="PR / PO / EST reference"></label><label>Category<select id="docCategory"><option>pdf</option><option>office</option><option>approval</option><option>supporting</option></select></label><label>Status<select id="docStatus"><option value="draft">Draft</option><option value="pending_approval">Needs approval</option></select></label><label class="full-span">Tags<input id="docTags" placeholder="gasket, maintenance, heater"></label><div class="modal-actions full-span"><button type="button" class="btn ghost" data-close-modal>Cancel</button><button class="btn primary">Upload & save</button></div></form>`,'wide');$('#uploadForm').onsubmit=async e=>{e.preventDefault();const file=$('#docFile').files[0],safe=`${state.user.id}/${Date.now()}-${file.name.replace(/[^\w.() -]/g,'_')}`;const up=await sb.storage.from('office-documents').upload(safe,file,{upsert:false});if(up.error)return toast(up.error.message,'danger');const {data,error}=await sb.from('documents').insert({owner_id:state.user.id,department:state.profile?.department,title:$('#docTitle').value.trim(),reference_no:$('#docRef').value.trim()||null,category:$('#docCategory').value,mime_type:file.type,file_size:file.size,status:$('#docStatus').value,storage_path:safe,tags:$('#docTags').value.split(',').map(x=>x.trim()).filter(Boolean)}).select().single();if(error){await sb.storage.from('office-documents').remove([safe]);return toast(error.message,'danger');}await audit('uploaded','document',data.id,`Uploaded ${data.title}`);closeModal();await loadData();toast('Document uploaded','success');};}

  initApp();
})();
