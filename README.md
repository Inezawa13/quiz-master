# ⚡ QuizMaster — Guide de déploiement

## Structure du projet
```
quiz-app/
├── server.js          → Serveur Node.js (WebSocket + Express)
├── package.json       → Dépendances
└── public/
    ├── index.html     → Vue joueurs (téléphone)
    └── master.html    → Panel maître (toi)
```

---

## 🚀 Déploiement sur Railway (gratuit)

### 1. Préparer GitHub
1. Crée un compte sur [github.com](https://github.com) si tu n'en as pas
2. Crée un **nouveau repository** (bouton vert "+ New")
3. Nom : `quiz-app`, coche "Add a README file"
4. Upload tous les fichiers du projet dans ce repo

### 2. Déployer sur Railway
1. Va sur [railway.app](https://railway.app) → **Login with GitHub**
2. Clique **"New Project"** → **"Deploy from GitHub repo"**
3. Sélectionne ton repo `quiz-app`
4. Railway détecte Node.js automatiquement ✅
5. Va dans **Settings** → **Environment Variables** → ajoute :
   - `MASTER_PASSWORD` = `ton_mot_de_passe_secret`
6. Va dans **Settings** → **Networking** → **Generate Domain**
7. Tu obtiens une URL type : `https://quiz-app-xxxx.railway.app`

---

## 🎮 Utilisation le soir J

### Toi (maître)
- Ouvre : `https://ton-url.railway.app/master.html`
- Entre ton mot de passe maître
- Ajoute tes questions dans le panel
- (Optionnel) Colle une URL YouTube pour l'intro

### Les joueurs
- Ils ouvrent : `https://ton-url.railway.app`
- Ils entrent leur pseudo et rejoignent

### Déroulé de la soirée
1. Lance l'intro vidéo (bouton ▶️)
2. Démarre le quiz (bouton 🚀)
3. Les joueurs répondent sur leur téléphone
4. Tu passes à la question suivante quand tu veux (bouton ⏭)
5. Entre chaque question, tu peux afficher le classement (🏆)

---

## 🔧 Personnalisation

Pour changer les couleurs, ouvre `public/index.html` et `public/master.html`
et modifie les variables CSS dans `:root { ... }` en haut du fichier.

Couleurs principales :
- `--accent` : couleur principale (violet par défaut)
- `--bg` : couleur de fond
- `--gold` : couleur or (classement)
- `--green` : bonnes réponses
- `--red` : mauvaises réponses

---

## Types de questions disponibles
- **QCM** : choix multiples (jusqu'à 4 réponses)
- **Vrai / Faux** : boutons Vrai et Faux
- **Réponse libre** : champ texte libre
- **Texte à trou** : utilise ___ dans ta question (ex: "La capitale de la France est ___")

## Mot de passe par défaut
Si tu ne définis pas `MASTER_PASSWORD` sur Railway, le mot de passe par défaut est : `master123`
**Change-le avant ta soirée !**
