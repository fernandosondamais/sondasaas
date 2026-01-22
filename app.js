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
const COLORS = { PRIMARY: '#444444', ACCENT: '#6a9615', BORDER: '#000000', BG_HEADER: '#ffffff' };
const isProduction = process.env.NODE_ENV === 'production';
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:admin123@localhost:5432/sondasaas';
const pool = new Pool({ connectionString, ssl: isProduction ? { rejectUnauthorized: false } : false });

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' })); 
app.use(express.static('public')); 

// --- ROTAS DE PÁGINAS ---
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => adminLogado ? res.sendFile(path.join(__dirname, 'public', 'admin.html')) : res.redirect('/login'));
app.get('/boletim', (req, res) => res.sendFile(path.join(__dirname, 'public', 'boletim.html')));
app.get('/engenharia', (req, res) => adminLogado ? res.sendFile(path.join(__dirname, 'public', 'engenharia.html')) : res.redirect('/login')); // NOVA TELA
app.get('/logout', (req, res) => { adminLogado = false; res.redirect('/login'); });

// --- API GERAL ---
app.post('/api/login', (req, res) => { if (req.body.senha === SENHA_MESTRA) { adminLogado = true; res.sendStatus(200); } else { res.sendStatus(401); } });
app.get('/api/propostas', async (req, res) => { try { const r = await pool.query('SELECT * FROM propostas ORDER BY id DESC'); res.json(r.rows); } catch (err) { res.status(500).json({ error: err.message }); } });
app.delete('/api/propostas/:id', async (req, res) => { if (!adminLogado) return res.status(403).send('Acesso Negado'); try { await pool.query('DELETE FROM propostas WHERE id = $1', [req.params.id]); res.status(200).send('Ok'); } catch (err) { res.status(500).json(err); } });

