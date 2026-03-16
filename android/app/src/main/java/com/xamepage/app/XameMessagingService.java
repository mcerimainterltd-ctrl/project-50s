package com.xamepage.app;

import android.content.Intent;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class XameMessagingService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage remoteMessage) {
        String type = remoteMessage.getData().get("type");
        if ("incoming_call".equals(type)) {
            Intent i = new Intent("com.xamepage.app.INCOMING_CALL");
            i.putExtra("callerName", remoteMessage.getData().get("callerName"));
            i.putExtra("callType", remoteMessage.getData().get("callType"));
            sendBroadcast(i);
        }
    }
}
