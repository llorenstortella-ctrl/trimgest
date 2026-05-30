const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const auth = require('../middleware/auth');

const baseDataDir = process.env.RAILWAY_ENVIRONMENT ? '/app/data' : path.join(__dirname, '../data');

function getBancoPath(empresaId) {
  return path.join(baseDataDir, 'empresas', empresaId, 'banco.json');
}

function getBanco(empresaId) {
  const p = getBancoPath(empresaId);
  if (!fs.existsSync(p)) return { movimientos: [], ultima_fecha: null };
  return JSON.parse(fs.readFileSync(p));
}

function saveBanco(empresaId, data) {
  fs.writeFileSync(getBancoPath(empresaId), JSON.stringify(data, null, 2));
}

function getFacturas(empresaId) {
  const p = path.join(baseDataDir, 'empresas', empresaId, 'facturas.json');
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p));
}

// Parsear importe CaixaBank: "-92,40EUR" → -92.40
function parsearImporte(str) {
  if (!str) return 0;
  var s = str.replace('EUR','').replace('+','').trim();
  // Formato español: punto=miles, coma=decimal
  s = s.replace(/\./g,'').replace(',','.');
  return parseFloat(s);
}

// Parsear fecha CaixaBank: "29/05/2026" → Date
function parsearFecha(str) {
  if (!str) return null;
  const parts = str.trim().split('/');
  if (parts.length !== 3) return null;
  return new Date(parts[2], parts[1]-1, parts[0]);
}

function fechaStr(date) {
  if (!date) return null;
  const d = new Date(date);
  return d.getDate().toString().padStart(2,'0') + '/' + (d.getMonth()+1).toString().padStart(2,'0') + '/' + d.getFullYear();
}

// Cruzar movimiento con facturas — busca por importe similar y fecha cercana
function cruzarConFacturas(movimiento, facturas) {
  const imp = Math.abs(movimiento.importe);
  const fecha = new Date(movimiento.fecha);
  const candidatos = facturas.filter(function(f) {
    const totalF = Math.abs(parseFloat(f.total));
    if (Math.abs(totalF - imp) > 0.02) return false;
    const fechaF = f.fecha ? parsearFecha(f.fecha) : null;
    if (!fechaF) return false;
    const difDias = Math.abs((fecha - fechaF) / (1000*60*60*24));
    return difDias <= 60;
  });
  return candidatos.length > 0 ? candidatos[0] : null;
}

const storage = multer.memoryStorage();
const upload = multer({ storage });

