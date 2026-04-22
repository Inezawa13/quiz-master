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

let gameState = {
  phase: 'waiting',
  players: {},
  rounds: [
    { name: "L'Éveil de Seiya", timer: 40, questions: [] },
    { name: "La Fureur d'Ikki", timer: 45, questions: [] },
    { name: "Le Jugement de Saga", timer: 45, questions: [] },
    { name: "La Malédiction d'Hadès", timer: 50, questions: [] },
    { name: "Le Cosmos d'Athéna", timer: 55, questions: [] },
  ],
  currentRoundIndex: -1,
  currentQuestionIndex: -1,
  currentQuestion: null,
  currentRound: null,
  answers: {},
  answerTimes: {},
  scores: {},
  introVideo: null,
  paused: false,
};

function broadcastAll(data) {
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data)); });
}
function broadcastMaster(data) {
  wss.clients.forEach(c => { if (c.isMaster && c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data)); });
}
function broadcastPlayers(data) {
  wss.clients.forEach(c => { if (!c.isMaster && c.readyState === WebSocket.OPEN) c.send(JSON.stringify(data)); });
}

function getLeaderboard() {
  return Object.entries(gameState.scores)
    .map(([id, score]) => ({ id, name: gameState.players[id]?.name || id, score }))
    .sort((a, b) => b.score - a.score);
}

function getCurrentQuestions() {
  if (gameState.currentRoundIndex < 0) return [];
  return gameState.rounds[gameState.currentRoundIndex]?.questions || [];
}

function calcPoints(playerId) {
  const q = gameState.currentQuestion;
  const basePoints = q.points || 100;
  // Speed bonus: rank among correct answers
  const correctAnswers = Object.entries(gameState.answers)
    .filter(([pid, ans]) => {
      if (q.type === 'qcm' || q.type === 'vrai_faux') return ans === q.correctAnswer;
      return ans?.toLowerCase().trim() === q.correctAnswer?.toLowerCase().trim();
    })
    .sort((a, b) => (gameState.answerTimes[a[0]] || 0) - (gameState.answerTimes[b[0]] || 0));
  const rank = correctAnswers.findIndex(([pid]) => pid === playerId);
  if (rank === -1) return 0;
  // Bonus: 1st = +50, 2nd = +30, 3rd = +20, rest = +0
  const bonuses = [50, 30, 20];
  return basePoints + (bonuses[rank] || 0);
}

