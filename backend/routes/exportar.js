const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const dbPath = process.env.DATA_PATH || path.join(__dirname, '../data/facturas.json');
const getFacturas = () => JSON.parse(fs.readFileSync(dbPath));

router.get('/:tipo/:trimestre/:anno', (req, res) => {
  try {
    const { tipo, trimestre, anno } = req.params;
    const facturas = getFacturas();
    const lista = facturas.filter(function(f) {
      return f.tipo === tipo && f.trimestre === trimestre && String(f.anno) === String(anno);
    });

    const datos = lista.map(function(f) {
      return {
        'Nombre': f.nombre,
        'N° Factura': f.numero_factura,
        'Fecha': f.fecha,
        'Base Imponible': Number(f.base_imponible),
        'IVA %': f.iva_porcentaje,
        'IVA Importe': Number(f.iva_importe),
        'Total': Number(f.total),
        'Trimestre': f.trimestre,
        'Año': f.anno,
        'Estado': f.enviado ? 'Enviada' : 'Pendiente'
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(datos);

    ws['!cols'] = [
      { wch: 30 }, { wch: 15 }, { wch: 12 },
      { wch: 15 }, { wch: 8 }, { wch: 15 },
      { wch: 15 }, { wch: 10 }, { wch: 8 }, { wch: 12 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, tipo === 'proveedor' ? 'Proveedores' : 'Clientes');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = 'TrimGest-' + tipo + '-' + trimestre + '-' + anno + '.xlsx';

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=' + filename);
    res.send(buffer);
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error exportando' });
  }
});

module.exports = router;
