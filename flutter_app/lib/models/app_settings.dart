import 'dart:convert';

class ModelConfig {
  final String id;
  final String name;
  final String provider; // 'deepseek', 'openai', 'anthropic', 'custom'
  final bool isReasoner;
  final String description;

  const ModelConfig({
    required this.id,
    required this.name,
    required this.provider,
    this.isReasoner = false,
    this.description = '',
  });
}

class AppSettings {
  bool isDarkMode;
  String activeModel;
  String deepSeekApiKey;
  String customBaseUrl;
  String customApiKey;
  double temperature;
  int maxTokens;
  bool enableReasoning;
  bool enableStream;
  String localBridgeWsUrl;
  String localAgentToken;
  String targetWorkspace;

  AppSettings({
    this.isDarkMode = false,
    this.activeModel = 'deepseek-reasoner',
    this.deepSeekApiKey = '',
    this.customBaseUrl = 'https://api.deepseek.com',
    this.customApiKey = '',
    this.temperature = 0.6,
    this.maxTokens = 4096,
    this.enableReasoning = true,
    this.enableStream = true,
    this.localBridgeWsUrl = 'ws://127.0.0.1:8765',
    this.localAgentToken = 'lx_agent_token_888',
    this.targetWorkspace = 'deepseek-agent',
  });

  static const List<ModelConfig> availableModels = [
    ModelConfig(
      id: 'deepseek-reasoner',
      name: 'DeepSeek-R1 (深度思考)',
      provider: 'deepseek',
      isReasoner: true,
      description: '具备超长思维链与自省推理能力，数理代码极强',
    ),
    ModelConfig(
      id: 'deepseek-chat',
      name: 'DeepSeek-V3 (通用极速)',
      provider: 'deepseek',
      isReasoner: false,
      description: '百万上下文高吞吐，通用对话与快速问答首选',
    ),
    ModelConfig(
      id: 'gpt-4o',
      name: 'GPT-4o Omni',
      provider: 'openai',
      isReasoner: false,
      description: 'OpenAI 旗舰全模态智能模型',
    ),
    ModelConfig(
      id: 'claude-3-5-sonnet-20241022',
      name: 'Claude 3.5 Sonnet',
      provider: 'anthropic',
      isReasoner: false,
      description: '代码工程与长篇写作卓越表现',
    ),
  ];

  Map<String, dynamic> toMap() {
    return {
      'isDarkMode': isDarkMode,
      'activeModel': activeModel,
      'deepSeekApiKey': deepSeekApiKey,
      'customBaseUrl': customBaseUrl,
      'customApiKey': customApiKey,
      'temperature': temperature,
      'maxTokens': maxTokens,
      'enableReasoning': enableReasoning,
      'enableStream': enableStream,
      'localBridgeWsUrl': localBridgeWsUrl,
      'localAgentToken': localAgentToken,
      'targetWorkspace': targetWorkspace,
    };
  }

  factory AppSettings.fromMap(Map<dynamic, dynamic> map) {
    return AppSettings(
      isDarkMode: map['isDarkMode'] as bool? ?? false,
      activeModel: map['activeModel'] as String? ?? 'deepseek-reasoner',
      deepSeekApiKey: map['deepSeekApiKey'] as String? ?? '',
      customBaseUrl: map['customBaseUrl'] as String? ?? 'https://api.deepseek.com',
      customApiKey: map['customApiKey'] as String? ?? '',
      temperature: (map['temperature'] as num?)?.toDouble() ?? 0.6,
      maxTokens: map['maxTokens'] as int? ?? 4096,
      enableReasoning: map['enableReasoning'] as bool? ?? true,
      enableStream: map['enableStream'] as bool? ?? true,
      localBridgeWsUrl: map['localBridgeWsUrl'] as String? ?? 'ws://127.0.0.1:8765',
      localAgentToken: map['localAgentToken'] as String? ?? 'lx_agent_token_888',
      targetWorkspace: map['targetWorkspace'] as String? ?? 'deepseek-agent',
    );
  }
}
