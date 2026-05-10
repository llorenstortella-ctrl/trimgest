const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TrimGest2026!';
const baseDataDir = path.join(__dirname, '../data');

function getUsuarios() {
  const usuariosPath = path.join(baseDataDir, 'usuarios.json');
  if (!fs.existsSync(usuariosPath)) return [];
  return JSON.parse(fs.readFileSync(usuariosPath));
}

function saveUsuarios(usuarios) {
  fs.writeFileSync(path.join(baseDataDir, 'usuarios.json'), JSON.stringify(usuarios, null, 2));
}

function getFacturasCount(empresaId) {
  const dbPath = path.join(baseDataDir, 'empresas', empresaId, 'facturas.json');
  if (!fs.existsSync(dbPath)) return 0;
  return JSON.parse(fs.readFileSync(dbPath)).length;
}

function getNominasCount(empresaId) {
  const dbPath = path.join(baseDataDir, 'empresas', empresaId, 'nominas.json');
  if (!fs.existsSync(dbPath)) return 0;
  return JSON.parse(fs.readFileSync(dbPath)).length;
}

// Verificar password admin
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Password incorrecta' });
  }
});

// Obtener todos los usuarios
router.get('/usuarios', (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'No autorizado' });

  const usuarios = getUsuarios();
  const data = usuarios.map(u => ({
    id: u.id,
    email: u.email,
    nombre_empresa: u.nombre_empresa,
    plan: u.plan || 'basico',
    fecha_registro: u.fecha_registro,
    empresaId: u.empresaId,
    facturas: getFacturasCount(u.empresaId),
    nominas: getNominasCount(u.empresaId)
  }));

  res.json({
    total: usuarios.length,
    usuarios: data
  });
});

// Borrar usuario
router.delete('/usuarios/:id', (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'No autorizado' });

  const usuarios = getUsuarios();
  const idx = usuarios.findIndex(u => u.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
  usuarios.splice(idx, 1);
  saveUsuarios(usuarios);
  res.json({ ok: true });
});

// Obtener ficha de empresa
router.get('/empresa/:empresaId', (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'No autorizado' });

  const usuarios = getUsuarios();
  const usuario = usuarios.find(u => u.empresaId === req.params.empresaId);
  if (!usuario) return res.status(404).json({ error: 'Empresa no encontrada' });

  res.json({
    ok: true,
    empresa: {
      nombre_empresa: usuario.nombre_empresa,
      email: usuario.email,
      nif: usuario.nif || '-',
      direccion: usuario.direccion || '-',
      cp: usuario.cp || '-',
      ciudad: usuario.ciudad || '-',
      provincia: usuario.provincia || '-',
      plan: usuario.plan || 'basico',
      fecha_registro: usuario.fecha_registro,
      facturas: getFacturasCount(usuario.empresaId),
      nominas: getNominasCount(usuario.empresaId)
    }
  });
});

module.exports = router;
