package com.xamepage.app.utils

object Constants {

    // ── App ────────────────────────────────────────────────────────────────
    const val APP_VERSION = "2.1"

    // ── Server ─────────────────────────────────────────────────────────────
    const val SERVER_URL = "https://project-50s.onrender.com"

    // ── Storage keys ───────────────────────────────────────────────────────
    const val KEY_USER     = "xame:user"
    const val KEY_CONTACTS = "xame:contacts"
    const val KEY_DRAFTS   = "xame:drafts"
    const val KEY_SETTINGS = "xame:settings"
    const val KEY_SOUND    = "xame:sound"
    const val KEY_VIBRATION= "xame:vibration"
    fun keyChat(id: String) = "xame:chat:$id"

    // ── File upload limits ─────────────────────────────────────────────────
    const val MAX_FILE_SIZE = 500 * 1024 * 1024L // 500 MB

    val ALLOWED_IMAGE_TYPES    = listOf("image/jpeg","image/jpg","image/png","image/gif","image/webp")
    val ALLOWED_VIDEO_TYPES    = listOf("video/mp4","video/webm","video/ogg")
    val ALLOWED_AUDIO_TYPES    = listOf("audio/mpeg","audio/wav","audio/ogg","audio/webm","audio/mp4")
    val ALLOWED_DOCUMENT_TYPES = listOf(
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "text/plain","text/javascript","application/javascript",
        "text/css","text/html",
        "application/vnd.android.package-archive"
    )

    // ── WebRTC ─────────────────────────────────────────────────────────────
    val ICE_SERVERS = listOf(
        "stun:stun.l.google.com:19302",
        "turn:openrelay.metered.ca:80"
    )
    const val TURN_USERNAME   = "openrelayproject"
    const val TURN_CREDENTIAL = "openrelayproject"

    // ── Socket / reconnection ──────────────────────────────────────────────
    const val MAX_RECONNECT_ATTEMPTS = 10
    const val RECONNECT_BASE_DELAY   = 1500L  // ms
    const val HEARTBEAT_INTERVAL     = 30000L // ms

    // ── Message pagination ─────────────────────────────────────────────────
    const val MESSAGE_PAGE_SIZE = 100

    // ── VAPID ──────────────────────────────────────────────────────────────
    const val VAPID_PUBLIC_KEY =
        "BKRD94hqX829Dy5EobzJRdUJRMMGJp_Irma-KBPOAtgn6CvK-FvSVnjRuAlelMfqBrKVsd47HvpciMr_ZpBenL8"

    // ── Vibration ──────────────────────────────────────────────────────────
    val VIBRATION_PATTERN = longArrayOf(0L, 150L, 80L, 150L)
}
