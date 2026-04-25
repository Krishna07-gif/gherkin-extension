// ============================================================
// popup.js — Extension Popup Controller
// Handles all UI interactions, real-time step display,
// Gherkin generation, scenario management, export.
// ============================================================

'use strict';

// ----- State -----
let steps = [];
let isRecording = false;
let isPaused = false;
let startTime = null;
let timerInterval = null;
let editingIndex = null;

// Video state
let isVideoRecording = false;
let isVideoPaused    = false;
let isVideoProcessing = false;
let videoDataUrl     = null;

// ----- DOM Refs -----
const $ = id => document.getElementById(id);
const statusBadge     = $('statusBadge');
const statusText      = $('statusText');
const btnStart        = $('btnStart');
const btnPause        = $('btnPause');
const btnStop         = $('btnStop');
const btnClear        = $('btnClear');
const stepCountLabel  = $('stepCountLabel');
const timerLabel      = $('timerLabel');
const pausedBadge     = $('pausedBadge');
const stepsList       = $('stepsList');
const emptyState      = $('emptyState');
const stepSearch      = $('stepSearch');
const gherkinOutput   = $('gherkinOutput');
const featureName     = $('featureName');
const scenarioName    = $('scenarioName');
const tagsInput       = $('tagsInput');
const savedList       = $('savedList');
const editModal       = $('editModal');
const assertModal     = $('assertModal');
const toast           = $('toast');

// Video DOM refs (resolved after DOMContentLoaded)
let btnVideo, videoBadge, videoPreviewPanel, videoPlayer, videoBtnLabel;

// ===========================================================
//  INIT
// ===========================================================
document.addEventListener('DOMContentLoaded', async () => {
  // Assign video DOM refs after DOM is ready
  btnVideo          = $('btnVideoRecord');
  videoBadge        = $('videoBadge');
  videoPreviewPanel = $('videoPreviewPanel');
  videoPlayer       = $('videoPlayer');
  videoBtnLabel     = $('videoBtnLabel');

  await loadState();
  bindEvents();
  loadSavedScenarios();
});

async function loadState() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (resp) => {
      if (chrome.runtime.lastError || !resp) { resolve(); return; }
      steps            = resp.steps || [];
      isRecording      = resp.isRecording || false;
      isPaused         = resp.isPaused || false;
      startTime        = resp.startTime || null;
      isVideoRecording = resp.isVideoRecording || false;
      isVideoPaused    = resp.isVideoPaused || false;

      renderSteps();
      updateUIState();
      updateVideoUI();
      updateGherkin();

      if (isRecording && startTime) startTimer();
      resolve();
    });
  });
}

// ===========================================================
//  MESSAGE LISTENER — real-time step updates from background
// ===========================================================
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'STATE_UPDATE') {
    const prevCount      = steps.length;
    steps                = message.steps || [];
    isRecording          = message.isRecording;
    isPaused             = message.isPaused;
    isVideoRecording     = message.isVideoRecording || false;
    isVideoPaused        = message.isVideoPaused    || false;

    if (steps.length !== prevCount) renderSteps();
    updateStepCount();
    updateGherkin();
    updateVideoUI();
  }

  // Background relays finished video data URL here
  if (message.type === 'VIDEO_READY') {
    isVideoRecording  = false;
    isVideoProcessing = false;
    videoDataUrl      = message.dataUrl;
    updateVideoUI();
    showVideoPreview(message.dataUrl, message.size);
    showToast('✅ Video ready! Click Download.', 'success');
  }
});

