const express = require('express');
const { enviarInvitacionGestoria, enviarVerificacion } = require('../utils/email');
const crypto = require('crypto');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'trimgest_secret_2026';
const dataDir = path.join(__dirname, '../data');
const usuariosPath = path.join(dataDir, 'usuarios.json');

const getUsuarios = () => JSON.parse(fs.readFileSync(usuariosPath));
const saveUsuarios = (u) => fs.writeFileSync(usuariosPath, JSON.stringify(u, null, 2));

function getEmpresaDir(empresaId) {
  const dir = path.join(dataDir, 'empresas', empresaId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getUserFromToken(req) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const usuarios = getUsuarios();
    return usuarios.find(u => u.id === decoded.id) || null;
  } catch(e) { return null; }
}

// POST /gestoria/registro — registro como gestoria
router.post('/registro', async (req, res) => {
  try {
    const { email, password, nombre_empresa, ref_referido_por } = req.body;
    if (!email || !password || !nombre_empresa) {
      return res.status(400).json({ error: 'Faltan datos' });
    }
    const usuarios = getUsuarios();
    if (usuarios.find(u => u.email === email)) {
      return res.status(400).json({ error: 'Email ya registrado' });
    }
    const hash = await bcrypt.hash(password, 10);
    const gestoriaId = 'ges_' + Date.now();
    const verToken = crypto.randomBytes(32).toString('hex');
    const nuevo = {
      id: Date.now(),
      email,
      password: hash,
      nombre_empresa,
      empresaId: gestoriaId,
      tipo: 'gestoria',
      clientesGestoria: [],
      solicitudesEnviadas: [],
      plan: 'basico',
      fecha_registro: new Date().toISOString(),
      verificado: false,
      ver_token: verToken,
      ref_codigo: Math.random().toString(36).substring(2, 8).toUpperCase(),
      ref_referido_por: ref_referido_por || null,
      ref_saldo: 0
    };
    // Añadir empresa demo como primer cliente
    nuevo.clientesGestoria = [{
      empresaId: 'emp_demo_construcciones',
      empresaEmail: 'demo@construccionesbalear.es',
      empresaNombre: 'Construcciones Balear SL',
      fecha: new Date().toISOString(),
      es_demo: true
    }];
    usuarios.push(nuevo);
    saveUsuarios(usuarios);
    try { await enviarVerificacion(email, nombre_empresa, verToken); } catch(e) { console.error('Error email verificacion gestoria:', e); }
    const token = jwt.sign({ id: nuevo.id, empresaId: gestoriaId, tipo: 'gestoria' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, nombre_empresa, empresaId: gestoriaId, tipo: 'gestoria', verificacion_pendiente: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error en registro' });
  }
});

// POST /gestoria/solicitar-acceso — gestoria solicita acceso a empresa por email
router.post('/solicitar-acceso', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') {
      return res.status(401).json({ error: 'No autorizado' });
    }
    const { emailEmpresa } = req.body;
    if (!emailEmpresa) return res.status(400).json({ error: 'Falta email de empresa' });

    const usuarios = getUsuarios();
    const empIdx = usuarios.findIndex(u => u.email === emailEmpresa && u.tipo !== 'gestoria');
    if (empIdx === -1) return res.status(404).json({ error: 'Empresa no encontrada' });

    const empresa = usuarios[empIdx];
    if (!empresa.solicitudesGestoria) empresa.solicitudesGestoria = [];
    if (!empresa.gestoriasAprobadas) empresa.gestoriasAprobadas = [];

    const yaAprobada = empresa.gestoriasAprobadas.find(g => g.gestoriaId === gestoria.empresaId);
    if (yaAprobada) return res.status(400).json({ error: 'Ya tienes acceso a esta empresa' });

    const yaSolicitada = empresa.solicitudesGestoria.find(s => s.gestoriaId === gestoria.empresaId && s.estado === 'pendiente');
    if (yaSolicitada) return res.status(400).json({ error: 'Ya existe una solicitud pendiente' });

    empresa.solicitudesGestoria.push({
      gestoriaId: gestoria.empresaId,
      gestoriaEmail: gestoria.email,
      gestoriaNombre: gestoria.nombre_empresa,
      estado: 'pendiente',
      fecha: new Date().toISOString()
    });

    const gesIdx = usuarios.findIndex(u => u.id === gestoria.id);
    if (!usuarios[gesIdx].solicitudesEnviadas) usuarios[gesIdx].solicitudesEnviadas = [];
    usuarios[gesIdx].solicitudesEnviadas.push({
      empresaId: empresa.empresaId,
      empresaEmail: empresa.email,
      empresaNombre: empresa.nombre_empresa,
      estado: 'pendiente',
      fecha: new Date().toISOString()
    });

    usuarios[empIdx] = empresa;
    saveUsuarios(usuarios);
    res.json({ ok: true, mensaje: 'Solicitud enviada correctamente' });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error al solicitar acceso' });
  }
});

// POST /gestoria/invitar — empresa invita a gestoria por email
router.post('/invitar', async (req, res) => {
  try {
    const empresa = getUserFromToken(req);
    if (!empresa || empresa.tipo === 'gestoria') {
      return res.status(401).json({ error: 'No autorizado' });
    }
    const { emailGestoria } = req.body;
    if (!emailGestoria) return res.status(400).json({ error: 'Falta email de gestoría' });

    const usuarios = getUsuarios();
    const empIdx = usuarios.findIndex(u => u.id === empresa.id);
    if (!usuarios[empIdx].solicitudesGestoria) usuarios[empIdx].solicitudesGestoria = [];
    if (!usuarios[empIdx].gestoriasAprobadas) usuarios[empIdx].gestoriasAprobadas = [];

    const gesIdx = usuarios.findIndex(u => u.email === emailGestoria && u.tipo === 'gestoria');

    if (gesIdx !== -1) {
      const gestoria = usuarios[gesIdx];
      const yaAprobada = usuarios[empIdx].gestoriasAprobadas.find(g => g.gestoriaId === gestoria.empresaId);
      if (yaAprobada) return res.status(400).json({ error: 'Esta gestoría ya tiene acceso' });

      const yaInvitada = usuarios[empIdx].solicitudesGestoria.find(s => s.gestoriaId === gestoria.empresaId && s.estado === 'pendiente');
      if (yaInvitada) return res.status(400).json({ error: 'Ya existe una invitación pendiente' });

      usuarios[empIdx].solicitudesGestoria.push({
        gestoriaId: gestoria.empresaId,
        gestoriaEmail: gestoria.email,
        gestoriaNombre: gestoria.nombre_empresa,
        estado: 'invitacion_pendiente',
        fecha: new Date().toISOString()
      });

      if (!usuarios[gesIdx].invitacionesRecibidas) usuarios[gesIdx].invitacionesRecibidas = [];
      usuarios[gesIdx].invitacionesRecibidas.push({
        empresaId: empresa.empresaId,
        empresaEmail: empresa.email,
        empresaNombre: empresa.nombre_empresa,
        estado: 'pendiente',
        fecha: new Date().toISOString()
      });
    } else {
      usuarios[empIdx].solicitudesGestoria.push({
        gestoriaId: null,
        gestoriaEmail: emailGestoria,
        gestoriaNombre: 'Pendiente de registro',
        estado: 'invitacion_sin_registro',
        fecha: new Date().toISOString()
      });
    }

    saveUsuarios(usuarios);
    if (gesIdx !== -1) {
      try { await enviarInvitacionGestoria(emailGestoria, empresa.nombre_empresa); } catch(e) { console.error('Error email invitacion:', e); }
    }
    res.json({ ok: true, mensaje: gesIdx !== -1 ? 'Invitación enviada a la gestoría' : 'Invitación registrada — la gestoría debe registrarse con ese email' });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error al invitar' });
  }
});

