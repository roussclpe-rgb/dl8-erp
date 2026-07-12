const { db } = require('../../db');
const catalogos = require('./catalogos');
const motor = require('./motor');
const { aMinorPEN } = require('./montos');
const { hashCanonico } = require('./idempotencia');

const fallo = (message, status = 400) => Object.assign(new Error(message), { status });
const fechaValida = (valor) => {
  const fecha = String(valor || new Date().toISOString().slice(0, 10)).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw fallo('La fecha debe tener formato YYYY-MM-DD');
  return fecha;
};
const cuentaPlan = (entidadId, codigo) => {
  const cuenta = db.prepare("SELECT id FROM fin_plan_cuentas WHERE entidad_id=? AND codigo=? AND estado='activa' AND permite_movimiento=1").get(entidadId, codigo);
  if (!cuenta) throw fallo('Falta la cuenta contable requerida para el movimiento manual', 409);
  return cuenta.id;
};
const bolsilloSinAsignar = (entidadId) => {
  const bolsillo = db.prepare("SELECT * FROM fin_bolsillos WHERE entidad_id=? AND tipo='sin_asignar' AND estado='activa'").get(entidadId);
  if (!bolsillo) throw fallo('La entidad no tiene bolsillo Sin asignar activo', 409);
  return bolsillo;
};

function buscarMovimientoManualIdempotente({ usuarioId, clave, payload }) {
  if (!clave) return null;
  const hashPayload = hashCanonico(payload);
  const previo = db.prepare('SELECT hash_payload,respuesta_json FROM movimientos_manuales_claves_idempotencia WHERE usuario_id=? AND clave=?').get(usuarioId, clave);
  if (!previo) return null;
  if (previo.hash_payload !== hashPayload) throw fallo('La clave de idempotencia se usó con otro payload', 409);
  return JSON.parse(previo.respuesta_json);
}

const registrarMovimientoManual = db.transaction(({ entidadId, usuarioId, tipo, cuentaFinancieraId, bolsilloId, monto, motivo, fecha, claveIdempotencia }) => {
  if (!claveIdempotencia) throw fallo('Idempotency-Key es obligatorio');
  entidadId = Number(entidadId);
  catalogos.exigirAcceso(entidadId, usuarioId, ['finanzas_admin', 'finanzas_operador', 'finanzas_personal_propietario']);
  if (!['ingreso', 'egreso'].includes(tipo)) throw fallo('Tipo inválido');
  const fechaEfectiva = fechaValida(fecha);
  const importeMinor = aMinorPEN(monto);
  if (importeMinor <= 0) throw fallo('El monto debe ser mayor a cero');
  const motivoLimpio = String(motivo || '').trim();
  if (!motivoLimpio) throw fallo('El motivo es obligatorio');
  const cuenta = db.prepare("SELECT * FROM fin_cuentas_financieras WHERE id=? AND entidad_id=? AND estado='activa'").get(cuentaFinancieraId, entidadId);
  if (!cuenta) throw fallo('La cuenta financiera no pertenece a la entidad o no está activa', 404);
  const bolsillo = bolsilloId ? db.prepare("SELECT * FROM fin_bolsillos WHERE id=? AND entidad_id=? AND estado='activa'").get(bolsilloId, entidadId) : bolsilloSinAsignar(entidadId);
  if (!bolsillo) throw fallo('El bolsillo no pertenece a la entidad o no está activo', 404);
  const payload = { entidadId, tipo, cuentaFinancieraId: cuenta.id, bolsilloId: bolsillo.id, monto: importeMinor, motivo: motivoLimpio, fecha: fechaEfectiva };
  const previo = buscarMovimientoManualIdempotente({ usuarioId, clave: claveIdempotencia, payload });
  if (previo) return previo;
  const hashPayload = hashCanonico(payload);
  const repetido = db.prepare('SELECT respuesta_json FROM movimientos_manuales_claves_idempotencia WHERE usuario_id=? AND hash_payload=? ORDER BY id LIMIT 1').get(usuarioId, hashPayload);
  if (repetido) {
    const respuesta = JSON.parse(repetido.respuesta_json);
    db.prepare('INSERT INTO movimientos_manuales_claves_idempotencia(usuario_id,clave,hash_payload,respuesta_json) VALUES(?,?,?,?)').run(usuarioId, claveIdempotencia, hashPayload, JSON.stringify(respuesta));
    return respuesta;
  }
  const contraparte = cuentaPlan(entidadId, tipo === 'ingreso' ? '4101' : '5201');
  const evento = motor.ejecutar({
    entidadId, usuarioId, clave: claveIdempotencia, tipo: tipo === 'ingreso' ? 'ingreso_manual' : 'egreso_manual', fecha: fechaEfectiva,
    descripcion: `${tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} manual: ${motivoLimpio}`, payload,
    lineas: tipo === 'ingreso'
      ? [{ cuenta_contable_id: cuenta.cuenta_contable_id, cuenta_financiera_id: cuenta.id, debe_minor: importeMinor, haber_minor: 0 }, { cuenta_contable_id: contraparte, debe_minor: 0, haber_minor: importeMinor }]
      : [{ cuenta_contable_id: contraparte, debe_minor: importeMinor, haber_minor: 0 }, { cuenta_contable_id: cuenta.cuenta_contable_id, cuenta_financiera_id: cuenta.id, debe_minor: 0, haber_minor: importeMinor }],
    asigs: tipo === 'ingreso'
      ? [{ cuenta_destino_id: cuenta.id, bolsillo_destino_id: bolsillo.id, importe_minor: importeMinor }]
      : [{ cuenta_origen_id: cuenta.id, bolsillo_origen_id: bolsillo.id, importe_minor: importeMinor }],
  });
  const respuesta = { evento_financiero_id: evento.id, importe: importeMinor / 100 };
  db.prepare("INSERT INTO fin_auditoria(entidad_id,usuario_id,accion,entidad_tabla,entidad_registro_id,datos_despues) VALUES(?,?, 'crear','fin_movimientos_manuales',?,?)").run(entidadId, usuarioId, evento.id, JSON.stringify({ ...payload, evento_financiero_id: evento.id }));
  db.prepare('INSERT INTO movimientos_manuales_claves_idempotencia(usuario_id,clave,hash_payload,respuesta_json) VALUES(?,?,?,?)').run(usuarioId, claveIdempotencia, hashPayload, JSON.stringify(respuesta));
  return respuesta;
});

function listarMovimientosManuales(entidadId) {
  return db.prepare(`SELECT e.id evento_financiero_id,e.tipo,e.fecha,e.descripcion motivo,e.creado_en,c.codigo cuenta_codigo,c.nombre cuenta_nombre,b.id bolsillo_id,b.nombre bolsillo_nombre,ABS(m.importe_minor) importe_minor
    FROM fin_eventos_financieros e
    JOIN fin_movimientos_tesoreria m ON m.evento_id=e.id
    JOIN fin_cuentas_financieras c ON c.id=m.cuenta_financiera_id
    LEFT JOIN fin_asignaciones_bolsillo a ON a.evento_id=e.id
    LEFT JOIN fin_bolsillos b ON b.id=COALESCE(a.bolsillo_destino_id,a.bolsillo_origen_id)
    WHERE e.entidad_id=? AND e.tipo IN ('ingreso_manual','egreso_manual') ORDER BY e.fecha DESC,e.id DESC`).all(entidadId).map((row) => ({ ...row, importe: row.importe_minor / 100 }));
}

module.exports = { registrarMovimientoManual, buscarMovimientoManualIdempotente, listarMovimientosManuales };
