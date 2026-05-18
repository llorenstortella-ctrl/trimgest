const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');

const FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

async function getAuthClient() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });
  return auth;
}

async function subirArchivo(drive, nombre, contenido, mimeType) {
  try {
    const res = await drive.files.list({
      q: `name='${nombre}' and '${FOLDER_ID}' in parents and trashed=false`,
      fields: 'files(id, name)'
    });
    const fileMetadata = { name: nombre, parents: [FOLDER_ID] };
    const media = { mimeType, body: require('stream').Readable.from([contenido]) };
    if (res.data.files && res.data.files.length > 0) {
      await drive.files.update({ fileId: res.data.files[0].id, media });
      console.log('Actualizado:', nombre);
    } else {
      await drive.files.create({ requestBody: fileMetadata, media });
      console.log('Creado:', nombre);
    }
  } catch(e) {
    console.error('Error subiendo', nombre, e.message);
  }
}

async function ejecutarBackup() {
  if (!FOLDER_ID || !process.env.GOOGLE_SERVICE_ACCOUNT) {
    console.log('Backup: variables no configuradas, saltando');
    return;
  }
  try {
    const auth = await getAuthClient();
    const drive = google.drive({ version: 'v3', auth });
    const dataDir = path.join(__dirname, '../data');
    const fecha = new Date().toISOString().split('T')[0];

    // Backup usuarios.json
    const usuariosPath = path.join(dataDir, 'usuarios.json');
    if (fs.existsSync(usuariosPath)) {
      const contenido = fs.readFileSync(usuariosPath, 'utf8');
      await subirArchivo(drive, `usuarios-${fecha}.json`, contenido, 'application/json');
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
          await subirArchivo(drive, `${empresaId}-facturas-${fecha}.json`, contenido, 'application/json');
        }
        if (fs.existsSync(nominasPath)) {
          const contenido = fs.readFileSync(nominasPath, 'utf8');
          await subirArchivo(drive, `${empresaId}-nominas-${fecha}.json`, contenido, 'application/json');
        }
      }
    }

    console.log('Backup completado:', new Date().toISOString());
  } catch(e) {
    console.error('Error en backup:', e.message);
  }
}

module.exports = { ejecutarBackup };
