package com.xamepage.app.data.models

data class Message(
    val id: String = "",
    val type: String = "",        // "sent" or "received"
    val content: String = "",
    val mediaUrl: String? = null,
    val mediaType: String? = null,
    val timestamp: Long = 0L,
    var status: String = "sent",  // "sent", "delivered", "seen"
    val replyTo: String? = null,
    val reaction: String? = null,
    val disappearsAt: Long? = null,
    val isDeleted: Boolean = false
)
