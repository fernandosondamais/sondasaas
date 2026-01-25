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

// CORES E PADRÕES TÉCNICOS
const C = { 
    GRID: '#d0d0d0', 
    BORDER: '#000000',
    GRAPH_LINE: '#ff0000',
    WATER: '#0000ff',
    TEXT: '#000000',
    HEADER_BG: '#d9d9d9', // Cinza padrão engenharia
    // Cores de Fundo Litologia
    BG_ARGILA: '#e6b8af', // Rosado
    BG_AREIA: '#fff2cc',  // Amarelo
    BG_SILTE: '#d9ead3',  // Verde Claro
    BG_ATERRO: '#cccccc'  // Cinza
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

// --- API ---
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

// --- FUNÇÃO DE HACHURAS (SIMBOLOGIA GEOLÓGICA) ---
function drawLithology(doc, x, y, w, h, tipoSolo) {
    const solo = (tipoSolo || '').toLowerCase();
    
    doc.save().rect(x, y, w, h).clip(); // Corta o desenho para ficar dentro da caixa

    if (solo.includes('aterro')) {
        // ATERRO: Cinza + Xadrez
        doc.fillColor(C.BG_ATERRO).rect(x, y, w, h).fill();
        doc.strokeColor('#999999').lineWidth(0.5);
        for(let i = -w; i < h; i+=5) {
            doc.moveTo(x, y+i).lineTo(x+w, y+i+w).stroke(); // Diagonal 1
            doc.moveTo(x+w, y+i).lineTo(x, y+i+w).stroke(); // Diagonal 2
        }
    } 
    else if (solo.includes('areia')) {
        // AREIA: Amarelo + Pontos (Dots)
        doc.fillColor(C.BG_AREIA).rect(x, y, w, h).fill();
        doc.fillColor('#d4a017'); // Ouro Escuro
        for(let i=0; i<30; i++) { // Densidade de pontos
            const randX = x + Math.random() * w;
            const randY = y + Math.random() * h;
            doc.circle(randX, randY, 0.8).fill();
        }
    } 
    else if (solo.includes('argila')) {
        // ARGILA: Vermelho/Rosa + Traços Horizontais
        doc.fillColor(C.BG_ARGILA).rect(x, y, w, h).fill();
        doc.strokeColor('#cc0000').lineWidth(0.5); // Vermelho escuro
        for(let i=3; i<h; i+=4) { // Linhas a cada 4px
            // Pequenos traços horizontais aleatórios
            const dashW = 5 + Math.random() * 10;
            const dashX = x + Math.random() * (w - dashW);
            doc.moveTo(dashX, y+i).lineTo(dashX+dashW, y+i).stroke();
        }
    } 
    else if (solo.includes('silte')) {
        // SILTE: Verde + Diagonal Fina
        doc.fillColor(C.BG_SILTE).rect(x, y, w, h).fill();
        doc.strokeColor('#6aa84f').lineWidth(0.3);
        for(let i = -w; i < h; i+=6) {
            doc.moveTo(x, y+i).lineTo(x+w, y+i+w).stroke();
        }
    } else {
        // Solo Indefinido (Branco)
        doc.fillColor('white').rect(x, y, w, h).fill();
    }

    doc.restore();
}

// --- RELATÓRIO TÉCNICO (PADRÃO RIGOROSO NBR/ABGE) ---
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
        res.setHeader('Content-Disposition', `attachment; filename="Relatorio_Engenharia_${proposta.id}.pdf"`);
        doc.pipe(res);

        const logoPath = path.join(__dirname, 'public', 'logo.png');

        // LOOP DE FUROS (CADA UM GERA UM PERFIL)
        for (let i = 0; i < furos.length; i++) {
            const furo = furos[i];
            const amosRes = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [furo.id]);
            const amostras = amosRes.rows;
            const fotosRes = await pool.query('SELECT * FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [furo.id]);

            doc.addPage();

            // COORDENADAS X (AJUSTE FINO)
            const X = {
                PROF: 30,       
                AMOSTRA: 60,    
                GOLPES: 90,     
                NSPT: 135,      
                GRAF_INI: 155,  // Largura 115
                GRAF_FIM: 270,  
                PERFIL: 280,    // Onde vai a hachura (Largura 25)
                PERFIL_FIM: 305,
                DESC: 310,      
                FIM: 570
            };
            const ESCALA = 30; // 30px = 1 metro

            // --- CABEÇALHO TÉCNICO (BOX) ---
            const drawBox = (y, h, fill) => { 
                doc.rect(20, y, 555, h);
                if(fill) doc.fill(fill);
                doc.stroke();
            };
            
            // 1. Logo e Título
            drawBox(20, 50, 'white');
            if (fs.existsSync(logoPath)) doc.image(logoPath, 25, 25, { width: 80 });
            doc.fillColor('black').font('Helvetica-Bold').fontSize(14).text('PERFIL INDIVIDUAL DE SONDAGEM SPT', 130, 32);
            doc.fontSize(9).text('NBR 6484:2020', 130, 50);

            // 2. Dados Gerais
            let yH = 70;
            drawBox(yH, 35, 'white');
            doc.fontSize(7).font('Helvetica-Bold');
            doc.text('CLIENTE:', 25, yH+5); doc.font('Helvetica').text(proposta.cliente, 70, yH+5);
            doc.font('Helvetica-Bold').text('OBRA:', 25, yH+18); doc.font('Helvetica').text(proposta.endereco, 70, yH+18);
            
            doc.font('Helvetica-Bold').text('FURO:', 450, yH+5); doc.fontSize(12).text(furo.nome_furo, 490, yH+3);
            doc.fontSize(7).font('Helvetica-Bold').text('DATA:', 450, yH+18); doc.font('Helvetica').text(furo.data_inicio ? new Date(furo.data_inicio).toLocaleDateString() : '-', 490, yH+18);

            // 3. Dados Técnicos (Água, Cota)
            yH = 105;
            drawBox(yH, 25, 'white');
            
            doc.font('Helvetica-Bold').text('COTA:', 25, yH+10); doc.font('Helvetica').text(furo.cota || 'Relativa', 55, yH+10);
            
            doc.font('Helvetica-Bold').text('NÍVEL D\'ÁGUA (NA):', 150, yH+10);
            const naIni = furo.nivel_agua_inicial ? `${furo.nivel_agua_inicial}m` : 'Seco';
            const naFim = furo.nivel_agua_final ? `${furo.nivel_agua_final}m` : '-';
            doc.fillColor(C.WATER).font('Helvetica-Bold').text(`Inicial: ${naIni}  |  24h: ${naFim}`, 235, yH+10);
            
            doc.fillColor('black').font('Helvetica-Bold').text('COORD:', 450, yH+10); doc.font('Helvetica').text(furo.coordenadas || '-', 490, yH+10);

            // 4. Cabeçalho Tabela (Cinza)
            yH = 130;
            drawBox(yH, 25, C.HEADER_BG);
            doc.fillColor('black').font('Helvetica-Bold').fontSize(6);
            
            const center = (t, x, w) => doc.text(t, x, yH+8, {width: w, align: 'center'});
            center('PROF\n(m)', X.PROF, 30);
            center('AMOSTRA\nNº', X.AMOSTRA, 30);
            center('GOLPES\n30cm', X.GOLPES, 45);
            center('N\nSPT', X.NSPT, 20);
            
            // Gráfico
            center('PENETRAÇÃO (Golpes)', X.GRAF_INI, X.GRAF_FIM - X.GRAF_INI);
            doc.fontSize(5);
            for(let k=0; k<=5; k++) doc.text(k*10, X.GRAF_INI + (k*(X.GRAF_FIM-X.GRAF_INI)/5) - 3, yH+18);

            doc.fontSize(6).text('PERFIL', X.PERFIL, yH+10, {width: 25, align: 'center'});
            doc.text('DESCRIÇÃO ESTRATIGRÁFICA', X.DESC+5, yH+10);

            // --- LOOP DE DADOS ---
            let currentY = 155;
            let startGraphY = currentY;
            let polylinePoints = [];

            for (let am of amostras) {
                // Paginação
                if (currentY > 750) {
                    drawGraphLines(doc, startGraphY, currentY, X);
                    drawGraphTrace(doc, polylinePoints);
                    doc.rect(20, 155, 555, currentY - 155).stroke(); // Fecha borda da pág anterior
                    
                    doc.addPage(); currentY = 50; startGraphY = currentY; polylinePoints = [];
                    doc.font('Helvetica-Bold').fontSize(10).fillColor('black').text(`Continuação ${furo.nome_furo}`, 20, 30);
                }

                const prof = parseFloat(am.profundidade_ini);
                const g1 = am.golpe_1 || '';
                const g2 = am.golpe_2 || '';
                const g3 = am.golpe_3 || '';
                const nspt = (parseInt(g2)||0) + (parseInt(g3)||0);

                // Grade Horizontal Fina
                doc.save().strokeColor(C.GRID).lineWidth(0.5).moveTo(20, currentY+ESCALA).lineTo(575, currentY+ESCALA).stroke().restore();

                // Textos
                doc.fillColor('black').font('Helvetica').fontSize(8);
                center(prof.toFixed(0), X.PROF, 30, currentY+10);
                center(Math.ceil(prof), X.AMOSTRA, 30, currentY+10);
                doc.fontSize(7);
                center(`${g1} / ${g2} / ${g3}`, X.GOLPES, 45, currentY+10);
                doc.font('Helvetica-Bold').fontSize(9);
                center(nspt > 0 ? nspt : '-', X.NSPT, 20, currentY+10);

                // --- HACHURA (SIMBOLOGIA VISUAL) ---
                drawLithology(doc, X.PERFIL, currentY, X.PERFIL_FIM - X.PERFIL, ESCALA, am.tipo_solo);

                // Descrição
                doc.fillColor('black').font('Helvetica').fontSize(7);
                doc.text(am.tipo_solo || '', X.DESC+5, currentY+8, {width: 250, align:'left'});

                // Ponto Gráfico
                let val = nspt > 50 ? 50 : nspt;
                if (val > 0) {
                    let px = X.GRAF_INI + ((val/50) * (X.GRAF_FIM - X.GRAF_INI));
                    let py = currentY + (ESCALA/2);
                    polylinePoints.push([px, py]);
                }

                // Desenho do Nível D'água (Linha Azul)
                if (furo.nivel_agua_final && Math.abs(parseFloat(furo.nivel_agua_final) - prof) < 0.5) {
                    let yW = currentY + ((parseFloat(furo.nivel_agua_final) - Math.floor(prof)) * ESCALA);
                    doc.save().strokeColor(C.WATER).lineWidth(1.5).dash(3, {space: 2})
                       .moveTo(X.GRAF_INI, yW).lineTo(X.GRAF_FIM, yW).stroke();
                    doc.restore();
                }

                currentY += ESCALA;
            }

            // Desenha o gráfico final
            drawGraphLines(doc, startGraphY, currentY, X);
            drawGraphTrace(doc, polylinePoints);

            // Borda Externa e Linhas Verticais
            doc.rect(20, 155, 555, currentY - 155).stroke();
            doc.save().strokeColor('black').lineWidth(0.5);
            [X.AMOSTRA, X.GOLPES, X.NSPT, X.GRAF_INI, X.GRAF_FIM, X.PERFIL, X.PERFIL_FIM, X.DESC].forEach(x => {
                doc.moveTo(x, 155).lineTo(x, currentY).stroke();
            });
            doc.restore();

            // PÁGINA FOTOS
            if(fotosRes.rows.length > 0) {
                doc.addPage();
                doc.font('Helvetica-Bold').fontSize(14).text(`REGISTRO FOTOGRÁFICO - ${furo.nome_furo}`, {align:'center'});
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
    } catch (err) { console.error(err); res.status(500).send('Erro: ' + err.message); }
});

function drawGraphLines(doc, yStart, yEnd, X) {
    doc.save().strokeColor(C.GRID).lineWidth(0.5).dash(2, {space: 2});
    for(let k=1; k<5; k++) {
        let gx = X.GRAF_INI + (k * (X.GRAF_FIM - X.GRAF_INI)/5);
        doc.moveTo(gx, yStart).lineTo(gx, yEnd).stroke();
    }
    doc.restore();
}

function drawGraphTrace(doc, points) {
    if (points.length > 1) {
        doc.save().strokeColor(C.GRAPH_LINE).lineWidth(2).lineJoin('round');
        doc.moveTo(points[0][0], points[0][1]);
        for(let i=1; i<points.length; i++) doc.lineTo(points[i][0], points[i][1]);
        doc.stroke();
        doc.fillColor(C.GRAPH_LINE);
        points.forEach(p => doc.circle(p[0], p[1], 1.5).fill());
        doc.restore();
    }
}

app.listen(port, () => { console.log(`>>> SondaSaaS rodando na porta ${port} <<<`); });