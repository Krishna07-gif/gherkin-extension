// content.js — Page Event Recorder v2
(function () {
  'use strict';
  if (window.__gherkinRecorderInjected) return;
  window.__gherkinRecorderInjected = true;

  let isRecording = false;
  let inputDebounceMap = new Map();
  let pendingInputMap  = new Map();
  let scrollDebounce   = null;
  let lastScrollY      = window.scrollY;
  let lastScrollX      = window.scrollX;

  chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' }, (resp) => {
    if (chrome.runtime.lastError) return;
    if (resp) isRecording = resp.isRecording;
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SET_RECORDING_STATE') {
      isRecording = message.isRecording;
      sendResponse({ success: true });
    }
    return true;
  });

  // ── Element helpers ──────────────────────────────────────
  function getElementLabel(el) {
    const a = el.getAttribute('aria-label');
    if (a?.trim()) return clean(a);

    const lbId = el.getAttribute('aria-labelledby');
    if (lbId) {
      const ref = document.getElementById(lbId);
      if (ref?.textContent.trim()) return clean(ref.textContent);
    }

    if (el.id) {
      const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (lbl?.textContent.trim()) return clean(lbl.textContent);
    }

    const wrapLabel = el.closest('label');
    if (wrapLabel) {
      const t = wrapLabel.textContent.replace(el.value || '', '').trim();
      if (t) return clean(t);
    }

    if (el.placeholder?.trim()) return clean(el.placeholder);
    if (el.title?.trim())       return clean(el.title);
    if (el.name?.trim())        return prettifyName(el.name);

    const tc = el.textContent.trim();
    if (tc && tc.length <= 80)  return clean(tc);

    if (el.value && ['button','submit','reset'].includes(el.type)) return clean(el.value);
    if (el.alt?.trim())         return clean(el.alt);

    for (const attr of ['data-testid','data-cy','data-qa','data-test']) {
      const v = el.getAttribute(attr);
      if (v?.trim()) return prettifyName(v);
    }

    return getCSSSelector(el);
  }

  function prettifyName(n) {
    return n.replace(/[-_]/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').trim();
  }
  function clean(t) { return t.replace(/\s+/g,' ').trim().slice(0,60); }
  function getCSSSelector(el) {
    if (el.id) return `#${el.id}`;
    const tag = el.tagName.toLowerCase();
    const cls = Array.from(el.classList).slice(0,2).join('.');
    return cls ? `${tag}.${cls}` : tag;
  }

  function getElementType(el) {
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'a')        return 'link';
    if (tag === 'select')   return 'select';
    if (tag === 'textarea') return 'input';
    if (tag === 'button')   return 'button';
    if (tag === 'input') {
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio')    return 'radio';
      if (['submit','button','reset'].includes(type)) return 'button';
      if (type === 'file')     return 'file';
      return 'input';
    }
    if (role === 'button')   return 'button';
    if (role === 'link')     return 'link';
    if (role === 'checkbox') return 'checkbox';
    if (role === 'radio')    return 'radio';
    if (role === 'menuitem') return 'menuitem';
    if (role === 'tab')      return 'tab';
    if (role === 'combobox') return 'select';
    if (window.getComputedStyle(el).cursor === 'pointer') return 'clickable';
    return 'element';
  }

  function isTextInput(el) {
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') return !['checkbox','radio','button','submit','reset','file','hidden','image'].includes(type);
    if (el.getAttribute('contenteditable') === 'true') return true;
    return false;
  }

  function shouldSkipClick(el) {
    if (getElementType(el) === 'input') return true;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return true;
    if (['BODY','HTML'].includes(el.tagName)) return true;
    return false;
  }

  // ── Send action ──────────────────────────────────────────
  function sendAction(action) {
    if (!isRecording) return;
    chrome.runtime.sendMessage({
      type: 'RECORD_ACTION',
      action: { ...action, timestamp: Date.now(), pageUrl: window.location.href }
    }).catch(() => {});
  }

  // ── Click ────────────────────────────────────────────────
  document.addEventListener('click', (e) => {
    if (!isRecording) return;
    let el = e.target;
    let candidate = el;
    for (let i = 0; i < 5; i++) {
      const t = getElementType(candidate);
      if (['button','link','checkbox','radio','tab','menuitem'].includes(t)) { el = candidate; break; }
      if (!candidate.parentElement) break;
      candidate = candidate.parentElement;
    }
    if (shouldSkipClick(el)) return;
    const elType = getElementType(el);
    sendAction({ type: 'click', elementType: elType, label: getElementLabel(el),
                 tag: el.tagName.toLowerCase(), checked: el.checked !== undefined ? el.checked : null });
  }, true);

  // ── Input (debounced) ────────────────────────────────────
  document.addEventListener('input', (e) => {
    if (!isRecording) return;
    const el = e.target;
    if (!isTextInput(el)) return;
    const label     = getElementLabel(el);
    const inputType = (el.type || 'text').toLowerCase();
    pendingInputMap.set(el, { label, value: inputType === 'password' ? '••••••' : el.value, inputType });
    clearTimeout(inputDebounceMap.get(el));
    inputDebounceMap.set(el, setTimeout(() => {
      const p = pendingInputMap.get(el);
      if (p?.value) sendAction({ type: 'input', elementType: 'input', label: p.label, value: p.value, inputType: p.inputType });
      inputDebounceMap.delete(el);
      pendingInputMap.delete(el);
    }, 1200));
  }, true);

  // ── Change (select/checkbox/radio/file) ──────────────────
  document.addEventListener('change', (e) => {
    if (!isRecording) return;
    const el   = e.target;
    const tag  = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();
    if (tag === 'select') {
      const opt = el.options[el.selectedIndex];
      sendAction({ type: 'select', elementType: 'select', label: getElementLabel(el), value: opt ? opt.text.trim() : el.value });
    } else if (type === 'checkbox') {
      sendAction({ type: 'checkbox', elementType: 'checkbox', label: getElementLabel(el), checked: el.checked });
    } else if (type === 'radio') {
      sendAction({ type: 'radio', elementType: 'radio', label: getElementLabel(el), value: getElementLabel(el) });
    } else if (type === 'file') {
      const files = Array.from(el.files || []).map(f => f.name).join(', ');
      sendAction({ type: 'file', elementType: 'file', label: getElementLabel(el), value: files || 'selected file' });
    }
  }, true);

  // ── Submit ───────────────────────────────────────────────
  document.addEventListener('submit', (e) => {
    if (!isRecording) return;
    const form  = e.target;
    const label = form.getAttribute('aria-label') || form.getAttribute('name') || form.id || 'form';
    sendAction({ type: 'submit', elementType: 'form', label: label.trim().slice(0, 60) });
  }, true);

  // ── Keyboard shortcuts ────────────────────────────────────
  document.addEventListener('keydown', (e) => {
    if (!isRecording) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      const shorts = { s: 'Save', z: 'Undo', y: 'Redo', c: 'Copy', v: 'Paste', a: 'Select All', f: 'Find', p: 'Print' };
      if (shorts[key]) {
        sendAction({ type: 'hotkey', elementType: 'keyboard',
                     label: `${e.ctrlKey ? 'Ctrl' : 'Cmd'}+${e.key.toUpperCase()}`, value: shorts[key] });
      }
    }
    // Special keys
    if (['Escape','Enter','Tab'].includes(e.key) && !isTextInput(document.activeElement)) {
      if (e.key === 'Escape') sendAction({ type: 'hotkey', elementType: 'keyboard', label: 'Escape', value: 'Dismiss' });
    }
  }, true);

  // ── Scroll (debounced, significant movement only) ─────────
  document.addEventListener('scroll', () => {
    if (!isRecording) return;
    clearTimeout(scrollDebounce);
    scrollDebounce = setTimeout(() => {
      const dy = window.scrollY - lastScrollY;
      const dx = window.scrollX - lastScrollX;
      const sig = Math.abs(dy) > 200 || Math.abs(dx) > 200; // only significant scrolls
      if (!sig) return;
      const dir = Math.abs(dy) >= Math.abs(dx)
        ? (dy > 0 ? 'down' : 'up')
        : (dx > 0 ? 'right' : 'left');
      const pct = Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100);
      sendAction({ type: 'scroll', elementType: 'scroll', label: `Scroll ${dir}`,
                   direction: dir, scrollY: Math.round(window.scrollY),
                   scrollPercent: isNaN(pct) ? 0 : pct });
      lastScrollY = window.scrollY;
      lastScrollX = window.scrollX;
    }, 600);
  }, { passive: true });

  // ── Right-click assertion ─────────────────────────────────
  document.addEventListener('contextmenu', (e) => {
    if (!isRecording) return;
    const el   = e.target;
    const text = el.textContent.trim().slice(0, 60);
    if (!text) return;
    sendAction({ type: 'assert', elementType: 'assertion', label: getElementLabel(el), value: text });
  }, true);

  // ── Drag & Drop ───────────────────────────────────────────
  let dragSourceLabel = '';
  document.addEventListener('dragstart', (e) => {
    if (!isRecording) return;
    dragSourceLabel = getElementLabel(e.target);
  }, true);
  document.addEventListener('drop', (e) => {
    if (!isRecording) return;
    const target = getElementLabel(e.target);
    if (dragSourceLabel && target) {
      sendAction({ type: 'dragdrop', elementType: 'dragdrop',
                   label: dragSourceLabel, value: target });
    }
    dragSourceLabel = '';
  }, true);

  // ── Clipboard paste detection ─────────────────────────────
  document.addEventListener('paste', (e) => {
    if (!isRecording) return;
    const el = e.target;
    if (!isTextInput(el)) return;
    const text = e.clipboardData?.getData('text')?.slice(0, 80) || 'clipboard content';
    sendAction({ type: 'paste', elementType: 'input', label: getElementLabel(el), value: text });
  }, true);

})();
