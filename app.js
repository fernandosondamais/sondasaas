const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();

// --- CONFIGURAÇÃO DE PORTA (NUVEM vs LOCAL) ---
// O Render define a porta automaticamente via variável de ambiente
const port = process.env.PORT || 3000;

// --- CONTROLE DE SESSÃO SIMPLES ---
let adminLogado = false; 
const SENHA_MESTRA = 'admin123';

// --- CORES SONDAMAIS ---
const COLORS = {
    PRIMARY: '#8CBF26',   // Verde
    SECONDARY: '#003366', // Azul
    DARK_TEXT: '#333333',
    LIGHT_TEXT: '#555555',
    TABLE_HEADER: '#E0E0E0',
    BORDER: '#CCCCCC'
};

// --- CONFIGURAÇÃO DO BANCO DE DADOS (HÍBRIDA) ---
// Verifica se estamos em produção (nuvem) ou local
const isProduction = process.env.NODE_ENV === 'production';

// Se tiver uma URL de banco definida pelo sistema (nuvem), usa ela.
// Caso contrário, usa a sua string de conexão local padrão.
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:admin123@localhost:5432/sondasaas';

const pool = new Pool({
    connectionString: connectionString,
    // O Render exige SSL (conexão segura). Localmente, desativamos.
    ssl: isProduction ? { rejectUnauthorized: false } : false
});

app.use(express.json());
app.use(express.static('public')); 

// --- ROTAS DE NAVEGAÇÃO ---

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/admin', (req, res) => {
    if (adminLogado) {
        res.sendFile(path.join(__dirname, 'public', 'admin.html'));
    } else {
        res.redirect('/login');
    }
});

app.get('/logout', (req, res) => {
    adminLogado = false;
    res.redirect('/login');
});

// --- API: AUTENTICAÇÃO ---
app.post('/api/login', (req, res) => {
    const { senha } = req.body;
    
    if (senha === SENHA_MESTRA) {
        adminLogado = true;
        console.log('🔓 Login de Admin realizado com sucesso!');
        res.sendStatus(200);
    } else {
        console.log('⛔ Tentativa de senha incorreta.');
        res.sendStatus(401);
    }
});

// --- API: LISTAR PROPOSTAS (Protegida) ---
app.get('/api/propostas', async (req, res) => {
    if (!adminLogado) return res.status(403).json({ error: 'Acesso negado' });

    try {
        const result = await pool.query('SELECT * FROM propostas ORDER BY id DESC');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao buscar dados.' });
    }
});

// --- API: EXCLUIR PROPOSTA ---
app.delete('/api/propostas/:id', async (req, res) => {
    if (!adminLogado) return res.status(403).send('Acesso Negado');

    const id = req.params.id;
    try {
        await pool.query('DELETE FROM propostas WHERE id = $1', [id]);
        console.log(`🗑️ Proposta #${id} excluída.`);
        res.status(200).send('Excluído com sucesso');
    } catch (err) {
        console.error('Erro ao excluir:', err);
        res.status(500).json({ error: 'Erro ao excluir do banco.' });
    }
});

