// popup.js — UI Controller v2
'use strict';

// ── State ─────────────────────────────────────────────────────
let steps = [], isRecording = false, isPaused = false, startTime = null;
let timerInterval = null, editingIndex = null;
let isVideoRecording = false, isVideoPaused = false, isVideoProcessing = false, videoDataUrl = null;
let isDark = true;
let dragSrcIndex = null;

// ── DOM shortcuts ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const statusOrb = $('statusOrb'), statusPill = $('statusPill');
const btnStart = $('btnStart'), orbIcon = $('orbIcon'), orbLabel = $('orbLabel'), orbRing = $('orbRing');
const btnPause = $('btnPause'), btnStop = $('btnStop'), btnClear = $('btnClear');
const stepCountLabel = $('stepCountLabel'), timerLabel = $('timerLabel');
const pausedBadge = $('pausedBadge'), videoBadge = $('videoBadge');
const stepsList = $('stepsList'), stepSearch = $('stepSearch');
const gherkinOutput = $('gherkinOutput'), featureName = $('featureName');
const scenarioName = $('scenarioName'), tagsInput = $('tagsInput');
const savedList = $('savedList'), toast = $('toast');
let btnVideo, videoBadgeEl, videoPreviewPanel, videoPlayer, videoBtnLabel;

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  btnVideo = $('btnVideoRecord'); videoBadgeEl = $('videoBadge');
  videoPreviewPanel = $('videoPreviewPanel'); videoPlayer = $('videoPlayer');
  videoBtnLabel = $('videoBtnLabel');

  loadTheme();
  await loadState();
  bindEvents();
  loadSavedScenarios();
  updateExportOutput();
  bindDebounceSlider();
});

// ── Load State ───────────────────────────────────────────────
async function loadState() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (resp) => {
      if (chrome.runtime.lastError || !resp) { resolve(); return; }
      steps = resp.steps || []; isRecording = resp.isRecording || false;
      isPaused = resp.isPaused || false; startTime = resp.startTime || null;
      isVideoRecording = resp.isVideoRecording || false; isVideoPaused = resp.isVideoPaused || false;
      renderSteps(); updateUIState(); updateVideoUI(); updateGherkin();
      if (isRecording && startTime) startTimer();
      resolve();
    });
  });
}

// ── Real-time updates ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'STATE_UPDATE') {
    const prev = steps.length; steps = msg.steps || [];
    isRecording = msg.isRecording; isPaused = msg.isPaused;
    isVideoRecording = msg.isVideoRecording || false; isVideoPaused = msg.isVideoPaused || false;
    if (steps.length !== prev) renderSteps();
    updateStepCount(); updateGherkin(); updateVideoUI();
  }
  if (msg.type === 'VIDEO_READY') {
    isVideoRecording = false; isVideoProcessing = false;
    videoDataUrl = msg.dataUrl;
    updateVideoUI(); showVideoPreview(msg.dataUrl, msg.size);
    showToast('✅ Video ready! Download below.', 'success');
  }
});

