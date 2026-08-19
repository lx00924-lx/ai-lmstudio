import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { WebSocketServer, WebSocket as WSWebSocket } from "ws";
import path from "path";
import fs from "fs/promises";
import { createWriteStream } from "fs";
import multer from "multer";
import { createServer as createViteServer } from "vite";
import cors from "cors";

const PORT = 3000;
const MESSAGES_FILE = path.join(process.cwd(), "messages_data", "messages_v2.json"); // Use v2 to avoid conflicts
const USERS_FILE = path.join(process.cwd(), "messages_data", "users.json");
const SETTINGS_FILE = path.join(process.cwd(), "messages_data", "settings.json");
const UPLOADS_DIR = path.join(process.cwd(), "messages_media");

// File lock mechanism to prevent race conditions during concurrent JSON writes
const fileLocks: Map<string, Promise<any>> = new Map();

async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const currentLock = fileLocks.get(filePath) || Promise.resolve();
  let release: () => void = () => {};
  const nextLock = new Promise<void>((resolve) => { release = resolve; });
  fileLocks.set(filePath, currentLock.then(() => nextLock));

  try {
    await currentLock;
    return await fn();
  } finally {
    release();
  }
}

// Atomic file write using temporary file with Windows EPERM retry and fallback
async function safeWriteJSON(filePath: string, data: any): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true }).catch(() => {});

  const tempPath = `${filePath}.tmp.${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const content = JSON.stringify(data, null, 2);

  try {
    await fs.writeFile(tempPath, content, "utf-8");

    // Attempt rename with retries for Windows NTFS file locking
    let renamed = false;
    for (let i = 0; i < 5; i++) {
      try {
        await fs.rename(tempPath, filePath);
        renamed = true;
        break;
      } catch (err: any) {
        if (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES') {
          await new Promise(r => setTimeout(r, 40 * (i + 1)));
        } else {
          throw err;
        }
      }
    }

    if (!renamed) {
      // Fallback directly to write target file if rename is continuously locked on Windows
      await fs.writeFile(filePath, content, "utf-8");
      await fs.unlink(tempPath).catch(() => {});
    }
  } catch (err) {
    // Clean up temporary file
    await fs.unlink(tempPath).catch(() => {});
    // Direct write fallback as last resort
    await fs.writeFile(filePath, content, "utf-8");
  }
}

// Robust JSON reader with auto-recovery for corrupted JSON files
async function safeReadJSON<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    return JSON.parse(trimmed) as T;
  } catch (error) {
    console.error(`[JSON Read Error] Failed to parse ${filePath}:`, error);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const firstBrace = raw.indexOf('{');
      const lastBrace = raw.lastIndexOf('}');
      const firstBracket = raw.indexOf('[');
      const lastBracket = raw.lastIndexOf(']');

      let candidate = '';
      if (firstBracket !== -1 && lastBracket > firstBracket) {
        candidate = raw.substring(firstBracket, lastBracket + 1);
      } else if (firstBrace !== -1 && lastBrace > firstBrace) {
        candidate = raw.substring(firstBrace, lastBrace + 1);
      }

      if (candidate) {
        const parsed = JSON.parse(candidate);
        console.log(`[JSON Recovery] Recovered clean JSON for ${filePath}`);
        await safeWriteJSON(filePath, parsed);
        return parsed as T;
      }
    } catch (recoveryErr) {
      console.error(`[JSON Recovery Failed] Backing up corrupted file ${filePath}`);
      try {
        await fs.writeFile(`${filePath}.corrupted.${Date.now()}`, await fs.readFile(filePath));
        await safeWriteJSON(filePath, fallback);
      } catch (e) {
        console.error("Failed to write fallback file:", e);
      }
    }
    return fallback;
  }
}

// Helper to normalize and sanitize custom OpenAI-compatible API endpoints
function normalizeApiBaseUrl(rawEndpoint: string): string {
  if (!rawEndpoint) return '';
  let endpoint = rawEndpoint.trim();
  
  if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
    if (
      endpoint.startsWith('localhost') || 
      endpoint.startsWith('127.0.0.1') || 
      endpoint.startsWith('192.168.') || 
      endpoint.startsWith('10.')
    ) {
      endpoint = `http://${endpoint}`;
    } else {
      endpoint = `https://${endpoint}`;
    }
  }

  endpoint = endpoint.replace(/\/+$/, '');

  endpoint = endpoint
    .replace(/\/chat\/completions\/?$/i, '')
    .replace(/\/completions\/?$/i, '')
    .replace(/\/models\/?$/i, '')
    .replace(/\/responses\/?$/i, '')
    .replace(/\/embeddings\/?$/i, '')
    .replace(/\/+$/, '');

  if (endpoint.includes('dashscope.aliyuncs.com')) {
    if (!endpoint.includes('/compatible-mode/v1')) {
      endpoint = endpoint.replace(/\/+$/, '');
      if (endpoint.endsWith('/v1')) {
        endpoint = endpoint.replace(/\/v1$/, '/compatible-mode/v1');
      } else {
        endpoint = `${endpoint}/compatible-mode/v1`;
      }
    }
    return endpoint;
  }

  if (endpoint.includes('open.bigmodel.cn')) {
    if (!endpoint.includes('/api/paas/v4')) {
      endpoint = endpoint.replace(/\/+$/, '');
      if (endpoint.endsWith('/v1') || endpoint.endsWith('/v4')) {
        endpoint = endpoint.replace(/\/(v1|v4)$/, '/api/paas/v4');
      } else {
        endpoint = `${endpoint}/api/paas/v4`;
      }
    }
    return endpoint;
  }

  if (endpoint.includes('volces.com') || endpoint.includes('volcengine.com')) {
    if (!endpoint.includes('/api/v3') && !endpoint.includes('/api/')) {
      endpoint = `${endpoint}/api/v3`;
    }
    return endpoint;
  }

  if (endpoint.includes('qianfan.baidubce.com')) {
    if (!endpoint.includes('/v2') && !endpoint.includes('/v1')) {
      endpoint = `${endpoint}/v2`;
    }
    return endpoint;
  }

  const hasVersionPath = /\/(v\d+|api\/v\d+|compatible-mode\/v\d+|api\/paas\/v\d+)$/i.test(endpoint) || /\/v\d+\//i.test(endpoint) || /\/api\//i.test(endpoint);
  if (!hasVersionPath) {
    endpoint = `${endpoint}/v1`;
  }

  return endpoint;
}

