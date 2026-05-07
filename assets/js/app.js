/* ═══════════════════════════════════════════════════════════════
   CORRÊA ASSESSORIA · app.js
   Navegação, modais, toasts
═══════════════════════════════════════════════════════════════ */

// ── Navegação ─────────────────────────────────────────────────
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

function navTo(pageId) {
  // Páginas
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + pageId);
  if (target) target.classList.add('active');

  // Nav items
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.querySelector(`.nav-item[data-page="${pageId}"]`);
  if (navEl) navEl.classList.add('active');

  // Breadcrumb
  const label = document.getElementById('tb-current-page');
  if (label) label.textContent = pageLabels[pageId] || pageId;

  // Fechar sidebar mobile
  if (window.innerWidth < 768) {
    document.getElementById('sidebar').classList.add('collapsed');
  }
}

// Cliques na sidebar
document.querySelectorAll('.nav-item[data-page]').forEach(item => {
  item.addEventListener('click', () => navTo(item.dataset.page));
});

// Botões na topbar com data-nav
document.querySelectorAll('[data-nav]').forEach(el => {
  el.addEventListener('click', () => navTo(el.dataset.nav));
});

// ── Sidebar collapse ──────────────────────────────────────────
document.getElementById('sidebarToggle').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('collapsed');
});

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

// Fechar modal com ESC
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => {
      m.classList.remove('open');
      document.body.style.overflow = '';
    });
  }
});

// ── Toasts ────────────────────────────────────────────────────
function showToast(msg, type = 'default', duration = 3500) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast' + (type !== 'default' ? ' ' + type : '');

  const icons = {
    success: '✓',
    error:   '✕',
    warning: '⚠',
    default: 'ℹ',
  };
  toast.innerHTML = `<span style="font-weight:700;font-size:15px">${icons[type] || icons.default}</span><span>${msg}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity .3s';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ── Init ──────────────────────────────────────────────────────
navTo('dashboard');
