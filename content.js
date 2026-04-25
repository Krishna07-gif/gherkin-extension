// content.js — Page Event Recorder v3 (settings-aware + recording overlay)
(function () {
  'use strict';
  if (window.__gherkinRecorderInjected) return;
  window.__gherkinRecorderInjected = true;

  let isRecording = false;
  let isPaused    = false;
  let settings    = { screenshots: true, scrolls: false, hotkeys: false, rightClick: true, maskPass: true, debounce: 1200 };
  let inputDebounceMap = new Map();
  let pendingInputMap  = new Map();
  let scrollDebounce   = null;
  let lastScrollY = window.scrollY, lastScrollX = window.scrollX;
  let dragSourceLabel = '';

  // Fetch initial state + settings
  chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATE' }, resp => {
    if (chrome.runtime.lastError) return;
    if (resp) isRecording = resp.isRecording;
  });
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, resp => {
    if (resp?.settings) settings = { ...settings, ...resp.settings };
  });

  // ── Message listener ──────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (msg.type === 'SET_RECORDING_STATE') {
      const wasRecording = isRecording;
      isRecording = msg.isRecording;
      isPaused    = msg.isPaused || false;
      if (msg.settings) settings = { ...settings, ...msg.settings };
      if (isRecording && !wasRecording) showOverlay();
      else if (!isRecording && wasRecording) removeOverlay();
      else if (isRecording) updateOverlay();
      sendResponse({ success: true });
    }
    if (msg.type === 'UPDATE_SETTINGS') {
      if (msg.settings) settings = { ...settings, ...msg.settings };
      sendResponse({ success: true });
    }
    // Overlay control from background when pause triggered from overlay itself
    if (msg.type === 'OVERLAY_PAUSE_STATE') {
      isPaused = msg.isPaused; updateOverlay(); sendResponse({ success: true });
    }
    return true;
  });

  // ════════════════════════════════════════════════════
  //  RECORDING OVERLAY — floating indicator on the page
  // ════════════════════════════════════════════════════
  let overlay = null, isDragging = false, dragOffX = 0, dragOffY = 0;

  function showOverlay() {
    removeOverlay();
    overlay = document.createElement('div');
    overlay.id = '__gherkin_rec_overlay__';

    // Inline all styles — no external CSS in content scripts
    Object.assign(overlay.style, {
      position:     'fixed',
      top:          '14px',
      right:        '14px',
      zIndex:       '2147483647',
      display:      'flex',
      alignItems:   'center',
      gap:          '8px',
      padding:      '8px 14px',
      background:   'rgba(12,12,22,0.92)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border:       '1px solid rgba(255,85,119,0.45)',
      borderRadius: '40px',
      boxShadow:    '0 4px 24px rgba(0,0,0,0.55)',
      fontFamily:   '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize:     '12px',
      fontWeight:   '600',
      cursor:       'grab',
      userSelect:   'none',
      transition:   'opacity 200ms',
    });

    overlay.innerHTML = `
      <span id="__grec_dot__" style="
        width:9px;height:9px;border-radius:50%;background:#FF5577;
        display:inline-block;flex-shrink:0;
        box-shadow:0 0 0 3px rgba(255,85,119,0.3);
        animation:__gRecPulse__ 1.3s ease-in-out infinite;
      "></span>
      <span id="__grec_label__" style="color:#f0f0ff;letter-spacing:0.5px">REC</span>
      <button id="__grec_pause__" title="Pause recording" style="
        background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);
        color:#f0f0ff;padding:3px 8px;border-radius:20px;cursor:pointer;
        font-size:11px;font-weight:700;transition:background 150ms;
      ">⏸</button>
      <button id="__grec_stop__" title="Stop recording" style="
        background:rgba(255,85,119,0.15);border:1px solid rgba(255,85,119,0.4);
        color:#FF5577;padding:3px 8px;border-radius:20px;cursor:pointer;
        font-size:11px;font-weight:700;transition:background 150ms;
      ">⏹</button>
      <span style="font-size:14px">🧪</span>
    `;

    // Inject keyframe animation via a style tag (once)
    if (!document.getElementById('__gherkin_rec_style__')) {
      const style = document.createElement('style');
      style.id = '__gherkin_rec_style__';
      style.textContent = `
        @keyframes __gRecPulse__ {
          0%,100%{box-shadow:0 0 0 3px rgba(255,85,119,0.3);}
          50%{box-shadow:0 0 0 6px rgba(255,85,119,0);}
        }
      `;
      document.head.appendChild(style);
    }

    // Drag to move
    overlay.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      dragOffX = e.clientX - overlay.getBoundingClientRect().left;
      dragOffY = e.clientY - overlay.getBoundingClientRect().top;
      overlay.style.cursor = 'grabbing';
      e.preventDefault();
    });
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragUp);

    // Pause button
    overlay.querySelector('#__grec_pause__').addEventListener('click', e => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'PAUSE_RECORDING' }, resp => {
        if (resp) { isPaused = resp.isPaused; updateOverlay(); }
      });
    });

    // Stop button — stops recording AND opens extension popup
    overlay.querySelector('#__grec_stop__').addEventListener('click', e => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'STOP_RECORDING' }, () => {
        removeOverlay();
        // Open the extension popup by clicking the action button
        chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {});
      });
    });

    document.body.appendChild(overlay);
  }

  function updateOverlay() {
    if (!overlay) return;
    const dot   = overlay.querySelector('#__grec_dot__');
    const label = overlay.querySelector('#__grec_label__');
    const pauseBtn = overlay.querySelector('#__grec_pause__');
    if (isPaused) {
      dot.style.background = '#FFD166';
      dot.style.animation  = 'none';
      dot.style.boxShadow  = '0 0 0 3px rgba(255,209,102,0.3)';
      label.textContent    = 'PAUSED';
      label.style.color    = '#FFD166';
      overlay.style.borderColor = 'rgba(255,209,102,0.4)';
      pauseBtn.textContent = '▶';
      pauseBtn.title       = 'Resume recording';
    } else {
      dot.style.background = '#FF5577';
      dot.style.animation  = '__gRecPulse__ 1.3s ease-in-out infinite';
      dot.style.boxShadow  = '0 0 0 3px rgba(255,85,119,0.3)';
      label.textContent    = 'REC';
      label.style.color    = '#f0f0ff';
      overlay.style.borderColor = 'rgba(255,85,119,0.45)';
      pauseBtn.textContent = '⏸';
      pauseBtn.title       = 'Pause recording';
    }
  }

  function removeOverlay() {
    if (overlay) { overlay.remove(); overlay = null; }
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragUp);
  }

  function onDragMove(e) {
    if (!isDragging || !overlay) return;
    const x = Math.max(0, Math.min(window.innerWidth  - overlay.offsetWidth,  e.clientX - dragOffX));
    const y = Math.max(0, Math.min(window.innerHeight - overlay.offsetHeight, e.clientY - dragOffY));
    overlay.style.left  = x + 'px';
    overlay.style.top   = y + 'px';
    overlay.style.right = 'auto';
  }
  function onDragUp() { isDragging = false; if (overlay) overlay.style.cursor = 'grab'; }

  // ════════════════════════════════════════════════════
  //  ELEMENT HELPERS
  // ════════════════════════════════════════════════════
  function getLabel(el) {
    const a = el.getAttribute('aria-label'); if (a?.trim()) return clean(a);
    const lbId = el.getAttribute('aria-labelledby');
    if (lbId) { const r = document.getElementById(lbId); if (r?.textContent.trim()) return clean(r.textContent); }
    if (el.id) { const lbl = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (lbl?.textContent.trim()) return clean(lbl.textContent); }
    const wl = el.closest('label'); if (wl) { const t = wl.textContent.replace(el.value||'','').trim(); if (t) return clean(t); }
    if (el.placeholder?.trim()) return clean(el.placeholder);
    if (el.title?.trim())       return clean(el.title);
    if (el.name?.trim())        return prettify(el.name);
    const tc = el.textContent.trim(); if (tc && tc.length <= 80) return clean(tc);
    if (el.value && ['button','submit','reset'].includes(el.type)) return clean(el.value);
    if (el.alt?.trim()) return clean(el.alt);
    for (const attr of ['data-testid','data-cy','data-qa','data-test']) { const v = el.getAttribute(attr); if (v?.trim()) return prettify(v); }
    if (el.id) return `#${el.id}`;
    return el.tagName.toLowerCase() + (el.className ? '.' + Array.from(el.classList).slice(0,2).join('.') : '');
  }
  function prettify(n) { return n.replace(/[-_]/g,' ').replace(/([a-z])([A-Z])/g,'$1 $2').trim(); }
  function clean(t) { return t.replace(/\s+/g,' ').trim().slice(0,60); }

  function getElType(el) {
    const tag = el.tagName.toLowerCase(), type = (el.type||'').toLowerCase(), role = (el.getAttribute('role')||'').toLowerCase();
    if (tag==='a') return 'link'; if (tag==='select') return 'select'; if (tag==='textarea') return 'input'; if (tag==='button') return 'button';
    if (tag==='input') { if (type==='checkbox') return 'checkbox'; if (type==='radio') return 'radio'; if (['submit','button','reset'].includes(type)) return 'button'; if (type==='file') return 'file'; return 'input'; }
    if (role==='button') return 'button'; if (role==='link') return 'link'; if (role==='checkbox') return 'checkbox'; if (role==='tab') return 'tab'; if (role==='menuitem') return 'menuitem';
    if (window.getComputedStyle(el).cursor === 'pointer') return 'clickable';
    return 'element';
  }
  function isText(el) {
    const tag = el.tagName.toLowerCase(), type = (el.type||'').toLowerCase();
    if (tag==='textarea') return true;
    if (tag==='input') return !['checkbox','radio','button','submit','reset','file','hidden','image'].includes(type);
    return el.getAttribute('contenteditable')==='true';
  }

  function send(action) {
    if (!isRecording || isPaused) return;
    // Apply settings filter here too (belt-and-suspenders)
    if (action.type==='hotkey' && !settings.hotkeys)    return;
    if (action.type==='scroll' && !settings.scrolls)    return;
    if (action.type==='assert' && action.fromRightClick && !settings.rightClick) return;
    chrome.runtime.sendMessage({ type: 'RECORD_ACTION', action: { ...action, timestamp: Date.now(), pageUrl: window.location.href } }).catch(()=>{});
  }

  // ════════════════════════════════════════════════════
  //  EVENT LISTENERS
  // ════════════════════════════════════════════════════

  // Click
  document.addEventListener('click', e => {
    if (!isRecording||isPaused) return;
    // Ignore clicks inside our overlay
    if (e.target.closest('#__gherkin_rec_overlay__')) return;
    let el = e.target;
    let cand = el;
    for (let i=0; i<5; i++) {
      const t = getElType(cand);
      if (['button','link','checkbox','radio','tab','menuitem'].includes(t)) { el = cand; break; }
      if (!cand.parentElement) break; cand = cand.parentElement;
    }
    if (getElType(el)==='input') return;
    const rect = el.getBoundingClientRect();
    if (rect.width===0 && rect.height===0) return;
    if (['BODY','HTML'].includes(el.tagName)) return;
    send({ type:'click', elementType: getElType(el), label: getLabel(el), tag: el.tagName.toLowerCase(), checked: el.checked!==undefined ? el.checked : null });
  }, true);

  // Input (debounced — uses settings.debounce)
  document.addEventListener('input', e => {
    if (!isRecording||isPaused) return;
    const el = e.target; if (!isText(el)) return;
    const label = getLabel(el), itype = (el.type||'text').toLowerCase();
    // Mask password based on settings.maskPass
    const value = (itype==='password' && settings.maskPass!==false) ? '••••••' : el.value;
    pendingInputMap.set(el, { label, value, inputType: itype });
    clearTimeout(inputDebounceMap.get(el));
    const delay = settings.debounce || 1200;
    inputDebounceMap.set(el, setTimeout(() => {
      const p = pendingInputMap.get(el);
      if (p?.value) send({ type:'input', elementType:'input', label:p.label, value:p.value, inputType:p.inputType });
      inputDebounceMap.delete(el); pendingInputMap.delete(el);
    }, delay));
  }, true);

  // Change (select/checkbox/radio/file)
  document.addEventListener('change', e => {
    if (!isRecording||isPaused) return;
    const el = e.target, tag = el.tagName.toLowerCase(), type = (el.type||'').toLowerCase();
    if (tag==='select') { const opt = el.options[el.selectedIndex]; send({ type:'select', elementType:'select', label:getLabel(el), value: opt?opt.text.trim():el.value }); }
    else if (type==='checkbox') send({ type:'checkbox', elementType:'checkbox', label:getLabel(el), checked:el.checked });
    else if (type==='radio')    send({ type:'radio', elementType:'radio', label:getLabel(el), value:getLabel(el) });
    else if (type==='file') { const files = Array.from(el.files||[]).map(f=>f.name).join(', '); send({ type:'file', elementType:'file', label:getLabel(el), value:files||'selected file' }); }
  }, true);

  // Submit
  document.addEventListener('submit', e => {
    if (!isRecording||isPaused) return;
    const form = e.target, lbl = form.getAttribute('aria-label')||form.getAttribute('name')||form.id||'form';
    send({ type:'submit', elementType:'form', label:lbl.trim().slice(0,60) });
  }, true);

  // Keyboard shortcuts (respects settings.hotkeys)
  document.addEventListener('keydown', e => {
    if (!isRecording||isPaused||!settings.hotkeys) return;
    if ((e.ctrlKey||e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      const map = { s:'Save', z:'Undo', y:'Redo', c:'Copy', v:'Paste', a:'Select All', f:'Find', p:'Print' };
      if (map[k]) send({ type:'hotkey', elementType:'keyboard', label:`${e.ctrlKey?'Ctrl':'Cmd'}+${e.key.toUpperCase()}`, value:map[k] });
    }
  }, true);

  // Scroll (respects settings.scrolls, only significant movement)
  document.addEventListener('scroll', () => {
    if (!isRecording||isPaused||!settings.scrolls) return;
    clearTimeout(scrollDebounce);
    scrollDebounce = setTimeout(() => {
      const dy = window.scrollY - lastScrollY, dx = window.scrollX - lastScrollX;
      if (Math.abs(dy) < 200 && Math.abs(dx) < 200) return;
      const dir = Math.abs(dy)>=Math.abs(dx) ? (dy>0?'down':'up') : (dx>0?'right':'left');
      const tot = document.body.scrollHeight - window.innerHeight;
      const pct = tot > 0 ? Math.round((window.scrollY / tot) * 100) : 0;
      send({ type:'scroll', elementType:'scroll', label:`Scroll ${dir}`, direction:dir, scrollY:Math.round(window.scrollY), scrollPercent:pct });
      lastScrollY = window.scrollY; lastScrollX = window.scrollX;
    }, 600);
  }, { passive: true });

  // Right-click assertion (respects settings.rightClick)
  document.addEventListener('contextmenu', e => {
    if (!isRecording||isPaused) return;
    if (!settings.rightClick) return;
    if (e.target.closest('#__gherkin_rec_overlay__')) return;
    const text = e.target.textContent.trim().slice(0,60); if (!text) return;
    send({ type:'assert', elementType:'assertion', label:getLabel(e.target), value:text, fromRightClick:true });
  }, true);

  // Drag & drop
  document.addEventListener('dragstart', e => { if (!isRecording||isPaused||e.target.closest('#__gherkin_rec_overlay__')) return; dragSourceLabel = getLabel(e.target); }, true);
  document.addEventListener('drop', e => {
    if (!isRecording||isPaused) return;
    const target = getLabel(e.target);
    if (dragSourceLabel && target) send({ type:'dragdrop', elementType:'dragdrop', label:dragSourceLabel, value:target });
    dragSourceLabel = '';
  }, true);

  // Paste
  document.addEventListener('paste', e => {
    if (!isRecording||isPaused) return;
    const el = e.target; if (!isText(el)) return;
    const text = e.clipboardData?.getData('text')?.slice(0,80)||'clipboard content';
    send({ type:'paste', elementType:'input', label:getLabel(el), value:text });
  }, true);

})();
