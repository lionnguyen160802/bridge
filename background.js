// background.js — Flow Auto Generator v4.0
// Service Worker: WebSocket client + Job Queue + Tab Management + Message Router
importScripts('constants.js');

// ==========================================
// STATE
// ==========================================
let state = {
  wsConnected: false,
  currentJob: null,
  currentState: FLOW_STATES.IDLE,
  queue: [],
  completedJobs: [],
  failedJobs: [],
  logs: [],
  paused: false,
  retryCount: 0,
  settings: {
    bridgeUrl: BRIDGE_URL,
    wsUrl: WS_URL,
    downloadPath: 'FlowVideos',
    autoRefreshMinutes: 3  // Auto-refresh Flow tab every N minutes (0 = disabled)
  }
};

let ws = null;
let reconnectAttempt = 0;
let heartbeatTimer = null;

// ==========================================
// PERSISTENCE
// ==========================================
async function loadState() {
  try {
    const data = await chrome.storage.local.get('flowAutoState');
    if (data.flowAutoState) {
      state = { ...state, ...data.flowAutoState };
      // Don't restore WebSocket state — always start fresh
      state.wsConnected = false;
      
      // Filter out stale queue items older than 15 minutes
      const MAX_AGE = 15 * 60 * 1000;
      if (Array.isArray(state.queue)) {
        state.queue = state.queue.filter(j => !j.queuedAt || (Date.now() - j.queuedAt < MAX_AGE));
      } else {
        state.queue = [];
      }

      // Retain correlation for a still-running content script. Initialization
      // must NOT redispatch this job (create_project is not replay-safe).
      if (state.currentJob) state.currentJob.recovered = true;
      if (!state.currentJob) state.currentState = FLOW_STATES.IDLE;
      state.retryCount = 0;

      // Ensure settings object exists
      if (!state.settings) {
        state.settings = {
          bridgeUrl: BRIDGE_URL,
          wsUrl: WS_URL
        };
      }
    }
  } catch (e) {
    console.error('[FlowAuto] loadState error:', e);
  }
}

let _saveTimeout = null;
function saveState() {
  // Debounce: coalesce rapid writes into one (max 2s delay)
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(() => {
    _saveTimeout = null;
    try {
      chrome.storage.local.set({
        flowAutoState: {
          currentJob: state.currentJob,
          currentState: state.currentState,
          queue: state.queue,
          completedJobs: state.completedJobs.slice(0, 50),
          failedJobs: state.failedJobs.slice(0, 50),
          logs: state.logs.slice(0, 300),
          paused: state.paused,
          retryCount: state.retryCount,
          settings: state.settings
        }
      });
    } catch (e) {
      console.error('[FlowAuto] saveState error:', e);
    }
  }, 2000);
}

// Force immediate save (for critical state changes like job start/complete)
function saveStateNow() {
  if (_saveTimeout) { clearTimeout(_saveTimeout); _saveTimeout = null; }
  try {
    chrome.storage.local.set({
      flowAutoState: {
        currentJob: state.currentJob,
        currentState: state.currentState,
        queue: state.queue,
        completedJobs: state.completedJobs.slice(0, 50),
        failedJobs: state.failedJobs.slice(0, 50),
        logs: state.logs.slice(0, 300),
        paused: state.paused,
        retryCount: state.retryCount,
        settings: state.settings
      }
    });
  } catch (e) {
    console.error('[FlowAuto] saveStateNow error:', e);
  }
}

function addLog(msg) {
  const entry = '[' + new Date().toLocaleTimeString('vi-VN') + '] ' + msg;
  state.logs.unshift(entry);
  if (state.logs.length > 500) state.logs.length = 500;
  saveState(); // debounced — won't hammer storage
  console.log('[FlowAuto]', msg);
}

// ==========================================
// WEBSOCKET CLIENT
// ==========================================
function connectWS() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return; // Already connected or connecting
  }

  try {
    addLog('🔗 Connecting to bridge: ' + state.settings.wsUrl);
    ws = new WebSocket(state.settings.wsUrl);

    ws.onopen = () => {
      state.wsConnected = true;
      reconnectAttempt = 0;
      addLog('✅ Bridge connected');
      saveState();

      // Register as extension client
      ws.send(JSON.stringify({ type: 'register', client: 'extension' }));

      // Start heartbeat
      startHeartbeat();
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleBridgeMessage(msg);
      } catch (e) {
        addLog('⚠️ Invalid bridge message: ' + e.message);
      }
    };

    ws.onclose = (event) => {
      state.wsConnected = false;
      stopHeartbeat();
      saveState();
      addLog('🔌 Bridge disconnected (code: ' + event.code + ')');
      scheduleReconnect();
    };

    ws.onerror = () => {
      // Error details logged by onclose
    };
  } catch (e) {
    addLog('❌ WebSocket error: ' + e.message);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  const delay = WS_RECONNECT_DELAYS[Math.min(reconnectAttempt, WS_RECONNECT_DELAYS.length - 1)];
  reconnectAttempt++;
  addLog('🔄 Reconnect in ' + (delay / 1000) + 's (attempt #' + reconnectAttempt + ')');
  setTimeout(connectWS, delay);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, WS_HEARTBEAT_INTERVAL);
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function sendToBridge(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  addLog('⚠️ Bridge not connected, message dropped: ' + msg.type);
  return false;
}

