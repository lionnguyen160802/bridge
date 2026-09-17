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
  const context = vm.createContext({ console: { log() {} }, process: { env: {} }, __dirname: __dirname,
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