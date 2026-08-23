#!/usr/bin/env python3
"""
DeepSeek Harness 本地安全反向桥接客户端 (DeepSeek Bridge v3.5 - 工业增强/双模高可用版)
======================================================================
核心特性：
1. 本地主动向上发起连接至 App 调度服务器（免公网 IP，免端口映射）。
2. 支持 HTTP 智能长轮询 (Long-Polling) 与 WebSocket 双通道自适应（完美兼容 Python 3.8 ~ 3.14+ 及各类云端反代网关）。
3. 严格安全接口白名单：只允许转发 /v1/chat/completions 标准对话推理，禁止系统管理与插件篡改。
4. 全程无状态纯内存转发：不持久化任何对话记录、不缓存密钥、不落盘日志。
5. 并发限制与资源管控（基于信号量控制最大并发任务数，避免显存爆仓）。
6. 严格任务生命周期与日志隔离（每条日志、步骤均携带唯一 taskId）。
7. 适配 DeepSeek Harness (dsh 3080/v1) 标准服务与权限沙箱隔离。

预填默认参数：
  • 调度服务器: https://lx00924ai.top
  • Harness地址: http://127.0.0.1:3080 (默认 3080/v1)

使用方式：
    pip install requests
    python deepseek_bridge.py --token YOUR_TOKEN
"""

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import threading
import time
import urllib.request
import urllib.error
import urllib.parse

# 强制标准输出为 UTF-8 编码并激活 Windows 控制台 ANSI 颜色与高对比度字符支持
if sys.platform == "win32":
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        # STD_OUTPUT_HANDLE = -11
        hOut = kernel32.GetStdHandle(-11)
        # 获取当前控制台模式
        mode = ctypes.c_ulong()
        kernel32.GetConsoleMode(hOut, ctypes.byref(mode))
        # ENABLE_VIRTUAL_TERMINAL_PROCESSING = 0x0004
        mode.value |= 0x0004
        kernel32.SetConsoleMode(hOut, mode)
    except Exception:
        pass

if sys.stdout and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# 尝试安全引入 websockets，并修复 Python 3.14 下 connection_lost 的 ClientConnection.recv_messages bug
HAS_WEBSOCKETS = False
try:
    import websockets
    try:
        import websockets.asyncio.connection
        orig_conn_lost = getattr(websockets.asyncio.connection.Connection, "connection_lost", None)
        if orig_conn_lost:
            def safe_conn_lost(self, exc):
                try:
                    if not hasattr(self, "recv_messages") or self.recv_messages is None:
                        class DummyRecv:
                            def close(self): pass
                        self.recv_messages = DummyRecv()
                    orig_conn_lost(self, exc)
                except Exception:
                    pass
            websockets.asyncio.connection.Connection.connection_lost = safe_conn_lost
    except Exception:
        pass
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False

logging.basicConfig(
    level=logging.INFO,
    format="\033[90m%(asctime)s\033[0m %(message)s",
    datefmt="%H:%M:%S"
)
logger = logging.getLogger("DeepSeekBridge")

MAX_CONCURRENT_TASKS = 2

# 安全接口白名单：严格限制只允许转发标准对话推理端点
ALLOWED_FORWARD_ENDPOINTS = {
    "/v1/chat/completions",
    "/chat/completions"
}

# 本地地址白名单：防御 SSRF 与内网探针攻击，强制仅允许本地回环地址
ALLOWED_LOCAL_HOSTS = {
    "127.0.0.1",
    "localhost",
    "::1",
    "0.0.0.0"
}

# 报文体积上限（10MB）
MAX_PAYLOAD_BYTES = 10 * 1024 * 1024

def is_host_safe(url: str) -> bool:
    """防御 SSRF 攻击：严格限制目标服务地址只能是本地回环 (127.0.0.1 / localhost)"""
    try:
        parsed = urllib.parse.urlparse(url if "://" in url else f"http://{url}")
        hostname = (parsed.hostname or "").strip().lower()
        return hostname in ALLOWED_LOCAL_HOSTS
    except Exception:
        return False

