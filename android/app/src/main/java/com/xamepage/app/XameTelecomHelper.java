package com.xamepage.app;

import android.content.ComponentName;
import android.content.Context;
import android.os.Bundle;
import android.telecom.PhoneAccount;
import android.telecom.PhoneAccountHandle;
import android.telecom.TelecomManager;
import android.content.Intent;

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
            // Wake screen first
            android.os.PowerManager pm = (android.os.PowerManager) context.getSystemService(Context.POWER_SERVICE);
            android.os.PowerManager.WakeLock wl = pm.newWakeLock(
                android.os.PowerManager.SCREEN_BRIGHT_WAKE_LOCK | android.os.PowerManager.ACQUIRE_CAUSES_WAKEUP | android.os.PowerManager.ON_AFTER_RELEASE,
                "xamepage:telecomwakelock"
            );
            wl.acquire(30000);

            TelecomManager telecomManager = (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
            if (telecomManager == null) return;
            PhoneAccountHandle handle = getPhoneAccountHandle(context);
            Bundle extras = new Bundle();
            extras.putString("callerName", callerName);
            extras.putString("callType", callType);
            extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, handle);
            telecomManager.addNewIncomingCall(handle, extras);

            // Directly launch MainActivity over lock screen
            Intent i = new Intent(context, MainActivity.class);
            i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            i.putExtra("incomingCall", true);
            i.putExtra("callerName", callerName);
            i.putExtra("callType", callType);
            context.startActivity(i);

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
