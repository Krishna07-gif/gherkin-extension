// popup.js — UI Controller v3 (all bugs fixed)
'use strict';

// ── State ─────────────────────────────────────────────────────
let steps = [], isRecording = false, isPaused = false, startTime = null;
let timerInterval = null, editingIndex = null;
let isVideoRecording = false, isVideoPaused = false, isVideoProcessing = false, videoDataUrl = null;
let isDark = true, dragSrcIndex = null;
let runnerResults = [], runnerTabId = null;

const DEFAULT_SETTINGS = { screenshots: true, scrolls: false, hotkeys: false, rightClick: true, maskPass: true, debounce: 1200 };
let currentSettings = { ...DEFAULT_SETTINGS };

const $ = id => document.getElementById(id);
const statusOrb = $('statusOrb'), statusPill = $('statusPill');
const btnStart = $('btnStart'), orbIcon = $('orbIcon'), orbLabel = $('orbLabel'), orbRing = $('orbRing');
const btnPause = $('btnPause'), btnStop = $('btnStop'), btnClear = $('btnClear');
const stepCountLabel = $('stepCountLabel'), timerLabel = $('timerLabel');
const pausedBadge = $('pausedBadge');
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
  await loadSettings();   // ← MUST happen before loadState
  await loadState();
  bindEvents();
  loadSavedScenarios();
  updateExportOutput();
});

// ── Load Settings (populates checkboxes) ──────────────────────
async function loadSettings() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, resp => {
      if (resp?.settings) currentSettings = { ...DEFAULT_SETTINGS, ...resp.settings };
      applySettingsToUI(currentSettings);
      resolve();
    });
  });
}

function applySettingsToUI(s) {
  const set = (id, val) => { const el = $(id); if (el) el.checked = val !== false; };
  set('settingScreenshots', s.screenshots);
  set('settingScrolls',     s.scrolls);
  set('settingHotkeys',     s.hotkeys);
  set('settingMaskPass',    s.maskPass);
  set('settingRightClick',  s.rightClick);
  const slider = $('settingDebounce'), label = $('debounceLabel');
  if (slider) { slider.value = s.debounce || 1200; }
  if (label)  { label.textContent = ((s.debounce||1200)/1000).toFixed(1) + 's'; }
}

function saveSettings() {
  currentSettings = {
    screenshots: $('settingScreenshots')?.checked ?? true,
    scrolls:     $('settingScrolls')?.checked     ?? false,
    hotkeys:     $('settingHotkeys')?.checked      ?? false,
    maskPass:    $('settingMaskPass')?.checked     ?? true,
    rightClick:  $('settingRightClick')?.checked   ?? true,
    debounce:    parseInt($('settingDebounce')?.value || '1200', 10)
  };
  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: currentSettings });
}

// ── Load State ────────────────────────────────────────────────
async function loadState() {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, resp => {
      if (chrome.runtime.lastError || !resp) { resolve(); return; }
      steps = resp.steps || []; isRecording = resp.isRecording || false;
      isPaused = resp.isPaused || false; startTime = resp.startTime || null;
      isVideoRecording = resp.isVideoRecording || false; isVideoPaused = resp.isVideoPaused || false;

      renderSteps(); updateUIState(); updateVideoUI(); updateGherkin();
      if (isRecording && startTime) startTimer();

      // Restore pending video that arrived while popup was closed
      if (resp.pendingVideoData?.dataUrl) {
        videoDataUrl = resp.pendingVideoData.dataUrl;
        showVideoPreview(resp.pendingVideoData.dataUrl, resp.pendingVideoData.size);
        chrome.runtime.sendMessage({ type: 'CLEAR_PENDING_VIDEO' });
      }
      resolve();
    });
  });
}

// ── Real-time updates ─────────────────────────────────────────
chrome.runtime.onMessage.addListener(msg => {
  // ── Background runner progress updates ───────────────────
  if (msg.type === 'RUNNER_UPDATE') {
    const { event } = msg;
    if (event === 'step_start') {
      addRunRow(msg.index, steps[msg.index], 'running', null, null);
    } else if (event === 'step_result') {
      const step = steps[msg.index];
      if (!document.getElementById('run-row-' + msg.index)) addRunRow(msg.index, step, msg.status, msg.time, msg.error);
      else updateRunRow(msg.index, msg.status, msg.time, msg.error);
      runnerResults[msg.index] = { step, status: msg.status, time: msg.time, error: msg.error };
    } else if (event === 'stats') {
      updateRunStats(msg.pass, msg.fail, msg.skip, msg.total);
    } else if (event === 'done') {
      showToast('Done: ✅' + msg.pass + ' ❌' + msg.fail, msg.pass >= msg.fail ? 'success' : 'error');
      $('btnRunScenario').disabled = false;
      $('btnRunScenario').textContent = '▶ Run';
      $('btnDownloadReport').style.display = 'inline-flex';
      $('runInfo').style.display = 'block';
      $('runProgress').style.display = 'none';
    } else if (event === 'error') {
      showToast('Runner error: ' + msg.error, 'error');
      $('btnRunScenario').disabled = false;
      $('btnRunScenario').textContent = '▶ Run';
      $('runInfo').style.display = 'block';
      $('runProgress').style.display = 'none';
    }
    return;
  }
  if (msg.type === 'STATE_UPDATE') {
    const prev = steps.length; steps = msg.steps || [];
    isRecording = msg.isRecording; isPaused = msg.isPaused;
    isVideoRecording = msg.isVideoRecording || false; isVideoPaused = msg.isVideoPaused || false;
    if (steps.length !== prev) renderSteps();
    updateStepCount(); updateGherkin(); updateVideoUI();
  }
  if (msg.type === 'VIDEO_READY') {
    isVideoRecording = false; isVideoProcessing = false; videoDataUrl = msg.dataUrl;
    updateVideoUI(); showVideoPreview(msg.dataUrl, msg.size);
    showToast('✅ Video ready — click Download', 'success');
  }
});

