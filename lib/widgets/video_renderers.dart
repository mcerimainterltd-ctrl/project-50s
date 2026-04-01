import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';

class XameVideoView extends StatelessWidget {
  final RTCVideoRenderer renderer;
  final bool isLocal;

  const XameVideoView({super.key, required this.renderer, this.isLocal = false});

  @override
  Widget build(BuildContext context) {
    return Container(
      color: Colors.black,
      child: RTCVideoView(
        renderer,
        objectFit: RTCVideoViewObjectFit.RTCVideoViewObjectFitCover,
        mirror: isLocal, // Mirror the front camera for the user
      ),
    );
  }
}
