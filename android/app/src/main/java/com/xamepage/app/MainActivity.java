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
        getWebView().setDownloadListener(new DownloadListener() {
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