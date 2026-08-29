function ok(res, result = {}, status = 'OK') {
  return res.status(200).json({ success: 1, status, result });
}

function created(res, result = {}, status = 'OK') {
  return res.status(201).json({ success: 1, status, result });
}

function fail(res, httpStatus = 400, message = 'Solicitud inválida', status = 'BAD_REQUEST', extra = {}) {
  return res.status(httpStatus).json({ success: 0, status, result: { message, ...extra } });
}

function badRequest(res, message, extra) { return fail(res, 400, message, 'BAD_REQUEST', extra); }
function unauthorized(res, message = 'No autorizado') { return fail(res, 401, message, 'UNAUTHORIZED'); }
function forbidden(res, message = 'No tienes permisos para esta acción') { return fail(res, 403, message, 'FORBIDDEN'); }
function notFound(res, message = 'Registro no encontrado') { return fail(res, 404, message, 'NOT_FOUND'); }

function errorHandler(err, _req, res, _next) {
  console.error(err);

  if (err?.name === 'MulterError') {
    const messages = {
      LIMIT_FILE_SIZE: 'El archivo supera el tamaño máximo permitido',
      LIMIT_FILE_COUNT: 'Se enviaron más archivos de los permitidos',
      LIMIT_UNEXPECTED_FILE: 'Campo de archivo no permitido',
    };
    return fail(res, 400, messages[err.code] || err.message || 'Archivo inválido', err.code || 'UPLOAD_ERROR');
  }

  const message = err?.sqlMessage || err?.message || 'Error inesperado';
  return fail(res, err?.httpStatus || 500, message, err?.code || 'INTERNAL_ERROR');
}

module.exports = { ok, created, fail, badRequest, unauthorized, forbidden, notFound, errorHandler };