// GET /gestoria/solicitudes — empresa ve solicitudes pendientes
router.get('/solicitudes', (req, res) => {
  try {
    const empresa = getUserFromToken(req);
    if (!empresa || empresa.tipo === 'gestoria') {
      return res.status(401).json({ error: 'No autorizado' });
    }
    const usuarios = getUsuarios();
    const emp = usuarios.find(u => u.id === empresa.id);
    const aprobadasEnriquecidas = (emp.gestoriasAprobadas || []).map(function(g) {
      const gestoria = usuarios.find(u => u.empresaId === g.gestoriaId || u.gestoId === g.gestoriaId);
      return Object.assign({}, g, { telefono: gestoria ? (gestoria.telefono || '') : '' });
    });
    res.json({ ok: true, solicitudes: emp.solicitudesGestoria || [], aprobadas: aprobadasEnriquecidas });
  } catch(e) {
    res.status(500).json({ error: 'Error' });
  }
});

// POST /gestoria/responder — empresa acepta o rechaza solicitud
router.post('/responder', (req, res) => {
  try {
    const empresa = getUserFromToken(req);
    if (!empresa || empresa.tipo === 'gestoria') {
      return res.status(401).json({ error: 'No autorizado' });
    }
    const { gestoriaId, accion } = req.body;
    if (!gestoriaId || !accion) return res.status(400).json({ error: 'Faltan datos' });

    const usuarios = getUsuarios();
    const empIdx = usuarios.findIndex(u => u.id === empresa.id);
    if (!usuarios[empIdx].solicitudesGestoria) usuarios[empIdx].solicitudesGestoria = [];
    if (!usuarios[empIdx].gestoriasAprobadas) usuarios[empIdx].gestoriasAprobadas = [];

    const solIdx = usuarios[empIdx].solicitudesGestoria.findIndex(s => s.gestoriaId === gestoriaId && (s.estado === 'pendiente' || s.estado === 'invitacion_pendiente'));
    if (solIdx === -1) return res.status(404).json({ error: 'Solicitud no encontrada' });

    const solicitud = usuarios[empIdx].solicitudesGestoria[solIdx];

    if (accion === 'aceptar') {
      usuarios[empIdx].solicitudesGestoria[solIdx].estado = 'aprobada';
      usuarios[empIdx].gestoriasAprobadas.push({
        gestoriaId: solicitud.gestoriaId,
        gestoriaEmail: solicitud.gestoriaEmail,
        gestoriaNombre: solicitud.gestoriaNombre,
        fecha: new Date().toISOString()
      });

      const gesIdx = usuarios.findIndex(u => u.empresaId === gestoriaId);
      if (gesIdx !== -1) {
        if (!usuarios[gesIdx].clientesGestoria) usuarios[gesIdx].clientesGestoria = [];
        const yaCliente = usuarios[gesIdx].clientesGestoria.find(c => c.empresaId === empresa.empresaId);
        if (!yaCliente) {
          usuarios[gesIdx].clientesGestoria.push({
            empresaId: empresa.empresaId,
            empresaEmail: empresa.email,
            empresaNombre: empresa.nombre_empresa,
            fecha: new Date().toISOString()
          });
        }
        const invIdx = usuarios[gesIdx].solicitudesEnviadas?.findIndex(s => s.empresaId === empresa.empresaId);
        if (invIdx !== undefined && invIdx !== -1) {
          usuarios[gesIdx].solicitudesEnviadas[invIdx].estado = 'aprobada';
        }
        const invRecIdx = usuarios[gesIdx].invitacionesRecibidas?.findIndex(s => s.empresaId === empresa.empresaId);
        if (invRecIdx !== undefined && invRecIdx !== -1) {
          usuarios[gesIdx].invitacionesRecibidas[invRecIdx].estado = 'aceptada';
        }
      }
    } else {
      usuarios[empIdx].solicitudesGestoria[solIdx].estado = 'rechazada';
    }

    saveUsuarios(usuarios);
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error al responder' });
  }
});

// POST /gestoria/responder-invitacion — gestoria acepta o rechaza invitacion de empresa
router.post('/responder-invitacion', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') {
      return res.status(401).json({ error: 'No autorizado' });
    }
    const { empresaId, accion } = req.body;
    if (!empresaId || !accion) return res.status(400).json({ error: 'Faltan datos' });

    const usuarios = getUsuarios();
    const gesIdx = usuarios.findIndex(u => u.id === gestoria.id);
    const empIdx = usuarios.findIndex(u => u.empresaId === empresaId);
    if (empIdx === -1) return res.status(404).json({ error: 'Empresa no encontrada' });

    if (accion === 'aceptar') {
      if (!usuarios[gesIdx].clientesGestoria) usuarios[gesIdx].clientesGestoria = [];
      const yaCliente = usuarios[gesIdx].clientesGestoria.find(c => c.empresaId === empresaId);
      if (!yaCliente) {
        usuarios[gesIdx].clientesGestoria.push({
          empresaId: usuarios[empIdx].empresaId,
          empresaEmail: usuarios[empIdx].email,
          empresaNombre: usuarios[empIdx].nombre_empresa,
          fecha: new Date().toISOString()
        });
      }
      if (!usuarios[empIdx].gestoriasAprobadas) usuarios[empIdx].gestoriasAprobadas = [];
      const yaAprobada = usuarios[empIdx].gestoriasAprobadas.find(g => g.gestoriaId === gestoria.empresaId);
      if (!yaAprobada) {
        usuarios[empIdx].gestoriasAprobadas.push({
          gestoriaId: gestoria.empresaId,
          gestoriaEmail: gestoria.email,
          gestoriaNombre: gestoria.nombre_empresa,
          fecha: new Date().toISOString()
        });
      }
      const solIdx = usuarios[empIdx].solicitudesGestoria?.findIndex(s => s.gestoriaId === gestoria.empresaId);
      if (solIdx !== undefined && solIdx !== -1) {
        usuarios[empIdx].solicitudesGestoria[solIdx].estado = 'aprobada';
      }
      const invIdx = usuarios[gesIdx].invitacionesRecibidas?.findIndex(s => s.empresaId === empresaId);
      if (invIdx !== undefined && invIdx !== -1) {
        usuarios[gesIdx].invitacionesRecibidas[invIdx].estado = 'aceptada';
      }
    } else {
      const invIdx = usuarios[gesIdx].invitacionesRecibidas?.findIndex(s => s.empresaId === empresaId);
      if (invIdx !== undefined && invIdx !== -1) {
        usuarios[gesIdx].invitacionesRecibidas[invIdx].estado = 'rechazada';
      }
    }

    saveUsuarios(usuarios);
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error al responder invitación' });
  }
});