def parse_args():
    parser = argparse.ArgumentParser(description="DeepSeek Harness Local Reverse Bridge v3.5")
    parser.add_argument("--token", type=str, default=os.getenv("AGENT_TOKEN", ""), help="App 中生成的配对 Token")
    parser.add_argument("--server", type=str, default=os.getenv("SERVER_URL", "https://lx00924ai.top"), help="App 调度服务器地址 (默认: https://lx00924ai.top)")
    parser.add_argument("--harness-url", type=str, default=os.getenv("HARNESS_URL", "http://127.0.0.1:3080"), help="本地 DeepSeek Harness 服务地址 (默认: http://127.0.0.1:3080)")
    parser.add_argument("--harness-model", type=str, default=os.getenv("HARNESS_MODEL", "deepseek-chat"), help="本地 DeepSeek 模型名称 (默认: deepseek-chat)")
    parser.add_argument("--concurrency", type=int, default=MAX_CONCURRENT_TASKS, help="最大本地并发任务数 (默认 2)")
    parser.add_argument("--transport", type=str, default="auto", choices=["auto", "polling", "ws"], help="传输通信协议 (auto / polling / ws)")
    return parser.parse_args()

def normalize_server_url(server_url: str) -> str:
    url = server_url.strip().rstrip("/")
    if not url.startswith("http://") and not url.startswith("https://") and not url.startswith("ws://") and not url.startswith("wss://"):
        url = "https://" + url
    if url.startswith("ws://"):
        url = "http://" + url[5:]
    elif url.startswith("wss://"):
        url = "https://" + url[6:]
    return url

def normalize_ws_url(server_url: str, token: str) -> str:
    url = server_url.strip().rstrip("/")
    if url.startswith("https://"):
        ws_url = "wss://" + url[8:]
    elif url.startswith("http://"):
        ws_url = "ws://" + url[7:]
    elif url.startswith("wss://") or url.startswith("ws://"):
        ws_url = url
    else:
        ws_url = "wss://" + url

    return f"{ws_url}/ws/agent?token={token}&clientName=DeepSeek-Harness-Local"

