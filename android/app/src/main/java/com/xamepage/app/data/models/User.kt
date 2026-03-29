package com.xamepage.app.data.models

data class User(
    val xameId: String = "",
    val firstName: String = "",
    val lastName: String = "",
    val email: String = "",
    val phone: String = "",
    val profilePic: String? = null,
    val status: String = "",
    val token: String = "",
    val createdAt: Long = 0L
) {
    val fullName get() = "$firstName $lastName".trim()
    val initials get() = "${firstName.firstOrNull() ?: ""}${lastName.firstOrNull() ?: ""}".uppercase()
}
