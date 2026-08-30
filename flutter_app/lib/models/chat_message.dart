import 'dart:convert';

enum MessageRole { user, assistant, system }

class ChatMessage {
  final String id;
  final String sessionId;
  final MessageRole role;
  String content;
  String? reasoningContent; // 思考链过程
  final DateTime createdAt;
  bool isStreaming;
  int? elapsedSeconds;
  List<String>? attachments;

  ChatMessage({
    required this.id,
    required this.sessionId,
    required this.role,
    required this.content,
    this.reasoningContent,
    DateTime? createdAt,
    this.isStreaming = false,
    this.elapsedSeconds,
    this.attachments,
  }) : createdAt = createdAt ?? DateTime.now();

  Map<String, dynamic> toMap() {
    return {
      'id': id,
      'sessionId': sessionId,
      'role': role.name,
      'content': content,
      'reasoningContent': reasoningContent,
      'createdAt': createdAt.toIso8601String(),
      'elapsedSeconds': elapsedSeconds,
      'attachments': attachments,
    };
  }

  factory ChatMessage.fromMap(Map<dynamic, dynamic> map) {
    return ChatMessage(
      id: map['id'] as String,
      sessionId: map['sessionId'] as String,
      role: MessageRole.values.byName(map['role'] as String),
      content: map['content'] as String,
      reasoningContent: map['reasoningContent'] as String?,
      createdAt: DateTime.parse(map['createdAt'] as String),
      elapsedSeconds: map['elapsedSeconds'] as int?,
      attachments: (map['attachments'] as List<dynamic>?)?.map((e) => e.toString()).toList(),
    );
  }

  String toJson() => json.encode(toMap());
  factory ChatMessage.fromJson(String source) => ChatMessage.fromMap(json.decode(source));
}
