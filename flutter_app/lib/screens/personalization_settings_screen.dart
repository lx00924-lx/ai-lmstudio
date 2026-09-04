import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/settings_provider.dart';

class PersonalizationSettingsScreen extends StatefulWidget {
  const PersonalizationSettingsScreen({super.key});

  @override
  State<PersonalizationSettingsScreen> createState() => _PersonalizationSettingsScreenState();
}

class _PersonalizationSettingsScreenState extends State<PersonalizationSettingsScreen> {
  late TextEditingController _splashTitleCtrl;
  late TextEditingController _splashSubtitleCtrl;
  late TextEditingController _splashDurationCtrl;
  late TextEditingController _systemPromptCtrl;
  late TextEditingController _opacityCtrl;

  @override
  void initState() {
    super.initState();
    final s = context.read<SettingsProvider>().settings;
    _splashTitleCtrl = TextEditingController(text: s.splashTitle);
    _splashSubtitleCtrl = TextEditingController(text: s.splashSubtitle);
    _splashDurationCtrl = TextEditingController(text: s.splashDurationMs.toString());
    _systemPromptCtrl = TextEditingController(text: s.systemPrompt);
    _opacityCtrl = TextEditingController(text: s.backgroundOpacity.toString());
  }

  @override
  void dispose() {
    _splashTitleCtrl.dispose();
    _splashSubtitleCtrl.dispose();
    _splashDurationCtrl.dispose();
    _systemPromptCtrl.dispose();
    _opacityCtrl.dispose();
    super.dispose();
  }

  void _save() {
    final sp = context.read<SettingsProvider>();
    final s = sp.settings;
    s.splashTitle = _splashTitleCtrl.text.trim();
    s.splashSubtitle = _splashSubtitleCtrl.text.trim();
    s.splashDurationMs = int.tryParse(_splashDurationCtrl.text.trim()) ?? 1000;
    s.systemPrompt = _systemPromptCtrl.text.trim();
    s.backgroundOpacity = int.tryParse(_opacityCtrl.text.trim()) ?? 100;
    sp.updateSettings(s);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('个性化设置已保存')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sp = context.watch<SettingsProvider>();
    final s = sp.settings;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      appBar: AppBar(
        title: const Text('个性化设置'),
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
          // 界面与背景外观
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('背景与字体', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Container(
                        width: 48,
                        height: 48,
                        decoration: BoxDecoration(
                          color: Colors.grey.withOpacity(0.2),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(Icons.wallpaper_outlined, color: Color(0xFF0284C7)),
                      ),
                      const SizedBox(width: 12),
                      const Text('自定义背景', style: TextStyle(fontSize: 14)),
                      const Spacer(),
                      OutlinedButton.icon(
                        icon: const Icon(Icons.image_outlined, size: 16),
                        label: const Text('选择图片'),
                        onPressed: () {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('已选择默认唯美插画背景')),
                          );
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  const Text('字体大小', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w500)),
                  const SizedBox(height: 8),
                  Row(
                    children: [
                      _buildFontSizeButton(13, '小号\n13px', s.chatFontSize == 13),
                      const SizedBox(width: 8),
                      _buildFontSizeButton(15, '标准\n15px', s.chatFontSize == 15),
                      const SizedBox(width: 8),
                      _buildFontSizeButton(16, '大号\n16px', s.chatFontSize == 16),
                      const SizedBox(width: 8),
                      _buildFontSizeButton(18, '特大\n18px', s.chatFontSize == 18),
                    ],
                  ),
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: isDark ? const Color(0xFF1E293B) : const Color(0xFFF1F5F9),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      '预览：这是一条示例聊天消息文本效果',
                      style: TextStyle(fontSize: s.chatFontSize.toDouble()),
                    ),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _opacityCtrl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: '背景透明度 (%)',
                      hintText: '100',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 8),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('暗夜模式显示背景', style: TextStyle(fontSize: 14)),
                    value: s.showBackgroundInDarkMode,
                    onChanged: (val) {
                      s.showBackgroundInDarkMode = val;
                      sp.updateSettings(s);
                    },
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // 启动页设置
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('启动页设置', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  SwitchListTile(
                    contentPadding: EdgeInsets.zero,
                    title: const Text('启用启动页', style: TextStyle(fontSize: 14)),
                    value: s.enableSplash,
                    onChanged: (val) {
                      s.enableSplash = val;
                      sp.updateSettings(s);
                    },
                  ),
                  TextField(
                    controller: _splashTitleCtrl,
                    decoration: const InputDecoration(
                      labelText: '启动主标题',
                      hintText: 'Aether-X',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _splashSubtitleCtrl,
                    decoration: const InputDecoration(
                      labelText: '启动子文本',
                      hintText: 'Loading AI Experience',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _splashDurationCtrl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: '持续时间 (ms)',
                      hintText: '1000',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      const Text('启动图片', style: TextStyle(fontSize: 14)),
                      const Spacer(),
                      OutlinedButton.icon(
                        icon: const Icon(Icons.photo_outlined, size: 16),
                        label: const Text('选择图片'),
                        onPressed: () {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('已配置默认启动图标')),
                          );
                        },
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          // 系统回复逻辑 (System Prompt)
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('回复逻辑 (System Prompt)', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _systemPromptCtrl,
                    maxLines: 4,
                    decoration: const InputDecoration(
                      labelText: '系统人设与回复逻辑',
                      hintText: '例如：你是一个专业的程序员，回答精简准确...',
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

  Widget _buildFontSizeButton(int size, String label, bool isSelected) {
    return Expanded(
      child: InkWell(
        onTap: () {
          final sp = context.read<SettingsProvider>();
          final s = sp.settings;
          s.chatFontSize = size;
          sp.updateSettings(s);
        },
        borderRadius: BorderRadius.circular(8),
        child: Container(
          padding: const EdgeInsets.symmetric(vertical: 8),
          decoration: BoxDecoration(
            color: isSelected ? const Color(0xFF0284C7) : Colors.transparent,
            border: Border.all(
              color: isSelected ? const Color(0xFF0284C7) : Colors.grey.shade400,
            ),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            label,
            textAlign: TextAlign.center,
            style: TextStyle(
              fontSize: 12,
              color: isSelected ? Colors.white : null,
              fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
            ),
          ),
        ),
      ),
    );
  }
}