// ── Bind Events ───────────────────────────────────────────────
function bindEvents() {
  // Record orb / controls
  btnStart.addEventListener('click', handleOrbClick);
  btnPause.addEventListener('click', pauseRecording);
  btnStop.addEventListener('click', stopRecording);
  btnClear.addEventListener('click', clearSteps);
  if (btnVideo) btnVideo.addEventListener('click', handleVideoButton);
  $('btnTheme').addEventListener('click', toggleTheme);

  // Tab switching
  document.querySelectorAll('.tab-item').forEach(b =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // Gherkin tab
  $('btnRefresh').addEventListener('click', updateGherkin);
  $('btnCopy').addEventListener('click', copyGherkin);
  $('btnDownload').addEventListener('click', downloadGherkin);
  $('btnSaveScenario').addEventListener('click', saveScenario);
  [featureName, scenarioName, tagsInput].forEach(el => el.addEventListener('input', updateGherkin));
  $('optDedupe').addEventListener('change', updateGherkin);
  $('optSmartNav').addEventListener('change', updateGherkin);

  // Export tab
  $('exportFormat').addEventListener('change', updateExportOutput);
  $('btnExportRefresh').addEventListener('click', updateExportOutput);
  $('btnExportCopy').addEventListener('click', copyExport);
  $('btnExportDownload').addEventListener('click', downloadExport);

  // Record toolbar
  stepSearch.addEventListener('input', () => renderSteps(stepSearch.value));
  $('btnAddAssert').addEventListener('click', () => { assertModal.classList.add('open'); $('assertValue').focus(); });

  // Edit modal
  $('modalClose').addEventListener('click', closeEditModal);
  $('modalCancel').addEventListener('click', closeEditModal);
  $('modalSave').addEventListener('click', saveEditStep);
  $('editModal').addEventListener('click', e => { if (e.target === $('editModal')) closeEditModal(); });

  // Assert modal
  $('assertModalClose').addEventListener('click', () => $('assertModal').classList.remove('open'));
  $('assertModalCancel').addEventListener('click', () => $('assertModal').classList.remove('open'));
  $('assertModalSave').addEventListener('click', addManualAssert);
  $('assertModal').addEventListener('click', e => { if (e.target === $('assertModal')) $('assertModal').classList.remove('open'); });
  $('assertValue').addEventListener('keydown', e => { if (e.key === 'Enter') addManualAssert(); });

  // Screenshot modal
  $('screenshotModalClose').addEventListener('click', () => $('screenshotModal').classList.remove('open'));
  $('screenshotModal').addEventListener('click', e => { if (e.target === $('screenshotModal')) $('screenshotModal').classList.remove('open'); });

  // Saved tab
  $('btnExportAll').addEventListener('click', exportAllScenarios);

  // Settings
  $('btnClearAll').addEventListener('click', () => {
    if (!confirm('Delete all saved scenarios?')) return;
    chrome.storage.local.set({ scenarios: [] }, () => { loadSavedScenarios(); showToast('Cleared', 'info'); });
  });

  // Keyboard shortcuts in popup
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'r' && !isRecording) handleOrbClick();
    if (e.key === 's' && isRecording) stopRecording();
    if (e.key === 'p' && isRecording) pauseRecording();
  });
}

function bindDebounceSlider() {
  const slider = $('settingDebounce'), label = $('debounceLabel');
  if (!slider) return;
  slider.addEventListener('input', () => {
    label.textContent = (slider.value / 1000).toFixed(1) + 's';
  });
}

// ── Orb Click — morphs between Start / Stop ──────────────────
function handleOrbClick() {
  if (!isRecording) startRecording();
  else stopRecording();
}

// ── Recording Controls ────────────────────────────────────────
function startRecording() {
  chrome.runtime.sendMessage({ type: 'START_RECORDING' }, () => {
    isRecording = true; isPaused = false; startTime = Date.now(); steps = [];
    renderSteps(); updateUIState(); startTimer();
    showToast('🔴 Recording started!', 'success'); switchTab('record');
  });
}

function pauseRecording() {
  chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' }, (resp) => {
    if (!resp) return; isPaused = resp.isPaused; updateUIState();
    showToast(isPaused ? '⏸ Paused' : '▶ Resumed', 'info');
    if (isPaused) clearInterval(timerInterval); else startTimer();
  });
}

function stopRecording() {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (resp) => {
    isRecording = false; isPaused = false;
    if (resp) steps = resp.steps || steps;
    stopTimer(); updateUIState(); renderSteps(); updateGherkin();
    showToast(`⏹ Stopped. ${steps.length} steps.`, 'success');
    if (steps.length > 0) setTimeout(() => switchTab('gherkin'), 600);
  });
}

function clearSteps() {
  if (steps.length > 0 && !confirm('Clear all recorded steps?')) return;
  chrome.runtime.sendMessage({ type: 'CLEAR_STEPS' }, () => {
    steps = []; if (!isRecording) startTime = null; else startTime = Date.now();
    renderSteps(); updateStepCount(); updateGherkin(); showToast('Cleared', 'info');
  });
}

