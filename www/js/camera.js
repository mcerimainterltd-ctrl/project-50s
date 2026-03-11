/*
 * camera.js - XamePage v2.1
 * Photo only for now via Capacitor Camera plugin
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
    takeNativePhoto();
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
    console.error('Photo error:', e);
  }
}
