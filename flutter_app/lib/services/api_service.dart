import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import '../models/app_settings.dart';
import '../models/chat_message.dart';

class ApiService {
  final Dio _dio = Dio();

  /// 发送聊天消息并以 Stream 形式实时返回（支持 DeepSeek-R1 思考链 + 正文双流拼接）
  Stream<Map<String, dynamic>> streamChatCompletion({
    required List<ChatMessage> history,
    required AppSettings settings,
  }) async* {
    final baseUrl = settings.customBaseUrl.isNotEmpty
        ? settings.customBaseUrl.trim()
        : 'https://api.deepseek.com';

    final apiKey = settings.deepSeekApiKey.isNotEmpty
        ? settings.deepSeekApiKey.trim()
        : settings.customApiKey.trim();

    final model = settings.activeModel;

    final messagesPayload = history.map((m) {
      return {
        'role': m.role == MessageRole.user ? 'user' : 'assistant',
        'content': m.content,
      };
    }).toList();

    final requestBody = {
      'model': model,
      'messages': messagesPayload,
      'stream': true,
      'temperature': settings.temperature,
      'max_tokens': settings.maxTokens,
    };

    final response = await _dio.post<ResponseBody>(
      '$baseUrl/chat/completions',
      data: requestBody,
      options: Options(
        headers: {
          'Authorization': 'Bearer $apiKey',
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        responseType: ResponseType.stream,
      ),
    );

    final stream = response.data!.stream;
    String buffer = '';

    await for (final Uint8List chunk in stream) {
      final text = utf8.decode(chunk);
      buffer += text;

      final lines = buffer.split('\n');
      buffer = lines.removeLast(); // 保留尚未结束的行

      for (final line in lines) {
        final trimmed = line.trim();
        if (trimmed.isEmpty) continue;
        if (trimmed == 'data: [DONE]') {
          yield {'done': true};
          return;
        }

        if (trimmed.startsWith('data: ')) {
          final jsonStr = trimmed.substring(6);
          try {
            final data = json.decode(jsonStr);
            final choices = data['choices'] as List<dynamic>?;
            if (choices != null && choices.isNotEmpty) {
              final delta = choices[0]['delta'] as Map<String, dynamic>?;
              if (delta != null) {
                final content = delta['content'] as String?;
                final reasoning = delta['reasoning_content'] as String?;

                yield {
                  'content': content ?? '',
                  'reasoning': reasoning ?? '',
                  'done': false,
                };
              }
            }
          } catch (_) {
            // 忽略残缺帧
          }
        }
      }
    }
  }
}