// ==========================================
// BRIDGE MESSAGE HANDLER
// ==========================================
function handleBridgeMessage(msg) {
  switch (msg.type) {
    case 'reconcile_job': {
      // Result replay only: an unknown job must never start new Flow work.
      const completed = state.completedJobs.find(j => j.id === msg.jobId);
      const failed = state.failedJobs.find(j => j.id === msg.jobId);
      if (completed) {
        sendToBridge({ type: 'job_completed', jobId: completed.id,
          projectId: completed.projectId, result: completed.result || {} });
      } else if (failed) {
        sendToBridge({ type: 'job_failed', jobId: failed.id, error: failed.error });
      }
      break;
    }

    case 'new_job':
      enqueueJob(msg.job);
      break;

    case 'cancel_job':
      cancelJob(msg.jobId);
      break;

    case 'clear_queue':
      clearAllQueue(true);
      break;

    case 'pause':
      state.paused = true;
      addLog('⏸️ Queue paused by bridge');
      saveState();
      break;

    case 'resume':
      state.paused = false;
      addLog('▶️ Queue resumed by bridge');
      saveState();
      processQueue();
      break;

    case 'pong':
      // Heartbeat response
      break;

    default:
      addLog('ℹ️ Bridge message: ' + msg.type);
  }
}

// ==========================================
// JOB QUEUE
// ==========================================
function enqueueJob(job) {
  if (!job || !job.id) return;

  // 1. Bỏ qua nếu job này đã hoàn thành trước đó (triệt để chống chạy lại job cũ)
  const alreadyCompleted = state.completedJobs.find(j => j.id === job.id);
  if (alreadyCompleted) {
    addLog('⚠️ Bỏ qua job đã hoàn thành: ' + (job.sceneId || job.id));
    sendToBridge({
      type: 'job_completed',
      jobId: job.id,
      result: alreadyCompleted.result || {}
    });
    return;
  }

  // 2. Bỏ qua nếu job này đang chạy
  if (state.currentJob && state.currentJob.id === job.id) {
    addLog('⚠️ Bỏ qua job đang trong tiến trình: ' + (job.sceneId || job.id));
    return;
  }

  // 3. Bỏ qua nếu job này đã có sẵn trong queue
  if (state.queue.some(j => j.id === job.id)) {
    addLog('⚠️ Bỏ qua job đã nằm trong hàng đợi: ' + (job.sceneId || job.id));
    return;
  }

  // 4. Bỏ qua nếu job đã tạo quá 15 phút trước (tránh zombie job từ server cũ)
  if (job.createdAt && (Date.now() - job.createdAt > 15 * 60 * 1000)) {
    addLog('⚠️ Bỏ qua job đã hết hạn (>15 phút): ' + (job.sceneId || job.id));
    return;
  }

  job.status = 'QUEUED';
  job.queuedAt = Date.now();
  job.id = job.id || (job.projectId + '_' + job.sceneId + '_' + Date.now());

  state.queue.push(job);
  addLog('📥 Queued: ' + job.sceneId + (job.character ? ' (' + job.character + ')' : ''));
  saveStateNow();

  sendToBridge({ type: 'job_queued', jobId: job.id });
  processQueue();
}

function processQueue() {
  if (state.paused) return;
  if (state.currentJob) return;
  if (state.queue.length === 0) return;

  const job = state.queue.shift();
  state.currentJob = job;
  state.currentJob.status = 'PROCESSING';
  state.currentJob.startedAt = Date.now();
  if (job.action === 'create_project' || (!job.projectId && !job.images?.length && !job.action)) {
    state.currentState = FLOW_STATES.CREATE_PROJECT;
  } else if (job.action === 'create_character') {
    state.currentState = (job.projectId && job.projectId !== 'manual') ? FLOW_STATES.GENERATE_CHARACTER : FLOW_STATES.CREATE_PROJECT;
  } else if (job.images && job.images.length > 0) {
    state.currentState = FLOW_STATES.UPLOAD_IMAGE;
  } else {
    state.currentState = FLOW_STATES.FIND_CHARACTER;
  }
  state.retryCount = 0;
  saveState();

  addLog('🚀 Starting: ' + job.sceneId);
  sendToBridge({ type: 'job_started', jobId: job.id });
  dispatchJobToContentScript(job);
}

