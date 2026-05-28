const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');
const pdfParse = require('pdf-parse');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const auth = require('../middleware/auth');
const baseDataDir = path.join(__dirname, '../data');

function getEmpresaDirs(empresaId) {
  const empresaDir = path.join(baseDataDir, 'empresas', empresaId);
  if (!fs.existsSync(empresaDir)) fs.mkdirSync(empresaDir, { recursive: true });
  const uploadsDir = path.join(empresaDir, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  const dbPath = path.join(empresaDir, 'nominas.json');
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify([]));
  return { uploadsDir, dbPath };
}

function getNominas(empresaId) {
  const { dbPath } = getEmpresaDirs(empresaId);
  return JSON.parse(fs.readFileSync(dbPath));
}

function saveNominas(nominas, empresaId) {
  const { dbPath } = getEmpresaDirs(empresaId);
  fs.writeFileSync(dbPath, JSON.stringify(nominas, null, 2));
}

const upload = multer({ storage: multer.memoryStorage() });

function similitud(texto1, texto2) {
  const palabras1 = texto1.toLowerCase().split(/\s+/).filter(p => p.length > 3);
  const palabras2 = new Set(texto2.toLowerCase().split(/\s+/).filter(p => p.length > 3));
  if (!palabras1.length) return 0;
  const coinciden = palabras1.filter(p => palabras2.has(p)).length;
  return coinciden / palabras1.length;
}

async function detectarDuplicadoPaginas(fileBuffer) {
  try {
    const pdfLib = require('pdf-lib');
    const pdfDoc = await pdfLib.PDFDocument.load(fileBuffer);
    const numPaginas = pdfDoc.getPageCount();
    if (numPaginas < 2) return { duplicado: false, numPaginas };
    const pdfParse = require('pdf-parse');
    const textosPaginas = [];
    for (let i = 0; i < Math.min(numPaginas, 4); i++) {
      const pdfDocTemp = await pdfLib.PDFDocument.load(fileBuffer);
      const pagina = await pdfLib.PDFDocument.create();
      const [paginaCopied] = await pagina.copyPages(pdfDocTemp, [i]);
      pagina.addPage(paginaCopied);
      const paginaBytes = await pagina.save();
      const parsed = await pdfParse(Buffer.from(paginaBytes));
      textosPaginas.push(parsed.text);
    }
    for (let i = 0; i < textosPaginas.length - 1; i++) {
      for (let j = i + 1; j < textosPaginas.length; j++) {
        const sim = similitud(textosPaginas[i], textosPaginas[j]);
        if (sim > 0.75) return { duplicado: true, numPaginas, paginaDuplicada: j + 1, similitudDetectada: Math.round(sim * 100) };
      }
    }
    return { duplicado: false, numPaginas };
  } catch(e) {
    return { duplicado: false, numPaginas: 1 };
  }
}


router.post('/subir', auth, upload.single('nomina'), async (req, res) => {
  try {
    const fileBuffer = req.file.buffer;
    const pdfData = await pdfParse(fileBuffer);
    const textoNomina = pdfData.text;

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'Eres un experto en nominas espanolas. Extraes datos de nominas y devuelves solo JSON valido. IMPORTANTE: Para trabajadores mayores de 65 anos con contrato indefinido y al menos 38 anos y 6 meses cotizados (o mayores de 67 anos con 37 anos cotizados), la empresa tiene reduccion del 100% en cuota empresarial por contingencias comunes segun art. 152 LGSS. En estos casos la ss_empresa real es mucho menor de lo que indica la nomina en el apartado teorico, porque la bonificacion ya esta aplicada en el TC1. Extrae siempre los datos literales del documento sin recalcular.'
        },
        {
          role: 'user',
          content: `Eres un experto en nominas espanolas. Extrae los datos de esta nomina con maxima precision y devuelve SOLO el JSON, sin texto adicional ni markdown.

INSTRUCCIONES IMPORTANTES:
- "neto" = liquido a percibir (lo que cobra el trabajador)
- "devengado" = total devengado (suma de todos los conceptos positivos)
- "deducciones" = total deducciones (suma de IRPF + SS trabajador + otras deducciones)
- "irpf_importe" = importe en EUROS descontado por IRPF este mes. Busca el valor numerico en la columna DEDUCCION junto a la linea IRPF. NUNCA uses el porcentaje acumulado como importe.
- "irpf_porcentaje" = porcentaje de retencion IRPF. En la linea BASE IRPF del PDF aparece: base, importe retenido y porcentaje. Extrae el porcentaje directamente.
- "ss_trabajador" = cuota SS que paga el TRABAJADOR (contingencias comunes + desempleo + FP del trabajador)
- "ss_empresa" = cuota SS que paga la EMPRESA (contingencias comunes empresa + AT/EP + desempleo empresa + FP empresa + FOGASA)
- "coste_empresa" = devengado + ss_empresa (coste total para la empresa)

{
  "trabajador": "nombre completo del trabajador",
  "mes": "nombre del mes en minusculas (enero, febrero...)",
  "anno": numero_del_anno,
  "devengado": numero,
  "deducciones": numero,
  "neto": numero,
  "irpf_importe": numero,
  "irpf_porcentaje": numero,
  "ss_trabajador": numero,
  "ss_empresa": numero,
  "coste_empresa": numero
}

TEXTO DE LA NOMINA:
${textoNomina}`
        }
      ],
      max_tokens: 500
    });

    let texto = response.choices[0].message.content.trim();
    texto = texto.replace(/```json|```/g, '').trim();
    const datos = JSON.parse(texto);

    const { uploadsDir: empUploads } = getEmpresaDirs(req.empresaId);
    const filename = Date.now() + '-nomina.pdf';
    const filepath = path.join(empUploads, filename);
    fs.writeFileSync(filepath, fileBuffer);

    const infoDuplicado = await detectarDuplicadoPaginas(fileBuffer);
    const nominas = getNominas(req.empresaId);
    const nueva = {
      id: Date.now(),
      ...datos,
      archivo: filename,
      fecha_subida: new Date().toISOString(),
      duplicado_detectado: infoDuplicado.duplicado,
      num_paginas: infoDuplicado.numPaginas,
      pagina_duplicada: infoDuplicado.paginaDuplicada || null
    };
    nominas.push(nueva);
    saveNominas(nominas, req.empresaId);

    res.json({ nomina: nueva });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error procesando nomina' });
  }
});

