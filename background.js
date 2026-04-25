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

    GET_VIDEO_STATE: () => sendResponse({ isVideoRecording: state.isVideoRecording, isVideoPaused: state.isVideoPaused })
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
