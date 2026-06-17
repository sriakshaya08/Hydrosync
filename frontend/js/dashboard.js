/* ═══════════════════════════════════════════════════════════════════════════
   HydroSense Dashboard — dashboard.js
   ═══════════════════════════════════════════════════════════════════════════ */

const API = 'http://127.0.0.1:5000/api';
const token = () => localStorage.getItem('hs_token');
const headers = () => {
  const t = localStorage.getItem('hs_token');

  return {
    'Content-Type': 'application/json',
    'Authorization': t ? `Bearer ${t}` : ''
  };
};
// Redirect if not logged in
if (!token()) window.location.href = 'index.html';

/* ── State ─────────────────────────────────────────────────────────────── */
let userData = JSON.parse(localStorage.getItem('hs_user') || '{}');
let ringChart = null, hourlyChart = null, historyChart = null;
let notifPage = 1, notifFilter = 'all', notifTotal = 0;
let sensorInterval = null, notifInterval = null;

/* ═══════════════════════════════════════════════════════════════════════════
   INIT
   ═══════════════════════════════════════════════════════════════════════════ */
window.addEventListener('DOMContentLoaded', async () => {
  setupGreeting();
  renderSidebarUser();
  initRingChart();
  initHourlyChart();
  await Promise.all([loadDashboard(), loadWeather(), loadNotifCount()]);
  startPolling();

  // 🔥 ADD THIS BELOW
  if (window.location.hash === '#fit-connected') {
    alert('✅ Google Fit connected successfully!');
    syncFitData(); // auto sync after connect
  }

});

function setupGreeting() {
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const name = userData.name ? `, ${userData.name.split(' ')[0]}` : '';
  document.getElementById('greeting').textContent = `${greet}${name}! 👋`;
  document.getElementById('date-line').textContent = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function renderSidebarUser() {
  if (!userData.name) return;
  document.getElementById('user-name').textContent = userData.name;
  document.getElementById('user-avatar').textContent = userData.name[0].toUpperCase();
  const streak = userData.stats?.streak || 0;
  document.getElementById('user-streak').textContent = `🔥 ${streak} day streak`;
  document.getElementById('stat-streak').textContent = streak + ' 🔥';
}

function startPolling() {
  // Poll sensor data every 10s
  sensorInterval = setInterval(loadDashboard, 10000);
  // Poll notification count every 30s
  notifInterval = setInterval(loadNotifCount, 30000);
}

/* ═══════════════════════════════════════════════════════════════════════════
   DASHBOARD DATA
   ═══════════════════════════════════════════════════════════════════════════ */
async function loadDashboard() {
  try {
    const r = await fetch(`${API}/hydration/today`, { headers: headers() });
    if (r.status === 401) return doLogout();
    const d = await r.json();
    updateDashboardUI(d);
  } catch (e) { console.warn('Dashboard load:', e.message); }
}

function updateDashboardUI(d) {
  const consumed = d.todayConsumed || 0;
  const goal = d.todayGoal || 2000;
  const pct = Math.min(100, Math.round((consumed / goal) * 100));
  const remaining = Math.max(0, goal - consumed);
  const bottleLevel = d.bottleLevelMl || 0;
  const bottleCap = d.bottleCapacity || 1000;

  // Stats - Main consumed display
  document.getElementById('stat-consumed').textContent = formatMl(consumed);
  document.getElementById('stat-goal-line').textContent = `of ${formatMl(goal)} goal`;
  document.getElementById('stat-remaining').textContent = formatMl(remaining);
  document.getElementById('stat-bottle').textContent = formatMl(bottleLevel);

  // Bottle viz - Show actual bottle level as percentage of bottle capacity
  // ✅ FIX 5: Handle NaN and edge cases when sensor is offline
  const bottlePct = !isFinite(bottleLevel / bottleCap) || bottleCap <= 0 
    ? 0 
    : Math.min(100, Math.round((bottleLevel / bottleCap) * 100));
  
  const fillEl = document.getElementById('bottle-fill');
  fillEl.style.height = bottlePct + '%';
  document.getElementById('bottle-label').textContent = bottleLevel + ' ml';
  document.getElementById('bottle-pct').textContent = isNaN(bottlePct) ? '0%' : bottlePct + '%';

  // Bottle bubbles
  const bubblesEl = document.getElementById('bottle-bubbles');
  bubblesEl.style.height = bottlePct + '%';
  if (bottlePct > 10 && bubblesEl.children.length === 0) spawnBubbles(bubblesEl);

  // Status message
  const statusEl = document.getElementById('bottle-status');
  if (bottleLevel < 50) statusEl.textContent = '⚠️ Bottle nearly empty — refill soon!';
  else if (bottleLevel < 200) statusEl.textContent = '🔴 Less than 200ml left in bottle';
  else if (bottleLevel < 500) statusEl.textContent = '🟡 Bottle half empty';
  else statusEl.textContent = '🟢 Bottle well filled';

  // Ring - Shows progress toward DAILY GOAL
  updateRing(pct);
  document.getElementById('ring-pct').textContent = pct + '%';

  // Goal breakdown mini
  document.getElementById('goal-breakdown-mini').textContent =
    `Daily target: ${formatMl(goal)} • ${formatMl(remaining)} remaining`;

  // Hourly chart
  if (d.hourlyData) updateHourlyChart(d.hourlyData, goal);

  // Stats
  if (d.stats) {
    document.getElementById('stat-streak').textContent = (d.stats.streak || 0) + ' 🔥';
    document.getElementById('user-streak').textContent = `🔥 ${d.stats.streak || 0} day streak`;
    userData.stats = d.stats;
  }
}

function spawnBubbles(container) {
  for (let i = 0; i < 6; i++) {
    const b = document.createElement('div');
    b.className = 'bubble';
    b.style.width = b.style.height = (4 + Math.random() * 6) + 'px';
    b.style.left = (10 + Math.random() * 60) + '%';
    b.style.bottom = (Math.random() * 30) + '%';
    b.style.animationDelay = (Math.random() * 3) + 's';
    b.style.animationDuration = (2 + Math.random() * 3) + 's';
    container.appendChild(b);
  }
}

/* ── Ring Chart ─────────────────────────────────────────────────────────── */
function initRingChart() {
  const ctx = document.getElementById('ring-canvas').getContext('2d');
  ringChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      datasets: [{
        data: [0, 100],
        backgroundColor: ['#00d2d2', 'rgba(255,255,255,0.04)'],
        borderWidth: 0,
        borderRadius: 6
      }]
    },
    options: {
      cutout: '78%',
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      animation: { duration: 1000, easing: 'easeInOutQuart' }
    }
  });
}

