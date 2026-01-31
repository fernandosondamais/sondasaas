require('dotenv').config();
const express = require('express');
const path = require('path');
const session = require('express-session');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 3000;

// --- 1. CONFIGURAÇÃO (SERVER) ---
app.set('trust proxy', 1);

// SEGURANÇA: Use Variável de Ambiente no Render.com
const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
    console.warn("ATENÇÃO: DATABASE_URL não definida. O sistema pode falhar se não estiver rodando localmente com hardcode.");
}

const pool = new Pool({
  connectionString: connectionString,
  ssl: connectionString && connectionString.includes('render.com') ? { rejectUnauthorized: false } : false
});

// Aumentei o limite para suportar fotos em Base64 vindas do campo
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

app.use(session({
    secret: process.env.SESSION_SECRET || 'sonda_saas_secret_key_v4',
    resave: true,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', 
        maxAge: 24 * 60 * 60 * 1000, // 24 horas
        httpOnly: true
    }
}));

// --- 2. DB & MIGRATION ---
async function iniciarSistema() {
    try {
        console.log('>>> 🚀 INICIANDO SONDASAAS V4.1 (CORREÇÃO QA)...');
        await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
        
        // Tabelas Principais
        await pool.query(`CREATE TABLE IF NOT EXISTS empresas (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), nome_fantasia VARCHAR(255), email_dono VARCHAR(255), cnpj VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), empresa_id UUID REFERENCES empresas(id), nome VARCHAR(255), email VARCHAR(255) UNIQUE, senha_hash VARCHAR(255), nivel_acesso VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        
        // Tabela Propostas (Estrutura Atualizada)
        await pool.query(`CREATE TABLE IF NOT EXISTS propostas (
            id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), 
            empresa_id UUID REFERENCES empresas(id), 
            cliente VARCHAR(255), 
            email VARCHAR(255), 
            telefone VARCHAR(50), 
            endereco TEXT, 
            furos_previstos INTEGER, 
            metragem_total DECIMAL(10,2), 
            valor_total DECIMAL(10,2), 
            status VARCHAR(50) DEFAULT 'ORCAMENTO', 
            tecnico_responsavel VARCHAR(255), 
            sondador_id UUID REFERENCES usuarios(id), 
            data_criacao TIMESTAMP DEFAULT NOW()
        );`);
        
        // Atualizações de Schema (Idempotente)
        const updates = [
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS tecnico_responsavel VARCHAR(255)`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS sondador_id UUID REFERENCES usuarios(id)`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ORCAMENTO'`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_art DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_mobilizacao DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_desconto DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS nome_arquivo_pdf VARCHAR(255)`,
            `CREATE TABLE IF NOT EXISTS furos (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), proposta_id UUID REFERENCES propostas(id) ON DELETE CASCADE, nome_furo VARCHAR(50), data_inicio TIMESTAMP, data_termino TIMESTAMP, nivel_agua_inicial DECIMAL(5,2), nivel_agua_final DECIMAL(5,2), coordenadas VARCHAR(100))`,
            `CREATE TABLE IF NOT EXISTS amostras (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), furo_id UUID REFERENCES furos(id) ON DELETE CASCADE, profundidade_ini DECIMAL(5,2), profundidade_fim DECIMAL(5,2), golpe_1 INTEGER, golpe_2 INTEGER, golpe_3 INTEGER, tipo_solo TEXT)`,
            `CREATE TABLE IF NOT EXISTS fotos (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), furo_id UUID REFERENCES furos(id) ON DELETE CASCADE, url_imagem TEXT, legenda VARCHAR(255))`
        ];
        
        for(let sql of updates) { 
            try { await pool.query(sql); } catch(e) { console.log('Info Schema:', e.message); } 
        }

        // Seed Usuários (Apenas se não existirem)
        const checkEmp = await pool.query("SELECT id FROM empresas LIMIT 1");
        let empId;
        if (checkEmp.rows.length === 0) {
            const res = await pool.query(`INSERT INTO empresas (nome_fantasia, email_dono, cnpj) VALUES ('SondaMais Engenharia', 'fabiano@sondamais.com', '0001') RETURNING id`);
            empId = res.rows[0].id;
        } else { empId = checkEmp.rows[0].id; }

        const equipe = [
            { login: 'luis', nome: 'Luis Fernando', pass: 'sonda123', role: 'admin' },
            { login: 'fabiano', nome: 'Fabiano Rielli', pass: 'sonda123', role: 'admin' },
            { login: 'thais', nome: 'Thais Torres', pass: 'sonda123', role: 'admin' },
            { login: 'wellington', nome: 'Wellington', pass: 'sonda123', role: 'admin' },
            { login: 'jandilson', nome: 'Jandilson', pass: '1234', role: 'sondador' },
            { login: 'luispaulo', nome: 'Luis Paulo', pass: '1234', role: 'sondador' },
            { login: 'flavio', nome: 'Flavio', pass: '1234', role: 'sondador' },
            { login: 'ronilson', nome: 'Ronilson', pass: '1234', role: 'sondador' }
        ];

        for (let u of equipe) {
            const check = await pool.query("SELECT id FROM usuarios WHERE email = $1", [u.login]);
            if (check.rows.length === 0) {
                await pool.query(`INSERT INTO usuarios (empresa_id, nome, email, senha_hash, nivel_acesso) VALUES ($1, $2, $3, $4, $5)`, [empId, u.nome, u.login, u.pass, u.role]);
            }
        }
        console.log('>>> ✅ SISTEMA E BANCO DE DADOS PRONTOS.');
    } catch (e) { console.error('!!! ERRO STARTUP !!!', e); }
}

// --- 3. MOTOR PDF (PADRÃO SONDAMAIS - CORRIGIDO) ---
const montarLayoutPDF = (doc, p) => {
    const C_VERDE = '#8CBF26'; 
    const C_TEXTO = '#000000';
    
    // Header
    const logoPath = path.join(__dirname, 'public', 'logo.png');
    if (fs.existsSync(logoPath)) { 
        doc.image(logoPath, 40, 30, { width: 120 }); 
    } else { 
        doc.fillColor(C_VERDE).fontSize(22).font('Helvetica-Bold').text('SONDAMAIS', 40, 40); 
    }

    doc.fillColor(C_TEXTO).fontSize(10).font('Helvetica')
       .text('R. Luís Spiandorelli Neto, 60', 300, 30, { align: 'right' })
       .text('Valinhos, São Paulo, 13271-570', 300, 44, { align: 'right' })
       .text('(19) 99800-2260', 300, 58, { align: 'right' });

    doc.moveDown(3);

    // Titulo
    let y = 110;
    doc.fillColor(C_VERDE).fontSize(16).font('Helvetica-Bold').text('Orçamento', 40, y);
    
    // Metadados
    y += 30;
    doc.fillColor('#000').fontSize(10).font('Helvetica-Bold').text('Data', 40, y);
    doc.font('Helvetica').text(new Date().toLocaleDateString('pt-BR'), 40, y + 15);

    doc.font('Helvetica-Bold').text('Pagamento', 150, y);
    doc.font('Helvetica').text('50% SINAL ENTRADA E RESTANTE NA ENTREGA DO LAUDO - TRANSFERÊNCIA BANCÁRIA OU PIX', 150, y + 15, { width: 220 });

    doc.font('Helvetica-Bold').text('Número da Proposta', 400, y);
    doc.font('Helvetica').text(p.id.split('-')[0].toUpperCase(), 400, y + 15);

    y += 60;
    doc.font('Helvetica-Bold').text('Elaborado por:', 400, y);
    doc.font('Helvetica').text('Eng. Fabiano Rielli', 400, y + 15);

    doc.font('Helvetica-Bold').text('Solicitante:', 40, y);
    doc.font('Helvetica').text(p.cliente, 100, y);

    y += 20;
    doc.font('Helvetica-Bold').text('Endereço:', 40, y);
    doc.font('Helvetica').text(p.endereco || 'Não informado', 100, y);

    // Tabela Itens
    y += 40;
    const col = { DESC: 40, QTD: 300, UNIT: 360, TOTAL: 450 };
    doc.rect(40, y, 515, 20).fill('#f0f0f0');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
    doc.text('Descrição', col.DESC + 5, y + 6);
    doc.text('Qtd', col.QTD, y + 6);
    doc.text('Preço unitário', col.UNIT, y + 6);
    doc.text('Preço total', col.TOTAL, y + 6);

    y += 25;
    doc.font('Helvetica').fontSize(10);

    const total = parseFloat(p.valor_total || 0);
    const art = parseFloat(p.valor_art || 0);
    const mob = parseFloat(p.valor_mobilizacao || 0);
    const desc = parseFloat(p.valor_desconto || 0);
    const sondagemTotal = total - art - mob + desc;
    const valorMetro = (p.metragem_total > 0) ? (sondagemTotal / p.metragem_total) : 0;

    // Itens
    doc.text('Sondagem SPT', col.DESC, y);
    doc.text(p.furos_previstos.toString(), col.QTD, y);
    doc.fontSize(8).text('(furos conforme norma NBR 6484:2020). Será cobrado o metro excedente.', col.DESC, y + 12, { width: 250 });
    
    y += 35;
    doc.fontSize(10).font('Helvetica-Bold').text('*Metragem mínima (metros lineares)', col.DESC, y);
    doc.font('Helvetica').text(p.metragem_total.toString(), col.QTD, y)
       .text(`R$ ${valorMetro.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.UNIT, y)
       .text(`R$ ${sondagemTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y);

    y += 20; doc.text('ART', col.DESC, y).text('1', col.QTD, y).text(`R$ ${art.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.UNIT, y).text(`R$ ${art.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y);
    y += 20; doc.text('Mobilização (combustível, equipe)', col.DESC, y).text('1', col.QTD, y).text(`R$ ${mob.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.UNIT, y).text(`R$ ${mob.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y);

    if (desc > 0) {
        y += 20; doc.fillColor('red').text('Desconto Comercial', col.DESC, y).text('-', col.QTD, y).text(`- R$ ${desc.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y);
    }

    y += 30;
    doc.rect(col.TOTAL - 10, y - 5, 100, 25).fill(C_VERDE);
    doc.fillColor('white').font('Helvetica-Bold').fontSize(11).text(`R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y + 2);
    doc.fillColor(C_TEXTO).fontSize(10).text('Total base à vista:', 300, y + 2);

    // Textos Legais NBR 6484:2020
    y += 50;
    doc.fontSize(8).font('Helvetica').fillColor('#000');
    if (y > 600) { doc.addPage(); y = 50; }

    const textoLegal = `Na ausência do fornecimento do critério de paralisação por parte da contratante ou seu pressuposto, o CRITÉRIO DE PARALIZAÇÃO DOS ENSAIOS SEGUE AS RECOMENDAÇÕES DA NBR 6484:2020, ITEM 5.2.4 OU 6.2.4.\n\n**Conforme critério de paralisação de sondagem-SPT (Norma NBR 6484:2020), a profundidade atingida pode sofrer variação. Portanto, caso ultrapasse a *metragem mínima será cobrado o valor unitário por metro excedente.\n\n5.2.4.2 Na ausência do fornecimento do critério de paralisação por parte da contratante ou de seu preposto, as sondagens devem avançar até que seja atingido um dos seguintes critérios:\na) avanço da sondagem até a profundidade na qual tenham sido obtidos 10 m de resultados consecutivos indicando N iguais ou superiores a 25 golpes;\nb) avanço da sondagem até a profundidade na qual tenham sido obtidos 8 m de resultados consecutivos indicando N iguais ou superiores a 30 golpes;\nc) avanço da sondagem até a profundidade na qual tenham sido obtidos 6 m de resultados consecutivos indicando N iguais ou superiores a 35 golpes.`;

    doc.text(textoLegal, 40, y, { width: 515, align: 'justify' });

    y += 130; 
    if (y > 650) { doc.addPage(); y = 50; }
    
    doc.fillColor(C_VERDE).fontSize(12).font('Helvetica-Bold').text('CRONOGRAMA', 40, y);
    y += 20;
    doc.fillColor('#000').fontSize(10).font('Helvetica');
    doc.text('Previsão de execução: 1 a 3 dias (dependendo do solo)', 40, y); y+=15;
    doc.text('Início dos serviços: A combinar', 40, y); y+=15;
    doc.text('Entrega do Relatório: Até 3 dias úteis após execução', 40, y); y+=15;
    doc.text('Validade da Proposta: 10 dias', 40, y);
};

// --- 4. MIDDLEWARES & VIEW ROUTES ---
const checkAuth = (req, res, next) => { 
    if (req.session && req.session.user) next(); 
    else if(req.path.startsWith('/api/')) res.status(401).json({error: 'Sessão expirada'});
    else res.redirect('/login'); 
};

const checkAdmin = (req, res, next) => {
    if (req.session && req.session.user && req.session.user.nivel_acesso === 'admin') next();
    else res.redirect('/boletim'); 
};

// Rotas de Visualização
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => {
    if (req.session && req.session.user) return res.redirect(req.session.user.nivel_acesso === 'sondador' ? '/boletim' : '/admin');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// A Rota "Gerador de Propostas" VOLTOU e é exclusiva para ADMIN
app.get('/orcamento', checkAuth, checkAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));

app.get('/admin', checkAuth, checkAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/crm', checkAuth, checkAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/engenharia', checkAuth, checkAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html'))); 
app.get('/boletim', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- 5. API ---

app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body;
    try {
        const result = await pool.query("SELECT * FROM usuarios WHERE lower(email) = lower($1)", [email.trim()]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            if (String(senha).trim() === String(user.senha_hash).trim()) {
                req.session.user = { id: user.id, empresa_id: user.empresa_id, nome: user.nome, nivel_acesso: user.nivel_acesso };
                const destino = (user.nivel_acesso === 'sondador') ? '/boletim' : '/admin';
                req.session.save(() => res.json({ ok: true, redirect: destino }));
                return;
            }
        }
        res.status(401).send('Erro de credenciais');
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/api/propostas', checkAuth, async (req, res) => {
    try {
        let sql = 'SELECT * FROM propostas WHERE empresa_id = $1 ORDER BY data_criacao DESC';
        let params = [req.session.user.empresa_id];
        if (req.session.user.nivel_acesso === 'sondador') {
            sql = `SELECT * FROM propostas WHERE empresa_id = $1 AND sondador_id = $2 AND status IN ('Aprovada', 'Em Execução') ORDER BY data_criacao DESC`;
            params.push(req.session.user.id);
        }
        const result = await pool.query(sql, params);
        res.json(result.rows);
    } catch (e) { res.status(500).json(e); }
});

app.get('/api/usuarios/sondadores', checkAuth, async (req, res) => {
    try {
        const r = await pool.query("SELECT id, nome FROM usuarios WHERE empresa_id = $1 AND nivel_acesso = 'sondador'", [req.session.user.empresa_id]);
        res.json(r.rows);
    } catch(e) { res.status(500).json(e); }
});

app.patch('/api/propostas/:id/equipe', checkAuth, async (req, res) => {
    try {
        await pool.query("UPDATE propostas SET sondador_id = $1 WHERE id = $2", [req.body.sondador_id, req.params.id]);
        res.sendStatus(200);
    } catch(e) { res.status(500).json(e); }
});

// Geração de Proposta + PDF
app.post('/gerar-proposta', checkAuth, async (req, res) => {
    try {
        const d = req.body;
        const total = (parseFloat(d.metragem)*parseFloat(d.valor_metro)) + parseFloat(d.art) + parseFloat(d.mobilizacao) - parseFloat(d.desconto);
        const sql = `INSERT INTO propostas (empresa_id, cliente, telefone, email, endereco, furos_previstos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total, tecnico_responsavel, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ORCAMENTO') RETURNING *`;
        const values = [req.session.user.empresa_id, d.cliente, d.telefone, d.email, d.endereco, d.furos, d.metragem, d.art, d.mobilizacao, d.desconto, total, req.session.user.nome];
        
        const result = await pool.query(sql, values);
        
        // Gera e baixa o PDF
        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Orcamento_${result.rows[0].cliente.split(' ')[0]}.pdf`);
        doc.pipe(res);
        montarLayoutPDF(doc, result.rows[0]);
        doc.end();
        
    } catch (e) { res.status(500).send('Erro: ' + e.message); }
});

app.get('/api/propostas/:id/pdf', checkAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM propostas WHERE id = $1', [req.params.id]);
        if(result.rows.length === 0) return res.status(404).send('N/A');
        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Orcamento.pdf`);
        doc.pipe(res);
        montarLayoutPDF(doc, result.rows[0]);
        doc.end();
    } catch(e) { res.status(500).send(e.message); }
});

