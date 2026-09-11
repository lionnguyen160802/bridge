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
  const driveFolderId = document.getElementById('manualDriveFolderId').value.trim();
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
    callbackUrl: webhookUrl || null,
    driveFolderId: driveFolderId || null
  });

  // Clear inputs
  document.getElementById('manualChar').value = '';
  document.getElementById('manualScene').value = '';
  document.getElementById('manualPrompt').value = '';
  
  setTimeout(loadDashboard, 500);
});

document.getElementById('btnClearHistory').addEventListener('click', async () => {
  if (!confirm('Xóa toàn bộ lịch sử Done/Failed?')) return;
  await chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY' });
  loadDashboard();
});

document.getElementById('btnSaveSettings').addEventListener('click', async () => {
  const bridgeUrl = document.getElementById('settingBridgeUrl').value.trim();
  const webhookUrl = document.getElementById('settingDefaultWebhook').value.trim();
  const driveFolderId = document.getElementById('settingDriveFolderId').value.trim();
  const clientId = document.getElementById('settingDriveClientId').value.trim();
  const clientSecret = document.getElementById('settingDriveClientSecret').value.trim();
  const refreshToken = document.getElementById('settingDriveRefreshToken').value.trim();
  
  await chrome.runtime.sendMessage({
    type: 'UPDATE_SETTINGS',
    settings: { 
      bridgeUrl: bridgeUrl || 'http://localhost:3000',
      wsUrl: (bridgeUrl || 'http://localhost:3000').replace('http://', 'ws://').replace('https://', 'wss://') + '/stream',
      defaultWebhookUrl: webhookUrl || null,
      driveFolderId: driveFolderId || null,
      driveClientId: clientId || null,
      driveClientSecret: clientSecret || null,
      driveRefreshToken: refreshToken || null
    }
  });
  
  alert('Đã lưu cài đặt chung!');
  loadDashboard();
});

// Update settings when dashboard loads
const oldRenderConnection = renderConnection;
renderConnection = function(data) {
  oldRenderConnection(data);
  // Populate settings if not focused
  const bridgeInput = document.getElementById('settingBridgeUrl');
  const webhookInput = document.getElementById('settingDefaultWebhook');
  const folderInput = document.getElementById('settingDriveFolderId');
  const clientIdInput = document.getElementById('settingDriveClientId');
  const clientSecretInput = document.getElementById('settingDriveClientSecret');
  const refreshTokenInput = document.getElementById('settingDriveRefreshToken');
  
  if (data.settings) {
    if (document.activeElement !== bridgeInput) bridgeInput.value = data.settings.bridgeUrl || 'http://localhost:3000';
    if (document.activeElement !== webhookInput) webhookInput.value = data.settings.defaultWebhookUrl || '';
    if (document.activeElement !== folderInput) folderInput.value = data.settings.driveFolderId || '';
    if (document.activeElement !== clientIdInput) clientIdInput.value = data.settings.driveClientId || '';
    if (document.activeElement !== clientSecretInput) clientSecretInput.value = data.settings.driveClientSecret || '';
    if (document.activeElement !== refreshTokenInput) refreshTokenInput.value = data.settings.driveRefreshToken || '';
  }

  // Auto-refresh settings sync
  const autoRefreshInput = document.getElementById('autoRefreshInput');
  const autoRefreshStatus = document.getElementById('autoRefreshStatus');
  const minutes = data.autoRefreshMinutes || (data.settings && data.settings.autoRefreshMinutes) || 0;
  if (document.activeElement !== autoRefreshInput) {
    autoRefreshInput.value = minutes;
  }
  if (minutes > 0) {
    autoRefreshStatus.textContent = '✅ Đang bật: reload trang mỗi ' + minutes + ' phút';
    autoRefreshStatus.style.color = '#22c55e';
  } else {
    autoRefreshStatus.textContent = '⏹ Đã tắt auto-refresh';
    autoRefreshStatus.style.color = '#ef4444';
  }
};

// ==========================================
// AUTO-REFRESH EVENT HANDLERS
// ==========================================
document.getElementById('btnRefreshMinus').addEventListener('click', () => {
  const input = document.getElementById('autoRefreshInput');
  const val = parseInt(input.value) || 0;
  if (val > 0) input.value = val - 1;
});

document.getElementById('btnRefreshPlus').addEventListener('click', () => {
  const input = document.getElementById('autoRefreshInput');
  const val = parseInt(input.value) || 0;
  if (val < 60) input.value = val + 1;
});

document.getElementById('autoRefreshInput').addEventListener('change', () => {
  const input = document.getElementById('autoRefreshInput');
  let val = parseInt(input.value);
  if (isNaN(val) || val < 0) val = 0;
  if (val > 60) val = 60;
  input.value = val;
});

document.getElementById('btnSaveRefresh').addEventListener('click', async () => {
  const minutes = parseInt(document.getElementById('autoRefreshInput').value) || 0;
  await chrome.runtime.sendMessage({ type: 'UPDATE_AUTO_REFRESH', minutes });
  loadDashboard();
});

// ==========================================
// IMAGE UPLOAD EVENT HANDLERS
// ==========================================
let selectedFiles = [];

