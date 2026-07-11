-- Fundación financiera MVP 1: catálogos. No contiene eventos ni movimientos.
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
CREATE TABLE IF NOT EXISTS fin_eventos_financieros (id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), tipo TEXT NOT NULL CHECK(tipo IN ('saldo_inicial','transferencia_interna','reasignacion_bolsillo','reversion')), estado TEXT NOT NULL DEFAULT 'confirmado' CHECK(estado='confirmado'), fecha TEXT NOT NULL, moneda TEXT NOT NULL DEFAULT 'PEN' CHECK(moneda='PEN'), descripcion TEXT NOT NULL, reversion_de_id INTEGER UNIQUE REFERENCES fin_eventos_financieros(id), creado_por INTEGER NOT NULL REFERENCES usuarios(id), creado_en TEXT NOT NULL DEFAULT(datetime('now')));
CREATE TABLE IF NOT EXISTS fin_eventos_por_entidad (id INTEGER PRIMARY KEY AUTOINCREMENT, evento_id INTEGER NOT NULL REFERENCES fin_eventos_financieros(id), entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), UNIQUE(evento_id, entidad_id));
CREATE TABLE IF NOT EXISTS fin_asientos_contables (id INTEGER PRIMARY KEY AUTOINCREMENT, evento_id INTEGER NOT NULL UNIQUE REFERENCES fin_eventos_financieros(id), entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), periodo_id INTEGER NOT NULL REFERENCES fin_periodos(id), fecha TEXT NOT NULL, estado TEXT NOT NULL DEFAULT 'confirmado' CHECK(estado='confirmado'), glosa TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS fin_lineas_asiento (id INTEGER PRIMARY KEY AUTOINCREMENT, asiento_id INTEGER NOT NULL REFERENCES fin_asientos_contables(id), cuenta_contable_id INTEGER NOT NULL REFERENCES fin_plan_cuentas(id), cuenta_financiera_id INTEGER REFERENCES fin_cuentas_financieras(id), debe_minor INTEGER NOT NULL DEFAULT 0 CHECK(debe_minor>=0), haber_minor INTEGER NOT NULL DEFAULT 0 CHECK(haber_minor>=0), CHECK((debe_minor>0 AND haber_minor=0) OR (haber_minor>0 AND debe_minor=0)));
CREATE TABLE IF NOT EXISTS fin_movimientos_tesoreria (id INTEGER PRIMARY KEY AUTOINCREMENT, evento_id INTEGER NOT NULL REFERENCES fin_eventos_financieros(id), linea_asiento_id INTEGER NOT NULL UNIQUE REFERENCES fin_lineas_asiento(id), cuenta_financiera_id INTEGER NOT NULL REFERENCES fin_cuentas_financieras(id), importe_minor INTEGER NOT NULL CHECK(importe_minor<>0), moneda TEXT NOT NULL DEFAULT 'PEN' CHECK(moneda='PEN'));
CREATE TABLE IF NOT EXISTS fin_asignaciones_bolsillo (id INTEGER PRIMARY KEY AUTOINCREMENT, evento_id INTEGER NOT NULL REFERENCES fin_eventos_financieros(id), cuenta_origen_id INTEGER REFERENCES fin_cuentas_financieras(id), bolsillo_origen_id INTEGER REFERENCES fin_bolsillos(id), cuenta_destino_id INTEGER REFERENCES fin_cuentas_financieras(id), bolsillo_destino_id INTEGER REFERENCES fin_bolsillos(id), importe_minor INTEGER NOT NULL CHECK(importe_minor>0), moneda TEXT NOT NULL DEFAULT 'PEN' CHECK(moneda='PEN'), CHECK(cuenta_origen_id IS NOT NULL OR cuenta_destino_id IS NOT NULL));
CREATE TABLE IF NOT EXISTS fin_claves_idempotencia (id INTEGER PRIMARY KEY AUTOINCREMENT, entidad_id INTEGER NOT NULL REFERENCES fin_entidades_economicas(id), clave TEXT NOT NULL, hash_payload TEXT NOT NULL, evento_id INTEGER REFERENCES fin_eventos_financieros(id), UNIQUE(entidad_id, clave));
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
