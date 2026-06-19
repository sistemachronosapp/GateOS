const express = require('express');
const cors = require('cors');
const { applyHelmet, limiter, sanitizeInput } = require('./middlewares/security');

// 1. Importação das rotas
const authRoutes = require('./routes/authRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const superAdminRoutes = require('./routes/superAdminRoutes');
const condominioRoutes = require('./routes/condominioRoutes'); // <-- AQUI! A nova rota do síndico
const paymentRoutes = require('./routes/paymentRoutes');

const app = express();

// Segurança e Parsers
app.use(applyHelmet);
app.use(limiter);
app.use(cors());
app.use(express.json());
app.use(sanitizeInput);

// Arquivos Estáticos (Seu Frontend)
app.use(express.static('public'));

// 2. Rotas da API
app.use('/auth', authRoutes);
app.use('/devices', deviceRoutes);
app.use('/cortex-api', superAdminRoutes); 
app.use('/condominio', condominioRoutes); // <-- AQUI! Conectando a URL ao arquivo
app.use('/financeiro', paymentRoutes);

app.get('/', (req, res) => {
    res.redirect('/home.html');
});

module.exports = app;