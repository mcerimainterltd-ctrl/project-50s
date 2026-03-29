package com.xamepage.app.utils

import android.net.Uri
import com.xamepage.app.data.models.Contact
import com.xamepage.app.data.models.Message
import com.xamepage.app.data.models.User
import org.webrtc.PeerConnection
import org.webrtc.MediaStream

object AppState {

    // ── Auth / user ────────────────────────────────────────────────────────
    var currentUser: User? = null
    var contacts: MutableList<Contact> = mutableListOf()
    var drafts: MutableMap<String, String> = mutableMapOf()
    var activeContactId: String? = null

    // ── Chat history cache ─────────────────────────────────────────────────
    var chatHistory: MutableMap<String, MutableList<Message>> = mutableMapOf()

    // ── Message selection ──────────────────────────────────────────────────
    var selectedMessages: MutableList<Message> = mutableListOf()

    // ── Typing indicator ───────────────────────────────────────────────────
    var isTyping: Boolean = false

    // ── Socket ────────────────────────────────────────────────────────────
    var isConnected: Boolean = false
    var reconnectAttempts: Int = 0

    // ── Message pagination ─────────────────────────────────────────────────
    var currentMessagePage: Int = 1
    var isLoadingMoreMessages: Boolean = false

    // ── Sound / vibration feedback ─────────────────────────────────────────
    var soundEnabled: Boolean = true
    var vibrationEnabled: Boolean = true

    // ── WebRTC call state ──────────────────────────────────────────────────
    var peerConnection: PeerConnection? = null
    var localStream: MediaStream? = null
    var remoteStream: MediaStream? = null
    var isAudioMuted: Boolean = false
    var isVideoMuted: Boolean = false
    var isLoudspeakerOn: Boolean = false
    var pendingIceCandidates: MutableList<String> = mutableListOf()

    // ── Active call ────────────────────────────────────────────────────────
    var activeCallContactId: String? = null
    var activeCallType: String? = null // "voice" or "video"
    var callStartTime: Long = 0L

    // ── Camera ────────────────────────────────────────────────────────────
    var isCameraRecording: Boolean = false
    var currentFacingMode: String = "front" // "front" or "back"

    // ── Resource cleanup tracking ──────────────────────────────────────────
    val peerConnections: MutableList<PeerConnection> = mutableListOf()
    val localStreams: MutableList<MediaStream> = mutableListOf()

    // ── Helpers ────────────────────────────────────────────────────────────
    fun reset() {
        currentUser = null
        contacts.clear()
        drafts.clear()
        activeContactId = null
        chatHistory.clear()
        selectedMessages.clear()
        isTyping = false
        isConnected = false
        reconnectAttempts = 0
        peerConnection = null
        localStream = null
        remoteStream = null
        isAudioMuted = false
        isVideoMuted = false
        isLoudspeakerOn = false
        pendingIceCandidates.clear()
        activeCallContactId = null
        activeCallType = null
        callStartTime = 0L
    }
}
