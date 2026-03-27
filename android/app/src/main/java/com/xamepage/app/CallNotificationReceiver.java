package com.xamepage.app;

import android.app.KeyguardManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

public class CallNotificationReceiver extends BroadcastReceiver {
    public static final String CHANNEL_ID = "incoming_calls";

    public static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Incoming Calls", NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Notifications for incoming calls");
            channel.enableVibration(true);
            channel.setShowBadge(true);
            NotificationManager nm = context.getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    public static final int NOTIFICATION_ID = 1001;
    public static final String ACTION_ANSWER  = "com.xamepage.app.ANSWER_CALL";
    public static final String ACTION_DECLINE = "com.xamepage.app.DECLINE_CALL";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action     = intent.getAction();
        String callerName = intent.getStringExtra("callerName");
        String callType   = intent.getStringExtra("callType");

        // Handle answer/decline actions
        if (ACTION_ANSWER.equals(action)) {
            // Cancel notification
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIFICATION_ID);
            // Wake screen
            PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
            PowerManager.WakeLock wl = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
                "xamepage:callwakelock"
            );
            wl.acquire(30000);
            // Launch app to answer
            Intent openIntent = new Intent(context, MainActivity.class);
            openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            openIntent.putExtra("incomingCall", true);
            openIntent.putExtra("answerCall", true);
            openIntent.putExtra("callerName", callerName);
            openIntent.putExtra("callType", callType);
            context.startActivity(openIntent);
            return;
        }

        if (ACTION_DECLINE.equals(action)) {
            // Just cancel the notification — call times out on caller's end
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIFICATION_ID);
            // Stop foreground service if running
            context.stopService(new Intent(context, CallForegroundService.class));
            return;
        }

        // ── Show heads-up notification (don't open app) ──────────────────
        PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
        PowerManager.WakeLock wl = pm.newWakeLock(
            PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP | PowerManager.ON_AFTER_RELEASE,
            "xamepage:callwakelock"
        );
        wl.acquire(30000);

        // Answer intent
        Intent answerIntent = new Intent(context, CallNotificationReceiver.class);
        answerIntent.setAction(ACTION_ANSWER);
        answerIntent.putExtra("callerName", callerName);
        answerIntent.putExtra("callType", callType);
        PendingIntent answerPI = PendingIntent.getBroadcast(context, 1, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Decline intent
        Intent declineIntent = new Intent(context, CallNotificationReceiver.class);
        declineIntent.setAction(ACTION_DECLINE);
        declineIntent.putExtra("callerName", callerName);
        PendingIntent declinePI = PendingIntent.getBroadcast(context, 2, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // Full screen intent (for lock screen)
        Intent fullScreenIntent = new Intent(context, MainActivity.class);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra("incomingCall", true);
        fullScreenIntent.putExtra("callerName", callerName);
        fullScreenIntent.putExtra("callType", callType);
        PendingIntent fullScreenPI = PendingIntent.getActivity(context, 0, fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String title = (callType != null && callType.equals("video")) ? "Incoming Video Call" : "Incoming Voice Call";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(title)
            .setContentText(callerName + " is calling...")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setFullScreenIntent(fullScreenPI, true)
            .setAutoCancel(false)
            .setOngoing(true)
            .setContentIntent(fullScreenPI)
            .addAction(android.R.drawable.ic_menu_call, "Answer", answerPI)
            .addAction(android.R.drawable.ic_delete, "Decline", declinePI);

        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIFICATION_ID, builder.build());
    }
}
