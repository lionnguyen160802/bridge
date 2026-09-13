// inject.js — DOM Manipulator for Google Flow v4.4
// Runs in PAGE CONTEXT for full DOM + React access
// Communicates with content.js via window.postMessage
//
// Flow: hover card → click ⋮ → "Thêm vào câu lệnh" → nhập vào "Bạn muốn tạo gì?" → Enter

(function () {
  'use strict';

  // RE-INJECTION GUARD — prevent duplicate listeners & fetch wrapper chains on 24/7 VPS
  if (window._flowAutoInjectLoaded) {
    console.log('[FlowAuto:inject] Already loaded, skipping re-injection');
    return;
  }
  window._flowAutoInjectLoaded = true;

  let authToken = '';

  // --- Intercept Fetch for Token ---
  const _fetch = window.fetch;
  window.fetch = async function(...args) {
    try {
      const [url, opts] = args;
      const urlStr = (url || '').toString();
      if (urlStr.includes('googleapis.com')) {
        if (opts && opts.headers) {
          let auth = '';
          if (opts.headers instanceof Headers) auth = opts.headers.get('Authorization') || '';
          else if (typeof opts.headers === 'object') auth = opts.headers['Authorization'] || opts.headers['authorization'] || '';
          if (auth && auth.length > 20) authToken = auth.replace('Bearer ', '');
        }
      }
    } catch(e) {}
    return _fetch.apply(this, args);
  };

  // --- Intercept XHR for Token ---
  try {
    const _open = XMLHttpRequest.prototype.open;
    const _setHeader = XMLHttpRequest.prototype.setRequestHeader;
    XMLHttpRequest.prototype.open = function(method, url) {
      this._vUrl = (url || '').toString();
      return _open.apply(this, arguments);
    };
    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
      if (this._vUrl && this._vUrl.includes('googleapis.com') && name.toLowerCase() === 'authorization') {
        authToken = (value || '').replace('Bearer ', '');
      }
      return _setHeader.apply(this, arguments);
    };
  } catch(e) {}

  const TAG = '[FlowAuto:inject]';
  let renderObserver = null;
  let preexistingVideos = new Set();

  function capturePreexistingVideos() {
    preexistingVideos.clear();
    document.querySelectorAll('video').forEach(v => {
      if (v.src) preexistingVideos.add(v.src);
      if (v.currentSrc) preexistingVideos.add(v.currentSrc);
      v.querySelectorAll('source').forEach(s => { if (s.src) preexistingVideos.add(s.src); });
    });
    log('📸 Captured ' + preexistingVideos.size + ' pre-existing video URLs to ignore.');
  }

  function log(msg) {
    console.log(TAG, msg);
    window.postMessage({ type: 'FLOW_LOG', message: msg }, '*');
  }

  // ==========================================
  // CSS INJECTION — Removed force visibility CSS
  // Previously injected rules with pointer-events: auto !important on overlay containers
  // caused UI click interception and severe lag on Google Flow.
  // ==========================================
  const existingForceCss = document.getElementById('flowauto-force-css');
  if (existingForceCss) existingForceCss.remove();

  // ==========================================
  // RESULT SENDER
  // ==========================================
  function sendResult(action, success, data, error) {
    window.postMessage({
      type: 'FLOW_INJECT_RESULT',
      action: action,
      success: success,
      data: data || {},
      error: error || null
    }, '*');
  }

  // ==========================================
  // DOM UTILITIES
  // ==========================================
  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      parseFloat(style.opacity) > 0;
  }

  function scrollIntoViewIfNeeded(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function waitForCondition(checkFn, timeout = 5000) {
    return new Promise((resolve) => {
      const immediate = checkFn();
      if (immediate) { resolve(immediate); return; }

      let resolved = false;
      const observer = new MutationObserver(() => {
        if (resolved) return;
        const result = checkFn();
        if (result) {
          resolved = true;
          observer.disconnect();
          resolve(result);
        }
      });

      observer.observe(document.body, {
        childList: true, subtree: true,
        attributes: true, characterData: true
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          resolve(null);
        }
      }, timeout);
    });
  }

  // ==========================================
  // EVENT SIMULATORS (React-compatible)
  // ==========================================
  function getCenter(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function simulateHover(el) {
    if (!el) return false;
    scrollIntoViewIfNeeded(el);
    const { x, y } = getCenter(el);
    const opts = {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y,
      screenX: window.screenX + x, screenY: window.screenY + y,
      pointerId: 1, pointerType: 'mouse', view: window
    };
    ['pointerover', 'pointerenter', 'pointermove'].forEach(t =>
      el.dispatchEvent(new PointerEvent(t, opts)));
    ['mouseover', 'mouseenter', 'mousemove'].forEach(t =>
      el.dispatchEvent(new MouseEvent(t, opts)));
    // Also hover children for React delegation
    const child = el.querySelector('*');
    if (child) {
      try {
        child.dispatchEvent(new PointerEvent('pointermove', opts));
        child.dispatchEvent(new MouseEvent('mousemove', opts));
      } catch (e) { }
    }
    return true;
  }

  function simulateClick(el) {
    if (!el) return false;
    scrollIntoViewIfNeeded(el);
    const { x, y } = getCenter(el);
    const opts = {
      bubbles: true, cancelable: true, composed: true,
      clientX: x, clientY: y,
      screenX: window.screenX + x, screenY: window.screenY + y,
      button: 0, buttons: 1, detail: 1,
      pointerId: 1, pointerType: 'mouse', view: window
    };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    setTimeout(() => {
      const up = { ...opts, buttons: 0 };
      el.dispatchEvent(new PointerEvent('pointerup', up));
      el.dispatchEvent(new MouseEvent('mouseup', up));
      el.dispatchEvent(new MouseEvent('click', up));
    }, 30 + Math.random() * 40);
    return true;
  }

  // ==========================================
  // TEXT INJECTION (React/Angular/Lit/Wiz compatible)
  // Multiple strategies to ensure framework state is updated
  // ==========================================

  function injectTextToReactInput(el, text) {
    if (!el) return false;
    log('💉 Injecting text into <' + el.tagName + '> ce=' + el.getAttribute('contenteditable') + ' role=' + (el.getAttribute('role') || ''));

    el.focus();
    el.click();

    const isContentEditable = el.getAttribute('contenteditable') === 'true';

    // Find the deep leaf node inside contenteditable (e.g. <p> or <span>) to avoid breaking rich text models
    let targetContainer = el;
    if (isContentEditable) {
      let inner = el.querySelector('p');
      if (!inner) inner = el.querySelector('span');
      if (!inner && el.firstElementChild) inner = el.firstElementChild;
      if (inner) {
        targetContainer = inner;
        log('💉 Targeting leaf container: <' + inner.tagName + '>');
      }
    }

    // Move cursor to the end of the container to APPEND text (preserving chips/pills!)
    function moveCursorToEnd() {
      try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(targetContainer);
        range.collapse(false); // false = collapse to end
        selection.removeAllRanges();
        selection.addRange(range);
      } catch (e) {
        log('⚠️ caret adjustment error: ' + e.message);
      }
    }

    // Safely appends DOM content while bypassing React's value interceptor
    function appendDOMValue(val) {
      if (isContentEditable) {
        const textNode = document.createTextNode(val);
        targetContainer.appendChild(textNode);
        moveCursorToEnd();
      } else {
        const newVal = (el.value || '') + val;
        try {
          const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (nativeSetter) nativeSetter.call(el, newVal);
          else el.value = newVal;
        } catch(e) {
          el.value = newVal;
        }
        
        try {
          const tracker = el._valueTracker;
          if (tracker) tracker.setValue(el.value === newVal ? '' : el.value);
        } catch (e) {}
      }
    }

    // Fire the complete event chain that frameworks listen to
    function fireEventSequence(inputType, val, skipDOMUpdate = false) {
      const opts = { bubbles: true, composed: true };
      el.dispatchEvent(new FocusEvent('focus', opts));
      
      el.dispatchEvent(new KeyboardEvent('keydown', { ...opts, key: 'Process', keyCode: 229 }));
      
      // Composition events are crucial for many modern rich text editors
      el.dispatchEvent(new CompositionEvent('compositionstart', { ...opts, data: '' }));
      el.dispatchEvent(new CompositionEvent('compositionupdate', { ...opts, data: val }));
      
      el.dispatchEvent(new InputEvent('beforeinput', { ...opts, cancelable: true, inputType: inputType, data: val }));

      if (!skipDOMUpdate) {
        appendDOMValue(val);
      }

      el.dispatchEvent(new InputEvent('input', { ...opts, cancelable: true, inputType: inputType, data: val }));
      el.dispatchEvent(new CompositionEvent('compositionend', { ...opts, data: val }));
      
      el.dispatchEvent(new Event('change', opts));
      el.dispatchEvent(new KeyboardEvent('keyup', { ...opts, key: 'Process', keyCode: 229 }));
      
      // Blur is essential to trigger validators in Angular & Lit
      el.dispatchEvent(new FocusEvent('blur', opts));
      
      // Force sync to Custom Element ancestors (Lit/Web Components/Wiz)
      let curr = el;
      while (curr && curr !== document.body) {
        if (curr.tagName && curr.tagName.includes('-')) {
          try {
            if ('value' in curr) {
               if (typeof curr.value === 'string' && !curr.value.includes(val)) {
                  curr.value = curr.value + val;
               } else if (typeof curr.value !== 'string') {
                  curr.value = val;
               }
            }
            curr.dispatchEvent(new Event('input', opts));
            curr.dispatchEvent(new Event('change', opts));
          } catch(e) {}
        }
        curr = curr.parentElement;
      }
      
      el.focus();
    }

    // ALWAYS MOVE CURSOR TO END BEFORE ANY STRATEGY
    if (isContentEditable) moveCursorToEnd();

    // === Strategy 1: Paste Event + DataTransfer + Event Chain ===
    try {
      log('💉 Strategy 1: Simulate Clipboard Paste...');
      
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: dt });
      el.dispatchEvent(pasteEvent);

      // We still fire the sequence, but we update DOM just in case paste didn't
      fireEventSequence('insertFromPaste', text, false);

      const val = isContentEditable ? el.textContent : el.value;
      if (val && val.includes(text.substring(0, 10))) {
        log('✓ Strategy 1 paste + chain succeeded!');
        return true;
      }
    } catch (e) {
      log('⚠️ Strategy 1 error: ' + e.message);
    }

    // === Strategy 2: execCommand insertText (APPEND) ===
    try {
      log('💉 Strategy 2: execCommand insertText...');
      el.focus();
      moveCursorToEnd();

      el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, composed: true, inputType: 'insertText', data: text }));

      const ok = document.execCommand('insertText', false, text);
      if (ok) {
        log('✓ execCommand returned true');
        fireEventSequence('insertText', text, true); // skip DOM update because execCommand did it
        const val = isContentEditable ? el.textContent : el.value;
        if (val && val.includes(text.substring(0, 5))) {
          log('✓ Strategy 2 execCommand succeeded!');
          return true;
        }
      }
    } catch (e) {
      log('⚠️ Strategy 2 error: ' + e.message);
    }

    // === Strategy 3: React Internal Prop & Event Handlers directly ===
    try {
      log('💉 Strategy 3: Direct React Handler invocation...');
      let reactKey = null;
      let targetEl = el;
      for (let i = 0; i < 4 && targetEl; i++) {
        reactKey = Object.keys(targetEl).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
        if (reactKey) break;
        targetEl = targetEl.parentElement;
      }

      if (reactKey && targetEl[reactKey]) {
        log('✓ Found React key: ' + reactKey);
        const props = targetEl[reactKey];
        if (typeof props.onChange === 'function') {
          props.onChange({ target: el, currentTarget: el, type: 'change', preventDefault: () => {}, stopPropagation: () => {} });
        }
        if (typeof props.onInput === 'function') {
          props.onInput({ target: el, currentTarget: el, type: 'input', preventDefault: () => {}, stopPropagation: () => {} });
        }
      }

      fireEventSequence('insertText', text, false);
      return true;
    } catch (e) {
      log('⚠️ Strategy 3 error: ' + e.message);
    }

    // === Strategy 4: Basic direct fallback + events ===
    try {
      log('💉 Strategy 4: Direct fallback...');
      fireEventSequence('insertText', text, false);
      return true;
    } catch (e) {
      log('⚠️ Strategy 4 error: ' + e.message);
    }

    log('❌ All injection strategies failed');
    return false;
  }

  // ==========================================
  // ELEMENT FINDERS
  // ==========================================

  function findSearchBar() {
    const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])');
    for (const el of inputs) {
      if (!isVisible(el)) continue;
      const ph = (el.getAttribute('placeholder') || '').toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      if (ph.includes('tìm kiếm') || ph.includes('search') || aria.includes('tìm kiếm') || aria.includes('search')) {
        // Must be in the top half (exclude prompt input)
        if (el.getBoundingClientRect().top < window.innerHeight / 2) {
          return el;
        }
      }
    }
    return null;
  }

  function clearSearchInput(el) {
    if (!el) return;
    el.focus();
    
    // Strategy 1: Native setter (React-compatible)
    try {
      const proto = window.HTMLInputElement.prototype;
      const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (nativeSetter) nativeSetter.call(el, '');
      else el.value = '';
    } catch(e) { el.value = ''; }
    
    // Strategy 2: Keyboard simulation — Ctrl+A then Delete (most reliable for React/Angular)
    try {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true }));
      el.select && el.select();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true }));
      el.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'deleteContentBackward' }));
    } catch(e) {}

    // Strategy 3: Fire standard events
    const opts = { bubbles: true, composed: true };
    el.dispatchEvent(new Event('input', opts));
    el.dispatchEvent(new Event('change', opts));
    
    // Clear React internal tracker
    try {
      const tracker = el._valueTracker;
      if (tracker) tracker.setValue('x'); // Force React to see the change
    } catch(e) {}
    
    el.dispatchEvent(new Event('input', opts));
  }

  /** Find character card by name */
  function findCharacterCard(name) {
    if (!name) return null;
    const nameLower = name.toLowerCase();

    // Strategy 1: img alt text
    for (const img of document.querySelectorAll('img')) {
      const alt = (img.alt || '').toLowerCase();
      if (alt && alt.includes(nameLower)) {
        const card = climbToCard(img);
        if (card && isVisible(card)) return { card, img, method: 'alt' };
      }
    }
    // Strategy 2: aria-label
    for (const el of document.querySelectorAll('[aria-label]')) {
      if (el.getAttribute('aria-label').toLowerCase().includes(nameLower) && isVisible(el)) {
        return { card: climbToCard(el), img: null, method: 'aria-label' };
      }
    }
    // Strategy 3: text content
    for (const el of document.querySelectorAll('[role="button"], [role="listitem"], [tabindex]')) {
      if ((el.textContent?.trim().toLowerCase() || '').includes(nameLower) && isVisible(el)) {
        return { card: el, img: null, method: 'text' };
      }
    }
    return null;
  }

  function climbToCard(el) {
    let current = el;
    for (let d = 0; d < 12 && current && current !== document.body; d++) {
      const role = current.getAttribute('role');
      const ti = current.getAttribute('tabindex');
      if (role === 'button' || role === 'listitem' || role === 'option' ||
        current.tagName === 'BUTTON' || current.tagName === 'A' ||
        ti === '0' || ti === '-1') {
        return current;
      }
      current = current.parentElement;
    }
    return el.parentElement?.parentElement || el.parentElement;
  }

  /** Find ⋮ (three-dots "Khác") button on/near a character card */
  function findMoreButton(characterName) {
    const cardResult = findCharacterCard(characterName);
    if (!cardResult) return null;
    const card = cardResult.card;
    const img = cardResult.img;

    log('🔍 Searching ⋮ on card (tag=' + card.tagName + ')');

    // Strategy 1: aria-label up to 4 parent levels
    const ariaKW = ['Khác', 'More', 'more', 'Menu', 'Options'];
    let root = card;
    for (let lvl = 0; lvl < 4; lvl++) {
      for (const kw of ariaKW) {
        const btn = root.querySelector('[aria-label*="' + kw + '"]');
        if (btn && isVisible(btn)) { log('✓ ⋮ via aria (lvl ' + lvl + ')'); return btn; }
      }
      const tb = root.querySelector('[data-tooltip*="Khác"], [title*="Khác"], [data-tooltip*="More"], [title*="More"]');
      if (tb && isVisible(tb)) { log('✓ ⋮ via tooltip'); return tb; }
      root = root.parentElement || root;
    }

    // Strategy 2: icon-only buttons in expanded area
    const area = card.parentElement?.parentElement || card.parentElement || card;
    for (const btn of area.querySelectorAll('button, [role="button"]')) {
      if (btn === card) continue;
      const text = btn.textContent?.trim() || '';
      const al = (btn.getAttribute('aria-label') || '').toLowerCase();
      if (text === '⋮' || text === '︙' || text === '…' ||
        al.includes('more') || al.includes('khác') || al.includes('menu')) {
        if (isVisible(btn)) { log('✓ ⋮ via text/aria'); return btn; }
      }
      if (text.length <= 2 && btn.querySelector('svg, [class*="icon"]')) {
        const r = btn.getBoundingClientRect();
        const cr = (img || card).getBoundingClientRect();
        if (r.width > 0 && r.width < 50 && Math.abs(r.right - cr.right) < 60 && Math.abs(r.top - cr.top) < 60) {
          log('✓ ⋮ via icon position'); return btn;
        }
      }
    }

    // Strategy 3: elementFromPoint probes
    const target = img || card;
    const tr = target.getBoundingClientRect();
    const probes = [
      { x: tr.right - 18, y: tr.top + 18 }, { x: tr.right - 12, y: tr.top + 24 },
      { x: tr.right - 24, y: tr.top + 12 }, { x: tr.right - 8, y: tr.top + 8 },
      { x: tr.right - 18, y: tr.top + 30 }, { x: tr.right - 40, y: tr.top + 18 },
    ];
    for (const p of probes) {
      if (p.x < 0 || p.y < 0) continue;
      let el = document.elementFromPoint(p.x, p.y);
      for (let d = 0; d < 5 && el; d++) {
        if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
          const ca = (el.getAttribute('aria-label') || '').toLowerCase();
          if (el !== card && !ca.includes('thích') && !ca.includes('like') && !ca.includes('favorite')) {
            log('✓ ⋮ via elementFromPoint (' + Math.round(p.x) + ',' + Math.round(p.y) + ')');
            return el;
          }
        }
        el = el.parentElement;
      }
    }

    // Strategy 4: global
    for (const btn of document.querySelectorAll('button, [role="button"]')) {
      const al = (btn.getAttribute('aria-label') || '').toLowerCase();
      const ti = (btn.getAttribute('title') || '').toLowerCase();
      if ((al.includes('khác') || ti.includes('khác') || al === 'more_vert') && isVisible(btn)) {
        log('✓ ⋮ via global'); return btn;
      }
    }

    // Debug dump
    log('❌ ⋮ not found. Dumping card area:');
    let dc = 0;
    for (const el of area.querySelectorAll('*')) {
      if (dc > 25) break;
      const tag = el.tagName.toLowerCase(), role = el.getAttribute('role') || '';
      const aria = el.getAttribute('aria-label') || '', title = el.getAttribute('title') || '';
      if (tag === 'button' || role === 'button' || aria || title || tag === 'svg') {
        log('  <' + tag + '> role="' + role + '" aria="' + aria + '" title="' + title + '" vis=' + isVisible(el));
        dc++;
      }
    }
    return null;
  }

  /** Find button by text content */
  function findButtonByText(searchText) {
    for (const el of document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"]')) {
      if ((el.textContent?.trim() || '').includes(searchText) && isVisible(el)) return el;
    }
    for (const el of document.querySelectorAll('span, div, a')) {
      const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
      if (own.includes(searchText) && isVisible(el)) return climbToCard(el);
    }
    return null;
  }

  /** Find prompt input "Bạn muốn tạo những gì?" at the bottom prompt bar */
  function findPromptInput() {
    const placeholders = [
      'Bạn muốn tạo những gì',
      'Bạn muốn tạo gì',
      'What do you want to create',
      'Start creating or drop media',
      'Bắt đầu tạo hoặc thả nội dung nghe nhìn',
      'Nhập câu lệnh'
    ];
    const viewH = window.innerHeight;

    // Helper: Check if element is the bottom prompt bar input (not search/title)
    function isPromptBarInput(el) {
      if (!isVisible(el)) return false;
      // Must NOT be a search input
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'search') return false;
      const role = (el.getAttribute('role') || '').toLowerCase();
      if (role === 'search' || role === 'searchbox') return false;
      const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
      if (ariaLabel.includes('search') || ariaLabel.includes('tìm kiếm')) return false;
      // Must be in the lower part of the viewport (ignore top navigation search bars)
      const rect = el.getBoundingClientRect();
      if (rect.top < 100) return false;
      return true;
    }

    // Strategy 1: EXACT placeholder match — highest priority
    const allInputs = document.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable="true"]');
    for (const el of allInputs) {
      const ph = el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') ||
                 el.getAttribute('data-placeholder') || '';
      for (const p of placeholders) {
        if (ph.includes(p) && isVisible(el)) {
          log('✓ findPromptInput: matched by placeholder "' + ph + '" at y=' + Math.round(el.getBoundingClientRect().top));
          return el;
        }
      }
    }

    // Strategy 2: Look for contenteditable with "Bạn muốn tạo gì?" nearby text
    for (const el of document.querySelectorAll('[contenteditable="true"]')) {
      if (!isPromptBarInput(el)) continue;
      // Check if parent/sibling has the placeholder text
      const parent = el.parentElement;
      if (parent) {
        const parentText = parent.textContent || '';
        for (const p of placeholders) {
          if (parentText.includes(p)) {
            log('✓ findPromptInput: contenteditable near placeholder text at y=' + Math.round(el.getBoundingClientRect().top));
            return el;
          }
        }
      }
    }

    // Strategy 3: Find input near "+ Tác nhân" / "+ Characters" button (they're in the same prompt bar)
    const tacNhanBtn = findButtonByText('Tác nhân') || findButtonByText('Characters');
    if (tacNhanBtn) {
      const btnRect = tacNhanBtn.getBoundingClientRect();
      for (const el of allInputs) {
        if (!isVisible(el)) continue;
        const r = el.getBoundingClientRect();
        if (Math.abs(r.bottom - btnRect.bottom) < 120) {
          log('✓ findPromptInput: near "' + tacNhanBtn.textContent.trim().substring(0, 15) + '" button at y=' + Math.round(r.top));
          return el;
        }
      }
    }

    // Strategy 4: Any visible input/textarea in the bottom viewport
    for (const el of allInputs) {
      if (isPromptBarInput(el)) {
        log('✓ findPromptInput: bottom-half input at y=' + Math.round(el.getBoundingClientRect().top));
        return el;
      }
    }

    // Debug: log ALL inputs found on page
    log('❌ findPromptInput: no match found. All inputs:');
    for (const el of allInputs) {
      const ph = el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || '';
      const rect = el.getBoundingClientRect();
      const type = el.getAttribute('type') || '';
      const role = el.getAttribute('role') || '';
      const tag = el.tagName.toLowerCase();
      const ce = el.getAttribute('contenteditable') || '';
      log('  <' + tag + '> type="' + type + '" role="' + role + '" ce="' + ce +
          '" ph="' + ph + '" y=' + Math.round(rect.top) + ' vis=' + isVisible(el));
    }

    return null;
  }

  /** Find '+' button in prompt bar */
  function findPlusButton() {
    const promptInput = findPromptInput();
    const promptContainer = promptInput ? (promptInput.closest('div[class*="prompt"], form, footer') || promptInput.parentElement?.parentElement?.parentElement) : null;
    const searchRoot = promptContainer || document;
    for (const btn of searchRoot.querySelectorAll('button, [role="button"]')) {
      const text = (btn.textContent || '').trim();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const title = (btn.getAttribute('title') || '').toLowerCase();
      if (text === '+' || aria.includes('thêm') || aria.includes('add') || aria.includes('upload') || title.includes('thêm') || title.includes('add')) {
        if (isVisible(btn)) return btn;
      }
      if (btn.querySelector('svg path[d*="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"]') || btn.querySelector('svg [d*="M12 5v14"]') || btn.querySelector('svg [d*="M5 12h14"]')) {
        if (isVisible(btn)) return btn;
      }
    }
    return null;
  }

  function base64ToFile(base64Str, filename, mimeType) {
    try {
      const arr = base64Str.split(',');
      const mime = mimeType || (arr[0].match(/:(.*?);/) || [])[1] || 'image/png';
      const bstr = atob(arr[arr.length - 1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
      }
      return new File([u8arr], filename || 'flow_upload_' + Date.now() + '.png', { type: mime });
    } catch (e) {
      log('base64ToFile error: ' + e.message);
      return null;
    }
  }

  function showFlowToast(message, duration = 4000) {
    let toast = document.getElementById('flowauto-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'flowauto-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #1e1b4b, #312e81);
        color: #fff;
        padding: 10px 20px;
        border-radius: 9999px;
        font-size: 13px;
        font-weight: 600;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(99, 102, 241, 0.4);
        z-index: 1000000;
        pointer-events: none;
        transition: opacity 0.3s ease, transform 0.3s ease;
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    setTimeout(() => {
      if (toast) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(10px)';
      }
    }, duration);
  }

  function getFlowDropTarget() {
    const cx = Math.floor(window.innerWidth * 0.5);
    const cy = Math.floor(window.innerHeight * 0.45);

    // 1. Innermost leaf element with text "thả nội dung" or "drop media"
    const textCandidates = Array.from(document.querySelectorAll('*')).filter(node => {
      if (!isVisible(node) || node.closest('#flowauto-floating-widget') || node.closest('#flowauto-toast')) return false;
      const t = (node.textContent || '').toLowerCase();
      return t.includes('thả nội dung') || t.includes('drop media') || t.includes('bắt đầu tạo');
    });

    if (textCandidates.length > 0) {
      // Sort by fewest children = innermost leaf element!
      textCandidates.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
      const leaf = textCandidates[0];
      const r = leaf.getBoundingClientRect();
      log('✓ Found innermost dropzone leaf: <' + leaf.tagName + '> ("' + leaf.textContent.trim().substring(0, 30) + '")');
      return { element: leaf, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }

    // 2. Element right at center of screen (when media already exists on canvas)
    let centerEl = document.elementFromPoint(cx, cy);
    if (centerEl && !centerEl.closest('#flowauto-floating-widget') && !centerEl.closest('#flowauto-toast') && centerEl !== document.body && centerEl !== document.documentElement) {
      log('✓ Found center workspace element: <' + centerEl.tagName + ' class="' + (centerEl.className || '') + '">');
      return { element: centerEl, x: cx, y: cy };
    }

    // 3. Existing image card on canvas
    const img = document.querySelector('img:not([id*="flowauto"]):not([src^="data:"])');
    if (img && isVisible(img)) {
      const r = img.getBoundingClientRect();
      log('✓ Found existing canvas image card');
      return { element: img, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }

    // 4. Fallback: Main container or body
    const mainArea = document.querySelector('main') || document.querySelector('[role="main"]') || document.body;
    return { element: mainArea, x: cx, y: cy };
  }

  function dispatchDragDropToFlow(targetObj, dt) {
    const { element, x, y } = targetObj;
    log('🎯 Dispatching DragDrop to <' + element.tagName + ' class="' + (element.className || '') + '"> at (' + x + ',' + y + ')');

    const opts = {
      bubbles: true,
      cancelable: true,
      composed: true,
      dataTransfer: dt,
      clientX: x,
      clientY: y,
      screenX: x + (window.screenX || 0),
      screenY: y + (window.screenY || 0),
      view: window
    };

    try {
      element.dispatchEvent(new DragEvent('dragenter', opts));
      element.dispatchEvent(new DragEvent('dragover', opts));
      element.dispatchEvent(new DragEvent('drop', opts));
      return true;
    } catch (e) {
      log('dispatchDragDropToFlow error: ' + e.message);
      return false;
    }
  }

  let isUploading = false;

  /** Upload an array of files/images into Google Flow */
  async function uploadFilesToFlow(filesData) {
    if (!filesData || filesData.length === 0) {
      return { success: false, error: 'Không có dữ liệu ảnh' };
    }

    if (isUploading) {
      log('⚠️ Upload đang diễn ra, bỏ qua lệnh gọi trùng lặp');
      return { success: false, error: 'Đang tải ảnh, vui lòng chờ...' };
    }
    isUploading = true;

    try {
      const fileObjects = [];
      for (const item of filesData) {
        if (item instanceof File) {
          fileObjects.push(item);
        } else if (item?.file instanceof File) {
          fileObjects.push(item.file);
        } else if (item?.base64) {
          const f = base64ToFile(item.base64, item.name, item.type);
          if (f) fileObjects.push(f);
        } else if (typeof item === 'string' && item.startsWith('data:image')) {
          const f = base64ToFile(item, 'image_' + Date.now() + '.png');
          if (f) fileObjects.push(f);
        } else if (item?.url || (typeof item === 'string' && item.startsWith('http'))) {
          const url = item.url || item;
          try {
            log('🌐 Fetching image from URL: ' + url);
            const resp = await fetch(url);
            const blob = await resp.blob();
            const fname = url.split('/').pop().split('?')[0] || ('image_' + Date.now() + '.png');
            fileObjects.push(new File([blob], fname, { type: blob.type || 'image/png' }));
          } catch (err) {
            log('❌ Fetch URL failed: ' + err.message);
          }
        }
      }

      if (fileObjects.length === 0) {
        return { success: false, error: 'Không thể tạo file từ dữ liệu ảnh cung cấp' };
      }

      log('🖼️ Chuẩn bị upload ' + fileObjects.length + ' ảnh vào Flow...');
      showFlowToast('⏳ Đang upload ' + fileObjects.length + ' ảnh vào Flow...', 3000);

      const dt = new DataTransfer();
      for (const f of fileObjects) {
        dt.items.add(f);
      }
      try {
        dt.effectAllowed = 'all';
        dt.dropEffect = 'copy';
      } catch(e) {}

      // Get THE ONE BEST leaf target element
      const targetObj = getFlowDropTarget();

      // Dispatch Drag & Drop ONCE to target (bubbles naturally to React components)
      const ok = dispatchDragDropToFlow(targetObj, dt);

      showFlowToast('✅ Đã nạp ' + fileObjects.length + ' ảnh vào Flow!', 4000);
      return { success: ok, count: fileObjects.length };
    } finally {
      setTimeout(() => { isUploading = false; }, 1500);
    }
  }

  /** Injects floating upload button into Flow interface */
  function injectFloatingUploadWidget() {
    if (document.getElementById('flowauto-floating-widget')) return;

    const widget = document.createElement('div');
    widget.id = 'flowauto-floating-widget';
    widget.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999998;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    `;

    // Inner upload button
    const btn = document.createElement('button');
    btn.id = 'flowauto-float-upload-btn';
    btn.innerHTML = '📤 <span style="font-weight:700;">Upload Ảnh vào Flow</span>';
    btn.title = 'Bấm để chọn ảnh từ máy tính hoặc kéo thả ảnh vào đây để nạp vào Flow';
    btn.style.cssText = `
      background: linear-gradient(135deg, #7c3aed, #4f46e5);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      border-radius: 9999px;
      padding: 10px 18px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4);
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    `;

    btn.onmouseover = () => {
      btn.style.transform = 'translateY(-2px) scale(1.02)';
      btn.style.boxShadow = '0 6px 20px rgba(124, 58, 237, 0.6)';
    };
    btn.onmouseout = () => {
      btn.style.transform = 'none';
      btn.style.boxShadow = '0 4px 14px rgba(124, 58, 237, 0.4)';
    };

    // Hidden file input — marked with data-flowauto-input so uploadFilesToFlow will never mistakenly match it!
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.multiple = true;
    fileInput.accept = 'image/*';
    fileInput.setAttribute('data-flowauto-input', 'true');
    fileInput.style.display = 'none';

    btn.onclick = () => fileInput.click();

    fileInput.onchange = async () => {
      if (fileInput.files && fileInput.files.length > 0) {
        btn.disabled = true;
        btn.innerHTML = '⏳ <span>Đang nạp ảnh...</span>';
        await uploadFilesToFlow(Array.from(fileInput.files));
        btn.disabled = false;
        btn.innerHTML = '📤 <span style="font-weight:700;">Upload Ảnh vào Flow</span>';
        fileInput.value = '';
      }
    };

    // Drag-and-drop directly onto floating button
    btn.ondragover = (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
      btn.style.boxShadow = '0 0 20px rgba(16, 185, 129, 0.8)';
    };
    btn.ondragleave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.style.background = 'linear-gradient(135deg, #7c3aed, #4f46e5)';
      btn.style.boxShadow = '0 4px 14px rgba(124, 58, 237, 0.4)';
    };
    btn.ondrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.style.background = 'linear-gradient(135deg, #7c3aed, #4f46e5)';
      btn.style.boxShadow = '0 4px 14px rgba(124, 58, 237, 0.4)';
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files.length > 0) {
        btn.disabled = true;
        btn.innerHTML = '⏳ <span>Đang nạp ảnh...</span>';
        await uploadFilesToFlow(files);
        btn.disabled = false;
        btn.innerHTML = '📤 <span style="font-weight:700;">Upload Ảnh vào Flow</span>';
      }
    };

    widget.appendChild(fileInput);
    widget.appendChild(btn);
    document.body.appendChild(widget);
    log('🎨 Injected Floating Upload Widget on Flow');
  }

  /** Detect completed videos (up to 3 newest at top/bottom) */
  function detectVideoComplete() {
    const results = [];
    const videos = Array.from(document.querySelectorAll('video')).reverse();
    
    for (const v of videos) {
      const src = v.src || v.currentSrc;
      if (src && (src.startsWith('http') || src.startsWith('blob:')) && !preexistingVideos.has(src)) {
        results.push({ element: v, src, type: 'video' });
        if (results.length >= 3) break;
      } else {
        const source = v.querySelector('source[src]');
        if (source?.src && !preexistingVideos.has(source.src)) {
           results.push({ element: v, src: source.src, type: 'source' });
           if (results.length >= 3) break;
        }
      }
    }
    
    // Fallback to download buttons if no video tags found
    if (results.length === 0) {
      for (const sel of ['a[download]', 'a[href*="download"]', 'button[aria-label*="Download"]', 'button[aria-label*="Tải"]']) {
        const buttons = Array.from(document.querySelectorAll(sel)).reverse();
        for (const el of buttons) {
           if (isVisible(el)) {
             results.push({ element: el, src: el.href || '', type: 'download_button' });
             if (results.length >= 3) break;
           }
        }
        if (results.length >= 3) break;
      }
    }
    
    return results.length > 0 ? results : null;
  }

  // ==========================================
  // RENDER MONITOR
  // ==========================================
  function startRenderMonitor() {
    stopRenderMonitor();
    renderObserver = new MutationObserver(() => {
      const video = detectVideoComplete();
      if (video) {
        log('🎬 Video detected by observer');
        stopRenderMonitor();
        window.postMessage({ type: 'FLOW_VIDEO_DETECTED', video }, '*');
        return;
      }
      if (document.querySelector('[role="progressbar"], [class*="progress"], [class*="spinner"]')) {
        window.postMessage({ type: 'FLOW_RENDER_PROGRESS', progress: 'Rendering...' }, '*');
      }
    });
    renderObserver.observe(document.body, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ['src', 'class', 'style']
    });
    return true;
  }

  function stopRenderMonitor() {
    if (renderObserver) { renderObserver.disconnect(); renderObserver = null; }
  }

  // ==========================================
  // VIDEO DOWNLOAD (Base64 to n8n)
  // ==========================================
  async function downloadVideos(videos, projectId, sceneId) {
    try {
      const results = [];
      for (let i = 0; i < videos.length; i++) {
        const info = videos[i];
        const filename = (projectId || 'project') + '_' + (sceneId || 'scene') + '_v' + (i + 1) + '.mp4';
        
        let videoUrl = info.src;
        if (!videoUrl && info.type === 'download_button') {
          simulateClick(info.element);
          results.push({ filename, url: '', base64: '' });
          continue;
        }
        
        log(`📥 Fetching video blob ${i+1}/${videos.length}: ` + videoUrl);
        const response = await fetch(videoUrl);
        const blob = await response.blob();
        
        log(`📦 Converting video ${i+1} to Base64 (` + Math.round(blob.size / 1024 / 1024 * 10) / 10 + ' MB)...');
        
        const base64data = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
        
        log(`✅ Base64 conversion ${i+1} complete.`);
        results.push({
          filename,
          url: videoUrl,
          base64: base64data
        });
      }
      
      window.postMessage({ 
        type: 'FLOW_DOWNLOAD_COMPLETE', 
        videos: results,
        token: authToken
      }, '*');
      
      return true;
    } catch (e) { 
      log('❌ Download error: ' + e.message); 
      return false; 
    }
  }

  // ==========================================
  // ACTION HANDLER
  // ==========================================
  async function handleAction(action, params) {
    log('→ ' + action + (params.name ? ' [' + params.name + ']' : ''));

    switch (action) {

      // ── Step -1: Create New Project ──
      case 'createProject': {
        try {
          // Check if already in a project
          const currentUrl = window.location.href;
          const match = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
          if (match && match[1]) {
            log('✓ Already inside project: ' + match[1]);
            sendResult(action, true, { log: '✓ Đang ở trong project: ' + match[1], projectId: match[1] });
            return;
          }

          log('✨ Looking for "Dự án mới" / "New project" button...');
          const newProjectKeywords = ['dự án mới', 'new project', 'tạo dự án', 'create project'];
          let targetBtn = null;

          for (const btn of document.querySelectorAll('button, [role="button"], a, div')) {
            const text = (btn.textContent || '').trim().toLowerCase();
            const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            const title = (btn.getAttribute('title') || '').toLowerCase();
            
            for (const kw of newProjectKeywords) {
              if ((text.includes(kw) || aria.includes(kw) || title.includes(kw)) && isVisible(btn)) {
                // Climb up to clickable button if needed
                targetBtn = btn.closest('button, [role="button"], a') || btn;
                break;
              }
            }
            if (targetBtn) break;
          }

          if (!targetBtn) {
            sendResult(action, false, null, 'Không tìm thấy nút "+ Dự án mới"');
            return;
          }

          log('🖱️ Clicking "+ Dự án mới" button...');
          simulateClick(targetBtn);

          // Wait for URL to update with project ID (up to 15 seconds)
          const startWait = Date.now();
          const checkInterval = setInterval(() => {
            const cur = window.location.href;
            const m = cur.match(/\/project\/([a-zA-Z0-9_-]+)/);
            if (m && m[1]) {
              clearInterval(checkInterval);
              log('🎉 Created new project successfully: ' + m[1]);
              sendResult(action, true, { log: '✓ Đã tạo dự án mới: ' + m[1], projectId: m[1] });
            } else if (Date.now() - startWait > 15000) {
              clearInterval(checkInterval);
              sendResult(action, false, null, 'Hết thời gian chờ tạo dự án (URL không đổi)');
            }
          }, 500);

        } catch (err) {
          sendResult(action, false, null, 'createProject exception: ' + err.message);
        }
        break;
      }

      // ── Step 0: Upload Image(s) to Flow ──
      case 'uploadImage': {
        try {
          const filesData = params.files || [];
          if (filesData.length === 0 && params.imageUrl) filesData.push({ url: params.imageUrl });
          if (filesData.length === 0 && params.base64) filesData.push({ base64: params.base64, name: params.name });

          log('🖼️ uploadImage action: ' + filesData.length + ' image(s)');
          const res = await uploadFilesToFlow(filesData);
          if (res.success) {
            sendResult(action, true, { log: '✓ Đã nạp ' + res.count + ' ảnh vào Flow' });
          } else {
            sendResult(action, false, null, res.error || 'Upload ảnh thất bại');
          }
        } catch (err) {
          sendResult(action, false, null, 'uploadImage exception: ' + err.message);
        }
        break;
      }

      // ── Step 1: Find character card ──
      case 'findCharacter': {
        // Always clear leftover search filter from previous character
        const preSearchBar = findSearchBar();
        if (preSearchBar && preSearchBar.value && preSearchBar.value.trim().length > 0) {
          log('🧹 Clearing leftover search filter...');
          clearSearchInput(preSearchBar);
          await new Promise(res => setTimeout(res, 1500));
        }

        // Attempt 1: Try finding directly in the visible grid
        let r = findCharacterCard(params.name);
        
        // Attempt 2: Use Search Bar to filter (essential for large projects)
        if (!r) {
          const searchInput = findSearchBar();
          if (searchInput) {
            log('🔍 Character not visible (' + params.name + '), using Search Bar...');
            clearSearchInput(searchInput);
            await new Promise(res => setTimeout(res, 500));
            
            // Type full character name
            injectTextToReactInput(searchInput, params.name);
            const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
            searchInput.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
            searchInput.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
            searchInput.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
            
            // Wait for search results
            await new Promise(res => setTimeout(res, 2500));
            r = findCharacterCard(params.name);
            
            // Attempt 3: Try with first word only (e.g. "Chanh Pink" → "Chanh")
            if (!r) {
              const words = params.name.trim().split(/\s+/);
              if (words.length > 1) {
                log('🔍 Full name not found, trying first word: "' + words[0] + '"...');
                clearSearchInput(searchInput);
                await new Promise(res => setTimeout(res, 500));
                injectTextToReactInput(searchInput, words[0]);
                searchInput.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
                searchInput.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
                await new Promise(res => setTimeout(res, 2500));
                r = findCharacterCard(params.name); // Still match full name in results
              }
            }
            
            // Clear search bar after finding to reset grid for hover/click steps
            if (r) {
              log('🧹 Clearing search filter after finding character...');
              clearSearchInput(searchInput);
              await new Promise(res => setTimeout(res, 1500)); // Wait for grid to fully reset
            }
          }
        }

        if (r) {
          log('✓ Found via ' + r.method);
          sendResult(action, true, { log: '✓ Found: ' + params.name + ' (' + r.method + ')' });
        } else {
          sendResult(action, false, null, 'Character not found: ' + params.name);
        }
        break;
      }

      // ── Step 2: Hover character card ──
      case 'hoverCharacter': {
        const r = findCharacterCard(params.name);
        if (r && simulateHover(r.card)) {
          await new Promise(r => setTimeout(r, 1000));
          sendResult(action, true, { log: '✓ Hover triggered: ' + params.name });
        } else {
          sendResult(action, false, null, 'Cannot hover: ' + params.name);
        }
        break;
      }

      // ── Step 3: Click ⋮ menu button ──
      case 'clickMoreMenu': {
        const cardResult = findCharacterCard(params.name);
        if (cardResult) { simulateHover(cardResult.card); await new Promise(r => setTimeout(r, 500)); }

        const btn = findMoreButton(params.name);
        if (btn) {
          simulateClick(btn);
          log('✓ Clicked ⋮');
          await new Promise(r => setTimeout(r, 600));
          sendResult(action, true, { log: '✓ Clicked ⋮ on: ' + params.name });
        } else {
          sendResult(action, false, null, '⋮ button not found on card: ' + params.name);
        }
        break;
      }

      // ── Step 4: Wait for dropdown menu ──
      case 'waitMenu': {
        const btn = await waitForCondition(() => findButtonByText('Thêm vào câu lệnh') || findButtonByText('Add to prompt'), 5000);
        if (btn) {
          sendResult(action, true, { log: '✓ Menu detected: "' + btn.textContent.trim().substring(0, 30) + '"' });
        } else {
          sendResult(action, false, null, 'Menu did not appear');
        }
        break;
      }

      // ── Step 5: Click "Thêm vào câu lệnh" / "Add to prompt" ──
      case 'clickAddButton': {
        const btn = findButtonByText('Thêm vào câu lệnh') || findButtonByText('Add to prompt');
        if (btn) {
          simulateClick(btn);
          const label = btn.textContent.trim().substring(0, 30);
          log('✓ Clicked "' + label + '"');
          await new Promise(r => setTimeout(r, 800));
          sendResult(action, true, { log: '✓ Clicked "' + label + '"' });
        } else {
          sendResult(action, false, null, '"Thêm vào câu lệnh" / "Add to prompt" not found');
        }
        break;
      }

      // ── Step 6: Wait for prompt input "Bạn muốn tạo gì?" ──
      case 'waitTextarea': {
        const input = await waitForCondition(() => findPromptInput(), 5000);
        if (input) {
          log('✓ Prompt input ready');
          sendResult(action, true, { log: '✓ Prompt input "Bạn muốn tạo gì?" ready' });
        } else {
          log('❌ Prompt input not found');
          for (const el of document.querySelectorAll('textarea, input, [contenteditable="true"]')) {
            log('  input: tag=' + el.tagName + ' ph="' + (el.getAttribute('placeholder') || '') + '" vis=' + isVisible(el));
          }
          sendResult(action, false, null, 'Prompt input "Bạn muốn tạo gì?" not found');
        }
        break;
      }

      // ── Step 7: Inject prompt text (Using Chrome Debugger API for 100% OS-level reliability) ──
      case 'injectPrompt': {
        const input = findPromptInput();
        if (input) {
          log('🐞 Requesting OS-level Debugger Typing...');
          // Add a space to gracefully separate from the Character Pill/Chip
          const textToInject = " " + params.prompt;
          
          // 1. Focus the input so the debugger types in the correct place
          input.focus();
          input.click();
          
          // Move cursor to end to avoid overwriting chips
          if (input.getAttribute('contenteditable') === 'true') {
             try {
               let target = input;
               let inner = input.querySelector('p') || input.querySelector('span') || input.firstElementChild;
               if (inner) target = inner;
               const selection = window.getSelection();
               const range = document.createRange();
               range.selectNodeContents(target);
               range.collapse(false);
               selection.removeAllRanges();
               selection.addRange(range);
             } catch(e) {}
          } else {
             try { input.selectionStart = input.selectionEnd = input.value.length; } catch(e) {}
          }

          // 2. Setup listener with TIMEOUT FALLBACK for the background script's response
          let debuggerHandled = false;
          const handleDebuggerResponse = (e) => {
             if (e.source !== window || e.data.type !== 'FLOW_DEBUGGER_RESULT') return;
             if (debuggerHandled) return;
             debuggerHandled = true;
             window.removeEventListener('message', handleDebuggerResponse);
             
             if (e.data.success) {
                log('✓ Debugger typing succeeded! (' + params.prompt.length + ' chars)');
                setTimeout(() => {
                   sendResult(action, true, { log: '✓ Typed: "' + params.prompt.substring(0, 50) + '..."' });
                }, 500);
             } else {
                log('❌ Debugger typing failed: ' + e.data.error);
                log('💉 Falling back to DOM injection...');
                const ok = injectTextToReactInput(input, textToInject);
                if (ok) {
                   sendResult(action, true, { log: '✓ Fallback injected: "' + params.prompt.substring(0, 50) + '..."' });
                } else {
                   sendResult(action, false, null, 'Both Debugger and Fallback injection failed');
                }
             }
          };
          window.addEventListener('message', handleDebuggerResponse);

          // Timeout fallback: if debugger never responds within 15s, use DOM fallback
          setTimeout(() => {
            if (!debuggerHandled) {
              debuggerHandled = true;
              window.removeEventListener('message', handleDebuggerResponse);
              log('⏰ Debugger typing timeout (15s). Falling back to DOM injection...');
              const ok = injectTextToReactInput(input, textToInject);
              if (ok) {
                sendResult(action, true, { log: '✓ Timeout fallback injected: "' + params.prompt.substring(0, 50) + '..."' });
              } else {
                sendResult(action, false, null, 'Debugger timeout and DOM fallback both failed');
              }
            }
          }, 15000);

          // 3. Send request to content.js to bridge to background.js
          window.postMessage({
             type: 'FLOW_DEBUGGER_TYPE',
             text: textToInject
          }, '*');
          
        } else {
          sendResult(action, false, null, 'Prompt input not found');
        }
        break;
      }

      // ── Step 8: Verify input ──
      case 'verifyInput': {
        const input = findPromptInput();
        if (input) {
          const val = input.value || input.textContent || '';
          if (val.length > 0) {
            sendResult(action, true, { log: '✓ Input verified (' + val.length + ' chars)' });
          } else {
            sendResult(action, false, null, 'Prompt input is empty after injection');
          }
        } else {
          sendResult(action, false, null, 'Prompt input not found');
        }
        break;
      }

      // ── Step 9: Press Enter to submit ──
      case 'pressEnter': {
        const input = findPromptInput();
        if (input) {
          input.focus();
          
          // 🛑 Capture existing videos BEFORE we submit the new prompt!
          capturePreexistingVideos();
          
          log('🐞 Requesting OS-level Debugger Enter Key...');
          
          let enterHandled = false;
          const handleEnterResponse = (e) => {
             if (e.source !== window || e.data.type !== 'FLOW_DEBUGGER_ENTER_RESULT') return;
             if (enterHandled) return;
             enterHandled = true;
             window.removeEventListener('message', handleEnterResponse);
             
             if (e.data.success) {
                log('✓ Debugger Enter pressed natively!');
             } else {
                log('❌ Debugger Enter failed: ' + e.data.error + '. Falling back to DOM events...');
                const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
                input.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
                input.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
                input.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
             }
             
             // Also try forcefully clicking the submit button directly as a safety measure
             setTimeout(() => {
                const container = input.closest('form, [role="dialog"], body');
                if (container) {
                   const buttons = Array.from(container.querySelectorAll('button:not([disabled]), [role="button"]:not([aria-disabled="true"])'));
                   const submitBtn = buttons.find(b => {
                      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                      if (aria.includes('tạo') || aria.includes('gửi') || aria.includes('submit') || aria.includes('create')) return true;
                      if (b.querySelector('svg path[d*="m12 4"]')) return true; 
                      return false;
                   });
                   
                   if (submitBtn) {
                      log('🖱️ Force clicking submit button as well...');
                      simulateClick(submitBtn);
                   }
                }
                
                sendResult(action, true, { log: '✓ Enter pressed / Submitted' });
             }, 800);
          };
          
          window.addEventListener('message', handleEnterResponse);

          // Timeout fallback: if debugger never responds within 15s
          setTimeout(() => {
            if (!enterHandled) {
              enterHandled = true;
              window.removeEventListener('message', handleEnterResponse);
              log('⏰ Debugger Enter timeout (15s). Falling back to DOM events...');
              const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
              input.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
              input.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
              input.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
              
              setTimeout(() => {
                sendResult(action, true, { log: '✓ Timeout fallback: Enter pressed via DOM' });
              }, 800);
            }
          }, 15000);
          
          window.postMessage({
             type: 'FLOW_DEBUGGER_ENTER'
          }, '*');

        } else {
          sendResult(action, false, null, 'Prompt input not found for Enter');
        }
        break;
      }

      // ── Step 10: Wait for render ──
      case 'waitRender': {
        const existing = detectVideoComplete();
        if (existing) {
          sendResult(action, true, { log: '✓ Video already present', status: 'complete' });
          return;
        }
        
        log('⏳ Waiting exactly 2 minutes (120s) for video to render...');
        sendResult(action, true, { log: '⏳ Waiting 2 minutes for render...', status: 'monitoring' });
        
        setTimeout(() => {
           log('⏰ 2 minutes elapsed. Assuming video is ready.');
           window.postMessage({ type: 'FLOW_VIDEO_DETECTED' }, '*');
        }, 120000); // 2 minutes
        break;
      }

      // ── Step 11: Detect completion ──
      case 'detectComplete': {
        const videos = detectVideoComplete();
        if (videos && videos.length > 0) {
          sendResult(action, true, { log: '✓ Videos ready: ' + videos.length, videos: videos.map(v => ({ src: v.src, type: v.type })) });
        } else {
          sendResult(action, false, null, 'Video not yet complete');
        }
        break;
      }

      // ── Step 12: Download ──
      case 'downloadVideo': {
        sendResult(action, true, { log: '⏳ Chờ 10s để đảm bảo video load xong...', status: 'monitoring' });
        
        setTimeout(() => {
          const videos = detectVideoComplete();
          if (videos && videos.length > 0) {
            downloadVideos(videos, params.projectId, params.sceneId);
          } else {
            window.postMessage({ type: 'FLOW_DOWNLOAD_COMPLETE', videos: [] }, '*');
          }
        }, 10000);
        break;
      }

      default:
        sendResult(action, false, null, 'Unknown action: ' + action);
    }
  }

  // ==========================================
  // MESSAGE LISTENER
  // ==========================================
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data.type === 'FLOW_INJECT_ACTION') {
      handleAction(event.data.action, event.data.params || {});
    }
  });

  // Injects floating upload widget on Flow interface
  setTimeout(injectFloatingUploadWidget, 1500);

  log('🚀 inject.js v4.5 loaded (with Flow Image Upload & Widget)');
})();
