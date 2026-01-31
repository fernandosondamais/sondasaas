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

const connectionString = process.env.DATABASE_URL || "postgres://sondasaas_db_user:QhOwhbqwMaso6EpV49iC29JIHRbNaabb@dpg-d5ocbter433s7381d8rg-a.virginia-postgres.render.com/sondasaas_db";
const isProduction = connectionString.includes('render.com');

const pool = new Pool({
  connectionString: connectionString,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

app.use(session({
    secret: 'sonda_saas_v4_ux_master',
    resave: true,
    saveUninitialized: false,
    cookie: { 
        secure: isProduction, 
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 dias (para não deslogar o Fabiano no campo)
        sameSite: 'lax',
        httpOnly: true
    }
}));

// --- 2. BANCO DE DADOS & SEED (USUÁRIOS SIMPLIFICADOS) ---
async function iniciarSistema() {
    try {
        console.log('>>> 🚀 INICIANDO SONDASAAS V4 (UX MOBILE)...');
        await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
        
        // Tabelas
        await pool.query(`CREATE TABLE IF NOT EXISTS empresas (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), nome_fantasia VARCHAR(255), email_dono VARCHAR(255), cnpj VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        // Note: Coluna 'email' agora será usada como 'login' (aceita nomes simples)
        await pool.query(`CREATE TABLE IF NOT EXISTS usuarios (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), empresa_id UUID REFERENCES empresas(id), nome VARCHAR(255), email VARCHAR(255) UNIQUE, senha_hash VARCHAR(255), nivel_acesso VARCHAR(50), data_criacao TIMESTAMP DEFAULT NOW());`);
        
        await pool.query(`CREATE TABLE IF NOT EXISTS propostas (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), empresa_id UUID REFERENCES empresas(id), cliente VARCHAR(255), email VARCHAR(255), telefone VARCHAR(50), endereco TEXT, furos_previstos INTEGER, metragem_total DECIMAL(10,2), valor_total DECIMAL(10,2), status VARCHAR(50) DEFAULT 'ORCAMENTO', tecnico_responsavel VARCHAR(255), sondador_id UUID REFERENCES usuarios(id), data_criacao TIMESTAMP DEFAULT NOW());`);
        
        // Updates de Colunas (Idempotente)
        const updates = [
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS tecnico_responsavel VARCHAR(255)`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS sondador_id UUID REFERENCES usuarios(id)`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ORCAMENTO'`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_art DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_mobilizacao DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS valor_desconto DECIMAL(10,2) DEFAULT 0`,
            `ALTER TABLE propostas ADD COLUMN IF NOT EXISTS nome_arquivo_pdf VARCHAR(255)`,
            // Engenharia
            `CREATE TABLE IF NOT EXISTS furos (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), proposta_id UUID REFERENCES propostas(id) ON DELETE CASCADE, nome_furo VARCHAR(50), data_inicio TIMESTAMP, data_termino TIMESTAMP, nivel_agua_inicial DECIMAL(5,2), nivel_agua_final DECIMAL(5,2), coordenadas VARCHAR(100))`,
            `CREATE TABLE IF NOT EXISTS amostras (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), furo_id UUID REFERENCES furos(id) ON DELETE CASCADE, profundidade_ini DECIMAL(5,2), profundidade_fim DECIMAL(5,2), golpe_1 INTEGER, golpe_2 INTEGER, golpe_3 INTEGER, tipo_solo TEXT)`,
            `CREATE TABLE IF NOT EXISTS fotos (id UUID PRIMARY KEY DEFAULT uuid_generate_v4(), furo_id UUID REFERENCES furos(id) ON DELETE CASCADE, url_imagem TEXT, legenda VARCHAR(255))`
        ];
        for(let sql of updates) { try { await pool.query(sql); } catch(e){} }

        // --- SEED INTELIGENTE (EQUIPE REAL) ---
        // 1. Empresa
        let empId;
        const checkEmp = await pool.query("SELECT id FROM empresas LIMIT 1");
        if (checkEmp.rows.length === 0) {
            const res = await pool.query(`INSERT INTO empresas (nome_fantasia, email_dono, cnpj) VALUES ('SondaMais Engenharia', 'fabiano@sondamais.com', '0001') RETURNING id`);
            empId = res.rows[0].id;
        } else { empId = checkEmp.rows[0].id; }

        // 2. Usuários (Logins Curtos)
        const equipe = [
            // Gestão (Senha: sonda123)
            { login: 'luis', nome: 'Luis Fernando', pass: 'sonda123', role: 'admin' },
            { login: 'fabiano', nome: 'Fabiano Rielli', pass: 'sonda123', role: 'admin' },
            { login: 'thais', nome: 'Thais Torres', pass: 'sonda123', role: 'admin' },
            { login: 'wellington', nome: 'Wellington', pass: 'sonda123', role: 'admin' },
            // Campo (Senha: 1234 - Fácil digitação)
            { login: 'jandilson', nome: 'Jandilson', pass: '1234', role: 'sondador' },
            { login: 'luispaulo', nome: 'Luis Paulo', pass: '1234', role: 'sondador' },
            { login: 'flavio', nome: 'Flavio', pass: '1234', role: 'sondador' },
            { login: 'ronilson', nome: 'Ronilson', pass: '1234', role: 'sondador' }
        ];

        for (let u of equipe) {
            const check = await pool.query("SELECT id FROM usuarios WHERE email = $1", [u.login]);
            if (check.rows.length === 0) {
                await pool.query(
                    `INSERT INTO usuarios (empresa_id, nome, email, senha_hash, nivel_acesso) VALUES ($1, $2, $3, $4, $5)`,
                    [empId, u.nome, u.login, u.pass, u.role] // Login entra na coluna email
                );
                console.log(`> +Usuario: ${u.nome} (${u.login})`);
            }
        }
        console.log('>>> ✅ DADOS V4 SINCRONIZADOS.');
    } catch (e) { console.error('!!! ERRO STARTUP !!!', e); }
}

// --- 3. MOTOR PDF (PADRÃO SONDAMAIS EXATO) ---
const montarLayoutPDF = (doc, p, empresa) => {
    // Layout baseado no arquivo: 1283817850rev03...
    const C_VERDE = '#8CBF26'; 
    const C_TEXTO = '#000000';
    
    // -- HEADER --
    const logoPath = path.join(__dirname, 'public', 'logo.png');
    if (fs.existsSync(logoPath)) { doc.image(logoPath, 40, 30, { width: 120 }); } 
    else { doc.fillColor(C_VERDE).fontSize(22).font('Helvetica-Bold').text('SONDAMAIS', 40, 40); }

    doc.fillColor(C_TEXTO).fontSize(10).font('Helvetica')
       .text('R. Luís Spiandorelli Neto, 60', 300, 30, { align: 'right' })
       .text('Valinhos, São Paulo, 13271-570', 300, 44, { align: 'right' })
       .text('(19) 99800-2260', 300, 58, { align: 'right' });

    doc.moveDown(3);

    // -- TITULO --
    let y = 110;
    doc.fillColor(C_VERDE).fontSize(16).font('Helvetica-Bold').text('Orçamento', 40, y);
    
    // -- BLOCO DE DADOS --
    y += 30;
    // Coluna 1
    doc.fillColor('#000').fontSize(10).font('Helvetica-Bold').text('Data', 40, y);
    doc.font('Helvetica').text(new Date().toLocaleDateString('pt-BR'), 40, y + 15);

    // Coluna 2
    doc.font('Helvetica-Bold').text('Pagamento', 150, y);
    doc.font('Helvetica').text('50% SINAL ENTRADA E RESTANTE NA ENTREGA DO LAUDO - TRANSFERÊNCIA BANCÁRIA OU PIX', 150, y + 15, { width: 220 });

    // Coluna 3
    doc.font('Helvetica-Bold').text('Número da Proposta', 400, y);
    doc.font('Helvetica').text(p.id.split('-')[0].toUpperCase(), 400, y + 15); // ID Curto

    y += 60;
    // Elaborado por
    doc.font('Helvetica-Bold').text('Elaborado por:', 400, y);
    doc.font('Helvetica').text('Eng. Fabiano Rielli', 400, y + 15);

    // Cliente
    doc.font('Helvetica-Bold').text('Solicitante:', 40, y);
    doc.font('Helvetica').text(p.cliente, 100, y);

    y += 20;
    doc.font('Helvetica-Bold').text('Endereço:', 40, y);
    doc.font('Helvetica').text(p.endereco || 'Não informado', 100, y);

    // -- TABELA --
    y += 40;
    const col = { DESC: 40, QTD: 300, UNIT: 360, TOTAL: 450 };
    
    // Header Tabela
    doc.rect(40, y, 515, 20).fill('#f0f0f0');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(10);
    doc.text('Descrição', col.DESC + 5, y + 6);
    doc.text('Qtd', col.QTD, y + 6);
    doc.text('Preço unitário', col.UNIT, y + 6);
    doc.text('Preço total', col.TOTAL, y + 6);

    y += 25;
    doc.font('Helvetica').fontSize(10);

    const total = parseFloat(p.valor_total);
    const art = parseFloat(p.valor_art);
    const mob = parseFloat(p.valor_mobilizacao);
    const desc = parseFloat(p.valor_desconto);
    const sondagemTotal = total - art - mob + desc;
    const valorMetro = (p.metragem_total > 0) ? (sondagemTotal / p.metragem_total) : 0;

    // Linha 1: Sondagem
    doc.text('Sondagem SPT', col.DESC, y);
    doc.text(p.furos_previstos.toString(), col.QTD, y);
    doc.fontSize(8).text('(furos conforme norma NBR 6484:2020). Será cobrado o metro excedente.', col.DESC, y + 12, { width: 250 });
    
    // Linha 2: Metragem
    y += 35;
    doc.fontSize(10).font('Helvetica-Bold').text('*Metragem mínima (metros lineares)', col.DESC, y);
    doc.font('Helvetica');
    doc.text(p.metragem_total.toString(), col.QTD, y);
    doc.text(`R$ ${valorMetro.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.UNIT, y);
    doc.text(`R$ ${sondagemTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y);

    // Linha 3: ART
    y += 20;
    doc.text('ART', col.DESC, y).text('1', col.QTD, y)
       .text(`R$ ${art.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.UNIT, y)
       .text(`R$ ${art.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y);

    // Linha 4: Mobilização
    y += 20;
    doc.text('Mobilização (combustível, equipe)', col.DESC, y).text('1', col.QTD, y)
       .text(`R$ ${mob.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.UNIT, y)
       .text(`R$ ${mob.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y);

    if (desc > 0) {
        y += 20;
        doc.fillColor('red').text('Desconto Comercial', col.DESC, y).text('-', col.QTD, y)
           .text(`- R$ ${desc.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, col.TOTAL, y);
    }

    // -- TOTAL FINAL --
    y += 40;
    doc.fontSize(14).font('Helvetica-Bold').fillColor('#000');
    doc.text(`Total base à vista:`, 250, y);
    doc.text(`R$ ${total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, 450, y);

    // -- TEXTO LEGAL (CRÍTICO) --
    y += 50;
    doc.fontSize(9).font('Helvetica').fillColor('#000');
    if (y > 600) { doc.addPage(); y = 50; }

    const textoLegal = `Na ausência do fornecimento do critério de paralisação por parte da contratante ou seu pressuposto, o CRITÉRIO DE PARALIZAÇÃO DOS ENSAIOS SEGUE AS RECOMENDAÇÕES DA NBR 6484:2020, ITEM 5.2.4 OU 6.2.4.

**Conforme critério de paralisação de sondagem-SPT (Norma NBR 6484:2020), a profundidade atingida pode sofrer variação. Portanto, caso ultrapasse a *metragem mínima será cobrado o valor unitário por metro excedente.

5.2.4.2 Na ausência do fornecimento do critério de paralisação por parte da contratante ou de seu preposto, as sondagens devem avançar até que seja atingido um dos seguintes critérios:
a) avanço da sondagem até a profundidade na qual tenham sido obtidos 10 m de resultados consecutivos indicando N iguais ou superiores a 25 golpes;
b) avanço da sondagem até a profundidade na qual tenham sido obtidos 8 m de resultados consecutivos indicando N iguais ou superiores a 30 golpes;
c) avanço da sondagem até a profundidade na qual tenham sido obtidos 6 m de resultados consecutivos indicando N iguais ou superiores a 35 golpes.`;

    doc.text(textoLegal, 40, y, { width: 515, align: 'justify' });

    // -- CRONOGRAMA --
    y += 150; 
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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => {
    if (req.session && req.session.user) return res.redirect(req.session.user.nivel_acesso === 'sondador' ? '/boletim' : '/admin');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Gestão
app.get('/orcamento', checkAuth, checkAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/admin', checkAuth, checkAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/crm', checkAuth, checkAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/engenharia', checkAuth, checkAdmin, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html'))); 

// Campo
app.get('/boletim', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });

// --- 5. API ---

// LOGIN SIMPLIFICADO
app.post('/api/login', async (req, res) => {
    const { email, senha } = req.body; // 'email' aqui é o usuário (luis, jandilson)
    try {
        // Busca case-insensitive
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
        res.status(401).send('Usuário ou senha incorretos');
    } catch (err) { res.status(500).send(err.message); }
});

// --- CRM & PROPOSTAS ---
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

app.post('/gerar-proposta', checkAuth, async (req, res) => {
    try {
        const d = req.body;
        const total = (parseFloat(d.metragem)*parseFloat(d.valor_metro)) + parseFloat(d.art) + parseFloat(d.mobilizacao) - parseFloat(d.desconto);
        const sql = `INSERT INTO propostas (empresa_id, cliente, telefone, email, endereco, furos_previstos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total, tecnico_responsavel, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'ORCAMENTO') RETURNING *`;
        const values = [req.session.user.empresa_id, d.cliente, d.telefone, d.email, d.endereco, d.furos, d.metragem, d.art, d.mobilizacao, d.desconto, total, req.session.user.nome];
        await pool.query(sql, values);
        res.redirect('/orcamento?ok=1');
    } catch (e) { res.status(500).send(e.message); }
});

app.get('/api/propostas/:id/pdf', checkAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM propostas WHERE id = $1', [req.params.id]);
        if(result.rows.length === 0) return res.status(404).send('404');
        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=Orcamento_${result.rows[0].cliente.split(' ')[0]}.pdf`);
        doc.pipe(res);
        montarLayoutPDF(doc, result.rows[0], null);
        doc.end();
    } catch(e) { res.status(500).send(e.message); }
});

