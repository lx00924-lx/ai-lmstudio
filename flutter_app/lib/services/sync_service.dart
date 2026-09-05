import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:dio/dio.dart';
import '../models/chat_message.dart';
import '../models/chat_session.dart';
import 'storage_service.dart';

/// 后台静默实时同步服务：实现 Flutter 客户端与服务端的自动增量同步
class SyncService {
  static final SyncService instance = SyncService._();
  SyncService._();

  final Dio _dio = Dio(
    BaseOptions(
      connectTimeout: const Duration(seconds: 10),
      receiveTimeout: const Duration(seconds: 15),
      sendTimeout: const Duration(seconds: 15),
    ),
  );

  bool _isSyncing = false;

  /// 获取服务器基地址（Web 端自适应 origin，App 原生端连接生产服务端）
  String get serverBaseUrl {
    if (kIsWeb) {
      final uri = Uri.base;
      if (uri.host.isNotEmpty) {
        final portPart = uri.hasPort && uri.port != 80 && uri.port != 443 ? ':${uri.port}' : '';
        return '${uri.scheme}://${uri.host}$portPart';
      }
    }
    return 'https://lx00924ai.top';
  }

  /// 后台静默从服务器拉取历史消息并合并到本地 Hive
  Future<int> pullAndMergeMessages({
    required String userId,
    Function()? onNewMessagesImported,
  }) async {
    final cleanUserId = userId.trim();
    if (cleanUserId.isEmpty || _isSyncing) return 0;
    _isSyncing = true;
    int importedCount = 0;

    try {
      final url = '$serverBaseUrl/api/messages/$cleanUserId';
      final response = await _dio.get(url);

      if (response.statusCode == 200 && response.data is List) {
        final list = response.data as List;
        final storage = StorageService.instance;

        final List<ChatMessage> newMessages = [];
        final Map<String, ChatSession> neededSessions = {};

        for (var item in list) {
          if (item is Map) {
            try {
              final msg = ChatMessage.fromMap(item);
              if (msg.id.isNotEmpty && !storage.hasMessage(msg.id)) {
                newMessages.add(msg);

                // 检查对应 session 是否存在
                if (!storage.hasSession(msg.sessionId) && !neededSessions.containsKey(msg.sessionId)) {
                  final title = msg.content.length > 20
                      ? '${msg.content.substring(0, 20)}...'
                      : (msg.content.isNotEmpty ? msg.content : '云端同步会话');
                  neededSessions[msg.sessionId] = ChatSession(
                    id: msg.sessionId,
                    title: title,
                    createdAt: msg.createdAt,
                    updatedAt: msg.createdAt,
                  );
                }
              }
            } catch (_) {}
          }
        }

        // 补全缺失的会话
        for (var session in neededSessions.values) {
          await storage.saveSession(session);
        }

        // 保存新消息
        for (var msg in newMessages) {
          await storage.saveMessage(msg);
          importedCount++;
        }

        if (importedCount > 0 && onNewMessagesImported != null) {
          onNewMessagesImported();
        }
      }
    } catch (e) {
      // 静默处理，不中断任何前台交互
      debugPrint('[SyncService] Pull messages silent error: $e');
    } finally {
      _isSyncing = false;
    }

    return importedCount;
  }

  /// 实时静默推送单条或多条消息至服务器
  Future<void> pushMessages({
    required String userId,
    required List<ChatMessage> messages,
  }) async {
    final cleanUserId = userId.trim();
    if (cleanUserId.isEmpty || messages.isEmpty) return;

    // 过滤掉未生成完的空流式消息
    final validMessages = messages
        .where((m) => !m.isStreaming && (m.content.isNotEmpty || (m.attachments != null && m.attachments!.isNotEmpty)))
        .map((m) => m.toMap())
        .toList();

    if (validMessages.isEmpty) return;

    try {
      final url = '$serverBaseUrl/api/sync-messages';
      await _dio.post(
        url,
        data: {
          'userId': cleanUserId,
          'messages': validMessages,
        },
      );
    } catch (e) {
      debugPrint('[SyncService] Push messages silent error: $e');
    }
  }

  /// 实时静默删除云端单条消息
  Future<void> deleteMessage({
    required String userId,
    required String messageId,
  }) async {
    final cleanUserId = userId.trim();
    final cleanMessageId = messageId.trim();
    if (cleanUserId.isEmpty || cleanMessageId.isEmpty) return;

    try {
      final url = '$serverBaseUrl/api/delete-message';
      await _dio.post(
        url,
        data: {
          'userId': cleanUserId,
          'messageId': cleanMessageId,
        },
      );
    } catch (e) {
      debugPrint('[SyncService] Delete message silent error: $e');
    }
  }

  /// 实时静默删除云端会话
  Future<void> deleteSession({
    required String userId,
    required String sessionId,
  }) async {
    final cleanUserId = userId.trim();
    final cleanSessionId = sessionId.trim();
    if (cleanUserId.isEmpty || cleanSessionId.isEmpty) return;

    try {
      final url = '$serverBaseUrl/api/delete-session';
      await _dio.post(
        url,
        data: {
          'userId': cleanUserId,
          'sessionId': cleanSessionId,
        },
      );
    } catch (e) {
      debugPrint('[SyncService] Delete session silent error: $e');
    }
  }
}
