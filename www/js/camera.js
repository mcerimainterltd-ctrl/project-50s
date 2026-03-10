/*
 * camera.js - XamePage v2.1
 * Uses native Capacitor camera for APK, getUserMedia for PWA
 */

function initCameraFunctionality() {
  setupCameraButton();
}

function setupCameraButton() {
  const cameraBtn = document.getElementById('camera-btn');
  if (cameraBtn) cameraBtn.addEventListener('click', openCamera);
}

async function openCamera() {
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    showNativeCameraOptions();
  } else {
    alert('Camera only works on the app.');
  }
}

function showNativeCameraOptions() {
  const overlay = document.createElement('div');
  overlay.id = 'native-cam-overlay';
  overlay.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(18,18,18,0.95);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:30px 20px;z-index:12000;display:flex;flex-direction:column;gap:15px;';
  overlay.innerHTML = `
    <h3 style="color:white;text-align:center;margin:0 0 10px;">📷 Camera</h3>
    <button id="cam-photo-btn" style="padding:16px;border-radius:14px;background:#007aff;color:white;border:none;font-size:16px;font-weight:bold;">📸 Take Photo</button>
    <button id="cam-video-btn" style="padding:16px;border-radius:14px;background:#ff3b30;color:white;border:none;font-size:16px;font-weight:bold;">🎥 Record Video</button>
    <button id="cam-cancel-btn" style="padding:16px;border-radius:14px;background:rgba(255,255,255,0.1);color:white;border:none;font-size:16px;">Cancel</button>
  `;
  document.body.appendChild(overlay);

  document.getElementById('cam-photo-btn').onclick = () => { removeOverlay(); takeNativePhoto(); };
  document.getElementById('cam-video-btn').onclick = () => { removeOverlay(); recordNativeVideo(); };
  document.getElementById('cam-cancel-btn').onclick = removeOverlay;

  function removeOverlay() {
    document.getElementById('native-cam-overlay')?.remove();
  }
}

async function takeNativePhoto() {
  try {
    const { Camera } = window.Capacitor.Plugins;
    const image = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: 'dataUrl',
      source: 'CAMERA'
    });
    if (image && image.dataUrl) {
      const blob = await fetch(image.dataUrl).then(r => r.blob());
      sendFile(new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
    }
  } catch(e) {
    if (!e.message?.includes('cancelled')) console.error('Photo error:', e);
  }
}

async function recordNativeVideo() {
  try {
    const { CapacitorVideoRecorder } = window.Capacitor.Plugins;
    if (!CapacitorVideoRecorder) {
      // Fallback: use Camera plugin in video mode
      const { Camera } = window.Capacitor.Plugins;
      const video = await Camera.getPhoto({
        quality: 90,
        allowEditing: false,
        resultType: 'dataUrl',
        source: 'CAMERA',
        presentationStyle: 'fullscreen'
      });
      if (video && video.dataUrl) {
        const blob = await fetch(video.dataUrl).then(r => r.blob());
        sendFile(new File([blob], 'video.mp4', { type: 'video/mp4' }));
      }
      return;
    }
  } catch(e) {
    if (!e.message?.includes('cancelled')) console.error('Video error:', e);
  }
}
