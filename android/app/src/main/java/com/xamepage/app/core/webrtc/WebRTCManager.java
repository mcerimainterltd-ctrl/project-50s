package com.xamepage.app.core.webrtc;

import android.content.Context;
import android.media.AudioManager;
import android.util.Log;

import com.xamepage.app.utils.Constants;

import org.webrtc.AudioSource;
import org.webrtc.AudioTrack;
import org.webrtc.Camera2Enumerator;
import org.webrtc.DataChannel;
import org.webrtc.DefaultVideoDecoderFactory;
import org.webrtc.DefaultVideoEncoderFactory;
import org.webrtc.EglBase;
import org.webrtc.IceCandidate;
import org.webrtc.MediaConstraints;
import org.webrtc.MediaStream;
import org.webrtc.PeerConnection;
import org.webrtc.PeerConnectionFactory;
import org.webrtc.RtpReceiver;
import org.webrtc.SessionDescription;
import org.webrtc.SurfaceTextureHelper;
import org.webrtc.SurfaceViewRenderer;
import org.webrtc.VideoCapturer;
import org.webrtc.VideoSource;
import org.webrtc.VideoTrack;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class WebRTCManager {

    private static final String TAG = "WebRTCManager";

    // ── Singleton ──────────────────────────────────────────────────────────
    private static WebRTCManager instance;
    public static WebRTCManager getInstance(Context context) {
        if (instance == null) instance = new WebRTCManager(context.getApplicationContext());
        return instance;
    }

    // ── State ──────────────────────────────────────────────────────────────
    private final Context context;
    private PeerConnectionFactory factory;
    private EglBase eglBase;
    private MediaStream localStream;
    private VideoSource videoSource;
    private AudioSource audioSource;
    private VideoCapturer videoCapturer;
    private SurfaceTextureHelper surfaceTextureHelper;

    private final Map<String, PeerConnection> peers = new HashMap<>();
    private final List<IceCandidate> pendingCandidates = new ArrayList<>();

    private boolean isAudioMuted    = false;
    private boolean isVideoMuted    = false;
    private boolean isLoudspeakerOn = false;
    private boolean callActive      = false;
    private boolean isFrontCamera   = true;

    // ── Call timer ─────────────────────────────────────────────────────────
    private long callStartTime = 0L;

    // ── Listener ──────────────────────────────────────────────────────────
    private WebRTCListener listener;
    public interface WebRTCListener {
        void onLocalStream(MediaStream stream);
        void onRemoteStream(String userId, MediaStream stream);
        void onIceCandidate(String userId, IceCandidate candidate);
        void onCallConnected(String userId);
        void onCallEnded(String userId);
        void onError(String message);
    }
    public void setListener(WebRTCListener listener) { this.listener = listener; }

    // ── Constructor ────────────────────────────────────────────────────────
    private WebRTCManager(Context context) {
        this.context = context;
        initFactory();
    }

    private void initFactory() {
        eglBase = EglBase.create();
        PeerConnectionFactory.InitializationOptions options =
            PeerConnectionFactory.InitializationOptions.builder(context)
                .setEnableInternalTracer(true)
                .createInitializationOptions();
        PeerConnectionFactory.initialize(options);
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(new DefaultVideoEncoderFactory(eglBase.getEglBaseContext(), true, true))
            .setVideoDecoderFactory(new DefaultVideoDecoderFactory(eglBase.getEglBaseContext()))
            .createPeerConnectionFactory();
        Log.d(TAG, "PeerConnectionFactory initialized");
    }

    // ── ICE servers ────────────────────────────────────────────────────────
    private List<PeerConnection.IceServer> getIceServers() {
        List<PeerConnection.IceServer> servers = new ArrayList<>();
        servers.add(PeerConnection.IceServer.builder(Constants.ICE_SERVERS.get(0)).createIceServer());
        servers.add(PeerConnection.IceServer.builder(Constants.ICE_SERVERS.get(1))
            .setUsername(Constants.TURN_USERNAME)
            .setPassword(Constants.TURN_CREDENTIAL)
            .createIceServer());
        return servers;
    }

    // ── Local stream ───────────────────────────────────────────────────────
    public void initLocalStream(boolean withVideo) {
        MediaConstraints audioConstraints = new MediaConstraints();
        audioConstraints.mandatory.add(new MediaConstraints.KeyValuePair("echoCancellation", "true"));
        audioConstraints.mandatory.add(new MediaConstraints.KeyValuePair("noiseSuppression", "true"));
        audioSource = factory.createAudioSource(audioConstraints);
        AudioTrack audioTrack = factory.createAudioTrack("audio0", audioSource);

        localStream = factory.createLocalMediaStream("localStream");
        localStream.addTrack(audioTrack);

        if (withVideo) {
            videoCapturer = createVideoCapturer();
            if (videoCapturer != null) {
                surfaceTextureHelper = SurfaceTextureHelper.create("CaptureThread", eglBase.getEglBaseContext());
                videoSource = factory.createVideoSource(videoCapturer.isScreencast());
                videoCapturer.initialize(surfaceTextureHelper, context, videoSource.getCapturerObserver());
                videoCapturer.startCapture(1280, 720, 30);
                VideoTrack videoTrack = factory.createVideoTrack("video0", videoSource);
                localStream.addTrack(videoTrack);
            }
        }
        if (listener != null) listener.onLocalStream(localStream);
        Log.d(TAG, "Local stream initialized, video=" + withVideo);
    }

    private VideoCapturer createVideoCapturer() {
        Camera2Enumerator enumerator = new Camera2Enumerator(context);
        for (String name : enumerator.getDeviceNames()) {
            if (isFrontCamera && enumerator.isFrontFacing(name))
                return enumerator.createCapturer(name, null);
        }
        for (String name : enumerator.getDeviceNames()) {
            if (!isFrontCamera && enumerator.isBackFacing(name))
                return enumerator.createCapturer(name, null);
        }
        return null;
    }

    // ── Create peer connection ─────────────────────────────────────────────
    public PeerConnection createPeerConnection(String userId) {
        PeerConnection.RTCConfiguration config =
            new PeerConnection.RTCConfiguration(getIceServers());
        config.sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN;

        PeerConnection pc = factory.createPeerConnection(config, new PeerConnection.Observer() {
            @Override public void onIceCandidate(IceCandidate candidate) {
                if (listener != null) listener.onIceCandidate(userId, candidate);
            }
            @Override public void onTrack(org.webrtc.RtpTransceiver transceiver) {
                MediaStream[] streams = transceiver.getReceiver().getStreams().toArray(new MediaStream[0]);
                if (streams.length > 0 && listener != null) {
                    listener.onRemoteStream(userId, streams[0]);
                    listener.onCallConnected(userId);
                    callActive = true;
                    callStartTime = System.currentTimeMillis();
                }
            }
            @Override public void onIceConnectionChange(PeerConnection.IceConnectionState state) {
                Log.d(TAG, "ICE [" + userId + "]: " + state);
                if (state == PeerConnection.IceConnectionState.FAILED ||
                    state == PeerConnection.IceConnectionState.DISCONNECTED) {
                    if (listener != null) listener.onCallEnded(userId);
                    removePeer(userId);
                }
            }
            @Override public void onSignalingChange(PeerConnection.SignalingState s) {}
            @Override public void onIceGatheringChange(PeerConnection.IceGatheringState s) {}
            @Override public void onIceCandidatesRemoved(IceCandidate[] c) {}
            @Override public void onAddStream(MediaStream s) {}
            @Override public void onRemoveStream(MediaStream s) {}
            @Override public void onDataChannel(DataChannel d) {}
            @Override public void onRenegotiationNeeded() {}
            @Override public void onAddTrack(RtpReceiver r, MediaStream[] s) {}
            @Override public void onConnectionChange(PeerConnection.PeerConnectionState s) {}
        });

        if (pc != null) {
            peers.put(userId, pc);
            if (localStream != null) {
                for (org.webrtc.MediaStreamTrack track : localStream.audioTracks)
                    pc.addTrack(track, List.of("localStream"));
                for (org.webrtc.MediaStreamTrack track : localStream.videoTracks)
                    pc.addTrack(track, List.of("localStream"));
            }
        }
        return pc;
    }

    // ── Offer / Answer ─────────────────────────────────────────────────────
    public void createOffer(String userId, SdpCallback callback) {
        PeerConnection pc = peers.get(userId); if (pc == null) return;
        MediaConstraints constraints = new MediaConstraints();
        constraints.mandatory.add(new MediaConstraints.KeyValuePair("OfferToReceiveAudio", "true"));
        constraints.mandatory.add(new MediaConstraints.KeyValuePair("OfferToReceiveVideo", "true"));
        pc.createOffer(new SimpleSdpObserver() {
            @Override public void onCreateSuccess(SessionDescription sdp) {
                pc.setLocalDescription(new SimpleSdpObserver(), sdp);
                callback.onSdp(sdp);
            }
        }, constraints);
    }

    public void createAnswer(String userId, SdpCallback callback) {
        PeerConnection pc = peers.get(userId); if (pc == null) return;
        MediaConstraints constraints = new MediaConstraints();
        pc.createAnswer(new SimpleSdpObserver() {
            @Override public void onCreateSuccess(SessionDescription sdp) {
                pc.setLocalDescription(new SimpleSdpObserver(), sdp);
                callback.onSdp(sdp);
            }
        }, constraints);
    }

    public void setRemoteDescription(String userId, SessionDescription sdp) {
        PeerConnection pc = peers.get(userId); if (pc == null) return;
        pc.setRemoteDescription(new SimpleSdpObserver(), sdp);
        for (IceCandidate c : pendingCandidates) pc.addIceCandidate(c);
        pendingCandidates.clear();
    }

    public void addIceCandidate(String userId, IceCandidate candidate) {
        PeerConnection pc = peers.get(userId);
        if (pc != null && pc.remoteDescription() != null) pc.addIceCandidate(candidate);
        else pendingCandidates.add(candidate);
    }

    // ── Controls ───────────────────────────────────────────────────────────
    public void toggleAudio() {
        isAudioMuted = !isAudioMuted;
        if (localStream != null)
            for (AudioTrack t : localStream.audioTracks) t.setEnabled(!isAudioMuted);
    }

    public void toggleVideo() {
        isVideoMuted = !isVideoMuted;
        if (localStream != null)
            for (VideoTrack t : localStream.videoTracks) t.setEnabled(!isVideoMuted);
    }

    public void toggleSpeaker() {
        isLoudspeakerOn = !isLoudspeakerOn;
        AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        am.setSpeakerphoneOn(isLoudspeakerOn);
    }

    public void switchCamera() {
        if (videoCapturer instanceof org.webrtc.Camera2Capturer) {
            ((org.webrtc.Camera2Capturer) videoCapturer).switchCamera(null);
            isFrontCamera = !isFrontCamera;
        }
    }

    public void initSurfaceView(SurfaceViewRenderer renderer) {
        renderer.init(eglBase.getEglBaseContext(), null);
        renderer.setMirror(true);
    }

    // ── Remove peer ────────────────────────────────────────────────────────
    public void removePeer(String userId) {
        PeerConnection pc = peers.remove(userId);
        if (pc != null) { pc.close(); }
        if (listener != null) listener.onCallEnded(userId);
        if (peers.isEmpty()) endCall();
    }

    // ── End call ───────────────────────────────────────────────────────────
    public void endCall() {
        for (PeerConnection pc : peers.values()) pc.close();
        peers.clear();
        pendingCandidates.clear();
        if (localStream != null) {
            for (AudioTrack t : localStream.audioTracks) t.setEnabled(false);
            for (VideoTrack t : localStream.videoTracks) t.setEnabled(false);
        }
        if (videoCapturer != null) {
            try { videoCapturer.stopCapture(); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            videoCapturer.dispose(); videoCapturer = null;
        }
        if (videoSource != null) { videoSource.dispose(); videoSource = null; }
        if (audioSource != null) { audioSource.dispose(); audioSource = null; }
        if (surfaceTextureHelper != null) { surfaceTextureHelper.dispose(); surfaceTextureHelper = null; }
        localStream = null;
        isAudioMuted = false; isVideoMuted = false;
        isLoudspeakerOn = false; callActive = false;
        // Reset audio to normal mode
        AudioManager am = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        am.setSpeakerphoneOn(false);
        am.setMode(AudioManager.MODE_NORMAL);
        Log.d(TAG, "Call ended, resources released");
    }

    // ── Getters ────────────────────────────────────────────────────────────
    public boolean isCallActive()      { return callActive; }
    public boolean isAudioMuted()      { return isAudioMuted; }
    public boolean isVideoMuted()      { return isVideoMuted; }
    public boolean isLoudspeakerOn()   { return isLoudspeakerOn; }
    public long    getCallDuration()   { return callActive ? (System.currentTimeMillis() - callStartTime) / 1000 : 0; }
    public int     getPeerCount()      { return peers.size(); }
    public EglBase getEglBase()        { return eglBase; }
    public Map<String, PeerConnection> getPeers() { return peers; }

    // ── Cleanup ────────────────────────────────────────────────────────────
    public void dispose() {
        endCall();
        if (factory != null) { factory.dispose(); factory = null; }
        if (eglBase  != null) { eglBase.release();  eglBase  = null; }
        instance = null;
    }

    // ── Interfaces ─────────────────────────────────────────────────────────
    public interface SdpCallback { void onSdp(SessionDescription sdp); }
}
