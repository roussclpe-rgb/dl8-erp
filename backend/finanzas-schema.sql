-- Fundación financiera MVP 1: catálogos. No contiene eventos ni movimientos.
CREATE TABLE IF NOT EXISTS mpf_politicas (id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), nombre TEXT NOT NULL, evento_tipo TEXT NOT NULL CHECK(evento_tipo IN ('cobro_venta','aporte','prestamo')), version INTEGER NOT NULL DEFAULT 1, estado TEXT NOT NULL DEFAULT 'borrador' CHECK(estado IN ('borrador','activa','inactiva')), es_predeterminada INTEGER NOT NULL DEFAULT 0 CHECK(es_predeterminada IN (0,1)), recupera_costo INTEGER NOT NULL DEFAULT 0 CHECK(recupera_costo IN (0,1)), bolsillo_costo_id INTEGER REFERENCES fin_bolsillos(id), creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT(datetime('now')), UNIQUE(entidad_id,nombre,version));
CREATE UNIQUE INDEX IF NOT EXISTS idx_mpf_politica_predeterminada ON mpf_politicas(entidad_id,evento_tipo) WHERE estado='activa' AND es_predeterminada=1;
CREATE TABLE IF NOT EXISTS mpf_reglas (id INTEGER PRIMARY KEY AUTOINCREMENT, politica_id INTEGER NOT NULL REFERENCES mpf_politicas(id), orden INTEGER NOT NULL CHECK(orden>0), nombre TEXT NOT NULL, base TEXT NOT NULL CHECK(base IN ('ingreso','remanente')), tipo TEXT NOT NULL CHECK(tipo IN ('porcentaje','importe_fijo')), valor_minor INTEGER NOT NULL CHECK(valor_minor>=0), bolsillo_id INTEGER NOT NULL REFERENCES fin_bolsillos(id), meta_id INTEGER REFERENCES mpf_metas_financieras(id), condicion_json TEXT NOT NULL DEFAULT '{}', accion TEXT NOT NULL DEFAULT 'aplicar' CHECK(accion IN ('aplicar','resto','omitir')), bolsillo_destino_id INTEGER REFERENCES fin_bolsillos(id), meta_destino_id INTEGER REFERENCES mpf_metas_financieras(id), UNIQUE(politica_id,orden));
CREATE TABLE IF NOT EXISTS mpf_aplicaciones (id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), evento_financiero_id INTEGER NOT NULL UNIQUE REFERENCES fin_eventos_financieros(id), politica_id INTEGER NOT NULL REFERENCES mpf_politicas(id), politica_version INTEGER NOT NULL, importe_ingreso_minor INTEGER NOT NULL CHECK(importe_ingreso_minor>0), costo_recuperado_minor INTEGER NOT NULL DEFAULT 0 CHECK(costo_recuperado_minor>=0), importe_distribuido_minor INTEGER NOT NULL CHECK(importe_distribuido_minor>=0), creado_en TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS mpf_detalles_aplicacion (id INTEGER PRIMARY KEY AUTOINCREMENT, aplicacion_id INTEGER NOT NULL REFERENCES mpf_aplicaciones(id), regla_id INTEGER NOT NULL REFERENCES mpf_reglas(id), bolsillo_id INTEGER NOT NULL REFERENCES fin_bolsillos(id), importe_minor INTEGER NOT NULL CHECK(importe_minor>=0), condicion_evaluada_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS mpf_metas_bolsillo (id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), bolsillo_id INTEGER NOT NULL REFERENCES fin_bolsillos(id), meta_minor INTEGER NOT NULL CHECK(meta_minor>=0), actualizado_por INTEGER NOT NULL REFERENCES usuarios(id), actualizado_en TEXT NOT NULL DEFAULT(datetime('now')), UNIQUE(entidad_id,bolsillo_id));
CREATE TABLE IF NOT EXISTS mpf_metas_financieras (id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), nombre TEXT NOT NULL, bolsillo_id INTEGER NOT NULL REFERENCES fin_bolsillos(id), monto_objetivo_minor INTEGER NOT NULL CHECK(monto_objetivo_minor>0), fecha_objetivo TEXT, estado TEXT NOT NULL DEFAULT 'activa' CHECK(estado IN ('activa','pausada','cumplida','cancelada')), creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT(datetime('now')), actualizado_por INTEGER REFERENCES usuarios(id), actualizado_en TEXT);
CREATE TABLE IF NOT EXISTS fin_alertas_config (id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), tipo TEXT NOT NULL, severidad TEXT NOT NULL DEFAULT 'advertencia', umbral_minor INTEGER, activa INTEGER NOT NULL DEFAULT 1, UNIQUE(entidad_id,tipo));
CREATE TABLE IF NOT EXISTS fin_alertas (id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), tipo TEXT NOT NULL, clave_problema TEXT NOT NULL, severidad TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'activa', mensaje TEXT NOT NULL, origen_json TEXT NOT NULL DEFAULT '{}', creada_en TEXT NOT NULL DEFAULT(datetime('now')), actualizada_en TEXT NOT NULL DEFAULT(datetime('now')), UNIQUE(entidad_id,tipo,clave_problema));
CREATE TABLE IF NOT EXISTS fin_alertas_historial (id INTEGER PRIMARY KEY AUTOINCREMENT, alerta_id INTEGER NOT NULL REFERENCES fin_alertas(id), usuario_id INTEGER REFERENCES usuarios(id), estado_anterior TEXT, estado_nuevo TEXT NOT NULL, creado_en TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS fin_escenarios_financieros (id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), nombre TEXT NOT NULL, configuracion_json TEXT NOT NULL DEFAULT '{}', creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT(datetime('now')), actualizado_en TEXT NOT NULL DEFAULT(datetime('now')), UNIQUE(entidad_id,nombre));
CREATE TABLE IF NOT EXISTS fin_entidades_economicas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('empresa','persona','patrimonio_compartido')),
  moneda_base TEXT NOT NULL DEFAULT 'PEN' CHECK (moneda_base = 'PEN'),
  es_personal INTEGER NOT NULL DEFAULT 0 CHECK (es_personal IN (0,1)),
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','bloqueada','inactiva')),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_por INTEGER NOT NULL REFERENCES usuarios(id), actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK ((tipo = 'persona' AND es_personal = 1) OR (tipo <> 'persona' AND es_personal = 0))
);
CREATE TABLE IF NOT EXISTS fin_propietarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK (tipo IN ('persona','organizacion')), nombre TEXT NOT NULL,
  documento_tipo TEXT, documento_numero TEXT,
  usuario_id INTEGER UNIQUE REFERENCES usuarios(id),
  entidad_personal_id INTEGER UNIQUE REFERENCES fin_entidades_economicas(id),
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','bloqueada','inactiva')),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_por INTEGER NOT NULL REFERENCES usuarios(id), actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fin_periodos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id),
  anio INTEGER NOT NULL CHECK (anio BETWEEN 2000 AND 2100), mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  estado TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto','cerrado')),
  cerrado_por INTEGER REFERENCES usuarios(id), cerrado_en TEXT,
  creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_por INTEGER NOT NULL REFERENCES usuarios(id), actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entidad_id, anio, mes)
);
CREATE TABLE IF NOT EXISTS fin_plan_cuentas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id),
  codigo TEXT NOT NULL, nombre TEXT NOT NULL,
  naturaleza TEXT NOT NULL CHECK (naturaleza IN ('activo','pasivo','patrimonio','ingreso','costo','gasto')),
  subtipo TEXT NOT NULL CHECK (subtipo IN ('efectivo_equivalente','custodia_tercero','fondos_procesador','cuentas_por_cobrar','inventario','otro_activo','cuentas_por_pagar','otro_pasivo','capital','resultados_acumulados','saldo_inicial','ingreso_operativo','otro_ingreso','costo_ventas','otro_costo','gasto_operativo','gasto_financiero','otro_gasto')),
  permite_movimiento INTEGER NOT NULL DEFAULT 1 CHECK (permite_movimiento IN (0,1)),
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','bloqueada','inactiva')),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_por INTEGER NOT NULL REFERENCES usuarios(id), actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entidad_id, codigo)
);
CREATE TABLE IF NOT EXISTS fin_participaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id),
  propietario_id INTEGER NOT NULL REFERENCES fin_propietarios(id),
  porcentaje_minor INTEGER CHECK (porcentaje_minor IS NULL OR porcentaje_minor BETWEEN 0 AND 10000),
  cuenta_capital_id INTEGER REFERENCES fin_plan_cuentas(id), fecha_inicio TEXT NOT NULL, fecha_fin TEXT,
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','bloqueada','inactiva')),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_por INTEGER NOT NULL REFERENCES usuarios(id), actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);
CREATE INDEX IF NOT EXISTS idx_fin_participaciones_entidad ON fin_participaciones(entidad_id, estado, fecha_inicio, fecha_fin);
CREATE TABLE IF NOT EXISTS fin_cuentas_financieras (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id),
  cuenta_contable_id INTEGER NOT NULL REFERENCES fin_plan_cuentas(id), codigo TEXT NOT NULL, nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('caja','banco','billetera','procesador','custodia_tercero','transito')),
  moneda TEXT NOT NULL DEFAULT 'PEN' CHECK (moneda = 'PEN'), titular_legal TEXT,
  custodio_propietario_id INTEGER REFERENCES fin_propietarios(id), custodio_entidad_id INTEGER REFERENCES fin_entidades_economicas(id),
  referencia_externa TEXT, estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','bloqueada','inactiva')),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_por INTEGER NOT NULL REFERENCES usuarios(id), actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entidad_id, codigo), CHECK (NOT (custodio_propietario_id IS NOT NULL AND custodio_entidad_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_fin_cuentas_financieras_entidad ON fin_cuentas_financieras(entidad_id, estado);
