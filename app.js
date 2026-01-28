require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const { Pool } = require('pg');

// Inicializa o App
const app = express();
const port = process.env.PORT || 3000;

// --- 1. CONFIGURAÇÃO DE CONEXÃO AO BANCO ---
// Mantém a lógica híbrida que funciona no seu ambiente
const connectionString = process.env.DATABASE_URL || "postgres://sondasaas_db_user:QhOwhbqwMaso6EpV49iC29JIHRbNaabb@dpg-d5ocbter433s7381d8rg-a.virginia-postgres.render.com/sondasaas_db";
const isProduction = connectionString.includes('render.com');

console.log('--------------------------------------------------');
console.log('>>> 🔌 INICIANDO CONEXÃO COM O BANCO...');
console.log('>>> URL:', isProduction ? 'Produção (Render)' : 'Local/Dev');
console.log('--------------------------------------------------');

const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

// Exporta o pool para ser usado nos controllers (importante!)
module.exports = { pool };

// --- 2. CONFIGURAÇÕES DO EXPRESS ---
// Aumenta o limite para aceitar uploads de fotos do boletim
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

// Configuração de Sessão (CRÍTICO PARA O LOGIN FUNCIONAR)
app.use(session({
    secret: process.env.SESSION_SECRET || 'segredo_super_secreto_sondasaas_2026',
    resave: false,
    saveUninitialized: false, // Importante: false evita criar sessões vazias
    cookie: { 
        secure: false, // Mantém false para garantir que funcione sem HTTPS forçado no início
        maxAge: 24 * 60 * 60 * 1000 // 24 horas de sessão
    }
}));

// --- 3. FUNÇÃO DE AUTO-REPARO DO BANCO (CORREÇÃO DE COLUNAS) ---
// Isso roda ao iniciar para garantir que o banco tenha as colunas novas sem apagar dados
async function verificarBanco() {
    try {
        console.log('>>> 🛠️  VERIFICANDO ESTRUTURA DO BANCO DE DADOS...');
        
        // Garante extensão UUID
        await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

        // Cria tabelas essenciais se não existirem
        await pool.query(`CREATE TABLE IF NOT EXISTS empresas (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), nome_fantasia VARCHAR(255), email_dono VARCHAR(255), cnpj VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), empresa_id UUID REFERENCES empresas(id), nome VARCHAR(255), email VARCHAR(255) UNIQUE, senha_hash VARCHAR(255), nivel_acesso VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS propostas (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), empresa_id UUID REFERENCES empresas(id), cliente VARCHAR(255), email VARCHAR(255), telefone VARCHAR(50), endereco TEXT, furos_previstos INTEGER, metragem_total DECIMAL(10,2), valor_total DECIMAL(10,2), status VARCHAR(50) DEFAULT 'ORCAMENTO', tecnico_responsavel VARCHAR(255), data_criacao TIMESTAMP DEFAULT NOW());`);

        // --- CORREÇÃO DAS COLUNAS FALTANTES (ERRO DO PRINT) ---
        const correcoes = [
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS tecnico_responsavel VARCHAR(255)`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ORCAMENTO'`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_art DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_mobilizacao DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_desconto DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS nome_arquivo_pdf VARCHAR(255)`,
            // Tabelas de Engenharia
            `CREATE TABLE IF NOT EXISTS furos (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), proposta_id UUID REFERENCES propostas(id) ON DELETE CASCADE, nome_furo VARCHAR(50), data_inicio TIMESTAMP, data_termino TIMESTAMP, nivel_agua_inicial DECIMAL(5,2), nivel_agua_final DECIMAL(5,2), coordenadas VARCHAR(100))`,
            `CREATE TABLE IF NOT EXISTS amostras (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), furo_id UUID REFERENCES furos(id) ON DELETE CASCADE, profundidade_ini DECIMAL(5,2), profundidade_fim DECIMAL(5,2), golpe_1 INTEGER, golpe_2 INTEGER, golpe_3 INTEGER, tipo_solo TEXT)`,
            `CREATE TABLE IF NOT EXISTS fotos (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), furo_id UUID REFERENCES furos(id) ON DELETE CASCADE, url_imagem TEXT, legenda VARCHAR(255))`
        ];

        for (const sql of correcoes) {
            try { await pool.query(sql); } catch (e) { /* Ignora se coluna já existe */ }
        }

        // Garante Admin de Segurança
        const checkAdmin = await pool.query("SELECT * FROM usuarios WHERE email = 'admin@sondasaas.com'");
        if (checkAdmin.rows.length === 0) {
            console.log('>>> 👤 RECRIANDO ADMIN DE EMERGÊNCIA...');
            const empRes = await pool.query(`INSERT INTO empresas (nome_fantasia, email_dono, cnpj) VALUES ('SondaSaaS Matriz', 'admin@sondasaas.com', '0001') RETURNING id`);
            await pool.query(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, nivel_acesso) VALUES ($1, 'Admin Supremo', 'admin@sondasaas.com', '123456', 'admin')`, [empRes.rows[0].id]);
        }

        console.log('>>> ✅ BANCO PRONTO PARA OPERAÇÃO!');
    } catch (err) {
        console.error('!!! ERRO CRÍTICO NO BANCO !!!', err.message);
    }
}