function updateRing(pct) {
  if (!ringChart) return;
  ringChart.data.datasets[0].data = [pct, Math.max(0, 100 - pct)];
  const color = pct >= 100 ? '#00e0a0' : pct >= 75 ? '#00d2d2' : pct >= 50 ? '#ffb830' : '#ff5a6e';
  ringChart.data.datasets[0].backgroundColor[0] = color;
  ringChart.update();
}

/* ── Hourly Chart ────────────────────────────────────────────────────────── */
function initHourlyChart() {
  const ctx = document.getElementById('hourly-chart').getContext('2d');
  const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);
  hourlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'ml',
        data: Array(24).fill(0),
        backgroundColor: 'rgba(0,210,210,0.45)',
        borderColor: 'rgba(0,210,210,0.9)',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.raw + ' ml' } } },
      scales: {
        x: { ticks: { color: '#6899b8', font: { size: 10 }, maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#6899b8', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
      }
    }
  });
}

function updateHourlyChart(data, goal) {
  if (!hourlyChart) return;
  hourlyChart.data.datasets[0].data = data;
  hourlyChart.update();
}

/* ── Quick Add ──────────────────────────────────────────────────────────── */
async function quickAdd(amount) {
  if (!amount || amount <= 0) return;
  try {
    const r = await fetch(`${API}/hydration/manual`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ amount })
    });
    const d = await r.json();
    const fb = document.getElementById('add-feedback');
    fb.textContent = `✅ +${amount}ml logged! You're at ${d.todayConsumed}ml (${d.percentage}%)`;
    setTimeout(() => fb.textContent = '', 4000);
    document.getElementById('custom-amount').value = '';
    await loadDashboard();
  } catch (e) {
    document.getElementById('add-feedback').textContent = '❌ Failed to log. Try again.';
  }
}

