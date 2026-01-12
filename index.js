// -----------------------------------------------------------------------------
// |                     THE ABYSS WAR - PROJECT BLUEPRINT                     |
// |                 BACKEND SERVER (v2.1) - FINAL WITH SEEDING                |
// |      Based on your excellent v1.1, with added initial card decks.         |
// -----------------------------------------------------------------------------

const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const cors = require('cors');

const app = express();
app.use(cors());
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const gameRooms = {};
const PORT = process.env.PORT || 3001;

// --- NEW: Helper function to generate unique card IDs ---
const generateCardId = (ownerId, cardName, index) => `${ownerId.slice(0, 4)}-${cardName.replace(/\s/g, '')}-${index}`;

io.on('connection', (socket) => {
  console.log(`A user connected: ${socket.id}`);

  // --- Room Management ---
  socket.on('createRoom', (playerName, callback) => {
    const roomId = `R${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
    socket.join(roomId);
    
    const newPlayer = { id: socket.id, name: playerName, life: 4000 };

    // --- NEW: Create an initial deck for the first player ---
    const initialDeck = [
      { id: generateCardId(socket.id, 'Melora', 1), name: 'ميلورا، آكلة الدماء', imageUrl: 'https://imgur.com/mGHUktw', ownerId: socket.id, zone: 'deck', x: 0, y: 0, rotation: 0, isFlipped: true, counters: 0 },
      { id: generateCardId(socket.id, 'Reaper', 1), name: 'حاصد ارواح الهاوية', imageUrl: 'https://imgur.com/a/31wybzA', ownerId: socket.id, zone: 'deck', x: 0, y: 0, rotation: 0, isFlipped: true, counters: 0 },
      { id: generateCardId(socket.id, 'Bargain', 1), name: 'صفقة الهاوية', imageUrl: 'https://imgur.com/FUOOJe6', ownerId: socket.id, zone: 'deck', x: 0, y: 0, rotation: 0, isFlipped: true, counters: 0 },
      // Add more cards for player 1 here...
    ];

    gameRooms[roomId] = {
      id: roomId,
      players: [newPlayer],
      cards: initialDeck, // Use the generated deck
      status: 'waiting'
    };

    console.log(`Room created: ${roomId} by ${playerName}`);
    callback({ success: true, roomId });
    io.to(roomId).emit('gameStateUpdate', gameRooms[roomId]);
  });

  socket.on('joinRoom', ({ roomId, playerName }, callback) => {
    const room = gameRooms[roomId];
    if (room) {
      socket.join(roomId);
      const newPlayer = { id: socket.id, name: playerName, life: 4000 };
      room.players.push(newPlayer);
      room.status = 'playing';

      // --- NEW: Create an initial deck for the second player ---
      const opponentDeck = [
        { id: generateCardId(socket.id, 'ForestGuardian', 1), name: 'حارس الغابة', imageUrl: 'https://i.imgur.com/opponent_card1.jpeg', ownerId: socket.id, zone: 'deck', x: 0, y: 0, rotation: 0, isFlipped: true, counters: 0 },
        { id: generateCardId(socket.id, 'NatureSpirit', 1), name: 'روح الطبيعة', imageUrl: 'https://i.imgur.com/opponent_card2.jpeg', ownerId: socket.id, zone: 'deck', x: 0, y: 0, rotation: 0, isFlipped: true, counters: 0 },
        // Add more cards for player 2 here...
      ];
      room.cards.push(...opponentDeck); // Add the new deck to the existing cards

      console.log(`${playerName} joined room: ${roomId}`);
      io.to(roomId).emit('notification', `${playerName} has joined the battle!`);
      io.to(roomId).emit('gameStateUpdate', room);
      callback({ success: true });
    } else {
      callback({ success: false, message: "Room not found." });
    }
  });

  // --- NEW: Logic for drawing a card ---
  socket.on('drawCard', ({ roomId }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    
    const playerDeck = room.cards.filter(c => c.ownerId === socket.id && c.zone === 'deck');
    if (playerDeck.length > 0) {
      const cardToDraw = playerDeck[0]; // Draw the top card
      cardToDraw.zone = 'hand';
      io.to(roomId).emit('gameStateUpdate', room);
      io.to(socket.id).emit('notification', `You drew: ${cardToDraw.name}`);
    } else {
      io.to(socket.id).emit('notification', 'Deck is empty!');
    }
  });

  // --- All other event handlers from your v1.1 are kept as they are ---
  // (moveCard, flipCard, rotateCard, updateLife, etc.)
  // They are already compatible. I will paste them here for completeness.

  socket.on('moveCard', ({ roomId, cardId, x, y, zone }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    let card = room.cards.find(c => c.id === cardId);
    if (card) {
      card.x = x;
      card.y = y;
      card.zone = zone || 'board'; // Default to board if zone is not specified
      io.to(roomId).emit('gameStateUpdate', room);
    }
  });

  socket.on('flipCard', ({ roomId, cardId }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const card = room.cards.find(c => c.id === cardId);
    if (card) {
      card.isFlipped = !card.isFlipped;
      io.to(roomId).emit('gameStateUpdate', room);
    }
  });

  socket.on('rotateCard', ({ roomId, cardId, newRotation }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const card = room.cards.find(c => c.id === cardId);
    if (card) {
      card.rotation = newRotation;
      io.to(roomId).emit('gameStateUpdate', room);
    }
  });

  socket.on('updateLife', ({ roomId, playerId, newLife }) => {
    const room = gameRooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === playerId);
    if (player) {
      player.life = newLife;
      io.to(roomId).emit('gameStateUpdate', room);
    }
  });

  socket.on('triggerEffect', ({ roomId, effectName }) => {
    console.log(`Effect triggered: ${effectName}`);
    io.to(roomId).emit('playEffect', { effectName });
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    for (const roomId in gameRooms) {
      const room = gameRooms[roomId];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        room.players.splice(playerIndex, 1);
        room.cards = room.cards.filter(c => c.ownerId !== socket.id);
        if (room.players.length === 0) {
          delete gameRooms[roomId];
        } else {
          io.to(roomId).emit('notification', `${room.players[playerIndex].name} has left.`);
          io.to(roomId).emit('gameStateUpdate', room);
        }
        break;
      }
    }
  });
});

app.get('/', (req, res) => {
  res.send('Abyss War Server v2.1 is running! 🚀');
});

server.listen(PORT, () => {
  console.log(`Server v2.1 with Card Seeding is ALIVE on port: ${PORT}`);
});