// ===========================================================
//  EVENT BINDINGS
// ===========================================================
function bindEvents() {
  // Controls
  btnStart.addEventListener('click', startRecording);
  btnPause.addEventListener('click', pauseRecording);
  btnStop.addEventListener('click',  stopRecording);
  btnClear.addEventListener('click', clearSteps);

  // Video recording
  btnVideo.addEventListener('click', handleVideoButton);

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // Gherkin tab actions
  $('btnRefresh').addEventListener('click', updateGherkin);
  $('btnCopy').addEventListener('click', copyGherkin);
  $('btnDownload').addEventListener('click', downloadGherkin);
  $('btnSaveScenario').addEventListener('click', saveScenario);

  // Real-time Gherkin refresh on name change
  featureName.addEventListener('input',  updateGherkin);
  scenarioName.addEventListener('input', updateGherkin);
  tagsInput.addEventListener('input',    updateGherkin);
  $('optDedupe').addEventListener('change', updateGherkin);
  $('optSmartNav').addEventListener('change', updateGherkin);

  // Step search / filter
  stepSearch.addEventListener('input', () => renderSteps(stepSearch.value));

  // Add assertion button
  $('btnAddAssert').addEventListener('click', () => {
    assertModal.classList.add('open');
    $('assertValue').focus();
  });

  // Edit modal
  $('modalClose').addEventListener('click',   closeEditModal);
  $('modalCancel').addEventListener('click',  closeEditModal);
  $('modalSave').addEventListener('click',    saveEditStep);
  editModal.addEventListener('click', e => { if (e.target === editModal) closeEditModal(); });

  // Assert modal
  $('assertModalClose').addEventListener('click',  () => assertModal.classList.remove('open'));
  $('assertModalCancel').addEventListener('click', () => assertModal.classList.remove('open'));
  $('assertModalSave').addEventListener('click',   addManualAssert);
  assertModal.addEventListener('click', e => { if (e.target === assertModal) assertModal.classList.remove('open'); });

  // Saved tab
  $('btnExportAll').addEventListener('click', exportAllScenarios);

  // Settings
  $('btnClearAll').addEventListener('click', () => {
    if (confirm('Delete all saved scenarios? This cannot be undone.')) {
      chrome.storage.local.set({ scenarios: [] }, () => {
        loadSavedScenarios();
        showToast('All scenarios deleted', 'error');
      });
    }
  });

  // Keyboard shortcut: Enter in assert value field
  $('assertValue').addEventListener('keydown', e => {
    if (e.key === 'Enter') addManualAssert();
  });
}

// ===========================================================
//  RECORDING CONTROLS
// ===========================================================
function startRecording() {
  chrome.runtime.sendMessage({ type: 'START_RECORDING' }, () => {
    isRecording = true;
    isPaused    = false;
    startTime   = Date.now();
    steps       = [];
    renderSteps();
    updateUIState();
    startTimer();
    showToast('Recording started!', 'success');
    switchTab('record');
  });
}

function pauseRecording() {
  chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' }, (resp) => {
    if (!resp) return;
    isPaused = resp.isPaused;
    updateUIState();
    showToast(isPaused ? 'Recording paused' : 'Recording resumed', 'info');
    if (isPaused) {
      clearInterval(timerInterval);
    } else {
      startTimer();
    }
  });
}

function stopRecording() {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, (resp) => {
    isRecording = false;
    isPaused    = false;
    if (resp) steps = resp.steps || steps;
    stopTimer();
    updateUIState();
    renderSteps();
    updateGherkin();
    showToast(`Stopped. ${steps.length} steps recorded.`, 'success');
    // Auto-switch to Gherkin tab if steps exist
    if (steps.length > 0) {
      setTimeout(() => switchTab('gherkin'), 600);
    }
  });
}

function clearSteps() {
  if (steps.length > 0 && !confirm('Clear all recorded steps?')) return;
  chrome.runtime.sendMessage({ type: 'CLEAR_STEPS' }, () => {
    steps = [];
    stopTimer();
    if (!isRecording) startTime = null;
    else startTime = Date.now();
    renderSteps();
    updateStepCount();
    updateGherkin();
    showToast('Steps cleared', 'info');
  });
}

// ===========================================================
//  TIMER
// ===========================================================
function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer();
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
}

function updateTimer() {
  if (!startTime) { timerLabel.textContent = '00:00'; return; }
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  const m = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const s = String(elapsed % 60).padStart(2, '0');
  timerLabel.textContent = `${m}:${s}`;
}

// ===========================================================
//  UI STATE
// ===========================================================
function updateUIState() {
  // Buttons
  btnStart.disabled = isRecording;
  btnPause.disabled = !isRecording;
  btnStop.disabled  = !isRecording;
  btnPause.querySelector('span').textContent = isPaused ? 'Resume' : 'Pause';

  // Status badge
  statusBadge.className = 'status-badge';
  if (isRecording && !isPaused) {
    statusBadge.classList.add('recording');
    statusText.textContent = 'REC';
  } else if (isPaused) {
    statusBadge.classList.add('paused');
    statusText.textContent = 'PAUSED';
  } else if (steps.length > 0) {
    statusBadge.classList.add('done');
    statusText.textContent = 'DONE';
  } else {
    statusText.textContent = 'IDLE';
  }

  // Paused badge
  pausedBadge.style.display = isPaused ? 'flex' : 'none';

  updateStepCount();
}

