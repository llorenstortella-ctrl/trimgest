Borra todo el contenido de frontend/src/main.js y pega esto:
javascriptimport './style.css';

const API = 'http://localhost:3001';

function getTrimestre() {
  const m = new Date().getMonth();
  if (m <= 2) return 'T1';
  if (m <= 5) return 'T2';
  if (m <= 8) return 'T3';
  return 'T4';
}

function formatEur(n) {
  return Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
}

async function cargarFacturas() {
  const res = await fetch(`${API}/facturas/listar`);
  const data = await res.json();
  return data.facturas;
}

async function renderApp() {
  const facturas = await cargarFacturas();
  const trimestre = getTrimestre();
  const año = new Date().getFullYear();

  const facturasT = facturas.filter(f => f.trimestre === trimestre);
  const proveedores = facturasT.filter(f => f.tipo === 'proveedor');
  const clientes = facturasT.filter(f => f.tipo === 'cliente');

  const totalProveedores = proveedores.reduce((s, f) => s + f.total, 0);
  const totalClientes = clientes.reduce((s, f) => s + f.total, 0);

  const listaHTML = facturasT.length === 0
    ? '<div class="empty">Aún no hay facturas este trimestre</div>'
    : '<div class="facturas-list">' + facturasT.map(f =>
        '<div class="factura-card">' +
        '<div class="factura-header">' +
        '<span class="factura-nombre">' + f.nombre + '</span>' +
        '<span class="factura-badge ' + f.tipo + '">' + f.tipo + '</span>' +
        '</div>' +
        '<div class="factura-datos">' +
        '<span>' + f.fecha + '</span>' +
        '<span>N\u00ba ' + f.numero_factura + '</span>' +
        '<span class="factura-total">' + formatEur(f.total) + '</span>' +
        '</div>' +
        '<div class="factura-desglose">Base ' + formatEur(f.base_imponible) + ' \u00b7 IVA ' + f.iva_porcentaje + '% ' + formatEur(f.iva_importe) + '</div>' +
        (f.anomalias ? '<div class="anomalia">\u26a0\ufe0f ' + f.anomalias + '</div>' : '') +
        '</div>'
      ).join('') + '</div>';

  const generarBtn = facturasT.length > 0
    ? '<button class="btn-generar" id="btnGenerar">Generar PDFs para gestoría</button>'
    : '';

  document.querySelector('#app').innerHTML =
    '<div class="header">' +
    '<div class="header-top">' +
    '<div><div class="label">TrimGest</div><h1>' + trimestre + ' \u00b7 ' + año + '</h1></div>' +
    '<button class="btn-subir" id="btnSubir">+ Subir factura</button>' +
    '</div>' +
    '<div class="stats">' +
    '<div class="stat"><div class="stat-label">Proveedores</div><div class="stat-value">' + formatEur(totalProveedores) + '</div><div class="stat-count">' + proveedores.length + ' facturas</div></div>' +
    '<div class="stat"><div class="stat-label">Clientes</div><div class="stat-value clientes">' + formatEur(totalClientes) + '</div><div class="stat-count">' + clientes.length + ' facturas</div></div>' +
    '</div></div>' +
    '<div class="content">' +
    '<div id="uploadArea" class="upload-area hidden">' +
    '<div class="upload-box">' +
    '<div class="upload-icon">\ud83d\udcc4</div>' +
    '<div class="upload-title">Subir factura</div>' +
    '<div class="upload-sub">PDF desde tu iPhone o Mac</div>' +
    '<input type="file" id="fileInput" accept="application/pdf" />' +
    '<button class="btn-file" id="btnFile">Elegir PDF</button>' +
    '<div id="uploadStatus"></div>' +
    '</div></div>' +
    '<div class="section-title">Facturas del trimestre</div>' +
    listaHTML +
    generarBtn +
    '</div>';

  document.getElementById('btnSubir').addEventListener('click', function() {
    document.getElementById('uploadArea').classList.toggle('hidden');
  });

  var btnFile = document.getElementById('btnFile');
  if (btnFile) {
    btnFile.addEventListener('click', function() {
      document.getElementById('fileInput').click();
    });
  }

  var fileInput = document.getElementById('fileInput');
  if (fileInput) {
    fileInput.addEventListener('change', async function(e) {
      var file = e.target.files[0];
      if (!file) return;
      var status = document.getElementById('uploadStatus');
      status.innerHTML = '<div class="uploading">Procesando con IA...</div>';
      var formData = new FormData();
      formData.append('factura', file);
      try {
        var res = await fetch(API + '/facturas/subir', { method: 'POST', body: formData });
        var data = await res.json();
        if (data.factura) {
          status.innerHTML = '<div class="success">Factura procesada correctamente</div>';
          setTimeout(function() { renderApp(); }, 1500);
        } else {
          status.innerHTML = '<div class="error">Error al procesar la factura</div>';
        }
      } catch (err) {
        status.innerHTML = '<div class="error">Error de conexión</div>';
      }
    });
  }
}

renderApp();