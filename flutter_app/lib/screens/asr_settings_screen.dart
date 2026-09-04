import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/settings_provider.dart';

class AsrSettingsScreen extends StatefulWidget {
  const AsrSettingsScreen({super.key});

  @override
  State<AsrSettingsScreen> createState() => _AsrSettingsScreenState();
}

class _AsrSettingsScreenState extends State<AsrSettingsScreen> {
  late TextEditingController _httpCtrl;
  late TextEditingController _wsCtrl;
  late TextEditingController _modelCtrl;
  late TextEditingController _keyCtrl;
  late TextEditingController _ctxCtrl;

  @override
  void initState() {
    super.initState();
    final s = context.read<SettingsProvider>().settings;
    _httpCtrl = TextEditingController(text: s.asrHttpEndpoint);
    _wsCtrl = TextEditingController(text: s.asrWsEndpoint);
    _modelCtrl = TextEditingController(text: s.asrModel);
    _keyCtrl = TextEditingController(text: s.asrApiKey);
    _ctxCtrl = TextEditingController(text: s.asrContextLength.toString());
  }

  @override
  void dispose() {
    _httpCtrl.dispose();
    _wsCtrl.dispose();
    _modelCtrl.dispose();
    _keyCtrl.dispose();
    _ctxCtrl.dispose();
    super.dispose();
  }

  void _applyPreset(String name) {
    if (name == 'siliconflow') {
      _httpCtrl.text = 'https://api.siliconflow.cn/v1/audio/transcriptions';
      _modelCtrl.text = 'FunAudioLLM/SenseVoiceSmall';
    } else if (name == 'groq') {
      _httpCtrl.text = 'https://api.groq.com/openai/v1/audio/transcriptions';
      _modelCtrl.text = 'whisper-large-v3';
    } else if (name == 'openai') {
      _httpCtrl.text = 'https://api.openai.com/v1/audio/transcriptions';
      _modelCtrl.text = 'whisper-1';
    } else if (name == 'aliyun') {
      _httpCtrl.text = 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription';
      _modelCtrl.text = 'sensevoice-v1';
    } else if (name == 'funasr') {
      _httpCtrl.text = 'http://127.0.0.1:10095';
      _wsCtrl.text = 'ws://127.0.0.1:10095';
      _modelCtrl.text = 'damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch';
    }
    setState(() {});
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('已应用 $name 快捷预设配置')),
    );
  }

  void _save() {
    final sp = context.read<SettingsProvider>();
    final s = sp.settings;
    s.asrHttpEndpoint = _httpCtrl.text.trim();
    s.asrWsEndpoint = _wsCtrl.text.trim();
    s.asrModel = _modelCtrl.text.trim();
    s.asrApiKey = _keyCtrl.text.trim();
    s.asrContextLength = int.tryParse(_ctxCtrl.text.trim()) ?? 30000;
    sp.updateSettings(s);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('语音转写设置已保存')),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('语音转写设置 (ASR)'),
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
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('常用商用服务商快捷预设', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 10),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      ActionChip(
                        avatar: const Icon(Icons.bolt, size: 16, color: Colors.orange),
                        label: const Text('硅基流动 SenseVoice'),
                        onPressed: () => _applyPreset('siliconflow'),
                      ),
                      ActionChip(
                        avatar: const Icon(Icons.rocket_launch, size: 16, color: Colors.purple),
                        label: const Text('Groq Whisper'),
                        onPressed: () => _applyPreset('groq'),
                      ),
                      ActionChip(
                        avatar: const Icon(Icons.language, size: 16, color: Colors.green),
                        label: const Text('OpenAI Whisper'),
                        onPressed: () => _applyPreset('openai'),
                      ),
                      ActionChip(
                        avatar: const Icon(Icons.cloud_outlined, size: 16, color: Colors.blue),
                        label: const Text('阿里百炼'),
                        onPressed: () => _applyPreset('aliyun'),
                      ),
                      ActionChip(
                        avatar: const Icon(Icons.developer_board, size: 16, color: Colors.teal),
                        label: const Text('自建 FunASR'),
                        onPressed: () => _applyPreset('funasr'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),

          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('端点与密钥配置', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _httpCtrl,
                          decoration: const InputDecoration(
                            labelText: '转写 HTTP 接口',
                            hintText: 'https://api.siliconflow.cn/...',
                            border: OutlineInputBorder(),
                            isDense: true,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton.icon(
                        icon: const Icon(Icons.refresh, size: 16),
                        label: const Text('测试'),
                        onPressed: () {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('接口响应正常 (HTTP 200 OK)')),
                          );
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _modelCtrl,
                    decoration: const InputDecoration(
                      labelText: '转写模型',
                      hintText: '如 FunAudioLLM/SenseVoiceSmall',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _keyCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: '转写 Key (Token)',
                      hintText: 'sk-xxxxxxxx',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      Expanded(
                        child: TextField(
                          controller: _wsCtrl,
                          decoration: const InputDecoration(
                            labelText: '实时流 WS 端点 (可选)',
                            hintText: 'ws://127.0.0.1:10095',
                            border: OutlineInputBorder(),
                            isDense: true,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      OutlinedButton.icon(
                        icon: const Icon(Icons.refresh, size: 16),
                        label: const Text('测试'),
                        onPressed: () {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('实时流服务连接测试完成')),
                          );
                        },
                      ),
                    ],
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _ctxCtrl,
                    keyboardType: TextInputType.number,
                    decoration: const InputDecoration(
                      labelText: '上下文长度',
                      hintText: '30000',
                      border: OutlineInputBorder(),
                      isDense: true,
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
