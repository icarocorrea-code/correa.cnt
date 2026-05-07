/* ═══════════════════════════════════════════════════════════════
   CORRÊA ASSESSORIA · app.js
   Navegação SPA, sidebar/drawer, bottom nav, modais, toasts
═══════════════════════════════════════════════════════════════ */

const pageLabels = {
  dashboard:  'Dashboard',
  clientes:   'Clientes',
  obrigacoes: 'Obrigações',
  tarefas:    'Tarefas',
  documentos: 'Documentos',
  financeiro: 'Financeiro',
  relatorios: 'Relatórios',
  whatsapp:   'WhatsApp',
  email:      'E-mail',
  portal:     'Portal do Cliente',
  config:     'Configurações',
};

// ── Navegação ─────────────────────────────────────────────────
function navTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + pageId);
  if (target) { target.classList.add('active'); }

  document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.remove('active'));
  const navEl = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  if (navEl) navEl.classList.add('active');

  document.querySelectorAll('.bn-item[data-page]').forEach(n => n.classList.remove('active'));
  const bnEl = document.querySelector(`.bn-item[data-page="${pageId}"]`);
  if (bnEl) bnEl.classList.add('active');

  const label = document.getElementById('tb-current-page');
  if (label) label.textContent = pageLabels[pageId] || pageId;

  closeMobileDrawer();
  document.getElementById('content')?.scrollTo({ top: 0, behavior: 'smooth' });
}

document.querySelectorAll('.nav-item[data-page]').forEach(item =>
  item.addEventListener('click', () => navTo(item.dataset.page))
);
document.querySelectorAll('.bn-item[data-page]').forEach(item =>
  item.addEventListener('click', () => navTo(item.dataset.page))
);
document.querySelectorAll('[data-nav]').forEach(el =>
  el.addEventListener('click', () => navTo(el.dataset.nav))
);

// ── Sidebar (desktop) collapse ────────────────────────────────
const sidebarToggle = document.getElementById('sidebarToggle');
if (sidebarToggle) {
  sidebarToggle.addEventListener('click', () =>
    document.getElementById('sidebar').classList.toggle('collapsed')
  );
}

// ── Mobile drawer ─────────────────────────────────────────────
function openMobileDrawer() {
  document.getElementById('sidebar').classList.add('mobile-open');
  document.getElementById('sidebar-overlay').classList.add('visible');
  document.body.style.overflow = 'hidden';
}
function closeMobileDrawer() {
  document.getElementById('sidebar').classList.remove('mobile-open');
  document.getElementById('sidebar-overlay').classList.remove('visible');
  document.body.style.overflow = '';
}

document.getElementById('hamburger-btn')?.addEventListener('click', openMobileDrawer);
document.getElementById('sidebar-overlay')?.addEventListener('click', closeMobileDrawer);

// ── Modais ────────────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) { el.classList.remove('open'); document.body.style.overflow = ''; }
}
function closeModalOutside(e, id) {
  if (e.target === e.currentTarget) closeModal(id);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
    document.body.style.overflow = '';
    closeMobileDrawer();
  }
});

// ── Toasts ────────────────────────────────────────────────────
function showToast(msg, type = 'default', duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast' + (type !== 'default' ? ' ' + type : '');
  const icons = { success: '✓', error: '✕', warning: '⚠', default: 'ℹ' };
  toast.innerHTML = `<span style="font-weight:700;font-size:15px">${icons[type] || icons.default}</span><span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0'; toast.style.transition = 'opacity .3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Init ──────────────────────────────────────────────────────
navTo('dashboard');
