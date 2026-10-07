'use strict';

/* ==========================================================
   SUKU KATA — Main script
   Step 1: Home screen (locked)
   Step 2: 2D almari with hinged doors (locked)
   Step 3: Gameplay + child-friendly feedback area
   Step 4B: Teacher's saved content (IndexedDB)
   Step 5: Teacher-recorded syllable voice (optional)
   Step 6: Teacher-recorded global feedback voice (optional)
   ========================================================== */


/* ---------- Config ----------
   A word is correct when the chosen syllables, joined together,
   equal a picture's label. Pictures: if `image` exists in images/,
   it is shown; otherwise the emoji is used. Positions never change. */
const LEVELS = {
  2: {
    title: '2 Suku Kata',
    syllableCount: 2,
    subtitle: 'Klik suku kata pertama + kedua + gambar!',
    instructions: [
      'Pilih suku kata pertama (baris atas)',
      'Pilih suku kata kedua (baris bawah)'
    ],
    syllableRows: [
      ['Ba', 'Bi', 'Be', 'Bo', 'Bu', 'Be'],
      ['bir', 'pa', 'mi', 'ca', 'tul', 'leh']
    ],
    pictures: {
      left: [
        { label: 'Bumi',  emoji: '🌍', image: 'images/bumi.png' },
        { label: 'Bibir', emoji: '👄', image: 'images/bibir.png' },
        { label: 'Betul', emoji: '✅', image: 'images/betul.png' }
      ],
      right: [
        { label: 'Bapa',  emoji: '👨', image: 'images/bapa.png' },
        { label: 'Boleh', emoji: '🎓', image: 'images/boleh.png' },
        { label: 'Beca',  emoji: '🛺', image: 'images/beca.png' }
      ]
    }
  },

  3: {
    title: '3 Suku Kata',
    syllableCount: 3,
    subtitle: 'Klik suku kata pertama + kedua + ketiga + gambar!',
    instructions: [
      'Pilih suku kata pertama (baris atas)',
      'Pilih suku kata kedua (baris tengah)',
      'Pilih suku kata ketiga (baris bawah)'
    ],
    syllableRows: [
      ['Ke', 'Ke', 'Se', 'Ke', 'Be', 'Pe'],
      ['re', 'la', 'ko', 'ru', 'la', 'la'],
      ['ta', 'pa', 'lah', 'si', 'lang', 'ngi']
    ],
    pictures: {
      left: [
        { label: 'Kelapa',   emoji: '🥥', image: 'images/kelapa.png' },
        { label: 'Pelangi',  emoji: '🌈', image: 'images/pelangi.png' },
        { label: 'Kereta',   emoji: '🚗', image: 'images/kereta.png' }
      ],
      right: [
        { label: 'Sekolah',  emoji: '🏫', image: 'images/sekolah.png' },
        { label: 'Belalang', emoji: '🦗', image: 'images/belalang.png' },
        { label: 'Kerusi',   emoji: '🪑', image: 'images/kerusi.png' }
      ]
    }
  }
};

const ORDINALS = ['pertama', 'kedua', 'ketiga', 'keempat'];

/* How long feedback messages stay before moving on (ms) */
const CELEBRATE_MS = 4500;
const RETRY_MS = 4500;

const HOME_DOCUMENT_TITLE = 'Suku Kata — Jom Belajar Membaca!';
const HASH_PREFIX = 'tahap-';


