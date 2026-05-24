const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TrimGest2026!';
const baseDataDir = path.join(__dirname, '../data');

function getUsuarios() {
  const usuariosPath = path.join(baseDataDir, 'usuarios.json');
  if (!fs.existsSync(usuariosPath)) return [];
  return JSON.parse(fs.readFileSync(usuariosPath));
}

function saveUsuarios(usuarios) {
  fs.writeFileSync(path.join(baseDataDir, 'usuarios.json'), JSON.stringify(usuarios, null, 2));
}

function getFacturasCount(empresaId) {
  const dbPath = path.join(baseDataDir, 'empresas', empresaId, 'facturas.json');
  if (!fs.existsSync(dbPath)) return 0;
  return JSON.parse(fs.readFileSync(dbPath)).length;
}

function getNominasCount(empresaId) {
  const dbPath = path.join(baseDataDir, 'empresas', empresaId, 'nominas.json');
  if (!fs.existsSync(dbPath)) return 0;
  return JSON.parse(fs.readFileSync(dbPath)).length;
}

// Verificar password admin
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Password incorrecta' });
  }
});

// Obtener todos los usuarios
router.get('/usuarios', (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'No autorizado' });

  const usuarios = getUsuarios();
  const data = usuarios.map(u => ({
    id: u.id,
    email: u.email,
    nombre_empresa: u.nombre_empresa,
    tipo: u.tipo || 'empresa',
    plan: u.plan || 'basico',
    plan_gratuito: u.plan_gratuito || false,
    fecha_registro: u.fecha_registro,
    empresaId: u.empresaId,
    facturas: getFacturasCount(u.empresaId),
    nominas: getNominasCount(u.empresaId)
  }));

  res.json({
    total: usuarios.length,
    usuarios: data
  });
});

// Borrar usuario
router.delete('/usuarios/:id', (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'No autorizado' });

  const usuarios = getUsuarios();
  const idx = usuarios.findIndex(u => u.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
  usuarios.splice(idx, 1);
  saveUsuarios(usuarios);
  res.json({ ok: true });
});

// Obtener ficha de empresa
router.get('/empresa/:empresaId', (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'No autorizado' });

  const usuarios = getUsuarios();
  const usuario = usuarios.find(u => u.empresaId === req.params.empresaId);
  if (!usuario) return res.status(404).json({ error: 'Empresa no encontrada' });

  res.json({
    ok: true,
    empresa: {
      nombre_empresa: usuario.nombre_empresa,
      email: usuario.email,
      nif: usuario.nif || '-',
      direccion: usuario.direccion || '-',
      cp: usuario.cp || '-',
      ciudad: usuario.ciudad || '-',
      provincia: usuario.provincia || '-',
      plan: usuario.plan || 'basico',
      fecha_registro: usuario.fecha_registro,
      facturas: getFacturasCount(usuario.empresaId),
      nominas: getNominasCount(usuario.empresaId)
    }
  });
});


// POST /admin/plan-gratuito — dar o quitar acceso gratuito
router.post('/plan-gratuito', (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'TrimGest2026!')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const { empresaId, activo } = req.body;
  if (!empresaId) return res.status(400).json({ error: 'Falta empresaId' });
  const usuariosPath = path.join(__dirname, '../data/usuarios.json');
  const usuarios = JSON.parse(fs.readFileSync(usuariosPath));
  const idx = usuarios.findIndex(u => u.empresaId === empresaId);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
  usuarios[idx].plan_gratuito = activo ? true : false;
  fs.writeFileSync(usuariosPath, JSON.stringify(usuarios, null, 2));
  res.json({ ok: true });
});


// GET /admin/backup — descargar backup completo de datos
router.get('/backup', (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'TrimGest2026!')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const dataDir = path.join(__dirname, '../data');
    const backup = {};

    // usuarios.json
    const usuariosPath = path.join(dataDir, 'usuarios.json');
    if (fs.existsSync(usuariosPath)) {
      backup.usuarios = JSON.parse(fs.readFileSync(usuariosPath));
    }

    // empresas
    backup.empresas = {};
    const empresasDir = path.join(dataDir, 'empresas');
    if (fs.existsSync(empresasDir)) {
      const empresas = fs.readdirSync(empresasDir);
      empresas.forEach(empresaId => {
        backup.empresas[empresaId] = {};
        const dir = path.join(empresasDir, empresaId);
        const archivos = ['facturas.json', 'nominas.json', 'config.json', 'pyg.json'];
        archivos.forEach(archivo => {
          const p = path.join(dir, archivo);
          if (fs.existsSync(p)) {
            backup.empresas[empresaId][archivo.replace('.json', '')] = JSON.parse(fs.readFileSync(p));
          }
        });
      });
    }

    const fecha = new Date().toISOString().split('T')[0];
    res.setHeader('Content-Disposition', 'attachment; filename=trimgest-backup-' + fecha + '.json');
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify(backup, null, 2));
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error al generar backup' });
  }
});


