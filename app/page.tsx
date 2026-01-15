"use client"

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Swords, LogIn, Users, Send, Loader2, Trophy, Star, Play, TrendingUp, Target, Shield, Crown, AlertCircle, Zap } from "lucide-react";
import { supabase } from "@/lib/supabase";

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

        case 'new_round':
          setRound(data.round);
          setIsGiver(data.isGiver);
          setWord(data.word || '');
          setAttempts([]);
          setTimeLeft(60);
          setWaitingForPartner(false);
          break;

        case 'timer_update':
          setTimeLeft(data.timeLeft);
          break;

        case 'game_end':
          setTeamScore(data.teamScore);
          updatePlayerStats(data.teamScore);
          setGameState('results');
          break;

        case 'partner_disconnected':
          alert('Votre complice s\'est déconnecté');
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

    const { data: topPlayers } = await supabase
      .from('players')
      .select('id, pseudo, score_giver, total_games, games_won')
      .order('score_giver', { ascending: false })
      .limit(10);

    if (topPlayers) setLeaderboard(topPlayers);
  };

  const updatePlayerStats = async (finalScore: number) => {
    if (!playerId) return;

    const wordsFound = finalScore;
    const wordsMissed = 4 - finalScore;
    const pointsGained = (wordsFound * 25) - (wordsMissed * 10);
    const isPerfect = finalScore === 4;

    const { data: player } = await supabase
      .from('players')
      .select('*')
      .eq('id', playerId)
      .single();

    if (player) {
      const newScore = player.score_giver + pointsGained;
      await supabase.from('players').update({
        score_giver: newScore,
        total_games: player.total_games + 1,
        games_won: player.games_won + (isPerfect ? 1 : 0)
      }).eq('id', playerId);

      setPlayerScore(newScore);
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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
        <div className="bg-gray-100 border-b border-gray-200 py-2 text-center text-xs text-gray-500">
          Publicité - 728x90
        </div>

        <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-8">
          <div className="text-center py-8 space-y-4">
            <h1 className="text-5xl md:text-7xl font-black text-blue-900 mb-2">
              DicoClash
            </h1>
            <p className="text-lg md:text-xl text-gray-600">
              Jeu de mots coopératif en ligne
            </p>

            <div className="flex justify-center gap-6 md:gap-12 py-4 text-sm md:text-base">
              <div className="text-center">
                <div className="text-2xl md:text-3xl font-bold text-green-600">{onlinePlayers}</div>
                <p className="text-gray-600">joueurs en ligne</p>
              </div>
              <div className="text-center">
                <div className="text-2xl md:text-3xl font-bold text-blue-600">{activeGames}</div>
                <p className="text-gray-600">parties en cours</p>
              </div>
            </div>

            <Card className="max-w-md mx-auto border-2 border-blue-200 shadow-xl">
              <CardContent className="p-6 space-y-4">
                <input
                  type="text"
                  value={pseudo}
                  onChange={(e) => setPseudo(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                  placeholder="Entrez votre pseudo..."
                  className="w-full px-4 py-3 text-lg border-2 border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  maxLength={20}
                  disabled={loading}
                />
                <Button
                  onClick={handleLogin}
                  disabled={!pseudo.trim() || !ws || ws.readyState !== WebSocket.OPEN || loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-xl py-6 rounded-lg"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 w-6 h-6 animate-spin" />
                      Connexion...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 w-6 h-6" />
                      Jouer
                    </>
                  )}
                </Button>
                {(!ws || ws.readyState !== WebSocket.OPEN) && (
                  <p className="text-sm text-orange-600 text-center">Connexion au serveur...</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="border-2 border-blue-100">
            <CardHeader className="bg-blue-50">
              <CardTitle className="text-xl flex items-center gap-2">
                <Target className="w-5 h-5 text-blue-600" />
                Comment jouer ?
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm">1</div>
                    <div>
                      <h3 className="font-bold">Trouvez un complice</h3>
                      <p className="text-sm text-gray-600">Matchmaking automatique</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold text-sm">2</div>
                    <div>
                      <h3 className="font-bold">Donnez des indices</h3>
                      <p className="text-sm text-gray-600">À tour de rôle, aidez votre complice</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold text-sm">3</div>
                    <div>
                      <h3 className="font-bold">Trouvez les 4 mots</h3>
                      <p className="text-sm text-gray-600">4 tentatives par mot, 60 secondes</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold text-sm">4</div>
                    <div>
                      <h3 className="font-bold">Gagnez ensemble</h3>
                      <p className="text-sm text-gray-600">+25 pts par mot, -10 pts si raté</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
                <p className="text-sm text-gray-700">
                  <Shield className="inline w-4 h-4 mr-1 text-blue-600" />
                  <strong>Important :</strong> Les indices ne doivent pas être trop proches du mot à deviner !
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-2 border-green-100">
            <CardHeader className="bg-green-50">
              <CardTitle className="text-xl flex items-center gap-2">
                <Trophy className="w-5 h-5 text-green-600" />
                Classement
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6">
              {leaderboard.length === 0 ? (
                <p className="text-center text-gray-500 py-4">Chargement...</p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.map((player, index) => (
                    <div key={player.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg border">
                      <div className="flex items-center gap-3">
                        {index === 0 && <Crown className="w-5 h-5 text-yellow-600" />}
                        {index === 1 && <Star className="w-5 h-5 text-gray-400" />}
                        {index === 2 && <Star className="w-5 h-5 text-amber-700" />}
                        <span className="font-bold text-gray-600">#{index + 1}</span>
                        <span className="font-semibold">{player.pseudo}</span>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-bold text-blue-600">{player.score_giver}</div>
                        <div className="text-xs text-gray-500">{player.total_games} parties</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="bg-gray-100 border rounded-lg p-8 text-center text-xs text-gray-500">
              Publicité - 300x250
            </div>
            <div className="bg-gray-100 border rounded-lg p-8 text-center text-xs text-gray-500">
              Publicité - 300x250
            </div>
          </div>
        </div>

        <div className="bg-gray-100 border-t py-2 text-center text-xs text-gray-500 mt-8">
          Publicité - 728x90
        </div>
      </div>
    );
  }

  // PAGE HOME
  if (gameState === 'home') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
        <div className="bg-gray-100 border-b py-2 text-center text-xs text-gray-500">
          Publicité - 728x90
        </div>

        <div className="max-w-4xl mx-auto p-4 md:p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-3xl md:text-4xl font-black text-blue-900 mb-2">
              Bienvenue, {pseudo} !
            </h1>
            <Badge variant="outline" className="text-lg px-4 py-1">
              <Crown className="w-4 h-4 mr-2 text-yellow-600" />
              {playerScore} points
            </Badge>
          </div>

          <Card className="border-2 border-blue-200 shadow-xl">
            <CardContent className="p-8 text-center space-y-4">
              <h2 className="text-2xl font-bold">Rechercher un complice ?</h2>
              <Button
                onClick={joinQueue}
                className="text-xl px-16 py-8 h-auto bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                <Play className="mr-3 w-8 h-8" />
                Lancer une partie
              </Button>
              <div className="flex justify-center gap-8 mt-4">
                <div className="text-center">
                  <div className="text-green-600 text-2xl font-bold">{onlinePlayers}</div>
                  <p className="text-xs text-gray-600">En ligne</p>
                </div>
                <div className="text-center">
                  <div className="text-blue-600 text-2xl font-bold">{activeGames}</div>
                  <p className="text-xs text-gray-600">Parties en cours</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-gray-50">
              <CardContent className="p-6 text-center">
                <Trophy className="w-12 h-12 mx-auto mb-2 text-yellow-600" />
                <p className="text-3xl font-bold">{totalGames}</p>
                <p className="text-sm text-gray-600">Parties</p>
              </CardContent>
            </Card>
            <Card className="bg-gray-50">
              <CardContent className="p-6 text-center">
                <Star className="w-12 h-12 mx-auto mb-2 text-green-600" />
                <p className="text-3xl font-bold">{gamesWon}</p>
                <p className="text-sm text-gray-600">Victoires</p>
              </CardContent>
            </Card>
            <Card className="bg-gray-50">
              <CardContent className="p-6 text-center">
                <Zap className="w-12 h-12 mx-auto mb-2 text-blue-600" />
                <p className="text-3xl font-bold">{playerScore}</p>
                <p className="text-sm text-gray-600">Score</p>
              </CardContent>
            </Card>
          </div>

          <Card className="border-2 border-blue-100">
            <CardHeader className="bg-blue-50">
              <CardTitle className="flex items-center gap-2">
                <Target className="w-5 h-5 text-blue-600" />
                Règles
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-2 text-sm">
              <p>🎯 Trouvez les 4 mots avec votre complice</p>
              <p>🔄 4 tentatives maximum par mot</p>
              <p>⏱️ 60 secondes par mot</p>
              <p>✅ +25 points par mot trouvé</p>
              <p>❌ -10 points par mot raté</p>
            </CardContent>
          </Card>

          <Card className="border-2 border-green-100">
            <CardHeader className="bg-green-50">
              <CardTitle className="flex items-center gap-2">
                <Trophy className="w-5 h-5 text-green-600" />
                Classement
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {leaderboard.length === 0 ? (
                <p className="text-center text-gray-500 py-4">Chargement...</p>
              ) : (
                <div className="space-y-2">
                  {leaderboard.slice(0, 5).map((player, index) => (
                    <div key={player.id} className={`flex justify-between items-center p-2 rounded ${player.id === playerId ? 'bg-blue-100 border border-blue-300' : 'bg-gray-50'}`}>
                      <div className="flex items-center gap-2">
                        {index === 0 && <Crown className="w-4 h-4 text-yellow-600" />}
                        <span className="font-bold text-gray-600 text-sm">#{index + 1}</span>
                        <span className="font-semibold text-sm">{player.pseudo}</span>
                      </div>
                      <div className="text-blue-600 font-bold">{player.score_giver}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

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
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-2 border-blue-100">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto">
              <Users className="w-10 h-10 text-blue-600 animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Recherche d'un complice...</h2>
              <p className="text-gray-600 mt-2">
                <b>{queueSize}</b> joueur{queueSize > 1 ? 's' : ''} dans la file
              </p>
              <p className="text-sm text-gray-500">
                <b>{activeGames}</b> parties en cours
              </p>
            </div>
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-blue-600" />
            <Button variant="outline" onClick={() => {
              if (ws) ws.send(JSON.stringify({ type: 'leave_queue', playerId }));
              setGameState('home');
            }}>
              Annuler
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // PAGE PLAYING
  if (gameState === 'playing') {
    const attemptsLeft = 4 - attempts.length;

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-2 md:p-4">
        <div className="max-w-5xl mx-auto space-y-3">
          <div className="bg-blue-600 text-white p-3 md:p-4 rounded-lg border-2 border-blue-700">
            <div className="flex justify-between items-center">
              <div>
                <div className="text-lg md:text-xl font-bold">Manche {round}/4</div>
                <Badge variant="secondary" className={isGiver ? "bg-blue-800" : "bg-indigo-800"}>
                  {isGiver ? "Vous faites deviner" : "Vous devinez"}
                </Badge>
              </div>
              <div className="text-right">
                <div className="text-sm">Complice : <b>{partnerPseudo}</b></div>
                <div className="text-2xl md:text-3xl font-black">
                  {teamScore}/4
                </div>
                <div className={`text-xl font-bold ${timeLeft > 30 ? 'text-green-300' : timeLeft > 10 ? 'text-yellow-300' : 'text-red-300'}`}>
                  {timeLeft}s
                </div>
              </div>
            </div>
          </div>

          {isGiver && (
            <Card className="border-2 border-blue-200 bg-blue-50">
              <CardHeader className="pb-2">
                <CardTitle className="text-center">Faites deviner</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-6 md:py-8">
                  <div className="inline-block bg-blue-600 text-white px-8 md:px-12 py-4 md:py-6 rounded-xl text-3xl md:text-5xl font-black">
                    {word}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-3">
            <Card className="border-2 border-blue-100">
              <CardHeader className="pb-2 bg-blue-50">
                <CardTitle className="text-base">
                  {!isGiver && <span className="text-blue-600">→ </span>}
                  Indices
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-2">
                {attempts.map((att, i) => (
                  <div key={i} className={`p-2 rounded ${i % 2 === 0 ? 'bg-blue-50' : 'bg-white'} border`}>
                    <p className="font-bold">{att.clue}</p>
                  </div>
                ))}
                {attempts.length === 0 && <p className="text-center text-gray-400 py-4 text-sm">Aucun indice</p>}
              </CardContent>
            </Card>

            <Card className="border-2 border-indigo-100">
              <CardHeader className="pb-2 bg-indigo-50">
                <CardTitle className="text-base">
                  Réponses
                  {isGiver && <span className="text-indigo-600"> ←</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-2">
                {attempts.map((att, i) => (
                  <div key={i} className={`p-2 rounded ${att.correct ? 'bg-green-100 border-green-300' : 'bg-red-50 border-red-200'} border`}>
                    <p className="font-bold">{att.guess || '...'}</p>
                  </div>
                ))}
                {attempts.length === 0 && <p className="text-center text-gray-400 py-4 text-sm">Aucune réponse</p>}
              </CardContent>
            </Card>
          </div>

          {clueError && (
            <div className="p-3 bg-red-100 border-2 border-red-300 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-red-600" />
              <p className="text-sm font-semibold text-red-700">{clueError}</p>
            </div>
          )}

          {isGiver && attemptsLeft > 0 && !waitingForPartner && (
            (attempts.length === 0 || (attempts[attempts.length - 1].guess && !attempts[attempts.length - 1].correct)) && (
              <Card className="border-2 border-blue-200">
                <CardContent className="p-4">
                  <form onSubmit={(e) => { e.preventDefault(); sendClue(); }} className="flex gap-2">
                    <input
                      type="text"
                      value={currentClue}
                      onChange={(e) => setCurrentClue(e.target.value)}
                      placeholder="Votre indice..."
                      className="flex-1 px-4 py-3 border-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      maxLength={50}
                      autoFocus
                      required
                    />
                    <Button type="submit" disabled={!currentClue.trim()} className="bg-blue-600 px-6">
                      <Send className="w-5 h-5" />
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )
          )}

          {!isGiver && attempts.length > 0 && !attempts[attempts.length - 1].guess && !waitingForPartner && (
            <Card className="border-2 border-indigo-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">À vous de deviner !</CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <form onSubmit={(e) => { e.preventDefault(); sendGuess(); }}>
                  <input
                    type="text"
                    value={currentGuess}
                    onChange={(e) => setCurrentGuess(e.target.value.toUpperCase())}
                    placeholder="RÉPONSE..."
                    className="w-full px-4 py-4 border-2 rounded-lg text-center font-black text-2xl uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    maxLength={30}
                    autoFocus
                    required
                  />
                  <Button type="submit" disabled={!currentGuess.trim()} className="w-full bg-indigo-600 py-4 mt-3">
                    <Send className="mr-2" />
                    Envoyer
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {waitingForPartner && (
            <div className="text-center py-6">
              <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin text-blue-600" />
              <p className="text-gray-600">En attente de {partnerPseudo}...</p>
            </div>
          )}

          <div className="bg-gray-100 border rounded-lg p-4 text-center text-xs text-gray-500">
            Publicité - 728x90
          </div>
        </div>
      </div>
    );
  }

  // PAGE RESULTS
  if (gameState === 'results') {
    const isPerfect = teamScore === 4;
    const wordsFound = teamScore;
    const wordsMissed = 4 - teamScore;
    const pointsGained = (wordsFound * 25) - (wordsMissed * 10);

    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl border-2 border-blue-100">
          <CardContent className="p-8 space-y-6">
            <div className="text-center">
              {isPerfect ? (
                <div className="w-24 h-24 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Crown className="w-12 h-12 text-yellow-600" />
                </div>
              ) : teamScore >= 2 ? (
                <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Trophy className="w-12 h-12 text-green-600" />
                </div>
              ) : (
                <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Star className="w-12 h-12 text-gray-400" />
                </div>
              )}
              <h2 className="text-4xl font-bold">
                {isPerfect ? "VICTOIRE PARFAITE !" : teamScore >= 2 ? "Bien joué !" : "Dommage..."}
              </h2>
              <p className="text-gray-600 mt-2">Avec {partnerPseudo}</p>
            </div>

            <div className="text-center py-6">
              <div className="text-7xl font-black text-blue-600">{teamScore}/4</div>
              <p className="text-gray-600 mt-2">Mots trouvés</p>
            </div>

            <div className="bg-gray-50 rounded-lg p-6 border">
              <h3 className="font-bold text-lg mb-3">Récapitulatif</h3>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Mots trouvés :</span>
                  <span className="font-bold text-green-600">+{wordsFound * 25} pts</span>
                </div>
                <div className="flex justify-between">
                  <span>Mots manqués :</span>
                  <span className="font-bold text-red-600">-{wordsMissed * 10} pts</span>
                </div>
                <div className="border-t pt-2 mt-2">
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total :</span>
                    <span className={pointsGained >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {pointsGained >= 0 ? '+' : ''}{pointsGained} pts
                    </span>
                  </div>
                </div>
                <div className="border-t pt-2 mt-2 bg-blue-50 -mx-6 px-6 py-2 rounded">
                  <div className="flex justify-between text-xl font-bold">
                    <span>Nouveau score :</span>
                    <span className="text-blue-600">{playerScore} pts</span>
                  </div>
                </div>
              </div>
            </div>

            <Button onClick={() => {
              setGameState('home');
            }} className="w-full bg-blue-600 hover:bg-blue-700 text-xl py-6">
              <Play className="mr-2 w-6 h-6" />
              Retour à l'accueil
            </Button>

            <div className="bg-gray-100 border rounded-lg p-8 text-center text-xs text-gray-500">
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