/* ---------- DOM references ---------- */
const dom = {
  screens: document.querySelectorAll('.screen'),

  homeScreen: document.getElementById('screen-home'),
  levelGrid: document.getElementById('level-grid'),

  gameScreen: document.getElementById('screen-game'),
  gameTitle: document.getElementById('game-title'),
  gameLevelNumber: document.getElementById('game-level-number'),
  backButton: document.getElementById('back-button'),

  gameSubtitle: document.getElementById('game-subtitle'),
  howToList: document.getElementById('how-to-list'),
  readyCount: document.getElementById('ready-count'),
  readyTotal: document.getElementById('ready-total'),
  statusHint: document.getElementById('status-hint'),
  syllableGrid: document.getElementById('syllable-grid'),
  selectionRow: document.getElementById('selection-row'),
  clearButton: document.getElementById('clear-button'),

  feedback: document.getElementById('feedback'),
  feedbackEmoji: document.getElementById('feedback-emoji'),
  feedbackFormula: document.getElementById('feedback-formula'),
  feedbackWord: document.getElementById('feedback-word'),
  feedbackTitle: document.getElementById('feedback-title'),
  feedbackText: document.getElementById('feedback-text'),
  feedbackExtra: document.getElementById('feedback-extra'),
  feedbackAction: document.getElementById('feedback-action'),

  pictures: {
    left: document.getElementById('pictures-left'),
    right: document.getElementById('pictures-right')
  },

  doors: {
    left: document.getElementById('door-left'),
    right: document.getElementById('door-right')
  },

  doorToggles: document.querySelectorAll('.door__toggle')
};


/* ---------- App state ---------- */
const state = {
  lastLevelId: null,
  openedFromHome: false,
  doors: { left: false, right: false }
};

/* ---------- Game state ----------
   phase:
     'syllables' — picking syllables
     'picture'   — all syllables picked, choose a picture
     'pause'     — a message is showing (correct / try again)
     'finished'  — all words matched */
const game = {
  level: null,
  picks: [],             // [{ text, col }] one per row
  completed: new Set(),  // matched words (UPPERCASE)
  phase: 'syllables',
  timer: null
};


