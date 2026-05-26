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
    downloadPath: 'FlowVideos'
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
      // Force settings to reflect latest constants (prevent stale localhost overrides)
      state.settings.bridgeUrl = BRIDGE_URL;
      state.settings.wsUrl = WS_URL;
    }
  } catch (e) {
    console.error('[FlowAuto] loadState error:', e);
  }
}

function saveState() {
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
}

function addLog(msg) {
  const entry = '[' + new Date().toLocaleTimeString('vi-VN') + '] ' + msg;
  state.logs.unshift(entry);
  if (state.logs.length > 500) state.logs.length = 500;
  saveState();
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
    case 'new_job':
      enqueueJob(msg.job);
      break;

    case 'cancel_job':
      cancelJob(msg.jobId);
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
  job.status = 'QUEUED';
  job.queuedAt = Date.now();
  job.id = job.id || (job.projectId + '_' + job.sceneId + '_' + Date.now());

  state.queue.push(job);
  addLog('📥 Queued: ' + job.sceneId + (job.character ? ' (' + job.character + ')' : ''));
  saveState();

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
  state.currentState = FLOW_STATES.FIND_CHARACTER;
  state.retryCount = 0;
  saveState();

  addLog('🚀 Starting: ' + job.sceneId);
  sendToBridge({ type: 'job_started', jobId: job.id });
  dispatchJobToContentScript(job);
}

