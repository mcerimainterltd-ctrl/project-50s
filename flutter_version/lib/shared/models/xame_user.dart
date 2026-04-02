class XameUser {
  final String xameId;
  final String firstName;
  final String lastName;
  final String? email;
  final String? phone;
  final String? profilePic;
  final String? sessionToken;

  const XameUser({
    required this.xameId,
    required this.firstName,
    required this.lastName,
    this.email,
    this.phone,
    this.profilePic,
    this.sessionToken,
  });

  factory XameUser.fromMap(Map<String, dynamic> m) => XameUser(
    xameId: m['xameId'] as String,
    firstName: m['firstName'] as String? ?? '',
    lastName: m['lastName'] as String? ?? '',
    email: m['email'] as String?,
    phone: m['phone'] as String?,
    profilePic: m['profilePic'] as String?,
    sessionToken: m['sessionToken'] as String?,
  );
}
