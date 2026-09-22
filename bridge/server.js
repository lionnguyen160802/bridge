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
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
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
      // Restore correlation, never requeue an already dispatched side effect.
      currentJob = data.currentJob || null;

      // Filter out stale jobs older than 15 minutes (to avoid re-running ancient zombie jobs)
      const MAX_AGE_MS = 15 * 60 * 1000;
      const initialCount = jobQueue.length;
      jobQueue = jobQueue.filter(j => (Date.now() - (j.createdAt || 0)) < MAX_AGE_MS);
      if (jobQueue.length !== initialCount) {
        log('🧹 Bỏ qua ' + (initialCount - jobQueue.length) + ' job cũ quá hạn trong queue');
        saveQueue();
      }

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
      currentJob,
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
app.use(express.json({ limit: '8mb' }));

function normalizeImages(images) {
  if (images == null) return [];
  if (!Array.isArray(images) || images.length > 1) throw new Error('Exactly zero or one product image is supported');
  return images.map(image => {
    const type = String(image?.type || '');
    const match = String(image?.base64 || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match || match[1] !== type) throw new Error('Invalid product image payload');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Product image exceeds 5 MB');
    const name = path.basename(String(image.name || 'product')).replace(/[^\p{L}\p{N}._ -]+/gu, '_').slice(0, 180);
    return { role: image.role === 'product' ? 'product' : undefined, name, type, sha256: String(image.sha256 || ''), base64: image.base64 };
  });
}

function publicJob(job) {
  if (!job) return null;
  const { images, ...safe } = job;
  return { ...safe, images: Array.isArray(images) ? images.map(({ base64, ...image }) => image) : [] };
}

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
  // Support both Object {...} and Array [{...}] payloads from N8N
  const body = Array.isArray(req.body) ? req.body[0] : req.body;
  const { row_id, rowId, projectId, sceneId, character, prompt, characterPrompt, callbackUrl, driveFolderId, images, action, createCharacter } = body || {};
  
  const finalRowId = row_id || rowId || null;
  const finalPrompt = prompt || characterPrompt || '';
  const finalAction = action || (createCharacter ? 'create_character' : 'generate');

  if (!finalPrompt && finalAction !== 'upload_only' && finalAction !== 'create_project') {
    return res.status(400).json({ error: 'Missing required field: prompt' });
  }

  jobCounter++;
  const job = {
    id: (projectId || 'proj') + '_' + (sceneId || 'scene') + '_' + jobCounter + '_' + Date.now(),
    rowId: finalRowId,
    projectId: projectId || null,
    sceneId: sceneId || 'scene_' + String(jobCounter).padStart(3, '0'),
    character: character || '',
    prompt: finalPrompt,
    images: images || [],
    action: finalAction,
    callbackUrl: callbackUrl || null,
    driveFolderId: driveFolderId || null,
    status: 'QUEUED',
    createdAt: Date.now()
  };

  jobQueue.push(job);
  saveQueue();
  log('📥 New job queued: ' + job.id + (images?.length ? ' [' + images.length + ' images]' : '') + ' — Action: ' + job.action);

  // Try to dispatch immediately
  dispatchNext();

  res.json({
    success: true,
    jobId: job.id,
    rowId: finalRowId,
    folderId: driveFolderId,
    position: jobQueue.length,
    message: 'Job queued successfully'
  });
});

