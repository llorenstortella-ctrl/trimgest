const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = 'TrimGest <no-reply@trimgest.es>';

async function enviarVerificacion(email, nombre, token) {
  const url = 'https://trimgest.es/verificar?token=' + token;
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Verifica tu cuenta de TrimGest',
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;background:#0f0f13;color:#f0ede8;"><div style="font-size:24px;color:#e8c87a;font-weight:600;margin-bottom:8px;">TrimGest</div><div style="font-size:16px;margin-bottom:24px;">Hola ${nombre},</div><p style="color:#9a90b4;margin-bottom:24px;">Gracias por registrarte. Pulsa el boton para verificar tu cuenta:</p><a href="${url}" style="display:inline-block;background:#e8c87a;color:#1a1500;padding:14px 28px;border-radius:10px;font-weight:600;text-decoration:none;font-size:16px;">Verificar cuenta</a><p style="color:#6a6070;font-size:12px;margin-top:32px;">Si no has creado esta cuenta puedes ignorar este email. El enlace caduca en 24 horas.</p></div>`
  });
}

async function enviarRecuperacion(email, nombre, token) {
  const url = 'https://trimgest.es/recuperar?token=' + token;
  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Recupera tu contrasena de TrimGest',
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;background:#0f0f13;color:#f0ede8;"><div style="font-size:24px;color:#e8c87a;font-weight:600;margin-bottom:8px;">TrimGest</div><div style="font-size:16px;margin-bottom:24px;">Hola ${nombre},</div><p style="color:#9a90b4;margin-bottom:24px;">Recibimos una solicitud para recuperar tu contrasena:</p><a href="${url}" style="display:inline-block;background:#e8c87a;color:#1a1500;padding:14px 28px;border-radius:10px;font-weight:600;text-decoration:none;font-size:16px;">Cambiar contrasena</a><p style="color:#6a6070;font-size:12px;margin-top:32px;">Si no has solicitado esto puedes ignorar este email. El enlace caduca en 1 hora.</p></div>`
  });
}

async function enviarInvitacionGestoria(emailGestoria, nombreEmpresa) {
  await resend.emails.send({
    from: FROM,
    to: emailGestoria,
    subject: nombreEmpresa + ' te ha invitado a TrimGest',
    html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;background:#0f0f13;color:#f0ede8;"><div style="font-size:24px;color:#e8c87a;font-weight:600;margin-bottom:8px;">TrimGest</div><p style="color:#9a90b4;margin-bottom:24px;"><strong style="color:#e0d8cc;">${nombreEmpresa}</strong> te ha invitado a acceder a sus datos fiscales en TrimGest.</p><a href="https://trimgest.es/panel-gestoria" style="display:inline-block;background:#e8c87a;color:#1a1500;padding:14px 28px;border-radius:10px;font-weight:600;text-decoration:none;font-size:16px;">Ver invitacion</a><p style="color:#6a6070;font-size:12px;margin-top:32px;">Entra en tu panel de gestoria para aceptar o rechazar la invitacion.</p></div>`
  });
}


async function enviarRecordatorioTrimestral(email, nombreEmpresa, trimestre, anno, numFacturas) {
  const textoFacturas = numFacturas === 0
    ? 'Todavia no tienes ninguna factura subida para este trimestre.'
    : 'Tienes ' + numFacturas + ' factura' + (numFacturas === 1 ? '' : 's') + ' subida' + (numFacturas === 1 ? '' : 's') + ' para este trimestre.';

  await resend.emails.send({
    from: FROM,
    to: email,
    subject: 'Recordatorio: el T' + trimestre + ' ' + anno + ' termina pronto',
    html: '<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:40px 20px;background:#0f0f13;color:#f0ede8;"><div style="font-size:24px;color:#e8c87a;font-weight:600;margin-bottom:8px;">TrimGest</div><div style="font-size:16px;margin-bottom:24px;">Hola ' + nombreEmpresa + ',</div><p style="color:#9a90b4;margin-bottom:16px;">El trimestre T' + trimestre + ' de ' + anno + ' esta a punto de terminar. Es el momento de tener todas tus facturas al dia.</p><p style="color:#e0d8cc;margin-bottom:24px;">' + textoFacturas + '</p><a href="https://trimgest.es" style="display:inline-block;background:#e8c87a;color:#1a1500;padding:14px 28px;border-radius:10px;font-weight:600;text-decoration:none;font-size:16px;">Ir a TrimGest</a><p style="color:#6a6070;font-size:12px;margin-top:32px;">Recibes este email porque tienes una cuenta activa en TrimGest.</p></div>'
  });
}

module.exports = { enviarVerificacion, enviarRecuperacion, enviarInvitacionGestoria, enviarRecordatorioTrimestral };
