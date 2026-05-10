const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const authMiddleware = require('../middleware/auth');
const baseDataDir = path.join(__dirname, '../data');

function formatEur(n) {
  return Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}

async function generarPDF(tipo, trimestre, anno, empresa, dbPath, uploadsDir) {
  const facturas = JSON.parse(require('fs').readFileSync(dbPath));
  const lista = facturas.filter(function(f) {
    return f.tipo === tipo && f.trimestre === trimestre && String(f.anno) === String(anno) && !f.enviado;
  });

  const pdfDoc = await PDFDocument.create();
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // PORTADA
  const portada = pdfDoc.addPage([595, 842]);
  const { width, height } = portada.getSize();

  portada.drawRectangle({ x: 0, y: height - 120, width, height: 120, color: rgb(0.06, 0.06, 0.1) });
  portada.drawText('TrimGest', { x: 40, y: height - 50, size: 28, font: helveticaBold, color: rgb(0.91, 0.78, 0.48) });
  portada.drawText(empresa, { x: 40, y: height - 80, size: 12, font: helvetica, color: rgb(0.8, 0.8, 0.8) });

  portada.drawText(tipo === 'proveedor' ? 'FACTURAS DE PROVEEDORES' : 'FACTURAS DE CLIENTES', {
    x: 40, y: height - 180, size: 20, font: helveticaBold, color: rgb(0.1, 0.1, 0.15)
  });
  portada.drawText(trimestre + ' · ' + anno, {
    x: 40, y: height - 210, size: 14, font: helvetica, color: rgb(0.4, 0.4, 0.5)
  });
  portada.drawText('Generado el ' + new Date().toLocaleDateString('es-ES'), {
    x: 40, y: height - 235, size: 10, font: helvetica, color: rgb(0.6, 0.6, 0.6)
  });

  // RESUMEN
  const resumen = pdfDoc.addPage([595, 842]);
  resumen.drawText('RESUMEN', { x: 40, y: height - 60, size: 16, font: helveticaBold, color: rgb(0.1, 0.1, 0.15) });

  // Cabecera tabla
  const cols = [40, 180, 280, 350, 420, 490];
  const headers = ['Proveedor/Cliente', 'N° Factura', 'Fecha', 'Base', 'IVA', 'Total'];
  let y = height - 100;

  resumen.drawRectangle({ x: 35, y: y - 5, width: width - 70, height: 20, color: rgb(0.06, 0.06, 0.1) });
  headers.forEach(function(h, i) {
    resumen.drawText(h, { x: cols[i], y, size: 8, font: helveticaBold, color: rgb(0.91, 0.78, 0.48) });
  });
  y -= 25;

  var totalBase = 0;
  var totalIVA = 0;
  var totalTotal = 0;

  for (var i = 0; i < lista.length; i++) {
    var f = lista[i];
    if (y < 80) {
      y = height - 60;
      const newPage = pdfDoc.addPage([595, 842]);
    }
    var rowColor = i % 2 === 0 ? rgb(0.97, 0.97, 0.98) : rgb(1, 1, 1);
    resumen.drawRectangle({ x: 35, y: y - 5, width: width - 70, height: 16, color: rowColor });

    var nombre = f.nombre.length > 22 ? f.nombre.substring(0, 22) + '...' : f.nombre;
    resumen.drawText(nombre, { x: cols[0], y, size: 7, font: helvetica, color: rgb(0.1, 0.1, 0.15) });
    resumen.drawText(String(f.numero_factura), { x: cols[1], y, size: 7, font: helvetica, color: rgb(0.1, 0.1, 0.15) });
    resumen.drawText(f.fecha, { x: cols[2], y, size: 7, font: helvetica, color: rgb(0.1, 0.1, 0.15) });
    resumen.drawText(formatEur(f.base_imponible), { x: cols[3], y, size: 7, font: helvetica, color: rgb(0.1, 0.1, 0.15) });
    resumen.drawText(formatEur(f.iva_importe), { x: cols[4], y, size: 7, font: helvetica, color: rgb(0.1, 0.1, 0.15) });
    resumen.drawText(formatEur(f.total), { x: cols[5], y, size: 7, font: helveticaBold, color: rgb(0.1, 0.1, 0.15) });

    totalBase += Number(f.base_imponible);
    totalIVA += Number(f.iva_importe);
    totalTotal += Number(f.total);
    y -= 18;
  }

  // Totales
  y -= 10;
  resumen.drawRectangle({ x: 35, y: y - 5, width: width - 70, height: 20, color: rgb(0.06, 0.06, 0.1) });
  resumen.drawText('TOTAL', { x: cols[0], y, size: 9, font: helveticaBold, color: rgb(0.91, 0.78, 0.48) });
  resumen.drawText(formatEur(totalBase), { x: cols[3], y, size: 9, font: helveticaBold, color: rgb(0.91, 0.78, 0.48) });
  resumen.drawText(formatEur(totalIVA), { x: cols[4], y, size: 9, font: helveticaBold, color: rgb(0.91, 0.78, 0.48) });
  resumen.drawText(formatEur(totalTotal), { x: cols[5], y, size: 9, font: helveticaBold, color: rgb(0.91, 0.78, 0.48) });

  // ADJUNTAR PDFs ORIGINALES
  for (var i = 0; i < lista.length; i++) {
    var f = lista[i];
    var archivoPath = path.join(uploadsDir, f.archivo);
    if (fs.existsSync(archivoPath)) {
      try {
        var facturaBytes = fs.readFileSync(archivoPath);
        var facturaPdf = await PDFDocument.load(facturaBytes);
        var pages = await pdfDoc.copyPages(facturaPdf, facturaPdf.getPageIndices());
        pages.forEach(function(page) { pdfDoc.addPage(page); });
      } catch(e) {
        console.log('No se pudo adjuntar:', f.archivo);
      }
    }
  }

  return await pdfDoc.save();
}

router.get('/pdf/:tipo/:trimestre/:anno', authMiddleware, async (req, res) => {
  try {
    const { tipo, trimestre, anno } = req.params;
    const usuariosPath = path.join(baseDataDir, 'usuarios.json');
    const usuarios = JSON.parse(fs.readFileSync(usuariosPath));
    const usuario = usuarios.find(u => u.empresaId === req.empresaId);
    const empresa = usuario ? usuario.nombre_empresa : 'Mi Empresa';
    const dbPath = path.join(baseDataDir, 'empresas', req.empresaId, 'facturas.json');
    const uploadsDir = path.join(baseDataDir, 'empresas', req.empresaId, 'uploads');
    const pdfBytes = await generarPDF(tipo, trimestre, anno, empresa, dbPath, uploadsDir);
    const filename = 'TrimGest-' + tipo + '-' + trimestre + '-' + anno + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=' + filename);
    res.send(Buffer.from(pdfBytes));
  } catch(error) {
    console.error(error);
    res.status(500).json({ error: 'Error generando PDF' });
  }
});

module.exports = router;