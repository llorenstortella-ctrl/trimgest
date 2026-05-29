const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'trimgest_secret_2026';
const { enviarInvitacionReferidoEmpresa, enviarInvitacionReferidoGestoria } = require('../utils/email');

const USUARIOS_PATH = process.env.RAILWAY_ENVIRONMENT ? '/app/data/usuarios.json' : path.join(__dirname, '../../data/usuarios.json');

function getUsuarios() {
  try { return JSON.parse(fs.readFileSync(USUARIOS_PATH, 'utf8')); } catch(e) { return []; }
}
function saveUsuarios(u) {
  fs.writeFileSync(USUARIOS_PATH, JSON.stringify(u, null, 2));
}
function getUserFromToken(req) {
  try {
    const auth = req.headers.authorization;
    if (!auth) return null;
    const token = auth.replace('Bearer ', '');
    return jwt.verify(token, JWT_SECRET);
  } catch(e) { return null; }
}

// GET /referidos/info — código y saldo del usuario
router.get('/info', (req, res) => {
  const decoded = getUserFromToken(req);
  if (!decoded) return res.status(401).json({ error: 'No autorizado' });
  const usuarios = getUsuarios();
  const usuario = usuarios.find(u => u.empresaId === decoded.empresaId);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({
    ref_codigo: usuario.ref_codigo || null,
    ref_saldo: usuario.ref_saldo || 0,
    enlace: 'https://trimgest.es/?ref=' + (usuario.ref_codigo || '')
  });
});

// POST /referidos/invitar — envía email de invitación
router.post('/invitar', async (req, res) => {
  const decoded = getUserFromToken(req);
  if (!decoded) return res.status(401).json({ error: 'No autorizado' });
  const { emailDestino } = req.body;
  if (!emailDestino) return res.status(400).json({ error: 'Falta email' });
  const usuarios = getUsuarios();
  const usuario = usuarios.find(u => u.empresaId === decoded.empresaId);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  const enlace = 'https://trimgest.es/?ref=' + (usuario.ref_codigo || '');
  try {
    if (usuario.tipo === 'gestoria') {
      await enviarInvitacionReferidoGestoria(emailDestino, usuario.nombre_empresa, enlace);
    } else {
      await enviarInvitacionReferidoEmpresa(emailDestino, usuario.nombre_empresa, enlace);
    }
    res.json({ ok: true });
  } catch(e) {
    console.error('Error enviando invitacion referido:', e);
    res.status(500).json({ error: 'Error enviando email' });
  }
});

// POST /referidos/solicitar-pago — solicita cobro (mínimo 15€)
router.post('/solicitar-pago', (req, res) => {
  const decoded = getUserFromToken(req);
  if (!decoded) return res.status(401).json({ error: 'No autorizado' });
  const { iban, dni } = req.body;
  if (!iban || !dni) return res.status(400).json({ error: 'Faltan IBAN y DNI' });
  const usuarios = getUsuarios();
  const idx = usuarios.findIndex(u => u.empresaId === decoded.empresaId);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
  const usuario = usuarios[idx];
  if ((usuario.ref_saldo || 0) < 15) return res.status(400).json({ error: 'Saldo minimo 15€ para solicitar pago' });
  if (usuario.ref_pago_pendiente) return res.status(400).json({ error: 'Ya tienes una solicitud pendiente' });
  usuarios[idx].ref_pago_pendiente = {
    iban,
    dni,
    importe: usuario.ref_saldo,
    fecha: new Date().toISOString(),
    pagado: false
  };
  saveUsuarios(usuarios);
  res.json({ ok: true, importe: usuario.ref_saldo });
});

// GET /referidos/admin/pendientes — lista solicitudes pendientes (solo admin)
router.get('/admin/pendientes', (req, res) => {
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword !== (process.env.ADMIN_PASSWORD || 'TrimGest2026!')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const usuarios = getUsuarios();
  const pendientes = usuarios
    .filter(u => u.ref_pago_pendiente && !u.ref_pago_pendiente.pagado)
    .map(u => ({
      empresaId: u.empresaId,
      email: u.email,
      nombre: u.nombre_empresa,
      tipo: u.tipo || 'empresa',
      saldo: u.ref_saldo,
      iban: u.ref_pago_pendiente.iban,
      dni: u.ref_pago_pendiente.dni,
      importe: u.ref_pago_pendiente.importe,
      fecha: u.ref_pago_pendiente.fecha
    }));
  res.json(pendientes);
});

// POST /referidos/admin/marcar-pagado — marca solicitud como pagada
router.post('/admin/marcar-pagado', (req, res) => {
  const adminPassword = req.headers['x-admin-password'];
  if (adminPassword !== (process.env.ADMIN_PASSWORD || 'TrimGest2026!')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const { empresaId } = req.body;
  if (!empresaId) return res.status(400).json({ error: 'Falta empresaId' });
  const usuarios = getUsuarios();
  const idx = usuarios.findIndex(u => u.empresaId === empresaId);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
  usuarios[idx].ref_saldo = 0;
  usuarios[idx].ref_pago_pendiente = null;
  saveUsuarios(usuarios);
  res.json({ ok: true });
});

module.exports = router;
