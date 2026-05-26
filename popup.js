// popup.js — Dashboard logic for Flow Auto Generator v4.0

// Vietnamese state labels (duplicated here since popup can't importScripts)
const STATE_LABELS_POPUP = {
  IDLE:             '⏸️ Chờ job',
  FIND_CHARACTER:   '🔍 Tìm nhân vật',
  HOVER_CHARACTER:  '👆 Hover nhân vật',
  CLICK_MORE_MENU:  '🖱️ Click ⋮ menu',
  WAIT_MENU:        '⏳ Chờ dropdown',
  CLICK_ADD_BUTTON: '🖱️ Thêm vào câu lệnh',
  WAIT_TEXTAREA:    '⏳ Chờ ô nhập',
  INJECT_PROMPT:    '✏️ Nhập prompt',
  VERIFY_INPUT:     '✅ Xác nhận',
  PRESS_ENTER:      '⏎ Ấn Enter',
  WAIT_RENDER:      '🎬 Rendering...',
  DETECT_COMPLETE:  '🔎 Kiểm tra',
  DOWNLOAD_VIDEO:   '💾 Tải video',
  CALLBACK_RESULT:  '📤 Gửi kết quả',
  DONE:             '✅ Hoàn tất',
  ERROR:            '❌ Lỗi'
};

// State sequence for progress calculation
const STATE_ORDER = [
  'FIND_CHARACTER', 'HOVER_CHARACTER', 'CLICK_MORE_MENU', 'WAIT_MENU',
  'CLICK_ADD_BUTTON', 'WAIT_TEXTAREA', 'INJECT_PROMPT', 'VERIFY_INPUT',
  'PRESS_ENTER', 'WAIT_RENDER', 'DETECT_COMPLETE', 'DOWNLOAD_VIDEO',
  'CALLBACK_RESULT', 'DONE'
];

function getProgress(state) {
  const idx = STATE_ORDER.indexOf(state);
  if (idx < 0) return 0;
  return Math.round(((idx + 1) / STATE_ORDER.length) * 100);
}

// ==========================================
// LOAD DASHBOARD STATE
// ==========================================
async function loadDashboard() {
  try {
    const data = await chrome.runtime.sendMessage({ type: 'GET_DASHBOARD' });
    if (!data) return;

    renderConnection(data);
    renderStats(data);
    renderCurrentJob(data);
    renderControls(data);
    renderQueue(data);
    renderLogs(data);
  } catch (e) {
    document.getElementById('connLabel').innerHTML =
      '<strong style="color:#ef4444">Lỗi:</strong> ' + e.message;
  }
}

// ==========================================
// RENDER FUNCTIONS
// ==========================================

function renderConnection(data) {
  const dot = document.getElementById('connDot');
  const label = document.getElementById('connLabel');
  const chip = document.getElementById('stateChip');

  if (data.wsConnected) {
    dot.className = 'conn-dot on';
    label.innerHTML = '<strong>Bridge connected</strong>';
  } else {
    dot.className = 'conn-dot off';
    label.innerHTML = '<strong style="color:#ef4444">Bridge disconnected</strong>';
  }

  const stateLabel = STATE_LABELS_POPUP[data.currentState] || data.currentState;
  chip.textContent = stateLabel;
  chip.className = 'state-chip' +
    (data.currentState !== 'IDLE' && data.currentState !== 'DONE' ? ' active' : '');
}

function renderStats(data) {
  document.getElementById('statQueue').textContent = data.queueLength || 0;
  document.getElementById('statDone').textContent = data.completedCount || 0;
  document.getElementById('statFailed').textContent = data.failedCount || 0;
  document.getElementById('statRetry').textContent = data.retryCount || 0;
}

function renderCurrentJob(data) {
  const card = document.getElementById('jobCard');
  const badge = document.getElementById('jobBadge');
  const details = document.getElementById('jobDetails');
  const progressWrap = document.getElementById('progressWrap');
  const progressBar = document.getElementById('progressBar');

  if (data.currentJob) {
    card.className = 'job-card active';
    badge.textContent = data.currentState;
    badge.className = 'job-card-badge badge-processing';

    const job = data.currentJob;
    let html = '';
    if (job.projectId) {
      html += '<div class="job-detail"><span class="job-detail-key">Project:</span><span class="job-detail-val">' + esc(job.projectId) + '</span></div>';
    }
    html += '<div class="job-detail"><span class="job-detail-key">Scene:</span><span class="job-detail-val">' + esc(job.sceneId || '—') + '</span></div>';
    if (job.character) {
      html += '<div class="job-detail"><span class="job-detail-key">Character:</span><span class="job-detail-val">' + esc(job.character) + '</span></div>';
    }
    const stateLabel = STATE_LABELS_POPUP[data.currentState] || data.currentState;
    html += '<div class="job-detail"><span class="job-detail-key">Status:</span><span class="job-detail-val">' + esc(stateLabel) + '</span></div>';

    if (job.startedAt) {
      const elapsed = Math.round((Date.now() - job.startedAt) / 1000);
      const min = Math.floor(elapsed / 60);
      const sec = elapsed % 60;
      html += '<div class="job-detail"><span class="job-detail-key">Elapsed:</span><span class="job-detail-val">' + min + 'm ' + sec + 's</span></div>';
    }

    details.innerHTML = html;

    // Progress bar
    const progress = getProgress(data.currentState);
    progressWrap.style.display = 'block';
    progressBar.style.width = progress + '%';
  } else {
    card.className = 'job-card';
    badge.textContent = 'IDLE';
    badge.className = 'job-card-badge badge-idle';
    details.innerHTML = '<div class="queue-empty">Không có job đang chạy</div>';
    progressWrap.style.display = 'none';
  }
}

