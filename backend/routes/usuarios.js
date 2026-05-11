const express = require('express');
const { enviarVerificacion, enviarRecuperacion } = require('../utils/email');
const crypto = require('crypto');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'trimgest_secret_2026';
const dataDir = path.join(__dirname, '../data');
const usuariosPath = path.join(dataDir, 'usuarios.json');

if (!fs.existsSync(usuariosPath)) fs.writeFileSync(usuariosPath, JSON.stringify([]));

const getUsuarios = () => JSON.parse(fs.readFileSync(usuariosPath));
const saveUsuarios = (u) => fs.writeFileSync(usuariosPath, JSON.stringify(u, null, 2));

function getEmpresaDir(empresaId) {
  const dir = path.join(dataDir, 'empresas', empresaId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function initEmpresa(empresaId) {
  const dir = getEmpresaDir(empresaId);
  const facturasPath = path.join(dir, 'facturas.json');
  const nominasPath = path.join(dir, 'nominas.json');
  if (!fs.existsSync(facturasPath)) fs.writeFileSync(facturasPath, JSON.stringify([]));
  if (!fs.existsSync(nominasPath)) fs.writeFileSync(nominasPath, JSON.stringify([]));
}

// Registro
router.post('/registro', async (req, res) => {
  try {
    const { email, password, nombre_empresa, nif, direccion } = req.body;
    if (!email || !password || !nombre_empresa) {
      return res.status(400).json({ error: 'Faltan datos' });
    }
    const usuarios = getUsuarios();
    if (usuarios.find(u => u.email === email)) {
      return res.status(400).json({ error: 'Email ya registrado' });
    }
    const hash = await bcrypt.hash(password, 10);
    const empresaId = 'emp_' + Date.now();
    const verToken = crypto.randomBytes(32).toString('hex');
    const nuevo = {
      id: Date.now(),
      email,
      password: hash,
      nombre_empresa,
      nif: nif || '',
      direccion: direccion || '',
      empresaId,
      plan: 'free',
      facturas_mes: 0,
      mes_actual: new Date().getMonth(),
      fecha_registro: new Date().toISOString(),
      verificado: false,
      ver_token: verToken
    };
    usuarios.push(nuevo);
    saveUsuarios(usuarios);
    initEmpresa(empresaId);
    try { await enviarVerificacion(email, nombre_empresa, verToken); } catch(e) { console.error('Error email verificacion:', e); }
    const token = jwt.sign({ id: nuevo.id, empresaId }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, nombre_empresa, empresaId, verificacion_pendiente: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error en registro' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const usuarios = getUsuarios();
    const usuario = usuarios.find(u => u.email === email);
    if (!usuario) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    const ok = await bcrypt.compare(password, usuario.password);
    if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    if (!usuario.verificado) return res.status(401).json({ error: 'Debes verificar tu email antes de entrar. Revisa tu bandeja de entrada.' });
    const token = jwt.sign({ id: usuario.id, empresaId: usuario.empresaId }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, nombre_empresa: usuario.nombre_empresa, empresaId: usuario.empresaId });
  } catch(e) {
    res.status(500).json({ error: 'Error en login' });
  }
});

// Verificar token
router.post('/verificar-token', (req, res) => {
  try {
    const { token } = req.body;
    const decoded = jwt.verify(token, JWT_SECRET);
    const usuarios = getUsuarios();
    const usuario = usuarios.find(u => u.id === decoded.id);
    if (!usuario) return res.status(401).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true, nombre_empresa: usuario.nombre_empresa, empresaId: usuario.empresaId });
  } catch(e) {
    res.status(401).json({ error: 'Token inválido' });
  }
});

// Obtener perfil
router.get('/perfil', (req, res) => {
  try {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, JWT_SECRET);
    const usuarios = getUsuarios();
    const usuario = usuarios.find(u => u.id === decoded.id);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ ok: true, nombre_empresa: usuario.nombre_empresa, nif: usuario.nif || '', direccion: usuario.direccion || '', cp: usuario.cp || '', ciudad: usuario.ciudad || '', provincia: usuario.provincia || '', email: usuario.email, plan: usuario.plan || 'basico', facturas_mes: usuario.facturas_mes || 0, plan_gratuito: usuario.plan_gratuito || false });
  } catch(e) {
    res.status(401).json({ error: 'No autorizado' });
  }
});

// Actualizar perfil
router.put('/perfil', (req, res) => {
  try {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    const jwt = require('jsonwebtoken');
    const decoded = jwt.verify(token, JWT_SECRET);
    const usuarios = getUsuarios();
    const idx = usuarios.findIndex(u => u.id === decoded.id);
    if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
    const { nombre_empresa, nif, direccion, cp, ciudad, provincia } = req.body;
    if (nombre_empresa) usuarios[idx].nombre_empresa = nombre_empresa;
    if (nif !== undefined) usuarios[idx].nif = nif;
    if (direccion !== undefined) usuarios[idx].direccion = direccion;
    if (cp !== undefined) usuarios[idx].cp = cp;
    if (ciudad !== undefined) usuarios[idx].ciudad = ciudad;
    if (provincia !== undefined) usuarios[idx].provincia = provincia;
    saveUsuarios(usuarios);
    res.json({ ok: true });
  } catch(e) {
    res.status(401).json({ error: 'No autorizado' });
  }
});


// Verificar email
router.get('/verificar', (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).send('<h2>Token no válido</h2>');
    const usuarios = getUsuarios();
    const idx = usuarios.findIndex(u => u.ver_token === token);
    if (idx === -1) return res.status(400).send('<h2>Token no válido o ya usado</h2>');
    usuarios[idx].verificado = true;
    usuarios[idx].ver_token = null;
    saveUsuarios(usuarios);
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>TrimGest</title><style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5;}div{text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 2px 20px rgba(0,0,0,0.1);}</style></head><body><div><h2>✅ Email verificado</h2><p>Tu cuenta está activa. Ya puedes entrar a TrimGest.</p><br><a href="https://trimgest.es/app" style="background:#2563eb;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;">Entrar a la app</a></div></body></html>`);
  } catch(e) {
    res.status(500).send('<h2>Error al verificar</h2>');
  }
});

module.exports = { router, getEmpresaDir, JWT_SECRET };
