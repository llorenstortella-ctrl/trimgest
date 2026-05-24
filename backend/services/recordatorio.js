const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../data');
const usuariosPath = path.join(dataDir, 'usuarios.json');

function getUsuarios() {
  if (!fs.existsSync(usuariosPath)) return [];
  return JSON.parse(fs.readFileSync(usuariosPath));
}

function getTrimestresProximos() {
  const hoy = new Date();
  const dia = hoy.getDate();
  const mes = hoy.getMonth() + 1; // 1-12

  // Avisos 15 días antes del fin de trimestre
  // T1 acaba 31 marzo → avisamos del 16 al 31 de marzo
  // T2 acaba 30 junio → avisamos del 15 al 30 de junio
  // T3 acaba 30 septiembre → avisamos del 15 al 30 de septiembre
  // T4 acaba 31 diciembre → avisamos del 16 al 31 de diciembre

  const ventanas = [
    { mes: 3, desde: 16, hasta: 31, trimestre: 1, anno: hoy.getFullYear() },
    { mes: 6, desde: 15, hasta: 30, trimestre: 2, anno: hoy.getFullYear() },
    { mes: 9, desde: 15, hasta: 30, trimestre: 3, anno: hoy.getFullYear() },
    { mes: 12, desde: 16, hasta: 31, trimestre: 4, anno: hoy.getFullYear() }
  ];

  return ventanas.filter(v => v.mes === mes && dia >= v.desde && dia <= v.hasta);
}

async function ejecutarRecordatorios() {
  try {
    const { enviarRecordatorioTrimestral } = require('../utils/email');
    const trimestres = getTrimestresProximos();

    if (trimestres.length === 0) {
      console.log('[Recordatorio] Fuera de ventana de aviso, nada que enviar');
      return;
    }

    const usuarios = getUsuarios();
    const empresas = usuarios.filter(u => u.tipo !== 'gestoria' && u.verificado && u.empresaId);

    for (const empresa of empresas) {
      for (const t of trimestres) {
        // Comprobar si ya enviamos hoy para no duplicar
        const claveHoy = `recordatorio_${t.trimestre}_${t.anno}_${new Date().toISOString().slice(0, 10)}`;
        if (empresa.recordatorios_enviados && empresa.recordatorios_enviados.includes(claveHoy)) {
          console.log('[Recordatorio] Ya enviado hoy a', empresa.email);
          continue;
        }

        // Contar facturas del trimestre
        let numFacturas = 0;
        try {
          const facturasPath = path.join(dataDir, 'empresas', empresa.empresaId, 'facturas.json');
          if (fs.existsSync(facturasPath)) {
            const facturas = JSON.parse(fs.readFileSync(facturasPath));
            numFacturas = facturas.filter(f => f.trimestre == t.trimestre && f.anno == t.anno).length;
          }
        } catch(e) {}

        await enviarRecordatorioTrimestral(empresa.email, empresa.nombre_empresa || empresa.email, t.trimestre, t.anno, numFacturas);

        // Marcar como enviado
        if (!empresa.recordatorios_enviados) empresa.recordatorios_enviados = [];
        empresa.recordatorios_enviados.push(claveHoy);
        // Limpiar registros antiguos (guardar solo últimos 20)
        if (empresa.recordatorios_enviados.length > 20) {
          empresa.recordatorios_enviados = empresa.recordatorios_enviados.slice(-20);
        }

        console.log('[Recordatorio] Enviado a', empresa.email, 'T' + t.trimestre, t.anno);
      }
    }

    // Guardar cambios en usuarios.json
    fs.writeFileSync(usuariosPath, JSON.stringify(usuarios, null, 2));
    console.log('[Recordatorio] Proceso completado');

  } catch(e) {
    console.error('[Recordatorio] Error:', e.message);
  }
}

module.exports = { ejecutarRecordatorios };
