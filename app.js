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

// CORES SONDAMAIS (Baseado no Logo)
const COLORS = {
    PRIMARY: '#444444', 
    SONDA_GREEN: '#8CBF26', 
    BORDER: '#000000', 
    BG_HEADER: '#ffffff'
};

const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:admin123@localhost:5432/sondasaas';

const pool = new Pool({
    connectionString: connectionString,
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

// AUMENTO DO LIMITE PARA FOTOS (50MB)
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

// --- API GERAL ---
app.post('/api/login', (req, res) => {
    if (req.body.senha === SENHA_MESTRA) { adminLogado = true; res.sendStatus(200); } else { res.sendStatus(401); }
});

app.get('/api/propostas', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM propostas ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }); }
});

app.delete('/api/propostas/:id', async (req, res) => {
    if (!adminLogado) return res.status(403).send('Acesso Negado');
    try {
        await pool.query('DELETE FROM propostas WHERE id = $1', [req.params.id]);
        res.status(200).send('Excluído');
    } catch (err) { res.status(500).json({ error: 'Erro' }); }
});

// --- API ENGENHARIA ---
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

// --- API BOLETIM (CAMPO) ---
app.get('/api/boletim/furos/:obraId', async (req, res) => { try { const r = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [req.params.obraId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/furos', async (req, res) => { const d = req.body; try { const r = await pool.query(`INSERT INTO furos (proposta_id, nome_furo, sondador, data_inicio, cota, nivel_agua_inicial) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [d.proposta_id, d.nome_furo, d.sondador, d.data_inicio, d.cota, d.nivel_agua_inicial]); res.json({id: r.rows[0].id}); } catch (e) { res.status(500).json(e); } });
app.put('/api/boletim/furos/:id', async (req, res) => { const {id} = req.params; const d = req.body; try { await pool.query(`UPDATE furos SET nivel_agua_inicial=$1, nivel_agua_final=$2, data_inicio=$3, data_termino=$4, coordenadas=$5 WHERE id=$6`, [d.nivel_agua_inicial, d.nivel_agua_final, d.data_inicio, d.data_termino, d.coordenadas, id]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/boletim/amostras/:furoId', async (req, res) => { try { const r = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [req.params.furoId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/amostras', async (req, res) => { const d = req.body; try { await pool.query(`INSERT INTO amostras (furo_id, profundidade_ini, profundidade_fim, golpe_1, golpe_2, golpe_3, tipo_solo, cor_solo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [d.furo_id, d.profundidade_ini, d.profundidade_fim, d.golpe_1, d.golpe_2, d.golpe_3, d.tipo_solo, d.cor_solo]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/boletim/fotos/:furoId', async (req, res) => { try { const r = await pool.query('SELECT id, legenda, data_upload FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [req.params.furoId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/fotos', async (req, res) => { const {furo_id, imagem_base64, legenda} = req.body; try { await pool.query(`INSERT INTO fotos (furo_id, imagem, legenda) VALUES ($1, $2, $3)`, [furo_id, imagem_base64, legenda]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/foto-full/:id', async (req, res) => { try { const r = await pool.query('SELECT imagem FROM fotos WHERE id = $1', [req.params.id]); if(r.rows.length > 0) { const img = Buffer.from(r.rows[0].imagem.split(",")[1], 'base64'); res.writeHead(200, {'Content-Type': 'image/jpeg', 'Content-Length': img.length}); res.end(img); } else res.status(404).send('Not found'); } catch(e) { res.status(500).send(e); } });

// --- GERAÇÃO DO RELATÓRIO TÉCNICO (ESTILO SONDAMAIS) ---
app.get('/gerar-relatorio-tecnico/:id', async (req, res) => {
    if (!adminLogado) return res.redirect('/login');

    try {
        const propId = req.params.id;
        const propRes = await pool.query('SELECT * FROM propostas WHERE id = $1', [propId]);
        const proposta = propRes.rows[0];
        const furosRes = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [propId]);
        const furos = furosRes.rows;

        // Configuração do PDF (A4 Vertical)
        const doc = new PDFDocument({ margin: 20, size: 'A4', bufferPages: true });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Relatorio_Tecnico_SondaMais_${proposta.id}.pdf"`);
        doc.pipe(res);

        // -- CAPA --
        doc.rect(0, 0, 595, 842).fill('white'); // Fundo Branco
        const logoPath = path.join(__dirname, 'public', 'logo.png');
        if (fs.existsSync(logoPath)) { 
            doc.image(logoPath, 150, 100, { width: 300 }); 
        }
        
        doc.fillColor(COLORS.SONDA_GREEN).font('Helvetica-Bold').fontSize(30).text('SONDAMAIS', 0, 450, { align: 'center' });
        doc.fillColor(COLORS.PRIMARY).fontSize(20).text('SONDAGEM DE SOLO', 0, 490, { align: 'center' });
        doc.fillColor('black').fontSize(12).text(proposta.cliente, 0, 600, { align: 'center' });
        doc.text(proposta.endereco, 0, 620, { align: 'center' });
        doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`, 0, 650, { align: 'center' });

        // -- PÁGINAS DOS FUROS --
        for (let i = 0; i < furos.length; i++) {
            const furo = furos[i];
            const amosRes = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [furo.id]);
            const amostras = amosRes.rows;
            const fotosRes = await pool.query('SELECT * FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [furo.id]);
            
            doc.addPage();

            // -- CABEÇALHO DO FURO (ESTILO GRID) --
            const topY = 30;
            doc.rect(20, topY, 555, 60).stroke(); // Box Principal
            
            // Títulos e Dados
            doc.fontSize(8).font('Helvetica-Bold').fillColor('black');
            doc.text('CLIENTE:', 25, topY + 10);
            doc.font('Helvetica').text(proposta.cliente, 70, topY + 10);
            
            doc.font('Helvetica-Bold').text('LOCAL:', 25, topY + 25);
            doc.font('Helvetica').text(proposta.endereco, 70, topY + 25);

            doc.font('Helvetica-Bold').text('FURO:', 450, topY + 10);
            doc.fontSize(14).text(furo.nome_furo, 480, topY + 8);

            doc.fontSize(8).font('Helvetica-Bold').text('INÍCIO:', 450, topY + 30);
            doc.font('Helvetica').text(furo.data_inicio ? new Date(furo.data_inicio).toLocaleDateString() : '-', 490, topY + 30);

            doc.font('Helvetica-Bold').text('N.A. (m):', 450, topY + 45);
            doc.font('Helvetica').text(furo.nivel_agua_inicial || 'Seco', 490, topY + 45);

            // -- COLUNAS DO PERFIL --
            const headerY = 100;
            const yStart = 120;
            const colProf = 20;   // Profundidade
            const colGraf = 60;   // Gráfico
            const colGolpes = 200; // Golpes
            const colNSPT = 260;  // NSPT
            const colPerfil = 300; // Desenho Solo
            const colDesc = 340;  // Descrição

            // Títulos Colunas
            doc.font('Helvetica-Bold').fontSize(8);
            doc.text('Prof(m)', colProf, headerY);
            doc.text('Gráfico SPT (0-50)', colGraf, headerY);
            doc.text('Golpes', colGolpes, headerY);
            doc.text('NSPT', colNSPT, headerY);
            doc.text('Perfil', colPerfil, headerY);
            doc.text('Descrição do Material', colDesc, headerY);
            
            doc.moveTo(20, yStart).lineTo(575, yStart).stroke();

            let currentY = yStart + 10;
            let scaleY = 30; // 30 pixels por metro
            let pontosGrafico = [];

            // -- LOOP DAS AMOSTRAS --
            for (let am of amostras) {
                // Quebra de página se encher
                if (currentY > 750) { 
                    doc.addPage(); 
                    currentY = 50; 
                    // Redesenha título simples se quebrar página
                    doc.text('Continuação...', 20, 30);
                }

                const prof = parseFloat(am.profundidade_ini);
                const g1 = am.golpe_1 || 0;
                const g2 = am.golpe_2 || 0;
                const g3 = am.golpe_3 || 0;
                const nspt = parseInt(g2) + parseInt(g3);

                // 1. Profundidade
                doc.font('Helvetica').fontSize(9).fillColor('black');
                doc.text(prof.toFixed(2), colProf, currentY);

                // 2. Golpes Texto
                doc.fontSize(8);
                doc.text(`${g1} / ${g2} / ${g3}`, colGolpes, currentY);

                // 3. NSPT (Negrito)
                doc.font('Helvetica-Bold').fontSize(10);
                doc.text(nspt.toString(), colNSPT, currentY);

                // 4. Perfil Visual (COR DO SOLO)
                // Lógica de cores baseada no texto do solo (Referência SondaMais)
                let corSolo = '#e0e0e0'; // Cinza padrão
                const desc = (am.tipo_solo || '').toLowerCase();
                
                if(desc.includes('argila')) corSolo = '#D2691E'; // Chocolate (Argila)
                else if(desc.includes('areia')) corSolo = '#F0E68C'; // Khaki (Areia)
                else if(desc.includes('silte')) corSolo = '#8FBC8F'; // Verde (Silte)
                else if(desc.includes('aterro')) corSolo = '#A9A9A9'; // Cinza Escuro

                doc.save();
                doc.rect(colPerfil, currentY - 5, 30, scaleY).fill(corSolo);
                doc.restore();
                doc.rect(colPerfil, currentY - 5, 30, scaleY).stroke();

                // 5. Descrição Texto
                doc.font('Helvetica').fontSize(8).fillColor('black');
                doc.text(am.tipo_solo || '-', colDesc, currentY, { width: 220 });

                // 6. Dados para o Gráfico
                // Escala: 0 a 50 golpes = 120 pixels de largura (aprox 2.4px por golpe)
                let xG = colGraf + (nspt * 2.4);
                if (xG > colGraf + 120) xG = colGraf + 120; // Limite gráfico
                pontosGrafico.push({ x: xG, y: currentY + 5 });

                // Desenha ponto vermelho
                doc.circle(xG, currentY + 5, 2).fillColor('red').fill();

                currentY += scaleY;
            }

            // -- DESENHAR A LINHA DO GRÁFICO (Conectar pontos) --
            if (pontosGrafico.length > 1) {
                doc.save();
                doc.strokeColor('red').lineWidth(1.5);
                doc.moveTo(pontosGrafico[0].x, pontosGrafico[0].y);
                for (let p of pontosGrafico) {
                    doc.lineTo(p.x, p.y);
                }
                doc.stroke();
                doc.restore();
            }

            // -- GRADE DE FUNDO DO GRÁFICO --
            doc.save();
            doc.strokeColor('#cccccc').lineWidth(0.5).dash(2, { space: 2 });
            // Linhas verticais a cada 10 golpes (10, 20, 30, 40, 50)
            for(let g=10; g<=50; g+=10) {
                let lineX = colGraf + (g * 2.4);
                doc.moveTo(lineX, yStart).lineTo(lineX, currentY).stroke();
                // Numerozinho no topo
                doc.fontSize(6).text(g.toString(), lineX - 3, yStart - 10);
            }
            doc.restore();

            // -- FOTOS DO FURO --
            if(fotosRes.rows.length > 0) {
                doc.addPage();
                doc.rect(20, 20, 555, 30).fill(COLORS.SONDA_GREEN);
                doc.fillColor('white').fontSize(14).font('Helvetica-Bold').text(`REGISTRO FOTOGRÁFICO - ${furo.nome_furo}`, 30, 30);
                doc.fillColor('black');
                
                let xFoto = 40;
                let yFoto = 80;
                let count = 0;

                for(let foto of fotosRes.rows) {
                    try {
                        const imgBuffer = Buffer.from(foto.imagem.split(",")[1], 'base64');
                        doc.image(imgBuffer, xFoto, yFoto, { width: 240, height: 180, fit: [240, 180] });
                        
                        // Legenda
                        doc.rect(xFoto, yFoto + 180, 240, 20).fill('#f0f0f0');
                        doc.fillColor('black').fontSize(9).text(foto.legenda || 'Foto', xFoto + 5, yFoto + 186, {width: 230, align: 'center'});

                        count++;
                        if (count % 2 === 1) { xFoto = 310; } // Vai pra direita
                        else { xFoto = 40; yFoto += 220; } // Vai pra baixo
                        
                        if(yFoto > 700) { doc.addPage(); yFoto = 80; xFoto = 40; count=0; }

                    } catch(e) { console.error('Erro imagem', e); }
                }
            }
        }

        doc.end();

    } catch (err) {
        console.error(err);
        res.status(500).send('Erro ao gerar relatório técnico');
    }
});

// --- INIT SQL ---
const initSQL = `
CREATE TABLE IF NOT EXISTS propostas (id SERIAL PRIMARY KEY, cliente VARCHAR(255), endereco TEXT, furos INTEGER, metragem_total NUMERIC, valor_art NUMERIC, valor_mobilizacao NUMERIC, valor_desconto NUMERIC, valor_total NUMERIC, data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP, telefone VARCHAR(50), email VARCHAR(255), criterio VARCHAR(50), detalhe_criterio VARCHAR(255));
CREATE TABLE IF NOT EXISTS furos (id SERIAL PRIMARY KEY, proposta_id INTEGER REFERENCES propostas(id) ON DELETE CASCADE, nome_furo VARCHAR(20), sondador VARCHAR(100), data_inicio DATE, data_termino DATE, cota NUMERIC, nivel_agua_inicial NUMERIC, nivel_agua_final NUMERIC, revestimento NUMERIC, coordenadas TEXT);
CREATE TABLE IF NOT EXISTS amostras (id SERIAL PRIMARY KEY, furo_id INTEGER REFERENCES furos(id) ON DELETE CASCADE, profundidade_ini NUMERIC, profundidade_fim NUMERIC, golpe_1 INTEGER, golpe_2 INTEGER, golpe_3 INTEGER, tipo_solo TEXT, cor_solo TEXT, obs_solo TEXT);
CREATE TABLE IF NOT EXISTS fotos (id SERIAL PRIMARY KEY, furo_id INTEGER REFERENCES furos(id) ON DELETE CASCADE, imagem TEXT, legenda VARCHAR(100), data_upload TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
`;
pool.query(initSQL).then(() => { console.log('>>> DB OK <<<'); app.listen(port, () => { console.log(`Rodando na porta ${port}`); }); }).catch(err => { console.error('ERRO DB:', err); });