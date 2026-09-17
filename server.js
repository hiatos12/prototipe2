import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

// Требуется для поддержки SharedArrayBuffer в Godot 4 Web
app.use((req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  next();
});

// Раздача файлов экспорта Godot из папки public
app.use(express.static(path.join(__dirname, 'public')));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

// Обмен кода авторизации Discord на access_token
app.post('/api/token', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Code is required' });

  try {
    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
      }),
    });

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json({ access_token: data.access_token });
  } catch (err) {
    console.error('OAuth error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Хранилище комнат лобби: instanceId -> Map(socketId -> playerInfo)
const rooms = new Map();

io.on('connection', (socket) => {
  socket.on('join_lobby', ({ instanceId, user }) => {
    socket.join(instanceId);
    socket.instanceId = instanceId;

    if (!rooms.has(instanceId)) {
      rooms.set(instanceId, new Map());
    }

    const room = rooms.get(instanceId);
    room.set(socket.id, {
      socketId: socket.id,
      id: user.id,
      username: user.global_name || user.username,
      avatarUrl: user.avatarUrl
    });

    // Отправляем всем участникам актуальный список игроков
    io.to(instanceId).emit('lobby_updated', Array.from(room.values()));
  });

  socket.on('disconnect', () => {
    const instanceId = socket.instanceId;
    if (instanceId && rooms.has(instanceId)) {
      const room = rooms.get(instanceId);
      room.delete(socket.id);

      if (room.size === 0) {
        rooms.delete(instanceId);
      } else {
        io.to(instanceId).emit('lobby_updated', Array.from(room.values()));
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});