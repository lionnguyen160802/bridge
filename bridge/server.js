// server.js — Local Node.js Bridge for Flow Auto Generator
// HTTP API (port 3500) + WebSocket Server
// Role: Trung gian giữa n8n workflow và Chrome Extension

const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3500;
const QUEUE_FILE = path.join(__dirname, 'queue.json');
const LOG_FILE = path.join(__dirname, 'bridge.log');

// STATE
// ==========================================
let extensionSocket = null;
let jobQueue = [];
let completedJobs = [];
let failedJobs = [];
let currentJob = null;
let paused = false;
let jobCounter = 0;

// Load persisted queue
function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
      jobQueue = data.queue || [];
      completedJobs = data.completed || [];
      failedJobs = data.failed || [];
      jobCounter = data.counter || 0;
      log('📂 Loaded queue: ' + jobQueue.length + ' pending, ' + completedJobs.length + ' completed');
    }
  } catch (e) {
    log('⚠️ Could not load queue: ' + e.message);
  }
}

function saveQueue() {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify({
      queue: jobQueue,
      completed: completedJobs.slice(0, 100),
      failed: failedJobs.slice(0, 100),
      counter: jobCounter
    }, null, 2));
  } catch (e) {
    log('⚠️ Could not save queue: ' + e.message);
  }
}

function log(msg) {
  const ts = new Date().toISOString();
  const line = '[' + ts + '] ' + msg;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (e) {}
}

// ==========================================
// EXPRESS HTTP API
// ==========================================
const app = express();
app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({
    name: 'Flow Auto Bridge',
    version: '1.0.0',
    extensionConnected: extensionSocket !== null && extensionSocket.readyState === WebSocket.OPEN,
    currentJob: currentJob ? { id: currentJob.id, sceneId: currentJob.sceneId, status: currentJob.status } : null,
    queueLength: jobQueue.length,
    completedCount: completedJobs.length,
    failedCount: failedJobs.length,
    paused: paused
  });
});

// Submit new job — called by n8n
app.post('/generate', (req, res) => {
  const { projectId, sceneId, character, prompt, callbackUrl } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Missing required field: prompt' });
  }

  jobCounter++;
  const job = {
    id: (projectId || 'proj') + '_' + (sceneId || 'scene') + '_' + jobCounter + '_' + Date.now(),
    projectId: projectId || 'default',
    sceneId: sceneId || 'scene_' + String(jobCounter).padStart(3, '0'),
    character: character || '',
    prompt: prompt,
    callbackUrl: callbackUrl || null,
    status: 'QUEUED',
    createdAt: Date.now()
  };

  jobQueue.push(job);
  saveQueue();
  log('📥 New job queued: ' + job.id + ' — "' + prompt.substring(0, 60) + '..."');

  // Try to dispatch immediately
  dispatchNext();

  res.json({
    success: true,
    jobId: job.id,
    position: jobQueue.length,
    message: 'Job queued successfully'
  });
});

// Get current status
app.get('/status', (req, res) => {
  res.json({
    extensionConnected: extensionSocket !== null && extensionSocket.readyState === WebSocket.OPEN,
    currentJob: currentJob,
    queueLength: jobQueue.length,
    queue: jobQueue.slice(0, 20),
    completedCount: completedJobs.length,
    recentCompleted: completedJobs.slice(0, 10),
    failedCount: failedJobs.length,
    recentFailed: failedJobs.slice(0, 10),
    paused: paused
  });
});

// Get queue details
app.get('/queue', (req, res) => {
  res.json({
    queue: jobQueue,
    currentJob: currentJob,
    paused: paused
  });
});