// Dedicated endpoint to create project and optionally upload images and generate character image
app.post('/create-project', async (req, res) => {
  const body = Array.isArray(req.body) ? req.body[0] : req.body;
  const { rowId, row_id, images, character, characterName, productName, prompt, characterPrompt, callbackUrl, wait, projectId } = body || {};

  const finalPrompt = (prompt || characterPrompt || '').trim();
  const finalProjectId = projectId || null;
  const finalAction = finalProjectId && finalPrompt ? 'create_character' : 'create_project';

  let normalizedImages;
  try { normalizedImages = normalizeImages(images); } catch (error) { return res.status(400).json({ error: error.message }); }
  jobCounter++;
  const job = {
    id: 'create_proj_' + jobCounter + '_' + Date.now(),
    rowId: rowId || row_id || null,
    projectId: finalProjectId,
    sceneId: 'create_project_' + String(jobCounter).padStart(3, '0'),
    character: character || characterName || '',
    prompt: finalPrompt,
    images: normalizedImages,
    productName: String(productName || '').trim().slice(0, 200),
    action: finalAction,
    callbackUrl: callbackUrl || null,
    status: 'QUEUED',
    createdAt: Date.now()
  };

  jobQueue.push(job);
  saveQueue();
  log('✨ Create project requested: ' + job.id + (normalizedImages.length ? ' [product image]' : '') + (finalPrompt ? ' [with prompt]' : ''));

  dispatchNext();

  // If wait=true (default is true if wait !== false), wait synchronously up to 75s (if prompt) or 35s for projectId!
  const shouldWait = wait !== false;
  if (shouldWait) {
    const startWait = Date.now();
    const timeoutMs = finalPrompt ? 75000 : 35000;
    const checkDone = setInterval(() => {
      const found = completedJobs.find(j => j.id === job.id);
      if (found) {
        clearInterval(checkDone);
        const imgUrl = found.result?.characterImageUrl || found.result?.imageUrl || found.result?.imageSrc || found.characterImageUrl || found.imageUrl || found.imageSrc || null;
        return res.json({
          success: true,
          jobId: job.id,
          projectId: found.projectId || found.result?.projectId,
          character: found.result?.character || job.character,
          characterImageUrl: imgUrl,
          imageUrl: imgUrl,
          imageSrc: imgUrl,
          status: 'completed',
          result: found.result
        });
      }

      const failed = failedJobs.find(j => j.id === job.id);
      if (failed) {
        clearInterval(checkDone);
        return res.status(500).json({
          success: false,
          jobId: job.id,
          status: 'failed',
          error: failed.error
        });
      }

      // Timeout
      if (Date.now() - startWait > timeoutMs) {
        clearInterval(checkDone);
        return res.json({
          success: true,
          jobId: job.id,
          status: 'processing',
          message: 'Project creation is taking longer than expected. Check /job/' + job.id + ' or your callbackUrl.'
        });
      }
    }, 500);
    return;
  }

  res.json({
    success: true,
    jobId: job.id,
    position: jobQueue.length,
    message: 'Create project job queued. Query /job/' + job.id + ' or wait for callback.'
  });
});

