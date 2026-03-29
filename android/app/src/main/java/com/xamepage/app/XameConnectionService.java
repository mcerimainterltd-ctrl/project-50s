package com.xamepage.app;

import android.telecom.Connection;
import android.telecom.ConnectionRequest;
import android.telecom.ConnectionService;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;

public class XameConnectionService extends ConnectionService {

    @Override
    public Connection onCreateIncomingConnection(PhoneAccountHandle connectionManagerPhoneAccount, ConnectionRequest request) {
        XameConnection connection = new XameConnection(getApplicationContext());
        connection.setCallerDisplayName(
            request.getExtras().getString("callerName", "Unknown"),
            TelecomManager.PRESENTATION_ALLOWED
        );
        connection.setActive();
        return connection;
    }

    @Override
    public void onCreateIncomingConnectionFailed(PhoneAccountHandle connectionManagerPhoneAccount, ConnectionRequest request) {
        // Fall back to notification
        android.content.Intent i = new android.content.Intent(this, CallForegroundService.class);
        i.putExtra("callerName", request.getExtras().getString("callerName", "Unknown"));
        i.putExtra("callType", request.getExtras().getString("callType", "voice"));
        startForegroundService(i);
    }
}
