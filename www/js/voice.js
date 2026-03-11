/*
 * voice.js
 * Voice note recording, playback, send;
 * speech-to-text and text-to-speech.
 * XamePage v2.1
 *
 * Depends on: state.js, utils.js, ui.js, messaging.js (sendFile),
 *             audio.js (notifyWithFeedback)
 */

//  Reset voice recorder UI 
function resetVoiceRecorderUI() {
  if (messageInput)     messageInput.classList.remove('hidden');
  if (attachBtn)        attachBtn.classList.remove('hidden');
  if (voiceNoteControl) voiceNoteControl.classList.add('hidden');
  if (recordBtn)        recordBtn.classList.remove('hidden');
  if (stopRecordBtn)    stopRecordBtn.classList.add('hidden');
  if (playBtn)          playBtn.classList.add('hidden');
  if (sendVoiceBtn)     sendVoiceBtn.classList.add('hidden');
  updateComposerButtons();
}

//  Mic button: enter voice recording mode 
micBtn?.addEventListener('click', () => {
  console.log(' Voice note mode activated');
  messageInput?.classList.add('hidden');
  sendBtn?.classList.add('hidden');
  attachBtn?.classList.add('hidden');
  voiceNoteControl?.classList.remove('hidden');
  if (recordBtn)     recordBtn.classList.remove("hidden");
  if (stopRecordBtn) stopRecordBtn.classList.add("hidden");
  if (playBtn)       playBtn.classList.add("hidden");
  if (sendVoiceBtn)  sendVoiceBtn.classList.add("hidden");
});

//  Record 
recordBtn?.addEventListener('click', async () => {
  try {
    console.log(' Starting audio recording...');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const mimeTypes = [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/webm',
      'audio/mp4',
      '',
    ];
    const mimeType = mimeTypes.find(t => t === '' || MediaRecorder.isTypeSupported(t));
    console.log(' Using MIME type:', mimeType || 'browser default');

    const options  = mimeType ? { mimeType } : {};
    mediaRecorder  = new MediaRecorder(stream, options);
    RESOURCES.mediaRecorders.push(mediaRecorder);

    audioChunks = [];
    audioBlob   = null;

    recordBtn?.classList.add('hidden');
    stopRecordBtn?.classList.remove('hidden');

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        console.log(' Audio data chunk:', event.data.size, 'bytes');
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = () => {
      console.log(' Recording stopped. Total chunks:', audioChunks.length);
      if (audioChunks.length > 0) {
        audioBlob = new Blob(audioChunks, { type: mimeType || 'audio/webm' });
        console.log(' Audio Blob created:', audioBlob.size, 'bytes, type:', audioBlob.type);
        if (audioBlob.size > 0) {
          playBtn?.classList.remove('hidden');
          sendVoiceBtn?.classList.remove('hidden');
          stopRecordBtn?.classList.add('hidden');
        } else {
          console.error(' Audio Blob is empty');
          showNotification('Recording failed. Please try again.'); resetVoiceRecorderUI();
        }
      } else {
        console.error(' No audio chunks recorded');
        showNotification('No audio was captured. Please try again.'); resetVoiceRecorderUI();
      }
      stream.getTracks().forEach(t => t.stop());
    };

    mediaRecorder.start();
    console.log(' Recording started...');

  } catch (err) {
    console.error(" Recording failed:", err.name, err.message, err);
    showNotification("Recording error: " + (err.name || err.message || "unknown"))');
    resetVoiceRecorderUI();
  }
});

//  Stop recording 
stopRecordBtn?.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    console.log(' Stopping recording...'); mediaRecorder.stop();
  }
});

//  Playback 
playBtn?.addEventListener('click', () => {
  if (!audioBlob) return;
  console.log(' Playing recorded audio...');
  const audioUrl = URL.createObjectURL(audioBlob);
  const audio    = new Audio(audioUrl);
  audio.play();
  audio.onended  = () => URL.revokeObjectURL(audioUrl);
  audio.onerror  = () => { showNotification('Failed to play audio'); URL.revokeObjectURL(audioUrl); };
});

//  Send voice note 
sendVoiceBtn?.addEventListener('click', () => {
  if (audioBlob && audioBlob.size > 0) {
    console.log(' Sending voice note...');
    let extension = 'webm';
    if (audioBlob.type.includes('mp4'))  extension = 'mp4';
    else if (audioBlob.type.includes('ogg'))  extension = 'ogg';
    else if (audioBlob.type.includes('mpeg')) extension = 'mp3';

    const audioFile = new File([audioBlob], `voicenote-${Date.now()}.${extension}`, { type: audioBlob.type });
    sendFile(audioFile);
    resetVoiceRecorderUI();
    audioBlob   = null;
    audioChunks = [];
  } else {
    console.error(' Cannot send empty audio blob');
    showNotification('No audio to send. Please record again.'); resetVoiceRecorderUI();
  }
});

//  Speech-to-text button 
const speechToTextBtn  = document.createElement('button');
speechToTextBtn.className = 'icon-btn voice-text-btn';
speechToTextBtn.innerHTML = '&#127908;';
speechToTextBtn.title     = 'Voice to text';

speechToTextBtn.addEventListener('click', () => {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    return showNotification('Your browser does not support Speech Recognition.');
  }
  if (speechRecognizer && speechRecognizer.running) { speechRecognizer.stop(); return; }

  const SR      = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechRecognizer            = new SR();
  speechRecognizer.continuous = false;
  speechRecognizer.interimResults = false;
  speechRecognizer.lang       = 'en-US';

  speechRecognizer.onstart = () => {
    speechToTextBtn.innerHTML = '&#127908;';
    if (messageInput) messageInput.placeholder = 'Listening...';
  };
  speechRecognizer.onend = () => {
    speechToTextBtn.innerHTML = '&#127908;';
    if (messageInput) messageInput.placeholder = 'Type a message...';
  };
  speechRecognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    if (messageInput) { messageInput.value = transcript; messageInput.focus(); updateComposerButtons(); }
  };
  speechRecognizer.onerror = (event) => {
    console.error('Speech recognition error:', event.error);
    speechToTextBtn.innerHTML = '&#127908;';
    if (messageInput) messageInput.placeholder = 'Type a message...';
    showNotification('Error with voice input. Try again.');
  };

  try { speechRecognizer.start(); }
  catch (error) { console.error('Failed to start speech recognition:', error); showNotification('Failed to start voice input'); }
});

if (composer && messageInput) {
  composer.insertBefore(speechToTextBtn, messageInput.nextSibling);
}

//  Text-to-speech 
function textToVoice(text) {
  if (!('speechSynthesis' in window)) {
    return showNotification('Your browser does not support Text-to-Speech.');
  }
  try {
    speechSynthesis.cancel();
    const utterance       = new SpeechSynthesisUtterance(text);
    utterance.rate        = 1.0;
    utterance.pitch       = 1.0;
    utterance.volume      = 1.0;
    utterance.onerror     = (event) => { console.error('Speech synthesis error:', event); showNotification('Failed to speak text'); };
    speechSynthesis.speak(utterance);
  } catch (error) {
    console.error('Text-to-speech error:', error);
    showNotification('Failed to speak text');
  }
}
