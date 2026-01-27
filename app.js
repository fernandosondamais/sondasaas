require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./config/db'); 
const session = require('express-session');
const app = express();
const port = process.env.PORT || 3000;

// Aumenta limite para fotos
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

// Sessão
app.use(session({
    secret: process.env.SESSION_SECRET || 'segredo_dev',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Em produção real com HTTPS, mude para true
}));

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
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- API LOGIN (MODO DETETIVE ATIVADO) ---
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    
    console.log('--- TENTATIVA DE LOGIN ---');
    console.log('1. Email recebido do site:', `"${email}"`); // Aspas para ver se tem espaço
    console.log('2. Senha recebida:', senha);

    try {
        // Teste de conexão básico
        const now = await pool.query('SELECT NOW()');
        console.log('3. Banco Conectado? SIM. Hora:', now.rows[0].now);

        // Busca usuário
        const result = await pool.query('SELECT * FROM usuarios WHERE email = $1', [email]);
        console.log('4. Usuário encontrado no banco?', result.rows.length > 0 ? 'SIM' : 'NÃO');

        if (result.rows.length > 0) {
            const user = result.rows[0];
            console.log('5. Senha salva no banco:', user.senha_hash);
            console.log('6. Comparando:', senha, '===', user.senha_hash);
            
            // Comparação
            if (String(senha).trim() === String(user.senha_hash).trim()) {
                console.log('7. SUCESSO! Logando...');
                req.session.user = { id: user.id, empresa_id: user.empresa_id, nome: user.nome };
                return res.sendStatus(200);
            } else {
                console.log('7. ERRO: As senhas não batem.');
            }
        } else {
            // Se não achou pelo e-mail exato, vamos listar o que tem lá pra entender
            const todos = await pool.query('SELECT email FROM usuarios');
            console.log('8. ERRO: Email não achado. Emails que existem no banco:', todos.rows);
        }
        res.status(401).send('Login inválido');
    } catch (err) {
        console.error('!!! ERRO FATAL NO SERVIDOR !!!', err);
        res.status(500).send(err.message);
    }
});

// --- IMPORTAR CONTROLLERS ---
const propostasController = require('./controllers/propostasController');
app.get('/api/propostas', checkAuth, propostasController.listarPropostas);
app.post('/gerar-proposta', checkAuth, propostasController.criarProposta);
app.get('/gerar-pdf/:id', checkAuth, propostasController.gerarPDFComercial);

app.listen(port, () => { console.log(`>>> SondaSaaS ON na porta ${port} <<<`); });