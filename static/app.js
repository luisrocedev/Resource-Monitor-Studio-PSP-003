/* ── Resource Monitor Studio · app.js v2 ── */

/* ── DOM refs ── */
const el = {
  kpiSamples:    document.getElementById('kpiSamples'),
  kpiCpu:        document.getElementById('kpiCpu'),
  kpiRam:        document.getElementById('kpiRam'),
  kpiDisk:       document.getElementById('kpiDisk'),
  kpiProcesses:  document.getElementById('kpiProcesses'),
  kpiCritical:   document.getElementById('kpiCritical'),
  runtimeState:  document.getElementById('runtimeState'),
  intervalInput: document.getElementById('intervalInput'),
  pauseBtn:      document.getElementById('pauseBtn'),
  resumeBtn:     document.getElementById('resumeBtn'),
  applyIntervalBtn: document.getElementById('applyIntervalBtn'),
  spikeBtn:      document.getElementById('spikeBtn'),
  alertsBody:    document.getElementById('alertsBody'),
  alertSearch:   document.getElementById('alertSearch'),
  alertSevFilter:document.getElementById('alertSevFilter'),
  hourBtn:       document.getElementById('hourBtn'),
  dayBtn:        document.getElementById('dayBtn'),
  statusDot:     document.getElementById('statusDot'),
  statusText:    document.getElementById('statusText'),
  darkModeBtn:   document.getElementById('darkModeBtn'),
  exportBtn:     document.getElementById('exportBtn'),
  importBtn:     document.getElementById('importBtn'),
  importFile:    document.getElementById('importFile'),
  toastContainer:document.getElementById('toastContainer'),
  confirmOverlay:document.getElementById('confirmOverlay'),
  confirmTitle:  document.getElementById('confirmTitle'),
  confirmMsg:    document.getElementById('confirmMsg'),
  confirmOk:     document.getElementById('confirmOk'),
  confirmCancel: document.getElementById('confirmCancel'),
};

let lineChart = null;
let barChart = null;
let rollupMode = 'hour';
let allAlerts = [];

/* ── Dark mode ── */
function applyDark(dark) {
  document.body.classList.toggle('dark', dark);
  document.body.classList.toggle('light-forced', !dark);
  el.darkModeBtn.textContent = dark ? '☀️' : '🌙';
  localStorage.setItem('rms-dark', dark ? '1' : '0');
  // Rebuild charts with adapted colours
  rebuildCharts();
}

(function initDark() {
  const saved = localStorage.getItem('rms-dark');
  if (saved !== null) {
    applyDark(saved === '1');
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    applyDark(true);
  }
})();

el.darkModeBtn.addEventListener('click', () => {
  applyDark(!document.body.classList.contains('dark'));
});

/* ── Tabs ── */
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const target = document.getElementById(btn.dataset.tab);
    if (target) target.classList.add('active');
  });
});

/* ── Toast ── */
function toast(msg, tone = 'info') {
  const div = document.createElement('div');
  div.className = `toast toast-${tone}`;
  div.textContent = msg;
  el.toastContainer.appendChild(div);
  setTimeout(() => div.remove(), 3200);
}

/* ── Custom confirm ── */
function nousConfirm(title, msg) {
  return new Promise(resolve => {
    el.confirmTitle.textContent = title;
    el.confirmMsg.textContent = msg;
    el.confirmOverlay.classList.remove('hidden');

    function cleanup(result) {
      el.confirmOverlay.classList.add('hidden');
      el.confirmOk.removeEventListener('click', onOk);
      el.confirmCancel.removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }

    el.confirmOk.addEventListener('click', onOk);
    el.confirmCancel.addEventListener('click', onCancel);
  });
}

/* ── Chart helpers (dark-adapted) ── */
function chartColors() {
  const dark = document.body.classList.contains('dark');
  return {
    grid: dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)',
    text: dark ? '#94a3b8' : '#6b7280',
  };
}

function chartScaleOpts(maxVal = 100) {
  const c = chartColors();
  return {
    y: { min: 0, max: maxVal, ticks: { color: c.text }, grid: { color: c.grid } },
    x: { ticks: { color: c.text, maxTicksLimit: 18 }, grid: { color: c.grid } },
  };
}