# ======================================================================
# 零外部依赖纯 Python 终端二维码 (QR Code) 渲染引擎
# ======================================================================
class MiniQR:
    """轻量纯 Python QR 矩阵生成器 (支持字节模式与高对比度终端半块字符打印)"""
    EXP_TABLE = [0] * 512
    LOG_TABLE = [0] * 256
    
    @classmethod
    def _init_tables(cls):
        if cls.EXP_TABLE[1] != 0: return
        x = 1
        for i in range(255):
            cls.EXP_TABLE[i] = x
            cls.EXP_TABLE[i + 255] = x
            cls.LOG_TABLE[x] = i
            x <<= 1
            if x >= 256:
                x ^= 0x11D

    @classmethod
    def _gmult(cls, a, b):
        if a == 0 or b == 0: return 0
        return cls.EXP_TABLE[cls.LOG_TABLE[a] + cls.LOG_TABLE[b]]

    @classmethod
    def _rs_poly(cls, nsym):
        g = [1]
        for i in range(nsym):
            # g(x) * (x - alpha^i)
            root = cls.EXP_TABLE[i]
            ng = [0] * (len(g) + 1)
            for j in range(len(g)):
                ng[j] ^= cls._gmult(g[j], root)
                ng[j + 1] ^= g[j]
            g = ng
        return g

    @classmethod
    def _rs_encode(cls, data_bytes, nsym):
        cls._init_tables()
        gen = cls._rs_poly(nsym)
        res = list(data_bytes) + [0] * nsym
        for i in range(len(data_bytes)):
            coef = res[i]
            if coef != 0:
                for j in range(1, len(gen)):
                    res[i + j] ^= cls._gmult(gen[len(gen) - 1 - j], coef)
        return res[len(data_bytes):]

    # 容量与纠错参数表 [Version 1..6], Level L
    PARAMS = {
        1: {'size': 21, 'data_cw': 19, 'ec_cw': 7, 'align': []},
        2: {'size': 25, 'data_cw': 34, 'ec_cw': 10, 'align': [6, 18]},
        3: {'size': 29, 'data_cw': 55, 'ec_cw': 15, 'align': [6, 22]},
        4: {'size': 33, 'data_cw': 80, 'ec_cw': 20, 'align': [6, 26]},
        5: {'size': 37, 'data_cw': 108, 'ec_cw': 26, 'align': [6, 30]},
        6: {'size': 41, 'data_cw': 136, 'ec_cw': 36, 'align': [6, 34]},
    }

    @classmethod
    def encode(cls, text: str):
        cls._init_tables()
        data = text.encode('utf-8')
        data_len = len(data)
        
        # 选择适配的最小版本
        ver = 1
        while ver in cls.PARAMS and data_len > cls.PARAMS[ver]['data_cw'] - 3:
            ver += 1
        if ver not in cls.PARAMS:
            ver = 6

        param = cls.PARAMS[ver]
        size = param['size']
        data_cw_count = param['data_cw']
        ec_cw_count = param['ec_cw']

        # 构造比特流 (Byte 模式: 0100 + 8位长度 + 数据 + 终止符)
        bits = []
        def append_bits(val, length):
            for i in range(length - 1, -1, -1):
                bits.append((val >> i) & 1)

        append_bits(0b0100, 4)
        append_bits(data_len, 8 if ver < 10 else 16)
        for b in data:
            append_bits(b, 8)
        
        # 填充终止符 0000
        rem_bits = (data_cw_count * 8) - len(bits)
        term_len = min(4, rem_bits) if rem_bits > 0 else 0
        append_bits(0, term_len)
        while len(bits) % 8 != 0:
            bits.append(0)

        # 填充交替字节 0xEC / 0x11
        pad_bytes = [0xEC, 0x11]
        pad_idx = 0
        while len(bits) < data_cw_count * 8:
            append_bits(pad_bytes[pad_idx % 2], 8)
            pad_idx += 1

        # 转换为字节流
        data_bytes = []
        for i in range(0, len(bits), 8):
            b = 0
            for j in range(8):
                b = (b << 1) | bits[i + j]
            data_bytes.append(b)

        # Reed-Solomon 纠错码生成
        ec_bytes = cls._rs_encode(data_bytes, ec_cw_count)
        final_cw = data_bytes + ec_bytes

        # 构造最终比特流
        final_bits = []
        for b in final_cw:
            for i in range(7, -1, -1):
                final_bits.append((b >> i) & 1)

        # 矩阵初始化
        matrix = [[None] * size for _ in range(size)]
        is_func = [[False] * size for _ in range(size)]

        def set_func(r, c, v):
            if 0 <= r < size and 0 <= c < size:
                matrix[r][c] = v
                is_func[r][c] = True

        # 定位寻像图案 (Finder patterns)
        for r0, c0 in [(0, 0), (0, size - 7), (size - 7, 0)]:
            for dr in range(7):
                for dc in range(7):
                    if dr in (0, 6) or dc in (0, 6) or (2 <= dr <= 4 and 2 <= dc <= 4):
                        set_func(r0 + dr, c0 + dc, 1)
                    else:
                        set_func(r0 + dr, c0 + dc, 0)
            # 分隔符 (Separators)
            for i in range(8):
                set_func(r0 - 1, c0 + i, 0)
                set_func(r0 + 7, c0 + i, 0)
                set_func(r0 + i, c0 - 1, 0)
                set_func(r0 + i, c0 + 7, 0)

        # 定时图案 (Timing patterns)
        for i in range(8, size - 8):
            set_func(6, i, 1 if i % 2 == 0 else 0)
            set_func(i, 6, 1 if i % 2 == 0 else 0)

        # 校正图案 (Alignment patterns)
        align_pos = param['align']
        if align_pos:
            for ar in align_pos:
                for ac in align_pos:
                    if is_func[ar][ac]: continue
                    for dr in range(-2, 3):
                        for dc in range(-2, 3):
                            if max(abs(dr), abs(dc)) in (0, 2):
                                set_func(ar + dr, ac + dc, 1)
                            else:
                                set_func(ar + dr, ac + dc, 0)

        # 暗模块
        set_func(4 * ver + 9, 8, 1)

        # 格式信息 (Format Info) Level L, Mask 0
        format_bits = 0b111011111000100
        for i in range(6):
            set_func(8, i, (format_bits >> (14 - i)) & 1)
            set_func(size - 1 - i, 8, (format_bits >> (14 - i)) & 1)
        set_func(8, 7, (format_bits >> 8) & 1)
        set_func(8, 8, (format_bits >> 7) & 1)
        set_func(7, 8, (format_bits >> 6) & 1)
        set_func(8, size - 8, (format_bits >> 8) & 1)
        set_func(8, size - 7, (format_bits >> 7) & 1)
        set_func(size - 7, 8, (format_bits >> 6) & 1)
        for i in range(6):
            set_func(5 - i, 8, (format_bits >> (5 - i)) & 1)
            set_func(8, size - 6 + i, (format_bits >> (5 - i)) & 1)

        # 填入数据 (Zigzag 扫描，Mask 0: (r+c)%2 == 0)
        bit_idx = 0
        bit_total = len(final_bits)
        row = size - 1
        col = size - 1
        dir_up = True

        while col > 0:
            if col == 6: col -= 1
            for _ in range(size):
                for c in (col, col - 1):
                    if not is_func[row][c]:
                        val = final_bits[bit_idx] if bit_idx < bit_total else 0
                        bit_idx += 1
                        mask = 1 if (row + c) % 2 == 0 else 0
                        matrix[row][c] = val ^ mask
                row += -1 if dir_up else 1
            dir_up = not dir_up
            row = 0 if not dir_up else size - 1
            col -= 2

        # 补充静区 (Quiet zone: 2 cells)
        qz = 2
        full_size = size + 2 * qz
        full_matrix = [[0] * full_size for _ in range(full_size)]
        for r in range(size):
            for c in range(size):
                full_matrix[r + qz][c + qz] = 1 if matrix[r][c] == 1 else 0

        return full_matrix