function updateStepCount() {
  const n = steps.length;
  stepCountLabel.textContent = n === 0 ? '0 steps recorded'
    : n === 1 ? '1 step recorded'
    : `${n} steps recorded`;
}

// ===========================================================
//  RENDER STEPS
// ===========================================================
function renderSteps(filter = '') {
  const filterLower = filter.toLowerCase();
  const filtered = filter
    ? steps.filter((s, i) => getStepSummary(s).toLowerCase().includes(filterLower))
    : steps;

  // Show/hide empty state
  if (steps.length === 0) {
    stepsList.innerHTML = '';
    stepsList.appendChild(buildEmptyState());
    return;
  }

  if (filtered.length === 0) {
    stepsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p class="empty-title">No matches</p>
        <p class="empty-desc">No steps match "${filter}"</p>
      </div>`;
    return;
  }

  // Build fragment for performance
  const fragment = document.createDocumentFragment();
  filtered.forEach((step, displayIdx) => {
    const realIdx = steps.indexOf(step);
    fragment.appendChild(buildStepEl(step, realIdx, displayIdx + 1));
  });

  stepsList.innerHTML = '';
  stepsList.appendChild(fragment);

  // Scroll to bottom if recording
  if (isRecording && !filter) {
    stepsList.scrollTop = stepsList.scrollHeight;
  }
}

function buildEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `
    <div class="empty-icon">🎬</div>
    <p class="empty-title">Ready to Record</p>
    <p class="empty-desc">Click <strong>Start</strong> then interact with any web page.<br>Every click, type, and navigation will be captured here.</p>
  `;
  return div;
}

function buildStepEl(step, realIdx, displayNum) {
  const el = document.createElement('div');
  el.className = 'step-item';
  el.dataset.index = realIdx;

  const icon    = getStepIcon(step);
  const summary = getStepSummary(step);
  const badge   = buildBadge(step.type);
  const meta    = buildMeta(step);

  el.innerHTML = `
    <span class="step-number">${displayNum}</span>
    <span class="step-icon">${icon}</span>
    <div class="step-content">
      <div class="step-summary">${escapeHtml(summary)}</div>
      <div class="step-meta">${badge}${meta}</div>
    </div>
    <div class="step-actions">
      <button class="step-action-btn edit-btn" title="Edit step">✏️</button>
      <button class="step-action-btn delete delete-btn" title="Delete step">🗑</button>
    </div>
  `;

  el.querySelector('.edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    openEditModal(realIdx);
  });

  el.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteStep(realIdx, el);
  });

  return el;
}

function buildBadge(type) {
  const map = {
    navigate: ['navigate', 'NAVIGATE'],
    click:    ['click',    'CLICK'],
    input:    ['input',    'INPUT'],
    select:   ['select',   'SELECT'],
    checkbox: ['checkbox', 'CHECK'],
    radio:    ['checkbox', 'RADIO'],
    submit:   ['submit',   'SUBMIT'],
    file:     ['file',     'FILE'],
    hotkey:   ['hotkey',   'KEY'],
    assert:   ['assert',   'ASSERT']
  };
  const [cls, label] = map[type] || ['navigate', type.toUpperCase()];
  return `<span class="step-type-badge badge-${cls}">${label}</span>`;
}

function buildMeta(step) {
  if (step.type === 'navigate') {
    try { return new URL(step.url).hostname; } catch { return step.url; }
  }
  if (step.type === 'input') return `${step.inputType || 'text'} field`;
  if (step.type === 'click') return step.elementType || '';
  return '';
}

// ===========================================================
//  STEP ACTIONS
// ===========================================================
function deleteStep(index, el) {
  // Animate out
  el.style.opacity = '0';
  el.style.transform = 'translateX(20px)';
  el.style.transition = 'all 200ms ease';

  setTimeout(() => {
    chrome.runtime.sendMessage({ type: 'DELETE_STEP', index }, (resp) => {
      if (resp && resp.success) {
        steps = resp.steps;
        renderSteps(stepSearch.value);
        updateStepCount();
        updateGherkin();
      }
    });
  }, 200);
}

function openEditModal(index) {
  editingIndex = index;
  const step = steps[index];

  $('editLabel').value = step.label || step.url || '';
  $('editValue').value = step.value || '';
  $('editType').value  = step.type  || 'click';

  // Show/hide value row based on type
  const showValue = !['navigate', 'submit', 'assert'].includes(step.type);
  $('editValueRow').style.display = showValue ? '' : 'none';
  if (step.type === 'assert') {
    $('editValueRow').style.display = '';
    $('editValue').value = step.value || '';
  }

  editModal.classList.add('open');
  $('editLabel').focus();
}

function closeEditModal() {
  editModal.classList.remove('open');
  editingIndex = null;
}

function saveEditStep() {
  if (editingIndex === null) return;

  const step  = steps[editingIndex];
  const label = $('editLabel').value.trim();
  const value = $('editValue').value.trim();
  const type  = $('editType').value;

  const updates = { label, type };
  if (value) updates.value = value;
  if (type === 'navigate') {
    updates.url = label;
    delete updates.label;
  }

  chrome.runtime.sendMessage({ type: 'UPDATE_STEP', index: editingIndex, updates }, (resp) => {
    if (resp && resp.success) {
      steps = resp.steps;
      renderSteps(stepSearch.value);
      updateGherkin();
      showToast('Step updated', 'success');
    }
  });

  closeEditModal();
}

function addManualAssert() {
  const assertType = $('assertType').value;
  const value = $('assertValue').value.trim();
  if (!value) { showToast('Please enter an assertion value', 'error'); return; }

  const assertLabels = {
    see_text:        `I should see "${value}"`,
    see_element:     `I should see the "${value}" element`,
    not_see:         `I should not see "${value}"`,
    url_contains:    `the URL should contain "${value}"`,
    title_is:        `the page title should be "${value}"`,
    element_enabled: `the "${value}" element should be enabled`,
    element_disabled:`the "${value}" element should be disabled`
  };

  const step = {
    type: 'assert',
    elementType: 'assertion',
    assertType,
    label: value,
    value,
    gherkinOverride: `Then ${assertLabels[assertType]}`,
    timestamp: Date.now()
  };

  chrome.runtime.sendMessage({ type: 'RECORD_ACTION', action: step }, (resp) => {
    // Also update local steps
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (state) => {
      if (state) steps = state.steps || steps;
      renderSteps();
      updateStepCount();
      updateGherkin();
    });
  });

  assertModal.classList.remove('open');
  $('assertValue').value = '';
  showToast('Assertion added!', 'success');
}

// ===========================================================
//  GHERKIN GENERATION
// ===========================================================
function updateGherkin() {
  const feature  = featureName.value.trim()  || 'My Feature';
  const scenario = scenarioName.value.trim() || 'My Scenario';
  const tags     = tagsInput.value.trim();
  const dedupe   = $('optDedupe').checked;

  let workingSteps = [...steps];
  if (dedupe) workingSteps = deduplicateSteps(workingSteps);

  // Handle manual assert overrides
  workingSteps = workingSteps.map(s => {
    if (s.gherkinOverride) return { ...s, _overrideText: s.gherkinOverride };
    return s;
  });

  if (workingSteps.length === 0) {
    gherkinOutput.innerHTML = `<span class="placeholder-text">Record some steps to generate Gherkin output...</span>`;
    return;
  }

  const raw = generateGherkinWithOverrides(workingSteps, feature, scenario, tags);
  gherkinOutput.innerHTML = syntaxHighlight(raw);
}

function generateGherkinWithOverrides(steps, featureName, scenarioName, tags) {
  const lines = [];

  if (tags) lines.push(tags);
  lines.push(`Feature: ${featureName}`);
  lines.push('');

  const firstNav = steps.find(s => s.type === 'navigate');
  if (firstNav) {
    lines.push(`  # URL: ${firstNav.url}`);
    lines.push(`  # Steps: ${steps.length}`);
    lines.push('');
  }

  lines.push(`  Scenario: ${scenarioName}`);

  let prevKeyword = null;
  let stepIndex   = 0;

  for (const step of steps) {
    // Check for manual override
    if (step._overrideText) {
      lines.push(`    ${step._overrideText}`);
      prevKeyword = 'Then';
      stepIndex++;
      continue;
    }

    const result = stepToGherkin(step, stepIndex, prevKeyword);
    if (!result) continue;

    lines.push(`    ${result.line}`);
    prevKeyword = result.keyword;
    stepIndex++;
  }

  lines.push('');
  return lines.join('\n');
}