app.patch('/api/propostas/:id/status', checkAuth, async (req, res) => {
    try { await pool.query('UPDATE propostas SET status = $1 WHERE id = $2', [req.body.status, req.params.id]); res.sendStatus(200); } catch (e) { res.status(500).json(e); }
});
app.delete('/api/propostas/:id', checkAuth, async (req, res) => {
    try { await pool.query('DELETE FROM propostas WHERE id = $1', [req.params.id]); res.sendStatus(200); } catch(e) { res.status(500).send(e); }
});

// --- API DE CAMPO (CORREÇÃO DE BUG NÍVEL ÁGUA) ---
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

// Rota de Upload de Fotos (Aumentado timeout/limite implícito pelo express.json)
app.post('/api/boletim/fotos', checkAuth, async (req, res) => {
    try { 
        await pool.query("INSERT INTO fotos (furo_id, url_imagem, legenda) VALUES ($1, $2, $3)", [req.body.furo_id, req.body.imagem_base64, req.body.legenda]); 
        res.sendStatus(200); 
    } catch(e) { 
        console.error('Erro Foto:', e);
        res.status(500).json(e); 
    }
});

app.put('/api/boletim/furos/:id', checkAuth, async (req, res) => {
    try { 
        // Correção Bug Nível Água: Se vier vazio, salva NULL
        const d = req.body; 
        const na_ini = d.nivel_agua_inicial === '' ? null : d.nivel_agua_inicial;
        await pool.query("UPDATE furos SET nivel_agua_inicial=$1, nivel_agua_final=$2, data_inicio=$3, data_termino=$4, coordenadas=$5 WHERE id=$6", [na_ini, d.nivel_agua_final, d.data_inicio, d.data_termino, d.coordenadas, req.params.id]); 
        res.sendStatus(200); 
    } catch(e) { res.status(500).json(e); }
});

// --- API ENGENHARIA (DADOS TÉCNICOS) ---
app.get('/api/engenharia/:id', checkAuth, async (req, res) => {
    try {
        const pRes = await pool.query("SELECT * FROM propostas WHERE id = $1", [req.params.id]);
        if(pRes.rows.length === 0) return res.status(404).send('Nada');
        
        const fRes = await pool.query("SELECT * FROM furos WHERE proposta_id = $1 ORDER BY nome_furo", [req.params.id]);
        const furos = fRes.rows;
        
        for(let f of furos) {
            const aRes = await pool.query("SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini", [f.id]);
            f.amostras = aRes.rows;
            const phRes = await pool.query("SELECT id, legenda FROM fotos WHERE furo_id = $1", [f.id]);
            f.fotos = phRes.rows;
        }
        res.json({ proposta: pRes.rows[0], furos });
    } catch(e) { res.status(500).json(e); }
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

iniciarSistema().then(() => {
    app.listen(port, () => { console.log(`>>> 🚀 SONDASAAS V4.1 (FIX FINAL) RODANDO NA PORTA ${port}`); });
});