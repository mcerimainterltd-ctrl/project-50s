package com.xamepage.app.data.models

data class Call(
    val id: String = "",
    val contactId: String = "",
    val contactName: String = "",
    val type: String = "",          // "voice" or "video"
    val direction: String = "",     // "outgoing" or "incoming"
    var status: String = "missed",  // "missed", "answered", "declined"
    val timestamp: Long = 0L,
    var duration: Long = 0L,        // seconds
    val seen: Boolean = false
) {
    val formattedDuration: String get() {
        if (duration <= 0L) return ""
        val h = duration / 3600
        val m = (duration % 3600) / 60
        val s = duration % 60
        return if (h > 0) "%d:%02d:%02d".format(h, m, s)
        else "%d:%02d".format(m, s)
    }
}