// ── Bind Events ───────────────────────────────────────────────
function bindEvents() {
  btnStart.addEventListener('click', handleOrbClick);
  btnPause.addEventListener('click', pauseRecording);
  btnStop.addEventListener('click', stopRecording);
  btnClear.addEventListener('click', clearSteps);
  if (btnVideo) btnVideo.addEventListener('click', handleVideoButton);
  $('btnTheme').addEventListener('click', toggleTheme);

  // Tabs
  document.querySelectorAll('.tab-item').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

  // Gherkin
  $('btnRefresh').addEventListener('click', updateGherkin);
  $('btnCopy').addEventListener('click', copyGherkin);
  $('btnDownload').addEventListener('click', downloadGherkin);
  $('btnSaveScenario').addEventListener('click', saveScenario);
  [featureName, scenarioName, tagsInput].forEach(el => el.addEventListener('input', updateGherkin));
  $('optDedupe').addEventListener('change', updateGherkin);
  $('optSmartNav').addEventListener('change', updateGherkin);

  // Export
  $('exportFormat').addEventListener('change', updateExportOutput);
  $('btnExportRefresh').addEventListener('click', updateExportOutput);
  $('btnExportCopy').addEventListener('click', copyExport);
  $('btnExportDownload').addEventListener('click', downloadExport);

  // Record toolbar
  stepSearch.addEventListener('input', () => renderSteps(stepSearch.value));
  $('btnAddAssert').addEventListener('click', () => { $('assertModal').classList.add('open'); $('assertValue').focus(); });

  // Modals
  $('modalClose').addEventListener('click', closeEditModal);
  $('modalCancel').addEventListener('click', closeEditModal);
  $('modalSave').addEventListener('click', saveEditStep);
  $('editModal').addEventListener('click', e => { if (e.target===$('editModal')) closeEditModal(); });
  $('assertModalClose').addEventListener('click', () => $('assertModal').classList.remove('open'));
  $('assertModalCancel').addEventListener('click', () => $('assertModal').classList.remove('open'));
  $('assertModalSave').addEventListener('click', addManualAssert);
  $('assertModal').addEventListener('click', e => { if (e.target===$('assertModal')) $('assertModal').classList.remove('open'); });
  $('assertValue').addEventListener('keydown', e => { if (e.key==='Enter') addManualAssert(); });
  $('screenshotModalClose').addEventListener('click', () => $('screenshotModal').classList.remove('open'));
  $('screenshotModal').addEventListener('click', e => { if (e.target===$('screenshotModal')) $('screenshotModal').classList.remove('open'); });

  // Saved
  $('btnExportAll').addEventListener('click', exportAllScenarios);

  // Runner
  $('btnRunScenario').addEventListener('click', runScenario);
  $('btnDownloadReport').addEventListener('click', downloadReport);

  // Settings — save immediately on any change
  ['settingScreenshots','settingScrolls','settingHotkeys','settingMaskPass','settingRightClick'].forEach(id => {
    const el = $(id); if (el) el.addEventListener('change', saveSettings);
  });
  const debounceSlider = $('settingDebounce');
  if (debounceSlider) {
    debounceSlider.addEventListener('input', () => {
      const lbl = $('debounceLabel'); if (lbl) lbl.textContent = (debounceSlider.value/1000).toFixed(1)+'s';
    });
    debounceSlider.addEventListener('change', saveSettings);
  }

  $('btnClearAll').addEventListener('click', () => {
    if (!confirm('Delete all saved scenarios?')) return;
    chrome.storage.local.set({ scenarios: [] }, () => { loadSavedScenarios(); showToast('Cleared', 'info'); });
  });

  // Popup keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
    if (e.key==='r'&&!isRecording) handleOrbClick();
    if (e.key==='s'&&isRecording)  stopRecording();
    if (e.key==='p'&&isRecording)  pauseRecording();
  });
}

// ── Orb: toggles Start / Stop ─────────────────────────────────
function handleOrbClick() { if (!isRecording) startRecording(); else stopRecording(); }

// ── Recording ─────────────────────────────────────────────────
function startRecording() {
  chrome.runtime.sendMessage({ type: 'START_RECORDING' }, () => {
    isRecording = true; isPaused = false; startTime = Date.now(); steps = [];
    renderSteps(); updateUIState(); startTimer();
    showToast('🔴 Recording started!', 'success'); switchTab('record');
  });
}
function pauseRecording() {
  chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' }, resp => {
    if (!resp) return; isPaused = resp.isPaused; updateUIState();
    showToast(isPaused ? '⏸ Paused' : '▶ Resumed', 'info');
    if (isPaused) clearInterval(timerInterval); else startTimer();
  });
}
function stopRecording() {
  chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, resp => {
    isRecording = false; isPaused = false;
    if (resp) steps = resp.steps || steps;
    stopTimer(); updateUIState(); renderSteps(); updateGherkin();
    showToast(`⏹ Stopped — ${steps.length} steps`, 'success');
    if (steps.length > 0) setTimeout(() => switchTab('gherkin'), 600);
  });
}
function clearSteps() {
  if (steps.length > 0 && !confirm('Clear all steps?')) return;
  chrome.runtime.sendMessage({ type: 'CLEAR_STEPS' }, () => {
    steps = []; if (!isRecording) startTime = null; else startTime = Date.now();
    renderSteps(); updateStepCount(); updateGherkin(); showToast('Cleared','info');
  });
}

