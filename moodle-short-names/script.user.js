// ==UserScript==
// @name         Moodle short course names
// @version      1.0
// @license      MIT

// @description  Allows reordering and renaming Moodle courses in the sidebar
// @author       darius-it
// @namespace    https://darius-it.me

// @match        https://elearning.ur.de/*
// @match        https://elearning.uni-regensburg.de/*

// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(() => {
  const SCOPE = '.drawercontent, .block_course_quick_access, .primary-navigation';
  const USE_TITLE_FALLBACK = true; // use the link's title="" when no custom name is set

  let names = GM_getValue('names', {}); // { "77346": "Short name" }
  let order = GM_getValue('order', {}); // { "5semester": ["77434", "77489", ...] }
  let dragLi = null;

  const idFromHref = href => {
    try {
      const u = new URL(href, location.href);
      return u.pathname.endsWith('/course/view.php') ? u.searchParams.get('id') : null;
    } catch { return null; }
  };
  const courseIdOf = li => idFromHref(li.querySelector('a[href*="course/view.php"]')?.href);
  const saveNames = () => GM_setValue('names', names);

  // ---------- inline edit button ----------
  function addEditButton(a) {
    if (a.nextElementSibling?.classList.contains('sn-edit')) return;
    const b = document.createElement('span');
    b.className = 'sn-edit';
    b.textContent = ' ✎';
    b.title = 'Set short name';
    b.style.cssText = 'cursor:pointer;opacity:.5;margin-left:4px';
    b.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const id = idFromHref(a.href);
      const v = prompt(
        `Short name for course ${id} (empty = remove):`,
        names[id] || a.getAttribute('title') || a.dataset.snOrig || ''
      );
      if (v === null) return;
      if (v.trim()) names[id] = v.trim(); else delete names[id];
      saveNames();
      apply();
    });
    a.after(b);
  }

  // ---------- drag handles ----------
  function addDragHandle(li) {
    if (li.firstElementChild?.classList.contains('sn-drag')) return;
    const h = document.createElement('span');
    h.className = 'sn-drag';
    h.textContent = '⠿';
    h.title = 'Drag to re-order';
    h.draggable = true;
    h.style.cssText = 'cursor:grab;opacity:.5;margin-right:6px;user-select:none';
    li.prepend(h);
  }

  document.addEventListener('dragstart', e => {
    const h = e.target.closest?.('.sn-drag');
    if (!h) return;
    dragLi = h.closest('li.qa-course');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', 'sn-drag'); // Firefox needs data to start a drag
    e.dataTransfer.setDragImage(dragLi, 10, 10);
    dragLi.style.opacity = '.4';
  });

  document.addEventListener('dragover', e => {
    if (!dragLi) return;
    e.preventDefault();
    const t = e.target.closest?.('li.qa-course');
    if (!t || t === dragLi || t.parentElement !== dragLi.parentElement) return;
    const r = t.getBoundingClientRect();
    if (e.clientY > r.top + r.height / 2) t.after(dragLi); else t.before(dragLi);
  });

  document.addEventListener('drop', e => { if (dragLi) e.preventDefault(); });

  document.addEventListener('dragend', () => {
    if (!dragLi) return;
    dragLi.style.opacity = '';
    const cat = dragLi.closest('li.qa-usercategory');
    if (cat?.id) {
      order[cat.id] = [...dragLi.parentElement.children]
        .filter(li => li.matches('li.qa-course'))
        .map(courseIdOf)
        .filter(Boolean);
      GM_setValue('order', order);
    }
    dragLi = null;
  });

  function applyOrder() {
    if (dragLi) return;
    document.querySelectorAll('li.qa-usercategory').forEach(cat => {
      const saved = order[cat.id];
      const ul = cat.querySelector(':scope > ul');
      if (!saved || !ul) return;
      const items = [...ul.children].filter(li => li.matches('li.qa-course'));
      const rank = li => { const i = saved.indexOf(courseIdOf(li)); return i < 0 ? 1e9 : i; };
      const sorted = [...items].sort((a, b) => rank(a) - rank(b));
      if (sorted.some((li, i) => li !== items[i])) sorted.forEach(li => ul.appendChild(li));
    });
  }

  // ---------- search ----------
  let saved = null; // snapshot of hidden/display state while filtering

  function filter(q) {
    const root = document.querySelector('#qa-blocklist');
    if (!root) return;
    q = q.trim().toLowerCase();

    if (!q) {
      if (saved) {
        saved.forEach((s, el) => { el.hidden = s.hidden; el.style.display = s.display; });
        saved = null;
      }
      return;
    }

    if (!saved) saved = new Map();
    const snap = el => { if (!saved.has(el)) saved.set(el, { hidden: el.hidden, display: el.style.display }); };
    const show = el => { snap(el); el.hidden = false; el.style.display = ''; };
    const hide = el => { snap(el); el.hidden = true; el.style.display = 'none'; };

    root.querySelectorAll('li.qa-course').forEach(li => {
      const a = li.querySelector('a');
      const hay = [a.textContent, a.dataset.snOrig, a.getAttribute('title')].join(' ').toLowerCase();
      if (hay.includes(q)) {
        show(li);
        for (let p = li.parentElement; p && p !== root; p = p.parentElement) show(p);
      } else hide(li);
    });
    root.querySelectorAll('li.qa-usercategory').forEach(cat => {
      if (!cat.querySelector('li.qa-course:not([hidden])')) hide(cat);
    });
  }

  function setupSearch() {
    const form = document.getElementById('qa-searchform');
    if (!form || form.dataset.snBound) return;
    form.dataset.snBound = '1';
    // Capture phase on the form: our handler runs, the block's own handlers never see the events
    ['input', 'keyup', 'keydown', 'keypress', 'change', 'search'].forEach(type =>
      form.addEventListener(type, e => {
        e.stopPropagation();
        if (type === 'input' && e.target.id === 'qa-search') filter(e.target.value);
      }, true)
    );
    form.addEventListener('submit', e => e.preventDefault(), true); // no jump to server search on Enter
    const input = form.querySelector('#qa-search');
    if (input?.value) filter(input.value);
  }

  // ---------- main ----------
  function apply() {
    document.querySelectorAll(SCOPE).forEach(scope => {
      scope.querySelectorAll('a[href*="course/view.php"]').forEach(a => {
        const id = idFromHref(a.href);
        if (!id) return;

        // The course name is the longest text node (the icon is an <i>, no text)
        let best = null;
        const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
        for (let n; (n = w.nextNode()); ) {
          if (n.nodeValue.trim() && (!best || n.nodeValue.length > best.nodeValue.length)) best = n;
        }
        if (!best) return;

        // Remember the original full name once, so it can be restored
        if (a.dataset.snOrig === undefined) a.dataset.snOrig = best.nodeValue;

        let short = names[id];
        if (!short && USE_TITLE_FALLBACK) short = (a.getAttribute('title') || '').trim();
        const target = short || a.dataset.snOrig;
        if (best.nodeValue.trim() !== target.trim()) best.nodeValue = target;

        addEditButton(a);
        const li = a.closest('li.qa-course');
        if (li) addDragHandle(li);
      });
    });
    applyOrder();
    setupSearch();
  }

  GM_registerMenuCommand('Set short name for this course', () => {
    const id = idFromHref(location.href) || (document.body.className.match(/\bcourse-(\d+)\b/) || [])[1];
    if (!id || id === '1') return alert('Open a course page first.');
    const v = prompt(`Short name for course ${id} (empty = remove):`, names[id] || '');
    if (v === null) return;
    if (v.trim()) names[id] = v.trim(); else delete names[id];
    saveNames();
    apply();
  });

  GM_registerMenuCommand('Edit all short names (JSON)', () => {
    const v = prompt('JSON { "courseId": "short name" }:', JSON.stringify(names));
    if (v === null) return;
    try { names = JSON.parse(v); saveNames(); apply(); }
    catch { alert('Invalid JSON'); }
  });

  GM_registerMenuCommand('Reset course order', () => {
    order = {};
    GM_setValue('order', order);
    location.reload();
  });

  apply();
  let t;
  new MutationObserver(() => { clearTimeout(t); t = setTimeout(apply, 50); })
    .observe(document.body, { childList: true, subtree: true });
})();
