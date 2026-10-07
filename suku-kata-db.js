'use strict';

/* ==========================================================
   SUKU KATA — Shared storage (IndexedDB)
   Used by Teacher Mode (teacher.js) and Student Mode (script.js).

   Word record:
   {
     id:         "w123",
     level:      2,
     word:       "Bibir",
     syllables:  ["Bi", "bir"],
     emoji:      "👄",
     image:      "data:image/jpeg;base64,...",  // teacher image, or null
     defaultKey: "Bibir",  // built-in word it started from (fallback image)
     order:      1,
     audio:      {                              // teacher voice, or null
       "bi":  { type: "audio/webm;codecs=opus", data: ArrayBuffer },
       "bir": { type: "audio/webm;codecs=opus", data: ArrayBuffer }
     }
   }

   `image` only ever holds real image data (a data URL).
   Built-in images/xxx.png paths are never stored — they are fallbacks.

   `audio` is keyed by the syllable in lower case (see syllableKey()).
   Only syllables the word currently has can keep a recording.
   Old records without `audio` keep working (audio is simply null).

   `wordAudio` (optional, per word) is the teacher's recording of the
   FULL word:  { type: "audio/...", data: ArrayBuffer, key: "jaguar" }
   `key` is the word in lower case (see wordKey()). It is only valid
   while the record's word still matches that key, so a recording can
   never play for a different word. Old records without `wordAudio`
   keep working (it is simply null).

   Special (non-word) records in the same store:
     "__meta__"     { id, seeded: true }
     "__feedback__" { id, correct: {type, data}, wrong: {type, data} }
     "__settings__" { id, teacherPin: "0000" }   // local Teacher Mode lock
   None of them is ever returned by getAllWords().
   ========================================================== */
