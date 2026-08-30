import 'package:flutter/material.dart';
import '../models/app_settings.dart';
import '../services/storage_service.dart';

class SettingsProvider extends ChangeNotifier {
  late AppSettings _settings;

  SettingsProvider() {
    _settings = StorageService.instance.loadSettings();
  }

  AppSettings get settings => _settings;
  bool get isDarkMode => _settings.isDarkMode;
  String get activeModel => _settings.activeModel;

  void toggleTheme() {
    _settings.isDarkMode = !_settings.isDarkMode;
    _save();
  }

  void updateModel(String modelId) {
    _settings.activeModel = modelId;
    _save();
  }

  void updateSettings(AppSettings newSettings) {
    _settings = newSettings;
    _save();
  }

  void _save() {
    StorageService.instance.saveSettings(_settings);
    notifyListeners();
  }
}
