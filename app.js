require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./config/db'); 
const PDFDocument = require('pdfkit');
const fs = require('fs');

// No Node 18+ o fetch é nativo, mas para garantir compatibilidade:
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

global.adminLogado = false; 
const SENHA_MESTRA = process.env.SENHA_MESTRA || 'admin123';

const COLORS = { 
    SONDA_GREEN: '#8CBF26', 
    HEADER_BG: '#e0e0e0',
    WATER_BLUE: '#0066cc'
};

// --- ROTAS PADRÃO ---
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
app.get('/api/boletim/fotos/:furoId', async (req, res) => { try { const r = await pool.query('SELECT id, legenda, data_upload FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [req.params.furoId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/fotos', async (req, res) => { const {furo_id, imagem_base64, legenda} = req.body; try { await pool.query(`INSERT INTO fotos (furo_id, imagem, legenda) VALUES ($1, $2, $3)`, [furo_id, imagem_base64, legenda]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/foto-full/:id', async (req, res) => { try { const r = await pool.query('SELECT imagem FROM fotos WHERE id = $1', [req.params.id]); if(r.rows.length > 0) { const img = Buffer.from(r.rows[0].imagem.split(",")[1], 'base64'); res.writeHead(200, {'Content-Type': 'image/jpeg', 'Content-Length': img.length}); res.end(img); } else res.status(404).send('Not found'); } catch(e) { res.status(500).send(e); } });

// --- FUNÇÃO MÁGICA: QUICKCHART (GERA O GRÁFICO NSPT) ---
async function fetchNsptChart(amostras) {
    // Prepara dados
    const depths = amostras.map(a => parseFloat(a.profundidade_ini).toFixed(0));
    const nspts = amostras.map(a => {
        const n = (parseInt(a.golpe_2)||0) + (parseInt(a.golpe_3)||0);
        return n > 50 ? 50 : n; // Limita em 50 para o gráfico não estourar
    });

    const chartConfig = {
        type: 'line',
        data: {
            labels: depths,
            datasets: [{
                label: 'NSPT',
                data: nspts,
                borderColor: 'red',
                borderWidth: 2,
                pointRadius: 2,
                pointBackgroundColor: 'red',
                fill: false,
                tension: 0.1 // Linha levemente suavizada ou reta (0)
            }]
        },
        options: {
            scales: {
                x: { display: false }, // Escondemos o eixo X pois ele vai alinhar com a tabela
                y: { 
                    display: true,
                    position: 'top', // Truque para alinhar rotação se precisasse, mas aqui vamos simplificar
                    min: 0,
                    max: 50,
                    ticks: { stepSize: 10, color: '#666', font: {size: 10} },
                    grid: { color: '#ccc' }
                }
            },
            plugins: { legend: { display: false } }
        }
    };

    // Monta URL da API
    // Usamos um truque aqui: rotação para ficar vertical? 
    // Não! Vamos desenhar normal e o PDF que se vire, ou melhor:
    // O gráfico NSPT é horizontal (0-50 no eixo X topo) e Profundidade no Y.
    // Vamos configurar o Chart.js para fazer exatamente isso.
    
    const chartConfigV = {
        type: 'line',
        data: {
            labels: depths, // Profundidades
            datasets: [{
                data: nspts,
                borderColor: 'red',
                borderWidth: 2,
                pointRadius: 2,
                fill: false,
                lineTension: 0
            }]
        },
        options: {
            indexAxis: 'y', // INVERTE EIXOS: Y vira categoria (profundidade), X vira valor (NSPT)
            scales: {
                x: {
                    position: 'top', // Coloca os numeros 0, 10, 20 em cima
                    min: 0, max: 50,
                    ticks: { stepSize: 10 },
                    grid: { color: '#ccc' }
                },
                y: {
                    reverse: true, // Profundidade cresce para baixo
                    grid: { display: false },
                    ticks: { display: false } // Escondemos os numeros Y pois ja temos na tabela
                }
            },
            plugins: { legend: { display: false } }
        }
    };

    const url = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfigV))}&w=300&h=${amostras.length * 40}`; // Altura dinâmica
    
    try {
        const response = await fetch(url);
        return await response.arrayBuffer();
    } catch (e) {
        console.error("Erro QuickChart", e);
        return null;
    }
}


// --- RELATÓRIO COM GRÁFICO PROFISSIONAL (QUICKCHART) ---
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

        for (let i = 0; i < furos.length; i++) {
            const furo = furos[i];
            const amosRes = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [furo.id]);
            const amostras = amosRes.rows;
            const fotosRes = await pool.query('SELECT * FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [furo.id]);

            // GERA O GRÁFICO EXTERNAMENTE (A "MÁGICA")
            const chartImage = await fetchNsptChart(amostras);

            doc.addPage();

            // COORDENADAS
            const X = { PROF: 30, AMOSTRA: 60, GOLPES: 90, NSPT: 135, GRAF: 160, DESC: 320, FIM: 570 };
            const W_GRAF = X.DESC - X.GRAF; // Largura da coluna gráfica

            // --- CABEÇALHO TÉCNICO (RGSE STYLE) ---
            doc.rect(20, 20, 555, 90).stroke();
            if (fs.existsSync(logoPath)) doc.image(logoPath, 25, 25, { width: 80 });
            
            doc.font('Helvetica-Bold').fontSize(14).fillColor('black').text('PERFIL INDIVIDUAL DE SONDAGEM', 130, 35);
            doc.fontSize(9).text('NBR 6484:2020', 130, 52);

            let yH = 70;
            doc.rect(20, yH, 555, 40).stroke(); // Box Dados
            doc.fontSize(8).text('CLIENTE:', 25, yH+5); doc.font('Helvetica').text(proposta.cliente, 70, yH+5);
            doc.font('Helvetica-Bold').text('LOCAL:', 25, yH+18); doc.font('Helvetica').text(proposta.endereco, 70, yH+18);
            doc.font('Helvetica-Bold').text('FURO:', 400, yH+5); doc.fontSize(12).text(furo.nome_furo, 440, yH+3);
            doc.fontSize(8).font('Helvetica-Bold').text('DATA:', 400, yH+18); doc.font('Helvetica').text(furo.data_inicio ? new Date(furo.data_inicio).toLocaleDateString() : '-', 440, yH+18);

            // Nível D'água
            doc.rect(20, 110, 555, 15).fill(COLORS.HEADER_BG).stroke();
            doc.fillColor('black').font('Helvetica-Bold').text(`NÍVEL D'ÁGUA: Inicial: ${furo.nivel_agua_inicial||'-'}m  |  Final (24h): ${furo.nivel_agua_final||'-'}m`, 30, 114);

            // --- CABEÇALHOS TABELA ---
            yH = 135;
            doc.rect(20, yH, 555, 25).fill(COLORS.SONDA_GREEN).stroke();
            doc.fillColor('white').fontSize(7);
            doc.text('PROF', X.PROF, yH+5); doc.text('(m)', X.PROF, yH+14);
            doc.text('AMOSTRA', X.AMOSTRA, yH+8);
            doc.text('GOLPES', X.GOLPES, yH+8);
            doc.text('NSPT', X.NSPT, yH+8);
            doc.text('RESISTÊNCIA (Golpes)', X.GRAF, yH+8, {width: W_GRAF, align:'center'});
            doc.text('DESCRIÇÃO ESTRATIGRÁFICA', X.DESC+5, yH+8);

            // --- CORPO DO RELATÓRIO ---
            let currentY = 160;
            const linhaH = 20; // Altura de cada linha (metro)
            
            // 1. COLAR O GRÁFICO GERADO (O Segredo!)
            // Calculamos a altura total necessária para o gráfico
            const totalHeight = amostras.length * linhaH;
            
            // Se tiver gráfico, cola ele na coluna certa
            if (chartImage && totalHeight < 600) { // Limite simples de 1 pág por enquanto
                doc.image(chartImage, X.GRAF, currentY, { width: W_GRAF, height: totalHeight });
            }

            // 2. DESENHAR TABELA DE DADOS (POR CIMA/AO LADO)
            doc.strokeColor('#aaaaaa').lineWidth(0.5);
            
            for (let am of amostras) {
                const prof = parseFloat(am.profundidade_ini);
                const nspt = (parseInt(am.golpe_2)||0) + (parseInt(am.golpe_3)||0);

                // Linha Horizontal
                doc.moveTo(20, currentY + linhaH).lineTo(575, currentY + linhaH).stroke();

                // Textos
                doc.fillColor('black').fontSize(8).font('Helvetica');
                doc.text(prof.toFixed(0), X.PROF, currentY+6);
                doc.text(Math.ceil(prof), X.AMOSTRA+5, currentY+6);
                doc.fontSize(7).text(`${am.golpe_1}-${am.golpe_2}-${am.golpe_3}`, X.GOLPES, currentY+6);
                doc.font('Helvetica-Bold').fontSize(9).text(nspt, X.NSPT+5, currentY+6);

                // Descrição
                doc.font('Helvetica').fontSize(8).text(am.tipo_solo || '', X.DESC+5, currentY+6, {width: 240});

                currentY += linhaH;
            }

            // Borda Externa da Tabela
            doc.rect(20, 160, 555, currentY - 160).stroke();
            
            // Linhas Verticais
            doc.strokeColor('black').lineWidth(1);
            [X.AMOSTRA, X.GOLPES, X.NSPT, X.GRAF, X.DESC].forEach(x => {
                doc.moveTo(x, 160).lineTo(x, currentY).stroke();
            });

            // --- FOTOS ---
            if(fotosRes.rows.length > 0) {
                doc.addPage();
                doc.font('Helvetica-Bold').fontSize(14).text(`FOTOS - ${furo.nome_furo}`, {align:'center'});
                let yPos = 50;
                for(let foto of fotosRes.rows) {
                    try {
                        const img = Buffer.from(foto.imagem.split(",")[1], 'base64');
                        doc.image(img, 150, yPos, { width: 300 });
                        doc.text(foto.legenda, 150, yPos+210);
                        yPos += 250;
                    } catch(e){}
                }
            }
        }
        doc.end();
    } catch (err) { console.error(err); res.status(500).send('Erro: ' + err.message); }
});

app.listen(port, () => { console.log(`>>> SondaSaaS rodando na porta ${port} <<<`); });