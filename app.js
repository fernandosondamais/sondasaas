require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./config/db'); 
const PDFDocument = require('pdfkit');
const fs = require('fs');

const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

global.adminLogado = false; 
const SENHA_MESTRA = process.env.SENHA_MESTRA || 'admin123';

const COLORS = { 
    SONDA_GREEN: '#2c3e50', // Tom mais sóbrio para engenharia
    HEADER_BG: '#f2f2f2',
    LINE_GREY: '#cccccc'
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

// --- API DE DADOS ---
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
app.post('/api/boletim/fotos', async (req, res) => { const {furo_id, imagem_base64, legenda} = req.body; try { await pool.query(`INSERT INTO fotos (furo_id, imagem, legenda) VALUES ($1, $2, $3)`, [furo_id, imagem_base64, legenda]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });

// --- MOTOR GRÁFICO QUICKCHART ---
async function fetchNsptChart(amostras) {
    if (!amostras || amostras.length === 0) return null;
    
    const depths = amostras.map(a => `${parseFloat(a.profundidade_ini).toFixed(0)}m`);
    const nspts = amostras.map(a => {
        const n = (parseInt(a.golpe_2)||0) + (parseInt(a.golpe_3)||0);
        return n > 50 ? 50 : n;
    });

    const chartConfig = {
        type: 'line',
        data: {
            labels: depths,
            datasets: [{
                data: nspts,
                borderColor: 'red',
                borderWidth: 2,
                pointRadius: 3,
                pointBackgroundColor: 'red',
                fill: false,
                lineTension: 0
            }]
        },
        options: {
            indexAxis: 'y',
            scales: {
                x: {
                    position: 'top',
                    min: 0, max: 50,
                    ticks: { stepSize: 10, font: { size: 10, weight: 'bold' } },
                    grid: { color: '#ddd' }
                },
                y: {
                    reverse: true,
                    grid: { display: false },
                    ticks: { display: false }
                }
            },
            plugins: { legend: { display: false } }
        }
    };

    const url = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=160&h=${amostras.length * 20}&bkg=transparent`;
    
    try {
        const response = await fetch(url);
        return await response.arrayBuffer();
    } catch (e) { return null; }
}

// --- GERAÇÃO DO RELATÓRIO TÉCNICO (O CORAÇÃO) ---
app.get('/gerar-relatorio-tecnico/:id', async (req, res) => {
    if (!global.adminLogado) return res.redirect('/login');
    try {
        const propId = req.params.id;
        const propRes = await pool.query('SELECT * FROM propostas WHERE id = $1', [propId]);
        const proposta = propRes.rows[0];
        const furosRes = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [propId]);
        
        const doc = new PDFDocument({ margin: 30, size: 'A4' });
        res.setHeader('Content-Type', 'application/pdf');
        doc.pipe(res);

        for (let furo of furosRes.rows) {
            const amosRes = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [furo.id]);
            const amostras = amosRes.rows;
            const chartImage = await fetchNsptChart(amostras);

            doc.addPage();
            
            // Cabeçalho Principal
            doc.rect(30, 30, 535, 60).stroke();
            doc.font('Helvetica-Bold').fontSize(14).text('PERFIL INDIVIDUAL DE SONDAGEM - NBR 6484', 120, 45);
            doc.fontSize(10).text(`OBRA: ${proposta.cliente}`, 120, 65);

            // Grid de Informações
            let yTop = 100;
            doc.rect(30, yTop, 535, 45).stroke();
            doc.fontSize(8);
            doc.text(`LOCAL: ${proposta.endereco}`, 35, yTop + 10);
            doc.text(`DATA INÍCIO: ${furo.data_inicio ? new Date(furo.data_inicio).toLocaleDateString() : '-'}`, 35, yTop + 25);
            doc.font('Helvetica-Bold').text(`FURO: ${furo.nome_furo}`, 450, yTop + 15, { fontSize: 14 });

            // Nível d'água
            doc.rect(30, 150, 535, 20).fill(COLORS.HEADER_BG).stroke();
            doc.fillColor('black').text(`NÍVEL D'ÁGUA: Inicial: ${furo.nivel_agua_inicial || '-'}m | 24h: ${furo.nivel_agua_final || '-'}m`, 40, 157);

            // Cabeçalho da Tabela
            const col = { prof: 30, am: 70, golpes: 110, nspt: 160, graf: 200, desc: 360 };
            const yTab = 180;
            doc.rect(30, yTab, 535, 25).fill(COLORS.SONDA_GREEN).stroke();
            doc.fillColor('white').font('Helvetica-Bold');
            doc.text('PROF', col.prof + 5, yTab + 8);
            doc.text('AMOSTRA', col.am + 2, yTab + 8);
            doc.text('GOLPES', col.golpes + 5, yTab + 8);
            doc.text('NSPT', col.nspt + 5, yTab + 8);
            doc.text('GRÁFICO NSPT', col.graf + 40, yTab + 8);
            doc.text('DESCRIÇÃO DO SOLO', col.desc + 40, yTab + 8);

            // Conteúdo da Tabela
            let currentY = yTab + 25;
            const rowH = 20;

            if (chartImage) {
                doc.image(chartImage, col.graf, currentY, { width: 160, height: amostras.length * rowH });
            }

            amostras.forEach((am, index) => {
                doc.rect(30, currentY, 535, rowH).strokeColor(COLORS.LINE_GREY).stroke();
                doc.fillColor('black').font('Helvetica').fontSize(8);
                
                doc.text(`${parseFloat(am.profundidade_ini).toFixed(0)}m`, col.prof + 5, currentY + 7);
                doc.text(`${index + 1}`, col.am + 15, currentY + 7);
                doc.text(`${am.golpe_1}-${am.golpe_2}-${am.golpe_3}`, col.golpes + 5, currentY + 7);
                
                const n = (parseInt(am.golpe_2)||0) + (parseInt(am.golpe_3)||0);
                doc.font('Helvetica-Bold').text(n, col.nspt + 15, currentY + 7);
                
                doc.font('Helvetica').fontSize(7).text(am.tipo_solo || '', col.desc + 5, currentY + 5, { width: 195 });
                
                currentY += rowH;
            });

            // Linhas Verticais da Tabela para fechar o layout
            doc.strokeColor('black').lineWidth(1);
            [col.am, col.golpes, col.nspt, col.graf, col.desc].forEach(x => {
                doc.moveTo(x, yTab).lineTo(x, currentY).stroke();
            });
            doc.rect(30, yTab, 535, currentY - yTab).stroke();
        }

        doc.end();
    } catch (err) { res.status(500).send(err.message); }
});

app.listen(port, () => { console.log(`>>> SondaSaaS ON na porta ${port} <<<`); });