// POST /admin/restore — restaurar backup
router.post('/restore', express.json({ limit: '50mb' }), (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'TrimGest2026!')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  try {
    const backup = req.body;
    if (!backup.usuarios) return res.status(400).json({ error: 'Backup invalido' });

    const dataDir = path.join(__dirname, '../data');

    // Restaurar usuarios.json
    fs.writeFileSync(path.join(dataDir, 'usuarios.json'), JSON.stringify(backup.usuarios, null, 2));

    // Restaurar empresas
    if (backup.empresas) {
      const empresasDir = path.join(dataDir, 'empresas');
      if (!fs.existsSync(empresasDir)) fs.mkdirSync(empresasDir, { recursive: true });

      Object.keys(backup.empresas).forEach(empresaId => {
        const dir = path.join(empresasDir, empresaId);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const empresa = backup.empresas[empresaId];
        const archivos = ['facturas', 'nominas', 'config', 'pyg'];
        archivos.forEach(nombre => {
          if (empresa[nombre]) {
            fs.writeFileSync(path.join(dir, nombre + '.json'), JSON.stringify(empresa[nombre], null, 2));
          }
        });
      });
    }

    res.json({ ok: true, mensaje: 'Backup restaurado correctamente' });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error al restaurar: ' + e.message });
  }
});


// POST /admin/verificar-usuario — verificar email de usuario manualmente
router.post('/verificar-usuario', (req, res) => {
  const adminPass = req.headers['x-admin-password'];
  if (adminPass !== (process.env.ADMIN_PASSWORD || 'TrimGest2026!')) {
    return res.status(401).json({ error: 'No autorizado' });
  }
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Falta email' });
  const usuarios = getUsuarios();
  const idx = usuarios.findIndex(u => u.email === email);
  if (idx === -1) return res.status(404).json({ error: 'Usuario no encontrado' });
  usuarios[idx].verificado = true;
  usuarios[idx].ver_token = null;
  saveUsuarios(usuarios);
  res.json({ ok: true, mensaje: 'Usuario verificado: ' + email });
});


