// ─── State ────────────────────────────────────────────────────
let currentPage = 'dashboard';
let charts = {};

// ─── Navigation ───────────────────────────────────────────────
function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const pageEl = document.getElementById('page-' + page);
  if (pageEl) pageEl.classList.add('active');

  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add('active');

  const titles = {
    dashboard: 'Dashboard', patients: 'Patient Database', register: 'Register Patient',
    complaints: 'Complaints', 'submit-complaint': 'Submit Complaint', analytics: 'Analytics',
    notifications: 'Notifications', chatbot: 'AI Assistant', admin: 'Admin Panel', settings: 'Settings'
  };
  document.getElementById('page-title').textContent = titles[page] || page;
  currentPage = page;

  // Load page data
  if (page === 'dashboard') loadDashboard();
  else if (page === 'patients') loadPatients();
  else if (page === 'complaints') loadComplaints();
  else if (page === 'analytics') loadAnalytics();
  else if (page === 'notifications') loadNotifications();
  else if (page === 'admin') loadAdmin();
  else if (page === 'settings') loadSettings();

  // Close sidebar on mobile
  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('open');
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ─── Live Clock ───────────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const t = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const d = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  document.getElementById('live-time').textContent = `${d} ${t}`;
}
setInterval(updateClock, 1000);
updateClock();

// ─── Toast ────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.className = 'toast', 3000);
}

// ─── API Helper ───────────────────────────────────────────────
async function api(url, method = 'GET', body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  return res.json();
}

// ─── Chart Helpers ────────────────────────────────────────────
const chartDefaults = {
  color: (ctx) => {
    const palette = ['#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4'];
    return palette[ctx.dataIndex % palette.length];
  }
};

function destroyChart(id) {
  if (charts[id]) { charts[id].destroy(); delete charts[id]; }
}

