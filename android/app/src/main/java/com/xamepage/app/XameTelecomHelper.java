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
        // No longer launching the app directly — notification handles it
    }
}
