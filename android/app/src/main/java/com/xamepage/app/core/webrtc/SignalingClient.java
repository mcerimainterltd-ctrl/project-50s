package com.xamepage.app.core.webrtc;

import android.util.Log;
import com.xamepage.app.utils.Constants;
import org.json.JSONException;
import org.json.JSONObject;
import io.socket.client.IO;
import io.socket.client.Socket;
import io.socket.emitter.Emitter;
import java.net.URISyntaxException;

public class SignalingClient {

    private static final String TAG = "SignalingClient";
    private Socket socket;
    private SignalingListener listener;

    public interface SignalingListener {
        void onIncomingCall(String callerId, String callerName, String callType, JSONObject offer);
        void onCallAnswered(String userId, JSONObject answer);
        void onIceCandidate(String userId, JSONObject candidate);
        void onCallRejected(String userId, String reason);
        void onCallEnded(String userId);
        void onConnected();
        void onDisconnected();
    }

    public void setListener(SignalingListener listener) { this.listener = listener; }

    // ── Connect ────────────────────────────────────────────────────────────
    public void connect(String userId, String token) {
        try {
            IO.Options options = new IO.Options();
            options.forceNew   = true;
            options.reconnection = true;
            options.reconnectionAttempts = Constants.MAX_RECONNECT_ATTEMPTS;
            options.reconnectionDelay    = Constants.RECONNECT_BASE_DELAY;
            options.query = "token=" + token;

            socket = IO.socket(Constants.SERVER_URL, options);
            registerEvents(userId);
            socket.connect();
            Log.d(TAG, "Connecting to " + Constants.SERVER_URL);
        } catch (URISyntaxException e) {
            Log.e(TAG, "Socket URI error: " + e.getMessage());
        }
    }

    // ── Register socket events ─────────────────────────────────────────────
    private void registerEvents(String userId) {
        socket.on(Socket.EVENT_CONNECT, args -> {
            Log.d(TAG, "Socket connected");
            socket.emit("register", userId);
            if (listener != null) listener.onConnected();
        });

        socket.on(Socket.EVENT_DISCONNECT, args -> {
            Log.d(TAG, "Socket disconnected");
            if (listener != null) listener.onDisconnected();
        });

        socket.on("incoming-call", args -> {
            try {
                JSONObject data   = (JSONObject) args[0];
                JSONObject caller = data.getJSONObject("caller");
                String callerId   = caller.getString("xameId");
                String callerName = caller.optString("name", callerId);
                String callType   = data.optString("callType", "voice");
                JSONObject offer  = data.getJSONObject("offer");
                if (listener != null) listener.onIncomingCall(callerId, callerName, callType, offer);
            } catch (JSONException e) { Log.e(TAG, "incoming-call parse error: " + e.getMessage()); }
        });

        socket.on("call-answered", args -> {
            try {
                JSONObject data  = (JSONObject) args[0];
                String fromId    = data.getString("from");
                JSONObject answer = data.getJSONObject("answer");
                if (listener != null) listener.onCallAnswered(fromId, answer);
            } catch (JSONException e) { Log.e(TAG, "call-answered parse error: " + e.getMessage()); }
        });

        socket.on("ice-candidate", args -> {
            try {
                JSONObject data      = (JSONObject) args[0];
                String fromId        = data.getString("from");
                JSONObject candidate = data.getJSONObject("candidate");
                if (listener != null) listener.onIceCandidate(fromId, candidate);
            } catch (JSONException e) { Log.e(TAG, "ice-candidate parse error: " + e.getMessage()); }
        });

        socket.on("call-rejected", args -> {
            try {
                JSONObject data = (JSONObject) args[0];
                String fromId   = data.getString("from");
                String reason   = data.optString("reason", "");
                if (listener != null) listener.onCallRejected(fromId, reason);
            } catch (JSONException e) { Log.e(TAG, "call-rejected parse error: " + e.getMessage()); }
        });

        socket.on("call-ended", args -> {
            try {
                JSONObject data = (JSONObject) args[0];
                String fromId   = data.getString("from");
                if (listener != null) listener.onCallEnded(fromId);
            } catch (JSONException e) { Log.e(TAG, "call-ended parse error: " + e.getMessage()); }
        });
    }

    // ── Emit helpers ───────────────────────────────────────────────────────
    public void emitCallUser(String recipientId, JSONObject offer, String callType) {
        try {
            JSONObject data = new JSONObject();
            data.put("recipientId", recipientId);
            data.put("offer", offer);
            data.put("callType", callType);
            socket.emit("call-user", data);
        } catch (JSONException e) { Log.e(TAG, "emitCallUser error: " + e.getMessage()); }
    }

    public void emitAnswer(String recipientId, JSONObject answer) {
        try {
            JSONObject data = new JSONObject();
            data.put("recipientId", recipientId);
            data.put("answer", answer);
            socket.emit("make-answer", data);
        } catch (JSONException e) { Log.e(TAG, "emitAnswer error: " + e.getMessage()); }
    }

    public void emitIceCandidate(String recipientId, JSONObject candidate) {
        try {
            JSONObject data = new JSONObject();
            data.put("recipientId", recipientId);
            data.put("candidate", candidate);
            socket.emit("ice-candidate", data);
        } catch (JSONException e) { Log.e(TAG, "emitIceCandidate error: " + e.getMessage()); }
    }

    public void emitCallAccepted(String recipientId) {
        try {
            JSONObject data = new JSONObject();
            data.put("recipientId", recipientId);
            socket.emit("call-accepted", data);
        } catch (JSONException e) { Log.e(TAG, "emitCallAccepted error: " + e.getMessage()); }
    }

    public void emitCallEnded(String recipientId) {
        try {
            JSONObject data = new JSONObject();
            data.put("recipientId", recipientId);
            socket.emit("call-ended", data);
        } catch (JSONException e) { Log.e(TAG, "emitCallEnded error: " + e.getMessage()); }
    }

    public void emitCallRejected(String recipientId, String reason) {
        try {
            JSONObject data = new JSONObject();
            data.put("recipientId", recipientId);
            data.put("reason", reason);
            socket.emit("call-rejected", data);
        } catch (JSONException e) { Log.e(TAG, "emitCallRejected error: " + e.getMessage()); }
    }

    // ── Disconnect ─────────────────────────────────────────────────────────
    public void disconnect() {
        if (socket != null) { socket.disconnect(); socket.off(); socket = null; }
    }

    public boolean isConnected() { return socket != null && socket.connected(); }
}