async function dispatchJobToContentScript(job) {
  try {
    const tab = await findOrOpenFlowTab(job.projectId, job.action);
    if (!tab) {
      addLog('❌ Cannot find/open Google Flow tab');
      failCurrentJob('Cannot find Google Flow tab');
      return;
    }

    addLog('📤 Dispatching to tab #' + tab.id);

    // Health check: ping content script first
    const alive = await healthCheckContentScript(tab.id);
    if (alive) {
      const sent = await trySendToContentScript(tab.id, job);
      if (sent) return;
    }

    // Content script not responding — try refresh tab if it's been running a while
    addLog('💉 Content script not responding, refreshing tab...');
    await refreshFlowTab(tab);

    // After refresh, inject scripts
    addLog('💉 Injecting content scripts...');
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['constants.js', 'content.js']
      });
      addLog('✅ Content scripts injected');
    } catch (injectErr) {
      addLog('❌ Script injection failed: ' + injectErr.message);
      failCurrentJob('Cannot inject content scripts: ' + injectErr.message);
      return;
    }

    // Wait for scripts to initialize
    await new Promise(r => setTimeout(r, 2000));

    // Retry sending message after injection (up to 3 attempts)
    for (let attempt = 1; attempt <= 3; attempt++) {
      const ok = await trySendToContentScript(tab.id, job);
      if (ok) return;
      addLog('⚠️ Post-inject attempt ' + attempt + '/3 failed, waiting...');
      await new Promise(r => setTimeout(r, 1500));
    }

    addLog('❌ Content script still unreachable after injection');
    failCurrentJob('Content script unreachable after injection');
  } catch (e) {
    addLog('❌ Dispatch failed: ' + e.message);
    failCurrentJob('Dispatch failed: ' + e.message);
  }
}

// Health check: ping content script to see if it's alive
async function healthCheckContentScript(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: 'HEALTH_CHECK' });
    return response && response.ok;
  } catch (e) {
    return false;
  }
}

// Refresh the Flow tab to clear memory (critical for 24/7 VPS)
async function refreshFlowTab(tab) {
  try {
    addLog('🔄 Refreshing Flow tab to clear memory...');
    // Clear the re-injection guard flags by reloading the page
    await chrome.tabs.reload(tab.id);
    
    // Wait for page to fully load
    await new Promise((resolve) => {
      const onUpdated = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(onUpdated);
          setTimeout(resolve, 7000); // Wait 7s for SPA hydration
        }
      };
      chrome.tabs.onUpdated.addListener(onUpdated);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve(); }, 25000);
    });
    
    addLog('✅ Tab refreshed successfully');
  } catch (e) {
    addLog('⚠️ Tab refresh failed: ' + e.message);
  }
}

// Start/restart auto-refresh alarm based on settings
function setupAutoRefreshAlarm() {
  chrome.alarms.clear('flowAutoRefreshTab');
  const minutes = state.settings.autoRefreshMinutes || 0;
  if (minutes > 0) {
    chrome.alarms.create('flowAutoRefreshTab', { periodInMinutes: minutes });
    addLog('🔄 Auto-refresh trang: mỗi ' + minutes + ' phút');
  } else {
    addLog('🔄 Auto-refresh trang: TẮT');
  }
}

/**
 * Try to send EXECUTE_JOB message to content script.
 * Returns true if successful, false if unreachable.
 */