// GET /gestoria/clientes — gestoria ve sus clientes
router.get('/clientes', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') {
      return res.status(401).json({ error: 'No autorizado' });
    }
    const usuarios = getUsuarios();
    const ges = usuarios.find(u => u.id === gestoria.id);
    const clientesEnriquecidos = (ges.clientesGestoria || []).map(function(c) {
      const empresa = usuarios.find(u => u.empresaId === c.empresaId);
      return Object.assign({}, c, { telefono: empresa ? (empresa.telefono || '') : '' });
    });
    res.json({ ok: true, clientes: clientesEnriquecidos, invitaciones: ges.invitacionesRecibidas || [] });
  } catch(e) {
    res.status(500).json({ error: 'Error' });
  }
});

// GET /gestoria/cliente/:empresaId/facturas
router.get('/cliente/:empresaId/facturas', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') {
      return res.status(401).json({ error: 'No autorizado' });
    }
    const { empresaId } = req.params;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso a esta empresa' });

    const dir = getEmpresaDir(empresaId);
    const facturasPath = path.join(dir, 'facturas.json');
    const facturas = fs.existsSync(facturasPath) ? JSON.parse(fs.readFileSync(facturasPath)) : [];
    res.json({ ok: true, facturas });
  } catch(e) {
    res.status(500).json({ error: 'Error' });
  }
});

// GET /gestoria/cliente/:empresaId/nominas
router.get('/cliente/:empresaId/nominas', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') {
      return res.status(401).json({ error: 'No autorizado' });
    }
    const { empresaId } = req.params;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso a esta empresa' });

    const dir = getEmpresaDir(empresaId);
    const nominasPath = path.join(dir, 'nominas.json');
    const nominas = fs.existsSync(nominasPath) ? JSON.parse(fs.readFileSync(nominasPath)) : [];
    res.json({ ok: true, nominas });
  } catch(e) {
    res.status(500).json({ error: 'Error' });
  }
});

// GET /gestoria/invitaciones — gestoria ve invitaciones pendientes
router.get('/invitaciones', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') {
      return res.status(401).json({ error: 'No autorizado' });
    }
    const usuarios = getUsuarios();
    const ges = usuarios.find(u => u.id === gestoria.id);
    res.json({ ok: true, invitaciones: ges.invitacionesRecibidas || [] });
  } catch(e) {
    res.status(500).json({ error: 'Error' });
  }
});

// POST /gestoria/revocar — empresa revoca acceso a gestoria
router.post('/revocar', (req, res) => {
  try {
    const empresa = getUserFromToken(req);
    if (!empresa || empresa.tipo === 'gestoria') {
      return res.status(401).json({ error: 'No autorizado' });
    }
    const { gestoriaId } = req.body;
    if (!gestoriaId) return res.status(400).json({ error: 'Falta gestoriaId' });

    const usuarios = getUsuarios();
    const empIdx = usuarios.findIndex(u => u.id === empresa.id);
    if (!usuarios[empIdx].gestoriasAprobadas) usuarios[empIdx].gestoriasAprobadas = [];

    usuarios[empIdx].gestoriasAprobadas = usuarios[empIdx].gestoriasAprobadas.filter(g => g.gestoriaId !== gestoriaId);
    if (usuarios[empIdx].solicitudesGestoria) {
      usuarios[empIdx].solicitudesGestoria = usuarios[empIdx].solicitudesGestoria.filter(s => s.gestoriaId !== gestoriaId);
    }

    const gesIdx = usuarios.findIndex(u => u.empresaId === gestoriaId);
    if (gesIdx !== -1) {
      if (usuarios[gesIdx].clientesGestoria) {
        usuarios[gesIdx].clientesGestoria = usuarios[gesIdx].clientesGestoria.filter(c => c.empresaId !== empresa.empresaId);
      }
    }

    saveUsuarios(usuarios);
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error al revocar' });
  }
});


