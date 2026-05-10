const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const facturasRouter = require('./routes/facturas');
const generarRouter = require('./routes/generar');
const authRouter = require('./routes/auth');

const path = require('path');
const app = express();
const PORT = process.env.PORT || 3001;
const asesorRouter = require('./routes/asesor');
const pygRouter = require('./routes/pyg');
const nominasRouter = require('./routes/nominas');
app.use(cors());
app.use(express.json());

app.use('/facturas', facturasRouter);
app.use('/generar', generarRouter);
app.use('/auth', authRouter);
app.use('/asesor', asesorRouter);
app.use('/pyg', pygRouter);
app.use('/nominas', nominasRouter);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor TrimGest corriendo en puerto ${PORT}`);
});