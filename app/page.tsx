"use client"

import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Swords, Users, Send, Loader2, Trophy, Star, Play, Target, Shield, Crown, AlertCircle, Zap, X, Clock, Award, Ban, Check, Bot, LogIn, UserPlus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { createAccount, login, getOrCreatePlayer } from "@/lib/auth";

// ========== COMPOSANT PUBLICITÉ ==========
const AdBanner = ({
  slot,
  format = "auto",
  style = { display: 'block' },
  className = ""
}: {
  slot: string;
  format?: string;
  style?: React.CSSProperties;
  className?: string;
}) => {
  useEffect(() => {
    try {
      // @ts-ignore
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch (err) {
      console.error('AdSense error:', err);
    }
  }, []);

  return (
    <div className={className}>
      <ins
        className="adsbygoogle"
        style={style}
        data-ad-client="ca-pub-6353514227988642"
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
};

const AdSenseInit = () => {
  useEffect(() => {
    if (!document.querySelector('script[src*="adsbygoogle.js"]')) {
      const script = document.createElement('script');
      script.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6353514227988642';
      script.async = true;
      script.crossOrigin = 'anonymous';
      document.head.appendChild(script);
    }
  }, []);

  return null;
};
// ==========================================

interface Attempt {
  clue: string;
  guess: string;
  correct: boolean;
}

interface LeaderboardEntry {
  id: string;
  pseudo: string;
  score_giver: number;
  total_games: number;
  games_won: number;
}

interface BotHints {
  hint1: string;
  hint2: string;
  hint3: string;
  hint4: string;
}

const normalizeString = (str: string) => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
};

const DicoClash = () => {
  AdSenseInit();

  const [gameState, setGameState] = useState<"auth" | "welcome" | "home" | "queue" | "playing" | "results">("auth");
  const [authMode, setAuthMode] = useState<"choice" | "login" | "register" | "guest">("choice");
  const [pseudo, setPseudo] = useState("");
  const [password, setPassword] = useState("");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(true);

  const [ws, setWs] = useState<WebSocket | null>(null);
  const [playerId, setPlayerId] = useState("");
  const playerIdRef = useRef("");
  const [playerScore, setPlayerScore] = useState(1000);
  const [totalGames, setTotalGames] = useState(0);
  const [gamesWon, setGamesWon] = useState(0);
  const [gameId, setGameId] = useState("");
  const [partnerPseudo, setPartnerPseudo] = useState("");
  const [isGiver, setIsGiver] = useState(false);
  const [word, setWord] = useState("");
  const [round, setRound] = useState(1);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [currentClue, setCurrentClue] = useState("");
  const [currentGuess, setCurrentGuess] = useState("");
  const [timeLeft, setTimeLeft] = useState(60);
  const [teamScore, setTeamScore] = useState(0);
  const [waitingForPartner, setWaitingForPartner] = useState(false);
  const [loading, setLoading] = useState(false);
  const [onlinePlayers, setOnlinePlayers] = useState(0);
  const [activeGames, setActiveGames] = useState(0);
  const [queueSize, setQueueSize] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [clueError, setClueError] = useState("");
  const [failedWord, setFailedWord] = useState("");

  // BOT MODE
  const [botMode, setBotMode] = useState(false);
  const [botWords, setBotWords] = useState<Array<{word: string, hints: BotHints}>>([]);
  const [botCurrentHints, setBotCurrentHints] = useState<string[]>([]);
  const [botHintIndex, setBotHintIndex] = useState(0);
  const [botTimerInterval, setBotTimerInterval] = useState<NodeJS.Timeout | null>(null);

  // CACHE SESSION
  useEffect(() => {
    // Charger depuis localStorage au démarrage
    const cachedPlayerId = localStorage.getItem('dicoclash_playerId');
    const cachedPseudo = localStorage.getItem('dicoclash_pseudo');
    const cachedAccountId = localStorage.getItem('dicoclash_accountId');
    const cachedIsGuest = localStorage.getItem('dicoclash_isGuest');

    if (cachedPlayerId && cachedPseudo) {
      console.log('🔄 Restoring session from cache');
      setPlayerId(cachedPlayerId);
      playerIdRef.current = cachedPlayerId;
      setPseudo(cachedPseudo);
      setAccountId(cachedAccountId);
      setIsGuest(cachedIsGuest === 'true');

      // Recharger les données du joueur
      reloadPlayerData(cachedPlayerId);
      setGameState('home');
    }
  }, []);

  // Sauvegarder dans localStorage
  const saveSession = (pId: string, psPseudo: string, accId: string | null, guest: boolean) => {
    localStorage.setItem('dicoclash_playerId', pId);
    localStorage.setItem('dicoclash_pseudo', psPseudo);
    localStorage.setItem('dicoclash_accountId', accId || '');
    localStorage.setItem('dicoclash_isGuest', guest.toString());
  };

  // Effacer la session
  const clearSession = () => {
    localStorage.removeItem('dicoclash_playerId');
    localStorage.removeItem('dicoclash_pseudo');
    localStorage.removeItem('dicoclash_accountId');
    localStorage.removeItem('dicoclash_isGuest');
  };

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080';
    let socket: WebSocket | null = null;
    let reconnectAttempts = 0;
    const MAX_RECONNECT_ATTEMPTS = 5;

    const connect = () => {
      console.log('🔄 Connecting to WebSocket...', wsUrl);
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        console.log('✅ WebSocket connected');
        reconnectAttempts = 0;
        setWs(socket);
      };

      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('📩 WS Message received:', data.type, data);

        switch (data.type) {
          case 'stats_update':
            setActiveGames(data.activeGames);
            setOnlinePlayers(data.onlinePlayers);
            break;

          case 'queue_update':
            setQueueSize(data.queueSize);
            break;

          case 'game_start':
            setGameId(data.gameId);
            setPartnerPseudo(data.partnerPseudo);
            setIsGiver(data.isGiver);
            setWord(data.word || '');
            setRound(data.round);
            setAttempts([]);
            setTimeLeft(60);
            setTeamScore(0);
            setBotMode(false);
            setFailedWord('');
            setGameState('playing');
            break;

          case 'new_clue':
            setAttempts(data.attempts);
            setWaitingForPartner(false);
            break;

          case 'clue_sent':
            setAttempts(data.attempts);
            setWaitingForPartner(true);
            break;

          case 'new_guess':
            setAttempts(data.attempts);
            setWaitingForPartner(false);
            if (data.correct) {
              setTeamScore(prev => prev + 1);
            }
            break;

          case 'word_failed':
            console.log('❌ WORD FAILED received:', data.word);
            setFailedWord(data.word);
            // Garder affiché pendant 3 secondes
            setTimeout(() => {
              setFailedWord('');
            }, 3000);
            break;

          case 'new_round':
            console.log('🔄 New round:', data.round);
            setRound(data.round);
            setIsGiver(data.isGiver);
            setWord(data.word || '');
            setAttempts([]);
            setTimeLeft(60);
            setWaitingForPartner(false);
            setFailedWord('');
            break;

          case 'timer_update':
            setTimeLeft(data.timeLeft);
            break;

          case 'game_end':
            setTeamScore(data.teamScore);
            updatePlayerStats(data.teamScore, playerIdRef.current);
            setGameState('results');
            break;

          case 'partner_disconnected':
            alert('Votre complice s\'est déconnecté');
            reloadPlayerData(playerIdRef.current);
            setGameState('home');
            break;
        }
      };

      socket.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
      };

      socket.onclose = () => {
        console.log('🔌 WebSocket closed');

        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
          setTimeout(connect, delay);
        } else {
          setWs(null);
        }
      };
    };

    connect();

    return () => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, []);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, []);

  const loadStats = async () => {
    const { data: topPlayers } = await supabase
      .from('players')
      .select('id, pseudo, score_giver, total_games, games_won')
      .order('score_giver', { ascending: false })
      .limit(10);

    if (topPlayers) {
      setLeaderboard(topPlayers);
    }
  };

  const reloadPlayerData = async (pId: string) => {
    if (!pId) return;

    const { data: player } = await supabase
      .from('players')
      .select('*')
      .eq('id', pId)
      .single();

    if (player) {
      setPlayerScore(player.score_giver);
      setTotalGames(player.total_games);
      setGamesWon(player.games_won);
    }
  };

  const updatePlayerStats = async (finalScore: number, pId: string) => {
    if (!pId) return;

    const wordsFound = finalScore;
    const wordsMissed = 4 - finalScore;
    const pointsGained = (wordsFound * 25) - (wordsMissed * 10);
    const isPerfect = finalScore === 4;

    const { data: currentPlayer } = await supabase
      .from('players')
      .select('*')
      .eq('id', pId)
      .single();

    if (!currentPlayer) return;

    const newScore = currentPlayer.score_giver + pointsGained;
    const newTotalGames = currentPlayer.total_games + 1;
    const newGamesWon = currentPlayer.games_won + (isPerfect ? 1 : 0);

    await supabase
      .from('players')
      .update({
        score_giver: newScore,
        total_games: newTotalGames,
        games_won: newGamesWon
      })
      .eq('id', pId);

    setPlayerScore(newScore);
    setTotalGames(newTotalGames);
    setGamesWon(newGamesWon);

    await loadStats();
  };

  // AUTHENTIFICATION
  const handleLogin = async () => {
    setLoading(true);
    try {
      const account = await login(pseudo, password);
      const player = await getOrCreatePlayer(pseudo, account.id);

      setAccountId(account.id);
      setIsGuest(false);
      setPlayerId(player.id);
      playerIdRef.current = player.id;
      setPlayerScore(player.score_giver);
      setTotalGames(player.total_games);
      setGamesWon(player.games_won);

      // Sauvegarder dans cache
      saveSession(player.id, pseudo, account.id, false);

      if (ws) ws.send(JSON.stringify({ type: 'player_online', playerId: player.id }));

      setGameState('home');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    setLoading(true);
    try {
      const account = await createAccount(pseudo, password);
      const player = await getOrCreatePlayer(pseudo, account.id);

      setAccountId(account.id);
      setIsGuest(false);
      setPlayerId(player.id);
      playerIdRef.current = player.id;
      setPlayerScore(player.score_giver);
      setTotalGames(player.total_games);
      setGamesWon(player.games_won);

      // Sauvegarder dans cache
      saveSession(player.id, pseudo, account.id, false);

      if (ws) ws.send(JSON.stringify({ type: 'player_online', playerId: player.id }));

      setGameState('home');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async () => {
    setLoading(true);
    try {
      const player = await getOrCreatePlayer(pseudo);

      setIsGuest(true);
      setPlayerId(player.id);
      playerIdRef.current = player.id;
      setPlayerScore(player.score_giver);
      setTotalGames(player.total_games);
      setGamesWon(player.games_won);

      // Sauvegarder dans cache
      saveSession(player.id, pseudo, null, true);

      if (ws) ws.send(JSON.stringify({ type: 'player_online', playerId: player.id }));

      setGameState('home');
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const joinQueue = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !playerId) return;

    ws.send(JSON.stringify({
      type: 'join_queue',
      playerId,
      pseudo
    }));

    setGameState('queue');
  };

  // BOT MODE - FIX COMPLET
  const startBotGame = async () => {
  setLoading(true);
  try {
    const { data: wordsData, error } = await supabase
      .from('words')
      .select('id, word, word_hints!inner(hint1, hint2, hint3, hint4)')
      .limit(200);

    if (error || !wordsData) {
      console.error('Error loading words:', error);
      alert('Erreur lors du chargement des mots');
      setLoading(false);
      return;
    }

    const wordsWithHints = wordsData
      .filter(w => w.word_hints && w.word_hints.length > 0)
      .map(w => ({
        word: w.word,
        hints: w.word_hints[0]
      }));

    console.log('🤖 Words with hints loaded:', wordsWithHints.length);

    if (wordsWithHints.length < 4) {
      alert('Pas assez de mots avec indices dans la base');
      setLoading(false);
      return;
    }

    const shuffled = wordsWithHints.sort(() => Math.random() - 0.5);
    const selectedWords = shuffled.slice(0, 4);

    console.log('🤖 Bot game starting with words:', selectedWords);

    setBotWords(selectedWords);
    setBotMode(true);
    setRound(1);
    setTeamScore(0);
    setAttempts([]);
    setTimeLeft(60);
    setIsGiver(false);
    setFailedWord('');

    const firstWordHints = selectedWords[0].hints;
    const allHints = [
      firstWordHints.hint1,
      firstWordHints.hint2,
      firstWordHints.hint3,
      firstWordHints.hint4
    ];

    console.log('💡 All hints for first word:', allHints);

    setBotCurrentHints(allHints);
    setBotHintIndex(0);
    setWord(selectedWords[0].word);

    setGameState('playing');
    setLoading(false);
    startBotTimer();

    // IMPORTANT : Donner le premier indice IMMÉDIATEMENT
    console.log('💡 Calling giveBotHint immediately');
    setTimeout(() => {
      const firstHint = allHints[0];
      console.log('💬 Giving FIRST hint:', firstHint);
      const newAttempt: Attempt = {
        clue: firstHint,
        guess: '',
        correct: false
      };
      setAttempts([newAttempt]);
      setBotHintIndex(1);
    }, 500);
  } catch (err) {
    console.error('Error starting bot game:', err);
    alert('Erreur lors du démarrage de la partie bot');
    setLoading(false);
  }
};

  const startBotTimer = () => {
    if (botTimerInterval) clearInterval(botTimerInterval);

    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          endBotGame();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    setBotTimerInterval(interval);
  };

  const giveBotHint = () => {
    console.log('💡 giveBotHint called - hintIndex:', botHintIndex);

    if (botHintIndex >= 4) {
      console.log('⚠️ Max hints reached');
      return;
    }

    const hint = botCurrentHints[botHintIndex];
    console.log('💬 Giving hint:', hint);

    const newAttempt: Attempt = {
      clue: hint,
      guess: '',
      correct: false
    };

    setAttempts(prev => {
      const updated = [...prev, newAttempt];
      console.log('📝 Attempts updated:', updated);
      return updated;
    });
    setBotHintIndex(prev => prev + 1);
  };

  const sendBotGuess = () => {
    if (!currentGuess.trim()) return;

    const normalizedGuess = normalizeString(currentGuess);
    const normalizedWord = normalizeString(word);
    const isCorrect = normalizedGuess === normalizedWord;

    console.log('🎯 Bot guess:', currentGuess, 'Correct:', isCorrect);

    setAttempts(prev => {
      const updated = [...prev];
      const lastAttempt = updated[updated.length - 1];
      if (lastAttempt) {
        lastAttempt.guess = currentGuess;
        lastAttempt.correct = isCorrect;
      }
      return updated;
    });

    setCurrentGuess('');

    if (isCorrect) {
      setTeamScore(prev => prev + 1);
      setTimeout(() => nextBotRound(), 2000);
    } else if (attempts.length >= 4) {
      setFailedWord(word);
      setTimeout(() => {
        setFailedWord('');
        nextBotRound();
      }, 3000);
    } else {
      setTimeout(() => giveBotHint(), 1000);
    }
  };

  const nextBotRound = () => {
  console.log('🔄 nextBotRound - current round:', round);

  if (round >= 4) {
    console.log('🏁 Game finished');
    endBotGame();
    return;
  }

  const nextRoundNum = round + 1;
  console.log('➡️ Moving to round:', nextRoundNum);

  setRound(nextRoundNum);
  setAttempts([]);
  setFailedWord('');
  setBotHintIndex(0);

  const nextWord = botWords[nextRoundNum - 1];
  console.log('🎯 Next word:', nextWord.word);

  const allHints = [
    nextWord.hints.hint1,
    nextWord.hints.hint2,
    nextWord.hints.hint3,
    nextWord.hints.hint4
  ];

  console.log('💡 All hints for next word:', allHints);

  setBotCurrentHints(allHints);
  setWord(nextWord.word);

  // Donner le premier indice immédiatement
  setTimeout(() => {
    console.log('💬 Giving first hint for round', nextRoundNum);
    const firstHint = allHints[0];
    const newAttempt: Attempt = {
      clue: firstHint,
      guess: '',
      correct: false
    };
    setAttempts([newAttempt]);
    setBotHintIndex(1);
  }, 500);
};

  const endBotGame = () => {
    if (botTimerInterval) {
      clearInterval(botTimerInterval);
      setBotTimerInterval(null);
    }

    console.log('🏁 Bot game ended. Final score:', teamScore);
    updatePlayerStats(teamScore, playerIdRef.current);
    setGameState('results');
  };
  const validateClue = (clue: string) => {
    const normalizedClue = normalizeString(clue);
    const normalizedWord = normalizeString(word);

    if (normalizedClue === normalizedWord) {
      return "Vous ne pouvez pas donner le mot lui-même !";
    }

    if (normalizedWord.includes(normalizedClue) && normalizedClue.length > 2) {
      return "L'indice est contenu dans le mot !";
    }

    if (normalizedClue.includes(normalizedWord) && normalizedWord.length > 2) {
      return "L'indice contient le mot !";
    }

    if (normalizedWord.substring(0, 3) === normalizedClue.substring(0, 3)) {
      return "Premiers caractères identiques";
    }

    if (normalizedWord.slice(-3) === normalizedClue.slice(-3) && normalizedClue.length > 3) {
      return "Derniers caractères identiques";
    }

    return "";
  };

  const sendClue = () => {
    if (!ws || !currentClue.trim()) return;

    const error = validateClue(currentClue.trim());
    if (error) {
      setClueError(error);
      setTimeout(() => setClueError(""), 3000);
      return;
    }

    setClueError("");

    ws.send(JSON.stringify({
      type: 'send_clue',
      gameId,
      clue: currentClue.trim()
    }));
    setCurrentClue('');
  };

  const sendGuess = () => {
    if (botMode) {
      sendBotGuess();
      return;
    }

    if (!ws || !currentGuess.trim()) return;

    ws.send(JSON.stringify({
      type: 'send_guess',
      gameId,
      guess: currentGuess.trim()
    }));
    setCurrentGuess('');
  };

  // ========== PAGE AUTH (LOGO + NOM À CÔTÉ) ==========
  if (gameState === 'auth') {
    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/dicoclash-background-sides.png)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-white/80 backdrop-blur-sm">
          <AdBanner
            slot="4176823157"
            format="auto"
            style={{ display: 'block', minHeight: '90px' }}
            className="bg-gradient-to-r from-cyan-100 to-blue-100 border-b border-cyan-200 py-2"
          />

          <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8">
            {/* HEADER COMPACT - LOGO + NOM À CÔTÉ */}
            <div className="text-center py-6">
              <div className="flex items-center justify-center gap-4 mb-4">
                <div className="relative">
                  <div className="absolute inset-0 bg-gradient-to-br from-cyan-400 to-pink-500 rounded-2xl blur-xl opacity-40 animate-pulse"></div>
                  <div className="relative p-4 bg-gradient-to-br from-cyan-500 via-blue-500 to-pink-500 rounded-2xl shadow-xl">
                    <Swords className="w-12 h-12 text-white" strokeWidth={2.5} />
                  </div>
                </div>
                <h1 className="text-5xl md:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 via-blue-600 to-pink-600">
                  DicoClash
                </h1>
              </div>
              <p className="text-lg md:text-xl text-gray-800 font-bold">
                Jeu de mots coopératif multijoueur
              </p>

              <div className="flex justify-center gap-8 md:gap-16 py-4">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-2xl md:text-3xl font-black text-green-600">
                    <Users className="w-6 h-6" strokeWidth={3} />
                    {onlinePlayers}
                  </div>
                  <p className="text-xs text-gray-700 font-bold mt-1">en ligne</p>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-2 text-2xl md:text-3xl font-black text-blue-600">
                    <Zap className="w-6 h-6" strokeWidth={3} />
                    {activeGames}
                  </div>
                  <p className="text-xs text-gray-700 font-bold mt-1">parties</p>
                </div>
              </div>
            </div>

            {/* FORMULAIRE AUTH */}
            <Card className="max-w-md mx-auto border-2 border-cyan-300 shadow-2xl bg-white">
              <CardContent className="p-8 space-y-4">
                {authMode === 'choice' && (
                  <>
                    <Button
                      onClick={() => setAuthMode('guest')}
                      className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-black py-6 text-lg"
                    >
                      <Play className="mr-2 w-6 h-6" fill="white" />
                      JOUER EN INVITÉ
                    </Button>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-gray-300" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-white px-2 text-gray-500 font-bold">Ou</span>
                      </div>
                    </div>

                    <Button
                      onClick={() => setAuthMode('login')}
                      variant="outline"
                      className="w-full border-2 border-cyan-500 text-cyan-700 font-black py-6 text-lg hover:bg-cyan-50"
                    >
                      <LogIn className="mr-2 w-5 h-5" />
                      SE CONNECTER
                    </Button>

                    <Button
                      onClick={() => setAuthMode('register')}
                      variant="outline"
                      className="w-full border-2 border-pink-500 text-pink-700 font-black py-6 text-lg hover:bg-pink-50"
                    >
                      <UserPlus className="mr-2 w-5 h-5" />
                      CRÉER UN COMPTE
                    </Button>
                  </>
                )}

                {authMode === 'guest' && (
                  <>
                    <Button
                      onClick={() => setAuthMode('choice')}
                      variant="ghost"
                      className="mb-4"
                    >
                      ← Retour
                    </Button>
                    <input
                      type="text"
                      value={pseudo}
                      onChange={(e) => setPseudo(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleGuest()}
                      placeholder="Votre pseudo..."
                      className="w-full px-5 py-4 text-lg font-bold border-2 border-cyan-300 bg-white text-gray-900 placeholder-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      maxLength={20}
                      disabled={loading}
                    />
                    <Button
                      onClick={handleGuest}
                      disabled={!pseudo.trim() || loading}
                      className="w-full bg-gradient-to-r from-green-500 to-emerald-600 text-white font-black py-6 text-lg"
                    >
                      {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : 'CONTINUER'}
                    </Button>
                    <p className="text-xs text-gray-600 text-center">
                      ⚠️ Les pseudos avec compte sont protégés (même casse différente)
                    </p>
                  </>
                )}

                {authMode === 'login' && (
                  <>
                    <Button
                      onClick={() => setAuthMode('choice')}
                      variant="ghost"
                      className="mb-4"
                    >
                      ← Retour
                    </Button>
                    <input
                      type="text"
                      value={pseudo}
                      onChange={(e) => setPseudo(e.target.value)}
                      placeholder="Pseudo"
                      className="w-full px-5 py-4 text-lg font-bold border-2 border-cyan-300 bg-white text-gray-900 placeholder-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      maxLength={20}
                      disabled={loading}
                    />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                      placeholder="Mot de passe"
                      className="w-full px-5 py-4 text-lg font-bold border-2 border-cyan-300 bg-white text-gray-900 placeholder-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      disabled={loading}
                    />
                    <Button
                      onClick={handleLogin}
                      disabled={!pseudo.trim() || !password.trim() || loading}
                      className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-black py-6 text-lg"
                    >
                      {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : 'SE CONNECTER'}
                    </Button>
                  </>
                )}

                {authMode === 'register' && (
                  <>
                    <Button
                      onClick={() => setAuthMode('choice')}
                      variant="ghost"
                      className="mb-4"
                    >
                      ← Retour
                    </Button>
                    <input
                      type="text"
                      value={pseudo}
                      onChange={(e) => setPseudo(e.target.value)}
                      placeholder="Pseudo"
                      className="w-full px-5 py-4 text-lg font-bold border-2 border-pink-300 bg-white text-gray-900 placeholder-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                      maxLength={20}
                      disabled={loading}
                    />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleRegister()}
                      placeholder="Mot de passe (min 8 caractères)"
                      className="w-full px-5 py-4 text-lg font-bold border-2 border-pink-300 bg-white text-gray-900 placeholder-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                      disabled={loading}
                    />
                    <Button
                      onClick={handleRegister}
                      disabled={!pseudo.trim() || !password.trim() || loading}
                      className="w-full bg-gradient-to-r from-pink-500 to-purple-600 text-white font-black py-6 text-lg"
                    >
                      {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : 'CRÉER MON COMPTE'}
                    </Button>
                    <p className="text-xs text-gray-600 text-center">
                      ✅ Votre pseudo sera protégé (insensible à la casse)
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            {/* RÈGLES DU JEU */}
            <Card className="border-4 border-blue-400 bg-white shadow-2xl">
              <CardHeader className="bg-gradient-to-r from-blue-200 to-cyan-200 border-b-4 border-blue-400">
                <CardTitle className="text-3xl font-black flex items-center gap-3 text-gray-900">
                  <Target className="w-8 h-8 text-cyan-700" strokeWidth={3} />
                  RÈGLES DU JEU
                </CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <div className="grid md:grid-cols-2 gap-8">
                  <div className="space-y-6">
                    <div className="flex gap-4 items-start bg-cyan-50 p-4 rounded-xl border-2 border-cyan-200">
                      <Target className="w-10 h-10 text-cyan-600 flex-shrink-0" strokeWidth={2.5} />
                      <div>
                        <h3 className="font-black text-xl text-gray-900 mb-2">OBJECTIF</h3>
                        <p className="text-base font-bold text-gray-800">Deviner 4 mots en équipe avec des indices</p>
                      </div>
                    </div>

                    <div className="flex gap-4 items-start bg-orange-50 p-4 rounded-xl border-2 border-orange-200">
                      <Clock className="w-10 h-10 text-orange-600 flex-shrink-0" strokeWidth={2.5} />
                      <div>
                        <h3 className="font-black text-xl text-gray-900 mb-2">TEMPS LIMITÉ</h3>
                        <p className="text-base font-bold text-gray-800">60 secondes pour toute la partie</p>
                      </div>
                    </div>

                    <div className="flex gap-4 items-start bg-purple-50 p-4 rounded-xl border-2 border-purple-200">
                      <Users className="w-10 h-10 text-purple-600 flex-shrink-0" strokeWidth={2.5} />
                      <div>
                        <h3 className="font-black text-xl text-gray-900 mb-2">COOPÉRATION</h3>
                        <p className="text-base font-bold text-gray-800">4 tentatives maximum par mot</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <div className="flex gap-4 items-start bg-green-50 p-4 rounded-xl border-2 border-green-300">
                      <Award className="w-10 h-10 text-green-600 flex-shrink-0" strokeWidth={2.5} />
                      <div>
                        <h3 className="font-black text-xl text-gray-900 mb-2">SCORING</h3>
                        <p className="text-base font-bold text-green-700">✅ +25 points par mot trouvé</p>
                        <p className="text-base font-bold text-red-700 mt-1">❌ -10 points par mot raté</p>
                      </div>
                    </div>

                    <div className="bg-red-50 p-6 rounded-xl border-4 border-red-400">
                      <div className="flex gap-3 items-start mb-3">
                        <Ban className="w-8 h-8 text-red-600 flex-shrink-0" strokeWidth={3} />
                        <h3 className="font-black text-xl text-red-900">INDICES INTERDITS</h3>
                      </div>
                      <ul className="space-y-2 text-sm font-bold text-red-800">
                        <li className="flex items-start gap-2">
                          <X className="w-5 h-5 flex-shrink-0 mt-0.5" />
                          Donner le mot lui-même
                        </li>
                        <li className="flex items-start gap-2">
                          <X className="w-5 h-5 flex-shrink-0 mt-0.5" />
                          Mot contenant le mot à deviner
                        </li>
                        <li className="flex items-start gap-2">
                          <X className="w-5 h-5 flex-shrink-0 mt-0.5" />
                          Même début ou fin de mot
                        </li>
                        <li className="flex items-start gap-2">
                          <X className="w-5 h-5 flex-shrink-0 mt-0.5" />
                          Trop de lettres en commun
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* CLASSEMENT */}
            <Card className="border-2 border-yellow-300 bg-white shadow-xl">
              <CardHeader className="bg-gradient-to-r from-yellow-100 to-orange-100 border-b">
                <CardTitle className="text-2xl font-black flex items-center gap-2 text-gray-900">
                  <Trophy className="w-6 h-6 text-yellow-600" />
                  Classement
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                {leaderboard.length === 0 ? (
                  <div className="text-center py-8">
                    <Loader2 className="w-8 h-8 animate-spin mx-auto text-gray-400 mb-2" />
                    <p className="text-gray-600">Chargement...</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {leaderboard.map((player, index) => (
                      <div key={player.id} className={`flex justify-between items-center p-4 rounded-xl border-2 transition-all ${
                        index === 0 ? 'bg-yellow-100 border-yellow-300' :
                        index === 1 ? 'bg-gray-100 border-gray-300' :
                        index === 2 ? 'bg-orange-100 border-orange-300' :
                        'bg-white border-gray-200'
                      }`}>
                        <div className="flex items-center gap-4">
                          {index === 0 && <Crown className="w-6 h-6 text-yellow-600" />}
                          {index === 1 && <Star className="w-6 h-6 text-gray-500" />}
                          {index === 2 && <Star className="w-6 h-6 text-orange-600" />}
                          <span className="font-black text-gray-600 text-lg w-8">#{index + 1}</span>
                          <span className="font-bold text-lg text-gray-900">{player.pseudo}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-black text-cyan-600">{player.score_giver}</div>
                          <div className="text-xs text-gray-600 font-medium">{player.total_games} parties • {player.games_won} parfaites</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <AdBanner
            slot="4176823157"
            format="auto"
            style={{ display: 'block', minHeight: '90px' }}
            className="bg-gradient-to-r from-cyan-100 to-blue-100 border-t border-cyan-200 py-2 mt-12"
          />
        </div>
      </div>
    );
  }
  // ========== PAGE HOME ==========
  if (gameState === 'home') {
    const myRank = leaderboard.findIndex(p => p.id === playerId) + 1;

    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/dicoclash-background-sides.png)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-white/80 backdrop-blur-sm">
          <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
            <div className="text-center">
              <h1 className="text-4xl md:text-5xl font-black text-gray-900 mb-3">
                {pseudo} {isGuest && <Badge className="text-sm bg-gray-400">Invité</Badge>}
              </h1>
              <div className="flex justify-center gap-4 flex-wrap">
                <Badge className="text-lg px-6 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white border-0 shadow-lg">
                  <Crown className="w-5 h-5 mr-2" />
                  {playerScore} points
                </Badge>
                {myRank > 0 && (
                  <Badge className="text-lg px-6 py-2 border-2 bg-white text-gray-900 border-pink-400 shadow-lg">
                    #{myRank} au classement
                  </Badge>
                )}
              </div>
            </div>

            <Card className="border-2 border-cyan-300 shadow-2xl bg-white">
              <CardContent className="p-6 space-y-3">
                <Button
                  onClick={joinQueue}
                  className="w-full text-lg px-8 py-6 bg-gradient-to-r from-cyan-500 via-blue-500 to-pink-500 hover:from-cyan-600 hover:via-blue-600 hover:to-pink-600 rounded-xl shadow-xl font-black"
                >
                  <Users className="mr-2 w-6 h-6" strokeWidth={3} />
                  JOUER EN LIGNE
                </Button>

                <Button
                  onClick={startBotGame}
                  disabled={loading}
                  className="w-full text-base px-6 py-5 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-600 hover:to-indigo-700 rounded-xl shadow-lg font-black"
                >
                  <Bot className="mr-2 w-5 h-5" strokeWidth={3} />
                  {loading ? <Loader2 className="w-5 h-5 animate-spin inline" /> : 'JOUER CONTRE UN BOT'}
                </Button>

                <div className="flex justify-center gap-8 pt-2">
                  <div className="text-center">
                    <div className="text-green-600 text-2xl font-black">{onlinePlayers}</div>
                    <p className="text-xs text-gray-700 font-bold">En ligne</p>
                  </div>
                  <div className="text-center">
                    <div className="text-blue-600 text-2xl font-black">{activeGames}</div>
                    <p className="text-xs text-gray-700 font-bold">Parties</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-3 gap-4">
              <Card className="bg-gradient-to-br from-yellow-100 to-orange-100 border-2 border-yellow-300 shadow">
                <CardContent className="p-6 text-center">
                  <Trophy className="w-12 h-12 mx-auto mb-3 text-yellow-600" strokeWidth={2.5} />
                  <p className="text-4xl font-black text-gray-900">{totalGames}</p>
                  <p className="text-sm text-gray-700 font-bold mt-1">Parties</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-green-100 to-emerald-100 border-2 border-green-300 shadow">
                <CardContent className="p-6 text-center">
                  <Star className="w-12 h-12 mx-auto mb-3 text-green-600" strokeWidth={2.5} />
                  <p className="text-4xl font-black text-gray-900">{gamesWon}</p>
                  <p className="text-sm text-gray-700 font-bold mt-1">Parfaites</p>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-cyan-100 to-blue-100 border-2 border-cyan-300 shadow">
                <CardContent className="p-6 text-center">
                  <Zap className="w-12 h-12 mx-auto mb-3 text-cyan-600" strokeWidth={2.5} />
                  <p className="text-4xl font-black text-gray-900">{playerScore}</p>
                  <p className="text-sm text-gray-700 font-bold mt-1">Score</p>
                </CardContent>
              </Card>
            </div>

            <Card className="border-4 border-blue-400 bg-white shadow-xl">
              <CardHeader className="bg-gradient-to-r from-blue-200 to-cyan-200 border-b-4 border-blue-400 pb-3">
                <CardTitle className="text-2xl font-black flex items-center gap-2 text-gray-900">
                  <Shield className="w-7 h-7 text-blue-700" strokeWidth={3} />
                  RÈGLES DU JEU
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="bg-green-50 p-4 rounded-xl border-2 border-green-300">
                    <div className="flex items-center gap-2 mb-2">
                      <Check className="w-6 h-6 text-green-600" strokeWidth={3} />
                      <h3 className="font-black text-lg text-green-900">SI TROUVÉ</h3>
                    </div>
                    <p className="text-sm font-bold text-green-800">+25 points au score total</p>
                  </div>
                  <div className="bg-red-50 p-4 rounded-xl border-2 border-red-300">
                    <div className="flex items-center gap-2 mb-2">
                      <X className="w-6 h-6 text-red-600" strokeWidth={3} />
                      <h3 className="font-black text-lg text-red-900">SI RATÉ</h3>
                    </div>
                    <p className="text-sm font-bold text-red-800">-10 points au score total</p>
                  </div>
                </div>
                <div className="bg-orange-50 p-4 rounded-xl border-2 border-orange-300">
                  <div className="flex items-center gap-2 mb-2">
                    <Ban className="w-6 h-6 text-orange-600" strokeWidth={3} />
                    <h3 className="font-black text-lg text-orange-900">INTERDICTIONS</h3>
                  </div>
                  <p className="text-sm font-bold text-orange-800">
                    ❌ Donner le mot / Mot similaire / Même début ou fin / Trop de similitudes
                  </p>
                </div>
                <div className="bg-cyan-50 p-4 rounded-xl border-2 border-cyan-300">
                  <div className="flex items-center gap-2 mb-2">
                    <Clock className="w-6 h-6 text-cyan-600" strokeWidth={3} />
                    <h3 className="font-black text-lg text-cyan-900">TIMING</h3>
                  </div>
                  <p className="text-sm font-bold text-cyan-800">
                    ⏱️ 60 secondes pour deviner 4 mots • 4 tentatives max par mot
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-yellow-300 bg-white shadow-xl">
              <CardHeader className="bg-gradient-to-r from-yellow-100 to-orange-100 border-b">
                <CardTitle className="text-xl font-black flex items-center gap-2 text-gray-900">
                  <Trophy className="w-6 h-6 text-yellow-600" />
                  Classement
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4">
                {leaderboard.length === 0 ? (
                  <div className="text-center py-6">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-400 mb-2" />
                    <p className="text-gray-600 text-sm">Chargement...</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {leaderboard.slice(0, 5).map((player, index) => (
                      <div key={player.id} className={`flex justify-between items-center p-3 rounded-lg border-2 ${
                        index === 0 ? 'bg-yellow-100 border-yellow-300' :
                        index === 1 ? 'bg-gray-100 border-gray-300' :
                        index === 2 ? 'bg-orange-100 border-orange-300' :
                        'bg-white border-gray-200'
                      }`}>
                        <div className="flex items-center gap-3">
                          {index === 0 && <Crown className="w-5 h-5 text-yellow-600" />}
                          {index === 1 && <Star className="w-5 h-5 text-gray-500" />}
                          {index === 2 && <Star className="w-5 h-5 text-orange-600" />}
                          <span className="font-black text-gray-600 w-6">#{index + 1}</span>
                          <span className="font-bold text-gray-900">{player.pseudo}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-xl font-black text-cyan-600">{player.score_giver}</div>
                          <div className="text-xs text-gray-600">{player.total_games} parties</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="text-center">
              <Button variant="outline" className="border-2 border-gray-300 bg-white text-gray-900 hover:bg-gray-100" onClick={() => {
                if (ws) ws.send(JSON.stringify({ type: 'player_offline', playerId }));
                clearSession();
                setGameState('auth');
                setAuthMode('choice');
                setPseudo('');
                setPassword('');
              }}>
                <X className="w-4 h-4 mr-2" />
                Déconnexion
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ========== PAGE QUEUE ==========
  if (gameState === 'queue') {
    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/dicoclash-background-sides.png)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-white/80 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-md border-2 border-cyan-300 shadow-2xl bg-white">
            <CardContent className="p-10 text-center space-y-6">
              <div className="w-24 h-24 bg-gradient-to-br from-cyan-100 to-blue-100 rounded-full flex items-center justify-center mx-auto shadow-lg border-4 border-cyan-300">
                <Users className="w-12 h-12 text-cyan-600 animate-pulse" strokeWidth={2.5} />
              </div>
              <div>
                <h2 className="text-3xl font-black text-gray-900 mb-2">Recherche...</h2>
                <p className="text-gray-700 font-medium text-lg mt-3">
                  <span className="text-3xl font-black text-cyan-600">{queueSize}</span> joueur{queueSize > 1 ? 's' : ''} en attente
                </p>
                <p className="text-sm text-gray-600 font-medium mt-2">
                  {activeGames} parties en cours
                </p>
              </div>
              <Loader2 className="w-10 h-10 mx-auto animate-spin text-cyan-600" strokeWidth={3} />
              <Button variant="outline" className="border-2 border-gray-300 bg-white text-gray-900 w-full py-6 hover:bg-gray-100" onClick={() => {
                if (ws) ws.send(JSON.stringify({ type: 'leave_queue', playerId }));
                setGameState('home');
              }}>
                Annuler
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // ========== PAGE PLAYING ==========
  if (gameState === 'playing') {
    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/dicoclash-background-sides.png)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-white/80 backdrop-blur-sm p-2 md:p-4">
          <div className="max-w-5xl mx-auto space-y-2">
            <div className={`${botMode ? 'bg-gradient-to-r from-purple-500 to-indigo-600' : isGiver ? 'bg-gradient-to-r from-cyan-500 to-blue-600' : 'bg-gradient-to-r from-indigo-500 to-purple-600'} text-white p-3 rounded-xl shadow-lg`}>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-4">
                  <div>
                    <div className="text-lg font-black">MANCHE {round}/4</div>
                    <Badge className={`${botMode ? 'bg-white text-purple-700' : isGiver ? 'bg-white text-cyan-700' : 'bg-white text-indigo-700'} border-0 font-bold text-xs`}>
                      {botMode ? "🤖 MODE BOT" : isGiver ? "🎯 VOUS DONNEZ" : "🔍 VOUS DEVINEZ"}
                    </Badge>
                  </div>
                  <div className="text-3xl font-black">
                    {teamScore}/4
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {!botMode && <div className="text-sm font-bold">avec {partnerPseudo}</div>}
                  <div className={`text-3xl font-black ${timeLeft > 30 ? 'text-green-300' : timeLeft > 10 ? 'text-yellow-300' : 'text-red-300 animate-pulse'} flex items-center gap-1`}>
                    <Clock className="w-6 h-6" />
                    {timeLeft}s
                  </div>
                </div>
              </div>
            </div>

            <Card className="border-2 border-orange-300 bg-orange-50 shadow">
              <CardContent className="p-2">
                <div className="flex items-center gap-2 text-xs">
                  <Shield className="w-4 h-4 text-orange-600 flex-shrink-0" strokeWidth={3} />
                  <div className="flex gap-4 flex-wrap">
                    <span className="font-bold text-green-800">✅ +25pts trouvé</span>
                    <span className="font-bold text-red-800">❌ -10pts raté</span>
                    {!botMode && isGiver && <span className="font-bold text-orange-800">🚫 Pas de mot similaire</span>}
                  </div>
                </div>
              </CardContent>
            </Card>

            {failedWord && (
              <Card className="border-4 border-red-500 bg-red-50 shadow-2xl animate-pulse">
                <CardContent className="p-6 text-center">
                  <X className="w-16 h-16 text-red-600 mx-auto mb-2" strokeWidth={3} />
                  <p className="text-2xl font-black text-red-900">LOUPÉ !</p>
                  <p className="text-lg font-bold text-red-800 mt-2">
                    Le mot était : <span className="text-3xl">{failedWord}</span>
                  </p>
                </CardContent>
              </Card>
            )}

            {isGiver && !botMode && !failedWord && (
              <Card className="border-2 border-cyan-300 bg-white shadow">
                <CardContent className="p-3">
                  <div className="text-center">
                    <div className="inline-block bg-gradient-to-r from-cyan-500 to-blue-600 text-white px-8 py-3 rounded-xl text-3xl font-black shadow">
                      {word}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid md:grid-cols-2 gap-2">
              <Card className="border-2 border-blue-300 bg-white shadow">
                <CardHeader className="pb-2 bg-gradient-to-r from-blue-100 to-cyan-100 border-b py-2">
                  <CardTitle className="text-sm font-black flex items-center gap-2 text-gray-900">
                    {(!isGiver || botMode) && <span className="text-cyan-600">→</span>}
                    INDICES {botMode && <Bot className="w-4 h-4 text-purple-600" />}
                    {(!isGiver || botMode) && <span className="text-cyan-600">←</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-2 space-y-1">
                  {attempts.map((att, i) => (
                    <div key={i} className={`p-2 rounded-lg ${i % 2 === 0 ? 'bg-blue-100 border border-blue-300' : 'bg-white border border-gray-200'} shadow-sm`}>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-cyan-500 text-white font-bold text-xs">#{i + 1}</Badge>
                        <p className="font-bold text-base text-gray-900">{att.clue}</p>
                      </div>
                    </div>
                  ))}
                  {attempts.length === 0 && <p className="text-center text-gray-500 py-4 text-xs font-medium">Aucun indice</p>}
                </CardContent>
              </Card>

              <Card className="border-2 border-indigo-300 bg-white shadow">
                <CardHeader className="pb-2 bg-gradient-to-r from-indigo-100 to-purple-100 border-b py-2">
                  <CardTitle className="text-sm font-black flex items-center gap-2 text-gray-900">
                    {(isGiver && !botMode) && <span className="text-indigo-600">→</span>}
                    RÉPONSES
                    {(isGiver && !botMode) && <span className="text-indigo-600">←</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-2 space-y-1">
                  {attempts.map((att, i) => (
                    <div key={i} className={`p-2 rounded-lg ${att.correct ? 'bg-green-100 border-2 border-green-400' : att.guess ? 'bg-red-100 border border-red-300' : 'bg-gray-100 border border-gray-200'} shadow-sm`}>
                      <div className="flex items-center gap-2">
                        {att.guess && (
                          <Badge className={`${att.correct ? 'bg-green-600' : 'bg-red-600'} text-white font-bold text-xs`}>
                            {att.correct ? '✓' : '✗'}
                          </Badge>
                        )}
                        <p className="font-bold text-base text-gray-900">{att.guess || '...'}</p>
                      </div>
                    </div>
                  ))}
                  {attempts.length === 0 && <p className="text-center text-gray-500 py-4 text-xs font-medium">Aucune réponse</p>}
                </CardContent>
              </Card>
            </div>

            {clueError && (
              <div className="p-3 bg-red-100 border-2 border-red-400 rounded-xl flex items-center gap-2 shadow">
                <AlertCircle className="w-5 h-5 text-red-600" strokeWidth={3} />
                <p className="text-xs font-bold text-red-900">{clueError}</p>
              </div>
            )}

            {!botMode && isGiver && !waitingForPartner && !failedWord && (
              (attempts.length === 0 || (attempts[attempts.length - 1].guess && !attempts[attempts.length - 1].correct)) && attempts.length < 4 && (
                <Card className="border-2 border-cyan-300 bg-white shadow">
                  <CardContent className="p-3">
                    <form onSubmit={(e) => { e.preventDefault(); sendClue(); }} className="flex gap-2">
                      <input
                        type="text"
                        value={currentClue}
                        onChange={(e) => setCurrentClue(e.target.value)}
                        placeholder="Donnez votre indice..."
                        className="flex-1 px-4 py-3 text-base font-medium border-2 border-cyan-300 bg-white text-gray-900 placeholder-gray-500 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                        maxLength={50}
                        autoFocus
                        required
                      />
                      <Button type="submit" disabled={!currentClue.trim()} className="bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3 font-bold">
                        <Send className="w-5 h-5" strokeWidth={3} />
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              )
            )}

            {(botMode || !isGiver) && attempts.length > 0 && !attempts[attempts.length - 1].guess && !waitingForPartner && !failedWord && (
              <Card className="border-2 border-indigo-300 bg-white shadow">
                <CardContent className="p-3">
                  <form onSubmit={(e) => { e.preventDefault(); sendGuess(); }}>
                    <input
                      type="text"
                      value={currentGuess}
                      onChange={(e) => setCurrentGuess(e.target.value.toUpperCase())}
                      placeholder="VOTRE RÉPONSE..."
                      className="w-full px-4 py-3 border-2 border-indigo-300 bg-white text-gray-900 rounded-xl text-center font-black text-2xl uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent mb-2"
                      maxLength={30}
                      autoFocus
                      required
                    />
                    <Button type="submit" disabled={!currentGuess.trim()} className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 py-3 font-black text-base">
                      <Send className="mr-2 w-5 h-5" />
                      VALIDER
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}

            {!botMode && waitingForPartner && !failedWord && (
              <div className="text-center py-4 bg-white rounded-xl border-2 border-gray-200 shadow">
                <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-cyan-600" strokeWidth={3} />
                <p className="text-gray-900 font-bold text-sm">En attente de {partnerPseudo}...</p>
              </div>
            )}

            <AdBanner
              slot="4176823157"
              format="auto"
              style={{ display: 'block', minHeight: '90px' }}
              className="bg-gradient-to-r from-blue-100 to-cyan-100 border-2 border-blue-200 rounded-xl p-2 shadow"
            />
          </div>
        </div>
      </div>
    );
  }

  // ========== PAGE RESULTS ==========
  if (gameState === 'results') {
    const isPerfect = teamScore === 4;
    const wordsFound = teamScore;
    const wordsMissed = 4 - teamScore;
    const pointsGained = (wordsFound * 25) - (wordsMissed * 10);

    return (
      <div className="min-h-screen" style={{backgroundImage: 'url(/dicoclash-background-sides.png)', backgroundSize: 'cover', backgroundPosition: 'center'}}>
        <div className="min-h-screen bg-white/80 backdrop-blur-sm flex items-center justify-center p-4">
          <Card className="w-full max-w-2xl border-2 border-cyan-300 shadow-2xl bg-white">
            <CardContent className="p-8 md:p-12 space-y-8">
              <div className="text-center">
                {isPerfect ? (
                  <div className="w-28 h-28 bg-gradient-to-br from-yellow-400 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
                    <Crown className="w-16 h-16 text-white" strokeWidth={3} />
                  </div>
                ) : teamScore >= 2 ? (
                  <div className="w-28 h-28 bg-gradient-to-br from-green-400 to-emerald-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
                    <Trophy className="w-16 h-16 text-white" strokeWidth={3} />
                  </div>
                ) : (
                  <div className="w-28 h-28 bg-gradient-to-br from-gray-400 to-gray-600 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl">
                    <Star className="w-16 h-16 text-white" strokeWidth={3} />
                  </div>
                )}
                <h2 className="text-5xl font-black text-gray-900 mb-2">
                  {isPerfect ? "PARFAIT !" : teamScore >= 2 ? "BIEN JOUÉ !" : "PERDU..."}
                </h2>
                {botMode ? (
                  <p className="text-gray-700 text-lg font-medium">Mode Bot 🤖</p>
                ) : (
                  <p className="text-gray-700 text-lg font-medium">avec {partnerPseudo}</p>
                )}
              </div>

              <div className="text-center py-8 bg-gradient-to-r from-cyan-100 to-blue-100 rounded-2xl border-2 border-cyan-300">
                <div className="text-8xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-600 to-pink-600">
                  {teamScore}/4
                </div>
                <p className="text-gray-900 font-bold text-xl mt-2">Mots trouvés</p>
              </div>

              <div className="bg-gray-100 rounded-2xl p-6 border-2 border-gray-200">
                <h3 className="font-black text-xl mb-4 text-gray-900">RÉCAPITULATIF</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-lg">
                    <span className="font-medium text-gray-700">Mots trouvés :</span>
                    <span className="font-black text-green-600 text-2xl">+{wordsFound * 25}</span>
                  </div>
                  <div className="flex justify-between items-center text-lg">
                    <span className="font-medium text-gray-700">Mots manqués :</span>
                    <span className="font-black text-red-600 text-2xl">-{wordsMissed * 10}</span>
                  </div>
                  <div className="border-t-2 border-gray-300 pt-3 mt-3">
                    <div className="flex justify-between items-center text-xl">
                      <span className="font-bold text-gray-900">Total :</span>
                      <span className={`font-black text-3xl ${pointsGained >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {pointsGained >= 0 ? '+' : ''}{pointsGained}
                      </span>
                    </div>
                  </div>
                  <div className="border-t-2 border-gray-300 pt-3 mt-3 bg-cyan-100 -mx-6 px-6 py-4 rounded-xl">
                    <div className="flex justify-between items-center text-2xl">
                      <span className="font-black text-gray-900">Nouveau score :</span>
                      <span className="font-black text-cyan-600">{playerScore}</span>
                    </div>
                  </div>
                </div>
              </div>

              <Button onClick={() => {
                reloadPlayerData(playerIdRef.current);
                setBotMode(false);
                setGameState('home');
              }} className="w-full bg-gradient-to-r from-cyan-500 via-blue-500 to-pink-500 hover:from-cyan-600 hover:via-blue-600 hover:to-pink-600 text-2xl font-black py-8 rounded-xl shadow-lg transform hover:scale-105 transition-all">
                <Play className="mr-3 w-8 h-8" strokeWidth={3} fill="white" />
                RETOUR
              </Button>

              <AdBanner
                slot="2847445522"
                format="auto"
                style={{ display: 'block', minHeight: '200px' }}
                className="bg-gradient-to-r from-blue-100 to-pink-100 border-2 border-blue-200 rounded-xl p-4"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return null;
};

export default DicoClash;