// PUT /gestoria/cliente/:empresaId/facturas/:id — editar factura
router.put('/cliente/:empresaId/facturas/:id', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const { empresaId, id } = req.params;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso' });
    const dir = getEmpresaDir(empresaId);
    const facturasPath = path.join(dir, 'facturas.json');
    const facturas = fs.existsSync(facturasPath) ? JSON.parse(fs.readFileSync(facturasPath)) : [];
    const idx = facturas.findIndex(f => String(f.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: 'Factura no encontrada' });
    if (req.body._toggleContabilizado) {
      facturas[idx].contabilizado = !facturas[idx].contabilizado;
    } else {
      facturas[idx] = Object.assign(facturas[idx], req.body);
    }
    fs.writeFileSync(facturasPath, JSON.stringify(facturas, null, 2));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

// DELETE /gestoria/cliente/:empresaId/facturas/:id — borrar factura
router.delete('/cliente/:empresaId/facturas/:id', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const { empresaId, id } = req.params;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso' });
    const dir = getEmpresaDir(empresaId);
    const facturasPath = path.join(dir, 'facturas.json');
    let facturas = fs.existsSync(facturasPath) ? JSON.parse(fs.readFileSync(facturasPath)) : [];
    facturas = facturas.filter(f => String(f.id) !== String(id));
    fs.writeFileSync(facturasPath, JSON.stringify(facturas, null, 2));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

// PUT /gestoria/cliente/:empresaId/nominas/:id — editar nomina
router.put('/cliente/:empresaId/nominas/:id', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const { empresaId, id } = req.params;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso' });
    const dir = getEmpresaDir(empresaId);
    const nominasPath = path.join(dir, 'nominas.json');
    const nominas = fs.existsSync(nominasPath) ? JSON.parse(fs.readFileSync(nominasPath)) : [];
    const idx = nominas.findIndex(n => String(n.id) === String(id));
    if (idx === -1) return res.status(404).json({ error: 'Nomina no encontrada' });
    if (req.body._toggleContabilizado) {
      nominas[idx].contabilizado = !nominas[idx].contabilizado;
    } else {
      nominas[idx] = Object.assign(nominas[idx], req.body);
    }
    fs.writeFileSync(nominasPath, JSON.stringify(nominas, null, 2));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

// DELETE /gestoria/cliente/:empresaId/nominas/:id — borrar nomina
router.delete('/cliente/:empresaId/nominas/:id', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const { empresaId, id } = req.params;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso' });
    const dir = getEmpresaDir(empresaId);
    const nominasPath = path.join(dir, 'nominas.json');
    let nominas = fs.existsSync(nominasPath) ? JSON.parse(fs.readFileSync(nominasPath)) : [];
    nominas = nominas.filter(n => String(n.id) !== String(id));
    fs.writeFileSync(nominasPath, JSON.stringify(nominas, null, 2));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});



// GET /gestoria/cliente/:empresaId/archivo/:filename — ver archivo escaneado
router.get('/cliente/:empresaId/archivo/:filename', (req, res) => {
  try {
    const tokenQuery = req.query.token;
    if (tokenQuery) req.headers['authorization'] = 'Bearer ' + tokenQuery;
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const { empresaId, filename } = req.params;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso' });
    const filePath = path.join(dataDir, 'empresas', empresaId, 'uploads', filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
    res.sendFile(filePath);
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

// GET /gestoria/cliente/:empresaId/exportar/:tipo/:trimestre/:anno — exportar Excel
router.get('/cliente/:empresaId/exportar/:tipo/:trimestre/:anno', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const { empresaId, tipo, trimestre, anno } = req.params;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso' });
    const XLSX = require('xlsx');
    const dbPath = path.join(dataDir, 'empresas', empresaId, 'facturas.json');
    if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'Sin datos' });
    const facturas = JSON.parse(fs.readFileSync(dbPath));
    const lista = facturas.filter(f => f.tipo === tipo && f.trimestre === trimestre && String(f.anno) === String(anno));
    const datos = lista.map(f => ({
      'Nombre': f.nombre || '',
      'N Factura': f.numero_factura || '',
      'Fecha': f.fecha || '',
      'Base Imponible': Number(f.base_imponible) || 0,
      'IVA %': f.iva_porcentaje || 0,
      'IVA Importe': Number(f.iva_importe) || 0,
      'Total': Number(f.total) || 0,
      'Trimestre': f.trimestre || '',
      'Anno': f.anno || ''
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(datos);
    ws['!cols'] = [{ wch: 30 },{ wch: 15 },{ wch: 12 },{ wch: 15 },{ wch: 8 },{ wch: 15 },{ wch: 15 },{ wch: 10 },{ wch: 8 }];
    XLSX.utils.book_append_sheet(wb, ws, tipo === 'proveedor' ? 'Proveedores' : 'Clientes');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=TrimGest-' + tipo + '-' + trimestre + '-' + anno + '.xlsx');
    res.send(buffer);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Error al exportar' }); }
});

// GET /gestoria/cliente/:empresaId/exportar/nominas/:anno — exportar Excel nominas
router.get('/cliente/:empresaId/exportar/nominas/:anno', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const { empresaId, anno } = req.params;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso' });
    const XLSX = require('xlsx');
    const dbPath = path.join(dataDir, 'empresas', empresaId, 'nominas.json');
    if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'Sin datos' });
    const nominas = JSON.parse(fs.readFileSync(dbPath));
    const lista = nominas;
    const datos = lista.map(n => ({
      'Trabajador': n.trabajador || n.empleado || n.nombre || '',
      'Mes': n.mes || '',
      'Anno': n.anno || '',
      'Devengado': Number(n.devengado || n.salario_bruto) || 0,
      'Neto': Number(n.neto || n.salario_neto) || 0
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(datos);
    XLSX.utils.book_append_sheet(wb, ws, 'Nominas');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=TrimGest-nominas-' + anno + '.xlsx');
    res.send(buffer);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Error al exportar nominas' }); }
});

// GET /gestoria/cliente/:empresaId/pdf/:tipo/:trimestre/:anno — generar PDF
router.get('/cliente/:empresaId/pdf/:tipo/:trimestre/:anno', async (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const { empresaId, tipo, trimestre, anno } = req.params;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso' });
    const usuarios = getUsuarios();
    const empresa = usuarios.find(u => u.empresaId === empresaId);
    const nombreEmpresa = empresa ? empresa.nombre_empresa : empresaId;
    const dbPath = path.join(dataDir, 'empresas', empresaId, 'facturas.json');
    const uploadsDir = path.join(dataDir, 'empresas', empresaId, 'uploads');
    const { generarPDFGestoria } = require('./generar');
    const pdfBytes = await generarPDFGestoria(tipo, trimestre, anno, nombreEmpresa, dbPath, uploadsDir, true);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=TrimGest-' + tipo + '-' + trimestre + '-' + anno + '.pdf');
    res.send(Buffer.from(pdfBytes));
  } catch(e) { console.error(e); res.status(500).json({ error: 'Error al generar PDF' }); }
});

// GET /gestoria/cliente/:empresaId/pdf/nominas/:anno — PDF nominas
router.get('/cliente/:empresaId/pdf/nominas/:anno', async (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const { empresaId, anno } = req.params;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso' });
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const usuarios = getUsuarios();
    const empresa = usuarios.find(u => u.empresaId === empresaId);
    const nombreEmpresa = empresa ? empresa.nombre_empresa : empresaId;
    const nominasPath = path.join(dataDir, 'empresas', empresaId, 'nominas.json');
    const nominas = fs.existsSync(nominasPath) ? JSON.parse(fs.readFileSync(nominasPath)) : [];
    const lista = nominas.filter(n => String(n.anno) === String(anno));

    const pdfDoc = await PDFDocument.create();
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const page = pdfDoc.addPage([595, 842]);
    const { width, height } = page.getSize();

    page.drawRectangle({ x: 0, y: height - 100, width, height: 100, color: rgb(0.06, 0.06, 0.1) });
    page.drawText('TrimGest', { x: 40, y: height - 40, size: 24, font: bold, color: rgb(0.91, 0.78, 0.48) });
    page.drawText(nombreEmpresa, { x: 40, y: height - 65, size: 11, font: regular, color: rgb(0.8, 0.8, 0.8) });
    page.drawText('NOMINAS ' + anno, { x: 40, y: height - 85, size: 10, font: regular, color: rgb(0.6, 0.6, 0.7) });

    let y = height - 130;
    page.drawText('Trabajador', { x: 40, y, size: 9, font: bold, color: rgb(0.5, 0.5, 0.6) });
    page.drawText('Mes', { x: 220, y, size: 9, font: bold, color: rgb(0.5, 0.5, 0.6) });
    page.drawText('Coste empresa', { x: 300, y, size: 9, font: bold, color: rgb(0.5, 0.5, 0.6) });
    page.drawText('Neto', { x: 420, y, size: 9, font: bold, color: rgb(0.5, 0.5, 0.6) });
    y -= 15;
    page.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.5, color: rgb(0.3, 0.3, 0.4) });
    y -= 15;

    lista.forEach(function(n) {
      if (y < 60) return;
      var trab = (n.trabajador || n.empleado || n.nombre || '-').substring(0, 28);
      var mes = (n.mes || '-').substring(0, 10);
      var bruto = n.coste_empresa || n.devengado || 0;
      var neto = n.neto || n.salario_neto || 0;
      page.drawText(trab, { x: 40, y, size: 9, font: regular, color: rgb(0.1, 0.1, 0.15) });
      page.drawText(mes, { x: 220, y, size: 9, font: regular, color: rgb(0.1, 0.1, 0.15) });
      page.drawText(Number(bruto).toFixed(2) + ' EUR', { x: 300, y, size: 9, font: regular, color: rgb(0.1, 0.1, 0.15) });
      page.drawText(Number(neto).toFixed(2) + ' EUR', { x: 420, y, size: 9, font: bold, color: rgb(0.2, 0.5, 0.3) });
      y -= 20;
    });

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=nominas-' + anno + '.pdf');
    res.send(Buffer.from(pdfBytes));
  } catch(e) { console.error(e); res.status(500).json({ error: 'Error al generar PDF nominas' }); }
});

// GET /gestoria/cliente/:empresaId/archivo-nomina/:filename — ver PDF nomina original
router.get('/cliente/:empresaId/archivo-nomina/:filename', (req, res) => {
  try {
    const tokenQuery = req.query.token;
    if (tokenQuery) req.headers['authorization'] = 'Bearer ' + tokenQuery;
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const { empresaId, filename } = req.params;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso' });
    const filePath = path.join(dataDir, 'empresas', empresaId, 'uploads', filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
    res.sendFile(filePath);
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

// GET /gestoria/cliente/:empresaId/pdf/nominas/:anno — PDF dossier nominas
router.get('/cliente/:empresaId/pdf/nominas/:anno', async (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const { empresaId, anno } = req.params;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso' });
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const usuarios = getUsuarios();
    const empresa = usuarios.find(u => u.empresaId === empresaId);
    const nombreEmpresa = empresa ? empresa.nombre_empresa : empresaId;
    const nominasPath = path.join(dataDir, 'empresas', empresaId, 'nominas.json');
    const nominas = fs.existsSync(nominasPath) ? JSON.parse(fs.readFileSync(nominasPath)) : [];
    const lista = anno === 'todas' ? nominas : nominas.filter(n => String(n.anno) === String(anno));

    const pdfDoc = await PDFDocument.create();
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Portada resumen
    const portada = pdfDoc.addPage([595, 842]);
    const { width, height } = portada.getSize();
    portada.drawRectangle({ x: 0, y: height - 100, width, height: 100, color: rgb(0.06, 0.06, 0.1) });
    portada.drawText('TrimGest', { x: 40, y: height - 40, size: 24, font: bold, color: rgb(0.91, 0.78, 0.48) });
    portada.drawText(nombreEmpresa, { x: 40, y: height - 65, size: 11, font: regular, color: rgb(0.8, 0.8, 0.8) });
    portada.drawText('NOMINAS ' + anno, { x: 40, y: height - 85, size: 10, font: regular, color: rgb(0.6, 0.6, 0.7) });

    let y = height - 130;
    portada.drawText('Trabajador', { x: 40, y, size: 9, font: bold, color: rgb(0.5, 0.5, 0.6) });
    portada.drawText('Mes', { x: 220, y, size: 9, font: bold, color: rgb(0.5, 0.5, 0.6) });
    portada.drawText('Coste empresa', { x: 300, y, size: 9, font: bold, color: rgb(0.5, 0.5, 0.6) });
    portada.drawText('Neto', { x: 430, y, size: 9, font: bold, color: rgb(0.5, 0.5, 0.6) });
    y -= 15;
    portada.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.5, color: rgb(0.3, 0.3, 0.4) });
    y -= 15;
    lista.forEach(function(n) {
      if (y < 60) return;
      var trab = (n.trabajador || n.empleado || n.nombre || '-').substring(0, 28);
      var bruto = n.coste_empresa || n.devengado || 0;
      var neto = n.neto || n.salario_neto || 0;
      portada.drawText(trab, { x: 40, y, size: 9, font: regular, color: rgb(0.1, 0.1, 0.15) });
      portada.drawText((n.mes || '-'), { x: 220, y, size: 9, font: regular, color: rgb(0.1, 0.1, 0.15) });
      portada.drawText(Number(bruto).toFixed(2) + ' EUR', { x: 300, y, size: 9, font: regular, color: rgb(0.1, 0.1, 0.15) });
      portada.drawText(Number(neto).toFixed(2) + ' EUR', { x: 430, y, size: 9, font: bold, color: rgb(0.2, 0.5, 0.3) });
      y -= 18;
    });

    // Adjuntar PDFs originales de cada nomina
    for (const n of lista) {
      if (!n.archivo) continue;
      const archivoPath = path.join(dataDir, 'empresas', empresaId, 'uploads', n.archivo);
      if (!fs.existsSync(archivoPath)) continue;
      try {
        const pdfBytes = fs.readFileSync(archivoPath);
        const nominaPdf = await PDFDocument.load(pdfBytes);
        const pages = await pdfDoc.copyPages(nominaPdf, nominaPdf.getPageIndices());
        pages.forEach(p => pdfDoc.addPage(p));
      } catch(e) { console.error('Error adjuntando nomina:', n.archivo, e.message); }
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=nominas-' + anno + '.pdf');
    res.send(Buffer.from(pdfBytes));
  } catch(e) { console.error(e); res.status(500).json({ error: 'Error al generar PDF nominas' }); }
});

// POST /gestoria/cliente/:empresaId/pdf/nominas-seleccionadas
router.post('/cliente/:empresaId/pdf/nominas-seleccionadas', async (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const { empresaId } = req.params;
    const { ids } = req.body;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso' });
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const nominasPath = path.join(dataDir, 'empresas', empresaId, 'nominas.json');
    const todasNominas = fs.existsSync(nominasPath) ? JSON.parse(fs.readFileSync(nominasPath)) : [];
    const lista = todasNominas.filter(n => ids.includes(String(n.id)));

    const pdfDoc = await PDFDocument.create();
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const usuarios = getUsuarios();
    const empresa = usuarios.find(u => u.empresaId === empresaId);
    const nombreEmpresa = empresa ? empresa.nombre_empresa : empresaId;

    // Portada resumen
    const portada = pdfDoc.addPage([595, 842]);
    const { width, height } = portada.getSize();
    portada.drawRectangle({ x: 0, y: height - 100, width, height: 100, color: rgb(0.06, 0.06, 0.1) });
    portada.drawText('TrimGest', { x: 40, y: height - 40, size: 24, font: bold, color: rgb(0.91, 0.78, 0.48) });
    portada.drawText(nombreEmpresa, { x: 40, y: height - 65, size: 11, font: regular, color: rgb(0.8, 0.8, 0.8) });
    portada.drawText('NOMINAS SELECCIONADAS', { x: 40, y: height - 85, size: 10, font: regular, color: rgb(0.6, 0.6, 0.7) });

    let y = height - 130;
    portada.drawText('Trabajador', { x: 40, y, size: 9, font: bold, color: rgb(0.5,0.5,0.6) });
    portada.drawText('Mes', { x: 220, y, size: 9, font: bold, color: rgb(0.5,0.5,0.6) });
    portada.drawText('Coste empresa', { x: 300, y, size: 9, font: bold, color: rgb(0.5,0.5,0.6) });
    portada.drawText('Neto', { x: 430, y, size: 9, font: bold, color: rgb(0.5,0.5,0.6) });
    y -= 15;
    portada.drawLine({ start: { x: 40, y }, end: { x: 555, y }, thickness: 0.5, color: rgb(0.3,0.3,0.4) });
    y -= 15;

    lista.forEach(function(n) {
      if (y < 60) return;
      var trab = (n.trabajador || n.empleado || n.nombre || '-').substring(0, 28);
      var bruto = n.coste_empresa || n.devengado || 0;
      var neto = n.neto || n.salario_neto || 0;
      portada.drawText(trab, { x: 40, y, size: 9, font: regular, color: rgb(0.1,0.1,0.15) });
      portada.drawText((n.mes||'-'), { x: 220, y, size: 9, font: regular, color: rgb(0.1,0.1,0.15) });
      portada.drawText(Number(bruto).toFixed(2)+' EUR', { x: 300, y, size: 9, font: regular, color: rgb(0.1,0.1,0.15) });
      portada.drawText(Number(neto).toFixed(2)+' EUR', { x: 430, y, size: 9, font: bold, color: rgb(0.2,0.5,0.3) });
      y -= 18;
    });

    // Adjuntar PDFs originales
    for (const n of lista) {
      if (!n.archivo) continue;
      const archivoPath = path.join(dataDir, 'empresas', empresaId, 'uploads', n.archivo);
      if (!fs.existsSync(archivoPath)) continue;
      try {
        const pdfBytes = fs.readFileSync(archivoPath);
        const nominaPdf = await PDFDocument.load(pdfBytes);
        const pages = await pdfDoc.copyPages(nominaPdf, nominaPdf.getPageIndices());
        pages.forEach(p => pdfDoc.addPage(p));
      } catch(e) { console.error('Error adjuntando nomina:', e.message); }
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=nominas-seleccionadas.pdf');
    res.send(Buffer.from(pdfBytes));
  } catch(e) { console.error(e); res.status(500).json({ error: 'Error al generar PDF' }); }
});


// POST /gestoria/cliente/:empresaId/excel/facturas-seleccionadas
router.post('/cliente/:empresaId/excel/facturas-seleccionadas', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const { empresaId } = req.params;
    const { ids, tipo } = req.body;
    if (!ids || !ids.length) return res.status(400).json({ error: 'Sin facturas seleccionadas' });
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso' });
    const XLSX = require('xlsx');
    const dbPath = path.join(dataDir, 'empresas', empresaId, 'facturas.json');
    if (!fs.existsSync(dbPath)) return res.status(404).json({ error: 'Sin datos' });
    const facturas = JSON.parse(fs.readFileSync(dbPath));
    const lista = facturas.filter(f => ids.includes(String(f.id)));
    const datos = lista.map(f => ({
      'Nombre': f.nombre || '',
      'N Factura': f.numero_factura || '',
      'Fecha': f.fecha || '',
      'Base Imponible': Number(f.base_imponible) || 0,
      'IVA %': f.iva_porcentaje || 0,
      'IVA Importe': Number(f.iva_importe) || 0,
      'Total': Number(f.total) || 0,
      'Trimestre': f.trimestre || '',
      'Anno': f.anno || '',
      'Contabilizado': f.contabilizado ? 'Si' : 'No'
    }));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(datos);
    ws['!cols'] = [{ wch: 30 },{ wch: 15 },{ wch: 12 },{ wch: 15 },{ wch: 8 },{ wch: 15 },{ wch: 15 },{ wch: 10 },{ wch: 8 },{ wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws, tipo === 'proveedor' ? 'Proveedores' : 'Clientes');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=facturas-seleccionadas.xlsx');
    res.send(buffer);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Error al exportar' }); }
});

// POST /gestoria/cliente/:empresaId/pdf/facturas-seleccionadas
router.post('/cliente/:empresaId/pdf/facturas-seleccionadas', async (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const { empresaId } = req.params;
    const { ids, tipo, trimestre, anno, todas, conAdjuntos } = req.body;
    const tieneAcceso = gestoria.clientesGestoria?.find(c => c.empresaId === empresaId);
    if (!tieneAcceso) return res.status(403).json({ error: 'Sin acceso' });
    const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
    const usuarios = getUsuarios();
    const empresa = usuarios.find(u => u.empresaId === empresaId);
    const nombreEmpresa = empresa ? empresa.nombre_empresa : empresaId;
    const facturasPath = path.join(dataDir, 'empresas', empresaId, 'facturas.json');
    const todasFacturas = fs.existsSync(facturasPath) ? JSON.parse(fs.readFileSync(facturasPath)) : [];
    let lista;
    if (todas) {
      lista = todasFacturas.filter(f => {
        if (f.tipo !== tipo) return false;
        if (String(f.anno) !== String(anno)) return false;
        if (trimestre && f.trimestre !== trimestre) return false;
        return true;
      });
    } else {
      lista = todasFacturas.filter(f => ids.includes(String(f.id)));
    }
    // conAdjuntos ya viene del destructuring

    const pdfDoc = await PDFDocument.create();
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    // Portada resumen
    const portada = pdfDoc.addPage([595, 842]);
    const { width, height } = portada.getSize();
    portada.drawRectangle({ x: 0, y: height-100, width, height: 100, color: rgb(0.06,0.06,0.1) });
    portada.drawText('TrimGest', { x: 40, y: height-40, size: 24, font: bold, color: rgb(0.91,0.78,0.48) });
    portada.drawText(nombreEmpresa, { x: 40, y: height-65, size: 11, font: regular, color: rgb(0.8,0.8,0.8) });
    portada.drawText('FACTURAS ' + (tipo==='proveedor'?'PROVEEDORES':'CLIENTES') + ' SELECCIONADAS', { x: 40, y: height-85, size: 10, font: regular, color: rgb(0.6,0.6,0.7) });

    let y = height-130;
    portada.drawText('Nombre', { x: 40, y, size: 8, font: bold, color: rgb(0.5,0.5,0.6) });
    portada.drawText('Fecha', { x: 170, y, size: 8, font: bold, color: rgb(0.5,0.5,0.6) });
    portada.drawText('N Factura', { x: 230, y, size: 8, font: bold, color: rgb(0.5,0.5,0.6) });
    portada.drawText('Base', { x: 310, y, size: 8, font: bold, color: rgb(0.5,0.5,0.6) });
    portada.drawText('IVA%', { x: 360, y, size: 8, font: bold, color: rgb(0.5,0.5,0.6) });
    portada.drawText('IVA EUR', { x: 395, y, size: 8, font: bold, color: rgb(0.5,0.5,0.6) });
    portada.drawText('Total', { x: 450, y, size: 8, font: bold, color: rgb(0.5,0.5,0.6) });
    portada.drawText('Pago', { x: 505, y, size: 8, font: bold, color: rgb(0.5,0.5,0.6) });
    y -= 15;
    portada.drawLine({ start: { x:40, y }, end: { x:555, y }, thickness: 0.5, color: rgb(0.3,0.3,0.4) });
    y -= 15;

    lista.forEach(function(f) {
      if (y < 60) return;
      var nombre = (f.nombre||f.proveedor||f.emisor||f.cliente||'-').substring(0,22);
      var fecha = (f.fecha||'-').substring(0,12);
      var num = (f.numero_factura||'-').substring(0,12);
      var base = Number(f.base_imponible||0).toFixed(2);
      var total = Number(f.total||0).toFixed(2);
      var ivaPct = String(f.iva_porcentaje||0) + '%';
      var ivaImp = Number(f.iva_importe||0).toFixed(2);
      var pago = f.estado_pago ? f.estado_pago.charAt(0).toUpperCase() + f.estado_pago.slice(1) : '-';
      portada.drawText(nombre, { x:40, y, size:8, font:regular, color:rgb(0.1,0.1,0.15) });
      portada.drawText(fecha, { x:170, y, size:8, font:regular, color:rgb(0.1,0.1,0.15) });
      portada.drawText(num, { x:230, y, size:8, font:regular, color:rgb(0.1,0.1,0.15) });
      portada.drawText(base+' EUR', { x:310, y, size:8, font:regular, color:rgb(0.1,0.1,0.15) });
      portada.drawText(ivaPct, { x:360, y, size:8, font:regular, color:rgb(0.1,0.1,0.15) });
      portada.drawText(ivaImp+' EUR', { x:395, y, size:8, font:regular, color:rgb(0.1,0.1,0.15) });
      portada.drawText(total+' EUR', { x:450, y, size:8, font:bold, color:rgb(0.2,0.5,0.3) });
      portada.drawText(pago, { x:505, y, size:8, font:regular, color:rgb(0.1,0.1,0.15) });
      y -= 18;
    });

    // Adjuntar PDFs originales solo si conAdjuntos=true
    if (conAdjuntos) {
      for (const f of lista) {
        if (!f.archivo) continue;
        const archivoPath = path.join(dataDir, 'empresas', empresaId, 'uploads', f.archivo);
        if (!fs.existsSync(archivoPath)) continue;
        try {
          const pdfBytes = fs.readFileSync(archivoPath);
          const facturaPdf = await PDFDocument.load(pdfBytes);
          const pages = await pdfDoc.copyPages(facturaPdf, facturaPdf.getPageIndices());
          pages.forEach(p => pdfDoc.addPage(p));
        } catch(e) { console.error('Error adjuntando factura:', e.message); }
      }
    }

    const pdfBytes = await pdfDoc.save();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=facturas-seleccionadas.pdf');
    res.send(Buffer.from(pdfBytes));
  } catch(e) { console.error(e); res.status(500).json({ error: 'Error al generar PDF' }); }
});


// GET perfil gestoria
router.get('/perfil', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria) return res.status(401).json({ error: 'No autorizado' });
    const usuarios = getUsuarios();
    const usuario = usuarios.find(u => u.id === gestoria.id);
    if (!usuario) return res.status(404).json({ error: 'Gestoria no encontrada' });
    res.json({ ok: true, nombre: usuario.nombre_empresa || usuario.nombre || '', email: usuario.email, telefono: usuario.telefono || '' });
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

// PUT perfil gestoria
router.put('/perfil', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria) return res.status(401).json({ error: 'No autorizado' });
    const usuarios = getUsuarios();
    const idx = usuarios.findIndex(u => u.id === gestoria.id);
    if (idx === -1) return res.status(404).json({ error: 'Gestoria no encontrada' });
    const { telefono, nombre } = req.body;
    if (telefono !== undefined) usuarios[idx].telefono = telefono;
    if (nombre !== undefined) usuarios[idx].nombre_empresa = nombre;
    fs.writeFileSync(path.join(__dirname, '../data/usuarios.json'), JSON.stringify(usuarios, null, 2));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'Error' }); }
});