const dropArea = document.getElementById('dropArea');
const filePickerInput = document.getElementById('filePickerInput');
const selectedFilesContainer = document.getElementById('selectedFilesContainer');
const selectedCount = document.getElementById('selectedCount');
const selectedThumbnails = document.getElementById('selectedThumbnails');
const btnClearSelected = document.getElementById('btnClearSelected');
const uploadImageUrl = document.getElementById('uploadImageUrl');
const btnUploadToFlow = document.getElementById('btnUploadToFlow');
const uploadStatus = document.getElementById('uploadStatus');

if (dropArea && filePickerInput) {
  dropArea.addEventListener('click', () => filePickerInput.click());

  filePickerInput.addEventListener('change', () => {
    handleFilesSelected(Array.from(filePickerInput.files));
  });

  dropArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropArea.style.borderColor = '#a855f7';
    dropArea.style.background = 'rgba(168, 85, 247, 0.15)';
  });

  dropArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropArea.style.borderColor = '#7c3aed';
    dropArea.style.background = 'rgba(0, 0, 0, 0.25)';
  });

  dropArea.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropArea.style.borderColor = '#7c3aed';
    dropArea.style.background = 'rgba(0, 0, 0, 0.25)';
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    handleFilesSelected(files);
  });
}

function handleFilesSelected(files) {
  if (!files || files.length === 0) return;
  selectedFiles = [...selectedFiles, ...files];
  renderSelectedFiles();
}

function renderSelectedFiles() {
  if (!selectedFilesContainer || !selectedThumbnails) return;
  if (selectedFiles.length === 0) {
    selectedFilesContainer.style.display = 'none';
    selectedThumbnails.innerHTML = '';
    return;
  }
  selectedFilesContainer.style.display = 'block';
  selectedCount.textContent = selectedFiles.length + ' ảnh đã chọn';
  selectedThumbnails.innerHTML = '';
  
  selectedFiles.slice(0, 8).forEach(file => {
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.title = file.name;
    img.style.cssText = 'width:40px; height:40px; object-fit:cover; border-radius:4px; border:1px solid #7c3aed;';
    selectedThumbnails.appendChild(img);
  });
  if (selectedFiles.length > 8) {
    const more = document.createElement('div');
    more.textContent = '+' + (selectedFiles.length - 8);
    more.style.cssText = 'width:40px; height:40px; display:flex; align-items:center; justify-content:center; background:#1e1b4b; border-radius:4px; font-size:11px; font-weight:bold; color:#a855f7;';
    selectedThumbnails.appendChild(more);
  }
}

if (btnClearSelected) {
  btnClearSelected.addEventListener('click', (e) => {
    e.preventDefault();
    selectedFiles = [];
    if (filePickerInput) filePickerInput.value = '';
    renderSelectedFiles();
  });
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      type: file.type,
      size: file.size,
      base64: reader.result
    });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

if (btnUploadToFlow) {
  btnUploadToFlow.addEventListener('click', async () => {
    const url = uploadImageUrl?.value.trim() || '';
    if (selectedFiles.length === 0 && !url) {
      alert('Vui lòng chọn ít nhất 1 ảnh từ máy tính hoặc dán URL ảnh!');
      return;
    }

    btnUploadToFlow.disabled = true;
    btnUploadToFlow.textContent = '⏳ Đang tải ảnh lên...';
    uploadStatus.style.display = 'block';
    uploadStatus.style.background = 'rgba(59, 130, 246, 0.2)';
    uploadStatus.style.color = '#60a5fa';
    uploadStatus.textContent = 'Đang chuẩn bị nạp ảnh vào Flow...';

    try {
      const filesPayload = [];
      if (selectedFiles.length > 0) {
        for (const f of selectedFiles) {
          const b64Data = await fileToBase64(f);
          filesPayload.push(b64Data);
        }
      }
      if (url) {
        filesPayload.push({ url: url });
      }

      const response = await chrome.runtime.sendMessage({
        type: 'UPLOAD_IMAGE_TO_FLOW',
        files: filesPayload
      });

      if (response && response.ok) {
        uploadStatus.style.background = 'rgba(34, 197, 94, 0.2)';
        uploadStatus.style.color = '#4ade80';
        uploadStatus.textContent = '✅ Đã nạp thành công ' + filesPayload.length + ' ảnh vào Flow!';
        selectedFiles = [];
        if (filePickerInput) filePickerInput.value = '';
        if (uploadImageUrl) uploadImageUrl.value = '';
        renderSelectedFiles();
      } else {
        uploadStatus.style.background = 'rgba(239, 68, 68, 0.2)';
        uploadStatus.style.color = '#f87171';
        uploadStatus.textContent = '❌ ' + (response?.error || 'Không thể upload ảnh vào Flow');
      }
    } catch (err) {
      uploadStatus.style.background = 'rgba(239, 68, 68, 0.2)';
      uploadStatus.style.color = '#f87171';
      uploadStatus.textContent = '❌ ' + err.message;
    } finally {
      btnUploadToFlow.disabled = false;
      btnUploadToFlow.textContent = '🚀 Tải ảnh lên Flow ngay';
      setTimeout(() => {
        if (uploadStatus) uploadStatus.style.display = 'none';
      }, 6000);
    }
  });
}

// ==========================================
// INIT
// ==========================================
loadDashboard();
setInterval(loadDashboard, 2000);
