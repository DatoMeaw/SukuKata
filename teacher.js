'use strict';

/* ==========================================================
   SUKU KATA — Teacher Mode (Step 4B + syllable voice + word voice + PIN)
   Words are saved in IndexedDB through suku-kata-db.js
   (db "suku-kata-content", store "words").
   Student Mode (script.js) reads the same records.

   Image rules:
   - Only teacher images (data:image/...) are stored in `image`.
   - Built-in images/xxx.png are never stored; they are the
     fallback, found through `defaultKey`.

   Voice rules:
   - The teacher records each syllable with the device microphone
     (MediaRecorder). No TTS, no AI, no external service.
   - Recordings are stored in `audio`, keyed by the syllable
     (lower case) and kept as ArrayBuffer + mime type.
   - On save, only recordings for the word's CURRENT syllables
     are kept, so an old "Ba" can never play for a new syllable.

   PIN rules:
   - Teacher Mode opens only after the 4-digit PIN is entered
     (default "0000"; the teacher can change it with "Tukar PIN").
   - The PIN is kept in IndexedDB (suku-kata-db.js, "__settings__").
     It is a local convenience lock for children, not real security.

   Word voice rules:
   - The teacher can also record the FULL word ("Perkataan").
   - It is stored in `wordAudio` = { type, data: ArrayBuffer, key }
     where `key` is the word in lower case. On save it is kept only
     if it still matches the word, so an old "Jaguar" recording can
     never play for a different word.
   ========================================================== */


/* ---------- Config ---------- */
const LEVEL_INFO = {
  2: { title: '2 Suku Kata', syllableCount: 2 },
  3: { title: '3 Suku Kata', syllableCount: 3 }
};

const MAX_WORDS_PER_LEVEL = 6; // 3 pictures on each door

/* The built-in words. Copied into the database once (first run),
   and used as fallback pictures afterwards. */
const INITIAL_CONTENT = {
  2: [
    { word: 'Bumi',  syllables: ['Bu', 'mi'],  emoji: '🌍', image: 'images/bumi.png' },
    { word: 'Bibir', syllables: ['Bi', 'bir'], emoji: '👄', image: 'images/bibir.png' },
    { word: 'Betul', syllables: ['Be', 'tul'], emoji: '✅', image: 'images/betul.png' },
    { word: 'Bapa',  syllables: ['Ba', 'pa'],  emoji: '👨', image: 'images/bapa.png' },
    { word: 'Boleh', syllables: ['Bo', 'leh'], emoji: '🎓', image: 'images/boleh.png' },
    { word: 'Beca',  syllables: ['Be', 'ca'],  emoji: '🛺', image: 'images/beca.png' }
  ],
  3: [
    { word: 'Kelapa',   syllables: ['Ke', 'la', 'pa'],   emoji: '🥥', image: 'images/kelapa.png' },
    { word: 'Pelangi',  syllables: ['Pe', 'la', 'ngi'],  emoji: '🌈', image: 'images/pelangi.png' },
    { word: 'Kereta',   syllables: ['Ke', 're', 'ta'],   emoji: '🚗', image: 'images/kereta.png' },
    { word: 'Sekolah',  syllables: ['Se', 'ko', 'lah'],  emoji: '🏫', image: 'images/sekolah.png' },
    { word: 'Belalang', syllables: ['Be', 'la', 'lang'], emoji: '🦗', image: 'images/belalang.png' },
    { word: 'Kerusi',   syllables: ['Ke', 'ru', 'si'],   emoji: '🪑', image: 'images/kerusi.png' }
  ]
};

const TOAST_MS = 2200;

/* A syllable (or a word) is short; stop automatically so a forgotten
   recording does not grow large. */
const MAX_RECORD_MS = 6000;

const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg'
];

/* The recording target that means "the whole word" (syllables use 0, 1, 2). */
const WORD_TARGET = 'word';


/* ---------- Content (loaded from IndexedDB) ----------
   item = { id, level, word, syllables, emoji, image, defaultKey, order, audio, wordAudio } */
const content = { 2: [], 3: [] };


/* ---------- DOM references ---------- */
const dom = {
  main: document.querySelector('.t-main'),

  lists: {
    2: document.getElementById('list-2'),
    3: document.getElementById('list-3')
  },
  counts: {
    2: document.getElementById('count-2'),
    3: document.getElementById('count-3')
  },

  wordDialog: document.getElementById('word-dialog'),
  wordForm: document.getElementById('word-form'),
  wordDialogTitle: document.getElementById('word-dialog-title'),
  wordDialogLevel: document.getElementById('word-dialog-level'),
  formError: document.getElementById('form-error'),
  wordInput: document.getElementById('input-word'),
  syllableInputs: document.getElementById('syllable-inputs'),
  syllablePreview: document.getElementById('syllable-preview'),
  wordVoiceName: document.getElementById('word-voice-name'),
  wordVoiceControls: document.getElementById('word-voice-controls'),
  picturePreview: document.getElementById('picture-preview'),
  imageInput: document.getElementById('input-image'),
  fileButton: document.getElementById('file-button'),
  formCancel: document.getElementById('form-cancel'),

  deleteDialog: document.getElementById('delete-dialog'),
  deleteWord: document.getElementById('delete-word'),
  deleteCancel: document.getElementById('delete-cancel'),
  deleteConfirm: document.getElementById('delete-confirm'),

  toast: document.getElementById('toast')
};