function getChatCompletionsUrl(endpoint: string): string {
  const base = normalizeApiBaseUrl(endpoint);
  return `${base}/chat/completions`;
}

interface ActiveGeneration {
  userId: string;
  assistantMessageId: string;
  content: string;
  status: 'generating' | 'completed' | 'error';
  error?: string;
  startedAt: number;
  abortController: AbortController;
}

const activeGenerations = new Map<string, ActiveGeneration>();

async function upsertMessage(userId: string, message: any) {
  if (!userId || userId === 'guest') return;
  await withFileLock(MESSAGES_FILE, async () => {
    const allMessages = await safeReadJSON<Record<string, any[]>>(MESSAGES_FILE, {});
    if (!allMessages[userId]) allMessages[userId] = [];
    const idx = allMessages[userId].findIndex((m: any) => m.id === message.id);
    if (idx !== -1) {
      allMessages[userId][idx] = { ...allMessages[userId][idx], ...message };
    } else {
      allMessages[userId].push(message);
    }
    await safeWriteJSON(MESSAGES_FILE, allMessages);
  });
}

async function runServerSideGeneration({
  userId,
  assistantMessageId,
  messages,
  settings,
  io
}: {
  userId: string;
  assistantMessageId: string;
  messages: any[];
  settings: any;
  io: Server;
}) {
  const genKey = `${userId}_${assistantMessageId}`;
  if (activeGenerations.has(genKey)) {
    return;
  }

  const abortController = new AbortController();
  const genState: ActiveGeneration = {
    userId,
    assistantMessageId,
    content: "",
    status: 'generating',
    startedAt: Date.now(),
    abortController,
  };
  activeGenerations.set(genKey, genState);

  // Initial placeholder save in DB (guarded against file lock interruptions)
  const initialAssistantMessage = {
    id: assistantMessageId,
    role: 'assistant',
    content: '',
    timestamp: new Date().toISOString(),
    type: 'text',
    status: 'generating',
  };
  try {
    await upsertMessage(userId, initialAssistantMessage);
  } catch (initialErr) {
    console.warn(`[Server Background Gen] Initial placeholder save skipped due to file lock:`, initialErr);
  }

  try {
    const apiEndpoint = settings?.apiEndpoint?.trim();
    const apiKey = settings?.apiKey || process.env.GEMINI_API_KEY || "";
    const modelName = settings?.modelName;
    const systemInstruction = settings?.systemInstruction;
    const contextLength = settings?.contextLength || 30000;

    let accumulatedContent = "";

    const onChunk = (chunk: string) => {
      accumulatedContent += chunk;
      genState.content = accumulatedContent;
      io.to(`user_${userId}`).emit("chat_chunk", {
        messageId: assistantMessageId,
        chunk,
        fullContent: accumulatedContent,
      });
    };

    if (apiEndpoint) {
      // OpenAI compatible flow
      const url = getChatCompletionsUrl(apiEndpoint);
      console.log(`[Server Background Gen] Calling OpenAI compatible API: ${url} (model: ${modelName || 'default'})`);
      
      const systemMessage = systemInstruction 
        ? [{ role: 'system', content: systemInstruction }] 
        : [];

      const mapMessageToContent = (msg: any) => {
        let text = msg.content;
        if (!text) {
          if (msg.type === 'image') text = '[图片]';
          else if (msg.type === 'voice') text = '[语音]';
          else text = ' ';
        }
        if (msg.quote) {
          text = `引用消息: "${msg.quote.content}"\n\n回复上面的消息: ${text}`;
        }
        if (msg.type === 'image' && msg.mediaUrl) {
          return [
            { type: 'text', text: text || ' ' },
            { type: 'image_url', image_url: { url: msg.mediaUrl } }
          ];
        }
        return text || ' ';
      };

      let currentTokens = 0;
      const recentHistory: any[] = [];
      const historyMessages = messages.slice(0, -1).reverse();
      for (const msg of historyMessages) {
        const msgTokens = Math.ceil((msg.content || "").length * 1.5);
        if (currentTokens + msgTokens > contextLength) break;
        currentTokens += msgTokens;
        recentHistory.unshift(msg);
      }

      const formattedHistory = recentHistory.map((m: any) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: mapMessageToContent(m),
      }));

      const lastMsg = messages[messages.length - 1] || { role: 'user', content: ' ' };
      const formattedLast = {
        role: 'user',
        content: mapMessageToContent(lastMsg),
      };

      const requestBody = {
        model: modelName || "local-model",
        messages: [
          ...systemMessage,
          ...formattedHistory,
          formattedLast,
        ],
        stream: true,
      };

      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey || "lm-studio"}`,
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => "");
        throw new Error(`API 返回错误 ${resp.status}: ${errBody.substring(0, 300)}`);
      }

      if (resp.body) {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data:")) continue;
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === "[DONE]") continue;
            try {
              const json = JSON.parse(dataStr);
              const delta = json.choices?.[0]?.delta?.content 
                || json.choices?.[0]?.delta?.reasoning_content 
                || json.choices?.[0]?.delta?.text 
                || json.choices?.[0]?.text 
                || "";
              if (delta) {
                onChunk(delta);
              }
            } catch (_) {}
          }
        }
      } else {
        const json: any = await resp.json();
        const full = json.choices?.[0]?.message?.content 
          || json.choices?.[0]?.message?.reasoning_content 
          || json.choices?.[0]?.text 
          || "";
        if (full) onChunk(full);
      }

    } else {
      // Google Gemini SDK flow
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || "" });
      const targetModel = modelName || "gemini-2.5-flash";

      const mapToGeminiParts = (msg: any) => {
        let text = msg.content;
        if (!text) {
          if (msg.type === 'image') text = '[图片]';
          else if (msg.type === 'voice') text = '[语音]';
          else text = ' ';
        }
        if (msg.quote) {
          text = `引用消息: "${msg.quote.content}"\n\n回复上面的消息: ${text}`;
        }
        const parts: any[] = [{ text: text || ' ' }];
        if ((msg.type === 'image' || msg.type === 'voice') && msg.mediaUrl) {
          try {
            const commaIndex = msg.mediaUrl.indexOf(',');
            if (commaIndex !== -1) {
              const base64Data = msg.mediaUrl.substring(commaIndex + 1);
              const metaPart = msg.mediaUrl.substring(0, commaIndex);
              const mimeMatch = metaPart.match(/data:([a-zA-Z0-9-]+\/[a-zA-Z0-9-.+]+)/);
              const mimeType = mimeMatch ? mimeMatch[1] : (msg.type === 'voice' ? 'audio/wav' : 'image/jpeg');
              parts.push({
                inlineData: {
                  data: base64Data,
                  mimeType,
                }
              });
            }
          } catch (e) {
            console.error("Error parsing media URL in server gen:", e);
          }
        }
        return parts;
      };

      let currentTokens = 0;
      const recentHistory: any[] = [];
      const historyMessages = messages.slice(0, -1).reverse();
      for (const msg of historyMessages) {
        const msgTokens = Math.ceil((msg.content || "").length * 1.5);
        if (currentTokens + msgTokens > contextLength) break;
        currentTokens += msgTokens;
        recentHistory.unshift(msg);
      }

      const formattedHistory = recentHistory.map((m: any) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: mapToGeminiParts(m),
      }));

      const lastMsg = messages[messages.length - 1] || { role: 'user', content: ' ' };
      const lastParts = mapToGeminiParts(lastMsg);

      const responseStream = await ai.models.generateContentStream({
        model: targetModel,
        contents: [
          ...formattedHistory,
          { role: 'user', parts: lastParts },
        ],
        config: {
          ...(systemInstruction ? { systemInstruction } : {}),
          tools: [{ googleSearch: {} }] as any,
        }
      });

      for await (const chunk of responseStream) {
        if (chunk.text) {
          onChunk(chunk.text);
        }
      }
    }

    genState.status = 'completed';
    genState.content = accumulatedContent;
    const finalAssistantMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: accumulatedContent,
      timestamp: new Date().toISOString(),
      type: 'text',
      status: 'completed',
    };
    await upsertMessage(userId, finalAssistantMessage);

    io.to(`user_${userId}`).emit("chat_completed", {
      messageId: assistantMessageId,
      content: accumulatedContent,
    });
    console.log(`[Server Background Gen] Completed for msg ${assistantMessageId} (${accumulatedContent.length} chars)`);

  } catch (err: any) {
    console.error(`[Server Background Gen] Error for msg ${assistantMessageId}:`, err);
    genState.status = 'error';
    genState.error = err.message || "生成失败";

    const errorAssistantMessage = {
      id: assistantMessageId,
      role: 'assistant',
      content: genState.content || `[生成失败: ${err.message || '网络中断'}]`,
      timestamp: new Date().toISOString(),
      type: 'text',
      status: 'error',
    };
    await upsertMessage(userId, errorAssistantMessage);

    io.to(`user_${userId}`).emit("chat_error", {
      messageId: assistantMessageId,
      error: err.message || "生成失败",
    });
  } finally {
    setTimeout(() => {
      activeGenerations.delete(genKey);
    }, 10 * 60 * 1000);
  }
}

// Ensure directories and files exist
async function ensureDirs() {
  try {
    await fs.mkdir(path.dirname(MESSAGES_FILE), { recursive: true });
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    
    const checkFile = async (filePath: string, defaultContent: any) => {
      await safeReadJSON(filePath, defaultContent);
    };

    await checkFile(MESSAGES_FILE, {}); // Map of userId -> messages[]
    await checkFile(USERS_FILE, []); // Simple user list
    await checkFile(SETTINGS_FILE, {}); // Map of userId -> settings
  } catch (error) {
    console.error("Error creating directories:", error);
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ 
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

async function startServer() {
  await ensureDirs();

  const app = express();
  app.use(cors());
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" },
    maxHttpBufferSize: 1e8,
  });

  app.use(express.json({ limit: "50mb" }));
  app.use("/uploads", express.static(UPLOADS_DIR));

  // User Auth API
  app.post("/api/register", async (req, res) => {
    const { username, password } = req.body;
    console.log(`Registration attempt for username: ${username}`);
    try {
      let registeredUser: any = null;
      let errorMsg = "";

      await withFileLock(USERS_FILE, async () => {
        const users = await safeReadJSON<any[]>(USERS_FILE, []);
        if (users.find((u: any) => u.username === username)) {
          errorMsg = "User already exists";
          return;
        }
        const newUser = { id: Date.now().toString(), username, password };
        users.push(newUser);
        await safeWriteJSON(USERS_FILE, users);
        registeredUser = newUser;
      });

      if (errorMsg) {
        console.log(`Registration failed: ${errorMsg} for ${username}`);
        return res.status(400).json({ error: errorMsg });
      }

      console.log(`Registration successful for username: ${username}`);
      res.json({ user: { id: registeredUser.id, username: registeredUser.username } });
    } catch (e) {
      console.error(`Registration error for ${username}:`, e);
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/login", async (req, res) => {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: "Invalid request body" });
    }
    const { username, password } = req.body;
    console.log(`Login attempt for username: ${username}`);
    try {
      const users = await safeReadJSON<any[]>(USERS_FILE, []);
      const user = users.find((u: any) => u.username === username);
      
      if (!user) {
        console.log(`Login failed for username: ${username}. User not found.`);
        return res.status(401).json({ error: "账号不存在" });
      }
      
      if (user.password !== password) {
        console.log(`Login failed for username: ${username}. Incorrect password.`);
        return res.status(401).json({ error: "密码错误" });
      }

      console.log(`Login successful for username: ${username}`);
      res.json({ user: { id: user.id, username: user.username } });
    } catch (e) {
      console.error(`Login error for ${username}:`, e);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // REST API for messages (Per user)
  app.get("/api/messages/:userId", async (req, res) => {
    try {
      const allMessages = await safeReadJSON<Record<string, any[]>>(MESSAGES_FILE, {});
      res.json(allMessages[req.params.userId] || []);
    } catch (error) {
      res.status(500).json({ error: "Failed to load messages" });
    }
  });

  app.post("/api/sync-messages", async (req, res) => {
    const { userId, messages } = req.body;
    try {
      await withFileLock(MESSAGES_FILE, async () => {
        const allMessages = await safeReadJSON<Record<string, any[]>>(MESSAGES_FILE, {});
        if (!allMessages[userId]) allMessages[userId] = [];
        // Combine existing with synced, avoiding duplicates based on ID
        const newMessages = [...allMessages[userId], ...messages];
        const uniqueMessages = Array.from(new Map(newMessages.map(m => [m.id, m])).values());
        allMessages[userId] = uniqueMessages;
        await safeWriteJSON(MESSAGES_FILE, allMessages);
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Sync messages error:", error);
      res.status(500).json({ error: "Failed to sync messages" });
    }
  });

  // Server-side Background Chat Generation (Persists even if client is closed/killed)
  app.post("/api/chat/generate", async (req, res) => {
    const { userId, assistantMessageId, messages, settings } = req.body;
    if (!assistantMessageId || !Array.isArray(messages)) {
      return res.status(400).json({ error: "Invalid parameters" });
    }
    
    // Start asynchronous generation in the background
    runServerSideGeneration({
      userId: userId || "guest",
      assistantMessageId,
      messages,
      settings: settings || {},
      io
    }).catch(err => {
      console.error("[Background Gen Worker] Uncaught error:", err);
    });

    res.json({ success: true, messageId: assistantMessageId, status: "generating" });
  });

  // Settings API
  app.get("/api/settings/:userId", async (req, res) => {
    try {
      const allSettings = await safeReadJSON<Record<string, any>>(SETTINGS_FILE, {});
      res.json(allSettings[req.params.userId] || {});
    } catch (error) {
      res.status(500).json({ error: "Failed to load settings" });
    }
  });

  app.post("/api/change-password", async (req, res) => {
    const { userId, oldPassword, newPassword } = req.body;
    try {
      let success = false;
      let errorMsg = "";
      await withFileLock(USERS_FILE, async () => {
        const users = await safeReadJSON<any[]>(USERS_FILE, []);
        const userIndex = users.findIndex((u: any) => u.id === userId && u.password === oldPassword);
        if (userIndex === -1) {
          errorMsg = "原密码错误";
          return;
        }
        users[userIndex].password = newPassword;
        await safeWriteJSON(USERS_FILE, users);
        success = true;
      });

      if (!success) {
        return res.status(401).json({ error: errorMsg || "修改失败" });
      }
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "服务器错误" });
    }
  });

  app.post("/api/upload-chunk", upload.single("chunk"), async (req, res) => {
    try {
      const { filename, chunkIndex, totalChunks } = req.body;
      const chunkDir = path.join(UPLOADS_DIR, `temp_${filename}`);
      await fs.mkdir(chunkDir, { recursive: true });
      await fs.rename(req.file!.path, path.join(chunkDir, chunkIndex));
      
      const files = await fs.readdir(chunkDir);
      if (files.length === parseInt(totalChunks)) {
        // Assemble
        const finalPath = path.join(UPLOADS_DIR, filename);
        const writeStream = createWriteStream(finalPath);
        
        await new Promise<void>((resolve, reject) => {
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
          (async () => {
            try {
              for (let i = 0; i < files.length; i++) {
                const chunkPath = path.join(chunkDir, i.toString());
                const chunkData = await fs.readFile(chunkPath);
                writeStream.write(chunkData);
                await fs.unlink(chunkPath).catch(() => {});
              }
              writeStream.end();
            } catch (err) {
              writeStream.destroy();
              reject(err);
            }
          })();
        });

        await fs.rmdir(chunkDir).catch(() => {});
        res.json({ url: `/uploads/${filename}`, completed: true });
      } else {
        res.json({ completed: false });
      }
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Chunk upload failed" });
    }
  });
  
  app.post("/api/upload", upload.single("image"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    res.json({ url: `/uploads/${req.file.filename}` });
  });

  // Universal Proxy route for Voice Transcription (FunASR & OpenAI/Whisper compatible APIs)
  app.post("/api/funasr-transcribe", upload.single("file"), async (req, res) => {
    try {
      const rawEndpoint = (req.query.endpoint as string) || "";
      if (!rawEndpoint) {
        return res.status(400).json({ error: "Missing endpoint parameter" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const apiKey = (req.headers["x-asr-api-key"] as string) || 
                     (req.headers["x-api-key"] as string) || 
                     (req.headers["authorization"]?.replace(/^Bearer\s+/i, "")) || 
                     (req.query.apiKey as string) || "";

      let model = (req.query.model as string) || (req.headers["x-asr-model"] as string) || "";

      let sanitized = rawEndpoint.trim();
      if (sanitized.startsWith('ws://')) {
        sanitized = sanitized.replace('ws://', 'http://');
      } else if (sanitized.startsWith('wss://')) {
        sanitized = sanitized.replace('wss://', 'https://');
      } else if (!sanitized.startsWith('http://') && !sanitized.startsWith('https://')) {
        if (
          sanitized.startsWith('localhost') || 
          sanitized.startsWith('127.0.0.1') || 
          sanitized.startsWith('192.168.') || 
          sanitized.startsWith('10.') || 
          sanitized.startsWith('172.') ||
          /^(\d{1,3}\.){3}\d{1,3}/.test(sanitized)
        ) {
          sanitized = `http://${sanitized}`;
        } else {
          sanitized = `https://${sanitized}`;
        }
      }

      // Check if this is an OpenAI/Whisper compatible endpoint
      const isOpenAiCompatible = 
        sanitized.includes('/audio/transcriptions') ||
        sanitized.includes('openai.com') ||
        sanitized.includes('groq.com') ||
        sanitized.includes('siliconflow.cn') ||
        sanitized.includes('dashscope.aliyuncs.com') ||
        sanitized.endsWith('/v1') ||
        sanitized.endsWith('/v1/') ||
        !!model;

      // Auto-append /audio/transcriptions if user provided a base URL for an OpenAI compatible provider
      if (isOpenAiCompatible && !sanitized.includes('/audio/transcriptions')) {
        sanitized = sanitized.replace(/\/+$/, '');
        if (sanitized.includes('dashscope.aliyuncs.com')) {
          if (!sanitized.includes('/compatible-mode/v1')) {
            sanitized = `${sanitized}/compatible-mode/v1/audio/transcriptions`;
          } else {
            sanitized = `${sanitized}/audio/transcriptions`;
          }
        } else if (sanitized.includes('groq.com')) {
          if (!sanitized.includes('/openai/v1') && !sanitized.includes('/v1')) {
            sanitized = `${sanitized}/openai/v1/audio/transcriptions`;
          } else {
            sanitized = `${sanitized}/audio/transcriptions`;
          }
        } else if (sanitized.endsWith('/v1')) {
          sanitized = `${sanitized}/audio/transcriptions`;
        } else if (!sanitized.includes('/v1/')) {
          sanitized = `${sanitized}/v1/audio/transcriptions`;
        } else {
          sanitized = `${sanitized}/audio/transcriptions`;
        }
      }

      const fileBuffer = await fs.readFile(req.file.path);
      const fileName = req.file.originalname || "audio.wav";
      const mimeType = req.file.mimetype || "audio/wav";
      const blob = new Blob([fileBuffer], { type: mimeType });

      const formData = new FormData();
      const headers: Record<string, string> = {};

      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      if (isOpenAiCompatible) {
        // Default models for known providers if not explicitly set
        if (!model) {
          if (sanitized.includes('siliconflow')) {
            model = 'FunAudioLLM/SenseVoiceSmall';
          } else if (sanitized.includes('groq')) {
            model = 'whisper-large-v3';
          } else if (sanitized.includes('dashscope')) {
            model = 'sensevoice-v1';
          } else {
            model = 'whisper-1';
          }
        }
        formData.append("file", blob, fileName);
        formData.append("model", model);
        formData.append("response_format", "json");
      } else {
        // FunASR C++ and Python standard payload
        formData.append("audio_in", blob, fileName);
        formData.append("file", blob, fileName);
        formData.append("wav_name", fileName);
        formData.append("wav_format", "wav");
        formData.append("is_itn", "1");
      }

      console.log(`[ASR Proxy] Sending request to: ${sanitized} (model: ${model || 'default'}, auth: ${apiKey ? 'present' : 'none'})`);
      const response = await fetch(sanitized, {
        method: "POST",
        headers,
        body: formData,
      });

      // Clean up local temp file
      try {
        await fs.unlink(req.file.path);
      } catch (err) {
        console.error("Failed to delete temp proxy file:", err);
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[ASR Proxy] Error from target server: ${response.status} - ${errorText}`);
        return res.status(response.status).json({ 
          error: `转写服务返回状态码 ${response.status}: ${errorText.substring(0, 300)}` 
        });
      }

      const responseText = await response.text();
      try {
        const data = JSON.parse(responseText);
        res.json(data);
      } catch {
        res.json({ text: responseText });
      }
    } catch (error: any) {
      console.error("[ASR Proxy] Exception:", error);
      if (req.file && req.file.path) {
        try {
          await fs.unlink(req.file.path);
        } catch (_) {}
      }
      res.status(500).json({ error: error.message || "Failed to proxy ASR request" });
    }
  });

  // WebSocket Proxy for Real-time Streaming FunASR
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    try {
      const requestUrl = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
      if (requestUrl.pathname === "/api/funasr-ws") {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request);
        });
      }
    } catch (err) {
      console.error("[WS Upgrade Error]", err);
    }
  });

  wss.on("connection", (clientWs, request) => {
    try {
      const requestUrl = new URL(request.url || "", `http://${request.headers.host || "localhost"}`);
      let targetEndpoint = requestUrl.searchParams.get("endpoint");

      if (!targetEndpoint) {
        console.error("[FunASR WS Proxy] Missing target endpoint");
        clientWs.close(1008, "Missing endpoint parameter");
        return;
      }

      targetEndpoint = targetEndpoint.trim();
      if (targetEndpoint.startsWith("http://")) {
        targetEndpoint = targetEndpoint.replace("http://", "ws://");
      } else if (targetEndpoint.startsWith("https://")) {
        targetEndpoint = targetEndpoint.replace("https://", "wss://");
      } else if (!targetEndpoint.startsWith("ws://") && !targetEndpoint.startsWith("wss://")) {
        if (targetEndpoint.includes('.') && !targetEndpoint.startsWith('127.') && !targetEndpoint.startsWith('192.168.') && !targetEndpoint.startsWith('10.') && !targetEndpoint.startsWith('localhost')) {
          targetEndpoint = `wss://${targetEndpoint}`;
        } else {
          targetEndpoint = `ws://${targetEndpoint}`;
        }
      }

      console.log(`[FunASR WS Proxy] Proxying WebSocket connection to target: ${targetEndpoint}`);

      const rawSubprotocol = request.headers['sec-websocket-protocol'];
      let protocols: string[] = ['binary'];
      if (rawSubprotocol) {
        const parsed = rawSubprotocol.split(',').map((s) => s.trim()).filter(Boolean);
        if (parsed.length > 0) {
          protocols = parsed;
        }
      }

      console.log(`[FunASR WS Proxy] Connecting to target WS: ${targetEndpoint} with protocols:`, protocols);
      
      const wsOptions: WSWebSocket.ClientOptions = {
        rejectUnauthorized: false,
        headers: {
          'User-Agent': (request.headers['user-agent'] as string) || 'Mozilla/5.0',
        },
      };

      const targetWs = new WSWebSocket(targetEndpoint, protocols, wsOptions);
      const pendingBuffer: any[] = [];

      targetWs.on("open", () => {
        console.log(`[FunASR WS Proxy] Connected to target FunASR WS: ${targetEndpoint}`);
        while (pendingBuffer.length > 0 && targetWs.readyState === WSWebSocket.OPEN) {
          const msg = pendingBuffer.shift();
          if (msg !== undefined) targetWs.send(msg);
        }
      });

      targetWs.on("message", (data, isBinary) => {
        if (clientWs.readyState === WSWebSocket.OPEN) {
          clientWs.send(data, { binary: isBinary });
        }
      });

      targetWs.on("error", (err) => {
        console.error("[FunASR WS Proxy] Target WS error:", err.message);
        if (clientWs.readyState === WSWebSocket.OPEN) {
          clientWs.close(1011, `Target error: ${err.message}`);
        }
      });

      // 每 45 秒发送 ping 帧，防止 Cloudflare / 代理层超时断开
      const heartbeatInterval = setInterval(() => {
        if (clientWs.readyState === WSWebSocket.OPEN) {
          try {
            clientWs.ping();
          } catch (pingErr) {
            console.error("[FunASR WS Proxy] Client ping error:", pingErr);
          }
        }
        if (targetWs.readyState === WSWebSocket.OPEN) {
          try {
            targetWs.ping();
          } catch (pingErr) {
            console.error("[FunASR WS Proxy] Target ping error:", pingErr);
          }
        }
      }, 45000);

      const cleanupProxy = () => {
        clearInterval(heartbeatInterval);
      };

      targetWs.on("close", (code, reason) => {
        console.log(`[FunASR WS Proxy] Target WS closed: ${code}`);
        cleanupProxy();
        if (clientWs.readyState === WSWebSocket.OPEN) {
          clientWs.close(code, reason);
        }
      });

      clientWs.on("message", (data, isBinary) => {
        if (targetWs.readyState === WSWebSocket.OPEN) {
          targetWs.send(data, { binary: isBinary });
        } else if (targetWs.readyState === WSWebSocket.CONNECTING) {
          pendingBuffer.push(data);
        }
      });

      clientWs.on("error", (err) => {
        console.error("[FunASR WS Proxy] Client WS error:", err.message);
        cleanupProxy();
        if (targetWs.readyState === WSWebSocket.OPEN || targetWs.readyState === WSWebSocket.CONNECTING) {
          targetWs.close();
        }
      });

      clientWs.on("close", () => {
        console.log("[FunASR WS Proxy] Client WS connection closed");
        cleanupProxy();
        if (targetWs.readyState === WSWebSocket.OPEN || targetWs.readyState === WSWebSocket.CONNECTING) {
          targetWs.close();
        }
      });
    } catch (err: any) {
      console.error("[FunASR WS Proxy] Setup exception:", err);
      clientWs.close(1011, err?.message || "Proxy setup failed");
    }
  });

  // Socket.io for Real-time Sync
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // Join a room based on userId to keep data separate
    socket.on("join_user_room", (userId) => {
      socket.join(`user_${userId}`);
      console.log(`Socket ${socket.id} joined user_${userId} room`);
    });

    socket.on("send_message", async ({ userId, message }) => {
      try {
        if (userId !== "guest") { // Only store for non-guests
          await withFileLock(MESSAGES_FILE, async () => {
            const allMessages = await safeReadJSON<Record<string, any[]>>(MESSAGES_FILE, {});
            if (!allMessages[userId]) allMessages[userId] = [];
            allMessages[userId].push(message);
            await safeWriteJSON(MESSAGES_FILE, allMessages);
          });
        }
        
        // Still broadcast for real-time
        io.to(`user_${userId}`).emit("receive_message", message);
      } catch (error) {
        console.error("Socket error saving message:", error);
      }
    });

    socket.on("start_generation", async ({ userId, assistantMessageId, messages, settings }) => {
      try {
        console.log(`[Socket] Received start_generation for user ${userId}, messageId ${assistantMessageId}`);
        runServerSideGeneration({
          userId: userId || "guest",
          assistantMessageId,
          messages,
          settings: settings || {},
          io
        }).catch(err => {
          console.error("[Socket Background Gen Worker] Error:", err);
        });
      } catch (error) {
        console.error("Socket error initiating generation:", error);
      }
    });

    socket.on("delete_message", async ({ userId, messageId }) => {
      try {
        await withFileLock(MESSAGES_FILE, async () => {
          const allMessages = await safeReadJSON<Record<string, any[]>>(MESSAGES_FILE, {});
          if (allMessages[userId]) {
            allMessages[userId] = allMessages[userId].filter((m: any) => m.id !== messageId);
            await safeWriteJSON(MESSAGES_FILE, allMessages);
          }
        });
        io.to(`user_${userId}`).emit("message_deleted", messageId);
      } catch (error) {
        console.error("Socket error deleting message:", error);
      }
    });

    socket.on("delete_messages_range", async ({ userId, range }) => {
      console.log(`[Socket] Received delete_messages_range for userId: ${userId}, range: ${range}`);
      try {
        let updatedUserMessages: any[] = [];
        await withFileLock(MESSAGES_FILE, async () => {
          const allMessages = await safeReadJSON<Record<string, any[]>>(MESSAGES_FILE, {});
          if (!allMessages[userId]) {
            console.log(`[Socket] No messages found for user: ${userId}`);
            return;
          }

          // Logic for filtering
          let messages = allMessages[userId];
          const firstMessage = messages[0];
          
          if (range === 'all') {
            console.log(`[Socket] Deleting all messages for user: ${userId}`);
            allMessages[userId] = firstMessage?.role === 'assistant' ? [firstMessage] : [];
          } else {
            const days = range as number;
            console.log(`[Socket] Deleting messages older than ${days} days for user: ${userId}`);
            const cutoff = new Date();
            cutoff.setDate(cutoff.getDate() - days);
            cutoff.setHours(0, 0, 0, 0);
            
            allMessages[userId] = messages.filter((m: any, index: number) => {
              if (index === 0 && m.role === 'assistant') return true;
              return new Date(m.timestamp) >= cutoff; // Keeps messages within the range
            });
          }
          
          await safeWriteJSON(MESSAGES_FILE, allMessages);
          updatedUserMessages = allMessages[userId];
        });

        console.log(`[Socket] Messages updated for user: ${userId}`);
        io.to(`user_${userId}`).emit("messages_updated", updatedUserMessages);
      } catch (error) {
        console.error("Socket error deleting messages range:", error);
      }
    });

    socket.on("update_settings", async ({ userId, settings }) => {
      try {
        await withFileLock(SETTINGS_FILE, async () => {
          const allSettings = await safeReadJSON<Record<string, any>>(SETTINGS_FILE, {});
          allSettings[userId] = settings;
          await safeWriteJSON(SETTINGS_FILE, allSettings);
        });
        io.to(`user_${userId}`).emit("settings_updated", settings);
      } catch (error) {
        console.error("Socket error saving settings:", error);
      }
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
