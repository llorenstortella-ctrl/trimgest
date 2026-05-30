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
  const mesesPorTrimestre = { 'T1': ['01','02','03','enero','febrero','marzo'], 'T2': ['04','05','06','abril','mayo','junio'], 'T3': ['07','08','09','julio','agosto','septiembre'], 'T4': ['10','11','12','octubre','noviembre','diciembre'] };
  const mesesTrim = mesesPorTrimestre[trimestre] || [];
  const nominasPeriodo = nominas.filter(n => {
    const mesStr = String(n.mes || '').toLowerCase().trim();
    return mesesTrim.includes(mesStr) && String(n.anno) === String(anno);
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
    empresaId,
    facturas_sin_clasificar: del_periodo.filter(f => f.estado_pago === null || f.estado_pago === undefined).length,
    facturas_sin_pagar: del_periodo.filter(f => f.estado_pago === 'sinpagar').length,
    facturas_no_contabilizadas: del_periodo.filter(f => !f.contabilizado).length,
    metodos_pago: del_periodo.reduce(function(acc, f) { var m = f.estado_pago || 'sin_clasificar'; acc[m] = (acc[m] || 0) + 1; return acc; }, {})
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

  const datosEmpresa = usuario ? `
DATOS DE LA EMPRESA:
- Nombre: ${usuario.nombre_empresa}
- NIF: ${usuario.nif || 'No disponible'}
- Dirección: ${usuario.direccion || ''} ${usuario.ciudad || ''} ${usuario.provincia || ''}
- Plan TrimGest: ${usuario.plan || 'free'}
- Fecha de registro: ${usuario.fecha_registro ? new Date(usuario.fecha_registro).toLocaleDateString('es-ES') : 'desconocida'}
` : '';

  const messages = [
    {
      role: 'system',
      content: `Eres el asesor financiero personal de ${nombreEmpresa}, una pequeña empresa española.

Tu rol es orientar al propietario sobre su situación financiera de forma clara, en lenguaje simple y sin jerga contable. Eres como un amigo que sabe de números.

${datosEmpresa}

DATOS ACTUALES DEL ${resumen.trimestre} ${resumen.anno}:
- Facturas de proveedores: ${resumen.num_facturas_proveedor} facturas, total gastos: ${resumen.total_gastos}€
- Facturas de clientes: ${resumen.num_facturas_cliente} facturas, total ingresos: ${resumen.total_ingresos}€
- Nominas: ${resumen.num_nominas} nominas, coste total: ${resumen.total_nominas}€
- Beneficio estimado (ingresos - gastos - nominas): ${resumen.beneficio_estimado}€
${resumen.objetivo_trimestre ? `- Objetivo de beneficio este trimestre: ${resumen.objetivo_trimestre}€` : '- Sin objetivo de beneficio definido'}
- Facturas sin clasificar estado pago: ${resumen.facturas_sin_clasificar}
- Facturas marcadas como sin pagar: ${resumen.facturas_sin_pagar}
- Facturas no contabilizadas: ${resumen.facturas_no_contabilizadas}
- Métodos de pago usados: ${JSON.stringify(resumen.metodos_pago)}

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