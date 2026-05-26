// constants.js — Shared constants for Flow Auto Generator v4.3
// Loaded by: background.js (importScripts), content.js (manifest js array)

const FLOW_STATES = {
  IDLE: 'IDLE',
  FIND_CHARACTER: 'FIND_CHARACTER',
  HOVER_CHARACTER: 'HOVER_CHARACTER',
  CLICK_MORE_MENU: 'CLICK_MORE_MENU',
  WAIT_MENU: 'WAIT_MENU',
  CLICK_ADD_BUTTON: 'CLICK_ADD_BUTTON',
  WAIT_TEXTAREA: 'WAIT_TEXTAREA',
  INJECT_PROMPT: 'INJECT_PROMPT',
  VERIFY_INPUT: 'VERIFY_INPUT',
  PRESS_ENTER: 'PRESS_ENTER',
  WAIT_RENDER: 'WAIT_RENDER',
  DETECT_COMPLETE: 'DETECT_COMPLETE',
  DOWNLOAD_VIDEO: 'DOWNLOAD_VIDEO',
  CALLBACK_RESULT: 'CALLBACK_RESULT',
  DONE: 'DONE',
  ERROR: 'ERROR'
};

// Retry delays (ms) per state — array length = max retries
const RETRY_DELAYS = {
  FIND_CHARACTER:   [1000, 2000, 5000, 10000, 10000],
  HOVER_CHARACTER:  [1000, 2000, 5000],
  CLICK_MORE_MENU:  [500, 1000, 2000, 3000, 5000],
  WAIT_MENU:        [500, 1000, 2000, 3000, 5000],
  CLICK_ADD_BUTTON: [1000, 2000, 5000],
  WAIT_TEXTAREA:    [500, 1000, 2000, 3000, 5000],
  INJECT_PROMPT:    [1000, 2000, 5000],
  VERIFY_INPUT:     [500, 1000, 2000],
  PRESS_ENTER:      [1000, 2000, 3000],
  WAIT_RENDER:      [5000, 10000, 30000, 60000, 120000],
  DETECT_COMPLETE:  [2000, 5000, 10000, 20000],
  DOWNLOAD_VIDEO:   [5000, 10000, 15000]
};

// Max time (ms) allowed in each state before timeout triggers retry
const STATE_TIMEOUTS = {
  FIND_CHARACTER:   30000,
  HOVER_CHARACTER:  10000,
  CLICK_MORE_MENU:  10000,
  WAIT_MENU:        15000,
  CLICK_ADD_BUTTON: 10000,
  WAIT_TEXTAREA:    15000,
  INJECT_PROMPT:    10000,
  VERIFY_INPUT:     10000,
  PRESS_ENTER:      10000,
  WAIT_RENDER:      600000,   // 10 minutes
  DETECT_COMPLETE:  60000,
  DOWNLOAD_VIDEO:   60000
};

// WebSocket / Bridge configuration
const WS_URL = 'wss://bridge-u03a.onrender.com';
const BRIDGE_URL = 'https://bridge-u03a.onrender.com';
const WS_RECONNECT_DELAYS = [1000, 2000, 5000, 10000, 30000];
const WS_HEARTBEAT_INTERVAL = 25000;

// Message types
const MSG = {
  EXECUTE_JOB:    'EXECUTE_JOB',
  STOP_JOB:       'STOP_JOB',
  STATE_UPDATE:    'STATE_UPDATE',
  JOB_COMPLETE:    'JOB_COMPLETE',
  JOB_ERROR:       'JOB_ERROR',
  INJECT_ACTION:   'FLOW_INJECT_ACTION',
  INJECT_RESULT:   'FLOW_INJECT_RESULT',
  RENDER_PROGRESS: 'FLOW_RENDER_PROGRESS',
  DOWNLOAD_DONE:   'FLOW_DOWNLOAD_COMPLETE',
  INJECT_LOG:      'FLOW_LOG',
  GET_DASHBOARD:   'GET_DASHBOARD',
  PAUSE_QUEUE:     'PAUSE_QUEUE',
  RESUME_QUEUE:    'RESUME_QUEUE',
  CANCEL_JOB:      'CANCEL_JOB',
  CLEAR_LOGS:      'CLEAR_LOGS',
  RETRY_JOB:       'RETRY_JOB',
  SKIP_JOB:        'SKIP_JOB',
  MANUAL_JOB:      'MANUAL_JOB'
};

// State display names (Vietnamese)
const STATE_LABELS = {
  IDLE:             '⏸️ Chờ job',
  FIND_CHARACTER:   '🔍 Tìm nhân vật',
  HOVER_CHARACTER:  '👆 Hover nhân vật',
  CLICK_MORE_MENU:  '🖱️ Click ⋮ menu',
  WAIT_MENU:        '⏳ Chờ dropdown',
  CLICK_ADD_BUTTON: '🖱️ Thêm vào câu lệnh',
  WAIT_TEXTAREA:    '⏳ Chờ ô nhập',
  INJECT_PROMPT:    '✏️ Nhập prompt',
  VERIFY_INPUT:     '✅ Xác nhận input',
  PRESS_ENTER:      '⏎ Ấn Enter',
  WAIT_RENDER:      '🎬 Đang render...',
  DETECT_COMPLETE:  '🔎 Kiểm tra hoàn tất',
  DOWNLOAD_VIDEO:   '💾 Tải video',
  CALLBACK_RESULT:  '📤 Gửi kết quả',
  DONE:             '✅ Hoàn tất',
  ERROR:            '❌ Lỗi'
};