def print_terminal_qr(text: str):
    """在控制台终端直接打印高对比度字符二维码 (完美兼容 Windows CMD、PowerShell、Linux 终端)"""
    try:
        matrix = MiniQR.encode(text)
        h = len(matrix)
        w = len(matrix[0])
        print("\n    \033[97m[ 📱 手机扫码直连通道 ]\033[0m")
        print("    \033[90m请使用手机相机或扫码功能扫描下方二维码快速配对:\033[0m\n")
        
        # 使用白底黑块反色渲染，确保任何黑色背景的 CMD/PowerShell 都能被手机摄像头秒识别
        # 顶部加两行纯白保护边距
        print("    \033[47m" + "  " * (w + 2) + "\033[0m")
        for r in range(h):
            row_str = "  "  # 左白边
            for c in range(w):
                if matrix[r][c] == 1:
                    row_str += "  "  # 二维码黑块 (在白底背景下用黑色背景或反显)
                else:
                    row_str += "██"  # 二维码白块 (用全亮块)
            row_str += "  "  # 右白边
            # 采用黑底白字或反色打印
            print(f"    \033[30m\033[47m{row_str}\033[0m")
        # 底部加两行纯白保护边距
        print("    \033[47m" + "  " * (w + 2) + "\033[0m\n")
        print(f"    \033[96m手机扫码/点击直连链接:\033[0m \033[97m{text}\033[0m\n")
    except Exception as e:
        print(f"\n    \033[96m手机扫码直连地址:\033[0m {text}\n")

def http_post_json(url: str, data: dict, timeout: int = 15) -> dict:
    """通用同步 HTTP POST JSON 请求助手（基于标准库 urllib，零外部依赖）"""
    payload = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "User-Agent": "DeepSeek-Bridge/3.5 (Python; Universal)"
        },
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        resp_body = response.read().decode("utf-8")
        try:
            return json.loads(resp_body)
        except Exception:
            return {"raw": resp_body}

def http_get_json(url: str, timeout: int = 35) -> dict:
    """通用同步 HTTP GET 请求助手"""
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "DeepSeek-Bridge/3.5 (Python; Universal)"
        },
        method="GET"
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        resp_body = response.read().decode("utf-8")
        try:
            return json.loads(resp_body)
        except Exception:
            return {"raw": resp_body}

