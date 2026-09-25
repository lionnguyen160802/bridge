const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function bridge(saved = {}) {
  let disk = JSON.stringify(saved);
  const sent = [];
  const app = { use() {}, get() {}, post() {} };
  const express = Object.assign(() => app, { json() {} });
  class WSS { constructor() { this.clients = []; } on() {} }
  const context = vm.createContext({ console: { log() {} }, process: { env: {} }, __dirname, Buffer, setInterval() {}, clearInterval() {}, setTimeout() {}, Date, JSON,
    require(name) { return { express, http: { createServer: () => ({ listen() {} }) }, ws: { WebSocketServer: WSS, WebSocket: { OPEN: 1 } }, cors: () => {}, path, fs: { existsSync: () => true, readFileSync: () => disk, writeFileSync: (_, value) => { disk = value; }, appendFileSync() {} } }[name]; } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'bridge/server.js'), 'utf8'), context);
  context.socket = { readyState: 1, send: raw => sent.push(JSON.parse(raw)) };
  return { run: code => vm.runInContext(code, context), sent, disk: () => JSON.parse(disk) };
}

function background(saved) {
  const sent = [];
  let listener;
  const context = vm.createContext({ console: { log() {}, error() {} }, importScripts() {}, FLOW_STATES: { IDLE: 'IDLE' }, BRIDGE_URL: '', WS_URL: '', MSG: { JOB_COMPLETE: 'done', JOB_ERROR: 'error' }, WebSocket: { OPEN: 1 }, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {}, chrome: { storage: { local: { get: () => new Promise(() => {}), set: async () => {} } }, runtime: { onMessage: { addListener(fn) { listener = fn; } } }, alarms: { create() {}, onAlarm: { addListener() {} } } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8'), context);
  if (saved) context.chrome.storage.local.get = async () => ({ flowAutoState: saved });
  context.socket = { readyState: 1, send: raw => sent.push(JSON.parse(raw)) };
  return { run: code => vm.runInContext(code, context), sent, message: (msg, respond = () => {}) => listener(msg, {}, respond) };
}

test('bridge restart reconciles without creating another project', () => {
  const first = bridge({ queue: [{ id: 'job-a', action: 'create_project', createdAt: Date.now() }] });
  first.run("handleExtensionMessage(socket, {type:'register'})");
  const restarted = bridge(first.disk());
  restarted.run("handleExtensionMessage(socket, {type:'register'})");
  assert.equal(restarted.sent.filter(m => m.type === 'new_job').length, 0);
  assert.ok(restarted.sent.some(m => m.type === 'reconcile_job' && m.jobId === 'job-a'));
});

test('unified prompt reacquires the composer after attachment rerender', () => {
  const source = fs.readFileSync(path.join(__dirname, 'inject.js'), 'utf8');
  const start = source.indexOf("case 'injectUnifiedPrompt':");
  const end = source.indexOf("case 'submitUnifiedCharacter':", start);
  const action = source.slice(start, end);

  assert.match(action, /findCharacterPromptInput\(\)/);
  assert.match(action, /input\.isConnected/);
  assert.match(action, /injectTextToReactInput\(input, textToInject\)/);
  assert.match(action, /hasConfirmedAttachment\(composer\)/);
  assert.match(action, /bỏ qua để tránh nhập trùng/);
});

test('reconciliation replays terminal results only', () => {
  const b = background();
  b.run("ws=socket; state.completedJobs=[{id:'a',result:{projectId:'flow-a'}}]; state.failedJobs=[{id:'b',error:'timeout'}]");
  b.run("handleBridgeMessage({type:'reconcile_job',jobId:'a'}); handleBridgeMessage({type:'reconcile_job',jobId:'b'})");
  assert.deepEqual(b.sent.map(m => [m.type, m.jobId]), [['job_completed', 'a'], ['job_failed', 'b']]);
});

test('late completion cannot terminate a different active job', () => {
  const b = background();
  b.run("state.currentJob={id:'new-job'}");
  b.message({ type: 'done', jobId: 'old-job', result: {} });
  assert.equal(b.run('state.currentJob?.id'), 'new-job');
});

test('worker restart retains correlation but does not resume side effects', async () => {
  const b = background({ currentJob: { id: 'a', status: 'PROCESSING' }, currentState: 'CREATE_PROJECT' });
  await b.run('loadState()');
  let response;
  b.message({ type: 'GET_ACTIVE_JOB' }, value => { response = value; });
  assert.equal(response.job, null);
  assert.equal(b.run('state.currentJob.id'), 'a');
});

test('create-project normalizes one bounded product image', () => {
  const b = bridge();
  const image = { role: 'product', name: '../box.png', type: 'image/png', sha256: 'a'.repeat(64), base64: 'data:image/png;base64,iVBORw0KGgo=' };
  const normalized = b.run(`normalizeImages(${JSON.stringify([image])})`);
  assert.equal(normalized[0].role, 'product');
  assert.equal(normalized[0].name, 'box.png');
  assert.throws(() => b.run(`normalizeImages(${JSON.stringify([image, image])})`), /zero or one/);
});

test('public status strips product base64 but preserves metadata', () => {
  const job = bridge().run(`publicJob({id:'a',productName:'Box',images:[{role:'product',name:'box.png',base64:'secret'}]})`);
  assert.equal(job.productName, 'Box');
  assert.equal(job.images[0].role, 'product');
  assert.equal(job.images[0].base64, undefined);
});

test('product create-project uses composer file input before paste, then verifies before submit', () => {
  const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
  const dom = fs.readFileSync(path.join(__dirname, 'inject.js'), 'utf8');
  const paste = source.indexOf('case FLOW_STATES.PASTE_PRODUCT_REFERENCE:');
  const verify = source.indexOf('case FLOW_STATES.VERIFY_PRODUCT_ATTACHMENT:');
  const inject = source.indexOf('case FLOW_STATES.INJECT_UNIFIED_PROMPT:');
  const submit = source.indexOf('case FLOW_STATES.SUBMIT:');
  assert.ok(paste >= 0 && verify > paste && inject > verify && submit > inject);
  assert.match(source, /productReferenceAttached = true/);
  assert.match(dom, /case 'pasteProductReference'/);
  const productAction = dom.slice(dom.indexOf("case 'pasteProductReference':"), dom.indexOf("case 'verifyProductAttachment':"));
  assert.match(productAction, /attachProductViaComposerFileInput\(input, file/);
  assert.ok(productAction.indexOf('attachProductViaComposerFileInput(input, file') < productAction.indexOf('dispatchProductPaste(input, file)'));
  assert.match(dom, /new ClipboardEvent\('paste'/);
  assert.match(dom, /dispatchProductDrop\(input, dt\)/);
  const fileInputStrategy = dom.slice(dom.indexOf('async function attachProductViaComposerFileInput'), dom.indexOf('function dispatchProductPaste'));
  assert.match(fileInputStrategy, /input\[type="file"\]/);
  assert.match(fileInputStrategy, /new DataTransfer\(\)/);
  assert.match(fileInputStrategy, /fileInput\.files = dt\.files/);
  assert.doesNotMatch(fileInputStrategy, /Tải lên|Thêm từ dự án|uploadFilesToFlow|getFlowDropTarget/);
  assert.match(dom, /hasConfirmedAttachment\(composer\)/);
  assert.match(dom, /case 'verifyProductAttachment'/);
  assert.match(dom, /không submit/);
  assert.match(dom, /fresh\.length !== 1/);
  const productRoute = source.slice(source.indexOf('case FLOW_STATES.CREATE_PROJECT:'), source.indexOf('case FLOW_STATES.GENERATE_CHARACTER:'));
  assert.doesNotMatch(productRoute, /attachProductReference|clickMoreMenu/);
});

test('generic upload_only path remains upload then done', () => {
  const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
  assert.match(source, /currentJob\?\.action === 'upload_only'[\s\S]*state === FLOW_STATES\.UPLOAD_IMAGE[\s\S]*return FLOW_STATES\.DONE/);
  assert.match(source, /case FLOW_STATES\.UPLOAD_IMAGE:[\s\S]*sendAction\('uploadImage'/);
});

test('product recovery maps obsolete canvas product states to direct paste', () => {
  const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
  assert.match(source, /legacyProductStates = \['UPLOAD_IMAGE', 'ATTACH_PRODUCT_REFERENCE', 'GENERATE_UNIFIED_IMAGE'\]/);
  assert.match(source, /FLOW_STATES\.PASTE_PRODUCT_REFERENCE/);
});

test('submit button finder strictly excludes avatar creation cards and bounds search to composer', () => {
  const dom = fs.readFileSync(path.join(__dirname, 'inject.js'), 'utf8');
  assert.match(dom, /aria\.includes\('avatar'\) \|\| text\.includes\('avatar'\)/);
  assert.match(dom, /create your avatar/);
  assert.match(dom, /br\.width > 120 \|\| br\.height > 80/);
  assert.match(dom, /br\.bottom < inputRect\.top \+ 10/);
  assert.match(dom, /btn\.querySelector\('h1, h2, h3, h4, h5, p'\)/);
});

test('scene creation supports bilingual card detection, hardware hover, add-to-prompt and render polling', () => {
  const bg = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8');
  const content = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
  const dom = fs.readFileSync(path.join(__dirname, 'inject.js'), 'utf8');

  // Background and content script hardware hover bridge
  assert.match(bg, /case 'DEBUGGER_HOVER':/);
  assert.match(bg, /type: "mouseMoved"/);
  assert.match(content, /FLOW_DEBUGGER_HOVER/);

  // Inject helpers
  assert.match(dom, /function triggerRealHover/);
  assert.match(dom, /function isCardElement/);
  assert.match(dom, /function findCharacterCardByBadge/);
  assert.match(dom, /function findAddToPromptButton/);

  // findCharacter priorities and safety checks
  assert.match(dom, /findCharacterCard\('Untitled character'\)/);
  assert.match(dom, /findCharacterCardByBadge\(\)/);

  // waitRender polling
  assert.match(dom, /existing && existing\.length > 0/);
  assert.match(dom, /setInterval/);
  assert.match(dom, /FLOW_VIDEO_DETECTED/);
});/* Historical duplicate content below is ignored.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function bridge(saved = {}) {
  let disk = JSON.stringify(saved);
  const sent = [];
  const app = { use() {}, get() {}, post() {} };
  const express = Object.assign(() => app, { json() {} });
  class WSS { constructor() { this.clients = []; } on() {} }
  const context = vm.createContext({ console: { log() {} }, process: { env: {} }, __dirname,
    Buffer, setInterval() {}, clearInterval() {}, setTimeout() {}, Date, JSON,
    require(name) { return { express, http: { createServer: () => ({ listen() {} }) }, ws: { WebSocketServer: WSS, WebSocket: { OPEN: 1 } }, cors: () => {}, path, fs: { existsSync: () => true, readFileSync: () => disk, writeFileSync: (_, value) => { disk = value; }, appendFileSync() {} } }[name]; }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'bridge/server.js'), 'utf8'), context);
  context.socket = { readyState: 1, send: raw => sent.push(JSON.parse(raw)) };
  return { run: code => vm.runInContext(code, context), sent, disk: () => JSON.parse(disk) };
}

function background(saved) {
  const sent = [];
  let listener;
  const context = vm.createContext({ console: { log() {}, error() {} }, importScripts() {}, FLOW_STATES: { IDLE: 'IDLE' }, BRIDGE_URL: '', WS_URL: '', MSG: { JOB_COMPLETE: 'done', JOB_ERROR: 'error' }, WebSocket: { OPEN: 1 }, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {}, chrome: { storage: { local: { get: () => new Promise(() => {}), set: async () => {} } }, runtime: { onMessage: { addListener(fn) { listener = fn; } } }, alarms: { create() {}, onAlarm: { addListener() {} } } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8'), context);
  if (saved) context.chrome.storage.local.get = async () => ({ flowAutoState: saved });
  context.socket = { readyState: 1, send: raw => sent.push(JSON.parse(raw)) };
  return { run: code => vm.runInContext(code, context), sent, message: (msg, respond = () => {}) => listener(msg, {}, respond) };
}

test('bridge persists dispatched job and restores it without creating another project', () => {
  const first = bridge({ queue: [{ id: 'job-a', action: 'create_project', createdAt: Date.now() }] });
  first.run("handleExtensionMessage(socket, {type:'register'})");
  assert.equal(first.disk().currentJob?.id, 'job-a');
  const restarted = bridge(first.disk());
  restarted.run("handleExtensionMessage(socket, {type:'register'})");
  assert.equal(restarted.sent.filter(m => m.type === 'new_job').length, 0);
  assert.ok(restarted.sent.some(m => m.type === 'reconcile_job' && m.jobId === 'job-a'));
  restarted.run("handleExtensionMessage(socket, {type:'job_completed',jobId:'job-a',result:{projectId:'flow-a'}})");
  assert.equal(restarted.disk().completed[0].projectId, 'flow-a');
});

test('reconciliation replays terminal results only, including failures, never enqueues work', () => {
  const b = background();
  b.run("ws=socket; state.completedJobs=[{id:'a',result:{projectId:'flow-a'}}]; state.failedJobs=[{id:'b',error:'timeout'}]");
  b.run("handleBridgeMessage({type:'reconcile_job',jobId:'a'}); handleBridgeMessage({type:'reconcile_job',jobId:'b'}); handleBridgeMessage({type:'reconcile_job',jobId:'unknown'})");
  assert.deepEqual(b.sent.map(m => [m.type, m.jobId]), [['job_completed', 'a'], ['job_failed', 'b']]);
  assert.equal(b.run('state.queue.length'), 0);
});

test('late completion/error cannot terminate a different active job', () => {
  const b = background();
  b.run("state.currentJob={id:'new-job'}");
  b.message({ type: 'done', jobId: 'old-job', result: {} });
  b.message({ type: 'error', jobId: 'old-job', error: 'late' });
  assert.equal(b.run('state.currentJob?.id'), 'new-job');
});

test('completion during disconnect is recovered on reconciliation', async () => {
  const b = background();
  b.run("state.currentJob={id:'a',action:'create_project',startedAt:Date.now()}");
  await b.run("completeCurrentJob({projectId:'flow-a'})");
  b.run("ws=socket;handleBridgeMessage({type:'reconcile_job',jobId:'a'})");
  assert.equal(b.sent[0].result.projectId, 'flow-a');
});

test('worker restart retains correlation but never resumes create-project side effects', async () => {
  const b = background({ currentJob: { id: 'a', status: 'PROCESSING' }, currentState: 'CREATE_PROJECT' });
  await b.run('loadState()');
  let response;
  b.message({ type: 'GET_ACTIVE_JOB' }, value => { response = value; });
  assert.equal(response.job, null);
  assert.equal(b.run('state.currentJob.id'), 'a');
});

test('create-project normalizes one bounded product image', () => {
  const b = bridge();
  const image = { role: 'product', name: '../box.png', type: 'image/png', sha256: 'a'.repeat(64), base64: 'data:image/png;base64,iVBORw0KGgo=' };
  const normalized = b.run(`normalizeImages(${JSON.stringify([image])})`);
  assert.equal(normalized[0].role, 'product');
  assert.equal(normalized[0].name, 'box.png');
  assert.throws(() => b.run(`normalizeImages(${JSON.stringify([image, image])})`), /zero or one/);
});

test('public bridge status strips product base64 while preserving metadata', () => {
  const job = bridge().run(`publicJob({id:'a',productName:'Box',images:[{role:'product',name:'box.png',base64:'secret'}]})`);
  assert.equal(job.productName, 'Box');
  assert.equal(job.images[0].role, 'product');
  assert.equal(job.images[0].base64, undefined);
});

test('unified composition orders upload, association and one generation', () => {
  const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
  const dom = fs.readFileSync(path.join(__dirname, 'inject.js'), 'utf8');
  assert.ok(source.indexOf('case FLOW_STATES.UPLOAD_IMAGE:') < source.indexOf('case FLOW_STATES.ATTACH_PRODUCT_REFERENCE:'));
  assert.ok(source.indexOf('case FLOW_STATES.ATTACH_PRODUCT_REFERENCE:') < source.indexOf('case FLOW_STATES.GENERATE_UNIFIED_IMAGE:'));
  assert.match(source, /productReferenceAttached = true/);
  assert.match(dom, /case 'attachProductReference'/);
  assert.match(dom, /Thêm vào câu lệnh/);
  assert.match(dom, /composer không hiển thị reference sản phẩm/);
  assert.match(dom, /case 'generateUnifiedImage'/);
  assert.match(dom, /fresh\.length === 1/);
  assert.match(dom, /fresh\.length > 1/);
});
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function bridge(saved = {}) {
  let disk = JSON.stringify(saved);
  const sent = [];
  const app = { use() {}, get() {}, post() {} };
  const express = Object.assign(() => app, { json() {} });
  class WSS { constructor() { this.clients = []; } on() {} }
  const context = vm.createContext({ console: { log() {} }, process: { env: {} }, __dirname: __dirname, Buffer,
    setInterval() {}, clearInterval() {}, setTimeout() {}, Date, JSON,
    require(name) {
      return { express, http: { createServer: () => ({ listen() {} }) }, ws: { WebSocketServer: WSS, WebSocket: { OPEN: 1 } },
        cors: () => {}, path, fs: { existsSync: () => true, readFileSync: () => disk,
          writeFileSync: (_, value) => { disk = value; }, appendFileSync() {} } }[name];
    } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'bridge/server.js'), 'utf8'), context);
  context.socket = { readyState: 1, send: raw => sent.push(JSON.parse(raw)) };
  return { run: code => vm.runInContext(code, context), sent, disk: () => JSON.parse(disk) };
}

test('bridge persists dispatched job and restores it without creating another project', () => {
  const first = bridge({ queue: [{ id: 'job-a', action: 'create_project', createdAt: Date.now() }] });
  first.run("handleExtensionMessage(socket, {type:'register'})");
  assert.equal(first.disk().currentJob?.id, 'job-a');
  const restarted = bridge(first.disk());
  restarted.run("handleExtensionMessage(socket, {type:'register'})");
  assert.equal(restarted.sent.filter(m => m.type === 'new_job').length, 0);
  assert.ok(restarted.sent.some(m => m.type === 'reconcile_job' && m.jobId === 'job-a'));
  restarted.run("handleExtensionMessage(socket, {type:'job_completed',jobId:'wrong',result:{projectId:'wrong'}})");
  assert.equal(restarted.run('currentJob.id'), 'job-a');
  restarted.run("handleExtensionMessage(socket, {type:'job_completed',jobId:'job-a',result:{projectId:'flow-a'}})");
  assert.equal(restarted.disk().completed[0].projectId, 'flow-a');
  assert.equal(restarted.disk().currentJob, null);
  restarted.run("handleExtensionMessage(socket, {type:'job_completed',jobId:'job-a',result:{projectId:'flow-a'}})");
  assert.equal(restarted.disk().completed.length, 1);
});

function background(saved) {
  const sent = [];
  let listener;
  const context = vm.createContext({ console: { log() {}, error() {} }, importScripts() {},
    FLOW_STATES: { IDLE: 'IDLE' }, BRIDGE_URL: '', WS_URL: '', MSG: { JOB_COMPLETE: 'done', JOB_ERROR: 'error' },
    WebSocket: { OPEN: 1 }, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    chrome: { storage: { local: { get: () => new Promise(() => {}), set: async () => {} } },
      runtime: { onMessage: { addListener(fn) { listener = fn; } } },
      alarms: { create() {}, onAlarm: { addListener() {} } } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8'), context);
  if (saved) context.chrome.storage.local.get = async () => ({ flowAutoState: saved });
  context.socket = { readyState: 1, send: raw => sent.push(JSON.parse(raw)) };
  return { run: code => vm.runInContext(code, context), sent, message: (msg, respond = () => {}) => listener(msg, {}, respond) };
}

test('reconciliation replays terminal results only, including failures, never enqueues work', () => {
  const b = background();
  b.run("ws=socket; state.completedJobs=[{id:'a',result:{projectId:'flow-a'}}]; state.failedJobs=[{id:'b',error:'timeout'}]");
  b.run("handleBridgeMessage({type:'reconcile_job',jobId:'a'}); handleBridgeMessage({type:'reconcile_job',jobId:'b'}); handleBridgeMessage({type:'reconcile_job',jobId:'unknown'})");
  assert.deepEqual(b.sent.map(m => [m.type, m.jobId]), [['job_completed', 'a'], ['job_failed', 'b']]);
  assert.equal(b.run('state.queue.length'), 0);
});

test('late completion/error cannot terminate a different active job', () => {
  const b = background();
  b.run("state.currentJob={id:'new-job'}");
  b.message({ type: 'done', jobId: 'old-job', result: {} });
  b.message({ type: 'error', jobId: 'old-job', error: 'late' });
  assert.equal(b.run('state.currentJob?.id'), 'new-job');
});

test('completion during disconnect is recovered on reconciliation', async () => {
  const b = background();
  b.run("state.currentJob={id:'a',action:'create_project',startedAt:Date.now()}");
  await b.run("completeCurrentJob({projectId:'flow-a'})");
  assert.equal(b.sent.length, 0);
  b.run("ws=socket;handleBridgeMessage({type:'reconcile_job',jobId:'a'})");
  assert.equal(b.sent[0].result.projectId, 'flow-a');
});

test('worker restart retains correlation but never resumes create-project side effects', async () => {
  const b = background({ currentJob: { id: 'a', status: 'PROCESSING' }, currentState: 'CREATE_PROJECT' });
  await b.run('loadState()');
  let response;
  b.message({ type: 'GET_ACTIVE_JOB' }, value => { response = value; });
  assert.equal(response.job, null);
  assert.equal(b.run('state.currentJob.id'), 'a');
  b.message({ type: 'done', jobId: 'a', result: { projectId: 'flow-a' } });
  assert.equal(b.run('state.completedJobs[0].result.projectId'), 'flow-a');
});

test('create-project normalizes one bounded product image without logging its bytes', () => {
  const b = bridge();
  const image = { role: 'product', name: '../box.png', type: 'image/png', sha256: 'a'.repeat(64), base64: 'data:image/png;base64,iVBORw0KGgo=' };
  const normalized = b.run(`normalizeImages(${JSON.stringify([image])})`);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].role, 'product');
  assert.equal(normalized[0].name, 'box.png');
  assert.throws(() => b.run(`normalizeImages(${JSON.stringify([image, image])})`), /zero or one/);
  assert.throws(() => b.run(`normalizeImages([{name:'x.gif',type:'image/gif',base64:'data:image/gif;base64,R0lG'}])`), /Invalid product image/);
});

test('public bridge status strips product base64 while preserving reference metadata', () => {
  const b = bridge();
  const job = b.run(`publicJob({id:'a',productName:'Box',images:[{role:'product',name:'box.png',base64:'secret'}]})`);
  assert.equal(job.productName, 'Box');
  assert.equal(job.images[0].role, 'product');
  assert.equal(job.images[0].base64, undefined);
});

test('unified composition state orders upload, reference association and one canvas generation', () => {
  const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
  const domSource = fs.readFileSync(path.join(__dirname, 'inject.js'), 'utf8');
  const upload = source.indexOf("case FLOW_STATES.UPLOAD_IMAGE:");
  const attach = source.indexOf("case FLOW_STATES.ATTACH_PRODUCT_REFERENCE:");
  const generate = source.indexOf("case FLOW_STATES.GENERATE_UNIFIED_IMAGE:");
  assert.ok(upload >= 0 && attach > upload && generate > attach);
  assert.match(source, /ATTACH_PRODUCT_REFERENCE\) return FLOW_STATES\.GENERATE_UNIFIED_IMAGE/);
  assert.match(source, /productReferenceAttached = true/);
  assert.match(domSource, /case 'attachProductReference'/);
  assert.match(domSource, /Thêm vào câu lệnh/);
  assert.match(domSource, /composer không hiển thị reference sản phẩm/);
  assert.match(domSource, /case 'generateUnifiedImage'/);
  assert.match(domSource, /fresh\.length === 1/);
  assert.match(domSource, /fresh\.length > 1/);
});const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function bridge(saved = {}) {
  let disk = JSON.stringify(saved);
  const sent = [];
  const app = { use() {}, get() {}, post() {} };
  const express = Object.assign(() => app, { json() {} });
  class WSS { constructor() { this.clients = []; } on() {} }
  const context = vm.createContext({ console: { log() {} }, process: { env: {} }, __dirname: __dirname, Buffer,
    setInterval() {}, clearInterval() {}, setTimeout() {}, Date, JSON,
    require(name) {
      return { express, http: { createServer: () => ({ listen() {} }) }, ws: { WebSocketServer: WSS, WebSocket: { OPEN: 1 } },
        cors: () => {}, path, fs: { existsSync: () => true, readFileSync: () => disk,
          writeFileSync: (_, value) => { disk = value; }, appendFileSync() {} } }[name];
    } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'bridge/server.js'), 'utf8'), context);
  context.socket = { readyState: 1, send: raw => sent.push(JSON.parse(raw)) };
  return { run: code => vm.runInContext(code, context), sent, disk: () => JSON.parse(disk) };
}

test('bridge persists dispatched job and restores it without creating another project', () => {
  const first = bridge({ queue: [{ id: 'job-a', action: 'create_project', createdAt: Date.now() }] });
  first.run("handleExtensionMessage(socket, {type:'register'})");
  assert.equal(first.disk().currentJob?.id, 'job-a');
  const restarted = bridge(first.disk());
  restarted.run("handleExtensionMessage(socket, {type:'register'})");
  assert.equal(restarted.sent.filter(m => m.type === 'new_job').length, 0);
  assert.ok(restarted.sent.some(m => m.type === 'reconcile_job' && m.jobId === 'job-a'));
  restarted.run("handleExtensionMessage(socket, {type:'job_completed',jobId:'wrong',result:{projectId:'wrong'}})");
  assert.equal(restarted.run('currentJob.id'), 'job-a');
  restarted.run("handleExtensionMessage(socket, {type:'job_completed',jobId:'job-a',result:{projectId:'flow-a'}})");
  assert.equal(restarted.disk().completed[0].projectId, 'flow-a');
  assert.equal(restarted.disk().currentJob, null);
  restarted.run("handleExtensionMessage(socket, {type:'job_completed',jobId:'job-a',result:{projectId:'flow-a'}})");
  assert.equal(restarted.disk().completed.length, 1);
});

function background(saved) {
  const sent = [];
  let listener;
  const context = vm.createContext({ console: { log() {}, error() {} }, importScripts() {},
    FLOW_STATES: { IDLE: 'IDLE' }, BRIDGE_URL: '', WS_URL: '', MSG: { JOB_COMPLETE: 'done', JOB_ERROR: 'error' },
    WebSocket: { OPEN: 1 }, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {},
    chrome: { storage: { local: { get: () => new Promise(() => {}), set: async () => {} } },
      runtime: { onMessage: { addListener(fn) { listener = fn; } } },
      alarms: { create() {}, onAlarm: { addListener() {} } } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8'), context);
  if (saved) context.chrome.storage.local.get = async () => ({ flowAutoState: saved });
  context.socket = { readyState: 1, send: raw => sent.push(JSON.parse(raw)) };
  return { run: code => vm.runInContext(code, context), sent, message: (msg, respond = () => {}) => listener(msg, {}, respond) };
}

test('reconciliation replays terminal results only, including failures, never enqueues work', () => {
  const b = background();
  b.run("ws=socket; state.completedJobs=[{id:'a',result:{projectId:'flow-a'}}]; state.failedJobs=[{id:'b',error:'timeout'}]");
  b.run("handleBridgeMessage({type:'reconcile_job',jobId:'a'}); handleBridgeMessage({type:'reconcile_job',jobId:'b'}); handleBridgeMessage({type:'reconcile_job',jobId:'unknown'})");
  assert.deepEqual(b.sent.map(m => [m.type, m.jobId]), [['job_completed', 'a'], ['job_failed', 'b']]);
  assert.equal(b.run('state.queue.length'), 0);
});

test('late completion/error cannot terminate a different active job', () => {
  const b = background();
  b.run("state.currentJob={id:'new-job'}");
  b.message({ type: 'done', jobId: 'old-job', result: {} });
  b.message({ type: 'error', jobId: 'old-job', error: 'late' });
  assert.equal(b.run('state.currentJob?.id'), 'new-job');
});

test('completion during disconnect is recovered on reconciliation', async () => {
  const b = background();
  b.run("state.currentJob={id:'a',action:'create_project',startedAt:Date.now()}");
  await b.run("completeCurrentJob({projectId:'flow-a'})");
  assert.equal(b.sent.length, 0);
  b.run("ws=socket;handleBridgeMessage({type:'reconcile_job',jobId:'a'})");
  assert.equal(b.sent[0].result.projectId, 'flow-a');
});

test('worker restart retains correlation but never resumes create-project side effects', async () => {
  const b = background({ currentJob: { id: 'a', status: 'PROCESSING' }, currentState: 'CREATE_PROJECT' });
  await b.run('loadState()');
  let response;
  b.message({ type: 'GET_ACTIVE_JOB' }, value => { response = value; });
  assert.equal(response.job, null);
  assert.equal(b.run('state.currentJob.id'), 'a');
  b.message({ type: 'done', jobId: 'a', result: { projectId: 'flow-a' } });
  assert.equal(b.run('state.completedJobs[0].result.projectId'), 'flow-a');
});

test('create-project normalizes one bounded product image without logging its bytes', () => {
  const b = bridge();
  const image = { role: 'product', name: '../box.png', type: 'image/png', sha256: 'a'.repeat(64), base64: 'data:image/png;base64,iVBORw0KGgo=' };
  const normalized = b.run(`normalizeImages(${JSON.stringify([image])})`);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].role, 'product');
  assert.equal(normalized[0].name, 'box.png');
  assert.throws(() => b.run(`normalizeImages(${JSON.stringify([image, image])})`), /zero or one/);
  assert.throws(() => b.run(`normalizeImages([{name:'x.gif',type:'image/gif',base64:'data:image/gif;base64,R0lG'}])`), /Invalid product image/);
});

test('public bridge status strips product base64 while preserving reference metadata', () => {
  const b = bridge();
  const job = b.run(`publicJob({id:'a',productName:'Box',images:[{role:'product',name:'box.png',base64:'secret'}]})`);
  assert.equal(job.productName, 'Box');
  assert.equal(job.images[0].role, 'product');
  assert.equal(job.images[0].base64, undefined);
});

test('unified composition state orders upload, reference association and one canvas generation', () => {
  const source = fs.readFileSync(path.join(__dirname, 'content.js'), 'utf8');
  const domSource = fs.readFileSync(path.join(__dirname, 'inject.js'), 'utf8');
  const upload = source.indexOf("case FLOW_STATES.UPLOAD_IMAGE:");
  const attach = source.indexOf("case FLOW_STATES.ATTACH_PRODUCT_REFERENCE:");
  const generate = source.indexOf("case FLOW_STATES.GENERATE_UNIFIED_IMAGE:");
  assert.ok(upload >= 0 && attach > upload && generate > attach);
  assert.match(source, /ATTACH_PRODUCT_REFERENCE\) return FLOW_STATES\.GENERATE_UNIFIED_IMAGE/);
  assert.match(source, /productReferenceAttached = true/);
  assert.match(domSource, /case 'attachProductReference'/);
  assert.match(domSource, /Thêm vào câu lệnh/);
  assert.match(domSource, /composer không hiển thị reference sản phẩm/);
  assert.match(domSource, /case 'generateUnifiedImage'/);
  assert.match(domSource, /fresh\.length === 1/);
  assert.match(domSource, /fresh\.length > 1/);
});
*/