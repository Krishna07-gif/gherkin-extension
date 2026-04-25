// background.js — Service Worker v3 (all bugs fixed)
'use strict';

const DEFAULT_SETTINGS = {
  screenshots: true, scrolls: false, hotkeys: false,
  rightClick: true, maskPass: true, debounce: 1200
};

let state = {
  isRecording: false, isPaused: false, tabId: null, startTime: null,
  steps: [], settings: { ...DEFAULT_SETTINGS },
  isVideoRecording: false, isVideoPaused: false, videoTabId: null,
  pendingVideoData: null  // stores VIDEO_READY data across popup open/close
};

// ── Load settings at startup ──────────────────────────────
async function loadSettingsFromStorage() {
  return new Promise(resolve => {
    chrome.storage.local.get(['settings'], r => {
      if (r.settings) state.settings = { ...DEFAULT_SETTINGS, ...r.settings };
      resolve(state.settings);
    });
  });
}
loadSettingsFromStorage();

// ── Navigation tracking ───────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!state.isRecording || state.isPaused || tabId !== state.tabId) return;
  if (changeInfo.status === 'loading' && changeInfo.url) {
    if (changeInfo.url.startsWith('chrome') || changeInfo.url.startsWith('extension')) return;
    const last = state.steps[state.steps.length - 1];
    if (last?.type === 'navigate' && last.url === changeInfo.url) return;
    addStep({ type: 'navigate', url: changeInfo.url, timestamp: Date.now() });
  }
});

chrome.tabs.onActivated.addListener(info => {
  if (state.isRecording) state.tabId = info.tabId;
});

// ── Context menus ─────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'gherkin-assert', title: '✅ Add assertion: "%s"', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'gherkin-start',  title: '🔴 Start Gherkin Recording', contexts: ['page'] });
  });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'gherkin-assert' && info.selectionText && state.isRecording && !state.isPaused) {
    addStep({ type: 'assert', elementType: 'assertion', label: info.selectionText.slice(0,60),
              value: info.selectionText.slice(0,60), timestamp: Date.now() });
  }
  if (info.menuItemId === 'gherkin-start') startRecordingOnTab(tab.id, tab.url);
});

// ── Offscreen helpers ─────────────────────────────────────
async function ensureOffscreenDocument() {
  const ctxs = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).catch(() => []);
  if (ctxs?.length) return;
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('offscreen.html'), reasons: ['USER_MEDIA'],
    justification: 'Tab capture for video'
  });
}
async function closeOffscreenDocument() {
  const ctxs = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).catch(() => []);
  if (!ctxs?.length) return;
  await chrome.offscreen.closeDocument().catch(() => {});
}

// ── Screenshot (respects settings) ───────────────────────
function captureScreenshot() {
  return new Promise(resolve => {
    if (!state.tabId || state.settings.screenshots === false) { resolve(null); return; }
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 30 }, dataUrl => {
      resolve(chrome.runtime.lastError ? null : (dataUrl || null));
    });
  });
}

// ── Settings helper ───────────────────────────────────────
function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['settings'], r => {
      const merged = { ...DEFAULT_SETTINGS, ...(r.settings || {}) };
      state.settings = merged;
      resolve(merged);
    });
  });
}