/* ---------- Form state ---------- */
const editing = {
  levelId: null,
  itemId: null,        // null = adding a new word
  image: null,         // teacher image (data URL) or null
  fallbackImage: null, // built-in image path (preview only)
  emoji: '',
  audio: {},           // draft recordings: syllable key -> { type, data }
  wordAudio: null      // draft full-word recording: { type, data, key } or null
};

let deleting = null; // { levelId, itemId }
let saving = false;


/* ---------- Helpers ---------- */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* "bUMI" -> "Bumi" */
function capitalise(text) {
  const clean = text.trim().toLowerCase();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/* For comparing words: no spaces, upper case */
function compareKey(text) {
  return String(text || '').replace(/\s+/g, '').toUpperCase();
}

/* Key a recording is stored under (shared with Student Mode). */
function keyOf(syllable) {
  return window.SukuKataDB.syllableKey(syllable);
}

/* Key the full-word recording belongs to ("Jaguar" -> "jaguar"). */
function wordKeyOf(text) {
  return window.SukuKataDB.wordKey(text);
}

function findItem(levelId, itemId) {
  return content[levelId].find(function (item) { return item.id === itemId; }) || null;
}

function newId() {
  return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function openDialog(dialog) {
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

function closeDialog(dialog) {
  if (typeof dialog.close === 'function') {
    dialog.close();
  } else {
    dialog.removeAttribute('open');
  }
}

/* Built-in word with this name in this level (or null). */
function findBuiltIn(levelId, word) {
  const key = compareKey(word);
  if (!key) return null;
  return INITIAL_CONTENT[levelId].find(function (entry) {
    return compareKey(entry.word) === key;
  }) || null;
}

/* What to draw for a saved item:
   teacher image, else built-in image, else emoji. */
function displayPicture(item) {
  const builtIn = findBuiltIn(item.level, item.defaultKey || item.word);
  return {
    image: item.image || (builtIn ? builtIn.image : null),
    emoji: item.emoji || (builtIn ? builtIn.emoji : '')
  };
}

/* Shows the emoji at once, then swaps to the real image if it loads. */
function createPicture(picture) {
  if (!picture.image && !picture.emoji) {
    const empty = el('div', 'picture__empty');
    empty.appendChild(el('span', null, '🖼️'));
    empty.appendChild(document.createTextNode('Tiada gambar'));
    return empty;
  }

  const emoji = el('span', 'picture__emoji', picture.emoji || '🖼️');

  if (picture.image) {
    const img = new Image();
    img.className = 'picture__img';
    img.alt = '';
    img.addEventListener('load', function () {
      emoji.replaceWith(img);
    });
    img.src = picture.image;
  }

  return emoji;
}

/* Plain record for the database. */
function toRecord(item, order) {
  return {
    id: item.id,
    level: Number(item.level),
    word: item.word,
    syllables: item.syllables.slice(),
    emoji: item.emoji || '',
    image: item.image || null,
    defaultKey: item.defaultKey || null,
    order: order,
    audio: item.audio || null,
    wordAudio: item.wordAudio || null
  };
}

/* Writes a whole level (with fresh order numbers) and returns the
   saved items. Nothing in memory changes unless this succeeds. */
function saveLevel(levelId, items) {
  const records = items.map(function (item, index) {
    return toRecord(item, index + 1);
  });

  return window.SukuKataDB.saveWords(records).then(function () {
    return records;
  });
}


/* ==========================================================
   LOAD (and first-run copy of the built-in words)
   ========================================================== */
function seedRecords() {
  const records = [];

  Object.keys(INITIAL_CONTENT).forEach(function (levelId) {
    INITIAL_CONTENT[levelId].forEach(function (entry, index) {
      records.push({
        id: 'w-' + levelId + '-' + (index + 1),
        level: Number(levelId),
        word: entry.word,
        syllables: entry.syllables.slice(),
        emoji: entry.emoji,
        image: null,              // built-in image stays a fallback
        defaultKey: entry.word,
        order: index + 1,
        audio: null,
        wordAudio: null
      });
    });
  });

  return records;
}

function loadContent() {
  const db = window.SukuKataDB;

  return db.getAllWords().then(function (records) {
    if (records.length > 0) return records;

    return db.isSeeded().then(function (seeded) {
      if (seeded) return [];

      const seed = seedRecords();
      return db.saveWords(seed)
        .then(function () { return db.markSeeded(); })
        .then(function () { return seed; });
    });
  }).then(function (records) {
    content[2] = [];
    content[3] = [];

    records.forEach(function (record) {
      const levelId = String(record.level);
      if (!content[levelId]) return;
      content[levelId].push({
        id: record.id,
        level: Number(record.level),
        word: record.word,
        syllables: record.syllables.slice(),
        emoji: record.emoji || '',
        image: record.image || null,
        defaultKey: record.defaultKey || null,
        order: record.order,
        audio: record.audio || null,         // old records have none
        wordAudio: record.wordAudio || null  // old records have none
      });
    });
  });
}


/* ==========================================================
   LIST
   ========================================================== */
function renderLevel(levelId) {
  const list = dom.lists[levelId];
  const items = content[levelId];

  list.textContent = '';

  if (items.length === 0) {
    list.appendChild(el('li', 'empty-state', 'Belum ada perkataan. Tekan "+ Tambah Perkataan".'));
  } else {
    items.forEach(function (item) {
      list.appendChild(createWordCard(levelId, item));
    });
  }

  dom.counts[levelId].textContent = items.length + ' perkataan';
}

function renderAll() {
  Object.keys(content).forEach(renderLevel);
}

function createWordCard(levelId, item) {
  const card = el('li', 'word-card');

  const picture = el('div', 'word-card__picture');
  picture.setAttribute('aria-hidden', 'true');
  picture.appendChild(createPicture(displayPicture(item)));
  card.appendChild(picture);

  card.appendChild(el('h3', 'word-card__word', item.word));

  const chips = el('p', 'syllable-chips');
  chips.setAttribute('aria-label', 'Suku kata: ' + item.syllables.join(', '));
  item.syllables.forEach(function (syllable, index) {
    if (index > 0) {
      const plus = el('span', 'syllable-plus', '+');
      plus.setAttribute('aria-hidden', 'true');
      chips.appendChild(plus);
    }
    const chip = el('span', 'syllable-chip', syllable);
    chip.setAttribute('aria-hidden', 'true');
    chips.appendChild(chip);
  });
  card.appendChild(chips);

  const actions = el('div', 'word-card__actions');
  actions.appendChild(createCardButton('edit', '✏️ Edit', 't-btn--ghost', levelId, item));
  actions.appendChild(createCardButton('delete', '🗑️ Padam', 't-btn--danger', levelId, item));
  card.appendChild(actions);

  return card;
}

function createCardButton(action, label, variant, levelId, item) {
  const button = el('button', 't-btn ' + variant, label);
  button.type = 'button';
  button.dataset.action = action;
  button.dataset.level = levelId;
  button.dataset.id = item.id;
  button.setAttribute('aria-label', (action === 'edit' ? 'Edit ' : 'Padam ') + item.word);
  return button;
}


/* ==========================================================
   EDIT / ADD FORM
   ========================================================== */
function openWordForm(levelId, itemId) {
  const item = itemId ? findItem(levelId, itemId) : null;

  if (!item && content[levelId].length >= MAX_WORDS_PER_LEVEL) {
    showToast('Maksimum ' + MAX_WORDS_PER_LEVEL + ' perkataan setiap tahap.');
    return;
  }

  const shown = item ? displayPicture(item) : { image: null, emoji: '' };

  editing.levelId = levelId;
  editing.itemId = item ? item.id : null;
  editing.image = item ? item.image : null;
  editing.fallbackImage = item && !item.image ? shown.image : null;
  editing.emoji = item ? shown.emoji : '';
  editing.audio = item && item.audio ? Object.assign({}, item.audio) : {};
  editing.wordAudio = item && item.wordAudio ? Object.assign({}, item.wordAudio) : null;

  dom.wordDialog.dataset.level = levelId;
  dom.wordDialogTitle.textContent = item ? 'Edit Perkataan' : 'Tambah Perkataan';
  dom.wordDialogLevel.textContent = LEVEL_INFO[levelId].title;

  dom.wordInput.value = item ? item.word : '';
  buildSyllableInputs(LEVEL_INFO[levelId].syllableCount, item ? item.syllables : []);

  dom.imageInput.value = '';
  renderFormPicture();
  clearFormError();
  updateSyllablePreview();
  refreshAudioControls();

  openDialog(dom.wordDialog);
  dom.wordInput.focus();
}

function buildSyllableInputs(count, values) {
  dom.syllableInputs.textContent = '';

  for (let i = 0; i < count; i++) {
    if (i > 0) {
      const plus = el('span', 'syllable-inputs__plus', '+');
      plus.setAttribute('aria-hidden', 'true');
      dom.syllableInputs.appendChild(plus);
    }

    // A div (not a label) so the voice buttons are not inside a label.
    const field = el('div', 'syllable-field');

    const label = el('label', 'syllable-field__label', 'Suku kata ' + (i + 1));
    label.htmlFor = 'syllable-input-' + i;
    field.appendChild(label);

    const input = el('input', 'field__input syllable-input');
    input.id = 'syllable-input-' + i;
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = values[i] || '';
    field.appendChild(input);

    // Filled in by refreshAudioControls()
    field.appendChild(el('div', 'voice-controls'));

    dom.syllableInputs.appendChild(field);
  }
}

function getSyllableInputs() {
  return Array.prototype.slice.call(dom.syllableInputs.querySelectorAll('.syllable-input'));
}

function getSyllableValues() {
  return getSyllableInputs().map(function (input) { return input.value.trim(); });
}

/* "Bu + mi = BUMI ✓" */
function updateSyllablePreview() {
  const parts = getSyllableValues();
  const joined = compareKey(parts.join(''));
  const word = compareKey(dom.wordInput.value);
  const allFilled = parts.every(Boolean);

  let text = parts.map(function (p) { return p || '?'; }).join(' + ') + ' = ' + (joined || '…');

  dom.syllablePreview.classList.remove('is-ok', 'is-bad');

  if (allFilled && word) {
    if (joined === word) {
      text += '  ✓';
      dom.syllablePreview.classList.add('is-ok');
    } else {
      text += '  ✗ Tidak sama dengan perkataan';
      dom.syllablePreview.classList.add('is-bad');
    }
  }

  dom.syllablePreview.textContent = text;
}

function renderFormPicture() {
  dom.picturePreview.textContent = '';
  dom.picturePreview.classList.remove('is-invalid');
  dom.picturePreview.appendChild(createPicture({
    image: editing.image || editing.fallbackImage,
    emoji: editing.emoji
  }));
}

function handleImageChosen() {
  const file = dom.imageInput.files && dom.imageInput.files[0];
  if (!file) return;

  if (!file.type || file.type.indexOf('image/') !== 0) {
    showFormError('Sila pilih fail gambar (PNG atau JPG).');
    dom.imageInput.value = '';
    return;
  }

  // Data URL (not a blob: URL) so the image stays usable after a refresh.
  const reader = new FileReader();
  reader.addEventListener('load', function () {
    editing.image = reader.result;
    renderFormPicture();
    clearFormError();
  });
  reader.addEventListener('error', function () {
    showFormError('Gambar tidak dapat dibuka. Sila cuba gambar lain.');
  });
  reader.readAsDataURL(file);
}

/* ---------- Errors ---------- */
function showFormError(message, field) {
  dom.formError.textContent = message;
  dom.formError.hidden = false;

  if (field) {
    field.setAttribute('aria-invalid', 'true');
    field.focus();
  }
}

function clearFormError() {
  dom.formError.textContent = '';
  dom.formError.hidden = true;
  dom.picturePreview.classList.remove('is-invalid');
  dom.wordForm.querySelectorAll('[aria-invalid]').forEach(function (field) {
    field.removeAttribute('aria-invalid');
  });
}

/* Returns null when everything is fine, otherwise { message, field }. */
function validateForm(word, syllables) {
  if (!word) {
    return { message: 'Sila isi perkataan.', field: dom.wordInput };
  }

  const inputs = getSyllableInputs();
  for (let i = 0; i < syllables.length; i++) {
    if (!syllables[i]) {
      return { message: 'Sila isi semua suku kata.', field: inputs[i] };
    }
  }

  if (compareKey(syllables.join('')) !== compareKey(word)) {
    return {
      message: 'Suku kata (' + syllables.join(' + ') + ') tidak membentuk perkataan "' + word + '".',
      field: inputs[0]
    };
  }

  const duplicate = content[editing.levelId].some(function (item) {
    return item.id !== editing.itemId && compareKey(item.word) === compareKey(word);
  });
  if (duplicate) {
    return { message: 'Perkataan "' + word + '" sudah ada dalam tahap ini.', field: dom.wordInput };
  }

  // A picture is needed: a teacher image, or a built-in picture for this word.
  if (!editing.image && !findBuiltIn(editing.levelId, word)) {
    dom.picturePreview.classList.add('is-invalid');
    return { message: 'Sila pilih gambar.', field: dom.imageInput };
  }

  return null;
}


/* ==========================================================
   VOICE (teacher recordings)
   Used for each syllable AND for the full word ("Perkataan").
   Draft recordings live in `editing.audio` (syllables) and
   `editing.wordAudio` (word) until the word is saved.
   A recording "target" is a syllable index (0, 1, 2) or WORD_TARGET.
   ========================================================== */
const recorder = {
  /* The recording in progress, or null:
     { index (syllable index or WORD_TARGET), key, phase: 'asking' | 'recording' | 'saving',
       mediaRecorder, stream, chunks, timer, discard, mime } */
  active: null,
  playing: null   // syllable index or WORD_TARGET being played back, or null
};

let previewPlayer = null;
let previewUrl = null;

function getRecordingProblem() {
  if (!window.MediaRecorder || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return 'Pelayar ini tidak menyokong rakaman suara. Sila guna Chrome atau Edge yang terkini, ' +
           'dan buka laman ini melalui https atau localhost.';
  }
  return '';
}

function microphoneMessage(error) {
  const name = error && error.name;

  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return 'Microfon tidak dibenarkan. Sila benarkan akses mikrofon untuk merakam suara.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'Mikrofon tidak dijumpai pada peranti ini.';
  }
  if (name === 'NotReadableError') {
    return 'Mikrofon sedang digunakan oleh aplikasi lain.';
  }
  return 'Rakaman tidak dapat dimulakan. Sila cuba lagi.';
}

/* First format this browser can record, or '' to let the browser choose. */
function pickMimeType() {
  if (typeof MediaRecorder.isTypeSupported !== 'function') return '';

  for (let i = 0; i < MIME_CANDIDATES.length; i++) {
    if (MediaRecorder.isTypeSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i];
  }
  return '';
}

function normaliseAudioType(type) {
  let clean = String(type || '').replace(/^video\//, 'audio/');
  if (clean.indexOf('audio/') !== 0) clean = 'audio/webm';
  return clean;
}

function blobToArrayBuffer(blob) {
  return new Promise(function (resolve, reject) {
    const reader = new FileReader();
    reader.addEventListener('load', function () { resolve(reader.result); });
    reader.addEventListener('error', function () { reject(reader.error); });
    reader.readAsArrayBuffer(blob);
  });
}

function releaseStream(session) {
  if (session && session.stream) {
    session.stream.getTracks().forEach(function (track) { track.stop(); });
    session.stream = null;
  }
}

/* Keeps only recordings that belong to the CURRENT syllables. */
function pruneAudio(audio, syllables) {
  const keep = {};
  let count = 0;

  syllables.forEach(function (syllable) {
    const key = keyOf(syllable);
    if (key && !keep[key] && audio[key]) {
      keep[key] = audio[key];
      count++;
    }
  });

  return count > 0 ? keep : null;
}

/* The full-word recording, only while it still matches the word. */
function pruneWordAudio(wordAudio, word) {
  const key = wordKeyOf(word);
  if (!wordAudio || !key || wordAudio.key !== key) return null;
  return { type: wordAudio.type, data: wordAudio.data, key: key };
}

/* The draft recording for a target, or null. */
function entryForTarget(target) {
  if (target === WORD_TARGET) {
    const key = wordKeyOf(dom.wordInput.value);
    return key && editing.wordAudio && editing.wordAudio.key === key ? editing.wordAudio : null;
  }

  const input = getSyllableInputs()[target];
  return input ? editing.audio[keyOf(input.value)] || null : null;
}

/* ---------- Recording ---------- */
function startRecording(target) {
  if (recorder.active) return;

  const problem = getRecordingProblem();
  if (problem) {
    showFormError(problem);
    return;
  }

  let key = '';
  if (target === WORD_TARGET) {
    key = wordKeyOf(dom.wordInput.value);
    if (!key) {
      showFormError('Isi perkataan dahulu, kemudian tekan Rakam.', dom.wordInput);
      return;
    }
  } else {
    const input = getSyllableInputs()[target];
    key = input ? keyOf(input.value) : '';
    if (!key) {
      showFormError('Isi suku kata dahulu, kemudian tekan Rakam.', input);
      return;
    }
  }

  stopPreview();
  clearFormError();

  const session = {
    index: target,
    key: key,
    phase: 'asking',
    mediaRecorder: null,
    stream: null,
    chunks: [],
    timer: null,
    discard: false,
    mime: ''
  };
  recorder.active = session;
  refreshAudioControls();

  navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
    // Dialog closed (or cancelled) while the permission question was open.
    if (recorder.active !== session) {
      stream.getTracks().forEach(function (track) { track.stop(); });
      return;
    }

    session.stream = stream;
    session.mime = pickMimeType();

    const mediaRecorder = session.mime
      ? new MediaRecorder(stream, { mimeType: session.mime })
      : new MediaRecorder(stream);
    session.mediaRecorder = mediaRecorder;

    mediaRecorder.addEventListener('dataavailable', function (event) {
      if (event.data && event.data.size > 0) session.chunks.push(event.data);
    });
    mediaRecorder.addEventListener('stop', function () {
      finishRecording(session);
    });
    mediaRecorder.addEventListener('error', function () {
      if (recorder.active !== session) return;
      releaseStream(session);
      recorder.active = null;
      refreshAudioControls();
      showFormError('Rakaman terhenti. Sila cuba lagi.');
    });

    mediaRecorder.start();
    session.phase = 'recording';
    session.timer = setTimeout(function () { stopRecording(); }, MAX_RECORD_MS);
    refreshAudioControls();
  }).catch(function (error) {
    releaseStream(session);
    if (recorder.active === session) recorder.active = null;
    refreshAudioControls();
    showFormError(microphoneMessage(error));
  });
}

/* Teacher pressed "Berhenti" (or the time limit was reached). */
function stopRecording() {
  const session = recorder.active;
  if (!session || session.phase !== 'recording') return;

  if (session.timer) {
    clearTimeout(session.timer);
    session.timer = null;
  }

  try {
    if (session.mediaRecorder && session.mediaRecorder.state !== 'inactive') {
      session.mediaRecorder.stop();   // fires 'stop' -> finishRecording
    } else {
      finishRecording(session);
    }
  } catch (error) {
    finishRecording(session);
  }
}

function finishRecording(session) {
  releaseStream(session);
  if (recorder.active !== session || session.phase === 'saving') return;

  session.phase = 'saving';
  refreshAudioControls();

  const type = normaliseAudioType(
    (session.mediaRecorder && session.mediaRecorder.mimeType) || session.mime
  );
  const blob = new Blob(session.chunks, { type: type });

  if (blob.size === 0) {
    recorder.active = null;
    refreshAudioControls();
    showFormError('Tiada suara dirakam. Sila cuba lagi.');
    return;
  }

  blobToArrayBuffer(blob).then(function (buffer) {
    if (recorder.active !== session) return; // dialog closed meanwhile

    if (session.index === WORD_TARGET) {
      // Replaces only the full-word recording.
      editing.wordAudio = { type: type, data: buffer, key: session.key };
    } else {
      editing.audio[session.key] = { type: type, data: buffer };
    }
    recorder.active = null;
    refreshAudioControls();
  }).catch(function () {
    if (recorder.active !== session) return;
    recorder.active = null;
    refreshAudioControls();
    showFormError('Rakaman tidak dapat disimpan. Sila cuba lagi.');
  });
}

/* ---------- Listening (preview) ---------- */
function playPreview(target) {
  const entry = entryForTarget(target);
  if (!entry) return;

  const wasPlaying = recorder.playing === target;
  stopPreview();
  if (wasPlaying) return;

  const url = URL.createObjectURL(new Blob([entry.data], { type: entry.type }));
  const player = new Audio(url);

  previewPlayer = player;
  previewUrl = url;
  recorder.playing = target;

  player.addEventListener('ended', function () {
    if (previewPlayer === player) stopPreview();
  });
  player.addEventListener('error', function () {
    if (previewPlayer !== player) return;
    stopPreview();
    showFormError('Rakaman tidak dapat dimainkan. Sila rakam semula.');
  });

  const promise = player.play();
  if (promise && promise.catch) {
    promise.catch(function () {
      if (previewPlayer !== player) return;
      stopPreview();
      showFormError('Rakaman tidak dapat dimainkan. Sila rakam semula.');
    });
  }

  refreshAudioControls();
}

function stopPreview() {
  const player = previewPlayer;
  const url = previewUrl;
  const wasPlaying = recorder.playing !== null;

  previewPlayer = null;
  previewUrl = null;
  recorder.playing = null;

  if (player) {
    try { player.pause(); } catch (error) { /* ignore */ }
  }
  if (url) URL.revokeObjectURL(url);
  if (wasPlaying) refreshAudioControls();
}

/* Dialog closed or cancelled: drop any recording in progress. */
function cleanupAudio() {
  const session = recorder.active;

  if (session) {
    session.discard = true;
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }
    try {
      if (session.mediaRecorder && session.mediaRecorder.state !== 'inactive') {
        session.mediaRecorder.stop();
      }
    } catch (error) { /* ignore */ }
    releaseStream(session);
    recorder.active = null;
  }

  stopPreview();
  dom.wordInput.readOnly = false;
}

