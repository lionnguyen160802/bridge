// content.js — State Machine Automation Controller v4.4
// Injected into Google Flow pages by manifest content_scripts
// Depends on: constants.js (loaded before this in manifest)

// ==========================================
// RE-INJECTION GUARD — prevent listener accumulation on 24/7 VPS
// ==========================================
if (window._flowAutoContentLoaded) {
  console.log('[FlowAuto v4.4] Content script already loaded, skipping re-injection');
  // Don't re-inject inject.js, don't add duplicate listeners
} else {
  window._flowAutoContentLoaded = true;

// ==========================================
// INJECT PAGE-CONTEXT SCRIPT (only once)
// ==========================================
const _injectScript = document.createElement('script');
_injectScript.src = chrome.runtime.getURL('inject.js');
_injectScript.onload = () => _injectScript.remove();
(document.head || document.documentElement).appendChild(_injectScript);

// ==========================================
// STATE MACHINE
// ==========================================
let currentJob = null;
let currentState = FLOW_STATES.IDLE;
let retryCount = 0;
let stateTimeoutId = null;
let retryTimeoutId = null;
let pendingAction = null;
let stopped = false;
let currentCharacterList = [];
let currentCharacterIndex = 0;

const STATE_SEQUENCE = [
  FLOW_STATES.CREATE_PROJECT,
  FLOW_STATES.UPLOAD_IMAGE,
  FLOW_STATES.FIND_CHARACTER,
  FLOW_STATES.HOVER_CHARACTER,
  FLOW_STATES.CLICK_MORE_MENU,
  FLOW_STATES.WAIT_MENU,
  FLOW_STATES.CLICK_ADD_BUTTON,
  FLOW_STATES.WAIT_TEXTAREA,
  FLOW_STATES.INJECT_PROMPT,
  FLOW_STATES.VERIFY_INPUT,
  FLOW_STATES.PRESS_ENTER,
  FLOW_STATES.WAIT_RENDER,
  FLOW_STATES.DETECT_COMPLETE,
  FLOW_STATES.DOWNLOAD_VIDEO,
  FLOW_STATES.DONE
];

function nextState(state) {
  // If action is create_project_only, stop right after project is created
  if (currentJob?.action === 'create_project' && state === FLOW_STATES.CREATE_PROJECT) {
    // If images are provided with create_project, proceed to upload image first
    if (currentJob.images && currentJob.images.length > 0) {
      return FLOW_STATES.UPLOAD_IMAGE;
    }
    return FLOW_STATES.DONE;
  }

  // If action is upload_only, stop right after upload completes
  if ((currentJob?.action === 'upload_only' || currentJob?.action === 'create_project') && state === FLOW_STATES.UPLOAD_IMAGE) {
    return FLOW_STATES.DONE;
  }

  // If we just clicked add button, check if there are more characters to process
  // NOTE: currentCharacterIndex is incremented BEFORE this call (in the success handler)
  if (state === FLOW_STATES.CLICK_ADD_BUTTON) {
    if (currentCharacterIndex < currentCharacterList.length - 1) {
      return FLOW_STATES.FIND_CHARACTER; // Loop back for next character
    }
  }

  const idx = STATE_SEQUENCE.indexOf(state);
  if (idx >= 0 && idx < STATE_SEQUENCE.length - 1) {
    return STATE_SEQUENCE[idx + 1];
  }
  return FLOW_STATES.DONE;
}

function getRetryDelay() {
  const delays = RETRY_DELAYS[currentState] || [1000, 2000, 5000];
  return delays[Math.min(retryCount, delays.length - 1)];
}

function getMaxRetries() {
  return (RETRY_DELAYS[currentState] || [1000, 2000, 5000]).length;
}

function getTimeout() {
  return STATE_TIMEOUTS[currentState] || 30000;
}

// ==========================================
// STATE TRANSITIONS
// ==========================================
function transitionTo(newState, logMsg) {
  if (stopped) return;

  clearTimeout(stateTimeoutId);
  currentState = newState;
  retryCount = 0;

  const label = STATE_LABELS[newState] || newState;
  const msg = logMsg || ('→ ' + label);
  reportState(newState, msg);

  if (newState === FLOW_STATES.DONE) {
    completeJob(currentJob?.result || { success: true, message: 'Flow completed successfully' });
    return;
  }

  if (newState === FLOW_STATES.CALLBACK_RESULT) {
    transitionTo(FLOW_STATES.DONE, '✅ Callback sent');
    return;
  }

  if (newState === FLOW_STATES.ERROR) {
    return;
  }

  stateTimeoutId = setTimeout(() => {
    onStateTimeout();
  }, getTimeout());

  executeState(newState);
}

function retryState() {
  if (stopped) return;

  retryCount++;
  const maxR = getMaxRetries();

  if (retryCount >= maxR) {
    reportState(currentState, '❌ Max retries (' + maxR + ') reached for: ' + (STATE_LABELS[currentState] || currentState));
    errorJob('Max retries exceeded at state: ' + currentState);
    return;
  }

  const delay = getRetryDelay();
  reportState(currentState, '🔄 Retry ' + retryCount + '/' + maxR + ' in ' + (delay / 1000) + 's — ' + (STATE_LABELS[currentState] || currentState));

  retryTimeoutId = setTimeout(() => {
    if (!stopped) executeState(currentState);
  }, delay);
}

function onStateTimeout() {
  reportState(currentState, '⏰ Timeout at: ' + (STATE_LABELS[currentState] || currentState));
  retryState();
}

// ==========================================
// STATE EXECUTION
// ==========================================
function executeState(state) {
  if (stopped || !currentJob) return;

  const charName = currentCharacterList[currentCharacterIndex];

  switch (state) {
    case FLOW_STATES.CREATE_PROJECT:
      sendAction('createProject', {});
      break;

    case FLOW_STATES.UPLOAD_IMAGE:
      if (!currentJob?.images || currentJob.images.length === 0) {
        transitionTo(FLOW_STATES.FIND_CHARACTER, '⏭️ Không có ảnh — chuyển sang tìm nhân vật');
        return;
      }
      sendAction('uploadImage', { files: currentJob.images });
      break;

    case FLOW_STATES.FIND_CHARACTER:
      if (!charName) {
        // No character — skip to WAIT_TEXTAREA (find the prompt input directly)
        transitionTo(FLOW_STATES.WAIT_TEXTAREA, '⏭️ No character — skipping to prompt input');
        return;
      }
      sendAction('findCharacter', { name: charName });
      break;

    case FLOW_STATES.HOVER_CHARACTER:
      sendAction('hoverCharacter', { name: charName });
      break;

    case FLOW_STATES.CLICK_MORE_MENU:
      sendAction('clickMoreMenu', { name: charName });
      break;

    case FLOW_STATES.WAIT_MENU:
      sendAction('waitMenu', {});
      break;

    case FLOW_STATES.CLICK_ADD_BUTTON:
      sendAction('clickAddButton', {});
      break;

    case FLOW_STATES.WAIT_TEXTAREA:
      sendAction('waitTextarea', {});
      break;

    case FLOW_STATES.INJECT_PROMPT:
      sendAction('injectPrompt', { prompt: currentJob.prompt });
      break;

    case FLOW_STATES.VERIFY_INPUT:
      sendAction('verifyInput', { prompt: currentJob.prompt });
      break;

    case FLOW_STATES.PRESS_ENTER:
      sendAction('pressEnter', {});
      break;

    case FLOW_STATES.WAIT_RENDER:
      sendAction('waitRender', {});
      break;

    case FLOW_STATES.DETECT_COMPLETE:
      sendAction('detectComplete', {});
      break;

    case FLOW_STATES.DOWNLOAD_VIDEO:
      sendAction('downloadVideo', {
        projectId: currentJob.projectId,
        sceneId: currentJob.sceneId
      });
      break;
  }
}

// ==========================================
// COMMUNICATION WITH inject.js
// ==========================================
function sendAction(action, params) {
  pendingAction = action;
  window.postMessage({
    type: MSG.INJECT_ACTION,
    action: action,
    params: params
  }, '*');
}

window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  if (event.data.type === MSG.INJECT_RESULT) {
    const { action, success, data, error } = event.data;

    if (action !== pendingAction) return;
    pendingAction = null;

    if (success) {
      const log = data?.log || ('✓ ' + action);
      reportState(currentState, log);

      if (
        (currentState === FLOW_STATES.WAIT_RENDER && data?.status === 'monitoring') ||
        (currentState === FLOW_STATES.DOWNLOAD_VIDEO && data?.status === 'monitoring')
      ) {
        return;
      }

      // Save newly created projectId to currentJob
      if (currentState === FLOW_STATES.CREATE_PROJECT && data?.projectId) {
        currentJob.projectId = data.projectId;
        if (!currentJob.result) currentJob.result = {};
        currentJob.result.projectId = data.projectId;
      }

      // Advance character index BEFORE computing next state
      if (currentState === FLOW_STATES.CLICK_ADD_BUTTON) {
        currentCharacterIndex++;
      }

      transitionTo(nextState(currentState));
    } else {
      reportState(currentState, '⚠️ ' + action + ': ' + (error || 'failed'));
      retryState();
    }
  }

  if (event.data.type === MSG.RENDER_PROGRESS) {
    reportState(FLOW_STATES.WAIT_RENDER, '🎬 ' + (event.data.progress || 'Rendering...'));
  }

  if (event.data.type === 'FLOW_VIDEO_DETECTED') {
    if (currentState === FLOW_STATES.WAIT_RENDER) {
      reportState(FLOW_STATES.WAIT_RENDER, '🎬 Video element detected!');
      transitionTo(FLOW_STATES.DETECT_COMPLETE);
    }
  }

  if (event.data.type === MSG.DOWNLOAD_DONE) {
    if (currentState === FLOW_STATES.DOWNLOAD_VIDEO) {
      const videosCount = event.data.videos ? event.data.videos.length : 0;
      reportState(FLOW_STATES.DOWNLOAD_VIDEO, '💾 Downloaded/Encoded ' + videosCount + ' videos');
      currentJob.result = {
        videos: event.data.videos || [],
        token: event.data.token || ''
      };
      transitionTo(FLOW_STATES.DONE, '📤 Processing video payload...');
    }
  }

  if (event.data.type === MSG.INJECT_LOG) {
    chrome.runtime.sendMessage({ type: 'LOG', message: event.data.message }).catch(() => {});
  }
  
  if (event.data.type === 'FLOW_DEBUGGER_TYPE') {
    chrome.runtime.sendMessage({
      type: 'DEBUGGER_TYPE',
      text: event.data.text
    }, (response) => {
      window.postMessage({
        type: 'FLOW_DEBUGGER_RESULT',
        success: response?.success,
        error: response?.error
      }, '*');
    });
  }

  if (event.data.type === 'FLOW_DEBUGGER_ENTER') {
    chrome.runtime.sendMessage({
      type: 'DEBUGGER_ENTER'
    }, (response) => {
      window.postMessage({
        type: 'FLOW_DEBUGGER_ENTER_RESULT',
        success: response?.success,
        error: response?.error
      }, '*');
    });
  }
});