async function trySendToContentScript(tabId, job) {
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: MSG.EXECUTE_JOB,
      job: job
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function completeCurrentJob(result) {
  if (!state.currentJob) return;

  const job = { ...state.currentJob };

  // Immediately clear current job so any concurrent messages/reloads won't see or re-run it
  state.currentJob = null;
  state.currentState = FLOW_STATES.IDLE;
  state.retryCount = 0;
  saveStateNow(); // Critical state change — save immediately
  
  // Upload videos to Google Drive if configured
  const driveFolderId = job.driveFolderId || state.settings?.driveFolderId || null;

  if (result && result.videos) {
    const videosWithBase64 = [...result.videos];

    // Await Drive upload — don't fire-and-forget
    try {
      const driveToken = await ensureValidToken();
      for (const v of videosWithBase64) {
        if (!v.base64) continue;
        if (driveToken && driveFolderId) {
          addLog('📁 Đang upload lên Drive: ' + v.filename);
          const url = await uploadToDrive(v.base64, v.filename, driveFolderId, driveToken);
          if (url) addLog('✅ Đã lưu Drive: ' + url);
        }
      }
    } catch (uploadErr) {
      addLog('❌ Drive upload error: ' + uploadErr.message);
    }
    
    // Strip Base64 from payload to prevent Bridge/Webhook crashes
    result.videos = result.videos.map(v => ({ filename: v.filename, url: v.url }));
  }

  job.status = 'COMPLETED';
  job.completedAt = Date.now();
  job.duration = job.completedAt - (job.startedAt || job.queuedAt);
  if (result?.projectId) {
    job.projectId = result.projectId;
  }
  if (result?.character) {
    job.character = result.character;
  }
  const imgUrl = result?.characterImageUrl || result?.imageUrl || result?.imageSrc;
  if (imgUrl) {
    job.characterImageUrl = imgUrl;
    job.imageUrl = imgUrl;
    job.imageSrc = imgUrl;
  }
  job.result = result;

  state.completedJobs.unshift(job);
  if (state.completedJobs.length > 50) state.completedJobs.length = 50;

  const durationStr = Math.round((job.duration || 0) / 1000) + 's';
  addLog('✅ Completed: ' + job.sceneId + ' (' + durationStr + ')');

  const finalCallbackUrl = job.callbackUrl || state.settings?.defaultWebhookUrl || null;

  sendToBridge({
    type: 'job_completed',
    jobId: job.id,
    rowId: job.rowId,
    projectId: job.projectId || result?.projectId || null,
    sceneId: job.sceneId,
    status: 'completed',
    character: job.character || result?.character || null,
    characterImageUrl: imgUrl || null,
    imageUrl: imgUrl || null,
    imageSrc: imgUrl || null,
    result: result,
    callbackUrl: finalCallbackUrl
  });

  saveStateNow();

  // Đảm bảo tab quay về trang Canvas https://flow.google.com/project/{projectId} nếu vừa hoàn thành tạo nhân vật
  if (job.action === 'create_character' || (job.action === 'create_project' && job.prompt)) {
    const targetProjectId = job.projectId || result?.projectId;
    if (targetProjectId && targetProjectId !== 'manual' && targetProjectId !== 'new') {
      const canvasUrl = `https://flow.google.com/project/${targetProjectId}`;
      findFlowTab().then(tab => {
        if (tab && tab.url && tab.url.includes('/character')) {
          addLog('🌐 Đưa tab về lại Canvas: ' + canvasUrl);
          chrome.tabs.update(tab.id, { url: canvasUrl });
        }
      }).catch(() => {});
    }
  }

  // Process next after delay
  setTimeout(processQueue, 2000);
}

function failCurrentJob(error) {
  if (!state.currentJob) return;

  const job = { ...state.currentJob };

  // Immediately clear current job so any concurrent messages/reloads won't see or re-run it
  state.currentJob = null;
  state.currentState = FLOW_STATES.IDLE;
  state.retryCount = 0;
  saveStateNow(); // Critical state change — save immediately

  job.status = 'FAILED';
  job.failedAt = Date.now();
  job.error = error;

  state.failedJobs.unshift(job);
  if (state.failedJobs.length > 50) state.failedJobs.length = 50;

  addLog('❌ Failed: ' + job.sceneId + ' — ' + error);

  const finalCallbackUrl = job.callbackUrl || state.settings?.defaultWebhookUrl || null;

  sendToBridge({
    type: 'job_failed',
    jobId: job.id,
    rowId: job.rowId,
    projectId: job.projectId,
    sceneId: job.sceneId,
    status: 'failed',
    error: error,
    callbackUrl: finalCallbackUrl
  });

  saveStateNow();

  setTimeout(processQueue, 3000);
}

function cancelJob(jobId) {
  // Cancel current
  if (state.currentJob && state.currentJob.id === jobId) {
    addLog('🛑 Cancelling: ' + state.currentJob.sceneId);
    findFlowTab().then(tab => {
      if (tab) chrome.tabs.sendMessage(tab.id, { type: MSG.STOP_JOB }).catch(() => {});
    });
    failCurrentJob('Cancelled');
    return;
  }

  // Remove from queue
  const idx = state.queue.findIndex(j => j.id === jobId);
  if (idx >= 0) {
    const removed = state.queue.splice(idx, 1)[0];
    addLog('🗑️ Dequeued: ' + removed.sceneId);
    saveState();
  }
}

function clearAllQueue(fromBridge = false) {
  const count = state.queue.length;
  state.queue = [];

  // Hủy job đang chạy nếu có
  if (state.currentJob) {
    const activeId = state.currentJob.sceneId || state.currentJob.id;
    addLog('🛑 Dừng job đang chạy: ' + activeId);
    findFlowTab().then(tab => {
      if (tab) chrome.tabs.sendMessage(tab.id, { type: MSG.STOP_JOB }).catch(() => {});
    });
    failCurrentJob('Queue cleared by user');
  }

  state.currentState = FLOW_STATES.IDLE;
  state.retryCount = 0;
  addLog('🗑️ Đã xóa sạch toàn bộ hàng đợi (' + count + ' jobs)');
  saveStateNow();

  // Báo cho Bridge server xóa hàng đợi trên server luôn
  if (!fromBridge) {
    sendToBridge({ type: 'clear_queue' });
  }
}

// ==========================================
// TAB MANAGEMENT
// ==========================================
async function findFlowTab() {
  // Try specific Flow URL patterns (supports both new flow.google.com and legacy labs.google/fx)
  const patterns = [
    'https://flow.google.com/*',
    'https://labs.google/fx/vi/tools/flow/*',
    'https://labs.google/fx/*/tools/flow/*',
    'https://labs.google/fx/*'
  ];

  for (const pattern of patterns) {
    try {
      const tabs = await chrome.tabs.query({ url: pattern });
      for (const tab of tabs) {
        if (tab.url && (tab.url.includes('flow.google.com') || tab.url.includes('/tools/flow'))) {
          return tab;
        }
      }
      if (tabs.length > 0) return tabs[0];
    } catch (e) {
      // Pattern might not match, continue
    }
  }
  return null;
}

async function findOrOpenFlowTab(projectId, action) {
  let targetUrl = 'https://flow.google.com/';
  const isSpecialId = !projectId || projectId === 'default' || projectId === 'test_n8n' || projectId === 'manual' || projectId === 'new' || projectId === 'proj';
  if (!isSpecialId) {
    if (action === 'create_character') {
      targetUrl = `https://flow.google.com/project/${projectId}/character`;
    } else {
      targetUrl = `https://flow.google.com/project/${projectId}`;
    }
  }

  let tab = await findFlowTab();
  
  if (tab) {
    // Check if the existing tab needs navigation
    const currentUrl = tab.url || '';
    let needsNav = false;

    if (action === 'create_project') {
      // If we need to create a project, we MUST be at https://flow.google.com/ home (not inside an existing project!)
      if (currentUrl.includes('/project/')) {
        needsNav = true;
        targetUrl = 'https://flow.google.com/';
      }
    } else if (action === 'create_character') {
      if (projectId && !currentUrl.includes(`/project/${projectId}/character`)) {
        needsNav = true;
        targetUrl = `https://flow.google.com/project/${projectId}/character`;
      } else if (!projectId && currentUrl.includes('/project/')) {
        needsNav = true;
        targetUrl = 'https://flow.google.com/';
      }
    } else if (!isSpecialId && !currentUrl.includes(`/project/${projectId}`)) {
      needsNav = true;
    }

    if (needsNav) {
       addLog('🌐 Navigating to ' + targetUrl + ' (waiting 7s for page load)');
       await chrome.tabs.update(tab.id, { url: targetUrl, active: true });
       // Wait for navigation and load
       return new Promise((resolve) => {
         const onUpdated = (tabId, changeInfo) => {
           if (tabId === tab.id && changeInfo.status === 'complete') {
             chrome.tabs.onUpdated.removeListener(onUpdated);
             setTimeout(() => resolve(tab), 7000); // Wait 7s for SPA hydration + character grid
           }
         };
         chrome.tabs.onUpdated.addListener(onUpdated);
         setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve(tab); }, 20000);
       });
    }

    // Focus existing tab
    await chrome.tabs.update(tab.id, { active: true });
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) {}
    return tab;
  }

  // Open new tab
  addLog('🌐 Opening Google Flow tab (waiting 7s for page load): ' + targetUrl);
  tab = await chrome.tabs.create({ url: targetUrl });

  // Wait for page load
  return new Promise((resolve) => {
    const onUpdated = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        // Extra wait for SPA hydration + character grid
        setTimeout(() => resolve(tab), 7000);
      }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);

    // Fallback timeout
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(tab);
    }, 20000);
  });
}