// POST /banco/subir — sube CSV extracto bancario
router.post('/subir', auth, upload.single('extracto'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se ha subido ningún archivo' });
  try {
    const empresaId = req.empresaId;
    const contenido = req.file.buffer.toString('utf8');
    const lineas = contenido.split('\n').filter(l => l.trim());
    
    // Detectar cabecera CaixaBank: Concepto;Fecha;Importe;Saldo
    const cabecera = lineas[0].toLowerCase();
    if (!cabecera.includes('concepto') || !cabecera.includes('fecha') || !cabecera.includes('importe')) {
      return res.status(400).json({ error: 'Formato de banco no reconocido. Por favor usa el extracto de CaixaBank.' });
    }

    const banco = getBanco(empresaId);
    const facturas = getFacturas(empresaId);
    
    // Fecha límite — ignorar movimientos ya procesados
    const ultimaFecha = banco.ultima_fecha ? new Date(banco.ultima_fecha) : null;

    const nuevosMovimientos = [];
    let maxFecha = ultimaFecha;

    for (let i = 1; i < lineas.length; i++) {
      const cols = lineas[i].split(';');
      if (cols.length < 3) continue;
      const concepto = cols[0].trim();
      const fechaRaw = cols[1].trim();
      const importeRaw = cols[2].trim();
      const fecha = parsearFecha(fechaRaw);
      if (!fecha) continue;
      const importe = parsearImporte(importeRaw);

      // Ignorar si ya procesado
      if (ultimaFecha && fecha <= ultimaFecha) continue;

      // Cruzar con facturas
      const facturaMatch = cruzarConFacturas({ importe, fecha }, facturas);

      const mov = {
        id: Date.now() + i,
        concepto,
        fecha: fecha.toISOString(),
        fecha_display: fechaRaw,
        importe,
        estado: facturaMatch ? 'conciliado' : 'pendiente',
        conciliado: !!facturaMatch,
        factura_id: facturaMatch ? facturaMatch.id : null,
        factura_nombre: facturaMatch ? facturaMatch.nombre : null,
        factura_total: facturaMatch ? facturaMatch.total : null,
        manual: false
      };
      nuevosMovimientos.push(mov);
      if (!maxFecha || fecha > maxFecha) maxFecha = fecha;
    }

    // Añadir nuevos movimientos al histórico
    banco.movimientos = banco.movimientos.concat(nuevosMovimientos);
    banco.ultima_fecha = maxFecha ? maxFecha.toISOString() : banco.ultima_fecha;
    banco.ultima_importacion = new Date().toISOString();
    saveBanco(empresaId, banco);

    res.json({
      ok: true,
      nuevos: nuevosMovimientos.length,
      conciliados: nuevosMovimientos.filter(m => m.conciliado).length,
      sin_cruzar: nuevosMovimientos.filter(m => !m.conciliado).length,
      ultima_fecha: banco.ultima_fecha ? fechaStr(new Date(banco.ultima_fecha)) : null
    });
  } catch(e) {
    console.error('Error subiendo extracto:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /banco/movimientos — lista movimientos
router.get('/movimientos', auth, (req, res) => {
  const empresaId = req.empresaId;
  const banco = getBanco(empresaId);
  const ultima = banco.ultima_fecha ? fechaStr(new Date(banco.ultima_fecha)) : null;
  res.json({
    movimientos: banco.movimientos || [],
    ultima_fecha: ultima,
    ultima_importacion: banco.ultima_importacion || null
  });
});


// POST /banco/actualizar-movimiento — actualiza estado de un movimiento
router.post('/actualizar-movimiento', auth, (req, res) => {
  const { movimiento_id, estado, factura_id, factura_nombre, factura_total, motivo } = req.body;
  if (!movimiento_id) return res.status(400).json({ error: 'Falta movimiento_id' });
  const empresaId = req.empresaId;
  const banco = getBanco(empresaId);
  const idx = banco.movimientos.findIndex(function(m) { return m.id === parseInt(movimiento_id); });
  if (idx === -1) return res.status(404).json({ error: 'Movimiento no encontrado' });
  banco.movimientos[idx].estado = estado || 'pendiente';
  banco.movimientos[idx].factura_id = factura_id || null;
  banco.movimientos[idx].factura_nombre = factura_nombre || null;
  banco.movimientos[idx].factura_total = factura_total || null;
  banco.movimientos[idx].motivo = motivo || null;
  banco.movimientos[idx].conciliado = estado === 'conciliado';
  saveBanco(empresaId, banco);
  res.json({ ok: true });
});

// POST /banco/conciliar-manual — conciliar manualmente un movimiento con una factura
router.post('/conciliar-manual', auth, (req, res) => {
  const { movimiento_id, factura_id } = req.body;
  if (!movimiento_id || !factura_id) return res.status(400).json({ error: 'Faltan datos' });
  const empresaId = req.empresaId;
  const banco = getBanco(empresaId);
  const facturas = getFacturas(empresaId);
  const factura = facturas.find(f => f.id === parseInt(factura_id));
  const idx = banco.movimientos.findIndex(m => m.id === parseInt(movimiento_id));
  if (idx === -1) return res.status(404).json({ error: 'Movimiento no encontrado' });
  banco.movimientos[idx].conciliado = true;
  banco.movimientos[idx].factura_id = factura ? factura.id : null;
  banco.movimientos[idx].factura_nombre = factura ? factura.nombre : null;
  banco.movimientos[idx].factura_total = factura ? factura.total : null;
  banco.movimientos[idx].manual = true;
  saveBanco(empresaId, banco);
  res.json({ ok: true });
});


// POST /banco/reconciliar — re-cruza solo los movimientos pendientes
router.post('/reconciliar', auth, (req, res) => {
  try {
    const empresaId = req.empresaId;
    const banco = getBanco(empresaId);
    const facturas = getFacturas(empresaId);
    let actualizados = 0;
    banco.movimientos.forEach(function(m) {
      if (m.estado && m.estado !== 'pendiente') return; // no tocar los ya procesados
      const fecha = new Date(m.fecha);
      const match = cruzarConFacturas({ importe: m.importe, fecha }, facturas);
      if (match) {
        m.estado = 'conciliado';
        m.conciliado = true;
        m.factura_id = match.id;
        m.factura_nombre = match.nombre;
        m.factura_total = match.total;
        actualizados++;
      }
    });
    saveBanco(empresaId, banco);
    res.json({ ok: true, actualizados });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /banco/resetear — borra todo el historial bancario
router.post('/resetear', auth, (req, res) => {
  const empresaId = req.empresaId;
  saveBanco(empresaId, { movimientos: [], ultima_fecha: null });
  res.json({ ok: true });
});

module.exports = router;