/* ── Charts ── */
function createLineChart(labels, cpu, ram, disk) {
  const ctx = document.getElementById('lineChart');
  if (lineChart) lineChart.destroy();
  lineChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'CPU %', data: cpu, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.08)', tension: .3, fill: true },
        { label: 'RAM %', data: ram, borderColor: '#0891b2', backgroundColor: 'rgba(8,145,178,.08)', tension: .3, fill: true },
        { label: 'Disco %', data: disk, borderColor: '#d97706', backgroundColor: 'rgba(217,119,6,.08)', tension: .3, fill: true },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: chartScaleOpts(100),
      plugins: { legend: { position: 'bottom', labels: { color: chartColors().text } } },
    },
  });
}

function createBarChart(labels, cpu, ram, disk) {
  const ctx = document.getElementById('barChart');
  if (barChart) barChart.destroy();
  barChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'CPU promedio', data: cpu, backgroundColor: '#2563eb' },
        { label: 'RAM promedio', data: ram, backgroundColor: '#06b6d4' },
        { label: 'Disco promedio', data: disk, backgroundColor: '#f59e0b' },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      scales: chartScaleOpts(100),
      plugins: { legend: { position: 'bottom', labels: { color: chartColors().text } } },
    },
  });
}

/* ── Severity ── */
function sevHTML(sev) {
  const s = String(sev || '').toLowerCase();
  if (s === 'critical') return `<span class="sev-critical">CRITICAL</span>`;
  if (s === 'warning')  return `<span class="sev-warning">WARNING</span>`;
  return sev;
}

