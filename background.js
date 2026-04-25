// background.js — Service Worker v2
'use strict';

let state = {
  isRecording: false, isPaused: false, tabId: null, startTime: null,
  steps: [], isVideoRecording: false, isVideoPaused: false, videoTabId: null
};

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

chrome.tabs.onActivated.addListener((info) => {
  if (state.isRecording) state.tabId = info.tabId;
});

// ── Context menus ─────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'gherkin-assert',
    title: '✅ Add assertion: "%s"',
    contexts: ['selection']
  });
  chrome.contextMenus.create({
    id: 'gherkin-start',
    title: '🔴 Start Gherkin Recording',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'gherkin-assert' && info.selectionText) {
    if (state.isRecording && !state.isPaused) {
      addStep({ type: 'assert', elementType: 'assertion',
                label: info.selectionText.slice(0, 60),
                value: info.selectionText.slice(0, 60), timestamp: Date.now() });
    }
  }
  if (info.menuItemId === 'gherkin-start') {
    startRecordingOnTab(tab.id, tab.url);
  }
});

// ── Offscreen helpers ─────────────────────────────────────
async function ensureOffscreenDocument() {
  const ctxs = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).catch(() => []);
  if (ctxs?.length > 0) return;
  await chrome.offscreen.createDocument({
    url: chrome.runtime.getURL('offscreen.html'), reasons: ['USER_MEDIA'],
    justification: 'Tab capture for video recording'
  });
}
async function closeOffscreenDocument() {
  const ctxs = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).catch(() => []);
  if (!ctxs?.length) return;
  await chrome.offscreen.closeDocument().catch(() => {});
}

// ── Screenshot capture ────────────────────────────────────
function captureScreenshot() {
  return new Promise((resolve) => {
    if (!state.tabId) { resolve(null); return; }
    chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 25 }, (dataUrl) => {
      if (chrome.runtime.lastError) { resolve(null); return; }
      resolve(dataUrl || null);
    });
  });
}

// ── Message handler ───────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'VIDEO_READY') {
    state.isVideoRecording = false; state.isVideoPaused = false;
    chrome.runtime.sendMessage({ type: 'VIDEO_READY', dataUrl: message.dataUrl,
                                  mimeType: message.mimeType, size: message.size }).catch(() => {});
    closeOffscreenDocument(); broadcastUpdate(); return true;
  }

  const handlers = {
    GET_STATE: () => sendResponse({ ...state }),

    GET_RECORDING_STATE: () => sendResponse({ isRecording: state.isRecording && !state.isPaused }),

    START_RECORDING: () => {
      state.steps = []; state.isRecording = true; state.isPaused = false; state.startTime = Date.now();
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        state.tabId = tabs[0].id;
        chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['content.js'] }).catch(() => {});
        if (tabs[0].url && !tabs[0].url.startsWith('chrome')) {
          addStep({ type: 'navigate', url: tabs[0].url, timestamp: Date.now() });
        }
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_RECORDING_STATE', isRecording: true }).catch(() => {});
      });
      sendResponse({ success: true });
    },

    STOP_RECORDING: () => {
      state.isRecording = false; state.isPaused = false;
      if (state.tabId) chrome.tabs.sendMessage(state.tabId, { type: 'SET_RECORDING_STATE', isRecording: false }).catch(() => {});
      sendResponse({ success: true, steps: state.steps });
    },

    PAUSE_RECORDING: () => {
      state.isPaused = !state.isPaused;
      if (state.tabId) chrome.tabs.sendMessage(state.tabId, { type: 'SET_RECORDING_STATE', isRecording: state.isRecording && !state.isPaused }).catch(() => {});
      sendResponse({ isPaused: state.isPaused });
    },

    CLEAR_STEPS: () => {
      state.steps = []; state.startTime = state.isRecording ? Date.now() : null;
      broadcastUpdate(); sendResponse({ success: true });
    },

    RECORD_ACTION: async () => {
      if (!state.isRecording || state.isPaused) { sendResponse({ ignored: true }); return; }
      // Capture screenshot for non-navigate steps
      const screenshot = (message.action.type !== 'navigate') ? await captureScreenshot() : null;
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
        const [moved] = state.steps.splice(from, 1);
        state.steps.splice(to, 0, moved);
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
      chrome.storage.local.get(['scenarios'], (r) => {
        const scenarios = r.scenarios || [];
        // Strip screenshots before saving (save storage space)
        const cleanSteps = (scenario.steps || []).map(s => { const c = {...s}; delete c.screenshot; return c; });
        scenarios.push({ ...scenario, steps: cleanSteps, id: Date.now() });
        chrome.storage.local.set({ scenarios }, () => sendResponse({ success: true, scenarios }));
      });
    },

    GET_SCENARIOS: () => {
      chrome.storage.local.get(['scenarios'], (r) => sendResponse({ scenarios: r.scenarios || [] }));
    },

    DELETE_SCENARIO: () => {
      chrome.storage.local.get(['scenarios'], (r) => {
        const scenarios = (r.scenarios || []).filter(s => s.id !== message.id);
        chrome.storage.local.set({ scenarios }, () => sendResponse({ success: true, scenarios }));
      });
    },

    // ── Video ──────────────────────────────────────────────
    START_VIDEO_RECORDING: async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab  = tabs[0];
        if (!tab) { sendResponse({ success: false, error: 'No active tab' }); return; }
        chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async (streamId) => {
          if (chrome.runtime.lastError) { sendResponse({ success: false, error: chrome.runtime.lastError.message }); return; }
          try {
            await ensureOffscreenDocument();
            await new Promise(r => setTimeout(r, 300));
            await chrome.runtime.sendMessage({ type: 'START_VIDEO', target: 'offscreen', streamId });
            state.isVideoRecording = true; state.isVideoPaused = false; state.videoTabId = tab.id;
            broadcastUpdate(); sendResponse({ success: true });
          } catch (e) { await closeOffscreenDocument(); sendResponse({ success: false, error: e.message }); }
        });
      } catch (e) { sendResponse({ success: false, error: e.message }); }
    },

    STOP_VIDEO_RECORDING: () => {
      chrome.runtime.sendMessage({ type: 'STOP_VIDEO', target: 'offscreen' }).catch(() => {});
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

    // ── Settings storage ───────────────────────────────────
    SAVE_SETTINGS: () => {
      chrome.storage.local.set({ settings: message.settings }, () => sendResponse({ success: true }));
    },
    GET_SETTINGS: () => {
      chrome.storage.local.get(['settings'], (r) => sendResponse({ settings: r.settings || {} }));
    }
  };

  if (handlers[message.type]) { handlers[message.type](); }
  else sendResponse({ error: 'Unknown: ' + message.type });
  return true;
});

function startRecordingOnTab(tabId, url) {
  state.steps = []; state.isRecording = true; state.isPaused = false;
  state.startTime = Date.now(); state.tabId = tabId;
  chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }).catch(() => {});
  if (url && !url.startsWith('chrome')) addStep({ type: 'navigate', url, timestamp: Date.now() });
  chrome.tabs.sendMessage(tabId, { type: 'SET_RECORDING_STATE', isRecording: true }).catch(() => {});
  broadcastUpdate();
}

function addStep(step) { state.steps.push(step); broadcastUpdate(); }

function broadcastUpdate() {
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATE', steps: state.steps,
    isRecording: state.isRecording, isPaused: state.isPaused, startTime: state.startTime,
    isVideoRecording: state.isVideoRecording, isVideoPaused: state.isVideoPaused
  }).catch(() => {});
}
