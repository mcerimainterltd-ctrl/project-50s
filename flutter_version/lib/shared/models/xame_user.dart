class XameUser {
  final String xameId;
  final String firstName;
  final String lastName;
  final String? email;

  XameUser({required this.xameId, required this.firstName, required this.lastName, this.email});

  factory XameUser.fromMap(Map<String, dynamic> map) {
    return XameUser(
      xameId: map['xameId'] ?? '',
      firstName: map['firstName'] ?? '',
      lastName: map['lastName'] ?? '',
      email: map['email'],
    );
  }
}
