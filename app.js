require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./config/db'); 
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

global.adminLogado = false; 
const SENHA_MESTRA = process.env.SENHA_MESTRA || 'admin123';

// CORES PADRÃO ABGE/NBR
const C = { 
    GRID: '#d0d0d0', 
    BORDER: '#000000',
    GRAPH_LINE: '#cc0000', // Vermelho NSPT
    WATER: '#0066cc',      // Azul Nível D'água
    TEXT: '#000000',
    HEADER_BG: '#f0f0f0'
};

// --- ROTAS ---
const propostasRoutes = require('./routes/propostas');
const propostasController = require('./controllers/propostasController');
app.use('/api/propostas', propostasRoutes);
app.post('/gerar-proposta', propostasController.criarProposta); 

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/orcamento', (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/boletim', (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));

const checkAuth = (req, res, next) => { if (global.adminLogado) next(); else res.redirect('/login'); };
app.get('/crm', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/engenharia', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html'))); 
app.get('/logout', (req, res) => { global.adminLogado = false; res.redirect('/login'); });
app.post('/api/login', (req, res) => { if (req.body.senha === SENHA_MESTRA) { global.adminLogado = true; res.sendStatus(200); } else { res.sendStatus(401); } });

// --- API (Mantida) ---
app.get('/api/engenharia/:id', async (req, res) => {
    if (!global.adminLogado) return res.status(403).send('Acesso Negado');
    try {
        const propId = req.params.id;
        const propRes = await pool.query('SELECT * FROM propostas WHERE id = $1', [propId]);
        const furosRes = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [propId]);
        const furos = furosRes.rows;
        for (let furo of furos) {
            const amosRes = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [furo.id]);
            furo.amostras = amosRes.rows;
            const fotoRes = await pool.query('SELECT id, legenda, data_upload FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [furo.id]);
            furo.fotos = fotoRes.rows;
        }
        res.json({ proposta: propRes.rows[0], furos });
    } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/boletim/furos/:obraId', async (req, res) => { try { const r = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [req.params.obraId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/furos', async (req, res) => { const d = req.body; try { const r = await pool.query(`INSERT INTO furos (proposta_id, nome_furo, sondador, data_inicio, cota, nivel_agua_inicial) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [d.proposta_id, d.nome_furo, d.sondador, d.data_inicio, d.cota, d.nivel_agua_inicial]); res.json({id: r.rows[0].id}); } catch (e) { res.status(500).json(e); } });
app.put('/api/boletim/furos/:id', async (req, res) => { const {id} = req.params; const d = req.body; try { await pool.query(`UPDATE furos SET nivel_agua_inicial=$1, nivel_agua_final=$2, data_inicio=$3, data_termino=$4, coordenadas=$5 WHERE id=$6`, [d.nivel_agua_inicial, d.nivel_agua_final, d.data_inicio, d.data_termino, d.coordenadas, id]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/boletim/amostras/:furoId', async (req, res) => { try { const r = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [req.params.furoId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/amostras', async (req, res) => { const d = req.body; try { await pool.query(`INSERT INTO amostras (furo_id, profundidade_ini, profundidade_fim, golpe_1, golpe_2, golpe_3, tipo_solo, cor_solo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [d.furo_id, d.profundidade_ini, d.profundidade_fim, d.golpe_1, d.golpe_2, d.golpe_3, d.tipo_solo, d.cor_solo]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/boletim/fotos/:furoId', async (req, res) => { try { const r = await pool.query('SELECT id, legenda, data_upload FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [req.params.furoId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/fotos', async (req, res) => { const {furo_id, imagem_base64, legenda} = req.body; try { await pool.query(`INSERT INTO fotos (furo_id, imagem, legenda) VALUES ($1, $2, $3)`, [furo_id, imagem_base64, legenda]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/foto-full/:id', async (req, res) => { try { const r = await pool.query('SELECT imagem FROM fotos WHERE id = $1', [req.params.id]); if(r.rows.length > 0) { const img = Buffer.from(r.rows[0].imagem.split(",")[1], 'base64'); res.writeHead(200, {'Content-Type': 'image/jpeg', 'Content-Length': img.length}); res.end(img); } else res.status(404).send('Not found'); } catch(e) { res.status(500).send(e); } });

// --- NOVO MOTOR GRÁFICO (NORMA ABGE/NBR) ---
app.get('/gerar-relatorio-tecnico/:id', async (req, res) => {
    if (!global.adminLogado) return res.redirect('/login');
    try {
        const propId = req.params.id;
        const propRes = await pool.query('SELECT * FROM propostas WHERE id = $1', [propId]);
        const proposta = propRes.rows[0];
        const furosRes = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [propId]);
        const furos = furosRes.rows;

        const doc = new PDFDocument({ margin: 20, size: 'A4', bufferPages: true });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Relatorio_Tecnico_${proposta.id}.pdf"`);
        doc.pipe(res);

        const logoPath = path.join(__dirname, 'public', 'logo.png');

        // FUNÇÃO DE DESENHO DE PERFIL (CAD STYLE)
        for (let i = 0; i < furos.length; i++) {
            const furo = furos[i];
            const amosRes = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [furo.id]);
            const amostras = amosRes.rows;
            const fotosRes = await pool.query('SELECT * FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [furo.id]);

            doc.addPage();

            // --- CONFIGURAÇÃO DE LAYOUT (COORDENADAS X) ---
            // Tabela ABGE Padrão
            const X = {
                PROF: 30,       // Profundidade
                AMOSTRA: 60,    // Nº Amostra
                GOLPES: 90,     // 1º, 2º, 3º
                NSPT: 140,      // N
                GRAF_INI: 160,  // Início do Gráfico
                GRAF_FIM: 280,  // Fim do Gráfico
                PERFIL: 290,    // Coluna visual (cor)
                DESC: 310,      // Descrição
                FIM: 570
            };
            const ESCALA_VERTICAL = 30; // 30 pontos = 1 metro (Escala Visual)

            // --- 1. CABEÇALHO TÉCNICO COMPLETO ---
            const drawHeaderBox = (y, h) => { doc.rect(20, y, 555, h).stroke(); };
            const drawLabel = (txt, x, y) => doc.font('Helvetica-Bold').fontSize(7).text(txt, x, y);
            const drawValue = (txt, x, y) => doc.font('Helvetica').fontSize(8).text(txt || '-', x, y);

            // Linha 1: Título e Logo
            doc.rect(20, 20, 555, 50).stroke();
            if (fs.existsSync(logoPath)) doc.image(logoPath, 25, 25, { width: 80 });
            doc.font('Helvetica-Bold').fontSize(16).text('PERFIL INDIVIDUAL DE SONDAGEM A PERCUSSÃO', 120, 30);
            doc.fontSize(10).text('NBR 6484:2020', 120, 50);

            // Linha 2: Dados da Obra
            let yH = 70;
            drawHeaderBox(yH, 35);
            drawLabel('CLIENTE:', 25, yH+5); drawValue(proposta.cliente, 70, yH+5);
            drawLabel('OBRA/LOCAL:', 25, yH+18); drawValue(proposta.endereco, 90, yH+18);
            
            drawLabel('FURO Nº:', 400, yH+5); doc.fontSize(12).text(furo.nome_furo, 450, yH+3);
            drawLabel('DATA:', 400, yH+18); drawValue(furo.data_inicio ? new Date(furo.data_inicio).toLocaleDateString() : '-', 450, yH+18);

            // Linha 3: Dados Técnicos (Cota, NA, Coord)
            yH = 105;
            drawHeaderBox(yH, 25);
            drawLabel('COTA BOCA:', 25, yH+5); drawValue(furo.cota || 'Relativa', 25, yH+15);
            
            // Nível D'água (Azul para destaque)
            drawLabel('NÍVEL D\'ÁGUA (NA):', 120, yH+5); 
            let txtNa = `INI: ${furo.nivel_agua_inicial || 'Seco'}m`;
            if(furo.nivel_agua_final) txtNa += ` | FIM: ${furo.nivel_agua_final}m`;
            doc.fillColor(C.WATER).font('Helvetica-Bold').text(txtNa, 120, yH+15).fillColor(C.BORDER);

            drawLabel('COORDENADAS:', 300, yH+5); drawValue(furo.coordenadas || 'Não inf.', 300, yH+15);
            drawLabel('EXECUTOR:', 450, yH+5); drawValue(furo.sondador || 'SondaMais', 450, yH+15);

            // --- 2. CABEÇALHOS DA TABELA (BOX VERDE) ---
            yH = 130;
            doc.rect(20, yH, 555, 25).fill(C.HEADER_BG).stroke();
            doc.fillColor(C.TEXT).font('Helvetica-Bold').fontSize(6);
            
            const centerText = (txt, x, w, y) => doc.text(txt, x, y, {width: w, align: 'center'});
            
            centerText('PROF\n(m)', X.PROF, 30, yH+8);
            centerText('AMOSTRA\nNº', X.AMOSTRA, 30, yH+8);
            centerText('GOLPES\n30cm', X.GOLPES, 50, yH+8);
            centerText('NSPT\n(N)', X.NSPT, 20, yH+8);
            
            // Cabeçalho do Gráfico
            centerText('RESISTÊNCIA A PENETRAÇÃO (Golpes)', X.GRAF_INI, X.GRAF_FIM - X.GRAF_INI, yH+5);
            // Régua do gráfico (0 10 20 30 40 50)
            doc.fontSize(5);
            for(let k=0; k<=5; k++) {
                let gx = X.GRAF_INI + (k * (X.GRAF_FIM - X.GRAF_INI)/5);
                doc.text(k*10, gx-5, yH+16);
            }

            centerText('PERFIL', X.PERFIL, 20, yH+10);
            doc.text('DESCRIÇÃO DO MATERIAL', X.DESC+5, yH+10);

            // --- 3. LOOP DE DADOS (DESENHO VETORIAL) ---
            let currentY = 155;
            let startGraphY = currentY;
            
            // Arrays para polilinha do gráfico
            let polylinePoints = []; 

            // Loop de Amostras (Metro a Metro)
            for (let am of amostras) {
                // Checar quebra de página
                if (currentY > 750) {
                    // Desenha o gráfico da página atual antes de quebrar
                    drawGraphOverlay(doc, polylinePoints);
                    polylinePoints = []; // Reseta para nova página
                    
                    doc.addPage();
                    currentY = 50; 
                    startGraphY = currentY;
                    doc.font('Helvetica-Bold').fontSize(10).text(`Continuação ${furo.nome_furo}`, 20, 30);
                }

                const prof = parseFloat(am.profundidade_ini);
                const g1 = am.golpe_1 || '';
                const g2 = am.golpe_2 || '';
                const g3 = am.golpe_3 || '';
                const nspt = (parseInt(g2)||0) + (parseInt(g3)||0);
                
                // 1. Linhas de Grade Horizontal (Fina)
                doc.save().strokeColor(C.GRID).lineWidth(0.5)
                   .moveTo(20, currentY + ESCALA_VERTICAL).lineTo(575, currentY + ESCALA_VERTICAL).stroke().restore();

                // 2. Textos
                doc.fillColor(C.TEXT).font('Helvetica').fontSize(8);
                // Prof
                doc.text(prof.toFixed(0), X.PROF, currentY+10, {width: 30, align:'center'});
                // Amostra
                doc.text(Math.ceil(prof), X.AMOSTRA, currentY+10, {width: 30, align:'center'});
                // Golpes
                doc.fontSize(7).text(`${g1} / ${g2} / ${g3}`, X.GOLPES, currentY+10, {width: 50, align:'center'});
                // NSPT
                doc.font('Helvetica-Bold').fontSize(9).text(nspt > 0 ? nspt : '-', X.NSPT, currentY+10, {width: 20, align:'center'});

                // 3. Coluna Visual (Cor do Solo)
                let corSolo = '#ffffff';
                const desc = (am.tipo_solo || '').toLowerCase();
                if(desc.includes('argila')) corSolo = '#e6b8af'; // Avermelhado
                if(desc.includes('areia')) corSolo = '#fff2cc';  // Amarelo
                if(desc.includes('silte')) corSolo = '#d9ead3';  // Verde claro
                if(desc.includes('aterro')) corSolo = '#cccccc'; // Cinza
                
                doc.save().rect(X.PERFIL, currentY, X.DESC - X.PERFIL, ESCALA_VERTICAL).fill(corSolo).stroke().restore();

                // 4. Descrição
                doc.font('Helvetica').fontSize(7).fillColor(C.TEXT)
                   .text(am.tipo_solo || '', X.DESC + 5, currentY + 8, {width: 250, align: 'left'});

                // 5. Preparar Ponto do Gráfico
                let graphWidth = X.GRAF_FIM - X.GRAF_INI;
                let val = nspt > 50 ? 50 : nspt;
                let px = X.GRAF_INI + ((val / 50) * graphWidth);
                let py = currentY + (ESCALA_VERTICAL / 2); // Meio do metro
                if (nspt > 0) polylinePoints.push([px, py]);

                // 6. Desenhar Nível D'água Visual (Se coincidir com a profundidade)
                if (furo.nivel_agua_final && Math.abs(parseFloat(furo.nivel_agua_final) - prof) < 0.5) {
                    let yW = currentY + ((parseFloat(furo.nivel_agua_final) - Math.floor(prof)) * ESCALA_VERTICAL);
                    doc.save().strokeColor(C.WATER).lineWidth(2)
                       .moveTo(X.GRAF_INI, yW).lineTo(X.GRAF_FIM, yW).stroke();
                    // Triângulo
                    doc.polygon([X.GRAF_INI-5, yW-5], [X.GRAF_INI+5, yW-5], [X.GRAF_INI, yW]).fill(C.WATER);
                    doc.restore();
                }

                currentY += ESCALA_VERTICAL;
            }

            // Desenha o gráfico sobreposto (para ficar por cima das linhas)
            drawGraphOverlay(doc, polylinePoints, X, startGraphY, currentY);

            // Borda Externa Final da Tabela
            doc.rect(20, 155, 555, currentY - 155).stroke();
            
            // Linhas Verticais Estruturais (Pretas)
            doc.save().strokeColor(C.BORDER).lineWidth(0.5);
            [X.AMOSTRA, X.GOLPES, X.NSPT, X.GRAF_INI, X.GRAF_FIM, X.PERFIL, X.DESC].forEach(x => {
                doc.moveTo(x, 155).lineTo(x, currentY).stroke();
            });
            doc.restore();

            // --- FOTOS ---
            if(fotosRes.rows.length > 0) {
                doc.addPage();
                doc.font('Helvetica-Bold').fontSize(14).text(`ANEXO FOTOGRÁFICO - ${furo.nome_furo}`, {align:'center'});
                let yPos = 80;
                for(let foto of fotosRes.rows) {
                    try {
                        const img = Buffer.from(foto.imagem.split(",")[1], 'base64');
                        if(yPos > 650) { doc.addPage(); yPos = 50; }
                        doc.image(img, 150, yPos, { width: 300 });
                        doc.fontSize(10).text(foto.legenda || '', 150, yPos + 210, {align:'center', width: 300});
                        yPos += 250;
                    } catch(e){}
                }
            }
        }
        doc.end();
    } catch (err) { console.error(err); res.status(500).send('Erro no relatório: '+err.message); }
});

// Função Auxiliar para Desenhar o Gráfico (Grade + Linha Vermelha)
function drawGraphOverlay(doc, points, X, yStart, yEnd) {
    if(!X) return; 
    
    // 1. Desenhar Linhas Verticais da Grade do Gráfico (0,10,20...)
    doc.save().strokeColor(C.GRID).lineWidth(0.5).dash(2, {space: 2});
    for(let k=1; k<5; k++) { // Linhas internas (10, 20, 30, 40)
        let gx = X.GRAF_INI + (k * (X.GRAF_FIM - X.GRAF_INI)/5);
        doc.moveTo(gx, yStart).lineTo(gx, yEnd).stroke();
    }
    doc.restore();

    // 2. Desenhar Polilinha Vermelha
    if (points.length > 1) {
        doc.save().strokeColor(C.GRAPH_LINE).lineWidth(2).lineJoin('round');
        doc.moveTo(points[0][0], points[0][1]);
        for(let i=1; i<points.length; i++) {
            doc.lineTo(points[i][0], points[i][1]);
        }
        doc.stroke();
        
        // 3. Pontos (Círculos)
        doc.fillColor(C.GRAPH_LINE);
        points.forEach(p => {
            doc.circle(p[0], p[1], 2).fill();
        });
        doc.restore();
    }
}

app.listen(port, () => { console.log(`>>> SondaSaaS rodando na porta ${port} <<<`); });