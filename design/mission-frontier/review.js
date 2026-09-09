(() => {
  const $ = (id) => document.getElementById(id);
  const storageKey = 'mission-frontier-design-v1-feedback';
  let screens = [];
  let selected = 0;
  let selectedStateId = '';
  let notes = {};
  let grid = false;
  let storageAvailable = true;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '{}');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
      for (const [key, value] of Object.entries(saved)) {
        if (value && ['unreviewed', 'keep', 'refine'].includes(value.state) && typeof value.note === 'string') notes[key] = value;
      }
    }
  } catch { storageAvailable = false; }
  const layout = document.querySelector('.review-layout');
  const entry = (key) => notes[key] || { state: 'unreviewed', note: '' };
  const stateViews = (screen) => screen.states?.length ? screen.states : [{ id: '', label: '', feedbackKey: screen.key }];
  const selectedView = () => stateViews(screens[selected]).find((state) => state.id === selectedStateId) || stateViews(screens[selected])[0];
  const feedbackKey = (screen, state) => state.feedbackKey || screen.key;
  const readLocation = () => location.hash.slice(1).split('/');

  function renderNavigation() {
    const query = $('search').value.trim().toLowerCase();
    const list = $('screen-list');
    list.replaceChildren();
    let lastGroup = '';
    screens.forEach((screen, index) => {
      if (query && !`${screen.title} ${screen.group}`.toLowerCase().includes(query)) return;
      if (lastGroup !== screen.group) {
        const group = document.createElement('div');
        group.className = 'nav-group'; group.textContent = screen.group;
        list.append(group); lastGroup = screen.group;
      }
      const button = document.createElement('button');
      button.className = 'screen-item'; button.type = 'button';
      if (index === selected && !grid) button.setAttribute('aria-current', 'page');
      const number = document.createElement('span'); number.className = 'screen-number'; number.textContent = String(screen.order).padStart(2, '0');
      const name = document.createElement('span'); name.className = 'screen-name'; name.textContent = screen.title;
      const decisions = stateViews(screen).map((state) => entry(feedbackKey(screen, state)).state);
      const decision = decisions.includes('refine') ? 'refine' : decisions.every((value) => value === 'keep') ? 'keep' : 'unreviewed';
      const dot = document.createElement('i'); dot.className = `review-dot ${decision}`; dot.setAttribute('aria-hidden', 'true');
      button.append(number, name, dot); button.addEventListener('click', () => showScreen(index)); list.append(button);
    });
  }

  function showScreen(index, updateHash = true, stateId = '') {
    selected = Math.max(0, Math.min(index, screens.length - 1)); grid = false;
    layout.classList.remove('overview');
    const screen = screens[selected];
    const states = stateViews(screen);
    selectedStateId = states.some((state) => state.id === stateId) ? stateId : (screen.defaultState || states[0].id);
    const state = selectedView();
    const review = entry(feedbackKey(screen, state));
    $('screen-view').hidden = false; $('grid-view').hidden = true;
    $('grid-toggle').textContent = 'All screens';
    $('screen-group').textContent = screen.group;
    $('screen-title').textContent = screen.title;
    $('screen-position').textContent = `${selected + 1} / ${screens.length}`;
    $('previous').disabled = selected === 0; $('next').disabled = selected === screens.length - 1;
    const imagePath = state.image || screen.image;
    $('design-image').src = imagePath; $('design-image').alt = `${screen.title}${state.label ? ` · ${state.label}` : ''} — Mission Frontier visual design study`;
    $('image-error').hidden = true; $('full-image').href = imagePath;
    $('notes-title').textContent = `${screen.title}${state.label ? ` · ${state.label}` : ''}`;
    $('screen-summary').textContent = state.summary || screen.summary;
    $('backend-status').textContent = screen.backendStatus || 'Design proposal';
    $('backend-note').textContent = screen.backendNote || 'Review the interaction specification and backend coverage before planning.';
    $('screen-contract').textContent = state.contract || screen.contract || screen.review;
    $('qa-note').textContent = state.qa || screen.qa || 'Illustrative image content. The written contract defines behaviour; incidental microcopy and decorative objects do not add requirements.';
    $('review-state').value = review.state;
    $('review-note').value = review.note;
    const stateList = $('design-state-list'); stateList.replaceChildren();
    $('design-states').hidden = states.length < 2;
    states.forEach((variant) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = variant.label;
      button.setAttribute('aria-pressed', String(variant.id === selectedStateId));
      button.addEventListener('click', () => showScreen(selected, true, variant.id)); stateList.append(button);
    });
    $('save-status').textContent = storageAvailable ? 'Notes stay in this browser. Export feedback to keep or share them.' : 'Browser storage is unavailable. Export your feedback before leaving.';
    if (updateHash) history.replaceState(null, '', `#${screen.key}${selectedStateId ? `/${selectedStateId}` : ''}`);
    renderNavigation();
    $('notes-toggle').setAttribute('aria-expanded', String(getComputedStyle($('notes-panel')).display !== 'none'));
  }

  function showGrid() {
    layout.classList.add('overview');
    grid = true; $('screen-view').hidden = true; $('grid-view').hidden = false;
    $('grid-toggle').textContent = 'Selected screen';
    const container = $('screen-grid'); container.replaceChildren();
    screens.forEach((screen, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'grid-card';
      const img = document.createElement('img'); img.src = screen.image; img.alt = screen.title; img.loading = 'lazy';
      const text = document.createElement('div');
      const label = document.createElement('span'); label.textContent = `${String(screen.order).padStart(2, '0')} / ${screen.group}`;
      const title = document.createElement('strong'); title.textContent = screen.title;
      text.append(label, title); button.append(img, text); button.addEventListener('click', () => showScreen(index)); container.append(button);
    });
    renderNavigation();
  }

  function saveNote() {
    const screen = screens[selected];
    notes[feedbackKey(screen, selectedView())] = { state: $('review-state').value, note: $('review-note').value, updatedAt: new Date().toISOString() };
    try { localStorage.setItem(storageKey, JSON.stringify(notes)); $('save-status').textContent = 'Saved on this device. Export feedback to share it.'; }
    catch { storageAvailable = false; $('save-status').textContent = 'Kept for this session only. Export feedback before leaving.'; }
    renderNavigation();
  }

  $('search').addEventListener('input', renderNavigation);
  $('previous').addEventListener('click', () => showScreen(selected - 1));
  $('next').addEventListener('click', () => showScreen(selected + 1));
  $('grid-toggle').addEventListener('click', () => grid ? showScreen(selected, true, selectedStateId) : showGrid());
  $('review-state').addEventListener('change', saveNote); $('review-note').addEventListener('input', saveNote);
  $('notes-toggle').addEventListener('click', () => {
    if (matchMedia('(max-width:1250px)').matches) layout.classList.toggle('show-notes');
    else layout.classList.toggle('notes-hidden');
    $('notes-toggle').setAttribute('aria-expanded', String(getComputedStyle($('notes-panel')).display !== 'none'));
  });
  $('design-image').addEventListener('error', () => { $('image-error').hidden = false; });
  $('export').addEventListener('click', () => {
    const output = ['# Mission Frontier — design feedback', '', `Exported ${new Date().toISOString()}`, ''];
    screens.forEach((screen) => {
      stateViews(screen).forEach((state) => {
        const value = entry(feedbackKey(screen, state));
        if (value.state === 'unreviewed' && !value.note.trim()) return;
        output.push(`## ${String(screen.order).padStart(2, '0')} — ${screen.title}${state.label ? ` / ${state.label}` : ''}`, '', `Decision: ${value.state}`, '', value.note.trim() || '(No written notes)', '');
      });
    });
    if (output.length === 4) output.push('No screens reviewed yet.');
    const url = URL.createObjectURL(new Blob([output.join('\n')], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'mission-frontier-feedback.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  document.addEventListener('keydown', (event) => {
    if (event.target.closest('input,textarea,select,button') || event.metaKey || event.ctrlKey || event.altKey || grid) return;
    if (event.key === 'ArrowRight') { event.preventDefault(); showScreen(selected + 1); }
    if (event.key === 'ArrowLeft') { event.preventDefault(); showScreen(selected - 1); }
  });
  window.addEventListener('hashchange', () => {
    const [key, stateId] = readLocation();
    const index = screens.findIndex((screen) => screen.key === key);
    if (index >= 0) showScreen(index, false, stateId);
  });
  Promise.resolve(window.missionFrontierCatalog).then((data) => {
    if (!Array.isArray(data) || !data.length) throw new Error('Could not load the design catalogue.');
    screens = data.sort((a, b) => a.order - b.order);
    const [key, stateId] = readLocation();
    const index = screens.findIndex((screen) => screen.key === key); showScreen(index < 0 ? 0 : index, false, stateId);
  }).catch((error) => { $('fatal-error').hidden = false; $('fatal-error').textContent = error.message; });
})();