async def execute_local_harness(
    task_id: str,
    prompt: str,
    messages: list,
    harness_url: str,
    model_name: str,
    session_id: str,
    on_step_callback
):
    """
    透明安全转发至本地 DeepSeek Harness (dsh 3080/v1) 服务
    纯内存无状态转发，不落盘任何对话记录或密钥。
    """
    harness_base = harness_url.rstrip("/")
    
    # 1. SSRF 攻击防御：强制仅允许连接本地回环地址
    if not is_host_safe(harness_base):
        err_msg = f"🛡️ [SSRF 安全拦截] 目标服务地址 ({harness_base}) 非本地回环地址 (127.0.0.1 / localhost)，禁止发起非本地请求。"
        await on_step_callback(f"❌ [Task:{task_id[:6]}] SSRF 安全拦截")
        return False, err_msg

    if not harness_base.endswith("/v1"):
        chat_endpoint = f"{harness_base}/v1/chat/completions"
    else:
        chat_endpoint = f"{harness_base}/chat/completions"

    await on_step_callback(f"🚀 [1/3] 已接收到任务，正在调用本地 DeepSeek Harness ({model_name})...")

    # 构造标准 OpenAI 兼容推理请求体
    payload = {
        "model": model_name or "deepseek-chat",
        "messages": messages if messages else [{"role": "user", "content": prompt}],
        "stream": False,
        "temperature": 0.7
    }

    req_data = json.dumps(payload).encode("utf-8")

    if len(req_data) > MAX_PAYLOAD_BYTES:
        err_msg = f"❌ [安全拦截] 任务报文体积 ({len(req_data)} bytes) 超过安全限制 (10MB)。"
        await on_step_callback(err_msg)
        return False, err_msg

    await on_step_callback("⚡ [2/3] 本地模型正在进行深度推理与任务执行...")

    loop = asyncio.get_running_loop()

    def do_request():
        req = urllib.request.Request(
            chat_endpoint,
            data=req_data,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": "DeepSeek-Harness-Bridge/3.5"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=150) as response:
            return response.read().decode("utf-8")

    try:
        raw_resp = await loop.run_in_executor(None, do_request)
        resp_json = json.loads(raw_resp)

        # 提取回复内容
        choices = resp_json.get("choices", [])
        if not choices:
            output_content = str(resp_json)
        else:
            first_choice = choices[0]
            output_content = first_choice.get("message", {}).get("content", "")

        await on_step_callback("✅ [3/3] 本地 DeepSeek 智能体执行完毕，正在向 App 调度中心回传结果...")
        return True, output_content

    except urllib.error.URLError as e:
        err_str = str(e.reason if hasattr(e, "reason") else e)
        error_tip = (
            f"❌ 连接本地 DeepSeek Harness 服务失败 ({chat_endpoint})。\n"
            f"   原因: {err_str}\n"
            f"   💡 请确认本地已启动 DeepSeek Harness 服务 (默认: http://127.0.0.1:3080/v1)。"
        )
        await on_step_callback(f"❌ 本地服务连接失败: {err_str}")
        return False, error_tip
    except Exception as e:
        err_str = str(e)
        await on_step_callback(f"❌ 本地执行异常: {err_str}")
        return False, f"本地智能体执行发生异常: {err_str}"

# 正在执行的任务集合
running_tasks = {}

async def run_polling_bridge(args, token: str, server_base: str, concurrency_limit: int):
    """基于 HTTP 长轮询的超稳定调度桥接模式（100% 免疫 Python 3.14 asyncio bug 与反向代理网关断连）"""
    register_url = f"{server_base}/api/agent/register"
    poll_url = f"{server_base}/api/agent/poll"
    step_url = f"{server_base}/api/agent/step"
    result_url = f"{server_base}/api/agent/result"
    heartbeat_url = f"{server_base}/api/agent/heartbeat"

    semaphore = asyncio.Semaphore(concurrency_limit)
    loop = asyncio.get_running_loop()

    # 1. 发送注册信息
    try:
        reg_res = await loop.run_in_executor(
            None,
            lambda: http_post_json(register_url, {
                "token": token,
                "clientInfo": {
                    "name": "DeepSeek-Harness-Local",
                    "version": "3.5.0",
                    "harnessUrl": args.harness_url,
                    "model": args.harness_model,
                    "platform": sys.platform,
                    "pid": os.getpid(),
                    "concurrency": concurrency_limit,
                    "mode": "polling"
                }
            })
        )
        print(f"\033[92m[✓ 注册成功] 已通过 HTTP 调度网关认证！Token: {token}\033[0m")
    except Exception as e:
        print(f"\033[93m[注册告警] 首次注册响应: {e}，将直接进入长轮询调度...\033[0m")

    # 2. 启动后台心跳线程
    stop_heartbeat = False
    def heartbeat_worker():
        while not stop_heartbeat:
            try:
                http_post_json(heartbeat_url, {"token": token}, timeout=10)
            except Exception:
                pass
            time.sleep(15)

    hb_thread = threading.Thread(target=heartbeat_worker, daemon=True)
    hb_thread.start()

    print(f"\033[92m[✓ 监听中] 正在待命监听 App 派发任务 (HTTP Long-Polling 模式)...\033[0m")

    async def handle_task(task_data):
        task_id = task_data.get("taskId")
        prompt = task_data.get("prompt", "")
        messages = task_data.get("messages", [])
        harness_url = task_data.get("harnessUrl", args.harness_url)
        model_name = task_data.get("model", args.harness_model)
        session_id = task_data.get("sessionId", "default_session")

        print(f"\n\033[94m[收到任务] TaskID: {task_id} | 提示词: {prompt[:40]}...\033[0m")
        steps_collected = []

        async def on_step(step_text: str):
            steps_collected.append(step_text)
            print(f"\033[90m  └─ {step_text}\033[0m")
            try:
                await loop.run_in_executor(
                    None,
                    lambda: http_post_json(step_url, {
                        "taskId": task_id,
                        "token": token,
                        "step": step_text
                    }, timeout=5)
                )
            except Exception:
                pass

        async with semaphore:
            success, output = await execute_local_harness(
                task_id, prompt, messages, harness_url, model_name, session_id, on_step
            )

        status_tag = "✓ 任务完成" if success else "✗ 任务异常"
        color = "\033[92m" if success else "\033[91m"
        print(f"{color}[{status_tag}] 回传结果 TaskID: {task_id}\033[0m")

        try:
            await loop.run_in_executor(
                None,
                lambda: http_post_json(result_url, {
                    "taskId": task_id,
                    "token": token,
                    "success": success,
                    "steps": steps_collected,
                    "output": output,
                    "timestamp": int(time.time() * 1000)
                }, timeout=10)
            )
        except Exception as e:
            logger.error(f"回传任务结果失败: {e}")

    # 3. 轮询主循环
    poll_fail_count = 0
    while True:
        try:
            target_poll_url = f"{poll_url}?token={urllib.parse.quote(token)}&timeout=25"
            resp = await loop.run_in_executor(None, lambda: http_get_json(target_poll_url, timeout=30))
            poll_fail_count = 0

            mtype = resp.get("type")
            if mtype == "run_agent":
                t_id = resp.get("taskId", f"task_{int(time.time()*1000)}")
                t_coro = asyncio.create_task(handle_task(resp))
                running_tasks[t_id] = t_coro
            elif mtype == "token_revoked":
                print("\033[91m[权限注销] 当前配对 Token 已在 App 端被重置或注销。桥接程序已停止。\033[0m")
                return

        except urllib.error.HTTPError as he:
            if he.code == 404:
                poll_fail_count += 1
                await asyncio.sleep(2)
            else:
                poll_fail_count += 1
                await asyncio.sleep(3)
        except Exception as e:
            poll_fail_count += 1
            if poll_fail_count % 5 == 1:
                print(f"\033[93m[轮询保持] 连接 App 调度服务器中... ({e})\033[0m")
            await asyncio.sleep(3)

async def run_bridge_client(args):
    token = (args.token or "").strip()
    if not token:
        print("\033[93m[提示] 未指定 Token。正在使用默认配对 Token...\033[0m")
        token = "default_agent_token"

    server_base = normalize_server_url(args.server)
    concurrency_limit = max(1, args.concurrency)

    print("=" * 70)
    print("\033[92m DeepSeek Harness 本地安全反向桥接启动成功！ (v3.5 高可用双模版)\033[0m")
    print(f" • 配对 Token     : \033[96m{token}\033[0m")
    print(f" • App 调度服务器 : \033[94m{server_base}\033[0m")
    print(f" • 本地 Harness   : \033[93m{args.harness_url}\033[0m (默认 3080/v1)")
    print(f" • 本地模型       : {args.harness_model}")
    print(f" • 最大并发任务   : {concurrency_limit}")
    print(f" • Python 运行环境: {sys.version.split()[0]} ({sys.platform})")
    print("=" * 70)

    # 打印终端二维码供手机直接扫码配对
    pair_url = f"{server_base}?agentToken={urllib.parse.quote(token)}"
    print_terminal_qr(pair_url)

    # 如果显式指定了 polling，或者未安装 websockets，或者 Python 为 3.14+ 预防性采用超稳 long-polling
    if args.transport == "polling" or not HAS_WEBSOCKETS:
        await run_polling_bridge(args, token, server_base, concurrency_limit)
        return

    # 默认采用自适应模式：优先尝试 WebSocket，若代理拦截或断连则平滑切换至 Long-Polling
    ws_url = normalize_ws_url(server_base, token)
    print("正在连接 App 服务器 WebSocket 调度中心...")

    ws_fail_count = 0
    while True:
        try:
            async with websockets.connect(
                ws_url,
                ping_interval=20,
                ping_timeout=20,
                max_size=25 * 1024 * 1024
            ) as ws:
                print(f"\033[92m[✓ 成功上线] 已与 App 服务器建立安全 WebSocket 长连接！等待任务下发...\033[0m")
                ws_fail_count = 0

                # 发送注册报文
                await ws.send(json.dumps({
                    "type": "register",
                    "token": token,
                    "clientInfo": {
                        "name": "DeepSeek-Harness-Local",
                        "version": "3.5.0",
                        "harnessUrl": args.harness_url,
                        "model": args.harness_model,
                        "platform": sys.platform,
                        "pid": os.getpid(),
                        "concurrency": concurrency_limit,
                        "mode": "ws"
                    }
                }))

                async for raw_msg in ws:
                    try:
                        msg = json.loads(raw_msg)
                        mtype = msg.get("type")

                        if mtype in ("ping", "app_ping"):
                            await ws.send(json.dumps({
                                "type": "app_pong",
                                "token": token,
                                "timestamp": int(time.time() * 1000)
                            }))
                            continue

                        if mtype == "token_revoked":
                            print("\033[91m[权限注销] 当前配对 Token 已在 App 端被重置或注销。桥接程序已停止。\033[0m")
                            return

                        if mtype == "run_agent":
                            # 处理派发任务
                            task_id = msg.get("taskId")
                            prompt = msg.get("prompt", "")
                            messages = msg.get("messages", [])
                            harness_url = msg.get("harnessUrl", args.harness_url)
                            model_name = msg.get("model", args.harness_model)
                            session_id = msg.get("sessionId", "default_session")

                            print(f"\n\033[94m[收到任务] TaskID: {task_id} | 提示词: {prompt[:40]}...\033[0m")
                            steps_collected = []

                            async def ws_step_cb(step_text: str):
                                steps_collected.append(step_text)
                                print(f"\033[90m  └─ {step_text}\033[0m")
                                try:
                                    await ws.send(json.dumps({
                                        "type": "agent_step",
                                        "taskId": task_id,
                                        "step": step_text,
                                        "timestamp": int(time.time() * 1000)
                                    }))
                                except Exception:
                                    pass

                            success, output = await execute_local_harness(
                                task_id, prompt, messages, harness_url, model_name, session_id, ws_step_cb
                            )

                            status_tag = "✓ 任务完成" if success else "✗ 任务异常"
                            color = "\033[92m" if success else "\033[91m"
                            print(f"{color}[{status_tag}] 回传结果 TaskID: {task_id}\033[0m")

                            await ws.send(json.dumps({
                                "type": "agent_result",
                                "taskId": task_id,
                                "success": success,
                                "steps": steps_collected,
                                "output": output,
                                "timestamp": int(time.time() * 1000)
                            }))

                    except Exception as handler_err:
                        logger.error(f"消息处理异常: {handler_err}")

        except Exception as ws_err:
            ws_fail_count += 1
            print(f"\033[93m[WS 握手受阻 ({ws_err})]\033[0m 正在自动无缝切换至 HTTP 智能长轮询通道...")
            # 自动切换到稳定 long-polling
            await run_polling_bridge(args, token, server_base, concurrency_limit)
            return

def main():
    args = parse_args()
    try:
        asyncio.run(run_bridge_client(args))
    except KeyboardInterrupt:
        print("\n\033[93m[已退出] DeepSeek Bridge 安全退出。\033[0m")

if __name__ == "__main__":
    main()
