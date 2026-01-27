CREATE TABLE propostas (
    id SERIAL PRIMARY KEY,
    cliente VARCHAR(255) NOT NULL,
    endereco TEXT NOT NULL,
    area_terreno NUMERIC(10, 2),
    furos INTEGER NOT NULL,
    metragem_total NUMERIC(10, 2) NOT NULL,
    valor_art NUMERIC(10, 2),
    valor_mobilizacao NUMERIC(10, 2),
    valor_desconto NUMERIC(10, 2) DEFAULT 0,
    valor_total NUMERIC(10, 2) NOT NULL,
    data_criacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    tecnico_responsavel VARCHAR(100) DEFAULT 'Eng. Fabiano Rielli'
);