/* ---------- Small helpers ---------- */
function createElement(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function allPictures(level) {
  return level.pictures.left.concat(level.pictures.right);
}

function restartAnimation(el, className) {
  el.classList.remove(className);
  void el.offsetWidth; // reflow so the animation can replay
  el.classList.add(className);
}


/* ---------- Screens ---------- */
function showScreen(screenEl, focusTarget) {
  dom.screens.forEach(function (screen) {
    screen.hidden = screen !== screenEl;
  });

  window.scrollTo(0, 0);

  if (focusTarget) {
    focusTarget.focus({ preventScroll: true });
  }
}

function showHome(moveFocus) {
  clearGameTimer();
  stopSyllableAudio();
  stopFeedbackAudio();
  state.openedFromHome = false;
  document.title = HOME_DOCUMENT_TITLE;

  const lastCard = state.lastLevelId
    ? dom.levelGrid.querySelector('[data-level="' + state.lastLevelId + '"]')
    : null;

  showScreen(dom.homeScreen, moveFocus ? lastCard : null);
}

function showGame(levelId, moveFocus) {
  const level = LEVELS[levelId];
  state.lastLevelId = levelId;

  dom.gameScreen.dataset.level = levelId;
  dom.gameLevelNumber.textContent = levelId;
  document.title = level.title + ' — Suku Kata';

  setupAlmari(level);

  showScreen(dom.gameScreen, moveFocus ? dom.gameTitle : null);
}


/* ---------- Almari setup ---------- */
function setupAlmari(level) {
  setDoor('left', false);
  setDoor('right', false);

  renderPanelText(level);
  renderSyllableGrid(level.syllableRows);
  startGame(level);
}

function renderPanelText(level) {
  dom.gameSubtitle.textContent = level.subtitle;

  dom.howToList.textContent = '';
  level.instructions.forEach(function (line) {
    dom.howToList.appendChild(createElement('li', null, line));
  });

  dom.readyTotal.textContent = String(allPictures(level).length);
}

function renderSyllableGrid(rows) {
  dom.syllableGrid.textContent = '';

  rows.forEach(function (row, rowIndex) {
    const rowEl = createElement('div', 'syllable-row');
    if (rowIndex % 2 === 1) rowEl.classList.add('syllable-row--strong');

    row.forEach(function (syllable, col) {
      const button = createElement('button', 'syl', syllable);
      button.type = 'button';
      button.dataset.row = String(rowIndex);
      button.dataset.col = String(col);
      button.setAttribute('aria-pressed', 'false');
      rowEl.appendChild(button);
    });

    dom.syllableGrid.appendChild(rowEl);
  });
}

function renderPictures(container, pictures) {
  container.textContent = '';

  pictures.forEach(function (picture) {
    const card = createElement('button', 'picture-card');
    card.type = 'button';
    card.dataset.word = picture.label.toUpperCase();
    card.setAttribute('aria-label', picture.label);

    // Emoji placeholder first; swapped for the real image once it loads.
    const emoji = createElement('span', 'picture-card__emoji', picture.emoji);
    emoji.setAttribute('aria-hidden', 'true');
    card.appendChild(emoji);

    if (picture.image) {
      const img = new Image();
      img.className = 'picture-card__img';
      img.alt = '';
      img.addEventListener('load', function () {
        emoji.replaceWith(img);
      });
      img.src = picture.image;
    }

    container.appendChild(card);
  });
}


/* ==========================================================
   GAME
   ========================================================== */
function startGame(level) {
  clearGameTimer();

  game.level = level;
  game.picks = [];
  game.completed = new Set();
  game.phase = 'syllables';

  renderPictures(dom.pictures.left, level.pictures.left);
  renderPictures(dom.pictures.right, level.pictures.right);

  updateGameUI();
  showPrompt(false);
}

/* ---------- Timers ---------- */
function clearGameTimer() {
  if (game.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }
}

function schedule(callback, delay) {
  clearGameTimer();
  game.timer = setTimeout(function () {
    game.timer = null;
    callback();
  }, delay);
}

/* ---------- Derived values ---------- */
function isWordComplete() {
  return game.picks.length === game.level.syllableCount;
}

function currentWord() {
  if (!isWordComplete()) return '';
  return game.picks.map(function (pick) { return pick.text; }).join('').toUpperCase();
}

/* "Ke + la + ?" */
function currentFormula() {
  const parts = [];
  for (let i = 0; i < game.level.syllableCount; i++) {
    parts.push(game.picks[i] ? game.picks[i].text : '?');
  }
  return parts.join(' + ');
}

function wordHasPicture(word) {
  return allPictures(game.level).some(function (picture) {
    return picture.label.toUpperCase() === word;
  });
}

function bothDoorsClosed() {
  return !state.doors.left && !state.doors.right;
}

/* ---------- Actions ---------- */
function handleSyllableTap(row, col) {
  if (!game.level || game.phase === 'finished') return;

  const count = game.level.syllableCount;
  if (row > game.picks.length || row >= count) return;

  // Teacher's recording for this syllable (optional; never affects the game).
  playSyllableAudio(row, col);

  clearGameTimer();

  // Picking in an earlier row replaces that choice and the ones after it.
  game.picks = game.picks.slice(0, row);
  game.picks.push({ text: game.level.syllableRows[row][col], col: col });

  if (!isWordComplete()) {
    game.phase = 'syllables';
    updateGameUI();
    showPrompt(true);
    return;
  }

  const word = currentWord();

  // Not one of the pictures: encourage, then start the word again.
  if (!wordHasPicture(word)) {
    game.phase = 'pause';
    updateGameUI();
    setFeedback({
      tone: 'wrong',
      emoji: '😊',
      formula: currentFormula(),
      title: 'Cuba lagi!',
      text: 'Kamu boleh! 💪'
    }, true);

    playFeedbackAudio('wrong');
    
    schedule(clearPicks, RETRY_MS + 400);
    return;
  }

  // Already matched earlier.
  if (game.completed.has(word)) {
    game.phase = 'pause';
    updateGameUI();
    setFeedback({
      tone: 'done',
      emoji: '⭐',
      word: word,
      title: 'Sudah siap!',
      text: 'Cari perkataan lain 👆'
    }, true);
    schedule(clearPicks, RETRY_MS + 400);
    return;
  }

  game.phase = 'picture';
  updateGameUI();
  showPrompt(true);
}

function handlePictureTap(card) {
  if (!game.level) return;
  if (game.phase === 'pause' || game.phase === 'finished') return;

  // Picture tapped before the word is ready: repeat the current hint.
  if (game.phase !== 'picture') {
    showPrompt(true);
    return;
  }

  clearGameTimer();
  const word = currentWord();

  if (card.dataset.word === word) {
    game.completed.add(word);
    markCardDone(card);

    const total = allPictures(game.level).length;
    game.phase = game.completed.size === total ? 'finished' : 'pause';
    updateGameUI();

    setFeedback({
      tone: 'correct',
      emoji: '👍',
      word: word,
      title: 'BETUL! 🎉',
      text: 'Pandai!'
    }, true);

    // Teacher's recorded word ("Jaguar!"), then the global "Jawapan Betul".
    // Either one is optional; missing recordings are skipped silently.
    playCorrectAnswerAudio(word);

    if (game.phase === 'finished') {
      schedule(function () { showPrompt(true); }, CELEBRATE_MS);
    } else {
      schedule(clearPicks, CELEBRATE_MS);
    }
  } else {
    restartAnimation(card, 'is-wrong');
    setTimeout(function () { card.classList.remove('is-wrong'); }, 700);

    setFeedback({
      tone: 'wrong',
      emoji: '😊',
      word: word,
      title: 'Cuba lagi!',
      text: 'Kamu boleh! 💪'
    }, true);

    // Teacher's recorded "Jawapan Salah" (optional; silent if none).
    playFeedbackAudio('wrong');

    // Keep the chosen syllables so the child can try another picture.
    schedule(function () { showPrompt(true); }, RETRY_MS);
  }
}

function clearPicks() {
  clearGameTimer();
  game.picks = [];
  game.phase = 'syllables';
  updateGameUI();
  showPrompt(true);
}

function markCardDone(card) {
  card.classList.add('is-done');
  card.disabled = true;
  card.setAttribute('aria-label', card.getAttribute('aria-label') + ', siap');
}

/* ---------- UI updates ---------- */
function updateGameUI() {
  updateSyllableRows();
  updateSelectionRow();
  updateStatus();
}

function updateSyllableRows() {
  const rows = dom.syllableGrid.children;

  Array.prototype.forEach.call(rows, function (rowEl, rowIndex) {
    const locked = game.phase === 'finished' || rowIndex > game.picks.length;
    const current = game.phase === 'syllables' && rowIndex === game.picks.length;
    const pick = game.picks[rowIndex];

    rowEl.classList.toggle('is-locked', locked);
    rowEl.classList.toggle('is-current', current);

    Array.prototype.forEach.call(rowEl.children, function (button, col) {
      const selected = Boolean(pick) && pick.col === col;
      button.disabled = locked;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  });
}

/* "Dipilih:  Ke + ? = ---" */
function updateSelectionRow() {
  const count = game.level.syllableCount;
  dom.selectionRow.textContent = '';

  for (let i = 0; i < count; i++) {
    if (i > 0) dom.selectionRow.appendChild(createElement('span', 'pick-op', '+'));

    const pick = game.picks[i];
    const slot = createElement('span', 'pick-slot', pick ? pick.text : '?');
    if (pick) slot.classList.add('pick-slot--filled');
    if (game.phase === 'syllables' && i === game.picks.length) {
      slot.classList.add('pick-slot--active');
    }
    dom.selectionRow.appendChild(slot);
  }

  dom.selectionRow.appendChild(createElement('span', 'pick-op', '='));

  const word = currentWord();
  const result = createElement('span', 'pick-result', word || '---');
  if (word) result.classList.add('pick-result--filled');
  dom.selectionRow.appendChild(result);
}

function updateStatus() {
  dom.readyCount.textContent = String(game.completed.size);

  let hint;
  if (game.phase === 'finished') {
    hint = 'Semua siap! 🎉';
  } else if (!isWordComplete()) {
    hint = 'Pilih suku kata ' + ORDINALS[game.picks.length];
  } else {
    hint = 'Pilih gambar';
  }
  dom.statusHint.textContent = hint;
}

/* ---------- Feedback area ---------- */

/* Shows the guidance message that matches the current game state. */
function showPrompt(animate) {
  if (!game.level) return;

  if (game.phase === 'finished') {
    setFeedback({
      tone: 'finished',
      emoji: '🏆',
      title: 'Tahniah!',
      text: 'Semua perkataan siap! 🌟',
      action: true
    }, animate);
    return;
  }

  const picked = game.picks.length;

  if (picked === 0) {
    setFeedback({
      tone: 'start',
      emoji: '👆',
      title: 'Pilih suku kata pertama!',
      text: 'Jom cuba! 🌟'
    }, animate);
  } else if (!isWordComplete()) {
    setFeedback({
      tone: 'progress',
      emoji: '👏',
      formula: currentFormula(),
      text: 'Bagus! Pilih suku kata seterusnya 👆'
    }, animate);
  } else {
    setFeedback({
      tone: 'picture',
      formula: currentFormula(),
      word: currentWord(),
      title: '👆 Sekarang pilih gambar yang betul!',
      extra: bothDoorsClosed() ? 'Buka pintu almari! 🚪' : ''
    }, animate);
  }
}

function setLine(el, value) {
  el.textContent = value || '';
  el.hidden = !value;
}

function setFeedback(view, animate) {
  dom.feedback.dataset.tone = view.tone;

  setLine(dom.feedbackEmoji, view.emoji);
  setLine(dom.feedbackFormula, view.formula);
  setLine(dom.feedbackWord, view.word);
  setLine(dom.feedbackTitle, view.title);
  setLine(dom.feedbackText, view.text);
  setLine(dom.feedbackExtra, view.extra);
  dom.feedbackAction.hidden = !view.action;

  if (animate) {
    restartAnimation(dom.feedback, 'is-pop');
  }
}


/* ---------- Doors ---------- */
function setDoor(side, isOpen) {
  const door = dom.doors[side];
  if (!door) return;

  state.doors[side] = isOpen;
  door.classList.toggle('is-open', isOpen);

  const toggle = door.querySelector('.door__toggle');
  toggle.setAttribute('aria-expanded', String(isOpen));
}

function toggleDoor(side) {
  setDoor(side, !state.doors[side]);

  // Update the "Buka pintu almari!" hint if it is showing.
  if (game.level && game.phase === 'picture' && !game.timer) {
    showPrompt(false);
  }
}


/* ---------- Navigation (address-based) ---------- */
function getLevelIdFromHash() {
  const hash = window.location.hash.replace('#', '');
  if (hash.indexOf(HASH_PREFIX) !== 0) return null;

  const levelId = hash.slice(HASH_PREFIX.length);
  return LEVELS[levelId] ? levelId : null;
}

function render(moveFocus) {
  const levelId = getLevelIdFromHash();

  if (levelId) {
    showGame(levelId, moveFocus);
  } else {
    showHome(moveFocus);
  }
}

function openLevel(levelId) {
  if (!LEVELS[levelId]) return;

  state.openedFromHome = true;
  window.location.hash = HASH_PREFIX + levelId;
}

function goHome() {
  if (state.openedFromHome) {
    window.history.back();
  } else {
    window.location.hash = '';
  }
}

/* ==========================================================
   SAVED CONTENT (Step 4B)
   Teacher Mode saves words in IndexedDB (suku-kata-db.js).
   Image priority:
     A. teacher-uploaded saved image
     B. built-in images/xxx.png
     C. emoji
   ========================================================== */
const MAX_WORDS_PER_LEVEL = 6; // 3 pictures on each door

function copyPicture(picture) {
  return { label: picture.label, emoji: picture.emoji, image: picture.image };
}

function cloneLevelContent(level) {
  return {
    pictures: {
      left: level.pictures.left.map(copyPicture),
      right: level.pictures.right.map(copyPicture)
    },
    syllableRows: level.syllableRows.map(function (row) { return row.slice(); })
  };
}

/* Snapshot of the built-in content, taken before anything is replaced. */
const BUILT_IN = {};
Object.keys(LEVELS).forEach(function (levelId) {
  BUILT_IN[levelId] = cloneLevelContent(LEVELS[levelId]);
});

function builtInPictures(levelId) {
  return BUILT_IN[levelId].pictures.left.concat(BUILT_IN[levelId].pictures.right);
}

function findBuiltInPicture(levelId, record) {
  const key = String(record.defaultKey || record.word).toUpperCase();
  return builtInPictures(levelId).find(function (picture) {
    return picture.label.toUpperCase() === key;
  }) || null;
}

/* Saved record -> picture object for renderPictures() */
function toStudentPicture(levelId, record) {
  const builtIn = findBuiltInPicture(levelId, record);
  let image = null;

  if (window.SukuKataDB.isPersistentImage(record.image)) {
    image = record.image;                 // A. teacher image
  } else if (builtIn && builtIn.image) {
    image = builtIn.image;                // B. built-in image
  }                                       // C. emoji (renderPictures fallback)

  return {
    label: record.word,
    emoji: record.emoji || (builtIn && builtIn.emoji) || '🖼️',
    image: image,
    wordAudio: window.SukuKataDB.wordAudioOf(record)   // full-word recording or null
  };
}

function isUsableRecord(record, syllableCount) {
  return Boolean(record) &&
    typeof record.word === 'string' && record.word.trim() !== '' &&
    Array.isArray(record.syllables) && record.syllables.length === syllableCount &&
    record.syllables.every(function (s) { return typeof s === 'string' && s.trim() !== ''; });
}

/* Same words as the built-in set (in the same order)? */
function matchesBuiltInWords(levelId, records) {
  const builtIn = builtInPictures(levelId);
  if (builtIn.length !== records.length) return false;

  return records.every(function (record, index) {
    return record.word.toUpperCase() === builtIn[index].label.toUpperCase();
  });
}

/* Row r holds every word's r-th syllable, in a fixed shifted order
   (so columns don't simply line up into whole words). */
function buildSyllableRows(records, syllableCount) {
  const rows = [];

  for (let r = 0; r < syllableCount; r++) {
    const row = [];
    for (let i = 0; i < records.length; i++) {
      row.push(records[(i + r) % records.length].syllables[r]);
    }
    rows.push(row);
  }

  return rows;
}


/* ==========================================================
   TEACHER VOICE (Step 5)
   A syllable button plays the teacher's recording of THAT word's
   syllable. Recordings are looked up through the saved word's
   current syllable (lower case), so an old recording can never
   play for a different syllable. No recording = no sound, no error.
   ========================================================== */
let syllablePlayer = null;
let audioUrls = [];

/* The recording for syllable `index` of this saved word, or null. */
function audioEntryFor(record, index) {
  const db = window.SukuKataDB;
  const key = db.syllableKey(record.syllables[index]);
  const entry = record.audio && key ? record.audio[key] : null;
  return db.isValidAudio(entry) ? entry : null;
}

/* Layout made by buildSyllableRows(): button (row r, column i) is the
   r-th syllable of records[(i + r) % n], so the match is exact. */
function buildAudioRowsShifted(records, syllableCount) {
  const rows = [];

  for (let r = 0; r < syllableCount; r++) {
    const row = [];
    for (let i = 0; i < records.length; i++) {
      row.push(audioEntryFor(records[(i + r) % records.length], r));
    }
    rows.push(row);
  }

  return rows;
}

/* Built-in layout kept as-is: match each button's text to a word that
   has that syllable in that row (each word is used once per row). */
function buildAudioRowsForLayout(syllableRows, records) {
  const db = window.SukuKataDB;

  return syllableRows.map(function (row, r) {
    const used = {};

    return row.map(function (text) {
      const key = db.syllableKey(text);
      const candidates = [];

      records.forEach(function (record, index) {
        if (!used[index] && db.syllableKey(record.syllables[r]) === key) {
          candidates.push(index);
        }
      });

      let chosen = candidates.find(function (index) {
        return audioEntryFor(records[index], r) !== null;
      });
      if (chosen === undefined) chosen = candidates[0];
      if (chosen === undefined) return null;

      used[chosen] = true;
      return audioEntryFor(records[chosen], r);
    });
  });
}

function countAudioClips(rows) {
  if (!rows) return 0;
  return rows.reduce(function (total, row) {
    return total + row.filter(Boolean).length;
  }, 0);
}

/* A temporary address for one recording (made on first use). */
function entryUrl(entry) {
  if (!entry.url) {
    entry.url = URL.createObjectURL(new Blob([entry.data], { type: entry.type }));
    audioUrls.push(entry.url);
  }
  return entry.url;
}

function releaseAudioUrls() {
  stopSyllableAudio();
  stopFeedbackAudio();
  audioUrls.forEach(function (url) { URL.revokeObjectURL(url); });
  audioUrls = [];
}

function stopSyllableAudio() {
  if (!syllablePlayer) return;
  try { syllablePlayer.pause(); } catch (error) { /* ignore */ }
}

/* Called when a syllable is tapped. Never throws. */
function playSyllableAudio(row, col) {
  try {
    const rows = game.level && game.level.syllableAudio;
    const entry = rows && rows[row] ? rows[row][col] : null;

    stopSyllableAudio();       // never let two syllables overlap
    stopFeedbackAudio();       // a tapped syllable cuts any feedback voice
    if (!entry) return;

    if (!syllablePlayer) syllablePlayer = new Audio();
    syllablePlayer.src = entryUrl(entry);

    const promise = syllablePlayer.play();
    if (promise && promise.catch) promise.catch(function () { /* ignore */ });
  } catch (error) {
    console.warn('[Student] Syllable audio could not be played.', error);
  }
}


/* ==========================================================
   TEACHER FEEDBACK VOICE (Step 6)
   Two GLOBAL teacher recordings: "Jawapan Betul" and "Jawapan Salah".
   Stored in IndexedDB as the special record "__feedback__".
   No recording = silent, no error; the visual feedback is unchanged.
   ========================================================== */
let feedbackClips = { correct: null, wrong: null };

/* ONE player is used for both the full-word recording and the global
   feedback recording, so these two can never overlap. `feedbackToken`
   changes on every stop, so a clip that was stopped (or replaced) can
   never trigger the next step of a sequence. */
let feedbackPlayer = null;
let feedbackToken = 0;

/* Stops the word / feedback voice and cancels any step still waiting. */
function stopFeedbackAudio() {
  feedbackToken++;
  if (!feedbackPlayer) return;
  feedbackPlayer.onended = null;
  feedbackPlayer.onerror = null;
  try { feedbackPlayer.pause(); } catch (error) { /* ignore */ }
}

/* Plays one recording; calls onFinish when it ends (or cannot play),
   unless it was stopped or replaced meanwhile. */
function startVoiceClip(entry, onFinish) {
  if (!feedbackPlayer) feedbackPlayer = new Audio();

  const token = feedbackToken;
  const done = function () {
    if (token !== feedbackToken) return;     // stopped or replaced
    feedbackPlayer.onended = null;
    feedbackPlayer.onerror = null;
    if (onFinish) onFinish();
  };

  feedbackPlayer.onended = done;
  feedbackPlayer.onerror = done;
  feedbackPlayer.src = entryUrl(entry);

  const promise = feedbackPlayer.play();
  if (promise && promise.catch) promise.catch(done);
}

/* kind: 'correct' | 'wrong'. No recording = silent, no error. Never throws. */
function playFeedbackAudio(kind) {
  try {
    stopSyllableAudio();       // never overlap with a syllable
    stopFeedbackAudio();       // ...or with the word recording

    const entry = feedbackClips[kind];
    if (!entry) return;

    startVoiceClip(entry, null);
  } catch (error) {
    console.warn('[Student] Feedback audio could not be played.', error);
  }
}

/* The teacher's full-word recording for this word (UPPERCASE), or null. */
function wordAudioFor(word) {
  const picture = allPictures(game.level).find(function (item) {
    return item.label.toUpperCase() === word;
  });
  return picture && picture.wordAudio ? picture.wordAudio : null;
}

/* Correct picture chosen:
     word recording -> (when it has finished) -> global "Jawapan Betul".
   No word recording: the global correct feedback plays straight away.
   Never throws. */
function playCorrectAnswerAudio(word) {
  try {
    stopSyllableAudio();
    stopFeedbackAudio();

    const entry = wordAudioFor(word);
    if (!entry) {
      playFeedbackAudio('correct');
      return;
    }

    startVoiceClip(entry, function () {
      playFeedbackAudio('correct');
    });
  } catch (error) {
    console.warn('[Student] Word audio could not be played.', error);
  }
}

/* Always resolves. */
function loadFeedbackClips() {
  const db = window.SukuKataDB;
  if (!db || typeof db.getFeedback !== 'function') return Promise.resolve();

  return db.getFeedback().then(function (clips) {
    feedbackClips = clips;
  }).catch(function (error) {
    console.warn('[Student] Feedback voice not loaded.', error);
  });
}


function applySavedContent(records) {
  let teacherImages = 0;
  let voiceClips = 0;

  releaseAudioUrls();   // old recordings are replaced by the freshly loaded ones

  Object.keys(LEVELS).forEach(function (levelId) {
    const level = LEVELS[levelId];
    const builtIn = cloneLevelContent(BUILT_IN[levelId]);

    const words = records.filter(function (record) {
      return String(record.level) === levelId && isUsableRecord(record, level.syllableCount);
    }).slice(0, MAX_WORDS_PER_LEVEL);

    // No saved words for this level: keep the built-in content (no voice).
    if (words.length === 0) {
      level.pictures = builtIn.pictures;
      level.syllableRows = builtIn.syllableRows;
      level.syllableAudio = null;
      return;
    }

    const pictures = words.map(function (record) {
      return toStudentPicture(levelId, record);
    });

    teacherImages += pictures.filter(function (picture) {
      return window.SukuKataDB.isPersistentImage(picture.image);
    }).length;

    const half = Math.ceil(pictures.length / 2);
    level.pictures = { left: pictures.slice(0, half), right: pictures.slice(half) };

    // Unchanged word list keeps the original syllable layout.
    const keepLayout = matchesBuiltInWords(levelId, words);
    level.syllableRows = keepLayout
      ? builtIn.syllableRows
      : buildSyllableRows(words, level.syllableCount);

    // Recordings follow the same layout, button by button.
    level.syllableAudio = keepLayout
      ? buildAudioRowsForLayout(level.syllableRows, words)
      : buildAudioRowsShifted(words, level.syllableCount);

    voiceClips += countAudioClips(level.syllableAudio);
  });

  console.info('[Student] Loaded saved content (' + teacherImages + ' teacher image(s), ' +
    voiceClips + ' voice button(s)).');
}

/* Always resolves; on any problem the built-in content is used. */
function loadSavedContent() {
  if (!window.SukuKataDB) return Promise.resolve();

  return window.SukuKataDB.getAllWords()
    .then(applySavedContent)
    .catch(function (error) {
      console.warn('[Student] Saved content not loaded, using built-in content.', error);
    })
    .then(loadFeedbackClips);   // teacher feedback voice (never rejects)
}

/* ---------- Init ---------- */
function init() {
  dom.levelGrid.addEventListener('click', function (event) {
    const card = event.target.closest('[data-level]');
    if (!card) return;
    openLevel(card.dataset.level);
  });

  dom.backButton.addEventListener('click', goHome);

  dom.doorToggles.forEach(function (toggle) {
    toggle.addEventListener('click', function () {
      toggleDoor(toggle.dataset.door);
    });
  });

  // Syllable buttons (one listener for the whole grid)
  dom.syllableGrid.addEventListener('click', function (event) {
    const button = event.target.closest('.syl');
    if (!button || button.disabled) return;
    handleSyllableTap(Number(button.dataset.row), Number(button.dataset.col));
  });

  // Picture cards on both doors
  [dom.pictures.left, dom.pictures.right].forEach(function (container) {
    container.addEventListener('click', function (event) {
      const card = event.target.closest('.picture-card');
      if (!card || card.disabled) return;
      handlePictureTap(card);
    });
  });

  dom.clearButton.addEventListener('click', function () {
    if (game.level && game.phase !== 'finished') clearPicks();
  });

  dom.feedbackAction.addEventListener('click', function () {
    if (game.level) startGame(game.level);
  });

  // Load the teacher's saved content BEFORE the first screen is shown,
  // so a level never starts with old pictures.
  loadSavedContent().then(function () {
    window.addEventListener('hashchange', function () {
      render(true);
    });
    render(false);
  });

  // The browser's Back button can restore an old copy of this page;
  // reload the saved content in that case.
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;
    loadSavedContent().then(function () {
      render(false);
    });
  });
}

init();