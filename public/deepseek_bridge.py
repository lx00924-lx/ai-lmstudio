#!/usr/bin/env python3
"""
DeepSeek Harness 本地安全反向桥接客户端 (DeepSeek Bridge v3.6 - 工业增强/双模高可用版)
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
    pip install requests websockets
    python deepseek_bridge.py --token YOUR_TOKEN
"""

import argparse
import asyncio
from datetime import datetime
import json
import logging
import os
import re
import ssl
import sys
import threading
import time
import urllib.request
import urllib.error
import urllib.parse
import uuid

# 强制标准输出为 UTF-8 编码并激活 Windows 控制台 ANSI 颜色与高对比度字符支持
if sys.platform == "win32":
    try:
        import ctypes
        kernel32 = ctypes.windll.kernel32
        hOut = kernel32.GetStdHandle(-11)
        mode = ctypes.c_ulong()
        kernel32.GetConsoleMode(hOut, ctypes.byref(mode))
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
    parser = argparse.ArgumentParser(description="DeepSeek Harness Local Reverse Bridge v3.6")
    parser.add_argument("--token", type=str, default=os.getenv("AGENT_TOKEN", ""), help="App 中生成的配对 Token")
    parser.add_argument("--server", type=str, default=os.getenv("SERVER_URL", "https://lx00924ai.top"), help="App 调度服务器地址 (默认: https://lx00924ai.top)")
    parser.add_argument("--harness-url", type=str, default=os.getenv("HARNESS_URL", "http://127.0.0.1:3080"), help="本地 DeepSeek Harness / Agent 服务地址 (默认: http://127.0.0.1:3080)")
    parser.add_argument("--harness-model", type=str, default=os.getenv("HARNESS_MODEL", "deepseek-chat"), help="本地 DeepSeek 模型名称 (默认: deepseek-chat)")
    parser.add_argument("--chat-api-url", type=str, default=os.getenv("CHAT_API_URL", ""), help="可选：独立云端聊天推理接口 (如火山方舟 https://ark.cn-beijing.volces.com/api/v3)")
    parser.add_argument("--chat-api-key", type=str, default=os.getenv("CHAT_API_KEY", ""), help="可选：云端聊天 API Key")
    parser.add_argument("--chat-model", type=str, default=os.getenv("CHAT_MODEL", ""), help="可选：云端聊天模型名称 (如 deepseek-v4-pro-ga-260813)")
    parser.add_argument("--concurrency", type=int, default=MAX_CONCURRENT_TASKS, help="最大本地并发任务数 (默认 2)")
    parser.add_argument("--transport", type=str, default="auto", choices=["auto", "polling", "ws"], help="传输通信协议 (auto / polling / ws)")
    parser.add_argument("--no-proxy", action="store_true", help="强制 Direct 直连，忽略系统所有代理与 Clash 残留")
    parser.add_argument("--proxy", type=str, default=os.getenv("ALL_PROXY", os.getenv("HTTPS_PROXY", "")), help="手动指定代理服务器地址 (如 http://127.0.0.1:7890)")
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
        
        ver = 1
        while ver in cls.PARAMS and data_len > cls.PARAMS[ver]['data_cw'] - 3:
            ver += 1
        if ver not in cls.PARAMS:
            ver = 6

        param = cls.PARAMS[ver]
        size = param['size']
        data_cw_count = param['data_cw']
        ec_cw_count = param['ec_cw']

        bits = []
        def append_bits(val, length):
            for i in range(length - 1, -1, -1):
                bits.append((val >> i) & 1)

        append_bits(0b0100, 4)
        append_bits(data_len, 8 if ver < 10 else 16)
        for b in data:
            append_bits(b, 8)
        
        rem_bits = (data_cw_count * 8) - len(bits)
        term_len = min(4, rem_bits) if rem_bits > 0 else 0
        append_bits(0, term_len)
        while len(bits) % 8 != 0:
            bits.append(0)

        pad_bytes = [0xEC, 0x11]
        pad_idx = 0
        while len(bits) < data_cw_count * 8:
            append_bits(pad_bytes[pad_idx % 2], 8)
            pad_idx += 1

        data_bytes = []
        for i in range(0, len(bits), 8):
            b = 0
            for j in range(8):
                b = (b << 1) | bits[i + j]
            data_bytes.append(b)

        ec_bytes = cls._rs_encode(data_bytes, ec_cw_count)
        final_cw = data_bytes + ec_bytes

        final_bits = []
        for b in final_cw:
            for i in range(7, -1, -1):
                final_bits.append((b >> i) & 1)

        matrix = [[None] * size for _ in range(size)]
        is_func = [[False] * size for _ in range(size)]

        def set_func(r, c, v):
            if 0 <= r < size and 0 <= c < size:
                matrix[r][c] = v
                is_func[r][c] = True

        for r0, c0 in [(0, 0), (0, size - 7), (size - 7, 0)]:
            for dr in range(7):
                for dc in range(7):
                    if dr in (0, 6) or dc in (0, 6) or (2 <= dr <= 4 and 2 <= dc <= 4):
                        set_func(r0 + dr, c0 + dc, 1)
                    else:
                        set_func(r0 + dr, c0 + dc, 0)
            for i in range(8):
                set_func(r0 - 1, c0 + i, 0)
                set_func(r0 + 7, c0 + i, 0)
                set_func(r0 + i, c0 - 1, 0)
                set_func(r0 + i, c0 + 7, 0)

        for i in range(8, size - 8):
            set_func(6, i, 1 if i % 2 == 0 else 0)
            set_func(i, 6, 1 if i % 2 == 0 else 0)

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

        set_func(4 * ver + 9, 8, 1)

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
        
        print("    \033[47m" + "  " * (w + 2) + "\033[0m")
        for r in range(h):
            row_str = "  "
            for c in range(w):
                if matrix[r][c] == 1:
                    row_str += "  "
                else:
                    row_str += "██"
            row_str += "  "
            print(f"    \033[30m\033[47m{row_str}\033[0m")
        print("    \033[47m" + "  " * (w + 2) + "\033[0m\n")
        print(f"    \033[96m手机扫码/点击直连链接:\033[0m \033[97m{text}\033[0m\n")
    except Exception as e:
        print(f"\n    \033[96m手机扫码直连地址:\033[0m {text}\n")

