function colorsFromValue(value) {
  let rawItems = [];

  if (Array.isArray(value)) {
    rawItems = value;
  } else if (value !== null && value !== undefined && value !== '') {
    const text = String(value).trim();
    if (text) {
      try {
        const parsed = JSON.parse(text);
        rawItems = Array.isArray(parsed) ? parsed : text.split(',');
      } catch {
        rawItems = text.split(',');
      }
    }
  }

  const items = [];
  const seen = new Set();
  for (const raw of rawItems) {
    const color = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (!color) continue;
    const key = color.toLocaleLowerCase('es');
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(color);
  }
  return items;
}

function serializeColors(value) {
  const items = colorsFromValue(value);
  if (items.length > 20) {
    throw Object.assign(new Error('Puedes registrar máximo 20 colores por producto'), {
      httpStatus: 400,
      code: 'COLORES_LIMITE',
    });
  }
  const invalid = items.find(color => color.length > 40);
  if (invalid) {
    throw Object.assign(new Error('Cada color puede tener máximo 40 caracteres'), {
      httpStatus: 400,
      code: 'COLOR_INVALIDO',
    });
  }
  return items.length ? JSON.stringify(items) : null;
}

function productWithParsedColors(product) {
  if (!product) return product;
  return {
    ...product,
    colores_disponibles: colorsFromValue(product.colores_disponibles),
  };
}

async function attachProductImages(db, products) {
  const items = Array.isArray(products) ? products : [];
  if (!items.length) return items;

  const ids = [...new Set(items.map(p => Number(p.id)).filter(id => Number.isInteger(id) && id > 0))];
  if (!ids.length) return items.map(productWithParsedColors);

  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await db.query(
    `SELECT id, producto_id, url, alt, es_principal, orden
       FROM producto_imagen
      WHERE producto_id IN (${placeholders})
      ORDER BY producto_id ASC, es_principal DESC, orden ASC, id ASC`,
    ids
  );

  const byProduct = new Map();
  for (const row of rows || []) {
    const id = Number(row.producto_id);
    if (!byProduct.has(id)) byProduct.set(id, []);
    byProduct.get(id).push({
      id: Number(row.id),
      url: row.url,
      alt: row.alt ?? null,
      es_principal: Number(row.es_principal || 0),
      orden: Number(row.orden || 0),
    });
  }

  return items.map(product => {
    const images = byProduct.get(Number(product.id)) || [];
    const principal = images.find(img => img.es_principal === 1) || images[0] || null;
    const normalized = productWithParsedColors(product);
    return {
      ...normalized,
      imagen: principal?.url ?? normalized.imagen ?? null,
      imagen_principal: principal?.url ?? normalized.imagen_principal ?? normalized.imagen ?? null,
      imagenes: images,
      video: normalized.video_url ? {
        url: normalized.video_url,
        duracion_segundos: normalized.video_duracion_segundos == null ? null : Number(normalized.video_duracion_segundos),
        mime: normalized.video_mime ?? null,
      } : null,
    };
  });
}

module.exports = {
  colorsFromValue,
  serializeColors,
  productWithParsedColors,
  attachProductImages,
};
