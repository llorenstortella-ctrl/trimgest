const fs = require('fs');
const path = require('path');

const GITHUB_TOKEN = process.env.GITHUB_BACKUP_TOKEN;
const GITHUB_REPO = 'llorenstortella-ctrl/trimgest-backups';
const GITHUB_API = 'https://api.github.com';

async function subirArchivoGitHub(nombre, contenido) {
  try {
    const url = GITHUB_API + '/repos/' + GITHUB_REPO + '/contents/backups/' + nombre;
    const encoded = Buffer.from(contenido).toString('base64');

    // Ver si el archivo ya existe para obtener su SHA
    let sha = null;
    try {
      const getRes = await fetch(url, {
        headers: {
          'Authorization': 'token ' + GITHUB_TOKEN,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (getRes.ok) {
        const data = await getRes.json();
        sha = data.sha;
      }
    } catch(e) {}

    const body = {
      message: 'Backup ' + nombre,
      content: encoded
    };
    if (sha) body.sha = sha;

    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': 'token ' + GITHUB_TOKEN,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (res.ok) {
      console.log('Subido:', nombre);
    } else {
      const err = await res.json();
      console.error('Error subiendo', nombre, err.message);
    }
  } catch(e) {
    console.error('Error subiendo', nombre, e.message);
  }
}

async function ejecutarBackup() {
  if (!GITHUB_TOKEN) {
    console.log('Backup: GITHUB_BACKUP_TOKEN no configurado, saltando');
    return;
  }
  try {
    const dataDir = path.join(__dirname, '../data');
    const fecha = new Date().toISOString().split('T')[0];

    // Backup usuarios.json
    const usuariosPath = path.join(dataDir, 'usuarios.json');
    if (fs.existsSync(usuariosPath)) {
      const contenido = fs.readFileSync(usuariosPath, 'utf8');
      await subirArchivoGitHub('usuarios-' + fecha + '.json', contenido);
    }

    // Backup facturas y nominas de cada empresa
    const empresasDir = path.join(dataDir, 'empresas');
    if (fs.existsSync(empresasDir)) {
      const empresas = fs.readdirSync(empresasDir);
      for (const empresaId of empresas) {
        const facturasPath = path.join(empresasDir, empresaId, 'facturas.json');
        const nominasPath = path.join(empresasDir, empresaId, 'nominas.json');
        if (fs.existsSync(facturasPath)) {
          const contenido = fs.readFileSync(facturasPath, 'utf8');
          await subirArchivoGitHub(empresaId + '-facturas-' + fecha + '.json', contenido);
        }
        if (fs.existsSync(nominasPath)) {
          const contenido = fs.readFileSync(nominasPath, 'utf8');
          await subirArchivoGitHub(empresaId + '-nominas-' + fecha + '.json', contenido);
        }
      }
    }

    console.log('Backup completado:', new Date().toISOString());
  } catch(e) {
    console.error('Error en backup:', e.message);
  }
}

module.exports = { ejecutarBackup };
