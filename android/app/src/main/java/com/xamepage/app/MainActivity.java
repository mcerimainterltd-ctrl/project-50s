package com.xamepage.app;
import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.JavascriptInterface;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import com.ahm.capacitor.camera.preview.CameraPreview;
import com.capacitorjs.plugins.camera.CameraPlugin;
import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private static final int VIDEO_CAPTURE_REQUEST = 101;
    private String pendingVideoPath = null;

    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(CameraPlugin.class);
        registerPlugin(CameraPreview.class);
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new VideoBridge(), "AndroidVideoBridge");
    }

    class VideoBridge {
        @JavascriptInterface
        public void recordVideo() {
            try {
                String timeStamp = new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(new Date());
                File videoFile = new File(getExternalFilesDir(Environment.DIRECTORY_MOVIES), "VID_" + timeStamp + ".mp4");
                pendingVideoPath = videoFile.getAbsolutePath();
                Uri videoUri = FileProvider.getUriForFile(MainActivity.this, getApplicationContext().getPackageName() + ".provider", videoFile);
                Intent intent = new Intent(MediaStore.ACTION_VIDEO_CAPTURE);
                intent.putExtra(MediaStore.EXTRA_OUTPUT, videoUri);
                intent.putExtra(MediaStore.EXTRA_VIDEO_QUALITY, 1);
                startActivityForResult(intent, VIDEO_CAPTURE_REQUEST);
            } catch (Exception e) {
                e.printStackTrace();
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != VIDEO_CAPTURE_REQUEST) {
            super.onActivityResult(requestCode, resultCode, data);
            return;
        }
        if (requestCode == VIDEO_CAPTURE_REQUEST) {
            if (resultCode == Activity.RESULT_OK && pendingVideoPath != null) {
                final String path = pendingVideoPath;
                getBridge().getWebView().post(() -> {
                    getBridge().getWebView().evaluateJavascript(
                        "if(window.onNativeVideoReady) window.onNativeVideoReady('file://" + path + "');", null
                    );
                });
            } else {
                getBridge().getWebView().post(() -> {
                    getBridge().getWebView().evaluateJavascript(
                        "if(window.onNativeVideoCancelled) window.onNativeVideoCancelled();", null
                    );
                });
            }
            pendingVideoPath = null;
        }
    }

    @Override
    public void onStart() {
        super.onStart();
        String[] permissions = {
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.MODIFY_AUDIO_SETTINGS
        };
        for (String p : permissions) {
            if (ContextCompat.checkSelfPermission(this, p) != PackageManager.PERMISSION_GRANTED) {
                ActivityCompat.requestPermissions(this, permissions, 1);
                break;
            }
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        WebView webView = getBridge().getWebView();
        WebSettings settings = webView.getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                request.grant(request.getResources());
            }
        });
    }
}