// ── Timer ─────────────────────────────────────────────────────
function startTimer() { clearInterval(timerInterval); timerInterval = setInterval(updateTimer, 1000); updateTimer(); }
function stopTimer()  { clearInterval(timerInterval); timerInterval = null; }
function updateTimer() {
  if (!startTime) { timerLabel.textContent = '00:00'; return; }
  const s = Math.floor((Date.now() - startTime) / 1000);
  timerLabel.textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

// ── UI State ──────────────────────────────────────────────────
function updateUIState() {
  btnPause.disabled = !isRecording; btnStop.disabled = !isRecording;
  btnPause.querySelector('span:last-child').textContent = isPaused ? 'Resume' : 'Pause';

  // Orb
  if (isRecording && !isPaused) {
    orbIcon.textContent = '⏹'; orbLabel.textContent = 'Click to Stop';
    orbRing.className = 'orb-ring recording';
  } else if (isPaused) {
    orbIcon.textContent = '▶'; orbLabel.textContent = 'Click to Stop';
    orbRing.className = 'orb-ring';
  } else {
    orbIcon.textContent = '⏺'; orbLabel.textContent = 'Click to Record';
    orbRing.className = 'orb-ring idle';
  }

  // Status orb & pill
  statusOrb.className = 'brand-orb';
  statusPill.className = 'status-pill';
  if (isRecording && !isPaused) { statusOrb.classList.add('recording'); statusPill.classList.add('recording'); statusPill.textContent = 'REC'; }
  else if (isPaused)             { statusOrb.classList.add('paused');    statusPill.classList.add('paused');    statusPill.textContent = 'PAUSED'; }
  else if (steps.length > 0)    { statusOrb.classList.add('done');      statusPill.classList.add('done');      statusPill.textContent = 'DONE'; }
  else                           { statusPill.textContent = 'IDLE'; }

  pausedBadge.style.display = isPaused ? 'flex' : 'none';
  updateStepCount();
}

function updateStepCount() {
  const n = steps.length;
  stepCountLabel.textContent = n === 0 ? '0 steps' : n === 1 ? '1 step' : `${n} steps`;
}

// ── Render Steps ──────────────────────────────────────────────
function renderSteps(filter = '') {
  const fl = filter.toLowerCase();
  const filtered = filter ? steps.filter(s => getStepSummary(s).toLowerCase().includes(fl)) : steps;

  if (steps.length === 0) { stepsList.innerHTML = buildEmptyHTML(); return; }
  if (filtered.length === 0) {
    stepsList.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-title">No matches</p><p class="empty-desc">No steps match "${escHtml(filter)}"</p></div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  filtered.forEach((step, di) => {
    const ri = steps.indexOf(step);
    frag.appendChild(buildStepCard(step, ri, di + 1));
  });
  stepsList.innerHTML = '';
  stepsList.appendChild(frag);
  if (isRecording && !filter) stepsList.scrollTop = stepsList.scrollHeight;
}

function buildEmptyHTML() {
  return `<div class="empty-state"><div class="empty-icon">🎬</div>
    <p class="empty-title">Ready to Record</p>
    <p class="empty-desc">Click the orb above then interact with any web page.</p></div>`;
}

function buildStepCard(step, ri, dn) {
  const card = document.createElement('div');
  card.className = 'step-card'; card.dataset.index = ri;
  card.draggable = true;

  const icon    = getStepIcon(step);
  const summary = getStepSummary(step);
  const badge   = buildBadge(step.type);
  const pillCls = getPillClass(step.type);
  const timing  = buildTiming(step, ri);

  // Screenshot thumbnail
  const thumbHtml = step.screenshot
    ? `<img class="step-screenshot" src="${step.screenshot}" title="Click to enlarge" />`
    : '';

  card.innerHTML = `
    <div class="drag-handle" title="Drag to reorder">⠿</div>
    <div class="step-num">${dn}</div>
    <div class="step-icon-pill ${pillCls}">${icon}</div>
    <div class="step-content">
      <div class="step-summary">${escHtml(summary)}</div>
      <div class="step-meta-row">${badge}${timing}</div>
    </div>
    ${thumbHtml}
    <div class="step-actions">
      <button class="step-act-btn copy-s" title="Copy as Gherkin">📋</button>
      <button class="step-act-btn dup-btn" title="Duplicate step">⧉</button>
      <button class="step-act-btn edit-btn" title="Edit step">✏️</button>
      <button class="step-act-btn del" title="Delete step">🗑</button>
    </div>
  `;

  // Events
  card.addEventListener('dragstart', e => { dragSrcIndex = ri; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; });
  card.addEventListener('dragend',   () => { dragSrcIndex = null; card.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over')); });
  card.addEventListener('dragover',  e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; card.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault(); card.classList.remove('drag-over');
    if (dragSrcIndex !== null && dragSrcIndex !== ri) {
      chrome.runtime.sendMessage({ type: 'REORDER_STEP', from: dragSrcIndex, to: ri }, (resp) => {
        if (resp?.success) { steps = resp.steps; renderSteps(stepSearch.value); updateGherkin(); }
      });
    }
  });

  if (step.screenshot) {
    card.querySelector('.step-screenshot').addEventListener('click', (e) => { e.stopPropagation(); openScreenshotModal(step.screenshot, summary); });
  }
  card.querySelector('.copy-s').addEventListener('click', e => { e.stopPropagation(); copyStepAsGherkin(step, ri); });
  card.querySelector('.dup-btn').addEventListener('click', e => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: 'DUPLICATE_STEP', index: ri }, (resp) => {
      if (resp?.success) { steps = resp.steps; renderSteps(stepSearch.value); updateGherkin(); showToast('Step duplicated', 'success'); }
    });
  });
  card.querySelector('.edit-btn').addEventListener('click', e => { e.stopPropagation(); openEditModal(ri); });
  card.querySelector('.del').addEventListener('click', e => { e.stopPropagation(); deleteStep(ri, card); });

  return card;
}

