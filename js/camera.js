/*
 * camera.js - XamePage v2.1
 * Photo and Video capture via native camera
 */

function initCameraFunctionality() {
  setupCameraButton();
}

function setupCameraButton() {
  const cameraBtn = document.getElementById('camera-btn');
  if (cameraBtn) cameraBtn.addEventListener('click', openCameraSheet);
}

function openCameraSheet() {
  const existing = document.getElementById('cameraModeSheet');
  if (existing) { existing.remove(); return; }

  const sheet = document.createElement('div');
  sheet.id = 'cameraModeSheet';
  sheet.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.5);';

  sheet.innerHTML = `
    <div style="background:var(--bg-secondary,#1a2332);border-radius:20px 20px 0 0;width:100%;max-width:500px;padding:20px 20px 32px;">
      <div style="width:40px;height:4px;background:rgba(255,255,255,0.2);border-radius:2px;margin:0 auto 20px;"></div>
      <h3 style="color:#fff;font-size:16px;font-weight:700;margin-bottom:16px;text-align:center;">Camera</h3>
      <div style="display:flex;gap:12px;">
        <button id="sheetPhotoBtn" style="flex:1;padding:18px;background:rgba(0,176,160,0.15);border:1px solid rgba(0,176,160,0.3);border-radius:14px;color:#00B0A0;font-size:14px;font-weight:600;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;">
          <span style="font-size:28px;">📷</span>Photo
        </button>
        <button id="sheetVideoBtn" style="flex:1;padding:18px;background:rgba(255,100,100,0.1);border:1px solid rgba(255,100,100,0.2);border-radius:14px;color:#ff6464;font-size:14px;font-weight:600;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:8px;">
          <span style="font-size:28px;">🎥</span>Video
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(sheet);

  sheet.querySelector('#sheetPhotoBtn').addEventListener('click', () => {
    sheet.remove();
    takeNativePhoto();
  });

  sheet.querySelector('#sheetVideoBtn').addEventListener('click', () => {
    sheet.remove();
    recordNativeVideo();
  });

  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.remove(); });
}

async function takeNativePhoto() {
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
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
      console.error('Photo error:', e);
    }
  }
}

function recordNativeVideo() {
  // Use hidden file input with video capture
  let videoInput = document.getElementById('xameVideoInput');
  if (!videoInput) {
    videoInput = document.createElement('input');
    videoInput.type = 'file';
    videoInput.id = 'xameVideoInput';
    videoInput.accept = 'video/*';
    videoInput.setAttribute('capture', 'camcorder');
    videoInput.style.display = 'none';
    document.body.appendChild(videoInput);
  }
  videoInput.value = '';
  videoInput.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    sendFile(file);
    videoInput.value = '';
  };
  videoInput.click();
}
