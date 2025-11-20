// script.js

// ========= Global config & state =========

let chordConfig = null;
let inversionDefs = [];
let inversionById = {};

const state = {
  reference: null,    // {root, sectionId, chordId, inversion}
  sequence: [],       // array of same
  guesses: [],        // [{root, chordJson, inversion}]
  session: {
    correct: 0,
    attempts: 0,
    exercises: 0,
    missed: {}
  },
  pendingMisses: {}
};

// ========= DOM references =========

const bpmInp        = document.getElementById('bpm');
const nInp          = document.getElementById('nChords');
const rootListInp   = document.getElementById('rootList');
const toneSel       = document.getElementById('tone');

const startBtn      = document.getElementById('start');
const playRefBtn    = document.getElementById('playRef');      // may be null if you removed these
const playRefArpBtn = document.getElementById('playRefArp');   // may be null if you removed these
const playAllBtn    = document.getElementById('playAll');
const autoPlay      = document.getElementById('autoPlay');
const resetSession  = document.getElementById('resetSession');

const sessionScore  = document.getElementById('sessionScore');
const missStats     = document.getElementById('missStats');

const exerciseCard  = document.getElementById('exercise');
const referenceSlot = document.getElementById('referenceSlot');
const slotsDiv      = document.getElementById('slots');
const evalBtn       = document.getElementById('eval');
const nextBtn       = document.getElementById('next');
const statusEl      = document.getElementById('status');
const chordSectionsContainer = document.getElementById('chordSections');

// ========= Audio helpers =========

let audioCtx = null;
window.currentTone = toneSel.value;

toneSel.addEventListener('change', () => {
  window.currentTone = toneSel.value;
});