// Syntax highlight the Gherkin output
function syntaxHighlight(text) {
  return escapeHtml(text)
    .replace(/^(Feature:)/gm,  '<span class="kw-feature">Feature:</span>')
    .replace(/^(  Scenario:)/gm, '<span class="kw-scenario">  Scenario:</span>')
    .replace(/^(  Scenario Outline:)/gm, '<span class="kw-scenario">  Scenario Outline:</span>')
    .replace(/^(    Given )/gm,  '<span class="kw-given">    Given </span>')
    .replace(/^(    When )/gm,   '<span class="kw-when">    When </span>')
    .replace(/^(    Then )/gm,   '<span class="kw-then">    Then </span>')
    .replace(/^(    And )/gm,    '<span class="kw-and">    And </span>')
    .replace(/^(    But )/gm,    '<span class="kw-and">    But </span>')
    .replace(/(#.*)/gm,          '<span class="kw-comment">$1</span>')
    .replace(/(@\S+)/g,          '<span class="kw-tag">$1</span>')
    .replace(/"([^"]*)"/g,        '"<span class="kw-string">$1</span>"');
}

// ===========================================================
//  EXPORT
// ===========================================================
function copyGherkin() {
  const text = getRawGherkin();
  if (!text || text.includes('Record some steps')) {
    showToast('Nothing to copy — record some steps first', 'error');
    return;
  }
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!', 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Copied!', 'success');
  });
}