// POST /gestoria/quitar-demo — elimina el cliente demo de la lista
router.post('/quitar-demo', (req, res) => {
  try {
    const gestoria = getUserFromToken(req);
    if (!gestoria || gestoria.tipo !== 'gestoria') return res.status(401).json({ error: 'No autorizado' });
    const usuarios = getUsuarios();
    const idx = usuarios.findIndex(u => u.empresaId === gestoria.empresaId);
    if (idx === -1) return res.status(404).json({ error: 'No encontrado' });
    usuarios[idx].clientesGestoria = (usuarios[idx].clientesGestoria || []).filter(c => c.empresaId !== 'emp_demo_construcciones');
    saveUsuarios(usuarios);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});




// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MÓDULO BANCO — gestoría accede al banco de sus clientes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const multer = require('multer');
const multerStorage = multer.memoryStorage();
const uploadBanco = multer({ storage: multerStorage });

function getBancoPath(empresaId) {
  return path.join(baseDataDir, 'empresas', empresaId, 'banco.json');
}
function getBanco(empresaId) {
  const p = getBancoPath(empresaId);
  if (!fs.existsSync(p)) return { movimientos: [], ultima_fecha: null };
  return JSON.parse(fs.readFileSync(p));
}
function saveBanco(empresaId, data) {
  fs.writeFileSync(getBancoPath(empresaId), JSON.stringify(data, null, 2));
}
function getFacturasBanco(empresaId) {
  const p = path.join(baseDataDir, 'empresas', empresaId, 'facturas.json');
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p));
}
function getNominasBanco(empresaId) {
  const p = path.join(baseDataDir, 'empresas', empresaId, 'nominas.json');
  if (!fs.existsSync(p)) return [];
  return JSON.parse(fs.readFileSync(p));
}
function parsearImporteBanco(str) {
  if (!str) return 0;
  var s = str.replace('EUR','').replace('+','').trim();
  s = s.replace(/\./g,'').replace(',','.');
  return parseFloat(s);
}
function parsearFechaBanco(str) {
  if (!str) return null;
  const parts = str.trim().split('/');
  if (parts.length !== 3) return null;
  return new Date(parts[2], parts[1]-1, parts[0]);
}
function fechaStrBanco(date) {
  if (!date) return null;
  const d = new Date(date);
  return d.getDate().toString().padStart(2,'0') + '/' + (d.getMonth()+1).toString().padStart(2,'0') + '/' + d.getFullYear();
}
function cruzarConFacturasBanco(movimiento, facturas, idsAsignados) {
  const imp = Math.abs(movimiento.importe);
  const fecha = new Date(movimiento.fecha);
  const asignados = idsAsignados || [];
  const candidatos = facturas.filter(function(f) {
    const totalF = Math.abs(parseFloat(f.total));
    return Math.abs(totalF - imp) <= 0.02 && !asignados.includes(f.id);
  });
  if (candidatos.length === 0) return null;
  if (candidatos.length === 1) return candidatos[0];
  candidatos.sort(function(a, b) {
    var da = Math.abs(new Date(a.fecha) - fecha);
    var db = Math.abs(new Date(b.fecha) - fecha);
    return da - db;
  });
  return candidatos[0];
}
function verificarAccesoBanco(req, empresaId) {
  const gestoria = getUserFromToken(req);
  if (!gestoria || gestoria.tipo !== 'gestoria') return null;
  const usuarios = getUsuarios();
  const ges = usuarios.find(u => u.empresaId === gestoria.empresaId);
  if (!ges) return null;
  const tieneAcceso = (ges.clientesGestoria || []).find(c => c.empresaId === empresaId);
  if (!tieneAcceso) return null;
  return gestoria;
}