// ── Timer ─────────────────────────────────────────────────────
function startTimer() { clearInterval(timerInterval); timerInterval = setInterval(updateTimer,1000); updateTimer(); }
function stopTimer()  { clearInterval(timerInterval); timerInterval = null; }
function updateTimer() {
  if (!startTime) { timerLabel.textContent='00:00'; return; }
  const s = Math.floor((Date.now()-startTime)/1000);
  timerLabel.textContent = `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}

// ── UI State ──────────────────────────────────────────────────
function updateUIState() {
  btnPause.disabled = !isRecording; btnStop.disabled = !isRecording;
  btnPause.querySelector('span:last-child').textContent = isPaused ? 'Resume' : 'Pause';
  if (isRecording && !isPaused) {
    orbIcon.textContent='⏹'; orbLabel.textContent='Click to Stop'; orbRing.className='orb-ring recording';
  } else if (isPaused) {
    orbIcon.textContent='▶'; orbLabel.textContent='Click to Stop'; orbRing.className='orb-ring';
  } else {
    orbIcon.textContent='⏺'; orbLabel.textContent='Click to Record'; orbRing.className='orb-ring idle';
  }
  statusOrb.className='brand-orb'; statusPill.className='status-pill';
  if (isRecording&&!isPaused) { statusOrb.classList.add('recording'); statusPill.classList.add('recording'); statusPill.textContent='REC'; }
  else if (isPaused)          { statusOrb.classList.add('paused');    statusPill.classList.add('paused');    statusPill.textContent='PAUSED'; }
  else if (steps.length>0)   { statusOrb.classList.add('done');      statusPill.classList.add('done');      statusPill.textContent='DONE'; }
  else                        { statusPill.textContent='IDLE'; }
  pausedBadge.style.display = isPaused ? 'flex' : 'none';
  updateStepCount();
}
function updateStepCount() {
  const n = steps.length;
  stepCountLabel.textContent = n===0?'0 steps':n===1?'1 step':`${n} steps`;
}

// ── Render Steps (with drag-reorder) ──────────────────────────
function renderSteps(filter = '') {
  const fl = filter.toLowerCase();
  const filtered = filter ? steps.filter(s => getStepSummary(s).toLowerCase().includes(fl)) : steps;
  if (steps.length === 0) { stepsList.innerHTML = `<div class="empty-state"><div class="empty-icon">🎬</div><p class="empty-title">Ready to Record</p><p class="empty-desc">Click the orb above then interact with any web page.</p></div>`; return; }
  if (filtered.length === 0) { stepsList.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p class="empty-title">No matches</p><p class="empty-desc">No steps match "${escHtml(filter)}"</p></div>`; return; }
  const frag = document.createDocumentFragment();
  filtered.forEach((step, di) => { const ri = steps.indexOf(step); frag.appendChild(buildStepCard(step, ri, di+1)); });
  stepsList.innerHTML = '';
  stepsList.appendChild(frag);
  if (isRecording && !filter) stepsList.scrollTop = stepsList.scrollHeight;
}

function buildStepCard(step, ri, dn) {
  const card = document.createElement('div');
  card.className = 'step-card'; card.dataset.index = ri; card.draggable = true;
  const pillCls = { navigate:'pill-nav',click:'pill-click',input:'pill-input',select:'pill-select',
                    checkbox:'pill-checkbox',submit:'pill-submit',assert:'pill-assert',
                    scroll:'pill-scroll',dragdrop:'pill-dragdrop',hotkey:'pill-hotkey',
                    radio:'pill-checkbox',paste:'pill-input',file:'pill-input' }[step.type]||'pill-default';
  const badgeCls = { navigate:'navigate',click:'click',input:'input',select:'select',
                     checkbox:'checkbox',submit:'submit',assert:'assert',scroll:'scroll',
                     hotkey:'hotkey',dragdrop:'dragdrop',paste:'input',radio:'checkbox',file:'input' }[step.type]||'default';
  const badgeLabel = { navigate:'NAV',click:'CLICK',input:'INPUT',select:'SELECT',checkbox:'CHECK',
                        submit:'SUBMIT',assert:'ASSERT',scroll:'SCROLL',hotkey:'KEY',
                        dragdrop:'DRAG',paste:'PASTE',radio:'RADIO',file:'FILE' }[step.type]||step.type.toUpperCase();
  const timing = (() => {
    if (ri===0||!step.timestamp) return '';
    const prev = steps[ri-1]; if (!prev?.timestamp) return '';
    const d = step.timestamp - prev.timestamp; if (d<500) return '';
    return `<span class="step-time">${d<60000?`+${(d/1000).toFixed(1)}s`:`+${Math.floor(d/60000)}m${String(Math.floor((d%60000)/1000)).padStart(2,'0')}s`}</span>`;
  })();
  const thumbHtml = step.screenshot ? `<img class="step-screenshot" src="${step.screenshot}" title="Click to enlarge" />` : '';

  card.innerHTML = `
    <div class="drag-handle" title="Drag to reorder">⠿</div>
    <div class="step-num">${dn}</div>
    <div class="step-icon-pill ${pillCls}">${getStepIcon(step)}</div>
    <div class="step-content">
      <div class="step-summary">${escHtml(getStepSummary(step))}</div>
      <div class="step-meta-row"><span class="step-type-badge badge-${badgeCls}">${badgeLabel}</span>${timing}</div>
    </div>
    ${thumbHtml}
    <div class="step-actions">
      <button class="step-act-btn" title="Copy as Gherkin">📋</button>
      <button class="step-act-btn dup-btn" title="Duplicate">⧉</button>
      <button class="step-act-btn edit-btn" title="Edit">✏️</button>
      <button class="step-act-btn del" title="Delete">🗑</button>
    </div>`;

  // Drag events
  card.addEventListener('dragstart', e => { dragSrcIndex=ri; card.classList.add('dragging'); e.dataTransfer.effectAllowed='move'; });
  card.addEventListener('dragend',   () => { dragSrcIndex=null; card.classList.remove('dragging'); document.querySelectorAll('.drag-over').forEach(c=>c.classList.remove('drag-over')); });
  card.addEventListener('dragover',  e => { e.preventDefault(); card.classList.add('drag-over'); });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', e => {
    e.preventDefault(); card.classList.remove('drag-over');
    if (dragSrcIndex!==null && dragSrcIndex!==ri) {
      chrome.runtime.sendMessage({ type:'REORDER_STEP', from:dragSrcIndex, to:ri }, resp => {
        if (resp?.success) { steps=resp.steps; renderSteps(stepSearch.value); updateGherkin(); }
      });
    }
  });

  if (step.screenshot) card.querySelector('.step-screenshot').addEventListener('click', e => { e.stopPropagation(); openScreenshotModal(step.screenshot, getStepSummary(step)); });
  card.querySelectorAll('.step-act-btn')[0].addEventListener('click', e => { e.stopPropagation(); const r=stepToGherkin(step,ri,ri>0?'When':null); if(r) navigator.clipboard.writeText(`    ${r.line}`).then(()=>showToast('Copied','success')); });
  card.querySelector('.dup-btn').addEventListener('click', e => { e.stopPropagation(); chrome.runtime.sendMessage({type:'DUPLICATE_STEP',index:ri}, resp=>{ if(resp?.success){steps=resp.steps;renderSteps(stepSearch.value);updateGherkin();showToast('Duplicated','success');} }); });
  card.querySelector('.edit-btn').addEventListener('click', e => { e.stopPropagation(); openEditModal(ri); });
  card.querySelector('.del').addEventListener('click', e => { e.stopPropagation(); deleteStep(ri, card); });
  return card;
}