CREATE TABLE IF NOT EXISTS fin_bolsillos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id),
  codigo TEXT NOT NULL, nombre TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('sin_asignar','operacion','reserva','impuestos','otro')),
  moneda TEXT NOT NULL DEFAULT 'PEN' CHECK (moneda = 'PEN'), permite_saldo_negativo INTEGER NOT NULL DEFAULT 0 CHECK (permite_saldo_negativo IN (0,1)),
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','bloqueada','inactiva')),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_por INTEGER NOT NULL REFERENCES usuarios(id), actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entidad_id, codigo)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_bolsillo_sin_asignar_unico ON fin_bolsillos(entidad_id, moneda) WHERE tipo = 'sin_asignar' AND estado = 'activa';
CREATE TABLE IF NOT EXISTS fin_accesos_entidad (
  id INTEGER PRIMARY KEY AUTOINCREMENT, usuario_id INTEGER NOT NULL REFERENCES usuarios(id), entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id),
  rol_financiero TEXT NOT NULL CHECK (rol_financiero IN ('finanzas_admin','finanzas_operador','finanzas_lector','finanzas_personal_propietario','finanzas_auditor_personal')),
  estado TEXT NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','bloqueada','inactiva')),
  otorgado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_por INTEGER NOT NULL REFERENCES usuarios(id), actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(usuario_id, entidad_id)
);
CREATE INDEX IF NOT EXISTS idx_fin_accesos_usuario ON fin_accesos_entidad(usuario_id, estado);
CREATE TABLE IF NOT EXISTS fin_auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER REFERENCES fin_entidades_economicas(id), usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
  accion TEXT NOT NULL CHECK (accion IN ('crear','actualizar','bloquear','inactivar','cerrar_periodo','cambiar_acceso')),
  entidad_tabla TEXT NOT NULL, entidad_registro_id INTEGER NOT NULL, datos_antes TEXT, datos_despues TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fin_auditoria_entidad_fecha ON fin_auditoria(entidad_id, creado_en DESC);
