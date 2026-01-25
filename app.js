require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./config/db'); 
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Configurações
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

global.adminLogado = false; 
const SENHA_MESTRA = process.env.SENHA_MESTRA || 'admin123';
const COLORS = { 
    SONDA_GREEN: '#8CBF26', 
    DARK_TEXT: '#333333',
    GRID: '#cccccc',
    RED_GRAPH: '#cc0000'
};

// --- ROTAS MVC ---
const propostasRoutes = require('./routes/propostas');
const propostasController = require('./controllers/propostasController');
app.use('/api/propostas', propostasRoutes);
app.post('/gerar-proposta', propostasController.criarProposta); 

// --- ROTAS DE PÁGINAS ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/orcamento', (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/boletim', (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));

// Auth Middleware
const checkAuth = (req, res, next) => {
    if (global.adminLogado) next();
    else res.redirect('/login');
};

app.get('/crm', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/engenharia', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html'))); 
app.get('/logout', (req, res) => { global.adminLogado = false; res.redirect('/login'); });
app.post('/api/login', (req, res) => {
    if (req.body.senha === SENHA_MESTRA) { global.adminLogado = true; res.sendStatus(200); } else { res.sendStatus(401); }
});

// --- API BOLETIM (MOBILE) ---
// Mantendo a compatibilidade com o app
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


