const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const uploadsDir = path.join(__dirname, '../data/uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const dbPath = path.join(__dirname, '../data/nominas.json');
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify([]));

const getNominas = () => JSON.parse(fs.readFileSync(dbPath));
const saveNominas = (nominas) => fs.writeFileSync(dbPath, JSON.stringify(nominas, null, 2));

const upload = multer({ storage: multer.memoryStorage() });

router.post('/subir', upload.single('nomina'), async (req, res) => {
  try {
    const fileBuffer = req.file.buffer;
    const base64 = fileBuffer.toString('base64');

    const prompt = `Eres un experto en nominas espanolas. Extrae los siguientes datos de esta nomina en formato JSON y nada mas:
{
  "trabajador": "nombre completo del trabajador",
  "mes": "nombre del mes en español (enero, febrero, etc.)",
  "anno": "año como numero",
  "devengado": "total devengado como numero",
  "deducciones": "total deducciones como numero",
  "neto": "liquido a percibir como numero",
  "irpf_importe": "importe retenido de IRPF como numero",
  "irpf_porcentaje": "porcentaje de IRPF como numero",
  "ss_trabajador": "cuota SS del trabajador como numero",
  "ss_empresa": "aportacion SS de la empresa como numero",
  "coste_empresa": "coste total empresa como numero"
}
Solo devuelve el JSON, sin texto adicional.`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:application/pdf;base64,${base64}` } }
          ]
        }
      ],
      max_tokens: 500
    });

    let texto = response.choices[0].message.content.trim();
    texto = texto.replace(/```json|```/g, '').trim();
    const datos = JSON.parse(texto);

    const filename = Date.now() + '-nomina.pdf';
    const filepath = path.join(uploadsDir, filename);
    fs.writeFileSync(filepath, fileBuffer);

    const nominas = getNominas();
    const nueva = {
      id: Date.now(),
      ...datos,
      archivo: filename,
      fecha_subida: new Date().toISOString()
    };
    nominas.push(nueva);
    saveNominas(nominas);

    res.json({ nomina: nueva });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error procesando nomina' });
  }
});

router.get('/listar', (req, res) => {
  res.json({ nominas: getNominas() });
});

router.delete('/borrar/:id', (req, res) => {
  const nominas = getNominas();
  const idx = nominas.findIndex(n => n.id === parseInt(req.params.id));
  if (idx !== -1) {
    const archivo = nominas[idx].archivo;
    nominas.splice(idx, 1);
    saveNominas(nominas);
    try { fs.unlinkSync(path.join(uploadsDir, archivo)); } catch(e) {}
  }
  res.json({ ok: true });
});

module.exports = router;