// Cancel a specific job
app.post('/cancel', (req, res) => {
  const { jobId } = req.body;

  // Cancel current job
  if (currentJob && currentJob.id === jobId) {
    log('🛑 Cancelling current job: ' + jobId);
    sendToExtension({ type: 'cancel_job', jobId: jobId });
    currentJob.status = 'CANCELLED';
    failedJobs.unshift(currentJob);
    currentJob = null;
    saveQueue();
    return res.json({ success: true, message: 'Current job cancelled' });
  }

  // Remove from queue
  const idx = jobQueue.findIndex(j => j.id === jobId);
  if (idx >= 0) {
    const removed = jobQueue.splice(idx, 1)[0];
    log('🗑️ Removed from queue: ' + jobId);
    saveQueue();
    return res.json({ success: true, message: 'Job removed from queue' });
  }

  res.status(404).json({ error: 'Job not found: ' + jobId });
});

// Pause queue
app.post('/pause', (req, res) => {
  paused = true;
  log('⏸️ Queue paused');
  sendToExtension({ type: 'pause' });
  res.json({ success: true, message: 'Queue paused' });
});

// Resume queue
app.post('/resume', (req, res) => {
  paused = false;
  log('▶️ Queue resumed');
  sendToExtension({ type: 'resume' });
  dispatchNext();
  res.json({ success: true, message: 'Queue resumed' });
});

// Clear completed/failed history
app.post('/clear-history', (req, res) => {
  completedJobs = [];
  failedJobs = [];
  saveQueue();
  log('🧹 History cleared');
  res.json({ success: true });
});

// Retry a failed job
app.post('/retry', (req, res) => {
  const { jobId } = req.body;
  const idx = failedJobs.findIndex(j => j.id === jobId);
  if (idx >= 0) {
    const job = failedJobs.splice(idx, 1)[0];
    job.status = 'QUEUED';
    job.retryCount = (job.retryCount || 0) + 1;
    delete job.error;
    delete job.failedAt;
    jobQueue.push(job);
    saveQueue();
    dispatchNext();
    log('🔄 Retrying job: ' + jobId);
    return res.json({ success: true, message: 'Job re-queued' });
  }
  res.status(404).json({ error: 'Failed job not found: ' + jobId });
});

// ==========================================
// WEBSOCKET SERVER
// ==========================================
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  log('🔗 WebSocket client connected from ' + req.socket.remoteAddress);

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleExtensionMessage(ws, msg);
    } catch (e) {
      log('⚠️ Invalid message: ' + e.message);
    }
  });

  ws.on('close', () => {
    log('🔌 WebSocket client disconnected');
    if (extensionSocket === ws) {
      extensionSocket = null;
    }
  });

  ws.on('error', (err) => {
    log('❌ WebSocket error: ' + err.message);
  });

  // Ping-pong keepalive
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
});

// Keepalive interval
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      log('💀 Terminating unresponsive client');
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

// ==========================================
// EXTENSION MESSAGE HANDLER
// ==========================================
function handleExtensionMessage(ws, msg) {
  switch (msg.type) {
    case 'register':
      extensionSocket = ws;
      log('✅ Extension registered');
      // Send pending jobs
      dispatchNext();
      break;

    case 'pong':
      // Keepalive response
      break;

    case 'job_queued':
      log('📋 Extension acknowledged job: ' + msg.jobId);
      break;

    case 'job_started':
      log('🚀 Extension started job: ' + msg.jobId);
      if (currentJob && currentJob.id === msg.jobId) {
        currentJob.status = 'PROCESSING';
        currentJob.startedAt = Date.now();
        saveQueue();
      }
      break;

    case 'state_update':
      log('📊 State: ' + msg.state + ' | Job: ' + (msg.jobId || '?') + ' | Retry: ' + (msg.retryCount || 0));
      if (currentJob && currentJob.id === msg.jobId) {
        currentJob.currentState = msg.state;
        currentJob.retryCount = msg.retryCount;
      }
      break;

    case 'job_completed':
      log('✅ Job completed: ' + msg.jobId);
      if (currentJob && currentJob.id === msg.jobId) {
        currentJob.status = 'COMPLETED';
        currentJob.completedAt = Date.now();
        currentJob.result = msg.result;
        completedJobs.unshift(currentJob);
        if (completedJobs.length > 100) completedJobs.pop();
        currentJob = null;
        saveQueue();

        // Callback to n8n
        sendCallback(msg);
      }
      // Process next
      setTimeout(dispatchNext, 2000);
      break;

    case 'job_failed':
      log('❌ Job failed: ' + msg.jobId + ' — ' + msg.error);
      if (currentJob && currentJob.id === msg.jobId) {
        currentJob.status = 'FAILED';
        currentJob.failedAt = Date.now();
        currentJob.error = msg.error;
        failedJobs.unshift(currentJob);
        if (failedJobs.length > 100) failedJobs.pop();
        currentJob = null;
        saveQueue();

        // Callback to n8n
        sendCallback(msg);
      }
      // Process next
      setTimeout(dispatchNext, 3000);
      break;

    default:
      log('⚠️ Unknown message type: ' + msg.type);
  }
}