function downloadGherkin() {
  const text = getRawGherkin();
  if (!text || steps.length === 0) {
    showToast('Nothing to download — record some steps first', 'error');
    return;
  }
  const filename = `${sanitizeFilename(scenarioName.value || 'scenario')}.feature`;
  const blob = new Blob([text], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  showToast(`Downloaded ${filename}`, 'success');
}

function getRawGherkin() {
  const feature  = featureName.value.trim()  || 'My Feature';
  const scenario = scenarioName.value.trim() || 'My Scenario';
  const tags     = tagsInput.value.trim();
  const dedupe   = $('optDedupe').checked;
  let workingSteps = [...steps];
  if (dedupe) workingSteps = deduplicateSteps(workingSteps);
  return generateGherkinWithOverrides(workingSteps, feature, scenario, tags);
}

// ===========================================================
//  SAVED SCENARIOS
// ===========================================================
function saveScenario() {
  if (steps.length === 0) {
    showToast('No steps to save', 'error');
    return;
  }
  const scenario = {
    featureName:  featureName.value.trim()  || 'My Feature',
    scenarioName: scenarioName.value.trim() || 'My Scenario',
    tags:         tagsInput.value.trim(),
    steps:        [...steps],
    stepCount:    steps.length,
    gherkin:      getRawGherkin(),
    savedAt:      Date.now()
  };

  chrome.runtime.sendMessage({ type: 'SAVE_SCENARIO', scenario }, (resp) => {
    showToast(`Saved: "${scenario.scenarioName}"`, 'success');
    loadSavedScenarios();
  });
}

function loadSavedScenarios() {
  chrome.runtime.sendMessage({ type: 'GET_SCENARIOS' }, (resp) => {
    renderSavedScenarios(resp?.scenarios || []);
  });
}

function renderSavedScenarios(scenarios) {
  if (scenarios.length === 0) {
    savedList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💾</div>
        <p class="empty-title">No Saved Scenarios</p>
        <p class="empty-desc">Record and generate Gherkin, then click <strong>Save</strong> to store scenarios here.</p>
      </div>`;
    return;
  }

  savedList.innerHTML = '';
  [...scenarios].reverse().forEach(scenario => {
    const item = document.createElement('div');
    item.className = 'saved-item';

    const date = new Date(scenario.savedAt);
    const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    item.innerHTML = `
      <div class="saved-item-info">
        <div class="saved-item-name" title="${escapeHtml(scenario.featureName)} / ${escapeHtml(scenario.scenarioName)}">
          ${escapeHtml(scenario.scenarioName)}
        </div>
        <div class="saved-item-meta">
          📋 ${scenario.stepCount} steps &nbsp;·&nbsp; ${dateStr}
          ${scenario.tags ? ` &nbsp;·&nbsp; ${escapeHtml(scenario.tags)}` : ''}
        </div>
      </div>
      <div class="saved-item-actions">
        <button class="action-btn" data-action="load" title="Load into editor">📂</button>
        <button class="action-btn" data-action="copy" title="Copy Gherkin">📋</button>
        <button class="action-btn" data-action="download" title="Download .feature">💾</button>
        <button class="action-btn" data-action="delete" title="Delete">🗑</button>
      </div>
    `;

    item.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => handleSavedAction(btn.dataset.action, scenario));
    });

    savedList.appendChild(item);
  });
}

function handleSavedAction(action, scenario) {
  switch (action) {
    case 'load':
      steps = [...scenario.steps];
      featureName.value  = scenario.featureName;
      scenarioName.value = scenario.scenarioName;
      tagsInput.value    = scenario.tags || '';
      renderSteps();
      updateStepCount();
      updateGherkin();
      switchTab('record');
      showToast(`Loaded "${scenario.scenarioName}"`, 'success');
      break;

    case 'copy':
      navigator.clipboard.writeText(scenario.gherkin).then(() => {
        showToast('Copied!', 'success');
      }).catch(() => showToast('Copy failed', 'error'));
      break;

    case 'download': {
      const filename = `${sanitizeFilename(scenario.scenarioName)}.feature`;
      const blob = new Blob([scenario.gherkin], { type: 'text/plain' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
      showToast(`Downloaded ${filename}`, 'success');
      break;
    }

    case 'delete':
      if (!confirm(`Delete "${scenario.scenarioName}"?`)) return;
      chrome.runtime.sendMessage({ type: 'DELETE_SCENARIO', id: scenario.id }, (resp) => {
        renderSavedScenarios(resp?.scenarios || []);
        showToast('Scenario deleted', 'info');
      });
      break;
  }
}

function exportAllScenarios() {
  chrome.runtime.sendMessage({ type: 'GET_SCENARIOS' }, (resp) => {
    const scenarios = resp?.scenarios || [];
    if (scenarios.length === 0) { showToast('No saved scenarios to export', 'error'); return; }

    const combined = scenarios.map(s => s.gherkin).join('\n\n# ─────────────────\n\n');
    const blob = new Blob([combined], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'all-scenarios.feature'; a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${scenarios.length} scenarios`, 'success');
  });
}

