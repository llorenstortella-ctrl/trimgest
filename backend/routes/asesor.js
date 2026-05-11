const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const auth = require('../middleware/auth');

const baseDataDir = path.join(__dirname, '../data');

function getFacturasEmpresa(empresaId) {
  const p = path.join(baseDataDir, 'empresas', empresaId, 'facturas.json');
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p));
}

function getConfigEmpresa(empresaId) {
  const p = path.join(baseDataDir, 'empresas', empresaId, 'config.json');
  if (!fs.existsSync(p)) return { objetivo_trimestre: null };
  return JSON.parse(fs.readFileSync(p));
}

function saveConfigEmpresa(empresaId, config) {
  const dir = path.join(baseDataDir, 'empresas', empresaId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
}

function getPyGEmpresa(empresaId) {
  const p = path.join(baseDataDir, 'empresas', empresaId, 'pyg.json');
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p));
}

function getNominasEmpresa(empresaId) {
  const p = path.join(baseDataDir, 'empresas', empresaId, 'nominas.json');
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p));
}

function getResumenFinanciero(trimestre, anno, empresaId) {
  const facturas = getFacturasEmpresa(empresaId);
  const del_periodo = facturas.filter(f =>
    f.trimestre === trimestre && String(f.anno) === String(anno)
  );

  const proveedores = del_periodo.filter(f => f.tipo === 'proveedor');
  const clientes = del_periodo.filter(f => f.tipo === 'cliente');

  const totalGastos = proveedores.reduce((s, f) => s + Number(f.total), 0);
  const totalIngresos = clientes.reduce((s, f) => s + Number(f.total), 0);

  const nominas = getNominasEmpresa(empresaId);
  const nominasPeriodo = nominas.filter(n => {
    if (!n.fecha) return false;
    const d = new Date(n.fecha);
    const t = Math.ceil((d.getMonth() + 1) / 3);
    return String(t) === String(trimestre).replace('Q','') && String(d.getFullYear()) === String(anno);
  });
  const totalNominas = nominasPeriodo.reduce((s, n) => s + Number(n.coste_empresa || n.salario_bruto || 0), 0);

  const beneficioEstimado = totalIngresos - totalGastos - totalNominas;
  const pyg = getPyGEmpresa(empresaId);

  return {
    trimestre,
    anno,
    num_facturas_proveedor: proveedores.length,
    num_facturas_cliente: clientes.length,
    num_nominas: nominasPeriodo.length,
    total_gastos: totalGastos.toFixed(2),
    total_ingresos: totalIngresos.toFixed(2),
    total_nominas: totalNominas.toFixed(2),
    beneficio_estimado: beneficioEstimado.toFixed(2),
    objetivo_trimestre: getConfigEmpresa(empresaId).objetivo_trimestre || null,
    proveedores_detalle: proveedores.map(f => ({ nombre: f.nombre, total: f.total, fecha: f.fecha })),
    clientes_detalle: clientes.map(f => ({ nombre: f.nombre, total: f.total, fecha: f.fecha })),
    nominas_detalle: nominasPeriodo.map(n => ({ empleado: n.empleado || n.nombre || 'Empleado', coste: n.coste_empresa || n.salario_bruto || 0, mes: n.mes || n.fecha })),
    pyg_actual: pyg ? pyg.ejercicio_actual : null,
    pyg_anterior: pyg ? pyg.ejercicio_anterior : null,
    empresaId
  };
}

router.post('/objetivo', auth, (req, res) => {
  const { objetivo } = req.body;
  const empresaId = req.empresaId || req.body.empresaId;
  const config = getConfigEmpresa(empresaId);
  config.objetivo_trimestre = parseFloat(objetivo);
  saveConfigEmpresa(empresaId, config);
  res.json({ ok: true });
});

router.post('/chat', auth, async (req, res) => {
  const { mensaje, trimestre, anno, historial } = req.body;
  const empresaId = req.empresaId || req.body.empresaId;
  const usuariosPath = path.join(baseDataDir, 'usuarios.json');
  const usuarios = JSON.parse(fs.readFileSync(usuariosPath));
  const usuario = usuarios.find(u => u.empresaId === empresaId);
  const nombreEmpresa = usuario ? usuario.nombre_empresa : 'tu empresa';
  const resumen = getResumenFinanciero(trimestre, anno, empresaId);

  const pygActualTexto = resumen.pyg_actual ? `
DATOS P&G AÑO ACTUAL (${resumen.pyg_actual.anno}):
- Ingresos netos: ${resumen.pyg_actual.ingresos_netos}€
- Gastos de personal: ${resumen.pyg_actual.gastos_personal}€
- Otros gastos de explotación: ${resumen.pyg_actual.otros_gastos_explotacion}€
- Resultado de explotación: ${resumen.pyg_actual.resultado_explotacion}€
- Resultado del ejercicio: ${resumen.pyg_actual.resultado_ejercicio}€` : '- Sin datos de P&G del año actual';

  const pygAnteriorTexto = resumen.pyg_anterior && resumen.pyg_anterior.anno ? `
DATOS P&G AÑO ANTERIOR (${resumen.pyg_anterior.anno}):
- Ingresos netos: ${resumen.pyg_anterior.ingresos_netos}€
- Gastos de personal: ${resumen.pyg_anterior.gastos_personal}€
- Otros gastos de explotación: ${resumen.pyg_anterior.otros_gastos_explotacion}€
- Resultado de explotación: ${resumen.pyg_anterior.resultado_explotacion}€
- Resultado del ejercicio: ${resumen.pyg_anterior.resultado_ejercicio}€` : '';

  const messages = [
    {
      role: 'system',
      content: `Eres el asesor financiero personal de ${nombreEmpresa}, una pequeña empresa española.

Tu rol es orientar al propietario sobre su situación financiera de forma clara, en lenguaje simple y sin jerga contable. Eres como un amigo que sabe de números.

DATOS ACTUALES DEL ${resumen.trimestre} ${resumen.anno}:
- Facturas de proveedores: ${resumen.num_facturas_proveedor} facturas, total gastos: ${resumen.total_gastos}€
- Facturas de clientes: ${resumen.num_facturas_cliente} facturas, total ingresos: ${resumen.total_ingresos}€
- Nominas: ${resumen.num_nominas} nominas, coste total: ${resumen.total_nominas}€
- Beneficio estimado (ingresos - gastos - nominas): ${resumen.beneficio_estimado}€
${resumen.objetivo_trimestre ? `- Objetivo de beneficio este trimestre: ${resumen.objetivo_trimestre}€` : '- Sin objetivo de beneficio definido'}

${pygActualTexto}
${pygAnteriorTexto}

PROVEEDORES:
${resumen.proveedores_detalle.map(p => `  - ${p.nombre}: ${p.total}€`).join('\n')}

CLIENTES:
${resumen.clientes_detalle.map(c => `  - ${c.nombre}: ${c.total}€`).join('\n')}

IMPORTANTE:
- Los datos de P&G son los contabilizados por la gestoría e incluyen gastos que no están en TrimGest como nóminas, seguridad social, etc.
- Sé honesto sobre las limitaciones de los datos.
- Responde siempre en español.
- Sé conciso, máximo 3-4 frases por respuesta.`
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