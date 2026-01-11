// -----------------------------------------------------------------------------
// |                     THE ABYSS WAR - PROJECT BLUEPRINT                     |
// |                           BACKEND SERVER (v1.0)                           |
// |   Built with Node.js, Express, and the magic of Socket.IO                 |
// -----------------------------------------------------------------------------

// 1. --- SETUP AND IMPORTS ---
// استيراد المكتبات الأساسية التي يحتاجها الخادم
const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

// إعداد التطبيق والخادم
const app = express();
app.use(cors()); // السماح للواجهة بالتحدث مع الخادم
const server = http.createServer(app);

// إعداد Socket.IO مع السماح بالاتصالات من أي مصدر (مهم للنشر)
const io = new Server(server, {
  cors: {
    origin: "*", // يسمح بالاتصال من أي رابط (مثل netlify.app)
    methods: ["GET", "POST"]
  }
});

// هذا المتغير هو "قاعدة البيانات" المؤقتة التي ستخزن كل غرف اللعب النشطة
// كل غرفة سيكون لها حالتها الخاصة (لاعبين، بطاقات، نقاط حياة)
const gameRooms = {};

const PORT = process.env.PORT || 3001; // استخدام البورت الذي يوفره Render أو 3001 محلياً

// 2. --- SERVER'S BRAIN: EVENT LISTENERS ---
// هذا هو الجزء الذي يستمع فيه الخادم للأحداث القادمة من اللاعبين

io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  // --- إدارة غرف اللعب ---

  // حدث لإنشاء غرفة جديدة
  socket.on('createRoom', (playerName, callback) => {
    const roomId = `R${Math.random().toString(36).substr(2, 5).toUpperCase()}`; // إنشاء رمز عشوائي للغرفة
    socket.join(roomId);
    
    gameRooms[roomId] = {
      roomId,
      players: [{ id: socket.id, name: playerName, life: 4000 }],
      gameState: { // حالة اللعبة الأولية
        cards: [], // كل البطاقات في اللعب ومواقعها
        decks: {}, // معلومات عن مجموعة كل لاعب
        graveyards: {},
        banished: {},
      }
    };

    console.log(`Room created: ${roomId} by ${playerName}`);
    callback({ success: true, roomId }); // إرسال الرمز لللاعب الذي أنشأ الغرفة
    socket.emit('gameStateUpdate', gameRooms[roomId]); // إرسال حالة اللعبة الأولية له
  });

  // حدث للانضمام إلى غرفة موجودة
  socket.on('joinRoom', ({ roomId, playerName }, callback) => {
    if (gameRooms[roomId]) {
      socket.join(roomId);
      gameRooms[roomId].players.push({ id: socket.id, name: playerName, life: 4000 });
      
      console.log(`${playerName} joined room: ${roomId}`);
      
      // إرسال الحالة الكاملة للعبة لجميع من في الغرفة (بما فيهم اللاعب الجديد)
      io.to(roomId).emit('gameStateUpdate', gameRooms[roomId]);
      
      // إرسال رسالة ترحيب للجميع
      io.to(roomId).emit('notification', `${playerName} has joined the battle!`);
      
      callback({ success: true });
    } else {
      callback({ success: false, message: "Room not found." });
    }
  });

  // --- إدارة حركات اللعبة (العقد الذي صممناه) ---

  // حدث لتحريك بطاقة
  socket.on('moveCard', ({ roomId, cardId, newPosition }) => {
    const room = gameRooms[roomId];
    if (!room) return;

    // تحديث موقع البطاقة في حالة اللعبة
    const cardIndex = room.gameState.cards.findIndex(c => c.id === cardId);
    if (cardIndex !== -1) {
      room.gameState.cards[cardIndex].position = newPosition;
    } else {
      // إذا لم تكن البطاقة موجودة، أضفها (أول مرة تُلعب من اليد)
      room.gameState.cards.push({ id: cardId, position: newPosition, rotation: 0, isFlipped: false });
    }
    
    // إرسال الحالة المحدثة للجميع في الغرفة ما عدا المرسل (لتجنب التكرار)
    socket.to(roomId).emit('gameStateUpdate', room);
  });

  // حدث لقلب بطاقة
  socket.on('flipCard', ({ roomId, cardId }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const card = room.gameState.cards.find(c => c.id === cardId);
    if (card) {
      card.isFlipped = !card.isFlipped;
      io.to(roomId).emit('gameStateUpdate', room); // إرسال التحديث للجميع
    }
  });

  // حدث لتدوير بطاقة
  socket.on('rotateCard', ({ roomId, cardId, newRotation }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const card = room.gameState.cards.find(c => c.id === cardId);
    if (card) {
      card.rotation = newRotation;
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

  // حدث لتشغيل مؤثر خاص
  socket.on('triggerEffect', ({ roomId, effectName }) => {
    console.log(`Effect triggered in room ${roomId}: ${effectName}`);
    // ببساطة، نعيد بث هذا الحدث لجميع اللاعبين في الغرفة
    // الواجهة هي المسؤولة عن عرض المؤثر الفعلي عند استقبال هذا الحدث
    io.to(roomId).emit('playEffect', { effectName });
  });
  
  // --- إدارة قطع الاتصال ---
  socket.on('disconnect', () => {
    console.log(`A user disconnected: ${socket.id}`);
    // البحث عن الغرفة التي كان فيها اللاعب وإزالته منها
    for (const roomId in gameRooms) {
      const room = gameRooms[roomId];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        const playerName = room.players[playerIndex].name;
        room.players.splice(playerIndex, 1);
        
        // إذا أصبحت الغرفة فارغة، احذفها
        if (room.players.length === 0) {
          delete gameRooms[roomId];
          console.log(`Room ${roomId} is empty and has been deleted.`);
        } else {
          // أبلغ اللاعبين المتبقين
          io.to(roomId).emit('notification', `${playerName} has left the battle.`);
          io.to(roomId).emit('gameStateUpdate', room);
        }
        break;
      }
    }
  });
});

// 3. --- START THE SERVER ---
// تشغيل الخادم ليكون جاهزاً لاستقبال الاتصالات
server.listen(PORT, () => {
  console.log(`
  --------------------------------------
  |  THE ABYSS WAR SERVER IS ALIVE!    |
  |  Listening on port: ${PORT}          |
  --------------------------------------
  `);
});