// ==========================================
// JOB DISPATCH
// ==========================================
function dispatchNext() {
  if (paused) {
    log('⏸️ Queue paused, not dispatching');
    return;
  }
  if (currentJob) {
    log('⏳ Job already running: ' + currentJob.id);
    return;
  }
  if (jobQueue.length === 0) {
    log('📭 Queue empty');
    return;
  }
  if (!extensionSocket || extensionSocket.readyState !== WebSocket.OPEN) {
    log('⚠️ Extension not connected, waiting...');
    return;
  }

  currentJob = jobQueue.shift();
  currentJob.status = 'DISPATCHED';
  saveQueue();

  log('📤 Dispatching job: ' + currentJob.id);
  sendToExtension({
    type: 'new_job',
    job: {
      id: currentJob.id,
      projectId: currentJob.projectId,
      sceneId: currentJob.sceneId,
      character: currentJob.character,
      prompt: currentJob.prompt
    }
  });
}

function sendToExtension(msg) {
  if (extensionSocket && extensionSocket.readyState === WebSocket.OPEN) {
    extensionSocket.send(JSON.stringify(msg));
  } else {
    log('⚠️ Extension not connected');
  }
}

// ==========================================
// CALLBACK TO n8n
// ==========================================
async function sendCallback(result) {
  // Find original job to get callbackUrl
  const job = [...completedJobs, ...failedJobs].find(j => j.id === result.jobId);
  const callbackUrl = job?.callbackUrl || result.callbackUrl;

  if (!callbackUrl) {
    log('ℹ️ No callback URL for job: ' + result.jobId);
    return;
  }

  const payload = {
    jobId: result.jobId,
    projectId: result.projectId,
    sceneId: result.sceneId,
    status: result.status || (result.type === 'job_completed' ? 'completed' : 'failed'),
    error: result.error || null,
    result: result.result || null,
    timestamp: Date.now()
  };

  // Retry callback up to 3 times
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        log('📤 Callback sent to ' + callbackUrl + ' (attempt ' + attempt + ')');
        return;
      }
      log('⚠️ Callback HTTP ' + res.status + ' (attempt ' + attempt + '/3)');
    } catch (e) {
      log('❌ Callback error (attempt ' + attempt + '/3): ' + e.message);
    }
    // Wait before retry
    if (attempt < 3) await new Promise(r => setTimeout(r, 2000 * attempt));
  }
  log('❌ All callback attempts failed for job: ' + result.jobId);
}

// ==========================================
// START SERVER
// ==========================================
loadQueue();

server.listen(PORT, () => {
  log('');
  log('╔══════════════════════════════════════════╗');
  log('║   Flow Auto Bridge v1.0                  ║');
  log('║   HTTP API + WebSocket: port ' + PORT + '        ║');
  log('╚══════════════════════════════════════════╝');
  log('');
  log('API Endpoints:');
  log('  POST /generate        — Submit new job');
  log('  GET  /status          — Current status');
  log('  GET  /queue           — Queue details');
  log('  POST /cancel          — Cancel job');
  log('  POST /pause           — Pause queue');
  log('  POST /resume          — Resume queue');
  log('  POST /retry           — Retry failed job');
  log('  POST /clear-history   — Clear history');
  log('');
  log('Waiting for extension connection...');
});
