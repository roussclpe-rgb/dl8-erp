const express = require("express");
const { requireAuth, requireRole } = require("../middleware/auth");
const catalogos = require("../services/finanzas/catalogos");

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
module.exports = router;