/* ── Weather ────────────────────────────────────────────────────────────── */
async function loadWeather() {
  try {
    console.log("🌦️ Fetching weather...");

    const r = await fetch(`${API}/weather`, { headers: headers() });

    if (!r.ok) {
      console.warn("❌ Weather API failed:", r.status);
      setWeatherFallback();
      return;
    }

    const d = await r.json();
    console.log("🌦️ Weather data:", d);

    if (!d || d.temperature === undefined) {
      console.warn("⚠️ Invalid weather data");
      setWeatherFallback();
      return;
    }

    const icon = getWeatherEmoji(d.temperature, d.description || '');

    document.getElementById('weather-main').textContent =
      `${icon} ${Math.round(d.temperature)}°C`;

    document.getElementById('weather-sub').textContent =
      `${d.city || 'Unknown'} • 💧 ${d.humidity || 0}%`;

    document.getElementById('w-temp-big').textContent =
      (d.temperature ?? 0) + '°C';

    document.getElementById('w-advisory').textContent =
      d.advisory || 'Stay hydrated!';

    document.getElementById('w-humidity').textContent =
      (d.humidity ?? 0) + '%';

    document.getElementById('w-feels').textContent =
      (d.feelsLike ?? d.temperature ?? 0) + '°C';

    if (d.icon) {
      const img = document.getElementById('w-icon-img');
      img.src = d.icon;
      img.style.display = 'block';
    }

  } catch (e) {
    console.warn('❌ Weather error:', e.message);
    setWeatherFallback();
  }
}

function setWeatherFallback() {
  document.getElementById('weather-main').textContent = '🌡️ --°C';
  document.getElementById('weather-sub').textContent = 'Location unavailable';

  document.getElementById('w-temp-big').textContent = '--°C';
  document.getElementById('w-advisory').textContent = 'Unable to fetch weather';
  document.getElementById('w-humidity').textContent = '--%';
  document.getElementById('w-feels').textContent = '--°C';
}