function buildBadge(type) {
  const map = { navigate:'navigate',click:'click',input:'input',select:'select',
                checkbox:'checkbox',submit:'submit',assert:'assert',scroll:'scroll',
                hotkey:'hotkey',dragdrop:'dragdrop',paste:'input',radio:'checkbox',file:'input' };
  const cls = map[type] || 'default';
  const labels = { navigate:'NAV',click:'CLICK',input:'INPUT',select:'SELECT',
                   checkbox:'CHECK',submit:'SUBMIT',assert:'ASSERT',scroll:'SCROLL',
                   hotkey:'KEY',dragdrop:'DRAG',paste:'PASTE',radio:'RADIO',file:'FILE' };
  return `<span class="step-type-badge badge-${cls}">${labels[type]||type.toUpperCase()}</span>`;
}

function getPillClass(type) {
  const m = { navigate:'pill-nav',click:'pill-click',input:'pill-input',select:'pill-select',
              checkbox:'pill-checkbox',submit:'pill-submit',assert:'pill-assert',
              scroll:'pill-scroll',dragdrop:'pill-dragdrop',hotkey:'pill-hotkey',
              radio:'pill-checkbox',paste:'pill-input',file:'pill-input' };
  return m[type] || 'pill-default';
}

function buildTiming(step, ri) {
  if (ri === 0 || !step.timestamp) return '';
  const prev = steps[ri - 1];
  if (!prev?.timestamp) return '';
  const diff = step.timestamp - prev.timestamp;
  if (diff < 500) return '';
  const label = diff < 60000
    ? `+${(diff / 1000).toFixed(1)}s`
    : `+${Math.floor(diff / 60000)}m${String(Math.floor((diff % 60000) / 1000)).padStart(2,'0')}s`;
  return `<span class="step-time">${label}</span>`;
}

// ── Screenshot Modal ──────────────────────────────────────────
function openScreenshotModal(src, title) {
  $('screenshotImg').src = src;
  $('screenshotModalTitle').textContent = title || 'Step Screenshot';
  $('screenshotModal').classList.add('open');
}

// ── Step Actions ──────────────────────────────────────────────
function deleteStep(index, el) {
  el.style.opacity = '0'; el.style.transform = 'translateX(16px)'; el.style.transition = 'all 200ms ease';
  setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'DELETE_STEP', index }, (resp) => {
      if (resp?.success) { steps = resp.steps; renderSteps(stepSearch.value); updateStepCount(); updateGherkin(); }
    });
  }, 200);
}

function copyStepAsGherkin(step, index) {
  const result = stepToGherkin(step, index, index > 0 ? 'When' : null);
  if (result) {
    navigator.clipboard.writeText(`    ${result.line}`).then(() => showToast('Step copied!', 'success')).catch(() => {});
  }
}

// ── Edit Modal ────────────────────────────────────────────────
function openEditModal(index) {
  editingIndex = index; const step = steps[index];
  $('editLabel').value = step.label || step.url || '';
  $('editValue').value = step.value || '';
  $('editType').value  = step.type  || 'click';
  $('editValueRow').style.display = ['navigate'].includes(step.type) ? 'none' : '';
  $('editModal').classList.add('open'); $('editLabel').focus();
}
function closeEditModal() { $('editModal').classList.remove('open'); editingIndex = null; }
function saveEditStep() {
  if (editingIndex === null) return;
  const updates = { label: $('editLabel').value.trim(), type: $('editType').value };
  if ($('editValue').value.trim()) updates.value = $('editValue').value.trim();
  if (updates.type === 'navigate') { updates.url = updates.label; delete updates.label; }
  chrome.runtime.sendMessage({ type: 'UPDATE_STEP', index: editingIndex, updates }, (resp) => {
    if (resp?.success) { steps = resp.steps; renderSteps(stepSearch.value); updateGherkin(); showToast('Step updated', 'success'); }
  });
  closeEditModal();
}

