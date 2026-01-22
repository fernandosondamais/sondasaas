const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// --- CONFIGURAÇÕES GERAIS ---
let adminLogado = false; 
const SENHA_MESTRA = 'admin123';

const COLORS = {
    PRIMARY: '#444444', 
    ACCENT: '#6a9615', 
    BORDER: '#000000', 
    BG_HEADER: '#ffffff'
};

const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:admin123@localhost:5432/sondasaas';

const pool = new Pool({
    connectionString: connectionString,
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

// AUMENTO DO LIMITE PARA ACEITAR FOTOS (50MB)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

// --- ROTAS DE PÁGINAS ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => adminLogado ? res.sendFile(path.join(__dirname, 'public', 'admin.html')) : res.redirect('/login'));
app.get('/boletim', (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));
app.get('/engenharia', (req, res) => adminLogado ? res.sendFile(path.join(__dirname, 'public', 'engenharia.html')) : res.redirect('/login')); 
app.get('/logout', (req, res) => { adminLogado = false; res.redirect('/login'); });

// --- API GERAL (LOGIN E PROPOSTAS) ---
app.post('/api/login', (req, res) => {
    if (req.body.senha === SENHA_MESTRA) { adminLogado = true; res.sendStatus(200); } else { res.sendStatus(401); }
});

app.get('/api/propostas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM propostas ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao buscar propostas' }); }
});

