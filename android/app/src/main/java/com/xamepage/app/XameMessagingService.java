package com.xamepage.app;

import android.app.KeyguardManager;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class XameMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        String type = remoteMessage.getData().get("type");
        if ("incoming_call".equals(type)) {
            String callerName = remoteMessage.getData().get("callerName");
            String callType = remoteMessage.getData().get("callType");

            // Wake screen
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            PowerManager.WakeLock wl = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                "xamepage:msgwakelock"
            );
            wl.acquire(30000);

            // Post full screen notification directly
            Intent openIntent = new Intent(this, MainActivity.class);
            openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            openIntent.putExtra("incomingCall", true);
            openIntent.putExtra("callerName", callerName);
            openIntent.putExtra("callType", callType);

            PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CallNotificationReceiver.CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_call)
                .setContentTitle(callType != null && callType.equals("video") ? "Incoming Video Call" : "Incoming Voice Call")
                .setContentText(callerName + " is calling you")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setFullScreenIntent(pendingIntent, true)
                .setAutoCancel(true)
                .setOngoing(true)
                .setContentIntent(pendingIntent);

            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(1001, builder.build());

            // Also send broadcast for receiver
            Intent i = new Intent("com.xamepage.app.INCOMING_CALL");
            i.putExtra("callerName", callerName);
            i.putExtra("callType", callType);
            sendBroadcast(i);
        }
    }
}