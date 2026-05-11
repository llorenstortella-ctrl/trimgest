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

module.exports = router;
