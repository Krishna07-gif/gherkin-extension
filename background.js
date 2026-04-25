// ============================================================
// background.js — Service Worker
// Manages recording state, navigation tracking, message routing
// + Video recording via offscreen document + tabCapture
// ============================================================

'use strict';

// ----- Global State -----
let state = {
  isRecording:      false,
  isPaused:         false,
  tabId:            null,
  startTime:        null,
  steps:            [],
  isVideoRecording: false,
  isVideoPaused:    false,
  videoTabId:       null
};

// ----- Tab Navigation Tracking -----
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!state.isRecording || state.isPaused) return;
  if (tabId !== state.tabId) return;
  if (changeInfo.status === 'loading' && changeInfo.url) {
    if (changeInfo.url.startsWith('chrome') || changeInfo.url.startsWith('extension')) return;
    const lastStep = state.steps[state.steps.length - 1];
    if (lastStep && lastStep.type === 'navigate' && lastStep.url === changeInfo.url) return;
    addStep({ type: 'navigate', url: changeInfo.url, timestamp: Date.now() });
  }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
  if (state.isRecording) state.tabId = activeInfo.tabId;
});

// ============================================================
// Offscreen Document Helpers
// ============================================================

async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).catch(() => []);
  if (contexts && contexts.length > 0) return;
  await chrome.offscreen.createDocument({
    url:           chrome.runtime.getURL('offscreen.html'),
    reasons:       ['USER_MEDIA'],
    justification: 'Tab screen capture for session video recording'
  });
}

async function closeOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] }).catch(() => []);
  if (!contexts || contexts.length === 0) return;
  await chrome.offscreen.closeDocument().catch(() => {});
}

