require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./config/db'); 
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 3000;

// Configurações Básicas
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

// Variáveis Globais
global.adminLogado = false; 
const SENHA_MESTRA = process.env.SENHA_MESTRA || 'admin123';
const COLORS = { PRIMARY: '#444444', SONDA_GREEN: '#8CBF26', GRID_LINE: '#aaaaaa' };

// --- 1. ROTAS MVC (Novo Padrão) ---
const propostasRoutes = require('./routes/propostas');
const propostasController = require('./controllers/propostasController');

app.use('/api/propostas', propostasRoutes);
app.post('/gerar-proposta', propostasController.criarProposta); 

// --- 2. ROTAS DE PÁGINAS (Frontend) ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/orcamento', (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/boletim', (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));

// Rotas Protegidas
const checkAuth = (req, res, next) => {
    if (global.adminLogado) next();
    else res.redirect('/login');
};

app.get('/crm', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'crm.html')));
app.get('/admin', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/engenharia', checkAuth, (req, res) => res.sendFile(path.join(__dirname, 'public', 'engenharia.html'))); 

// Login/Logout
app.get('/logout', (req, res) => { global.adminLogado = false; res.redirect('/login'); });
app.post('/api/login', (req, res) => {
    if (req.body.senha === SENHA_MESTRA) { global.adminLogado = true; res.sendStatus(200); } else { res.sendStatus(401); }
});

// --- 3. API DO BOLETIM (MOBILE) ---
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


// --- 4. GERAÇÃO DO RELATÓRIO TÉCNICO (PADRÃO SONDAMAIS/EXCEL) ---
app.get('/gerar-relatorio-tecnico/:id', async (req, res) => {
    if (!global.adminLogado) return res.redirect('/login');
    try {
        const propId = req.params.id;
        // Buscas no Banco
        const propRes = await pool.query('SELECT * FROM propostas WHERE id = $1', [propId]);
        const proposta = propRes.rows[0];
        const furosRes = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [propId]);
        const furos = furosRes.rows;

        // Configuração do PDF
        const doc = new PDFDocument({ margin: 30, size: 'A4', bufferPages: true });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="Relatorio_Final_${proposta.id}.pdf"`);
        doc.pipe(res);

        // --- CAPA ---
        doc.rect(0, 0, 595, 842).fill('#f9f9f9'); // Fundo leve
        const logoPath = path.join(__dirname, 'public', 'logo.png');
        if (fs.existsSync(logoPath)) { doc.image(logoPath, 197, 200, { width: 200 }); }
        
        doc.fillColor(COLORS.SONDA_GREEN).font('Helvetica-Bold').fontSize(26).text('RELATÓRIO DE SONDAGEM', 0, 450, { align: 'center' });
        doc.fillColor('#444').fontSize(16).text('PERFIL GEOLÓGICO-GEOTÉCNICO (SPT)', 0, 490, { align: 'center' });
        
        doc.fontSize(12).fillColor('black').text(proposta.cliente.toUpperCase(), 0, 600, { align: 'center' });
        doc.font('Helvetica').fontSize(10).text(proposta.endereco, 0, 620, { align: 'center' });
        
        doc.text(`Ref. Proposta: ${proposta.id}/2026`, 0, 750, { align: 'center' });
        doc.text(`Data: ${new Date().toLocaleDateString('pt-BR')}`, 0, 770, { align: 'center' });

        // --- PÁGINAS DOS FUROS (PERFIS) ---
        for (let i = 0; i < furos.length; i++) {
            const furo = furos[i];
            const amosRes = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [furo.id]);
            const amostras = amosRes.rows;
            const fotosRes = await pool.query('SELECT * FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [furo.id]);

            doc.addPage();
            
            // Layout das Colunas (X positions)
            const X = { PROF: 30, GRAF_INI: 80, GRAF_FIM: 280, NSPT: 300, SOLO: 340, FIM: 570 };
            
            // 1. CABEÇALHO DO FURO (Estilo Excel)
            doc.rect(20, 20, 555, 90).stroke(); // Box Geral
            
            if (fs.existsSync(logoPath)) { doc.image(logoPath, 25, 25, { width: 80 }); }
            
            doc.font('Helvetica-Bold').fontSize(14).fillColor('black')
               .text('PERFIL INDIVIDUAL DE SONDAGEM', 120, 35);
            
            doc.fontSize(9).font('Helvetica');
            doc.text(`CLIENTE: ${proposta.cliente}`, 120, 60);
            doc.text(`LOCAL: ${proposta.endereco}`, 120, 75);
            doc.text(`FURO: ${furo.nome_furo}`, 450, 60);
            doc.text(`DATA: ${furo.data_inicio ? new Date(furo.data_inicio).toLocaleDateString('pt-BR') : '-'}`, 450, 75);

            // Nível D'água (Destacado)
            doc.rect(20, 95, 555, 15).fill('#eee').stroke();
            doc.fillColor('black').font('Helvetica-Bold').fontSize(8);
            let txtAgua = `NÍVEL D'ÁGUA INICIAL: ${furo.nivel_agua_inicial || 'Seco'}m`;
            if(furo.nivel_agua_final) txtAgua += `  |  APÓS 24H: ${furo.nivel_agua_final}m`;
            doc.text(txtAgua, 30, 99);

            // 2. CABEÇALHOS DA TABELA
            doc.rect(20, 115, 555, 20).fill(COLORS.SONDA_GREEN).stroke();
            doc.fillColor('white').font('Helvetica-Bold').fontSize(8);
            doc.text('PROF (m)', X.PROF, 122);
            doc.text('GRÁFICO NSPT', X.GRAF_INI + 60, 122);
            doc.text('NSPT', X.NSPT, 122);
            doc.text('DESCRIÇÃO DO SOLO', X.SOLO, 122);

            // 3. DESENHAR O GRÁFICO E DADOS
            let currentY = 140;
            let prevX = null; 
            let prevY = null;
            
            // Função para desenhar linhas de grade verticais
            const drawVerticals = (yEnd) => {
                doc.save().strokeColor('#ccc').lineWidth(0.5);
                // Linhas do Gráfico (0, 10, 20... 50)
                for(let k=0; k<=5; k++) {
                    let gx = X.GRAF_INI + (k * (X.GRAF_FIM - X.GRAF_INI)/5);
                    doc.moveTo(gx, 140).lineTo(gx, yEnd).stroke();
                    // Numeros da escala
                    if(currentY === 140) doc.fillColor('#666').fontSize(6).text(k*10, gx-3, 132);
                }
                // Divisores de Coluna
                doc.strokeColor('black').lineWidth(1);
                [X.GRAF_INI, X.GRAF_FIM, X.SOLO].forEach(x => doc.moveTo(x, 115).lineTo(x, yEnd).stroke());
                doc.restore();
            };

            // Loop Amostras
            for (let am of amostras) {
                // Checa quebra de página
                if (currentY > 750) {
                    drawVerticals(currentY);
                    doc.addPage(); 
                    currentY = 50; 
                    prevY = null; prevX = null; 
                    doc.font('Helvetica-Bold').fontSize(10).fillColor('black').text(`Continuação Furo ${furo.nome_furo}`, 30, 30);
                }

                const prof = parseFloat(am.profundidade_ini);
                const g2 = parseInt(am.golpe_2)||0; 
                const g3 = parseInt(am.golpe_3)||0;
                const nspt = g2 + g3;
                
                const stepH = 25; 

                // Texto Profundidade
                doc.fillColor('black').fontSize(9).font('Helvetica-Bold');
                doc.text(prof.toFixed(0), X.PROF + 5, currentY + 8);

                // Texto NSPT
                doc.text(nspt.toString(), X.NSPT + 5, currentY + 8);

                // Texto Solo
                doc.font('Helvetica').fontSize(8);
                doc.text(am.tipo_solo || '-', X.SOLO + 5, currentY + 5, { width: 220 });

                // --- LÓGICA DO GRÁFICO (LINHA VERMELHA) ---
                let graphWidth = X.GRAF_FIM - X.GRAF_INI;
                let pointX = X.GRAF_INI + ((nspt / 50) * graphWidth);
                if (pointX > X.GRAF_FIM) pointX = X.GRAF_FIM; 
                let pointY = currentY + 12; 

                // Desenha ponto
                doc.circle(pointX, pointY, 2).fillColor('red').fill();

                // Desenha linha conectando ao anterior
                if (prevX !== null && prevY !== null) {
                    doc.save().strokeColor('red').lineWidth(2)
                       .moveTo(prevX, prevY).lineTo(pointX, pointY).stroke().restore();
                }

                prevX = pointX;
                prevY = pointY;

                // Linha horizontal divisória
                doc.save().strokeColor('#eee').lineWidth(1)
                   .moveTo(20, currentY + stepH).lineTo(570, currentY + stepH).stroke().restore();

                currentY += stepH;
            }
            
            drawVerticals(currentY);
            doc.rect(20, 115, 555, currentY - 115).stroke(); // Borda externa

            // --- PÁGINA DE FOTOS ---
            if(fotosRes.rows.length > 0) {
                doc.addPage();
                doc.font('Helvetica-Bold').fontSize(14).text(`REGISTRO FOTOGRÁFICO - ${furo.nome_furo}`, {align:'center'});
                doc.moveDown();
                
                let xPos = 40;
                let yPos = 100;
                
                for(let foto of fotosRes.rows) {
                    try {
                        const img = Buffer.from(foto.imagem.split(",")[1], 'base64');
                        doc.image(img, xPos, yPos, { width: 240, height: 180, fit: [240, 180] });
                        doc.fontSize(10).text(foto.legenda || 'Sem legenda', xPos, yPos + 185, {width: 240, align: 'center'});
                        
                        xPos += 260;
                        if (xPos > 300) { 
                            xPos = 40;
                            yPos += 220;
                        }
                        if (yPos > 700) { doc.addPage(); yPos = 50; xPos = 40; }
                    } catch(e){}
                }
            }
        }

        doc.end();
    } catch (err) { console.error(err); res.status(500).send('Erro no relatório'); }
});

app.listen(port, () => { console.log(`>>> SondaSaaS rodando na porta ${port} <<<`); });