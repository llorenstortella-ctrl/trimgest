const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const dbPath = process.env.DATA_PATH || path.join(__dirname, '../data/facturas.json');
const configPath = process.env.DATA_PATH
  ? path.join(path.dirname(process.env.DATA_PATH), 'config.json')
  : path.join(__dirname, '../data/config.json');

const getFacturas = () => {
  if (!fs.existsSync(dbPath)) return [];
  return JSON.parse(fs.readFileSync(dbPath));
};

const getConfig = () => {
  if (!fs.existsSync(configPath)) return { pin: '1234', objetivo_trimestre: null };
  return JSON.parse(fs.readFileSync(configPath));
};

const saveConfig = (config) => {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
};

function getResumenFinanciero(trimestre, anno) {
  const facturas = getFacturas();
  const del_periodo = facturas.filter(f =>
    f.trimestre === trimestre && String(f.anno) === String(anno)
  );

  const proveedores = del_periodo.filter(f => f.tipo === 'proveedor');
  const clientes = del_periodo.filter(f => f.tipo === 'cliente');

  const totalGastos = proveedores.reduce((s, f) => s + Number(f.total), 0);
  const totalIngresos = clientes.reduce((s, f) => s + Number(f.total), 0);
  const beneficioEstimado = totalIngresos - totalGastos;

  return {
    trimestre,
    anno,
    num_facturas_proveedor: proveedores.length,
    num_facturas_cliente: clientes.length,
    total_gastos: totalGastos.toFixed(2),
    total_ingresos: totalIngresos.toFixed(2),
    beneficio_estimado: beneficioEstimado.toFixed(2),
    objetivo_trimestre: getConfig().objetivo_trimestre || null,
    proveedores_detalle: proveedores.map(f => ({ nombre: f.nombre, total: f.total, fecha: f.fecha })),
    clientes_detalle: clientes.map(f => ({ nombre: f.nombre, total: f.total, fecha: f.fecha }))
  };
}

// Guardar objetivo
router.post('/objetivo', (req, res) => {
  const { objetivo } = req.body;
  const config = getConfig();
  config.objetivo_trimestre = parseFloat(objetivo);
  saveConfig(config);
  res.json({ ok: true });
});

// Chat con asesor
router.post('/chat', async (req, res) => {
  const { mensaje, trimestre, anno, historial } = req.body;
  const resumen = getResumenFinanciero(trimestre, anno);

  const messages = [
    {
      role: 'system',
      content: `Eres el asesor financiero personal de FEIM CA TEVA S.L., una pequeña empresa española. 
      
Tu rol es orientar al propietario sobre su situación financiera de forma clara, en lenguaje simple y sin jerga contable. Eres como un amigo que sabe de números.

DATOS ACTUALES DEL ${resumen.trimestre} ${resumen.anno}:
- Facturas de proveedores: ${resumen.num_facturas_proveedor} facturas, total gastos: ${resumen.total_gastos}€
- Facturas de clientes: ${resumen.num_facturas_cliente} facturas, total ingresos: ${resumen.total_ingresos}€
- Beneficio estimado: ${resumen.beneficio_estimado}€
${resumen.objetivo_trimestre ? `- Objetivo de beneficio este trimestre: ${resumen.objetivo_trimestre}€` : '- Sin objetivo de beneficio definido'}

PROVEEDORES:
${resumen.proveedores_detalle.map(p => `  - ${p.nombre}: ${p.total}€`).join('\n')}

CLIENTES:
${resumen.clientes_detalle.map(c => `  - ${c.nombre}: ${c.total}€`).join('\n')}

IMPORTANTE:
- Estos datos son estimaciones basadas en las facturas subidas. La gestoría puede tener información adicional.
- Sé honesto sobre las limitaciones de los datos.
- Responde siempre en español.
- Sé conciso, máximo 3-4 frases por respuesta.
- Si te preguntan algo que no puedes saber con estos datos, dilo claramente.`
    }
  ];

  if (historial && historial.length > 0) {
    historial.forEach(h => messages.push(h));
  }

  messages.push({ role: 'user', content: mensaje });

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      max_tokens: 300
    });

    const respuesta = response.choices[0].message.content;
    res.json({ respuesta });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error del asesor' });
  }
});

module.exports = router;