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

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('DicoClash WebSocket Server is running!');
});

const PORT = process.env.PORT || 8080;
const wss = new WebSocketServer({ server });

const rooms = new Map();
const queue = [];

console.log('🚀 Server starting on port', PORT);

const normalizeString = (str) => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
};

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
        case 'leave_queue':
          handleLeaveQueue(ws, msg);
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

function broadcastQueueSize() {
  queue.forEach(player => {
    player.ws.send(JSON.stringify({
      type: 'queue_update',
      queueSize: queue.length
    }));
  });
}

function handleLeaveQueue(ws, msg) {
  const idx = queue.findIndex(p => p.ws === ws);
  if (idx !== -1) {
    queue.splice(idx, 1);
    broadcastQueueSize();
  }
}

async function handleJoinQueue(ws, msg) {
  const { playerId, pseudo } = msg;

  queue.push({ ws, playerId, pseudo });
  console.log('👥 Queue size:', queue.length);
  broadcastQueueSize();

  if (queue.length >= 2) {
    console.log('🎮 Creating match...');
    const p1 = queue.shift();
    const p2 = queue.shift();
    broadcastQueueSize();

    const { data: word } = await supabase.rpc('get_random_word');

    const { data: game } = await supabase
      .from('games')
      .insert({
        player1_id: p1.playerId,
        player2_id: p2.playerId,
        current_word: word || 'ELEPHANT',
        current_giver_id: p1.playerId,
        current_round: 1,
        player1_score: 0,
        player2_score: 0,
        status: 'playing'
      })
      .select()
      .single();

    if (!game) return;

    const room = {
      id: game.id,
      player1: { ws: p1.ws, id: p1.playerId, pseudo: p1.pseudo },
      player2: { ws: p2.ws, id: p2.playerId, pseudo: p2.pseudo },
      currentRound: 1,
      currentWord: game.current_word,
      currentGiverId: p1.playerId,
      teamScore: 0,
      attempts: [],
      timeLeft: 60
    };

    rooms.set(game.id, room);

    p1.ws.send(JSON.stringify({
      type: 'game_start',
      gameId: game.id,
      partnerPseudo: p2.pseudo,
      isGiver: true,
      word: game.current_word,
      round: 1
    }));

    p2.ws.send(JSON.stringify({
      type: 'game_start',
      gameId: game.id,
      partnerPseudo: p1.pseudo,
      isGiver: false,
      round: 1
    }));

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

  const normalizedGuess = normalizeString(guess);
  const normalizedWord = normalizeString(room.currentWord);
  const isCorrect = normalizedGuess === normalizedWord;

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
    room.teamScore++;

    await supabase.from('games').update({
      player1_score: room.teamScore,
      player2_score: room.teamScore
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
      player1_score: room.teamScore,
      player2_score: room.teamScore
    }).eq('id', gameId);

    broadcast(room, {
      type: 'game_end',
      teamScore: room.teamScore
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
  if (idx !== -1) {
    queue.splice(idx, 1);
    broadcastQueueSize();
  }

  for (const [gameId, room] of rooms.entries()) {
    if (room.player1.ws === ws || room.player2.ws === ws) {
      if (room.timer) clearInterval(room.timer);

      const other = room.player1.ws === ws ? room.player2 : room.player1;
      other.ws.send(JSON.stringify({ type: 'partner_disconnected' }));

      rooms.delete(gameId);
    }
  }
}

server.listen(PORT, () => {
  console.log('🚀 WebSocket server running on port', PORT);
});