/* ---------- Controls under each syllable box and the word ---------- */
function voiceButton(label, action, index, variant, disabled) {
  const button = el('button', 't-btn voice-btn ' + variant, label);
  button.type = 'button';
  button.dataset.voice = action;
  button.dataset.index = String(index);
  button.disabled = Boolean(disabled);
  return button;
}

/* Fills one .voice-controls box. Same look for syllables and the word.
   p = { target, hasAudio, mine, otherBusy, isPlaying, recordingText } */
function renderVoiceBox(box, p) {
  const session = recorder.active;
  const status = el('p', 'voice-status');
  const buttons = el('div', 'voice-buttons');
  let state;

  if (p.mine && session.phase === 'asking') {
    state = 'asking';
    status.textContent = 'Menunggu kebenaran mikrofon…';
  } else if (p.mine && session.phase === 'recording') {
    state = 'recording';
    status.textContent = p.recordingText;
    buttons.appendChild(voiceButton('⏹ Berhenti', 'stop', p.target, 't-btn--danger-solid', false));
  } else if (p.mine) {
    state = 'saving';
    status.textContent = 'Menyimpan rakaman…';
  } else if (p.hasAudio) {
    state = p.isPlaying ? 'playing' : 'recorded';
    status.textContent = p.isPlaying ? '🔊 Sedang dimainkan…' : '✓ Sudah dirakam';
    buttons.appendChild(voiceButton(
      p.isPlaying ? '⏹ Henti' : '▶ Dengar', p.isPlaying ? 'pause' : 'play', p.target, 't-btn--ghost', p.otherBusy
    ));
    buttons.appendChild(voiceButton('🔄 Rakam Semula', 'record', p.target, 't-btn--primary', p.otherBusy));
  } else {
    state = 'empty';
    status.textContent = 'Belum dirakam';
    buttons.appendChild(voiceButton('🎙️ Rakam', 'record', p.target, 't-btn--primary', p.otherBusy));
  }

  box.dataset.state = state;
  box.textContent = '';
  box.appendChild(status);
  if (buttons.children.length > 0) box.appendChild(buttons);
}

