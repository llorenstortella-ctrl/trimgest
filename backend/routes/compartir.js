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
  const esTodos = enlaceEncontrado.trimestre === 'TODOS';
  const lista = facturas.filter(function(f) {
    if (esTodos) return String(f.anno) === String(enlaceEncontrado.anno);
    return f.trimestre === enlaceEncontrado.trimestre && String(f.anno) === String(enlaceEncontrado.anno);
  });
  const todasNominas = getNominas(empresaEncontrada.empresaId);
  const meses = esTodos ? ['01','02','03','04','05','06','07','08','09','10','11','12'] : mesesDeTrimestre(enlaceEncontrado.trimestre);
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


// PDF todas las facturas de un tipo y trimestre
router.get('/:token/pdf/:tipo/:trimestre/:anno', (req, res) => {
  const { token, tipo, trimestre, anno } = req.params;
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
  const facturas = getFacturas(empresaEncontrada.empresaId);
  const esTodos = enlaceEncontrado.trimestre === 'TODOS';
  const lista = facturas.filter(function(f) {
    if (f.tipo !== tipo) return false;
    if (esTodos) return String(f.anno) === String(enlaceEncontrado.anno);
    return f.trimestre === enlaceEncontrado.trimestre && String(f.anno) === String(enlaceEncontrado.anno);
  });
  generarPdfFacturas(res, lista, empresaEncontrada.nombre_empresa, tipo, enlaceEncontrado.trimestre, enlaceEncontrado.anno);
});

// PDF facturas seleccionadas
router.get('/:token/pdf/seleccionadas', (req, res) => {
  const { token } = req.params;
  const { password, tipo, ids } = req.query;
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
  const idsList = (ids || '').split(',').map(function(x) { return x.trim(); });
  const facturas = getFacturas(empresaEncontrada.empresaId);
  const lista = facturas.filter(function(f) { return idsList.indexOf(String(f.id)) !== -1; });
  generarPdfFacturas(res, lista, empresaEncontrada.nombre_empresa, tipo || 'proveedor', enlaceEncontrado.trimestre, enlaceEncontrado.anno);
});

// PDF nominas todas
router.get('/:token/pdf/nominas/:anno', (req, res) => {
  const { token, anno } = req.params;
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
  const todasNominas = getNominas(empresaEncontrada.empresaId);
  const esTodos = enlaceEncontrado.trimestre === 'TODOS';
  const meses = esTodos ? ['01','02','03','04','05','06','07','08','09','10','11','12'] : mesesDeTrimestre(enlaceEncontrado.trimestre);
  const lista = todasNominas.filter(function(n) {
    return String(n.anno) === String(enlaceEncontrado.anno) && meses.indexOf(String(n.mes).padStart(2,'0')) !== -1;
  });
  generarPdfNominas(res, lista, empresaEncontrada.nombre_empresa, enlaceEncontrado.trimestre, enlaceEncontrado.anno);
});

// PDF nominas seleccionadas
router.get('/:token/pdf/nominas-seleccionadas', (req, res) => {
  const { token } = req.params;
  const { password, ids } = req.query;
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
  const idsList = (ids || '').split(',').map(function(x) { return x.trim(); });
  const todasNominas = getNominas(empresaEncontrada.empresaId);
  const lista = todasNominas.filter(function(n) { return idsList.indexOf(String(n.id)) !== -1; });
  generarPdfNominas(res, lista, empresaEncontrada.nombre_empresa, enlaceEncontrado.trimestre, enlaceEncontrado.anno);
});