// Endpoint temporal — cargar datos demo
router.post('/cargar-demo', async (req, res) => {
  const password = req.headers['x-admin-password'];
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'No autorizado' });

  try {
    const bcrypt = require('bcryptjs');
    const empresaId = 'emp_demo_construcciones';
    const gestoId = 'gest_demo_001';
    const passwordHash = await bcrypt.hash('Demo1234!', 10);

    // Usuarios
    const empresa = {
      id: 9000000001, email: 'demo@construccionesbalear.es', password: passwordHash,
      nombre_empresa: 'CONSTRUCCIONES BALEAR S.L.', nif: 'B57123456',
      direccion: 'Carrer Major 12, Palma de Mallorca', empresaId,
      plan: 'estandar', facturas_mes: 0, mes_actual: new Date().getMonth(),
      fecha_registro: '2024-01-15T09:00:00.000Z', verificado: true, ver_token: null,
      telefono: '634567890', gestoriasAprobadas: [{ gestoriaId: gestoId, gestoriaNombre: 'Gestoria Mallorca Assessors', gestoriaEmail: 'demo@gestoria-mallorca.es' }], solicitudesGestoria: []
    };
    const gestoria = {
      id: 9000000002, email: 'demo@gestoria-mallorca.es', password: passwordHash,
      nombre_empresa: 'GESTORIA MALLORCA ASSESSORS S.L.', nif: 'B57987654',
      direccion: 'Avda. Jaume III 5, Palma de Mallorca', empresaId: gestoId, gestoId,
      plan: 'free', tipo: 'gestoria', facturas_mes: 0, mes_actual: new Date().getMonth(),
      fecha_registro: '2024-01-10T09:00:00.000Z', verificado: true, ver_token: null,
      telefono: '971234567', nombre_gestoria: 'Gestoria Mallorca Assessors', whatsapp: '34971234567', clientesGestoria: [{ empresaId: empresaId, nombreEmpresa: 'CONSTRUCCIONES BALEAR S.L.', email: 'demo@construccionesbalear.es' }]
    };

    let usuarios = getUsuarios();
    usuarios = usuarios.filter(function(u) { return u.empresaId !== empresaId && u.gestoId !== gestoId && u.email !== 'demo@construccionesbalear.es' && u.email !== 'demo@gestoria-mallorca.es'; });
    usuarios.push(empresa);
    usuarios.push(gestoria);
    saveUsuarios(usuarios);

    // Directorios
    const empDir = path.join(baseDataDir, 'empresas', empresaId);
    if (!fs.existsSync(empDir)) fs.mkdirSync(empDir, { recursive: true });
    const uploadsDir = path.join(empDir, 'uploads');

    // Facturas
    const proveedores = [
      { nombre: 'REPSOL BUTANO S.A.', cif: 'A28001133' },
      { nombre: 'ENDESA ENERGIA S.A.', cif: 'A81948077' },
      { nombre: 'FERRETERIA SON SERVERA', cif: 'B57234567' },
      { nombre: 'CIMENT MALLORCA S.L.', cif: 'B57345678' },
      { nombre: 'LEROY MERLIN ESPANA S.L.', cif: 'B81840917' },
      { nombre: 'TELEFONICA DE ESPANA S.A.', cif: 'A28015865' },
      { nombre: 'GESTORIA MALLORCA ASSESSORS', cif: 'B57987654' },
      { nombre: 'GRUES I MAQUINARIA BALEAR S.L.', cif: 'B57456789' },
      { nombre: 'FUSTERIA CAN PERE S.L.', cif: 'B57567890' },
      { nombre: 'TRANSPORT MALLORCA EXPRESS S.L.', cif: 'B57678901' }
    ];
    const clientes = [
      { nombre: 'HOTEL MARINA CALA MILLOR S.L.', cif: 'B57111222' },
      { nombre: 'PROMOTORA LLEVANT S.A.', cif: 'A57222333' },
      { nombre: 'RESTAURANTE ES PORT S.L.', cif: 'B57333444' },
      { nombre: 'COMUNITAT DE PROPIETARIS PALMA NOVA', cif: 'H57444555' },
      { nombre: 'REFORMA INTEGRAL MANACOR S.L.', cif: 'B57555666' }
    ];
    const estadosPago = ['transferencia', 'tarjeta', 'domiciliacion', 'bizum', 'efectivo', 'mixto'];
    const trimestres = [
      { t: 'T1', a: 2025, meses: ['01','02','03'] },
      { t: 'T2', a: 2025, meses: ['04','05','06'] },
      { t: 'T3', a: 2025, meses: ['07','08','09'] },
      { t: 'T4', a: 2025, meses: ['10','11','12'] }
    ];
    function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
    function randItem(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function fmt(d, m, a) { return String(d).padStart(2,'0') + '/' + m + '/' + a; }
    function getTrim(f) { var m = parseInt(f.split('/')[1]); return m<=3?'T1':m<=6?'T2':m<=9?'T3':'T4'; }
    function getAnno(f) { return parseInt(f.split('/')[2]); }

    var facturas = [];
    var idC = 9000100001;
    trimestres.forEach(function(trim) {
      proveedores.forEach(function(prov) {
        var n = rand(1,2);
        for (var i=0;i<n;i++) {
          var base = rand(150,1500);
          var ivaPct = randItem([10,21]);
          var ivaImp = Math.round(base*ivaPct)/100;
          var total = Math.round((base+ivaImp)*100)/100;
          var mes = randItem(trim.meses);
          var fecha = fmt(rand(1,28), mes, trim.a);
          facturas.push({
            id: idC++, archivo: null, tipo: 'proveedor',
            nombre: prov.nombre, cif: prov.cif,
            numero_factura: 'F'+trim.a+'-'+String(idC).slice(-4),
            fecha, base_imponible: base, iva_porcentaje: ivaPct,
            iva_importe: ivaImp, total, trimestre: getTrim(fecha), anno: getAnno(fecha),
            enviado: false, contabilizado: Math.random()>0.3,
            estado_pago: randItem(estadosPago), fecha_subida: new Date().toISOString()
          });
        }
      });
      clientes.forEach(function(cli) {
        var base = rand(8000,45000);
        var ivaImp = Math.round(base*21)/100;
        var total = Math.round((base+ivaImp)*100)/100;
        var fecha = fmt(rand(1,28), randItem(trim.meses), trim.a);
        facturas.push({
          id: idC++, archivo: null, tipo: 'cliente',
          nombre: cli.nombre, cif: cli.cif,
          numero_factura: 'FC'+trim.a+'-'+String(idC).slice(-4),
          fecha, base_imponible: base, iva_porcentaje: 21,
          iva_importe: ivaImp, total, trimestre: getTrim(fecha), anno: getAnno(fecha),
          enviado: Math.random()>0.5, contabilizado: Math.random()>0.4,
          estado_pago: 'transferencia', fecha_subida: new Date().toISOString()
        });
      });
    });
    fs.writeFileSync(path.join(empDir, 'facturas.json'), JSON.stringify(facturas, null, 2));

    // Nominas
    var trabajadores = ['JOAN TOUS FUSTER','MIQUEL SERVERA LLULL','PERE ANTONI RIERA GALMES','BARTOMEU OLIVER NADAL'];
    var meses = ['01','02','03','04','05','06','07','08','09','10','11','12'];
    var nominas = [];
    var nomId = 9000200001;
    trabajadores.forEach(function(trab) {
      var bruto = rand(1800,3200);
      meses.forEach(function(mes) {
        var irpfPct = rand(12,20);
        var ssTrab = Math.round(bruto*0.0635*100)/100;
        var irpfImp = Math.round(bruto*irpfPct/100*100)/100;
        var neto = Math.round((bruto-ssTrab-irpfImp)*100)/100;
        var ssEmp = Math.round(bruto*0.236*100)/100;
        nominas.push({
          id: nomId++, trabajador: trab, mes, anno: 2025,
          devengado: bruto, neto, deducciones: Math.round((ssTrab+irpfImp)*100)/100,
          irpf_porcentaje: irpfPct, irpf_importe: irpfImp,
          ss_trabajador: ssTrab, ss_empresa: ssEmp,
          coste_empresa: Math.round((bruto+ssEmp)*100)/100,
          archivo: null, contabilizado: mes<'05', fecha_subida: new Date().toISOString()
        });
      });
    });
    fs.writeFileSync(path.join(empDir, 'nominas.json'), JSON.stringify(nominas, null, 2));



    // Generar PDFs demo
    const PDFDocument = require('pdfkit');
    const uploadsDirDemo = path.join(empDir, 'uploads');
    if (!fs.existsSync(uploadsDirDemo)) fs.mkdirSync(uploadsDirDemo, { recursive: true });

    function generarPDFFactura(factura) {
      return new Promise(function(resolve, reject) {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const nombreArchivo = 'demo_' + factura.id + '.pdf';
        const rutaArchivo = path.join(uploadsDirDemo, nombreArchivo);
        const stream = fs.createWriteStream(rutaArchivo);
        doc.pipe(stream);

        // Cabecera
        doc.fontSize(20).fillColor('#1a1a2e').text('CONSTRUCCIONES BALEAR S.L.', 50, 50);
        doc.fontSize(10).fillColor('#666').text('B57123456 | Carrer Major 12, Palma de Mallorca', 50, 78);
        doc.fontSize(10).fillColor('#666').text('info@construccionesbalear.es | Tel: 634 567 890', 50, 92);

        // Linea separadora
        doc.moveTo(50, 110).lineTo(545, 110).strokeColor('#e0e0e0').stroke();

        // Titulo factura
        const tipoLabel = factura.tipo === 'cliente' ? 'FACTURA EMITIDA' : 'FACTURA RECIBIDA';
        doc.fontSize(14).fillColor('#1a1a2e').text(tipoLabel, 50, 125);
        doc.fontSize(10).fillColor('#333');

        // Datos factura
        doc.text('Número:', 50, 155).text(factura.numero_factura, 150, 155);
        doc.text('Fecha:', 50, 170).text(factura.fecha, 150, 170);
        doc.text('Proveedor/Cliente:', 50, 185).text(factura.nombre, 150, 185);
        doc.text('CIF:', 50, 200).text(factura.cif || '-', 150, 200);

        // Linea separadora
        doc.moveTo(50, 225).lineTo(545, 225).strokeColor('#e0e0e0').stroke();

        // Tabla importes
        doc.fontSize(10).fillColor('#666').text('Base imponible', 50, 240);
        doc.fillColor('#333').text(factura.base_imponible.toFixed(2) + ' €', 400, 240, { align: 'right', width: 145 });

        doc.fillColor('#666').text('IVA (' + factura.iva_porcentaje + '%)', 50, 258);
        doc.fillColor('#333').text(factura.iva_importe.toFixed(2) + ' €', 400, 258, { align: 'right', width: 145 });

        doc.moveTo(50, 278).lineTo(545, 278).strokeColor('#e0e0e0').stroke();

        doc.fontSize(12).fillColor('#1a1a2e').text('TOTAL', 50, 290);
        doc.fontSize(13).fillColor('#1a1a2e').text(factura.total.toFixed(2) + ' €', 400, 288, { align: 'right', width: 145 });

        // Pie
        doc.fontSize(8).fillColor('#aaa').text('Documento generado por TrimGest — trimgest.es', 50, 750, { align: 'center', width: 495 });

        doc.end();
        stream.on('finish', function() { resolve(nombreArchivo); });
        stream.on('error', reject);
      });
    }

    function generarPDFNomina(nomina) {
      return new Promise(function(resolve, reject) {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const nombreArchivo = 'demo_nom_' + nomina.id + '.pdf';
        const rutaArchivo = path.join(uploadsDirDemo, nombreArchivo);
        const stream = fs.createWriteStream(rutaArchivo);
        doc.pipe(stream);

        doc.fontSize(20).fillColor('#1a1a2e').text('CONSTRUCCIONES BALEAR S.L.', 50, 50);
        doc.fontSize(10).fillColor('#666').text('B57123456 | Carrer Major 12, Palma de Mallorca', 50, 78);

        doc.moveTo(50, 110).lineTo(545, 110).strokeColor('#e0e0e0').stroke();

        doc.fontSize(14).fillColor('#1a1a2e').text('NÓMINA', 50, 125);
        doc.fontSize(10).fillColor('#333');

        doc.text('Trabajador:', 50, 155).text(nomina.trabajador, 150, 155);
        doc.text('Mes:', 50, 170).text(nomina.mes + '/' + nomina.anno, 150, 170);

        doc.moveTo(50, 195).lineTo(545, 195).strokeColor('#e0e0e0').stroke();

        doc.fillColor('#666').text('Devengado bruto', 50, 210);
        doc.fillColor('#333').text(nomina.devengado.toFixed(2) + ' €', 400, 210, { align: 'right', width: 145 });

        doc.fillColor('#666').text('SS trabajador', 50, 228);
        doc.fillColor('#333').text('-' + nomina.ss_trabajador.toFixed(2) + ' €', 400, 228, { align: 'right', width: 145 });

        doc.fillColor('#666').text('IRPF (' + nomina.irpf_porcentaje + '%)', 50, 246);
        doc.fillColor('#333').text('-' + nomina.irpf_importe.toFixed(2) + ' €', 400, 246, { align: 'right', width: 145 });

        doc.moveTo(50, 266).lineTo(545, 266).strokeColor('#e0e0e0').stroke();

        doc.fontSize(12).fillColor('#1a1a2e').text('NETO A PERCIBIR', 50, 278);
        doc.fontSize(13).fillColor('#1a1a2e').text(nomina.neto.toFixed(2) + ' €', 400, 276, { align: 'right', width: 145 });

        doc.fontSize(10).fillColor('#666').text('Coste empresa: ' + nomina.coste_empresa.toFixed(2) + ' €', 50, 310);

        doc.fontSize(8).fillColor('#aaa').text('Documento generado por TrimGest — trimgest.es', 50, 750, { align: 'center', width: 495 });

        doc.end();
        stream.on('finish', function() { resolve(nombreArchivo); });
        stream.on('error', reject);
      });
    }

    // Generar PDFs para todas las facturas
    for (var fi = 0; fi < facturas.length; fi++) {
      var nombrePDF = await generarPDFFactura(facturas[fi]);
      facturas[fi].archivo = nombrePDF;
    }
    fs.writeFileSync(path.join(empDir, 'facturas.json'), JSON.stringify(facturas, null, 2));

    // Generar PDFs para todas las nominas
    for (var ni = 0; ni < nominas.length; ni++) {
      var nombreNomPDF = await generarPDFNomina(nominas[ni]);
      nominas[ni].archivo = nombreNomPDF;
    }
    fs.writeFileSync(path.join(empDir, 'nominas.json'), JSON.stringify(nominas, null, 2));

    res.json({ ok: true, mensaje: 'Demo cargada', facturas: facturas.length, nominas: nominas.length });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});


module.exports = router;
