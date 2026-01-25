// app.js - Versão Refatorada v3.0 (CORRIGIDA)
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
const COLORS = { PRIMARY: '#444444', SONDA_GREEN: '#8CBF26', GRID_LINE: '#aaaaaa' };

// --- ROTAS DE API (MODULARIZADAS) ---
// Aqui conectamos as pastas que você criou!
const propostasRoutes = require('./routes/propostas');
const propostasController = require('./controllers/propostasController');

app.use('/api/propostas', propostasRoutes);
app.post('/gerar-proposta', propostasController.criarProposta); 

// --- ROTAS DE PÁGINAS ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/orcamento', (req, res) => res.sendFile(path.join(__dirname, 'public', 'orcamento.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/boletim', (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));

// Rotas Protegidas
app.get('/crm', (req, res) => global.adminLogado ? res.sendFile(path.join(__dirname, 'public', 'crm.html')) : res.redirect('/login'));
app.get('/admin', (req, res) => global.adminLogado ? res.sendFile(path.join(__dirname, 'public', 'admin.html')) : res.redirect('/login'));
app.get('/engenharia', (req, res) => global.adminLogado ? res.sendFile(path.join(__dirname, 'public', 'engenharia.html')) : res.redirect('/login')); 
app.get('/logout', (req, res) => { global.adminLogado = false; res.redirect('/login'); });

// Login API
app.post('/api/login', (req, res) => {
    if (req.body.senha === SENHA_MESTRA) { global.adminLogado = true; res.sendStatus(200); } else { res.sendStatus(401); }
});

// --- CÓDIGO LEGADO DO BOLETIM E RELATÓRIO TÉCNICO (MANTIDO DO ORIGINAL) ---
// (Estou colando aqui o bloco exato para você não ter trabalho de procurar)

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