// --- API: GERAR NOVA PROPOSTA (SALVA NO BD + PDF) ---
app.post('/gerar-proposta', async (req, res) => {
    const d = req.body;

    // Tratamento de valores
    const v_furos = parseInt(d.furos) || 0;
    const v_metragem = parseFloat(d.metragem) || 0;
    const v_metro = parseFloat(d.valor_metro) || 0;
    const v_art = parseFloat(d.art) || 0;
    const v_mobi = parseFloat(d.mobilizacao) || 0;
    const v_desc = parseFloat(d.desconto) || 0;

    const subtotal_sondagem = v_metragem * v_metro;
    const valor_total = subtotal_sondagem + v_art + v_mobi - v_desc;

    try {
        // 1. Salva no Banco
        const sql = `
            INSERT INTO propostas (cliente, endereco, furos, metragem_total, valor_art, valor_mobilizacao, valor_desconto, valor_total) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, data_criacao;
        `;
        const values = [d.cliente, d.endereco, v_furos, v_metragem, v_art, v_mobi, v_desc, valor_total];
        const dbRes = await pool.query(sql, values);
        
        const idProposta = dbRes.rows[0].id;
        const dataCriacao = new Date().toLocaleDateString('pt-BR');

        console.log(`✅ Nova Proposta #${idProposta} criada.`);

        // 2. Monta objeto para o PDF
        const dadosPDF = {
            id: idProposta,
            data: dataCriacao,
            cliente: d.cliente,
            endereco: d.endereco,
            furos: v_furos,
            metragem: v_metragem,
            valor_metro: v_metro,
            subtotal_sondagem: subtotal_sondagem,
            art: v_art,
            mobilizacao: v_mobi,
            desconto: v_desc,
            total: valor_total
        };

        // 3. Chama a Fábrica de PDF
        gerarPDFDinamico(res, dadosPDF);

    } catch (err) {
        console.error('Erro ao salvar:', err);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// --- API: REEMITIR PDF (BUSCA DO BD) ---
app.get('/reemitir-pdf/:id', async (req, res) => {
    if (!adminLogado) return res.redirect('/login');

    const id = req.params.id;
    try {
        const result = await pool.query('SELECT * FROM propostas WHERE id = $1', [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).send('Proposta não encontrada.');
        }

        const row = result.rows[0];

        // Engenharia Reversa para achar o valor do metro
        const total = parseFloat(row.valor_total);
        const art = parseFloat(row.valor_art);
        const mobi = parseFloat(row.valor_mobilizacao);
        const desc = parseFloat(row.valor_desconto);
        const metragem = parseFloat(row.metragem_total);
        const furos = parseInt(row.furos); // Recuperando furos também
        
        const subtotal_sondagem = total - art - mobi + desc;
        
        let valor_metro = 0;
        if (metragem > 0) {
            valor_metro = subtotal_sondagem / metragem;
        }

        const dadosPDF = {
            id: row.id,
            data: new Date(row.data_criacao).toLocaleDateString('pt-BR'),
            cliente: row.cliente,
            endereco: row.endereco,
            furos: furos,
            metragem: metragem,
            valor_metro: valor_metro,
            subtotal_sondagem: subtotal_sondagem,
            art: art,
            mobilizacao: mobi,
            desconto: desc,
            total: total
        };

        console.log(`♻️ Reemitindo PDF da Proposta #${id}`);
        gerarPDFDinamico(res, dadosPDF);

    } catch (err) {
        console.error('Erro ao reemitir:', err);
        res.status(500).send('Erro ao gerar PDF.');
    }
});

// ==================================================================
// 📐 GERADOR DE PDF COM POSICIONAMENTO DINÂMICO
// ==================================================================
function gerarPDFDinamico(res, d) {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Orcamento_${d.id}.pdf"`);
    doc.pipe(res);

    // --- 1. CABEÇALHO (FIXO) ---
    const logoPath = path.join(__dirname, 'public', 'logo.png');
    if (fs.existsSync(logoPath)) {
        doc.image(logoPath, 40, 30, { width: 100 });
    }

    doc.font('Helvetica-Bold').fontSize(16).fillColor(COLORS.SECONDARY)
       .text('SONDAMAIS ENGENHARIA', 200, 35, { align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.LIGHT_TEXT)
       .text('R. Luís Spiandorelli Neto, 60 - Valinhos/SP', 200, 55, { align: 'right' })
       .text('CEP: 13271-570 | Tel: (19) 99800-2260', 200, 68, { align: 'right' });

    // Definir Cursor Inicial após o cabeçalho
    doc.y = 100; 

    // --- 2. DADOS DO CLIENTE (DINÂMICO) ---
    // Desenhamos o texto primeiro para calcular a altura necessária
    const startY = doc.y;
    
    // Coluna Esquerda (Dados Proposta)
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.SECONDARY)
       .text('ORÇAMENTO TÉCNICO', 50, startY + 10);
    doc.font('Helvetica').fontSize(9).fillColor('black')
       .text(`Nº: ${d.id}/2026`, 50, startY + 25)
       .text(`Data: ${d.data}`, 50, startY + 38);

    // Coluna Direita (Dados Cliente - Pode ser longo)
    const colClienteX = 200;
    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.SECONDARY)
       .text('DADOS DO CLIENTE', colClienteX, startY + 10);
    
    doc.font('Helvetica').fontSize(9).fillColor('black');
    doc.text(`Solicitante: ${d.cliente}`, colClienteX, startY + 25);
    
    // Aqui está o segredo: deixamos o endereço fluir e pegamos o Y final
    doc.text(`Local: ${d.endereco}`, colClienteX, startY + 38, { width: 340, align: 'left' });
    
    // Calcula onde a caixa deve terminar (onde o texto do endereço parou + margem)
    const endY = doc.y + 10;
    
    // Desenha a borda ao redor do que foi escrito
    doc.rect(40, startY, 515, endY - startY).strokeColor(COLORS.BORDER).stroke();

    // Atualiza o cursor global para baixo da caixa
    doc.y = endY + 20;

    // --- 3. TABELA DE ITENS ---
    const tableHeaderY = doc.y;
    
    // Cabeçalho da Tabela
    doc.rect(40, tableHeaderY, 515, 20).fill(COLORS.TABLE_HEADER);
    doc.fillColor('black').font('Helvetica-Bold').fontSize(9);
    doc.text('DESCRIÇÃO', 45, tableHeaderY + 6);
    doc.text('QTD.', 340, tableHeaderY + 6);
    doc.text('UNIT.', 390, tableHeaderY + 6);
    doc.text('TOTAL', 460, tableHeaderY + 6);

    doc.y += 25; // Move cursor para primeira linha de dados

    // Função para desenhar linha
    function drawRow(desc, subtext, qtd, unit, total, isRed = false) {
        const rowY = doc.y;
        
        // Verifica se cabe na página
        if (rowY > 700) {
            doc.addPage();
            doc.y = 50;
        }

        doc.font('Helvetica').fontSize(9).fillColor(isRed ? '#cc0000' : COLORS.DARK_TEXT);
        
        // Escreve descrição e calcula altura que ela ocupou
        doc.text(desc, 45, doc.y, { width: 280 });
        if (subtext) {
            doc.fontSize(8).fillColor(COLORS.LIGHT_TEXT).text(subtext, 45, doc.y + 2, { width: 280 });
        }
        
        // Determina altura da linha baseada no texto da descrição
        const textHeight = doc.y - rowY;
        const rowHeight = textHeight < 20 ? 20 : textHeight + 5; // Mínimo 20px

        // Escreve colunas de valores (alinhados ao topo da linha)
        doc.font('Helvetica').fontSize(9).fillColor(isRed ? '#cc0000' : COLORS.DARK_TEXT);
        doc.text(qtd, 340, rowY);
        doc.text(unit, 390, rowY);
        doc.text(total, 460, rowY);

        // Move cursor para próxima linha
        doc.y = rowY + rowHeight;
    }

    // -- INSERÇÃO DOS ITENS --
    drawRow(
        'Sondagem SPT (conf. NBR 6484:2020)', 
        `Estimativa: ${d.furos} furos. Metragem mínima contratada.`,
        `${d.metragem} m`, 
        `R$ ${d.valor_metro.toFixed(2)}`, 
        `R$ ${d.subtotal_sondagem.toFixed(2)}`
    );

    if (d.mobilizacao > 0) {
        drawRow('Mobilização e Desmobilização', '', '1 vb', `R$ ${d.mobilizacao.toFixed(2)}`, `R$ ${d.mobilizacao.toFixed(2)}`);
    }

    if (d.art > 0) {
        drawRow('Emissão de ART (Taxa CREA)', '', '1 un', `R$ ${d.art.toFixed(2)}`, `R$ ${d.art.toFixed(2)}`);
    }

    if (d.desconto > 0) {
        drawRow('Desconto Comercial', '', '-', '-', `- R$ ${d.desconto.toFixed(2)}`, true);
    }

    // Linha de Total
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(COLORS.PRIMARY).lineWidth(2).stroke();
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.SECONDARY)
       .text(`TOTAL: R$ ${d.total.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`, 40, doc.y, { align: 'right', width: 515 });

    // --- 4. NOTAS E JURÍDICO (Dinâmico) ---
    doc.moveDown(2);
    
    // Verifica quebra de página para notas
    if (doc.y > 600) doc.addPage();

    doc.font('Helvetica-Bold').fontSize(10).fillColor(COLORS.SECONDARY).text('NOTAS TÉCNICAS E CRITÉRIOS DE PARALISAÇÃO');
    doc.moveDown(0.5);
    
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.DARK_TEXT);
    const notas = [
        "1. Na ausência do fornecimento do critério de paralisação por parte da contratante, o CRITÉRIO DE PARALIZAÇÃO SEGUE AS RECOMENDAÇÕES DA NBR 6484:2020.",
        `2. Conforme NBR 6484:2020, a profundidade pode variar. Caso ultrapasse a metragem mínima (${d.metragem}m), será cobrado R$ ${d.valor_metro.toFixed(2)} por metro excedente.`,
        "3. A locação dos furos (topografia) e o fornecimento de água são de responsabilidade do contratante, salvo negociação contrária.",
        "4. Ocorrendo necessidade de avançar o pacote mínimo para seguir norma, o excedente será faturado automaticamente."
    ];

    for (let nota of notas) {
        doc.text(nota, 40, doc.y, { width: 515, align: 'justify' });
        doc.moveDown(0.5);
    }

    // --- 5. RODAPÉ DE PAGAMENTO (Fixo no final, mas verifica espaço) ---
    doc.moveDown(1);
    if (doc.y > 650) doc.addPage();

    const footerY = doc.y;
    
    // Caixa Cronograma
    doc.rect(40, footerY, 250, 70).strokeColor('#dddddd').lineWidth(1).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.SECONDARY).text('CRONOGRAMA', 50, footerY + 5);
    
    doc.font('Helvetica').fontSize(8).fillColor(COLORS.DARK_TEXT);
    doc.text('• Início: A combinar (sujeito a agenda).', 50, footerY + 20);
    doc.text('• Execução: Estimado 1 a 2 dias.', 50, footerY + 32);
    doc.text('• Relatório: Até 3 dias úteis após campo.', 50, footerY + 44);
    doc.text('• Validade: 10 dias.', 50, footerY + 56);

    // Caixa Pagamento
    doc.rect(305, footerY, 250, 70).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.SECONDARY).text('CONDIÇÕES DE PAGAMENTO', 315, footerY + 5);
    
    doc.fillColor('#cc0000').text('50% SINAL (PIX/Transferência)', 315, footerY + 20);
    doc.fillColor(COLORS.DARK_TEXT).text('50% NA ENTREGA DO LAUDO', 315, footerY + 32);
    doc.font('Helvetica-Oblique').fontSize(7).text('Dados bancários no corpo do e-mail/NF.', 315, footerY + 50);

    doc.end();
}

app.listen(port, () => {
    console.log(`\n🚀 SondaSaaS RODANDO!`);
    console.log(`➜ Porta: ${port}`);
    console.log(`➜ Ambiente: ${isProduction ? 'NUVEM (Produção)' : 'LOCAL (Desenvolvimento)'}\n`);
});