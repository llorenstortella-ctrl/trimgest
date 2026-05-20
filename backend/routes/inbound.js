const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const pdfParse = require('pdf-parse');
const { Resend } = require('resend');
const { extraerDatosFactura } = require('../services/openai');
const OpenAI = require('openai');

const baseDataDir = path.join(__dirname, '../data');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);

function getEmpresaDirs(empresaId) {
  const empresaDir = path.join(baseDataDir, 'empresas', empresaId);
  if (!fs.existsSync(empresaDir)) fs.mkdirSync(empresaDir, { recursive: true });
  const uploadsDir = path.join(empresaDir, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
  return {
    uploadsDir,
    facturasPath: path.join(empresaDir, 'facturas.json'),
    nominasPath: path.join(empresaDir, 'nominas.json')
  };
}

function getTrimestre(fecha) {
  if (!fecha) return 'T1';
  const mes = parseInt(fecha.split('/')[1]);
  if (mes <= 3) return 'T1';
  if (mes <= 6) return 'T2';
  if (mes <= 9) return 'T3';
  return 'T4';
}

function getAnno(fecha) {
  if (!fecha) return new Date().getFullYear();
  return parseInt(fecha.split('/')[2]);
}

async function extraerDatosNominaBuffer(buffer) {
  const pdfData = await pdfParse(buffer);
  const texto = pdfData.text;
  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'Eres un experto en nominas espanolas. Devuelves solo JSON valido sin texto adicional.' },
      { role: 'user', content: `Extrae los datos de esta nomina y devuelve SOLO este JSON:
{
  "trabajador": "nombre completo del trabajador",
  "mes": "MM",
  "anno": YYYY,
  "devengado": numero,
  "neto": numero,
  "deducciones": numero,
  "irpf_porcentaje": numero,
  "irpf_importe": numero,
  "ss_trabajador": numero,
  "ss_empresa": numero,
  "coste_empresa": numero
}

TEXTO NOMINA:
${texto}` }
    ],
    max_tokens: 500
  });
  const clean = response.choices[0].message.content.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function procesarPDFFactura(buffer, nombreArchivo, empresaId, emailUsuario) {
  const { uploadsDir, facturasPath } = getEmpresaDirs(empresaId);
  const nombreFinal = Date.now() + '-' + nombreArchivo;
  const rutaFinal = path.join(uploadsDir, nombreFinal);
  fs.writeFileSync(rutaFinal, buffer);

  const datos = await extraerDatosFactura(rutaFinal);

  const facturas = fs.existsSync(facturasPath) ? JSON.parse(fs.readFileSync(facturasPath)) : [];
  const duplicado = facturas.find(function(f) {
    return f.numero_factura === datos.numero_factura && f.nombre === datos.nombre;
  });
  if (duplicado) {
    fs.unlinkSync(rutaFinal);
    return { ok: false, motivo: 'duplicado', nombre: datos.nombre, numero: datos.numero_factura };
  }

  const nueva = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    archivo: nombreFinal,
    tipo: 'proveedor',
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
    estado_pago: null,
    creado: new Date().toISOString(),
    origen: 'email'
  };

  facturas.push(nueva);
  fs.writeFileSync(facturasPath, JSON.stringify(facturas, null, 2));
  return { ok: true, factura: nueva };
}

async function procesarPDFNomina(buffer, nombreArchivo, empresaId) {
  const { uploadsDir, nominasPath } = getEmpresaDirs(empresaId);
  const nombreFinal = Date.now() + '-' + nombreArchivo;
  const rutaFinal = path.join(uploadsDir, nombreFinal);
  fs.writeFileSync(rutaFinal, buffer);

  const datos = await extraerDatosNominaBuffer(buffer);

  const nominas = fs.existsSync(nominasPath) ? JSON.parse(fs.readFileSync(nominasPath)) : [];
  const nueva = {
    id: Date.now() + Math.floor(Math.random() * 1000),
    archivo: nombreFinal,
    trabajador: datos.trabajador,
    mes: datos.mes,
    anno: datos.anno,
    devengado: datos.devengado,
    neto: datos.neto,
    deducciones: datos.deducciones,
    irpf_porcentaje: datos.irpf_porcentaje,
    irpf_importe: datos.irpf_importe,
    ss_trabajador: datos.ss_trabajador,
    ss_empresa: datos.ss_empresa,
    coste_empresa: datos.coste_empresa,
    contabilizado: false,
    fecha_subida: new Date().toISOString(),
    origen: 'email'
  };

  nominas.push(nueva);
  fs.writeFileSync(nominasPath, JSON.stringify(nominas, null, 2));
  return { ok: true, nomina: nueva };
}

