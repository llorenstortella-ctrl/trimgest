const express = require('express');
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
    const { email, password, nombre_empresa } = req.body;
    if (!email || !password || !nombre_empresa) {
      return res.status(400).json({ error: 'Faltan datos' });
    }
    const usuarios = getUsuarios();
    if (usuarios.find(u => u.email === email)) {
      return res.status(400).json({ error: 'Email ya registrado' });
    }
    const hash = await bcrypt.hash(password, 10);
    const gestoriaId = 'ges_' + Date.now();
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
      fecha_registro: new Date().toISOString()
    };
    usuarios.push(nuevo);
    saveUsuarios(usuarios);
    const token = jwt.sign({ id: nuevo.id, empresaId: gestoriaId, tipo: 'gestoria' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ ok: true, token, nombre_empresa, empresaId: gestoriaId, tipo: 'gestoria' });
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
router.post('/invitar', (req, res) => {
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
    res.json({ ok: true, solicitudes: emp.solicitudesGestoria || [], aprobadas: emp.gestoriasAprobadas || [] });
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

    const solIdx = usuarios[empIdx].solicitudesGestoria.findIndex(s => s.gestoriaId === gestoriaId);
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
    res.json({ ok: true, clientes: ges.clientesGestoria || [], invitaciones: ges.invitacionesRecibidas || [] });
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

module.exports = router;