(function () {
  const DB_NAME = 'suku-kata-content';
  const DB_VERSION = 1; // unchanged: `audio` is just one more field on a record
  const STORE = 'words';
  const META_ID = '__meta__';
  const FEEDBACK_ID = '__feedback__'; // global teacher feedback voice (NOT a word)
  const SETTINGS_ID = '__settings__'; // small settings, e.g. the Teacher Mode PIN (NOT a word)
  const DEFAULT_TEACHER_PIN = '0000'; // used until the teacher saves a different PIN

  let dbPromise = null;

  function openDatabase() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function () {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };

      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });

    return dbPromise;
  }

  /* Runs one transaction and resolves when it has fully completed. */
  function transaction(mode, work) {
    return openDatabase().then(function (db) {
      return new Promise(function (resolve, reject) {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));

        tx.oncomplete = function () { resolve(request ? request.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error || new Error('Transaction aborted.')); };
      });
    });
  }

  function isPersistentImage(value) {
    return typeof value === 'string' && value.indexOf('data:image/') === 0;
  }

  /* "Ba " -> "ba". The same key is used when saving and when playing,
     so a recording only ever matches the exact syllable it was made for. */
  function syllableKey(text) {
    return String(text == null ? '' : text).trim().toLowerCase();
  }

  /* One recording: { type: "audio/...", data: ArrayBuffer (not empty) } */
  function isValidAudio(entry) {
    return Boolean(entry) &&
      typeof entry.type === 'string' && entry.type.indexOf('audio/') === 0 &&
      entry.data instanceof ArrayBuffer && entry.data.byteLength > 0;
  }

  /* Keeps only recordings that belong to the word's CURRENT syllables.
     Returns null when nothing is left. */
  function cleanAudio(audio, syllables) {
    if (!audio || typeof audio !== 'object') return null;

    const keep = {};
    let count = 0;

    syllables.forEach(function (syllable) {
      const key = syllableKey(syllable);
      if (key && !keep[key] && isValidAudio(audio[key])) {
        keep[key] = { type: audio[key].type, data: audio[key].data };
        count++;
      }
    });

    return count > 0 ? keep : null;
  }

  /* "Jaguar" -> "jaguar" (no spaces, lower case). */
  function wordKey(text) {
    return syllableKey(String(text == null ? '' : text).replace(/\s+/g, ''));
  }

  /* The full-word recording, kept only while it still belongs to `word`.
     Returns { type, data, key } or null. */
  function cleanWordAudio(entry, word) {
    if (!isValidAudio(entry)) return null;

    const key = wordKey(word);
    if (!key || entry.key !== key) return null;

    return { type: entry.type, data: entry.data, key: key };
  }

  /* Student Mode: the valid full-word recording of a saved word, or null. */
  function wordAudioOf(record) {
    return record ? cleanWordAudio(record.wordAudio, record.word) : null;
  }

  /* Normalises a record and refuses anything that is not real image data
     (blob: URLs, file names, images/xxx.png paths ...). */
  function cleanRecord(record) {
    if (record.image != null && !isPersistentImage(record.image)) {
      throw new Error('Only image data (data:image/...) can be saved as a word image.');
    }

    return {
      id: String(record.id),
      level: Number(record.level),
      word: record.word,
      syllables: record.syllables.slice(),
      emoji: record.emoji || '',
      image: record.image || null,
      defaultKey: record.defaultKey || null,
      order: Number(record.order) || 0,
      audio: cleanAudio(record.audio, record.syllables),
      wordAudio: cleanWordAudio(record.wordAudio, record.word)
    };
  }

  function getAllWords() {
    return transaction('readonly', function (store) {
      return store.getAll();
    }).then(function (records) {
      return (records || [])
        .filter(function (record) {
          return record.id !== META_ID && record.id !== FEEDBACK_ID &&
                 record.id !== SETTINGS_ID;
        })
        .sort(function (a, b) { return (a.level - b.level) || (a.order - b.order); });
    });
  }

  function saveWord(record) {
    let clean;
    try {
      clean = cleanRecord(record);
    } catch (error) {
      return Promise.reject(error);
    }

    return transaction('readwrite', function (store) {
      return store.put(clean);
    });
  }

  function saveWords(records) {
    let clean;
    try {
      clean = records.map(cleanRecord);
    } catch (error) {
      return Promise.reject(error);
    }

    return transaction('readwrite', function (store) {
      clean.forEach(function (record) { store.put(record); });
      return null;
    });
  }

  function deleteWord(id) {
    return transaction('readwrite', function (store) {
      return store.delete(String(id));
    });
  }

  /* Remembers that the built-in words were copied in once,
     so deleting every word does not bring the defaults back. */
  function isSeeded() {
    return transaction('readonly', function (store) {
      return store.get(META_ID);
    }).then(function (meta) {
      return Boolean(meta && meta.seeded);
    });
  }

  function markSeeded() {
    return transaction('readwrite', function (store) {
      return store.put({ id: META_ID, seeded: true });
    });
  }

  /* ---------- Global feedback voice ----------
     One special record in the same store:
     { id: "__feedback__", correct: {type, data}, wrong: {type, data} }
     getAllWords() never returns it, so it is never a vocabulary word. */
  function getFeedback() {
    return transaction('readonly', function (store) {
      return store.get(FEEDBACK_ID);
    }).then(function (record) {
      const result = { correct: null, wrong: null };
      if (record) {
        ['correct', 'wrong'].forEach(function (kind) {
          if (isValidAudio(record[kind])) {
            result[kind] = { type: record[kind].type, data: record[kind].data };
          }
        });
      }
      return result;
    });
  }

  /* kind: 'correct' | 'wrong'. Replaces that clip, keeps the other one. */
  function saveFeedbackClip(kind, entry) {
    if (kind !== 'correct' && kind !== 'wrong') {
      return Promise.reject(new Error('Unknown feedback kind.'));
    }
    if (!isValidAudio(entry)) {
      return Promise.reject(new Error('Invalid feedback recording.'));
    }

    return transaction('readwrite', function (store) {
      const read = store.get(FEEDBACK_ID);
      read.onsuccess = function () {
        const record = read.result || { id: FEEDBACK_ID, correct: null, wrong: null };
        record[kind] = { type: entry.type, data: entry.data };
        store.put(record);
      };
      return null;
    });
  }

  /* ---------- Teacher Mode PIN ----------
     A local convenience lock (not real security). The PIN lives in the
     special "__settings__" record; with no saved PIN, "0000" is used.
     The PIN is never returned to the pages: they can only ask
     "is this the PIN?" or change it. */
  function isValidPin(value) {
    return typeof value === 'string' && /^\d{4}$/.test(value);
  }

  function activePin(record) {
    return record && isValidPin(record.teacherPin) ? record.teacherPin : DEFAULT_TEACHER_PIN;
  }

  /* Resolves true when `pin` is the active PIN. */
  function verifyTeacherPin(pin) {
    return transaction('readonly', function (store) {
      return store.get(SETTINGS_ID);
    }).then(function (record) {
      return isValidPin(pin) && pin === activePin(record);
    });
  }

  /* Resolves 'ok' (new PIN saved), 'wrong-current' or 'invalid-new'.
     The check and the save happen in one transaction. */
  function changeTeacherPin(currentPin, newPin) {
    if (!isValidPin(newPin)) return Promise.resolve('invalid-new');

    let outcome = 'wrong-current';

    return transaction('readwrite', function (store) {
      const read = store.get(SETTINGS_ID);
      read.onsuccess = function () {
        const record = read.result || { id: SETTINGS_ID };
        if (!isValidPin(currentPin) || currentPin !== activePin(record)) return;

        record.teacherPin = newPin;
        store.put(record);
        outcome = 'ok';
      };
      return null;
    }).then(function () {
      return outcome;
    });
  }

  window.SukuKataDB = {
    getAllWords: getAllWords,
    saveWord: saveWord,
    saveWords: saveWords,
    deleteWord: deleteWord,
    isSeeded: isSeeded,
    markSeeded: markSeeded,
    isPersistentImage: isPersistentImage,
    syllableKey: syllableKey,
    isValidAudio: isValidAudio,
    getFeedback: getFeedback,
    saveFeedbackClip: saveFeedbackClip,
    wordKey: wordKey,
    wordAudioOf: wordAudioOf,
    verifyTeacherPin: verifyTeacherPin,
    changeTeacherPin: changeTeacherPin
  };
})();