// ==========================================
// JOB LIFECYCLE
// ==========================================
function startJob(job) {
  stopped = false;
  currentJob = job;
  retryCount = 0;
  pendingAction = null;
  clearTimeout(stateTimeoutId);

  // Parse comma-separated characters
  currentCharacterList = [];
  if (job.character) {
    currentCharacterList = job.character.split(',').map(c => c.trim()).filter(c => c.length > 0);
  }
  currentCharacterIndex = 0;

  reportState(FLOW_STATES.IDLE, '🚀 Job started: ' + job.sceneId + (job.character ? ' (' + job.character + ')' : ''));
  
  if (job.action === 'create_project' || (!job.projectId && !window.location.href.includes('/project/'))) {
    transitionTo(FLOW_STATES.CREATE_PROJECT, '✨ Creating new project in Flow...');
  } else if (job.images && job.images.length > 0) {
    transitionTo(FLOW_STATES.UPLOAD_IMAGE, '🖼️ Uploading ' + job.images.length + ' image(s) to Flow...');
  } else {
    transitionTo(FLOW_STATES.FIND_CHARACTER, '🔍 Finding character: ' + (currentCharacterList[0] || '(none)'));
  }
}

function completeJob(result) {
  clearTimeout(stateTimeoutId);
  stopped = true;
  currentState = FLOW_STATES.IDLE;
  pendingAction = null;

  chrome.runtime.sendMessage({
    type: MSG.JOB_COMPLETE,
    jobId: currentJob?.id,
    result: result || {}
  }).catch(() => {});

  currentJob = null;
  retryCount = 0;
}

