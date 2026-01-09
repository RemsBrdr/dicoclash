"use client"

import React, { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Trophy, Clock, User, Zap, Crown, Star, Send, Swords, LogIn, Users, Wifi, Target, Brain, Sparkles, Timer, MessageSquare, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

type GameState = "login" | "home" | "queue" | "playing" | "waiting" | "results";

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

  const heartbeatInterval = useRef<NodeJS.Timeout | null>(null);
  const gameSubscription = useRef<any>(null);
  const roundsSubscription = useRef<any>(null);
  const matchmakingInterval = useRef<NodeJS.Timeout | null>(null);

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
    if (gameState === "playing" && timeLeft > 0) {
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
  }, [gameState, timeLeft]);

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

          setCurrentGame(existingGame);
          setTimeLeft(60);
          setAttempts([]);
          setWaitingForOpponent(false);
          subscribeToGame(existingGame.id);
          setGameState("playing");
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
              setCurrentGame(game);
              setTimeLeft(60);
              setAttempts([]);
              setWaitingForOpponent(false);
              subscribeToGame(match.game_id);
              setGameState("playing");
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

  const subscribeToGame = (gameId: string) => {
    console.log('🔗 Abonnement au jeu:', gameId);

    gameSubscription.current = supabase
      .channel(`game:${gameId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'games',
        filter: `id=eq.${gameId}`
      }, (payload: any) => {
        console.log('🎮 Mise à jour du jeu:', payload);
        if (payload.new) {
          const gameData = payload.new as GameData;

          // Si le round a changé, reset les tentatives localement
          if (currentGame && gameData.current_round !== currentGame.current_round) {
            console.log('🔄 Nouveau round détecté, reset des tentatives');
            setAttempts([]);
            setCurrentClue("");
            setCurrentGuess("");
            setWaitingForOpponent(false);
            setTimeLeft(60);
          }

          setCurrentGame(gameData);

          if (gameData.status === 'finished') {
            handleGameEnd(gameData);
          }
        }
      })
      .subscribe();

    roundsSubscription.current = supabase
      .channel(`rounds:${gameId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'rounds',
        filter: `game_id=eq.${gameId}`
      }, async (payload: any) => {
        console.log('📥 Nouveau round reçu:', payload);

        if (payload.new) {
          const newRound = payload.new;
          console.log('🔍 Données du round:', newRound);

          // Si c'est un indice (clues existe)
          if (newRound.clues && newRound.clues.length > 0 && newRound.giver_id) {
            console.log('📝 Indices reçus:', newRound.clues);

            // Ne mettre à jour que si c'est l'adversaire qui a donné l'indice
            if (newRound.giver_id !== currentPlayer?.id) {
              const lastClue = newRound.clues[newRound.clues.length - 1];

              setAttempts(prev => {
                // Vérifier si on a déjà cet indice
                const exists = prev.some(a => a.clue === lastClue);
                if (exists) {
                  console.log('⚠️ Indice déjà présent');
                  return prev;
                }
                console.log('➕ Ajout du nouvel indice:', lastClue);
                return [...prev, { clue: lastClue, guess: '', correct: false }];
              });

              setWaitingForOpponent(false);
            }
          }

          // Si c'est une réponse (guess_word existe)
          if (newRound.guess_word && newRound.guesser_id) {
            console.log('🎯 Réponse reçue:', newRound.guess_word);

            // Ne mettre à jour que si c'est l'adversaire qui a répondu
            if (newRound.guesser_id !== currentPlayer?.id) {
              setAttempts(prev => {
                const newAttempts = [...prev];
                const lastAttempt = newAttempts[newAttempts.length - 1];

                // Vérifier que la dernière tentative n'a pas déjà une réponse
                if (lastAttempt && !lastAttempt.guess) {
                  lastAttempt.guess = newRound.guess_word;
                  lastAttempt.correct = newRound.won || false;
                }

                return newAttempts;
              });

              if (newRound.won) {
                console.log('✅ Mot trouvé !');
                setTimeout(() => handleNextRound(), 2000);
              } else {
                console.log('❌ Réponse incorrecte');
                setWaitingForOpponent(false);
              }
            }
          }
        }
      })
      .subscribe((status) => {
        console.log('📡 Statut de l\'abonnement rounds:', status);
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

    console.log('📤 Envoi de l\'indice:', currentClue.trim());

    setAttempts(prev => [...prev, { clue: currentClue.trim(), guess: '', correct: false }]);
    setCurrentClue("");
    setWaitingForOpponent(true);

    const allClues = [...attempts.map(a => a.clue), currentClue.trim()];
    console.log('📋 Tous les indices:', allClues);

    const { data, error } = await supabase.from('rounds').insert({
      game_id: currentGame.id,
      round_number: currentGame.current_round,
      word: currentGame.current_word,
      giver_id: currentPlayer?.id,
      clues: allClues
    }).select();

    console.log('✉️ Résultat insertion indice:', { data, error });

    await supabase.from('games').update({
      attempts_used: allClues.length
    }).eq('id', currentGame.id);
  };

  const submitGuess = async () => {
    if (!currentGame || !currentGuess.trim() || waitingForOpponent) return;

    const guessUpper = currentGuess.trim().toUpperCase();
    const isCorrect = guessUpper === currentGame.current_word;

    console.log('🎯 Envoi de la réponse:', guessUpper, 'Correct:', isCorrect);

    setAttempts(prev => {
      const newAttempts = [...prev];
      const lastAttempt = newAttempts[newAttempts.length - 1];
      if (lastAttempt) {
        lastAttempt.guess = guessUpper;
        lastAttempt.correct = isCorrect;
      }
      return newAttempts;
    });

    setCurrentGuess("");
    setWaitingForOpponent(true);

    const { data, error } = await supabase.from('rounds').insert({
      game_id: currentGame.id,
      round_number: currentGame.current_round,
      word: currentGame.current_word,
      guesser_id: currentPlayer?.id,
      guess_word: guessUpper,
      won: isCorrect,
      time_taken: 60 - timeLeft
    }).select();

    console.log('✉️ Résultat insertion réponse:', { data, error });

    if (isCorrect) {
      const isPlayer1 = currentGame.player1_id === currentPlayer?.id;
      await supabase.from('games').update({
        [isPlayer1 ? 'player1_score' : 'player2_score']: isPlayer1 ? currentGame.player1_score + 1 : currentGame.player2_score + 1
      }).eq('id', currentGame.id);

      setTimeout(() => handleNextRound(), 2000);
    } else if (attempts.length >= 4) {
      setTimeout(() => handleNextRound(), 2000);
    } else {
      setWaitingForOpponent(false);
    }
  };

  const handleTimeOut = () => {
    handleNextRound();
  };

  const handleNextRound = async () => {
    if (!currentGame) return;

    if (currentGame.current_round >= 4) {
      await supabase.from('games').update({
        status: 'finished'
      }).eq('id', currentGame.id);
    } else {
      setGameState("waiting");

      setTimeout(async () => {
        const nextRound = currentGame.current_round + 1;
        const { data: word } = await supabase.rpc('get_random_word');
        const newGiverId = currentGame.current_giver_id === currentGame.player1_id
          ? currentGame.player2_id
          : currentGame.player1_id;

        // Mise à jour du jeu qui va trigger le reset chez les 2 joueurs via subscription
        await supabase.from('games').update({
          current_round: nextRound,
          current_word: word || 'ELEPHANT',
          current_giver_id: newGiverId,
          time_left: 60,
          attempts_used: 0,
          round_start_time: new Date().toISOString()
        }).eq('id', currentGame.id);

        setGameState("playing");
      }, 3000);
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

  // [Le reste du code UI reste identique, je ne le répète pas pour gagner de la place]
  // Gardez tout le code des pages login, home, queue, waiting, results, playing tel quel

  // Code identique au précédent à partir d'ici...
  if (gameState === "login") {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-50 via-white to-blue-50">
        {/* ... même code que précédemment ... */}
      </div>
    );
  }

  // ... tous les autres états restent identiques
  return null;
};

export default DicoClash;