// ── Message handler ───────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Relay VIDEO_READY from offscreen → popup (and store in state for popup reopen)
  if (message.type === 'VIDEO_READY') {
    state.isVideoRecording = false; state.isVideoPaused = false;
    state.pendingVideoData = { dataUrl: message.dataUrl, mimeType: message.mimeType, size: message.size };
    chrome.runtime.sendMessage({ type: 'VIDEO_READY', ...state.pendingVideoData }).catch(() => {});
    closeOffscreenDocument(); broadcastUpdate(); return true;
  }

  const handlers = {
    GET_STATE: () => {
      // Include pendingVideoData so popup can retrieve video after reopen
      sendResponse({ ...state, pendingVideoData: state.pendingVideoData });
    },

    GET_RECORDING_STATE: () => sendResponse({ isRecording: state.isRecording && !state.isPaused }),

    CLEAR_PENDING_VIDEO: () => { state.pendingVideoData = null; sendResponse({ success: true }); },

    START_RECORDING: async () => {
      const settings = await getSettings();
      state.steps = []; state.isRecording = true; state.isPaused = false; state.startTime = Date.now();
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (!tabs[0]) return;
        state.tabId = tabs[0].id;
        chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['content.js'] }).catch(() => {});
        if (tabs[0].url && !tabs[0].url.startsWith('chrome'))
          addStep({ type: 'navigate', url: tabs[0].url, timestamp: Date.now() });
        // Pass settings AND signal to show overlay
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'SET_RECORDING_STATE', isRecording: true, settings
        }).catch(() => {});
      });
      sendResponse({ success: true });
    },

    STOP_RECORDING: () => {
      state.isRecording = false; state.isPaused = false;
      if (state.tabId) {
        chrome.tabs.sendMessage(state.tabId, { type: 'SET_RECORDING_STATE', isRecording: false }).catch(() => {});
      }
      sendResponse({ success: true, steps: state.steps });
    },

    PAUSE_RECORDING: () => {
      state.isPaused = !state.isPaused;
      if (state.tabId) {
        chrome.tabs.sendMessage(state.tabId, {
          type: 'SET_RECORDING_STATE', isRecording: state.isRecording && !state.isPaused,
          isPaused: state.isPaused, settings: state.settings
        }).catch(() => {});
      }
      sendResponse({ isPaused: state.isPaused });
    },

    CLEAR_STEPS: () => {
      state.steps = []; state.startTime = state.isRecording ? Date.now() : null;
      broadcastUpdate(); sendResponse({ success: true });
    },

    RECORD_ACTION: async () => {
      if (!state.isRecording || state.isPaused) { sendResponse({ ignored: true }); return; }
      const settings = state.settings;
      // Skip hotkeys if disabled
      if (message.action.type === 'hotkey' && settings.hotkeys === false) { sendResponse({ ignored: true }); return; }
      // Skip scroll if disabled
      if (message.action.type === 'scroll' && settings.scrolls === false) { sendResponse({ ignored: true }); return; }
      // Skip assert from right-click if disabled
      if (message.action.type === 'assert' && message.action.fromRightClick && settings.rightClick === false) { sendResponse({ ignored: true }); return; }
      // Screenshot (respects settings.screenshots)
      const screenshot = (message.action.type !== 'navigate' && settings.screenshots !== false)
        ? await captureScreenshot() : null;
      addStep({ ...message.action, screenshot });
      sendResponse({ success: true });
    },

    DELETE_STEP: () => {
      if (message.index >= 0 && message.index < state.steps.length) {
        state.steps.splice(message.index, 1); broadcastUpdate();
        sendResponse({ success: true, steps: state.steps });
      } else sendResponse({ success: false });
    },

    REORDER_STEP: () => {
      const { from, to } = message;
      if (from >= 0 && to >= 0 && from < state.steps.length && to < state.steps.length) {
        const [moved] = state.steps.splice(from, 1); state.steps.splice(to, 0, moved);
        broadcastUpdate(); sendResponse({ success: true, steps: state.steps });
      } else sendResponse({ success: false });
    },

    DUPLICATE_STEP: () => {
      if (message.index >= 0 && message.index < state.steps.length) {
        const copy = { ...state.steps[message.index], timestamp: Date.now(), screenshot: null };
        state.steps.splice(message.index + 1, 0, copy);
        broadcastUpdate(); sendResponse({ success: true, steps: state.steps });
      } else sendResponse({ success: false });
    },

    UPDATE_STEP: () => {
      if (state.steps[message.index]) {
        state.steps[message.index] = { ...state.steps[message.index], ...message.updates };
        broadcastUpdate(); sendResponse({ success: true, steps: state.steps });
      } else sendResponse({ success: false });
    },

    SAVE_SCENARIO: () => {
      const { scenario } = message;
      chrome.storage.local.get(['scenarios'], r => {
        const scenarios = r.scenarios || [];
        const cleanSteps = (scenario.steps || []).map(s => { const c = {...s}; delete c.screenshot; return c; });
        scenarios.push({ ...scenario, steps: cleanSteps, id: Date.now() });
        chrome.storage.local.set({ scenarios }, () => sendResponse({ success: true, scenarios }));
      });
    },

    GET_SCENARIOS: () => chrome.storage.local.get(['scenarios'], r => sendResponse({ scenarios: r.scenarios || [] })),

    DELETE_SCENARIO: () => {
      chrome.storage.local.get(['scenarios'], r => {
        const scenarios = (r.scenarios || []).filter(s => s.id !== message.id);
        chrome.storage.local.set({ scenarios }, () => sendResponse({ success: true, scenarios }));
      });
    },

    // ── Settings ─────────────────────────────────────────
    SAVE_SETTINGS: () => {
      state.settings = { ...DEFAULT_SETTINGS, ...message.settings };
      chrome.storage.local.set({ settings: state.settings }, () => {
        // Notify active content script immediately so mask-password etc. work live
        if (state.tabId) {
          chrome.tabs.sendMessage(state.tabId, { type: 'UPDATE_SETTINGS', settings: state.settings }).catch(() => {});
        }
        sendResponse({ success: true });
      });
    },

    GET_SETTINGS: () => chrome.storage.local.get(['settings'], r => sendResponse({ settings: { ...DEFAULT_SETTINGS, ...(r.settings || {}) } })),

    // ── Video ─────────────────────────────────────────────
    START_VIDEO_RECORDING: async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab = tabs[0];
        if (!tab) { sendResponse({ success: false, error: 'No active tab' }); return; }
        chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async streamId => {
          if (chrome.runtime.lastError) { sendResponse({ success: false, error: chrome.runtime.lastError.message }); return; }
          try {
            await ensureOffscreenDocument();
            await new Promise(r => setTimeout(r, 300));
            await chrome.runtime.sendMessage({ type: 'START_VIDEO', target: 'offscreen', streamId });
            state.isVideoRecording = true; state.isVideoPaused = false; state.videoTabId = tab.id;
            state.pendingVideoData = null;
            // Persist to local storage so popup can detect across restarts
            chrome.storage.local.set({ videoRecordingActive: true });
            broadcastUpdate(); sendResponse({ success: true });
          } catch(e) { await closeOffscreenDocument(); sendResponse({ success: false, error: e.message }); }
        });
      } catch(e) { sendResponse({ success: false, error: e.message }); }
    },

    STOP_VIDEO_RECORDING: () => {
      chrome.runtime.sendMessage({ type: 'STOP_VIDEO', target: 'offscreen' }).catch(() => {});
      chrome.storage.local.remove('videoRecordingActive');
      sendResponse({ success: true });
    },

    PAUSE_VIDEO_RECORDING: () => {
      chrome.runtime.sendMessage({ type: 'PAUSE_VIDEO', target: 'offscreen' }).catch(() => {});
      state.isVideoPaused = true; broadcastUpdate(); sendResponse({ success: true });
    },

    RESUME_VIDEO_RECORDING: () => {
      chrome.runtime.sendMessage({ type: 'RESUME_VIDEO', target: 'offscreen' }).catch(() => {});
      state.isVideoPaused = false; broadcastUpdate(); sendResponse({ success: true });
    },

    GET_VIDEO_STATE: () => sendResponse({ isVideoRecording: state.isVideoRecording, isVideoPaused: state.isVideoPaused }),

    RUN_SCENARIO: () => {
      runScenarioInBackground(message.steps);
      sendResponse({ success: true });
    }
  };

  if (handlers[message.type]) { handlers[message.type](); } else { sendResponse({ error: 'Unknown: ' + message.type }); }
  return true;
});