/* ── Goal Breakdown Modal ────────────────────────────────────────────────── */
async function loadGoalBreakdown() {
  try {
    const r = await fetch(`${API}/hydration/goal-breakdown`, { headers: headers() });
    const d = await r.json();

    const entries = Object.entries(d.breakdown);

    // 🎯 Label mapping (clean UI names)
    const labelMap = {
      base: "Base (weight × 35ml)",
      bmiBonus: "BMI Bonus",
      activityMultiplier: "Activity Multiplier",
      weatherBonus: "Weather Bonus",
      googleFitBonus: "🏃 Google Fit Bonus",
      pregnantBonus: "Pregnancy Bonus",
      breastfeedingBonus: "Breastfeeding Bonus",
      kidneyBonus: "Kidney Condition Bonus",
      utiBonus: "UTI Bonus",
      diabetesBonus: "Diabetes Bonus"
    };

    let html = entries
      .filter(([key]) => key !== 'weather') // ❌ remove object
      .map(([key, val]) => {

        let display = '—';
        let cls = '';

        if (key === 'activityMultiplier') {
          display = `×${val}`;
        } else if (typeof val === 'number' && val > 0) {
          display = `+${val} ml`;
          cls = 'pos';
        } else if (typeof val === 'number' && val < 0) {
          display = `${val} ml`;
          cls = 'neg';
        }

        return `
          <div class="breakdown-row">
            <span>${labelMap[key] || key}</span>
            <span class="breakdown-val ${cls}">${display}</span>
          </div>
        `;
      }).join('');

    // ✅ Total
    html += `
      <div class="breakdown-total">
        <span>Final Goal</span>
        <span class="breakdown-total-val">${d.total} ml</span>
      </div>
    `;

    // 🌡️ Weather info (clean card)
    if (d.weather?.temperature) {
      html += `
        <div style="margin-top:14px;padding:12px;background:rgba(0,170,255,0.08);
                    border-radius:10px;font-size:13px;color:#6899b8">
          🌡️ <strong>${d.weather.city}</strong> — 
          ${Math.round(d.weather.temperature)}°C, 
          💧 ${d.weather.humidity}%
        </div>
      `;
    }

    document.getElementById('goal-modal-content').innerHTML = html;
    document.getElementById('goal-modal').classList.add('open');

  } catch (e) {
    console.warn('Goal breakdown:', e);
  }
}
function closeGoalModal(e) {
  if (!e || e.target === document.getElementById('goal-modal')) {
    document.getElementById('goal-modal').classList.remove('open');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   HISTORY PAGE
   ═══════════════════════════════════════════════════════════════════════════ */
async function loadHistory(days = 7, btn) {
  if (btn) {
    document.querySelectorAll('.range-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  try {
    const r = await fetch(`${API}/hydration/history?days=${days}`, { headers: headers() });
    const d = await r.json();

    // Stats row
    const amounts = d.dailyData.map(x => x.amount);
    const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const max = Math.max(...amounts);
    const daysGoalMet = amounts.filter(a => a >= d.todayGoal * 0.9).length;
    document.getElementById('history-stats-row').innerHTML = `
      <div class="stat-card"><div class="stat-label">Daily Average</div><div class="stat-value">${formatMl(Math.round(avg))}</div><div class="stat-sub">over ${days} days</div></div>
      <div class="stat-card"><div class="stat-label">Best Day</div><div class="stat-value accent2">${formatMl(max)}</div><div class="stat-sub">max intake</div></div>
      <div class="stat-card"><div class="stat-label">Goals Met</div><div class="stat-value warn">${daysGoalMet}/${days}</div><div class="stat-sub">days</div></div>
      <div class="stat-card"><div class="stat-label">Total Intake</div><div class="stat-value">${formatMl(amounts.reduce((a,b)=>a+b,0))}</div><div class="stat-sub">in ${days} days</div></div>
    `;

    // Chart
    updateHistoryChart(d.dailyData, d.todayGoal);

    // Recent logs
    await loadRecentLogs();
  } catch (e) { console.warn('History:', e.message); }
}

function updateHistoryChart(data, goal) {
  const labels = data.map(x => {
    const d = new Date(x.date);
    return d.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' });
  });
  const values = data.map(x => x.amount);
  const colors = values.map(v => v >= goal * 0.9 ? 'rgba(0,224,160,0.7)' : v >= goal * 0.6 ? 'rgba(0,210,210,0.6)' : 'rgba(255,90,110,0.5)');

  if (historyChart) { historyChart.destroy(); historyChart = null; }
  const ctx = document.getElementById('history-chart').getContext('2d');
  historyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Intake (ml)',
          data: values,
          backgroundColor: colors,
          borderRadius: 6
        },
        {
          type: 'line',
          label: 'Goal',
          data: Array(values.length).fill(goal),
          borderColor: 'rgba(0,210,210,0.4)',
          borderDash: [6, 3],
          borderWidth: 2,
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#6899b8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { ticks: { color: '#6899b8', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
      }
    }
  });
}

async function loadRecentLogs() {
  try {
    const r = await fetch(`${API}/hydration/today`, { headers: headers() });
    const d = await r.json();
    const el = document.getElementById('recent-logs');
    if (!d.logs || d.logs.length === 0) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">No logs today yet</div>';
      return;
    }
    el.innerHTML = d.logs.slice().reverse().map(l => `
      <div class="log-item">
        <div class="log-icon">${l.source === 'sensor' ? '📡' : '✋'}</div>
        <div class="log-info">
          <div class="log-amount">+${l.amount} ml</div>
          <div class="log-meta">${l.source === 'sensor' ? 'Sensor reading' : l.note || 'Manual entry'}</div>
        </div>
        <div class="log-time">${formatTime(l.timestamp)}</div>
      </div>
    `).join('');
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACTIVITY PAGE
   ═══════════════════════════════════════════════════════════════════════════ */
async function logActivity() {
  const type = document.getElementById('act-type').value;
  const intensity = document.getElementById('act-intensity').value;
  const duration = parseInt(document.getElementById('act-duration').value);
  if (!duration || duration < 5) return alert('Enter duration (minimum 5 minutes)');

  try {
    const r = await fetch(`${API}/activity`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ type, intensity, duration })
    });
    const d = await r.json();
    const el = document.getElementById('activity-result');
    el.style.display = 'block';
    el.innerHTML = `
      💪 <strong>${duration}min ${intensity} ${type}</strong> logged!<br>
      Added <strong>+${d.extraWaterNeeded}ml</strong> to your goal.<br>
      New goal: <strong>${d.newGoal}ml</strong> • Progress: <strong>${d.percentage}%</strong>
    `;
    await loadActivities();
    await loadDashboard();
    await loadNotifCount();
  } catch (e) { alert('Failed to log activity.'); }
}