function generarPdfFacturas(res, lista, empresa, tipo, trimestre, anno) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="facturas.pdf"');
  doc.pipe(res);
  const tipoLabel = tipo === 'proveedor' ? 'Proveedores' : 'Clientes';
  const periodoLabel = trimestre === 'TODOS' ? 'Anno ' + anno : trimestre + ' ' + anno;
  doc.fontSize(18).fillColor('#1a1a1a').text('TrimGest - ' + tipoLabel, { align: 'left' });
  doc.fontSize(11).fillColor('#666').text(empresa + ' | ' + periodoLabel);
  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.5);
  if (!lista.length) {
    doc.fontSize(12).fillColor('#666').text('Sin facturas');
    doc.end();
    return;
  }
  var epLabels = { transferencia: 'Transferencia', efectivo: 'Efectivo', tarjeta: 'Tarjeta', domiciliacion: 'Domiciliacion', bizum: 'Bizum', mixto: 'Mixto', sinpagar: 'Sin pagar', parcial: 'Parcial' };
  lista.forEach(function(f, i) {
    if (doc.y > 700) doc.addPage();
    doc.fontSize(11).fillColor('#1a1a1a').text((f.nombre || 'Sin nombre') + '  |  N: ' + (f.numero_factura || '-') + '  |  ' + (f.fecha || '-'));
    var base = Number(f.base_imponible).toFixed(2);
    var iva = Number(f.iva_importe).toFixed(2);
    var total = Number(f.total).toFixed(2);
    var pago = f.estado_pago ? (epLabels[f.estado_pago] || f.estado_pago) : 'Sin clasificar';
    doc.fontSize(10).fillColor('#444').text('Base: ' + base + ' EUR  |  IVA ' + (f.iva_porcentaje || 0) + '%: ' + iva + ' EUR  |  Total: ' + total + ' EUR  |  Pago: ' + pago);
    if (f.nota) doc.fontSize(9).fillColor('#888').text('Nota: ' + f.nota);
    doc.moveDown(0.4);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#eeeeee').stroke();
    doc.moveDown(0.3);
  });
  var totalSum = lista.reduce(function(a, f) { return a + Number(f.total); }, 0);
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor('#1a1a1a').text('Total: ' + totalSum.toFixed(2) + ' EUR', { align: 'right' });
  doc.end();
}

function generarPdfNominas(res, lista, empresa, trimestre, anno) {
  const PDFDocument = require('pdfkit');
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename="nominas.pdf"');
  doc.pipe(res);
  const periodoLabel = trimestre === 'TODOS' ? 'Anno ' + anno : trimestre + ' ' + anno;
  doc.fontSize(18).fillColor('#1a1a1a').text('TrimGest - Nominas');
  doc.fontSize(11).fillColor('#666').text(empresa + ' | ' + periodoLabel);
  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#cccccc').stroke();
  doc.moveDown(0.5);
  if (!lista.length) {
    doc.fontSize(12).fillColor('#666').text('Sin nominas');
    doc.end();
    return;
  }
  lista.forEach(function(n) {
    if (doc.y > 700) doc.addPage();
    doc.fontSize(11).fillColor('#1a1a1a').text((n.trabajador || 'Sin nombre') + '  |  Mes ' + (n.mes || '-') + '/' + (n.anno || '-'));
    var bruto = Number(n.devengado).toFixed(2);
    var neto = Number(n.neto).toFixed(2);
    var irpf = Number(n.irpf_importe).toFixed(2);
    var sst = Number(n.ss_trabajador).toFixed(2);
    var coste = Number(n.coste_empresa).toFixed(2);
    doc.fontSize(10).fillColor('#444').text('Bruto: ' + bruto + ' EUR  |  Neto: ' + neto + ' EUR  |  IRPF ' + (n.irpf_porcentaje || 0) + '%: ' + irpf + ' EUR');
    doc.fontSize(10).fillColor('#444').text('SS Trabajador: ' + sst + ' EUR  |  Coste empresa: ' + coste + ' EUR');
    doc.moveDown(0.4);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#eeeeee').stroke();
    doc.moveDown(0.3);
  });
  var totalCoste = lista.reduce(function(a, n) { return a + Number(n.coste_empresa); }, 0);
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor('#1a1a1a').text('Coste total empresa: ' + totalCoste.toFixed(2) + ' EUR', { align: 'right' });
  doc.end();
}

module.exports = router;