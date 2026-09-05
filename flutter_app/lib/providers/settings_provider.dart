import 'package:flutter/material.dart';
import '../models/app_settings.dart';
import '../services/storage_service.dart';

class SettingsProvider extends ChangeNotifier {
  late AppSettings _settings;

  SettingsProvider() {
    _settings = StorageService.instance.loadSettings();
  }

  AppSettings get settings => _settings;
  bool get isLoggedIn => _settings.isLoggedIn;
  bool get isDarkMode => _settings.isDarkMode;
  bool get enableSplash => _settings.enableSplash;
  String get activeModelDisplayName => _settings.activeModelDisplayName;
  String get activeEndpointId => _settings.activeEndpointId;
  ApiModelEndpoint? get activeEndpoint => _settings.activeEndpoint;
  String get syncUserId => _settings.loginAccount.trim().isNotEmpty ? _settings.loginAccount.trim() : 'default_user';

  void toggleTheme() {
    _settings.isDarkMode = !_settings.isDarkMode;
    _save();
  }

  /// 在主界面下拉弹窗中切换选中的 API 卡片
  void selectEndpoint(ApiModelEndpoint endpoint) {
    _settings.activeEndpointId = endpoint.id;
    _settings.activeModelDisplayName = endpoint.cardName;
    _save();
  }

  /// 添加新的 API 模型卡片
  void addApiEndpoint(ApiModelEndpoint endpoint) {
    _settings.apiEndpoints.add(endpoint);
    if (_settings.apiEndpoints.length == 1) {
      _settings.activeEndpointId = endpoint.id;
      _settings.activeModelDisplayName = endpoint.cardName;
    }
    _save();
  }

  /// 更新现有 API 模型卡片
  void updateApiEndpoint(ApiModelEndpoint endpoint) {
    final idx = _settings.apiEndpoints.indexWhere((e) => e.id == endpoint.id);
    if (idx != -1) {
      _settings.apiEndpoints[idx] = endpoint;
      if (_settings.activeEndpointId == endpoint.id) {
        _settings.activeModelDisplayName = endpoint.cardName;
      }
      _save();
    }
  }

  /// 删除 API 模型卡片
  void removeApiEndpoint(String endpointId) {
    _settings.apiEndpoints.removeWhere((e) => e.id == endpointId);
    if (_settings.activeEndpointId == endpointId && _settings.apiEndpoints.isNotEmpty) {
      _settings.activeEndpointId = _settings.apiEndpoints.first.id;
      _settings.activeModelDisplayName = _settings.apiEndpoints.first.cardName;
    }
    _save();
  }

  void updateSettings(AppSettings newSettings) {
    _settings = newSettings;
    _save();
  }

  /// 用户登录验证
  bool login(String account, String password) {
    // 若尚未设置密码，或者账号与密码匹配则允许登录
    if (_settings.loginAccount.isEmpty) {
      // 尚未注册账号，提示需先注册
      return false;
    }
    if (_settings.loginAccount == account &&
        (_settings.accountPassword.isEmpty || _settings.accountPassword == password)) {
      _settings.isLoggedIn = true;
      _save();
      return true;
    }
    return false;
  }

  /// 用户注册
  void register({
    required String account,
    required String userName,
    required String password,
  }) {
    _settings.loginAccount = account.trim();
    _settings.userName = userName.trim().isNotEmpty ? userName.trim() : '用户_${account.trim()}';
    _settings.accountPassword = password;
    _settings.isLoggedIn = true;
    _save();
  }

  /// 退出登录
  void logout() {
    _settings.isLoggedIn = false;
    _save();
  }

  void _save() {
    StorageService.instance.saveSettings(_settings);
    notifyListeners();
  }
}
