class XameUser {
  final String xameId;
  final String firstName;
  final String lastName;

  XameUser({required this.xameId, required this.firstName, required this.lastName});

  factory XameUser.fromJson(Map<String, dynamic> json) {
    return XameUser(
      xameId: json['xameId'] ?? json['id'] ?? '',
      firstName: json['firstName'] ?? '',
      lastName: json['lastName'] ?? '',
    );
  }
}
