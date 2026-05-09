const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const pygPath = process.env.DATA_PATH
  ? path.join(path.dirname(process.env.DATA_PATH), 'pyg.json')
  : path.join(__dirname, '../data/pyg.json');

const upload = multer({ storage: multer.memoryStorage() });

router.post('/subir', upload.single('pyg'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se ha subido ningún archivo' });

  try {
    var messages;
    const isPDF = req.file.mimetype === 'application/pdf';

    if (isPDF) {
      const pdfData = await pdfParse(req.file.buffer);
      messages = [
        {
          role: 'system',
          content: 'Eres un experto contable español. Extrae los datos de una Cuenta de Pérdidas y Ganancias de Pymes. El documento tiene dos columnas de ejercicios. Devuelve SOLO un JSON.'
        },
        {
          role: 'user',
          content: `Extrae los datos de esta P&G con dos ejercicios. Devuelve SOLO este JSON:
{
  "ejercicio_actual": { "anno": número, "ingresos_netos": número, "gastos_personal": número, "otros_gastos_explotacion": número, "resultado_explotacion": número, "resultado_ejercicio": número },
  "ejercicio_anterior": { "anno": número o null, "ingresos_netos": número o null, "gastos_personal": número o null, "otros_gastos_explotacion": número o null, "resultado_explotacion": número o null, "resultado_ejercicio": número o null }
}

TEXTO: ${pdfData.text}`
        }
      ];
    } else {
      const base64 = req.file.buffer.toString('base64');
      const mimeType = req.file.mimetype;
      messages = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analiza esta imagen de una Cuenta de Pérdidas y Ganancias de Pymes española. Tiene dos columnas de ejercicios (años diferentes). Extrae los datos de AMBOS ejercicios y devuelve SOLO este JSON sin texto adicional:
{
  "ejercicio_actual": { "anno": número del año más reciente, "ingresos_netos": número, "gastos_personal": número, "otros_gastos_explotacion": número, "resultado_explotacion": número, "resultado_ejercicio": número },
  "ejercicio_anterior": { "anno": número del año anterior, "ingresos_netos": número, "gastos_personal": número, "otros_gastos_explotacion": número, "resultado_explotacion": número, "resultado_ejercicio": número }
}`
            },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64}` }
            }
          ]
        }
      ];
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      max_tokens: 800
    });

    const texto_resp = response.choices[0].message.content;
    const clean = texto_resp.replace(/```json|```/g, '').trim();
    const datos = JSON.parse(clean);

    fs.writeFileSync(pygPath, JSON.stringify(datos, null, 2));
    res.json({ ok: true, datos });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error procesando el archivo' });
  }
});

router.get('/datos', (req, res) => {
  if (!fs.existsSync(pygPath)) {
    return res.json({ datos: null });
  }
  res.json({ datos: JSON.parse(fs.readFileSync(pygPath)) });
});

module.exports = router;