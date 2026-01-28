require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const pool = require('./config/db');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

app.use(session({
    secret: process.env.SESSION_SECRET || 'segredo_sonda_saas_v2',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// --- MIDDLEWARE DE AUTENTICAÇÃO ---
const checkAuth = (req, res, next) => { 
    if (req.session.user) next(); 
    else res.redirect('/login'); 
};

// --- ROTAS DE PÁGINAS ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/orcamento', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/engenharia', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html'))); 
app.get('/crm', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/boletim', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- API LOGIN COMPATÍVEL COM V2 ---
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        // Busca na tabela usuarios (que usa UUID agora)
        const result = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email.trim()]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            // Comparação simples conforme seu script de insert (123456)
            if (senha.trim() === user.senha_hash) {
                req.session.user = { id: user.id, empresa_id: user.empresa_id, nome: user.nome };
                return res.sendStatus(200);
            }
        }
        res.status(401).send('Credenciais inválidas');
    } catch (err) { res.status(500).send(err.message); }
});

// --- IMPORTAÇÃO DOS CONTROLLERS ---
const propostasController = require('./controllers/propostasController');
const boletimController = require('./controllers/boletimController');

// Rotas Propostas (V2)
app.get('/api/propostas', checkAuth, propostasController.listarPropostas);
app.post('/gerar-proposta', checkAuth, propostasController.criarProposta);
app.get('/api/propostas/:id/pdf', checkAuth, propostasController.gerarPDFComercial);
app.get('/gerar-pdf/:id', checkAuth, propostasController.gerarPDFComercial);
app.patch('/api/propostas/:id/status', checkAuth, propostasController.atualizarStatus);
app.delete('/api/propostas/:id', checkAuth, propostasController.deletarProposta);

// Rotas Boletim (Engenharia V2)
app.get('/api/boletim/furos/:obraId', checkAuth, boletimController.listarFuros);
app.post('/api/boletim/furos', checkAuth, boletimController.criarFuro);
app.get('/api/boletim/amostras/:furoId', checkAuth, boletimController.listarAmostras);
app.post('/api/boletim/amostras', checkAuth, boletimController.salvarAmostra);
app.post('/api/boletim/fotos', checkAuth, boletimController.salvarFoto);
app.put('/api/boletim/furos/:id', checkAuth, boletimController.atualizarFuro);
app.get('/api/engenharia/:id', checkAuth, boletimController.dadosCompletosObra); // Nova rota para tela de engenharia

// --- INICIALIZAÇÃO ---
// Nota: Removemos a recriação automática de tabelas aqui porque 
// VOCÊ JÁ RODOU O SCRIPT SQL V2. O código apenas confia que o banco existe.
app.listen(port, () => { console.log(`>>> 🚀 SondaSaaS V2 (UUID) RODANDO na porta ${port}`); });