async function loadActivities() {
  try {
    const r = await fetch(`${API}/activity`, { headers: headers() });
    const acts = await r.json();
    const el = document.getElementById('activity-list');
    if (!acts.length) {
      el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">No activities logged this week</div>';
      return;
    }
    el.innerHTML = acts.map(a => `
      <div class="activity-item">
        <div class="log-icon">${activityEmoji(a.type)}</div>
        <div class="log-info" style="flex:1">
          <div style="font-weight:600;font-size:14px">${capitalize(a.type)}</div>
          <div style="font-size:12px;color:var(--text-muted)">${a.duration} minutes</div>
        </div>
        <span class="activity-badge badge-${a.intensity}">${a.intensity}</span>
        <div style="text-align:right">
          <div style="font-family:var(--font-head);font-weight:700;color:var(--accent)">+${a.extraWaterNeeded}ml</div>
          <div style="font-size:11px;color:var(--text-dim)">${formatTime(a.timestamp)}</div>
        </div>
      </div>
    `).join('');
  } catch (e) {}
}

function activityEmoji(type) {
  const m = { running:'🏃',cycling:'🚴',swimming:'🏊',gym:'🏋️',yoga:'🧘',hiit:'⚡',walking:'🚶',sports:'🏅',other:'🌀' };
  return m[type] || '🏃';
}

/* ═══════════════════════════════════════════════════════════════════════════
   NOTIFICATIONS PAGE
   ═══════════════════════════════════════════════════════════════════════════ */
async function loadNotifications(reset = true) {
  if (reset) { notifPage = 1; }
  const unreadParam = notifFilter === 'unread' ? '&unread=true' : '';
  const typeParam = ['all','unread'].includes(notifFilter) ? '' : `&type=${notifFilter}`;
  try {
    const r = await fetch(`${API}/notifications?page=${notifPage}&limit=20${unreadParam}${typeParam}`, { headers: headers() });
    const d = await r.json();
    notifTotal = d.total;
    const list = document.getElementById('notifications-list');
    document.getElementById('notif-summary').textContent =
      `${d.unreadCount} unread · ${d.total} total`;

    if (reset) list.innerHTML = '';

    if (d.notifications.length === 0 && notifPage === 1) {
      list.innerHTML = `<div class="notif-empty"><span class="big-icon">🔔</span>No notifications here yet</div>`;
      document.getElementById('load-more-wrap').style.display = 'none';
      return;
    }

    d.notifications.forEach(n => {
      list.insertAdjacentHTML('beforeend', renderNotif(n));
    });

    const hasMore = notifPage * 20 < notifTotal;
    document.getElementById('load-more-wrap').style.display = hasMore ? 'block' : 'none';
  } catch (e) {}
}

function renderNotif(n) {
  const timeAgo = formatTimeAgo(n.createdAt);
  const unreadClass = !n.isRead ? 'unread' : '';
  return `
    <div class="notif-item ${unreadClass}" id="notif-${n._id}" onclick="markRead('${n._id}')">
      <div class="notif-icon-wrap ${n.type}">${n.icon}</div>
      ${!n.isRead ? '<div class="unread-dot"></div>' : ''}
      <div class="notif-content">
        <div class="notif-title">${n.title}</div>
        <div class="notif-message">${n.message}</div>
        <div class="notif-time">${timeAgo}</div>
      </div>
      <button class="notif-delete" onclick="deleteNotif(event,'${n._id}')">✕</button>
    </div>
  `;
}

async function markRead(id) {
  await fetch(`${API}/notifications/${id}/read`, { method: 'PATCH', headers: headers() });
  const el = document.getElementById(`notif-${id}`);
  if (el) { el.classList.remove('unread'); el.querySelector('.unread-dot')?.remove(); }
  loadNotifCount();
}

async function deleteNotif(e, id) {
  e.stopPropagation();
  await fetch(`${API}/notifications/${id}`, { method: 'DELETE', headers: headers() });
  document.getElementById(`notif-${id}`)?.remove();
  loadNotifCount();
}

async function markAllRead() {
  await fetch(`${API}/notifications/read-all`, { method: 'PATCH', headers: headers() });
  await loadNotifications();
  loadNotifCount();
}

async function clearAllNotifs() {
  if (!confirm('Clear all notifications?')) return;
  await fetch(`${API}/notifications`, { method: 'DELETE', headers: headers() });
  await loadNotifications();
  loadNotifCount();
}

