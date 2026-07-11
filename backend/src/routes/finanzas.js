const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const catalogos = require("../services/finanzas/catalogos");
const motor = require("../services/finanzas/motor");
const { db } = require("../db");

const router = express.Router();
router.use(requireAuth);
const responder = (res, fn) => {
  try { res.status(201).json(fn()); } catch (e) {
    res.status(e.status || 400).json({ error: e.status ? e.message : "No se pudo procesar la solicitud financiera." });
  }
};
const acceso = (...roles) => (req, res, next) => { try { catalogos.exigirAcceso(req.params.entidadId, req.usuario.id, roles); next(); } catch (e) { res.status(e.status || 403).json({ error: e.message }); } };

router.get("/entidades", (req, res) => res.json(catalogos.listarEntidadesParaUsuario(req.usuario.id)));
router.post("/entidades", requireRole("admin"), (req, res) => responder(res, () => catalogos.crearEntidadFundacion({ codigo: req.body.codigo, nombre: req.body.nombre, tipo: req.body.tipo, fechaInicial: req.body.fecha_inicial, usuarioId: req.usuario.id })));
router.post("/propietarios", requireRole("admin"), (req, res) => responder(res, () => catalogos.crearPropietario({ tipo: req.body.tipo, nombre: req.body.nombre, documentoTipo: req.body.documento_tipo, documentoNumero: req.body.documento_numero, usuarioId: req.body.usuario_id, creadoPor: req.usuario.id })));

