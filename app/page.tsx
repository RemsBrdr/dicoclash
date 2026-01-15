"use client"

import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Swords, LogIn, Users, Send, Loader2, Trophy, Star } from "lucide-react";

interface Attempt {
  clue: string;
  guess: string;
  correct: boolean;
}

const DicoClash = () => {
  const [gameState, setGameState] = useState<"login" | "queue" | "playing" | "results">("login");
  const [pseudo, setPseudo] = useState("");
  const [ws, setWs] = useState<WebSocket | null>(null);
  const [playerId] = useState(crypto.randomUUID());
  const [gameId, setGameId] = useState("");
  const [opponentPseudo, setOpponentPseudo] = useState("");
  const [isGiver, setIsGiver] = useState(false);
  const [word, setWord] = useState("");
  const [round, setRound] = useState(1);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [currentClue, setCurrentClue] = useState("");
  const [currentGuess, setCurrentGuess] = useState("");
  const [timeLeft, setTimeLeft] = useState(60);
  const [player1Score, setPlayer1Score] = useState(0);
  const [player2Score, setPlayer2Score] = useState(0);
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);

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
          setPlayer1Score(data.player1Score);
          setPlayer2Score(data.player2Score);
          setGameState('results');
          break;

        case 'opponent_disconnected':
          alert('Adversaire déconnecté');
          setGameState('login');
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

  const joinQueue = () => {
    if (ws && ws.readyState === WebSocket.OPEN && pseudo.trim()) {
      ws.send(JSON.stringify({
        type: 'join_queue',
        playerId,
        pseudo: pseudo.trim()
      }));
      setGameState('queue');
    }
  };

  const sendClue = () => {
    if (ws && currentClue.trim()) {
      ws.send(JSON.stringify({
        type: 'send_clue',
        gameId,
        clue: currentClue.trim()
      }));
      setCurrentClue('');
    }
  };

  const sendGuess = () => {
    if (ws && currentGuess.trim()) {
      ws.send(JSON.stringify({
        type: 'send_guess',
        gameId,
        guess: currentGuess.trim()
      }));
      setCurrentGuess('');
    }
  };

  if (gameState === 'login') {
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
            <p className="text-gray-600 mt-2">WebSocket - Temps réel</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Votre pseudo</label>
              <input
                type="text"
                value={pseudo}
                onChange={(e) => setPseudo(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && joinQueue()}
                placeholder="Votre pseudo..."
                className="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
                maxLength={20}
              />
            </div>
            <Button
              onClick={joinQueue}
              disabled={!pseudo.trim() || !ws || ws.readyState !== WebSocket.OPEN}
              className="w-full bg-gradient-to-r from-rose-600 to-rose-700 text-lg py-6 rounded-xl"
            >
              <LogIn className="mr-2 w-5 h-5" />
              Jouer
            </Button>
            {(!ws || ws.readyState !== WebSocket.OPEN) && (
              <p className="text-sm text-orange-600 text-center">Connexion au serveur...</p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState === 'queue') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-indigo-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md border-2 border-rose-100">
          <CardContent className="p-8 text-center space-y-6">
            <div className="w-20 h-20 bg-rose-100 rounded-full flex items-center justify-center mx-auto">
              <Users className="w-10 h-10 text-rose-600 animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Recherche d'adversaire...</h2>
              <p className="text-gray-600">En attente de connexion</p>
            </div>
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-rose-600" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (gameState === 'playing') {
    const attemptsLeft = 4 - attempts.length;

    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-indigo-50 p-4">
        <div className="max-w-5xl mx-auto space-y-4">
          <Card className="border-2 border-rose-100">
            <CardContent className="p-4">
              <div className="flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold">Round {round}/4</h2>
                  <Badge variant={isGiver ? "default" : "secondary"} className={isGiver ? "bg-rose-600 mt-1" : "mt-1"}>
                    {isGiver ? "🎯 Donneur" : "🔍 Devineur"}
                  </Badge>
                </div>
                <div className="text-right">
                  <p className="text-sm">vs {opponentPseudo}</p>
                  <p className="text-2xl font-bold">Temps: {timeLeft}s</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {isGiver && (
            <Card className="border-2 border-rose-100">
              <CardHeader>
                <CardTitle className="text-center">Votre mot</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-center py-12">
                  <div className="inline-block bg-gradient-to-r from-rose-600 to-indigo-600 text-white px-12 py-6 rounded-2xl text-5xl font-black">
                    {word}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="border-2 border-gray-100">
            <CardHeader>
              <CardTitle>Historique</CardTitle>
              <p className="text-sm text-gray-600">{attemptsLeft} tentative(s) restante(s)</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {attempts.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  {isGiver ? "Donnez le premier indice" : `En attente de ${opponentPseudo}...`}
                </div>
              )}

              {attempts.map((att, i) => (
                <div key={i} className="border-2 rounded-xl p-4 bg-gray-50">
                  <div className="flex gap-3 mb-2">
                    <Badge>#{i + 1}</Badge>
                    <div className="flex-1">
                      <p className="text-sm text-gray-600">Indice :</p>
                      <p className="font-bold text-lg">{att.clue}</p>
                    </div>
                  </div>
                  {att.guess && (
                    <div className="flex gap-3 mt-3 pt-3 border-t">
                      <Badge variant={att.correct ? "default" : "destructive"} className={att.correct ? "bg-green-600" : ""}>
                        {att.correct ? "✓" : "✗"}
                      </Badge>
                      <p><b>{att.guess}</b></p>
                    </div>
                  )}
                  {!att.guess && <p className="text-sm text-gray-500 italic mt-2 pt-2 border-t">En attente de réponse...</p>}
                </div>
              ))}

              {isGiver && attemptsLeft > 0 && !waitingForOpponent && (
                (attempts.length === 0 || (attempts[attempts.length - 1].guess && !attempts[attempts.length - 1].correct)) && (
                  <Card className="border-2 border-rose-100 bg-rose-50">
                    <CardContent className="p-4">
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={currentClue}
                          onChange={(e) => setCurrentClue(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && sendClue()}
                          placeholder="Votre indice..."
                          className="flex-1 px-4 py-3 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-rose-500"
                          maxLength={50}
                          autoFocus
                        />
                        <Button onClick={sendClue} disabled={!currentClue.trim()} className="bg-rose-600 px-6">
                          <Send className="w-5 h-5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              )}

              {!isGiver && attempts.length > 0 && !attempts[attempts.length - 1].guess && (
                <Card className="border-2 border-indigo-100 bg-indigo-50">
                  <CardHeader>
                    <CardTitle>À vous de deviner !</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <input
                      type="text"
                      value={currentGuess}
                      onChange={(e) => setCurrentGuess(e.target.value.toUpperCase())}
                      onKeyPress={(e) => e.key === 'Enter' && sendGuess()}
                      placeholder="RÉPONSE..."
                      className="w-full px-4 py-4 border-2 rounded-xl text-center font-black text-2xl uppercase focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      maxLength={30}
                      autoFocus
                    />
                    <Button onClick={sendGuess} disabled={!currentGuess.trim()} className="w-full bg-indigo-600 py-4">
                      <Send className="mr-2" />
                      Valider
                    </Button>
                  </CardContent>
                </Card>
              )}

              {waitingForOpponent && (
                <div className="text-center py-6">
                  <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
                  <p className="text-gray-600">En attente de {opponentPseudo}...</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (gameState === 'results') {
    const myScore = player1Score;
    const opScore = player2Score;
    const won = myScore > opScore;

    return (
      <div className="min-h-screen bg-gradient-to-br from-rose-50 via-white to-indigo-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-2xl border-2 border-rose-100">
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
              <h2 className="text-4xl font-bold">
                {myScore === opScore ? "Match nul !" : won ? "Victoire !" : "Défaite"}
              </h2>
            </div>

            <div className="flex justify-center gap-16 py-8">
              <div className="text-center">
                <p className="text-sm mb-2">{pseudo}</p>
                <p className="text-6xl font-bold text-indigo-600">{myScore}</p>
              </div>
              <div className="text-6xl text-gray-300">-</div>
              <div className="text-center">
                <p className="text-sm mb-2">{opponentPseudo}</p>
                <p className="text-6xl font-bold text-rose-600">{opScore}</p>
              </div>
            </div>

            <Button onClick={() => {
              setGameState('login');
              setPseudo('');
            }} className="w-full bg-gradient-to-r from-rose-600 to-rose-700">
              Rejouer
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
};

export default DicoClash;