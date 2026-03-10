/*
 * camera.js - XamePage v2.1
 * Native camera for APK (photo + video), getUserMedia fallback for PWA
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
  const existing = document.getElementById('native-cam-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'native-cam-overlay';
  overlay.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:rgba(18,18,18,0.97);backdrop-filter:blur(20px);border-radius:24px 24px 0 0;padding:30px 20px 40px;z-index:12000;display:flex;flex-direction:column;gap:14px;';
  overlay.innerHTML = `
    <div style="width:40px;height:4px;background:rgba(255,255,255,0.2);border-radius:2px;margin:0 auto 10px;"></div>
    <h3 style="color:white;text-align:center;margin:0 0 6px;font-size:18px;font-weight:600;">Camera</h3>
    <button id="cam-photo-btn" style="padding:16px;border-radius:14px;background:linear-gradient(135deg,#007aff,#00c6ff);color:white;border:none;font-size:16px;font-weight:600;cursor:pointer;">📸 Take Photo</button>
    <button id="cam-video-btn" style="padding:16px;border-radius:14px;background:linear-gradient(135deg,#6c3483,#a93226,#e74c3c);color:white;border:none;font-size:16px;font-weight:600;cursor:pointer;">🎥 Record Video</button>
    <button id="cam-cancel-btn" style="padding:14px;border-radius:14px;background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.1);font-size:15px;cursor:pointer;">Cancel</button>
  `;
  document.body.appendChild(overlay);

  function removeOverlay() {
    document.getElementById('native-cam-overlay')?.remove();
  }

  document.getElementById('cam-photo-btn').onclick = () => { removeOverlay(); takeNativePhoto(); };
  document.getElementById('cam-video-btn').onclick = () => { removeOverlay(); recordNativeVideo(); };
  document.getElementById('cam-cancel-btn').onclick = removeOverlay;

  document.addEventListener('backbutton', function onBack(e) {
    e.preventDefault();
    removeOverlay();
    document.removeEventListener('backbutton', onBack);
  }, false);
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
    if (!e.message?.includes('cancelled') && !e.message?.includes('cancel')) {
      console.error('Photo error:', e);
    }
  }
}

async function recordNativeVideo() {
  try {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.capture = 'camcorder';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.onchange = async () => {
      const file = input.files[0];
      if (file) {
        sendFile(new File([file], 'video.mp4', { type: file.type }));
      }
      input.remove();
    };

    input.addEventListener('cancel', () => input.remove());
    input.click();
  } catch(e) {
    console.error('Video error:', e);
  }
}