function startRecordingOnTab(tabId, url) {
  loadSettingsFromStorage().then(settings => {
    state.steps = []; state.isRecording = true; state.isPaused = false;
    state.startTime = Date.now(); state.tabId = tabId;
    chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch(() => {});
    if (url && !url.startsWith('chrome')) addStep({ type: 'navigate', url, timestamp: Date.now() });
    chrome.tabs.sendMessage(tabId, { type: 'SET_RECORDING_STATE', isRecording: true, settings }).catch(() => {});
    broadcastUpdate();
  });
}

function addStep(step) { state.steps.push(step); broadcastUpdate(); }

function broadcastUpdate() {
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATE', steps: state.steps,
    isRecording: state.isRecording, isPaused: state.isPaused, startTime: state.startTime,
    isVideoRecording: state.isVideoRecording, isVideoPaused: state.isVideoPaused
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════════════
//  BACKGROUND RUNNER ENGINE
// ═══════════════════════════════════════════════════════════════

let runnerState = { running: false, tabId: null };

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const interval = setInterval(() => {
      chrome.tabs.get(tabId, tab => {
        if (chrome.runtime.lastError) { clearInterval(interval); reject(new Error('Tab closed')); return; }
        if (tab.status === 'complete') { clearInterval(interval); resolve(); }
        if (++tries > 100) { clearInterval(interval); resolve(); } // timeout after 10s
      });
    }, 100);
  });
}

