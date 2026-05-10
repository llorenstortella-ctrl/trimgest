const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'trimgest_secret_2026';

function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.empresaId = decoded.empresaId;
    req.userId = decoded.id;
    next();
  } catch(e) {
    res.status(401).json({ error: 'Token inválido' });
  }
}

module.exports = authMiddleware;