app.patch('/api/propostas/:id/status', checkAuth, async (req, res) => {
    try { await pool.query('UPDATE propostas SET status = $1 WHERE id = $2', [req.body.status, req.params.id]); res.sendStatus(200); } catch (e) { res.status(500).json(e); }
});
app.delete('/api/propostas/:id', checkAuth, async (req, res) => {
    try { await pool.query('DELETE FROM propostas WHERE id = $1', [req.params.id]); res.sendStatus(200); } catch(e) { res.status(500).send(e); }
});

// --- API BOLETIM ---
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
app.put('/api/boletim/furos/:id', checkAuth, async (req, res) => {
    try { const d = req.body; await pool.query("UPDATE furos SET nivel_agua_inicial=$1, nivel_agua_final=$2, data_inicio=$3, data_termino=$4, coordenadas=$5 WHERE id=$6", [d.nivel_agua_inicial, d.nivel_agua_final, d.data_inicio, d.data_termino, d.coordenadas, req.params.id]); res.sendStatus(200); } catch(e) { res.status(500).json(e); }
});
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
        } else { res.status(404).send('404'); }
    } catch(e) { res.status(500).send(e); }
});

iniciarSistema().then(() => {
    app.listen(port, () => { console.log(`>>> 🚀 SONDASAAS V4 RODANDO NA PORTA ${port}`); });
});