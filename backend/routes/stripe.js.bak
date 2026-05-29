const express = require('express');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const auth = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const baseDataDir = path.join(__dirname, '../data');
const getUsuarios = () => JSON.parse(fs.readFileSync(path.join(baseDataDir, 'usuarios.json')));
const saveUsuarios = (u) => fs.writeFileSync(path.join(baseDataDir, 'usuarios.json'), JSON.stringify(u, null, 2));

const PLANES = {
  basico: { precio: 1000, nombre: 'Plan Basico', limite: 100 },
  estandar: { precio: 2000, nombre: 'Plan Estandar', limite: 200 }
};

const PAQUETES_SUBIDAS = {
  p10:  { subidas: 10,  precio: 200,  nombre: '10 subidas extra' },
  p50:  { subidas: 50,  precio: 750,  nombre: '50 subidas extra' },
  p100: { subidas: 100, precio: 1000, nombre: '100 subidas extra' },
  p200: { subidas: 200, precio: 1600, nombre: '200 subidas extra' }
};

// Crear sesion de pago suscripcion
router.post('/checkout', auth, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLANES[plan]) return res.status(400).json({ error: 'Plan no valido' });

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: PLANES[plan].nombre },
          unit_amount: PLANES[plan].precio,
          recurring: { interval: 'month' }
        },
        quantity: 1
      }],
      success_url: 'https://trimgest.es/app?pago=ok&plan=' + plan,
      cancel_url: 'https://trimgest.es/app?pago=cancelado',
      metadata: { empresaId: req.empresaId, plan: plan },
      allow_promotion_codes: true
    });

    res.json({ url: session.url });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error creando sesion de pago' });
  }
});

// Crear sesion de pago subidas extra (pago unico)
router.post('/comprar-subidas', auth, async (req, res) => {
  try {
    const { paquete } = req.body;
    if (!PAQUETES_SUBIDAS[paquete]) return res.status(400).json({ error: 'Paquete no valido' });
    const p = PAQUETES_SUBIDAS[paquete];

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: p.nombre },
          unit_amount: p.precio
        },
        quantity: 1
      }],
      success_url: 'https://trimgest.es/app?subidas=ok&paquete=' + paquete,
      cancel_url: 'https://trimgest.es/app?subidas=cancelado',
      metadata: { empresaId: req.empresaId, tipo: 'subidas_extra', paquete: paquete, subidas: p.subidas },
      allow_promotion_codes: true
    });

    res.json({ url: session.url });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error creando sesion de pago' });
  }
});

// Webhook de Stripe
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET || '');
  } catch(e) {
    return res.status(400).send('Webhook error: ' + e.message);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { empresaId, plan, tipo, paquete, subidas } = session.metadata;
    const usuarios = getUsuarios();
    const idx = usuarios.findIndex(u => u.empresaId === empresaId);
    if (idx !== -1) {
      if (tipo === 'subidas_extra') {
        usuarios[idx].subidas_extra = (usuarios[idx].subidas_extra || 0) + parseInt(subidas);
      } else {
        usuarios[idx].plan = plan;
        usuarios[idx].plan_activo = true;
        usuarios[idx].stripe_customer = session.customer;
        usuarios[idx].stripe_subscription = session.subscription;
      }
      saveUsuarios(usuarios);
    }
  }

  res.json({ received: true });
});

// Estado del plan
router.get('/plan', auth, (req, res) => {
  const usuarios = getUsuarios();
  const usuario = usuarios.find(u => u.empresaId === req.empresaId);
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({
    plan: usuario.plan || 'free',
    plan_activo: usuario.plan_activo || false,
    limite: PLANES[usuario.plan] ? PLANES[usuario.plan].limite : 10,
    subidas_extra: usuario.subidas_extra || 0
  });
});

// POST /stripe/cancelar
router.post('/cancelar', auth, async (req, res) => {
  try {
    const usuarios = getUsuarios();
    const usuario = usuarios.find(u => u.empresaId === req.empresaId);
    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (!usuario.stripe_subscription) return res.json({ ok: true, mensaje: 'Sin suscripcion activa' });
    await stripe.subscriptions.update(usuario.stripe_subscription, { cancel_at_period_end: true });
    const idx = usuarios.findIndex(u => u.empresaId === req.empresaId);
    usuarios[idx].baja_solicitada = true;
    usuarios[idx].baja_fecha = new Date().toISOString();
    saveUsuarios(usuarios);
    res.json({ ok: true });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Error al cancelar: ' + e.message });
  }
});

module.exports = router;