CREATE TRIGGER IF NOT EXISTS trg_fin_participacion_sin_solape_insert BEFORE INSERT ON fin_participaciones WHEN NEW.estado = 'activa' BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM fin_participaciones p WHERE p.entidad_id = NEW.entidad_id AND p.propietario_id = NEW.propietario_id AND p.estado = 'activa' AND p.fecha_inicio <= COALESCE(NEW.fecha_fin, '9999-12-31') AND COALESCE(p.fecha_fin, '9999-12-31') >= NEW.fecha_inicio) THEN RAISE(ABORT, 'La participación activa se superpone con otra participación del mismo propietario') END;
  SELECT CASE WHEN (COALESCE((SELECT SUM(COALESCE(porcentaje_minor,0)) FROM fin_participaciones WHERE entidad_id = NEW.entidad_id AND estado = 'activa'),0) + COALESCE(NEW.porcentaje_minor,0)) > 10000 THEN RAISE(ABORT, 'Las participaciones activas no pueden superar 10000') END;
END;
-- Motor transaccional MVP 2
CREATE TABLE IF NOT EXISTS fin_eventos_financieros (id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), tipo TEXT NOT NULL CHECK(tipo IN ('saldo_inicial','transferencia_interna','reasignacion_bolsillo','ingreso_caja','egreso_caja','ajuste_conciliacion','cobro_venta','emision_venta','emision_compra','pago_compra','nota_credito_compra','reversion')), estado TEXT NOT NULL DEFAULT 'confirmado' CHECK(estado='confirmado'), fecha TEXT NOT NULL, moneda TEXT NOT NULL DEFAULT 'PEN' CHECK(moneda='PEN'), descripcion TEXT NOT NULL, reversion_de_id INTEGER UNIQUE REFERENCES fin_eventos_financieros(id), creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS fin_eventos_por_entidad (id INTEGER PRIMARY KEY AUTOINCREMENT, evento_id INTEGER NOT NULL REFERENCES fin_eventos_financieros(id), entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), UNIQUE(evento_id, entidad_id));
CREATE TABLE IF NOT EXISTS fin_asientos_contables (id INTEGER PRIMARY KEY AUTOINCREMENT, evento_id INTEGER NOT NULL UNIQUE REFERENCES fin_eventos_financieros(id), entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), periodo_id INTEGER NOT NULL REFERENCES fin_periodos(id), fecha TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'confirmado' CHECK(estado='confirmado'), glosa TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fin_lineas_asiento (id INTEGER PRIMARY KEY AUTOINCREMENT, asiento_id INTEGER NOT NULL REFERENCES fin_asientos_contables(id), cuenta_contable_id INTEGER NOT NULL REFERENCES fin_plan_cuentas(id), cuenta_financiera_id INTEGER REFERENCES fin_cuentas_financieras(id), debe_minor INTEGER NOT NULL DEFAULT 0 CHECK(debe_minor>=0), haber_minor INTEGER NOT NULL DEFAULT 0 CHECK(haber_minor>=0), CHECK((debe_minor>0 AND haber_minor=0) OR (haber_minor>0 AND debe_minor=0)));
CREATE TABLE IF NOT EXISTS fin_movimientos_tesoreria (id INTEGER PRIMARY KEY AUTOINCREMENT, evento_id INTEGER NOT NULL REFERENCES fin_eventos_financieros(id), linea_asiento_id INTEGER NOT NULL UNIQUE REFERENCES fin_lineas_asiento(id), cuenta_financiera_id INTEGER NOT NULL REFERENCES fin_cuentas_financieras(id), importe_minor INTEGER NOT NULL CHECK(importe_minor<>0), moneda TEXT NOT NULL DEFAULT 'PEN' CHECK(moneda='PEN'));
CREATE TABLE IF NOT EXISTS fin_asignaciones_bolsillo (id INTEGER PRIMARY KEY AUTOINCREMENT, evento_id INTEGER NOT NULL REFERENCES fin_eventos_financieros(id), cuenta_origen_id INTEGER REFERENCES fin_cuentas_financieras(id), bolsillo_origen_id INTEGER REFERENCES fin_bolsillos(id), cuenta_destino_id INTEGER REFERENCES fin_cuentas_financieras(id), bolsillo_destino_id INTEGER REFERENCES fin_bolsillos(id), importe_minor INTEGER NOT NULL CHECK(importe_minor>0), moneda TEXT NOT NULL DEFAULT 'PEN' CHECK(moneda='PEN'), CHECK(cuenta_origen_id IS NOT NULL OR cuenta_destino_id IS NOT NULL));
CREATE TABLE IF NOT EXISTS fin_claves_idempotencia (id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), clave TEXT NOT NULL, hash_payload TEXT NOT NULL, evento_id INTEGER REFERENCES fin_eventos_financieros(id), UNIQUE(entidad_id, clave));
CREATE TABLE IF NOT EXISTS fin_documentos_cxc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id),
  venta_id INTEGER NOT NULL UNIQUE REFERENCES ventas(id),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  tipo_documento TEXT NOT NULL DEFAULT 'venta' CHECK(tipo_documento = 'venta'),
  fecha_emision TEXT NOT NULL,
  fecha_vencimiento TEXT,
  moneda TEXT NOT NULL DEFAULT 'PEN' CHECK(moneda = 'PEN'),
  importe_original_minor INTEGER NOT NULL CHECK(importe_original_minor >= 0),
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK(estado IN ('abierta','parcial','pagada','anulada')),
  evento_emision_id INTEGER NOT NULL UNIQUE REFERENCES fin_eventos_financieros(id),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT(datetime('now')),
  CHECK(fecha_vencimiento IS NULL OR fecha_vencimiento >= fecha_emision)
);
CREATE INDEX IF NOT EXISTS idx_fin_documentos_cxc_entidad_estado ON fin_documentos_cxc(entidad_id, estado, fecha_emision);
CREATE TABLE IF NOT EXISTS fin_documentos_cxp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id),
  lote_compra_id INTEGER NOT NULL UNIQUE REFERENCES lotes_compra(id),
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  tipo_documento TEXT NOT NULL DEFAULT 'compra' CHECK(tipo_documento = 'compra'),
  fecha_emision TEXT NOT NULL,
  fecha_vencimiento TEXT,
  moneda TEXT NOT NULL DEFAULT 'PEN' CHECK(moneda = 'PEN'),
  importe_original_minor INTEGER NOT NULL CHECK(importe_original_minor > 0),
  estado TEXT NOT NULL DEFAULT 'abierta' CHECK(estado IN ('abierta','parcial','pagada','anulada')),
  evento_emision_id INTEGER NOT NULL UNIQUE REFERENCES fin_eventos_financieros(id),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT(datetime('now')),
  CHECK(fecha_vencimiento IS NULL OR fecha_vencimiento >= fecha_emision)
);
CREATE INDEX IF NOT EXISTS idx_fin_documentos_cxp_entidad_proveedor_estado ON fin_documentos_cxp(entidad_id, proveedor_id, estado, fecha_emision);
CREATE TRIGGER IF NOT EXISTS trg_fin_documentos_cxp_integridad BEFORE INSERT ON fin_documentos_cxp BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM lotes_compra l JOIN proveedores p ON p.id=l.proveedor_id WHERE l.id=NEW.lote_compra_id AND l.entidad_id=NEW.entidad_id AND l.proveedor_id=NEW.proveedor_id AND p.activo=1) THEN RAISE(ABORT,'La CxP no coincide con la compra, proveedor y entidad') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_eventos_financieros e WHERE e.id=NEW.evento_emision_id AND e.entidad_id=NEW.entidad_id AND e.tipo='emision_compra') THEN RAISE(ABORT,'El evento de emisión no pertenece a la entidad') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM fin_movimientos_tesoreria WHERE evento_id=NEW.evento_emision_id) THEN RAISE(ABORT,'La emisión de CxP no puede mover tesorería') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id WHERE a.evento_id=NEW.evento_emision_id AND pc.entidad_id=NEW.entidad_id AND pc.codigo='1301' AND l.debe_minor=NEW.importe_original_minor AND l.haber_minor=0) THEN RAISE(ABORT,'La emisión no debita 1301 por el importe de la CxP') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id WHERE a.evento_id=NEW.evento_emision_id AND pc.entidad_id=NEW.entidad_id AND pc.codigo='2101' AND l.debe_minor=0 AND l.haber_minor=NEW.importe_original_minor) THEN RAISE(ABORT,'La emisión no acredita 2101 por el importe de la CxP') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_documentos_cxp_no_update BEFORE UPDATE OF entidad_id,lote_compra_id,proveedor_id,tipo_documento,fecha_emision,fecha_vencimiento,moneda,importe_original_minor,evento_emision_id,creado_por ON fin_documentos_cxp BEGIN SELECT RAISE(ABORT,'Los documentos CxP confirmados son inmutables'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_documentos_cxp_no_delete BEFORE DELETE ON fin_documentos_cxp BEGIN SELECT RAISE(ABORT,'Los documentos CxP no se eliminan'); END;
CREATE TABLE IF NOT EXISTS fin_pagos_cxp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id),
  proveedor_id INTEGER NOT NULL REFERENCES proveedores(id),
  evento_financiero_id INTEGER NOT NULL UNIQUE REFERENCES fin_eventos_financieros(id),
  cuenta_financiera_id INTEGER NOT NULL REFERENCES fin_cuentas_financieras(id),
  bolsillo_id INTEGER NOT NULL REFERENCES fin_bolsillos(id),
  turno_caja_id INTEGER REFERENCES turnos_caja(id),
  metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('Efectivo','Yape','Plin','Transferencia','Tarjeta')),
  importe_minor INTEGER NOT NULL CHECK(importe_minor > 0),
  fecha TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','confirmado','revertido')),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_fin_pagos_cxp_entidad_proveedor_fecha ON fin_pagos_cxp(entidad_id, proveedor_id, fecha);
