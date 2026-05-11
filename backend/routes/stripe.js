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

// Crear sesion de pago
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
      metadata: { empresaId: req.empresaId, plan: plan }
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
    const { empresaId, plan } = session.metadata;
    const usuarios = getUsuarios();
    const idx = usuarios.findIndex(u => u.empresaId === empresaId);
    if (idx !== -1) {
      usuarios[idx].plan = plan;
      usuarios[idx].plan_activo = true;
      usuarios[idx].stripe_customer = session.customer;
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
    plan: usuario.plan || 'basico',
    plan_activo: usuario.plan_activo || false,
    limite: PLANES[usuario.plan || 'basico'].limite
  });
});

module.exports = router;