function refreshAudioControls() {
  const inputs = getSyllableInputs();
  const boxes = dom.syllableInputs.querySelectorAll('.voice-controls');
  const session = recorder.active;

  // One box per syllable
  inputs.forEach(function (input, index) {
    const box = boxes[index];
    if (!box) return;

    const key = keyOf(input.value);
    const mine = Boolean(session && session.index === index);

    input.readOnly = mine;

    renderVoiceBox(box, {
      target: index,
      hasAudio: Boolean(key && editing.audio[key]),
      mine: mine,
      otherBusy: Boolean(session && !mine),
      isPlaying: recorder.playing === index,
      recordingText: '🔴 Merakam… sebut suku kata ini'
    });
  });

  // The full word ("Perkataan")
  const wordMine = Boolean(session && session.index === WORD_TARGET);

  dom.wordInput.readOnly = wordMine;
  dom.wordVoiceName.textContent = dom.wordInput.value.trim();

  renderVoiceBox(dom.wordVoiceControls, {
    target: WORD_TARGET,
    hasAudio: Boolean(entryForTarget(WORD_TARGET)),
    mine: wordMine,
    otherBusy: Boolean(session && !wordMine),
    isPlaying: recorder.playing === WORD_TARGET,
    recordingText: '🔴 Merakam… sebut perkataan ini'
  });
}

