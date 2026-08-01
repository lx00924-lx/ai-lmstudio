import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { WebSocketServer, WebSocket as WSWebSocket } from "ws";
import path from "path";
import fs from "fs/promises";
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

// Atomic file write using a temporary file and rename
async function safeWriteJSON(filePath: string, data: any): Promise<void> {
  const tempPath = `${filePath}.tmp.${Math.random().toString(36).substring(2, 9)}`;
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tempPath, content, "utf-8");
  await fs.rename(tempPath, filePath);
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
        const writeStream = require('fs').createWriteStream(finalPath);
        for (let i = 0; i < files.length; i++) {
          const chunkPath = path.join(chunkDir, i.toString());
          const chunkData = await fs.readFile(chunkPath);
          writeStream.write(chunkData);
          await fs.unlink(chunkPath);
        }
        writeStream.end();
        await fs.rmdir(chunkDir);
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

  // Proxy route for FunASR to avoid browser CORS and Mixed Content issues
  app.post("/api/funasr-transcribe", upload.single("file"), async (req, res) => {
    try {
      const endpoint = req.query.endpoint as string;
      if (!endpoint) {
        return res.status(400).json({ error: "Missing endpoint parameter" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const fileBuffer = await fs.readFile(req.file.path);
      const blob = new Blob([fileBuffer], { type: req.file.mimetype });
      const formData = new FormData();
      
      // Standardize filenames (often FunASR C++ HTTP server parses names)
      const fileName = req.file.originalname || "audio.wav";
      
      // Send as both 'audio_in' (used by FunASR C++ HTTP servers) and 'file' (used by some FastAPI/Python/other servers)
      formData.append("audio_in", blob, fileName);
      formData.append("file", blob, fileName);
      formData.append("wav_name", fileName);
      formData.append("wav_format", "wav");
      formData.append("is_itn", "1");

      let sanitized = endpoint.trim();
      if (!sanitized.startsWith('http')) {
        sanitized = `http://${sanitized}`;
      }

      console.log(`[FunASR Proxy] Sending request to: ${sanitized}`);
      const response = await fetch(sanitized, {
        method: "POST",
        body: formData,
      });

      // Try to clean up local file
      try {
        await fs.unlink(req.file.path);
      } catch (err) {
        console.error("Failed to delete temp proxy file:", err);
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[FunASR Proxy] Error from target server: ${response.status} - ${errorText}`);
        return res.status(response.status).json({ error: `FunASR server returned status ${response.status}` });
      }

      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error("[FunASR Proxy] Exception:", error);
      if (req.file && req.file.path) {
        try {
          await fs.unlink(req.file.path);
        } catch (_) {}
      }
      res.status(500).json({ error: error.message || "Failed to proxy FunASR request" });
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
