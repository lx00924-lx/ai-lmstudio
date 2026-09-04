import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:provider/provider.dart';
import '../providers/settings_provider.dart';

class HarnessSettingsScreen extends StatefulWidget {
  const HarnessSettingsScreen({super.key});

  @override
  State<HarnessSettingsScreen> createState() => _HarnessSettingsScreenState();
}

class _HarnessSettingsScreenState extends State<HarnessSettingsScreen> {
  late TextEditingController _tokenCtrl;
  late TextEditingController _harnessUrlCtrl;
  late TextEditingController _workspaceCtrl;
  bool _isRefreshing = false;
  List<String> _workspaces = ['deepseek-agent', 'workspace-main', 'dev-sandbox'];
  List<String> _sessions = ['智能选择 / 自动新建会话 (推荐)', '会话 #101', '会话 #102'];
  String _selectedSession = '智能选择 / 自动新建会话 (推荐)';

  @override
  void initState() {
    super.initState();
    final s = context.read<SettingsProvider>().settings;
    _tokenCtrl = TextEditingController(text: s.harnessToken);
    var urlText = s.harnessServiceUrl.trim();
    if (urlText.startsWith('http://')) {
      urlText = urlText.substring(7);
    } else if (urlText.startsWith('https://')) {
      urlText = urlText.substring(8);
    }
    if (urlText.isEmpty) {
      urlText = '127.0.0.1:3081';
    }
    _harnessUrlCtrl = TextEditingController(text: urlText);
    _workspaceCtrl = TextEditingController(text: s.targetWorkspace);
  }

  @override
  void dispose() {
    _tokenCtrl.dispose();
    _harnessUrlCtrl.dispose();
    _workspaceCtrl.dispose();
    super.dispose();
  }

  void _save() {
    final sp = context.read<SettingsProvider>();
    final s = sp.settings;
    s.harnessToken = _tokenCtrl.text.trim();
    var rawUrl = _harnessUrlCtrl.text.trim();
    if (rawUrl.isEmpty) {
      rawUrl = '127.0.0.1:3081';
    }
    if (!rawUrl.startsWith('http://') && !rawUrl.startsWith('https://')) {
      s.harnessServiceUrl = 'http://$rawUrl';
    } else {
      s.harnessServiceUrl = rawUrl;
    }
    s.targetWorkspace = _workspaceCtrl.text.trim();
    sp.updateSettings(s);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Harness 桥接设置已保存')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sp = context.watch<SettingsProvider>();
    final s = sp.settings;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('DeepSeek Harness 设置'),
        actions: [
          IconButton(
            icon: const Icon(Icons.check),
            tooltip: '保存',
            onPressed: _save,
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // 桥接状态与模式
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.computer, color: Color(0xFF0284C7)),
                      const SizedBox(width: 8),
                      const Text(
                        '本地 Agent 桥接设置 (DeepSeek Harness)',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                      ),
                      const Spacer(),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: s.isHarnessOnline
                              ? Colors.green.withOpacity(0.2)
                              : Colors.grey.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(
                              Icons.circle,
                              size: 10,
                              color: s.isHarnessOnline ? Colors.green : Colors.grey,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              s.isHarnessOnline ? '桥接在线' : '桥接离线',
                              style: TextStyle(
                                fontSize: 12,
                                color: s.isHarnessOnline ? Colors.green : Colors.grey,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('默认 Agent 模式', style: TextStyle(fontSize: 14)),
                    subtitle: Text(
                      s.defaultAgentMode ? '已开启（优先执行电脑本地 Agent 操作）' : '已关闭（直接与 App 模型对话）',
                      style: const TextStyle(fontSize: 12),
                    ),
                    value: s.defaultAgentMode,
                    onChanged: (val) {
                      s.defaultAgentMode = val;
                      sp.updateSettings(s);
                    },
                  ),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _tokenCtrl,
                          decoration: const InputDecoration(
                            labelText: '配对 Token',
                            border: OutlineInputBorder(),
                            isDense: true,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      IconButton(
                        icon: const Icon(Icons.refresh),
                        tooltip: '重置注销',
                        onPressed: () {
                          final newToken = 'agent_${DateTime.now().millisecondsSinceEpoch.toString().substring(6)}';
                          _tokenCtrl.text = newToken;
                          s.harnessToken = newToken;
                          sp.updateSettings(s);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('已重新生成配对 Token')),
                          );
                        },
                      ),
                      IconButton(
                        icon: const Icon(Icons.copy),
                        tooltip: '复制',
                        onPressed: () {
                          Clipboard.setData(ClipboardData(text: _tokenCtrl.text.trim()));
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Token 已复制到剪贴板')),
                          );
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Container(
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: Colors.amber.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.amber.withOpacity(0.3)),
                    ),
                    child: const Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('🛡️ 安全防护与白名单：', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: Colors.amber)),
                        SizedBox(height: 2),
                        Text(
                          '桥接脚本内置严格接口白名单（仅允许标准对话转发），禁止篡改系统与插件；纯内存运行，不持久化任何对话与日志。',
                          style: TextStyle(fontSize: 11, color: Colors.amber),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _harnessUrlCtrl,
                    decoration: const InputDecoration(
                      labelText: 'Harness 服务地址',
                      prefixText: 'http://',
                      hintText: '127.0.0.1:3081',
                      border: OutlineInputBorder(),
                      helperText: '固定协议头 http://，默认预填 127.0.0.1:3081',
                      isDense: true,
                    ),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // 本地工作区与会话列表
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Text(
                        '本地工作区与会话列表',
                        style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold),
                      ),
                      const Spacer(),
                      OutlinedButton.icon(
                        icon: _isRefreshing
                            ? const SizedBox(
                                width: 12,
                                height: 12,
                                child: CircularProgressIndicator(strokeWidth: 2),
                              )
                            : const Icon(Icons.refresh, size: 14),
                        label: const Text('刷新列表', style: TextStyle(fontSize: 12)),
                        onPressed: () async {
                          setState(() => _isRefreshing = true);
                          await Future.delayed(const Duration(milliseconds: 600));
                          setState(() => _isRefreshing = false);
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('已刷新电脑本地工作区')),
                          );
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _workspaceCtrl,
                    decoration: const InputDecoration(
                      labelText: '目标工作区',
                      hintText: 'deepseek-agent',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  DropdownButtonFormField<String>(
                    value: _selectedSession,
                    decoration: const InputDecoration(
                      labelText: '目标会话',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                    items: _sessions.map((s) {
                      return DropdownMenuItem(value: s, child: Text(s, style: const TextStyle(fontSize: 13)));
                    }).toList(),
                    onChanged: (val) {
                      if (val != null) setState(() => _selectedSession = val);
                    },
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // 本地启动程序引导
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('电脑端启动命令 (免公网 IP，安全长连接)', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(10),
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF0F172A) : const Color(0xFFF8FAFC),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.grey.withOpacity(0.3)),
                    ),
                    child: Text(
                      'python deepseek_bridge.py --token "${_tokenCtrl.text.trim()}" --harness-url "${_harnessUrlCtrl.text.trim()}"',
                      style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                    ),
                  ),
                  const SizedBox(height: 8),
                  Align(
                    alignment: Alignment.centerRight,
                    child: TextButton.icon(
                      icon: const Icon(Icons.copy, size: 16),
                      label: const Text('复制命令'),
                      onPressed: () {
                        Clipboard.setData(ClipboardData(
                          text: 'python deepseek_bridge.py --token "${_tokenCtrl.text.trim()}" --harness-url "${_harnessUrlCtrl.text.trim()}"',
                        ));
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('启动命令已复制')),
                        );
                      },
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