// ============================================================
// Message Handler
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // Relay VIDEO_READY from offscreen doc to popup
  if (message.type === 'VIDEO_READY') {
    state.isVideoRecording = false;
    state.isVideoPaused    = false;
    chrome.runtime.sendMessage({
      type:     'VIDEO_READY',
      dataUrl:  message.dataUrl,
      mimeType: message.mimeType,
      size:     message.size
    }).catch(() => {});
    closeOffscreenDocument();
    broadcastUpdate();
    return true;
  }

  const handlers = {
    GET_STATE: () => {
      sendResponse({ ...state });
    },

    GET_RECORDING_STATE: () => {
      sendResponse({ isRecording: state.isRecording && !state.isPaused });
    },

    START_RECORDING: () => {
      state.steps       = [];
      state.isRecording = true;
      state.isPaused    = false;
      state.startTime   = Date.now();
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          state.tabId = tabs[0].id;
          chrome.scripting.executeScript({ target: { tabId: tabs[0].id }, files: ['content.js'] }).catch(() => {});
          if (tabs[0].url && !tabs[0].url.startsWith('chrome')) {
            addStep({ type: 'navigate', url: tabs[0].url, timestamp: Date.now() });
          }
          chrome.tabs.sendMessage(tabs[0].id, { type: 'SET_RECORDING_STATE', isRecording: true }).catch(() => {});
        }
      });
      sendResponse({ success: true });
    },

    STOP_RECORDING: () => {
      state.isRecording = false;
      state.isPaused    = false;
      if (state.tabId) {
        chrome.tabs.sendMessage(state.tabId, { type: 'SET_RECORDING_STATE', isRecording: false }).catch(() => {});
      }
      sendResponse({ success: true, steps: state.steps });
    },

    PAUSE_RECORDING: () => {
      state.isPaused = !state.isPaused;
      if (state.tabId) {
        chrome.tabs.sendMessage(state.tabId, { type: 'SET_RECORDING_STATE', isRecording: state.isRecording && !state.isPaused }).catch(() => {});
      }
      sendResponse({ isPaused: state.isPaused });
    },

    CLEAR_STEPS: () => {
      state.steps     = [];
      state.startTime = state.isRecording ? Date.now() : null;
      broadcastUpdate();
      sendResponse({ success: true });
    },

    RECORD_ACTION: () => {
      if (state.isRecording && !state.isPaused) {
        addStep(message.action);
        sendResponse({ success: true });
      } else {
        sendResponse({ ignored: true });
      }
    },

    DELETE_STEP: () => {
      if (message.index >= 0 && message.index < state.steps.length) {
        state.steps.splice(message.index, 1);
        broadcastUpdate();
        sendResponse({ success: true, steps: state.steps });
      } else {
        sendResponse({ success: false });
      }
    },

    UPDATE_STEP: () => {
      if (state.steps[message.index]) {
        state.steps[message.index] = { ...state.steps[message.index], ...message.updates };
        broadcastUpdate();
        sendResponse({ success: true, steps: state.steps });
      } else {
        sendResponse({ success: false });
      }
    },

    SAVE_SCENARIO: () => {
      const { scenario } = message;
      chrome.storage.local.get(['scenarios'], (result) => {
        const scenarios = result.scenarios || [];
        scenarios.push({ ...scenario, id: Date.now() });
        chrome.storage.local.set({ scenarios }, () => { sendResponse({ success: true, scenarios }); });
      });
    },

    GET_SCENARIOS: () => {
      chrome.storage.local.get(['scenarios'], (result) => { sendResponse({ scenarios: result.scenarios || [] }); });
    },

    DELETE_SCENARIO: () => {
      chrome.storage.local.get(['scenarios'], (result) => {
        const scenarios = (result.scenarios || []).filter(s => s.id !== message.id);
        chrome.storage.local.set({ scenarios }, () => { sendResponse({ success: true, scenarios }); });
      });
    },

    // ── Start video capture ──
    START_VIDEO_RECORDING: async () => {
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        const tab  = tabs[0];
        if (!tab) { sendResponse({ success: false, error: 'No active tab found' }); return; }

        chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, async (streamId) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message });
            return;
          }
          try {
            await ensureOffscreenDocument();

            // Small delay to ensure offscreen doc listener is ready
            await new Promise(r => setTimeout(r, 300));

            await chrome.runtime.sendMessage({ type: 'START_VIDEO', target: 'offscreen', streamId });

            state.isVideoRecording = true;
            state.isVideoPaused    = false;
            state.videoTabId       = tab.id;
            broadcastUpdate();
            sendResponse({ success: true });
          } catch (e) {
            await closeOffscreenDocument();
            sendResponse({ success: false, error: e.message });
          }
        });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    },

    // ── Stop video capture ──
    STOP_VIDEO_RECORDING: () => {
      chrome.runtime.sendMessage({ type: 'STOP_VIDEO', target: 'offscreen' }).catch(() => {});
      sendResponse({ success: true });
    },

    // ── Pause video ──
    PAUSE_VIDEO_RECORDING: () => {
      chrome.runtime.sendMessage({ type: 'PAUSE_VIDEO', target: 'offscreen' }).catch(() => {});
      state.isVideoPaused = true;
      broadcastUpdate();
      sendResponse({ success: true });
    },

    // ── Resume video ──
    RESUME_VIDEO_RECORDING: () => {
      chrome.runtime.sendMessage({ type: 'RESUME_VIDEO', target: 'offscreen' }).catch(() => {});
      state.isVideoPaused = false;
      broadcastUpdate();
      sendResponse({ success: true });
    },

    GET_VIDEO_STATE: () => {
      sendResponse({ isVideoRecording: state.isVideoRecording, isVideoPaused: state.isVideoPaused });
    }
  };

  if (handlers[message.type]) {
    handlers[message.type]();
  } else {
    sendResponse({ error: 'Unknown message type: ' + message.type });
  }

  return true;
});

// ---- Helpers ----
function addStep(step) {
  state.steps.push(step);
  broadcastUpdate();
}

function broadcastUpdate() {
  chrome.runtime.sendMessage({
    type:             'STATE_UPDATE',
    steps:            state.steps,
    isRecording:      state.isRecording,
    isPaused:         state.isPaused,
    startTime:        state.startTime,
    isVideoRecording: state.isVideoRecording,
    isVideoPaused:    state.isVideoPaused
  }).catch(() => {});
}
