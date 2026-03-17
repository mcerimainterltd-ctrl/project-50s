package com.xamepage.app;

import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.telecom.PhoneAccount;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;

public class XameTelecomHelper {

    public static PhoneAccountHandle getPhoneAccountHandle(Context context) {
        ComponentName component = new ComponentName(context, XameConnectionService.class);
        return new PhoneAccountHandle(component, "xamepage_account");
    }

    public static void registerPhoneAccount(Context context) {
        TelecomManager telecomManager = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
        if (telecomManager == null) return;
        PhoneAccountHandle handle = getPhoneAccountHandle(context);
        PhoneAccount account = PhoneAccount.builder(handle, "XamePage")
            .setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED)
            .build();
        telecomManager.registerPhoneAccount(account);
    }

    public static void addIncomingCall(Context context, String callerName, String callType) {
        try {
            TelecomManager telecomManager = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
            if (telecomManager == null) return;
            PhoneAccountHandle handle = getPhoneAccountHandle(context);
            Bundle extras = new Bundle();
            extras.putString("callerName", callerName);
            extras.putString("callType", callType);
            extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle);
            telecomManager.addNewIncomingCall(handle, extras);
        } catch (Exception e) {
            // Fall back to foreground service
            Intent i = new Intent(context, CallForegroundService.class);
            i.putExtra("callerName", callerName);
            i.putExtra("callType", callType);
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                context.startForegroundService(i);
            } else {
                context.startService(i);
            }
        }
    }
}