// Helper for safe Chrome Debugger API execution
async function safeDebuggerCommand(tabId, fn) {
  const target = { tabId };
  let attachedHere = false;
  try {
    await chrome.debugger.attach(target, "1.2");
    attachedHere = true;
    await new Promise(r => setTimeout(r, 80));
  } catch (attachErr) {
    if (attachErr.message && attachErr.message.includes('already attached')) {
      attachedHere = false; // Already attached, can proceed
    } else {
      throw attachErr;
    }
  }

  try {
    return await fn(target);
  } finally {
    if (attachedHere) {
      try { await chrome.debugger.detach(target); } catch(e) {}
    }
  }
}

// ==========================================
// CHROME MESSAGE HANDLER
// ==========================================
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  switch (msg.type) {
    // --- From Content Script ---
    case MSG.STATE_UPDATE:
      state.currentState = msg.state;
      state.retryCount = msg.retryCount || 0;
      if (msg.log) addLog(msg.log);
      saveState();
      sendToBridge({
        type: 'state_update',
        jobId: state.currentJob?.id,
        state: msg.state,
        retryCount: msg.retryCount
      });
      break;

    case MSG.JOB_COMPLETE:
      if (!msg.jobId || msg.jobId !== state.currentJob?.id) break;
      completeCurrentJob(msg.result);
      break;

    case MSG.JOB_ERROR:
      if (!msg.jobId || msg.jobId !== state.currentJob?.id) break;
      failCurrentJob(msg.error);
      break;

    // --- Debugger API for precise text injection ---
    case 'DEBUGGER_TYPE': {
      if (!sender || !sender.tab) { respond({ success: false, error: 'No sender tab' }); return; }
      const tabId = sender.tab.id;
      const text = msg.text || '';
      
      (async () => {
        try {
          await safeDebuggerCommand(tabId, async (target) => {
            await chrome.debugger.sendCommand(target, "Input.insertText", { text: text });
          });
          respond({ success: true });
        } catch (err) {
          respond({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'DEBUGGER_ENTER': {
      if (!sender || !sender.tab) { respond({ success: false, error: 'No sender tab' }); return; }
      const tabId = sender.tab.id;
      
      (async () => {
        try {
          await safeDebuggerCommand(tabId, async (target) => {
            await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
              type: "rawKeyDown",
              windowsVirtualKeyCode: 13,
              unmodifiedText: "\r",
              text: "\r"
            });
            await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", {
              type: "keyUp",
              windowsVirtualKeyCode: 13
            });
          });
          respond({ success: true });
        } catch (err) {
          respond({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'DEBUGGER_CLICK': {
      if (!sender || !sender.tab) { respond({ success: false, error: 'No sender tab' }); return; }
      const tabId = sender.tab.id;
      const x = Math.round(msg.x || 0);
      const y = Math.round(msg.y || 0);

      (async () => {
        try {
          await safeDebuggerCommand(tabId, async (target) => {
            await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
              type: "mousePressed",
              x: x,
              y: y,
              button: "left",
              clickCount: 1
            });
            await new Promise(r => setTimeout(r, 60));
            await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
              type: "mouseReleased",
              x: x,
              y: y,
              button: "left",
              clickCount: 1
            });
          });
          respond({ success: true });
        } catch (err) {
          respond({ success: false, error: err.message });
        }
      })();
      return true;
    }

    // --- From Popup ---
    case MSG.GET_DASHBOARD:
      respond({
        wsConnected: state.wsConnected,
        currentJob: state.currentJob,
        currentState: state.currentState,
        queueLength: state.queue.length,
        queue: state.queue.slice(0, 20),
        completedJobs: state.completedJobs.slice(0, 10),
        completedCount: state.completedJobs.length,
        failedJobs: state.failedJobs.slice(0, 10),
        failedCount: state.failedJobs.length,
        retryCount: state.retryCount,
        paused: state.paused,
        logs: state.logs.slice(0, 100),
        settings: state.settings,
        autoRefreshMinutes: state.settings.autoRefreshMinutes || 0
      });
      return true;

    case MSG.PAUSE_QUEUE:
      state.paused = true;
      addLog('⏸️ Queue paused');
      saveState();
      sendToBridge({ type: 'pause' });
      respond({ ok: true });
      return true;

    case MSG.RESUME_QUEUE:
      state.paused = false;
      addLog('▶️ Queue resumed');
      saveState();
      sendToBridge({ type: 'resume' });
      processQueue();
      respond({ ok: true });
      return true;

    case MSG.CANCEL_JOB:
      if (state.currentJob) cancelJob(state.currentJob.id);
      respond({ ok: true });
      return true;

    case MSG.CLEAR_QUEUE:
    case 'CLEAR_QUEUE':
      clearAllQueue(false);
      respond({ ok: true });
      return true;

    case MSG.SKIP_JOB:
      if (state.currentJob) failCurrentJob('Skipped by user');
      respond({ ok: true });
      return true;

    case MSG.CLEAR_LOGS:
      state.logs = [];
      saveState();
      respond({ ok: true });
      return true;

    case 'CLEAR_HISTORY':
      state.completedJobs = [];
      state.failedJobs = [];
      state.retryCount = 0;
      addLog('🧹 Lịch sử Done/Failed đã được xóa');
      saveStateNow();
      respond({ ok: true });
      return true;

    case MSG.RETRY_JOB:
      if (msg.jobId) {
        const idx = state.failedJobs.findIndex(j => j.id === msg.jobId);
        if (idx >= 0) {
          const retryJob = { ...state.failedJobs.splice(idx, 1)[0] };
          retryJob.status = 'QUEUED';
          retryJob.retryAttempt = (retryJob.retryAttempt || 0) + 1;
          delete retryJob.error;
          delete retryJob.failedAt;
          enqueueJob(retryJob);
        }
      }
      respond({ ok: true });
      return true;

    case 'GET_ACTIVE_JOB':
      if (
        state.currentJob &&
        !state.currentJob.recovered &&
        state.currentJob.status === 'PROCESSING' &&
        state.currentState !== FLOW_STATES.DONE &&
        state.currentState !== FLOW_STATES.ERROR
      ) {
        respond({ job: state.currentJob, state: state.currentState });
      } else {
        respond({ job: null, state: FLOW_STATES.IDLE });
      }
      return true;

    case 'UPDATE_JOB_PROJECT_ID':
      if (state.currentJob) {
        state.currentJob.projectId = msg.projectId;
        saveState();
        addLog('📌 Saved project ID: ' + msg.projectId);
      }
      respond({ ok: true });
      return true;

    case MSG.MANUAL_JOB:
      // Submit job directly from popup
      enqueueJob({
        id: 'manual_' + Date.now(),
        projectId: msg.projectId || (msg.action === 'create_character' ? null : 'manual'),
        sceneId: msg.sceneId || 'scene_' + Date.now(),
        character: msg.character || '',
        prompt: msg.prompt,
        images: msg.images || [],
        action: msg.action || 'generate',
        callbackUrl: msg.callbackUrl || null,
        driveFolderId: msg.driveFolderId || null
      });
      respond({ ok: true });
      return true;

    case MSG.UPLOAD_IMAGE_TO_FLOW: {
      (async () => {
        try {
          const tab = await findFlowTab();
          if (!tab) {
            respond({ ok: false, error: 'Không tìm thấy tab Google Flow đang mở. Vui lòng mở trang Flow trước!' });
            return;
          }

          // Ensure content script is alive, if not, auto-inject it!
          const alive = await healthCheckContentScript(tab.id);
          if (!alive) {
            addLog('💉 Content script chưa nạp trên tab #' + tab.id + ', đang inject...');
            try {
              await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['constants.js', 'content.js']
              });
              await new Promise(r => setTimeout(r, 1200));
            } catch (injectErr) {
              addLog('❌ Không thể inject script vào tab: ' + injectErr.message);
              respond({ ok: false, error: 'Tab Flow chưa được tải lại (F5). Vui lòng nhấn F5 tab Flow rồi thử lại!' });
              return;
            }
          }

          addLog('🖼️ Đang gửi ' + (msg.files?.length || 1) + ' ảnh vào Flow...' + (msg.characterName ? ' (Đặt tên: ' + msg.characterName + ')' : ''));
          chrome.tabs.sendMessage(tab.id, {
            type: MSG.UPLOAD_IMAGE_TO_FLOW,
            files: msg.files,
            images: msg.images,
            characterName: msg.characterName
          }, (response) => {
            if (chrome.runtime.lastError) {
              respond({ ok: false, error: chrome.runtime.lastError.message });
            } else {
              respond(response || { ok: true });
            }
          });
        } catch (err) {
          respond({ ok: false, error: err.message });
        }
      })();
      return true;
    }

    case 'LOG':
      addLog(msg.message);
      break;

    case 'UPDATE_SETTINGS':
      if (msg.settings) {
        state.settings = { ...state.settings, ...msg.settings };
        saveState();
        addLog('⚙️ Settings updated');
        // Reconnect if bridge URL changed
        if (msg.settings.wsUrl || msg.settings.bridgeUrl) {
          if (ws) ws.close();
          setTimeout(connectWS, 500);
        }
        // Update auto-refresh alarm if changed
        if ('autoRefreshMinutes' in msg.settings) {
          setupAutoRefreshAlarm();
        }
      }
      respond({ ok: true });
      return true;

    case 'UPDATE_AUTO_REFRESH':
      state.settings.autoRefreshMinutes = msg.minutes || 0;
      saveState();
      setupAutoRefreshAlarm();
      respond({ ok: true });
      return true;
  }
});

