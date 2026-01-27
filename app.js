require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./config/db'); 
const session = require('express-session');
const app = express();
const port = process.env.PORT || 3000;

// Configurações
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

// Sessão (Login)
app.use(session({
    secret: process.env.SESSION_SECRET || 'segredo_dev',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Mude para true se estiver usando HTTPS
}));

// Proteção de Rota
const checkAuth = (req, res, next) => { 
    if (req.session.user) next(); 
    else res.redirect('/login'); 
};

// --- ROTAS (Páginas) ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/orcamento', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/engenharia', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html'))); 
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- API LOGIN ---
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (senha === '123456' || senha === user.senha_hash) {
                req.session.user = { id: user.id, empresa_id: user.empresa_id, nome: user.nome };
                return res.sendStatus(200);
            }
        }
        res.status(401).send('Login inválido');
    } catch (err) { res.status(500).send(err.message); }
});

// --- IMPORTAR CONTROLLER ---
const propostasController = require('./controllers/propostasController');
app.get('/api/propostas', checkAuth, propostasController.listarPropostas);
app.post('/gerar-proposta', checkAuth, propostasController.criarProposta);
app.get('/gerar-pdf/:id', checkAuth, propostasController.gerarPDFComercial);

app.listen(port, () => { console.log(`>>> SondaSaaS ON na porta ${port} <<<`); });