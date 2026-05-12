const OpenAI = require('openai');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const path = require('path');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const MI_EMPRESA = 'FEIM CA TEVA';

const PROMPT_SISTEMA = `Eres un experto contable español. Analizas facturas de la empresa "${MI_EMPRESA}".

REGLAS ABSOLUTAS:
1. Busca en el texto qué empresa NO es "${MI_EMPRESA}" — esa es la otra parte
2. Si "${MI_EMPRESA}" paga la factura → tipo: "proveedor", nombre: la empresa que cobra
3. Si "${MI_EMPRESA}" cobra la factura → tipo: "cliente", nombre: la empresa que paga
4. El nombre NUNCA puede ser "${MI_EMPRESA}" ni nada parecido
5. Las fechas de 2024 son válidas, no las marques como anomalía
6. Solo marca anomalías si hay errores reales en importes o IVA
7. Si no hay anomalías devuelve null sin comillas`;

const PROMPT_USUARIO = `Analiza esta factura y devuelve SOLO este JSON sin texto adicional:
{
  "tipo": "proveedor" o "cliente",
  "nombre": "nombre de la empresa que NO es ${MI_EMPRESA}",
  "numero_factura": "número",
  "fecha": "DD/MM/YYYY",
  "base_imponible": número,
  "iva_porcentaje": número,
  "iva_importe": número,
  "total": número,
  "anomalias": null
}`;

function limpiarDatos(datos) {
  if (datos.nombre && datos.nombre.toUpperCase().includes(MI_EMPRESA.toUpperCase())) {
    datos.tipo = datos.tipo === 'proveedor' ? 'cliente' : 'proveedor';
  }
  if (!datos.anomalias || datos.anomalias === 'null' || datos.anomalias === '') {
    datos.anomalias = null;
  }
  return datos;
}

async function extraerDatosFactura(rutaArchivo) {
  const ext = path.extname(rutaArchivo).toLowerCase();
  const esImagen = ['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext);

  if (esImagen) {
    return await extraerDatosImagen(rutaArchivo);
  } else {
    return await extraerDatosPDF(rutaArchivo);
  }
}

async function extraerDatosPDF(rutaPDF) {
  const dataBuffer = fs.readFileSync(rutaPDF);
  const pdfData = await pdfParse(dataBuffer);
  const textoFactura = pdfData.text;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: PROMPT_SISTEMA },
      { role: 'user', content: PROMPT_USUARIO + '\n\nTEXTO:\n' + textoFactura }
    ],
    max_tokens: 500
  });

  const texto = response.choices[0].message.content;
  const clean = texto.replace(/```json|```/g, '').trim();
  const datos = JSON.parse(clean);
  return limpiarDatos(datos);
}

async function extraerDatosImagen(rutaImagen) {
  const imageBuffer = fs.readFileSync(rutaImagen);
  const base64 = imageBuffer.toString('base64');
  const ext = path.extname(rutaImagen).toLowerCase();
  const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
  const mimeType = mimeTypes[ext] || 'image/jpeg';

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: PROMPT_SISTEMA },
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT_USUARIO },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
        ]
      }
    ],
    max_tokens: 500
  });

  const texto = response.choices[0].message.content;
  const clean = texto.replace(/```json|```/g, '').trim();
  const datos = JSON.parse(clean);
  return limpiarDatos(datos);
}

module.exports = { extraerDatosFactura };