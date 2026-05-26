// content.js — State Machine Automation Controller v4.3
// Injected into Google Flow pages by manifest content_scripts
// Depends on: constants.js (loaded before this in manifest)

// ==========================================
// INJECT PAGE-CONTEXT SCRIPT
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
let pendingAction = null;
let stopped = false;

const STATE_SEQUENCE = [
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

  setTimeout(() => {
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

  switch (state) {
    case FLOW_STATES.FIND_CHARACTER:
      if (!currentJob.character) {
        // No character — skip to WAIT_TEXTAREA (find the prompt input directly)
        transitionTo(FLOW_STATES.WAIT_TEXTAREA, '⏭️ No character — skipping to prompt input');
        return;
      }
      sendAction('findCharacter', { name: currentJob.character });
      break;

    case FLOW_STATES.HOVER_CHARACTER:
      sendAction('hoverCharacter', { name: currentJob.character });
      break;

    case FLOW_STATES.CLICK_MORE_MENU:
      sendAction('clickMoreMenu', { name: currentJob.character });
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
        videos: event.data.videos || []
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

  reportState(FLOW_STATES.IDLE, '🚀 Job started: ' + job.sceneId + (job.character ? ' (' + job.character + ')' : ''));
  transitionTo(FLOW_STATES.FIND_CHARACTER, '🔍 Finding character: ' + (job.character || '(none)'));
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
  stopped = true;
  currentJob = null;
  currentState = FLOW_STATES.IDLE;
  retryCount = 0;
  pendingAction = null;
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

  if (msg.type === MSG.GET_DASHBOARD) {
    return false;
  }
});

// ==========================================
// INIT
// ==========================================
console.log('[FlowAuto v4.3] Content script loaded on:', window.location.href);
reportState(FLOW_STATES.IDLE, '📌 Content script ready');