/* ---------- Save ---------- */
function handleSave(event) {
  event.preventDefault();
  if (saving) return;
  clearFormError();

  if (recorder.active) {
    showFormError('Sila berhenti merakam dahulu sebelum menyimpan.');
    return;
  }

  const word = capitalise(dom.wordInput.value);
  const syllables = getSyllableValues().map(function (syllable, index) {
    return index === 0 ? capitalise(syllable) : syllable.toLowerCase();
  });

  const problem = validateForm(word, syllables);
  if (problem) {
    showFormError(problem.message, problem.field);
    return;
  }

  const levelId = editing.levelId;
  const builtIn = findBuiltIn(levelId, word);
  const existing = editing.itemId ? findItem(levelId, editing.itemId) : null;

  const item = {
    id: existing ? existing.id : newId(),
    level: Number(levelId),
    word: word,
    syllables: syllables,
    image: editing.image || null,                // teacher image only
    emoji: builtIn ? builtIn.emoji : '',
    defaultKey: builtIn ? builtIn.word : null,   // fallback picture lookup
    audio: pruneAudio(editing.audio, syllables), // only the CURRENT syllables
    wordAudio: pruneWordAudio(editing.wordAudio, word) // only if it still matches the word
  };

  const nextList = existing
    ? content[levelId].map(function (entry) { return entry.id === existing.id ? item : entry; })
    : content[levelId].concat([item]);

  saving = true;

  saveLevel(levelId, nextList).then(function (records) {
    content[levelId] = records;
    renderLevel(levelId);
    closeDialog(dom.wordDialog);
    showToast('Perkataan "' + word + '" disimpan.');
    focusEditButton(levelId, item.id);
  }).catch(function (error) {
    console.error('[Teacher] Save failed', error);
    showFormError('Tidak dapat menyimpan. Sila cuba lagi.');
  }).then(function () {
    saving = false;
  });
}

