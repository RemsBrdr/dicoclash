"use client"

import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Trophy, Clock, User, Zap, Crown, Star, Send, Swords, LogIn, Users, Wifi, Target, Brain, Sparkles, Timer, MessageSquare, AlertCircle } from "lucide-react";
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
  const [showTransition, setShowTransition] = useState(false);

  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null);
  const gameSubscription = useRef<any>(null);
  const roundsSubscription = useRef<any>(null);
  const matchmakingInterval = useRef<NodeJS.Timeout | null>(null);
  const lastProcessedRound = useRef(0);
  const isProcessingNextRound = useRef(false);

  useEffect(() => {
    setMounted(true);
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
      const interval = setInterval(() => {
        setQueueTime(prev => prev + 1);
      }, 1000);
      return () => clearInterval(interval);
    } else {
      setQueueTime(0);
    }
  }, [gameState]);

  useEffect(() => {
    if (gameState === "playing" && timeLeft > 0 && !showTransition) {
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
  }, [gameState, timeLeft, showTransition]);

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
    if (heartbeatInterval.current) {
      clearInterval(heartbeatInterval.current);
    }
    if (currentPlayer) {
      await supabase.from('presence').update({
        status: 'offline'
      }).eq('player_id', currentPlayer.id);
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
        await supabase
          .from('players')
          .update({ last_played: new Date().toISOString() })
          .eq('id', existingPlayer.id);
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
          if (matchmakingInterval.current) {
            clearInterval(matchmakingInterval.current);
          }

          const opponentId = existingGame.player1_id === currentPlayer.id
            ? existingGame.player2_id
            : existingGame.player1_id;

          const { data: opponent } = await supabase
            .from('players')
            .select('pseudo')
            .eq('id', opponentId)
            .single();

          if (opponent) setOpponentPseudo(opponent.pseudo);

          initializeGame(existingGame);
          return;
        }

        const { data } = await supabase.rpc('match_players');

        if (data && data.length > 0) {
          const match = data[0];

          if (match.player1_id === currentPlayer.id || match.player2_id === currentPlayer.id) {
            if (matchmakingInterval.current) {
              clearInterval(matchmakingInterval.current);
            }

            const opponentId = match.player1_id === currentPlayer.id ? match.player2_id : match.player1_id;
            const { data: opponent } = await supabase
              .from('players')
              .select('pseudo')
              .eq('id', opponentId)
              .single();

            if (opponent) setOpponentPseudo(opponent.pseudo);

            const { data: game } = await supabase
              .from('games')
              .select('*')
              .eq('id', match.game_id)
              .single();

            if (game) {
              initializeGame(game);
            }
          }
        }
      }, 2000);

      setTimeout(() => {
        if (matchmakingInterval.current) {
          clearInterval(matchmakingInterval.current);
        }
        if (gameState === "queue") {
          leaveQueue();
          setError("Aucun adversaire trouvé. Réessayez.");
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

  const initializeGame = (game: GameData) => {
    console.log('🎮 Initialisation jeu:', game.id, 'Round:', game.current_round);

    setCurrentGame(game);
    setTimeLeft(60);
    setAttempts([]);
    setWaitingForOpponent(false);
    setShowTransition(false);
    lastProcessedRound.current = game.current_round;
    isProcessingNextRound.current = false;

    subscribeToGame(game.id);
    setGameState("playing");
  };

  const subscribeToGame = (gameId: string) => {
    console.log('🔗 Subscribe game:', gameId);

    // Subscription aux changements du jeu
    gameSubscription.current = supabase
      .channel(`game:${gameId}:${Date.now()}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'games',
        filter: `id=eq.${gameId}`
      }, (payload: any) => {
        console.log('📩 Game UPDATE:', payload.new);

        if (payload.new) {
          const gameData = payload.new as GameData;

          // Détection changement de round
          if (gameData.current_round !== lastProcessedRound.current) {
            console.log('🔄 Round change:', lastProcessedRound.current, '→', gameData.current_round);

            lastProcessedRound.current = gameData.current_round;
            isProcessingNextRound.current = false;

            // Reset UI immédiat
            setAttempts([]);
            setCurrentClue("");
            setCurrentGuess("");
            setWaitingForOpponent(false);
            setTimeLeft(60);
            setShowTransition(false);

            console.log('✅ UI reset pour round', gameData.current_round);
          }

          setCurrentGame(gameData);

          // Fin de partie
          if (gameData.status === 'finished') {
            console.log('🏁 Partie finie');
            handleGameEnd(gameData);
          }
        }
      })
      .subscribe((status) => {
        console.log('📡 Game subscription:', status);
      });

    // Subscription aux rounds (indices/réponses)
    roundsSubscription.current = supabase
      .channel(`rounds:${gameId}:${Date.now()}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'rounds',
        filter: `game_id=eq.${gameId}`
      }, (payload: any) => {
        console.log('📩 Round INSERT:', payload.new);

        if (payload.new) {
          const newRound = payload.new;

          // Indice reçu
          if (newRound.clues && newRound.clues.length > 0 && newRound.giver_id !== currentPlayer?.id) {
            const lastClue = newRound.clues[newRound.clues.length - 1];
            console.log('💬 Indice reçu:', lastClue);

            setAttempts(prev => {
              if (prev.some(a => a.clue === lastClue)) return prev;
              return [...prev, { clue: lastClue, guess: '', correct: false }];
            });

            setWaitingForOpponent(false);
          }

          // Réponse reçue
          if (newRound.guess_word && newRound.guesser_id !== currentPlayer?.id) {
            console.log('🎯 Réponse reçue:', newRound.guess_word, 'Correct:', newRound.won);

            setAttempts(prev => {
              const updated = [...prev];
              const lastAttempt = updated[updated.length - 1];
              if (lastAttempt && !lastAttempt.guess) {
                lastAttempt.guess = newRound.guess_word;
                lastAttempt.correct = newRound.won || false;
              }
              return updated;
            });

            if (newRound.won) {
              console.log('✅ Mot trouvé, next round dans 2s');
              setShowTransition(true);
              setTimeout(() => triggerNextRound(), 2000);
            } else {
              setWaitingForOpponent(false);
            }
          }
        }
      })
      .subscribe((status) => {
        console.log('📡 Rounds subscription:', status);
      });
  };

  const unsubscribeFromGame = () => {
    if (gameSubscription.current) {
      supabase.removeChannel(gameSubscription.current);
    }
    if (roundsSubscription.current) {
      supabase.removeChannel(roundsSubscription.current);
    }
  };

  const sendClue = async () => {
    if (!currentGame || !currentClue.trim() || attempts.length >= 4 || waitingForOpponent) return;

    const clueUpper = currentClue.trim().toUpperCase();

    if (currentGame.current_word.substring(0, 3) === clueUpper.substring(0, 3)) {
      alert("⚠️ L'indice ne peut pas commencer par les 3 mêmes lettres que le mot !");
      return;
    }

    console.log('📤 Envoi indice:', currentClue.trim());

    // Optimistic update
    setAttempts(prev => [...prev, { clue: currentClue.trim(), guess: '', correct: false }]);
    setCurrentClue("");
    setWaitingForOpponent(true);

    const allClues = [...attempts.map(a => a.clue), currentClue.trim()];

    await supabase.from('rounds').insert({
      game_id: currentGame.id,
      round_number: currentGame.current_round,
      word: currentGame.current_word,
      giver_id: currentPlayer?.id,
      clues: allClues
    });

    await supabase.from('games').update({
      attempts_used: allClues.length
    }).eq('id', currentGame.id);
  };

  const submitGuess = async () => {
    if (!currentGame || !currentGuess.trim() || waitingForOpponent) return;

    const guessUpper = currentGuess.trim().toUpperCase();
    const isCorrect = guessUpper === currentGame.current_word;

    console.log('📤 Envoi réponse:', guessUpper, 'Correct:', isCorrect);

    // Optimistic update
    setAttempts(prev => {
      const updated = [...prev];
      const lastAttempt = updated[updated.length - 1];
      if (lastAttempt) {
        lastAttempt.guess = guessUpper;
        lastAttempt.correct = isCorrect;
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
      guess_word: guessUpper,
      won: isCorrect,
      time_taken: 60 - timeLeft
    });

    if (isCorrect) {
      const isPlayer1 = currentGame.player1_id === currentPlayer?.id;
      await supabase.from('games').update({
        [isPlayer1 ? 'player1_score' : 'player2_score']:
          isPlayer1 ? currentGame.player1_score + 1 : currentGame.player2_score + 1
      }).eq('id', currentGame.id);

      console.log('✅ Mot trouvé par moi, next round dans 2s');
      setShowTransition(true);
      setTimeout(() => triggerNextRound(), 2000);
    } else if (attempts.length >= 4) {
      console.log('❌ 4 tentatives, next round dans 2s');
      setShowTransition(true);
      setTimeout(() => triggerNextRound(), 2000);
    } else {
      setWaitingForOpponent(false);
    }
  };

  const handleTimeOut = () => {
    console.log('⏱️ Timeout');
    setShowTransition(true);
    triggerNextRound();
  };

  const triggerNextRound = async () => {
    if (!currentGame || isProcessingNextRound.current) {
      console.log('⚠️ Already processing ou pas de game');
      return;
    }

    isProcessingNextRound.current = true;
    console.log('🔄 Trigger next round, current:', currentGame.current_round);

    // Fin de partie ?
    if (currentGame.current_round >= 4) {
      console.log('🏁 Partie terminée');
      await supabase.from('games').update({
        status: 'finished'
      }).eq('id', currentGame.id);
      return;
    }

    // Seulement Player1 update la BDD
    const isPlayer1 = currentGame.player1_id === currentPlayer?.id;

    if (isPlayer1) {
      console.log('👑 Player1 update BDD');

      const nextRound = currentGame.current_round + 1;
      const { data: word } = await supabase.rpc('get_random_word');
      const newGiverId = currentGame.current_giver_id === currentGame.player1_id
        ? currentGame.player2_id
        : currentGame.player1_id;

      console.log('📝 UPDATE: round', nextRound, 'mot:', word);

      await supabase.from('games').update({
        current_round: nextRound,
        current_word: word || 'ELEPHANT',
        current_giver_id: newGiverId,
        time_left: 60,
        attempts_used: 0,
        round_start_time: new Date().toISOString()
      }).eq('id', currentGame.id);

      console.log('✅ BDD updated');
    } else {
      console.log('👤 Player2 attend subscription');
    }
  };

  const handleGameEnd = async (game: GameData) => {
    unsubscribeFromGame();

    const isPlayer1 = game.player1_id === currentPlayer?.id;
    const playerWon = isPlayer1
      ? game.player1_score > game.player2_score
      : game.player2_score > game.player1_score;

    if (currentPlayer) {
      await supabase.from('players').update({
        total_games: currentPlayer.total_games + 1,
        games_won: currentPlayer.games_won + (playerWon ? 1 : 0),
        score_giver: currentPlayer.score_giver + (playerWon ? 10 : -5),
        score_guesser: currentPlayer.score_guesser + (playerWon ? 10 : -5)
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

  // [UI COMPONENTS - Je garde juste le strict nécessaire pour tester]

  if (gameState === "login") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6">
            <h1 className="text-3xl font-bold text-center mb-6">DicoClash</h1>
            <div className="space-y-4">
              <input
                type="text"
                value={pseudoInput}
                onChange={(e) => setPseudoInput(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="Votre pseudo..."
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg"
                maxLength={20}
                disabled={loading}
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button
                onClick={handleLogin}
                disabled={loading || !pseudoInput.trim()}
                className="w-full"
              >
                {loading ? "Connexion..." : "Jouer"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState === "home") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50 p-4">
        <div className="max-w-2xl mx-auto space-y-4">
          <Card>
            <CardContent className="p-6 text-center">
              <h2 className="text-2xl font-bold mb-4">Bienvenue {currentPlayer?.pseudo}</h2>
              <Button onClick={joinQueue} size="lg">
                Trouver un adversaire
              </Button>
              <p className="mt-4 text-sm text-gray-600">{onlinePlayers} joueurs en ligne</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Statistiques</CardTitle></CardHeader>
            <CardContent>
              <p>Parties: {currentPlayer?.total_games || 0}</p>
              <p>Victoires: {currentPlayer?.games_won || 0}</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (gameState === "queue") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50 flex items-center justify-center p-4">
        <Card>
          <CardContent className="p-8 text-center">
            <h2 className="text-2xl font-bold mb-4">Recherche d'adversaire...</h2>
            <p>{queueTime}s</p>
            <Button variant="outline" onClick={() => {
              leaveQueue();
              if (matchmakingInterval.current) clearInterval(matchmakingInterval.current);
              setGameState("home");
            }} className="mt-4">
              Annuler
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState === "results") {
    if (!currentGame) return null;

    const isPlayer1 = currentGame.player1_id === currentPlayer?.id;
    const playerScore = isPlayer1 ? currentGame.player1_score : currentGame.player2_score;
    const opponentScore = isPlayer1 ? currentGame.player2_score : currentGame.player1_score;
    const isWinner = playerScore > opponentScore;

    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center space-y-6">
            <h2 className="text-3xl font-bold">
              {playerScore === opponentScore ? "Match nul !" : isWinner ? "Victoire !" : "Défaite"}
            </h2>
            <div className="flex justify-center gap-8">
              <div>
                <p className="text-sm">{currentPlayer?.pseudo}</p>
                <p className="text-4xl font-bold">{playerScore}</p>
              </div>
              <div className="text-3xl">-</div>
              <div>
                <p className="text-sm">{opponentPseudo}</p>
                <p className="text-4xl font-bold">{opponentScore}</p>
              </div>
            </div>
            <Button onClick={() => {
              setCurrentGame(null);
              setGameState("home");
            }}>
              Nouvelle partie
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState === "playing" && currentGame) {
    const isGiver = currentGame.current_giver_id === currentPlayer?.id;
    const isPlayer1 = currentGame.player1_id === currentPlayer?.id;
    const playerScore = isPlayer1 ? currentGame.player1_score : currentGame.player2_score;
    const opponentScore = isPlayer1 ? currentGame.player2_score : currentGame.player1_score;
    const attemptsLeft = 4 - attempts.length;

    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50 p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {/* Header */}
          <Card>
            <CardContent className="p-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-bold">Round {currentGame.current_round}/4</h2>
                  <Badge>{isGiver ? "Donneur" : "Devineur"}</Badge>
                </div>
                <div className="text-right">
                  <p className="text-sm">vs {opponentPseudo}</p>
                  <p className="text-xl font-bold">{playerScore} - {opponentScore}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Temps et tentatives */}
          <div className="grid grid-cols-2 gap-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-sm mb-2">Temps</p>
                <p className="text-2xl font-bold">{timeLeft}s</p>
                <Progress value={(timeLeft / 60) * 100} className="mt-2" />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-sm mb-2">Tentatives</p>
                <p className="text-2xl font-bold">{attemptsLeft}/4</p>
                <Progress value={(attempts.length / 4) * 100} className="mt-2" />
              </CardContent>
            </Card>
          </div>

          {/* Mot à faire deviner (si donneur) */}
          {isGiver && (
            <Card>
              <CardHeader><CardTitle>Votre mot</CardTitle></CardHeader>
              <CardContent>
                <div className="text-center py-8">
                  <div className="inline-block bg-red-600 text-white px-8 py-4 rounded-xl text-4xl font-bold">
                    {currentGame.current_word}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Historique */}
          <Card>
            <CardHeader><CardTitle>Historique</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {attempts.length === 0 && (
                <p className="text-gray-500 text-center py-4">
                  {isGiver ? "Donnez le premier indice" : `En attente de ${opponentPseudo}...`}
                </p>
              )}

              {attempts.map((attempt, index) => (
                <div key={index} className="border-2 rounded-lg p-3">
                  <div className="flex gap-2 mb-2">
                    <Badge>#{index + 1}</Badge>
                    <p className="font-semibold">{attempt.clue}</p>
                  </div>
                  {attempt.guess && (
                    <div className="pl-8">
                      <Badge variant={attempt.correct ? "default" : "destructive"}>
                        {attempt.correct ? "✓" : "✗"} {attempt.guess}
                      </Badge>
                    </div>
                  )}
                  {!attempt.guess && (
                    <p className="text-sm text-gray-500 pl-8">En attente...</p>
                  )}
                </div>
              ))}

              {/* Input zone */}
              {showTransition && (
                <div className="text-center py-4">
                  <AlertCircle className="w-6 h-6 mx-auto mb-2 animate-pulse" />
                  <p className="text-gray-600">Passage au round suivant...</p>
                </div>
              )}

              {!showTransition && isGiver && attemptsLeft > 0 && (
                (attempts.length === 0 || (attempts[attempts.length - 1].guess && !attempts[attempts.length - 1].correct)) && !waitingForOpponent && (
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={currentClue}
                      onChange={(e) => setCurrentClue(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && sendClue()}
                      placeholder="Votre indice..."
                      className="flex-1 px-4 py-2 border-2 rounded-lg"
                      maxLength={50}
                    />
                    <Button onClick={sendClue} disabled={!currentClue.trim()}>
                      <Send className="w-4 h-4" />
                    </Button>
                  </div>
                )
              )}

              {!showTransition && !isGiver && attempts.length > 0 && !attempts[attempts.length - 1].guess && !waitingForOpponent && (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={currentGuess}
                    onChange={(e) => setCurrentGuess(e.target.value.toUpperCase())}
                    onKeyPress={(e) => e.key === 'Enter' && submitGuess()}
                    placeholder="VOTRE RÉPONSE..."
                    className="w-full px-4 py-3 border-2 rounded-lg text-center font-bold text-lg uppercase"
                    maxLength={30}
                    autoFocus
                  />
                  <Button onClick={submitGuess} disabled={!currentGuess.trim()} className="w-full">
                    Valider
                  </Button>
                </div>
              )}

              {waitingForOpponent && !showTransition && (
                <p className="text-center text-gray-500 py-4">
                  En attente de {opponentPseudo}...
                </p>
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