// ── Manual Assert ─────────────────────────────────────────────
function addManualAssert() {
  const type = $('assertType').value;
  const val  = $('assertValue').value.trim();
  if (!val) { showToast('Enter a value', 'error'); return; }

  const labels = {
    see_text:        `Then I should see "${val}"`,
    see_element:     `Then I should see the "${val}" element`,
    not_see:         `Then I should not see "${val}"`,
    url_contains:    `Then the URL should contain "${val}"`,
    title_is:        `Then the page title should be "${val}"`,
    element_enabled: `Then the "${val}" element should be enabled`,
    element_disabled:`Then the "${val}" element should be disabled`,
    count:           `Then there should be "${val}" elements`,
  };

  const step = { type: 'assert', elementType: 'assertion', assertType: type,
                 label: val, value: val, gherkinOverride: labels[type], timestamp: Date.now() };

  chrome.runtime.sendMessage({ type: 'RECORD_ACTION', action: step }, () => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
      if (state) steps = state.steps || steps;
      renderSteps(); updateStepCount(); updateGherkin();
    });
  });

  $('assertModal').classList.remove('open');
  $('assertValue').value = '';
  showToast('Assertion added!', 'success');
}

// ── Gherkin Generation ────────────────────────────────────────
function updateGherkin() {
  const feat = featureName.value.trim() || 'My Feature';
  const scen = scenarioName.value.trim() || 'My Scenario';
  const tags = tagsInput.value.trim();
  const ded  = $('optDedupe').checked;

  let ws = [...steps];
  if (ded) ws = deduplicateSteps(ws);

  if (ws.length === 0) {
    gherkinOutput.innerHTML = `<span class="muted">Start recording to generate Gherkin…</span>`;
    return;
  }
  const raw = buildGherkinText(ws, feat, scen, tags);
  gherkinOutput.innerHTML = syntaxHL(raw);
}

function buildGherkinText(steps, feat, scen, tags) {
  const lines = [];
  if (tags) lines.push(tags);
  lines.push(`Feature: ${feat}`);
  lines.push('');
  const fn = steps.find(s => s.type === 'navigate');
  if (fn) { lines.push(`  # URL: ${fn.url}`); lines.push(`  # Steps: ${steps.length}`); lines.push(''); }
  lines.push(`  Scenario: ${scen}`);
  let prevKw = null, idx = 0;
  for (const step of steps) {
    if (step._overrideText) { lines.push(`    ${step._overrideText}`); prevKw = 'Then'; idx++; continue; }
    if (step.gherkinOverride) { lines.push(`    ${step.gherkinOverride}`); prevKw = 'Then'; idx++; continue; }
    const r = stepToGherkin(step, idx, prevKw);
    if (!r) continue;
    lines.push(`    ${r.line}`); prevKw = r.keyword; idx++;
  }
  if (prevKw === 'When') lines.push(`    Then I verify the page state`);
  lines.push('');
  return lines.join('\n');
}