function focusEditButton(levelId, itemId) {
  const button = dom.lists[levelId].querySelector(
    '[data-action="edit"][data-id="' + itemId + '"]'
  );
  if (button) button.focus();
}


/* ==========================================================
   DELETE
   ========================================================== */
function openDeleteDialog(levelId, itemId) {
  const item = findItem(levelId, itemId);
  if (!item) return;

  deleting = { levelId: levelId, itemId: itemId };
  dom.deleteWord.textContent = item.word;

  openDialog(dom.deleteDialog);
  dom.deleteCancel.focus();
}

function handleDeleteConfirm() {
  if (!deleting || saving) return;

  const levelId = deleting.levelId;
  const itemId = deleting.itemId;
  const item = findItem(levelId, itemId);

  saving = true;

  window.SukuKataDB.deleteWord(itemId).then(function () {
    const remaining = content[levelId].filter(function (entry) {
      return entry.id !== itemId;
    });
    return saveLevel(levelId, remaining);
  }).then(function (records) {
    content[levelId] = records;
    deleting = null;

    renderLevel(levelId);
    closeDialog(dom.deleteDialog);
    showToast('Perkataan "' + (item ? item.word : '') + '" dipadam.');

    const addButton = document.querySelector('[data-action="add"][data-level="' + levelId + '"]');
    if (addButton) addButton.focus();
  }).catch(function (error) {
    console.error('[Teacher] Delete failed', error);
    closeDialog(dom.deleteDialog);
    showToast('Tidak dapat memadam. Sila cuba lagi.');
  }).then(function () {
    saving = false;
  });
}


