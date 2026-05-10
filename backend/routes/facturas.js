const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { extraerDatosFactura } = require('../services/openai');

const uploadsDir = path.join(__dirname, '../data/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const dbPath = process.env.DATA_PATH || path.join(__dirname, '../data/facturas.json');
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify([]));

const getFacturas = () => JSON.parse(fs.readFileSync(dbPath));
const saveFacturas = (facturas) => fs.writeFileSync(dbPath, JSON.stringify(facturas, null, 2));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});

const upload = multer({ storage });

function getTrimestre(fecha) {
  if (!fecha) return 'T1';
  const partes = fecha.split('/');
  const mes = parseInt(partes[1]);
  if (mes <= 3) return 'T1';
  if (mes <= 6) return 'T2';
  if (mes <= 9) return 'T3';
  return 'T4';
}

function getAnno(fecha) {
  if (!fecha) return new Date().getFullYear();
  const partes = fecha.split('/');
  return parseInt(partes[2]);
}

router.post('/subir', upload.single('factura'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se ha subido ningún archivo' });

  try {
    const datos = await extraerDatosFactura(req.file.path);
    const facturas = getFacturas();

    const duplicado = facturas.find(function(f) {
      return f.numero_factura === datos.numero_factura && f.nombre === datos.nombre;
    });

    if (duplicado) {
      fs.unlinkSync(req.file.path);
      return res.status(409).json({ error: 'duplicado', mensaje: 'Esta factura ya existe', factura: duplicado });
    }

    const tipoFinal = req.query.tipo_manual;
    if (!tipoFinal) return res.status(400).json({ error: 'Debes indicar el tipo de factura' });

    const nuevaFactura = {
      id: Date.now(),
      archivo: req.file.filename,
      tipo: tipoFinal,
      nombre: datos.nombre,
      numero_factura: datos.numero_factura,
      fecha: datos.fecha,
      base_imponible: datos.base_imponible,
      iva_porcentaje: datos.iva_porcentaje,
      iva_importe: datos.iva_importe,
      total: datos.total,
      anomalias: null,
      trimestre: getTrimestre(datos.fecha),
      anno: getAnno(datos.fecha),
      enviado: false,
      fecha_envio: null,
      creado: new Date().toISOString()
    };

    facturas.push(nuevaFactura);
    saveFacturas(facturas);
    res.json({ mensaje: 'Factura procesada correctamente', factura: nuevaFactura });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al procesar la factura con IA' });
  }
});

router.get('/listar', (req, res) => {
  res.json({ facturas: getFacturas() });
});

router.put('/editar/:id', (req, res) => {
  const facturas = getFacturas();
  const idx = facturas.findIndex(f => f.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
  const { tipo, trimestre, anno, nombre, numero_factura, fecha, base_imponible, iva_porcentaje, iva_importe, total } = req.body;
  if (tipo) facturas[idx].tipo = tipo;
  if (trimestre) facturas[idx].trimestre = trimestre;
  if (anno) facturas[idx].anno = parseInt(anno);
  if (nombre) facturas[idx].nombre = nombre;
  if (numero_factura) facturas[idx].numero_factura = numero_factura;
  if (fecha) {
    facturas[idx].fecha = fecha;
    facturas[idx].trimestre = getTrimestre(fecha);
    facturas[idx].anno = getAnno(fecha);
  }
  if (base_imponible) facturas[idx].base_imponible = parseFloat(base_imponible);
  if (iva_porcentaje) facturas[idx].iva_porcentaje = parseFloat(iva_porcentaje);
  if (iva_importe) facturas[idx].iva_importe = parseFloat(iva_importe);
  if (total) facturas[idx].total = parseFloat(total);
  saveFacturas(facturas);
  res.json({ mensaje: 'Actualizada', factura: facturas[idx] });
});

router.delete('/borrar/:id', (req, res) => {
  const facturas = getFacturas();
  const idx = facturas.findIndex(f => f.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
  const archivo = facturas[idx].archivo;
  facturas.splice(idx, 1);
  saveFacturas(facturas);
  try { fs.unlinkSync(path.join(uploadsDir, archivo)); } catch(e) {}
  res.json({ mensaje: 'Factura borrada' });
});

router.put('/marcar-enviado', (req, res) => {
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'Sin ids' });
  const facturas = getFacturas();
  const ahora = new Date().toISOString();
  ids.forEach(function(id) {
    const idx = facturas.findIndex(f => f.id === id);
    if (idx !== -1) { facturas[idx].enviado = true; facturas[idx].fecha_envio = ahora; }
  });
  saveFacturas(facturas);
  res.json({ mensaje: 'Marcadas como enviadas' });
});

router.post('/manual', (req, res) => {
  const facturas = getFacturas();
  const { tipo, nombre, numero_factura, fecha, base_imponible, iva_porcentaje, iva_importe, total, trimestre, anno } = req.body;
  const nueva = { id: Date.now(), tipo, nombre, numero_factura, fecha, base_imponible, iva_porcentaje, iva_importe, total, trimestre, anno, archivo: null, enviado: false, fecha_subida: new Date().toISOString() };
  facturas.push(nueva);
  saveFacturas(facturas);
  res.json({ factura: nueva });
});

module.exports = router;