wss.on('connection', (ws) => {
  ws.id = Math.random().toString(36).substr(2, 9);

  ws.on('message', (message) => {
    let data;
    try { data = JSON.parse(message); } catch { return; }

    switch (data.type) {

      case 'master_auth':
        if (data.password === MASTER_PASSWORD) {
          ws.isMaster = true;
          ws.send(JSON.stringify({ type: 'master_auth_ok' }));
          ws.send(JSON.stringify({ type: 'state_update', state: gameState, leaderboard: getLeaderboard() }));
        } else {
          ws.send(JSON.stringify({ type: 'master_auth_fail' }));
        }
        break;

      case 'master_set_rounds':
        if (!ws.isMaster) return;
        data.rounds.forEach((r, i) => {
          if (gameState.rounds[i]) gameState.rounds[i].questions = r.questions;
        });
        ws.send(JSON.stringify({ type: 'rounds_saved' }));
        break;

      case 'master_set_round_questions':
        if (!ws.isMaster) return;
        if (gameState.rounds[data.roundIndex]) {
          gameState.rounds[data.roundIndex].questions = data.questions;
        }
        ws.send(JSON.stringify({ type: 'round_questions_saved', roundIndex: data.roundIndex }));
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
        gameState.phase = 'round_intro';
        gameState.currentRoundIndex = 0;
        gameState.currentQuestionIndex = 0;
        gameState.currentRound = gameState.rounds[0];
        gameState.answers = {};
        gameState.answerTimes = {};
        gameState.paused = false;
        broadcastAll({
          type: 'phase_change',
          phase: 'round_intro',
          round: { name: gameState.currentRound.name, index: 0, total: gameState.rounds.length, timer: gameState.currentRound.timer },
        });
        break;

      case 'master_start_round':
        if (!ws.isMaster) return;
        gameState.phase = 'question';
        gameState.currentQuestion = getCurrentQuestions()[gameState.currentQuestionIndex];
        gameState.answers = {};
        gameState.answerTimes = {};
        broadcastAll({
          type: 'phase_change',
          phase: 'question',
          question: gameState.currentQuestion,
          index: gameState.currentQuestionIndex,
          total: getCurrentQuestions().length,
          round: { name: gameState.currentRound.name, index: gameState.currentRoundIndex, total: gameState.rounds.length, timer: gameState.currentRound.timer },
        });
        break;

      case 'master_pause':
        if (!ws.isMaster) return;
        gameState.paused = true;
        broadcastAll({ type: 'paused' });
        break;

      case 'master_resume':
        if (!ws.isMaster) return;
        gameState.paused = false;
        broadcastAll({ type: 'resumed' });
        break;

      case 'master_next_question':
        if (!ws.isMaster) return;
        // Calc scores
        Object.keys(gameState.answers).forEach(playerId => {
          const pts = calcPoints(playerId);
          if (pts > 0) gameState.scores[playerId] = (gameState.scores[playerId] || 0) + pts;
        });
        broadcastAll({
          type: 'show_answer',
          correctAnswer: gameState.currentQuestion.correctAnswer,
          answers: gameState.answers,
          leaderboard: getLeaderboard(),
        });
        broadcastMaster({ type: 'players_update', players: Object.values(gameState.players), leaderboard: getLeaderboard() });

        setTimeout(() => {
          const questions = getCurrentQuestions();
          gameState.currentQuestionIndex++;

          if (gameState.currentQuestionIndex >= questions.length) {
            gameState.currentRoundIndex++;
            if (gameState.currentRoundIndex >= gameState.rounds.length) {
              gameState.phase = 'end';
              broadcastAll({ type: 'phase_change', phase: 'end', leaderboard: getLeaderboard() });
            } else {
              gameState.currentRound = gameState.rounds[gameState.currentRoundIndex];
              gameState.currentQuestionIndex = 0;
              gameState.answers = {};
              gameState.answerTimes = {};
              gameState.phase = 'round_intro';
              broadcastAll({
                type: 'phase_change',
                phase: 'round_intro',
                round: { name: gameState.currentRound.name, index: gameState.currentRoundIndex, total: gameState.rounds.length, timer: gameState.currentRound.timer },
              });
            }
          } else {
            gameState.currentQuestion = questions[gameState.currentQuestionIndex];
            gameState.answers = {};
            gameState.answerTimes = {};
            gameState.phase = 'question';
            broadcastAll({
              type: 'phase_change',
              phase: 'question',
              question: gameState.currentQuestion,
              index: gameState.currentQuestionIndex,
              total: questions.length,
              round: { name: gameState.currentRound.name, index: gameState.currentRoundIndex, total: gameState.rounds.length, timer: gameState.currentRound.timer },
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
        gameState.currentRoundIndex = -1;
        gameState.currentQuestionIndex = -1;
        gameState.currentQuestion = null;
        gameState.currentRound = null;
        gameState.answers = {};
        gameState.answerTimes = {};
        gameState.scores = {};
        gameState.paused = false;
        gameState.rounds.forEach(r => r.questions = []);
        broadcastAll({ type: 'phase_change', phase: 'waiting' });
        break;

      case 'player_join':
        gameState.players[ws.id] = { name: data.name, id: ws.id };
        gameState.scores[ws.id] = 0;
        ws.playerName = data.name;
        ws.send(JSON.stringify({ type: 'joined', id: ws.id, phase: gameState.phase }));
        broadcastMaster({ type: 'players_update', players: Object.values(gameState.players), leaderboard: getLeaderboard() });
        broadcastAll({ type: 'player_joined', name: data.name, id: ws.id, count: Object.keys(gameState.players).length });
        break;

      case 'player_answer':
        if (!gameState.players[ws.id]) return;
        if (gameState.answers[ws.id]) return;
        if (gameState.paused) return;
        gameState.answers[ws.id] = data.answer;
        gameState.answerTimes[ws.id] = Date.now();
        ws.send(JSON.stringify({ type: 'answer_received' }));
        broadcastMaster({
          type: 'answer_update',
          playerId: ws.id,
          playerName: gameState.players[ws.id]?.name,
          answer: data.answer,
          count: Object.keys(gameState.answers).length,
          total: Object.keys(gameState.players).length,
        });
        break;
    }
  });

  ws.on('close', () => {
    if (gameState.players[ws.id]) {
      delete gameState.players[ws.id];
      broadcastMaster({ type: 'players_update', players: Object.values(gameState.players), leaderboard: getLeaderboard() });
      broadcastAll({ type: 'player_left', id: ws.id, count: Object.keys(gameState.players).length });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Quiz server running on port ${PORT}`));