function openScreenshotModal(src, title) {
  $('screenshotImg').src = src;
  $('screenshotModalTitle').textContent = title || 'Step Screenshot';
  $('screenshotModal').classList.add('open');
}

function deleteStep(index, el) {
  el.style.opacity='0'; el.style.transform='translateX(16px)'; el.style.transition='all 200ms ease';
  setTimeout(() => {
    chrome.runtime.sendMessage({ type:'DELETE_STEP', index }, resp => {
      if (resp?.success) { steps=resp.steps; renderSteps(stepSearch.value); updateStepCount(); updateGherkin(); }
    });
  }, 200);
}

// ── Edit Modal ────────────────────────────────────────────────
function openEditModal(index) {
  editingIndex = index; const step = steps[index];
  $('editLabel').value = step.label || step.url || '';
  $('editValue').value = step.value || '';
  $('editType').value  = step.type  || 'click';
  $('editValueRow').style.display = step.type==='navigate' ? 'none' : '';
  $('editModal').classList.add('open'); $('editLabel').focus();
}
function closeEditModal() { $('editModal').classList.remove('open'); editingIndex=null; }
function saveEditStep() {
  if (editingIndex===null) return;
  const updates = { label:$('editLabel').value.trim(), type:$('editType').value };
  if ($('editValue').value.trim()) updates.value = $('editValue').value.trim();
  if (updates.type==='navigate') { updates.url=updates.label; delete updates.label; }
  chrome.runtime.sendMessage({ type:'UPDATE_STEP', index:editingIndex, updates }, resp => {
    if (resp?.success) { steps=resp.steps; renderSteps(stepSearch.value); updateGherkin(); showToast('Updated','success'); }
  });
  closeEditModal();
}

// ── Manual Assert ─────────────────────────────────────────────
function addManualAssert() {
  const type=$('assertType').value, val=$('assertValue').value.trim();
  if (!val) { showToast('Enter a value','error'); return; }
  const labels = {
    see_text:`Then I should see "${val}"`, see_element:`Then I should see the "${val}" element`,
    not_see:`Then I should not see "${val}"`, url_contains:`Then the URL should contain "${val}"`,
    title_is:`Then the page title should be "${val}"`,
    element_enabled:`Then the "${val}" element should be enabled`,
    element_disabled:`Then the "${val}" element should be disabled`,
    count:`Then there should be "${val}" elements`,
  };
  const step = { type:'assert', elementType:'assertion', assertType:type, label:val, value:val, gherkinOverride:labels[type], timestamp:Date.now() };
  chrome.runtime.sendMessage({ type:'RECORD_ACTION', action:step }, () => {
    chrome.runtime.sendMessage({ type:'GET_STATE' }, s => {
      if (s) steps = s.steps || steps;
      renderSteps(); updateStepCount(); updateGherkin();
    });
  });
  $('assertModal').classList.remove('open'); $('assertValue').value='';
  showToast('Assertion added','success');
}

// ── Gherkin ───────────────────────────────────────────────────
function updateGherkin() {
  let ws = [...steps];
  if ($('optDedupe').checked) ws = deduplicateSteps(ws);
  if (ws.length === 0) { gherkinOutput.innerHTML=`<span class="muted">Start recording to generate Gherkin…</span>`; return; }
  gherkinOutput.innerHTML = syntaxHL(buildGherkinText(ws, featureName.value.trim()||'My Feature', scenarioName.value.trim()||'My Scenario', tagsInput.value.trim()));
}

