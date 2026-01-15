// Charger dotenv SEULEMENT en local (pas sur Render)
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' });
}

const { WebSocketServer } = require('ws');
const { createClient } = require('@supabase/supabase-js');
const http = require('http');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Serveur HTTP pour le keep-alive
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('DicoClash WebSocket Server is running!');
});

const PORT = process.env.PORT || 8080;

// Attacher WebSocket au serveur HTTP
const wss = new WebSocketServer({ server });

const rooms = new Map();
const queue = [];

console.log('🚀 Server starting on port', PORT);

wss.on('connection', (ws) => {
  console.log('🔌 New connection');

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log('📩 Received:', msg.type);

      switch (msg.type) {
        case 'join_queue':
          await handleJoinQueue(ws, msg);
          break;
        case 'send_clue':
          handleSendClue(msg);
          break;
        case 'send_guess':
          await handleSendGuess(msg);
          break;
      }
    } catch (err) {
      console.error('❌ Error:', err);
    }
  });

  ws.on('close', () => {
    console.log('🔌 Connection closed');
    handleDisconnect(ws);
  });
});

async function handleJoinQueue(ws, msg) {
  const { playerId, pseudo } = msg;

  queue.push({ ws, playerId, pseudo });
  console.log('👥 Queue size:', queue.length);

  if (queue.length >= 2) {
    console.log('🎮 Creating match...');
    const p1 = queue.shift();
    const p2 = queue.shift();

    console.log('📞 Calling get_random_word...');
    const { data: word, error: wordError } = await supabase.rpc('get_random_word');
    if (wordError) {
      console.error('❌ get_random_word error:', wordError);
      return;
    }
    console.log('✅ Word:', word);

    console.log('💾 Inserting game...');
    const { data: game, error: gameError } = await supabase
      .from('games')
      .insert({
        player1_id: p1.playerId,
        player2_id: p2.playerId,
        current_word: word || 'ELEPHANT',
        current_giver_id: p1.playerId,
        current_round: 1,
        status: 'playing'
      })
      .select()
      .single();

    if (gameError) {
      console.error('❌ Game insert error:', gameError);
      return;
    }
    if (!game) {
      console.error('❌ No game returned');
      return;
    }

    console.log('✅ Game created:', game.id);

    const room = {
      id: game.id,
      player1: { ws: p1.ws, id: p1.playerId, pseudo: p1.pseudo },
      player2: { ws: p2.ws, id: p2.playerId, pseudo: p2.pseudo },
      currentRound: 1,
      currentWord: game.current_word,
      currentGiverId: p1.playerId,
      player1Score: 0,
      player2Score: 0,
      attempts: [],
      timeLeft: 60
    };

    rooms.set(game.id, room);

    console.log('📤 Sending game_start to P1');
    p1.ws.send(JSON.stringify({
      type: 'game_start',
      gameId: game.id,
      opponentPseudo: p2.pseudo,
      isGiver: true,
      word: game.current_word,
      round: 1
    }));

    console.log('📤 Sending game_start to P2');
    p2.ws.send(JSON.stringify({
      type: 'game_start',
      gameId: game.id,
      opponentPseudo: p1.pseudo,
      isGiver: false,
      round: 1
    }));

    console.log('⏱️ Starting timer');
    startTimer(game.id);
  }
}

function handleSendClue(msg) {
  const { gameId, clue } = msg;
  const room = rooms.get(gameId);
  if (!room) return;

  room.attempts.push({ clue, guess: '', correct: false });

  const guesser = room.currentGiverId === room.player1.id ? room.player2 : room.player1;
  guesser.ws.send(JSON.stringify({
    type: 'new_clue',
    clue,
    attempts: room.attempts
  }));

  const giver = room.currentGiverId === room.player1.id ? room.player1 : room.player2;
  giver.ws.send(JSON.stringify({
    type: 'clue_sent',
    attempts: room.attempts
  }));
}

async function handleSendGuess(msg) {
  const { gameId, guess } = msg;
  const room = rooms.get(gameId);
  if (!room) return;

  const isCorrect = guess.toUpperCase() === room.currentWord.toUpperCase();

  const lastAttempt = room.attempts[room.attempts.length - 1];
  if (lastAttempt) {
    lastAttempt.guess = guess;
    lastAttempt.correct = isCorrect;
  }

  broadcast(room, {
    type: 'new_guess',
    guess,
    correct: isCorrect,
    attempts: room.attempts
  });

  if (isCorrect) {
    if (room.currentGiverId === room.player1.id) {
      room.player1Score++;
    } else {
      room.player2Score++;
    }

    await supabase.from('games').update({
      player1_score: room.player1Score,
      player2_score: room.player2Score
    }).eq('id', gameId);

    setTimeout(() => nextRound(gameId), 2000);
  } else if (room.attempts.length >= 4) {
    setTimeout(() => nextRound(gameId), 2000);
  }
}

async function nextRound(gameId) {
  const room = rooms.get(gameId);
  if (!room) return;

  if (room.timer) clearInterval(room.timer);

  if (room.currentRound >= 4) {
    await supabase.from('games').update({
      status: 'finished',
      player1_score: room.player1Score,
      player2_score: room.player2Score
    }).eq('id', gameId);

    broadcast(room, {
      type: 'game_end',
      player1Score: room.player1Score,
      player2Score: room.player2Score
    });

    rooms.delete(gameId);
    return;
  }

  room.currentRound++;
  room.currentGiverId = room.currentGiverId === room.player1.id ? room.player2.id : room.player1.id;
  room.attempts = [];
  room.timeLeft = 60;

  const { data: word } = await supabase.rpc('get_random_word');
  room.currentWord = word || 'ELEPHANT';

  await supabase.from('games').update({
    current_round: room.currentRound,
    current_word: room.currentWord,
    current_giver_id: room.currentGiverId
  }).eq('id', gameId);

  room.player1.ws.send(JSON.stringify({
    type: 'new_round',
    round: room.currentRound,
    isGiver: room.currentGiverId === room.player1.id,
    word: room.currentGiverId === room.player1.id ? room.currentWord : undefined
  }));

  room.player2.ws.send(JSON.stringify({
    type: 'new_round',
    round: room.currentRound,
    isGiver: room.currentGiverId === room.player2.id,
    word: room.currentGiverId === room.player2.id ? room.currentWord : undefined
  }));

  startTimer(gameId);
}

function startTimer(gameId) {
  const room = rooms.get(gameId);
  if (!room) return;

  room.timer = setInterval(() => {
    room.timeLeft--;

    broadcast(room, {
      type: 'timer_update',
      timeLeft: room.timeLeft
    });

    if (room.timeLeft <= 0) {
      clearInterval(room.timer);
      nextRound(gameId);
    }
  }, 1000);
}

function broadcast(room, data) {
  room.player1.ws.send(JSON.stringify(data));
  room.player2.ws.send(JSON.stringify(data));
}

function handleDisconnect(ws) {
  const idx = queue.findIndex(p => p.ws === ws);
  if (idx !== -1) queue.splice(idx, 1);

  for (const [gameId, room] of rooms.entries()) {
    if (room.player1.ws === ws || room.player2.ws === ws) {
      if (room.timer) clearInterval(room.timer);

      const other = room.player1.ws === ws ? room.player2 : room.player1;
      other.ws.send(JSON.stringify({ type: 'opponent_disconnected' }));

      rooms.delete(gameId);
    }
  }
}

// Démarrer le serveur
server.listen(PORT, () => {
  console.log('🚀 WebSocket server running on port', PORT);
});