const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const baseDataDir = path.join(__dirname, '../data');
const usuariosPath = path.join(baseDataDir, 'usuarios.json');

function getUsuarios() {
  return JSON.parse(fs.readFileSync(usuariosPath));
}

function getFacturas(empresaId) {
  const dbPath = path.join(baseDataDir, 'empresas', empresaId, 'facturas.json');
  if (!fs.existsSync(dbPath)) return [];
  return JSON.parse(fs.readFileSync(dbPath));
}

const auth = require('../middleware/auth');

// Generar enlace compartido
router.post('/generar', auth, (req, res) => {
  const { trimestre, anno, password } = req.body;
  const token = crypto.randomBytes(16).toString('hex');
  const usuarios = getUsuarios();
  const idx = usuarios.findIndex(u => u.empresaId === req.empresaId);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!usuarios[idx].enlaces_compartidos) usuarios[idx].enlaces_compartidos = [];
  usuarios[idx].enlaces_compartidos.push({
    token, trimestre, anno,
    password: password || null,
    creado: new Date().toISOString()
  });
  fs.writeFileSync(usuariosPath, JSON.stringify(usuarios, null, 2));
  res.json({ token, url: 'https://trimgest.es/compartir/' + token });
});

// Ver datos del enlace compartido
router.get('/:token', (req, res) => {
  const { token } = req.params;
  const { password } = req.query;
  const usuarios = getUsuarios();
  var empresaEncontrada = null;
  var enlaceEncontrado = null;
  usuarios.forEach(function(u) {
    if (u.enlaces_compartidos) {
      u.enlaces_compartidos.forEach(function(e) {
        if (e.token === token) { empresaEncontrada = u; enlaceEncontrado = e; }
      });
    }
  });
  if (!empresaEncontrada || !enlaceEncontrado) return res.status(404).json({ error: 'Enlace no encontrado' });
  if (enlaceEncontrado.password && enlaceEncontrado.password !== password) {
    return res.status(401).json({ error: 'contrasena_requerida' });
  }
  const facturas = getFacturas(empresaEncontrada.empresaId);
  const lista = facturas.filter(function(f) {
    return f.trimestre === enlaceEncontrado.trimestre && String(f.anno) === String(enlaceEncontrado.anno);
  });
  res.json({
    empresa: empresaEncontrada.nombre_empresa,
    trimestre: enlaceEncontrado.trimestre,
    anno: enlaceEncontrado.anno,
    facturas: lista
  });
});

// Ver PDF original
router.get('/:token/archivo/:filename', (req, res) => {
  const { token, filename } = req.params;
  const { password } = req.query;
  const usuarios = getUsuarios();
  var empresaEncontrada = null;
  var enlaceEncontrado = null;
  usuarios.forEach(function(u) {
    if (u.enlaces_compartidos) {
      u.enlaces_compartidos.forEach(function(e) {
        if (e.token === token) { empresaEncontrada = u; enlaceEncontrado = e; }
      });
    }
  });
  if (!empresaEncontrada || !enlaceEncontrado) return res.status(404).json({ error: 'No encontrado' });
  if (enlaceEncontrado.password && enlaceEncontrado.password !== password) return res.status(401).json({ error: 'No autorizado' });
  const filePath = path.join(baseDataDir, 'empresas', empresaEncontrada.empresaId, 'uploads', filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(filePath);
});

module.exports = router;