function syntaxHL(text) {
  return escHtml(text)
    .replace(/^(Feature:)/gm,    '<span class="kw-feature">Feature:</span>')
    .replace(/^(  Scenario:)/gm, '<span class="kw-scenario">  Scenario:</span>')
    .replace(/^(    Given )/gm,  '<span class="kw-given">    Given </span>')
    .replace(/^(    When )/gm,   '<span class="kw-when">    When </span>')
    .replace(/^(    Then )/gm,   '<span class="kw-then">    Then </span>')
    .replace(/^(    And )/gm,    '<span class="kw-and">    And </span>')
    .replace(/(#.*)/gm,          '<span class="kw-comment">$1</span>')
    .replace(/(@\S+)/g,          '<span class="kw-tag">$1</span>')
    .replace(/"([^"]*)"/g,       '"<span class="kw-string">$1</span>"');
}

function copyGherkin() {
  const text = getRawGherkin();
  if (!text || steps.length === 0) { showToast('Nothing to copy', 'error'); return; }
  navigator.clipboard.writeText(text).then(() => showToast('Copied!', 'success')).catch(() => showToast('Copy failed','error'));
}

function downloadGherkin() {
  if (steps.length === 0) { showToast('No steps to download', 'error'); return; }
  const text = getRawGherkin();
  const fn   = sanitize(scenarioName.value || 'scenario') + '.feature';
  downloadText(text, fn, 'text/plain');
  showToast(`Downloaded ${fn}`, 'success');
}

function getRawGherkin() {
  let ws = [...steps];
  if ($('optDedupe').checked) ws = deduplicateSteps(ws);
  return buildGherkinText(ws, featureName.value.trim() || 'My Feature', scenarioName.value.trim() || 'My Scenario', tagsInput.value.trim());
}

// ── Export Tab ────────────────────────────────────────────────
function updateExportOutput() {
  const fmt = $('exportFormat').value;
  const feat = featureName.value.trim() || 'My Feature';
  const scen = scenarioName.value.trim() || 'My Scenario';
  const tags = tagsInput.value.trim();
  const titleMap = { playwright: 'Playwright (TypeScript)', cypress: 'Cypress', selenium: 'Selenium (Python)', json: 'JSON' };
  $('exportOutputTitle').textContent = titleMap[fmt] || fmt;

  let ws = [...steps];
  if ($('optDedupe') && $('optDedupe').checked) ws = deduplicateSteps(ws);

  if (ws.length === 0) {
    $('exportOutput').innerHTML = `<span class="muted">Record some steps first…</span>`;
    $('varHints').style.display = 'none'; return;
  }

  let code = '';
  if (fmt === 'playwright') code = generatePlaywright(ws, scen);
  else if (fmt === 'cypress')   code = generateCypress(ws, scen);
  else if (fmt === 'selenium')  code = generateSelenium(ws, scen);
  else if (fmt === 'json')      code = generateJSON(ws, feat, scen, tags);

  $('exportOutput').textContent = code;

  // Variable detection
  const vars = detectVariables(ws);
  if (vars.length > 0) {
    $('varHints').style.display = 'block';
    $('varHintsList').innerHTML = vars.slice(0, 5).map(v =>
      `<div class="var-hint-item">
        <span>Step ${v.index + 1} — ${v.type}</span>
        <span class="var-hint-val">${escHtml(v.value.slice(0, 30))}…</span>
        <span class="var-hint-action" onclick="markAsVariable(${v.index})">→ {{variable}}</span>
      </div>`
    ).join('');
  } else {
    $('varHints').style.display = 'none';
  }
}

function markAsVariable(index) {
  if (!steps[index]) return;
  const step = steps[index];
  const newVal = `{{${step.type}_${index + 1}}}`;
  chrome.runtime.sendMessage({ type: 'UPDATE_STEP', index, updates: { value: newVal } }, (resp) => {
    if (resp?.success) { steps = resp.steps; updateExportOutput(); updateGherkin(); showToast('Marked as variable', 'success'); }
  });
}

function copyExport() {
  const text = $('exportOutput').textContent;
  if (!text || steps.length === 0) { showToast('Nothing to copy', 'error'); return; }
  navigator.clipboard.writeText(text).then(() => showToast('Copied!', 'success')).catch(() => {});
}

function downloadExport() {
  const fmt  = $('exportFormat').value;
  const text = $('exportOutput').textContent;
  if (!text || steps.length === 0) { showToast('Nothing to download', 'error'); return; }
  const exts = { playwright: 'spec.ts', cypress: 'cy.js', selenium: 'test.py', json: 'json' };
  const fn   = sanitize(scenarioName.value || 'scenario') + '.' + (exts[fmt] || 'txt');
  const mimes = { playwright: 'text/typescript', cypress: 'text/javascript', selenium: 'text/x-python', json: 'application/json' };
  downloadText(text, fn, mimes[fmt] || 'text/plain');
  showToast(`Downloaded ${fn}`, 'success');
}

// ── Saved Scenarios ───────────────────────────────────────────
function saveScenario() {
  if (steps.length === 0) { showToast('No steps to save', 'error'); return; }
  const scenario = {
    featureName: featureName.value.trim() || 'My Feature',
    scenarioName: scenarioName.value.trim() || 'My Scenario',
    tags: tagsInput.value.trim(), steps: [...steps],
    stepCount: steps.length, gherkin: getRawGherkin(), savedAt: Date.now()
  };
  chrome.runtime.sendMessage({ type: 'SAVE_SCENARIO', scenario }, () => {
    showToast(`Saved: "${scenario.scenarioName}"`, 'success'); loadSavedScenarios();
  });
}

function loadSavedScenarios() {
  chrome.runtime.sendMessage({ type: 'GET_SCENARIOS' }, (resp) => renderSavedScenarios(resp?.scenarios || []));
}

function renderSavedScenarios(scenarios) {
  if (scenarios.length === 0) {
    savedList.innerHTML = `<div class="empty-state"><div class="empty-icon">💾</div><p class="empty-title">No Saved Scenarios</p><p class="empty-desc">Record and save scenarios here.</p></div>`;
    return;
  }
  savedList.innerHTML = '';
  [...scenarios].reverse().forEach(sc => {
    const item = document.createElement('div');
    item.className = 'saved-card';
    const date = new Date(sc.savedAt).toLocaleDateString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
    item.innerHTML = `
      <div class="saved-card-info">
        <div class="saved-card-name">${escHtml(sc.scenarioName)}</div>
        <div class="saved-card-meta">📋 ${sc.stepCount} steps · ${date}${sc.tags ? ' · ' + escHtml(sc.tags) : ''}</div>
      </div>
      <div class="saved-card-actions">
        <button class="step-act-btn" data-action="load" title="Load">📂</button>
        <button class="step-act-btn" data-action="copy" title="Copy">📋</button>
        <button class="step-act-btn" data-action="download" title="Download">💾</button>
        <button class="step-act-btn del" data-action="delete" title="Delete">🗑</button>
      </div>`;
    item.querySelectorAll('[data-action]').forEach(btn =>
      btn.addEventListener('click', () => handleSavedAction(btn.dataset.action, sc)));
    savedList.appendChild(item);
  });
}

function handleSavedAction(action, sc) {
  if (action === 'load') {
    steps = [...sc.steps]; featureName.value = sc.featureName;
    scenarioName.value = sc.scenarioName; tagsInput.value = sc.tags || '';
    renderSteps(); updateStepCount(); updateGherkin(); switchTab('record');
    showToast(`Loaded "${sc.scenarioName}"`, 'success');
  }
  if (action === 'copy')     navigator.clipboard.writeText(sc.gherkin).then(() => showToast('Copied!','success')).catch(()=>{});
  if (action === 'download') { downloadText(sc.gherkin, sanitize(sc.scenarioName)+'.feature', 'text/plain'); showToast('Downloaded','success'); }
  if (action === 'delete') {
    if (!confirm(`Delete "${sc.scenarioName}"?`)) return;
    chrome.runtime.sendMessage({ type: 'DELETE_SCENARIO', id: sc.id }, (resp) => {
      renderSavedScenarios(resp?.scenarios || []); showToast('Deleted','info');
    });
  }
}

function exportAllScenarios() {
  chrome.runtime.sendMessage({ type: 'GET_SCENARIOS' }, (resp) => {
    const sc = resp?.scenarios || [];
    if (!sc.length) { showToast('No scenarios to export','error'); return; }
    downloadText(sc.map(s => s.gherkin).join('\n\n# ──────────────────\n\n'), 'all-scenarios.feature', 'text/plain');
    showToast(`Exported ${sc.length} scenarios`, 'success');
  });
}

// ── Video ─────────────────────────────────────────────────────
function handleVideoButton() {
  if (isVideoProcessing) return;
  if (!isVideoRecording) {
    if (videoPreviewPanel) videoPreviewPanel.style.display = 'none';
    videoDataUrl = null;
    btnVideo.disabled = true; videoBtnLabel.textContent = '…';
    chrome.runtime.sendMessage({ type: 'START_VIDEO_RECORDING' }, (resp) => {
      btnVideo.disabled = false;
      if (resp?.success) {
        isVideoRecording = true; isVideoPaused = false;
        updateVideoUI(); showToast('🔴 Video recording!', 'success');
      } else {
        showToast('Video error: ' + (resp?.error || '?'), 'error');
        videoBtnLabel.textContent = 'Video'; btnVideo.classList.remove('recording');
      }
    });
  } else if (!isVideoPaused) {
    chrome.runtime.sendMessage({ type: 'PAUSE_VIDEO_RECORDING' }, () => {
      isVideoPaused = true; updateVideoUI(); showToast('Video paused','info');
    });
  } else {
    chrome.runtime.sendMessage({ type: 'RESUME_VIDEO_RECORDING' }, () => {
      isVideoPaused = false; updateVideoUI(); showToast('Video resumed','success');
    });
  }
}

function stopVideoRecording() {
  chrome.runtime.sendMessage({ type: 'STOP_VIDEO_RECORDING' }, () => {
    isVideoProcessing = true; updateVideoUI(); showToast('⏳ Encoding…','info');
  });
}

function updateVideoUI() {
  if (!btnVideo) return;
  if (isVideoProcessing) {
    btnVideo.className = 'sec-btn video'; videoBtnLabel.textContent = 'Encoding…'; btnVideo.disabled = true;
    if (videoBadgeEl) videoBadgeEl.style.display = 'none'; return;
  }
  btnVideo.disabled = false;
  if (!isVideoRecording) {
    btnVideo.className = 'sec-btn video'; videoBtnLabel.textContent = 'Video';
    if (videoBadgeEl) videoBadgeEl.style.display = 'none';
  } else if (isVideoPaused) {
    btnVideo.className = 'sec-btn video recording'; videoBtnLabel.textContent = 'Resume';
    if (videoBadgeEl) { videoBadgeEl.style.display = 'flex'; videoBadgeEl.querySelector('.video-chip').textContent = '⏸ PAUSED'; }
  } else {
    btnVideo.className = 'sec-btn video recording'; videoBtnLabel.textContent = 'Pause';
    if (videoBadgeEl) {
      videoBadgeEl.style.display = 'flex';
      const chip = videoBadgeEl.querySelector('.video-chip');
      if (chip) chip.textContent = '⏺ REC';
      videoBadgeEl.style.cursor = 'pointer';
      videoBadgeEl.title = 'Click to stop video';
      videoBadgeEl.onclick = () => { if (confirm('Stop and encode video?')) stopVideoRecording(); };
    }
  }
}

function showVideoPreview(dataUrl, size) {
  if (!videoPreviewPanel || !videoPlayer) return;
  videoPlayer.src = dataUrl;
  const sl = $('videoSizeLabel');
  if (sl && size) sl.textContent = (size / (1024*1024)).toFixed(1) + ' MB';

  const od = $('btnVideoDownload'), os = $('btnVideoDiscard');
  const nd = od.cloneNode(true), ns = os.cloneNode(true);
  od.parentNode.replaceChild(nd, od); os.parentNode.replaceChild(ns, os);
  $('btnVideoDownload').addEventListener('click', downloadVideo);
  $('btnVideoDiscard').addEventListener('click', () => { videoPreviewPanel.style.display='none'; videoPlayer.src=''; videoDataUrl=null; });
  videoPreviewPanel.style.display = 'block';
}

function downloadVideo() {
  if (!videoDataUrl) { showToast('No video','error'); return; }
  const ext = videoDataUrl.includes('video/mp4') ? 'mp4' : 'webm';
  const a = document.createElement('a');
  a.href = videoDataUrl; a.download = `${sanitize(scenarioName?.value||'recording')}.${ext}`; a.click();
  showToast('Video downloaded!','success');
}

// ── Theme ─────────────────────────────────────────────────────
function loadTheme() {
  chrome.storage.local.get(['theme'], (r) => {
    isDark = r.theme !== 'light';
    applyTheme();
  });
}
function toggleTheme() {
  isDark = !isDark; applyTheme();
  chrome.storage.local.set({ theme: isDark ? 'dark' : 'light' });
  showToast(isDark ? '🌙 Dark mode' : '☀️ Light mode', 'info');
}
function applyTheme() {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  $('themeIcon').textContent = isDark ? '🌙' : '☀️';
}

// ── Tabs ──────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-item').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => {
    const active = p.id === `tab-${name}`;
    p.classList.toggle('active', active); p.style.display = active ? 'flex' : 'none';
  });
  if (name === 'gherkin') updateGherkin();
  if (name === 'export')  updateExportOutput();
  if (name === 'saved')   loadSavedScenarios();
}
document.querySelectorAll('.tab-panel').forEach(p => {
  p.style.display = p.classList.contains('active') ? 'flex' : 'none';
});

// ── Toast ─────────────────────────────────────────────────────
let toastT;
function showToast(msg, type = 'success') {
  toast.textContent = msg; toast.className = `toast ${type} show`;
  clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('show'), 2600);
}

// ── Utils ─────────────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function sanitize(s) { return s.replace(/[^a-zA-Z0-9_\-]/g,'_').toLowerCase().slice(0,50)||'file'; }
function downloadText(text, filename, mime) {
  const blob = new Blob([text], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

window.markAsVariable = markAsVariable;