// ==========================================
// KEEPALIVE ALARM (MV3 Service Worker persistence)
// ==========================================
chrome.alarms.create('flowAutoKeepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'flowAutoKeepalive') {
    // Keep service worker alive while processing
    if (state.currentJob || state.queue.length > 0) {
      addLog('💓 Alive — State: ' + state.currentState +
        ' | Queue: ' + state.queue.length +
        ' | Job: ' + (state.currentJob?.sceneId || 'none'));
    }

    // GLOBAL JOB TIMEOUT: If a job has been running > 15 minutes, force-fail it
    if (state.currentJob && state.currentJob.startedAt) {
      const elapsed = Date.now() - state.currentJob.startedAt;
      const MAX_JOB_DURATION = 15 * 60 * 1000; // 15 minutes
      if (elapsed > MAX_JOB_DURATION) {
        addLog('❌ Global timeout: Job ' + state.currentJob.sceneId + ' running for ' + Math.round(elapsed / 60000) + ' min. Force-failing...');
        failCurrentJob('Global timeout exceeded (' + Math.round(elapsed / 60000) + ' min)');
      }
    }

    // Reconnect WebSocket if needed
    if (!state.wsConnected) {
      connectWS();
    }
  }

  // Auto-refresh Flow tab periodically (time-based, not job-count-based)
  if (alarm.name === 'flowAutoRefreshTab') {
    // Skip refresh if a job is currently running
    if (state.currentJob) {
      addLog('🔄 Auto-refresh bị bỏ qua (đang chạy job: ' + state.currentJob.sceneId + ')');
      return;
    }
    const tab = await findFlowTab();
    if (tab) {
      addLog('🔄 Auto-refresh trang (mỗi ' + (state.settings.autoRefreshMinutes || 3) + ' phút — chống rò rỉ RAM)...');
      await refreshFlowTab(tab);
    }
  }
});

