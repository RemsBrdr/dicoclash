"use client"

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Swords, LogIn, Users, Send, Loader2, Trophy, Star, Play, TrendingUp, Clock, Target, Zap, Shield, Crown, AlertCircle } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Attempt {
  clue: string;
  guess: string;
  correct: boolean;
}

interface RecentGame {
  id: string;
  player1_pseudo: string;
  player2_pseudo: string;
  player1_score: number;
  player2_score: number;
  created_at: string;
}

const normalizeString = (str: string) => {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
};

const DicoClash = () => {
  const [gameState, setGameState] = useState<"welcome" | "home" | "queue" | "playing" | "results">("welcome");
  const [pseudo, setPseudo] = useState("");
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [playerId, setPlayerId] = useState("");
  const [playerScore, setPlayerScore] = useState(1500);
  const [totalGames, setTotalGames] = useState(0);
  const [gamesWon, setGamesWon] = useState(0);
  const [gameId, setGameId] = useState("");
  const [opponentPseudo, setOpponentPseudo] = useState("");
  const [isGiver, setIsGiver] = useState(false);
  const [word, setWord] = useState("");
  const [round, setRound] = useState(1);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [currentClue, setCurrentClue] = useState("");
  const [currentGuess, setCurrentGuess] = useState("");
  const [timeLeft, setTimeLeft] = useState(60);
  const [myScore, setMyScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [onlinePlayers, setOnlinePlayers] = useState(0);
  const [activeGames, setActiveGames] = useState(0);
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);
  const [clueError, setClueError] = useState("");

  useEffect(() => {
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:8080';
    const socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      console.log('✅ WebSocket connected');
      setWs(socket);
    };

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('📩 Received:', data.type, data);

      switch (data.type) {
        case 'game_start':
          setGameId(data.gameId);
          setOpponentPseudo(data.opponentPseudo);
          setIsGiver(data.isGiver);
          setWord(data.word || '');
          setRound(data.round);
          setAttempts([]);
          setTimeLeft(60);
          setMyScore(0);
          setOpponentScore(0);
          setGameState('playing');
          break;

        case 'new_clue':
          setAttempts(data.attempts);
          setWaitingForOpponent(false);
          break;

        case 'clue_sent':
          setAttempts(data.attempts);
          setWaitingForOpponent(true);
          break;

        case 'new_guess':
          setAttempts(data.attempts);
          setWaitingForOpponent(false);
          break;

        case 'score_update':
          setMyScore(data.myScore);
          setOpponentScore(data.opponentScore);
          break;

        case 'new_round':
          setRound(data.round);
          setIsGiver(data.isGiver);
          setWord(data.word || '');
          setAttempts([]);
          setTimeLeft(60);
          setWaitingForOpponent(false);
          break;

        case 'timer_update':
          setTimeLeft(data.timeLeft);
          break;

        case 'game_end':
          setMyScore(data.myScore);
          setOpponentScore(data.opponentScore);
          updatePlayerStats(data.myScore, data.opponentScore);
          setGameState('results');
          break;

        case 'opponent_disconnected':
          alert('Adversaire déconnecté');
          setGameState('home');
          break;
      }
    };

    socket.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
    };

    socket.onclose = () => {
      console.log('🔌 WebSocket closed');
    };

    return () => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.close();
      }
    };
  }, []);

  useEffect(() => {
    loadStats();
    const interval = setInterval(loadStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const loadStats = async () => {
    const { data: onlineCount } = await supabase.from('online_count').select('count').single();
    if (onlineCount) setOnlinePlayers(onlineCount.count);

    const { count: gamesCount } = await supabase
      .from('games')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'playing');
    setActiveGames(gamesCount || 0);

    const { data: recent } = await supabase
      .from('games')
      .select(`
        id,
        player1_score,
        player2_score,
        created_at,
        player1:players!games_player1_id_fkey(pseudo),
        player2:players!games_player2_id_fkey(pseudo)
      `)
      .eq('status', 'finished')
      .order('created_at', { ascending: false })
      .limit(10);

    if (recent) {
      const formatted = recent.map((g: any) => ({
        id: g.id,
        player1_pseudo: g.player1?.pseudo || 'Joueur 1',
        player2_pseudo: g.player2?.pseudo || 'Joueur 2',
        player1_score: g.player1_score,
        player2_score: g.player2_score,
        created_at: g.created_at
      }));
      setRecentGames(formatted);
    }
  };

  const updatePlayerStats = async (myFinalScore: number, oppFinalScore: number) => {
    if (!playerId) return;

    const wordsFound = myFinalScore;
    const wordsMissed = 4 - myFinalScore;
    const pointsGained = (wordsFound * 25) - (wordsMissed * 10);
    const isPerfect = myFinalScore === 4;

    const { data: player } = await supabase
      .from('players')
      .select('*')
      .eq('id', playerId)
      .single();

    if (player) {
      await supabase.from('players').update({
        score_giver: player.score_giver + pointsGained,
        total_games: player.total_games + 1,
        games_won: player.games_won + (isPerfect ? 1 : 0)
      }).eq('id', playerId);

      setPlayerScore(player.score_giver + pointsGained);
      setTotalGames(player.total_games + 1);
      setGamesWon(player.games_won + (isPerfect ? 1 : 0));
    }
  };

  const handleLogin = async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !pseudo.trim()) return;

    setLoading(true);

    try {
      const { data: existingPlayer } = await supabase
        .from('players')
        .select('*')
        .eq('pseudo', pseudo.trim())
        .single();

      let player;

      if (existingPlayer) {
        player = existingPlayer;
        await supabase.from('players').update({ last_played: new Date().toISOString() }).eq('id', player.id);
      } else {
        const { data: newPlayer, error } = await supabase
          .from('players')
          .insert([{ pseudo: pseudo.trim() }])
          .select()
          .single();

        if (error || !newPlayer) {
          alert('Erreur lors de la création du joueur');
          setLoading(false);
          return;
        }

        player = newPlayer;
      }

      setPlayerId(player.id);
      setPlayerScore(player.score_giver);
      setTotalGames(player.total_games);
      setGamesWon(player.games_won);

      await supabase.from('presence').upsert({
        player_id: player.id,
        last_heartbeat: new Date().toISOString(),
        status: 'online'
      });

      setGameState('home');
    } catch (err) {
      console.error('❌ Error:', err);
      alert('Erreur de connexion');
    } finally {
      setLoading(false);
    }
  };

  const joinQueue = async () => {
    if (!ws || ws.readyState !== WebSocket.OPEN || !playerId) return;

    ws.send(JSON.stringify({
      type: 'join_queue',
      playerId,
      pseudo
    }));

    setGameState('queue');
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
      return "L'indice ne peut pas commencer pareil !";
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
    if (!ws || !currentGuess.trim()) return;

    ws.send(JSON.stringify({
      type: 'send_guess',
      gameId,
      guess: currentGuess.trim()
    }));
    setCurrentGuess('');
  };

  // PAGE WELCOME
  if (gameState === 'welcome') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50">
        <div className="bg-gray-100 border-b border-gray-200 py-2 text-center text-xs text-gray-500">
          Publicité - 728x90
        </div>

        <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8">
          <div className="text-center py-12 space-y-6">
            <div className="flex items-center justify-center gap-4 mb-6">
              <div className="p-4 bg-gradient-to-br from-purple-600 to-blue-600 rounded-3xl shadow-2xl">
                <Swords className="w-16 h-16 text-white" />
              </div>
            </div>
            <h1 className="text-5xl md:text-7xl font-black bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent">
              DicoClash
            </h1>
            <p className="text-xl md:text-3xl text-gray-700 font-semibold">
              Le jeu de mots en duel qui fait vibrer !
            </p>
            <p className="text-base md:text-lg text-gray-600 max-w-2xl mx-auto">
              Affrontez des joueurs du monde entier. Donnez des indices, devinez des mots, gagnez des points !
            </p>

            <div className="flex justify-center gap-8 py-6">
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 text-green-600 text-2xl md:text-3xl font-bold">
                  <Users className="w-6 h-6 md:w-8 md:h-8" />
                  {onlinePlayers}
                </div>
                <p className="text-xs md:text-sm text-gray-600">En ligne</p>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 text-purple-600 text-2xl md:text-3xl font-bold">
                  <Zap className="w-6 h-6 md:w-8 md:h-8" />
                  {activeGames}
                </div>
                <p className="text-xs md:text-sm text-gray-600">Parties en cours</p>
              </div>
            </div>

            <Card className="max-w-md mx-auto border-2 border-purple-200 shadow-2xl">
              <CardContent className="p-6 space-y-4">
                <input
                  type="text"
                  value={pseudo}
                  onChange={(e) => setPseudo(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="Entrez votre pseudo..."
                  className="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500"
                  maxLength={20}
                  disabled={loading}
                />
                <Button
                  onClick={handleLogin}
                  disabled={!pseudo.trim() || !ws || ws.readyState !== WebSocket.OPEN || loading}
                  className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-xl py-6 rounded-xl shadow-lg"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 w-6 h-6 animate-spin" />
                      Connexion...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 w-6 h-6" />
                      Commencer à jouer
                    </>
                  )}
                </Button>
                {(!ws || ws.readyState !== WebSocket.OPEN) && (
                  <p className="text-sm text-orange-600 text-center">Connexion au serveur...</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="border-2 border-blue-200">
            <CardHeader className="bg-gradient-to-r from-purple-100 to-blue-100">
              <CardTitle className="text-xl md:text-2xl flex items-center gap-2">
                <Target className="w-5 h-5 md:w-6 md:h-6 text-purple-600" />
                Comment jouer ?
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 md:p-6">
              <div className="grid md:grid-cols-2 gap-4 md:gap-6">
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold">1</div>
                    <div>
                      <h3 className="font-bold text-base md:text-lg mb-1">Affrontez un adversaire</h3>
                      <p className="text-sm text-gray-600">Matchmaking instantané avec un joueur en ligne</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-purple-600 text-white rounded-full flex items-center justify-center font-bold">2</div>
                    <div>
                      <h3 className="font-bold text-base md:text-lg mb-1">Donnez des indices</h3>
                      <p className="text-sm text-gray-600">À tour de rôle, faites deviner un mot secret</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">3</div>
                    <div>
                      <h3 className="font-bold text-base md:text-lg mb-1">Devinez vite</h3>
                      <p className="text-sm text-gray-600">4 tentatives et 60 secondes par mot</p>
                    </div>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold">4</div>
                    <div>
                      <h3 className="font-bold text-base md:text-lg mb-1">Gagnez des points</h3>
                      <p className="text-sm text-gray-600">+25 pts par mot trouvé, -10 pts par mot manqué</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 p-4 bg-purple-50 rounded-lg border border-purple-200">
                <p className="text-sm text-gray-700">
                  <Shield className="inline w-4 h-4 mr-1 text-purple-600" />
                  <strong>Règle importante :</strong> Vous ne pouvez pas donner le mot lui-même ou un mot trop similaire en indice !
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-green-200">
            <CardHeader className="bg-gradient-to-r from-green-100 to-blue-100">
              <CardTitle className="text-xl md:text-2xl flex items-center gap-2">
                <TrendingUp className="w-5 h-5 md:w-6 md:h-6 text-green-600" />
                Dernières parties
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 md:p-6">
              {recentGames.length === 0 ? (
                <p className="text-center text-gray-500 py-8">Aucune partie récente</p>
              ) : (
                <div className="space-y-2">
                  {recentGames.map((game) => (
                    <div key={game.id} className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 p-3 bg-gray-50 rounded-lg border">
                      <div className="flex items-center gap-2 md:gap-3 flex-wrap">
                        <Trophy className="w-4 h-4 md:w-5 md:h-5 text-yellow-600" />
                        <span className="font-semibold text-sm md:text-base">{game.player1_pseudo}</span>
                        <span className="text-xl md:text-2xl font-bold text-purple-600">{game.player1_score}</span>
                        <span className="text-gray-400">-</span>
                        <span className="text-xl md:text-2xl font-bold text-blue-600">{game.player2_score}</span>
                        <span className="font-semibold text-sm md:text-base">{game.player2_pseudo}</span>
                      </div>
                      <span className="text-xs text-gray-500">
                        {new Date(game.created_at).toLocaleString('fr-FR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-gray-100 border border-gray-200 rounded-lg p-8 text-center text-xs text-gray-500">
              Publicité - 300x250
            </div>
            <div className="bg-gray-100 border border-gray-200 rounded-lg p-8 text-center text-xs text-gray-500">
              Publicité - 300x250
            </div>
          </div>
        </div>

        <div className="bg-gray-100 border-t border-gray-200 py-2 text-center text-xs text-gray-500 mt-8">
          Publicité - 728x90
        </div>
      </div>
    );
  }

  // PAGE HOME
  if (gameState === 'home') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50">
        <div className="bg-gray-100 border-b py-2 text-center text-xs text-gray-500">
          Publicité - 728x90
        </div>

        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-3xl md:text-4xl font-black bg-gradient-to-r from-purple-600 to-blue-600 bg-clip-text text-transparent mb-2">
              Bienvenue, {pseudo} !
            </h1>
            <Badge variant="outline" className="text-base md:text-lg px-4 py-1">
              <Crown className="w-4 h-4 mr-2 text-yellow-600" />
              Score : {playerScore} pts
            </Badge>
          </div>

          <Card className="border-2 border-purple-200 shadow-xl">
            <CardContent className="p-6 md:p-8 text-center space-y-4">
              <h2 className="text-2xl md:text-3xl font-bold">Prêt pour un duel ?</h2>
              <Button
                onClick={joinQueue}
                className="text-xl md:text-2xl px-12 md:px-16 py-6 md:py-8 h-auto bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 rounded-xl shadow-lg"
              >
                <Play className="mr-2 md:mr-3 w-6 h-6 md:w-8 md:h-8" />
                Lancer une partie
              </Button>
              <div className="flex justify-center gap-8 mt-4">
                <div className="text-center">
                  <div className="text-green-600 text-xl md:text-2xl font-bold">{onlinePlayers}</div>
                  <p className="text-xs text-gray-600">En ligne</p>
                </div>
                <div className="text-center">
                  <div className="text-purple-600 text-xl md:text-2xl font-bold">{activeGames}</div>
                  <p className="text-xs text-gray-600">Parties en cours</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6 text-center">
                <Trophy className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-2 text-yellow-600" />
                <p className="text-2xl md:text-3xl font-bold">{totalGames}</p>
                <p className="text-xs md:text-sm text-gray-600">Parties jouées</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <Star className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-2 text-green-600" />
                <p className="text-2xl md:text-3xl font-bold">{gamesWon}</p>
                <p className="text-xs md:text-sm text-gray-600">Victoires parfaites</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6 text-center">
                <TrendingUp className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-2 text-purple-600" />
                <p className="text-2xl md:text-3xl font-bold">{playerScore}</p>
                <p className="text-xs md:text-sm text-gray-600">Score total</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-gray-100 border rounded-lg p-8 text-center text-xs text-gray-500">
              Publicité - 300x250
            </div>
            <div className="bg-gray-100 border rounded-lg p-8 text-center text-xs text-gray-500">
              Publicité - 300x250
            </div>
          </div>

          <div className="text-center">
            <Button variant="outline" onClick={() => {
              setGameState('welcome');
              setPseudo('');
            }}>
              Se déconnecter
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // PAGE QUEUE
  if (gameState === 'queue') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-2 border-purple-100">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto">
              <Users className="w-10 h-10 text-purple-600 animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Recherche d'adversaire...</h2>
              <p className="text-gray-600">Matchmaking en cours</p>
            </div>
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-purple-600" />
            <p className="text-sm text-gray-500">{onlinePlayers} joueurs en ligne</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // PAGE PLAYING
  if (gameState === 'playing') {
    const attemptsLeft = 4 - attempts.length;

    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 p-2 md:p-4">
        <div className="max-w-5xl mx-auto space-y-3 md:space-y-4">
          <Card className="border-2 border-purple-100">
            <CardContent className="p-3 md:p-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-xl md:text-2xl font-bold">Round {round}/4</h2>
                  <Badge variant={isGiver ? "default" : "secondary"} className={isGiver ? "bg-purple-600 mt-1" : "mt-1"}>
                    {isGiver ? "🎯 Donneur" : "🔍 Devineur"}
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="text-xs md:text-sm">vs {opponentPseudo}</p>
                  <p className="text-lg md:text-2xl font-bold">
                    <span className="text-purple-600">{myScore}</span> - <span className="text-blue-600">{opponentScore}</span>
                  </p>
                  <p className={`text-xl md:text-2xl font-bold ${timeLeft > 30 ? 'text-green-600' : timeLeft > 10 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {timeLeft}s
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {isGiver && (
            <Card className="border-2 border-purple-100">
              <CardHeader className="pb-3">
                <CardTitle className="text-center text-lg md:text-xl">Votre mot</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-6 md:py-12">
                  <div className="inline-block bg-gradient-to-r from-purple-600 to-blue-600 text-white px-6 md:px-12 py-4 md:py-6 rounded-2xl text-3xl md:text-5xl font-black">
                    {word}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-2 border-gray-100">
            <CardHeader className="pb-3">
              <CardTitle className="text-base md:text-lg">Historique</CardTitle>
              <p className="text-xs md:text-sm text-gray-600">{attemptsLeft} tentative(s) restante(s)</p>
            </CardHeader>
            <CardContent className="space-y-2 md:space-y-3">
              {attempts.length === 0 && (
                <div className="text-center py-6 md:py-8 text-gray-500 text-sm md:text-base">
                  {isGiver ? "Donnez le premier indice" : `En attente de ${opponentPseudo}...`}
                </div>
              )}

              {attempts.map((att, i) => (
                <div key={i} className="border-2 rounded-xl p-3 md:p-4 bg-gray-50">
                  <div className="flex gap-2 md:gap-3 mb-2">
                    <Badge className="text-xs md:text-sm">#{i + 1}</Badge>
                    <div className="flex-1">
                      <p className="text-xs md:text-sm text-gray-600">Indice :</p>
                      <p className="font-bold text-base md:text-lg">{att.clue}</p>
                    </div>
                  </div>
                  {att.guess && (
                    <div className="flex gap-2 md:gap-3 mt-2 md:mt-3 pt-2 md:pt-3 border-t">
                      <Badge variant={att.correct ? "default" : "destructive"} className={att.correct ? "bg-green-600" : ""}>
                        {att.correct ? "✓" : "✗"}
                      </Badge>
                      <p className="text-sm md:text-base"><b>{att.guess}</b></p>
                    </div>
                  )}
                  {!att.guess && <p className="text-xs md:text-sm text-gray-500 italic mt-2 pt-2 border-t">En attente de réponse...</p>}
                </div>
              ))}

              {isGiver && attemptsLeft > 0 && !waitingForOpponent && (
                (attempts.length === 0 || (attempts[attempts.length - 1].guess && !attempts[attempts.length - 1].correct)) && (
                  <Card className="border-2 border-purple-100 bg-purple-50">
                    <CardContent className="p-3 md:p-4">
                      {clueError && (
                        <div className="mb-3 p-2 bg-red-100 border border-red-300 rounded-lg flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 text-red-600" />
                          <p className="text-sm text-red-700">{clueError}</p>
                        </div>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={currentClue}
                          onChange={(e) => setCurrentClue(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && sendClue()}
                          placeholder="Votre indice..."
                          className="flex-1 px-3 md:px-4 py-2 md:py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm md:text-base"
                          maxLength={50}
                          autoFocus
                        />
                        <Button onClick={sendClue} disabled={!currentClue.trim()} className="bg-purple-600 px-4 md:px-6">
                          <Send className="w-4 h-4 md:w-5 md:h-5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              )}

              {!isGiver && attempts.length > 0 && !attempts[attempts.length - 1].guess && (
                <Card className="border-2 border-blue-100 bg-blue-50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base md:text-lg">À vous de deviner !</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 md:space-y-3">
                    <input
                      type="text"
                      value={currentGuess}
                      onChange={(e) => setCurrentGuess(e.target.value.toUpperCase())}
                      onKeyPress={(e) => e.key === 'Enter' && sendGuess()}
                      placeholder="RÉPONSE..."
                      className="w-full px-3 md:px-4 py-3 md:py-4 border-2 rounded-xl text-center font-black text-xl md:text-2xl uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                      maxLength={30}
                      autoFocus
                    />
                    <Button onClick={sendGuess} disabled={!currentGuess.trim()} className="w-full bg-blue-600 py-3 md:py-4">
                      <Send className="mr-2 w-4 h-4 md:w-5 md:h-5" />
                      Valider
                    </Button>
                  </CardContent>
                </Card>
              )}

              {waitingForOpponent && (
                <div className="text-center py-4 md:py-6">
                  <Loader2 className="w-5 h-5 md:w-6 md:h-6 mx-auto mb-2 animate-spin" />
                  <p className="text-sm md:text-base text-gray-600">En attente de {opponentPseudo}...</p>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="bg-gray-100 border rounded-lg p-4 text-center text-xs text-gray-500">
            Publicité - 728x90
          </div>
        </div>
      </div>
    );
  }

  // PAGE RESULTS
  if (gameState === 'results') {
    const isPerfect = myScore === 4;
    const won = myScore > opponentScore;
    const wordsFound = myScore;
    const wordsMissed = 4 - myScore;
    const pointsGained = (wordsFound * 25) - (wordsMissed * 10);

    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-white to-blue-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl border-2 border-purple-100">
          <CardContent className="p-6 md:p-8 space-y-6">
            <div className="text-center">
              {isPerfect ? (
                <div className="w-20 h-20 md:w-24 md:h-24 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Crown className="w-10 h-10 md:w-12 md:h-12 text-yellow-600" />
                </div>
              ) : won ? (
                <div className="w-20 h-20 md:w-24 md:h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trophy className="w-10 h-10 md:w-12 md:h-12 text-green-600" />
                </div>
              ) : (
                <div className="w-20 h-20 md:w-24 md:h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Star className="w-10 h-10 md:w-12 md:h-12 text-gray-400" />
                </div>
              )}
              <h2 className="text-3xl md:text-4xl font-bold">
                {isPerfect ? "VICTOIRE PARFAITE !" : won ? "Bien joué !" : "Dommage !"}
              </h2>
            </div>

            <div className="flex justify-center gap-8 md:gap-16 py-6 md:py-8">
              <div className="text-center">
                <p className="text-xs md:text-sm mb-2">{pseudo}</p>
                <p className="text-4xl md:text-6xl font-bold text-purple-600">{myScore}</p>
              </div>
              <div className="text-4xl md:text-6xl text-gray-300">-</div>
              <div className="text-center">
                <p className="text-xs md:text-sm mb-2">{opponentPseudo}</p>
                <p className="text-4xl md:text-6xl font-bold text-blue-600">{opponentScore}</p>
              </div>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 md:p-6 border">
              <h3 className="font-bold text-base md:text-lg mb-3">Récapitulatif</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm md:text-base">
                  <span>Mots trouvés :</span>
                  <span className="font-bold text-green-600">+{wordsFound * 25} pts</span>
                </div>
                <div className="flex justify-between text-sm md:text-base">
                  <span>Mots manqués :</span>
                  <span className="font-bold text-red-600">-{wordsMissed * 10} pts</span>
                </div>
                <div className="border-t pt-2 mt-2">
                  <div className="flex justify-between text-base md:text-lg font-bold">
                    <span>Total :</span>
                    <span className={pointsGained >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {pointsGained >= 0 ? '+' : ''}{pointsGained} pts
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <Button onClick={() => {
              setGameState('home');
            }} className="w-full bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-lg md:text-xl py-5 md:py-6">
              <Play className="mr-2 w-5 h-5 md:w-6 md:h-6" />
              Rejouer
            </Button>

            <div className="bg-gray-100 border rounded-lg p-6 md:p-8 text-center text-xs text-gray-500">
              Publicité - 468x60
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
};

export default DicoClash;