// Dedicated endpoint to create a character image (Imagen 3) in existing project or new project
app.post('/create-character', async (req, res) => {
  const body = Array.isArray(req.body) ? req.body[0] : req.body;
  const { rowId, row_id, projectId, character, characterName, prompt, characterPrompt, callbackUrl, wait } = body || {};

  const finalPrompt = (prompt || characterPrompt || '').trim();
  if (!finalPrompt) {
    return res.status(400).json({ error: 'Missing required field: prompt (or characterPrompt)' });
  }

  const finalChar = character || characterName || '';

  jobCounter++;
  const job = {
    id: 'char_' + (projectId || 'new') + '_' + jobCounter + '_' + Date.now(),
    rowId: rowId || row_id || null,
    projectId: projectId || null,
    sceneId: 'create_char_' + String(jobCounter).padStart(3, '0'),
    character: finalChar,
    prompt: finalPrompt,
    images: [],
    action: 'create_character',
    callbackUrl: callbackUrl || null,
    status: 'QUEUED',
    createdAt: Date.now()
  };

  jobQueue.push(job);
  saveQueue();
  log('🎨 Create character requested: ' + job.id + (finalChar ? ' [' + finalChar + ']' : '') + ' in project: ' + (job.projectId || '(new project)'));

  dispatchNext();

  const shouldWait = wait !== false;
  if (shouldWait) {
    const startWait = Date.now();
    const timeoutMs = 75000;
    const checkDone = setInterval(() => {
      const found = completedJobs.find(j => j.id === job.id);
      if (found) {
        clearInterval(checkDone);
        const imgUrl = found.result?.characterImageUrl || found.result?.imageUrl || found.result?.imageSrc || found.characterImageUrl || found.imageUrl || found.imageSrc || null;
        return res.json({
          success: true,
          jobId: job.id,
          projectId: found.projectId || found.result?.projectId,
          character: found.result?.character || job.character,
          characterImageUrl: imgUrl,
          imageUrl: imgUrl,
          imageSrc: imgUrl,
          status: 'completed',
          result: found.result
        });
      }

      const failed = failedJobs.find(j => j.id === job.id);
      if (failed) {
        clearInterval(checkDone);
        return res.status(500).json({
          success: false,
          jobId: job.id,
          status: 'failed',
          error: failed.error
        });
      }

      // Timeout
      if (Date.now() - startWait > timeoutMs) {
        clearInterval(checkDone);
        return res.json({
          success: true,
          jobId: job.id,
          status: 'processing',
          message: 'Character generation is taking longer than expected. Check /job/' + job.id + ' or your callbackUrl.'
        });
      }
    }, 500);
    return;
  }

  res.json({
    success: true,
    jobId: job.id,
    position: jobQueue.length,
    message: 'Create character job queued. Query /job/' + job.id + ' or wait for callback.'
  });
});

// Query single job by ID to get projectId
app.get('/job/:jobId', (req, res) => {
  const { jobId } = req.params;

  // Check running job
  if (currentJob && currentJob.id === jobId) {
    return res.json({
      jobId: currentJob.id,
      status: currentJob.status || 'PROCESSING',
      state: currentJob.currentState
    });
  }

  // Check completed
  const completed = completedJobs.find(j => j.id === jobId);
  if (completed) {
    const imgUrl = completed.characterImageUrl || completed.imageUrl || completed.imageSrc || completed.result?.characterImageUrl || completed.result?.imageUrl || completed.result?.imageSrc || null;
    return res.json({
      jobId: completed.id,
      status: 'COMPLETED',
      projectId: completed.projectId || completed.result?.projectId,
      character: completed.character || completed.result?.character,
      characterImageUrl: imgUrl,
      imageUrl: imgUrl,
      imageSrc: imgUrl,
      result: completed.result
    });
  }

  // Check failed
  const failed = failedJobs.find(j => j.id === jobId);
  if (failed) {
    return res.status(500).json({
      jobId: failed.id,
      status: 'FAILED',
      error: failed.error
    });
  }

  // Check in queue
  const queued = jobQueue.find(j => j.id === jobId);
  if (queued) {
    return res.json({
      jobId: queued.id,
      status: 'QUEUED',
      position: jobQueue.indexOf(queued) + 1
    });
  }

  res.status(404).json({ error: 'Job not found: ' + jobId });
});

// Clear queue endpoint
app.post('/clear-queue', (req, res) => {
  const count = jobQueue.length;
  jobQueue = [];
  if (currentJob) {
    currentJob.status = 'CANCELLED';
    currentJob = null;
  }
  saveQueue();
  log('🗑️ Queue cleared via HTTP endpoint (' + count + ' jobs removed)');

  if (extensionSocket && extensionSocket.readyState === WebSocket.OPEN) {
    extensionSocket.send(JSON.stringify({ type: 'clear_queue' }));
  }

  res.json({
    success: true,
    message: 'Queue cleared successfully',
    removedJobsCount: count
  });
});

// Get current status
app.get('/status', (req, res) => {
  res.json({
    extensionConnected: extensionSocket !== null && extensionSocket.readyState === WebSocket.OPEN,
    currentJob: publicJob(currentJob),
    queueLength: jobQueue.length,
    queue: jobQueue.slice(0, 20).map(publicJob),
    completedCount: completedJobs.length,
    recentCompleted: completedJobs.slice(0, 10).map(publicJob),
    failedCount: failedJobs.length,
    recentFailed: failedJobs.slice(0, 10).map(publicJob),
    paused: paused
  });
});

