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
const exportarRouter = require('./routes/exportar');
const { router: usuariosRouter } = require('./routes/usuarios');
const adminRouter = require('./routes/admin');
const stripeRouter = require('./routes/stripe');
const gestoriaRouter = require('./routes/gestoria');
const compartirRouter = require('./routes/compartir');
app.use(cors());
app.use(express.json());

app.use('/facturas', facturasRouter);
app.use('/generar', generarRouter);
app.use('/auth', authRouter);
app.use('/asesor', asesorRouter);
app.use('/pyg', pygRouter);
app.use('/nominas', nominasRouter);
app.use('/exportar', exportarRouter);
app.use('/usuarios', usuariosRouter);
app.use('/admin', adminRouter);
app.use('/stripe', stripeRouter);
app.use('/gestoria', gestoriaRouter);
app.use('/api/compartir', compartirRouter);


app.get('/', (req, res) => {
res.sendFile(path.join(__dirname, 'public/landing.html'));
});

app.get('/app', (req, res) => {
res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/recuperar', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/recuperar.html'));
});

app.get('/verificar', (req, res) => {
  const token = req.query.token;
  if (!token) return res.redirect('/app');
  const usuariosRouter = require('./routes/usuarios');
  res.redirect('https://trimgest.es/usuarios/verificar?token=' + token);
});

app.get('/compartir/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/compartir.html'));
});

app.get('/privacidad', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/privacidad.html'));
});

app.get('/panel-gestoria', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/gestoria.html'));
});

app.get('/panel-admin', (req, res) => {
res.sendFile(path.join(__dirname, 'public/admin.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Servidor TrimGest corriendo en puerto ${PORT}`);
});