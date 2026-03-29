package com.xamepage.app.data.models

data class Contact(
    val id: String = "",
    var name: String = "",
    var status: String = "",
    var profilePic: String? = null,
    var isProfilePicHidden: Boolean = false,
    var online: Boolean = false,
    var unreadCount: Int = 0,
    var lastInteractionTs: Long = 0L,
    var lastInteractionPreview: String = "",
    val createdAt: Long = 0L,
    val lastAt: Long = 0L
) {
    val initials get() = name.split(" ")
        .mapNotNull { it.firstOrNull()?.toString() }
        .take(2).joinToString("").uppercase()
}