router.post('/inbound', express.json({ limit: '25mb' }), async (req, res) => {
  res.json({ ok: true });

  try {
    const payload = req.body;
    const toEmail = (payload.to || '').toLowerCase();
    const fromEmail = (payload.from || '').toLowerCase();

    // Extraer empresaId del email destinatario
    // facturas+emp_XXXX@... o nominas+emp_XXXX@...
    const matchEmp = toEmail.match(/[+](emp_[a-z0-9_]+)@/);
    if (!matchEmp) return;
    const empresaId = matchEmp[1];

    // Determinar tipo: facturas o nominas
    const esFact = toEmail.startsWith('facturas+');
    const esNom = toEmail.startsWith('nominas+');
    if (!esFact && !esNom) return;

    // Verificar que el remitente es el usuario registrado
    const usuariosPath = path.join(baseDataDir, 'usuarios.json');
    const usuarios = JSON.parse(fs.readFileSync(usuariosPath));
    const usuario = usuarios.find(function(u) { return u.empresaId === empresaId; });
    if (!usuario) return;
    if (!fromEmail.includes(usuario.email.toLowerCase())) return;

    // Procesar adjuntos PDF
    const adjuntos = payload.attachments || [];
    const pdfs = adjuntos.filter(function(a) {
      return a.filename && a.filename.toLowerCase().endsWith('.pdf');
    });

    if (pdfs.length === 0) return;

    const resultados = [];
    for (var i = 0; i < pdfs.length; i++) {
      var adj = pdfs[i];
      try {
        var buffer = Buffer.from(adj.content, 'base64');
        var resultado;
        if (esFact) {
          resultado = await procesarPDFFactura(buffer, adj.filename, empresaId, usuario.email);
        } else {
          resultado = await procesarPDFNomina(buffer, adj.filename, empresaId);
        }
        resultados.push({ archivo: adj.filename, ...resultado });
      } catch(e) {
        resultados.push({ archivo: adj.filename, ok: false, motivo: e.message });
      }
    }

    // Email resumen al usuario
    const ok = resultados.filter(function(r) { return r.ok; }).length;
    const err = resultados.filter(function(r) { return !r.ok; }).length;
    const tipo = esFact ? 'facturas' : 'nominas';

    let htmlResumen = '<h2>TrimGest — Importacion por email</h2>';
    htmlResumen += '<p>Hemos procesado tu email con ' + pdfs.length + ' archivo(s):</p><ul>';
    resultados.forEach(function(r) {
      if (r.ok) {
        htmlResumen += '<li>✅ <b>' + r.archivo + '</b> — procesado correctamente</li>';
      } else {
        var motivo = r.motivo === 'duplicado' ? 'ya existe en tu panel' : 'error al procesar';
        htmlResumen += '<li>⚠️ <b>' + r.archivo + '</b> — ' + motivo + '</li>';
      }
    });
    htmlResumen += '</ul>';
    if (ok > 0) htmlResumen += '<p><a href="https://trimgest.es">Ver en TrimGest</a></p>';

    await resend.emails.send({
      from: 'TrimGest <no-reply@trimgest.es>',
      to: usuario.email,
      subject: 'TrimGest — ' + ok + ' ' + tipo + ' importadas correctamente',
      html: htmlResumen
    });

  } catch(e) {
    console.error('Error inbound email:', e);
  }
});

module.exports = router;
