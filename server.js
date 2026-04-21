const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

const MASTER_PASSWORD = process.env.MASTER_PASSWORD || 'master123';

// Game state
let gameState = {
  phase: 'waiting', // waiting | intro | question | results | leaderboard | end
  players: {},
  questions: [],
  currentQuestionIndex: -1,
  currentQuestion: null,
  answers: {},
  scores: {},
  introVideo: null,
};

function broadcast(data, excludeWs = null) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN && client !== excludeWs) {
      client.send(JSON.stringify(data));
    }
  });
}

function broadcastAll(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

function getLeaderboard() {
  return Object.entries(gameState.scores)
    .map(([id, score]) => ({ id, name: gameState.players[id]?.name || id, score }))
    .sort((a, b) => b.score - a.score);
}

wss.on('connection', (ws) => {
  ws.id = Math.random().toString(36).substr(2, 9);

  ws.on('message', (message) => {
    let data;
    try { data = JSON.parse(message); } catch { return; }

    switch (data.type) {

      // --- MASTER ---
      case 'master_auth':
        if (data.password === MASTER_PASSWORD) {
          ws.isMaster = true;
          ws.send(JSON.stringify({ type: 'master_auth_ok' }));
          ws.send(JSON.stringify({ type: 'state_update', state: gameState, leaderboard: getLeaderboard() }));
        } else {
          ws.send(JSON.stringify({ type: 'master_auth_fail' }));
        }
        break;

      case 'master_set_questions':
        if (!ws.isMaster) return;
        gameState.questions = data.questions;
        ws.send(JSON.stringify({ type: 'questions_saved', count: data.questions.length }));
        break;

      case 'master_set_intro':
        if (!ws.isMaster) return;
        gameState.introVideo = data.url;
        ws.send(JSON.stringify({ type: 'intro_saved' }));
        break;

      case 'master_start_intro':
        if (!ws.isMaster) return;
        gameState.phase = 'intro';
        broadcastAll({ type: 'phase_change', phase: 'intro', videoUrl: gameState.introVideo });
        break;

      case 'master_start_game':
        if (!ws.isMaster) return;
        gameState.phase = 'question';
        gameState.currentQuestionIndex = 0;
        gameState.currentQuestion = gameState.questions[0];
        gameState.answers = {};
        broadcastAll({
          type: 'phase_change',
          phase: 'question',
          question: gameState.currentQuestion,
          index: 0,
          total: gameState.questions.length
        });
        break;

      case 'master_next_question':
        if (!ws.isMaster) return;
        // Show correct answer first
        broadcastAll({
          type: 'show_answer',
          correctAnswer: gameState.currentQuestion.correctAnswer,
          answers: gameState.answers
        });
        // Update scores
        Object.entries(gameState.answers).forEach(([playerId, answer]) => {
          const q = gameState.currentQuestion;
          let correct = false;
          if (q.type === 'qcm') correct = answer === q.correctAnswer;
          if (q.type === 'vrai_faux') correct = answer === q.correctAnswer;
          if (q.type === 'texte') correct = answer?.toLowerCase().trim() === q.correctAnswer?.toLowerCase().trim();
          if (q.type === 'trou') correct = answer?.toLowerCase().trim() === q.correctAnswer?.toLowerCase().trim();
          if (correct) gameState.scores[playerId] = (gameState.scores[playerId] || 0) + (q.points || 100);
        });
        setTimeout(() => {
          gameState.currentQuestionIndex++;
          if (gameState.currentQuestionIndex >= gameState.questions.length) {
            gameState.phase = 'end';
            broadcastAll({ type: 'phase_change', phase: 'end', leaderboard: getLeaderboard() });
          } else {
            gameState.currentQuestion = gameState.questions[gameState.currentQuestionIndex];
            gameState.answers = {};
            broadcastAll({
              type: 'phase_change',
              phase: 'question',
              question: gameState.currentQuestion,
              index: gameState.currentQuestionIndex,
              total: gameState.questions.length
            });
          }
        }, 4000);
        break;

      case 'master_show_leaderboard':
        if (!ws.isMaster) return;
        broadcastAll({ type: 'phase_change', phase: 'leaderboard', leaderboard: getLeaderboard() });
        break;

      case 'master_reset':
        if (!ws.isMaster) return;
        gameState.phase = 'waiting';
        gameState.currentQuestionIndex = -1;
        gameState.currentQuestion = null;
        gameState.answers = {};
        gameState.scores = {};
        broadcastAll({ type: 'phase_change', phase: 'waiting' });
        break;

      // --- PLAYER ---
      case 'player_join':
        gameState.players[ws.id] = { name: data.name, id: ws.id };
        gameState.scores[ws.id] = 0;
        ws.playerName = data.name;
        ws.send(JSON.stringify({ type: 'joined', id: ws.id, phase: gameState.phase }));
        broadcast({ type: 'player_joined', name: data.name, id: ws.id, count: Object.keys(gameState.players).length });
        // Notify master
        wss.clients.forEach(c => {
          if (c.isMaster && c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({ type: 'players_update', players: Object.values(gameState.players), leaderboard: getLeaderboard() }));
          }
        });
        break;

      case 'player_answer':
        if (!gameState.players[ws.id]) return;
        if (gameState.answers[ws.id]) return; // already answered
        gameState.answers[ws.id] = data.answer;
        ws.send(JSON.stringify({ type: 'answer_received' }));
        // Notify master
        wss.clients.forEach(c => {
          if (c.isMaster && c.readyState === WebSocket.OPEN) {
            c.send(JSON.stringify({
              type: 'answer_update',
              playerId: ws.id,
              playerName: gameState.players[ws.id]?.name,
              answer: data.answer,
              count: Object.keys(gameState.answers).length,
              total: Object.keys(gameState.players).length
            }));
          }
        });
        break;
    }
  });

  ws.on('close', () => {
    if (gameState.players[ws.id]) {
      delete gameState.players[ws.id];
      broadcast({ type: 'player_left', id: ws.id, count: Object.keys(gameState.players).length });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Quiz server running on port ${PORT}`));
