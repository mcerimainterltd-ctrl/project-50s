package com.xamepage.app;

import android.Manifest;
import android.content.pm.PackageManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import android.app.DownloadManager;
import android.net.Uri;
import android.webkit.DownloadListener;
import android.webkit.URLUtil;
import android.net.ConnectivityManager;
import android.media.AudioManager;
import androidx.biometric.BiometricPrompt;
import androidx.biometric.BiometricManager;
import androidx.core.content.ContextCompat;
import java.util.concurrent.Executor;
import android.net.NetworkRequest;
import android.net.Network;
import android.webkit.JavascriptInterface;
import android.os.AsyncTask;
import android.speech.tts.TextToSpeech;
import java.util.Locale;
import java.io.InputStream;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import io.capawesome.capacitorjs.plugins.firebase.messaging.FirebaseMessagingPlugin;
import com.xamepage.app.CallNotificationReceiver;
import com.capacitorjs.plugins.splashscreen.SplashScreenPlugin;

public class MainActivity extends BridgeActivity {
    private TextToSpeech tts;

    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        CallNotificationReceiver.createChannel(this);

        // Keep app alive with WakeLock
        android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
        android.os.PowerManager.WakeLock wakeLock = pm.newWakeLock(
            android.os.PowerManager.PARTIAL_WAKE_LOCK, "xamepage:appwakelock"
        );
        wakeLock.acquire();
        // Monitor network and reconnect WebView when internet restored
        ConnectivityManager cm = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        cm.registerDefaultNetworkCallback(new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                runOnUiThread(() -> {
                    getBridge().getWebView().evaluateJavascript(
                        "if(typeof connectSocket==='function' && (!window.socket || !window.socket.connected)) { connectSocket(); }",
                        null
                    );
                });
            }
        });
        XameTelecomHelper.registerPhoneAccount(this);
        registerPlugin(FirebaseMessagingPlugin.class);

        // ── WebView stability & native feel ──────────────────────────────
        android.webkit.WebView webView = getBridge().getWebView();
        // Hardware acceleration
        webView.setLayerType(android.view.View.LAYER_TYPE_HARDWARE, null);
        // Remove overscroll bounce effect
        webView.setOverScrollMode(android.view.View.OVER_SCROLL_NEVER);
        // Remove scroll bars
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        // Remove scroll glow effect
        webView.setVerticalFadingEdgeEnabled(false);
        webView.setHorizontalFadingEdgeEnabled(false);
        // Disable long-press selection vibration
        webView.setHapticFeedbackEnabled(false);
        // Smooth rendering
        webView.getSettings().setRenderPriority(android.webkit.WebSettings.RenderPriority.HIGH);
        // Enable file downloads in WebView
        // Add JavaScript interface for native file opening
        getBridge().getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void authenticateBiometric(String reason) {
                Executor executor = ContextCompat.getMainExecutor(MainActivity.this);
                BiometricPrompt biometricPrompt = new BiometricPrompt(MainActivity.this, executor,
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            getBridge().getWebView().post(() ->
                                getBridge().getWebView().evaluateJavascript("window.onBiometricSuccess && window.onBiometricSuccess()", null)
                            );
                        }
                        @Override
                        public void onAuthenticationFailed() {
                            getBridge().getWebView().post(() ->
                                getBridge().getWebView().evaluateJavascript("window.onBiometricFailed && window.onBiometricFailed()", null)
                            );
                        }
                        @Override
                        public void onAuthenticationError(int errorCode, CharSequence errString) {
                            getBridge().getWebView().post(() ->
                                getBridge().getWebView().evaluateJavascript("window.onBiometricError && window.onBiometricError('" + errString + "')", null)
                            );
                        }
                    });
                BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle("XamePage")
                    .setSubtitle(reason != null ? reason : "Verify your identity")
                    .setNegativeButtonText("Use PIN")
                    .build();
                runOnUiThread(() -> biometricPrompt.authenticate(promptInfo));
            }

            @JavascriptInterface
            public void checkBiometricAvailable() {
                BiometricManager bm = BiometricManager.from(MainActivity.this);
                boolean available = bm.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_WEAK) == BiometricManager.BIOMETRIC_SUCCESS;
                getBridge().getWebView().post(() ->
                    getBridge().getWebView().evaluateJavascript("window.onBiometricAvailable && window.onBiometricAvailable(" + available + ")", null)
                );
            }

            @JavascriptInterface
            public void setSpeaker(boolean on) {
                runOnUiThread(() -> {
                    AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
                    if (am == null) return;
                    am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                        // Android 12+ - use setCommunicationDevice
                        if (on) {
                            android.media.AudioDeviceInfo[] devices = am.getAvailableCommunicationDevices().toArray(new android.media.AudioDeviceInfo[0]);
                            for (android.media.AudioDeviceInfo device : devices) {
                                if (device.getType() == android.media.AudioDeviceInfo.TYPE_BUILTIN_SPEAKER) {
                                    am.setCommunicationDevice(device);
                                    break;
                                }
                            }
                        } else {
                            android.media.AudioDeviceInfo[] devices = am.getAvailableCommunicationDevices().toArray(new android.media.AudioDeviceInfo[0]);
                            for (android.media.AudioDeviceInfo device : devices) {
                                if (device.getType() == android.media.AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {
                                    am.setCommunicationDevice(device);
                                    break;
                                }
                            }
                        }
                    } else {
                        am.setSpeakerphoneOn(on);
                    }
                });
            }

            @JavascriptInterface
            public void setCallAudioMode(boolean inCall) {
                runOnUiThread(() -> {
                    AudioManager am = (AudioManager) getSystemService(AUDIO_SERVICE);
                    if (am != null) {
                        if (inCall) {
                            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                                // Android 12+ - route to earpiece
                                android.media.AudioDeviceInfo[] devices = am.getAvailableCommunicationDevices().toArray(new android.media.AudioDeviceInfo[0]);
                                for (android.media.AudioDeviceInfo device : devices) {
                                    if (device.getType() == android.media.AudioDeviceInfo.TYPE_BUILTIN_EARPIECE) {
                                        am.setCommunicationDevice(device);
                                        break;
                                    }
                                }
                            }
                            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O && android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.S) {
                                android.media.AudioFocusRequest focusRequest = new android.media.AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                                    .setAudioAttributes(new android.media.AudioAttributes.Builder()
                                        .setUsage(android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION)
                                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                                        .build())
                                    .build();
                                am.requestAudioFocus(focusRequest);
                            }
                            am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                            am.setSpeakerphoneOn(false);
                        } else {
                            am.setMode(AudioManager.MODE_NORMAL);
                            am.setSpeakerphoneOn(false);
                            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                                am.abandonAudioFocusRequest(new android.media.AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).build());
                            }
                        }
                    }
                });
            }
            @JavascriptInterface
            public void speak(String text) {
                if (tts == null) {
                    tts = new TextToSpeech(MainActivity.this, status -> {
                        if (status == TextToSpeech.SUCCESS) {
                            tts.setLanguage(Locale.getDefault());
                            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "xame_tts");
                        }
                    });
                } else {
                    tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "xame_tts");
                }
            }

            @JavascriptInterface
            public void stopSpeaking() {
                if (tts != null) tts.stop();
            }

            @JavascriptInterface
            public void openFileBase64(String base64Data, String fileName, String mimeType) {
                try {
                    byte[] bytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
                    String fn = fileName.toLowerCase();
                    // Save to cache for opening
                    java.io.File cacheFile = new java.io.File(getCacheDir(), fileName);
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(cacheFile);
                    fos.write(bytes);
                    fos.close();
                    // Silently save to Downloads/XamePage folder
                    try {
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
                            android.content.ContentValues values = new android.content.ContentValues();
                            values.put(android.provider.MediaStore.Downloads.DISPLAY_NAME, fileName);
                            String subPath;
                            if (fn.endsWith(".jpg")||fn.endsWith(".jpeg")||fn.endsWith(".png")||fn.endsWith(".gif")||fn.endsWith(".webp")||fn.endsWith(".mp4")||fn.endsWith(".mkv")||fn.endsWith(".avi")||fn.endsWith(".webm")||fn.endsWith(".mp3")||fn.endsWith(".wav")||fn.endsWith(".ogg")||fn.endsWith(".m4a")) {
                                subPath = "Download/XamePage/Media";
                            } else if (fn.endsWith(".apk")||fn.endsWith(".zip")||fn.endsWith(".rar")||fn.endsWith(".7z")||fn.endsWith(".exe")||fn.endsWith(".tar")||fn.endsWith(".gz")) {
                                subPath = "Download/XamePage/Executables";
                            } else {
                                subPath = "Download/XamePage/Documents";
                            }
                            values.put(android.provider.MediaStore.Downloads.RELATIVE_PATH, subPath);
                            android.net.Uri extUri = getContentResolver().insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                            if (extUri != null) {
                                java.io.OutputStream os = getContentResolver().openOutputStream(extUri);
                                if (os != null) { os.write(bytes); os.close(); }
                            }
                        } else {
                            java.io.File dl = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
                            String subDir;
                            if (fn.endsWith(".jpg")||fn.endsWith(".jpeg")||fn.endsWith(".png")||fn.endsWith(".mp4")||fn.endsWith(".mp3")||fn.endsWith(".wav")||fn.endsWith(".ogg")||fn.endsWith(".m4a")) {
                                subDir = "XamePage/Media";
                            } else if (fn.endsWith(".apk")||fn.endsWith(".zip")||fn.endsWith(".rar")||fn.endsWith(".7z")||fn.endsWith(".exe")||fn.endsWith(".tar")||fn.endsWith(".gz")) {
                                subDir = "XamePage/Executables";
                            } else {
                                subDir = "XamePage/Documents";
                            }
                            java.io.File xameDir = new java.io.File(dl, subDir);
                            if (!xameDir.exists()) xameDir.mkdirs();
                            java.io.File savedFile = new java.io.File(xameDir, fileName);
                            java.io.FileOutputStream savedFos = new java.io.FileOutputStream(savedFile);
                            savedFos.write(bytes);
                            savedFos.close();
                        }
                    } catch (Exception saveEx) { /* silent */ }
                    java.io.File file = cacheFile;
                    String resolvedMime = mimeType;
                    if (resolvedMime == null || resolvedMime.isEmpty() || resolvedMime.equals("application/octet-stream")) {
                        if (fn.endsWith(".pdf")) resolvedMime = "application/pdf";
                        else if (fn.endsWith(".apk")) resolvedMime = "application/vnd.android.package-archive";
                        else if (fn.endsWith(".doc")) resolvedMime = "application/msword";
                        else if (fn.endsWith(".docx")) resolvedMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                        else if (fn.endsWith(".xls")) resolvedMime = "application/vnd.ms-excel";
                        else if (fn.endsWith(".xlsx")) resolvedMime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                        else if (fn.endsWith(".ppt")) resolvedMime = "application/vnd.ms-powerpoint";
                        else if (fn.endsWith(".pptx")) resolvedMime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
                        else if (fn.endsWith(".txt")) resolvedMime = "text/plain";
                        else resolvedMime = "*/*";
                    }
                    android.net.Uri uri = androidx.core.content.FileProvider.getUriForFile(
                        MainActivity.this, getPackageName() + ".fileprovider", file
                    );
                    android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
                    intent.setDataAndType(uri, resolvedMime);
                    intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                    try { startActivity(intent); } catch (Exception e) {
                        android.widget.Toast.makeText(MainActivity.this, "No app found to open this file", android.widget.Toast.LENGTH_SHORT).show();
                    }
                } catch (Exception e) {
                    android.widget.Toast.makeText(MainActivity.this, "Failed to open: " + e.getMessage(), android.widget.Toast.LENGTH_SHORT).show();
                }
            }

            @JavascriptInterface
            public void openFile(String fileUrl, String fileName) {
                new android.os.AsyncTask<String, Void, java.io.File>() {
                    private String savedFileName = fileName;
                    @Override
                    protected java.io.File doInBackground(String... params) {
                        try {
                            URL url = new URL(params[0]);
                            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                            conn.connect();
                            java.io.File cacheDir = getCacheDir();
                            java.io.File file = new java.io.File(cacheDir, params[1]);
                            InputStream in = conn.getInputStream();
                            FileOutputStream out = new FileOutputStream(file);
                            byte[] buf = new byte[4096];
                            int len;
                            while ((len = in.read(buf)) != -1) out.write(buf, 0, len);
                            in.close(); out.close();
                            return file;
                        } catch (Exception e) { return null; }
                    }
                    @Override
                    protected void onPostExecute(java.io.File file) {
                        if (file == null) {
                            android.widget.Toast.makeText(MainActivity.this, "Download failed: " + savedFileName, android.widget.Toast.LENGTH_LONG).show();
                            return;
                        }
                        android.net.Uri uri = androidx.core.content.FileProvider.getUriForFile(
                            MainActivity.this, getPackageName() + ".fileprovider", file
                        );
                        String mimeType = getContentResolver().getType(uri);
                        if (mimeType == null) {
                            String fn = savedFileName.toLowerCase();
                            if (fn.endsWith(".pdf")) mimeType = "application/pdf";
                            else if (fn.endsWith(".apk")) mimeType = "application/vnd.android.package-archive";
                            else if (fn.endsWith(".doc")) mimeType = "application/msword";
                            else if (fn.endsWith(".docx")) mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
                            else if (fn.endsWith(".xls")) mimeType = "application/vnd.ms-excel";
                            else if (fn.endsWith(".xlsx")) mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
                            else if (fn.endsWith(".ppt")) mimeType = "application/vnd.ms-powerpoint";
                            else if (fn.endsWith(".pptx")) mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
                            else if (fn.endsWith(".txt")) mimeType = "text/plain";
                            else mimeType = "*/*";
                        }
                        android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
                        intent.setDataAndType(uri, mimeType);
                        intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                        try { startActivity(intent); } catch (Exception e) {
                            android.widget.Toast.makeText(MainActivity.this, "No app found to open this file", android.widget.Toast.LENGTH_SHORT).show();
                        }
                    }
                }.execute(fileUrl, fileName);
            }
        }, "AndroidBridge");

        getBridge().getWebView().setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimeType);
                request.addRequestHeader("User-Agent", userAgent);
                request.setDescription("Downloading file...");
                String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                request.setTitle(fileName);
                request.allowScanningByMediaScanner();
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, fileName);
                DownloadManager dm = (DownloadManager) getSystemService(DOWNLOAD_SERVICE);
                if (dm != null) dm.enqueue(request);
                android.widget.Toast.makeText(getApplicationContext(), "Downloading " + fileName, android.widget.Toast.LENGTH_SHORT).show();
            }
        });
        // Log permission states
        android.util.Log.d("XAMEPAGE_PERMS", "canDrawOverlays: " + android.provider.Settings.canDrawOverlays(this));
        android.os.PowerManager pm3 = (android.os.PowerManager) getSystemService(POWER_SERVICE);
        android.util.Log.d("XAMEPAGE_PERMS", "ignoringBatteryOpt: " + (pm3 != null && pm3.isIgnoringBatteryOptimizations(getPackageName())));
        android.app.NotificationManager nm2 = (android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        android.util.Log.d("XAMEPAGE_PERMS", "notificationsEnabled: " + (nm2 != null && nm2.areNotificationsEnabled()));
        // Request draw over other apps permission
        if (!android.provider.Settings.canDrawOverlays(this)) {
            android.content.Intent overlayIntent = new android.content.Intent(android.provider.Settings.ACTION_MANAGE_OVERLAY_PERMISSION);
            overlayIntent.setData(android.net.Uri.parse("package:" + getPackageName()));
            startActivity(overlayIntent);
        }
        // Request full screen intent permission (Android 14+)
        if (android.os.Build.VERSION.SDK_INT >= 34) {
            android.app.NotificationManager nm = (android.app.NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null && !nm.canUseFullScreenIntent()) {
                android.content.Intent fsiIntent = new android.content.Intent(android.provider.Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                fsiIntent.setData(android.net.Uri.parse("package:" + getPackageName()));
                startActivity(fsiIntent);
            }
        }
        // Request battery optimization exemption
        android.os.PowerManager pm2 = (android.os.PowerManager) getSystemService(POWER_SERVICE);
        if (pm2 != null && !pm2.isIgnoringBatteryOptimizations(getPackageName())) {
            android.content.Intent batteryIntent = new android.content.Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
            batteryIntent.setData(android.net.Uri.parse("package:" + getPackageName()));
            startActivity(batteryIntent);
        }
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O_MR1) {
            setTurnScreenOn(true);
            setShowWhenLocked(true);
            android.app.KeyguardManager km = (android.app.KeyguardManager) getSystemService(KEYGUARD_SERVICE);
            if (km != null) km.requestDismissKeyguard(this, null);
        }
    }
    @Override
    public void onStart() {
        super.onStart();
        java.util.List<String> permList = new java.util.ArrayList<>();
        permList.add(Manifest.permission.CAMERA);
        permList.add(Manifest.permission.RECORD_AUDIO);
        permList.add(Manifest.permission.MODIFY_AUDIO_SETTINGS);
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
            permList.add("android.permission.READ_MEDIA_AUDIO");
            permList.add("android.permission.READ_MEDIA_VIDEO");
            permList.add("android.permission.READ_MEDIA_IMAGES");
            permList.add("android.permission.POST_NOTIFICATIONS");
        } else {
            permList.add(Manifest.permission.READ_EXTERNAL_STORAGE);
            permList.add(Manifest.permission.WRITE_EXTERNAL_STORAGE);
        }
        String[] permissions = permList.toArray(new String[0]);
        for (String p : permissions) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, permissions, 1);
                break;
            }
        }
    }
}