app.delete('/api/propostas/:id', async (req, res) => {
    if (!adminLogado) return res.status(403).send('Acesso Negado');
    try {
        await pool.query('DELETE FROM propostas WHERE id = $1', [req.params.id]);
        res.status(200).send('Excluído');
    } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// --- API ENGENHARIA (DADOS COMPLETOS DA OBRA) ---
app.get('/api/engenharia/:id', async (req, res) => {
    if (!adminLogado) return res.status(403).send('Acesso Negado');
    try {
        const propId = req.params.id;
        const propRes = await pool.query('SELECT * FROM propostas WHERE id = $1', [propId]);
        const proposta = propRes.rows[0];
        const furosRes = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [propId]);
        const furos = furosRes.rows;

        for (let furo of furos) {
            const amosRes = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [furo.id]);
            furo.amostras = amosRes.rows;
            const fotoRes = await pool.query('SELECT id, legenda, data_upload FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [furo.id]);
            furo.fotos = fotoRes.rows;
        }
        res.json({ proposta, furos });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- API BOLETIM (CAMPO - INSERÇÃO DE DADOS) ---
app.get('/api/boletim/furos/:obraId', async (req, res) => { try { const r = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [req.params.obraId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/furos', async (req, res) => { const d = req.body; try { const r = await pool.query(`INSERT INTO furos (proposta_id, nome_furo, sondador, data_inicio, cota, nivel_agua_inicial) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [d.proposta_id, d.nome_furo, d.sondador, d.data_inicio, d.cota, d.nivel_agua_inicial]); res.json({id: r.rows[0].id}); } catch (e) { res.status(500).json(e); } });
app.put('/api/boletim/furos/:id', async (req, res) => { const {id} = req.params; const d = req.body; try { await pool.query(`UPDATE furos SET nivel_agua_inicial=$1, nivel_agua_final=$2, data_inicio=$3, data_termino=$4, coordenadas=$5 WHERE id=$6`, [d.nivel_agua_inicial, d.nivel_agua_final, d.data_inicio, d.data_termino, d.coordenadas, id]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/boletim/amostras/:furoId', async (req, res) => { try { const r = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [req.params.furoId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/amostras', async (req, res) => { const d = req.body; try { await pool.query(`INSERT INTO amostras (furo_id, profundidade_ini, profundidade_fim, golpe_1, golpe_2, golpe_3, tipo_solo, cor_solo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [d.furo_id, d.profundidade_ini, d.profundidade_fim, d.golpe_1, d.golpe_2, d.golpe_3, d.tipo_solo, d.cor_solo]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/boletim/fotos/:furoId', async (req, res) => { try { const r = await pool.query('SELECT id, legenda, data_upload FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [req.params.furoId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/fotos', async (req, res) => { const {furo_id, imagem_base64, legenda} = req.body; try { await pool.query(`INSERT INTO fotos (furo_id, imagem, legenda) VALUES ($1, $2, $3)`, [furo_id, imagem_base64, legenda]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/foto-full/:id', async (req, res) => { try { const r = await pool.query('SELECT imagem FROM fotos WHERE id = $1', [req.params.id]); if(r.rows.length > 0) { const img = Buffer.from(r.rows[0].imagem.split(",")[1], 'base64'); res.writeHead(200, {'Content-Type': 'image/jpeg', 'Content-Length': img.length}); res.end(img); } else res.status(404).send('Not found'); } catch(e) { res.status(500).send(e); } });

// --- GERADOR DE RELATÓRIO TÉCNICO (NOVA FUNÇÃO) ---
app.get('/gerar-relatorio-tecnico/:id', async (req, res) => {
    if (!adminLogado) return res.redirect('/login');

    try {
        const propId = req.params.id;
        
        // 1. Busca Dados
        const propRes = await pool.query('SELECT * FROM propostas WHERE id = $1', [propId]);
        const proposta = propRes.rows[0];
        const furosRes = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [propId]);
        const furos = furosRes.rows;

        // 2. Configura PDF
        const doc = new PDFDocument({ margin: 30, size: 'A4', bufferPages: true });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Relatorio_Tecnico_${proposta.id}.pdf"`);
        doc.pipe(res);

        // 3. Loop por Furos
        for (let i = 0; i < furos.length; i++) {
            const furo = furos[i];
            const amosRes = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [furo.id]);
            const amostras = amosRes.rows;
            const fotosRes = await pool.query('SELECT * FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [furo.id]);
            
            if (i > 0) doc.addPage(); 

            // --- CABEÇALHO ---
            doc.rect(30, 30, 535, 80).fill('#f0f0f0').stroke();
            doc.fillColor('#444444').fontSize(16).font('Helvetica-Bold').text('PERFIL DE SONDAGEM - SPT', 50, 45);
            doc.fontSize(10).font('Helvetica');
            doc.text(`Cliente: ${proposta.cliente}`, 50, 70);
            doc.text(`Obra: ${proposta.endereco}`, 50, 85);
            doc.fontSize(12).font('Helvetica-Bold').text(`FURO: ${furo.nome_furo}`, 400, 45, { align: 'right' });
            doc.fontSize(9).font('Helvetica').text(`Data: ${furo.data_inicio ? new Date(furo.data_inicio).toLocaleDateString() : '-'}`, 400, 70, {align: 'right'});
            doc.text(`N.A.: ${furo.nivel_agua_inicial || 'Seco'} m`, 400, 85, {align: 'right'});

            // --- DESENHO DO GRÁFICO ---
            const startY = 130;
            const scaleY = 40;  // Pixels por metro
            const X_PROF = 40;
            const X_GOLPES = 80;
            const X_NSPT = 140;
            const X_GRAPH = 170; // Área gráfica
            const X_GRAPH_END = 320;
            const X_PERFIL = 330;
            const X_DESC = 370;

            // Títulos
            doc.fontSize(8).font('Helvetica-Bold').fillColor('black');
            doc.text('Prof(m)', X_PROF, startY - 15);
            doc.text('Golpes', X_GOLPES, startY - 15);
            doc.text('NSPT', X_NSPT, startY - 15);
            doc.text('Gráfico (0-50)', X_GRAPH, startY - 15);
            doc.text('Perfil', X_PERFIL, startY - 15);
            doc.text('Descrição', X_DESC, startY - 15);
            doc.moveTo(30, startY).lineTo(565, startY).stroke();

            let currentY = startY + 10;
            let pontosGrafico = [];

            for (let am of amostras) {
                if (currentY > 750) { doc.addPage(); currentY = 50; }

                const prof = parseFloat(am.profundidade_ini);
                const g1 = am.golpe_1 || 0;
                const g2 = am.golpe_2 || 0;
                const g3 = am.golpe_3 || 0;
                const nspt = parseInt(g2) + parseInt(g3);

                // Texto
                doc.font('Helvetica').fontSize(9);
                doc.text(prof.toFixed(2), X_PROF, currentY);
                doc.text(`${g1}/${g2}/${g3}`, X_GOLPES, currentY);
                doc.font('Helvetica-Bold').text(nspt, X_NSPT, currentY);
                
                // Descrição
                doc.font('Helvetica').fontSize(8);
                doc.text(am.tipo_solo || '-', X_DESC, currentY, { width: 190 });

                // Retângulo Perfil (Hachura Simples)
                let cor = '#eeeeee';
                const tipo = (am.tipo_solo || '').toLowerCase();
                if(tipo.includes('argila')) cor = '#e6b8af';
                if(tipo.includes('areia')) cor = '#fff2cc';
                doc.save();
                doc.rect(X_PERFIL, currentY - 5, 30, scaleY).fill(cor);
                doc.restore();
                doc.rect(X_PERFIL, currentY - 5, 30, scaleY).stroke();

                // Ponto do Gráfico
                let xPoint = X_GRAPH + (nspt * 3);
                if (xPoint > X_GRAPH_END) xPoint = X_GRAPH_END;
                pontosGrafico.push({ x: xPoint, y: currentY + 5 });
                doc.circle(xPoint, currentY + 5, 2).fillColor('red').fill();

                currentY += scaleY;
            }

            // Linha do Gráfico
            if (pontosGrafico.length > 1) {
                doc.save();
                doc.strokeColor('red').lineWidth(1.5);
                doc.moveTo(pontosGrafico[0].x, pontosGrafico[0].y);
                for (let p of pontosGrafico) doc.lineTo(p.x, p.y);
                doc.stroke();
                doc.restore();
            }

            // Grade do Gráfico
            doc.save();
            doc.strokeColor('#cccccc').lineWidth(0.5).dash(2, { space: 2 });
            for(let g=10; g<=50; g+=10) {
                let xG = X_GRAPH + (g * 3);
                doc.moveTo(xG, startY).lineTo(xG, currentY).stroke();
            }
            doc.restore();

            // --- FOTOS ---
            if(fotosRes.rows.length > 0) {
                doc.addPage();
                doc.fontSize(14).fillColor('black').text(`Relatório Fotográfico - ${furo.nome_furo}`, {align: 'center'});
                doc.moveDown();
                
                let xFoto = 50, yFoto = 100, count = 0;
                for(let foto of fotosRes.rows) {
                    try {
                        const imgBuffer = Buffer.from(foto.imagem.split(",")[1], 'base64');
                        doc.image(imgBuffer, xFoto, yFoto, { width: 220, height: 160, fit: [220, 160] });
                        doc.fontSize(10).text(foto.legenda || '', xFoto, yFoto + 165, {width: 220, align: 'center'});
                        
                        count++;
                        if (count % 2 === 1) { xFoto = 300; } 
                        else { xFoto = 50; yFoto += 220; }
                        
                        if(yFoto > 700 && count < fotosRes.rows.length) { doc.addPage(); yFoto = 50; xFoto = 50; count=0; }
                    } catch(e) { console.error('Erro foto', e); }
                }
            }
        }
        doc.end();
    } catch (err) { console.error(err); res.status(500).send('Erro ao gerar relatório'); }
});

// --- CRIAÇÃO DE PROPOSTA (COMERCIAL) ---
app.post('/gerar-proposta', async (req, res) => { 
    const d = req.body; const v_furos = parseInt(d.furos)||0; const v_metragem = parseFloat(d.metragem)||0; 
    const valor_total = (v_metragem * parseFloat(d.valor_metro)) + parseFloat(d.art) + parseFloat(d.mobilizacao) - parseFloat(d.desconto); 
    try { 
        const sql=`INSERT INTO propostas (cliente, telefone, email, endereco, furos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total, criterio, detalhe_criterio) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, data_criacao`; 
        const v=[d.cliente, d.telefone, d.email, d.endereco, v_furos, v_metragem, d.art, d.mobilizacao, d.desconto, valor_total, d.criterio_tecnico, d.detalhe_criterio]; 
        const dbRes=await pool.query(sql, v); 
        const dadosPDF = { id: dbRes.rows[0].id, data: new Date().toLocaleDateString('pt-BR'), ...d, furos: v_furos, metragem: v_metragem, valor_metro: d.valor_metro, subtotal_sondagem: v_metragem * d.valor_metro, art: d.art, mobilizacao: d.mobilizacao, desconto: d.desconto, total: valor_total, criterio: d.criterio_tecnico, detalhe_criterio: d.detalhe_criterio };
        gerarPDFDinamico(res, dadosPDF);
    } catch(e){console.error(e); res.status(500).send('Erro');} 
});

app.get('/reemitir-pdf/:id', async (req, res) => { 
    if (!adminLogado) return res.redirect('/login');
    try {
        const result = await pool.query('SELECT * FROM propostas WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).send('Não encontrado');
        const row = result.rows[0];
        const dadosPDF = { id: row.id, data: new Date(row.data_criacao).toLocaleDateString('pt-BR'), cliente: row.cliente, telefone: row.telefone, email: row.email, endereco: row.endereco, furos: row.furos, metragem: row.metragem_total, valor_metro: 0, subtotal_sondagem: 0, art: row.valor_art, mobilizacao: row.valor_mobilizacao, desconto: row.valor_desconto, total: row.valor_total, criterio: row.criterio, detalhe_criterio: row.detalhe_criterio };
        gerarPDFDinamico(res, dadosPDF);
    } catch (err) { res.status(500).send('Erro'); }
});

function gerarPDFDinamico(res, d) {
    const doc = new PDFDocument({ margin: 30, size: 'A4', bufferPages: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Proposta_${d.id}.pdf"`);
    doc.pipe(res);
    // (Lógica do PDF Comercial mantida simples para economizar linhas, pois o foco agora é o Técnico)
    doc.fontSize(14).text('ORÇAMENTO SONDAMAIS - ' + d.cliente);
    doc.fontSize(10).text(`Total: R$ ${d.total}`);
    doc.end();
}

// --- INIT SQL ---
const initSQL = `
CREATE TABLE IF NOT EXISTS propostas (id SERIAL PRIMARY KEY, cliente VARCHAR(255), endereco TEXT, furos INTEGER, metragem_total NUMERIC, valor_art NUMERIC, valor_mobilizacao NUMERIC, valor_desconto NUMERIC, valor_total NUMERIC, data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP, telefone VARCHAR(50), email VARCHAR(255), criterio VARCHAR(50), detalhe_criterio VARCHAR(255));
CREATE TABLE IF NOT EXISTS furos (id SERIAL PRIMARY KEY, proposta_id INTEGER REFERENCES propostas(id) ON DELETE CASCADE, nome_furo VARCHAR(20), sondador VARCHAR(100), data_inicio DATE, data_termino DATE, cota NUMERIC, nivel_agua_inicial NUMERIC, nivel_agua_final NUMERIC, revestimento NUMERIC, coordenadas TEXT);
CREATE TABLE IF NOT EXISTS amostras (id SERIAL PRIMARY KEY, furo_id INTEGER REFERENCES furos(id) ON DELETE CASCADE, profundidade_ini NUMERIC, profundidade_fim NUMERIC, golpe_1 INTEGER, golpe_2 INTEGER, golpe_3 INTEGER, tipo_solo TEXT, cor_solo TEXT, obs_solo TEXT);
CREATE TABLE IF NOT EXISTS fotos (id SERIAL PRIMARY KEY, furo_id INTEGER REFERENCES furos(id) ON DELETE CASCADE, imagem TEXT, legenda VARCHAR(100), data_upload TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
`;
pool.query(initSQL).then(() => { console.log('>>> DB OK <<<'); app.listen(port, () => { console.log(`Rodando na porta ${port}`); }); }).catch(err => { console.error('ERRO DB:', err); });