// Rotas do App Mobile (Boletim)
app.get('/api/boletim/furos/:obraId', async (req, res) => { try { const r = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [req.params.obraId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/furos', async (req, res) => { const d = req.body; try { const r = await pool.query(`INSERT INTO furos (proposta_id, nome_furo, sondador, data_inicio, cota, nivel_agua_inicial) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [d.proposta_id, d.nome_furo, d.sondador, d.data_inicio, d.cota, d.nivel_agua_inicial]); res.json({id: r.rows[0].id}); } catch (e) { res.status(500).json(e); } });
app.put('/api/boletim/furos/:id', async (req, res) => { const {id} = req.params; const d = req.body; try { await pool.query(`UPDATE furos SET nivel_agua_inicial=$1, nivel_agua_final=$2, data_inicio=$3, data_termino=$4, coordenadas=$5 WHERE id=$6`, [d.nivel_agua_inicial, d.nivel_agua_final, d.data_inicio, d.data_termino, d.coordenadas, id]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/boletim/amostras/:furoId', async (req, res) => { try { const r = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [req.params.furoId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/amostras', async (req, res) => { const d = req.body; try { await pool.query(`INSERT INTO amostras (furo_id, profundidade_ini, profundidade_fim, golpe_1, golpe_2, golpe_3, tipo_solo, cor_solo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [d.furo_id, d.profundidade_ini, d.profundidade_fim, d.golpe_1, d.golpe_2, d.golpe_3, d.tipo_solo, d.cor_solo]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/boletim/fotos/:furoId', async (req, res) => { try { const r = await pool.query('SELECT id, legenda, data_upload FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [req.params.furoId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/fotos', async (req, res) => { const {furo_id, imagem_base64, legenda} = req.body; try { await pool.query(`INSERT INTO fotos (furo_id, imagem, legenda) VALUES ($1, $2, $3)`, [furo_id, imagem_base64, legenda]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/foto-full/:id', async (req, res) => { try { const r = await pool.query('SELECT imagem FROM fotos WHERE id = $1', [req.params.id]); if(r.rows.length > 0) { const img = Buffer.from(r.rows[0].imagem.split(",")[1], 'base64'); res.writeHead(200, {'Content-Type': 'image/jpeg', 'Content-Length': img.length}); res.end(img); } else res.status(404).send('Not found'); } catch(e) { res.status(500).send(e); } });

// --- GERAÇÃO RELATÓRIO TÉCNICO (CÓDIGO ORIGINAL MANTIDO) ---
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

        // Capa
        doc.rect(0, 0, 595, 842).fill('white');
        const logoPath = path.join(__dirname, 'public', 'logo.png');
        if (fs.existsSync(logoPath)) { doc.image(logoPath, 150, 150, { width: 300 }); }
        
        doc.fillColor(COLORS.SONDA_GREEN).font('Helvetica-Bold').fontSize(30).text('SONDAMAIS', 0, 500, { align: 'center' });
        doc.fillColor('#555555').fontSize(18).text('SONDAGEM DE SOLO', 0, 540, { align: 'center' });
        doc.fillColor('black').fontSize(14).text(proposta.cliente.toUpperCase(), 0, 650, { align: 'center' });
        doc.fontSize(10).text('RELATÓRIO TÉCNICO DE SONDAGEM SPT', 0, 670, { align: 'center' });
        doc.text(`Valinhos, ${new Date().toLocaleDateString('pt-BR')}.`, 0, 700, { align: 'center' });

        // Contracapa
        doc.addPage();
        const startY = 50;
        doc.font('Helvetica-Bold').fontSize(10).text(`CLIENTE: ${proposta.cliente}`, 40, startY);
        doc.text(`RELATÓRIO Nº: ${proposta.id}/2026`, 40, startY + 15);
        doc.text(`SERVIÇO: SONDAGEM SPT (NBR 6484)`, 40, startY + 30);
        doc.text(`LOCAL: ${proposta.endereco}`, 40, startY + 45);
        doc.moveDown(2);
        doc.font('Helvetica-Bold').fontSize(12).text('I - INTRODUÇÃO');
        doc.moveDown(0.5);
        doc.font('Helvetica').fontSize(10).text(`Foram realizadas ${furos.length} sondagens à percussão.`, { align: 'justify' });
        doc.moveDown(4);
        doc.text('Eng. Fabiano Rielli - CREA: 5069965546', { align: 'center' });

        // Perfis
        for (let i = 0; i < furos.length; i++) {
            const furo = furos[i];
            const amosRes = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [furo.id]);
            const amostras = amosRes.rows;
            const fotosRes = await pool.query('SELECT * FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [furo.id]);
            
            doc.addPage();
            const topY = 30;
            doc.rect(20, topY, 555, 55).stroke(); 
            doc.fontSize(8).font('Helvetica-Bold');
            doc.text('CLIENTE:', 25, topY + 8); doc.font('Helvetica').text(proposta.cliente, 70, topY + 8);
            doc.font('Helvetica-Bold').text('FURO:', 450, topY + 8); doc.fontSize(12).text(furo.nome_furo, 485, topY + 6);
            
            const yHeader = 100; const yStart = 120;
            const col = { PROF: 20, GRAF: 60, GOLPES: 180, NSPT: 240, PERFIL: 280, DESC: 320, END: 575 };
            doc.font('Helvetica-Bold').fontSize(8);
            doc.text('Prof(m)', col.PROF, yHeader); doc.text('SPT', col.GRAF, yHeader); doc.text('NSPT', col.NSPT, yHeader);
            doc.moveTo(20, yStart).lineTo(575, yStart).stroke();

            let currentY = yStart + 10;
            const scaleY = 30;
            let pontosGrafico = [];
            let pageStartY = yStart;

            for (let am of amostras) {
                if (currentY > 750) { 
                    drawGridLines(doc, pageStartY, currentY, col);
                    doc.addPage(); currentY = 50; pageStartY = 50; 
                }
                const prof = parseFloat(am.profundidade_ini);
                const g2 = parseInt(am.golpe_2)||0; const g3 = parseInt(am.golpe_3)||0;
                const nspt = g2 + g3;

                doc.font('Helvetica').fontSize(9).fillColor('black');
                doc.text(prof.toFixed(2), col.PROF, currentY);
                doc.font('Helvetica-Bold').fontSize(10).text(nspt.toString(), col.NSPT, currentY);

                let corSolo = '#ddd';
                if((am.tipo_solo||'').toLowerCase().includes('argila')) corSolo = '#D2691E';
                if((am.tipo_solo||'').toLowerCase().includes('areia')) corSolo = '#F0E68C';
                
                doc.save().rect(col.PERFIL+5, currentY-5, 30, scaleY).fill(corSolo).stroke().restore();
                doc.font('Helvetica').fontSize(8).text(am.tipo_solo||'-', col.DESC+5, currentY, {width: 240});

                let xG = col.GRAF + (nspt * 2.4); if (xG > col.GRAF + 120) xG = col.GRAF + 120;
                pontosGrafico.push({ x: xG, y: currentY + 5 });
                doc.circle(xG, currentY + 5, 2).fillColor('red').fill();

                doc.save().strokeColor('#eee').lineWidth(0.5).moveTo(col.PROF, currentY+scaleY-10).lineTo(col.END, currentY+scaleY-10).stroke().restore();
                currentY += scaleY;
            }
            drawGridLines(doc, pageStartY, currentY, col);

            if (pontosGrafico.length > 1) {
                doc.save().strokeColor('red').lineWidth(1.5);
                doc.moveTo(pontosGrafico[0].x, pontosGrafico[0].y);
                for (let p of pontosGrafico) doc.lineTo(p.x, p.y);
                doc.stroke().restore();
            }
            
            // Fotos
            if(fotosRes.rows.length > 0) {
                doc.addPage();
                doc.fontSize(14).text(`FOTOS - ${furo.nome_furo}`, {align:'center'});
                let yFoto = 50;
                for(let foto of fotosRes.rows) {
                    try {
                        const img = Buffer.from(foto.imagem.split(",")[1], 'base64');
                        doc.image(img, 100, yFoto, { width: 300 });
                        yFoto += 250;
                    } catch(e){}
                }
            }
        }
        doc.end();
    } catch (err) { console.error(err); res.status(500).send('Erro no relatório'); }
});

function drawGridLines(doc, yStart, yEnd, col) {
    doc.save().strokeColor(COLORS.GRID_LINE).lineWidth(0.5);
    doc.moveTo(col.PROF, yEnd).lineTo(col.END, yEnd).stroke();
    [col.PROF, col.GRAF, col.GOLPES, col.NSPT, col.PERFIL, col.DESC, col.END].forEach(x => {
        doc.moveTo(x, yStart).lineTo(x, yEnd).stroke();
    });
    doc.restore();
}

app.listen(port, () => { console.log(`Rodando na porta ${port}`); });