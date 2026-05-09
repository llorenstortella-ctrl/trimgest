const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const uploadsDir = path.join(__dirname, '../uploads');
const pygPath = process.env.DATA_PATH
  ? path.join(path.dirname(process.env.DATA_PATH), 'pyg.json')
  : path.join(__dirname, '../data/pyg.json');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/subir', upload.single('pyg'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se ha subido ningún archivo' });

  try {
    const pdfData = await pdfParse(req.file.buffer);
    const texto = pdfData.text;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'Eres un experto contable español. Extrae los datos de una Cuenta de Pérdidas y Ganancias de Pymes y devuelve SOLO un JSON.'
        },
        {
          role: 'user',
          content: `Extrae los datos de esta P&G y devuelve SOLO este JSON sin texto adicional:
{
  "anno": número del año del ejercicio,
  "ingresos_netos": número,
  "aprovisionamientos": número,
  "gastos_personal": número,
  "otros_gastos_explotacion": número,
  "amortizacion": número,
  "resultado_explotacion": número,
  "resultado_financiero": número,
  "resultado_antes_impuestos": número,
  "impuestos": número,
  "resultado_ejercicio": número
}

TEXTO DE LA P&G:
${texto}`
        }
      ],
      max_tokens: 500
    });

    const texto_resp = response.choices[0].message.content;
    const clean = texto_resp.replace(/\`\`\`json|\`\`\`/g, '').trim();
    const datos = JSON.parse(clean);

    fs.writeFileSync(pygPath, JSON.stringify(datos, null, 2));
    res.json({ ok: true, datos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error procesando el PDF' });
  }
});

router.get('/datos', (req, res) => {
  if (!fs.existsSync(pygPath)) {
    return res.json({ datos: null });
  }
  res.json({ datos: JSON.parse(fs.readFileSync(pygPath)) });
});

module.exports = router;