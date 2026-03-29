package com.xamepage.app.core.webrtc;

import android.util.Log;
import org.webrtc.SdpObserver;
import org.webrtc.SessionDescription;

public class SimpleSdpObserver implements SdpObserver {
    private static final String TAG = "SimpleSdpObserver";

    @Override public void onCreateSuccess(SessionDescription sdp) {}
    @Override public void onSetSuccess() {}
    @Override public void onCreateFailure(String error) { Log.e(TAG, "SDP create failed: " + error); }
    @Override public void onSetFailure(String error)    { Log.e(TAG, "SDP set failed: " + error); }
}
