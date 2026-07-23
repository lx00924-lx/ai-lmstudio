import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
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

// Ensure directories exist
async function ensureDirs() {
  try {
    await fs.mkdir(path.dirname(MESSAGES_FILE), { recursive: true });
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    
    const checkFile = async (filePath: string, defaultContent: any) => {
      try {
        const stats = await fs.stat(filePath);
        if (stats.size === 0) throw new Error("File empty");
      } catch {
        await fs.writeFile(filePath, JSON.stringify(defaultContent));
      }
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
      const users = JSON.parse(await fs.readFile(USERS_FILE, "utf-8"));
      if (users.find((u: any) => u.username === username)) {
        console.log(`Registration failed: user already exists: ${username}`);
        return res.status(400).json({ error: "User already exists" });
      }
      const newUser = { id: Date.now().toString(), username, password };
      users.push(newUser);
      await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
      console.log(`Registration successful for username: ${username}`);
      res.json({ user: { id: newUser.id, username: newUser.username } });
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
      const usersContent = await fs.readFile(USERS_FILE, "utf-8");
      let users = [];
      try {
        users = usersContent.trim() ? JSON.parse(usersContent) : [];
      } catch (e) {
        console.error("Error parsing users file:", e);
        return res.status(500).json({ error: "Internal server error: User data corruption" });
      }
      
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
      const allMessages = JSON.parse(await fs.readFile(MESSAGES_FILE, "utf-8"));
      res.json(allMessages[req.params.userId] || []);
    } catch (error) {
      res.status(500).json({ error: "Failed to load messages" });
    }
  });

  app.post("/api/sync-messages", async (req, res) => {
    const { userId, messages } = req.body;
    try {
      const allMessages = JSON.parse(await fs.readFile(MESSAGES_FILE, "utf-8"));
      if (!allMessages[userId]) allMessages[userId] = [];
      // Combine existing with synced, avoiding duplicates based on ID
      const newMessages = [...allMessages[userId], ...messages];
      const uniqueMessages = Array.from(new Map(newMessages.map(m => [m.id, m])).values());
      allMessages[userId] = uniqueMessages;
      await fs.writeFile(MESSAGES_FILE, JSON.stringify(allMessages, null, 2));
      res.json({ success: true });
    } catch (error) {
      console.error("Sync messages error:", error);
      res.status(500).json({ error: "Failed to sync messages" });
    }
  });

  // Settings API
  app.get("/api/settings/:userId", async (req, res) => {
    try {
      const allSettings = JSON.parse(await fs.readFile(SETTINGS_FILE, "utf-8"));
      res.json(allSettings[req.params.userId] || {});
    } catch (error) {
      res.status(500).json({ error: "Failed to load settings" });
    }
  });

  app.post("/api/change-password", async (req, res) => {
    const { userId, oldPassword, newPassword } = req.body;
    try {
      const users = JSON.parse(await fs.readFile(USERS_FILE, "utf-8"));
      const userIndex = users.findIndex((u: any) => u.id === userId && u.password === oldPassword);
      if (userIndex === -1) {
        return res.status(401).json({ error: "原密码错误" });
      }
      users[userIndex].password = newPassword;
      await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
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
          const allMessages = JSON.parse(await fs.readFile(MESSAGES_FILE, "utf-8"));
          if (!allMessages[userId]) allMessages[userId] = [];
          allMessages[userId].push(message);
          await fs.writeFile(MESSAGES_FILE, JSON.stringify(allMessages, null, 2));
        }
        
        // Still broadcast for real-time
        io.to(`user_${userId}`).emit("receive_message", message);
      } catch (error) {
        console.error("Socket error saving message:", error);
      }
    });

    socket.on("delete_message", async ({ userId, messageId }) => {
      try {
        const allMessages = JSON.parse(await fs.readFile(MESSAGES_FILE, "utf-8"));
        if (allMessages[userId]) {
          allMessages[userId] = allMessages[userId].filter((m: any) => m.id !== messageId);
          await fs.writeFile(MESSAGES_FILE, JSON.stringify(allMessages, null, 2));
        }
        io.to(`user_${userId}`).emit("message_deleted", messageId);
      } catch (error) {
        console.error("Socket error deleting message:", error);
      }
    });

    socket.on("delete_messages_range", async ({ userId, range }) => {
      console.log(`[Socket] Received delete_messages_range for userId: ${userId}, range: ${range}`);
      try {
        const allMessages = JSON.parse(await fs.readFile(MESSAGES_FILE, "utf-8"));
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
        
        await fs.writeFile(MESSAGES_FILE, JSON.stringify(allMessages, null, 2));
        console.log(`[Socket] Messages updated for user: ${userId}`);
        io.to(`user_${userId}`).emit("messages_updated", allMessages[userId]);
      } catch (error) {
        console.error("Socket error deleting messages range:", error);
      }
    });

    socket.on("update_settings", async ({ userId, settings }) => {
      try {
        const allSettings = JSON.parse(await fs.readFile(SETTINGS_FILE, "utf-8"));
        allSettings[userId] = settings;
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(allSettings, null, 2));
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
