// inject.js — DOM Manipulator for Google Flow v4.4
// Runs in PAGE CONTEXT for full DOM + React access
// Communicates with content.js via window.postMessage
//
// Product Flow: open /character → paste product File into composer → verify attachment → type prompt → submit

(function () {
  'use strict';

  // RE-INJECTION GUARD — prevent duplicate listeners & fetch wrapper chains on 24/7 VPS
  if (window._flowAutoInjectLoaded) {
    console.log('[FlowAuto:inject] Already loaded, skipping re-injection');
    window._flowAutoInjectReady = true;
    window.postMessage({ type: 'FLOW_INJECT_READY' }, '*');
    return;
  }
  window._flowAutoInjectLoaded = true;
  window._flowAutoInjectReady = true;
  window.postMessage({ type: 'FLOW_INJECT_READY' }, '*');

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

  let preexistingImages = new Set();
  let productAttachmentEvidence = null;

  function capturePreexistingImages() {
    preexistingImages.clear();
    document.querySelectorAll('img').forEach(im => {
      if (im.closest('#flowauto-floating-widget') || im.closest('#flowauto-toast')) return;
      if (im.src) preexistingImages.add(im.src);
      if (im.currentSrc) preexistingImages.add(im.currentSrc);
    });
    log('📸 Captured ' + preexistingImages.size + ' pre-existing image URLs to ignore.');
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
    try { el.focus(); } catch (e) {}
    const up = { ...opts, buttons: 0 };
    el.dispatchEvent(new PointerEvent('pointerup', up));
    el.dispatchEvent(new MouseEvent('mouseup', up));
    el.dispatchEvent(new MouseEvent('click', up));
    try { el.click(); } catch (e) {}
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

    const isContentEditable = !!(el.isContentEditable || el.getAttribute('contenteditable') === 'true' || el.getAttribute('contenteditable') === '' || el.getAttribute('contenteditable') === 'plaintext-only');

    // Find the deep leaf node inside contenteditable (e.g. <p> or <span>) to avoid breaking rich text models
    let targetContainer = el;
    if (isContentEditable) {
      let inner = el.querySelector('p');
      if (!inner) inner = el.querySelector('span');
      if (!inner && el.firstElementChild) inner = el.firstElementChild;
      if (inner && !(inner.textContent || '').includes('Mô tả nhân vật') && !(inner.textContent || '').includes('describe')) {
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
        // If placeholder element is still inside el, remove it
        const ph = Array.from(el.querySelectorAll('*')).find(c => (c.textContent || '').includes('Mô tả nhân vật') || (c.textContent || '').includes('describe your character'));
        if (ph && ph.parentElement && ph !== el) {
          try { ph.parentElement.removeChild(ph); } catch(e) {}
        }
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

  let lastFoundCharacterCard = null;

  /** Click vào menu "Nhân vật" ở thanh bên trái (sidebar) */
  async function clickCharactersSidebarMenu() {
    log('🧭 Đang tìm và bấm vào menu "Nhân vật" ở thanh bên trái...');
    showFlowToast('🧭 Đang chuyển sang mục "Nhân vật"...', 2000);

    // 1. Quét các phần tử bên thanh sidebar (bên trái màn hình, left < 280px)
    const sidebarItems = Array.from(document.querySelectorAll('nav, aside, [role="navigation"], ul, li, div, a, button, [role="tab"], [role="button"], [role="listitem"], span')).filter(el => {
      if (!isVisible(el)) return false;
      if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) return false;
      const r = el.getBoundingClientRect();
      return r.left < 280 && r.top < window.innerHeight * 0.75 && r.width > 15;
    });

    // 2. Tìm phần tử có văn bản khớp chính xác hoặc bắt đầu bằng "Nhân vật" / "Characters" / link /character
    let targetMenu = null;
    for (const el of sidebarItems) {
      const text = (el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      const href = (el.getAttribute('href') || el.href || '').toLowerCase();
      
      if (text === 'nhân vật' || text === 'characters' || text === 'character' ||
          aria === 'nhân vật' || aria === 'characters' || aria === 'character' ||
          text.startsWith('nhân vật') || text.startsWith('character') ||
          aria.startsWith('nhân vật') || aria.startsWith('character') ||
          href.endsWith('/character') || href.includes('/character/')) {
        // Ưu tiên thẻ có thể click (button, a, role="tab", role="button", hoặc thẻ cha)
        const clickable = el.closest('button, a, [role="tab"], [role="button"], li') || el;
        targetMenu = clickable;
        break;
      }
    }

    // 3. Dự phòng: Quét phần tử có chữ "Nhân vật" / "Characters" ở thanh bên trái
    if (!targetMenu) {
      const matchSpan = sidebarItems.find(el => {
        const t = (el.textContent || '').trim().toLowerCase();
        return (t.includes('nhân vật') || t.includes('character') || t.includes('characters')) && t.length < 30;
      });
      if (matchSpan) {
        targetMenu = matchSpan.closest('button, a, [role="tab"], [role="button"], li') || matchSpan;
      }
    }

    if (targetMenu) {
      log('✓ Tìm thấy nút menu "Nhân vật": <' + targetMenu.tagName + '> "' + targetMenu.textContent.trim().substring(0, 20) + '"');
      scrollIntoViewIfNeeded(targetMenu);
      simulateClick(targetMenu);
      try { targetMenu.click(); } catch(e) {}
      
      // Chờ 1.8 giây để Google Flow cập nhật lưới thẻ nhân vật
      await new Promise(r => setTimeout(r, 1800));
      return true;
    } else {
      log('ℹ️ Không thấy nút menu "Nhân vật" riêng biệt (có thể đã ở sẵn trong tab hoặc màn hình thu gọn)');
      return false;
    }
  }

  /** Normalizes character names to support both English ("Unnamed character") and Vietnamese ("Nhân vật chưa có tên") */
  function getEquivalentNames(name) {
    if (!name) return [];
    const n = name.trim().toLowerCase();
    const unnamedVariants = [
      'nhân vật chưa có tên',
      'nhan vat chua co ten',
      'unnamed character',
      'untitled character',
      'unnamed',
      'untitled'
    ];
    if (unnamedVariants.some(v => n.includes(v))) {
      return unnamedVariants;
    }
    return [n];
  }

  function isDefaultCharacterName(name) {
    if (!name) return true;
    const n = name.trim().toLowerCase();
    return n === 'nhân vật chưa có tên' ||
           n === 'nhan vat chua co ten' ||
           n === 'unnamed character' ||
           n === 'untitled character' ||
           n === 'unnamed' ||
           n === 'untitled';
  }

  /** Find character card by name (supports bilingual matching) */
  function findCharacterCard(name) {
    if (!name) return null;
    const names = getEquivalentNames(name);

    // Strategy 1: img alt text
    for (const img of document.querySelectorAll('img')) {
      if (img.closest('#flowauto-floating-widget') || img.closest('#flowauto-toast')) continue;
      const alt = (img.alt || '').toLowerCase();
      if (alt && names.some(n => alt.includes(n))) {
        const card = climbToCard(img);
        if (card && isVisible(card)) return { card, img, method: 'alt' };
      }
    }
    // Strategy 2: aria-label
    for (const el of document.querySelectorAll('[aria-label]')) {
      if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) continue;
      const aria = el.getAttribute('aria-label').toLowerCase();
      if (names.some(n => aria.includes(n)) && isVisible(el)) {
        return { card: climbToCard(el), img: el.querySelector('img'), method: 'aria-label' };
      }
    }
    // Strategy 3: broad text content search across common tags
    for (const el of document.querySelectorAll('div, span, p, [role="button"], [role="listitem"], [tabindex]')) {
      if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) continue;
      // Only match if this element's direct or trimmed text includes any equivalent name
      const text = (el.textContent?.trim().toLowerCase() || '');
      if (names.some(n => text.includes(n)) && isVisible(el)) {
        const card = climbToCard(el);
        if (card && isVisible(card) && card !== document.body) {
          const img = card.querySelector('img');
          return { card, img, method: 'text' };
        }
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

  /** Find a media card on Flow's canvas by hint (filename / part of name) or newest */
  function findMediaCardOnCanvas(hint) {
    // 1. If hint (like filename or part of filename or previous name) is provided:
    if (hint && typeof hint === 'string' && hint.trim()) {
      const clean = hint.replace(/\.[^/.]+$/, '').trim().toLowerCase();
      const prefix = clean.substring(0, 12);

      for (const el of document.querySelectorAll('div, span, p, [role="button"], [role="listitem"], [tabindex]')) {
        if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) continue;
        const text = (el.textContent || '').trim().toLowerCase();
        if (text && (text.includes(clean) || (prefix.length >= 4 && text.includes(prefix)))) {
          const card = climbToCard(el);
          if (card && isVisible(card) && card !== document.body) {
            const img = card.querySelector('img');
            log('✓ Found media card matching hint "' + hint + '"');
            return { card, img };
          }
        }
      }
    }

    // 2. Look for media card images in the main workspace (excluding header avatar / sidebar)
    const candidates = [];
    for (const img of document.querySelectorAll('img')) {
      if (!isVisible(img)) continue;
      if (img.closest('#flowauto-floating-widget') || img.closest('#flowauto-toast')) continue;

      const r = img.getBoundingClientRect();
      // Must be a media card image: width >= 80, height >= 80, y > 50 (below header), x > 160 (right of sidebar)
      if (r.width >= 80 && r.height >= 80 && r.top >= 50 && r.left >= 160) {
        const card = climbToCard(img);
        if (card && card !== document.body) {
          candidates.push({ card, img, top: r.top, left: r.left });
        }
      }
    }

    if (candidates.length > 0) {
      // Flow grid puts cards in rows. Top-left card is candidates[0]
      candidates.sort((a, b) => (a.top - b.top) || (a.left - b.left));
      log('✓ Found ' + candidates.length + ' media card(s) on canvas, using first card');
      return candidates[0];
    }

    return null;
  }

  /** Find ⋮ (three-dots "Khác" / "More") button on/near a character card */
  function findMoreButton(characterNameOrCard) {
    let card = null;
    let img = null;

    if (typeof characterNameOrCard === 'string') {
      const cardResult = findCharacterCard(characterNameOrCard) || findMediaCardOnCanvas(characterNameOrCard);
      if (cardResult) {
        card = cardResult.card;
        img = cardResult.img;
      }
    } else if (characterNameOrCard && characterNameOrCard.nodeType) {
      card = climbToCard(characterNameOrCard);
      img = characterNameOrCard.tagName === 'IMG' ? characterNameOrCard : characterNameOrCard.querySelector('img');
    }

    if (!card) return null;

    log('🔍 Searching ⋮ on card (tag=' + card.tagName + ')');

    // Strategy 1: Buttons inside or around the card
    const area = card.parentElement?.parentElement || card.parentElement || card;
    const btns = Array.from(new Set([
      ...card.querySelectorAll('button, [role="button"]'),
      ...area.querySelectorAll('button, [role="button"]')
    ]));
    for (const btn of btns) {
      if (btn === card) continue;
      const br = btn.getBoundingClientRect();
      // Must NEVER pick buttons in top navbar or header (y < 80)
      if (br.top < 80) continue;
      if (btn.closest('header, nav, [role="banner"], [class*="navbar"], [class*="header"]')) continue;

      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const title = (btn.getAttribute('title') || '').toLowerCase();
      const text = (btn.textContent || '').trim();
      const href = (btn.getAttribute('href') || '').toLowerCase();

      // Exclude user profile, account, avatar, favorite/heart
      if (aria.includes('account') || aria.includes('tài khoản') || aria.includes('profile') ||
          aria.includes('user') || aria.includes('google') || title.includes('account') ||
          title.includes('profile') || href.includes('accounts.google.com') ||
          aria.includes('thích') || aria.includes('like') || aria.includes('favorite') ||
          title.includes('thích') || title.includes('favorite') || title.includes('like')) continue;

      const has3DotsSvg = btn.querySelector('svg path[d*="m12 8"], svg path[d*="M12 8"], svg [d*="12 2"]') ||
                          btn.querySelectorAll('circle').length >= 3;

      if (text === '⋮' || text === '︙' || text === '…' ||
          aria.includes('khác') || aria.includes('more') || aria.includes('menu') || aria.includes('options') ||
          title.includes('khác') || title.includes('more') || title.includes('options') ||
          has3DotsSvg) {
        if (isVisible(btn)) { log('✓ ⋮ via button text/aria/svg'); return btn; }
      }
    }

    // Strategy 2: Check buttons in top-right corner of the card
    const target = img || card;
    const cr = target.getBoundingClientRect();
    for (const btn of btns) {
      if (btn === card) continue;
      const br = btn.getBoundingClientRect();
      if (br.top < 80) continue;
      if (btn.closest('header, nav, [role="banner"], [class*="navbar"], [class*="header"]')) continue;

      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const title = (btn.getAttribute('title') || '').toLowerCase();
      const href = (btn.getAttribute('href') || '').toLowerCase();
      if (aria.includes('account') || aria.includes('tài khoản') || aria.includes('profile') ||
          aria.includes('user') || aria.includes('google') || title.includes('account') ||
          title.includes('profile') || href.includes('accounts.google.com') ||
          aria.includes('thích') || aria.includes('like') || aria.includes('favorite') ||
          title.includes('thích') || title.includes('like') || title.includes('favorite')) continue;

      if (Math.abs(br.right - cr.right) < 70 && Math.abs(br.top - cr.top) < 70 && br.width > 0 && br.width < 60) {
        log('✓ ⋮ via top-right geometry (' + Math.round(br.left) + ',' + Math.round(br.top) + ')');
        return btn;
      }
    }

    // Strategy 3: elementFromPoint probes at top-right corner
    const probes = [
      { x: cr.right - 18, y: cr.top + 18 }, { x: cr.right - 12, y: cr.top + 24 },
      { x: cr.right - 26, y: cr.top + 14 }, { x: cr.right - 10, y: cr.top + 10 },
      { x: cr.right - 34, y: cr.top + 20 }
    ];
    for (const p of probes) {
      if (p.x < 0 || p.y < 80) continue; // NEVER in navbar
      let el = document.elementFromPoint(p.x, p.y);
      for (let d = 0; d < 5 && el && el !== card && el !== document.body; d++) {
        if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
          const br = el.getBoundingClientRect();
          if (br.top < 80) break;
          const ca = (el.getAttribute('aria-label') || '').toLowerCase();
          const ct = (el.getAttribute('title') || '').toLowerCase();
          const ch = (el.getAttribute('href') || '').toLowerCase();
          if (ca.includes('account') || ca.includes('tài khoản') || ca.includes('profile') ||
              ca.includes('user') || ca.includes('google') || ct.includes('account') ||
              ch.includes('accounts.google.com') || ca.includes('thích') || ca.includes('like') ||
              ca.includes('favorite') || ct.includes('thích') || ct.includes('like') || ct.includes('favorite')) break;
          log('✓ ⋮ via elementFromPoint (' + Math.round(p.x) + ',' + Math.round(p.y) + ')');
          return el;
        }
        el = el.parentElement;
      }
    }

    return null;
  }

  /**
   * Tìm URL ảnh nhân vật sắc nét nhất trên trang tạo/chi tiết nhân vật
   * (ưu tiên ảnh preview trung tâm có kích thước lớn nhất hoặc link tải)
   */
  function findMainCharacterImageUrl() {
    // 1. Quét tất cả thẻ img đang hiển thị
    const allImgs = Array.from(document.querySelectorAll('img')).filter(im => {
      if (!isVisible(im)) return false;
      if (im.closest('#flowauto-floating-widget') || im.closest('#flowauto-toast')) return false;
      const r = im.getBoundingClientRect();
      return r.width >= 80 && r.height >= 80;
    });

    if (allImgs.length === 0) return null;

    // 2. Sắp xếp theo diện tích lớn nhất (ảnh chính ở trung tâm luôn có kích thước hiển thị lớn nhất)
    allImgs.sort((a, b) => {
      const rA = a.getBoundingClientRect();
      const rB = b.getBoundingClientRect();
      return (rB.width * rB.height) - (rA.width * rA.height);
    });

    const bestImg = allImgs[0];
    let bestUrl = bestImg.currentSrc || bestImg.src || bestImg.getAttribute('src') || '';

    // 3. Kiểm tra xem có thẻ link download <a> ở gần ảnh không (nút download thường bọc link gốc)
    const container = bestImg.closest('[class*="preview"], [class*="viewer"], [class*="character"], [class*="card"], div');
    if (container) {
      const downloadLink = container.querySelector('a[download], a[href*="googleusercontent"], a[href*="blob"], a[href*="flow"]');
      if (downloadLink && downloadLink.href) {
        bestUrl = downloadLink.href;
      }
    }

    return { img: bestImg, url: bestUrl };
  }

  /**
   * Sửa tên nhân vật trên trang chi tiết /character/{characterId}:
   * Click vào ô đặt tên (hoặc icon cây bút) -> xóa chữ cũ -> viết tên mới -> xác nhận
   */
  async function editCharacterPageName(newName) {
    if (!newName || !newName.trim()) return false;
    newName = newName.trim();

    log('✏️ Bắt đầu sửa tên nhân vật trên trang chi tiết: "' + newName + '"...');
    showFlowToast('✏️ Đang sửa tên nhân vật: "' + newName + '"...', 3500);

    // Điểm neo "Chọn giọng nói" trên trang để giới hạn khu vực tiêu đề ở phía trên
    const voiceAnchor = Array.from(document.querySelectorAll('button, [role="button"], div, span')).find(el => {
      if (!isVisible(el)) return false;
      const t = (el.textContent || '').trim().toLowerCase();
      const r = el.getBoundingClientRect();
      return (t === 'chọn giọng nói' || t.includes('giọng nói') || t.includes('voice')) && r.left < window.innerWidth * 0.5 && r.top > 100;
    });
    const voiceTop = voiceAnchor ? voiceAnchor.getBoundingClientRect().top : (window.innerHeight * 0.55);

    log('🔍 Tìm kiếm ô đặt tên / icon bút (khu vực y: 50 -> ' + Math.round(voiceTop) + ')...');

    let targetInput = null;
    let titleEl = null;
    let editBtn = null;

    // 1. Kiểm tra xem ô input/contenteditable đã sẵn sàng hiển thị chưa
    const existingInputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]')).filter(el => {
      if (!isVisible(el)) return false;
      if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) return false;
      const r = el.getBoundingClientRect();
      return r.left < window.innerWidth * 0.45 && r.top > 50 && r.top < voiceTop;
    });

    if (existingInputs.length > 0) {
      targetInput = existingInputs[0];
      log('✓ Tìm thấy ô input tên trực tiếp: <' + targetInput.tagName + '>');
    }

    // 2. Nếu chưa có input trực tiếp, tìm tiêu đề và icon bút
    if (!targetInput) {
      // Tìm các button hoặc icon có thể là nút sửa / cây bút
      const candidateButtons = Array.from(document.querySelectorAll('button, [role="button"], span, div, svg')).filter(el => {
        if (!isVisible(el)) return false;
        if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) return false;
        const r = el.getBoundingClientRect();
        if (r.left >= window.innerWidth * 0.5 || r.top <= 50 || r.top >= voiceTop) return false;

        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const title = (el.getAttribute('title') || '').toLowerCase();
        const text = (el.textContent || '').trim().toLowerCase();
        
        if (aria.includes('sửa') || aria.includes('edit') || aria.includes('tên') || aria.includes('name') ||
            title.includes('sửa') || title.includes('edit') || title.includes('tên') ||
            text === 'edit' || text === 'stylus' || text === 'draw') {
          return true;
        }

        // Icon SVG có kích thước nhỏ (cây bút thường khoảng 16-36px)
        const isSmallIcon = (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') && r.width <= 48 && r.height <= 48;
        if (isSmallIcon && (el.querySelector('svg') || el.querySelector('i'))) {
          return true;
        }
        return false;
      });

      if (candidateButtons.length > 0) {
        editBtn = candidateButtons[0];
        log('✓ Tìm thấy nút/icon sửa tên (pencil button)');
      }

      // Tìm tiêu đề tên nhân vật
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"], div, span')).filter(el => {
        if (!isVisible(el)) return false;
        if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) return false;
        const r = el.getBoundingClientRect();
        if (r.left >= window.innerWidth * 0.45 || r.top <= 60 || r.top >= voiceTop) return false;
        if (r.height < 18 || r.width < 25) return false;

        const fs = parseFloat(window.getComputedStyle(el).fontSize) || 14;
        return fs >= 18 || el.tagName.startsWith('H') || el.getAttribute('role') === 'heading';
      });

      if (headings.length > 0) {
        headings.sort((a, b) => {
          const fsA = parseFloat(window.getComputedStyle(a).fontSize) || 0;
          const fsB = parseFloat(window.getComputedStyle(b).fontSize) || 0;
          return fsB - fsA;
        });
        titleEl = headings[0];
        log('✓ Tìm thấy tiêu đề nhân vật: "' + (titleEl.textContent || '').trim() + '"');
      }

      // 3. Click vào ô đặt tên hoặc icon cây bút
      if (editBtn) {
        log('🖱️ Click vào icon cây bút...');
        simulateClick(editBtn);
        try { editBtn.click(); } catch(e) {}
      } else if (titleEl) {
        log('🖱️ Click vào ô đặt tên / tiêu đề...');
        simulateClick(titleEl);
        try { titleEl.click(); } catch(e) {}
      }

      await new Promise(r => setTimeout(r, 600));

      // Chờ ô input xuất hiện sau khi click
      targetInput = await waitForCondition(() => {
        const act = document.activeElement;
        if (act && act !== document.body && isVisible(act)) {
          if (act.tagName === 'INPUT' || act.tagName === 'TEXTAREA' || act.isContentEditable || act.getAttribute('contenteditable') === 'true') {
            return act;
          }
        }

        const container = (titleEl ? titleEl.parentElement : null) || (editBtn ? editBtn.parentElement : null);
        if (container) {
          const inp = container.querySelector('input, textarea, [contenteditable="true"]');
          if (inp && isVisible(inp)) return inp;
        }

        const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="file"]), textarea, [contenteditable="true"]')).filter(el => {
          if (!isVisible(el)) return false;
          if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) return false;
          const r = el.getBoundingClientRect();
          return r.left < window.innerWidth * 0.45 && r.top > 50 && r.top < voiceTop;
        });
        if (inputs.length > 0) return inputs[0];

        if (titleEl && (titleEl.isContentEditable || titleEl.getAttribute('contenteditable') === 'true')) {
          return titleEl;
        }
        return null;
      }, 3000);
    }

    if (!targetInput && titleEl) {
      log('🖱️ Thử double-click vào tiêu đề...');
      titleEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 500));
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.isContentEditable)) {
        targetInput = document.activeElement;
      }
    }

    if (!targetInput) {
      log('⚠️ Không tìm thấy ô đặt tên nhân vật để sửa');
      return false;
    }

    // 4. Click và Focus vào ô đặt tên
    log('🎯 Focus vào ô đặt tên: <' + targetInput.tagName + '>');
    scrollIntoViewIfNeeded(targetInput);
    simulateClick(targetInput);
    targetInput.focus();
    await new Promise(r => setTimeout(r, 400));

    // 5. XÓA CHỮ CŨ (clear old text)
    log('🧹 Xóa chữ cũ trong ô đặt tên...');
    if (typeof targetInput.select === 'function') {
      try { targetInput.select(); } catch(e) {}
    }
    if (targetInput.setSelectionRange && targetInput.value) {
      try { targetInput.setSelectionRange(0, targetInput.value.length); } catch(e) {}
    }
    if (targetInput.isContentEditable) {
      try {
        const range = document.createRange();
        range.selectNodeContents(targetInput);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch(e) {}
    }

    setNativeValue(targetInput, '');
    if (targetInput.isContentEditable) {
      try {
        while (targetInput.firstChild) targetInput.removeChild(targetInput.firstChild);
      } catch(e) {}
      try {
        targetInput.textContent = '';
      } catch(e) {}
    }
    targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    targetInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Gửi phím Backspace / Delete
    const backOpts = { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, cancelable: true };
    targetInput.dispatchEvent(new KeyboardEvent('keydown', backOpts));
    targetInput.dispatchEvent(new KeyboardEvent('keyup', backOpts));
    await new Promise(r => setTimeout(r, 300));

    // 6. VIẾT TÊN MỚI (type new name)
    log('⌨️ Viết tên mới: "' + newName + '"...');
    try {
      document.execCommand('insertText', false, newName);
    } catch(e) {}

    const curVal = (targetInput.value || targetInput.textContent || '').trim();
    if (curVal !== newName) {
      setNativeValue(targetInput, newName);
      if (targetInput.isContentEditable) {
        targetInput.textContent = newName;
      }
      targetInput.dispatchEvent(new Event('input', { bubbles: true }));
      targetInput.dispatchEvent(new Event('change', { bubbles: true }));
      targetInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: newName, inputType: 'insertText' }));
    }

    await new Promise(r => setTimeout(r, 500));

    // 7. XÁC NHẬN LƯU TÊN MỚI (Enter + Blur + Click Save/Check nếu có)
    log('⏎ Nhấn Enter để xác nhận tên mới...');
    const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    targetInput.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    targetInput.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
    targetInput.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

    // Kiểm tra nếu có nút tick (✓ / Lưu / Save)
    const saveCheckBtn = Array.from(document.querySelectorAll('button, [role="button"], span')).find(el => {
      if (!isVisible(el)) return false;
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const t = (el.textContent || '').trim().toLowerCase();
      const r = el.getBoundingClientRect();
      return (r.left < window.innerWidth * 0.5 && r.top < voiceTop) &&
             (aria.includes('save') || aria.includes('lưu') || aria.includes('done') || aria.includes('xong') || t === '✓' || t === 'check');
    });
    if (saveCheckBtn) {
      log('🖱️ Click nút xác nhận lưu tên...');
      simulateClick(saveCheckBtn);
    }

    try { targetInput.blur(); } catch(e) {}
    await new Promise(r => setTimeout(r, 600));

    log('✅ Đã sửa tên nhân vật thành công: "' + newName + '"');
    showFlowToast('✅ Đã đổi tên nhân vật thành: "' + newName + '"', 3000);
    return true;
  }

  /** Click nút "Xong" (Done) ở góc trên bên phải trang chi tiết nhân vật để lưu và trở về Canvas */
  async function clickCharacterDoneButton() {
    log('🔍 Tìm nút "Xong" ở góc trên bên phải trang nhân vật...');
    const doneBtn = Array.from(document.querySelectorAll('button, [role="button"], a')).find(el => {
      if (!isVisible(el)) return false;
      if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) return false;
      const t = (el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const r = el.getBoundingClientRect();
      // Nằm ở góc trên bên phải (top < 120, right half)
      const isTopRight = r.top < 120 && r.left > window.innerWidth * 0.5;
      return (t === 'xong' || t === 'done' || aria === 'xong' || aria === 'done') ||
             (isTopRight && (t.includes('xong') || t.includes('done')));
    });

    if (doneBtn) {
      log('🖱️ Bấm nút "Xong" để lưu và quay về Canvas...');
      simulateClick(doneBtn);
      try { doneBtn.click(); } catch(e) {}
      return true;
    }
    return false;
  }

  /** Rename a character card via ⋮ menu -> Đổi tên (hoặc trên trang chi tiết nhân vật) */
  async function renameCharacterCard(targetElementOrName, newName) {
    if (!newName) return false;
    newName = newName.trim();

    // 0. Nếu đang ở trên trang chi tiết nhân vật (/character/{id}), sửa trực tiếp bằng ô đặt tên
    if (window.location.href.includes('/character')) {
      const ok = await editCharacterPageName(newName);
      if (ok) return true;
    }

    log('🏷️ Bắt đầu đổi tên nhân vật thành: "' + newName + '"...');
    showFlowToast('🏷️ Đang đổi tên thành: "' + newName + '"...', 3000);

    let card = null;
    let img = null;

    // 1. Locate card via name hint or element
    if (typeof targetElementOrName === 'string' && targetElementOrName.trim()) {
      const found = findCharacterCard(targetElementOrName) || findMediaCardOnCanvas(targetElementOrName);
      if (found) { card = found.card; img = found.img; }
    } else if (targetElementOrName && targetElementOrName.nodeType) {
      card = climbToCard(targetElementOrName);
      img = targetElementOrName.tagName === 'IMG' ? targetElementOrName : targetElementOrName.querySelector('img');
    }

    // 2. Fallback: newest media card on canvas
    if (!card) {
      log('🔍 Tìm thẻ media mới nhất trên canvas...');
      const mc = findMediaCardOnCanvas(null);
      if (mc) {
        card = mc.card;
        img = mc.img;
      }
    }

    if (!card) {
      log('❌ Không tìm thấy thẻ ảnh trên Flow để đổi tên');
      showFlowToast('❌ Không tìm thấy thẻ ảnh để đổi tên', 3000);
      return false;
    }

    log('🎯 Đã định vị thẻ ảnh: <' + card.tagName + '> class="' + (card.className || '') + '"');

    // 3. Hover card to reveal buttons
    simulateHover(card);
    if (img) simulateHover(img);
    await new Promise(r => setTimeout(r, 600));

    // 4. Find and click ⋮ button
    let moreBtn = findMoreButton(card);
    if (!moreBtn && img) moreBtn = findMoreButton(img);

    if (!moreBtn) {
      log('❌ Không tìm thấy nút ⋮ trên thẻ ảnh');
      showFlowToast('❌ Không tìm thấy nút ⋮ trên thẻ', 3000);
      return false;
    }

    log('🖱️ Click nút ⋮...');
    simulateClick(moreBtn);
    await new Promise(r => setTimeout(r, 800));

    // 5. Find and click "Đổi tên" / "Rename" in the popup menu
    log('🔍 Tìm mục "Đổi tên" trong menu...');
    const renameBtn = await waitForCondition(() => {
      for (const el of document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"], li, div, span')) {
        if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) continue;
        const text = (el.textContent || '').trim();
        if ((text === 'Đổi tên' || text === 'Rename' || text.startsWith('Đổi tên') || text.startsWith('Rename')) && isVisible(el)) {
          return el.closest('button, [role="button"], [role="menuitem"], [role="option"], li') || el;
        }
      }
      return null;
    }, 4000);

    if (!renameBtn) {
      log('❌ Không tìm thấy menu item "Đổi tên"');
      showFlowToast('❌ Không tìm thấy menu item "Đổi tên"', 3000);
      return false;
    }

    log('🖱️ Click "Đổi tên"...');
    simulateClick(renameBtn);
    await new Promise(r => setTimeout(r, 800));

    // 6. Find the rename input field
    log('🔍 Tìm ô nhập tên mới...');
    const searchBar = findSearchBar();
    const promptInput = findPromptInput();

    const renameInput = await waitForCondition(() => {
      // 6a. Check inline input inside the card
      const inlineInput = card.querySelector('input, textarea, [contenteditable="true"]');
      if (inlineInput && isVisible(inlineInput)) {
        log('✓ Tìm thấy ô nhập tên inline trong thẻ ảnh');
        return inlineInput;
      }

      // 6b. Check modal / dialog
      const dialogInput = document.querySelector('[role="dialog"] input, [role="alertdialog"] input, [aria-modal="true"] input');
      if (dialogInput && isVisible(dialogInput)) {
        log('✓ Tìm thấy ô nhập tên trong hộp thoại modal');
        return dialogInput;
      }

      // 6c. Check active focused element
      const active = document.activeElement;
      if (active && active !== document.body && active !== searchBar && active !== promptInput && isVisible(active)) {
        if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.getAttribute('contenteditable') === 'true') {
          log('✓ Tìm thấy ô nhập tên đang focus');
          return active;
        }
      }

      // 6d. Filter all visible inputs, excluding search bar & prompt
      const allInputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]'));
      return allInputs.find(i => {
        if (!isVisible(i)) return false;
        if (i === searchBar || i === promptInput) return false;
        if (i.closest('#flowauto-floating-widget') || i.closest('#flowauto-toast')) return false;
        const ph = (i.getAttribute('placeholder') || '').toLowerCase();
        if (ph.includes('bạn muốn tạo') || ph.includes('what do you want') || ph.includes('tìm kiếm') || ph.includes('search')) return false;
        return true;
      });
    }, 4000);

    if (!renameInput) {
      log('❌ Không tìm thấy ô nhập tên mới');
      showFlowToast('❌ Không tìm thấy ô nhập tên mới', 3000);
      return false;
    }

    log('✍️ Điền tên nhân vật mới: "' + newName + '"...');
    renameInput.focus();
    renameInput.click();

    if (typeof renameInput.select === 'function') {
      renameInput.select();
    }
    clearSearchInput(renameInput);
    await new Promise(r => setTimeout(r, 200));

    // Inject the new name via React-compatible setters
    injectTextToReactInput(renameInput, newName);

    try {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) nativeSetter.call(renameInput, newName);
      else renameInput.value = newName;
      renameInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      renameInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } catch(e) {}

    await new Promise(r => setTimeout(r, 300));

    // 7. Submit rename: Enter key + blur + click Save if button exists
    log('💾 Xác nhận lưu tên...');
    const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
    renameInput.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    renameInput.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
    renameInput.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

    renameInput.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));

    setTimeout(() => {
      const saveBtn = findButtonByText('Lưu') || findButtonByText('Save') || findButtonByText('Xong') || findButtonByText('Done') || findButtonByText('Xác nhận');
      if (saveBtn) {
        log('🖱️ Click nút Xác nhận/Lưu...');
        simulateClick(saveBtn);
      }
    }, 300);

    await new Promise(r => setTimeout(r, 600));
    log('🎉 Đổi tên nhân vật thành công: "' + newName + '"');
    showFlowToast('🏷️ Đã đổi tên nhân vật thành: "' + newName + '"', 4000);
    return true;
  }

  /** Find button by text content (case-insensitive) */
  function findButtonByText(searchText) {
    if (!searchText) return null;
    const searchLower = searchText.trim().toLowerCase();
    for (const el of document.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"], li, a')) {
      if ((el.textContent?.trim().toLowerCase() || '').includes(searchLower) && isVisible(el)) return el;
    }
    for (const el of document.querySelectorAll('span, div, a, p')) {
      const own = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim().toLowerCase()).join('');
      if (own.includes(searchLower) && isVisible(el)) return el.closest('button, [role="button"], [role="menuitem"], [role="option"], li, a') || climbToCard(el);
    }
    return null;
  }

  /** Find prompt input "Bạn muốn tạo những gì?" at the bottom prompt bar */
  function findPromptInput() {
    const placeholders = [
      'bạn muốn tạo những gì',
      'bạn muốn tạo gì',
      'what do you want to create',
      'what would you like to create',
      'start creating or drop media',
      'start creating',
      'drop media',
      'bắt đầu tạo hoặc thả nội dung nghe nhìn',
      'thả nội dung nghe nhìn',
      'nhập câu lệnh',
      'enter a prompt',
      'type a prompt',
      'describe your character',
      'describe a character',
      'describe the character',
      'character description'
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
      if (!isPromptBarInput(el)) continue;
      const ph = (el.getAttribute('placeholder') || el.getAttribute('aria-placeholder') ||
                 el.getAttribute('data-placeholder') || '').toLowerCase();
      for (const p of placeholders) {
        if (ph.includes(p) && isVisible(el)) {
          log('✓ findPromptInput: matched by placeholder "' + ph + '" at y=' + Math.round(el.getBoundingClientRect().top));
          return el;
        }
      }
    }

    // Strategy 2: Look for contenteditable with placeholder nearby text
    for (const el of document.querySelectorAll('[contenteditable="true"]')) {
      if (!isPromptBarInput(el)) continue;
      // Check if parent/sibling has the placeholder text
      const parent = el.parentElement;
      if (parent) {
        const parentText = (parent.textContent || '').toLowerCase();
        for (const p of placeholders) {
          if (parentText.includes(p)) {
            log('✓ findPromptInput: contenteditable near placeholder text at y=' + Math.round(el.getBoundingClientRect().top));
            return el;
          }
        }
      }
    }

    // Strategy 3: Find input near "+ Agent" / "+ Tác nhân" / "+ Characters" button (they're in the same prompt bar)
    const tacNhanBtn = findButtonByText('Agent') || findButtonByText('agent') || findButtonByText('Tác nhân') || findButtonByText('Characters') || findButtonByText('Character') || findButtonByText('Actors') || findButtonByText('Actor');
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

  function getProjectId() {
    const m = window.location.href.match(/\/project\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : null;
  }

  /** Find prompt input specifically on https://flow.google.com/project/{projectId}/character */
  function findCharacterPromptInput() {
    const allInputs = Array.from(document.querySelectorAll('textarea, input[type="text"], input:not([type]), [contenteditable], [role="textbox"], [role="combobox"]'));
    const charPlaceholders = [
      'mô tả nhân vật của bạn',
      'mô tả nhân vật',
      'nhân vật của bạn',
      'describe your character',
      'describe a character',
      'describe the character',
      'character description',
      'describe',
      'character'
    ];

    // 1. Check placeholder & aria-label on all editable elements
    for (const el of allInputs) {
      if (!isVisible(el)) continue;
      if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) continue;
      const ph = (el.getAttribute('placeholder') || el.getAttribute('data-placeholder') || el.getAttribute('aria-placeholder') || '').toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      for (const p of charPlaceholders) {
        if (ph.includes(p) || aria.includes(p)) {
          log('✓ findCharacterPromptInput: matched placeholder/aria "' + p + '" at y=' + Math.round(el.getBoundingClientRect().top));
          return el;
        }
      }
    }

    // 2. Look for any visible element on page containing the text "Mô tả nhân vật của bạn" / "Describe your character" (the placeholder element)
    const textPlaceholders = Array.from(document.querySelectorAll('p, span, div, label')).filter(el => {
      if (!isVisible(el)) return false;
      if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) return false;
      if (el.children.length > 2) return false;
      const t = (el.textContent || '').trim().toLowerCase();
      return t.includes('mô tả nhân vật') || t.includes('describe your character') || t.includes('describe a character') || t.includes('describe the character') || t.includes('character description');
    });

    for (const tEl of textPlaceholders) {
      if (tEl.isContentEditable || tEl.matches('textarea, input, [role="textbox"], [contenteditable]')) {
        log('✓ findCharacterPromptInput: placeholder element itself is editable at y=' + Math.round(tEl.getBoundingClientRect().top));
        return tEl;
      }
      let curr = tEl.parentElement;
      let foundEditable = null;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        const editable = curr.querySelector('textarea, [contenteditable="true"], [contenteditable=""], [contenteditable], [role="textbox"], input[type="text"], input:not([type])');
        if (editable && editable !== tEl && isVisible(editable)) {
          foundEditable = editable;
          break;
        }
        curr = curr.parentElement;
      }
      if (foundEditable) {
        log('✓ findCharacterPromptInput: found editable inside placeholder ancestor at y=' + Math.round(foundEditable.getBoundingClientRect().top));
        return foundEditable;
      }
      try {
        simulateClick(tEl);
        if (document.activeElement && document.activeElement !== document.body && 
            (document.activeElement.isContentEditable || document.activeElement.matches('textarea, input, [role="textbox"]'))) {
          log('✓ findCharacterPromptInput: clicking placeholder activated activeElement at y=' + Math.round(document.activeElement.getBoundingClientRect().top));
          return document.activeElement;
        }
      } catch (e) {}
    }

    // 3. Proximity to bottom prompt bar controls: Find container containing "Định dạng" or "Banana" or "+"
    const formatBtn = Array.from(document.querySelectorAll('button, [role="button"]')).find(b => {
      const t = (b.textContent || '').toLowerCase();
      return isVisible(b) && (t.includes('định dạng') || t.includes('format') || t.includes('banana'));
    });
    if (formatBtn) {
      let curr = formatBtn.parentElement;
      while (curr && curr !== document.body && curr !== document.documentElement) {
        const editable = curr.querySelector('textarea, [contenteditable="true"], [contenteditable=""], [contenteditable], [role="textbox"], input[type="text"], input:not([type])');
        if (editable && isVisible(editable)) {
          log('✓ findCharacterPromptInput: found editable in prompt bar near "Định dạng"/"Banana" at y=' + Math.round(editable.getBoundingClientRect().top));
          return editable;
        }
        curr = curr.parentElement;
      }
    }

    // 4. Fallback: Any visible textarea / contenteditable in bottom half of screen
    const bottomInputs = allInputs.filter(el => {
      if (!isVisible(el)) return false;
      if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) return false;
      const r = el.getBoundingClientRect();
      return r.top > window.innerHeight * 0.35 && r.width >= 100;
    });
    if (bottomInputs.length > 0) {
      log('✓ findCharacterPromptInput: fallback bottom input at y=' + Math.round(bottomInputs[0].getBoundingClientRect().top));
      return bottomInputs[0];
    }

    // 5. Fallback to general findPromptInput
    return findPromptInput();
  }

  /** Awaitable OS-level hardware mouse click via Chrome Debugger CDP */
  async function performDebuggerClick(x, y) {
    if (x <= 0 || y <= 0) return false;
    return new Promise((resolve) => {
      let done = false;
      const finish = (val) => {
        if (!done) {
          done = true;
          window.removeEventListener('message', handler);
          resolve(val);
        }
      };
      const handler = (e) => {
        if (e.source !== window) return;
        if (e.data && e.data.type === 'FLOW_DEBUGGER_CLICK_RESULT') {
          finish(!!e.data.success);
        }
      };
      window.addEventListener('message', handler);
      window.postMessage({ type: 'FLOW_DEBUGGER_CLICK', x: x, y: y }, '*');
      setTimeout(() => finish(false), 4000);
    });
  }

  /** Find the submit arrow button (->) on character page or main prompt bar */
  function findCharacterSubmitArrowButton(inputEl) {
    if (!inputEl) inputEl = findPromptInput() || findCharacterPromptInput();
    if (!inputEl) return null;

    const inputRect = inputEl.getBoundingClientRect();

    // 1. Identify composer container
    const composer = (typeof getCharacterComposer === 'function' ? getCharacterComposer(inputEl) : null) ||
                     inputEl?.closest('form, [class*="composer"], [class*="prompt"], [role="dialog"], div[class*="card"]') ||
                     inputEl?.parentElement?.parentElement?.parentElement?.parentElement ||
                     inputEl?.parentElement?.parentElement?.parentElement ||
                     inputEl?.parentElement?.parentElement ||
                     inputEl?.parentElement;

    const composerRect = composer ? composer.getBoundingClientRect() : inputRect;

    const roots = [composer, document].filter(Boolean);

    for (const root of roots) {
      const allButtons = Array.from(root.querySelectorAll('button, [role="button"], a[role="button"], div[tabindex="0"]'));

      // Filter to potential submit candidates by strictly excluding controls that are NOT submit
      const validButtons = allButtons.filter(btn => {
        if (!isVisible(btn)) return false;
        if (btn.closest('#flowauto-floating-widget') || btn.closest('#flowauto-toast')) return false;

        // GEOMETRIC BOUNDARY CONSTRAINT:
        // A submit button is small (not a canvas card) and located within/near the composer
        const br = btn.getBoundingClientRect();
        if (br.width < 16 || br.height < 16) return false;
        if (br.width > 120 || br.height > 80) return false; // Canvas cards are >= 160x120px!

        // Must NEVER be in the top navbar / header (y < 80)
        if (br.top < 80) return false;
        if (btn.closest('header, nav, [role="banner"], [class*="navbar"], [class*="header"]')) return false;

        // Must NOT be far above the prompt input (canvas cards and header are above)
        if (br.bottom < inputRect.top + 10) return false;
        // Must NOT be far below the composer
        if (br.top > inputRect.bottom + 250) return false;
        // Must NOT be far off to the left of the input
        if (br.right < inputRect.left - 10) return false;

        // Never a card containing headings or paragraphs
        if (btn.querySelector('h1, h2, h3, h4, h5, p')) return false;

        const text = (btn.textContent || '').trim().toLowerCase();
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const title = (btn.getAttribute('title') || '').toLowerCase();
        const href = (btn.getAttribute('href') || '').toLowerCase();

        // STRICT EXCLUSIONS:
        // Exclude Google Account, user profile, avatar, ultra badge
        if (aria.includes('account') || aria.includes('tài khoản') || aria.includes('profile') ||
            aria.includes('user') || aria.includes('google') || title.includes('account') ||
            title.includes('profile') || text.includes('ultra') || text === 'võ' || href.includes('accounts.google.com')) return false;

        // STRICT EXCLUSIONS:
        // Exclude back button, dropdowns, clear button, attachments, formats, models, etc.
        if (aria.includes('back') || aria.includes('quay lại') || aria.includes('trở về') ||
            title.includes('back') || title.includes('quay lại')) return false;
        if (aria === 'down' || aria === 'up' || aria.includes('thumbs down') || aria.includes('thumbs up') ||
            aria.includes('chevron down') || aria.includes('chevron up') ||
            title === 'down' || title === 'up') return false;
        if (aria.includes('clear') || aria.includes('close') || aria.includes('remove') || aria.includes('delete') ||
            aria.includes('xóa') || aria.includes('hủy') || aria.includes('đóng') ||
            title.includes('clear') || title.includes('close') || title.includes('remove') ||
            text === '✕' || text === '×' || text === 'x' || text === 'X') return false;
        if (text === '+' || aria.includes('attach') || aria.includes('thêm tệp') ||
            text.includes('format') || text.includes('định dạng') ||
            text.includes('banana') || text.includes('nano') ||
            text.includes('agent') || text.includes('tác nhân') ||
            text === 'video' || text === 'image' || text === 'hình ảnh' || text === 'ảnh' || text === 'phim' ||
            text.includes('720p') || text.includes('1080p') ||
            text.includes('upload') || text.includes('tải lên') ||
            text.includes('project') || text.includes('dự án') ||
            text.includes('favorite') || text.includes('thích')) return false;

        // STRICT CANVAS / AVATAR / CHARACTER EXCLUSIONS:
        // NEVER match avatar creation cards, new character buttons, or template cards
        if (aria.includes('avatar') || text.includes('avatar') || title.includes('avatar') ||
            aria.includes('đại diện') || text.includes('đại diện') || title.includes('đại diện') ||
            aria.includes('new character') || text.includes('new character') || title.includes('new character') ||
            aria.includes('nhân vật mới') || text.includes('nhân vật mới') || title.includes('nhân vật mới') ||
            aria.includes('create your avatar') || text.includes('create your avatar') ||
            aria.includes('tạo hình đại diện') || text.includes('tạo hình đại diện') ||
            aria.includes('template') || text.includes('template') || title.includes('template') ||
            aria.includes('mẫu') || text.includes('mẫu') || title.includes('mẫu') ||
            aria.includes('explore') || text.includes('explore') || title.includes('explore') ||
            aria.includes('khám phá') || text.includes('khám phá') || title.includes('khám phá') ||
            aria.includes('history') || text.includes('history') || title.includes('history')) return false;

        return true;
      });

      // Priority 1: Dedicated SVG arrow forward/send icon (the most specific marker of submit arrow button)
      for (const btn of validButtons) {
        const svg = btn.querySelector('svg');
        if (svg) {
          const pathDs = Array.from(svg.querySelectorAll('path, polygon, polyline, line')).map(p =>
            (p.getAttribute('d') || '') + ' ' + (p.getAttribute('points') || '') + ' ' + (p.getAttribute('x1') || '')
          ).join(' ');
          if (pathDs.includes('M5 12') || pathDs.includes('M12 4') || pathDs.includes('l8-8') ||
              pathDs.includes('16.17') || pathDs.includes('M10 6') || pathDs.includes('2.01') ||
              pathDs.includes('M4 12') || pathDs.includes('M5 13') || pathDs.includes('21.14') ||
              pathDs.includes('forward') || pathDs.includes('send') || pathDs.includes('M12 2L2 22') ||
              pathDs.includes('M2.01 21L23 12') || pathDs.includes('arrow') || pathDs.includes('M16') ||
              pathDs.includes('M20') || pathDs.includes('M13') || pathDs.includes('M14') ||
              pathDs.includes('19') || pathDs.includes('12')) {
            log('✓ findCharacterSubmitArrowButton: matched arrow path in SVG');
            return btn;
          }
        }
      }

      // Priority 2: By explicit submit/send/generate/run/tạo video label (en & vi)
      for (const btn of validButtons) {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const title = (btn.getAttribute('title') || '').toLowerCase();
        const text = (btn.textContent || '').trim().toLowerCase();
        const matched = [aria, title, text].some(s =>
          s === 'tạo' || s === 'gửi' || s === 'submit' || s === 'create' || s === 'send' || s === 'generate' || s === 'run' || s === 'chạy' ||
          s === 'tạo video' || s === 'create video' || s === 'generate video' || s === 'tạo ảnh' || s === 'create image' ||
          s.includes('submit') || s.includes('send') || s.includes('generate') || s.includes('forward') ||
          s.includes('tạo video') || s.includes('create video') || s.includes('generate video') ||
          s.includes('chạy') || s.includes('arrow')
        );
        if (matched) {
          log('✓ findCharacterSubmitArrowButton: matched aria/title/text: "' + (aria || title || text) + '"');
          return btn;
        }
      }

      // Priority 3: Any button containing an SVG at the bottom-right of the composer toolbar
      const svgButtons = validButtons.filter(b => b.querySelector('svg'));
      if (svgButtons.length > 0) {
        const sorted = [...svgButtons].sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
        const rightmost = sorted[0];
        const br = rightmost.getBoundingClientRect();
        if (br.right > inputRect.left + 50) {
          log('✓ findCharacterSubmitArrowButton: picked rightmost SVG button at x=' + Math.round(br.right) + ', y=' + Math.round(br.top));
          return rightmost;
        }
      }

      // Priority 4: Inside composer, pick the rightmost button in the toolbar
      if (root === composer && validButtons.length > 0) {
        const sorted = [...validButtons].sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
        const rightmost = sorted[0];
        log('✓ findCharacterSubmitArrowButton: picked rightmost button inside composer at x=' + Math.round(rightmost.getBoundingClientRect().right));
        return rightmost;
      }

      // Priority 5: The rightmost small button in the document near the composer
      if (validButtons.length > 0) {
        const sorted = [...validButtons].sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
        for (const candidate of sorted) {
          const br = candidate.getBoundingClientRect();
          if (br.top < 80) continue;
          if (br.right > inputRect.left + 50) {
            log('✓ findCharacterSubmitArrowButton: picked rightmost candidate at x=' + Math.round(br.right) + ', y=' + Math.round(br.top));
            return candidate;
          }
        }
      }
    }

    return null;
  }

  const findSubmitArrowButton = findCharacterSubmitArrowButton;

  function isSubmitButtonEnabled(btn) {
    if (!btn || !isVisible(btn)) return false;
    if (btn.disabled || btn.hasAttribute('disabled')) return false;
    if (btn.getAttribute('aria-disabled') === 'true') return false;
    const style = window.getComputedStyle(btn);
    if (style.pointerEvents === 'none') return false;
    if (parseFloat(style.opacity) < 0.4) return false;
    return true;
  }

  /** Force React/Wiz validation to activate and enable the submit arrow button */
  async function ensureSubmitButtonActivated(input) {
    if (!input) input = findPromptInput() || findCharacterPromptInput();
    if (!input) return false;

    let submitBtn = findSubmitArrowButton(input);
    if (submitBtn && isSubmitButtonEnabled(submitBtn)) {
      log('✓ Submit button is already enabled');
      return true;
    }

    log('⚡ Đang kích hoạt nút submit (bật trạng thái enabled)...');

    // 1. Ensure input is focused
    try { input.focus(); } catch(e) {}
    try { input.click(); } catch(e) {}

    // 2. Trigger React controlled value tracker synchronization
    const curVal = (input.value || input.innerText || input.textContent || '').trim();
    if (curVal.length > 0) {
      try {
        const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) nativeSetter.call(input, curVal);
        if (input._valueTracker) input._valueTracker.setValue('');
      } catch(e) {}

      const opts = { bubbles: true, composed: true };
      input.dispatchEvent(new InputEvent('beforeinput', { ...opts, inputType: 'insertText', data: ' ' }));
      input.dispatchEvent(new InputEvent('input', { ...opts, inputType: 'insertText', data: ' ' }));
      input.dispatchEvent(new Event('change', opts));
    }

    // 3. Physical keystroke simulation via Debugger API: type space then backspace
    try {
      window.postMessage({ type: 'FLOW_DEBUGGER_TYPE', text: ' ' }, '*');
      await new Promise(r => setTimeout(r, 200));
      window.postMessage({ type: 'FLOW_DEBUGGER_BACKSPACE' }, '*');
      await new Promise(r => setTimeout(r, 200));
    } catch(e) {}

    // 4. Also dispatch DOM synthetic backspace and input events as fallback
    try {
      const bsOpts = { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true, composed: true };
      input.dispatchEvent(new KeyboardEvent('keydown', bsOpts));
      input.dispatchEvent(new KeyboardEvent('keyup', bsOpts));
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    } catch(e) {}

    // 5. Wait up to 2.5s for submit button to become enabled
    const startWait = Date.now();
    while (Date.now() - startWait < 2500) {
      submitBtn = findSubmitArrowButton(input);
      if (submitBtn && isSubmitButtonEnabled(submitBtn)) {
        log('✓ Submit button activated successfully!');
        return true;
      }
      await new Promise(r => setTimeout(r, 250));
    }

    return !!(submitBtn && isSubmitButtonEnabled(submitBtn));
  }

  /** Trigger click through DOM layers to ensure React/Wiz event handlers fire */
  function triggerRealClick(el) {
    if (!el) return false;
    scrollIntoViewIfNeeded(el);
    const { x, y } = getCenter(el);
    const target = (x > 0 && y > 0) ? (document.elementFromPoint(x, y) || el) : el;
    const opts = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y,
      screenX: (window.screenX || 0) + x, screenY: (window.screenY || 0) + y,
      button: 0, buttons: 1, detail: 1, pointerId: 1, pointerType: 'mouse'
    };

    // 1. Dispatch pointerdown / mousedown on both target and el
    target.dispatchEvent(new PointerEvent('pointerdown', opts));
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    if (target !== el) {
      try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch(e) {}
      try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch(e) {}
    }
    try { el.focus(); } catch (e) {}

    // 2. Dispatch pointerup / mouseup / click
    const upOpts = { ...opts, buttons: 0 };
    target.dispatchEvent(new PointerEvent('pointerup', upOpts));
    target.dispatchEvent(new MouseEvent('mouseup', upOpts));
    target.dispatchEvent(new MouseEvent('click', upOpts));

    // 3. Also dispatch click on the button element if target was a child
    if (target !== el) {
      try { el.dispatchEvent(new PointerEvent('pointerup', upOpts)); } catch(e) {}
      try { el.dispatchEvent(new MouseEvent('mouseup', upOpts)); } catch(e) {}
      try { el.dispatchEvent(new MouseEvent('click', upOpts)); } catch(e) {}
    }

    // 4. Native DOM click & prototype call
    try { el.click(); } catch(e) {}
    try { HTMLButtonElement.prototype.click.call(el); } catch(e) {}

    return true;
  }

  /** Bulletproof submit button clicker: DOM layers + OS-level hardware click via CDP + Dual Keyboard Enter */
  async function clickSubmitArrowButton(btn, inputEl) {
    if (!btn) return false;
    scrollIntoViewIfNeeded(btn);
    await new Promise(r => setTimeout(r, 100));

    // Focus input if available to ensure state synchronization
    if (inputEl && inputEl.isConnected) {
      try { inputEl.focus(); } catch(e) {}
    }

    const { x, y } = getCenter(btn);
    log('🖱️ Clicking submit button at coordinates (' + Math.round(x) + ', ' + Math.round(y) + ')...');

    // 1. Hover
    simulateHover(btn);
    await new Promise(r => setTimeout(r, 100));

    // 2. Multi-layer DOM click
    triggerRealClick(btn);

    // 3. OS-level hardware mouse click via Chrome Debugger CDP (awaited)
    if (x > 0 && y > 0) {
      log('🐞 Triggering OS-level Debugger Mouse Click at (' + Math.round(x) + ', ' + Math.round(y) + ')...');
      const cdpSuccess = await performDebuggerClick(x, y);
      log(cdpSuccess ? '✓ CDP Debugger Click succeeded' : 'ℹ️ CDP Debugger Click finished/timeout');
    }

    // 4. Native click fallback
    try { btn.click(); } catch(e) {}
    try { HTMLButtonElement.prototype.click.call(btn); } catch(e) {}

    // 5. If button is within a form, submit the form directly
    try {
      if (btn.form) btn.form.requestSubmit(btn);
    } catch(e) {}

    // 6. Dual Keyboard Submission (Ctrl+Enter and Enter)
    if (inputEl && inputEl.isConnected) {
      try {
        inputEl.focus();
        // CDP level: Send Ctrl+Enter, then Enter
        window.postMessage({ type: 'FLOW_DEBUGGER_ENTER', ctrlKey: true }, '*');
        await new Promise(r => setTimeout(r, 150));
        window.postMessage({ type: 'FLOW_DEBUGGER_ENTER' }, '*');

        // DOM level: Synthetic KeyboardEvents
        const enterCtrl = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, ctrlKey: true, bubbles: true, cancelable: true, composed: true };
        inputEl.dispatchEvent(new KeyboardEvent('keydown', enterCtrl));
        inputEl.dispatchEvent(new KeyboardEvent('keypress', enterCtrl));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', enterCtrl));

        const enterPlain = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
        inputEl.dispatchEvent(new KeyboardEvent('keydown', enterPlain));
        inputEl.dispatchEvent(new KeyboardEvent('keypress', enterPlain));
        inputEl.dispatchEvent(new KeyboardEvent('keyup', enterPlain));
      } catch(e) {}
    }

    return true;
  }

  /** Reliably focus, click, and position caret inside an input or contenteditable element */
  async function focusAndClickInput(input) {
    if (!input) return null;
    scrollIntoViewIfNeeded(input);
    await new Promise(r => setTimeout(r, 150));

    // 1. Native focus and click
    try { input.focus(); } catch(e) {}
    try { input.click(); } catch(e) {}

    // 2. Pointer & Mouse events
    const { x, y } = getCenter(input);
    const opts = {
      bubbles: true, cancelable: true, composed: true, view: window,
      clientX: x, clientY: y,
      screenX: window.screenX + x, screenY: window.screenY + y,
      button: 0, buttons: 1, detail: 1
    };
    input.dispatchEvent(new PointerEvent('pointerdown', opts));
    input.dispatchEvent(new MouseEvent('mousedown', opts));
    input.dispatchEvent(new PointerEvent('pointerup', { ...opts, buttons: 0 }));
    input.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }));
    input.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 }));
    try { input.focus(); } catch(e) {}

    await new Promise(r => setTimeout(r, 150));

    // Resolve active element if focus shifted to an inner editable
    let active = input;
    if (document.activeElement && document.activeElement !== document.body &&
        (document.activeElement.isContentEditable || document.activeElement.matches('textarea, input, [role="textbox"]'))) {
      active = document.activeElement;
    }

    // Position cursor cleanly at end of input
    try {
      if (active.isContentEditable || active.getAttribute('contenteditable') === 'true' || active.getAttribute('role') === 'textbox') {
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(active);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        active.selectionStart = active.selectionEnd = (active.value || '').length;
      }
    } catch(e) {}

    return active;
  }

  /** Type text into an input element using multiple complementary strategies */
  async function typeWithDebuggerOrFallback(input, text) {
    if (!input) return false;

    // 1. Focus and click the input cleanly
    input = await focusAndClickInput(input) || input;

    const first15 = (text || '').trim().slice(0, 15);
    const hasText = () => {
      const v = (input.value || input.innerText || input.textContent || '').trim();
      return first15.length > 0 && v.includes(first15);
    };

    if (hasText()) return true;

    // Strategy 1: OS-level Chrome Debugger typing (highest reliability for React state)
    log('⌨️ Strategy 1: Chrome Debugger typing...');
    try {
      input = await focusAndClickInput(input) || input;
      await new Promise((resolve) => {
        let done = false;
        const finish = (val) => {
          if (!done) {
            done = true;
            window.removeEventListener('message', handler);
            resolve(val);
          }
        };
        const handler = (e) => {
          if (e.source !== window) return;
          if (e.data && e.data.type === 'FLOW_DEBUGGER_RESULT') {
            finish(!!e.data.success);
          }
        };
        window.addEventListener('message', handler);
        window.postMessage({ type: 'FLOW_DEBUGGER_TYPE', text: text }, '*');
        setTimeout(() => finish(false), 6000);
      });
    } catch(e) {}

    await new Promise(r => setTimeout(r, 250));
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true, key: 'Process', keyCode: 229 }));

    if (hasText()) {
      log('✓ Text entered via Chrome Debugger');
      await ensureSubmitButtonActivated(input);
      return true;
    }

    // Strategy 2: injectTextToReactInput fallback (React native setter + valueTracker)
    log('💉 Strategy 2: injectTextToReactInput fallback...');
    injectTextToReactInput(input, text);
    await new Promise(r => setTimeout(r, 200));
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    if (hasText()) {
      log('✓ Text entered via injectTextToReactInput');
      await ensureSubmitButtonActivated(input);
      return true;
    }

    // Strategy 3: document.execCommand('insertText')
    log('✍️ Strategy 3: document.execCommand("insertText")...');
    try {
      input.focus();
      document.execCommand('insertText', false, text);
    } catch(e) {}
    await new Promise(r => setTimeout(r, 200));
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    if (hasText()) {
      log('✓ Text entered via execCommand');
      await ensureSubmitButtonActivated(input);
      return true;
    }

    // Strategy 4: Synthetic paste event with DataTransfer
    log('📋 Strategy 4: Synthetic paste with DataTransfer...');
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      input.dispatchEvent(new ClipboardEvent('paste', {
        bubbles: true, cancelable: true, composed: true, clipboardData: dt
      }));
      input.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, composed: true, inputType: 'insertFromPaste', data: text
      }));
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true, cancelable: true, composed: true, inputType: 'insertFromPaste', data: text
      }));
    } catch(e) {}
    await new Promise(r => setTimeout(r, 200));
    await ensureSubmitButtonActivated(input);
    return hasText();

    await new Promise(r => setTimeout(r, 300));
    const curVal = (input.value || input.innerText || input.textContent || '').trim();
    log('✍️ Text check: "' + curVal.substring(0, 50) + '..."');
    return hasText();
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

  /** Switch prompt bar creation mode between 'image' and 'video' */
  async function switchCreationMode(targetMode) {
    targetMode = (targetMode || 'image').toLowerCase();
    log('🎨 Đang chuyển chế độ tạo sang: ' + targetMode);

    const isImageTarget = targetMode === 'image';
    const modeKeywords = isImageTarget ? ['hình ảnh', 'image', 'ảnh', 'photo'] : ['video', 'phim'];

    // 1. Check prompt bar buttons
    const promptInput = findPromptInput();
    const promptBar = promptInput?.closest('form, [class*="prompt"], [class*="composer"]') || document.body;
    const promptButtons = Array.from(promptBar.querySelectorAll('button, [role="button"], [role="combobox"]'));

    const currentModeBtn = promptButtons.find(b => {
      if (!isVisible(b)) return false;
      const text = (b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      return text.includes('video') || text.includes('hình ảnh') || text.includes('image') || aria.includes('video') || aria.includes('image');
    });

    if (currentModeBtn) {
      const btnText = (currentModeBtn.textContent || '').toLowerCase();
      const btnAria = (currentModeBtn.getAttribute('aria-label') || '').toLowerCase();

      // If already in target mode, we're good!
      if (modeKeywords.some(kw => btnText.includes(kw) || btnAria.includes(kw))) {
        log('✓ Đã ở chế độ: ' + targetMode);
        return true;
      }

      log('🖱️ Click nút chuyển chế độ: "' + currentModeBtn.textContent.trim() + '"');
      simulateClick(currentModeBtn);
      await new Promise(r => setTimeout(r, 600));

      // Wait for dropdown option
      const option = await waitForCondition(() => {
        for (const el of document.querySelectorAll('[role="option"], [role="menuitem"], button, div, span, li')) {
          if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) continue;
          const text = (el.textContent || '').trim().toLowerCase();
          if (isVisible(el) && modeKeywords.some(kw => text === kw || text.startsWith(kw))) {
            return el.closest('[role="option"], [role="menuitem"], button, li') || el;
          }
        }
        return null;
      }, 3000);

      if (option) {
        log('✓ Chọn tùy chọn: "' + option.textContent.trim() + '"');
        simulateClick(option);
        await new Promise(r => setTimeout(r, 600));
        return true;
      }
    }

    // 2. Fallback: Click sidebar "Hình ảnh"
    if (isImageTarget) {
      const sidebarItems = Array.from(document.querySelectorAll('nav [role="button"], aside [role="button"], [role="navigation"] button, button, a'));
      const imgTab = sidebarItems.find(el => {
        if (!isVisible(el)) return false;
        const text = (el.textContent || '').trim().toLowerCase();
        return text === 'hình ảnh' || text === 'images' || text === 'image';
      });
      if (imgTab) {
        log('🖱️ Click tab "Hình ảnh" ở menu bên trái...');
        simulateClick(imgTab);
        await new Promise(r => setTimeout(r, 800));
        return true;
      }
    }

    return false;
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

  function getCharacterComposer(input) {
    if (!input) return null;
    let curr = input.parentElement;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      const hasAttachment = curr.querySelector('[data-testid*="attachment"], [data-type*="media"], [aria-label*="remove" i], [aria-label*="delete" i], [aria-label*="xóa" i], [aria-label*="gỡ" i], [class*="attachment"], [class*="chip"]');
      const hasControls = Array.from(curr.querySelectorAll('button, [role="button"]')).some(b => {
        const t = (b.textContent || '').toLowerCase();
        const aria = (b.getAttribute('aria-label') || '').toLowerCase();
        if (t.includes('avatar') || aria.includes('avatar') || t.includes('đại diện') || aria.includes('đại diện') ||
            t.includes('new character') || aria.includes('new character')) return false;
        return t.includes('định dạng') || t.includes('format') || t.includes('banana') || t.includes('nano') ||
               t.includes('agent') || t.includes('tác nhân') || t.includes('video') || t.includes('720p') || t.includes('1080p') ||
               aria.includes('tạo') || aria.includes('gửi') || aria.includes('submit') || aria.includes('create') || aria.includes('send') || aria.includes('generate');
      });
      if (hasControls || hasAttachment || curr.matches('form, [class*="composer"], [class*="prompt"], [role="dialog"], [class*="card"]')) {
        return curr;
      }
      if (curr.tagName === 'MAIN' || curr.tagName === 'NAV' || curr.tagName === 'HEADER' || curr.getAttribute('role') === 'main' ||
          curr.classList.contains('canvas') || (curr.querySelector('h1, h2') && !curr.querySelector('textarea, [contenteditable]'))) {
        break;
      }
      curr = curr.parentElement;
    }
    return input.closest('form, [class*="composer"], [class*="prompt"], [role="dialog"]') ||
           input.parentElement?.parentElement?.parentElement ||
           input.parentElement?.parentElement ||
           input.parentElement || null;
  }

  function describeAttachmentElement(el) {
    const rect = el.getBoundingClientRect();
    return [el.tagName, el.currentSrc || el.getAttribute('src') || '', el.getAttribute('data-type') || '', el.getAttribute('data-testid') || '', el.getAttribute('aria-label') || '', Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)].join('|');
  }

  function attachmentSignature(composer, input) {
    if (!composer) return '';
    let activeComposer = composer;
    if (!activeComposer.isConnected && input?.isConnected) {
      activeComposer = getCharacterComposer(input) || activeComposer;
    }
    const inputRect = input?.getBoundingClientRect() || { top: 0, bottom: 0, left: 0, right: 0 };
    const selector = 'img, video, svg, button, [class*="chip"], [class*="pill"], [class*="attachment"], [class*="thumbnail"], [class*="preview"], [data-type*="media"], [data-testid*="attachment"], [aria-label*="remove" i], [aria-label*="delete" i], [aria-label*="xóa" i], [aria-label*="gỡ" i], [aria-label*="hủy" i], [aria-label*="close" i], [aria-label*="đóng" i], [aria-label*="clear" i], [aria-label*="dismiss" i]';
    const candidates = new Set(activeComposer.querySelectorAll(selector));
    const portalSelector = ['[role="dialog"]', '[role="menu"]', '[data-radix-portal]']
      .flatMap(scope => selector.split(', ').map(part => scope + ' ' + part))
      .join(', ');
    for (const el of document.querySelectorAll(portalSelector)) {
      const rect = el.getBoundingClientRect();
      const attachmentControl = el.matches('[data-testid*="attachment"], [data-type*="media"], [aria-label*="remove" i], [aria-label*="delete" i], [aria-label*="xóa" i], [aria-label*="gỡ" i], [class*="chip"], [class*="pill"]');
      const nearInput = rect.width > 0 && rect.height > 0 && rect.width <= 240 && rect.height <= 180 && Math.abs(rect.top - inputRect.top) <= 320;
      if (attachmentControl || nearInput) candidates.add(el);
    }
    return Array.from(candidates)
      .filter(el => el !== input && isVisible(el) && !el.closest('#flowauto-floating-widget') && !el.closest('#flowauto-toast'))
      .map(describeAttachmentElement)
      .sort()
      .join('\n');
  }

  function hasConfirmedAttachment(composer, input = null) {
    if (!composer) return false;
    let activeComposer = composer;
    if (!input || !input.isConnected) {
      input = activeComposer.querySelector('textarea, [contenteditable="true"], [contenteditable=""], [contenteditable], [role="textbox"], input[type="text"], input:not([type])') || findCharacterPromptInput();
    }
    if (!activeComposer.isConnected && input?.isConnected) {
      activeComposer = getCharacterComposer(input) || activeComposer;
    }

    // 1. Trust already verified product attachment evidence
    if (productAttachmentEvidence?.after) return true;

    // 2. Explicit attachment attributes or classes
    const explicit = '[data-testid*="attachment"], [data-type*="media"], [aria-label*="remove" i], [aria-label*="delete" i], [aria-label*="xóa" i], [aria-label*="gỡ" i], [aria-label*="hủy" i], [aria-label*="close" i], [aria-label*="đóng" i], [aria-label*="clear" i], [aria-label*="dismiss" i], [class*="attachment"], [class*="chip"], [class*="thumbnail"], [class*="preview"]';
    if (Array.from(activeComposer.querySelectorAll(explicit)).some(isVisible)) return true;

    // 3. Check for thumbnail images
    const imgs = Array.from(activeComposer.querySelectorAll('img')).filter(img => {
      if (!isVisible(img)) return false;
      const r = img.getBoundingClientRect();
      return r.width >= 16 && r.height >= 16 && r.width <= 240 && r.height <= 240;
    });
    if (imgs.length > 0) return true;

    // 4. Check for remove/dismiss button (✕ or svg cross) inside composer
    const buttons = Array.from(activeComposer.querySelectorAll('button, [role="button"], [role="img"], div, span')).filter(isVisible);
    for (const b of buttons) {
      const txt = (b.textContent || '').trim();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      const title = (b.getAttribute('title') || '').toLowerCase();
      if (txt === '✕' || txt === '×' || txt === 'x' || txt === 'X' ||
          aria.includes('xóa') || aria.includes('gỡ') || aria.includes('đóng') || aria.includes('remove') || aria.includes('delete') || aria.includes('close') || aria.includes('clear') || aria.includes('dismiss') || aria.includes('cancel') ||
          title.includes('xóa') || title.includes('gỡ') || title.includes('remove') || title.includes('close') || title.includes('clear') || title.includes('dismiss') || title.includes('delete')) {
        return true;
      }
    }

    // 5. Geometric check: Any element inside composer positioned above the prompt input
    if (input && input.isConnected) {
      const inputRect = input.getBoundingClientRect();
      const aboveInput = Array.from(activeComposer.querySelectorAll('div, span, button, svg, p')).filter(el => {
        if (!isVisible(el) || el === activeComposer || el.contains(input) || input.contains(el)) return false;
        if (el.closest('#flowauto-floating-widget') || el.closest('#flowauto-toast')) return false;
        const r = el.getBoundingClientRect();
        return r.height >= 16 && r.width >= 16 && r.bottom <= inputRect.top + 10;
      });
      if (aboveInput.length > 0) return true;
    }

    return false;
  }

  async function navigateToCharacterComposer(projectId) {
    if (window.location.href.includes('/character')) return true;
    if (!projectId) return false;
    const targetUrl = 'https://flow.google.com/project/' + projectId + '/character';
    const link = document.querySelector('a[href*="/character"]');
    if (link) {
      simulateClick(link);
      const arrived = await waitForCondition(() => window.location.href.includes('/character'), 3500);
      if (arrived) return true;
    }
    window.location.href = targetUrl;
    return false;
  }

  function isImageFileInput(el) {
    if (!(el instanceof HTMLInputElement) || el.type !== 'file') return false;
    const accept = (el.accept || '').toLowerCase();
    return !accept || accept.includes('image') || accept.includes('*/*');
  }

  function composerLocalFileInputs(composer, input) {
    const inputRect = input.getBoundingClientRect();
    return Array.from(document.querySelectorAll('input[type="file"]')).filter(el => {
      if (!isImageFileInput(el)) return false;
      if (composer.contains(el)) return true;
      const owner = el.closest('form, [role="dialog"], [role="menu"], [class*="popover"]');
      if (!owner || owner === document.body) return false;
      const rect = owner.getBoundingClientRect();
      return isVisible(owner) && Math.abs(rect.top - inputRect.top) <= 400;
    });
  }

  function findComposerImageButton(composer, input) {
    const inputRect = input.getBoundingClientRect();
    return Array.from(composer.querySelectorAll('button, [role="button"], label')).find(el => {
      if (!isVisible(el) || el.contains(input)) return false;
      const text = ((el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('title') || '') + ' ' + (el.textContent || '')).trim().toLowerCase();
      if (text.includes('tải lên') || text.includes('upload') || text.includes('thêm từ dự án') || text.includes('from project')) return false;
      const rect = el.getBoundingClientRect();
      const close = Math.abs(rect.top - inputRect.top) <= Math.max(100, inputRect.height + 60);
      const imageIntent = /image|ảnh|media|photo|add|thêm/.test(text) || !!el.querySelector('svg, img');
      return close && imageIntent;
    }) || null;
  }

  async function attachProductViaComposerFileInput(input, file, beforeSignature) {
    const composer = getCharacterComposer(input);
    const initialInputs = composerLocalFileInputs(composer, input);
    let fileInput = initialInputs[0] || null;
    if (!fileInput) {
      const button = findComposerImageButton(composer, input);
      if (!button) return null;
      log('📎 File-input strategy: click composer-local image control ' + describeAttachmentElement(button));
      simulateClick(button);
      fileInput = await waitForCondition(() => {
        const current = composerLocalFileInputs(composer, input);
        return current.find(el => !initialInputs.includes(el)) || current[0] || null;
      }, 3000);
    }
    if (!fileInput) return null;
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    const after = await waitForCondition(() => {
      const signature = attachmentSignature(composer, input);
      return signature && signature !== beforeSignature ? signature : null;
    }, 5000);
    if (!after) return null;
    const selectorEvidence = 'input[type="file"]' + (fileInput.accept ? '[accept="' + fileInput.accept.replace(/"/g, '\\"') + '"]' : '');
    log('✓ File-input strategy confirmed attachment via ' + selectorEvidence);
    return { after, strategy: 'composer-file-input', selectorEvidence };
  }

  function dispatchProductPaste(input, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.focus();
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: dt }));
    return dt;
  }

  function dispatchProductDrop(input, dt) {
    const rect = input.getBoundingClientRect();
    return dispatchDragDropToFlow({ element: input, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }, dt);
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

    function setButtonLabel(button, icon, text) {
      while (button.firstChild) button.removeChild(button.firstChild);
      const iconNode = document.createTextNode(icon + ' ');
      const span = document.createElement('span');
      span.style.fontWeight = '700';
      span.textContent = text;
      button.appendChild(iconNode);
      button.appendChild(span);
    }

    // Inner upload button
    const btn = document.createElement('button');
    btn.id = 'flowauto-float-upload-btn';
    setButtonLabel(btn, '📤', 'Upload Ảnh vào Flow');
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
        setButtonLabel(btn, '⏳', 'Đang nạp ảnh...');
        await uploadFilesToFlow(Array.from(fileInput.files));
        btn.disabled = false;
        setButtonLabel(btn, '📤', 'Upload Ảnh vào Flow');
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
        setButtonLabel(btn, '⏳', 'Đang nạp ảnh...');
        await uploadFilesToFlow(files);
        btn.disabled = false;
        setButtonLabel(btn, '📤', 'Upload Ảnh vào Flow');
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
          const currentUrl = window.location.href;
          const initialMatch = currentUrl.match(/\/project\/([a-zA-Z0-9_-]+)/);
          const oldProjectId = initialMatch ? initialMatch[1] : null;

          if (oldProjectId && params.allowExisting) {
            log('✓ Already inside project: ' + oldProjectId);
            sendResult(action, true, { log: '✓ Đang ở trong project: ' + oldProjectId, projectId: oldProjectId });
            return;
          }

          log('✨ Looking for "Dự án mới" / "New project" button...');
          const newProjectKeywords = ['dự án mới', 'new project', 'tạo dự án', 'create project'];
          let targetBtn = null;

          // 1. Search by text, aria-label, title
          for (const btn of document.querySelectorAll('button, [role="button"], a, div')) {
            const text = (btn.textContent || '').trim().toLowerCase();
            const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            const title = (btn.getAttribute('title') || '').toLowerCase();
            
            for (const kw of newProjectKeywords) {
              if ((text.includes(kw) || aria.includes(kw) || title.includes(kw)) && isVisible(btn)) {
                targetBtn = btn.closest('button, [role="button"], a') || btn;
                break;
              }
            }
            if (targetBtn) break;
          }

          // 2. If inside a project, look for header '+' button
          if (!targetBtn && oldProjectId) {
            const headerBtns = Array.from(document.querySelectorAll('header button, [role="banner"] button, nav button, button'));
            for (const b of headerBtns) {
              if (!isVisible(b)) continue;
              const aria = (b.getAttribute('aria-label') || '').toLowerCase();
              const text = (b.textContent || '').trim();
              if (text === '+' || aria.includes('tạo') || aria.includes('mới') || aria.includes('create') || aria.includes('new') || aria.includes('add')) {
                const r = b.getBoundingClientRect();
                if (r.top < 80) { // In top header
                  targetBtn = b;
                  break;
                }
              }
            }
          }

          // 3. Fallback: navigate to https://flow.google.com/ home if button not on page
          if (!targetBtn && oldProjectId) {
            log('🌐 Navigating back to home to click "Dự án mới"...');
            window.location.href = 'https://flow.google.com/';
            return; // Page will reload at home
          }

          if (!targetBtn) {
            sendResult(action, false, null, 'Không tìm thấy nút "+ Dự án mới"');
            return;
          }

          log('🖱️ Clicking "+ Dự án mới" button...');
          simulateClick(targetBtn);

          // Wait for URL to update with a NEW project ID (up to 20 seconds)
          const startWait = Date.now();
          const checkInterval = setInterval(() => {
            const cur = window.location.href;
            const m = cur.match(/\/project\/([a-zA-Z0-9_-]+)/);
            if (m && m[1] && m[1] !== oldProjectId) {
              clearInterval(checkInterval);
              log('🎉 Created new project successfully: ' + m[1]);
              sendResult(action, true, { log: '✓ Đã tạo dự án mới: ' + m[1], projectId: m[1] });
            } else if (Date.now() - startWait > 20000) {
              clearInterval(checkInterval);
              if (m && m[1]) {
                sendResult(action, true, { log: '✓ Đang ở trong project: ' + m[1], projectId: m[1] });
              } else {
                sendResult(action, false, null, 'Hết thời gian chờ tạo dự án (URL không đổi)');
              }
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

          const charName = (params.characterName || params.character || '').trim();
          const firstFileName = filesData[0]?.name || (filesData[0]?.url ? filesData[0].url.split('/').pop().split('?')[0] : '') || '';

          if (params.assetRole === 'product' && filesData.length !== 1) {
            sendResult(action, false, null, 'Luồng ảnh chung yêu cầu đúng một ảnh sản phẩm');
            return;
          }
          log('🖼️ uploadImage action: ' + filesData.length + ' image(s)' + (charName ? ' (Đổi tên: ' + charName + ')' : ''));
          capturePreexistingImages();
          const res = await uploadFilesToFlow(filesData);
          if (res.success) {
            let uploadedReference = null;
            const uploadWaitStarted = Date.now();
            while (!uploadedReference && Date.now() - uploadWaitStarted < 15000) {
              await new Promise(r => setTimeout(r, 750));
              for (const image of document.querySelectorAll('img')) {
                const src = image.currentSrc || image.src;
                const rect = image.getBoundingClientRect();
                if (src && !preexistingImages.has(src) && isVisible(image) && rect.width >= 80 && rect.height >= 80) {
                  uploadedReference = { card: climbToCard(image), img: image, src };
                  break;
                }
              }
            }
            if (params.assetRole === 'product' && !uploadedReference) {
              sendResult(action, false, null, 'Flow không hiển thị thẻ ảnh sản phẩm sau upload; không thể gắn reference an toàn');
              return;
            }
            // If characterName was provided, wait for card to appear and rename it!
            if (charName) {
              log('⏳ Chờ Flow hiển thị thẻ ảnh để đổi tên thành: "' + charName + '"...');
              showFlowToast('⏳ Đang chờ ảnh hiển thị để đổi tên...', 4000);
              
              let renamed = false;
              // Poll for card up to 15 seconds
              const startWait = Date.now();
              while (Date.now() - startWait < 15000) {
                await new Promise(r => setTimeout(r, 1200));
                renamed = await renameCharacterCard(firstFileName, charName);
                if (renamed) break;
              }

              if (!renamed) {
                // Fallback: try without hint
                log('⚠️ Thử đổi tên thẻ ảnh đầu tiên không cần hint...');
                renamed = await renameCharacterCard(null, charName);
              }

              if (renamed) {
                sendResult(action, true, { log: '✓ Đã upload ảnh và đổi tên thành: "' + charName + '"' });
              } else {
                sendResult(action, true, { log: '✓ Đã nạp ' + res.count + ' ảnh vào Flow (chưa kịp đổi tên thẻ)' });
              }
            } else {
              const referenceHint = firstFileName || params.productName || '';
              sendResult(action, true, { log: '✓ Đã nạp ảnh sản phẩm và xác nhận thẻ asset trên canvas', referenceHint });
            }
          } else {
            sendResult(action, false, null, res.error || 'Upload ảnh thất bại');
          }
        } catch (err) {
          sendResult(action, false, null, 'uploadImage exception: ' + err.message);
        }
        break;
      }

      case 'pasteProductReference': {
        try {
          if (!params.file?.base64) {
            sendResult(action, false, null, 'Thiếu bytes ảnh sản phẩm để dán vào composer');
            return;
          }
          if (!(await navigateToCharacterComposer(params.projectId))) return;
          const input = await waitForCondition(() => findCharacterPromptInput(), 10000);
          if (!input) {
            sendResult(action, false, null, 'Không tìm thấy character composer để dán ảnh sản phẩm');
            return;
          }
          const file = base64ToFile(params.file.base64, params.file.name || 'product-reference.png', params.file.type);
          if (!file) {
            sendResult(action, false, null, 'Không chuyển được ảnh sản phẩm thành File');
            return;
          }
          const composer = getCharacterComposer(input);
          const before = attachmentSignature(composer, input);
          if (hasConfirmedAttachment(composer)) {
            productAttachmentEvidence = { input, composer, before: '', after: before || 'existing', fileName: file.name, strategy: 'existing-confirmed', selectorEvidence: 'existing attachment UI' };
            sendResult(action, true, { log: '✓ Composer đã có attachment; bỏ qua để tránh gắn trùng' });
            return;
          }
          simulateClick(input);
          input.focus();
          const result = await attachProductViaComposerFileInput(input, file, before);
          let after = result?.after || '';
          let strategy = result?.strategy || '';
          const selectorEvidence = result?.selectorEvidence || '';
          if (!after) {
            log('⚠️ Composer file-input strategy unavailable/unconfirmed; trying synthetic paste fallback');
            const dt = dispatchProductPaste(input, file);
            await new Promise(r => setTimeout(r, 1200));
            after = attachmentSignature(composer, input);
            strategy = 'paste-fallback';
            if (!after || after === before) {
              log('⚠️ Synthetic paste unconfirmed; trying composer drop fallback');
              strategy = 'composer-drop-fallback';
              dispatchProductDrop(input, dt);
              await new Promise(r => setTimeout(r, 1200));
              after = attachmentSignature(composer, input);
            }
          }
          if (!after || after === before) {
            if (hasConfirmedAttachment(composer, input)) {
              after = 'confirmed-ui';
              strategy = strategy || 'composer-attachment-detected';
            }
          }
          productAttachmentEvidence = { input, composer, before, after, fileName: file.name, strategy, selectorEvidence };
          sendResult(action, true, { log: '✓ Đã thử gắn ảnh sản phẩm trực tiếp vào character composer (' + strategy + ')', selectorEvidence });
        } catch (err) {
          productAttachmentEvidence = null;
          sendResult(action, false, null, 'pasteProductReference exception: ' + err.message);
        }
        break;
      }

      case 'verifyProductAttachment': {
        let input = (await waitForCondition(() => findCharacterPromptInput(), 4000)) || productAttachmentEvidence?.input;
        let composer = input ? getCharacterComposer(input) : (productAttachmentEvidence?.composer || null);
        if (composer && !composer.isConnected && input?.isConnected) {
          composer = getCharacterComposer(input);
        }

        const evidence = productAttachmentEvidence;
        if (evidence && input && composer) {
          evidence.input = input;
          evidence.composer = composer;
        }

        const confirmed = composer ? hasConfirmedAttachment(composer, input) : false;
        const current = composer && input ? attachmentSignature(composer, input) : '';

        if (!confirmed && (!evidence || !current || current === evidence.before)) {
          sendResult(action, false, null, 'Flow không xác nhận thumbnail/media sản phẩm trong character composer. Synthetic paste có thể bị chặn vì sự kiện không trusted; không gửi prompt.');
          return;
        }
        if (evidence) evidence.after = current || 'confirmed';
        sendResult(action, true, { log: '✓ Đã xác nhận thumbnail/media sản phẩm trong composer', referenceAttached: true, strategy: evidence?.strategy || 'confirmed-ui' });
        break;
      }

      case 'injectUnifiedPrompt': {
        try {
          const evidence = productAttachmentEvidence;
          if (!evidence) {
            sendResult(action, false, null, 'Không còn attachment sản phẩm; từ chối nhập/gửi prompt');
            return;
          }
          // Flow re-renders the character composer after attaching a file, so
          // the input captured during the attachment step may already be stale.
          let input = await waitForCondition(() => findCharacterPromptInput(), 10000);
          if (!input || !input.isConnected) {
            sendResult(action, false, null, 'Không tìm thấy ô prompt hiện hành sau khi gắn ảnh sản phẩm');
            return;
          }

          // If input is an overlay or container, resolve the inner or active editable element
          if (!input.isContentEditable && !input.matches('textarea, input[type="text"], input:not([type]), [role="textbox"]')) {
            const inner = input.querySelector('textarea, [contenteditable="true"], [contenteditable=""], [contenteditable], [role="textbox"], input');
            if (inner && isVisible(inner)) {
              input = inner;
            } else {
              input = await focusAndClickInput(input) || input;
            }
          }

          const composer = getCharacterComposer(input);
          if (!hasConfirmedAttachment(composer)) {
            sendResult(action, false, null, 'Không còn attachment sản phẩm trong composer hiện hành; từ chối nhập/gửi prompt');
            return;
          }
          evidence.input = input;
          evidence.composer = composer;
          const promptText = (params.prompt || params.characterPrompt || params.character_prompt || '').trim();
          if (!promptText) {
            sendResult(action, false, null, 'Prompt ảnh chung không được để trống');
            return;
          }
          const instruction = ' Create exactly ONE image with ALL described characters and the exact ATTACHED product fully visible together in the SAME single camera frame. Preserve the attached product identity, packaging, label, colors, and proportions exactly. No collage, split screen, separate asset, product-only result, or extra image.';
          const textToInject = promptText + instruction;
          const readInputText = () => (input.value || input.innerText || input.textContent || '').trim();
          if (readInputText().includes(promptText.slice(0, 40))) {
            sendResult(action, true, { log: '✓ Unified prompt đã có trong composer; bỏ qua để tránh nhập trùng', injectionStrategy: 'existing-text' });
            return;
          }

          // Click into input to prepare for prompt insertion
          log('🖱️ Clicking into character prompt input...');
          input = await focusAndClickInput(input) || input;

          let injectionStrategy = 'multistage-type';
          const typed = await typeWithDebuggerOrFallback(input, textToInject);
          let text = readInputText();
          if (!typed || !text.includes(promptText.slice(0, 20))) {
            injectionStrategy = 'react-input';
            injectTextToReactInput(input, textToInject);
            text = readInputText();
          }
          const isReady = () => {
            const currentText = readInputText();
            const btn = findCharacterSubmitArrowButton(input);
            const ready = btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true';
            return currentText.includes(promptText.slice(0, 20)) || ready;
          };

          if (!isReady()) {
            await waitForCondition(() => isReady(), 3500);
            text = readInputText();
          }

          if (!isReady()) {
            sendResult(action, false, null, 'Không nhập được prompt ảnh chung vào composer hiện hành');
            return;
          }
          if (!hasConfirmedAttachment(composer)) {
            sendResult(action, false, null, 'Attachment sản phẩm biến mất sau khi nhập prompt; không gửi');
            return;
          }
          sendResult(action, true, { log: '✓ Đã nhập unified prompt vào composer hiện hành và giữ nguyên attachment', injectionStrategy });
        } catch (err) {
          sendResult(action, false, null, 'injectUnifiedPrompt exception: ' + err.message);
        }
        break;
      }

      case 'submitUnifiedCharacter': {
        try {
          const evidence = productAttachmentEvidence;
          const signature = evidence ? attachmentSignature(evidence.composer, evidence.input) : '';
          if (!evidence || !signature || signature === evidence.before) {
            sendResult(action, false, null, 'Attachment sản phẩm chưa được xác nhận; không submit');
            return;
          }
          capturePreexistingImages();
          let currentInput = (evidence?.input && evidence.input.isConnected) ? evidence.input : (findCharacterPromptInput() || findPromptInput());
          const button = findCharacterSubmitArrowButton(currentInput);
          if (!button || !isSubmitButtonEnabled(button)) {
            sendResult(action, false, null, 'Không tìm thấy nút submit character đang khả dụng');
            return;
          }
          await clickSubmitArrowButton(button, currentInput);
          let fresh = [];
          const started = Date.now();
          while (Date.now() - started < 45000) {
            await new Promise(r => setTimeout(r, 1500));
            fresh = Array.from(document.querySelectorAll('img')).filter(image => {
              const src = image.currentSrc || image.src;
              const rect = image.getBoundingClientRect();
              return src && !preexistingImages.has(src) && isVisible(image) && rect.width >= 80 && rect.height >= 80;
            });
            if (fresh.length) break;
          }
          if (fresh.length !== 1) {
            sendResult(action, false, null, fresh.length ? 'Flow tạo nhiều hơn một ảnh mới; yêu cầu đúng một ảnh' : 'Không phát hiện ảnh mới sau submit');
            return;
          }
          const imageUrl = fresh[0].currentSrc || fresh[0].src;
          productAttachmentEvidence = null;
          sendResult(action, true, { log: '✓ Đã tạo đúng một ảnh gồm nhân vật và sản phẩm', imageUrl, imageSrc: imageUrl, projectId: getProjectId(), referenceAttached: true });
        } catch (err) {
          sendResult(action, false, null, 'submitUnifiedCharacter exception: ' + err.message);
        }
        break;
      }

      // Legacy actions retained only for old non-product/manual callers. Product
      // create-project jobs never route through this canvas/menu path.
      // media card to Flow's canvas composer and prove the composer changed.
      case 'attachProductReference': {
        try {
          if (window.location.href.includes('/character')) {
            sendResult(action, false, null, 'Trang /character không bảo đảm nhận ảnh reference; cần chạy trên canvas project');
            return;
          }
          const hint = (params.referenceHint || params.productName || '').trim();
          const found = findMediaCardOnCanvas(hint);
          if (!found?.card) {
            sendResult(action, false, null, 'Không tìm thấy đúng thẻ ảnh sản phẩm vừa upload để gắn vào câu lệnh');
            return;
          }
          const promptBefore = findPromptInput();
          const beforeSignature = promptBefore ? (promptBefore.innerHTML || promptBefore.value || promptBefore.textContent || '') : '';
          simulateHover(found.card);
          await new Promise(r => setTimeout(r, 500));
          const more = findMoreButton(found.card);
          if (!more) {
            sendResult(action, false, null, 'Không tìm thấy menu của thẻ ảnh sản phẩm; chưa gắn reference');
            return;
          }
          simulateClick(more);
          await new Promise(r => setTimeout(r, 600));
          const add = await waitForCondition(() => findButtonByText('Thêm vào câu lệnh') || findButtonByText('Add to prompt'), 5000);
          if (!add) {
            sendResult(action, false, null, 'Flow không cung cấp "Thêm vào câu lệnh" cho ảnh sản phẩm; dừng để tránh tạo ảnh không có sản phẩm');
            return;
          }
          simulateClick(add);
          await new Promise(r => setTimeout(r, 1000));
          const promptAfter = findPromptInput();
          const afterSignature = promptAfter ? (promptAfter.innerHTML || promptAfter.value || promptAfter.textContent || '') : '';
          const hasReferenceUi = !!promptAfter && (
            afterSignature !== beforeSignature ||
            !!promptAfter.closest('form, [class*="prompt"], [class*="composer"]')?.querySelector('img, [class*="chip"], [class*="pill"], [data-type*="media"]')
          );
          if (!hasReferenceUi) {
            sendResult(action, false, null, 'Đã bấm thêm nhưng composer không hiển thị reference sản phẩm; không gửi prompt');
            return;
          }
          sendResult(action, true, { log: '✓ Ảnh sản phẩm đã được chọn làm reference trong composer', referenceAttached: true });
        } catch (err) {
          sendResult(action, false, null, 'attachProductReference exception: ' + err.message);
        }
        break;
      }

      case 'generateUnifiedImage': {
        try {
          const promptText = (params.prompt || '').trim();
          if (!promptText) {
            sendResult(action, false, null, 'Prompt ảnh chung không được để trống');
            return;
          }
          if (window.location.href.includes('/character')) {
            sendResult(action, false, null, 'Không tạo ảnh chung trên /character vì trang này không bảo đảm product reference');
            return;
          }
          const input = await waitForCondition(() => findPromptInput(), 8000);
          if (!input) {
            sendResult(action, false, null, 'Không tìm thấy composer canvas chứa product reference');
            return;
          }
          await switchCreationMode('image');
          const requiredInstruction = ' Create exactly ONE image: every described character and the exact attached product reference must be fully visible together in the SAME single camera frame. No collage, split screen, separate product image, or product-only result.';
          const entered = await typeWithDebuggerOrFallback(input, promptText + requiredInstruction);
          if (!entered) {
            sendResult(action, false, null, 'Không nhập được prompt ảnh chung vào composer');
            return;
          }
          capturePreexistingImages();
          window.postMessage({ type: 'FLOW_DEBUGGER_ENTER' }, '*');
          const enter = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
          input.dispatchEvent(new KeyboardEvent('keydown', enter));
          input.dispatchEvent(new KeyboardEvent('keypress', enter));
          input.dispatchEvent(new KeyboardEvent('keyup', enter));

          let generated = null;
          const started = Date.now();
          while (!generated && Date.now() - started < 45000) {
            await new Promise(r => setTimeout(r, 1500));
            const fresh = [];
            for (const image of document.querySelectorAll('img')) {
              const src = image.currentSrc || image.src;
              const rect = image.getBoundingClientRect();
              if (src && !preexistingImages.has(src) && isVisible(image) && rect.width >= 80 && rect.height >= 80) fresh.push({ image, src });
            }
            if (fresh.length === 1) generated = fresh[0];
            else if (fresh.length > 1) {
              sendResult(action, false, null, 'Flow trả nhiều ảnh mới; không thể chứng minh một composition duy nhất');
              return;
            }
          }
          if (!generated) {
            sendResult(action, false, null, 'Không phát hiện đúng một ảnh chung mới từ canvas');
            return;
          }
          sendResult(action, true, { log: '✓ Đã tạo đúng một ảnh mới từ composer có product reference', imageUrl: generated.src, imageSrc: generated.src, projectId: getProjectId(), referenceAttached: true });
        } catch (err) {
          sendResult(action, false, null, 'generateUnifiedImage exception: ' + err.message);
        }
        break;
      }

      // ── Step 0.5: Direct rename character card or page title ──
      case 'renameCharacter':
      case 'editCharacterName': {
        const targetName = params.name || params.newName || params.characterName || params.character;
        let ok = false;
        if (window.location.href.includes('/character')) {
          ok = await editCharacterPageName(targetName);
        }
        if (!ok) {
          ok = await renameCharacterCard(params.target || params.oldName || null, targetName);
        }
        sendResult(action, ok, { log: ok ? '✓ Đã đổi tên thành: ' + targetName : 'Đổi tên thất bại' });
        break;
      }

      // ── Step 0.6: Generate Character Image from Prompt on /character ──
      case 'generateCharacterImage': {
        try {
          const promptText = (params.prompt || params.characterPrompt || '').trim();
          const charName = (params.characterName || params.character || '').trim();
          const projectId = params.projectId || getProjectId();

          if (!promptText) {
            sendResult(action, false, null, 'Prompt tạo ảnh không được để trống');
            return;
          }

          // 1. Ensure we are on https://flow.google.com/project/{projectId}/character
          if (projectId) {
            const isAlreadyOnCharPage = window.location.href.includes('/character');
            if (!isAlreadyOnCharPage) {
              const targetUrl = 'https://flow.google.com/project/' + projectId + '/character';
              log('🌐 Chuyển sang URL tạo nhân vật: ' + targetUrl);
              showFlowToast('🌐 Đang chuyển sang trang tạo nhân vật...', 3000);

              // Try clicking in-page link to /character first (SPA navigation)
              const charLink = document.querySelector('a[href*="/character"]') ||
                               Array.from(document.querySelectorAll('nav a, aside a, [role="navigation"] a, a')).find(a => a.href && a.href.includes('/character'));
              
              let navigated = false;
              if (charLink) {
                simulateClick(charLink);
                for (let i = 0; i < 8; i++) {
                  await new Promise(r => setTimeout(r, 400));
                  if (window.location.href.includes('/character')) {
                    navigated = true;
                    break;
                  }
                }
              }

              if (!navigated) {
                // Navigate via browser URL
                window.location.href = targetUrl;
                // Page unloads; content.js resumes automatically on load via GET_ACTIVE_JOB
                return;
              }
            }
          }

          log('🎨 Bắt đầu tạo ảnh nhân vật: "' + (charName || 'unnamed') + '"...');
          showFlowToast('🎨 Đang chuẩn bị tạo ảnh nhân vật: ' + (charName || '') + '...', 4000);

          // Pacing: Chờ 1 giây để giao diện trang /character ổn định
          await new Promise(r => setTimeout(r, 1000));

          // 2. Wait for character prompt input to appear on /character
          let input = await waitForCondition(() => findCharacterPromptInput(), 10000);
          if (!input) {
            sendResult(action, false, null, 'Không tìm thấy ô nhập prompt "Mô tả nhân vật của bạn..." trên trang /character');
            return;
          }

          scrollIntoViewIfNeeded(input);
          await new Promise(r => setTimeout(r, 400));

          // 3. Focus & Click input một cách an toàn
          log('🖱️ Focus vào ô nhập prompt...');
          simulateClick(input);
          input.focus();
          await new Promise(r => setTimeout(r, 400));

          // If input is an overlay container/label, check if clicking it revealed or contains an inner editable
          const innerEditable = input.querySelector('textarea, [contenteditable], [role="textbox"], input');
          if (innerEditable && isVisible(innerEditable)) {
            input = innerEditable;
            simulateClick(input);
            input.focus();
          }

          // 4. Inject prompt vào input bằng Debugger OS-level + DOM fallback
          log('✍️ Điền prompt mô tả nhân vật: "' + promptText.substring(0, 45) + '..."');
          showFlowToast('✍️ Đang nhập prompt mô tả nhân vật...', 3000);
          await typeWithDebuggerOrFallback(input, promptText);

          // Pacing: Chờ 1.5 giây để React cập nhật state và mở khóa nút mũi tên (enable)
          log('⏳ Chờ giao diện xác nhận prompt và kích hoạt nút mũi tên (1.5s)...');
          await new Promise(r => setTimeout(r, 1500));

          // 5. Chụp danh sách ảnh hiện có TRƯỚC KHI bấm gửi
          capturePreexistingImages();

          // 6. Tìm và bấm nút MŨI TÊN (Submit)
          log('🔍 Đang tìm nút mũi tên gửi (submit)...');
          let arrowBtn = null;
          const findArrowStart = Date.now();
          while (Date.now() - findArrowStart < 5000) {
            arrowBtn = findCharacterSubmitArrowButton(input);
            if (arrowBtn && isSubmitButtonEnabled(arrowBtn)) {
              log('✓ Đã tìm thấy nút mũi tên ở trạng thái sẵn sàng (enabled)!');
              break;
            }
            await new Promise(r => setTimeout(r, 300));
          }

          if (arrowBtn) {
            log('🚀 Đang ấn nút mũi tên gửi tạo ảnh...');
            showFlowToast('🚀 Đang ấn mũi tên gửi tạo ảnh...', 3000);
            await clickSubmitArrowButton(arrowBtn, input);
            await new Promise(r => setTimeout(r, 1200));

            // Pacing: Chờ 1.5 giây rồi kiểm tra lại xem có cần bấm lại lần 2 không
            const recheckBtn = findCharacterSubmitArrowButton(input);
            if (recheckBtn && isSubmitButtonEnabled(recheckBtn)) {
              const curVal = (input.value || input.textContent || '').trim();
              if (curVal.length > 5) {
                log('🔄 Bấm bổ sung nút mũi tên lần 2 để đảm bảo gửi thành công...');
                await clickSubmitArrowButton(recheckBtn, input);
                await new Promise(r => setTimeout(r, 800));
              }
            }
          } else {
            log('⚠️ Không tìm thấy nút mũi tên riêng biệt, dùng phím Enter...');
            window.postMessage({ type: 'FLOW_DEBUGGER_ENTER' }, '*');
            const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
            input.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
            input.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
            input.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
          }

          // 7. Wait for new image card to appear (up to 45s)
          log('⏳ Chờ Google Flow tạo ảnh nhân vật (khoảng 5-25s)...');
          showFlowToast('⏳ Đang chờ ảnh nhân vật xuất hiện...', 8000);

          let newCardObj = null;
          const startWait = Date.now();
          const MAX_IMAGE_WAIT = 45000;

          while (Date.now() - startWait < MAX_IMAGE_WAIT) {
            await new Promise(r => setTimeout(r, 1500));

            for (const im of document.querySelectorAll('img')) {
              if (im.closest('#flowauto-floating-widget') || im.closest('#flowauto-toast')) continue;
              const src = im.src || im.currentSrc;
              const r = im.getBoundingClientRect();
              if (src && isVisible(im) && r.width >= 80 && r.height >= 80) {
                if (!preexistingImages.has(src)) {
                  const card = climbToCard(im);
                  newCardObj = { card: card !== document.body ? card : null, img: im, src };
                  log('🎉 Phát hiện ảnh nhân vật mới tạo: ' + src.substring(0, 45) + '...');
                  break;
                }
              }
            }
            if (newCardObj) break;
          }

          // Fallback if preexisting check didn't catch: pick top-left card
          if (!newCardObj) {
            const fallback = findMediaCardOnCanvas(null);
            if (fallback) newCardObj = { card: fallback.card, img: fallback.img, src: fallback.img?.src || '' };
          }

          if (!newCardObj) {
            sendResult(action, false, null, 'Hết thời gian chờ tạo ảnh nhân vật (không thấy thẻ ảnh mới xuất hiện)');
            return;
          }

          // Trích xuất URL ảnh nhân vật rõ nét nhất (ưu tiên ảnh preview lớn ở trung tâm màn hình)
          const mainImgObj = findMainCharacterImageUrl();
          const finalImageUrl = (mainImgObj && mainImgObj.url) ? mainImgObj.url : (newCardObj?.src || '');
          log('🖼️ Đã lấy URL ảnh nhân vật: ' + (finalImageUrl ? finalImageUrl.substring(0, 80) + '...' : '(không tìm thấy)'));

          // 7. Sửa tên nhân vật nếu có charName (click vào ô đặt tên -> xóa chữ cũ -> viết tên mới)
          if (charName) {
            try {
              log('🏷️ Đổi tên nhân vật thành: "' + charName + '"...');
              showFlowToast('🏷️ Đang sửa tên nhân vật: ' + charName + '...', 3000);
              await new Promise(r => setTimeout(r, 1000));

              let renamed = false;
              if (window.location.href.includes('/character')) {
                renamed = await editCharacterPageName(charName);
              }
              if (!renamed && newCardObj?.card) {
                await renameCharacterCard(newCardObj.card, charName);
              }
            } catch (renameErr) {
              log('⚠️ Rename character notice: ' + renameErr.message);
            }
          }

          showFlowToast('✅ Đã tạo ảnh nhân vật "' + (charName || 'mới') + '" thành công!', 4000);

          // 8. Chuyển về trang Canvas: https://flow.google.com/project/{projectId}
          if (projectId) {
            const canvasUrl = 'https://flow.google.com/project/' + projectId;
            log('🌐 Chuẩn bị chuyển về trang Canvas: ' + canvasUrl);
            showFlowToast('🌐 Đang chuyển về trang Canvas dự án...', 3000);

            let navigatedToCanvas = false;

            // 8a. Thử bấm nút "Xong" ở góc trên bên phải trang chi tiết nhân vật (lưu và thoát về Canvas)
            const clickedDone = await clickCharacterDoneButton();
            if (clickedDone) {
              for (let i = 0; i < 10; i++) {
                await new Promise(r => setTimeout(r, 400));
                if (!window.location.href.includes('/character')) {
                  navigatedToCanvas = true;
                  log('✅ Đã chuyển về Canvas sau khi bấm nút "Xong"!');
                  break;
                }
              }
            }

            // 8b. Nếu chưa chuyển, tìm link/nút "Khung vẽ" / "Canvas" trên thanh điều hướng
            if (!navigatedToCanvas) {
              const canvasLink = Array.from(document.querySelectorAll('a, button, [role="button"], [role="tab"], [role="link"], li, div[tabindex]')).find(el => {
                const href = el.getAttribute('href') || el.href || '';
                const text = (el.textContent || '').trim().toLowerCase();
                const aria = (el.getAttribute('aria-label') || '').toLowerCase();

                if (href) {
                  const cleanHref = href.split('?')[0].replace(/\/$/, '');
                  if (cleanHref.endsWith('/project/' + projectId) || cleanHref === canvasUrl) {
                    return true;
                  }
                }
                if ((text === 'khung vẽ' || text === 'canvas' || aria === 'khung vẽ' || aria === 'canvas') && !href.includes('/character')) {
                  return true;
                }
                return false;
              });

              if (canvasLink) {
                log('🖱️ Tìm thấy link/nút Canvas trên thanh điều hướng, click để chuyển trang...');
                simulateClick(canvasLink);
                for (let i = 0; i < 10; i++) {
                  await new Promise(r => setTimeout(r, 400));
                  if (!window.location.href.includes('/character')) {
                    navigatedToCanvas = true;
                    log('✅ Đã chuyển về Canvas qua SPA thành công!');
                    break;
                  }
                }
              }
            }

            // Gửi kết quả hoàn thành cho content.js & Bridge
            sendResult(action, true, {
              log: '✓ Đã tạo thành công ảnh nhân vật' + (charName ? ': "' + charName + '"' : ''),
              character: charName,
              imageSrc: finalImageUrl,
              imageUrl: finalImageUrl,
              characterImageUrl: finalImageUrl,
              projectId: projectId
            });

            // 8c. Nếu vẫn chưa đổi URL, điều hướng trực tiếp bằng window.location.href
            if (!navigatedToCanvas && window.location.href.includes('/character')) {
              log('🌐 Điều hướng window.location.href về: ' + canvasUrl);
              await new Promise(r => setTimeout(r, 600));
              window.location.href = canvasUrl;
            }
          } else {
            sendResult(action, true, {
              log: '✓ Đã tạo thành công ảnh nhân vật' + (charName ? ': "' + charName + '"' : ''),
              character: charName,
              imageSrc: finalImageUrl,
              imageUrl: finalImageUrl,
              characterImageUrl: finalImageUrl
            });
          }

        } catch (err) {
          sendResult(action, false, null, 'generateCharacterImage exception: ' + err.message);
        }
        break;
      }

      // ── Step 1: Find character card ──
      case 'findCharacter': {
        // Bước 1: Click vào menu "Nhân vật" / "Characters" ở thanh bên trái
        await clickCharactersSidebarMenu();

        // Xóa bộ lọc tìm kiếm cũ nếu còn sót
        const preSearchBar = findSearchBar();
        if (preSearchBar && preSearchBar.value && preSearchBar.value.trim().length > 0) {
          log('🧹 Clearing leftover search filter...');
          clearSearchInput(preSearchBar);
          await new Promise(res => setTimeout(res, 1200));
        }

        const charName = (params.name || '').trim();
        log('🔍 Bắt đầu tìm thẻ nhân vật (tên yêu cầu: "' + (charName || 'Nhân vật chưa có tên') + '")...');

        let r = null;

        // 1. Thử tìm theo tên chỉ định nếu có (và không phải tên mặc định)
        if (charName && !isDefaultCharacterName(charName)) {
          r = findCharacterCard(charName);
          // Nếu chưa thấy ngay, cuộn nhẹ xuống 350px để Flow nạp thêm thẻ rồi tìm lại
          if (!r) {
            window.scrollBy({ top: 350, behavior: 'smooth' });
            await new Promise(res => setTimeout(res, 800));
            r = findCharacterCard(charName);
          }
        }

        // 2. Tìm đến thẻ "Nhân vật chưa có tên" / "Unnamed character" (tự động khớp cả 2 ngôn ngữ qua getEquivalentNames)
        if (!r) {
          log('🔍 Tìm thẻ mang tên "Nhân vật chưa có tên" / "Unnamed character"...');
          r = findCharacterCard('Nhân vật chưa có tên');
        }

        // 3. Nếu chưa thấy trên màn hình, thử gõ search bar để tìm kiếm
        if (!r) {
          const searchInput = findSearchBar();
          if (searchInput) {
            const queryName = (charName && !isDefaultCharacterName(charName)) ? charName : 'Nhân vật chưa có tên';
            log('🔍 Thử lọc bằng Search Bar: "' + queryName + '"...');
            clearSearchInput(searchInput);
            await new Promise(res => setTimeout(res, 500));

            injectTextToReactInput(searchInput, queryName);
            const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
            searchInput.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
            searchInput.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
            searchInput.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

            await new Promise(res => setTimeout(res, 2000));
            r = (charName ? findCharacterCard(charName) : null) || findCharacterCard('Nhân vật chưa có tên');

            // Nếu trên giao diện tiếng Anh không thấy, thử tìm với "Unnamed character"
            if (!r && isDefaultCharacterName(queryName)) {
              clearSearchInput(searchInput);
              await new Promise(res => setTimeout(res, 400));
              injectTextToReactInput(searchInput, 'Unnamed character');
              searchInput.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
              searchInput.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
              searchInput.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
              await new Promise(res => setTimeout(res, 2000));
              r = findCharacterCard('Unnamed character');
            }

            // Xóa search bar sau khi tìm để phục hồi lưới thẻ
            clearSearchInput(searchInput);
            await new Promise(res => setTimeout(res, 1200));
          }
        }

        // 4. Fallback đặc biệt: Đã ở trong mục "Nhân vật", lấy thẻ nhân vật đầu tiên trong lưới
        if (!r) {
          log('🔍 Fallback: Lấy thẻ nhân vật đầu tiên trong mục "Nhân vật"...');
          r = findMediaCardOnCanvas(null);
        }

        if (r) {
          lastFoundCharacterCard = r;
          scrollIntoViewIfNeeded(r.card);
          await new Promise(res => setTimeout(res, 600));
          log('✓ Đã tìm thấy thẻ nhân vật via ' + r.method);
          sendResult(action, true, { log: '✓ Tìm thấy: ' + (charName || 'Nhân vật chưa có tên') + ' (' + r.method + ')' });
        } else {
          lastFoundCharacterCard = null;
          sendResult(action, false, null, 'Không tìm thấy thẻ "' + (charName || 'Nhân vật chưa có tên') + '" trong mục Nhân vật');
        }
        break;
      }

      // ── Step 2: Hover character card ──
      case 'hoverCharacter': {
        const r = (lastFoundCharacterCard && isVisible(lastFoundCharacterCard.card))
          ? lastFoundCharacterCard
          : (findCharacterCard(params.name) || findCharacterCard('Nhân vật chưa có tên') || findMediaCardOnCanvas(null));

        if (r) {
          lastFoundCharacterCard = r;
          scrollIntoViewIfNeeded(r.card);
          await new Promise(res => setTimeout(res, 400));
          simulateHover(r.card);
          log('✓ Hover triggered: ' + (params.name || 'Nhân vật chưa có tên'));
          // Pacing: Chờ 1.2s để Flow kịp hiển thị nút ⋮ và trái tim ở góc thẻ
          await new Promise(res => setTimeout(res, 1200));
          sendResult(action, true, { log: '✓ Hover triggered: ' + (params.name || 'Nhân vật chưa có tên') });
        } else {
          sendResult(action, false, null, 'Cannot hover: ' + (params.name || 'Nhân vật chưa có tên'));
        }
        break;
      }

      // ── Step 3: Click ⋮ menu button ──
      case 'clickMoreMenu': {
        const cardResult = (lastFoundCharacterCard && isVisible(lastFoundCharacterCard.card))
          ? lastFoundCharacterCard
          : (findCharacterCard(params.name) || findCharacterCard('Nhân vật chưa có tên') || findMediaCardOnCanvas(null));

        if (cardResult) {
          lastFoundCharacterCard = cardResult;
          scrollIntoViewIfNeeded(cardResult.card);
          await new Promise(res => setTimeout(res, 300));
          simulateHover(cardResult.card);
          await new Promise(res => setTimeout(res, 500));
        }

        // Thử tìm nút ⋮ lặp lại đến 5 lần nếu chưa hiển thị ngay (mỗi lần cách 400ms)
        let btn = null;
        for (let attempt = 0; attempt < 5; attempt++) {
          btn = (cardResult ? findMoreButton(cardResult.card) : null) ||
                findMoreButton(params.name) ||
                findMoreButton('Nhân vật chưa có tên');
          if (btn && isVisible(btn)) break;
          if (cardResult) simulateHover(cardResult.card);
          await new Promise(res => setTimeout(res, 400));
        }

        if (btn) {
          scrollIntoViewIfNeeded(btn);
          simulateHover(btn);
          await new Promise(res => setTimeout(res, 200));
          simulateClick(btn);
          try { btn.click(); } catch(e) {}
          log('✓ Clicked ⋮ button');
          // Pacing: Chờ 800ms để menu ngữ cảnh xổ xuống
          await new Promise(res => setTimeout(res, 800));
          sendResult(action, true, { log: '✓ Clicked ⋮ on: ' + (params.name || 'Nhân vật chưa có tên') });
        } else {
          sendResult(action, false, null, '⋮ button not found on card: ' + (params.name || 'Nhân vật chưa có tên'));
        }
        break;
      }

      // ── Step 4: Wait for dropdown menu ──
      case 'waitMenu': {
        const btn = await waitForCondition(() =>
          findButtonByText('Thêm vào câu lệnh') ||
          findButtonByText('Add to prompt') ||
          findButtonByText('Add to prompt bar'),
          6000
        );
        if (btn) {
          await new Promise(res => setTimeout(res, 300));
          sendResult(action, true, { log: '✓ Menu detected: "' + btn.textContent.trim().substring(0, 30) + '"' });
        } else {
          sendResult(action, false, null, 'Menu "Add to prompt" did not appear');
        }
        break;
      }

      // ── Step 5: Click "Thêm vào câu lệnh" / "Add to prompt" ──
      case 'clickAddButton': {
        const btn = findButtonByText('Thêm vào câu lệnh') ||
                    findButtonByText('Add to prompt') ||
                    findButtonByText('Add to prompt bar');
        if (btn) {
          scrollIntoViewIfNeeded(btn);
          simulateHover(btn);
          await new Promise(res => setTimeout(res, 200));
          simulateClick(btn);
          try { btn.click(); } catch(e) {}
          const label = btn.textContent.trim().substring(0, 30);
          log('✓ Clicked "' + label + '"');
          // Pacing: Chờ 1.5s để Flow đóng menu và gắn chip nhân vật vào prompt bar
          log('⏳ Chờ Flow gắn chip nhân vật vào prompt bar (1.5s)...');
          await new Promise(res => setTimeout(res, 1500));
          sendResult(action, true, { log: '✓ Clicked "' + label + '"' });
        } else {
          sendResult(action, false, null, '"Thêm vào câu lệnh" / "Add to prompt" not found');
        }
        break;
      }

      // ── Step 6: Wait for prompt input "What do you want to create?" ──
      case 'waitTextarea': {
        const input = await waitForCondition(() => findPromptInput(), 6000);
        if (input) {
          scrollIntoViewIfNeeded(input);
          await new Promise(res => setTimeout(res, 400));
          log('✓ Prompt input ready');
          sendResult(action, true, { log: '✓ Prompt input ready' });
        } else {
          log('❌ Prompt input not found');
          sendResult(action, false, null, 'Prompt input not found');
        }
        break;
      }

      // ── Step 7: Inject prompt text (Using Chrome Debugger API + DOM Fallback) ──
      case 'injectPrompt': {
        let input = findPromptInput();
        if (!input) {
          sendResult(action, false, null, 'Prompt input not found');
          break;
        }

        // Pacing: Chờ 500ms để đảm bảo các chip nhân vật đã ổn định trong input
        await new Promise(r => setTimeout(r, 500));

        // Đảm bảo chế độ tạo đang ở Video
        await switchCreationMode('video');
        await new Promise(r => setTimeout(r, 400));

        // Re-acquire input in case mode switch re-rendered the prompt bar
        input = findPromptInput() || input;

        // Click and focus into the prompt input
        log('🖱️ Focus & Click vào ô nhập prompt video...');
        input = await focusAndClickInput(input) || input;
        await new Promise(r => setTimeout(r, 400));

        const promptText = (params.prompt || '').trim();
        if (!promptText) {
          sendResult(action, false, null, 'Prompt video không được để trống');
          break;
        }

        // Check if prompt is already present to prevent duplicate typing
        const readInputText = () => (input.value || input.innerText || input.textContent || '').trim();
        if (readInputText().includes(promptText.slice(0, 30))) {
          log('✓ Prompt đã có sẵn trong input; bỏ qua để tránh nhập trùng');
          sendResult(action, true, { log: '✓ Prompt already present in input' });
          break;
        }

        // Add a leading space to separate cleanly from character chip
        const textToInject = ' ' + promptText;

        log('✍️ Điền prompt video: "' + promptText.substring(0, 50) + '..."');
        showFlowToast('✍️ Đang nhập prompt video...', 3000);

        // Try typeWithDebuggerOrFallback
        const typed = await typeWithDebuggerOrFallback(input, textToInject);
        await new Promise(r => setTimeout(r, 400));

        let currentText = readInputText();
        if (!typed || !currentText.includes(promptText.slice(0, 15))) {
          log('💉 Fallback: Dùng injectTextToReactInput...');
          injectTextToReactInput(input, textToInject);
          await new Promise(r => setTimeout(r, 400));
        }

        // Pacing & activation: Đảm bảo nút submit được kích hoạt (enabled)
        log('⚡ Đang xác nhận kích hoạt nút submit...');
        await ensureSubmitButtonActivated(input);
        await new Promise(r => setTimeout(r, 500));

        sendResult(action, true, { log: '✓ Typed prompt and activated submit: "' + promptText.substring(0, 40) + '..."' });
        break;
      }

      // ── Step 8: Verify input ──
      case 'verifyInput': {
        const input = findPromptInput();
        if (!input) {
          sendResult(action, false, null, 'Prompt input not found');
          break;
        }
        const promptText = (params.prompt || '').trim();
        let currentText = (input.value || input.innerText || input.textContent || '').trim();
        let submitBtn = findSubmitArrowButton(input);
        let isReady = isSubmitButtonEnabled(submitBtn);

        // If submit button is not ready yet, try to activate it!
        if (!isReady && currentText.length > 5) {
          log('⚡ verifyInput: Đang kích hoạt nút submit...');
          await ensureSubmitButtonActivated(input);
          submitBtn = findSubmitArrowButton(input);
          isReady = isSubmitButtonEnabled(submitBtn);
        }

        // Kiểm tra xem prompt text đã thực sự có trong ô input chưa
        if (promptText && currentText.includes(promptText.slice(0, 15))) {
          log('✓ Input verified with prompt text (' + currentText.length + ' chars), submit enabled=' + isReady);
          sendResult(action, true, { log: '✓ Input verified with prompt text', submitReady: isReady });
        } else if (isReady) {
          log('✓ Input verified (submit button is enabled)');
          sendResult(action, true, { log: '✓ Input verified (submit button ready)', submitReady: true });
        } else if (currentText.length > 0) {
          // Thử inject bổ sung 1 lần nếu prompt text chưa có
          log('⚠️ Prompt chưa xuất hiện đầy đủ trong input, thử inject bổ sung...');
          injectTextToReactInput(input, ' ' + promptText);
          await ensureSubmitButtonActivated(input);
          sendResult(action, true, { log: '✓ Re-injected prompt and activated submit' });
        } else {
          sendResult(action, false, null, 'Prompt input is completely empty');
        }
        break;
      }

      // ── Step 9: Press Enter / Click submit button ──
      case 'pressEnter': {
        const input = findPromptInput();
        if (!input) {
          sendResult(action, false, null, 'Prompt input not found for Enter / Submit');
          break;
        }

        // 🛑 Capture existing videos BEFORE we submit the new prompt!
        capturePreexistingVideos();

        // 1. Chờ nút submit chuyển sang trạng thái kích hoạt (enabled) - kiểm tra đến 5s
        log('🔍 Tìm kiếm nút submit (mũi tên gửi) và chờ trạng thái sẵn sàng...');
        let submitBtn = null;
        const findStart = Date.now();
        while (Date.now() - findStart < 5000) {
          submitBtn = findSubmitArrowButton(input);
          if (submitBtn && isSubmitButtonEnabled(submitBtn)) {
            log('✓ Đã tìm thấy nút submit ở trạng thái sẵn sàng (enabled)!');
            break;
          }
          await ensureSubmitButtonActivated(input);
          await new Promise(r => setTimeout(r, 300));
        }

        // 2. Click nút submit mũi tên và trigger submit
        log('🚀 Bắt đầu thực thi gửi prompt video (Click nút mũi tên + phím Enter/Ctrl+Enter)...');
        showFlowToast('🚀 Đang gửi tạo video...', 3000);

        if (submitBtn && isSubmitButtonEnabled(submitBtn)) {
          await clickSubmitArrowButton(submitBtn, input);
        } else {
          // Fallback: direct keyboard submit via Debugger and DOM
          window.postMessage({ type: 'FLOW_DEBUGGER_ENTER', ctrlKey: true }, '*');
          await new Promise(r => setTimeout(r, 200));
          window.postMessage({ type: 'FLOW_DEBUGGER_ENTER' }, '*');
        }

        // Pacing & Verification: Kiểm tra xem lệnh đã được Flow nhận chưa
        // Nếu sau 1.5s nút submit vẫn còn hiển thị enabled và composer vẫn còn text, thử bấm và gửi bổ sung
        for (let attempt = 1; attempt <= 3; attempt++) {
          await new Promise(r => setTimeout(r, 1500));
          const recheckBtn = findSubmitArrowButton(input);
          const currentVal = (input.value || input.textContent || '').trim();

          // Flow đã nhận lệnh nếu: nút submit biến mất / chuyển sang loading / disabled, hoặc composer đã đóng
          if (!recheckBtn || !isSubmitButtonEnabled(recheckBtn) || !input.isConnected) {
            log('✓ Flow đã nhận lệnh submit video thành công (nút đã chuyển trạng thái hoặc đã đóng composer)!');
            break;
          }

          if (currentVal.length > 5) {
            log(`🔄 Lần ${attempt}: Flow chưa xử lý lệnh, tiếp tục bấm nút submit và gửi phím Ctrl+Enter...`);
            await clickSubmitArrowButton(recheckBtn, input);
          }
        }

        sendResult(action, true, { log: '✓ Video prompt submitted successfully' });
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

  window.postMessage({ type: 'FLOW_INJECT_READY' }, '*');

  // Injects floating upload widget on Flow interface
  setTimeout(injectFloatingUploadWidget, 1500);

  log('🚀 inject.js v4.5 loaded (with Flow Image Upload & Widget)');
})();