// GET /gestoria/cliente/:empresaId/banco
router.get('/cliente/:empresaId/banco', (req, res) => {
  try {
    if (!verificarAccesoBanco(req, req.params.empresaId)) return res.status(401).json({ error: 'No autorizado' });
    const banco = getBanco(req.params.empresaId);
    res.json({ ok: true, movimientos: banco.movimientos || [], ultima_fecha: banco.ultima_fecha });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /gestoria/cliente/:empresaId/banco/subir
router.post('/cliente/:empresaId/banco/subir', uploadBanco.single('extracto'), (req, res) => {
  try {
    if (!verificarAccesoBanco(req, req.params.empresaId)) return res.status(401).json({ error: 'No autorizado' });
    if (!req.file) return res.status(400).json({ error: 'No se ha subido ningún archivo' });
    const empresaId = req.params.empresaId;
    const contenido = req.file.buffer.toString('utf8');
    const lineas = contenido.split('\n').filter(l => l.trim());
    const cabecera = lineas[0].toLowerCase();
    if (!cabecera.includes('concepto') || !cabecera.includes('fecha') || !cabecera.includes('importe')) {
      return res.status(400).json({ error: 'Formato de banco no reconocido. Por favor usa el extracto de CaixaBank.' });
    }
    const banco = getBanco(empresaId);
    const facturas = getFacturasBanco(empresaId);
    const ultimaFecha = banco.ultima_fecha ? new Date(banco.ultima_fecha) : null;
    const nuevosMovimientos = [];
    let maxFecha = ultimaFecha;
    for (let i = 1; i < lineas.length; i++) {
      const cols = lineas[i].split(';');
      if (cols.length < 3) continue;
      const concepto = cols[0].trim();
      const fechaRaw = cols[1].trim();
      const importeRaw = cols[2].trim();
      const fecha = parsearFechaBanco(fechaRaw);
      if (!fecha) continue;
      const importe = parsearImporteBanco(importeRaw);
      if (ultimaFecha && fecha <= ultimaFecha) continue;
      const idsYaAsignados = nuevosMovimientos.filter(m => m.factura_id).map(m => m.factura_id).concat(banco.movimientos.filter(m => m.factura_id).map(m => m.factura_id));
      const facturaMatch = cruzarConFacturasBanco({ importe, fecha }, facturas, idsYaAsignados);
      const mov = {
        id: Date.now() + i,
        concepto, fecha: fecha.toISOString(), fecha_display: fechaRaw, importe,
        estado: facturaMatch ? 'conciliado' : 'pendiente',
        conciliado: !!facturaMatch,
        factura_id: facturaMatch ? facturaMatch.id : null,
        factura_nombre: facturaMatch ? facturaMatch.nombre : null,
        factura_total: facturaMatch ? facturaMatch.total : null,
        manual: false
      };
      nuevosMovimientos.push(mov);
      if (!maxFecha || fecha > maxFecha) maxFecha = fecha;
    }
    banco.movimientos = banco.movimientos.concat(nuevosMovimientos);
    banco.ultima_fecha = maxFecha ? maxFecha.toISOString() : banco.ultima_fecha;
    banco.ultima_importacion = new Date().toISOString();
    saveBanco(empresaId, banco);
    res.json({ ok: true, nuevos: nuevosMovimientos.length, conciliados: nuevosMovimientos.filter(m => m.conciliado).length, sin_cruzar: nuevosMovimientos.filter(m => !m.conciliado).length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /gestoria/cliente/:empresaId/banco/actualizar-movimiento
router.post('/cliente/:empresaId/banco/actualizar-movimiento', (req, res) => {
  try {
    if (!verificarAccesoBanco(req, req.params.empresaId)) return res.status(401).json({ error: 'No autorizado' });
    const empresaId = req.params.empresaId;
    const { movimiento_id, estado, factura_id, factura_nombre, factura_total, nomina_id, motivo } = req.body;
    const banco = getBanco(empresaId);
    const idx = banco.movimientos.findIndex(m => m.id === movimiento_id);
    if (idx === -1) return res.status(404).json({ error: 'Movimiento no encontrado' });
    banco.movimientos[idx].estado = estado || banco.movimientos[idx].estado;
    banco.movimientos[idx].conciliado = estado === 'conciliado' || estado === 'sin_factura';
    banco.movimientos[idx].factura_id = factura_id || null;
    banco.movimientos[idx].factura_nombre = factura_id ? factura_nombre : null;
    banco.movimientos[idx].factura_total = factura_id ? factura_total : null;
    banco.movimientos[idx].nomina_id = nomina_id || null;
    banco.movimientos[idx].motivo = motivo || null;
    banco.movimientos[idx].manual = true;
    saveBanco(empresaId, banco);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /gestoria/cliente/:empresaId/banco/reconciliar
router.post('/cliente/:empresaId/banco/reconciliar', (req, res) => {
  try {
    if (!verificarAccesoBanco(req, req.params.empresaId)) return res.status(401).json({ error: 'No autorizado' });
    const empresaId = req.params.empresaId;
    const banco = getBanco(empresaId);
    const facturas = getFacturasBanco(empresaId);
    let actualizados = 0;
    banco.movimientos.forEach(function(m) {
      if (m.estado && m.estado !== 'pendiente') return;
      const fecha = new Date(m.fecha);
      const idsYaConciliados = banco.movimientos.filter(function(x) { return x.factura_id && x.id !== m.id; }).map(function(x) { return x.factura_id; });
      const match = cruzarConFacturasBanco({ importe: m.importe, fecha }, facturas, idsYaConciliados);
      if (match) {
        m.estado = 'conciliado'; m.conciliado = true;
        m.factura_id = match.id; m.factura_nombre = match.nombre; m.factura_total = match.total;
        actualizados++;
      }
    });
    saveBanco(empresaId, banco);
    res.json({ ok: true, actualizados });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /gestoria/cliente/:empresaId/banco/resetear
router.post('/cliente/:empresaId/banco/resetear', (req, res) => {
  try {
    if (!verificarAccesoBanco(req, req.params.empresaId)) return res.status(401).json({ error: 'No autorizado' });
    saveBanco(req.params.empresaId, { movimientos: [], ultima_fecha: null });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
