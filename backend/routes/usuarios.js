const express = require('express');
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
    const { email, password, nombre_empresa } = req.body;
    if (!email || !password || !nombre_empresa) {
      return res.status(400).json({ error: 'Faltan datos' });
    }
    const usuarios = getUsuarios();
    if (usuarios.find(u => u.email === email)) {
      return res.status(400).json({ error: 'Email ya registrado' });
    }
    const hash = await bcrypt.hash(password, 10);
    const empresaId = 'emp_' + Date.now();
    const nuevo = {
      id: Date.now(),
      email,
      password: hash,
      nombre_empresa,
      empresaId,
      plan: 'basico',
      facturas_mes: 0,
      mes_actual: new Date().getMonth(),
      fecha_registro: new Date().toISOString()
    };
    usuarios.push(nuevo);
    saveUsuarios(usuarios);
    initEmpresa(empresaId);
    const token = jwt.sign({ id: nuevo.id, empresaId }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, nombre_empresa, empresaId });
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

module.exports = { router, getEmpresaDir, JWT_SECRET };