router.get('/listar', auth, (req, res) => {
  res.json({ nominas: getNominas(req.empresaId) });
});

router.put('/editar/:id', auth, (req, res) => {
  const nominas = getNominas(req.empresaId);
  const idx = nominas.findIndex(n => n.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'No encontrada' });
  const { trabajador, mes, anno, devengado, deducciones, neto, irpf_importe, irpf_porcentaje, ss_trabajador, ss_empresa, coste_empresa } = req.body;
  if (trabajador !== undefined) nominas[idx].trabajador = trabajador;
  if (mes !== undefined) nominas[idx].mes = mes;
  if (anno !== undefined) nominas[idx].anno = anno;
  if (devengado !== undefined) nominas[idx].devengado = parseFloat(devengado);
  if (deducciones !== undefined) nominas[idx].deducciones = parseFloat(deducciones);
  if (neto !== undefined) nominas[idx].neto = parseFloat(neto);
  if (irpf_importe !== undefined) nominas[idx].irpf_importe = parseFloat(irpf_importe);
  if (irpf_porcentaje !== undefined) nominas[idx].irpf_porcentaje = parseFloat(irpf_porcentaje);
  if (ss_trabajador !== undefined) nominas[idx].ss_trabajador = parseFloat(ss_trabajador);
  if (ss_empresa !== undefined) nominas[idx].ss_empresa = parseFloat(ss_empresa);
  if (coste_empresa !== undefined) nominas[idx].coste_empresa = parseFloat(coste_empresa);
  saveNominas(nominas, req.empresaId);
  res.json({ ok: true, nomina: nominas[idx] });
});

router.delete('/borrar/:id', auth, (req, res) => {
  const nominas = getNominas(req.empresaId);
  const idx = nominas.findIndex(n => n.id === parseInt(req.params.id));
  if (idx !== -1) {
    const archivo = nominas[idx].archivo;
    nominas.splice(idx, 1);
    saveNominas(nominas, req.empresaId);
    try { fs.unlinkSync(path.join(uploadsDir, archivo)); } catch(e) {}
  }
  res.json({ ok: true });
});

router.post('/eliminar-pagina/:id', auth, async (req, res) => {
  try {
    const pagina = parseInt(req.body.pagina);
    console.log('ELIMINAR PAGINA body:', JSON.stringify(req.body), 'pagina:', pagina);
    const nominas = getNominas(req.empresaId);
    const idx = nominas.findIndex(n => n.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Nomina no encontrada' });
    if (!pagina || pagina < 1) return res.status(400).json({ error: 'Pagina invalida' });
    const { uploadsDir } = getEmpresaDirs(req.empresaId);
    const filepath = path.join(uploadsDir, nominas[idx].archivo);
    if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'PDF no encontrado' });
    const fileBuffer = fs.readFileSync(filepath);
    const { PDFDocument } = require('pdf-lib');
    const pdfDoc = await PDFDocument.load(fileBuffer);
    if (pagina > pdfDoc.getPageCount()) return res.status(400).json({ error: 'Pagina no existe en el PDF' });
    pdfDoc.removePage(pagina - 1);
    const pdfBytes = await pdfDoc.save();
    fs.writeFileSync(filepath, pdfBytes);
    nominas[idx].duplicado_detectado = false;
    nominas[idx].num_paginas = pdfDoc.getPageCount();
    nominas[idx].pagina_duplicada = null;
    saveNominas(nominas, req.empresaId);
    res.json({ ok: true });
  } catch(e) {
    console.error('ERROR ELIMINAR PAGINA:', e.message, e.stack);
    res.status(500).json({ error: 'Error eliminando pagina: ' + e.message });
  }
});

router.post('/conservar/:id', auth, (req, res) => {
  try {
    const nominas = getNominas(req.empresaId);
    const idx = nominas.findIndex(n => n.id === parseInt(req.params.id));
    if (idx === -1) return res.status(404).json({ error: 'Nomina no encontrada' });
    nominas[idx].duplicado_detectado = false;
    saveNominas(nominas, req.empresaId);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: 'Error' });
  }
});

module.exports = router;

router.get('/archivo/:filename', auth, (req, res) => {
  const { uploadsDir } = getEmpresaDirs(req.empresaId);
  const filePath = require('path').join(uploadsDir, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(filePath);
});

