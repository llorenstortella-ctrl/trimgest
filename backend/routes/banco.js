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
function cruzarConFacturas(movimiento, facturas, idsAsignados) {
  const imp = Math.abs(movimiento.importe);
  const fecha = new Date(movimiento.fecha);
  const asignados = idsAsignados || [];
  const candidatos = facturas.filter(function(f) {
    const totalF = Math.abs(parseFloat(f.total));
    return Math.abs(totalF - imp) <= 0.02 && !asignados.includes(f.id);
  });
  if (candidatos.length === 0) return null;
  if (candidatos.length === 1) return candidatos[0];
  // Ordenar por proximidad de fecha al movimiento bancario
  candidatos.sort(function(a, b) {
    var da = Math.abs(new Date(a.fecha) - fecha);
    var db = Math.abs(new Date(b.fecha) - fecha);
    return da - db;
  });
  return candidatos[0];
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
      const idsYaAsignados = nuevosMovimientos.filter(m => m.factura_id).map(m => m.factura_id).concat(banco.movimientos.filter(m => m.factura_id).map(m => m.factura_id));
      const facturaMatch = cruzarConFacturas({ importe, fecha }, facturas, idsYaAsignados);

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
  const { movimiento_id, estado, factura_id, factura_nombre, factura_total, motivo, nomina_id } = req.body;
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
  banco.movimientos[idx].nomina_id = nomina_id || null;
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
      const idsYaConciliados = banco.movimientos.filter(function(x) { return x.factura_id && x.id !== m.id; }).map(function(x) { return x.factura_id; });
      const match = cruzarConFacturas({ importe: m.importe, fecha }, facturas, idsYaConciliados);
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


// POST /banco/asignar — asignar importe parcial de un movimiento a una factura
router.post('/asignar', auth, (req, res) => {
  const { movimiento_id, factura_id, importe } = req.body;
  if (!movimiento_id || !factura_id || !importe) return res.status(400).json({ error: 'Faltan datos' });
  const empresaId = req.empresaId;
  const banco = getBanco(empresaId);
  const facturas = getFacturas(empresaId);
  const idx = banco.movimientos.findIndex(m => m.id === parseInt(movimiento_id));
  if (idx === -1) return res.status(404).json({ error: 'Movimiento no encontrado' });
  const factura = facturas.find(f => f.id === parseInt(factura_id));
  if (!factura) return res.status(404).json({ error: 'Factura no encontrada' });
  const mov = banco.movimientos[idx];
  if (!mov.asignaciones) mov.asignaciones = [];
  // Verificar que no se asigne más del importe disponible
  const yaAsignado = mov.asignaciones.reduce((s, a) => s + Math.abs(a.importe), 0);
  const disponible = Math.abs(mov.importe) - yaAsignado;
  const importeAsignar = Math.abs(parseFloat(importe));
  if (importeAsignar > disponible + 0.01) return res.status(400).json({ error: 'Importe supera el disponible del movimiento' });
  mov.asignaciones.push({ factura_id: parseInt(factura_id), factura_nombre: factura.nombre, factura_total: factura.total, importe: importeAsignar });
  // Calcular saldo pendiente de la factura
  const pagadoBanco = banco.movimientos.reduce((s, m) => {
    return s + (m.asignaciones || []).filter(a => a.factura_id === parseInt(factura_id)).reduce((ss, a) => ss + a.importe, 0);
  }, 0);
  const pagadoEfectivo = factura.pago_efectivo || 0;
  const totalPagado = pagadoBanco + pagadoEfectivo;
  // Estado movimiento
  const totalDisponible = Math.abs(mov.importe);
  const totalAsignadoMov = mov.asignaciones.reduce((s, a) => s + a.importe, 0);
  mov.estado = totalAsignadoMov >= totalDisponible - 0.01 ? 'conciliado' : 'parcial';
  mov.conciliado = mov.estado === 'conciliado';
  // Mantener compatibilidad con sistema anterior
  mov.factura_id = mov.asignaciones.length === 1 ? mov.asignaciones[0].factura_id : null;
  mov.factura_nombre = mov.asignaciones.length === 1 ? mov.asignaciones[0].factura_nombre : 'Múltiples facturas';
  mov.factura_total = mov.asignaciones.length === 1 ? mov.asignaciones[0].factura_total : null;
  saveBanco(empresaId, banco);
  res.json({ ok: true, pagado_total: totalPagado, pendiente: Math.max(0, factura.total - totalPagado) });
});

// POST /banco/borrar-asignacion — borrar una asignacion de un movimiento
router.post('/borrar-asignacion', auth, (req, res) => {
  const { movimiento_id, asignacion_idx } = req.body;
  if (movimiento_id === undefined || asignacion_idx === undefined) return res.status(400).json({ error: 'Faltan datos' });
  const empresaId = req.empresaId;
  const banco = getBanco(empresaId);
  const idx = banco.movimientos.findIndex(m => m.id === parseInt(movimiento_id));
  if (idx === -1) return res.status(404).json({ error: 'Movimiento no encontrado' });
  const mov = banco.movimientos[idx];
  if (!mov.asignaciones || asignacion_idx >= mov.asignaciones.length) return res.status(400).json({ error: 'Asignacion no encontrada' });
  mov.asignaciones.splice(asignacion_idx, 1);
  if (mov.asignaciones.length === 0) {
    mov.estado = 'pendiente';
    mov.conciliado = false;
    mov.factura_id = null;
    mov.factura_nombre = null;
    mov.factura_total = null;
  } else {
    mov.factura_id = mov.asignaciones.length === 1 ? mov.asignaciones[0].factura_id : null;
    mov.factura_nombre = mov.asignaciones.length === 1 ? mov.asignaciones[0].factura_nombre : 'Multiples facturas';
    var totalAsig = mov.asignaciones.reduce(function(s,a){return s+a.importe;},0);
    mov.estado = totalAsig >= Math.abs(mov.importe) - 0.01 ? 'conciliado' : 'parcial';
    mov.conciliado = mov.estado === 'conciliado';
  }
  saveBanco(empresaId, banco);
  res.json({ ok: true });
});

// GET /banco/extracto-pdf — PDF extracto por cliente/proveedor
router.get('/extracto-pdf', auth, (req, res) => {
  try {
    const empresaId = req.empresaId;
    const nombre = req.query.nombre || '';
    const banco = getBanco(empresaId);
    const facturas = getFacturas(empresaId);
    const saldos = {};
    facturas.forEach(f => {
      const pagadoBanco = banco.movimientos.reduce((s, m) => {
        return s + (m.asignaciones || []).filter(a => a.factura_id === f.id).reduce((ss, a) => ss + a.importe, 0)
          + (m.factura_id === f.id && (!m.asignaciones || m.asignaciones.length === 0) ? Math.abs(m.importe) : 0);
      }, 0);
      const pagadoEfectivo = f.pago_efectivo || 0;
      const totalPagado = pagadoBanco + pagadoEfectivo;
      saldos[f.id] = { pagado: totalPagado, pendiente: Math.max(0, Math.abs(f.total) - totalPagado) };
    });
    const lista = facturas.filter(f => (f.nombre || f.cliente || '').trim() === nombre.trim());
    if (lista.length === 0) return res.status(404).json({ error: 'Sin facturas para este cliente' });
    const totalFacturado = lista.reduce((s, f) => s + Math.abs(f.total), 0);
    const totalPagado = lista.reduce((s, f) => s + (saldos[f.id] ? saldos[f.id].pagado : 0), 0);
    const totalPendiente = Math.max(0, totalFacturado - totalPagado);
    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Extracto-' + nombre.substring(0,20).replace(/[^a-zA-Z0-9]/g,'-') + '.pdf"');
    doc.pipe(res);
    doc.fontSize(18).fillColor('#1a1a1a').text('Extracto: ' + nombre);
    doc.fontSize(11).fillColor('#666').text('Generado por TrimGest · ' + new Date().toLocaleDateString('es-ES'));
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);
    lista.forEach(function(f) {
      if (doc.y > 700) doc.addPage();
      var s = saldos[f.id] || { pagado: 0, pendiente: Math.abs(f.total) };
      doc.fontSize(11).fillColor('#1a1a1a').text((f.numero_factura || '-') + '  |  ' + (f.fecha || '-'));
      doc.fontSize(10).fillColor('#444').text('Total: ' + Number(f.total).toFixed(2) + ' EUR  |  Pagado: ' + s.pagado.toFixed(2) + ' EUR  |  Pendiente: ' + s.pendiente.toFixed(2) + ' EUR');
      doc.moveDown(0.3);
      doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#eeeeee').stroke();
      doc.moveDown(0.3);
    });
    doc.moveDown(0.5);
    doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#cccccc').stroke();
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#1a1a1a').text('Total facturado: ' + totalFacturado.toFixed(2) + ' EUR', { align: 'right' });
    doc.fontSize(12).fillColor('#2a7a2a').text('Total pagado: ' + totalPagado.toFixed(2) + ' EUR', { align: 'right' });
    doc.fontSize(12).fillColor('#c06060').text('Total pendiente: ' + totalPendiente.toFixed(2) + ' EUR', { align: 'right' });
    doc.end();
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// POST /banco/pago-efectivo — registrar pago en efectivo en una factura
router.post('/pago-efectivo', auth, (req, res) => {
  const { factura_id, importe } = req.body;
  if (!factura_id || !importe) return res.status(400).json({ error: 'Faltan datos' });
  const empresaId = req.empresaId;
  const p = require('path').join(baseDataDir, 'empresas', empresaId, 'facturas.json');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'Sin facturas' });
  const facturas = JSON.parse(fs.readFileSync(p));
  const idx = facturas.findIndex(f => f.id === parseInt(factura_id));
  if (idx === -1) return res.status(404).json({ error: 'Factura no encontrada' });
  facturas[idx].pago_efectivo = (facturas[idx].pago_efectivo || 0) + Math.abs(parseFloat(importe));
  fs.writeFileSync(p, JSON.stringify(facturas, null, 2));
  res.json({ ok: true, pago_efectivo: facturas[idx].pago_efectivo });
});

// GET /banco/saldos — devuelve saldo pendiente de todas las facturas
router.get('/saldos', auth, (req, res) => {
  const empresaId = req.empresaId;
  const banco = getBanco(empresaId);
  const facturas = getFacturas(empresaId);
  const saldos = {};
  facturas.forEach(f => {
    const pagadoBanco = banco.movimientos.reduce((s, m) => {
      return s + (m.asignaciones || []).filter(a => a.factura_id === f.id).reduce((ss, a) => ss + a.importe, 0)
        + (m.factura_id === f.id && (!m.asignaciones || m.asignaciones.length === 0) ? Math.abs(m.importe) : 0);
    }, 0);
    const pagadoEfectivo = f.pago_efectivo || 0;
    const totalPagado = pagadoBanco + pagadoEfectivo;
    saldos[f.id] = { pagado: totalPagado, pendiente: Math.max(0, Math.abs(f.total) - totalPagado), total: Math.abs(f.total) };
  });
  res.json({ ok: true, saldos });
});

module.exports = router;