// Get queue details
app.get('/queue', (req, res) => {
  res.json({
    queue: jobQueue.map(publicJob),
    currentJob: publicJob(currentJob),
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

// Clear completed/failed history and unstick queue
app.post('/clear-history', (req, res) => {
  completedJobs = [];
  failedJobs = [];
  if (currentJob) {
    log('⚠️ Forcefully clearing stuck currentJob');
    currentJob = null;
  }
  saveQueue();
  log('🧹 History and current job cleared');
  dispatchNext();
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
      if (currentJob) {
        // Ask for a retained result before considering timeout/dispatch.
        sendToExtension({ type: 'reconcile_job', jobId: currentJob.id });
        break;
      }
      // Send pending jobs
      dispatchNext();
      break;

    case 'pong':
      // Keepalive response
      break;

    case 'clear_queue': {
      const qCount = jobQueue.length;
      jobQueue = [];
      if (currentJob) {
        currentJob.status = 'CANCELLED';
        currentJob = null;
      }
      saveQueue();
      log('🗑️ Bridge queue cleared by extension (' + qCount + ' queued jobs removed)');
      break;
    }

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
        currentJob.projectId = msg.projectId || msg.result?.projectId || currentJob.projectId;
        currentJob.character = msg.character || msg.result?.character || currentJob.character;
        const imgUrl = msg.characterImageUrl || msg.imageUrl || msg.imageSrc || msg.result?.characterImageUrl || msg.result?.imageUrl || msg.result?.imageSrc || null;
        if (imgUrl) {
          currentJob.characterImageUrl = imgUrl;
          currentJob.imageUrl = imgUrl;
          currentJob.imageSrc = imgUrl;
        }
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
    // If currentJob has been running for more than 15 minutes, force expire it
    if (currentJob.startedAt && Date.now() - currentJob.startedAt > 15 * 60 * 1000) {
      log('⚠️ Current job timed out on server: ' + currentJob.id);
      currentJob.status = 'FAILED';
      currentJob.error = 'Global timeout';
      failedJobs.unshift(currentJob);
      currentJob = null;
      saveQueue();
    } else {
      log('⏳ Job already running: ' + currentJob.id);
      return;
    }
  }

  // Filter out any stale jobs before dispatching
  const MAX_AGE_MS = 15 * 60 * 1000;
  let droppedCount = 0;
  while (jobQueue.length > 0 && (Date.now() - (jobQueue[0].createdAt || 0)) >= MAX_AGE_MS) {
    jobQueue.shift();
    droppedCount++;
  }
  if (droppedCount > 0) {
    log('🗑️ Bỏ qua ' + droppedCount + ' job quá hạn (>15 phút)');
    saveQueue();
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
      rowId: currentJob.rowId,
      projectId: currentJob.projectId,
      sceneId: currentJob.sceneId,
      character: currentJob.character,
      prompt: currentJob.prompt,
      images: currentJob.images || [],
      productName: currentJob.productName || '',
      action: currentJob.action || 'generate',
      callbackUrl: currentJob.callbackUrl,
      driveFolderId: currentJob.driveFolderId
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

  const imgUrl = result.characterImageUrl || result.imageUrl || result.imageSrc || result.result?.characterImageUrl || result.result?.imageUrl || result.result?.imageSrc || job?.characterImageUrl || null;
  const payload = {
    jobId: result.jobId,
    rowId: result.rowId || job?.rowId || null,
    projectId: result.projectId || result.result?.projectId || job?.projectId || null,
    sceneId: result.sceneId,
    character: result.character || result.result?.character || job?.character || null,
    characterImageUrl: imgUrl,
    imageUrl: imgUrl,
    imageSrc: imgUrl,
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
