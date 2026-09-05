import 'dart:convert';
import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:file_picker/file_picker.dart';

/// 图片选择与通用编解码工具类，兼容 Android / Windows / iOS / Web
class ImagePickerHelper {
  /// 拉起系统文件/图片选择器，并返回持久化的 Base64 字符串（或带有前缀的 Data URI）
  static Future<String?> pickImageAsBase64() async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'],
        withData: true, // 确保在全平台都能直接获得内存 bytes
      );

      if (result == null || result.files.isEmpty) {
        return null;
      }

      final file = result.files.first;
      Uint8List? bytes = file.bytes;

      // 如果部分桌面端/原生端没有直接返回 bytes，但有 path
      if (bytes == null && file.path != null && file.path!.isNotEmpty) {
        final ioFile = File(file.path!);
        if (await ioFile.exists()) {
          bytes = await ioFile.readAsBytes();
        }
      }

      if (bytes == null || bytes.isEmpty) {
        return null;
      }

      // 根据扩展名自动组装 Data URI 前缀，便于各端通用渲染
      final ext = (file.extension ?? 'png').toLowerCase();
      final mime = ext == 'jpg' || ext == 'jpeg'
          ? 'image/jpeg'
          : ext == 'webp'
              ? 'image/webp'
              : ext == 'gif'
                  ? 'image/gif'
                  : 'image/png';

      final base64String = base64Encode(bytes);
      return 'data:$mime;base64,$base64String';
    } catch (e) {
      debugPrint('ImagePickerHelper error: $e');
      return null;
    }
  }

  /// 将可能包含 data:image/...;base64, 的字符串解码为 Uint8List
  static Uint8List? decodeBase64Image(String? source) {
    if (source == null || source.trim().isEmpty) return null;
    try {
      String cleanBase64 = source.trim();
      if (cleanBase64.contains(',')) {
        cleanBase64 = cleanBase64.split(',').last;
      }
      return base64Decode(cleanBase64);
    } catch (e) {
      debugPrint('decodeBase64Image error: $e');
      return null;
    }
  }
}
