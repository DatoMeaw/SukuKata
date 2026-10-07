'use strict';

/* ==========================================================
   SUKU KATA — Teacher Mode: global feedback voice
   Two teacher recordings (Jawapan Betul / Jawapan Salah),
   made with the microphone (MediaRecorder). No TTS, no AI,
   no external service.

   Stored in the existing IndexedDB, in the special record
   "__feedback__" (see suku-kata-db.js), as ArrayBuffer + mime type.
   A recording is saved as soon as it is stopped.

   Reuses helpers from teacher.js (loaded before this file):
   getRecordingProblem, microphoneMessage, pickMimeType,
   normaliseAudioType, blobToArrayBuffer, releaseStream, showToast.
   ========================================================== */
(function () {
  const MAX_FEEDBACK_MS = 10000;
  const KINDS = ['correct', 'wrong'];
  const NAMES = { correct: 'Jawapan Betul', wrong: 'Jawapan Salah' };

  const clips = { correct: null, wrong: null };
  const boxes = {};
  let errorBox = null;

  /* The recording in progress, or null:
     { kind, phase: 'asking' | 'recording' | 'saving',
       mediaRecorder, stream, chunks, timer, mime } */
  let active = null;

  let player = null;
  let playerUrl = null;
  let playingKind = null;

  function db() { return window.SukuKataDB; }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  function clearError() {
    errorBox.textContent = '';
    errorBox.hidden = true;
  }

  /* ---------- Controls ---------- */
  function button(label, action, kind, variant, disabled) {
    const node = document.createElement('button');
    node.type = 'button';
    node.className = 't-btn voice-btn ' + variant;
    node.textContent = label;
    node.dataset.fbVoice = action;
    node.dataset.kind = kind;
    node.disabled = Boolean(disabled);
    return node;
  }

  function refresh() {
    KINDS.forEach(function (kind) {
      const box = boxes[kind];
      if (!box) return;

      const mine = Boolean(active && active.kind === kind);
      const otherBusy = Boolean(active && !mine);
      const hasClip = Boolean(clips[kind]);
      const isPlaying = playingKind === kind;

      const status = document.createElement('p');
      status.className = 'voice-status';
      const buttons = document.createElement('div');
      buttons.className = 'voice-buttons';
      let state;

      if (mine && active.phase === 'asking') {
        state = 'asking';
        status.textContent = 'Menunggu kebenaran mikrofon…';
      } else if (mine && active.phase === 'recording') {
        state = 'recording';
        status.textContent = '🔴 Merakam…';
        buttons.appendChild(button('⏹ Berhenti', 'stop', kind, 't-btn--danger-solid', false));
      } else if (mine) {
        state = 'saving';
        status.textContent = 'Menyimpan rakaman…';
      } else if (hasClip) {
        state = isPlaying ? 'playing' : 'recorded';
        status.textContent = isPlaying ? '🔊 Sedang dimainkan…' : '✓ Sudah dirakam';
        buttons.appendChild(button(
          isPlaying ? '⏹ Henti' : '▶ Dengar',
          isPlaying ? 'pause' : 'play', kind, 't-btn--ghost', otherBusy
        ));
        buttons.appendChild(button('🔄 Rakam Semula', 'record', kind, 't-btn--primary', otherBusy));
      } else {
        state = 'empty';
        status.textContent = 'Belum dirakam';
        buttons.appendChild(button('🎙️ Rakam', 'record', kind, 't-btn--primary', otherBusy));
      }

      box.dataset.state = state;
      box.textContent = '';
      box.appendChild(status);
      if (buttons.children.length > 0) box.appendChild(buttons);
    });
  }

  /* ---------- Recording ---------- */
  function startRecording(kind) {
    if (active) return;

    const problem = getRecordingProblem();
    if (problem) {
      showError(problem);
      return;
    }

    stopPlayback();
    clearError();

    const session = {
      kind: kind,
      phase: 'asking',
      mediaRecorder: null,
      stream: null,
      chunks: [],
      timer: null,
      mime: ''
    };
    active = session;
    refresh();

    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (active !== session) {            // page left while asking permission
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
        if (active !== session) return;
        releaseStream(session);
        active = null;
        refresh();
        showError('Rakaman terhenti. Sila cuba lagi.');
      });

      mediaRecorder.start();
      session.phase = 'recording';
      session.timer = setTimeout(stopRecording, MAX_FEEDBACK_MS);
      refresh();
    }).catch(function (error) {
      releaseStream(session);
      if (active === session) active = null;
      refresh();
      showError(microphoneMessage(error));
    });
  }

  function stopRecording() {
    const session = active;
    if (!session || session.phase !== 'recording') return;

    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }

    try {
      if (session.mediaRecorder && session.mediaRecorder.state !== 'inactive') {
        session.mediaRecorder.stop();      // fires 'stop' -> finishRecording
      } else {
        finishRecording(session);
      }
    } catch (error) {
      finishRecording(session);
    }
  }

  function finishRecording(session) {
    releaseStream(session);
    if (active !== session || session.phase === 'saving') return;

    session.phase = 'saving';
    refresh();

    const type = normaliseAudioType(
      (session.mediaRecorder && session.mediaRecorder.mimeType) || session.mime
    );
    const blob = new Blob(session.chunks, { type: type });

    if (blob.size === 0) {
      active = null;
      refresh();
      showError('Tiada suara dirakam. Sila cuba lagi.');
      return;
    }

    blobToArrayBuffer(blob).then(function (buffer) {
      const entry = { type: type, data: buffer };
      return db().saveFeedbackClip(session.kind, entry).then(function () {
        return entry;
      });
    }).then(function (entry) {
      clips[session.kind] = entry;         // replaces the old recording
      active = null;
      refresh();
      showToast('"' + NAMES[session.kind] + '" disimpan.');
    }).catch(function (error) {
      console.error('[Teacher] Feedback save failed', error);
      active = null;                       // the previous recording is kept
      refresh();
      showError('Rakaman tidak dapat disimpan. Sila cuba lagi.');
    });
  }

  /* ---------- Listening ---------- */
  function playClip(kind) {
    const entry = clips[kind];
    if (!entry || active) return;

    const wasPlaying = playingKind === kind;
    stopPlayback();
    if (wasPlaying) return;

    const url = URL.createObjectURL(new Blob([entry.data], { type: entry.type }));
    const audio = new Audio(url);

    player = audio;
    playerUrl = url;
    playingKind = kind;

    audio.addEventListener('ended', function () {
      if (player === audio) stopPlayback();
    });
    audio.addEventListener('error', function () {
      if (player !== audio) return;
      stopPlayback();
      showError('Rakaman tidak dapat dimainkan. Sila rakam semula.');
    });

    const promise = audio.play();
    if (promise && promise.catch) {
      promise.catch(function () {
        if (player !== audio) return;
        stopPlayback();
        showError('Rakaman tidak dapat dimainkan. Sila rakam semula.');
      });
    }

    refresh();
  }

  function stopPlayback() {
    const audio = player;
    const url = playerUrl;
    const wasPlaying = playingKind !== null;

    player = null;
    playerUrl = null;
    playingKind = null;

    if (audio) {
      try { audio.pause(); } catch (error) { /* ignore */ }
    }
    if (url) URL.revokeObjectURL(url);
    if (wasPlaying) refresh();
  }

  /* Leaving the page: drop any recording in progress (nothing is saved). */
  function abortAll() {
    const session = active;
    active = null;                         // so finishRecording() ignores it

    if (session) {
      if (session.timer) clearTimeout(session.timer);
      try {
        if (session.mediaRecorder && session.mediaRecorder.state !== 'inactive') {
          session.mediaRecorder.stop();
        }
      } catch (error) { /* ignore */ }
      releaseStream(session);
    }

    stopPlayback();
  }

  /* ---------- Init ---------- */
  function init() {
    const section = document.getElementById('feedback-section');
    errorBox = document.getElementById('feedback-error');
    if (!section || !errorBox) return;

    KINDS.forEach(function (kind) {
      boxes[kind] = document.getElementById('feedback-controls-' + kind);
    });

    section.addEventListener('click', function (event) {
      const target = event.target.closest('[data-fb-voice]');
      if (!target || target.disabled) return;

      const kind = target.dataset.kind;
      const action = target.dataset.fbVoice;

      if (action === 'record') startRecording(kind);
      if (action === 'stop') stopRecording();
      if (action === 'play') playClip(kind);
      if (action === 'pause') stopPlayback();
    });

    window.addEventListener('pagehide', abortAll);

    refresh();

    if (!db() || typeof db().getFeedback !== 'function') {
      showError('suku-kata-db.js tidak dimuatkan.');
      return;
    }

    db().getFeedback().then(function (saved) {
      clips.correct = saved.correct;
      clips.wrong = saved.wrong;
      refresh();
    }).catch(function (error) {
      console.error('[Teacher] Could not load feedback voice', error);
      showError('Tidak dapat membuka rakaman maklum balas.');
    });
  }

  init();
})();