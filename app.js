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

// --- 1. AUTO-REPARO DE EMERGÊNCIA (CORRIGE O BANCO V1 PARA V2) ---
async function corrigirBanco() {
    try {
        console.log('>>> 🛠️  VERIFICANDO ESTRUTURA DO BANCO...');
        
        // Garante a extensão de UUID
        await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

        // TABELA PROPOSTAS (Adiciona as colunas V2 que faltam e causaram o erro)
        const alteracoes = [
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS tecnico_responsavel VARCHAR(255)`, // <--- O ERRO DA SUA TELA
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ORCAMENTO'`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_art DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_mobilizacao DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_desconto DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS nome_arquivo_pdf VARCHAR(255)`,
            `ALTER TABLE propostas ALTER COLUMN status SET DEFAULT 'ORCAMENTO'`
        ];

        for (const sql of alteracoes) {
            try { await pool.query(sql); } catch (e) { /* Ignora se já existir */ }
        }

        console.log('>>> ✅ BANCO CORRIGIDO PARA V2!');
    } catch (err) {
        console.error('!!! ERRO AO CORRIGIR BANCO !!!', err.message);
    }
}

// --- MIDDLEWARES ---
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

// --- IMPORTAÇÃO DOS CONTROLLERS (CORRIGIDO PARA O NOME REAL DOS ARQUIVOS) ---
// ATENÇÃO: Aqui estava o erro do Crash. O arquivo é 'boletimcontroller.js' (minúsculo)
const propostasController = require('./controllers/propostasController');
const boletimController = require('./controllers/boletimcontroller'); 

// Rotas Propostas
app.get('/api/propostas', checkAuth, propostasController.listarPropostas);
app.post('/gerar-proposta', checkAuth, propostasController.criarProposta);
app.get('/api/propostas/:id/pdf', checkAuth, propostasController.gerarPDFComercial);
app.get('/gerar-pdf/:id', checkAuth, propostasController.gerarPDFComercial);
app.patch('/api/propostas/:id/status', checkAuth, propostasController.atualizarStatus); // PATCH (Kanban)
app.post('/api/propostas/:id/status', checkAuth, propostasController.atualizarStatus); // POST (Fallback)
app.delete('/api/propostas/:id', checkAuth, propostasController.deletarProposta);

// Rotas Boletim / Engenharia
app.get('/api/boletim/furos/:obraId', checkAuth, boletimController.listarFuros);
app.post('/api/boletim/furos', checkAuth, boletimController.criarFuro);
app.get('/api/boletim/amostras/:furoId', checkAuth, boletimController.listarAmostras);
app.post('/api/boletim/amostras', checkAuth, boletimController.salvarAmostra);
app.post('/api/boletim/fotos', checkAuth, boletimController.salvarFoto);
app.put('/api/boletim/furos/:id', checkAuth, boletimController.atualizarFuro);
app.get('/api/engenharia/:id', checkAuth, boletimController.dadosCompletosObra);

// --- INICIALIZAÇÃO ---
// Roda a correção do banco antes de abrir a porta
corrigirBanco().then(() => {
    app.listen(port, () => { console.log(`>>> 🚀 SondaSaaS V2 (RESCUE MODE) RODANDO na porta ${port}`); });
});