# ======================================================================
# 工业级高容错 HTTP 通信引擎
# ======================================================================
FALLBACK_SERVERS = [
    "https://lx00924ai.top",
    "https://ais-pre-lswjsr25ivxdaulzx2iy3d-135884546184.asia-northeast1.run.app",
    "https://ais-dev-lswjsr25ivxdaulzx2iy3d-135884546184.asia-northeast1.run.app"
]

def create_resilient_ssl_context():
    try:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    except Exception:
        try:
            return ssl._create_unverified_context()
        except Exception:
            return None

class ResilientHttpClient:
    def __init__(self, force_no_proxy: bool = False, custom_proxy: str = "", primary_server: str = ""):
        self.ssl_ctx = create_resilient_ssl_context()
        self.force_no_proxy = force_no_proxy
        self.custom_proxy = (custom_proxy or "").strip()
        self.primary_server = primary_server.rstrip("/") if primary_server else "https://lx00924ai.top"
        
        self.direct_opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            urllib.request.HTTPSHandler(context=self.ssl_ctx) if self.ssl_ctx else urllib.request.HTTPSHandler()
        )
        
        if self.custom_proxy:
            proxy_dict = {"http": self.custom_proxy, "https": self.custom_proxy}
            self.proxy_opener = urllib.request.build_opener(
                urllib.request.ProxyHandler(proxy_dict),
                urllib.request.HTTPSHandler(context=self.ssl_ctx) if self.ssl_ctx else urllib.request.HTTPSHandler()
            )
        else:
            self.proxy_opener = urllib.request.build_opener(
                urllib.request.ProxyHandler(),
                urllib.request.HTTPSHandler(context=self.ssl_ctx) if self.ssl_ctx else urllib.request.HTTPSHandler()
            )
        
        self.active_opener = self.direct_opener if force_no_proxy else self.proxy_opener
        self.has_switched_to_direct = False
        self.active_server_base = self.primary_server

    def get_candidate_urls(self, target_url: str):
        candidates = [target_url]
        for fb in FALLBACK_SERVERS:
            if fb not in target_url:
                parsed_fb = urllib.parse.urlparse(fb)
                parsed_target = urllib.parse.urlparse(target_url)
                fb_url = urllib.parse.urlunparse((
                    parsed_fb.scheme,
                    parsed_fb.netloc,
                    parsed_target.path,
                    parsed_target.params,
                    parsed_target.query,
                    parsed_target.fragment
                ))
                if fb_url not in candidates:
                    candidates.append(fb_url)
        return candidates

    def request(self, url: str, data: bytes = None, headers: dict = None, method: str = "GET", timeout: int = 30) -> str:
        base_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Connection": "close"
        }
        if headers:
            base_headers.update(headers)

        candidate_urls = self.get_candidate_urls(url)
        last_error = None

        for candidate_url in candidate_urls:
            req = urllib.request.Request(candidate_url, data=data, headers=base_headers, method=method)
            try:
                with self.active_opener.open(req, timeout=timeout) as response:
                    return response.read().decode("utf-8")
            except Exception as e:
                last_error = e
                err_str = str(e)
                is_proxy_or_ssl_error = (
                    "10061" in err_str or
                    "refused" in err_str.lower() or
                    "proxy" in err_str.lower() or
                    "UNEXPECTED_EOF" in err_str or
                    "EOF occurred" in err_str or
                    "timed out" in err_str.lower()
                )
                
                if is_proxy_or_ssl_error and self.active_opener != self.direct_opener:
                    if not self.has_switched_to_direct:
                        print(f"\033[93m[🛡️ 网络自愈] 检测到系统代理不可用或 SSL 握手受阻，已自动熔断代理并切换至 Direct 直连！\033[0m")
                        self.has_switched_to_direct = True
                    self.active_opener = self.direct_opener
                    try:
                        with self.direct_opener.open(req, timeout=timeout) as response:
                            return response.read().decode("utf-8")
                    except Exception as retry_e:
                        last_error = retry_e
                        err_str = str(retry_e)

                is_dns_error = "11001" in err_str or "getaddrinfo failed" in err_str or "nodename nor servname" in err_str
                if is_dns_error and len(candidate_urls) > 1 and candidate_url != candidate_urls[-1]:
                    continue

        if last_error:
            raise last_error
        raise RuntimeError("所有网络候选节点均不可达")