// ─── DASHBOARD ────────────────────────────────────────────────
async function loadDashboard() {
  const data = await api('/api/dashboard');

  document.getElementById('m-patients').textContent = data.total_patients;
  document.getElementById('m-complaints').textContent = data.total_complaints;
  document.getElementById('m-critical').textContent = data.critical_cases;
  document.getElementById('m-resolution').textContent = data.resolution_rate + '%';

  if (data.critical_cases > 0) {
    document.getElementById('m-critical-label').textContent = `↑ ${data.critical_cases} Active`;
  }

  // Weekly chart
  destroyChart('weekly');
  const wCtx = document.getElementById('weeklyChart').getContext('2d');
  charts['weekly'] = new Chart(wCtx, {
    type: 'bar',
    data: {
      labels: data.weekly.map(d => d.day),
      datasets: [{
        data: data.weekly.map(d => d.count),
        backgroundColor: 'rgba(14,165,233,0.3)',
        borderColor: '#0ea5e9',
        borderWidth: 2,
        borderRadius: 6,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#1e2d45' }, ticks: { color: '#64748b', font: { size: 11 } } },
        y: { grid: { color: '#1e2d45' }, ticks: { color: '#64748b', stepSize: 1, font: { size: 11 } }, beginAtZero: true, max: Math.max(...data.weekly.map(d=>d.count), 5) + 1 }
      },
      layout: { padding: { top: 4 } }
    }
  });

  // Severity donut
  destroyChart('severityDonut');
  const sevData = {};
  data.severity_stats.forEach(s => sevData[s.severity] = s.count);
  const sdCtx = document.getElementById('severityDonut').getContext('2d');
  charts['severityDonut'] = new Chart(sdCtx, {
    type: 'doughnut',
    data: {
      labels: Object.keys(sevData),
      datasets: [{
        data: Object.values(sevData),
        backgroundColor: ['#10b981', '#f59e0b', '#ef4444', '#dc2626'],
        borderColor: '#111827', borderWidth: 3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#64748b', font: { size: 11 }, padding: 12 } }
      },
      cutout: '65%'
    }
  });

  // Activity feed
  const feed = document.getElementById('activity-feed');
  if (data.recent_activity.length === 0) {
    feed.innerHTML = '<div class="loading-pulse">No recent activity</div>';
    return;
  }
  feed.innerHTML = data.recent_activity.map(a => {
    const dotColors = { Low: '#10b981', Medium: '#f59e0b', High: '#ef4444', Critical: '#dc2626' };
    const color = dotColors[a.severity] || '#64748b';
    const time = new Date(a.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<div class="activity-item">
      <div class="activity-dot" style="background:${color};box-shadow:0 0 6px ${color}"></div>
      <div class="activity-text">
        Complaint from <strong>${a.actor}</strong>
      </div>
      <span class="severity-badge sev-${a.severity}">${a.severity}</span>
      <span class="status-badge stat-${a.status.replace(' ', '-')}">${a.status}</span>
      <div class="activity-time">${time}</div>
    </div>`;
  }).join('');

  updateNotifBadge();
}

// ─── PATIENTS ─────────────────────────────────────────────────
async function loadPatients() {
  const search = document.getElementById('patient-search')?.value || '';
  const dept = document.getElementById('dept-filter')?.value || '';
  const data = await api(`/api/patients?search=${encodeURIComponent(search)}&department=${encodeURIComponent(dept)}`);
  renderPatientsTable(data);
}

function renderPatientsTable(patients) {
  const tbody = document.getElementById('patients-tbody');
  if (patients.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">No patients found</td></tr>';
    return;
  }
  tbody.innerHTML = patients.map(p => {
    const date = new Date(p.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `<tr>
      <td class="patient-id-cell">${p.id}</td>
      <td>${p.name}</td>
      <td>${p.age}</td>
      <td>${p.gender}</td>
      <td>${p.phone}</td>
      <td><span class="status-badge" style="background:rgba(14,165,233,0.1);color:#7dd3fc">${p.department}</span></td>
      <td style="color:#64748b;font-size:12px">${date}</td>
      <td><button class="btn-view" onclick="viewPatient('${p.id}')">View</button></td>
    </tr>`;
  }).join('');
}

function searchPatients() {
  clearTimeout(window._searchTimer);
  window._searchTimer = setTimeout(loadPatients, 300);
}

async function viewPatient(pid) {
  const data = await api(`/api/patients/${pid}`);
  const p = data.patient;
  const complaints = data.complaints;

  document.getElementById('modal-patient-name').textContent = p.name;
  document.getElementById('modal-body').innerHTML = `
    <div class="detail-grid">
      <div class="detail-item"><div class="detail-label">Patient ID</div><div class="detail-value mono">${p.id}</div></div>
      <div class="detail-item"><div class="detail-label">Age</div><div class="detail-value">${p.age}</div></div>
      <div class="detail-item"><div class="detail-label">Gender</div><div class="detail-value">${p.gender}</div></div>
      <div class="detail-item"><div class="detail-label">Phone</div><div class="detail-value">${p.phone}</div></div>
      <div class="detail-item"><div class="detail-label">Department</div><div class="detail-value">${p.department}</div></div>
      <div class="detail-item"><div class="detail-label">Registered</div><div class="detail-value" style="font-size:12px">${new Date(p.created_at).toLocaleString()}</div></div>
    </div>
    <div class="section-title" style="margin-top:16px">Complaint History (${complaints.length})</div>
    ${complaints.length === 0 ? '<p style="color:#64748b;font-size:13px;margin-top:8px">No complaints on file.</p>' :
      complaints.map(c => `
        <div style="background:#080c14;border:1px solid #1e2d45;border-radius:8px;padding:12px;margin-top:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span class="patient-id-cell" style="font-size:11px">${c.id}</span>
            <span class="severity-badge sev-${c.severity}">${c.severity}</span>
            <span class="status-badge stat-${c.status.replace(' ','-')}">${c.status}</span>
          </div>
          <p style="font-size:12px;color:#94a3b8">${c.description}</p>
        </div>`).join('')}`;

  document.getElementById('patient-modal').classList.add('active');
}

function closeModal() {
  document.getElementById('patient-modal').classList.remove('active');
}

// ─── REGISTER PATIENT ─────────────────────────────────────────
async function registerPatient() {
  const name = document.getElementById('reg-name').value.trim();
  const age = document.getElementById('reg-age').value;
  const gender = document.getElementById('reg-gender').value;
  const phone = document.getElementById('reg-phone').value.trim();
  const department = document.getElementById('reg-dept').value;

  if (!name || !age || !gender || !phone || !department) {
    showResult('reg-result', 'error', '⚠️ All fields are required.');
    return;
  }

  const res = await api('/api/patients', 'POST', { name, age: parseInt(age), gender, phone, department });
  if (res.success) {
    showResult('reg-result', 'success', `✅ Patient registered successfully! Patient ID: ${res.patient_id}`);
    clearRegForm();
    showToast(`Patient ${name} registered (${res.patient_id})`, 'success');
    updateNotifBadge();
  } else {
    showResult('reg-result', 'error', '❌ Registration failed. Please try again.');
  }
}

function clearRegForm() {
  ['reg-name', 'reg-age', 'reg-phone'].forEach(id => document.getElementById(id).value = '');
  ['reg-gender', 'reg-dept'].forEach(id => document.getElementById(id).selectedIndex = 0);
}

// ─── COMPLAINTS ───────────────────────────────────────────────
async function loadComplaints() {
  const sev = document.getElementById('sev-filter')?.value || '';
  const stat = document.getElementById('status-filter')?.value || '';
  const data = await api(`/api/complaints?severity=${sev}&status=${encodeURIComponent(stat)}`);
  renderComplaintsTable(data);

  const openCount = data.filter(c => c.status !== 'Resolved').length;
  const badge = document.getElementById('complaints-badge');
  if (badge) badge.textContent = openCount || '';
}

function renderComplaintsTable(complaints) {
  const tbody = document.getElementById('complaints-tbody');
  if (complaints.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="loading-cell">No complaints found</td></tr>';
    return;
  }
  tbody.innerHTML = complaints.map(c => {
    const date = new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const desc = c.description.length > 50 ? c.description.slice(0, 50) + '...' : c.description;
    const statVal = c.status.replace(' ', '-');
    return `<tr>
      <td class="patient-id-cell">${c.id}</td>
      <td>${c.patient_name}</td>
      <td><span style="font-size:12px;color:#7dd3fc">${c.department}</span></td>
      <td><span class="severity-badge sev-${c.severity}">${c.severity}</span></td>
      <td style="color:#94a3b8;font-size:12px;max-width:180px">${desc}</td>
      <td><span class="status-badge stat-${statVal}">${c.status}</span></td>
      <td style="color:#64748b;font-size:12px">${date}</td>
      <td>
        <select class="status-select" onchange="updateStatus('${c.id}', this.value)">
          <option ${c.status === 'Open' ? 'selected' : ''}>Open</option>
          <option ${c.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
          <option ${c.status === 'Resolved' ? 'selected' : ''}>Resolved</option>
        </select>
      </td>
    </tr>`;
  }).join('');
}

async function updateStatus(cid, status) {
  const res = await api(`/api/complaints/${cid}`, 'PATCH', { status });
  if (res.success) {
    showToast(`Complaint ${cid} → ${status}`, 'success');
    loadComplaints();
    updateNotifBadge();
  }
}

// ─── SUBMIT COMPLAINT ─────────────────────────────────────────
async function lookupPatient() {
  const pid = document.getElementById('cmp-patient-id').value.trim();
  if (!pid) return;
  const data = await api(`/api/patients/${pid}`);
  const el = document.getElementById('lookup-result');
  if (data.patient) {
    el.textContent = `✓ Found: ${data.patient.name} — ${data.patient.department}`;
    el.style.color = '#10b981';
  } else {
    el.textContent = `✗ Patient ID not found`;
    el.style.color = '#ef4444';
  }
}

async function submitComplaint() {
  const patient_id = document.getElementById('cmp-patient-id').value.trim();
  const department = document.getElementById('cmp-dept').value;
  const severity = document.getElementById('cmp-severity').value;
  const description = document.getElementById('cmp-desc').value.trim();

  if (!patient_id || !department || !severity || !description) {
    showResult('cmp-result', 'error', '⚠️ All fields are required.');
    return;
  }

  const res = await api('/api/complaints', 'POST', { patient_id, department, severity, description });
  if (res.success) {
    showResult('cmp-result', 'success', `✅ Complaint submitted! ID: ${res.complaint_id}`);
    clearComplaintForm();
    showToast(`${severity} complaint filed (${res.complaint_id})`, severity === 'Critical' ? 'error' : 'info');
    updateNotifBadge();
  } else {
    showResult('cmp-result', 'error', '❌ Submission failed. Check patient ID.');
  }
}

function clearComplaintForm() {
  document.getElementById('cmp-patient-id').value = '';
  document.getElementById('cmp-desc').value = '';
  document.getElementById('lookup-result').textContent = '';
  ['cmp-dept', 'cmp-severity'].forEach(id => document.getElementById(id).selectedIndex = 0);
}

// ─── ANALYTICS ────────────────────────────────────────────────
async function loadAnalytics() {
  const data = await api('/api/analytics');

  // Status counts
  const statusMap = {};
  data.status_dist.forEach(s => statusMap[s.status] = s.count);
  document.getElementById('a-resolved').textContent = statusMap['Resolved'] || 0;
  document.getElementById('a-inprogress').textContent = statusMap['In Progress'] || 0;
  document.getElementById('a-open').textContent = statusMap['Open'] || 0;
  document.getElementById('a-avg-res').textContent = data.avg_resolution_hours + 'h';

  // Dept pie chart
  destroyChart('deptPie');
  const dpCtx = document.getElementById('deptPieChart').getContext('2d');
  charts['deptPie'] = new Chart(dpCtx, {
    type: 'pie',
    data: {
      labels: data.dept_complaints.map(d => d.department),
      datasets: [{
        data: data.dept_complaints.map(d => d.count),
        backgroundColor: ['#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#06b6d4'],
        borderColor: '#111827', borderWidth: 3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'right', labels: { color: '#64748b', font: { size: 11 } } } }
    }
  });

  // Severity bar chart
  destroyChart('severityBar');
  const sbCtx = document.getElementById('severityBarChart').getContext('2d');
  const sevColors = { Low: '#10b981', Medium: '#f59e0b', High: '#ef4444', Critical: '#dc2626' };
  charts['severityBar'] = new Chart(sbCtx, {
    type: 'bar',
    data: {
      labels: data.severity_dist.map(d => d.severity),
      datasets: [{
        data: data.severity_dist.map(d => d.count),
        backgroundColor: data.severity_dist.map(d => sevColors[d.severity] + '40'),
        borderColor: data.severity_dist.map(d => sevColors[d.severity]),
        borderWidth: 2, borderRadius: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#1e2d45' }, ticks: { color: '#64748b' } },
        y: { grid: { color: '#1e2d45' }, ticks: { color: '#64748b', stepSize: 1 }, beginAtZero: true }
      }
    }
  });

  // Monthly trend
  destroyChart('monthlyLine');
  const mlCtx = document.getElementById('monthlyLineChart').getContext('2d');
  charts['monthlyLine'] = new Chart(mlCtx, {
    type: 'line',
    data: {
      labels: data.monthly.map(d => d.month),
      datasets: [{
        label: 'Complaints',
        data: data.monthly.map(d => d.count),
        borderColor: '#0ea5e9',
        backgroundColor: 'rgba(14,165,233,0.1)',
        fill: true, tension: 0.4, pointRadius: 5,
        pointBackgroundColor: '#0ea5e9', pointBorderColor: '#111827', pointBorderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: '#1e2d45' }, ticks: { color: '#64748b' } },
        y: { grid: { color: '#1e2d45' }, ticks: { color: '#64748b', stepSize: 1 }, beginAtZero: true }
      }
    }
  });
}

// ─── NOTIFICATIONS ────────────────────────────────────────────
async function loadNotifications() {
  const data = await api('/api/notifications');
  const list = document.getElementById('notifications-list');

  if (data.notifications.length === 0) {
    list.innerHTML = '<div class="loading-pulse">No notifications</div>';
    return;
  }

  list.innerHTML = data.notifications.map(n => {
    const time = new Date(n.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const unread = n.read === 0 ? 'unread' : '';
    return `<div class="notif-item ${n.type} ${unread}">
      <div class="notif-dot ${n.type}"></div>
      <div class="notif-text">${n.message}</div>
      <div class="notif-time">${time}</div>
    </div>`;
  }).join('');

  updateNotifBadge();
}

async function markAllRead() {
  await api('/api/notifications/read', 'POST');
  loadNotifications();
  updateNotifBadge();
  showToast('All notifications marked as read', 'success');
}

async function updateNotifBadge() {
  const data = await api('/api/notifications');
  const count = data.unread;
  const badge = document.getElementById('notif-badge');
  const topbarCount = document.getElementById('topbar-notif-count');
  badge.textContent = count || '';
  if (topbarCount) topbarCount.textContent = count;
}

// ─── ADMIN ────────────────────────────────────────────────────
async function loadAdmin() {
  const data = await api('/api/admin/status');

  document.getElementById('system-status-list').innerHTML = `
    <div class="status-row"><span class="label">Database</span><span class="value online">● ${data.db_status}</span></div>
    <div class="status-row"><span class="label">AI Engine</span><span class="value online">● ${data.ai_status}</span></div>
    <div class="status-row"><span class="label">API Server</span><span class="value online">● ${data.api_status}</span></div>
    <div class="status-row"><span class="label">Uptime</span><span class="value">${data.uptime}</span></div>
    <div class="status-row"><span class="label">DB Size</span><span class="value">${data.db_size_kb} KB</span></div>
    <div class="status-row"><span class="label">Last Backup</span><span class="value">${data.last_backup}</span></div>`;

  document.getElementById('data-overview').innerHTML = `
    <div class="status-row"><span class="label">Total Patients</span><span class="value">${data.patients}</span></div>
    <div class="status-row"><span class="label">Total Complaints</span><span class="value">${data.complaints}</span></div>
    <div class="status-row"><span class="label">Notifications</span><span class="value">${data.notifications}</span></div>
    <div class="status-row"><span class="label">Environment</span><span class="value online">Production</span></div>`;
}

async function clearData(target) {
  const labels = { notifications: 'all notifications', complaints: 'all complaints and notifications', patients: 'ALL data (patients, complaints, notifications)' };
  if (!confirm(`⚠️ Are you sure you want to clear ${labels[target]}? This cannot be undone.`)) return;
  const res = await api('/api/admin/clear', 'POST', { target });
  if (res.success) {
    showToast(`${target} cleared successfully`, 'success');
    loadAdmin();
    updateNotifBadge();
  }
}

// ─── SETTINGS ─────────────────────────────────────────────────
async function loadSettings() {
  const data = await api('/api/settings');
  const setCheck = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.checked = data[key] === '1';
  };
  setCheck('set-alerts', 'alerts_enabled');
  setCheck('set-ai', 'ai_monitoring');
  setCheck('set-escalate', 'auto_escalate');
}

async function saveSetting(key, value) {
  await api('/api/settings', 'POST', { [key]: value });
  const banner = document.getElementById('save-banner');
  banner.style.display = 'block';
  setTimeout(() => banner.style.display = 'none', 2000);
}

// ─── CHATBOT ──────────────────────────────────────────────────
async function sendMessage() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  appendMessage('user', msg, new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));

  // Typing indicator
  const typingId = 'typing-' + Date.now();
  const msgEl = document.createElement('div');
  msgEl.className = 'chat-msg ai typing-indicator';
  msgEl.id = typingId;
  msgEl.innerHTML = `<div class="chat-bubble"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div>`;
  document.getElementById('chat-messages').appendChild(msgEl);
  scrollChat();

  const res = await api('/api/chat', 'POST', { message: msg });

  // Remove typing indicator
  document.getElementById(typingId)?.remove();
  appendMessage('ai', res.response, res.timestamp);
}

function sendQuickReply(msg) {
  document.getElementById('chat-input').value = msg;
  sendMessage();
}

function appendMessage(role, text, time) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `<div class="chat-bubble">${text}</div><div class="chat-time">${time}</div>`;
  msgs.appendChild(div);
  scrollChat();
}

function scrollChat() {
  const msgs = document.getElementById('chat-messages');
  msgs.scrollTop = msgs.scrollHeight;
}

// ─── Helpers ─────────────────────────────────────────────────
function showResult(id, type, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = `form-result ${type}`;
  setTimeout(() => el.className = 'form-result', 5000);
}

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  navigate('dashboard');
  updateNotifBadge();
  // Refresh notif badge periodically
  setInterval(updateNotifBadge, 30000);
});
