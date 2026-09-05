import 'dart:async';
import 'package:flutter/material.dart';
import 'package:uuid/uuid.dart';
import '../models/chat_message.dart';
import '../models/chat_session.dart';
import '../services/api_service.dart';
import '../services/storage_service.dart';
import 'settings_provider.dart';

class ChatProvider extends ChangeNotifier {
  final SettingsProvider settingsProvider;
  final ApiService _apiService = ApiService();
  final StorageService _storage = StorageService.instance;

  List<ChatSession> _sessions = [];
  ChatSession? _currentSession;
  List<ChatMessage> _messages = [];
  ChatMessage? _quotedMessage;
  bool _isGenerating = false;
  StreamSubscription? _streamSub;

  ChatProvider(this.settingsProvider) {
    loadSessions();
  }

  List<ChatSession> get sessions => _sessions;
  ChatSession? get currentSession => _currentSession;
  List<ChatMessage> get messages => _messages;
  ChatMessage? get quotedMessage => _quotedMessage;
  bool get isGenerating => _isGenerating;

  void setQuotedMessage(ChatMessage? msg) {
    _quotedMessage = msg;
    notifyListeners();
  }

  void clearQuotedMessage() {
    _quotedMessage = null;
    notifyListeners();
  }

  void deleteMessage(String messageId) {
    _storage.deleteMessage(messageId);
    _messages.removeWhere((m) => m.id == messageId);
    if (_quotedMessage?.id == messageId) {
      _quotedMessage = null;
    }
    notifyListeners();
  }

  void reloadFromStorage() {
    loadSessions();
  }

  void loadSessions() {
    _sessions = _storage.getAllSessions();
    if (_sessions.isNotEmpty) {
      selectSession(_sessions.first);
    } else {
      createNewSession();
    }
  }

  void createNewSession({String? title}) {
    final newSession = ChatSession(
      id: const Uuid().v4(),
      title: title ?? '新对话 ${DateTime.now().hour}:${DateTime.now().minute.toString().padLeft(2, '0')}',
      model: settingsProvider.activeModelDisplayName,
    );
    _storage.saveSession(newSession);
    _sessions.insert(0, newSession);
    _currentSession = newSession;
    _messages = [];
    notifyListeners();
  }

  void selectSession(ChatSession session) {
    _currentSession = session;
    _messages = _storage.getMessagesForSession(session.id);
    notifyListeners();
  }

  void deleteSession(String sessionId) {
    _storage.deleteSession(sessionId);
    _sessions.removeWhere((s) => s.id == sessionId);
    if (_currentSession?.id == sessionId) {
      if (_sessions.isNotEmpty) {
        selectSession(_sessions.first);
      } else {
        createNewSession();
      }
    } else {
      notifyListeners();
    }
  }

  Future<void> sendMessage(String text, {List<String>? attachments}) async {
    if (text.trim().isEmpty || _isGenerating) return;
    if (_currentSession == null) createNewSession();

    final userMsg = ChatMessage(
      id: const Uuid().v4(),
      sessionId: _currentSession!.id,
      role: MessageRole.user,
      content: text.trim(),
      attachments: attachments,
    );

    _messages.add(userMsg);
    await _storage.saveMessage(userMsg);

    // 自动更新会话标题（若为第一条消息）
    if (_messages.length == 1) {
      _currentSession!.title = text.length > 20 ? '${text.substring(0, 20)}...' : text;
      await _storage.saveSession(_currentSession!);
    }

    final assistantMsg = ChatMessage(
      id: const Uuid().v4(),
      sessionId: _currentSession!.id,
      role: MessageRole.assistant,
      content: '',
      reasoningContent: '',
      isStreaming: true,
    );

    _messages.add(assistantMsg);
    _isGenerating = true;
    notifyListeners();

    final startTime = DateTime.now();

    try {
      final stream = _apiService.streamChatCompletion(
        history: _messages.where((m) => !m.isStreaming).toList(),
        settings: settingsProvider.settings,
      );

      _streamSub = stream.listen(
        (chunk) {
          if (chunk['done'] == true) {
            assistantMsg.isStreaming = false;
            assistantMsg.elapsedSeconds = DateTime.now().difference(startTime).inSeconds;
            _storage.saveMessage(assistantMsg);
            _isGenerating = false;
            notifyListeners();
            return;
          }

          final contentDelta = chunk['content'] as String? ?? '';
          final reasoningDelta = chunk['reasoning'] as String? ?? '';

          if (reasoningDelta.isNotEmpty) {
            assistantMsg.reasoningContent = (assistantMsg.reasoningContent ?? '') + reasoningDelta;
          }
          if (contentDelta.isNotEmpty) {
            assistantMsg.content += contentDelta;
          }
          notifyListeners();
        },
        onError: (err) {
          assistantMsg.isStreaming = false;
          assistantMsg.content += '\n\n*(请求异常，请检查 API Key 或网络设置)*';
          _storage.saveMessage(assistantMsg);
          _isGenerating = false;
          notifyListeners();
        },
        onDone: () {
          assistantMsg.isStreaming = false;
          assistantMsg.elapsedSeconds = DateTime.now().difference(startTime).inSeconds;
          _storage.saveMessage(assistantMsg);
          _isGenerating = false;
          notifyListeners();
        },
      );
    } catch (e) {
      assistantMsg.isStreaming = false;
      assistantMsg.content = '发送失败: $e';
      _isGenerating = false;
      notifyListeners();
    }
  }

  void stopGeneration() {
    _streamSub?.cancel();
    _isGenerating = false;
    if (_messages.isNotEmpty && _messages.last.isStreaming) {
      _messages.last.isStreaming = false;
      _storage.saveMessage(_messages.last);
    }
    notifyListeners();
  }
}
