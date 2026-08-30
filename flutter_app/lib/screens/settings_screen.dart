import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/app_settings.dart';
import '../providers/settings_provider.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late TextEditingController _apiKeyCtrl;
  late TextEditingController _baseUrlCtrl;
  late TextEditingController _bridgeUrlCtrl;
  late TextEditingController _tokenCtrl;
  late TextEditingController _workspaceCtrl;

  @override
  void initState() {
    super.initState();
    final settings = context.read<SettingsProvider>().settings;
    _apiKeyCtrl = TextEditingController(text: settings.deepSeekApiKey);
    _baseUrlCtrl = TextEditingController(text: settings.customBaseUrl);
    _bridgeUrlCtrl = TextEditingController(text: settings.localBridgeWsUrl);
    _tokenCtrl = TextEditingController(text: settings.localAgentToken);
    _workspaceCtrl = TextEditingController(text: settings.targetWorkspace);
  }

  @override
  void dispose() {
    _apiKeyCtrl.dispose();
    _baseUrlCtrl.dispose();
    _bridgeUrlCtrl.dispose();
    _tokenCtrl.dispose();
    _workspaceCtrl.dispose();
    super.dispose();
  }

  void _saveSettings() {
    final provider = context.read<SettingsProvider>();
    final current = provider.settings;

    current.deepSeekApiKey = _apiKeyCtrl.text.trim();
    current.customBaseUrl = _baseUrlCtrl.text.trim();
    current.localBridgeWsUrl = _bridgeUrlCtrl.text.trim();
    current.localAgentToken = _tokenCtrl.text.trim();
    current.targetWorkspace = _workspaceCtrl.text.trim();

    provider.updateSettings(current);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('设置已保存并持久化至本地数据库')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final settings = context.watch<SettingsProvider>().settings;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('系统与模型设置'),
        actions: [
          IconButton(
            icon: const Icon(Icons.check),
            onPressed: _saveSettings,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // 主题模式
          Card(
            child: SwitchListTile(
              title: const Text('深色模式 (Dark Theme)'),
              subtitle: const Text('跟随系统或切换纯黑科技暗调'),
              value: settings.isDarkMode,
              onChanged: (_) => context.read<SettingsProvider>().toggleTheme(),
            ),
          ),
          const SizedBox(height: 16),

          // API 配置
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'DeepSeek 官方 API 配置',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _apiKeyCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: 'DeepSeek API Key',
                      hintText: 'sk-xxxxxxxx',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _baseUrlCtrl,
                    decoration: const InputDecoration(
                      labelText: 'API Base URL',
                      hintText: 'https://api.deepseek.com',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // 本地桥接与 Agent 配置
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    '本地桥接服务配置 (Local Bridge)',
                    style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _bridgeUrlCtrl,
                    decoration: const InputDecoration(
                      labelText: 'WebSocket 桥接地址',
                      hintText: 'ws://127.0.0.1:8765',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _tokenCtrl,
                    decoration: const InputDecoration(
                      labelText: '本地桥接 Token',
                      hintText: 'lx_agent_token_888',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _workspaceCtrl,
                    decoration: const InputDecoration(
                      labelText: '目标工作区名称',
                      hintText: 'deepseek-agent',
                      border: OutlineInputBorder(),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
