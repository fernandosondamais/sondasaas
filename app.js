require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURAÇÃO DE SERVIDOR ---
app.set('trust proxy', 1);

const connectionString = process.env.DATABASE_URL || "postgres://sondasaas_db_user:QhOwhbqwMaso6EpV49iC29JIHRbNaabb@dpg-d5ocbter433s7381d8rg-a.virginia-postgres.render.com/sondasaas_db";
const isProduction = connectionString.includes('render.com');

const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

// Sessão ajustada para evitar perda de login
app.use(session({
    secret: 'segredo_sonda_saas_v3_fix_session',
    resave: true, // Força salvar a sessão
    saveUninitialized: false,
    cookie: { 
        secure: isProduction, 
        maxAge: 24 * 60 * 60 * 1000, 
        sameSite: 'lax',
        httpOnly: true
    }
}));

// --- MIDDLEWARE DE AUTENTICAÇÃO CENTRALIZADO ---
// Se não estiver logado, manda pro login. Se for API, erro 401.
const checkAuth = (req, res, next) => { 
    if (req.session && req.session.user) {
        next(); 
    } else {
        if(req.path.startsWith('/api/')) {
            res.status(401).json({error: 'Sessão expirada'});
        } else {
            res.redirect('/login'); 
        }
    }
};

// --- ROTAS DE PÁGINAS (FRONTEND) ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => {
    if (req.session && req.session.user) return res.redirect('/admin'); // Se já tá logado, vai pro admin
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/orcamento', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/crm', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/engenharia', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html'))); 
app.get('/boletim', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));

app.get('/logout', (req, res) => { 
    req.session.destroy(); 
    res.redirect('/login'); 
});

// --- API (BACKEND) ---

// Login
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const result = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email.trim()]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (String(senha).trim() === String(user.senha_hash).trim()) {
                req.session.user = { id: user.id, empresa_id: user.empresa_id, nome: user.nome };
                req.session.save(() => res.json({ ok: true, redirect: '/admin' })); // Redireciona para o Painel Geral
                return;
            }
        }
        res.status(401).send('Credenciais inválidas');
    } catch (err) { res.status(500).send(err.message); }
});

// CRM: Listar Propostas
app.get('/api/propostas', checkAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM propostas WHERE empresa_id = $1 ORDER BY data_criacao DESC', [req.session.user.empresa_id]);
        res.json(result.rows);
    } catch (e) { res.status(500).json(e); }
});

// Gerar Proposta e PDF
app.post('/gerar-proposta', checkAuth, async (req, res) => {
    try {
        const d = req.body;
        const total = (parseFloat(d.metragem)*parseFloat(d.valor_metro)) + parseFloat(d.art) + parseFloat(d.mobilizacao) - parseFloat(d.desconto);
        
        // Status padrão agora é 'Em Aberto' para aparecer no CRM
        const sql = `INSERT INTO propostas (empresa_id, cliente, telefone, email, endereco, furos_previstos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total, tecnico_responsavel, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'Em Aberto') RETURNING *`;
        const values = [req.session.user.empresa_id, d.cliente, d.telefone, d.email, d.endereco, d.furos, d.metragem, d.art, d.mobilizacao, d.desconto, total, req.session.user.nome];
        
        const result = await pool.query(sql, values);
        
        // Gera PDF (Lógica simplificada para brevidade, mas funcional)
        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Orcamento.pdf`);
        doc.pipe(res);
        doc.fontSize(20).text(`Proposta Comercial #${result.rows[0].id.split('-')[0]}`, { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Cliente: ${d.cliente}`);
        doc.text(`Valor Total: R$ ${total.toFixed(2)}`);
        doc.end();
        
    } catch (e) { res.status(500).send('Erro: ' + e.message); }
});

// Atualizar Status (CRM)
app.patch('/api/propostas/:id/status', checkAuth, async (req, res) => {
    try { 
        await pool.query('UPDATE propostas SET status = $1 WHERE id = $2', [req.body.status, req.params.id]); 
        res.sendStatus(200); 
    } catch (e) { res.status(500).json(e); }
});