// ===========================================================
//  TAB SWITCHING
// ===========================================================
function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
  document.querySelectorAll('.tab-panel').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${tabName}`);
    p.style.display = p.id === `tab-${tabName}` ? 'flex' : 'none';
  });

  if (tabName === 'gherkin')  updateGherkin();
  if (tabName === 'saved')    loadSavedScenarios();
}

// Initialize correct tab display
document.querySelectorAll('.tab-panel').forEach(p => {
  p.style.display = p.classList.contains('active') ? 'flex' : 'none';
});

// ===========================================================
//  TOAST NOTIFICATIONS
// ===========================================================
let toastTimeout;
function showToast(msg, type = 'success') {
  toast.textContent = msg;
  toast.className   = `toast ${type} show`;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 2400);
}

// ===========================================================
//  VIDEO RECORDING
// ===========================================================

/** Main handler for the Video button — toggles start/pause/stop */
function handleVideoButton() {
  if (isVideoProcessing) return; // wait for encoding

  if (!isVideoRecording) {
    // START
    startVideoRecording();
  } else if (!isVideoPaused) {
    // PAUSE
    chrome.runtime.sendMessage({ type: 'PAUSE_VIDEO_RECORDING' }, (resp) => {
      if (resp && resp.success) {
        isVideoPaused = true;
        updateVideoUI();
        showToast('Video paused', 'info');
      }
    });
  } else {
    // RESUME
    chrome.runtime.sendMessage({ type: 'RESUME_VIDEO_RECORDING' }, (resp) => {
      if (resp && resp.success) {
        isVideoPaused = false;
        updateVideoUI();
        showToast('Video resumed', 'success');
      }
    });
  }
}

function startVideoRecording() {
  // Hide any stale preview
  if (videoPreviewPanel) videoPreviewPanel.style.display = 'none';
  videoDataUrl = null;

  btnVideo.disabled = true;
  videoBtnLabel.textContent = '...';

  chrome.runtime.sendMessage({ type: 'START_VIDEO_RECORDING' }, (resp) => {
    btnVideo.disabled = false;
    if (resp && resp.success) {
      isVideoRecording  = true;
      isVideoPaused     = false;
      isVideoProcessing = false;
      updateVideoUI();
      showToast('🔴 Video recording started!', 'success');
    } else {
      const err = resp ? resp.error : 'Unknown error';
      showToast('Video error: ' + err, 'error');
      videoBtnLabel.textContent = 'Video';
      btnVideo.className = 'ctrl-btn video-btn';
    }
  });
}

function stopVideoRecording() {
  chrome.runtime.sendMessage({ type: 'STOP_VIDEO_RECORDING' }, (resp) => {
    if (resp && resp.success) {
      isVideoRecording  = false;
      isVideoProcessing = true; // show "processing" state while encoding
      updateVideoUI();
      showToast('⏳ Processing video...', 'info');
    }
  });
}

/** Update video button appearance + badge based on current state */
function updateVideoUI() {
  if (!btnVideo) return;

  if (isVideoProcessing) {
    btnVideo.className           = 'ctrl-btn video-btn processing';
    videoBtnLabel.textContent    = 'Processing…';
    btnVideo.disabled            = true;
    if (videoBadge) videoBadge.style.display = 'none';
    return;
  }

  btnVideo.disabled = false;

  if (!isVideoRecording) {
    // Idle — show normal state
    btnVideo.className        = 'ctrl-btn video-btn';
    videoBtnLabel.textContent = 'Video';
    if (videoBadge) videoBadge.style.display = 'none';
  } else if (isVideoPaused) {
    // Paused — show resume option
    btnVideo.className        = 'ctrl-btn video-btn recording';
    videoBtnLabel.textContent = 'Resume';
    if (videoBadge) {
      videoBadge.style.display = 'flex';
      videoBadge.querySelector('.video-chip').textContent = '⏸ VIDEO PAUSED';
    }
  } else {
    // Recording — show stop option. Button click pauses first, long-press stops.
    // We keep it simple: click = pause, a "Stop Video" button appears in badge
    btnVideo.className        = 'ctrl-btn video-btn recording';
    videoBtnLabel.textContent = 'Pause';
    if (videoBadge) {
      videoBadge.style.display = 'flex';
      videoBadge.querySelector('.video-chip').textContent = '⏺ REC VIDEO';

      // Make badge clickable to stop the recording
      videoBadge.onclick = null;
      videoBadge.style.cursor = 'pointer';
      videoBadge.title = 'Click to stop video recording';
      videoBadge.onclick = () => {
        if (confirm('Stop video recording and save the video?')) {
          stopVideoRecording();
        }
      };
    }
  }
}

/** Render the video preview panel with player + download/discard */
function showVideoPreview(dataUrl, byteSize) {
  if (!videoPreviewPanel || !videoPlayer) return;

  // Set video source
  videoPlayer.src = dataUrl;

  // Show size label
  const sizeLabel = $('videoSizeLabel');
  if (sizeLabel && byteSize) {
    const mb = (byteSize / (1024 * 1024)).toFixed(1);
    sizeLabel.textContent = mb + ' MB';
  }

  // Wire up buttons (remove old listeners by cloning)
  const oldDl      = $('btnVideoDownload');
  const oldDiscard = $('btnVideoDiscard');
  const newDl      = oldDl.cloneNode(true);
  const newDiscard = oldDiscard.cloneNode(true);
  oldDl.parentNode.replaceChild(newDl, oldDl);
  oldDiscard.parentNode.replaceChild(newDiscard, oldDiscard);

  $('btnVideoDownload').addEventListener('click', downloadVideo);
  $('btnVideoDiscard').addEventListener('click', () => {
    videoPreviewPanel.style.display = 'none';
    videoPlayer.src = '';
    videoDataUrl    = null;
  });

  videoPreviewPanel.style.display = 'block';
}

function downloadVideo() {
  if (!videoDataUrl) { showToast('No video to download', 'error'); return; }
  const name = sanitizeFilename(
    (typeof scenarioName !== 'undefined' && scenarioName.value)
      ? scenarioName.value
      : 'recording'
  );
  const ext = videoDataUrl.includes('video/mp4') ? 'mp4' : 'webm';
  const a   = document.createElement('a');
  a.href     = videoDataUrl;
  a.download = `${name}-${Date.now()}.${ext}`;
  a.click();
  showToast('Video downloaded!', 'success');
}

// ===========================================================
//  UTILS
// ===========================================================
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase().slice(0, 50) || 'scenario';
}