// ==========================================
// INIT
// ==========================================
loadState().then(() => {
  addLog('🚀 Flow Auto Generator v4.0 started');
  connectWS();
  setupAutoRefreshAlarm();

  // Keep the active ID for late content completion; do not replay automation.
  saveStateNow();
});

// ==========================================
// GOOGLE DRIVE UPLOAD & OAUTH
// ==========================================
async function ensureValidToken() {
  const { driveClientId, driveClientSecret, driveRefreshToken } = state.settings || {};
  let currentToken = state.settings?.driveToken || null;
  let tokenExpiry = state.settings?.tokenExpiry || 0;

  if (!driveClientId || !driveClientSecret || !driveRefreshToken) {
    return null; // Missing config
  }

  // If token is valid for at least 5 more minutes
  if (currentToken && tokenExpiry > Date.now() + 5 * 60 * 1000) {
    return currentToken;
  }

  addLog('🔄 Đang làm mới Google OAuth Token...');
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: driveClientId,
        client_secret: driveClientSecret,
        refresh_token: driveRefreshToken,
        grant_type: 'refresh_token'
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      addLog('❌ Lỗi Refresh Token: ' + res.status + ' ' + errText.substring(0, 100));
      return null;
    }

    const data = await res.json();
    currentToken = data.access_token;
    // Google tokens usually expire in 3600 seconds
    tokenExpiry = Date.now() + (data.expires_in * 1000); 

    // Save to state
    if (!state.settings) state.settings = {};
    state.settings.driveToken = currentToken;
    state.settings.tokenExpiry = tokenExpiry;
    saveState();

    addLog('✅ Làm mới Token thành công');
    return currentToken;
  } catch (err) {
    addLog('❌ Refresh Token bị lỗi mạng: ' + err.message);
    return null;
  }
}

async function uploadToDrive(base64data, fileName, driveFolderId, token) {
  try {
    const metadata = { name: fileName, mimeType: 'video/mp4', parents: [driveFolderId] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    
    // Convert base64 to blob
    const fetchRes = await fetch(base64data);
    const videoBlob = await fetchRes.blob();
    
    form.append('file', videoBlob);

    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token },
      body: form
    });
    
    if (!res.ok) {
      const text = await res.text();
      addLog('❌ Lỗi upload Drive: ' + res.status + ' ' + text.substring(0, 100));
      return null;
    }
    
    const file = await res.json();
    return 'https://drive.google.com/file/d/' + file.id + '/view';
  } catch (err) {
    addLog('❌ Lỗi upload Drive: ' + err.message);
    return null;
  }
}
