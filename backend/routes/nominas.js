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
- "irpf_importe" = importe en euros descontado por IRPF ESTE MES (no el porcentaje acumulado)
- "irpf_porcentaje" = porcentaje de retencion IRPF aplicado
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

    const nominas = getNominas(req.empresaId);
    const nueva = {
      id: Date.now(),
      ...datos,
      archivo: filename,
      fecha_subida: new Date().toISOString()
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

module.exports = router;