function filterNotifs(type, btn) {
  notifFilter = type;
  document.querySelectorAll('.notif-filter').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  loadNotifications();
}

function loadMoreNotifs() {
  notifPage++;
  loadNotifications(false);
}

async function loadNotifCount() {
  try {
    const r = await fetch(`${API}/notifications/count`, { headers: headers() });
    const d = await r.json();
    const count = d.unreadCount || 0;
    ['notif-badge', 'notif-badge-mobile'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = count; el.style.display = count > 0 ? 'flex' : 'none'; }
    });
  } catch (e) {}
}

/* ═══════════════════════════════════════════════════════════════════════════
   SETTINGS PAGE
   ═══════════════════════════════════════════════════════════════════════════ */
function loadSettings() {
  const u = userData;
  const p = u.profile || {};
  const h = u.healthConditions || {};
  const n = u.notificationPrefs || {};

  document.getElementById('s-age').value = p.age || '';
  document.getElementById('s-weight').value = p.weight || '';
  document.getElementById('s-height').value = p.height || '';
  document.getElementById('s-gender').value = p.gender || 'male';
  document.getElementById('s-activity').value = p.activityLevel || 'moderate';
  document.getElementById('s-city').value = u.location?.city || '';

  // Health conditions
  const condMap = [
    ['kidneyStones','🫘 Kidney Stones'], ['diabetes','🩺 Diabetes'],
    ['hypertension','💓 Hypertension'], ['uti','🦠 UTI'],
    ['pregnant','🤰 Pregnant'], ['breastfeeding','👶 Breastfeeding'],
    ['heartDisease','❤️ Heart Disease']
  ];
  document.getElementById('s-conditions').innerHTML = condMap.map(([key, label]) =>
    `<label class="cond-item"><input type="checkbox" id="sc-${key}" value="${key}" ${h[key] ? 'checked' : ''} onchange="this.closest('.cond-item').classList.toggle('checked',this.checked)"> ${label}</label>`
  ).join('');

  document.getElementById('s-reminders').checked = n.reminderEnabled !== false;
  document.getElementById('s-weather-alerts').checked = n.weatherAlerts !== false;
  document.getElementById('s-activity-alerts').checked = n.activityAlerts !== false;
  document.getElementById('s-achievements').checked = n.achievementAlerts !== false;

  // Stats display
  const s = u.stats || {};
  document.getElementById('stats-display').innerHTML = `
    <div class="stat-row"><span>Current Streak</span><span class="stat-row-val">🔥 ${s.streak||0} days</span></div>
    <div class="stat-row"><span>Longest Streak</span><span class="stat-row-val">⭐ ${s.longestStreak||0} days</span></div>
    <div class="stat-row"><span>Goals Met</span><span class="stat-row-val">🏆 ${s.goalsMetCount||0}</span></div>
    <div class="stat-row"><span>Total Water</span><span class="stat-row-val">💧 ${((s.totalLiters||0).toFixed(1))} L</span></div>
  `;
}

