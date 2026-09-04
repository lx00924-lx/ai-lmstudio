import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../providers/settings_provider.dart';

class AccountSettingsScreen extends StatefulWidget {
  const AccountSettingsScreen({super.key});

  @override
  State<AccountSettingsScreen> createState() => _AccountSettingsScreenState();
}

class _AccountSettingsScreenState extends State<AccountSettingsScreen> {
  late TextEditingController _loginAccountCtrl;
  late TextEditingController _userNameCtrl;
  late TextEditingController _aiNameCtrl;
  late TextEditingController _oldPwdCtrl;
  late TextEditingController _newPwdCtrl;
  late TextEditingController _confirmPwdCtrl;

  @override
  void initState() {
    super.initState();
    final s = context.read<SettingsProvider>().settings;
    _loginAccountCtrl = TextEditingController(text: s.loginAccount);
    _userNameCtrl = TextEditingController(text: s.userName);
    _aiNameCtrl = TextEditingController(text: s.aiName);
    _oldPwdCtrl = TextEditingController();
    _newPwdCtrl = TextEditingController();
    _confirmPwdCtrl = TextEditingController();
  }

  @override
  void dispose() {
    _loginAccountCtrl.dispose();
    _userNameCtrl.dispose();
    _aiNameCtrl.dispose();
    _oldPwdCtrl.dispose();
    _newPwdCtrl.dispose();
    _confirmPwdCtrl.dispose();
    super.dispose();
  }

  void _saveAccount() {
    final sp = context.read<SettingsProvider>();
    final s = sp.settings;
    s.loginAccount = _loginAccountCtrl.text.trim();
    s.userName = _userNameCtrl.text.trim();
    s.aiName = _aiNameCtrl.text.trim();
    sp.updateSettings(s);
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('账户设置已保存')),
    );
  }

  void _changePassword() {
    if (_newPwdCtrl.text.trim() != _confirmPwdCtrl.text.trim()) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('两次输入的新密码不一致')),
      );
      return;
    }
    final sp = context.read<SettingsProvider>();
    final s = sp.settings;
    s.accountPassword = _newPwdCtrl.text.trim();
    sp.updateSettings(s);
    _oldPwdCtrl.clear();
    _newPwdCtrl.clear();
    _confirmPwdCtrl.clear();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('密码修改成功')),
    );
  }

  @override
  Widget build(BuildContext context) {
    final sp = context.watch<SettingsProvider>();
    final s = sp.settings;

    return Scaffold(
      appBar: AppBar(
        title: const Text('账户设置'),
        actions: [
          IconButton(
            icon: const Icon(Icons.check),
            tooltip: '保存',
            onPressed: _saveAccount,
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
                  const Text('基本资料', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _loginAccountCtrl,
                    decoration: const InputDecoration(
                      labelText: '登录账号',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _userNameCtrl,
                    decoration: const InputDecoration(
                      labelText: '用户名',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 20,
                        backgroundColor: const Color(0xFF0284C7).withOpacity(0.2),
                        child: const Icon(Icons.person, color: Color(0xFF0284C7)),
                      ),
                      const SizedBox(width: 12),
                      const Text('用户头像', style: TextStyle(fontSize: 14)),
                      const Spacer(),
                      OutlinedButton.icon(
                        icon: const Icon(Icons.image_outlined, size: 16),
                        label: const Text('选择图片'),
                        onPressed: () {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('已选择默认系统头像')),
                          );
                        },
                      ),
                    ],
                  ),
                  const Divider(height: 24),
                  TextField(
                    controller: _aiNameCtrl,
                    decoration: const InputDecoration(
                      labelText: 'AI 名称',
                      hintText: '如 Aether-X',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      CircleAvatar(
                        radius: 20,
                        backgroundColor: const Color(0xFF0284C7).withOpacity(0.2),
                        child: const Icon(Icons.smart_toy_outlined, color: Color(0xFF0284C7)),
                      ),
                      const SizedBox(width: 12),
                      const Text('AI 头像', style: TextStyle(fontSize: 14)),
                      const Spacer(),
                      OutlinedButton.icon(
                        icon: const Icon(Icons.image_outlined, size: 16),
                        label: const Text('选择图片'),
                        onPressed: () {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('已选择默认 AI 头像')),
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

          // 修改密码
          Card(
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('修改密码', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 16),
                  TextField(
                    controller: _oldPwdCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: '原密码',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _newPwdCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: '新密码',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 12),
                  TextField(
                    controller: _confirmPwdCtrl,
                    obscureText: true,
                    decoration: const InputDecoration(
                      labelText: '确认新密码',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Align(
                    alignment: Alignment.centerRight,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF0284C7),
                        foregroundColor: Colors.white,
                      ),
                      onPressed: _changePassword,
                      child: const Text('确认修改'),
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
