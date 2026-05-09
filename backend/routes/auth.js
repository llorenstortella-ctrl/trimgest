const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const configPath = process.env.DATA_PATH 
  ? path.join(path.dirname(process.env.DATA_PATH), 'config.json')
  : path.join(__dirname, '../data/config.json');

const EMAIL = 'feimcateva@gmail.com';

function getConfig() {
  if (!fs.existsSync(configPath)) {
    const defaultConfig = { pin: '1234', codigo_recuperacion: null, codigo_expira: null };
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig));
    return defaultConfig;
  }
  return JSON.parse(fs.readFileSync(configPath));
}

function saveConfig(config) {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

// Verificar PIN
router.post('/verificar', (req, res) => {
  const { pin } = req.body;
  const config = getConfig();
  if (pin === config.pin) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, error: 'PIN incorrecto' });
  }
});

// Cambiar PIN
router.post('/cambiar-pin', (req, res) => {
  const { pin_actual, pin_nuevo } = req.body;
  const config = getConfig();
  if (pin_actual !== config.pin) {
    return res.status(401).json({ error: 'PIN actual incorrecto' });
  }
  config.pin = pin_nuevo;
  saveConfig(config);
  res.json({ ok: true });
});

// Solicitar recuperación
router.post('/recuperar', async (req, res) => {
  const config = getConfig();
  const codigo = Math.floor(100000 + Math.random() * 900000).toString();
  const expira = Date.now() + 15 * 60 * 1000; // 15 minutos

  config.codigo_recuperacion = codigo;
  config.codigo_expira = expira;
  saveConfig(config);

  try {
    await resend.emails.send({
      from: 'TrimGest <onboarding@resend.dev>',
      to: EMAIL,
      subject: 'Código de recuperación TrimGest',
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
          <h2 style="color: #1a1a20;">TrimGest</h2>
          <p>Tu código de recuperación es:</p>
          <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #e8c87a; padding: 20px; background: #1a1a20; border-radius: 10px; text-align: center;">
            ${codigo}
          </div>
          <p style="color: #888; font-size: 12px;">Válido durante 15 minutos.</p>
        </div>
      `
    });
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error enviando email' });
  }
});

// Verificar código y resetear PIN
router.post('/resetear', (req, res) => {
  const { codigo, pin_nuevo } = req.body;
  const config = getConfig();
  if (!config.codigo_recuperacion || codigo !== config.codigo_recuperacion) {
    return res.status(401).json({ error: 'Código incorrecto' });
  }
  if (Date.now() > config.codigo_expira) {
    return res.status(401).json({ error: 'Código expirado' });
  }
  config.pin = pin_nuevo;
  config.codigo_recuperacion = null;
  config.codigo_expira = null;
  saveConfig(config);
  res.json({ ok: true });
});

module.exports = router;