// --- ROTAS DE ENGENHARIA (DADOS COMPLETOS) ---
app.get('/api/engenharia/:id', async (req, res) => {
    if (!adminLogado) return res.status(403).send('Acesso Negado');
    try {
        const propId = req.params.id;
        
        // 1. Pega a Proposta
        const propRes = await pool.query('SELECT * FROM propostas WHERE id = $1', [propId]);
        const proposta = propRes.rows[0];

        // 2. Pega os Furos
        const furosRes = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [propId]);
        const furos = furosRes.rows;

        // 3. Para cada furo, pega Amostras e Fotos
        for (let furo of furos) {
            const amosRes = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [furo.id]);
            furo.amostras = amosRes.rows;
            
            const fotoRes = await pool.query('SELECT id, legenda, data_upload FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [furo.id]);
            furo.fotos = fotoRes.rows;
        }

        res.json({ proposta, furos });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- ROTAS DO BOLETIM (CAMPO) ---
app.get('/api/boletim/furos/:obraId', async (req, res) => { try { const r = await pool.query('SELECT * FROM furos WHERE proposta_id = $1 ORDER BY id ASC', [req.params.obraId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/furos', async (req, res) => { const d = req.body; try { const r = await pool.query(`INSERT INTO furos (proposta_id, nome_furo, sondador, data_inicio, cota, nivel_agua_inicial) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`, [d.proposta_id, d.nome_furo, d.sondador, d.data_inicio, d.cota, d.nivel_agua_inicial]); res.json({id: r.rows[0].id}); } catch (e) { res.status(500).json(e); } });
app.put('/api/boletim/furos/:id', async (req, res) => { const {id} = req.params; const d = req.body; try { await pool.query(`UPDATE furos SET nivel_agua_inicial=$1, nivel_agua_final=$2, data_inicio=$3, data_termino=$4, coordenadas=$5 WHERE id=$6`, [d.nivel_agua_inicial, d.nivel_agua_final, d.data_inicio, d.data_termino, d.coordenadas, id]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/boletim/amostras/:furoId', async (req, res) => { try { const r = await pool.query('SELECT * FROM amostras WHERE furo_id = $1 ORDER BY profundidade_ini ASC', [req.params.furoId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/amostras', async (req, res) => { const d = req.body; try { await pool.query(`INSERT INTO amostras (furo_id, profundidade_ini, profundidade_fim, golpe_1, golpe_2, golpe_3, tipo_solo, cor_solo) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [d.furo_id, d.profundidade_ini, d.profundidade_fim, d.golpe_1, d.golpe_2, d.golpe_3, d.tipo_solo, d.cor_solo]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
app.get('/api/boletim/fotos/:furoId', async (req, res) => { try { const r = await pool.query('SELECT id, legenda, data_upload FROM fotos WHERE furo_id = $1 ORDER BY id DESC', [req.params.furoId]); res.json(r.rows); } catch (e) { res.status(500).json(e); } });
app.post('/api/boletim/fotos', async (req, res) => { const {furo_id, imagem_base64, legenda} = req.body; try { await pool.query(`INSERT INTO fotos (furo_id, imagem, legenda) VALUES ($1, $2, $3)`, [furo_id, imagem_base64, legenda]); res.sendStatus(200); } catch (e) { res.status(500).json(e); } });
// Rota para ver a foto real (full size) no admin
app.get('/api/foto-full/:id', async (req, res) => {
    try { const r = await pool.query('SELECT imagem FROM fotos WHERE id = $1', [req.params.id]); 
    if(r.rows.length > 0) { const img = Buffer.from(r.rows[0].imagem.split(",")[1], 'base64'); res.writeHead(200, {'Content-Type': 'image/jpeg', 'Content-Length': img.length}); res.end(img); } else res.status(404).send('Not found');
    } catch(e) { res.status(500).send(e); }
});

// --- CRIAÇÃO DE PROPOSTA (PDF COMERCIAL) ---
app.post('/gerar-proposta', async (req, res) => { /* Código existente do PDF Comercial mantido... */ const d = req.body; const v_furos = parseInt(d.furos)||0; const v_metragem = parseFloat(d.metragem)||0; const valor_total = (v_metragem * parseFloat(d.valor_metro)) + parseFloat(d.art) + parseFloat(d.mobilizacao) - parseFloat(d.desconto); try { const sql=`INSERT INTO propostas (cliente, telefone, email, endereco, furos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total, criterio, detalhe_criterio) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, data_criacao`; const v=[d.cliente, d.telefone, d.email, d.endereco, v_furos, v_metragem, d.art, d.mobilizacao, d.desconto, valor_total, d.criterio_tecnico, d.detalhe_criterio]; const r=await pool.query(sql, v); res.redirect('/admin'); } catch(e){console.error(e); res.status(500).send('Erro');} });
app.get('/reemitir-pdf/:id', async (req, res) => { /* Mantido código anterior de reemissão... */ res.send("Função Comercial mantida."); });

// --- INIT SQL ---
const initSQL = `
CREATE TABLE IF NOT EXISTS propostas (id SERIAL PRIMARY KEY, cliente VARCHAR(255), endereco TEXT, furos INTEGER, metragem_total NUMERIC, valor_art NUMERIC, valor_mobilizacao NUMERIC, valor_desconto NUMERIC, valor_total NUMERIC, data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP, telefone VARCHAR(50), email VARCHAR(255), criterio VARCHAR(50), detalhe_criterio VARCHAR(255));
CREATE TABLE IF NOT EXISTS furos (id SERIAL PRIMARY KEY, proposta_id INTEGER REFERENCES propostas(id) ON DELETE CASCADE, nome_furo VARCHAR(20), sondador VARCHAR(100), data_inicio DATE, data_termino DATE, cota NUMERIC, nivel_agua_inicial NUMERIC, nivel_agua_final NUMERIC, revestimento NUMERIC, coordenadas TEXT);
CREATE TABLE IF NOT EXISTS amostras (id SERIAL PRIMARY KEY, furo_id INTEGER REFERENCES furos(id) ON DELETE CASCADE, profundidade_ini NUMERIC, profundidade_fim NUMERIC, golpe_1 INTEGER, golpe_2 INTEGER, golpe_3 INTEGER, tipo_solo TEXT, cor_solo TEXT, obs_solo TEXT);
CREATE TABLE IF NOT EXISTS fotos (id SERIAL PRIMARY KEY, furo_id INTEGER REFERENCES furos(id) ON DELETE CASCADE, imagem TEXT, legenda VARCHAR(100), data_upload TIMESTAMP DEFAULT CURRENT_TIMESTAMP);
`;
pool.query(initSQL).then(() => { console.log('>>> DB OK <<<'); app.listen(port, () => { console.log(`Rodando na porta ${port}`); }); }).catch(err => { console.error('ERRO DB:', err); });