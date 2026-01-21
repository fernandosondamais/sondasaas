function gerarPDFDinamico(res, d) {
    const doc = new PDFDocument({ margin: 30, size: 'A4', bufferPages: true });
    
    // Configuração de fluxo de resposta
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Proposta_${d.id}.pdf"`);
    doc.pipe(res);

    // --- HELPER: Formatação de Moeda ---
    const fmtMoney = (v) => `R$ ${parseFloat(v).toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;

    // --- HELPER: Controle de Quebra de Página Inteligente ---
    // Verifica se há espaço suficiente (neededHeight). Se não, cria nova página.
    function checkPageBreak(neededHeight) {
        if (doc.y + neededHeight > doc.page.height - doc.page.margins.bottom) {
            doc.addPage();
            return true; // Retorna true se houve quebra
        }
        return false;
    }

    // --- 1. CABEÇALHO (Posições Fixas são OK aqui) ---
    const logoPath = path.join(__dirname, 'public', 'logo.png');
    if (fs.existsSync(logoPath)) { try { doc.image(logoPath, 30, 30, { width: 70 }); } catch (e) {} }
    
    let headerTextY = 95; 
    doc.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ACCENT).text('Sondamais Engenharia', 30, headerTextY);
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.PRIMARY)
        .text('R. Luís Spiandorelli Neto, 60', 30, headerTextY + 15)
        .text('Valinhos, São Paulo, 13271-570', 30, headerTextY + 27)
        .text('(19) 99800-2260 | contato@sondamais.com.br', 30, headerTextY + 39);

    const boxX = 300; const boxY = 40;
    doc.font('Helvetica-Bold').fontSize(14).text('Orçamento', boxX, boxY);
    
    doc.font('Helvetica-Bold').fontSize(9).text('Data', boxX, boxY + 25);
    doc.font('Helvetica').text(d.data, boxX, boxY + 37);
    
    doc.font('Helvetica-Bold').text('Número da Proposta', boxX + 150, boxY + 25);
    doc.font('Helvetica').text(`${d.id}/2026`, boxX + 150, boxY + 37);
    
    doc.font('Helvetica-Bold').text('Pagamento', boxX, boxY + 55);
    doc.font('Helvetica').text('50% SINAL + 50% ENTREGA DO LAUDO', boxX, boxY + 67);
    
    doc.font('Helvetica-Bold').text('Elaborado por:', boxX, boxY + 95);
    doc.font('Helvetica').text('Eng. Fabiano Rielli', boxX, boxY + 107);
    
    const clienteY = boxY + 125;
    doc.font('Helvetica-Bold').text('Solicitante:', boxX, clienteY);
    doc.font('Helvetica').text(d.cliente, boxX + 55, clienteY);
    doc.text(`Tel: ${d.telefone || '-'} | Email: ${d.email || '-'}`, boxX, clienteY + 14, {width: 260});
    doc.text(`Local: ${d.endereco}`, boxX, clienteY + 28, {width: 260});

    // --- 2. TABELA DE ITENS ---
    let y = 230; 
    const colDesc = 30, colQtd = 330, colUnit = 380, colTotal = 460;

    // Função para desenhar o cabeçalho da tabela
    function drawTableHeader(posY) {
        doc.rect(30, posY, 535, 20).fill('#f0f0f0');
        doc.fillColor('black').font('Helvetica-Bold').fontSize(9);
        doc.text('Descrição', colDesc + 5, posY + 6); 
        doc.text('Qtd', colQtd, posY + 6); 
        doc.text('Unitário', colUnit, posY + 6); 
        doc.text('Total', colTotal, posY + 6);
        return posY + 25; // Retorna a nova posição Y
    }

    y = drawTableHeader(y); // Desenha o cabeçalho inicial

    function drawRow(desc, subtext, qtd, unit, total) {
        // Verifica se cabe a linha (estimando 45px se tiver subtexto, ou 20px se não)
        const rowHeight = subtext ? 45 : 20;
        
        // Se passar de 700 (margem segura), nova página
        if (y + rowHeight > 750) { 
            doc.addPage(); 
            y = 50; 
            y = drawTableHeader(y); // Redesenha cabeçalho na nova página
        }

        doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.PRIMARY).text(desc, colDesc, y);
        
        if(subtext) { 
            doc.font('Helvetica').fontSize(8).text(subtext, colDesc, y + 12, {width: 290, align: 'justify'}); 
        }
        
        doc.font('Helvetica').fontSize(9);
        doc.text(qtd, colQtd, y); 
        doc.text(unit, colUnit, y); 
        doc.text(total, colTotal, y);
        
        y += rowHeight; 
        doc.moveTo(30, y).lineTo(565, y).strokeColor('#eeeeee').lineWidth(1).stroke(); 
        y += 10; 
    }

    // Dados da Tabela
    drawRow('Sondagem SPT', '(furos de até 20m ou NBR 6484:2020). Cobrado o metro excedente.', d.furos, '', '');
    drawRow('*Metragem mínima (metros lineares)', null, d.metragem, fmtMoney(d.valor_metro), fmtMoney(d.subtotal_sondagem));
    drawRow('ART', null, '1', fmtMoney(d.art), fmtMoney(d.art));
    if(d.mobilizacao > 0) drawRow('Mobilização (Logística)', null, '1', fmtMoney(d.mobilizacao), fmtMoney(d.mobilizacao));
    if(d.desconto > 0) drawRow('Desconto Comercial', null, '-', '-', `- ${fmtMoney(d.desconto)}`);

    // --- 3. TOTAIS ---
    // Verifica espaço para o bloco de totais (aprox 60px)
    checkPageBreak(60); 
    // Sincroniza o cursor do PDFKit com nossa variável Y manual
    doc.y = y + 10; 

    doc.font('Helvetica-Bold').fontSize(10).text('SONDAMAIS', 30, doc.y);
    doc.fontSize(8).text(`REV0${d.id % 5}`, 30, doc.y + 12); // Pequeno ajuste visual
    doc.font('Helvetica-Bold').fontSize(16).text(fmtMoney(d.total), 30, doc.y + 15);

    // --- 4. TEXTOS JURÍDICOS (CORREÇÃO DE COLISÃO) ---
    doc.moveDown(2); // Dá um espaço após o total
    
    // Aqui garantimos que o cursor (doc.y) está seguro
    checkPageBreak(100); // Verifica se tem espaço para começar o texto jurídico

    doc.font('Helvetica').fontSize(8);
    doc.text("Na ausência do fornecimento do critério de paralisação por parte da contratante ou seu preposto, o CRITÉRIO DE PARALIZAÇÃO DOS ENSAIOS SEGUE AS RECOMENDAÇÕES DA NBR 6484:2020, ITEM 5.2.4 OU 6.2.4.", {width: 535, align: 'justify'});
    
    doc.moveDown(0.8);
    
    // CORREÇÃO DO NEGRITO: Usamos font switch em vez de Markdown "**"
    doc.font('Helvetica-Bold');
    doc.text("Conforme critério de paralisação de sondagem-SPT (Norma NBR 6484:2020 - vide abaixo), a profundidade atingida pode sofrer variação. Portanto, caso ultrapasse a metragem mínima será cobrado " + fmtMoney(d.valor_metro) + " por metro excedente.", {width: 535, align: 'justify'});
    
    doc.moveDown(0.8);
    doc.font('Helvetica').text("5.2.4.2 Na ausência do fornecimento do critério de paralisação, as sondagens devem avançar até:", {width: 535});
    doc.moveDown(0.5);
    
    // Lista com recuo
    const listOpts = {indent: 10, width: 525};
    doc.text("a) avanço até a profundidade com 10 m de resultados consecutivos N >= 25 golpes;", listOpts);
    doc.moveDown(0.2);
    doc.text("b) avanço até a profundidade com 8 m de resultados consecutivos N >= 30 golpes;", listOpts);
    doc.moveDown(0.2);
    doc.text("c) avanço até a profundidade com 6 m de resultados consecutivos N >= 35 golpes;", listOpts);

    // --- 5. CRONOGRAMA ---
    doc.moveDown(2);
    
    // Verifica espaço para o bloco do cronograma inteiro (aprox 120px)
    if (checkPageBreak(120)) {
        // Se criou página nova, reseta Y para o topo
        doc.y = 50;
    }

    doc.font('Helvetica-Bold').fontSize(10).text('CRONOGRAMA', 30, doc.y);
    doc.moveDown(0.5);
    
    const cronoData = [
        ['Previsão de execução', '1 a 2 dias'],
        ['Início', 'A combinar'],
        ['Entrega do Relatório', '3 dias úteis após execução'],
        ['Validade', '10 dias']
    ];

    doc.font('Helvetica').fontSize(9);
    let cronoY = doc.y;
    
    cronoData.forEach(row => {
        doc.rect(30, cronoY, 535, 20).stroke();
        doc.text(row[0], 35, cronoY + 6); 
        doc.text(row[1], 300, cronoY + 6); 
        cronoY += 20;
    });

    doc.end();
}