async function saveSettings() {
  const profile = {
    age: parseInt(document.getElementById('s-age').value) || undefined,
    weight: parseFloat(document.getElementById('s-weight').value) || undefined,
    height: parseFloat(document.getElementById('s-height').value) || undefined,
    gender: document.getElementById('s-gender').value,
    activityLevel: document.getElementById('s-activity').value
  };
  const healthConditions = {};
  ['kidneyStones','diabetes','hypertension','uti','pregnant','breastfeeding','heartDisease'].forEach(key => {
    const el = document.getElementById(`sc-${key}`);
    if (el) healthConditions[key] = el.checked;
  });
  const notificationPrefs = {
    reminderEnabled: document.getElementById('s-reminders').checked,
    weatherAlerts: document.getElementById('s-weather-alerts').checked,
    activityAlerts: document.getElementById('s-activity-alerts').checked,
    achievementAlerts: document.getElementById('s-achievements').checked
  };
  const city = document.getElementById('s-city').value.trim();
  const location = city ? { city, country: 'IN' } : undefined;

  const fb = document.getElementById('settings-feedback');
  fb.textContent = 'Saving...'; fb.style.color = 'var(--text-muted)';
  try {
    const r = await fetch(`${API}/auth/profile`, {
      method: 'PUT', headers: headers(),
      body: JSON.stringify({ profile, healthConditions, notificationPrefs, location })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message);
    userData = { ...userData, ...d.user };
    localStorage.setItem('hs_user', JSON.stringify(userData));
    fb.textContent = `✅ Saved! New daily goal: ${d.user?.todayGoal || ''}ml`;
    fb.style.color = 'var(--success)';
    await loadDashboard();
  } catch (e) {
    fb.textContent = '❌ Save failed: ' + e.message;
    fb.style.color = 'var(--danger)';
  }
}

async function calibrate(step) {
  const statusEl = document.getElementById('calib-status');
  statusEl.textContent = `Sending calibration step "${step}"...`;
  try {
    const r = await fetch(`${API}/hydration/calibrate`, {
      method: 'POST', headers: headers(),
      body: JSON.stringify({ step, rawValue: 0 })  // rawValue comes from scale; 0 triggers save
    });
    const d = await r.json();
    statusEl.textContent = d.message;
  } catch (e) { statusEl.textContent = '❌ Calibration failed'; }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE ROUTER
   ═══════════════════════════════════════════════════════════════════════════ */
function showPage(name, clickedEl) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const page = document.getElementById(`page-${name}`);
  if (page) page.classList.add('active');
  if (clickedEl) clickedEl.classList.add('active');

  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');

  // Page-specific loads
  if (name === 'history') loadHistory(7);
  if (name === 'activity') loadActivities();
  if (name === 'notifications') loadNotifications();
  if (name === 'settings') loadSettings();
  if (name === 'dashboard') loadDashboard();
}

/* ═══════════════════════════════════════════════════════════════════════════
   MISC HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */
function doLogout() {
  clearInterval(sensorInterval);
  clearInterval(notifInterval);
  localStorage.removeItem('hs_token');
  localStorage.removeItem('hs_user');
  window.location.href = 'index.html';
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

function formatMl(ml) {
  if (ml >= 1000) return (ml / 1000).toFixed(1) + ' L';
  return ml + ' ml';
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function formatTimeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return Math.floor(h / 24) + 'd ago';
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

 //google fit

 async function connectGoogleFit() {
  try {
    const r = await fetch('/api/googlefit/auth-url', {
      headers: headers()
    });

    const d = await r.json();

    if (!d.url) throw new Error('No auth URL');

    // Redirect to Google login
    window.location.href = d.url;

  } catch (e) {
    console.error('Fit connect error:', e);
    alert('❌ Failed to connect Google Fit');
  }
}

async function syncFitData() {
  try {
    console.log("➡️ Calling Google Fit API...");

    const r = await fetch('/api/googlefit/today', {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('hs_token')}`
      }
    });

    console.log("Status:", r.status);

    const d = await r.json();
    console.log("Response:", d);

    if (!d.connected) {
      alert('⚠️ Google Fit not connected');
      return;
    }

    updateFitUI(true);

    alert(`🏃 Steps: ${d.steps}\n💧 Bonus: +${d.fitBonus}ml`);

    await loadDashboard();

  } catch (e) {
    console.error('❌ Fit sync error:', e);
  }
}



async function disconnectGoogleFit() {
  try {
    await fetch('/api/googlefit/disconnect', {
      method: 'DELETE',
      headers: headers()
    });

    alert('❌ Google Fit disconnected');

    document.getElementById('fitConnectBtn').style.display = 'inline-block';
    document.getElementById('fitDisconnectBtn').style.display = 'none';
    document.getElementById('fitSyncBtn').style.display = 'none';

  } catch (e) {
    console.error('Disconnect error:', e);
  }
}


function updateFitUI(connected) {
  document.getElementById('fitConnectBtn').style.display = connected ? 'none' : 'inline-block';
  document.getElementById('fitDisconnectBtn').style.display = connected ? 'inline-block' : 'none';
  document.getElementById('fitSyncBtn').style.display = connected ? 'inline-block' : 'none';
}


async function loadESPWeight() {
  try {
    const r = await fetch("http://10.195.187.89/weight");
    const d = await r.json();

    const weight = d.weight || 0;

    document.getElementById("today-intake").textContent =
      weight + " ml";

  } catch (e) {
    console.warn("ESP error:", e.message);
  }
}
setInterval(loadESPWeight, 2000);