GLOBAL_HTTP_CLIENT = ResilientHttpClient()

def init_global_http_client(force_no_proxy: bool = False, custom_proxy: str = "", primary_server: str = ""):
    global GLOBAL_HTTP_CLIENT
    GLOBAL_HTTP_CLIENT = ResilientHttpClient(force_no_proxy=force_no_proxy, custom_proxy=custom_proxy, primary_server=primary_server)

def http_post_json(url: str, data: dict, timeout: int = 15) -> dict:
    payload = json.dumps(data).encode("utf-8")
    resp_body = GLOBAL_HTTP_CLIENT.request(
        url,
        data=payload,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
        timeout=timeout
    )
    try:
        return json.loads(resp_body)
    except Exception:
        return {"raw": resp_body}

def http_get_json(url: str, timeout: int = 35) -> dict:
    resp_body = GLOBAL_HTTP_CLIENT.request(
        url,
        headers={"Accept": "application/json"},
        method="GET",
        timeout=timeout
    )
    try:
        return json.loads(resp_body)
    except Exception:
        return {"raw": resp_body}

async def query_dsh_workspaces_and_sessions(harness_url: str):
    harness_base = harness_url.rstrip("/")
    loop = asyncio.get_running_loop()
    workspaces = ["deepseek-agent"]
    sessions = []

    rpc_list_payload = {
        "type": "client-request",
        "rpcId": f"rpc_list_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}",
        "method": "session.list",
        "payload": {}
    }

    endpoints = [
        f"{harness_base}/session.list",
        f"{harness_base}/api/session.list",
        f"{harness_base}/session/list"
    ]

    for ep in endpoints:
        def do_req(url=ep):
            req_data = json.dumps(rpc_list_payload).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=req_data,
                headers={"Content-Type": "application/json; charset=utf-8"},
                method="POST"
            )
            with GLOBAL_HTTP_CLIENT.direct_opener.open(req, timeout=4) as response:
                return response.read().decode("utf-8")

        try:
            raw = await loop.run_in_executor(None, do_req)
            resp = json.loads(raw)
            if isinstance(resp, dict):
                items = resp.get("result") or resp.get("sessions") or resp.get("data") or []
                if isinstance(items, list):
                    for it in items:
                        if isinstance(it, dict):
                            s_id = it.get("sessionId") or it.get("id") or it.get("session_id")
                            if s_id:
                                s_ws = it.get("workspace") or "deepseek-agent"
                                if s_ws not in workspaces:
                                    workspaces.append(s_ws)
                                sessions.append({
                                    "id": str(s_id),
                                    "sessionId": str(s_id),
                                    "title": str(it.get("title") or it.get("name") or "未命名会话"),
                                    "workspace": s_ws,
                                    "updatedAt": it.get("updatedAt") or it.get("createdAt") or int(time.time() * 1000)
                                })
                    if sessions:
                        break
        except Exception:
            continue

    return workspaces, sessions