function renderControls(data) {
  const btnPause = document.getElementById('btnPause');
  const btnResume = document.getElementById('btnResume');
  const btnSkip = document.getElementById('btnSkip');
  const btnCancel = document.getElementById('btnCancel');

  if (data.paused) {
    btnPause.style.display = 'none';
    btnResume.style.display = '';
  } else {
    btnPause.style.display = '';
    btnResume.style.display = 'none';
  }

  const hasJob = !!data.currentJob;
  btnSkip.disabled = !hasJob;
  btnCancel.disabled = !hasJob;
}

function renderQueue(data) {
  const count = document.getElementById('queueCount');
  const list = document.getElementById('queueList');

  count.textContent = data.queueLength || 0;

  if (!data.queue || data.queue.length === 0) {
    list.innerHTML = '<div class="queue-empty">Queue trống</div>';
    return;
  }

  let html = '';
  data.queue.forEach((job, idx) => {
    html += '<div class="queue-item">' +
      '<span class="queue-item-idx">' + (idx + 1) + '</span>' +
      '<span class="queue-item-name">' + esc(job.sceneId || job.id) + '</span>' +
      '<span class="queue-item-char">' + esc(job.character || '') + '</span>' +
      '</div>';
  });
  list.innerHTML = html;
}

function renderLogs(data) {
  const wrap = document.getElementById('logsWrap');

  if (!data.logs || data.logs.length === 0) {
    wrap.innerHTML = '<div class="logs-empty">Chưa có hoạt động</div>';
    return;
  }

  let html = '';
  data.logs.forEach(log => {
    html += '<div class="log-line">' + esc(log) + '</div>';
  });
  wrap.innerHTML = html;
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ==========================================
// EVENT HANDLERS
// ==========================================

document.getElementById('btnPause').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'PAUSE_QUEUE' });
  loadDashboard();
});

document.getElementById('btnResume').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'RESUME_QUEUE' });
  loadDashboard();
});

document.getElementById('btnSkip').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'SKIP_JOB' });
  setTimeout(loadDashboard, 500);
});

document.getElementById('btnCancel').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CANCEL_JOB' });
  setTimeout(loadDashboard, 500);
});

document.getElementById('btnClearLog').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'CLEAR_LOGS' });
  loadDashboard();
});

document.getElementById('btnManual').addEventListener('click', async () => {
  const character = document.getElementById('manualChar').value.trim();
  const sceneId = document.getElementById('manualScene').value.trim();
  const webhookUrl = document.getElementById('manualWebhook').value.trim();
  const prompt = document.getElementById('manualPrompt').value.trim();

  if (!prompt) {
    alert('Vui lòng nhập prompt');
    return;
  }

  await chrome.runtime.sendMessage({
    type: 'MANUAL_JOB',
    character: character,
    sceneId: sceneId || 'manual_' + Date.now(),
    projectId: 'manual',
    prompt: prompt,
    callbackUrl: webhookUrl || null
  });

  // Clear inputs
  document.getElementById('manualChar').value = '';
  document.getElementById('manualScene').value = '';
  document.getElementById('manualPrompt').value = '';
  
  setTimeout(loadDashboard, 500);
});

document.getElementById('btnSaveSettings').addEventListener('click', async () => {
  const webhookUrl = document.getElementById('settingDefaultWebhook').value.trim();
  
  await chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    settings: { defaultWebhookUrl: webhookUrl || null }
  });
  
  alert('Đã lưu cài đặt chung!');
  loadDashboard();
});

// Update settings when dashboard loads
const oldRenderConnection = renderConnection;
renderConnection = function(data) {
  oldRenderConnection(data);
  // Populate settings if not focused
  const webhookInput = document.getElementById('settingDefaultWebhook');
  if (document.activeElement !== webhookInput && data.settings) {
    webhookInput.value = data.settings.defaultWebhookUrl || '';
  }
};

// ==========================================
// INIT
// ==========================================
loadDashboard();
setInterval(loadDashboard, 2000);