/* ==========================================================
   TOAST
   ========================================================== */
let toastTimer = null;

function showToast(message) {
  clearTimeout(toastTimer);
  dom.toast.textContent = message;
  dom.toast.classList.add('is-visible');

  toastTimer = setTimeout(function () {
    dom.toast.classList.remove('is-visible');
    setTimeout(function () { dom.toast.textContent = ''; }, 250);
  }, TOAST_MS);
}


/* ==========================================================
   INIT
   ========================================================== */

/* Voice button clicked (syllable boxes and the word box share this). */
function handleVoiceClick(event) {
  const button = event.target.closest('[data-voice]');
  if (!button || button.disabled) return;

  const target = button.dataset.index === WORD_TARGET ? WORD_TARGET : Number(button.dataset.index);
  const action = button.dataset.voice;

  if (action === 'record') startRecording(target);
  if (action === 'stop') stopRecording();
  if (action === 'play') playPreview(target);
  if (action === 'pause') stopPreview();
}

function init() {
  // Add / Edit / Delete buttons (one listener for the whole page)
  dom.main.addEventListener('click', function (event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;

    const levelId = button.dataset.level;
    const action = button.dataset.action;

    if (action === 'add') openWordForm(levelId, null);
    if (action === 'edit') openWordForm(levelId, button.dataset.id);
    if (action === 'delete') openDeleteDialog(levelId, button.dataset.id);
  });

  // Form
  dom.wordForm.addEventListener('submit', handleSave);
  dom.formCancel.addEventListener('click', function () {
    closeDialog(dom.wordDialog);
  });

  dom.wordForm.addEventListener('input', function (event) {
    if (event.target === dom.imageInput) return;
    event.target.removeAttribute('aria-invalid');
    updateSyllablePreview();

    // The recording belongs to the syllable text, so refresh its buttons.
    if (event.target.classList && event.target.classList.contains('syllable-input')) {
      stopPreview();
      refreshAudioControls();
    }

    // The full-word recording belongs to the word text.
    if (event.target === dom.wordInput) {
      stopPreview();
      refreshAudioControls();
    }
  });

  dom.imageInput.addEventListener('change', handleImageChosen);

  // Voice buttons (one handler; the buttons are rebuilt as states change)
  dom.syllableInputs.addEventListener('click', handleVoiceClick);
  dom.wordVoiceControls.addEventListener('click', handleVoiceClick);

  // Closing the form (Save, Batal or Esc) ends any recording or playback.
  dom.wordDialog.addEventListener('close', cleanupAudio);

  // Delete confirmation
  dom.deleteCancel.addEventListener('click', function () {
    deleting = null;
    closeDialog(dom.deleteDialog);
  });
  dom.deleteConfirm.addEventListener('click', handleDeleteConfirm);

  // Load saved words from IndexedDB, then draw the lists.
  if (!window.SukuKataDB) {
    showToast('suku-kata-db.js tidak dimuatkan.');
    renderAll();
    return;
  }

  loadContent().then(renderAll).catch(function (error) {
    console.error('[Teacher] Could not load saved words', error);
    renderAll();
    showToast('Tidak dapat membuka storan pelayar.');
  });
}

/* ==========================================================
   PIN LOCK
   The PIN screen is shown first. Teacher Mode (init) only starts
   after the correct PIN. The PIN itself is never shown, logged or
   kept in a variable: it is only sent to suku-kata-db.js to be checked.
   ========================================================== */
const pinDom = {
  gate: document.getElementById('pin-gate'),
  form: document.getElementById('pin-form'),
  input: document.getElementById('pin-input'),
  toggle: document.getElementById('pin-toggle'),
  error: document.getElementById('pin-error'),

  app: document.getElementById('t-app'),

  openChange: document.getElementById('pin-change-open'),
  dialog: document.getElementById('pin-dialog'),
  changeForm: document.getElementById('pin-change-form'),
  current: document.getElementById('pin-current'),
  next: document.getElementById('pin-new'),
  confirm: document.getElementById('pin-confirm'),
  changeError: document.getElementById('pin-change-error'),
  changeCancel: document.getElementById('pin-change-cancel')
};