function errorJob(error) {
  clearTimeout(stateTimeoutId);
  stopped = true;
  currentState = FLOW_STATES.ERROR;
  pendingAction = null;

  chrome.runtime.sendMessage({
    type: MSG.JOB_ERROR,
    jobId: currentJob?.id,
    error: error
  }).catch(() => {});

  currentJob = null;
  retryCount = 0;
}

function stopJob() {
  clearTimeout(stateTimeoutId);
  clearTimeout(retryTimeoutId);
  stopped = true;
  currentJob = null;
  currentState = FLOW_STATES.IDLE;
  retryCount = 0;
  pendingAction = null;
  currentCharacterList = [];
  currentCharacterIndex = 0;
  reportState(FLOW_STATES.IDLE, '🛑 Job stopped');
}

// ==========================================
// REPORTING TO BACKGROUND
// ==========================================
function reportState(state, log) {
  chrome.runtime.sendMessage({
    type: MSG.STATE_UPDATE,
    state: state,
    retryCount: retryCount,
    log: log
  }).catch(() => {});
}

// ==========================================
// MESSAGE HANDLER (from background)
// ==========================================
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === MSG.EXECUTE_JOB) {
    if (currentJob) stopJob();
    startJob(msg.job);
    respond({ ok: true });
    return true;
  }

  if (msg.type === MSG.STOP_JOB) {
    stopJob();
    respond({ ok: true });
    return true;
  }

  if (msg.type === 'HEALTH_CHECK') {
    respond({ ok: true, state: currentState, hasJob: !!currentJob });
    return true;
  }

  if (msg.type === MSG.UPLOAD_IMAGE_TO_FLOW) {
    const files = msg.files || msg.images || [];
    sendAction('uploadImage', { files: files });
    
    // Listen for inject result or timeout
    const onResult = (event) => {
      if (event.source !== window || event.data?.type !== MSG.INJECT_RESULT) return;
      if (event.data.action === 'uploadImage') {
        window.removeEventListener('message', onResult);
        respond({ ok: event.data.success, data: event.data.data, error: event.data.error });
      }
    };
    window.addEventListener('message', onResult);
    setTimeout(() => {
      window.removeEventListener('message', onResult);
      respond({ ok: true, message: 'Upload command sent' });
    }, 15000);
    return true;
  }

  if (msg.type === MSG.GET_DASHBOARD) {
    return false;
  }
});

// ==========================================
// INIT
// ==========================================
console.log('[FlowAuto v4.4] Content script loaded on:', window.location.href);
reportState(FLOW_STATES.IDLE, '📌 Content script ready');

} // end of re-injection guard else block
