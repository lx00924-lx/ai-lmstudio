import 'dart:convert';
import 'package:hive/hive.dart';
import '../models/chat_message.dart';
import '../models/chat_session.dart';
import '../models/app_settings.dart';

class StorageService {
  static final StorageService instance = StorageService._();
  StorageService._();

  Box? get _sessionsBox => Hive.isBoxOpen('sessions_box') ? Hive.box('sessions_box') : null;
  Box? get _messagesBox => Hive.isBoxOpen('messages_box') ? Hive.box('messages_box') : null;
  Box? get _settingsBox => Hive.isBoxOpen('settings_box') ? Hive.box('settings_box') : null;

  // --- 会话相关 ---
  List<ChatSession> getAllSessions() {
    final box = _sessionsBox;
    if (box == null) return [];
    final List<ChatSession> list = [];
    for (var key in box.keys) {
      final val = box.get(key);
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
    final box = _sessionsBox;
    if (box != null) {
      await box.put(session.id, session.toMap());
    }
  }

  Future<void> deleteSession(String sessionId) async {
    final sBox = _sessionsBox;
    if (sBox != null) {
      await sBox.delete(sessionId);
    }
    // 级联删除该会话的所有消息
    final mBox = _messagesBox;
    if (mBox != null) {
      final keysToDelete = <dynamic>[];
      for (var key in mBox.keys) {
        final msg = mBox.get(key);
        if (msg != null && msg['sessionId'] == sessionId) {
          keysToDelete.add(key);
        }
      }
      await mBox.deleteAll(keysToDelete);
    }
  }

  // --- 消息相关 ---
  List<ChatMessage> getMessagesForSession(String sessionId) {
    final box = _messagesBox;
    if (box == null) return [];
    final List<ChatMessage> list = [];
    for (var key in box.keys) {
      final val = box.get(key);
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
    final box = _messagesBox;
    if (box != null) {
      await box.put(message.id, message.toMap());
    }
  }

  Future<void> clearAllData() async {
    final sBox = _sessionsBox;
    if (sBox != null) await sBox.clear();
    final mBox = _messagesBox;
    if (mBox != null) await mBox.clear();
  }

  // --- 设置持久化 ---
  AppSettings loadSettings() {
    try {
      final box = _settingsBox;
      if (box != null) {
        final val = box.get('app_settings');
        if (val != null && val is Map) {
          return AppSettings.fromMap(val);
        }
      }
    } catch (_) {}
    return AppSettings();
  }

  Future<void> saveSettings(AppSettings settings) async {
    try {
      final box = _settingsBox;
      if (box != null) {
        await box.put('app_settings', settings.toMap());
      }
    } catch (_) {}
  }
}