CREATE TABLE IF NOT EXISTS fin_aplicaciones_cxp (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  documento_cxp_id INTEGER NOT NULL REFERENCES fin_documentos_cxp(id),
  pago_cxp_id INTEGER NOT NULL REFERENCES fin_pagos_cxp(id),
  evento_financiero_id INTEGER NOT NULL REFERENCES fin_eventos_financieros(id),
  importe_minor INTEGER NOT NULL CHECK(importe_minor > 0),
  fecha_aplicacion TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'confirmada' CHECK(estado IN ('confirmada','revertida')),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(documento_cxp_id, pago_cxp_id)
);
CREATE INDEX IF NOT EXISTS idx_fin_aplicaciones_cxp_documento ON fin_aplicaciones_cxp(documento_cxp_id, estado);
CREATE INDEX IF NOT EXISTS idx_fin_aplicaciones_cxp_pago ON fin_aplicaciones_cxp(pago_cxp_id, estado);
CREATE TRIGGER IF NOT EXISTS trg_fin_pagos_cxp_integridad BEFORE INSERT ON fin_pagos_cxp BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM proveedores p WHERE p.id=NEW.proveedor_id AND p.activo=1) THEN RAISE(ABORT,'El proveedor del pago CxP no está activo') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_eventos_financieros e WHERE e.id=NEW.evento_financiero_id AND e.entidad_id=NEW.entidad_id AND e.tipo='pago_compra') THEN RAISE(ABORT,'El evento de pago no pertenece a la entidad') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_cuentas_financieras c WHERE c.id=NEW.cuenta_financiera_id AND c.entidad_id=NEW.entidad_id AND c.estado='activa') THEN RAISE(ABORT,'La cuenta origen no pertenece a la entidad') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_bolsillos b WHERE b.id=NEW.bolsillo_id AND b.entidad_id=NEW.entidad_id AND b.estado='activa') THEN RAISE(ABORT,'El bolsillo origen no pertenece a la entidad') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_movimientos_tesoreria m WHERE m.evento_id=NEW.evento_financiero_id AND m.cuenta_financiera_id=NEW.cuenta_financiera_id AND m.importe_minor=-NEW.importe_minor) THEN RAISE(ABORT,'El pago no coincide con tesorería') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id WHERE a.evento_id=NEW.evento_financiero_id AND pc.entidad_id=NEW.entidad_id AND pc.codigo='2101' AND l.debe_minor=NEW.importe_minor AND l.haber_minor=0) THEN RAISE(ABORT,'El pago no debita la cuenta 2101') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_asignaciones_bolsillo a WHERE a.evento_id=NEW.evento_financiero_id AND a.cuenta_origen_id=NEW.cuenta_financiera_id AND a.bolsillo_origen_id=NEW.bolsillo_id AND a.importe_minor=NEW.importe_minor) THEN RAISE(ABORT,'El pago no coincide con el bolsillo') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_cuentas_financieras c WHERE c.id=NEW.cuenta_financiera_id AND ((NEW.metodo_pago='Efectivo' AND c.tipo='caja') OR (NEW.metodo_pago IN ('Yape','Plin') AND c.tipo='billetera') OR (NEW.metodo_pago='Transferencia' AND c.tipo='banco') OR (NEW.metodo_pago='Tarjeta' AND c.tipo='procesador'))) THEN RAISE(ABORT,'El método no coincide con el tipo de cuenta financiera') END;
  SELECT CASE WHEN NEW.metodo_pago='Efectivo' AND NOT EXISTS (SELECT 1 FROM turnos_caja t JOIN cajas c ON c.id=t.caja_id WHERE t.id=NEW.turno_caja_id AND t.estado='abierto' AND c.entidad_id=NEW.entidad_id AND c.cuenta_financiera_id=NEW.cuenta_financiera_id) THEN RAISE(ABORT,'El efectivo no coincide con el turno de caja') END;
  SELECT CASE WHEN NEW.metodo_pago<>'Efectivo' AND NEW.turno_caja_id IS NOT NULL THEN RAISE(ABORT,'Solo el efectivo puede vincularse a un turno de caja') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_aplicaciones_cxp_integridad BEFORE INSERT ON fin_aplicaciones_cxp BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_pagos_cxp p JOIN fin_documentos_cxp d ON d.id=NEW.documento_cxp_id WHERE p.id=NEW.pago_cxp_id AND p.estado='pendiente' AND p.evento_financiero_id=NEW.evento_financiero_id AND p.entidad_id=d.entidad_id AND p.proveedor_id=d.proveedor_id AND d.estado<>'anulada') THEN RAISE(ABORT,'La aplicación no coincide con el pago, proveedor y CxP') END;
  SELECT CASE WHEN (COALESCE((SELECT SUM(a.importe_minor) FROM fin_aplicaciones_cxp a WHERE a.documento_cxp_id=NEW.documento_cxp_id AND a.estado='confirmada'),0)+NEW.importe_minor) > (SELECT importe_original_minor FROM fin_documentos_cxp WHERE id=NEW.documento_cxp_id) THEN RAISE(ABORT,'La aplicación supera el saldo de la CxP') END;
  SELECT CASE WHEN (COALESCE((SELECT SUM(a.importe_minor) FROM fin_aplicaciones_cxp a WHERE a.pago_cxp_id=NEW.pago_cxp_id AND a.estado='confirmada'),0)+NEW.importe_minor) > (SELECT importe_minor FROM fin_pagos_cxp WHERE id=NEW.pago_cxp_id) THEN RAISE(ABORT,'Las aplicaciones superan el importe del pago') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_pagos_cxp_confirmar BEFORE UPDATE OF estado ON fin_pagos_cxp WHEN OLD.estado='pendiente' AND NEW.estado='confirmado' BEGIN
  SELECT CASE WHEN (SELECT COALESCE(SUM(importe_minor),0) FROM fin_aplicaciones_cxp WHERE pago_cxp_id=NEW.id AND estado='confirmada') <> NEW.importe_minor THEN RAISE(ABORT,'Las aplicaciones deben totalizar el importe del pago') END;
