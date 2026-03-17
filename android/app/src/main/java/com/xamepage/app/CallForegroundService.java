package com.xamepage.app;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

public class CallForegroundService extends Service {

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String callerName = intent != null ? intent.getStringExtra("callerName") : "Unknown";
        String callType   = intent != null ? intent.getStringExtra("callType") : "voice";

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openIntent.putExtra("incomingCall", true);
        openIntent.putExtra("callerName", callerName);
        openIntent.putExtra("callType", callType);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, CallNotificationReceiver.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(callType != null && callType.equals("video") ? "📹 Incoming Video Call" : "📞 Incoming Voice Call")
            .setContentText(callerName + " is calling you")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setFullScreenIntent(pendingIntent, true)
            .setOngoing(true)
            .setAutoCancel(false)
            .build();

        startForeground(1001, notification);

        // Directly launch MainActivity for full screen overlay on Android 10+
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.Q) {
            android.os.PowerManager pm = (android.os.PowerManager) getSystemService(POWER_SERVICE);
            android.os.PowerManager.WakeLock wl = pm.newWakeLock(
                android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK | android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP | android.os.PowerManager.ON_AFTER_RELEASE,
                "xamepage:fgwakelock"
            );
            wl.acquire(30000);
            Intent launchIntent = new Intent(this, MainActivity.class);
            launchIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            launchIntent.putExtra("incomingCall", true);
            launchIntent.putExtra("callerName", callerName);
            launchIntent.putExtra("callType", callType);
            startActivity(launchIntent);
        }

        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