const PIN_PATTERN = /^\d{4}$/;

let teacherModeStarted = false;
let pinBusy = false;

/* Digits only, at most 4. */
function keepDigits(input) {
  const clean = input.value.replace(/\D/g, '').slice(0, 4);
  if (clean !== input.value) input.value = clean;
}

function showPinError(box, message) {
  box.textContent = message;
  box.hidden = false;
}

function clearPinError(box) {
  box.textContent = '';
  box.hidden = true;
}

function setPinVisible(visible) {
  pinDom.input.type = visible ? 'text' : 'password';
  pinDom.toggle.textContent = visible ? '🙈 Sembunyi' : '👁 Tunjuk';
  pinDom.toggle.setAttribute('aria-pressed', String(visible));
}

/* Correct PIN: close the PIN screen and start Teacher Mode as usual. */
function unlockTeacherMode() {
  pinDom.input.value = '';
  setPinVisible(false);
  clearPinError(pinDom.error);

  pinDom.gate.hidden = true;
  pinDom.app.hidden = false;

  if (!teacherModeStarted) {
    teacherModeStarted = true;
    init();
  }
}

function handlePinSubmit(event) {
  event.preventDefault();
  if (pinBusy) return;
  clearPinError(pinDom.error);

  if (!window.SukuKataDB) {
    showPinError(pinDom.error, 'suku-kata-db.js tidak dimuatkan.');
    return;
  }

  const pin = pinDom.input.value;
  pinBusy = true;

  window.SukuKataDB.verifyTeacherPin(pin).then(function (ok) {
    if (ok) {
      unlockTeacherMode();
      return;
    }

    // Wrong PIN: stay here, clear the box, try again.
    pinDom.input.value = '';
    showPinError(pinDom.error, 'PIN salah. Cuba lagi.');
    pinDom.input.focus();
  }).catch(function () {
    pinDom.input.value = '';
    showPinError(pinDom.error, 'Tidak dapat membuka storan pelayar.');
  }).then(function () {
    pinBusy = false;
  });
}

/* ---------- Tukar PIN (only reachable inside Teacher Mode) ---------- */
function clearPinChangeFields() {
  pinDom.current.value = '';
  pinDom.next.value = '';
  pinDom.confirm.value = '';
}

function openPinChange() {
  clearPinChangeFields();
  clearPinError(pinDom.changeError);
  openDialog(pinDom.dialog);
  pinDom.current.focus();
}

function pinChangeFail(message, field, clearField) {
  showPinError(pinDom.changeError, message);
  if (clearField) field.value = '';
  field.focus();
}

function handlePinChange(event) {
  event.preventDefault();
  if (pinBusy) return;
  clearPinError(pinDom.changeError);

  const db = window.SukuKataDB;
  if (!db) {
    showPinError(pinDom.changeError, 'suku-kata-db.js tidak dimuatkan.');
    return;
  }

  const current = pinDom.current.value;
  const next = pinDom.next.value;
  const confirm = pinDom.confirm.value;

  pinBusy = true;

  db.verifyTeacherPin(current).then(function (ok) {
    if (!ok) {
      pinChangeFail('PIN semasa salah.', pinDom.current, true);
      return null;
    }
    if (!PIN_PATTERN.test(next)) {
      pinChangeFail('PIN baharu mesti 4 digit.', pinDom.next, true);
      return null;
    }
    if (confirm !== next) {
      pinChangeFail('PIN baharu tidak sepadan.', pinDom.confirm, true);
      return null;
    }

    return db.changeTeacherPin(current, next).then(function (result) {
      if (result === 'ok') {
        closeDialog(pinDom.dialog);       // also clears the fields
        showToast('PIN berjaya ditukar!');
      } else if (result === 'wrong-current') {
        pinChangeFail('PIN semasa salah.', pinDom.current, true);
      } else {
        pinChangeFail('PIN baharu mesti 4 digit.', pinDom.next, true);
      }
    });
  }).catch(function () {
    showPinError(pinDom.changeError, 'Tidak dapat menyimpan PIN. Sila cuba lagi.');
  }).then(function () {
    pinBusy = false;
  });
}

function setupPinLock() {
  [pinDom.input, pinDom.current, pinDom.next, pinDom.confirm].forEach(function (input) {
    input.addEventListener('input', function () {
      keepDigits(input);
      input.removeAttribute('aria-invalid');
    });
  });

  pinDom.form.addEventListener('submit', handlePinSubmit);
  pinDom.toggle.addEventListener('click', function () {
    setPinVisible(pinDom.input.type === 'password');
    pinDom.input.focus();
  });

  pinDom.openChange.addEventListener('click', openPinChange);
  pinDom.changeForm.addEventListener('submit', handlePinChange);
  pinDom.changeCancel.addEventListener('click', function () {
    closeDialog(pinDom.dialog);
  });
  // Save, Batal or Esc: never leave PIN digits sitting in the form.
  pinDom.dialog.addEventListener('close', function () {
    clearPinChangeFields();
    clearPinError(pinDom.changeError);
  });

  if (!window.SukuKataDB) {
    showPinError(pinDom.error, 'suku-kata-db.js tidak dimuatkan.');
  }

  pinDom.input.focus();
}

setupPinLock();