END;
DROP TRIGGER IF EXISTS trg_fin_pagos_cxp_no_update;
CREATE TRIGGER trg_fin_pagos_cxp_no_update BEFORE UPDATE ON fin_pagos_cxp WHEN OLD.estado='confirmado' AND NEW.estado<>'revertido' BEGIN SELECT RAISE(ABORT,'Los pagos CxP confirmados son inmutables; usa una reversión'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_pagos_cxp_no_delete BEFORE DELETE ON fin_pagos_cxp BEGIN SELECT RAISE(ABORT,'Los pagos CxP no se eliminan'); END;
DROP TRIGGER IF EXISTS trg_fin_aplicaciones_cxp_no_update;
CREATE TRIGGER trg_fin_aplicaciones_cxp_no_update BEFORE UPDATE ON fin_aplicaciones_cxp WHEN OLD.estado='confirmada' AND NEW.estado<>'revertida' BEGIN SELECT RAISE(ABORT,'Las aplicaciones CxP confirmadas son inmutables; usa una reversión'); END;
CREATE TABLE IF NOT EXISTS fin_notas_credito_cxp (
  id INTEGER PRIMARY KEY AUTOINCREMENT, documento_cxp_id INTEGER NOT NULL REFERENCES fin_documentos_cxp(id), entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id),
  lote_compra_id INTEGER NOT NULL REFERENCES lotes_compra(id), evento_financiero_id INTEGER NOT NULL UNIQUE REFERENCES fin_eventos_financieros(id),
  cantidad_base REAL NOT NULL CHECK(cantidad_base>0), importe_minor INTEGER NOT NULL CHECK(importe_minor>0), fecha TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'confirmada' CHECK(estado='confirmada'), creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS trg_fin_notas_credito_cxp_integridad BEFORE INSERT ON fin_notas_credito_cxp BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fin_documentos_cxp d JOIN lotes_compra l ON l.id=d.lote_compra_id WHERE d.id=NEW.documento_cxp_id AND d.entidad_id=NEW.entidad_id AND l.id=NEW.lote_compra_id) THEN RAISE(ABORT,'La nota no coincide con la CxP y lote') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fin_eventos_financieros e WHERE e.id=NEW.evento_financiero_id AND e.entidad_id=NEW.entidad_id AND e.tipo='nota_credito_compra') THEN RAISE(ABORT,'El evento de nota no pertenece a la entidad') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_notas_credito_cxp_reglas BEFORE INSERT ON fin_notas_credito_cxp BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM fin_documentos_cxp WHERE id=NEW.documento_cxp_id AND estado='anulada') THEN RAISE(ABORT,'No se puede corregir una CxP anulada') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM fin_movimientos_tesoreria WHERE evento_id=NEW.evento_financiero_id) THEN RAISE(ABORT,'La nota de credito no puede mover tesoreria') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id WHERE a.evento_id=NEW.evento_financiero_id AND pc.entidad_id=NEW.entidad_id AND pc.codigo='2101' AND l.debe_minor=NEW.importe_minor AND l.haber_minor=0) THEN RAISE(ABORT,'La nota no debita 2101 por su importe') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id WHERE a.evento_id=NEW.evento_financiero_id AND pc.entidad_id=NEW.entidad_id AND pc.codigo='1301' AND l.debe_minor=0 AND l.haber_minor=NEW.importe_minor) THEN RAISE(ABORT,'La nota no acredita 1301 por su importe') END;
 SELECT CASE WHEN NEW.cantidad_base>(SELECT cantidad_restante FROM lotes_compra WHERE id=NEW.lote_compra_id) THEN RAISE(ABORT,'La nota supera el inventario disponible') END;
 SELECT CASE WHEN NEW.importe_minor>(SELECT d.importe_original_minor-COALESCE((SELECT SUM(a.importe_minor) FROM fin_aplicaciones_cxp a WHERE a.documento_cxp_id=d.id AND a.estado='confirmada'),0)-COALESCE((SELECT SUM(n.importe_minor) FROM fin_notas_credito_cxp n WHERE n.documento_cxp_id=d.id AND n.estado='confirmada'),0) FROM fin_documentos_cxp d WHERE d.id=NEW.documento_cxp_id) THEN RAISE(ABORT,'La nota supera el saldo corregible de la CxP') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_notas_credito_cxp_no_update BEFORE UPDATE ON fin_notas_credito_cxp BEGIN SELECT RAISE(ABORT,'Las notas de credito CxP confirmadas son inmutables'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_notas_credito_cxp_no_delete BEFORE DELETE ON fin_notas_credito_cxp BEGIN SELECT RAISE(ABORT,'Las notas de credito CxP no se eliminan'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_aplicaciones_cxp_no_delete BEFORE DELETE ON fin_aplicaciones_cxp BEGIN SELECT RAISE(ABORT,'Las aplicaciones CxP no se eliminan'); END;
CREATE TABLE IF NOT EXISTS fin_cobros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id),
  pago_id INTEGER NOT NULL UNIQUE REFERENCES pagos(id),
  documento_cxc_id INTEGER NOT NULL REFERENCES fin_documentos_cxc(id),
  evento_financiero_id INTEGER NOT NULL UNIQUE REFERENCES fin_eventos_financieros(id),
  cuenta_financiera_id INTEGER NOT NULL REFERENCES fin_cuentas_financieras(id),
  bolsillo_id INTEGER NOT NULL REFERENCES fin_bolsillos(id),
  turno_caja_id INTEGER REFERENCES turnos_caja(id),
  metodo_pago TEXT NOT NULL CHECK(metodo_pago IN ('Efectivo','Yape','Plin','Transferencia','Tarjeta')),
  importe_minor INTEGER NOT NULL CHECK(importe_minor > 0),
  fecha TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'confirmado' CHECK(estado IN ('confirmado','revertido')),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT(datetime('now'))
);
CREATE TABLE IF NOT EXISTS fin_aplicaciones_cxc (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  documento_cxc_id INTEGER NOT NULL REFERENCES fin_documentos_cxc(id),
  cobro_id INTEGER NOT NULL UNIQUE REFERENCES fin_cobros(id),
  evento_financiero_id INTEGER NOT NULL REFERENCES fin_eventos_financieros(id),
  importe_minor INTEGER NOT NULL CHECK(importe_minor > 0),
  fecha_aplicacion TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'confirmada' CHECK(estado IN ('confirmada','revertida')),
  creado_por INTEGER NOT NULL REFERENCES usuarios(id),
  creado_en TEXT NOT NULL DEFAULT(datetime('now')),
  UNIQUE(documento_cxc_id, evento_financiero_id)
);
CREATE TRIGGER IF NOT EXISTS trg_fin_documentos_cxc_integridad BEFORE INSERT ON fin_documentos_cxc BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ventas v WHERE v.id=NEW.venta_id AND v.cliente_id=NEW.cliente_id) THEN RAISE(ABORT,'La CxC no coincide con la venta y el cliente') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_eventos_financieros e WHERE e.id=NEW.evento_emision_id AND e.entidad_id=NEW.entidad_id AND e.tipo='emision_venta') THEN RAISE(ABORT,'El evento de emisión no pertenece a la entidad') END;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM fin_movimientos_tesoreria WHERE evento_id=NEW.evento_emision_id) THEN RAISE(ABORT,'La emisión de CxC no puede mover tesorería') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id WHERE a.evento_id=NEW.evento_emision_id AND pc.entidad_id=NEW.entidad_id AND pc.codigo='1201' AND l.debe_minor=NEW.importe_original_minor AND l.haber_minor=0) THEN RAISE(ABORT,'La emisión no debita 1201 por el importe de la CxC') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id WHERE a.evento_id=NEW.evento_emision_id AND pc.entidad_id=NEW.entidad_id AND pc.codigo='4101' AND l.debe_minor=0 AND l.haber_minor=NEW.importe_original_minor) THEN RAISE(ABORT,'La emisión no acredita 4101 por el importe de la CxC') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_cobros_integridad BEFORE INSERT ON fin_cobros BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_documentos_cxc d JOIN pagos p ON p.id=NEW.pago_id WHERE d.id=NEW.documento_cxc_id AND d.entidad_id=NEW.entidad_id AND p.venta_id=d.venta_id) THEN RAISE(ABORT,'El cobro no coincide con la venta y la CxC') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_eventos_financieros e WHERE e.id=NEW.evento_financiero_id AND e.entidad_id=NEW.entidad_id AND e.tipo='cobro_venta') THEN RAISE(ABORT,'El evento de cobro no pertenece a la entidad') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_cuentas_financieras c WHERE c.id=NEW.cuenta_financiera_id AND c.entidad_id=NEW.entidad_id AND c.estado='activa') THEN RAISE(ABORT,'La cuenta receptora no pertenece a la entidad') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_bolsillos b WHERE b.id=NEW.bolsillo_id AND b.entidad_id=NEW.entidad_id AND b.estado='activa') THEN RAISE(ABORT,'El bolsillo receptor no pertenece a la entidad') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_movimientos_tesoreria m WHERE m.evento_id=NEW.evento_financiero_id AND m.cuenta_financiera_id=NEW.cuenta_financiera_id AND m.importe_minor=NEW.importe_minor) THEN RAISE(ABORT,'El cobro no coincide con tesorería') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id JOIN fin_plan_cuentas pc ON pc.id=l.cuenta_contable_id WHERE a.evento_id=NEW.evento_financiero_id AND pc.entidad_id=NEW.entidad_id AND pc.codigo='1201' AND l.debe_minor=0 AND l.haber_minor=NEW.importe_minor) THEN RAISE(ABORT,'El cobro no acredita la cuenta 1201') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_asignaciones_bolsillo a WHERE a.evento_id=NEW.evento_financiero_id AND a.cuenta_destino_id=NEW.cuenta_financiera_id AND a.bolsillo_destino_id=NEW.bolsillo_id AND a.importe_minor=NEW.importe_minor) THEN RAISE(ABORT,'El cobro no coincide con el bolsillo') END;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_cuentas_financieras c WHERE c.id=NEW.cuenta_financiera_id AND ((NEW.metodo_pago='Efectivo' AND c.tipo='caja') OR (NEW.metodo_pago IN ('Yape','Plin') AND c.tipo='billetera') OR (NEW.metodo_pago='Transferencia' AND c.tipo='banco') OR (NEW.metodo_pago='Tarjeta' AND c.tipo='procesador'))) THEN RAISE(ABORT,'El método no coincide con el tipo de cuenta financiera') END;
  SELECT CASE WHEN NEW.metodo_pago='Efectivo' AND NOT EXISTS (SELECT 1 FROM turnos_caja t JOIN cajas c ON c.id=t.caja_id WHERE t.id=NEW.turno_caja_id AND t.estado='abierto' AND c.entidad_id=NEW.entidad_id AND c.cuenta_financiera_id=NEW.cuenta_financiera_id) THEN RAISE(ABORT,'El efectivo no coincide con el turno de caja') END;
  SELECT CASE WHEN NEW.metodo_pago<>'Efectivo' AND NEW.turno_caja_id IS NOT NULL THEN RAISE(ABORT,'Solo el efectivo puede vincularse a un turno de caja') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_aplicaciones_cxc_integridad BEFORE INSERT ON fin_aplicaciones_cxc BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_cobros c WHERE c.id=NEW.cobro_id AND c.documento_cxc_id=NEW.documento_cxc_id AND c.evento_financiero_id=NEW.evento_financiero_id AND c.importe_minor=NEW.importe_minor AND c.estado='confirmado') THEN RAISE(ABORT,'La aplicación no coincide con el cobro') END;
  SELECT CASE WHEN (COALESCE((SELECT SUM(a.importe_minor) FROM fin_aplicaciones_cxc a WHERE a.documento_cxc_id=NEW.documento_cxc_id AND a.estado='confirmada'),0)+NEW.importe_minor) > (SELECT importe_original_minor FROM fin_documentos_cxc WHERE id=NEW.documento_cxc_id) THEN RAISE(ABORT,'La aplicación supera el saldo de la CxC') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_cobros_no_update BEFORE UPDATE ON fin_cobros WHEN OLD.estado='confirmado' BEGIN SELECT RAISE(ABORT,'Los cobros confirmados son inmutables; usa una reversión'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_cobros_no_delete BEFORE DELETE ON fin_cobros BEGIN SELECT RAISE(ABORT,'Los cobros no se eliminan'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_aplicaciones_no_update BEFORE UPDATE ON fin_aplicaciones_cxc WHEN OLD.estado='confirmada' BEGIN SELECT RAISE(ABORT,'Las aplicaciones confirmadas son inmutables; usa una reversión'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_aplicaciones_no_delete BEFORE DELETE ON fin_aplicaciones_cxc BEGIN SELECT RAISE(ABORT,'Las aplicaciones no se eliminan'); END;
CREATE TRIGGER IF NOT EXISTS trg_pagos_cxc_no_update BEFORE UPDATE ON pagos WHEN OLD.cobro_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'Los pagos vinculados a CxC son inmutables'); END;
CREATE TRIGGER IF NOT EXISTS trg_pagos_cxc_no_delete BEFORE DELETE ON pagos WHEN OLD.cobro_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'Los pagos vinculados a CxC no se eliminan'); END;
CREATE INDEX IF NOT EXISTS idx_fin_eventos_entidad_fecha ON fin_eventos_financieros(entidad_id, fecha, id);
DROP TRIGGER IF EXISTS trg_fin_eventos_no_update;
CREATE TRIGGER trg_fin_eventos_no_update BEFORE UPDATE ON fin_eventos_financieros BEGIN SELECT RAISE(ABORT,'Los eventos confirmados son inmutables; usa una reversión'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_eventos_no_delete BEFORE DELETE ON fin_eventos_financieros WHEN OLD.estado IN ('confirmado','revertido') BEGIN SELECT RAISE(ABORT,'Los eventos confirmados no se eliminan'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_eventos_no_update BEFORE UPDATE ON fin_eventos_financieros WHEN OLD.estado='revertido' OR (OLD.estado='confirmado' AND NEW.estado<>'revertido') BEGIN SELECT RAISE(ABORT,'Los eventos confirmados son inmutables; usa una reversión'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_asientos_no_update BEFORE UPDATE ON fin_asientos_contables WHEN OLD.estado IN ('confirmado','revertido') BEGIN SELECT RAISE(ABORT,'Los asientos confirmados son inmutables'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_asientos_no_delete BEFORE DELETE ON fin_asientos_contables WHEN OLD.estado IN ('confirmado','revertido') BEGIN SELECT RAISE(ABORT,'Los asientos confirmados no se eliminan'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_lineas_no_update BEFORE UPDATE ON fin_lineas_asiento WHEN EXISTS(SELECT 1 FROM fin_asientos_contables WHERE id=OLD.asiento_id AND estado IN ('confirmado','revertido')) BEGIN SELECT RAISE(ABORT,'Las líneas confirmadas son inmutables'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_lineas_no_delete BEFORE DELETE ON fin_lineas_asiento WHEN EXISTS(SELECT 1 FROM fin_asientos_contables WHERE id=OLD.asiento_id AND estado IN ('confirmado','revertido')) BEGIN SELECT RAISE(ABORT,'Las líneas confirmadas no se eliminan'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_tesoreria_no_update BEFORE UPDATE ON fin_movimientos_tesoreria BEGIN SELECT RAISE(ABORT,'Los movimientos de tesorería son inmutables'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_tesoreria_no_delete BEFORE DELETE ON fin_movimientos_tesoreria BEGIN SELECT RAISE(ABORT,'Los movimientos de tesorería no se eliminan'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_asignaciones_no_update BEFORE UPDATE ON fin_asignaciones_bolsillo WHEN EXISTS(SELECT 1 FROM fin_eventos_financieros WHERE id=OLD.evento_id AND estado IN ('confirmado','revertido')) BEGIN SELECT RAISE(ABORT,'Las asignaciones confirmadas son inmutables'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_asignaciones_no_delete BEFORE DELETE ON fin_asignaciones_bolsillo WHEN EXISTS(SELECT 1 FROM fin_eventos_financieros WHERE id=OLD.evento_id AND estado IN ('confirmado','revertido')) BEGIN SELECT RAISE(ABORT,'Las asignaciones confirmadas no se eliminan'); END;
CREATE TRIGGER IF NOT EXISTS trg_fin_participacion_sin_solape_update BEFORE UPDATE OF entidad_id, propietario_id, porcentaje_minor, fecha_inicio, fecha_fin, estado ON fin_participaciones WHEN NEW.estado = 'activa' BEGIN
  SELECT CASE WHEN EXISTS (SELECT 1 FROM fin_participaciones p WHERE p.id <> NEW.id AND p.entidad_id = NEW.entidad_id AND p.propietario_id = NEW.propietario_id AND p.estado = 'activa' AND p.fecha_inicio <= COALESCE(NEW.fecha_fin, '9999-12-31') AND COALESCE(p.fecha_fin, '9999-12-31') >= NEW.fecha_inicio) THEN RAISE(ABORT, 'La participación activa se superpone con otra participación del mismo propietario') END;
  SELECT CASE WHEN (COALESCE((SELECT SUM(COALESCE(porcentaje_minor,0)) FROM fin_participaciones WHERE entidad_id = NEW.entidad_id AND estado = 'activa' AND id <> NEW.id),0) + COALESCE(NEW.porcentaje_minor,0)) > 10000 THEN RAISE(ABORT, 'Las participaciones activas no pueden superar 10000') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_cuenta_financiera_mapeo_insert BEFORE INSERT ON fin_cuentas_financieras BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_plan_cuentas pc WHERE pc.id = NEW.cuenta_contable_id AND pc.entidad_id = NEW.entidad_id AND pc.naturaleza = 'activo' AND pc.estado = 'activa' AND pc.permite_movimiento = 1 AND ((NEW.tipo IN ('caja','banco','billetera','transito') AND pc.subtipo = 'efectivo_equivalente') OR (NEW.tipo = 'custodia_tercero' AND pc.subtipo = 'custodia_tercero') OR (NEW.tipo = 'procesador' AND pc.subtipo = 'fondos_procesador'))) THEN RAISE(ABORT, 'El mapeo cuenta financiera/cuenta contable no es válido') END;
END;
CREATE TRIGGER IF NOT EXISTS trg_fin_cuenta_financiera_mapeo_update BEFORE UPDATE OF entidad_id, cuenta_contable_id, tipo ON fin_cuentas_financieras BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM fin_plan_cuentas pc WHERE pc.id = NEW.cuenta_contable_id AND pc.entidad_id = NEW.entidad_id AND pc.naturaleza = 'activo' AND pc.estado = 'activa' AND pc.permite_movimiento = 1 AND ((NEW.tipo IN ('caja','banco','billetera','transito') AND pc.subtipo = 'efectivo_equivalente') OR (NEW.tipo = 'custodia_tercero' AND pc.subtipo = 'custodia_tercero') OR (NEW.tipo = 'procesador' AND pc.subtipo = 'fondos_procesador'))) THEN RAISE(ABORT, 'El mapeo cuenta financiera/cuenta contable no es válido') END;
END;
