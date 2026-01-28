require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// --- CONEXÃO ---
const connectionString = process.env.DATABASE_URL || "postgres://sondasaas_db_user:QhOwhbqwMaso6EpV49iC29JIHRbNaabb@dpg-d5ocbter433s7381d8rg-a.virginia-postgres.render.com/sondasaas_db";
const isProduction = connectionString.includes('render.com');

const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

module.exports = { pool };

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

app.use(session({
    secret: process.env.SESSION_SECRET || 'segredo_sonda_saas',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// --- CORREÇÃO DO BANCO (V2) ---
// Roda silenciosamente para garantir que as tabelas existem sem apagar dados
async function verificarBanco() {
    try {
        await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
        // Garante que a tabela propostas tenha as colunas novas
        await pool.query(`ALTER TABLE propostas ADD COLUMN IF NOT EXISTS tecnico_responsavel VARCHAR(255)`);
        await pool.query(`ALTER TABLE propostas ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ORCAMENTO'`);
        console.log('>>> BANCO VERIFICADO.');
    } catch (e) { console.log('>>> Info Banco:', e.message); }
}

const checkAuth = (req, res, next) => { 
    if (req.session.user) next(); 
    else res.redirect('/login'); 
};

// --- IMPORTAÇÃO DOS CONTROLLERS (AQUI ESTAVA O ERRO FATAL) ---
// Baseado EXATAMENTE no seu print do Explorer:
const propostasController = require('./controllers/propostasController'); // C Maiúsculo
const boletimController = require('./controllers/boletimcontroller');     // c Minúsculo

// --- ROTAS DAS PÁGINAS (Seus arquivos HTML estão aqui) ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// Essas são as páginas que você "perdeu". Elas vão voltar agora.
app.get('/orcamento', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/crm', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/engenharia', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html')));
app.get('/boletim', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));

app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- API LOGIN ---
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const result = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email.trim()]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (String(senha).trim() === String(user.senha_hash).trim()) {
                req.session.user = { id: user.id, empresa_id: user.empresa_id, nome: user.nome };
                return res.sendStatus(200);
            }
        }
        res.status(401).send('Credenciais inválidas');
    } catch (err) { res.status(500).send(err.message); }
});

// --- API PROPOSTAS ---
app.get('/api/propostas', checkAuth, propostasController.listarPropostas);
app.post('/gerar-proposta', checkAuth, propostasController.criarProposta);
app.get('/api/propostas/:id/pdf', checkAuth, propostasController.gerarPDFComercial);
app.get('/gerar-pdf/:id', checkAuth, propostasController.gerarPDFComercial);
app.patch('/api/propostas/:id/status', checkAuth, propostasController.atualizarStatus);
app.post('/api/propostas/:id/status', checkAuth, propostasController.atualizarStatus);
app.delete('/api/propostas/:id', checkAuth, propostasController.deletarProposta);

// --- API BOLETIM ---
app.get('/api/boletim/furos/:obraId', checkAuth, boletimController.listarFuros);
app.post('/api/boletim/furos', checkAuth, boletimController.criarFuro);
app.get('/api/boletim/amostras/:furoId', checkAuth, boletimController.listarAmostras);
app.post('/api/boletim/amostras', checkAuth, boletimController.salvarAmostra);
app.post('/api/boletim/fotos', checkAuth, boletimController.salvarFoto);
app.put('/api/boletim/furos/:id', checkAuth, boletimController.atualizarFuro);
app.get('/api/engenharia/:id', checkAuth, boletimController.dadosCompletosObra);

// --- START ---
verificarBanco().then(() => {
    app.listen(port, () => { console.log(`>>> 🚀 SONDASAAS ONLINE NA PORTA ${port}`); });
});