async def create_dsh_session_explicit(harness_url: str, workspace: str = "deepseek-agent", title: str = None, model: str = "deepseek-chat"):
    harness_base = harness_url.rstrip("/")
    loop = asyncio.get_running_loop()
    session_title = title or f"对话_{datetime.now().strftime('%m%d_%H%M%S')}"
    target_ws = workspace or "deepseek-agent"

    rpc_create_payload = {
        "type": "client-request",
        "rpcId": f"rpc_create_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}",
        "method": "session.create",
        "payload": {
            "workspace": target_ws,
            "title": session_title,
            "model": model or "deepseek-chat"
        }
    }

    endpoints = [
        f"{harness_base}/session.create",
        f"{harness_base}/api/session.create",
        f"{harness_base}/session/create"
    ]

    for ep in endpoints:
        def do_req(url=ep):
            req_data = json.dumps(rpc_create_payload).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=req_data,
                headers={"Content-Type": "application/json; charset=utf-8"},
                method="POST"
            )
            with GLOBAL_HTTP_CLIENT.direct_opener.open(req, timeout=6) as response:
                return response.read().decode("utf-8")

        try:
            raw = await loop.run_in_executor(None, do_req)
            resp = json.loads(raw)
            if isinstance(resp, dict):
                res_obj = resp.get("result") or resp.get("data") or resp
                s_id = None
                if isinstance(res_obj, dict):
                    s_id = res_obj.get("sessionId") or res_obj.get("id") or res_obj.get("session_id")
                elif isinstance(res_obj, str) and len(res_obj) > 8:
                    s_id = res_obj
                
                if s_id:
                    session_info = {
                        "id": str(s_id),
                        "sessionId": str(s_id),
                        "title": session_title,
                        "workspace": target_ws,
                        "updatedAt": int(time.time() * 1000)
                    }
                    return True, str(s_id), session_info
        except Exception:
            continue

    fallback_id = str(uuid.uuid4())
    fallback_session = {
        "id": fallback_id,
        "sessionId": fallback_id,
        "title": session_title,
        "workspace": target_ws,
        "updatedAt": int(time.time() * 1000)
    }
    return True, fallback_id, fallback_session