function executeStepInTab(tabId, step) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript({
      target: { tabId },
      func: function(s) {
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
        function findEl(label, tag) {
          if (!label) return null;
          const esc = label.replace(/['\"\\]/g, '\\$&');
          const tries = [
            () => document.querySelector('[aria-label="' + esc + '"]'),
            () => document.querySelector('[placeholder="' + esc + '"]'),
            () => document.querySelector('[title="' + esc + '"]'),
            () => document.querySelector('[name="' + esc + '"]'),
            () => document.querySelector('[data-testid="' + esc + '"]'),
            () => { const all=document.querySelectorAll(tag||'*'); for(const el of all){if(el.textContent.trim()===label)return el;} return null; },
            () => { const all=document.querySelectorAll(tag||'*'); for(const el of all){if(el.textContent.trim().includes(label)&&el.children.length<=2)return el;} return null; },
          ];
          for(const t of tries){try{const el=t();if(el)return el;}catch(_){}}
          return null;
        }
        function find(locators, label, tag) {
          return findElByLocators(locators) || findEl(label, tag);
        }
        try {
          if (s.type==='click') {
            const el = find(s.locators, s.label, 'button,a,[role="button"],[role="link"],input[type="submit"]');
            if (!el) return { pass:false, error:'Element not found: "' + s.label + '"' };
            el.click();
            return { pass:true, navigated: el.tagName==='A' || el.type==='submit' };
          }
          if (s.type==='input') {
            const el = find(s.locators, s.label, 'input,textarea,[contenteditable]');
            if (!el) return { pass:false, error:'Input not found: "' + s.label + '"' };
            el.focus(); el.value = s.value||'';
            el.dispatchEvent(new Event('input',{bubbles:true}));
            el.dispatchEvent(new Event('change',{bubbles:true}));
            return { pass:true };
          }
          if (s.type==='select') {
            const el = find(s.locators, s.label, 'select')||document.querySelector('select');
            if (!el) return { pass:false, error:'Select not found: "' + s.label + '"' };
            const opts=Array.from(el.options||[]);
            const opt=opts.find(o=>o.text.trim()===s.value||o.value===s.value);
            if (!opt) return { pass:false, error:'Option "' + s.value + '" not found' };
            el.value=opt.value; el.dispatchEvent(new Event('change',{bubbles:true}));
            return { pass:true };
          }
          if (s.type==='checkbox') {
            const el = find(s.locators, s.label, 'input[type="checkbox"]');
            if (!el) return { pass:false, error:'Checkbox not found: "' + s.label + '"' };
            if (el.checked!==s.checked) el.click();
            return { pass:true };
          }
          if (s.type==='radio') {
            const el = find(s.locators, s.label, 'input[type="radio"]');
            if (!el) return { pass:false, error:'Radio not found: "' + s.label + '"' };
            el.click(); return { pass:true };
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
            return found ? {pass:true} : {pass:false, error:'"' + s.value + '" not found on page'};
          }
          if (s.type==='paste') {
            const el = find(s.locators, s.label, 'input,textarea,[contenteditable]');
            if (!el) return { pass:false, error:'Input not found for paste: "' + s.label + '"' };
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

function broadcastRunnerUpdate(payload) {
  chrome.runtime.sendMessage({ type: 'RUNNER_UPDATE', ...payload }).catch(() => {});
}

async function runScenarioInBackground(steps) {
  if (runnerState.running) return;
  runnerState.running = true;

  const navStep = steps.find(s => s.type === 'navigate');
  if (!navStep) {
    broadcastRunnerUpdate({ event: 'error', error: 'No navigation step found — cannot start' });
    runnerState.running = false; return;
  }

  broadcastRunnerUpdate({ event: 'start', total: steps.length });

  try {
    const tab = await new Promise((res, rej) => {
      chrome.tabs.create({ url: navStep.url, active: true }, t => {
        if (chrome.runtime.lastError) { rej(new Error(chrome.runtime.lastError.message)); return; }
        res(t);
      });
    });
    runnerState.tabId = tab.id;
    await waitForTabLoad(tab.id);

    const navIdx = steps.indexOf(navStep);
    broadcastRunnerUpdate({ event: 'step_result', index: navIdx, status: 'pass', time: 0, error: null });

    let passCount = 1, failCount = 0, skipCount = 0;

    for (let i = 0; i < steps.length; i++) {
      if (i === navIdx) continue; // already reported navigate
      const step = steps[i];
      broadcastRunnerUpdate({ event: 'step_start', index: i });
      const start = Date.now();

      if (['navigate', 'scroll', 'hotkey'].includes(step.type)) {
        const time = Date.now() - start;
        broadcastRunnerUpdate({ event: 'step_result', index: i, status: 'skipped', time, error: null });
        skipCount++;
        broadcastRunnerUpdate({ event: 'stats', pass: passCount, fail: failCount, skip: skipCount, total: steps.length });
        continue;
      }

      try {
        const result = await executeStepInTab(runnerState.tabId, step);
        const time = Date.now() - start;
        if (result.pass) {
          broadcastRunnerUpdate({ event: 'step_result', index: i, status: 'pass', time, error: null });
          passCount++;
          if (result.navigated) {
            await new Promise(r => setTimeout(r, 800));
            await waitForTabLoad(runnerState.tabId);
          }
        } else {
          broadcastRunnerUpdate({ event: 'step_result', index: i, status: 'fail', time, error: result.error || 'Unknown error' });
          failCount++;
        }
      } catch(e) {
        const time = Date.now() - start;
        broadcastRunnerUpdate({ event: 'step_result', index: i, status: 'fail', time, error: e.message });
        failCount++;
      }
      broadcastRunnerUpdate({ event: 'stats', pass: passCount, fail: failCount, skip: skipCount, total: steps.length });
      await new Promise(r => setTimeout(r, 300));
    }

    broadcastRunnerUpdate({ event: 'done', pass: passCount, fail: failCount, skip: skipCount });
  } catch(e) {
    broadcastRunnerUpdate({ event: 'error', error: e.message });
  }

  runnerState.running = false;
  runnerState.tabId = null;
}
