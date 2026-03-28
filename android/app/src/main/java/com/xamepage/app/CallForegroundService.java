package com.xamepage.app;

import android.app.Notification;
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

        // Answer intent
        Intent answerIntent = new Intent(this, CallNotificationReceiver.class);
        answerIntent.setAction(CallNotificationReceiver.ACTION_ANSWER);
        answerIntent.putExtra("callerName", callerName);
        answerIntent.putExtra("callType", callType);
        PendingIntent answerPI = PendingIntent.getBroadcast(this, 1, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Decline intent
        Intent declineIntent = new Intent(this, CallNotificationReceiver.class);
        declineIntent.setAction(CallNotificationReceiver.ACTION_DECLINE);
        declineIntent.putExtra("callerName", callerName);
        PendingIntent declinePI = PendingIntent.getBroadcast(this, 2, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Full screen intent for lock screen only
        Intent fullScreenIntent = new Intent(this, MainActivity.class);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra("incomingCall", true);
        fullScreenIntent.putExtra("callerName", callerName);
        fullScreenIntent.putExtra("callType", callType);
        PendingIntent fullScreenPI = PendingIntent.getActivity(this, 0, fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String title = (callType != null && callType.equals("video")) ? "Incoming Video Call" : "Incoming Voice Call";

        Notification notification = new NotificationCompat.Builder(this, CallNotificationReceiver.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(title)
            .setContentText(callerName + " is calling...")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setFullScreenIntent(fullScreenPI, true)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(fullScreenPI)
            .addAction(android.R.drawable.ic_menu_call, "Answer", answerPI)
            .addAction(android.R.drawable.ic_delete, "Decline", declinePI)
            .build();

        startForeground(CallNotificationReceiver.NOTIFICATION_ID, notification);
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
