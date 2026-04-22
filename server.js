const express = require(‘express’);
const http = require(‘http’);
const WebSocket = require(‘ws’);
const path = require(‘path’);

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, ‘public’)));

const MASTER_PASSWORD = process.env.MASTER_PASSWORD || ‘master123’;

let state = {
phase: ‘waiting’, // waiting | question | answer | leaderboard | end
players: {},      // { id: { id, name, score } }
rounds: [],       // chargées par le master
currentRound: 0,
currentQuestion: 0,
question: null,
answers: {},      // { id: answer }
answerTimes: {},  // { id: timestamp }
};

function broadcast(data, filterFn = () => true) {
const msg = JSON.stringify(data);
wss.clients.forEach(c => {
if (c.readyState === WebSocket.OPEN && filterFn(c)) c.send(msg);
});
}
const toAll = data => broadcast(data);
const toPlayers = data => broadcast(data, c => !c.isMaster);
const toMaster = data => broadcast(data, c => c.isMaster);

function leaderboard() {
return Object.values(state.players)
.sort((a, b) => b.score - a.score)
.map((p, i) => ({ rank: i + 1, name: p.name, score: p.score }));
}

function currentQ() {
const round = state.rounds[state.currentRound];
if (!round) return null;
return round.questions[state.currentQuestion] || null;
}

wss.on(‘connection’, ws => {
ws.id = Math.random().toString(36).substr(2, 9);

ws.on(‘message’, raw => {
let msg;
try { msg = JSON.parse(raw); } catch { return; }

```
// ── MASTER ──────────────────────────────────────────
if (msg.type === 'master_auth') {
  if (msg.password === MASTER_PASSWORD) {
    ws.isMaster = true;
    ws.send(JSON.stringify({ type: 'master_ok', players: Object.values(state.players), leaderboard: leaderboard(), rounds: state.rounds }));
  } else {
    ws.send(JSON.stringify({ type: 'master_fail' }));
  }
  return;
}

if (!ws.isMaster && msg.type !== 'join' && msg.type !== 'answer') return;

switch (msg.type) {

  // Master charge les 5 manches avec toutes les questions
  case 'load_rounds':
    state.rounds = msg.rounds;
    ws.send(JSON.stringify({ type: 'rounds_loaded' }));
    break;

  // Master lance le jeu
  case 'start_game':
    state.phase = 'waiting';
    state.currentRound = 0;
    state.currentQuestion = 0;
    state.answers = {};
    state.answerTimes = {};
    Object.values(state.players).forEach(p => p.score = 0);
    toAll({ type: 'game_started' });
    toMaster({ type: 'state', players: Object.values(state.players), leaderboard: leaderboard() });
    break;

  // Master envoie la question suivante
  case 'next_question': {
    const q = currentQ();
    if (!q) return;
    state.phase = 'question';
    state.question = q;
    state.answers = {};
    state.answerTimes = {};
    const round = state.rounds[state.currentRound];
    toAll({
      type: 'question',
      question: q.text,
      choices: q.choices,
      index: state.currentQuestion + 1,
      total: round.questions.length,
      round: round.name,
      roundIndex: state.currentRound + 1,
    });
    toMaster({ type: 'answer_count', count: 0, total: Object.keys(state.players).length });
    break;
  }

  // Master révèle la réponse
  case 'reveal_answer': {
    const q = state.question;
    if (!q) return;
    state.phase = 'answer';
    // Calcule les points
    const correct = Object.entries(state.answers)
      .filter(([, ans]) => ans === q.correct)
      .sort((a, b) => (state.answerTimes[a[0]] || 0) - (state.answerTimes[b[0]] || 0));
    correct.forEach(([id], i) => {
      const bonus = [50, 30, 20][i] || 0;
      if (state.players[id]) state.players[id].score += 100 + bonus;
    });
    toAll({ type: 'answer_revealed', correct: q.correct, leaderboard: leaderboard() });
    // Avance l'index
    const round = state.rounds[state.currentRound];
    if (state.currentQuestion + 1 < round.questions.length) {
      state.currentQuestion++;
    } else {
      state.currentQuestion = 0;
      state.currentRound++;
    }
    break;
  }

  // Master affiche le classement
  case 'show_leaderboard':
    state.phase = 'leaderboard';
    toAll({ type: 'leaderboard', leaderboard: leaderboard(), round: state.currentRound });
    break;

  // Master termine
  case 'end_game':
    state.phase = 'end';
    toAll({ type: 'game_end', leaderboard: leaderboard() });
    break;

  // ── JOUEUR ──────────────────────────────────────────
  case 'join':
    state.players[ws.id] = { id: ws.id, name: msg.name, score: 0 };
    ws.playerName = msg.name;
    ws.send(JSON.stringify({ type: 'joined', name: msg.name, phase: state.phase }));
    toMaster({ type: 'player_joined', players: Object.values(state.players), leaderboard: leaderboard() });
    toPlayers({ type: 'player_count', count: Object.keys(state.players).length });
    break;

  case 'answer':
    if (state.phase !== 'question') return;
    if (state.answers[ws.id]) return; // déjà répondu
    state.answers[ws.id] = msg.answer;
    state.answerTimes[ws.id] = Date.now();
    ws.send(JSON.stringify({ type: 'answer_ok' }));
    toMaster({
      type: 'answer_count',
      count: Object.keys(state.answers).length,
      total: Object.keys(state.players).length,
      player: ws.playerName,
    });
    break;
}
```

});

ws.on(‘close’, () => {
if (state.players[ws.id]) {
delete state.players[ws.id];
toMaster({ type: ‘player_joined’, players: Object.values(state.players), leaderboard: leaderboard() });
toPlayers({ type: ‘player_count’, count: Object.keys(state.players).length });
}
});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`✅ Serveur lancé sur le port ${PORT}`));