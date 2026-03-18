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
import android.webkit.JavascriptInterface;
import android.os.AsyncTask;
import java.io.InputStream;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import io.capawesome.capacitorjs.plugins.firebase.messaging.FirebaseMessagingPlugin;
import com.xamepage.app.CallNotificationReceiver;
import com.capacitorjs.plugins.splashscreen.SplashScreenPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(android.os.Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        CallNotificationReceiver.createChannel(this);
        XameTelecomHelper.registerPhoneAccount(this);
        registerPlugin(FirebaseMessagingPlugin.class);
        // Enable file downloads in WebView
        // Add JavaScript interface for native file opening
        getBridge().getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void openFileBase64(String base64Data, String fileName, String mimeType) {
                try {
                    byte[] bytes = android.util.Base64.decode(base64Data, android.util.Base64.DEFAULT);
                    java.io.File cacheDir = getCacheDir();
                    java.io.File file = new java.io.File(cacheDir, fileName);
                    java.io.FileOutputStream fos = new java.io.FileOutputStream(file);
                    fos.write(bytes);
                    fos.close();
                    android.net.Uri uri = androidx.core.content.FileProvider.getUriForFile(
                        MainActivity.this, getPackageName() + ".fileprovider", file
                    );
                    String resolvedMime = mimeType;
                    if (resolvedMime == null || resolvedMime.isEmpty() || resolvedMime.equals("application/octet-stream")) {
                        String fn = fileName.toLowerCase();
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
                    // For APKs, save to Downloads folder
                    if (resolvedMime.equals("application/vnd.android.package-archive")) {
                        java.io.File downloadsDir = android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_DOWNLOADS);
                        java.io.File destFile = new java.io.File(downloadsDir, savedFileName);
                        java.io.FileInputStream fis = new java.io.FileInputStream(file);
                        java.io.FileOutputStream fos2 = new java.io.FileOutputStream(destFile);
                        byte[] buf2 = new byte[4096];
                        int len2;
                        while ((len2 = fis.read(buf2)) != -1) fos2.write(buf2, 0, len2);
                        fis.close(); fos2.close();
                        android.widget.Toast.makeText(MainActivity.this, savedFileName + " saved to Downloads", android.widget.Toast.LENGTH_LONG).show();
                        // Open Downloads folder
                        android.content.Intent downloadsIntent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
                        downloadsIntent.setDataAndType(android.net.Uri.parse("content://com.android.externalstorage.documents/document/primary:Downloads"), "vnd.android.document/directory");
                        downloadsIntent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                        try { startActivity(downloadsIntent); } catch(Exception ex) {
                            // Fallback: open file manager
                            android.content.Intent fm = new android.content.Intent(android.content.Intent.ACTION_GET_CONTENT);
                            fm.setType("*/*");
                            fm.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                            try { startActivity(fm); } catch(Exception ex2) {}
                        }
                    } else {
                        android.content.Intent intent = new android.content.Intent(android.content.Intent.ACTION_VIEW);
                        intent.setDataAndType(uri, resolvedMime);
                        intent.addFlags(android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
                        try { startActivity(intent); } catch (Exception e) {
                            android.widget.Toast.makeText(MainActivity.this, "No app found to open this file", android.widget.Toast.LENGTH_SHORT).show();
                        }
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