function buildGherkinText(steps, feat, scen, tags) {
  const lines = []; if (tags) lines.push(tags);
  lines.push(`Feature: ${feat}`,'');
  const fn = steps.find(s=>s.type==='navigate');
  if (fn) { lines.push(`  # URL: ${fn.url}`,`  # Steps: ${steps.length}`,''); }
  lines.push(`  Scenario: ${scen}`);
  let prevKw=null, idx=0;
  for (const step of steps) {
    if (step.gherkinOverride) { lines.push(`    ${step.gherkinOverride}`); prevKw='Then'; idx++; continue; }
    const r = stepToGherkin(step, idx, prevKw);
    if (!r) continue; lines.push(`    ${r.line}`); prevKw=r.keyword; idx++;
  }
  if (prevKw==='When') lines.push(`    Then I verify the page state`);
  lines.push(''); return lines.join('\n');
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

function getRawGherkin() {
  let ws=[...steps]; if($('optDedupe').checked) ws=deduplicateSteps(ws);
  return buildGherkinText(ws, featureName.value.trim()||'My Feature', scenarioName.value.trim()||'My Scenario', tagsInput.value.trim());
}
function copyGherkin() {
  if (!steps.length) { showToast('Nothing to copy','error'); return; }
  navigator.clipboard.writeText(getRawGherkin()).then(()=>showToast('Copied!','success')).catch(()=>showToast('Failed','error'));
}
function downloadGherkin() {
  if (!steps.length) { showToast('No steps','error'); return; }
  downloadText(getRawGherkin(), sanitize(scenarioName.value||'scenario')+'.feature','text/plain');
  showToast('Downloaded','success');
}

// ── Export ────────────────────────────────────────────────────
function updateExportOutput() {
  const fmt=$('exportFormat').value, feat=featureName.value.trim()||'My Feature', scen=scenarioName.value.trim()||'My Scenario', tags=tagsInput.value.trim();
  const titles={playwright:'Playwright (TypeScript)',cypress:'Cypress',selenium:'Selenium (Python)',json:'JSON'};
  $('exportOutputTitle').textContent = titles[fmt]||fmt;
  let ws=[...steps]; if($('optDedupe')?.checked) ws=deduplicateSteps(ws);
  if (!ws.length) { $('exportOutput').innerHTML=`<span class="muted">Record some steps first…</span>`; $('varHints').style.display='none'; return; }
  let code = fmt==='playwright'?generatePlaywright(ws,scen):fmt==='cypress'?generateCypress(ws,scen):fmt==='selenium'?generateSelenium(ws,scen):generateJSON(ws,feat,scen,tags);
  $('exportOutput').textContent = code;
  const vars = detectVariables(ws);
  if (vars.length) {
    $('varHints').style.display='block';
    $('varHintsList').innerHTML = vars.slice(0,5).map(v=>`<div class="var-hint-item"><span>Step ${v.index+1} — ${v.type}</span><span class="var-hint-val">${escHtml(v.value.slice(0,30))}</span><span class="var-hint-action" onclick="markAsVariable(${v.index})">→ {{var}}</span></div>`).join('');
  } else $('varHints').style.display='none';
}
function copyExport()  { const t=$('exportOutput').textContent; if(!t||!steps.length){showToast('Nothing','error');return;} navigator.clipboard.writeText(t).then(()=>showToast('Copied!','success')); }
function downloadExport() {
  const fmt=$('exportFormat').value, text=$('exportOutput').textContent;
  if (!text||!steps.length){showToast('Nothing','error');return;}
  const exts={playwright:'spec.ts',cypress:'cy.js',selenium:'test.py',json:'json'};
  const mimes={playwright:'text/typescript',cypress:'text/javascript',selenium:'text/x-python',json:'application/json'};
  downloadText(text, sanitize(scenarioName.value||'scenario')+'.'+(exts[fmt]||'txt'), mimes[fmt]||'text/plain');
  showToast('Downloaded','success');
}
window.markAsVariable = function(index) {
  if (!steps[index]) return;
  const newVal = `{{${steps[index].type}_${index+1}}}`;
  chrome.runtime.sendMessage({ type:'UPDATE_STEP', index, updates:{ value:newVal } }, resp => {
    if (resp?.success) { steps=resp.steps; updateExportOutput(); updateGherkin(); showToast('Marked as variable','success'); }
  });
};

// ── Saved Scenarios ───────────────────────────────────────────
function saveScenario() {
  if (!steps.length) { showToast('No steps','error'); return; }
  const sc = { featureName:featureName.value.trim()||'My Feature', scenarioName:scenarioName.value.trim()||'My Scenario', tags:tagsInput.value.trim(), steps:[...steps], stepCount:steps.length, gherkin:getRawGherkin(), savedAt:Date.now() };
  chrome.runtime.sendMessage({ type:'SAVE_SCENARIO', scenario:sc }, () => { showToast(`Saved: "${sc.scenarioName}"`, 'success'); loadSavedScenarios(); });
}
function loadSavedScenarios() { chrome.runtime.sendMessage({ type:'GET_SCENARIOS' }, resp => renderSavedScenarios(resp?.scenarios||[])); }
function renderSavedScenarios(scenarios) {
  if (!scenarios.length) { savedList.innerHTML=`<div class="empty-state"><div class="empty-icon">💾</div><p class="empty-title">No Saved Scenarios</p><p class="empty-desc">Record and save scenarios here.</p></div>`; return; }
  savedList.innerHTML='';
  [...scenarios].reverse().forEach(sc => {
    const item=document.createElement('div'); item.className='saved-card';
    const d=new Date(sc.savedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
    item.innerHTML=`<div class="saved-card-info"><div class="saved-card-name">${escHtml(sc.scenarioName)}</div><div class="saved-card-meta">📋 ${sc.stepCount} steps · ${d}${sc.tags?' · '+escHtml(sc.tags):''}</div></div><div class="saved-card-actions"><button class="step-act-btn" data-a="load" title="Load">📂</button><button class="step-act-btn" data-a="copy" title="Copy">📋</button><button class="step-act-btn" data-a="download" title="Download">💾</button><button class="step-act-btn del" data-a="delete" title="Delete">🗑</button></div>`;
    item.querySelectorAll('[data-a]').forEach(btn=>btn.addEventListener('click',()=>handleSavedAction(btn.dataset.a,sc)));
    savedList.appendChild(item);
  });
}
function handleSavedAction(action, sc) {
  if (action==='load') { steps=[...sc.steps];featureName.value=sc.featureName;scenarioName.value=sc.scenarioName;tagsInput.value=sc.tags||'';renderSteps();updateStepCount();updateGherkin();switchTab('record');showToast(`Loaded "${sc.scenarioName}"`, 'success'); }
  if (action==='copy') navigator.clipboard.writeText(sc.gherkin).then(()=>showToast('Copied','success')).catch(()=>{});
  if (action==='download') { downloadText(sc.gherkin, sanitize(sc.scenarioName)+'.feature', 'text/plain'); showToast('Downloaded','success'); }
  if (action==='delete') { if(!confirm(`Delete "${sc.scenarioName}"?`))return; chrome.runtime.sendMessage({type:'DELETE_SCENARIO',id:sc.id},resp=>{renderSavedScenarios(resp?.scenarios||[]);showToast('Deleted','info');}); }
}
function exportAllScenarios() {
  chrome.runtime.sendMessage({type:'GET_SCENARIOS'}, resp => {
    const sc=resp?.scenarios||[]; if(!sc.length){showToast('No scenarios','error');return;}
    downloadText(sc.map(s=>s.gherkin).join('\n\n# ──────────────\n\n'),'all-scenarios.feature','text/plain');
    showToast(`Exported ${sc.length} scenarios`,'success');
  });
}

// ═══════════════════════════════════════════════════════════════
//  SCRIPT RUNNER
// ═══════════════════════════════════════════════════════════════

function runScenario() {
  if (!steps.length) { showToast('No steps to run','error'); return; }
  const navStep = steps.find(s => s.type==='navigate');
  if (!navStep) { showToast('No navigation step found — cannot start','error'); return; }

  runnerResults = [];
  $('runProgress').style.display = 'block';
  $('runInfo').style.display     = 'none';
  $('btnRunScenario').disabled   = true;
  $('btnRunScenario').textContent = '⏳ Running…';
  $('btnDownloadReport').style.display = 'none';
  $('runStepsList').innerHTML    = '';
  updateRunStats(0,0,0,steps.length);

  // Delegate ALL execution to background.js service worker (stays alive when popup loses focus)
  chrome.runtime.sendMessage({ type: 'RUN_SCENARIO', steps }, () => {
    if (chrome.runtime.lastError) {
      showToast('Runner error: ' + chrome.runtime.lastError.message, 'error');
      $('btnRunScenario').disabled = false;
      $('btnRunScenario').textContent = '▶ Run';
    }
  });
}

// The step executor — injected and run inside the target tab
function executeStepInTab(tabId, step) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({
      target: { tabId },
      func: function(s) {
        // ── Locator-first finder (Selenium IDE strategy) ──────────────
        function findElByLocators(locators) {
          if (!locators || !locators.length) return null;
          for (const loc of locators) {
            try {
              let el = null;
              if (loc.startsWith('id=')) {
                el = document.getElementById(loc.slice(3));
              } else if (loc.startsWith('name=')) {
                el = document.querySelector('[name="' + loc.slice(5) + '"]');
              } else if (loc.startsWith('css=')) {
                el = document.querySelector(loc.slice(4));
              } else if (loc.startsWith('linkText=')) {
                const txt = loc.slice(9);
                el = Array.from(document.querySelectorAll('a')).find(a => a.textContent.trim() === txt) || null;
              } else if (loc.startsWith('xpath=')) {
                const res = document.evaluate(loc.slice(6), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                el = res.singleNodeValue || null;
              }
              if (el) return el;
            } catch(_) {}
          }
          return null;
        }
        // ── Label-based fallback (original approach) ──────────────────
        function findEl(label, tag) {
          if (!label) return null;
          const esc = label.replace(/['\"\\]/g, '\\$&');
          const tries = [
            () => document.querySelector(`[aria-label="${esc}"]`),
            () => document.querySelector(`[placeholder="${esc}"]`),
            () => document.querySelector(`[title="${esc}"]`),
            () => document.querySelector(`[name="${esc}"]`),
            () => document.querySelector(`[data-testid="${esc}"]`),
            () => { const all=document.querySelectorAll(tag||'*'); for(const el of all){if(el.textContent.trim()===label)return el;} return null; },
            () => { const all=document.querySelectorAll(tag||'*'); for(const el of all){if(el.textContent.trim().includes(label)&&el.children.length<=2)return el;} return null; },
          ];
          for(const t of tries){try{const el=t();if(el)return el;}catch(_){}}
          return null;
        }
        // ── Unified find: locators first, label fallback ──────────────
        function find(locators, label, tag) {
          return findElByLocators(locators) || findEl(label, tag);
        }
        try {
          if (s.type==='click') {
            const el = find(s.locators, s.label, 'button,a,[role="button"],[role="link"],input[type="submit"]');
            if (!el) return { pass:false, error:`Element not found: "${s.label}"` };
            el.click();
            return { pass:true, navigated: el.tagName==='A' || el.type==='submit' };
          }
          if (s.type==='input') {
            const el = find(s.locators, s.label, 'input,textarea,[contenteditable]');
            if (!el) return { pass:false, error:`Input not found: "${s.label}"` };
            el.focus(); el.value = s.value||'';
            el.dispatchEvent(new Event('input',{bubbles:true}));
            el.dispatchEvent(new Event('change',{bubbles:true}));
            return { pass:true };
          }
          if (s.type==='select') {
            const el = find(s.locators, s.label, 'select')||document.querySelector('select');
            if (!el) return { pass:false, error:`Select not found: "${s.label}"` };
            const opts=Array.from(el.options||[]);
            const opt=opts.find(o=>o.text.trim()===s.value||o.value===s.value);
            if (!opt) return { pass:false, error:`Option "${s.value}" not found` };
            el.value=opt.value; el.dispatchEvent(new Event('change',{bubbles:true}));
            return { pass:true };
          }
          if (s.type==='checkbox') {
            const el = find(s.locators, s.label, 'input[type="checkbox"]');
            if (!el) return { pass:false, error:`Checkbox not found: "${s.label}"` };
            if (el.checked!==s.checked) el.click();
            return { pass:true };
          }
          if (s.type==='radio') {
            const el = find(s.locators, s.label, 'input[type="radio"]');
            if (!el) return {pass:false, error:`Radio not found: "${s.label}"`};
            el.click(); return {pass:true};
          }
          if (s.type==='submit') {
            const form=document.querySelector('form');
            if (!form) return { pass:false, error:'No form found' };
            const btn=form.querySelector('[type="submit"],button');
            if (btn) { btn.click(); return {pass:true,navigated:true}; }
            form.submit(); return {pass:true,navigated:true};
          }
          if (s.type==='assert') {
            const found = document.body.innerText.includes(s.value)||document.body.innerHTML.includes(s.value);
            return found ? {pass:true} : {pass:false, error:`"${s.value}" not found on page`};
          }
          if (s.type==='paste') {
            const el = find(s.locators, s.label, 'input,textarea,[contenteditable]');
            if (!el) return { pass:false, error:`Input not found for paste: "${s.label}"` };
            el.focus(); el.value = (el.value||'') + (s.value||'');
            el.dispatchEvent(new Event('input',{bubbles:true}));
            el.dispatchEvent(new Event('change',{bubbles:true}));
            return { pass:true };
          }
          return { pass:true, skipped:true };
        } catch(e) { return { pass:false, error:e.message }; }
      },
      args: [step]
    }, results => {
      if (chrome.runtime.lastError) { reject(new Error(chrome.runtime.lastError.message)); return; }
      const r = results?.[0]?.result;
      if (!r) { reject(new Error('Script injection failed')); return; }
      resolve(r);
    });
  });
}

// Runner UI helpers
function addRunRow(index, step, status, time, error) {
  const row = document.createElement('div');
  row.id = `run-row-${index}`;
  row.className = `run-step-row ${status}`;
  const icons = { pass:'✅', fail:'❌', running:'<span class="run-spinning">⏳</span>', skipped:'⏭' };
  row.innerHTML = `<span class="run-step-status">${icons[status]||'▶️'}</span><span class="run-step-text">${escHtml(getStepSummary(step))}</span><span class="run-step-time">${time!=null?time+'ms':''}</span>`;
  if (error) { const errDiv=document.createElement('div'); errDiv.className='run-step-error'; errDiv.textContent=error; row.appendChild(errDiv); }
  $('runStepsList').appendChild(row);
  row.scrollIntoView({ behavior:'smooth', block:'nearest' });
}
function updateRunRow(index, status, time, error) {
  const row = $(`run-row-${index}`); if (!row) return;
  row.className = `run-step-row ${status}`;
  const icons = { pass:'✅', fail:'❌', skipped:'⏭' };
  row.querySelector('.run-step-status').innerHTML = icons[status]||'▶️';
  row.querySelector('.run-step-time').textContent = time+'ms';
  const existing = row.querySelector('.run-step-error'); if (existing) existing.remove();
  if (error) { const errDiv=document.createElement('div'); errDiv.className='run-step-error'; errDiv.textContent=error; row.appendChild(errDiv); }
}
function updateRunStats(pass, fail, skip, total) {
  $('runPassCount').textContent = `✅ ${pass}`;
  $('runFailCount').textContent = `❌ ${fail}`;
  $('runSkipCount').textContent = `⏭ ${skip}`;
  $('runTotalCount').textContent = `/ ${total} steps`;
}

// ── Download HTML Report ──────────────────────────────────────
function downloadReport() {
  if (!runnerResults.length) { showToast('No results yet','error'); return; }
  const pass = runnerResults.filter(r=>r.status==='pass').length;
  const fail = runnerResults.filter(r=>r.status==='fail').length;
  const skip = runnerResults.filter(r=>r.status==='skipped').length;
  const total = runnerResults.length;
  const pct = Math.round((pass/total)*100);
  const now = new Date().toLocaleString();

  const rows = runnerResults.map((r,i) => {
    const icon = r.status==='pass'?'✅':r.status==='fail'?'❌':'⏭';
    const bg   = r.status==='pass'?'#0d2e1e':r.status==='fail'?'#2e0d1a':'#1a1a2e';
    const err  = r.error ? `<br><span style="font-size:11px;color:#ff6b8a">${escHtml(r.error)}</span>` : '';
    return `<tr style="background:${bg}"><td>${i+1}</td><td>${icon} ${r.status.toUpperCase()}</td><td style="font-size:12px">${escHtml(getStepSummary(r.step))}</td><td>${r.time??'—'}ms${err}</td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Test Report — ${escHtml(scenarioName.value||'Scenario')}</title>
<style>
  body{margin:0;background:#0e0e1a;color:#f0f0ff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}
  .header{background:linear-gradient(135deg,#7c6cf4,#00d4aa);padding:32px;text-align:center;}
  .header h1{font-size:24px;margin:0 0 8px}
  .header p{margin:4px 0;opacity:.85;font-size:13px}
  .summary{display:flex;gap:16px;padding:20px;flex-wrap:wrap;justify-content:center;}
  .card{background:#16162a;border-radius:12px;padding:16px 24px;text-align:center;min-width:100px;}
  .card .num{font-size:32px;font-weight:800;}
  .card .lbl{font-size:11px;text-transform:uppercase;letter-spacing:.6px;opacity:.6;}
  .pass-card{border:1px solid rgba(0,212,170,.3)}.pass-card .num{color:#00d4aa}
  .fail-card{border:1px solid rgba(255,85,119,.3)}.fail-card .num{color:#ff5577}
  .skip-card{border:1px solid rgba(255,255,255,.1)}.skip-card .num{color:#9898bb}
  .pct-card{border:1px solid rgba(124,108,244,.3)}.pct-card .num{color:#7c6cf4}
  table{width:100%;border-collapse:collapse;font-size:13px;margin:0 0 32px}
  th{background:#16162a;padding:10px 14px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.6px;color:#9898bb;border-bottom:1px solid rgba(255,255,255,.08)}
  td{padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}
  .section-title{padding:16px;font-size:14px;font-weight:700;color:#9898bb;text-transform:uppercase;letter-spacing:.6px}
</style></head><body>
<div class="header">
  <h1>🧪 ${escHtml(scenarioName.value||'Test Scenario')}</h1>
  <p>${escHtml(featureName.value||'My Feature')}</p>
  <p>Generated: ${now}</p>
</div>
<div class="summary">
  <div class="card pass-card"><div class="num">${pass}</div><div class="lbl">Passed</div></div>
  <div class="card fail-card"><div class="num">${fail}</div><div class="lbl">Failed</div></div>
  <div class="card skip-card"><div class="num">${skip}</div><div class="lbl">Skipped</div></div>
  <div class="card pct-card"><div class="num">${pct}%</div><div class="lbl">Pass Rate</div></div>
</div>
<div class="section-title">Step Results</div>
<table><thead><tr><th>#</th><th>Status</th><th>Step</th><th>Time / Error</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>`;

  downloadText(html, `report-${sanitize(scenarioName.value||'scenario')}-${Date.now()}.html`, 'text/html');
  showToast('Report downloaded','success');
}

// ── Video ─────────────────────────────────────────────────────
function handleVideoButton() {
  if (isVideoProcessing) return;
  if (!isVideoRecording) {
    if (videoPreviewPanel) videoPreviewPanel.style.display='none';
    videoDataUrl=null; btnVideo.disabled=true; videoBtnLabel.textContent='…';
    chrome.runtime.sendMessage({ type:'START_VIDEO_RECORDING' }, resp => {
      btnVideo.disabled=false;
      if (resp?.success) { isVideoRecording=true; isVideoPaused=false; updateVideoUI(); showToast('🔴 Video recording!','success'); }
      else { showToast('Video error: '+(resp?.error||'?'),'error'); videoBtnLabel.textContent='Video'; btnVideo.className='sec-btn video'; }
    });
  } else if (!isVideoPaused) {
    chrome.runtime.sendMessage({ type:'PAUSE_VIDEO_RECORDING' }, ()=>{ isVideoPaused=true; updateVideoUI(); showToast('Video paused','info'); });
  } else {
    chrome.runtime.sendMessage({ type:'RESUME_VIDEO_RECORDING' }, ()=>{ isVideoPaused=false; updateVideoUI(); showToast('Video resumed','success'); });
  }
}
function stopVideoRecording() {
  chrome.runtime.sendMessage({ type:'STOP_VIDEO_RECORDING' }, ()=>{ isVideoProcessing=true; updateVideoUI(); showToast('⏳ Encoding…','info'); });
}
function updateVideoUI() {
  if (!btnVideo) return;
  if (isVideoProcessing) { btnVideo.className='sec-btn video'; videoBtnLabel.textContent='Encoding…'; btnVideo.disabled=true; if(videoBadgeEl)videoBadgeEl.style.display='none'; return; }
  btnVideo.disabled=false;
  if (!isVideoRecording) { btnVideo.className='sec-btn video'; videoBtnLabel.textContent='Video'; if(videoBadgeEl)videoBadgeEl.style.display='none'; }
  else if (isVideoPaused) { btnVideo.className='sec-btn video recording'; videoBtnLabel.textContent='Resume'; if(videoBadgeEl){videoBadgeEl.style.display='flex';videoBadgeEl.querySelector('.video-chip').textContent='⏸ PAUSED';} }
  else {
    btnVideo.className='sec-btn video recording'; videoBtnLabel.textContent='Pause';
    if (videoBadgeEl) {
      videoBadgeEl.style.display='flex'; videoBadgeEl.style.cursor='pointer';
      videoBadgeEl.title='Click to stop video';
      const chip=videoBadgeEl.querySelector('.video-chip'); if(chip) chip.textContent='⏺ REC';
      videoBadgeEl.onclick=()=>{ if(confirm('Stop and encode video?')) stopVideoRecording(); };
    }
  }
}
function showVideoPreview(dataUrl, size) {
  if (!videoPreviewPanel||!videoPlayer) return;
  videoPlayer.src=dataUrl;
  const sl=$('videoSizeLabel'); if(sl&&size) sl.textContent=(size/(1024*1024)).toFixed(1)+' MB';
  const od=$('btnVideoDownload'), os=$('btnVideoDiscard'), om=$('btnVideoMaximize');
  const nd=od.cloneNode(true), ns=os.cloneNode(true);
  od.parentNode.replaceChild(nd,od); os.parentNode.replaceChild(ns,os);
  $('btnVideoDownload').addEventListener('click', downloadVideo);
  $('btnVideoDiscard').addEventListener('click',()=>{ videoPreviewPanel.style.display='none'; videoPlayer.src=''; videoDataUrl=null; });
  if (om) {
    const nm=om.cloneNode(true); om.parentNode.replaceChild(nm,om);
    $('btnVideoMaximize').addEventListener('click',()=>{
      // Open video in a new window for full-screen viewing
      const win=window.open('','_blank','width=960,height=600,resizable=yes,scrollbars=no');
      if (!win) { showToast('Popup blocked — please allow popups','error'); return; }
      win.document.write(`<!DOCTYPE html><html><head><title>Recorded Session</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;display:flex;align-items:center;justify-content:center;height:100vh}video{max-width:100%;max-height:100vh;outline:none}</style></head><body><video src="${dataUrl}" controls autoplay></video></body></html>`);
      win.document.close();
    });
  }
  videoPreviewPanel.style.display='block';
}
function downloadVideo() {
  if (!videoDataUrl){showToast('No video','error');return;}
  const ext=videoDataUrl.includes('video/mp4')?'mp4':'webm';
  const a=document.createElement('a'); a.href=videoDataUrl; a.download=`${sanitize(scenarioName?.value||'recording')}.${ext}`; a.click();
  showToast('Video downloaded','success');
}

// ── Theme ─────────────────────────────────────────────────────
function loadTheme() { chrome.storage.local.get(['theme'],r=>{ isDark=r.theme!=='light'; applyTheme(); }); }
function toggleTheme() { isDark=!isDark; applyTheme(); chrome.storage.local.set({theme:isDark?'dark':'light'}); showToast(isDark?'🌙 Dark':'☀️ Light','info'); }
function applyTheme() { document.documentElement.setAttribute('data-theme',isDark?'dark':'light'); $('themeIcon').textContent=isDark?'🌙':'☀️'; }

// ── Tabs ──────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-item').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
  document.querySelectorAll('.tab-panel').forEach(p=>{ const a=p.id===`tab-${name}`; p.classList.toggle('active',a); p.style.display=a?'flex':'none'; });
  if (name==='gherkin') updateGherkin();
  if (name==='export')  updateExportOutput();
  if (name==='saved')   loadSavedScenarios();
}
document.querySelectorAll('.tab-panel').forEach(p=>{ p.style.display=p.classList.contains('active')?'flex':'none'; });

// ── Toast ─────────────────────────────────────────────────────
let toastT;
function showToast(msg, type='success') { toast.textContent=msg; toast.className=`toast ${type} show`; clearTimeout(toastT); toastT=setTimeout(()=>toast.classList.remove('show'),2600); }

// ── Utils ─────────────────────────────────────────────────────
function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function sanitize(s) { return s.replace(/[^a-zA-Z0-9_\-]/g,'_').toLowerCase().slice(0,50)||'file'; }
function downloadText(text, filename, mime) { const blob=new Blob([text],{type:mime}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url); }
