# Electron 桌面端 (.exe) 打包指南

本项目已内置完整的 Electron 打包与运行配置。

---

## 1. 本地打包步骤（Windows 电脑）

### 第一步：安装 Electron 相关开发依赖
在本地项目根目录下打开终端（PowerShell 或 CMD），运行：
```bash
npm install -D electron electron-builder
```

### 第二步：执行一键打包构建
```bash
npm run electron:build
```

---

## 2. 打包产物说明

打包成功后，项目根目录下会自动生成 `release/` 文件夹：
* **`AI智能助手 Setup.exe`**：标准 Windows 安装向导程序（支持自定义安装路径、创建桌面快捷方式等）。
* **`AI智能助手.exe` (Portable)**：绿色免安装便携版，双击直接运行。

---

## 3. 项目配置清单

* **主进程文件**：`electron/main.cjs`
* **预加载脚本**：`electron/preload.cjs`
* **打包配置文件**：`electron-builder.json`
* **Vite 相对路径**：`vite.config.ts` 中的 `base: './'`（确保本地 `file://` 离线协议不白屏）