function ctx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function midiToHz(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

function playChord(midiNotes, dur = 1.0, { time = 0, gain = 0.27 } = {}) {
  const c = ctx();
  const start = time || c.currentTime + 0.06;

  const g = c.createGain();
  g.gain.value = 0;
  g.connect(c.destination);

  const tone = window.currentTone || 'triangle';
  const isPiano = tone === 'piano';

  const atk = isPiano ? 0.008 : 0.02;
  const rel = isPiano ? 0.12 : 0.2;
  const peak = isPiano ? Math.min(0.35, gain + 0.05) : gain;

  g.gain.linearRampToValueAtTime(peak, start + atk);
  g.gain.setTargetAtTime(0, start + dur - 0.05, rel);

  const oscs = [];

  midiNotes.forEach(m => {
    if (isPiano) {
      const o1 = c.createOscillator();
      o1.type = 'triangle';
      o1.frequency.value = midiToHz(m);
      const o2 = c.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = midiToHz(m) * 2;

      const mix = c.createGain();
      mix.gain.value = 1.0;
      o1.connect(mix);
      o2.connect(mix);
      mix.connect(g);

      o1.start(start);
      o1.stop(start + dur + 0.02);
      o2.start(start);
      o2.stop(start + dur + 0.02);

      oscs.push(o1, o2);
    } else {
      const o = c.createOscillator();
      o.type = tone;
      o.frequency.value = midiToHz(m);
      o.connect(g);
      o.start(start);
      o.stop(start + dur + 0.05);
      oscs.push(o);
    }
  });

  return {
    stop: () => {
      try { g.disconnect(); } catch {}
      oscs.forEach(o => { try { o.stop(); } catch {} });
    }
  };
}

function playArpeggio(midiNotes, totalDur = 1.0, { time = 0, gain = 0.27, direction = 'up' } = {}) {
  const c = ctx();
  const start = time || c.currentTime + 0.06;
  const notes = [...midiNotes].sort((a, b) => a - b);
  const ordered = (direction === 'down') ? notes.slice().reverse() : notes;
  const step = Math.max(0.06, totalDur / Math.max(ordered.length, 1));

  ordered.forEach((m, i) => {
    playChord([m], step * 0.95, { time: start + i * step, gain });
  });
}

// ========= Chord voicing =========

function baseMidiForSemitone(semi) {
  const anchor = 60;
  return anchor + ((semi - (anchor % 12) + 12) % 12);
}

function voiceChord(rootSemi, intervals, inversion) {
  const baseRoot = baseMidiForSemitone(rootSemi);
  let notes = intervals.slice().sort((a, b) => a - b).map(iv => baseRoot + iv);

  const target = 60;
  while (notes[0] > target + 6) {
    notes = notes.map(n => n - 12);
  }
  while (notes[0] < target - 6) {
    notes = notes.map(n => n + 12);
  }

  const inv = Math.max(0, Math.floor(inversion || 0));
  for (let i = 0; i < inv; i++) {
    notes[0] += 12;
    notes.sort((a, b) => a - b);
  }
  return notes;
}

// ========= Config loading =========

async function loadChordConfig() {
  try {
    const res = await fetch('chords-config.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    chordConfig = await res.json();

    buildInversionDefs();
    buildChordSectionsUI();
    bootstrapRootList();
    updateSessionDisplay();
  } catch (err) {
    console.error('Failed to load chords-config.json', err);
    alert('Could not load chords-config.json. Is it in the same folder as index.html?');
  }
}

function buildInversionDefs() {
  const map = {};
  chordConfig.sections.forEach(sec => {
    (sec.inversions || []).forEach(inv => {
      if (!(inv.id in map)) {
        map[inv.id] = {
          id: inv.id,
          label: inv.label || inv.short || ('Inversion ' + inv.id),
          short: inv.short || String(inv.id)
        };
      }
    });
  });
  inversionById = map;
  inversionDefs = Object.values(map).sort((a, b) => a.id - b.id);
}

function buildChordSectionsUI() {
  chordSectionsContainer.innerHTML = '';

  chordConfig.sections.forEach(section => {
    const secDiv = document.createElement('div');
    secDiv.className = 'card';
    secDiv.style.marginTop = '8px';

    const header = document.createElement('div');
    header.className = 'row';

    const headerInner = document.createElement('div');

    const titleRow = document.createElement('div');
    titleRow.className = 'row';
    titleRow.style.alignItems = 'center';

    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.textContent = section.label;
    titleRow.appendChild(pill);

    const masterLabel = document.createElement('label');
    masterLabel.className = 'row';
    masterLabel.style.gap = '6px';
    masterLabel.style.marginLeft = '8px';
    masterLabel.style.fontWeight = '600';
    masterLabel.style.color = 'var(--sub)';

    const masterCb = document.createElement('input');
    masterCb.type = 'checkbox';
    masterCb.dataset.sectionMaster = section.id;

    const enabled = section.enabled !== false;
    masterCb.checked = enabled;

    masterLabel.appendChild(masterCb);
    masterLabel.appendChild(document.createTextNode('Enable section'));
    titleRow.appendChild(masterLabel);

    const desc = document.createElement('div');
    desc.className = 'muted';
    desc.textContent = section.description || '';

    headerInner.appendChild(titleRow);
    headerInner.appendChild(desc);
    header.appendChild(headerInner);
    secDiv.appendChild(header);

    // Details container (chords + inversions) shown only when enabled
    const details = document.createElement('div');
    details.className = 'section-details';
    secDiv.appendChild(details);

    // Chord checkboxes
    const chordList = document.createElement('div');
    chordList.className = 'stack';
    section.chords.forEach(ch => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = ch.defaultEnabled !== false;
      cb.dataset.section = section.id;
      cb.dataset.chordId = ch.id;
      label.appendChild(cb);

      const symbol = ch.symbol || '';
      const text = symbol ? `${ch.label} (${symbol})` : ch.label;
      label.appendChild(document.createTextNode(' ' + text));
      chordList.appendChild(label);
    });
    details.appendChild(chordList);

    // Inversion checkboxes
    const invTitle = document.createElement('div');
    invTitle.className = 'pill';
    invTitle.style.marginTop = '8px';
    invTitle.textContent = 'Inversions';
    details.appendChild(invTitle);

    const invList = document.createElement('div');
    invList.className = 'stack';
    (section.inversions || []).forEach(inv => {
      const label = document.createElement('label');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = inv.defaultEnabled !== false;
      cb.dataset.section = section.id;
      cb.dataset.invId = inv.id;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(' ' + (inv.label || inv.short || inv.id)));
      invList.appendChild(label);
    });
    details.appendChild(invList);

    // Apply initial visibility based on enabled flag
    details.style.display = enabled ? '' : 'none';

    // Master toggle: enable/disable section, show/hide details, and toggle children
    masterCb.addEventListener('change', () => {
      const on = masterCb.checked;
      section.enabled = on;
      details.style.display = on ? '' : 'none';

      const chordCbs = details.querySelectorAll(
        `input[type="checkbox"][data-section="${section.id}"][data-chord-id]`
      );
      const invCbs = details.querySelectorAll(
        `input[type="checkbox"][data-section="${section.id}"][data-inv-id]`
      );
      chordCbs.forEach(cb => { cb.checked = on; });
      invCbs.forEach(cb => { cb.checked = on; });
      refreshTypeSelects();
    });

    chordSectionsContainer.appendChild(secDiv);
  });

  chordSectionsContainer.addEventListener('change', () => {
    refreshTypeSelects();
  });
}

