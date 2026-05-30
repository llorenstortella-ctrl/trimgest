#!/usr/bin/env node
// TrimGest — Script de test funcional
// Uso: node test.js

const BASE = 'https://trimgest.es';

const EMPRESA_EMAIL = 'demo@construccionesbalear.es';
const EMPRESA_PASS = 'Demo1234!';
const GESTORIA_EMAIL = 'demo@gestoria-mallorca.es';
const GESTORIA_PASS = 'Demo1234!';

let ok = 0;
let fail = 0;

async function test(nombre, fn) {
  try {
    await fn();
    console.log('  ✅ ' + nombre);
    ok++;
  } catch(e) {
    console.log('  ❌ ' + nombre + ' — ' + e.message);
    fail++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'Fallo');
}

async function post(url, body, token) {
  var headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = 'Bearer ' + token;
  var r = await fetch(BASE + url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
  var text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; } catch(e) { throw new Error('No es JSON: ' + text.substring(0,60)); }
}

async function get(url, token) {
  var headers = {};
  if (token) headers['Authorization'] = 'Bearer ' + token;
  var r = await fetch(BASE + url, { headers: headers });
  var text = await r.text();
  try { return { status: r.status, data: JSON.parse(text) }; } catch(e) { throw new Error('No es JSON: ' + text.substring(0,60)); }
}

async function main() {
  console.log('\nTrimGest — Test funcional');
  console.log('================================\n');

  var tokenEmpresa = null;
  var tokenGestoria = null;

  // 1. Login empresa
  await test('Login empresa', async function() {
    var r = await post('/usuarios/login', { email: EMPRESA_EMAIL, password: EMPRESA_PASS });
    assert(r.status === 200, 'Status ' + r.status);
    assert(r.data.token, 'Sin token');
    tokenEmpresa = r.data.token;
  });

  // 2. Verificar token empresa
  await test('Verificar token empresa', async function() {
    var r = await post('/usuarios/verificar-token', { token: tokenEmpresa });
    assert(r.status === 200, 'Status ' + r.status);
    assert(r.data.ok, 'Token invalido');
  });

  // 3. Perfil empresa
  await test('Perfil empresa', async function() {
    var r = await get('/usuarios/perfil', tokenEmpresa);
    assert(r.status === 200, 'Status ' + r.status);
    assert(r.data.empresaId, 'Sin empresaId');
  });

  // 4. Listar facturas
  await test('Listar facturas', async function() {
    var r = await get('/facturas/listar', tokenEmpresa);
    assert(r.status === 200, 'Status ' + r.status);
    assert(Array.isArray(r.data.facturas), 'Sin array facturas');
  });

  // 5. Listar nominas
  await test('Listar nominas', async function() {
    var r = await get('/nominas/listar', tokenEmpresa);
    assert(r.status === 200, 'Status ' + r.status);
    assert(Array.isArray(r.data.nominas), 'Sin array nominas');
  });

  // 6. Resumen anual (PyG)
  await test('Resumen anual (PyG)', async function() {
    var r = await get('/pyg/datos', tokenEmpresa);
    assert(r.status === 200, 'Status ' + r.status);
  });

  // 7. Banco movimientos
  await test('Banco movimientos', async function() {
    var r = await get('/banco/movimientos', tokenEmpresa);
    assert(r.status === 200, 'Status ' + r.status);
    assert(Array.isArray(r.data.movimientos), 'Sin array movimientos');
  });

  // 8. Compartir trimestre
  await test('Compartir trimestre', async function() {
    var r = await post('/api/compartir/generar', { trimestre: 'T1', anno: 2025 }, tokenEmpresa);
    assert(r.status === 200, 'Status ' + r.status);
    assert(r.data.token || r.data.url || r.data.ok, 'Sin respuesta valida');
  });

  // 9. Referidos — info con codigo
  await test('Codigo referido', async function() {
    var r = await get('/referidos/info', tokenEmpresa);
    assert(r.status === 200, 'Status ' + r.status);
    assert(r.data.ref_codigo, 'Sin ref_codigo');
  });

  // 10. Login gestoria
  await test('Login gestoria', async function() {
    var r = await post('/usuarios/login', { email: GESTORIA_EMAIL, password: GESTORIA_PASS, origen: 'gestoria' });
    assert(r.status === 200, 'Status ' + r.status);
    assert(r.data.token, 'Sin token');
    tokenGestoria = r.data.token;
  });

  // 11. Listar clientes gestoria
  await test('Listar clientes gestoria', async function() {
    var r = await get('/gestoria/clientes', tokenGestoria);
    assert(r.status === 200, 'Status ' + r.status);
  });

  // Resumen
  console.log('\n================================');
  console.log('Resultado: ' + ok + ' OK — ' + fail + ' FALLOS');
  if (fail > 0) {
    console.log('\n⚠️  Hay fallos — revisa antes de desplegar');
    process.exit(1);
  } else {
    console.log('\n✅ Todo OK — puedes desplegar');
  }
}

main().catch(function(e) { console.error('Error fatal:', e.message); process.exit(1); });