/* ── Render alerts with filter ── */
function renderAlerts(items) {
  const search = (el.alertSearch.value || '').toLowerCase();
  const sevF   = el.alertSevFilter.value;

  const filtered = (items || []).filter(it => {
    if (sevF && it.severity !== sevF) return false;
    if (search && !`${it.reason} ${it.value} ${it.created_at}`.toLowerCase().includes(search)) return false;
    return true;
  });

  el.alertsBody.innerHTML = filtered.length
    ? filtered.map(it => `<tr>
        <td>${it.id}</td>
        <td>${it.created_at}</td>
        <td>${sevHTML(it.severity)}</td>
        <td>${it.reason}</td>
        <td>${it.value}</td>
        <td>${it.threshold}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" style="text-align:center;color:var(--muted)">Sin alertas</td></tr>';
}

/* ── Alert filter events ── */
el.alertSearch.addEventListener('input', () => renderAlerts(allAlerts));
el.alertSevFilter.addEventListener('change', () => renderAlerts(allAlerts));

/* ── Status indicator ── */
function updateStatusDot(isSampling, interval) {
  if (isSampling) {
    el.statusDot.classList.remove('paused');
    el.statusText.textContent = `Activo · ${interval}s`;
    el.runtimeState.textContent = `Estado: activo · cada ${interval}s`;
  } else {
    el.statusDot.classList.add('paused');
    el.statusText.textContent = 'Pausado';
    el.runtimeState.textContent = 'Estado: pausado';
  }
}

/* ── Data loaders ── */
async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const data = await res.json();

    el.kpiSamples.textContent = data.total_samples.toLocaleString('es-ES');
    el.kpiCritical.textContent = data.alerts_critical;

    if (data.latest) {
      el.kpiCpu.textContent = `${data.latest.cpu_percent} %`;
      el.kpiRam.textContent = `${data.latest.ram_percent} %`;
      el.kpiDisk.textContent = `${data.latest.disk_percent} %`;
      el.kpiProcesses.textContent = data.latest.process_count;
    }

    const rt = data.runtime;
    updateStatusDot(rt.is_sampling, rt.sample_seconds);
  } catch { /* network fail silently */ }
}

async function loadSeries() {
  try {
    const res = await fetch('/api/series?limit=240');
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items || [];

    const labels = items.map(x => x.created_at.slice(11, 19));
    const cpu  = items.map(x => x.cpu_percent);
    const ram  = items.map(x => x.ram_percent);
    const disk = items.map(x => x.disk_percent);

    createLineChart(labels, cpu, ram, disk);
  } catch { /* */ }
}

async function loadRollup() {
  try {
    const res = await fetch(`/api/rollup?mode=${rollupMode}`);
    if (!res.ok) return;
    const data = await res.json();
    const items = data.items || [];

    const labels = items.map(x => x.bucket.slice(5, 16));
    const cpu  = items.map(x => x.cpu_avg);
    const ram  = items.map(x => x.ram_avg);
    const disk = items.map(x => x.disk_avg);

    createBarChart(labels, cpu, ram, disk);
  } catch { /* */ }
}

async function loadAlerts() {
  try {
    const res = await fetch('/api/alerts?limit=120');
    if (!res.ok) return;
    const data = await res.json();
    allAlerts = data.items || [];
    renderAlerts(allAlerts);
  } catch { /* */ }
}

function rebuildCharts() {
  loadSeries();
  loadRollup();
}

/* ── API control ── */
async function sendControl(action, value = null) {
  const payload = value === null ? { action } : { action, value };
  await fetch('/api/control', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  await loadStats();
}

async function refreshAll() {
  await Promise.all([loadStats(), loadSeries(), loadRollup(), loadAlerts()]);
}

/* ── Control events ── */
el.pauseBtn.addEventListener('click', async () => {
  await sendControl('pause');
  toast('Muestreo pausado', 'warning');
});

el.resumeBtn.addEventListener('click', async () => {
  await sendControl('resume');
  toast('Muestreo reanudado', 'success');
});

el.applyIntervalBtn.addEventListener('click', async () => {
  const value = parseFloat(el.intervalInput.value || '2');
  await sendControl('interval', value);
  toast(`Intervalo ajustado a ${value}s`, 'info');
});

/* ── Spike simulation ── */
el.spikeBtn.addEventListener('click', async () => {
  const ok = await nousConfirm('Simular pico', '¿Generar un pico de CPU durante ~12 s para probar alertas?');
  if (!ok) return;
  toast('Pico de CPU generado en el servidor', 'warning');
  // The spike happens server-side via simulate_spike.py; in this UI-only context we just notify
});

/* ── Rollup mode toggle ── */
el.hourBtn.addEventListener('click', async () => {
  rollupMode = 'hour';
  el.hourBtn.classList.add('active');
  el.dayBtn.classList.remove('active');
  await loadRollup();
});

el.dayBtn.addEventListener('click', async () => {
  rollupMode = 'day';
  el.dayBtn.classList.add('active');
  el.hourBtn.classList.remove('active');
  await loadRollup();
});

/* ── Export JSON ── */
el.exportBtn.addEventListener('click', async () => {
  try {
    const [statsRes, seriesRes, alertsRes] = await Promise.all([
      fetch('/api/stats'),
      fetch('/api/series?limit=2000'),
      fetch('/api/alerts?limit=400'),
    ]);
    const stats  = await statsRes.json();
    const series = await seriesRes.json();
    const alerts = await alertsRes.json();

    const payload = {
      exported_at: new Date().toISOString(),
      stats,
      series: series.items || [],
      alerts: alerts.items || [],
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `resource_monitor_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Datos exportados a JSON', 'success');
  } catch (e) {
    toast('Error al exportar: ' + e.message, 'error');
  }
});

/* ── Import JSON ── */
el.importBtn.addEventListener('click', () => el.importFile.click());

el.importFile.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const ok = await nousConfirm('Importar datos', `¿Cargar datos desde "${file.name}"?`);
  if (!ok) { el.importFile.value = ''; return; }

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    // Re-render with imported data
    if (data.alerts && Array.isArray(data.alerts)) {
      allAlerts = data.alerts;
      renderAlerts(allAlerts);
    }
    if (data.series && Array.isArray(data.series)) {
      const items = data.series;
      createLineChart(
        items.map(x => (x.created_at || '').slice(11, 19)),
        items.map(x => x.cpu_percent),
        items.map(x => x.ram_percent),
        items.map(x => x.disk_percent),
      );
    }
    toast(`Importados ${(data.series || []).length} muestras y ${(data.alerts || []).length} alertas`, 'success');
  } catch (err) {
    toast('Error al importar: ' + err.message, 'error');
  }
  el.importFile.value = '';
});

/* ── Init ── */
refreshAll();
setInterval(refreshAll, 4000);
