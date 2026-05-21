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

function getNominas(empresaId) {
  const dbPath = path.join(baseDataDir, 'empresas', empresaId, 'nominas.json');
  if (!fs.existsSync(dbPath)) return [];
  return JSON.parse(fs.readFileSync(dbPath));
}

function mesesDeTrimestre(trimestre) {
  if (trimestre === 'T1') return ['01','02','03'];
  if (trimestre === 'T2') return ['04','05','06'];
  if (trimestre === 'T3') return ['07','08','09'];
  return ['10','11','12'];
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
  const todasNominas = getNominas(empresaEncontrada.empresaId);
  const meses = mesesDeTrimestre(enlaceEncontrado.trimestre);
  const listaNominas = todasNominas.filter(function(n) {
    return String(n.anno) === String(enlaceEncontrado.anno) && meses.indexOf(String(n.mes).padStart(2,'0')) !== -1;
  });
  res.json({
    empresa: empresaEncontrada.nombre_empresa,
    trimestre: enlaceEncontrado.trimestre,
    anno: enlaceEncontrado.anno,
    facturas: lista,
    nominas: listaNominas,
    contabilizados: enlaceEncontrado.contabilizados || []
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


// Contabilizar factura desde enlace compartido
router.post('/:token/contabilizar/:facturaId', (req, res) => {
  const { token, facturaId } = req.params;
  const { password } = req.body;
  const usuarios = getUsuarios();
  var usuIdx = -1;
  var enlaceIdx = -1;
  usuarios.forEach(function(u, i) {
    if (u.enlaces_compartidos) {
      u.enlaces_compartidos.forEach(function(e, j) {
        if (e.token === token) { usuIdx = i; enlaceIdx = j; }
      });
    }
  });
  if (usuIdx === -1) return res.status(404).json({ error: 'No encontrado' });
  var enlace = usuarios[usuIdx].enlaces_compartidos[enlaceIdx];
  if (enlace.password && enlace.password !== password) return res.status(401).json({ error: 'No autorizado' });
  if (!enlace.contabilizados) enlace.contabilizados = [];
  var idx = enlace.contabilizados.indexOf(facturaId);
  if (idx === -1) enlace.contabilizados.push(facturaId);
  else enlace.contabilizados.splice(idx, 1);
  fs.writeFileSync(usuariosPath, JSON.stringify(usuarios, null, 2));
  res.json({ ok: true, contabilizados: enlace.contabilizados });
});

module.exports = router;