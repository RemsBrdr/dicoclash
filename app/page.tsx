"use client"

import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Trophy, Clock, User, Zap, Crown, Star, Send, Swords, LogIn, Users, Wifi, Target, Brain, Sparkles, Timer, MessageSquare, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

type GameState = "login" | "home" | "queue" | "playing" | "results";

interface Player {
  id: string;
  pseudo: string;
  score_giver: number;
  score_guesser: number;
  total_games: number;
  games_won: number;
}

interface GameData {
  id: string;
  player1_id: string;
  player2_id: string;
  player1_score: number;
  player2_score: number;
  current_round: number;
  current_word: string;
  current_giver_id: string;
  status: string;
  time_left: number;
  round_start_time: string;
  attempts_used?: number;
}

interface LeaderboardEntry {
  id: string;
  pseudo: string;
  score_average: number;
  total_games: number;
  games_won: number;
  rank: number;
}

interface RoundAttempt {
  clue: string;
  guess: string;
  correct: boolean;
}

const DicoClash = () => {
  const [mounted, setMounted] = useState(false);
  const [gameState, setGameState] = useState<GameState>("login");
  const [currentPlayer, setCurrentPlayer] = useState<Player | null>(null);
  const [pseudoInput, setPseudoInput] = useState("");
  const [currentGame, setCurrentGame] = useState<GameData | null>(null);
  const [opponentPseudo, setOpponentPseudo] = useState("");
  const [currentClue, setCurrentClue] = useState("");
  const [currentGuess, setCurrentGuess] = useState("");
  const [attempts, setAttempts] = useState<RoundAttempt[]>([]);
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const [onlinePlayers, setOnlinePlayers] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queueTime, setQueueTime] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null);
  const gameChannel = useRef<any>(null);
  const roundsChannel = useRef<any>(null);
  const matchmakingInterval = useRef<NodeJS.Timeout | null>(null);
  const lastKnownRound = useRef(0);
  const updateLock = useRef(false);

  useEffect(() => {
    setMounted(true);
    return () => {
      cleanupChannels();
    };
  }, []);

  useEffect(() => {
    if (mounted) {
      loadLeaderboard();
      updateOnlineCount();

      if (currentPlayer) {
        startHeartbeat();
        const interval = setInterval(updateOnlineCount, 10000);
        return () => {
          clearInterval(interval);
          stopHeartbeat();
        };
      } else {
        const interval = setInterval(updateOnlineCount, 10000);
        return () => clearInterval(interval);
      }
    }
  }, [mounted, currentPlayer]);

  useEffect(() => {
    if (gameState === "queue") {
      const interval = setInterval(() => setQueueTime(prev => prev + 1), 1000);
      return () => clearInterval(interval);
    } else {
      setQueueTime(0);
    }
  }, [gameState]);

  useEffect(() => {
    if (gameState === "playing" && timeLeft > 0 && !isTransitioning) {
      const interval = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            handleTimeOut();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [gameState, timeLeft, isTransitioning]);

  const cleanupChannels = () => {
    if (gameChannel.current) {
      supabase.removeChannel(gameChannel.current);
      gameChannel.current = null;
    }
    if (roundsChannel.current) {
      supabase.removeChannel(roundsChannel.current);
      roundsChannel.current = null;
    }
  };

  const startHeartbeat = async () => {
    if (!currentPlayer) return;
    await supabase.from('presence').upsert({
      player_id: currentPlayer.id,
      last_heartbeat: new Date().toISOString(),
      status: 'online'
    });
    heartbeatInterval.current = setInterval(async () => {
      await supabase.from('presence').upsert({
        player_id: currentPlayer.id,
        last_heartbeat: new Date().toISOString(),
        status: gameState === 'playing' ? 'in_game' : 'online'
      });
    }, 15000);
  };

  const stopHeartbeat = async () => {
    if (heartbeatInterval.current) clearInterval(heartbeatInterval.current);
    if (currentPlayer) {
      await supabase.from('presence').update({ status: 'offline' }).eq('player_id', currentPlayer.id);
    }
  };

  const updateOnlineCount = async () => {
    const { data } = await supabase.from('online_count').select('count').single();
    if (data) setOnlinePlayers(data.count);
  };

  const loadLeaderboard = async () => {
    const { data } = await supabase.from('leaderboard_top').select('*').limit(10);
    if (data) setLeaderboard(data);
  };

  const handleLogin = async () => {
    if (!pseudoInput.trim()) {
      setError("Veuillez entrer un pseudo");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: existingPlayer } = await supabase
        .from('players')
        .select('*')
        .eq('pseudo', pseudoInput.trim())
        .single();

      let player: Player;

      if (existingPlayer) {
        await supabase.from('players').update({ last_played: new Date().toISOString() }).eq('id', existingPlayer.id);
        player = existingPlayer;
      } else {
        const { data: newPlayer, error } = await supabase
          .from('players')
          .insert([{ pseudo: pseudoInput.trim() }])
          .select()
          .single();
        if (error) throw error;
        player = newPlayer;
      }

      setCurrentPlayer(player);
      setGameState("home");
    } catch (err: any) {
      setError(err.message || "Erreur lors de la connexion");
    } finally {
      setLoading(false);
    }
  };

  const joinQueue = async () => {
    if (!currentPlayer) return;

    try {
      await supabase.from('queue').insert({
        player_id: currentPlayer.id,
        elo_score: Math.round((currentPlayer.score_giver + currentPlayer.score_guesser) / 2)
      });

      setGameState("queue");

      matchmakingInterval.current = setInterval(async () => {
        const { data: existingGame } = await supabase
          .from('games')
          .select('*')
          .or(`player1_id.eq.${currentPlayer.id},player2_id.eq.${currentPlayer.id}`)
          .eq('status', 'playing')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (existingGame) {
          if (matchmakingInterval.current) clearInterval(matchmakingInterval.current);
          const opponentId = existingGame.player1_id === currentPlayer.id ? existingGame.player2_id : existingGame.player1_id;
          const { data: opponent } = await supabase.from('players').select('pseudo').eq('id', opponentId).single();
          if (opponent) setOpponentPseudo(opponent.pseudo);
          await initGame(existingGame);
          return;
        }

        const { data } = await supabase.rpc('match_players');

        if (data && data.length > 0) {
          const match = data[0];
          if (match.player1_id === currentPlayer.id || match.player2_id === currentPlayer.id) {
            if (matchmakingInterval.current) clearInterval(matchmakingInterval.current);
            const opponentId = match.player1_id === currentPlayer.id ? match.player2_id : match.player1_id;
            const { data: opponent } = await supabase.from('players').select('pseudo').eq('id', opponentId).single();
            if (opponent) setOpponentPseudo(opponent.pseudo);
            const { data: game } = await supabase.from('games').select('*').eq('id', match.game_id).single();
            if (game) await initGame(game);
          }
        }
      }, 2000);

      setTimeout(() => {
        if (matchmakingInterval.current) clearInterval(matchmakingInterval.current);
        if (gameState === "queue") {
          leaveQueue();
          setError("Aucun adversaire trouvé");
          setGameState("home");
        }
      }, 60000);
    } catch (err: any) {
      setError(err.message);
      setGameState("home");
    }
  };

  const leaveQueue = async () => {
    if (!currentPlayer) return;
    await supabase.from('queue').delete().eq('player_id', currentPlayer.id);
  };

  const initGame = async (game: GameData) => {
    console.log('🎮 Init game:', game.id, 'Round:', game.current_round);

    cleanupChannels();

    setCurrentGame(game);
    lastKnownRound.current = game.current_round;
    updateLock.current = false;
    setAttempts([]);
    setCurrentClue("");
    setCurrentGuess("");
    setWaitingForOpponent(false);
    setIsTransitioning(false);
    setTimeLeft(60);

    await setupRealtimeChannels(game.id);

    setGameState("playing");
  };

  const setupRealtimeChannels = async (gameId: string) => {
    console.log('🔗 Setup channels for game:', gameId);

    gameChannel.current = supabase
      .channel(`game_${gameId}_${Date.now()}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'games',
        filter: `id=eq.${gameId}`
      }, (payload) => {
        console.log('📩 Game UPDATE:', payload.new);
        const newGame = payload.new as GameData;

        if (newGame.current_round !== lastKnownRound.current) {
          console.log('🔄 Round changed:', lastKnownRound.current, '→', newGame.current_round);
          lastKnownRound.current = newGame.current_round;
          updateLock.current = false;

          setAttempts([]);
          setCurrentClue("");
          setCurrentGuess("");
          setWaitingForOpponent(false);
          setIsTransitioning(false);
          setTimeLeft(60);
        }

        setCurrentGame(newGame);

        if (newGame.status === 'finished') {
          console.log('🏁 Game finished');
          handleGameEnd(newGame);
        }
      })
      .subscribe((status) => {
        console.log('📡 Game channel:', status);
      });

    roundsChannel.current = supabase
      .channel(`rounds_${gameId}_${Date.now()}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'rounds',
        filter: `game_id=eq.${gameId}`
      }, (payload) => {
        console.log('📩 Round INSERT:', payload.new);
        const round = payload.new;

        if (round.clues && round.giver_id !== currentPlayer?.id) {
          const lastClue = round.clues[round.clues.length - 1];
          console.log('💬 Received clue:', lastClue);
          setAttempts(prev => {
            if (prev.some(a => a.clue === lastClue)) return prev;
            return [...prev, { clue: lastClue, guess: '', correct: false }];
          });
          setWaitingForOpponent(false);
        }

        if (round.guess_word && round.guesser_id !== currentPlayer?.id) {
          console.log('🎯 Received guess:', round.guess_word, 'Won:', round.won);
          setAttempts(prev => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && !last.guess) {
              last.guess = round.guess_word;
              last.correct = round.won;
            }
            return updated;
          });

          if (round.won) {
            console.log('✅ Word found, transitioning...');
            setIsTransitioning(true);
            setTimeout(() => triggerNextRound(), 2000);
          } else {
            setWaitingForOpponent(false);
          }
        }
      })
      .subscribe((status) => {
        console.log('📡 Rounds channel:', status);
      });
  };

  const sendClue = async () => {
    if (!currentGame || !currentClue.trim() || attempts.length >= 4 || waitingForOpponent) return;

    const clueText = currentClue.trim().toUpperCase();
    if (currentGame.current_word.substring(0, 3) === clueText.substring(0, 3)) {
      alert("⚠️ L'indice ne peut pas commencer par les 3 mêmes lettres !");
      return;
    }

    console.log('📤 Send clue:', clueText);

    setAttempts(prev => [...prev, { clue: clueText, guess: '', correct: false }]);
    setCurrentClue("");
    setWaitingForOpponent(true);

    const allClues = [...attempts.map(a => a.clue), clueText];

    await supabase.from('rounds').insert({
      game_id: currentGame.id,
      round_number: currentGame.current_round,
      word: currentGame.current_word,
      giver_id: currentPlayer?.id,
      clues: allClues
    });
  };

  const submitGuess = async () => {
    if (!currentGame || !currentGuess.trim() || waitingForOpponent) return;

    const guessText = currentGuess.trim().toUpperCase();
    const isCorrect = guessText === currentGame.current_word;

    console.log('📤 Send guess:', guessText, 'Correct:', isCorrect);

    setAttempts(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last) {
        last.guess = guessText;
        last.correct = isCorrect;
      }
      return updated;
    });

    setCurrentGuess("");
    setWaitingForOpponent(true);

    await supabase.from('rounds').insert({
      game_id: currentGame.id,
      round_number: currentGame.current_round,
      word: currentGame.current_word,
      guesser_id: currentPlayer?.id,
      guess_word: guessText,
      won: isCorrect,
      time_taken: 60 - timeLeft
    });

    if (isCorrect) {
      const isP1 = currentGame.player1_id === currentPlayer?.id;
      await supabase.from('games').update({
        [isP1 ? 'player1_score' : 'player2_score']: isP1 ? currentGame.player1_score + 1 : currentGame.player2_score + 1
      }).eq('id', currentGame.id);

      console.log('✅ I found it, transitioning...');
      setIsTransitioning(true);
      setTimeout(() => triggerNextRound(), 2000);
    } else if (attempts.length >= 4) {
      console.log('❌ Max attempts, next round');
      setIsTransitioning(true);
      setTimeout(() => triggerNextRound(), 2000);
    } else {
      setWaitingForOpponent(false);
    }
  };

  const handleTimeOut = () => {
    console.log('⏱️ Timeout');
    setIsTransitioning(true);
    triggerNextRound();
  };

  const triggerNextRound = async () => {
    if (!currentGame || updateLock.current) {
      console.log('⚠️ Update locked or no game');
      return;
    }

    if (currentGame.current_round >= 4) {
      console.log('🏁 End game');
      await supabase.from('games').update({ status: 'finished' }).eq('id', currentGame.id);
      return;
    }

    const isP1 = currentGame.player1_id === currentPlayer?.id;

    if (isP1) {
      updateLock.current = true;
      console.log('👑 Player1 updating DB');

      const nextRound = currentGame.current_round + 1;
      const { data: word } = await supabase.rpc('get_random_word');
      const newGiver = currentGame.current_giver_id === currentGame.player1_id ? currentGame.player2_id : currentGame.player1_id;

      await supabase.from('games').update({
        current_round: nextRound,
        current_word: word || 'ELEPHANT',
        current_giver_id: newGiver,
        time_left: 60,
        attempts_used: 0,
        round_start_time: new Date().toISOString()
      }).eq('id', currentGame.id);

      console.log('✅ DB updated to round', nextRound);
    } else {
      console.log('👤 Player2 waiting for update');
    }
  };

  const handleGameEnd = async (game: GameData) => {
    cleanupChannels();

    const isP1 = game.player1_id === currentPlayer?.id;
    const won = isP1 ? game.player1_score > game.player2_score : game.player2_score > game.player1_score;

    if (currentPlayer) {
      await supabase.from('players').update({
        total_games: currentPlayer.total_games + 1,
        games_won: currentPlayer.games_won + (won ? 1 : 0),
        score_giver: currentPlayer.score_giver + (won ? 10 : -5),
        score_guesser: currentPlayer.score_guesser + (won ? 10 : -5)
      }).eq('id', currentPlayer.id);
    }

    await loadLeaderboard();
    setGameState("results");
  };

  const getRankBadge = (rank: number) => {
    if (rank === 1) return <Crown className="w-4 h-4 text-yellow-500" />;
    if (rank === 2) return <Star className="w-4 h-4 text-gray-400" />;
    if (rank === 3) return <Star className="w-4 h-4 text-amber-600" />;
    return null;
  };

  if (!mounted) return null;

  // ============= LOGIN =============
  if (gameState === "login") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-indigo-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-2 border-rose-100 shadow-2xl">
          <CardHeader className="text-center pb-8">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="p-3 bg-gradient-to-br from-rose-500 to-indigo-600 rounded-2xl shadow-lg">
                <Swords className="w-10 h-10 text-white" />
              </div>
            </div>
            <CardTitle className="text-4xl font-black bg-gradient-to-r from-rose-600 to-indigo-600 bg-clip-text text-transparent">
              DicoClash
            </CardTitle>
            <p className="text-gray-600 mt-2">Défiez des joueurs en temps réel</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Votre pseudo</label>
              <input
                type="text"
                value={pseudoInput}
                onChange={(e) => setPseudoInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="Choisissez un pseudo..."
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500 focus:border-rose-500"
                maxLength={20}
                disabled={loading}
              />
              {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
            </div>
            <Button
              onClick={handleLogin}
              disabled={loading || !pseudoInput.trim()}
              className="w-full bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 text-lg py-6 rounded-xl shadow-lg"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 w-5 h-5 animate-spin" />
                  Connexion...
                </>
              ) : (
                <>
                  <LogIn className="mr-2 w-5 h-5" />
                  Entrer dans l'arène
                </>
              )}
            </Button>
            <p className="text-center text-sm text-gray-500">
              <Wifi className="inline w-4 h-4 mr-1 text-green-500" />
              {onlinePlayers} joueurs en ligne
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============= HOME =============
  if (gameState === "home") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-indigo-50 p-4">
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="text-center py-6">
            <div className="inline-flex items-center gap-3 mb-4">
              <div className="p-2 bg-gradient-to-br from-rose-500 to-indigo-600 rounded-xl">
                <Swords className="w-8 h-8 text-white" />
              </div>
              <h1 className="text-4xl font-black bg-gradient-to-r from-rose-600 to-indigo-600 bg-clip-text text-transparent">
                DicoClash
              </h1>
            </div>
            <Badge variant="outline" className="text-base px-4 py-1">
              <User className="w-4 h-4 mr-2" />
              {currentPlayer?.pseudo}
            </Badge>
          </div>

          <Card className="border-2 border-rose-100 shadow-xl">
            <CardContent className="p-8 text-center space-y-6">
              <div>
                <h2 className="text-3xl font-bold mb-3 bg-gradient-to-r from-rose-600 to-indigo-600 bg-clip-text text-transparent">
                  Prêt pour le clash ?
                </h2>
                <p className="text-gray-600">Affrontez un adversaire en temps réel</p>
              </div>
              <Button
                onClick={joinQueue}
                className="text-xl px-12 py-7 h-auto bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-700 hover:to-rose-800 rounded-xl shadow-lg"
              >
                <Zap className="mr-2 w-6 h-6" />
                Trouver un adversaire
              </Button>
              <p className="text-sm text-gray-500">
                <Wifi className="inline w-4 h-4 mr-1 text-green-500" />
                {onlinePlayers} joueurs en ligne
              </p>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            <Card className="border-2 border-indigo-100">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-yellow-600" />
                  Vos statistiques
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Parties jouées</span>
                  <span className="font-bold text-lg">{currentPlayer?.total_games || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Victoires</span>
                  <span className="font-bold text-lg text-green-600">{currentPlayer?.games_won || 0}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Score Donneur</span>
                  <Badge variant="secondary" className="text-base">{currentPlayer?.score_giver || 1500}</Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Score Devineur</span>
                  <Badge variant="secondary" className="text-base">{currentPlayer?.score_guesser || 1500}</Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="border-2 border-rose-100">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-rose-600" />
                  Comment jouer
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>🎯 Matchs en 1 vs 1 temps réel</p>
                <p>🔄 Ping-pong : 4 tentatives max</p>
                <p>⏱️ 60 secondes par round</p>
                <p>🏆 4 rounds pour gagner</p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-2 border-yellow-100">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Crown className="w-5 h-5 text-yellow-600" />
                Top 10 Champions
              </CardTitle>
            </CardHeader>
            <CardContent>
              {leaderboard.length === 0 ? (
                <p className="text-center text-gray-500 py-4">Chargement...</p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.map((p) => (
                    <div key={p.id} className={`flex justify-between items-center p-3 rounded-lg border ${
                      p.id === currentPlayer?.id ? 'bg-rose-50 border-rose-200' : 'bg-gray-50 border-gray-100'
                    }`}>
                      <div className="flex items-center gap-3">
                        {getRankBadge(p.rank)}
                        <span className="font-bold">#{p.rank}</span>
                        <span>{p.pseudo}</span>
                        {p.id === currentPlayer?.id && <Badge variant="outline" className="text-xs">Vous</Badge>}
                      </div>
                      <div className="flex gap-4 text-sm">
                        <div><span className="text-gray-500">Score:</span> <b>{Math.round(p.score_average)}</b></div>
                        <div><span className="text-gray-500">Wins:</span> <b className="text-green-600">{p.games_won}</b></div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="text-center">
            <Button variant="outline" onClick={() => {
              stopHeartbeat();
              setCurrentPlayer(null);
              setGameState("login");
            }}>
              Changer de pseudo
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ============= QUEUE =============
  if (gameState === "queue") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-indigo-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-2 border-rose-100 shadow-xl">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-20 h-20 bg-rose-100 rounded-full flex items-center justify-center mx-auto">
              <Users className="w-10 h-10 text-rose-600 animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-bold mb-2">Recherche d'adversaire...</h2>
              <p className="text-gray-600">Connexion en cours</p>
            </div>
            <div className="space-y-2">
              <Progress value={(queueTime % 3) * 33} className="h-2" />
              <p className="text-sm text-gray-500">{queueTime}s écoulées</p>
            </div>
            <Button variant="outline" onClick={() => {
              leaveQueue();
              if (matchmakingInterval.current) clearInterval(matchmakingInterval.current);
              setGameState("home");
            }}>
              Annuler
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============= RESULTS =============
  if (gameState === "results") {
    if (!currentGame) return null;
    const isP1 = currentGame.player1_id === currentPlayer?.id;
    const pScore = isP1 ? currentGame.player1_score : currentGame.player2_score;
    const oScore = isP1 ? currentGame.player2_score : currentGame.player1_score;
    const won = pScore > oScore;

    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-indigo-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl border-2 border-rose-100 shadow-xl">
          <CardContent className="p-8 space-y-6">
            <div className="text-center">
              {won ? (
                <div className="w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trophy className="w-12 h-12 text-yellow-600" />
                </div>
              ) : (
                <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Star className="w-12 h-12 text-gray-400" />
                </div>
              )}
              <h2 className="text-4xl font-bold mb-2">
                {pScore === oScore ? "Match nul !" : won ? "Victoire !" : "Défaite"}
              </h2>
              <p className="text-gray-600">Partie terminée</p>
            </div>

            <div className="flex justify-center gap-16 py-8">
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-2">{currentPlayer?.pseudo}</p>
                <p className="text-6xl font-bold text-indigo-600">{pScore}</p>
              </div>
              <div className="text-6xl text-gray-300 self-center">-</div>
              <div className="text-center">
                <p className="text-sm text-gray-600 mb-2">{opponentPseudo}</p>
                <p className="text-6xl font-bold text-rose-600">{oScore}</p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button onClick={() => {
                setCurrentGame(null);
                setGameState("home");
              }} className="flex-1 bg-gradient-to-r from-rose-600 to-rose-700">
                <Zap className="mr-2" /> Nouveau Match
              </Button>
              <Button onClick={() => {
                setCurrentGame(null);
                setGameState("home");
              }} variant="outline" className="flex-1">
                Accueil
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============= PLAYING =============
  if (gameState === "playing" && currentGame) {
    const isGiver = currentGame.current_giver_id === currentPlayer?.id;
    const isP1 = currentGame.player1_id === currentPlayer?.id;
    const pScore = isP1 ? currentGame.player1_score : currentGame.player2_score;
    const oScore = isP1 ? currentGame.player2_score : currentGame.player1_score;
    const attemptsLeft = 4 - attempts.length;

    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-indigo-50 p-4">
        <div className="max-w-5xl mx-auto space-y-4">
          {/* Header */}
          <Card className="border-2 border-rose-100 shadow-lg">
            <CardContent className="p-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold">Round {currentGame.current_round}/4</h2>
                  <Badge variant={isGiver ? "default" : "secondary"} className={isGiver ? "bg-rose-600 mt-1" : "mt-1"}>
                    {isGiver ? "🎯 Donneur" : "🔍 Devineur"}
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="text-sm text-gray-600">vs {opponentPseudo}</p>
                  <p className="text-2xl font-bold">
                    <span className="text-indigo-600">{pScore}</span>
                    <span className="text-gray-400 mx-2">-</span>
                    <span className="text-rose-600">{oScore}</span>
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-4">
            <Card className="border-2 border-rose-100">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-gray-600" />
                    <span className="font-semibold">Temps</span>
                  </div>
                  <span className={`text-3xl font-bold ${timeLeft > 30 ? 'text-green-600' : timeLeft > 10 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {timeLeft}s
                  </span>
                </div>
                <Progress value={(timeLeft / 60) * 100} className="h-3" />
              </CardContent>
            </Card>

            <Card className="border-2 border-indigo-100">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Target className="w-5 h-5 text-gray-600" />
                    <span className="font-semibold">Tentatives</span>
                  </div>
                  <span className={`text-3xl font-bold ${attemptsLeft > 2 ? 'text-green-600' : attemptsLeft > 1 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {attemptsLeft}/4
                  </span>
                </div>
                <Progress value={(attempts.length / 4) * 100} className="h-3" />
              </CardContent>
            </Card>
          </div>

          {/* Word (if giver) */}
          {isGiver && (
            <Card className="border-2 border-rose-100 shadow-lg">
              <CardHeader>
                <CardTitle className="text-center">Votre mot à faire deviner</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-12">
                  <div className="inline-block bg-gradient-to-r from-rose-600 to-indigo-600 text-white px-12 py-6 rounded-2xl text-5xl font-black tracking-wider shadow-2xl">
                    {currentGame.current_word}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* History */}
          <Card className="border-2 border-gray-100 shadow-lg">
            <CardHeader>
              <CardTitle>Historique des échanges</CardTitle>
              <CardDescription>
                {isTransitioning ? "Passage au round suivant..." : `${attemptsLeft} tentative(s) restante(s)`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {attempts.length === 0 && !isTransitioning && (
                <div className="text-center py-8 text-gray-500">
                  {isGiver ? "Donnez le premier indice" : `En attente de ${opponentPseudo}...`}
                </div>
              )}

              {attempts.map((att, i) => (
                <div key={i} className="border-2 border-gray-200 rounded-xl p-4 bg-gradient-to-r from-gray-50 to-white">
                  <div className="flex items-start gap-3 mb-2">
                    <Badge className={isGiver ? "bg-indigo-600" : "bg-rose-600"}>#{i + 1}</Badge>
                    <div className="flex-1">
                      <p className="text-sm text-gray-600">{isGiver ? "Votre indice :" : `Indice de ${opponentPseudo} :`}</p>
                      <p className="font-bold text-lg">{att.clue}</p>
                    </div>
                  </div>
                  {att.guess && (
                    <div className="flex items-center gap-3 mt-3 pt-3 border-t">
                      <Badge variant={att.correct ? "default" : "destructive"} className={att.correct ? "bg-green-600" : ""}>
                        {att.correct ? "✓ Trouvé !" : "✗ Faux"}
                      </Badge>
                      <p className="text-sm">Réponse : <span className="font-bold">{att.guess}</span></p>
                    </div>
                  )}
                  {!att.guess && <p className="text-sm text-gray-500 italic mt-2 pt-2 border-t">En attente de la réponse...</p>}
                </div>
              ))}

              {/* Transition message */}
              {isTransitioning && (
                <div className="text-center py-8">
                  <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-rose-600" />
                  <p className="text-lg font-semibold text-gray-700">Passage au round suivant...</p>
                </div>
              )}

              {/* Input clue (giver) */}
              {!isTransitioning && isGiver && attemptsLeft > 0 && !waitingForOpponent && (
                (attempts.length === 0 || (attempts[attempts.length - 1].guess && !attempts[attempts.length - 1].correct)) && (
                  <Card className="border-2 border-rose-100 bg-rose-50">
                    <CardContent className="p-4">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={currentClue}
                          onChange={(e) => setCurrentClue(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && sendClue()}
                          placeholder="Donnez un indice..."
                          className="flex-1 px-4 py-3 border-2 border-rose-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
                          maxLength={50}
                          autoFocus
                        />
                        <Button onClick={sendClue} disabled={!currentClue.trim()} className="bg-gradient-to-r from-rose-600 to-rose-700 px-6">
                          <Send className="w-5 h-5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              )}

              {/* Input guess (guesser) */}
              {!isTransitioning && !isGiver && attempts.length > 0 && !attempts[attempts.length - 1].guess && !waitingForOpponent && (
                <Card className="border-2 border-indigo-100 bg-indigo-50">
                  <CardHeader>
                    <CardTitle className="text-xl">À vous de deviner !</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <input
                      type="text"
                      value={currentGuess}
                      onChange={(e) => setCurrentGuess(e.target.value.toUpperCase())}
                      onKeyPress={(e) => e.key === 'Enter' && submitGuess()}
                      placeholder="VOTRE RÉPONSE..."
                      className="w-full px-4 py-4 border-2 border-indigo-300 rounded-xl text-center font-black text-2xl uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      maxLength={30}
                      autoFocus
                    />
                    <Button onClick={submitGuess} disabled={!currentGuess.trim()} className="w-full bg-gradient-to-r from-indigo-600 to-indigo-700 py-4 text-lg">
                      <Send className="w-5 h-5 mr-2" />
                      Valider ma réponse
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Waiting */}
              {waitingForOpponent && !isTransitioning && (
                <div className="text-center py-6">
                  <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-gray-400" />
                  <p className="text-gray-600">En attente de {opponentPseudo}...</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return null;
};

export default DicoClash;