// --- GERAÇÃO DE RELATÓRIO TÉCNICO (NORMA NBR 6484:2020) ---
app.get('/gerar-relatorio-tecnico/:id', async (req, res) => {
    if (!global.adminLogado) return res.redirect('/login');
    try {
        const propId = req.params.id;
        const propRes = await pool.query('SELECT * FROM propostas WHERE id = $1', [propId]);
        const proposta = propRes.rows[0];
        const furosRes = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [propId]);
        const furos = furosRes.rows;

        const doc = new PDFDocument({ margin: 25, size: 'A4', bufferPages: true });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Relatorio_Tecnico_Final_${proposta.id}.pdf"`);
        doc.pipe(res);

        // LOGO PADRÃO
        const logoPath = path.join(__dirname, 'public', 'logo.png');
        const drawLogo = (x, y, w) => { if (fs.existsSync(logoPath)) doc.image(logoPath, x, y, { width: w }); };

        // --- PÁGINA 1: CAPA ---
        doc.rect(0, 0, 595, 842).fill('white');
        drawLogo(197, 150, 200);
        
        doc.moveDown(12);
        doc.font('Helvetica-Bold').fontSize(24).fillColor(COLORS.SONDA_GREEN).text('RELATÓRIO DE SONDAGEM', { align: 'center' });
        doc.fontSize(14).fillColor('#555').text('PERFIL GEOLÓGICO-GEOTÉCNICO', { align: 'center' });
        doc.moveDown(2);
        
        doc.fontSize(12).fillColor('black').text(`CLIENTE: ${proposta.cliente.toUpperCase()}`, { align: 'center' });
        doc.text(`OBRA: ${proposta.endereco}`, { align: 'center' });
        doc.text(`REF: PROPOSTA ${proposta.id}/2026`, { align: 'center' });
        
        doc.moveDown(8);
        doc.fontSize(10).text(`Valinhos, ${new Date().toLocaleDateString('pt-BR')}`, { align: 'center' });
        doc.text('Eng. Responsável: Fabiano Rielli', { align: 'center' });

        // --- PÁGINA 2: METODOLOGIA E LEGENDA (OBRIGATÓRIO NBR) ---
        doc.addPage();
        drawLogo(30, 30, 80);
        doc.font('Helvetica-Bold').fontSize(14).text('1. METODOLOGIA EXECUTIVA', 30, 100);
        doc.font('Helvetica').fontSize(10).text(
            `A sondagem foi executada estritamente conforme a norma NBR 6484:2020 "Solo - Sondagem de simples reconhecimento com SPT - Método de ensaio".\n\n` +
            `• Equipamento: O ensaio utiliza um amostrador padrão (terreno) acoplado a hastes, cravado no solo por um peso de 65kg caindo em queda livre de 75cm.\n` +
            `• SPT (Standard Penetration Test): O índice de resistência à penetração (N) corresponde à soma dos golpes necessários para cravar os últimos 30cm do amostrador.\n` +
            `• Amostragem: Amostras deformadas foram coletadas metro a metro para classificação tátil-visual.\n` +
            `• Nível D'água: Medido ao final da sondagem e confirmado após 24h, quando possível.\n` +
            `• Critério de Paralisação: Conforme item 6.2.4 da norma, ou impenetrável à percussão/lavagem.`,
            { align: 'justify', width: 535 }
        );

        doc.moveDown(2);
        doc.font('Helvetica-Bold').fontSize(14).text('2. LEGENDA E CONVENÇÕES');
        // Desenhar uma legenda simples de consistência
        const startY = doc.y + 10;
        doc.rect(30, startY, 535, 120).stroke();
        doc.font('Helvetica-Bold').fontSize(9).text('CONSISTÊNCIA (ARGILAS)', 40, startY + 10);
        doc.font('Helvetica').text('0-2: Muito Mole | 3-5: Mole | 6-10: Média | 11-19: Rija | >19: Dura', 40, startY + 25);
        
        doc.font('Helvetica-Bold').text('COMPACIDADE (AREIAS)', 40, startY + 50);
        doc.font('Helvetica').text('0-4: Fofa | 5-8: Pouco Compacta | 9-18: Med. Compacta | 19-40: Compacta | >40: Muito Compacta', 40, startY + 65);

        // --- PÁGINAS DOS FUROS (O CORAÇÃO DO RELATÓRIO) ---
        for (let i = 0; i < furos.length; i++) {
            const furo = furos[i];
            const amosRes = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [furo.id]);
            const amostras = amosRes.rows;
            const fotosRes = await pool.query('SELECT * FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [furo.id]);

            doc.addPage();
            
            // LAYOUT DE COLUNAS (Rigoroso NBR)
            // PROF | AMOSTRA | GOLPES (1/2/3) | NSPT | GRAFICO | DESCRICAO
            const X = { 
                PROF: 30, 
                AMOSTRA: 65, 
                GOLPES: 100, 
                NSPT: 160, 
                GRAF_INI: 190, 
                GRAF_FIM: 340, 
                DESC: 350, 
                FIM: 570 
            };
            
            // 1. CABEÇALHO TÉCNICO (BOX)
            doc.rect(25, 25, 545, 85).stroke();
            if (fs.existsSync(logoPath)) { doc.image(logoPath, 30, 30, { width: 80 }); }
            
            doc.font('Helvetica-Bold').fontSize(12).fillColor('black')
               .text('PERFIL INDIVIDUAL DE SONDAGEM À PERCUSSÃO', 130, 35);
            
            doc.fontSize(8).font('Helvetica');
            // Coluna 1 do Header
            doc.text(`CLIENTE:`, 130, 55); doc.font('Helvetica-Bold').text(proposta.cliente, 170, 55);
            doc.font('Helvetica').text(`LOCAL:`, 130, 68); doc.font('Helvetica-Bold').text(proposta.endereco, 170, 68);
            doc.font('Helvetica').text(`COTA:`, 130, 81); doc.text(furo.cota || 'Não informada', 170, 81);

            // Coluna 2 do Header
            doc.font('Helvetica').text(`FURO Nº:`, 400, 55); doc.font('Helvetica-Bold').fontSize(12).text(furo.nome_furo, 445, 53);
            doc.fontSize(8).font('Helvetica').text(`DATA INÍCIO:`, 400, 68); doc.text(furo.data_inicio ? new Date(furo.data_inicio).toLocaleDateString() : '-', 455, 68);
            doc.text(`DATA FIM:`, 400, 81); doc.text(furo.data_termino ? new Date(furo.data_termino).toLocaleDateString() : '-', 455, 81);
            doc.text(`COORD:`, 400, 94); doc.text(furo.coordenadas || '-', 455, 94);

            // Nível D'água (Barra Cinza)
            doc.rect(25, 115, 545, 15).fill('#eeeeee').stroke();
            doc.fillColor('black').font('Helvetica-Bold').fontSize(8);
            
            let txtNA = `NÍVEL D'ÁGUA: `;
            if(furo.nivel_agua_inicial) txtNA += `Inicial: ${furo.nivel_agua_inicial}m`; else txtNA += `Inicial: Não atingido`;
            if(furo.nivel_agua_final) txtNA += `  |  Final (24h): ${furo.nivel_agua_final}m`;
            
            doc.text(txtNA, 35, 119);

            // 2. CABEÇALHOS DA TABELA
            const yHead = 135;
            doc.rect(25, yHead, 545, 25).fill(COLORS.SONDA_GREEN).stroke();
            doc.fillColor('white').font('Helvetica-Bold').fontSize(7);
            
            doc.text('PROF (m)', X.PROF, yHead+8, {width: 30, align: 'center'});
            doc.text('AMOST', X.AMOSTRA, yHead+8, {width: 30, align: 'center'});
            doc.text('GOLPES', X.GOLPES, yHead+3, {width: 50, align: 'center'});
            doc.text('30+30+30', X.GOLPES, yHead+12, {width: 50, align: 'center'});
            doc.text('NSPT', X.NSPT, yHead+8, {width: 25, align: 'center'});
            doc.text('GRÁFICO N (Golpes)', X.GRAF_INI, yHead+8, {width: (X.GRAF_FIM - X.GRAF_INI), align: 'center'});
            doc.text('DESCRIÇÃO DO MATERIAL', X.DESC + 5, yHead+8, {align: 'left'});

            // 3. DESENHO DOS DADOS E GRÁFICO
            let currentY = 160;
            let prevX = null; 
            let prevY = null;
            
            // Função para desenhar a grade do gráfico (0,10,20,30,40,50)
            const drawGrid = (yTop, yBottom) => {
                doc.save().strokeColor('#e0e0e0').lineWidth(0.5);
                for(let k=0; k<=5; k++) {
                    let gx = X.GRAF_INI + (k * (X.GRAF_FIM - X.GRAF_INI)/5);
                    doc.moveTo(gx, yTop).lineTo(gx, yBottom).stroke();
                    if(yTop === 160) doc.fillColor('#666').fontSize(5).text(k*10, gx-3, yTop-8);
                }
                // Linhas Verticais da Tabela
                doc.strokeColor('black').lineWidth(0.5);
                [X.PROF, X.AMOSTRA, X.GOLPES, X.NSPT, X.GRAF_INI, X.GRAF_FIM, X.DESC, X.FIM].forEach(x => {
                   // doc.moveTo(x, yTop).lineTo(x, yBottom).stroke(); 
                   // Nota: Desativado o loop simples para desenhar bordas exatas depois
                });
                doc.restore();
            };

            for (let am of amostras) {
                if (currentY > 750) { // Quebra de Página
                    // Fecha caixa da página anterior
                    doc.rect(25, 160, 545, currentY - 160).stroke();
                    drawGrid(160, currentY);
                    
                    doc.addPage(); currentY = 50; prevY = null; prevX = null;
                    doc.font('Helvetica-Bold').fontSize(10).fillColor('black').text(`Continuação ${furo.nome_furo}`, 25, 30);
                }

                const prof = parseFloat(am.profundidade_ini);
                const g1 = parseInt(am.golpe_1)||0;
                const g2 = parseInt(am.golpe_2)||0;
                const g3 = parseInt(am.golpe_3)||0;
                const nspt = g2 + g3;
                const stepH = 20; // Altura da linha

                doc.fillColor('black').fontSize(8).font('Helvetica');
                
                // Dados Numéricos
                doc.text(prof.toFixed(0), X.PROF, currentY+6, {width: 30, align:'center'});
                doc.text(Math.ceil(prof), X.AMOSTRA, currentY+6, {width: 30, align:'center'}); // Amostra aprox pelo metro
                doc.text(`${g1} - ${g2} - ${g3}`, X.GOLPES, currentY+6, {width: 50, align:'center'});
                doc.font('Helvetica-Bold').text(nspt, X.NSPT, currentY+6, {width: 25, align:'center'});

                // Descrição Solo (Quebra de linha se for grande)
                doc.font('Helvetica').fontSize(7);
                doc.text(am.tipo_solo || '-', X.DESC + 5, currentY+6, {width: 210, align:'left'});

                // --- GRÁFICO (LINHA VERMELHA) ---
                let graphWidth = X.GRAF_FIM - X.GRAF_INI;
                let val = nspt > 50 ? 50 : nspt; // Trava em 50
                let pointX = X.GRAF_INI + ((val / 50) * graphWidth);
                let pointY = currentY + 10;

                doc.circle(pointX, pointY, 1.5).fillColor('red').fill();
                if (prevX !== null && prevY !== null) {
                    doc.save().strokeColor('red').lineWidth(1.5).moveTo(prevX, prevY).lineTo(pointX, pointY).stroke().restore();
                }
                prevX = pointX; prevY = pointY;

                // Linha Horizontal Fina
                doc.save().strokeColor('#eee').lineWidth(0.5).moveTo(25, currentY+stepH).lineTo(570, currentY+stepH).stroke().restore();
                
                currentY += stepH;
            }
            
            // Finalização da Tabela
            drawGrid(160, currentY); // Desenha a grade
            doc.rect(25, 160, 545, currentY - 160).stroke(); // Borda Externa
            
            // Linhas verticais separadoras (Desenhadas no final para ficarem limpas)
            doc.save().strokeColor('black').lineWidth(0.5);
            [X.AMOSTRA, X.GOLPES, X.NSPT, X.GRAF_INI, X.GRAF_FIM, X.DESC].forEach(x => {
                doc.moveTo(x, 160).lineTo(x, currentY).stroke();
            });
            doc.restore();

            // PÁGINA DE FOTOS
            if(fotosRes.rows.length > 0) {
                doc.addPage();
                doc.font('Helvetica-Bold').fontSize(14).text(`ANEXO FOTOGRÁFICO - ${furo.nome_furo}`, {align:'center'});
                doc.moveDown();
                
                let xPos = 40; let yPos = 80;
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

app.listen(port, () => { console.log(`>>> SondaSaaS rodando na porta ${port} <<<`); });