// ============================================================
// content.js — Page Event Recorder
// Injected into every web page. Captures DOM events and
// sends structured action data to the background service worker.
// ============================================================

(function () {
  'use strict';

  // Guard: prevent double-injection
  if (window.__gherkinRecorderInjected) return;
  window.__gherkinRecorderInjected = true;

  let isRecording = false;
  let inputDebounceMap = new Map(); // el → timeoutId
  let pendingInputMap = new Map();  // el → { label, value, type }

  // ---- Initialize: ask background for current state ----
  chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp) isRecording = resp.isRecording;
  });

  // ---- Listen for state changes from background ----
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SET_RECORDING_STATE') {
      isRecording = message.isRecording;
      sendResponse({ success: true });
    }
    return true;
  });

  // ===========================================================
  //  ELEMENT HELPERS
  // ===========================================================

  /** Returns the best human-readable label for an element */
  function getElementLabel(el) {
    // 1. aria-label attribute
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return clean(ariaLabel);

    // 2. aria-labelledby → text of referenced element
    const labelledById = el.getAttribute('aria-labelledby');
    if (labelledById) {
      const refEl = document.getElementById(labelledById);
      if (refEl && refEl.textContent.trim()) return clean(refEl.textContent);
    }

    // 3. <label for="id"> associated label
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label && label.textContent.trim()) return clean(label.textContent);
    }

    // 4. Wrapping <label>
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) {
      const labelText = wrappingLabel.textContent.replace(el.value || '', '').trim();
      if (labelText) return clean(labelText);
    }

    // 5. placeholder
    if (el.placeholder && el.placeholder.trim()) return clean(el.placeholder);

    // 6. title attribute
    if (el.title && el.title.trim()) return clean(el.title);

    // 7. name attribute (prettified)
    if (el.name && el.name.trim()) return prettifyName(el.name);

    // 8. Visible text content (buttons, links, etc.)
    const textContent = el.textContent.trim();
    if (textContent && textContent.length > 0 && textContent.length <= 80) {
      return clean(textContent);
    }

    // 9. input[type=button] value
    if (el.value && ['button', 'submit', 'reset'].includes(el.type)) {
      return clean(el.value);
    }

    // 10. alt attribute (images)
    if (el.alt && el.alt.trim()) return clean(el.alt);

    // 11. data-testid / data-cy / data-qa (popular test attributes)
    for (const attr of ['data-testid', 'data-cy', 'data-qa', 'data-test']) {
      const val = el.getAttribute(attr);
      if (val && val.trim()) return prettifyName(val);
    }

    // 12. Fallback: CSS selector
    return getCSSSelector(el);
  }

  /** Prettify camelCase/snake_case/kebab-case names */
  function prettifyName(name) {
    return name
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .trim();
  }

  /** Clean up text: collapse whitespace, truncate */
  function clean(text) {
    return text.replace(/\s+/g, ' ').trim().slice(0, 60);
  }

  /** Build a minimal unique CSS selector */
  function getCSSSelector(el) {
    if (el.id) return `#${el.id}`;
    const tag = el.tagName.toLowerCase();
    const classes = Array.from(el.classList).slice(0, 2).join('.');
    return classes ? `${tag}.${classes}` : tag;
  }

  /** Classify what kind of interactive element this is */
  function getElementType(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();

    if (tag === 'a') return 'link';
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'input';
    if (tag === 'button') return 'button';

    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button' || type === 'reset') return 'button';
      if (type === 'file') return 'file';
      return 'input';
    }

    // ARIA roles
    if (role === 'button') return 'button';
    if (role === 'link') return 'link';
    if (role === 'checkbox') return 'checkbox';
    if (role === 'radio') return 'radio';
    if (role === 'menuitem') return 'menuitem';
    if (role === 'tab') return 'tab';
    if (role === 'combobox') return 'select';

    // Clickable by CSS cursor or onclick
    const style = window.getComputedStyle(el);
    if (style.cursor === 'pointer') return 'clickable';

    return 'element';
  }

  /** Check if element is an input we care about tracking */
  function isTextInput(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      return !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'hidden', 'image'].includes(type);
    }
    if (el.getAttribute('contenteditable') === 'true') return true;
    return false;
  }

  /** Should we skip clicking on this element? (to avoid spam) */
  function shouldSkipClick(el) {
    // Don't record bare clicks on text inputs — we capture via 'input' event
    const elType = getElementType(el);
    if (elType === 'input') return true;

    // Skip invisible elements
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return true;

    // Skip body/html/document
    if (['BODY', 'HTML'].includes(el.tagName)) return true;

    return false;
  }

  // ===========================================================
  //  SEND ACTION
  // ===========================================================
  function sendAction(action) {
    if (!isRecording) return;
    chrome.runtime.sendMessage({
      type: 'RECORD_ACTION',
      action: { ...action, timestamp: Date.now(), pageUrl: window.location.href }
    }).catch(() => {});
  }

  // ===========================================================
  //  EVENT LISTENERS
  // ===========================================================

  /** 1. CLICK — walk up the DOM to find the most relevant clickable ancestor */
  document.addEventListener('click', (e) => {
    if (!isRecording) return;

    let el = e.target;

    // Walk up to find button/link/role=button ancestor (max 5 levels)
    let candidate = el;
    for (let i = 0; i < 5; i++) {
      const t = getElementType(candidate);
      if (['button', 'link', 'checkbox', 'radio', 'tab', 'menuitem'].includes(t)) {
        el = candidate;
        break;
      }
      if (!candidate.parentElement) break;
      candidate = candidate.parentElement;
    }

    if (shouldSkipClick(el)) return;

    const elType = getElementType(el);

    sendAction({
      type: 'click',
      elementType: elType,
      label: getElementLabel(el),
      tag: el.tagName.toLowerCase(),
      checked: el.checked !== undefined ? el.checked : null
    });
  }, true);

  /** 2. INPUT — debounced, captures final typed value */
  document.addEventListener('input', (e) => {
    if (!isRecording) return;

    const el = e.target;
    if (!isTextInput(el)) return;

    const label = getElementLabel(el);
    const inputType = (el.type || 'text').toLowerCase();

    // Store pending value
    pendingInputMap.set(el, {
      label,
      value: inputType === 'password' ? '••••••' : el.value,
      inputType
    });

    // Debounce: wait 1.2s of inactivity before recording
    clearTimeout(inputDebounceMap.get(el));
    inputDebounceMap.set(el, setTimeout(() => {
      const pending = pendingInputMap.get(el);
      if (pending && pending.value) {
        sendAction({
          type: 'input',
          elementType: 'input',
          label: pending.label,
          value: pending.value,
          inputType: pending.inputType
        });
      }
      inputDebounceMap.delete(el);
      pendingInputMap.delete(el);
    }, 1200));
  }, true);

  /** 3. CHANGE — for <select>, <input type="checkbox">, <input type="radio"> */
  document.addEventListener('change', (e) => {
    if (!isRecording) return;

    const el = e.target;
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    if (tag === 'select') {
      const selectedOption = el.options[el.selectedIndex];
      sendAction({
        type: 'select',
        elementType: 'select',
        label: getElementLabel(el),
        value: selectedOption ? selectedOption.text.trim() : el.value
      });
      return;
    }

    if (type === 'checkbox') {
      sendAction({
        type: 'checkbox',
        elementType: 'checkbox',
        label: getElementLabel(el),
        checked: el.checked
      });
      return;
    }

    if (type === 'radio') {
      sendAction({
        type: 'radio',
        elementType: 'radio',
        label: getElementLabel(el),
        value: getElementLabel(el)
      });
      return;
    }

    if (type === 'file') {
      const files = Array.from(el.files || []).map(f => f.name).join(', ');
      sendAction({
        type: 'file',
        elementType: 'file',
        label: getElementLabel(el),
        value: files || 'selected file'
      });
    }
  }, true);

  /** 4. SUBMIT — form submissions */
  document.addEventListener('submit', (e) => {
    if (!isRecording) return;

    const form = e.target;
    const label =
      form.getAttribute('aria-label') ||
      form.getAttribute('name') ||
      form.id ||
      'form';

    sendAction({
      type: 'submit',
      elementType: 'form',
      label: clean(label)
    });
  }, true);

  /** 5. KEY SHORTCUTS — Enter/Space on focused elements */
  document.addEventListener('keydown', (e) => {
    if (!isRecording) return;

    const el = e.target;
    const elType = getElementType(el);

    // Enter on non-input → treat as click
    if (e.key === 'Enter' && !isTextInput(el)) {
      if (['button', 'link', 'menuitem', 'tab'].includes(elType)) {
        // Already captured by click listener in most cases, skip to avoid dup
      }
    }

    // Keyboard shortcut detection (Ctrl/Cmd + key)
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      const shortcuts = { s: 'Save', z: 'Undo', y: 'Redo', c: 'Copy', v: 'Paste', a: 'Select All' };
      if (shortcuts[key]) {
        sendAction({
          type: 'hotkey',
          elementType: 'keyboard',
          label: `${e.ctrlKey ? 'Ctrl' : 'Cmd'}+${e.key.toUpperCase()}`,
          value: shortcuts[key]
        });
      }
    }
  }, true);

  // ===========================================================
  //  HOVER / ASSERTION HINTS (Right-click context)
  // ===========================================================
  // On right-click, we record a "verify" assertion step
  document.addEventListener('contextmenu', (e) => {
    if (!isRecording) return;

    const el = e.target;
    const text = el.textContent.trim().slice(0, 60);
    if (!text) return;

    sendAction({
      type: 'assert',
      elementType: 'assertion',
      label: getElementLabel(el),
      value: text
    });
  }, true);

})();
