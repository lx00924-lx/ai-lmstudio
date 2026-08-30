import 'dart:convert';
import 'package:hive/hive.dart';
import '../models/chat_message.dart';
import '../models/chat_session.dart';
import '../models/app_settings.dart';

class StorageService {
  static final StorageService instance = StorageService._();
  StorageService._();

  Box get _sessionsBox => Hive.box('sessions_box');
  Box get _messagesBox => Hive.box('messages_box');
  Box get _settingsBox => Hive.box('settings_box');

  // --- 会话相关 ---
  List<ChatSession> getAllSessions() {
    final List<ChatSession> list = [];
    for (var key in _sessionsBox.keys) {
      final val = _sessionsBox.get(key);
      if (val != null) {
        try {
          if (val is Map) {
            list.add(ChatSession.fromMap(val));
          } else if (val is String) {
            list.add(ChatSession.fromJson(val));
          }
        } catch (_) {}
      }
    }
    list.sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return list;
  }

  Future<void> saveSession(ChatSession session) async {
    await _sessionsBox.put(session.id, session.toMap());
  }

  Future<void> deleteSession(String sessionId) async {
    await _sessionsBox.delete(sessionId);
    // 级联删除该会话的所有消息
    final keysToDelete = <dynamic>[];
    for (var key in _messagesBox.keys) {
      final msg = _messagesBox.get(key);
      if (msg != null && msg['sessionId'] == sessionId) {
        keysToDelete.add(key);
      }
    }
    await _messagesBox.deleteAll(keysToDelete);
  }

  // --- 消息相关 ---
  List<ChatMessage> getMessagesForSession(String sessionId) {
    final List<ChatMessage> list = [];
    for (var key in _messagesBox.keys) {
      final val = _messagesBox.get(key);
      if (val != null && val['sessionId'] == sessionId) {
        try {
          if (val is Map) {
            list.add(ChatMessage.fromMap(val));
          }
        } catch (_) {}
      }
    }
    list.sort((a, b) => a.createdAt.compareTo(b.createdAt));
    return list;
  }

  Future<void> saveMessage(ChatMessage message) async {
    await _messagesBox.put(message.id, message.toMap());
  }

  Future<void> clearAllData() async {
    await _sessionsBox.clear();
    await _messagesBox.clear();
  }

  // --- 设置持久化 ---
  AppSettings loadSettings() {
    final val = _settingsBox.get('app_settings');
    if (val != null && val is Map) {
      return AppSettings.fromMap(val);
    }
    return AppSettings();
  }

  Future<void> saveSettings(AppSettings settings) async {
    await _settingsBox.put('app_settings', settings.toMap());
  }
}
