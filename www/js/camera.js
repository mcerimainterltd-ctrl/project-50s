/*
 * camera.js
 * In-app camera modal: photo capture, video recording,
 * camera switch, size-mode toggle, send media.
 * Includes: Flash Control & Self-Timer (3s/5s/10s).
 * XamePage v2.1
 * Uses @capacitor-community/camera-preview on APK,
 * falls back to getUserMedia on PWA/browser.
 */

let cameraTimerInterval = null;
let recordingInterval = null;
let selectedTimer = 0;
let isFlashOn = false;
let isNativeCamera = false;
let nativeCameraRecording = false;

function isNativePlatform() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

function getCameraPreviewPlugin() {
  return window.Capacitor?.Plugins?.CameraPreview;
}

function initCameraFunctionality() {
  createCameraModal();
  setupCameraButton();
}

function createCameraModal() {
  cameraModal = document.createElement('div');
  cameraModal.className = 'camera-modal hidden';
  cameraModal.innerHTML = `
    <div class="camera-modal-content" style="background: rgba(18, 18, 18, 0.9); backdrop-filter: blur(20px); border: 1px solid rgba(255,255,255,0.1); border-radius: 24px; overflow: hidden; position: relative;">
      
      <div class="camera-header" style="padding: 15px 20px; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.2);">
        <div style="display: flex; gap: 12px; align-items: center;">
          <button id="camera-flash-btn" class="ctrl-icon-btn" title="Toggle Flash" style="background: none; border: none; color: white; cursor: pointer; padding: 5px;">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 L3 14 L12 14 L11 22 L21 10 L12 10 Z"/></svg>
          </button>
          <select id="camera-timer-select" style="background: rgba(255,255,255,0.1); color: white; border: none; border-radius: 8px; font-size: 12px; padding: 4px 8px; outline: none;">
            <option value="0">Timer Off</option>
            <option value="3">3s</option>
            <option value="5">5s</option>
            <option value="10">10s</option>
          </select>
        </div>

        <div class="camera-header-controls" style="display: flex; align-items: center; gap: 12px;">
          <div class="screen-size-toggle" style="background: rgba(255,255,255,0.05); padding: 4px; border-radius: 12px; display: flex;">
            <button class="size-toggle-btn" data-mode="thumbnail" style="padding: 5px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15h18"/></svg></button>
            <button class="size-toggle-btn" data-mode="halfscreen" style="padding: 5px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/></svg></button>
            <button class="size-toggle-btn" data-mode="fullscreen" style="padding: 5px;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button>
          </div>
          <button class="close-camera" style="background: rgba(255,255,255,0.1); border: none; color: white; width: 30px; height: 30px; border-radius: 50%; cursor: pointer;">&times;</button>
        </div>
      </div>

      <div class="camera-preview" style="position: relative; background: transparent; min-height: 300px;">
        <video id="camera-video" autoplay playsinline muted style="width: 100%; display: block;"></video>
        <canvas id="camera-canvas" style="display:none;"></canvas>
        
        <div id="camera-countdown-display" style="display:none; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: white; font-size: 80px; font-weight: bold; text-shadow: 0 0 20px rgba(0,0,0,0.5); z-index: 10;"></div>
        
        <div class="recording-timer" id="recordingTimer" style="display:none; position: absolute; top: 15px; left: 50%; transform: translateX(-50%); background: rgba(255, 0, 0, 0.8); padding: 4px 12px; border-radius: 20px; color: white; align-items: center; gap: 6px; font-size: 14px; font-weight: bold;">
          <span style="width: 8px; height: 8px; background: white; border-radius: 50%; animation: pulse 1s infinite;"></span>
          <span id="timerDisplay">00:00</span>
        </div>
      </div>

      <div class="camera-controls" style="padding: 30px 20px; background: rgba(0,0,0,0.4);">
        <div class="camera-primary-controls" style="display: flex; justify-content: space-around; align-items: center;">
          <button id="camera-switch-camera" class="camera-btn" style="background: rgba(255,255,255,0.1); border: none; color: white; padding: 12px; border-radius: 50%; cursor: pointer;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 7V3h-4M3 17v4h4M21 3l-5 5M3 21l5-5M15 13l6 6M9 11l-6-6"/></svg>
          </button>
          
          <button id="camera-capture-btn" class="camera-btn" style="background: white; border: 6px solid rgba(255,255,255,0.3); width: 65px; height: 65px; border-radius: 50%; cursor: pointer;">
            <div style="width:100%; height:100%; border:2px solid black; border-radius:50%;"></div>
          </button>
          
          <button id="camera-start-recording" class="camera-btn" style="background: rgba(255,255,255,0.1); border: none; color: #ff4444; padding: 12px; border-radius: 50%; cursor: pointer;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10"/></svg>
          </button>

          <button id="camera-stop-recording" class="camera-btn" disabled style="display: none; background: #ff4444; border: none; color: white; padding: 12px; border-radius: 50%; cursor: pointer;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
        </div>
      </div>

      <div class="camera-preview-area" style="display:none; flex-direction: column; padding: 20px; background: #121212;">
        <img id="camera-preview-image" style="max-width:100%; border-radius: 15px; display:none;">
        <video id="camera-preview-video" controls style="max-width:100%; border-radius: 15px; display:none;"></video>
        <div style="display: flex; gap: 10px; margin-top: 20px;">
          <button id="camera-retake-media" style="flex:1; padding: 12px; border-radius: 12px; border: 1px solid white; background: transparent; color: white;">Retake</button>
          <button id="camera-send-media" style="flex:2; padding: 12px; border-radius: 12px; background: #007aff; color: white; border: none; font-weight: bold;">Send</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(cameraModal);

  cameraVideoElement = document.getElementById('camera-video');
  cameraCanvasElement = document.getElementById('camera-canvas');
  cameraCaptureBtn = document.getElementById('camera-capture-btn');
  cameraStartRecordingBtn = document.getElementById('camera-start-recording');
  cameraStopRecordingBtn = document.getElementById('camera-stop-recording');
  cameraCloseBtn = document.querySelector('.close-camera');
  cameraSwitchBtn = document.getElementById('camera-switch-camera');
  
  document.getElementById('camera-flash-btn').addEventListener('click', toggleFlash);
  document.getElementById('camera-timer-select').addEventListener('change', (e) => selectedTimer = parseInt(e.target.value));
  cameraCloseBtn.addEventListener('click', closeCamera);
  cameraCaptureBtn.addEventListener('click', handleCaptureWithTimer);
  cameraStartRecordingBtn.addEventListener('click', startCameraRecording);
  cameraStopRecordingBtn.addEventListener('click', stopCameraRecording);
  cameraSwitchBtn.addEventListener('click', switchCamera);
  document.getElementById('camera-send-media').addEventListener('click', sendCameraMedia);
  document.getElementById('camera-retake-media').addEventListener('click', retakeCameraMedia);

  document.querySelectorAll('.size-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => setCameraMode(btn.dataset.mode));
  });
}

async function toggleFlash() {
  const CameraPreview = getCameraPreviewPlugin();
  if (isNativeCamera && CameraPreview) {
    isFlashOn = !isFlashOn;
    try {
      await CameraPreview.setFlashMode({ flashMode: isFlashOn ? 'on' : 'off' });
      document.getElementById('camera-flash-btn').style.color = isFlashOn ? '#ffcc00' : 'white';
    } catch(e) { console.error('Flash error:', e); }
    return;
  }
  if (!cameraStream) return;
  const track = cameraStream.getVideoTracks()[0];
  const caps = track.getCapabilities();
  if (!caps.torch) { alert("Flash not supported on this device."); return; }
  isFlashOn = !isFlashOn;
  try {
    await track.applyConstraints({ advanced: [{ torch: isFlashOn }] });
    document.getElementById('camera-flash-btn').style.color = isFlashOn ? '#ffcc00' : 'white';
  } catch (e) { console.error("Flash error:", e); }
}

function handleCaptureWithTimer() {
  if (selectedTimer === 0) { capturePhoto(); return; }
  const display = document.getElementById('camera-countdown-display');
  let timeLeft = selectedTimer;
  display.innerText = timeLeft;
  display.style.display = 'block';
  cameraCaptureBtn.disabled = true;

  cameraTimerInterval = setInterval(() => {
    timeLeft--;
    if (timeLeft <= 0) {
      clearInterval(cameraTimerInterval);
      display.style.display = 'none';
      cameraCaptureBtn.disabled = false;
      capturePhoto();
    } else { display.innerText = timeLeft; }
  }, 1000);
}

async function startCameraRecording() {
  const CameraPreview = getCameraPreviewPlugin();
  if (isNativeCamera && CameraPreview) {
    try {
      await CameraPreview.startRecordVideo({});
      nativeCameraRecording = true;
      let seconds = 0;
      const timerDisplay = document.getElementById('timerDisplay');
      timerDisplay.textContent = "00:00";
      recordingInterval = setInterval(() => {
        seconds++;
        const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
        const secs = (seconds % 60).toString().padStart(2, '0');
        if (timerDisplay) timerDisplay.textContent = `${mins}:${secs}`;
      }, 1000);
      document.getElementById('recordingTimer').style.display = 'flex';
      cameraStartRecordingBtn.style.display = 'none';
      cameraStopRecordingBtn.style.display = 'block';
      cameraStopRecordingBtn.disabled = false;
    } catch(e) { console.error('Native recording error:', e); }
    return;
  }

  cameraRecordedChunks = [];
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  cameraMediaRecorder = new MediaRecorder(stream);
  
  let seconds = 0;
  const timerDisplay = document.getElementById('timerDisplay');
  timerDisplay.textContent = "00:00";
  recordingInterval = setInterval(() => {
    seconds++;
    const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    if (timerDisplay) timerDisplay.textContent = `${mins}:${secs}`;
  }, 1000);

  cameraMediaRecorder.ondataavailable = (e) => cameraRecordedChunks.push(e.data);
  cameraMediaRecorder.onstop = () => {
    clearInterval(recordingInterval);
    showCameraPreview('video', new Blob(cameraRecordedChunks, { type: 'video/webm' }));
    stream.getTracks().forEach(t => t.stop());
  };
  
  cameraMediaRecorder.start();
  document.getElementById('recordingTimer').style.display = 'flex';
  cameraStartRecordingBtn.style.display = 'none';
  cameraStopRecordingBtn.style.display = 'block';
  cameraStopRecordingBtn.disabled = false;
}

async function stopCameraRecording() {
  const CameraPreview = getCameraPreviewPlugin();
  if (isNativeCamera && CameraPreview && nativeCameraRecording) {
    try {
      clearInterval(recordingInterval);
      const result = await CameraPreview.stopRecordVideo();
      nativeCameraRecording = false;
      document.getElementById('recordingTimer').style.display = 'none';
      cameraStartRecordingBtn.style.display = 'block';
      cameraStopRecordingBtn.style.display = 'none';
      if (result && result.videoFilePath) {
        const response = await fetch(result.videoFilePath);
        const blob = await response.blob();
        showCameraPreview('video', blob);
      }
    } catch(e) { console.error('Stop recording error:', e); }
    return;
  }
  cameraMediaRecorder?.stop();
  document.getElementById('recordingTimer').style.display = 'none';
  cameraStartRecordingBtn.style.display = 'block';
  cameraStopRecordingBtn.style.display = 'none';
}

function setupCameraButton() {
  const cameraBtn = document.getElementById('camera-btn');
  if (cameraBtn) cameraBtn.addEventListener('click', openCamera);
}

function setCameraMode(mode) {
  currentCameraMode = mode;
  cameraModal.classList.remove('fullscreen', 'halfscreen', 'thumbnail');
  cameraModal.classList.add(mode);
  if (isNativeCamera) updateNativeCameraSize(mode);
}

function updateNativeCameraSize(mode) {
  const CameraPreview = getCameraPreviewPlugin();
  if (!CameraPreview) return;
  const modalRect = cameraModal.querySelector('.camera-preview').getBoundingClientRect();
  CameraPreview.startCamera({
    position: currentFacingMode === 'user' ? 'front' : 'rear',
    toBack: true,
    x: Math.round(modalRect.left),
    y: Math.round(modalRect.top),
    width: Math.round(modalRect.width),
    height: Math.round(modalRect.height),
  }).catch(() => {});
}

async function openCamera() {
  if (cameraModal) cameraModal.classList.remove('hidden');

  const CameraPreview = getCameraPreviewPlugin();
  if (isNativePlatform() && CameraPreview) {
    isNativeCamera = true;
    cameraVideoElement.style.display = 'none';
    const previewEl = cameraModal.querySelector('.camera-preview');
    previewEl.style.background = 'transparent';
    previewEl.style.minHeight = '300px';

    try {
      const rect = previewEl.getBoundingClientRect();
      await CameraPreview.start({
        position: currentFacingMode === 'user' ? 'front' : 'rear',
        toBack: true,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        enableHighResolution: true,
      });
      cameraModal.style.background = 'transparent';
      cameraModal.querySelector('.camera-modal-content').style.background = 'transparent';
    } catch(e) {
      console.error('Native camera start error:', e);
      isNativeCamera = false;
      cameraVideoElement.style.display = 'block';
      fallbackToGetUserMedia();
    }
    return;
  }
  fallbackToGetUserMedia();
}

async function fallbackToGetUserMedia() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: currentFacingMode },
      audio: false
    });
    cameraVideoElement.srcObject = cameraStream;
  } catch (error) {
    console.error('Camera error:', error);
    closeCamera();
  }
}

async function closeCamera() {
  const CameraPreview = getCameraPreviewPlugin();
  if (isNativeCamera && CameraPreview) {
    try { await CameraPreview.stop(); } catch(e) {}
    isNativeCamera = false;
    cameraModal.style.background = '';
    const content = cameraModal.querySelector('.camera-modal-content');
    if (content) content.style.background = 'rgba(18, 18, 18, 0.9)';
    cameraVideoElement.style.display = 'block';
  }
  if (isFlashOn) toggleFlash();
  clearInterval(cameraTimerInterval);
  clearInterval(recordingInterval);
  cameraModal?.classList.add('hidden');
  stopCamera();
  resetCameraPreview();
}

function stopCamera() {
  cameraStream?.getTracks().forEach(t => t.stop());
  cameraStream = null;
}

async function capturePhoto() {
  const CameraPreview = getCameraPreviewPlugin();
  if (isNativeCamera && CameraPreview) {
    try {
      const result = await CameraPreview.capture({ quality: 90 });
      if (result && result.value) {
        const dataUrl = 'data:image/jpeg;base64,' + result.value;
        const response = await fetch(dataUrl);
        const blob = await response.blob();
        showCameraPreview('photo', blob);
      }
    } catch(e) { console.error('Native capture error:', e); }
    return;
  }
  const context = cameraCanvasElement.getContext('2d');
  cameraCanvasElement.width = cameraVideoElement.videoWidth;
  cameraCanvasElement.height = cameraVideoElement.videoHeight;
  context.drawImage(cameraVideoElement, 0, 0);
  cameraCanvasElement.toBlob(blob => showCameraPreview('photo', blob), 'image/jpeg', 0.8);
}

async function switchCamera() {
  currentFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
  const CameraPreview = getCameraPreviewPlugin();
  if (isNativeCamera && CameraPreview) {
    try { await CameraPreview.flip(); } catch(e) { console.error('Flip error:', e); }
    return;
  }
  stopCamera();
  fallbackToGetUserMedia();
}

function showCameraPreview(type, blob) {
  const previewArea = document.querySelector('.camera-preview-area');
  const cameraPreview = document.querySelector('.camera-preview');
  const cameraCtrls = document.querySelector('.camera-controls');
  const img = document.getElementById('camera-preview-image');
  const vid = document.getElementById('camera-preview-video');

  cameraPreview.style.display = 'none';
  cameraCtrls.style.display = 'none';
  previewArea.style.display = 'flex';

  const url = URL.createObjectURL(blob);
  if (type === 'photo') { img.src = url; img.style.display = 'block'; vid.style.display = 'none'; }
  else { vid.src = url; vid.style.display = 'block'; img.style.display = 'none'; }
  previewArea.dataset.mediaBlob = url;
  previewArea.dataset.mediaType = type;
}

function retakeCameraMedia() {
  document.querySelector('.camera-preview-area').style.display = 'none';
  document.querySelector('.camera-preview').style.display = 'block';
  document.querySelector('.camera-controls').style.display = 'block';
}

function sendCameraMedia() {
  const previewArea = document.querySelector('.camera-preview-area');
  fetch(previewArea.dataset.mediaBlob).then(r => r.blob()).then(blob => {
    const fileName = previewArea.dataset.mediaType === 'photo' ? 'snap.jpg' : 'clip.webm';
    sendFile(new File([blob], fileName, { type: blob.type }));
    closeCamera();
  });
}

function resetCameraPreview() {
  const previewArea = document.querySelector('.camera-preview-area');
  const cameraPreview = document.querySelector('.camera-preview');
  const cameraCtrls = document.querySelector('.camera-controls');
  if (previewArea) previewArea.style.display = 'none';
  if (cameraPreview) cameraPreview.style.display = 'block';
  if (cameraCtrls) cameraCtrls.style.display = 'block';
}

// Close camera on Android back button
document.addEventListener('backbutton', function(e) {
  if (cameraModal && !cameraModal.classList.contains('hidden')) {
    e.preventDefault();
    closeCamera();
  }
}, false);
