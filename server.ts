import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs/promises";
import multer from "multer";
import { createServer as createViteServer } from "vite";

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
        await fs.access(filePath);
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
    try {
      const users = JSON.parse(await fs.readFile(USERS_FILE, "utf-8"));
      if (users.find((u: any) => u.username === username)) {
        return res.status(400).json({ error: "User already exists" });
      }
      const newUser = { id: Date.now().toString(), username, password };
      users.push(newUser);
      await fs.writeFile(USERS_FILE, JSON.stringify(users, null, 2));
      res.json({ user: { id: newUser.id, username: newUser.username } });
    } catch (e) {
      res.status(500).json({ error: "Registration failed" });
    }
  });

  app.post("/api/login", async (req, res) => {
    const { username, password } = req.body;
    try {
      const users = JSON.parse(await fs.readFile(USERS_FILE, "utf-8"));
      const user = users.find((u: any) => u.username === username && u.password === password);
      if (!user) return res.status(401).json({ error: "Invalid credentials" });
      res.json({ user: { id: user.id, username: user.username } });
    } catch (e) {
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

  app.post("/api/upload", upload.single("image"), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    res.json({ url: `/uploads/${req.file.filename}` });
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
        const allMessages = JSON.parse(await fs.readFile(MESSAGES_FILE, "utf-8"));
        if (!allMessages[userId]) allMessages[userId] = [];
        allMessages[userId].push(message);
        await fs.writeFile(MESSAGES_FILE, JSON.stringify(allMessages, null, 2));
        
        // Broadcast only to this user's devices
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
