function similitud(texto1, texto2) {
  const palabras1 = texto1.toLowerCase().split(/\s+/).filter(p => p.length > 3);
  const palabras2 = new Set(texto2.toLowerCase().split(/\s+/).filter(p => p.length > 3));
  if (!palabras1.length) return 0;
  const coinciden = palabras1.filter(p => palabras2.has(p)).length;
  return coinciden / palabras1.length;
}

async function detectarDuplicadoPaginas(fileBuffer) {
  try {
    const pdfLib = require('pdf-lib');
    const pdfDoc = await pdfLib.PDFDocument.load(fileBuffer);
    const numPaginas = pdfDoc.getPageCount();
    if (numPaginas < 2) return { duplicado: false, numPaginas };
    const pdfParse = require('pdf-parse');
    const textosPaginas = [];
    for (let i = 0; i < Math.min(numPaginas, 4); i++) {
      const pdfDocTemp = await pdfLib.PDFDocument.load(fileBuffer);
      const pagina = await pdfLib.PDFDocument.create();
      const [paginaCopied] = await pagina.copyPages(pdfDocTemp, [i]);
      pagina.addPage(paginaCopied);
      const paginaBytes = await pagina.save();
      const parsed = await pdfParse(Buffer.from(paginaBytes));
      textosPaginas.push(parsed.text);
    }
    for (let i = 0; i < textosPaginas.length - 1; i++) {
      for (let j = i + 1; j < textosPaginas.length; j++) {
        const sim = similitud(textosPaginas[i], textosPaginas[j]);
        if (sim > 0.75) return { duplicado: true, numPaginas, paginaDuplicada: j + 1, similitudDetectada: Math.round(sim * 100) };
      }
    }
    return { duplicado: false, numPaginas };
  } catch(e) {
    return { duplicado: false, numPaginas: 1 };
  }
}

module.exports = { similitud, detectarDuplicadoPaginas };