function bootstrapRootList() {
  if (!chordConfig) return;
  if (!rootListInp.value.trim()) {
    rootListInp.value = (chordConfig.roots || []).join(', ');
  }
}

// ========= Helpers for enabled roots / chord templates =========

function parseRootList() {
  if (!chordConfig) return [];
  const txt = rootListInp.value.trim();
  if (!txt) return chordConfig.roots.slice();

  const raw = txt.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
  const valid = [];
  raw.forEach(n => {
    const cleaned = n
      .replace(/[^A-Ga-g#b]/g, '')
      .replace(/^([a-g])/, m => m.toUpperCase());
    if (chordConfig.noteToSemitone[cleaned] != null) {
      if (!valid.includes(cleaned)) valid.push(cleaned);
    }
  });
  return valid.length ? valid : chordConfig.roots.slice();
}

function getEnabledTemplates() {
  if (!chordConfig) return [];
  const enabled = [];

  chordConfig.sections.forEach(section => {
    // Skip if section master is off
    const master = chordSectionsContainer.querySelector(
      `input[type="checkbox"][data-section-master="${section.id}"]`
    );
    if (master && !master.checked) {
      return;
    }

    const chordCheckboxes = chordSectionsContainer.querySelectorAll(
      `input[type="checkbox"][data-section="${section.id}"][data-chord-id]`
    );
    const invCheckboxes = chordSectionsContainer.querySelectorAll(
      `input[type="checkbox"][data-section="${section.id}"][data-inv-id]`
    );

    const enabledInversions = Array.from(invCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => Number(cb.dataset.invId));

    chordCheckboxes.forEach(cb => {
      if (!cb.checked) return;
      const chordId = cb.dataset.chordId;
      const chord = section.chords.find(c => c.id === chordId);
      if (!chord) return;

      enabled.push({
        sectionId: section.id,
        chordId: chord.id,
        label: chord.label,
        symbol: chord.symbol || '',
        intervals: chord.intervals.slice(),
        inversions: enabledInversions.slice()
      });
    });
  });

  return enabled;
}

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ========= Exercise generation =========

function generateExercise(nChords) {
  if (!chordConfig) {
    alert('Config not loaded yet.');
    return null;
  }

  const roots = parseRootList();
  const templates = getEnabledTemplates();

  if (!roots.length) {
    alert('No valid roots selected.');
    return null;
  }
  if (!templates.length) {
    alert('Enable at least one chord type in the sections above.');
    return null;
  }

  const refRoot = randomItem(roots);
  const refTmpl = randomItem(templates);
  const refInv = refTmpl.inversions.length ? randomItem(refTmpl.inversions) : 0;
  state.reference = {
    root: refRoot,
    sectionId: refTmpl.sectionId,
    chordId: refTmpl.chordId,
    inversion: refInv
  };

  const seq = [];
  for (let i = 0; i < nChords; i++) {
    const root = randomItem(roots);
    const tmpl = randomItem(templates);
    const inv = tmpl.inversions.length ? randomItem(tmpl.inversions) : 0;

    seq.push({
      root,
      sectionId: tmpl.sectionId,
      chordId: tmpl.chordId,
      inversion: inv
    });
  }

  return seq;
}

// ========= Lookup & label helpers =========

function findSection(sectionId) {
  return chordConfig.sections.find(s => s.id === sectionId) || null;
}

function findChord(sectionId, chordId) {
  const sec = findSection(sectionId);
  if (!sec) return null;
  return sec.chords.find(c => c.id === chordId) || null;
}

function formatChordLabel(spec) {
  const chord = findChord(spec.sectionId, spec.chordId);
  const symbol = chord ? (chord.symbol || '') : '';
  const root = spec.root || '?';
  const invDef = inversionById[spec.inversion] || { label: 'Inversion ' + spec.inversion };
  const core = symbol ? `${root}${symbol}` : `${root} (${chord ? chord.label : 'Chord'})`;
  return `${core} [${invDef.label}]`;
}

function playChordFromSpec(spec, durSeconds = 1.0) {
  if (!chordConfig) return;
  const chord = findChord(spec.sectionId, spec.chordId);
  if (!chord) return;

  const semi = chordConfig.noteToSemitone[spec.root];
  if (semi == null) return;

  const notes = voiceChord(semi, chord.intervals, spec.inversion || 0);
  playChord(notes, durSeconds, { gain: 0.3 });
}

function playChordArpFromSpec(spec, bpm) {
  if (!chordConfig) return;
  const chord = findChord(spec.sectionId, spec.chordId);
  if (!chord) return;

  const semi = chordConfig.noteToSemitone[spec.root];
  if (semi == null) return;

  const notes = voiceChord(semi, chord.intervals, spec.inversion || 0);
  const beat = 60 / Math.max(30, Math.min(240, bpm || 90));
  const totalDur = 2 * beat;
  playArpeggio(notes, totalDur, { gain: 0.3, direction: 'up' });
}

// ========= UI helpers =========

function buildTypeSelectOptions() {
  const frag = document.createDocumentFragment();

  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '(chord)';
  frag.appendChild(blank);

  const templates = getEnabledTemplates();
  if (!templates.length) return frag;

  const bySection = {};
  templates.forEach(t => {
    (bySection[t.sectionId] ||= []).push(t);
  });

  chordConfig.sections.forEach(section => {
    const list = bySection[section.id];
    if (!list || !list.length) return;

    const og = document.createElement('optgroup');
    og.label = section.label;

    section.chords.forEach(ch => {
      const tmpl = list.find(t => t.chordId === ch.id);
      if (!tmpl) return;

      const op = document.createElement('option');
      op.value = JSON.stringify({ sectionId: tmpl.sectionId, chordId: tmpl.chordId });
      const symbol = tmpl.symbol || '';
      op.textContent = symbol ? `${tmpl.label} (${symbol})` : tmpl.label;
      og.appendChild(op);
    });

    frag.appendChild(og);
  });

  return frag;
}

function buildInversionSelectOptionsForSection(sectionId) {
  const frag = document.createDocumentFragment();

  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '(inversion)';
  frag.appendChild(blank);

  if (!chordConfig) return frag;

  const section = chordConfig.sections.find(s => s.id === sectionId);
  if (!section) return frag;

  (section.inversions || []).forEach(inv => {
    const cb = chordSectionsContainer.querySelector(
      `input[type="checkbox"][data-section="${sectionId}"][data-inv-id="${inv.id}"]`
    );
    if (!cb || !cb.checked) return;

    const op = document.createElement('option');
    op.value = String(inv.id);
    op.textContent = inv.label || inv.short || String(inv.id);
    frag.appendChild(op);
  });

  return frag;
}

// ========= Reference card =========

function renderReferenceSlot() {
  referenceSlot.innerHTML = '';
  if (!state.reference || !chordConfig) return;

  const spec = state.reference;
  const chord = findChord(spec.sectionId, spec.chordId);
  const invDef = inversionById[spec.inversion] || { label: 'Inversion ' + spec.inversion };

  const slot = document.createElement('div');
  slot.className = 'slot';

  const head = document.createElement('div');
  head.className = 'slot-head';

  const title = document.createElement('span');
  title.textContent = 'Reference chord';
  head.appendChild(title);

  const btnRow = document.createElement('div');
  btnRow.className = 'row';

  const btnHear = document.createElement('button');
  btnHear.className = 'ghost';
  btnHear.style.padding = '4px 8px';
  btnHear.textContent = '▶ Hear';
  btnHear.addEventListener('click', () => {
    playChordFromSpec(spec, 1.0);
  });

  const btnArp = document.createElement('button');
  btnArp.className = 'ghost';
  btnArp.style.padding = '4px 8px';
  btnArp.textContent = '▶ Arp';
  btnArp.addEventListener('click', () => {
    const bpm = +bpmInp.value || 90;
    playChordArpFromSpec(spec, bpm);
  });

  btnRow.appendChild(btnHear);
  btnRow.appendChild(btnArp);
  head.appendChild(btnRow);
  slot.appendChild(head);

  const row = document.createElement('div');
  row.className = 'row';

  const selRoot = document.createElement('select');
  const optRoot = document.createElement('option');
  optRoot.value = spec.root;
  optRoot.textContent = spec.root;
  selRoot.appendChild(optRoot);
  selRoot.value = spec.root;
  selRoot.disabled = true;

  const selType = document.createElement('select');
  const optType = document.createElement('option');
  if (chord) {
    const symbol = chord.symbol || '';
    const label = chord.label || 'Chord';
    optType.value = JSON.stringify({ sectionId: spec.sectionId, chordId: spec.chordId });
    optType.textContent = symbol ? `${label} (${symbol})` : label;
  } else {
    optType.value = '';
    optType.textContent = '(chord)';
  }
  selType.appendChild(optType);
  selType.disabled = true;

  const selInv = document.createElement('select');
  const optInv = document.createElement('option');
  optInv.value = String(spec.inversion);
  optInv.textContent = invDef.label || '(inversion)';
  selInv.appendChild(optInv);
  selInv.disabled = true;

  row.appendChild(selRoot);
  row.appendChild(selType);
  row.appendChild(selInv);
  slot.appendChild(row);

  referenceSlot.appendChild(slot);
}

// ========= Exercise UI =========

function renderExercise() {
  slotsDiv.innerHTML = '';
  state.guesses = [];

  const roots = parseRootList();

  state.sequence.forEach((spec, idx) => {
    const slot = document.createElement('div');
    slot.className = 'slot';

    const head = document.createElement('div');
    head.className = 'slot-head';
    const title = document.createElement('span');
    title.textContent = `Chord ${idx + 1}`;
    head.appendChild(title);

    const btnRow = document.createElement('div');
    btnRow.className = 'row';

    const btnHear = document.createElement('button');
    btnHear.className = 'ghost';
    btnHear.style.padding = '4px 8px';
    btnHear.textContent = '▶ Hear';
    btnHear.addEventListener('click', () => {
      playChordFromSpec(spec, 1.0);
    });

    const btnArp = document.createElement('button');
    btnArp.className = 'ghost';
    btnArp.style.padding = '4px 8px';
    btnArp.textContent = '▶ Arp';
    btnArp.addEventListener('click', () => {
      const bpm = +bpmInp.value || 90;
      playChordArpFromSpec(spec, bpm);
    });

    btnRow.appendChild(btnHear);
    btnRow.appendChild(btnArp);
    head.appendChild(btnRow);
    slot.appendChild(head);

    const row = document.createElement('div');
    row.className = 'row';

    const selRoot = document.createElement('select');
    const blankRoot = document.createElement('option');
    blankRoot.value = '';
    blankRoot.textContent = '(root)';
    selRoot.appendChild(blankRoot);
    roots.forEach(r => {
      const op = document.createElement('option');
      op.value = r;
      op.textContent = r;
      selRoot.appendChild(op);
    });

    const selType = document.createElement('select');
    selType.appendChild(buildTypeSelectOptions());

    const selInv = document.createElement('select');
    const invPlaceholder = document.createElement('option');
    invPlaceholder.value = '';
    invPlaceholder.textContent = '(inversion)';
    selInv.appendChild(invPlaceholder);
    selInv.disabled = true;

    row.appendChild(selRoot);
    row.appendChild(selType);
    row.appendChild(selInv);
    slot.appendChild(row);

    const guess = { root: '', chordJson: '', inversion: '' };
    state.guesses[idx] = guess;

    const updateInversionOptions = () => {
      selInv.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = '(inversion)';
      selInv.appendChild(placeholder);

      guess.inversion = '';
      selInv.value = '';
      selInv.disabled = true;

      if (!selType.value) return;

      try {
        const chordSel = JSON.parse(selType.value);
        const sectionId = chordSel.sectionId;

        const frag = buildInversionSelectOptionsForSection(sectionId);
        const hasExtra = frag.childNodes.length > 1;
        const children = Array.from(frag.childNodes).slice(1);
        children.forEach(ch => selInv.appendChild(ch));
        selInv.disabled = !hasExtra;
      } catch {
        // leave placeholder-only
      }
    };

    const onChangeAny = () => {
      slot.classList.remove('correct', 'wrong');
      guess.root = selRoot.value;
      guess.chordJson = selType.value;
      guess.inversion = selInv.value;
    };

    selRoot.addEventListener('change', onChangeAny);
    selType.addEventListener('change', () => {
      updateInversionOptions();
      onChangeAny();
    });
    selInv.addEventListener('change', onChangeAny);

    slotsDiv.appendChild(slot);
  });
}

function refreshTypeSelects() {
  if (state.sequence && state.sequence.length) {
    renderReferenceSlot();
    renderExercise();
  }
}

// ========= Session & evaluation =========

function updateSessionDisplay() {
  const s = state.session;
  sessionScore.textContent =
    `Session: ${s.correct} correct / ${s.attempts} attempts | Exercises: ${s.exercises}`;

  const entries = Object.entries(s.missed)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);

  if (!entries.length) {
    missStats.textContent = ' | Misses: —';
  } else {
    missStats.textContent =
      ' | Misses: ' +
      entries
        .slice(0, 10)
        .map(([lab, c]) => `${lab}×${c}`)
        .join(', ');
  }
}

resetSession.addEventListener('click', () => {
  state.session = { correct: 0, attempts: 0, exercises: 0, missed: {} };
  state.pendingMisses = {};
  updateSessionDisplay();
  statusEl.textContent = '';
});

// Generic symmetry detector for pitch-class sets
function isSymmetricPitchClassSet(pcs) {
  // pcs: array of pitch classes (0–11). We treat uniqueness and spacing on the circle.
  if (!Array.isArray(pcs)) return false;

  const uniq = Array.from(new Set(pcs)).sort((a, b) => a - b);
  if (uniq.length < 3) return false; // need at least 3 distinct notes

  const diffs = [];
  for (let i = 0; i < uniq.length - 1; i++) {
    diffs.push(uniq[i + 1] - uniq[i]);
  }
  // wrap-around interval back to the first note
  diffs.push(uniq[0] + 12 - uniq[uniq.length - 1]);

  return diffs.every(d => d === diffs[0]);
}

function evaluateExercise() {
  const children = Array.from(slotsDiv.children);
  const total = state.sequence.length;

  let correct = 0;
  let attempted = 0;
  let unanswered = 0;

  for (let i = 0; i < total; i++) {
    const spec = state.sequence[i];       // the true chord
    const guess = state.guesses[i] || {}; // what the user chose
    const slot = children[i];

    slot.classList.remove('correct', 'wrong');

    // Only grade fully filled answers
    const isComplete =
      !!guess.root &&
      !!guess.chordJson &&
      guess.inversion !== '';

    if (!isComplete) {
      unanswered++;
      continue; // don't mark this slot at all
    }

    attempted++;

    let ok = false;

    try {
      const chordSel = JSON.parse(guess.chordJson);
      const inv = Number(guess.inversion);

      // 1) Strict check: exact match on root + section + chord + inversion
      if (
        guess.root === spec.root &&
        chordSel.sectionId === spec.sectionId &&
        chordSel.chordId === spec.chordId &&
        inv === spec.inversion
      ) {
        ok = true;
      } else {
        // 2) Generic symmetric check: if the *true* chord's pitch classes are
        //    rotationally symmetric, allow any labeling that produces the same
        //    pitch-class set.
        const specChord  = findChord(spec.sectionId, spec.chordId);
        const guessChord = findChord(chordSel.sectionId, chordSel.chordId);
        const specSemi   = chordConfig.noteToSemitone[spec.root];
        const guessSemi  = chordConfig.noteToSemitone[guess.root];

        if (specChord && guessChord && specSemi != null && guessSemi != null) {
          const specNotes = voiceChord(
            specSemi,
            specChord.intervals,
            spec.inversion || 0
          );
          const guessNotes = voiceChord(
            guessSemi,
            guessChord.intervals,
            inv || 0
          );

          const specPCs = Array.from(
            new Set(specNotes.map(n => ((n % 12) + 12) % 12))
          );
          const guessPCs = Array.from(
            new Set(guessNotes.map(n => ((n % 12) + 12) % 12))
          );

          if (
            specPCs.length === guessPCs.length &&
            isSymmetricPitchClassSet(specPCs)
          ) {
            let same = true;
            for (const pc of specPCs) {
              if (!guessPCs.includes(pc)) {
                same = false;
                break;
              }
            }
            if (same) {
              ok = true;
            }
          }
        }
      }
    } catch {
      ok = false;
    }

    if (ok) {
      slot.classList.add('correct');
      correct++;
    } else {
      slot.classList.add('wrong');
      const lab = formatChordLabel(spec);
      state.pendingMisses[lab] = (state.pendingMisses[lab] || 0) + 1;
    }
  }

  // Only graded answers count as attempts
  state.session.attempts += attempted;
  state.session.correct += correct;
  updateSessionDisplay();

  if (attempted === 0) {
    statusEl.textContent = 'No answers filled in yet.';
  } else if (unanswered > 0) {
    statusEl.textContent =
      `You scored ${correct}/${attempted} on filled answers. ` +
      `${unanswered} unanswered.`;
  } else {
    statusEl.textContent = `You scored ${correct}/${attempted}.`;
  }

  // Still require ALL chords to be correct before Next is enabled
  nextBtn.disabled = (correct !== total);
}

evalBtn.addEventListener('click', evaluateExercise);

function finalizeMisses() {
  const pending = state.pendingMisses;
  Object.entries(pending).forEach(([lab, c]) => {
    state.session.missed[lab] = (state.session.missed[lab] || 0) + c;
  });
  state.pendingMisses = {};
  updateSessionDisplay();
}

// ========= Playback: full progression =========

function playFullProgression() {
  if (!chordConfig) return;
  if (!state.reference && !state.sequence.length) return;

  const bpm = +bpmInp.value || 90;
  const beat = 60 / Math.max(30, Math.min(240, bpm));
  const dur = 2 * beat;

  const all = (state.reference ? [state.reference] : []).concat(state.sequence);
  let t = ctx().currentTime + 0.12;

  all.forEach(spec => {
    const chord = findChord(spec.sectionId, spec.chordId);
    if (!chord) return;
    const semi = chordConfig.noteToSemitone[spec.root];
    if (semi == null) return;
    const notes = voiceChord(semi, chord.intervals, spec.inversion || 0);
    playChord(notes, dur, { time: t, gain: 0.27 });
    t += dur;
  });
}

// ========= Buttons =========

startBtn.addEventListener('click', () => {
  if (!chordConfig) {
    alert('Config not loaded yet.');
    return;
  }

  finalizeMisses();

  const n = Math.max(1, Math.min(16, +nInp.value || 4));
  const seq = generateExercise(n);
  if (!seq) return;

  state.sequence = seq;
  state.session.exercises++;
  updateSessionDisplay();

  exerciseCard.style.display = 'block';
  renderReferenceSlot();
  renderExercise();
  statusEl.textContent = 'Exercise ready.';
  nextBtn.disabled = true;

  if (playAllBtn) {
    playAllBtn.disabled = false;
  }

  if (autoPlay.checked) {
    playFullProgression();
  }
});

nextBtn.addEventListener('click', () => {
  if (!chordConfig) return;
  finalizeMisses();

  const n = Math.max(1, Math.min(16, +nInp.value || 4));
  const seq = generateExercise(n);
  if (!seq) return;

  state.sequence = seq;
  state.session.exercises++;
  updateSessionDisplay();

  renderReferenceSlot();
  renderExercise();
  statusEl.textContent = 'New exercise ready.';
  nextBtn.disabled = true;

  if (playAllBtn) {
    playAllBtn.disabled = false;
  }

  if (autoPlay.checked) playFullProgression();
});

// Old header reference buttons (safe even if you removed them)
if (playRefBtn) {
  playRefBtn.addEventListener('click', () => {
    if (!state.reference) return;
    playChordFromSpec(state.reference, 1.0);
    statusEl.textContent = 'Played reference: ' + formatChordLabel(state.reference);
  });
}

if (playRefArpBtn) {
  playRefArpBtn.addEventListener('click', () => {
    if (!state.reference) return;
    const bpm = +bpmInp.value || 90;
    playChordArpFromSpec(state.reference, bpm);
    statusEl.textContent = 'Arpeggiated reference: ' + formatChordLabel(state.reference);
  });
}

if (playAllBtn) {
  playAllBtn.addEventListener('click', () => {
    playFullProgression();
  });
}

// ========= Init =========

updateSessionDisplay();
loadChordConfig();