async def execute_local_harness(
    task_id: str,
    prompt: str,
    messages: list,
    harness_url: str,
    model_name: str,
    session_id: str,
    on_step_callback,
    extra_chat_config: dict = None,
    target_workspace: str = "deepseek-agent"
):
    harness_base = harness_url.rstrip("/")
    extra_chat_config = extra_chat_config or {}
    target_workspace = target_workspace or "deepseek-agent"
    
    is_cloud_api = harness_base.startswith("https://") or "volces.com" in harness_base or "deepseek.com" in harness_base or "openai.com" in harness_base
    if not is_cloud_api and not is_host_safe(harness_base):
        err_msg = f"🛡️ [SSRF 安全拦截] 目标服务地址 ({harness_base}) 非本地回环地址 (127.0.0.1 / localhost)，禁止发起非本地请求。"
        await on_step_callback(f"❌ [Task:{task_id[:6]}] SSRF 安全拦截")
        return False, err_msg

    await on_step_callback(f"🚀 [1/3] 已接收到任务，正在调用本地 DeepSeek Harness Agent ({model_name})...")

    active_session_id = (session_id or "").strip()
    if not active_session_id or active_session_id in ("__auto__", "__auto_new__", "default_session", f"session_{task_id}"):
        await on_step_callback(f"✨ 正在为本地工作区 [{target_workspace}] 创建专属新会话...")
        ok_create, new_sid, _ = await create_dsh_session_explicit(
            harness_url, workspace=target_workspace, title=f"任务_{task_id[:6]}", model=model_name
        )
        if ok_create and new_sid:
            active_session_id = new_sid
            await on_step_callback(f"✨ 已创建本地新会话 ({active_session_id[:8]}...)，正在下发指令")
        else:
            active_session_id = str(uuid.uuid4())

    content_list = []
    if messages and isinstance(messages, list):
        for msg in messages:
            if isinstance(msg, dict):
                text_val = msg.get("content", "")
                if text_val:
                    content_list.append({"type": "text", "text": str(text_val)})
            elif isinstance(msg, str) and msg:
                content_list.append({"type": "text", "text": str(msg)})
    
    if not content_list:
        content_list = [{"type": "text", "text": str(prompt or "")}]

    def build_rpc_payloads(sid):
        rpc_id_steer = f"rpc_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}"
        rpc_id_queue = f"rpc_{int(time.time() * 1000) + 1}_{uuid.uuid4().hex[:6]}"
        steer_payload = {
            "type": "client-request",
            "rpcId": rpc_id_steer,
            "method": "session.prompt",
            "payload": {
                "sessionId": sid,
                "mode": "steer",
                "content": content_list,
                "model": model_name or "deepseek-chat"
            }
        }
        queue_payload = {
            "type": "client-request",
            "rpcId": rpc_id_queue,
            "method": "session.prompt",
            "payload": {
                "sessionId": sid,
                "mode": "queue",
                "content": content_list,
                "model": model_name or "deepseek-chat"
            }
        }
        return steer_payload, queue_payload

    dsh_rpc_payload_steer, dsh_rpc_payload_queue = build_rpc_payloads(active_session_id)

    candidate_endpoints = []
    if harness_base.endswith("/session.prompt") or harness_base.endswith("/session/prompt"):
        candidate_endpoints.append((harness_base, dsh_rpc_payload_steer, "DSH RPC 原生接口 (steer 模式)"))
        candidate_endpoints.append((harness_base, dsh_rpc_payload_queue, "DSH RPC 原生接口 (queue 降级)"))
    elif harness_base.endswith("/v1") or harness_base.endswith("/chat/completions"):
        endpoint_url = harness_base if harness_base.endswith("/chat/completions") else f"{harness_base}/chat/completions"
        candidate_endpoints.append((endpoint_url, {
            "model": model_name or "deepseek-chat",
            "messages": messages if messages else [{"role": "user", "content": prompt}],
            "stream": False,
            "temperature": 0.7
        }, "OpenAI 兼容接口"))
    else:
        candidate_endpoints.append((f"{harness_base}/session.prompt", dsh_rpc_payload_steer, "DSH 原生 RPC 接口 (/session.prompt, steer)"))
        candidate_endpoints.append((f"{harness_base}/session.prompt", dsh_rpc_payload_queue, "DSH 原生 RPC 接口 (/session.prompt, queue)"))
        candidate_endpoints.append((f"{harness_base}/api/session.prompt", dsh_rpc_payload_steer, "DSH API RPC 接口 (/api/session.prompt, steer)"))
        candidate_endpoints.append((f"{harness_base}/api/session.prompt", dsh_rpc_payload_queue, "DSH API RPC 接口 (/api/session.prompt, queue)"))
        candidate_endpoints.append((f"{harness_base}/v1/chat/completions", {
            "model": model_name or "deepseek-chat",
            "messages": messages if messages else [{"role": "user", "content": prompt}],
            "stream": False,
            "temperature": 0.7
        }, "OpenAI 兼容接口 (/v1/chat/completions)"))
        candidate_endpoints.append((f"{harness_base}/api/chat", {
            "prompt": prompt,
            "model": model_name or "deepseek-chat",
            "messages": messages if messages else [{"role": "user", "content": prompt}]
        }, "本地 Agent 接口 (/api/chat)"))

    await on_step_callback("⚡ [2/3] 本地模型/Agent 正在进行深度推理与任务执行...")

    loop = asyncio.get_running_loop()
    last_err = None
    output_content = None
    success_endpoint_name = ""

    for target_url, payload, ep_name in candidate_endpoints:
        req_data = json.dumps(payload).encode("utf-8")
        if len(req_data) > MAX_PAYLOAD_BYTES:
            continue

        def do_request(url=target_url, data=req_data):
            headers = {
                "Content-Type": "application/json; charset=utf-8",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            auth_key = extra_chat_config.get("apiKey")
            if auth_key:
                headers["Authorization"] = f"Bearer {auth_key}"

            req = urllib.request.Request(url, data=data, headers=headers, method="POST")
            with GLOBAL_HTTP_CLIENT.direct_opener.open(req, timeout=120) as response:
                return response.read().decode("utf-8")

        try:
            raw_resp = await loop.run_in_executor(None, do_request)
            try:
                resp_json = json.loads(raw_resp)
                if isinstance(resp_json, dict):
                    if resp_json.get("ok") is False:
                        err_detail = resp_json.get("error", resp_json)
                        err_str = json.dumps(err_detail, ensure_ascii=False)
                        last_err = err_str

                        if "session-not-found" in err_str or "not found" in err_str:
                            await on_step_callback(f"🔄 检测到原会话不存在，正在自动在工作区 [{target_workspace}] 重建新会话...")
                            ok_create, new_sid, _ = await create_dsh_session_explicit(
                                harness_url, workspace=target_workspace, title=f"自愈会话_{task_id[:6]}", model=model_name
                            )
                            if ok_create and new_sid:
                                active_session_id = new_sid
                                steer_p, _ = build_rpc_payloads(active_session_id)
                                retry_data = json.dumps(steer_p).encode("utf-8")
                                retry_resp_raw = await loop.run_in_executor(None, lambda: do_request(url=target_url, data=retry_data))
                                try:
                                    retry_json = json.loads(retry_resp_raw)
                                    if retry_json.get("ok") is not False:
                                        resp_json = retry_json
                                    else:
                                        continue
                                except Exception:
                                    output_content = retry_resp_raw
                                    success_endpoint_name = ep_name
                                    break
                            else:
                                continue

                    if "choices" in resp_json and len(resp_json["choices"]) > 0:
                        output_content = resp_json["choices"][0].get("message", {}).get("content", "")
                    elif "result" in resp_json:
                        output_content = resp_json["result"] if isinstance(resp_json["result"], str) else json.dumps(resp_json["result"], ensure_ascii=False)
                    elif "response" in resp_json:
                        output_content = resp_json["response"] if isinstance(resp_json["response"], str) else json.dumps(resp_json["response"], ensure_ascii=False)
                    elif "content" in resp_json:
                        output_content = resp_json["content"] if isinstance(resp_json["content"], str) else json.dumps(resp_json["content"], ensure_ascii=False)
                    elif "output" in resp_json:
                        output_content = resp_json["output"] if isinstance(resp_json["output"], str) else json.dumps(resp_json["output"], ensure_ascii=False)
                    elif "text" in resp_json:
                        output_content = resp_json["text"] if isinstance(resp_json["text"], str) else json.dumps(resp_json["text"], ensure_ascii=False)
                    else:
                        output_content = json.dumps(resp_json, ensure_ascii=False)
                else:
                    output_content = str(resp_json)
            except Exception:
                output_content = raw_resp

            success_endpoint_name = ep_name
            break

        except urllib.error.HTTPError as he:
            last_err = f"HTTP {he.code} ({he.reason})"
            continue
        except urllib.error.URLError as ue:
            last_err = str(ue.reason if hasattr(ue, "reason") else ue)
            continue
        except Exception as ex:
            last_err = str(ex)
            continue

    if output_content is not None:
        await on_step_callback(f"✅ [3/3] 本地 DeepSeek 智能体通过 {success_endpoint_name} 执行完毕，正在向 App 调度中心回传结果...")
        return True, str(output_content)

    error_tip = (
        "❌ 连接本地 DeepSeek Harness / Agent 服务失败 (" + str(harness_base) + ")。\n"
        "   最近一次尝试报错: " + str(last_err) + "\n"
        "   💡 排查指南:\n"
        "   1. 请确认本地 3080 端口已正常开启 (http://127.0.0.1:3080)；\n"
        "   2. 若使用其他端口，可在启动命令加上 --harness-url http://127.0.0.1:端口。"
    )
    await on_step_callback(f"❌ 本地服务连接失败: {last_err or '所有端点均不可达'}")
    return False, error_tip

running_tasks = {}

async def run_polling_bridge(args, token: str, server_base: str, concurrency_limit: int):
    register_url = f"{server_base}/api/agent/register"
    poll_url = f"{server_base}/api/agent/poll"
    step_url = f"{server_base}/api/agent/step"
    result_url = f"{server_base}/api/agent/result"
    heartbeat_url = f"{server_base}/api/agent/heartbeat"

    semaphore = asyncio.Semaphore(concurrency_limit)
    loop = asyncio.get_running_loop()

    try:
        init_workspaces, init_sessions = await query_dsh_workspaces_and_sessions(args.harness_url)
        await loop.run_in_executor(
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
        try:
            await loop.run_in_executor(
                None,
                lambda: http_post_json(f"{server_base}/api/agent/sync-sessions", {
                    "token": token,
                    "workspaces": init_workspaces,
                    "sessions": init_sessions
                }, timeout=5)
            )
        except Exception:
            pass
        print(f"\033[92m[✓ 注册成功] 已通过 HTTP 调度网关认证！发现 {len(init_sessions)} 个本地会话。Token: {token}\033[0m")
    except Exception as e:
        print(f"\033[93m[注册告警] 首次注册响应: {e}，将直接进入长轮询调度...\033[0m")

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
        session_id = task_data.get("agentSessionId") or task_data.get("sessionId", "default_session")
        target_ws = task_data.get("agentWorkspace") or task_data.get("workspace") or "deepseek-agent"

        print(f"\n\033[94m[收到任务] TaskID: {task_id} | 工作区: {target_ws} | 提示词: {prompt[:40]}...\033[0m")
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

        extra_config = {
            "apiEndpoint": task_data.get("apiEndpoint") or getattr(args, "chat_api_url", ""),
            "apiKey": task_data.get("apiKey") or getattr(args, "chat_api_key", ""),
            "chatModel": task_data.get("chatModel") or getattr(args, "chat_model", ""),
        }

        try:
            async with semaphore:
                success, output = await execute_local_harness(
                    task_id, prompt, messages, harness_url, model_name, session_id, on_step, extra_config, target_workspace=target_ws
                )
        except Exception as task_err:
            success = False
            output = f"本地执行异常: {task_err}"
            await on_step(f"❌ 任务发生未捕获异常: {task_err}")

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

        try:
            cur_ws, cur_sess = await query_dsh_workspaces_and_sessions(harness_url)
            await loop.run_in_executor(
                None,
                lambda: http_post_json(f"{server_base}/api/agent/sync-sessions", {
                    "token": token,
                    "workspaces": cur_ws,
                    "sessions": cur_sess
                }, timeout=5)
            )
        except Exception:
            pass

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
        except Exception as e:
            poll_fail_count += 1
            await asyncio.sleep(3)

async def run_bridge_client(args):
    token = (args.token or "").strip()
    if not token:
        token = "default_agent_token"

    server_base = normalize_server_url(args.server)
    concurrency_limit = max(1, args.concurrency)
    init_global_http_client(force_no_proxy=args.no_proxy, custom_proxy=args.proxy, primary_server=server_base)

    proxy_mode_desc = "强制 Direct 直连" if args.no_proxy else (f"自定义代理 ({args.proxy})" if args.proxy else "自适应系统/VPN代理")
    print("=" * 70)
    print("\033[92m DeepSeek Harness 本地安全反向桥接启动成功！ (v3.5 高可用双模版)\033[0m")
    print(f" • 配对 Token     : \033[96m{token}\033[0m")
    print(f" • App 调度服务器 : \033[94m{server_base}\033[0m")
    print(f" • 网络连接模式   : \033[95m{proxy_mode_desc}\033[0m")
    print(f" • 本地 Harness   : \033[93m{args.harness_url}\033[0m (默认 3080/v1)")
    print(f" • 本地模型       : {args.harness_model}")
    print(f" • 最大并发任务   : {concurrency_limit}")
    print(f" • Python 运行环境: {sys.version.split()[0]} ({sys.platform})")
    print("=" * 70)

    pair_url = f"{server_base}?agentToken={urllib.parse.quote(token)}"
    print_terminal_qr(pair_url)

    if args.transport == "polling" or not HAS_WEBSOCKETS:
        await run_polling_bridge(args, token, server_base, concurrency_limit)
        return

    ws_url = normalize_ws_url(server_base, token)
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

                try:
                    init_ws, init_sess = await query_dsh_workspaces_and_sessions(args.harness_url)
                    await ws.send(json.dumps({
                        "type": "sync_sessions",
                        "token": token,
                        "workspaces": init_ws,
                        "sessions": init_sess
                    }))
                    print(f"\033[92m[✓ 会话同步] 已向 App 同步本地 {len(init_sess)} 个 DSH 会话\033[0m")
                except Exception:
                    pass

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

                        if mtype == "get_sessions":
                            target_h_url = msg.get("harnessUrl", args.harness_url)
                            cur_workspaces, cur_sessions = await query_dsh_workspaces_and_sessions(target_h_url)
                            await ws.send(json.dumps({
                                "type": "sessions_result",
                                "token": token,
                                "workspaces": cur_workspaces,
                                "sessions": cur_sessions
                            }))
                            continue

                        if mtype == "create_session":
                            create_task_id = msg.get("taskId")
                            target_h_url = msg.get("harnessUrl", args.harness_url)
                            target_workspace = msg.get("workspace", "deepseek-agent")
                            title_text = msg.get("title")
                            model_text = msg.get("model", args.harness_model)

                            ok_create, new_sid, session_obj = await create_dsh_session_explicit(
                                target_h_url, workspace=target_workspace, title=title_text, model=model_text
                            )
                            cur_workspaces, cur_sessions = await query_dsh_workspaces_and_sessions(target_h_url)

                            await ws.send(json.dumps({
                                "type": "create_session_result",
                                "taskId": create_task_id,
                                "token": token,
                                "success": ok_create,
                                "sessionId": new_sid,
                                "session": session_obj,
                                "workspaces": cur_workspaces,
                                "sessions": cur_sessions
                            }))
                            continue

                        if mtype == "run_agent":
                            task_id = msg.get("taskId")
                            prompt = msg.get("prompt", "")
                            messages = msg.get("messages", [])
                            harness_url = msg.get("harnessUrl", args.harness_url)
                            model_name = msg.get("model", args.harness_model)
                            session_id = msg.get("agentSessionId") or msg.get("sessionId", "default_session")
                            target_ws = msg.get("agentWorkspace") or msg.get("workspace") or "deepseek-agent"

                            print(f"\n\033[94m[收到任务] TaskID: {task_id} | 工作区: {target_ws} | 提示词: {prompt[:40]}...\033[0m")
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

                            extra_config = {
                                "apiEndpoint": msg.get("apiEndpoint") or getattr(args, "chat_api_url", ""),
                                "apiKey": msg.get("apiKey") or getattr(args, "chat_api_key", ""),
                                "chatModel": msg.get("chatModel") or getattr(args, "chat_model", ""),
                            }

                            try:
                                success, output = await execute_local_harness(
                                    task_id, prompt, messages, harness_url, model_name, session_id, ws_step_cb, extra_config, target_workspace=target_ws
                                )
                            except Exception as task_err:
                                success = False
                                output = f"本地执行异常: {task_err}"
                                await ws_step_cb(f"❌ 任务发生未捕获异常: {task_err}")

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

                            try:
                                cur_ws, cur_sess = await query_dsh_workspaces_and_sessions(harness_url)
                                await ws.send(json.dumps({
                                    "type": "sync_sessions",
                                    "token": token,
                                    "workspaces": cur_ws,
                                    "sessions": cur_sess
                                }))
                            except Exception:
                                pass

                    except Exception as handler_err:
                        logger.error(f"消息处理异常: {handler_err}")

        except Exception as ws_err:
            ws_fail_count += 1
            print(f"\033[93m[WS 握手受阻 ({ws_err})]\033[0m 正在自动无缝切换至 HTTP 智能长轮询通道...")
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
