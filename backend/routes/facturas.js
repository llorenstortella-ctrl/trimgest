const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const Jimp = require('jimp');
const { extraerDatosFactura, extraerMultiplesFacturas } = require('../services/openai');
const auth = require('../middleware/auth');
const baseDataDir = path.join(__dirname, '../data');

function getEmpresaDirs(empresaId) {
  const empresaDir = path.join(baseDataDir, 'empresas', empresaId);
  if (!fs.existsSync(empresaDir)) fs.mkdirSync(empresaDir, { recursive: true });
  const uploadsDir = path.join(empresaDir, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const dbPath = path.join(empresaDir, 'facturas.json');
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify([]));
  return { uploadsDir, dbPath };
}

function getFacturas(empresaId) {
  const { dbPath } = getEmpresaDirs(empresaId);
  return JSON.parse(fs.readFileSync(dbPath));
}

function saveFacturas(facturas, empresaId) {
  const { dbPath } = getEmpresaDirs(empresaId);
  fs.writeFileSync(dbPath, JSON.stringify(facturas, null, 2));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const empresaId = req.empresaId || req.query.empresaId || 'default';
    const { uploadsDir } = getEmpresaDirs(empresaId);
    cb(null, uploadsDir);
  },
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

async function convertirImagenAPDF(rutaImagen, uploadsDir) {
  return new Promise(async (resolve, reject) => {
    try {
      const imagen = await Jimp.read(rutaImagen);
      
      // Mejorar imagen: aumentar contraste y brillo para que parezca escaneado
      imagen
        .greyscale()
        .normalize()
        .contrast(0.3)
        .brightness(0.1);

      // Tamaño A4 en puntos (595 x 842)
      const A4_ANCHO = 595;
      const A4_ALTO = 842;
      const MARGEN = 30;
      const ANCHO_UTIL = A4_ANCHO - (MARGEN * 2);
      const ALTO_UTIL = A4_ALTO - (MARGEN * 2);

      // Escalar imagen para que quepa en A4 manteniendo proporcion
      const anchoOriginal = imagen.getWidth();
      const altoOriginal = imagen.getHeight();
      const ratio = Math.min(ANCHO_UTIL / anchoOriginal, ALTO_UTIL / altoOriginal);
      const anchoFinal = Math.floor(anchoOriginal * ratio);
      const altoFinal = Math.floor(altoOriginal * ratio);

      imagen.resize(anchoFinal, altoFinal);

      // Guardar imagen procesada temporalmente
      const rutaTemp = rutaImagen + '_proc.jpg';
      await imagen.quality(90).writeAsync(rutaTemp);

      const doc = new PDFDocument({ autoFirstPage: false, size: 'A4', margin: 0 });
      const nombrePDF = path.basename(rutaImagen, path.extname(rutaImagen)) + '.pdf';
      const rutaPDF = path.join(uploadsDir, nombrePDF);
      const stream = fs.createWriteStream(rutaPDF);

      doc.pipe(stream);
      doc.addPage({ size: 'A4', margin: 0 });
      
      // Fondo blanco
      doc.rect(0, 0, A4_ANCHO, A4_ALTO).fill('white');
      
      // Centrar imagen en la página
      const x = (A4_ANCHO - anchoFinal) / 2;
      const y = (A4_ALTO - altoFinal) / 2;
      doc.image(rutaTemp, x, y, { width: anchoFinal, height: altoFinal });
      doc.end();

      stream.on('finish', () => {
        try { fs.unlinkSync(rutaImagen); } catch(e) {}
        try { fs.unlinkSync(rutaTemp); } catch(e) {}
        resolve({ rutaPDF, nombrePDF });
      });
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

router.post('/subir', auth, upload.single('factura'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se ha subido ningún archivo' });

  try {
    const usuariosPath = path.join(__dirname, '../data/usuarios.json');
    const usuarios = JSON.parse(fs.readFileSync(usuariosPath));
    const usuIdx = usuarios.findIndex(u => u.empresaId === req.empresaId);
    if (usuIdx !== -1) {
      const usu = usuarios[usuIdx];
      if (!usu.plan_gratuito) {
        const LIMITES = { free: 10, basico: 100, estandar: 200, gestoria: 999 };
        const limite = usu.plan_gratuito ? 99999 : (LIMITES[usu.plan] || 10);
        function getTrimestreFiscal() {
          const hoy = new Date();
          const mes = hoy.getMonth() + 1;
          const dia = hoy.getDate();
          const anyo = hoy.getFullYear();
          if (mes === 1 && dia <= 31) return 'T4-' + (anyo - 1);
          if (mes < 4 || (mes === 4 && dia <= 25)) return 'T1-' + anyo;
          if (mes < 7 || (mes === 7 && dia <= 25)) return 'T2-' + anyo;
          if (mes < 10 || (mes === 10 && dia <= 25)) return 'T3-' + anyo;
          return 'T4-' + anyo;
        }
        const trimestreActual = getTrimestreFiscal();
        if (usu.trimestre_fiscal !== trimestreActual) {
          usuarios[usuIdx].subidas_mes = 0;
          usuarios[usuIdx].trimestre_fiscal = trimestreActual;
        }
        const subidas = usuarios[usuIdx].subidas_mes || 0;
        if (subidas >= limite) {
          fs.unlinkSync(req.file.path);
          return res.status(403).json({ error: 'limite_alcanzado', limite: limite, subidas: subidas, plan_activo: usu.plan_activo || false });
        }
        usuarios[usuIdx].subidas_mes = subidas + 1;
        usuarios[usuIdx].trimestre_fiscal = trimestreActual;
        fs.writeFileSync(usuariosPath, JSON.stringify(usuarios, null, 2));
      }
    }

    let rutaArchivo = req.file.path;
    let nombreArchivo = req.file.filename;
    const ext = path.extname(req.file.originalname).toLowerCase();
    const esImagen = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);

    // Extraer datos
    const datos = await extraerDatosFactura(rutaArchivo);

    if (esImagen) {
      const { uploadsDir } = getEmpresaDirs(req.empresaId);
      const resultado = await convertirImagenAPDF(rutaArchivo, uploadsDir);
      rutaArchivo = resultado.rutaPDF;
      nombreArchivo = resultado.nombrePDF;
    }

    const tipoFinal = req.query.tipo_manual;
    if (!tipoFinal) return res.status(400).json({ error: 'Debes indicar el tipo de factura' });

    const facturas = getFacturas(req.empresaId);

    const duplicado = facturas.find(function(f) {
      return f.numero_factura === datos.numero_factura && f.nombre === datos.nombre;
    });

    if (duplicado) {
      fs.unlinkSync(rutaArchivo);
      return res.status(409).json({ error: 'duplicado', mensaje: 'Esta factura ya existe', factura: duplicado });
    }

    const nuevaFactura = {
      id: Date.now(),
      archivo: nombreArchivo,
      tipo: tipoFinal,
      nombre: datos.nombre,
      cif: datos.cif || null,
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
    saveFacturas(facturas, req.empresaId);
    res.json({ mensaje: 'Factura procesada correctamente', factura: nuevaFactura });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error al procesar la factura con IA' });
  }
});

router.get('/listar', auth, (req, res) => {
  res.json({ facturas: getFacturas(req.empresaId) });
});

router.put('/editar/:id', auth, (req, res) => {
  const facturas = getFacturas(req.empresaId);
  const idx = facturas.findIndex(f => f.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
  const { tipo, trimestre, anno, nombre, numero_factura, fecha, base_imponible, iva_porcentaje, iva_importe, total } = req.body;
  if (tipo) facturas[idx].tipo = tipo;
  if (trimestre) facturas[idx].trimestre = trimestre;
  if (anno) facturas[idx].anno = parseInt(anno);
  if (nombre) facturas[idx].nombre = nombre;
  if (req.body._toggleContabilizado) {
    facturas[idx].contabilizado = !facturas[idx].contabilizado;
    saveFacturas(facturas, req.empresaId);
    return res.json({ ok: true });
  }
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
  if (req.body.cif !== undefined) facturas[idx].cif = req.body.cif || null;
  saveFacturas(facturas, req.empresaId);
  res.json({ mensaje: 'Actualizada', factura: facturas[idx] });
});

router.delete('/borrar/:id', auth, (req, res) => {
  const facturas = getFacturas(req.empresaId);
  const idx = facturas.findIndex(f => f.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
  const archivo = facturas[idx].archivo;
  facturas.splice(idx, 1);
  saveFacturas(facturas, req.empresaId);
  const { uploadsDir } = getEmpresaDirs(req.empresaId);
  try { fs.unlinkSync(path.join(uploadsDir, archivo)); } catch(e) {}
  res.json({ mensaje: 'Factura borrada' });
});


router.get('/archivo/:filename', auth, (req, res) => {
  const { uploadsDir } = getEmpresaDirs(req.empresaId);
  const filePath = path.join(uploadsDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(filePath);
});

router.put('/marcar-enviado', auth, (req, res) => {
  const { ids } = req.body;
  if (!ids || !ids.length) return res.status(400).json({ error: 'Sin ids' });
  const facturas = getFacturas(req.empresaId);
  const ahora = new Date().toISOString();
  ids.forEach(function(id) {
    const idx = facturas.findIndex(f => f.id === id);
    if (idx !== -1) { facturas[idx].enviado = true; facturas[idx].fecha_envio = ahora; }
  });
  saveFacturas(facturas, req.empresaId);
  res.json({ mensaje: 'Marcadas como enviadas' });
});

router.post('/manual', auth, (req, res) => {
  const facturas = getFacturas(req.empresaId);
  const { tipo, nombre, cif, numero_factura, fecha, base_imponible, iva_porcentaje, iva_importe, total, trimestre, anno } = req.body;
  const nueva = { id: Date.now(), tipo, nombre, cif: cif || null, numero_factura, fecha, base_imponible, iva_porcentaje, iva_importe, total, trimestre, anno, archivo: null, enviado: false, fecha_subida: new Date().toISOString() };
  facturas.push(nueva);
  saveFacturas(facturas, req.empresaId);
  res.json({ factura: nueva });
});

module.exports = router;