async function dispatchJobToContentScript(job) {
  try {
    const tab = await findOrOpenFlowTab(job.projectId);
    if (!tab) {
      addLog('❌ Cannot find/open Google Flow tab');
      failCurrentJob('Cannot find Google Flow tab');
      return;
    }

    addLog('📤 Dispatching to tab #' + tab.id);

    // Try sending message directly first
    const sent = await trySendToContentScript(tab.id, job);
    if (sent) return;

    // Content script not present — inject programmatically
    addLog('💉 Injecting content scripts into tab...');
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

function completeCurrentJob(result) {
  if (!state.currentJob) return;

  const job = { ...state.currentJob };
  
  // Natively download videos using chrome.downloads API
  if (result && result.videos) {
    result.videos.forEach(v => {
      if (v.base64) {
        chrome.downloads.download({
          url: v.base64,
          filename: 'Veo/' + v.filename,
          conflictAction: 'uniquify'
        }, (downloadId) => {
           if (chrome.runtime.lastError) {
             addLog('❌ Download local lỗi: ' + chrome.runtime.lastError.message);
           }
        });
      }
    });
    
    // Strip Base64 from payload to prevent Bridge/Webhook crashes
    result.videos = result.videos.map(v => ({ filename: v.filename, url: v.url }));
  }

  job.status = 'COMPLETED';
  job.completedAt = Date.now();
  job.duration = job.completedAt - (job.startedAt || job.queuedAt);
  job.result = result;

  state.completedJobs.unshift(job);
  if (state.completedJobs.length > 50) state.completedJobs.length = 50;

  const durationStr = Math.round((job.duration || 0) / 1000) + 's';
  addLog('✅ Completed: ' + job.sceneId + ' (' + durationStr + ')');

  const finalCallbackUrl = job.callbackUrl || state.settings?.defaultWebhookUrl || null;

  sendToBridge({
    type: 'job_completed',
    jobId: job.id,
    projectId: job.projectId,
    sceneId: job.sceneId,
    status: 'completed',
    result: result,
    callbackUrl: finalCallbackUrl
  });

  state.currentJob = null;
  state.currentState = FLOW_STATES.IDLE;
  state.retryCount = 0;
  saveState();

  // Process next after delay
  setTimeout(processQueue, 2000);
}

function failCurrentJob(error) {
  if (!state.currentJob) return;

  const job = { ...state.currentJob };
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
    projectId: job.projectId,
    sceneId: job.sceneId,
    status: 'failed',
    error: error,
    callbackUrl: finalCallbackUrl
  });

  state.currentJob = null;
  state.currentState = FLOW_STATES.IDLE;
  state.retryCount = 0;
  saveState();

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

// ==========================================
// TAB MANAGEMENT
// ==========================================
async function findFlowTab() {
  // Try specific Flow URL patterns
  const patterns = [
    'https://labs.google/fx/vi/tools/flow/*',
    'https://labs.google/fx/*/tools/flow/*',
    'https://labs.google/fx/*'
  ];

  for (const pattern of patterns) {
    try {
      const tabs = await chrome.tabs.query({ url: pattern });
      for (const tab of tabs) {
        if (tab.url && tab.url.includes('/tools/flow')) {
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

async function findOrOpenFlowTab(projectId) {
  let targetUrl = 'https://labs.google/fx/vi/tools/flow';
  if (projectId && projectId !== 'default' && projectId !== 'test_n8n') {
     targetUrl = `https://labs.google/fx/vi/tools/flow/project/${projectId}`;
  }

  let tab = await findFlowTab();
  
  if (tab) {
    // Check if the existing tab needs navigation
    const currentUrl = tab.url || '';
    if (projectId && projectId !== 'default' && projectId !== 'test_n8n' && !currentUrl.includes(`/project/${projectId}`)) {
       addLog('🌐 Navigating existing tab to project: ' + projectId);
       await chrome.tabs.update(tab.id, { url: targetUrl, active: true });
       // Wait for navigation and load
       return new Promise((resolve) => {
         const onUpdated = (tabId, changeInfo) => {
           if (tabId === tab.id && changeInfo.status === 'complete') {
             chrome.tabs.onUpdated.removeListener(onUpdated);
             setTimeout(() => resolve(tab), 3000); // Wait for SPA hydration
           }
         };
         chrome.tabs.onUpdated.addListener(onUpdated);
         setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve(tab); }, 15000);
       });
    }

    // Focus existing tab
    await chrome.tabs.update(tab.id, { active: true });
    try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) {}
    return tab;
  }

  // Open new tab
  addLog('🌐 Opening Google Flow tab: ' + targetUrl);
  tab = await chrome.tabs.create({ url: targetUrl });

  // Wait for page load
  return new Promise((resolve) => {
    const onUpdated = (tabId, changeInfo) => {
      if (tabId === tab.id && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(onUpdated);
        // Extra wait for SPA hydration
        setTimeout(() => resolve(tab), 4000);
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
      completeCurrentJob(msg.result);
      break;

    case MSG.JOB_ERROR:
      failCurrentJob(msg.error);
      break;

    // --- Debugger API for precise text injection ---
    case 'DEBUGGER_TYPE': {
      if (!sender || !sender.tab) { respond({ success: false }); return; }
      const tabId = sender.tab.id;
      const text = msg.text || '';
      
      (async () => {
        try {
          const target = { tabId };
          await chrome.debugger.attach(target, "1.2");
          await chrome.debugger.sendCommand(target, "Input.insertText", { text: text });
          await chrome.debugger.detach(target);
          respond({ success: true });
        } catch (err) {
          try { await chrome.debugger.detach({ tabId }); } catch(e) {}
          respond({ success: false, error: err.message });
        }
      })();
      return true;
    }

    case 'DEBUGGER_ENTER': {
      if (!sender || !sender.tab) { respond({ success: false }); return; }
      const tabId = sender.tab.id;
      
      (async () => {
        try {
          const target = { tabId };
          await chrome.debugger.attach(target, "1.2");
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
          await chrome.debugger.detach(target);
          respond({ success: true });
        } catch (err) {
          try { await chrome.debugger.detach({ tabId }); } catch(e) {}
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
        settings: state.settings
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

    case MSG.SKIP_JOB:
      if (state.currentJob) failCurrentJob('Skipped by user');
      respond({ ok: true });
      return true;

    case MSG.CLEAR_LOGS:
      state.logs = [];
      saveState();
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

    case MSG.MANUAL_JOB:
      // Submit job directly from popup
      enqueueJob({
        id: 'manual_' + Date.now(),
        projectId: msg.projectId || 'manual',
        sceneId: msg.sceneId || 'scene_' + Date.now(),
        character: msg.character || '',
        prompt: msg.prompt,
        callbackUrl: msg.callbackUrl || null
      });
      respond({ ok: true });
      return true;

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
      }
      respond({ ok: true });
      return true;
  }
});

// ==========================================
// KEEPALIVE ALARM (MV3 Service Worker persistence)
// ==========================================
chrome.alarms.create('flowAutoKeepalive', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flowAutoKeepalive') {
    // Keep service worker alive while processing
    if (state.currentJob || state.queue.length > 0) {
      addLog('💓 Alive — State: ' + state.currentState +
        ' | Queue: ' + state.queue.length +
        ' | Job: ' + (state.currentJob?.sceneId || 'none'));
    }

    // Reconnect WebSocket if needed
    if (!state.wsConnected) {
      connectWS();
    }
  }
});

// ==========================================
// INIT
// ==========================================
loadState().then(() => {
  addLog('🚀 Flow Auto Generator v4.0 started');
  connectWS();

  // Resume interrupted job
  if (state.currentJob && state.currentJob.status === 'PROCESSING') {
    addLog('🔄 Resuming interrupted job: ' + state.currentJob.sceneId);
    setTimeout(() => dispatchJobToContentScript(state.currentJob), 3000);
  }
});