// Dados Completos para Engenharia (CORREÇÃO CRÍTICA)
app.get('/api/engenharia/:id', checkAuth, async (req, res) => {
    try {
        const pRes = await pool.query("SELECT * FROM propostas WHERE id = $1", [req.params.id]);
        if(pRes.rows.length === 0) return res.status(404).send('Obra não encontrada');
        
        const fRes = await pool.query("SELECT * FROM furos WHERE proposta_id = $1 ORDER BY nome_furo", [req.params.id]);
        const furos = fRes.rows;
        
        // Loop para popular amostras
        for(let f of furos) {
            const aRes = await pool.query("SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini", [f.id]);
            f.amostras = aRes.rows;
            const phRes = await pool.query("SELECT id, legenda FROM fotos WHERE furo_id = $1", [f.id]);
            f.fotos = phRes.rows;
        }

        res.json({ proposta: pRes.rows[0], furos: furos });
    } catch(e) { console.error(e); res.status(500).json(e); }
});

// Rotas do Boletim (Furos, Amostras, Fotos)
app.get('/api/boletim/furos/:obraId', checkAuth, async (req, res) => {
    try { const r = await pool.query("SELECT * FROM furos WHERE proposta_id = $1 ORDER BY data_inicio", [req.params.obraId]); res.json(r.rows); } catch(e) { res.status(500).json(e); }
});
app.post('/api/boletim/furos', checkAuth, async (req, res) => {
    try { const r = await pool.query("INSERT INTO furos (proposta_id, nome_furo, coordenadas, data_inicio) VALUES ($1, $2, $3, NOW()) RETURNING *", [req.body.proposta_id, req.body.nome_furo, req.body.coordenadas]); res.json(r.rows[0]); } catch(e) { res.status(500).json(e); }
});
app.get('/api/boletim/amostras/:furoId', checkAuth, async (req, res) => {
    try { const r = await pool.query("SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini", [req.params.furoId]); res.json(r.rows); } catch(e) { res.status(500).json(e); }
});
app.post('/api/boletim/amostras', checkAuth, async (req, res) => {
    try { const d = req.body; const r = await pool.query("INSERT INTO amostras (furo_id, profundidade_ini, profundidade_fim, golpe_1, golpe_2, golpe_3, tipo_solo) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *", [d.furo_id, d.profundidade_ini, d.profundidade_fim, d.golpe_1, d.golpe_2, d.golpe_3, d.tipo_solo]); res.json(r.rows[0]); } catch(e) { res.status(500).json(e); }
});
app.post('/api/boletim/fotos', checkAuth, async (req, res) => {
    try { await pool.query("INSERT INTO fotos (furo_id, url_imagem, legenda) VALUES ($1, $2, $3)", [req.body.furo_id, req.body.imagem_base64, req.body.legenda]); res.sendStatus(200); } catch(e) { res.status(500).json(e); }
});
app.get('/api/foto-full/:id', checkAuth, async (req, res) => {
    try {
        const r = await pool.query("SELECT url_imagem FROM fotos WHERE id = $1", [req.params.id]);
        if(r.rows.length > 0) {
            const img = r.rows[0].url_imagem;
            const base64Data = img.replace(/^data:image\/\w+;base64,/, "");
            const buf = Buffer.from(base64Data, 'base64');
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': buf.length });
            res.end(buf); 
        } else { res.status(404).send('Foto não encontrada'); }
    } catch(e) { res.status(500).send(e); }
});
// Rota para deletar proposta (Admin)
app.delete('/api/propostas/:id', checkAuth, async (req, res) => {
    try { await pool.query('DELETE FROM propostas WHERE id = $1', [req.params.id]); res.sendStatus(200); } catch(e) { res.status(500).send(e); }
});

// START
app.listen(port, () => { console.log(`>>> 🚀 SONDASAAS V3 RODANDO NA PORTA ${port}`); });