// --- 4. MIDDLEWARE DE AUTENTICAÇÃO ---
// Isso protege as páginas. Se a sessão não existir, manda pro login.
const checkAuth = (req, res, next) => { 
    if (req.session && req.session.user) {
        next(); // Usuário logado, pode passar
    } else {
        // Se for requisição de API, retorna 401. Se for página, redireciona.
        if (req.path.startsWith('/api/')) {
            res.status(401).json({ error: 'Não autorizado' });
        } else {
            res.redirect('/login');
        }
    }
};

// --- 5. IMPORTAÇÃO DOS CONTROLLERS ---
// ATENÇÃO: Nomes exatos conforme seu print image_f98c94.png
// Se um desses falhar, o servidor cai.
const propostasController = require('./controllers/propostasController'); // "C" maiúsculo
const boletimController = require('./controllers/boletimcontroller');     // "c" minúsculo (CORREÇÃO VITAL)

// --- 6. ROTAS (ENDPOINTS) ---

// Páginas Públicas
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));

// Páginas Protegidas (SISTEMA COMPLETO)
app.get('/orcamento', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/crm', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/engenharia', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html')));
app.get('/boletim', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));

// Rota de Logout
app.get('/logout', (req, res) => { 
    req.session.destroy(); 
    res.redirect('/login'); 
});

// API de Login (Lógica Robusta)
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    console.log(`>>> Tentativa de login: ${email}`);
    try {
        // Busca usuário ignorando espaços em branco
        const result = await pool.query("SELECT * FROM usuarios WHERE TRIM(email) = TRIM($1)", [email]);
        
        if (result.rows.length > 0) {
            const user = result.rows[0];
            // Verifica senha (texto simples conforme seu script)
            if (String(senha).trim() === String(user.senha_hash).trim()) {
                // SUCESSO: Cria a sessão
                req.session.user = { 
                    id: user.id, 
                    empresa_id: user.empresa_id, 
                    nome: user.nome,
                    nivel: user.nivel_acesso
                };
                console.log('>>> Login SUCESSO para:', user.nome);
                return res.json({ status: 'ok', redirect: '/orcamento' }); // Retorna JSON para o front tratar
            }
        }
        console.log('>>> Login FALHOU: Senha incorreta ou usuário não encontrado');
        res.status(401).json({ error: 'Credenciais inválidas' });
    } catch (err) { 
        console.error('>>> Erro no login:', err);
        res.status(500).json({ error: err.message }); 
    }
});

// APIs - PROPOSTAS
app.get('/api/propostas', checkAuth, propostasController.listarPropostas);
app.post('/gerar-proposta', checkAuth, propostasController.criarProposta);
app.get('/api/propostas/:id/pdf', checkAuth, propostasController.gerarPDFComercial);
app.get('/gerar-pdf/:id', checkAuth, propostasController.gerarPDFComercial); // Fallback
app.post('/api/propostas/:id/status', checkAuth, propostasController.atualizarStatus);
app.patch('/api/propostas/:id/status', checkAuth, propostasController.atualizarStatus);
app.delete('/api/propostas/:id', checkAuth, propostasController.deletarProposta);

// APIs - ENGENHARIA / BOLETIM
app.get('/api/boletim/furos/:obraId', checkAuth, boletimController.listarFuros);
app.post('/api/boletim/furos', checkAuth, boletimController.criarFuro);
app.get('/api/boletim/amostras/:furoId', checkAuth, boletimController.listarAmostras);
app.post('/api/boletim/amostras', checkAuth, boletimController.salvarAmostra);
app.post('/api/boletim/fotos', checkAuth, boletimController.salvarFoto);
app.put('/api/boletim/furos/:id', checkAuth, boletimController.atualizarFuro);
app.get('/api/engenharia/:id', checkAuth, boletimController.dadosCompletosObra);

// --- 7. INICIALIZAÇÃO DO SERVIDOR ---
verificarBanco().then(() => {
    app.listen(port, () => { 
        console.log(`=============================================`);
        console.log(`>>> 🚀 SONDASAAS (FULL) RODANDO NA PORTA ${port}`);
        console.log(`=============================================`);
    });
});