router.get("/entidades/:entidadId/periodos", acceso(...catalogos.ROLES_FINANCIEROS), (req, res) => res.json(catalogos.listarPorEntidad("periodos", req.params.entidadId)));
router.post("/entidades/:entidadId/periodos/:periodoId/cerrar", acceso("finanzas_admin"), (req, res) => responder(res, () => catalogos.cerrarPeriodo({ entidadId: req.params.entidadId, periodoId: req.params.periodoId, usuarioId: req.usuario.id })));
router.get("/entidades/:entidadId/plan-cuentas", acceso(...catalogos.ROLES_FINANCIEROS), (req, res) => res.json(catalogos.listarPorEntidad("cuentas", req.params.entidadId)));
router.post("/entidades/:entidadId/plan-cuentas", acceso("finanzas_admin"), (req, res) => responder(res, () => catalogos.crearCuentaPlan({ entidadId: req.params.entidadId, codigo: req.body.codigo, nombre: req.body.nombre, naturaleza: req.body.naturaleza, subtipo: req.body.subtipo, permiteMovimiento: req.body.permite_movimiento, usuarioId: req.usuario.id })));
router.get("/entidades/:entidadId/cuentas-financieras", acceso(...catalogos.ROLES_FINANCIEROS), (req, res) => res.json(catalogos.listarPorEntidad("cuentas_financieras", req.params.entidadId)));
router.post("/entidades/:entidadId/cuentas-financieras", acceso("finanzas_admin"), (req, res) => responder(res, () => catalogos.crearCuentaFinanciera({ entidadId: req.params.entidadId, cuentaContableId: req.body.cuenta_contable_id, codigo: req.body.codigo, nombre: req.body.nombre, tipo: req.body.tipo, titularLegal: req.body.titular_legal, custodioPropietarioId: req.body.custodio_propietario_id, custodioEntidadId: req.body.custodio_entidad_id, referenciaExterna: req.body.referencia_externa, usuarioId: req.usuario.id })));
router.get("/entidades/:entidadId/bolsillos", acceso(...catalogos.ROLES_FINANCIEROS), (req, res) => res.json(catalogos.listarPorEntidad("bolsillos", req.params.entidadId)));
router.post("/entidades/:entidadId/bolsillos", acceso("finanzas_admin"), (req, res) => responder(res, () => catalogos.crearBolsillo({ entidadId: req.params.entidadId, codigo: req.body.codigo, nombre: req.body.nombre, tipo: req.body.tipo, permiteSaldoNegativo: req.body.permite_saldo_negativo, usuarioId: req.usuario.id })));
router.get("/entidades/:entidadId/participaciones", acceso(...catalogos.ROLES_FINANCIEROS), (req, res) => res.json(catalogos.listarPorEntidad("participaciones", req.params.entidadId)));
router.post("/entidades/:entidadId/participaciones", acceso("finanzas_admin"), (req, res) => responder(res, () => catalogos.crearParticipacion({ entidadId: req.params.entidadId, propietarioId: req.body.propietario_id, porcentajeMinor: req.body.porcentaje_minor, cuentaCapitalId: req.body.cuenta_capital_id, fechaInicio: req.body.fecha_inicio, fechaFin: req.body.fecha_fin, usuarioId: req.usuario.id })));
router.get("/entidades/:entidadId/accesos", acceso("finanzas_admin"), (req, res) => res.json(catalogos.listarPorEntidad("accesos", req.params.entidadId)));
router.post("/entidades/:entidadId/accesos", acceso("finanzas_admin"), (req, res) => responder(res, () => catalogos.otorgarAcceso({ entidadId: req.params.entidadId, usuarioObjetivoId: req.body.usuario_id, rolFinanciero: req.body.rol_financiero, usuarioId: req.usuario.id })));
router.patch("/entidades/:entidadId/:tipo(plan-cuentas|cuentas-financieras|bolsillos)/:id/estado", acceso("finanzas_admin"), (req, res) => responder(res, () => catalogos.cambiarEstadoCatalogo({ tipo: req.params.tipo.replaceAll("-", "_"), entidadId: req.params.entidadId, id: req.params.id, estado: req.body.estado, usuarioId: req.usuario.id })));
const clave=req=>req.get('Idempotency-Key');
router.post('/entidades/:entidadId/saldos-iniciales',acceso('finanzas_admin','finanzas_personal_propietario'),(req,res)=>responder(res,()=>motor.inicial(+req.params.entidadId,req.usuario.id,clave(req),req.body)));
router.post('/entidades/:entidadId/transferencias-internas',acceso('finanzas_admin','finanzas_operador','finanzas_personal_propietario'),(req,res)=>responder(res,()=>motor.transferencia(+req.params.entidadId,req.usuario.id,clave(req),req.body)));
router.post('/entidades/:entidadId/asignaciones-bolsillo',acceso('finanzas_admin','finanzas_operador','finanzas_personal_propietario'),(req,res)=>responder(res,()=>motor.reasignar(+req.params.entidadId,req.usuario.id,clave(req),req.body)));
router.get('/entidades/:entidadId/eventos',acceso(...catalogos.ROLES_FINANCIEROS),(req,res)=>res.json(motor.eventos(+req.params.entidadId)));
router.get('/entidades/:entidadId/eventos/:eventoId',acceso(...catalogos.ROLES_FINANCIEROS),(req,res)=>{const x=motor.eventos(+req.params.entidadId).find(e=>e.id===+req.params.eventoId);if(!x)return res.status(404).json({error:'Evento no encontrado'});res.json(x)});
router.get('/entidades/:entidadId/saldos/tesoreria',acceso(...catalogos.ROLES_FINANCIEROS),(req,res)=>res.json(motor.saldos(+req.params.entidadId).tesoreria));
router.get('/entidades/:entidadId/saldos/bolsillos',acceso(...catalogos.ROLES_FINANCIEROS),(req,res)=>res.json(motor.saldos(+req.params.entidadId).bolsillos));
router.get('/entidades/:entidadId/saldos/respaldo-cuenta-bolsillo',acceso(...catalogos.ROLES_FINANCIEROS),(req,res)=>{try{const entidadId=+req.params.entidadId;const validarId=(valor,tabla)=>{if(valor==null)return null;const id=Number(valor);if(!Number.isSafeInteger(id)||id<=0||!db.prepare(`SELECT 1 FROM ${tabla} WHERE id=? AND entidad_id=?`).get(id,entidadId)){const e=new Error('Recurso financiero no encontrado');e.status=404;throw e}return id};const cuentaId=validarId(req.query.cuenta_financiera_id,'fin_cuentas_financieras');const bolsilloId=validarId(req.query.bolsillo_id,'fin_bolsillos');res.json(db.prepare('SELECT a.cuenta_destino_id cuenta_financiera_id,a.bolsillo_destino_id bolsillo_id,SUM(a.importe_minor) saldo_minor FROM fin_asignaciones_bolsillo a JOIN fin_eventos_financieros e ON e.id=a.evento_id WHERE e.entidad_id=? AND a.cuenta_destino_id IS NOT NULL AND (? IS NULL OR a.cuenta_destino_id=?) AND (? IS NULL OR a.bolsillo_destino_id=?) GROUP BY a.cuenta_destino_id,a.bolsillo_destino_id').all(entidadId,cuentaId,cuentaId,bolsilloId,bolsilloId))}catch(e){res.status(e.status||400).json({error:e.status?e.message:'No se pudo consultar el respaldo financiero.'})}});
router.get('/entidades/:entidadId/saldos/contables',acceso(...catalogos.ROLES_FINANCIEROS),(req,res)=>res.json(require('../db').db.prepare('SELECT l.cuenta_contable_id,SUM(l.debe_minor-l.haber_minor) saldo_minor FROM fin_lineas_asiento l JOIN fin_asientos_contables a ON a.id=l.asiento_id WHERE a.entidad_id=? GROUP BY l.cuenta_contable_id').all(+req.params.entidadId)));
router.post('/entidades/:entidadId/eventos/:eventoId/reversiones',acceso('finanzas_admin','finanzas_personal_propietario'),(req,res)=>responder(res,()=>motor.revertir({entidadId:+req.params.entidadId,eventoId:+req.params.eventoId,usuarioId:req.usuario.id,clave:clave(req)})));
module.exports = router;
