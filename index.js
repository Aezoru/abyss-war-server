// -----------------------------------------------------------------------------
// |                     THE ABYSS WAR - PROJECT BLUEPRINT                     |
// |                           BACKEND SERVER (v1.1)                           |
// |   Built with Node.js, Express, and the magic of Socket.IO                 |
// -----------------------------------------------------------------------------

// 1. --- SETUP AND IMPORTS ---
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

// قاعدة البيانات المؤقتة
const gameRooms = {};

const PORT = process.env.PORT || 3001;

// 2. --- SERVER'S BRAIN: EVENT LISTENERS ---

io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  // --- إدارة غرف اللعب ---

  socket.on('createRoom', (playerName, callback) => {
    const roomId = `R${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
    socket.join(roomId);
    
    gameRooms[roomId] = {
      id: roomId, // متوافق مع interface Room
      players: [{ id: socket.id, name: playerName, life: 4000 }],
      cards: [], // قائمة البطاقات الموحدة (Hand + Board + etc)
      status: 'playing'
    };

    console.log(`Room created: ${roomId} by ${playerName}`);
    callback({ success: true, roomId });
    socket.emit('gameStateUpdate', gameRooms[roomId]);
  });

  socket.on('joinRoom', ({ roomId, playerName }, callback) => {
    if (gameRooms[roomId]) {
      socket.join(roomId);
      gameRooms[roomId].players.push({ id: socket.id, name: playerName, life: 4000 });
      
      console.log(`${playerName} joined room: ${roomId}`);
      io.to(roomId).emit('gameStateUpdate', gameRooms[roomId]);
      io.to(roomId).emit('notification', `${playerName} has joined the battle!`);
      
      callback({ success: true });
    } else {
      callback({ success: false, message: "Room not found." });
    }
  });

  // --- إدارة حركات اللعبة (تعديلات الدقة والتناسق) ---

  // حدث لتحريك بطاقة (تم تحديثه ليدعم x, y و zone)
  socket.on('moveCard', ({ roomId, cardId, x, y, zone }) => {
    const room = gameRooms[roomId];
    if (!room) return;

    let card = room.cards.find(c => c.id === cardId);
    
    if (card) {
      // تحديث البيانات الموجودة فعلياً
      card.x = x;
      card.y = y;
      card.zone = zone || card.zone;
    } else {
      // إذا كانت البطاقة تظهر لأول مرة (مثلاً سُحبت من الـ Deck غير المعرف برمجياً بعد)
      room.cards.push({
        id: cardId,
        x: x,
        y: y,
        zone: zone || 'board',
        ownerId: socket.id, // تحديد المالك لضمان ظهورها في اليد الصحيحة
        rotation: 0,
        isFlipped: false,
        counters: 0,
        imageUrl: 'https://picsum.photos/id/101/200/280' // صورة افتراضية
      });
    }
    
    // إرسال التحديث للجميع لضمان تزامن الإحداثيات والمنطقة
    socket.to(roomId).emit('gameStateUpdate', room);
  });

  // حدث لقلب بطاقة
  socket.on('flipCard', ({ roomId, cardId }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const card = room.cards.find(c => c.id === cardId);
    if (card) {
      card.isFlipped = !card.isFlipped;
      io.to(roomId).emit('gameStateUpdate', room);
    }
  });

  // حدث لتدوير بطاقة
  socket.on('rotateCard', ({ roomId, cardId, newRotation }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const card = room.cards.find(c => c.id === cardId);
    if (card) {
      card.rotation = newRotation;
      io.to(roomId).emit('gameStateUpdate', room);
    }
  });

  // حدث لإدارة العدادات (إضافة ميزة Counters التي طلبناها)
  socket.on('updateCounters', ({ roomId, cardId, amount }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const card = room.cards.find(c => c.id === cardId);
    if (card) {
      card.counters = Math.max(0, (card.counters || 0) + amount);
      io.to(roomId).emit('gameStateUpdate', room);
    }
  });

  // حدث لتغيير نقاط الحياة
  socket.on('updateLife', ({ roomId, playerId, newLife }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.life = newLife;
      io.to(roomId).emit('gameStateUpdate', room);
    }
  });

  // --- محرك المؤثرات الخاصة ---
  socket.on('triggerEffect', ({ roomId, effectName }) => {
    console.log(`Effect triggered: ${effectName}`);
    io.to(roomId).emit('playEffect', { effectName });
  });
  
  // --- إدارة قطع الاتصال ---
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    for (const roomId in gameRooms) {
      const room = gameRooms[roomId];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const playerName = room.players[playerIndex].name;
        room.players.splice(playerIndex, 1);
        
        if (room.players.length === 0) {
          delete gameRooms[roomId];
        } else {
          io.to(roomId).emit('notification', `${playerName} has left the battle.`);
          io.to(roomId).emit('gameStateUpdate', room);
        }
        break;
      }
    }
  });
});
// إضافة مسار بسيط للتحقق من أن الخادم حي (Health Check)
app.get('/', (req, res) => {
  res.send('Server is running and awake! 🚀');
});

// 3. --- START THE SERVER ---
server.listen(PORT, () => {
  console.log(`
  --------------------------------------
  |  THE ABYSS WAR SERVER IS ALIVE!    |
  |  Listening on port: ${PORT}          |
  |  Status: Syncing X, Y, and Zones   |
  --------------------------------------
  `);
});