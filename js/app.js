'use strict';
/* ============================================================================
   Autoevaluación de Riesgos · Gestión de la Obra Pública
   Estructura del archivo:
     1. Configuración de Firebase y constantes
     2. Catálogos de opciones (etiquetas)
     3. Estado en memoria
     4. Utilidades
     5. Inicialización de Firebase + autenticación anónima
     6. Capa de datos (window.DB)
     7. Navegación entre vistas y tema
     8. Formulario: lógica condicional, validación, envío y borrador
     9. Tablero: agregaciones, KPIs, gráficos, tabla y exportación
   ============================================================================ */

/* ===== 1. Configuración de Firebase y constantes ===========================
   Definidas en js/firebase-config.js (se carga antes que este archivo):
   firebaseConfig, COLECCION, PERIODO_DEFAULT y BORRADOR_KEY.                */

/* ===== 2. Catálogos de opciones (etiquetas para tablero y exportación) ===== */
const CAT = {
  riesgo1_tipo: {
    estimacion_recursos: 'Estimación de recursos',
    imprecisiones: 'Imprecisiones en estudios/diseños',
    sin_errores: 'Sin errores'
  },
  riesgo1_etapas: {
    analisis: 'Análisis de requerimientos',
    factibilidad: 'Ciclo de factibilidad',
    estructuracion: 'Estructuración de proyectos'
  },
  riesgo2_tipo: {
    desconocimiento: 'Desconocimiento del proyecto',
    insuficiente_comunicacion: 'Comunicación insuficiente',
    sin_conflicto: 'Sin conflicto'
  },
  riesgo3_tipo: {
    administrativo: 'Administrativo/financiero',
    tecnico: 'Técnico',
    juridico: 'Jurídico',
    no_afectado: 'No afectado',
    otro: 'Otro'
  },
  corrupcion_tipo: {
    dadivas: 'Dádivas por cambios',
    estudios_previos: 'Estudios previos deficientes',
    no_multas: 'No solicita multas',
    informes_falsos: 'Informes de recibo falsos',
    ninguna: 'Ninguna actuación'
  }
};
const etiqueta = (grupo, clave) => (CAT[grupo] && CAT[grupo][clave]) || clave || '—';

/* ===== 3. Estado en memoria ===== */
let respuestas = [];       // documentos de Firestore
const charts = {};         // instancias de Chart.js
let filtroTabla = '';

/* ===== 4. Utilidades ===== */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

// Escapa texto para inyectarlo con seguridad en HTML.
const escapar = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Fecha para mostrar: DD/MM/AAAA HH:mm (es-CO)
const fmtFecha = (d) => {
  if (!d) return '—';
  const f = (d instanceof Date) ? d : (d.toDate ? d.toDate() : new Date(d));
  if (isNaN(f)) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(f.getDate())}/${p(f.getMonth() + 1)}/${f.getFullYear()} ${p(f.getHours())}:${p(f.getMinutes())}`;
};

// Toast de feedback
function toast(msg, tipo = 'ok') {
  const cont = $('#toasts');
  const colores = {
    ok:    'bg-marca-600',
    error: 'bg-rose-600',
    info:  'bg-slate-800 dark:bg-slate-700'
  };
  const el = document.createElement('div');
  el.className = `toast text-white text-sm font-medium px-4 py-2.5 rounded-xl shadow-lg ${colores[tipo] || colores.info}`;
  el.textContent = msg;
  cont.appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; }, 3200);
  setTimeout(() => el.remove(), 3600);
}

function setEstado(texto, clase) {
  const barra = $('#barra-estado');
  const chip = $('#estado-conexion');
  barra.classList.remove('hidden');
  chip.className = 'inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full ' + clase;
  chip.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-current"></span>${escapar(texto)}`;
}

/* ===== 5. Inicialización de Firebase + autenticación anónima ===============
   Patrón de dos niveles: sesión anónima al cargar para que las reglas puedan
   exigir request.auth != null. window.authReady resuelve cuando hay sesión. */
let db = null;
window.authReady = Promise.resolve(null);

try {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  // Robustez en redes institucionales (proxies / long-polling).
  db.settings({ experimentalAutoDetectLongPolling: true, merge: true });
  db.enablePersistence({ synchronizeTabs: true })
    .catch((err) => console.warn('Persistencia offline no disponible:', err && err.code));

  window.authReady = new Promise((resolve) => {
    firebase.auth().onAuthStateChanged((user) => { if (user) resolve(user); });
    firebase.auth().signInAnonymously().catch((err) => {
      console.error('Error de autenticación anónima:', err);
      setEstado('Sin autenticación (habilita el acceso Anónimo)', 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300');
      resolve(null); // degradación elegante: intentamos igual
    });
  });
} catch (err) {
  console.error('Error al inicializar Firebase:', err);
  setEstado('Error al iniciar Firebase: ' + (err.code || err.message), 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300');
}

/* ===== 6. Capa de datos (única que habla con Firestore) ===== */
window.DB = {
  async guardarRespuesta(datos) {
    if (!db) throw new Error('Firestore no está configurado.');
    await window.authReady;
    const uid = (firebase.auth().currentUser || {}).uid || null;
    return db.collection(COLECCION).add({
      ...datos,
      periodo: PERIODO_DEFAULT,
      uid,
      creado: firebase.firestore.FieldValue.serverTimestamp(),
      creadoISO: new Date().toISOString()
    });
  },
  // Escucha en tiempo real para el tablero.
  escuchar(callback) {
    if (!db) return () => {};
    return db.collection(COLECCION).orderBy('creado', 'desc').onSnapshot(
      (snap) => {
        const arr = [];
        snap.forEach((doc) => {
          const data = doc.data();
          if (data._seed) return; // omite el documento de inicialización de la colección
          arr.push({ id: doc.id, ...data });
        });
        callback(arr);
      },
      (err) => {
        console.error('Error al leer respuestas:', err);
        setEstado('Error al leer datos: ' + (err.code || err.message), 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300');
      }
    );
  }
};

/* ===== 7. Navegación entre vistas y tema ===== */
function irAVista(nombre) {
  $$('.vista').forEach((v) => v.classList.remove('activa'));
  const destino = $('#vista-' + nombre);
  if (destino) destino.classList.add('activa');
  // Estilos del segmentado
  $$('.tab-btn').forEach((b) => {
    const activo = b.dataset.vista === nombre;
    b.classList.toggle('bg-white', activo);
    b.classList.toggle('dark:bg-slate-700', activo);
    b.classList.toggle('text-marca-700', activo);
    b.classList.toggle('dark:text-marca-300', activo);
    b.classList.toggle('shadow-sm', activo);
    b.classList.toggle('text-slate-500', !activo);
  });
  if (nombre === 'resultados') renderTablero();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  try { location.hash = nombre; } catch (e) {}
}
$$('.tab-btn').forEach((b) => b.addEventListener('click', () => irAVista(b.dataset.vista)));

// Tema claro/oscuro
function aplicarTema(oscuro) {
  document.documentElement.classList.toggle('dark', oscuro);
  $('.icon-sol').classList.toggle('hidden', oscuro);
  $('.icon-luna').classList.toggle('hidden', !oscuro);
  try { localStorage.setItem('tema', oscuro ? 'oscuro' : 'claro'); } catch (e) {}
  // Redibujar gráficos con los nuevos colores.
  if ($('#vista-resultados').classList.contains('activa')) renderGraficos();
}
$('#btn-tema').addEventListener('click', () => aplicarTema(!document.documentElement.classList.contains('dark')));
(function initTema() {
  let pref;
  try { pref = localStorage.getItem('tema'); } catch (e) {}
  const oscuro = pref ? pref === 'oscuro' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  aplicarTema(oscuro);
})();

// Botón volver arriba
const btnArriba = $('#btn-arriba');
window.addEventListener('scroll', () => btnArriba.classList.toggle('hidden', window.scrollY < 400));
btnArriba.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

/* ===== 8. Formulario ===== */
const form = $('#form-encuesta');

// Resalta la opción seleccionada (chips) para radios y checkboxes.
function pintarOpciones() {
  $$('.opcion').forEach((lab) => {
    const input = lab.querySelector('input');
    if (input) lab.classList.toggle('sel', input.checked);
  });
}

// Lógica condicional (salto de preguntas del formulario original).
function actualizarCondicionales() {
  const r1 = (form.querySelector('input[name="riesgo1_tipo"]:checked') || {}).value;
  const r2 = (form.querySelector('input[name="riesgo2_tipo"]:checked') || {}).value;
  const r3 = (form.querySelector('input[name="riesgo3_tipo"]:checked') || {}).value;

  const mostrar1 = r1 && r1 !== 'sin_errores';
  const mostrar2 = r2 && r2 !== 'sin_conflicto';
  const mostrar3 = r3 && r3 !== 'no_afectado';

  $('#bloque-riesgo1').classList.toggle('hidden', !mostrar1);
  $('#bloque-riesgo2').classList.toggle('hidden', !mostrar2);
  $('#bloque-riesgo3').classList.toggle('hidden', !mostrar3);

  // Riesgos 4, 5 y 6 (cambio climático): el bloque se muestra si la respuesta es "sí".
  ['riesgo4_tipo', 'riesgo5_tipo', 'riesgo6_tipo'].forEach((name) => {
    const v = (form.querySelector(`input[name="${name}"]:checked`) || {}).value;
    $('#bloque-' + name.replace('_tipo', '')).classList.toggle('hidden', v !== 'si');
  });

  // Campo "Otro" del riesgo 3: habilitado solo si se elige "otro".
  const inputOtro = $('#f-r3-otro');
  inputOtro.disabled = r3 !== 'otro';
  if (r3 !== 'otro') inputOtro.value = '';
}

// Marca/limpia error en un contenedor de pregunta.
const marcarError = (cont, mostrar) => {
  const err = cont.querySelector('.err');
  if (err) err.classList.toggle('hidden', !mostrar);
};

function validar() {
  let ok = true;
  let primerError = null;
  const fallar = (cont) => { marcarError(cont, true); ok = false; if (!primerError) primerError = cont; };

  // Texto obligatorio
  const reqTexto = [['#f-nombre'], ['#f-unidad']];
  reqTexto.forEach(([sel]) => {
    const el = $(sel);
    const cont = el.closest('div');
    if (!el.value.trim()) fallar(cont); else marcarError(cont, false);
  });

  // Radios obligatorios (siempre): riesgo1-6 y corrupcion
  ['riesgo1_tipo', 'riesgo2_tipo', 'riesgo3_tipo', 'riesgo4_tipo', 'riesgo5_tipo', 'riesgo6_tipo', 'corrupcion_tipo'].forEach((name) => {
    const cont = form.querySelector(`[data-radios="${name}"]`).closest('fieldset');
    const marcado = form.querySelector(`input[name="${name}"]:checked`);
    if (!marcado) fallar(cont); else marcarError(cont, false);
  });

  // Condicionales riesgo 1
  if (!$('#bloque-riesgo1').classList.contains('hidden')) {
    const etapas = form.querySelectorAll('input[name="riesgo1_etapas"]:checked');
    const contEt = $('#bloque-riesgo1').querySelector('fieldset');
    if (etapas.length === 0) fallar(contEt); else marcarError(contEt, false);
    [['#f-r1-contrato'], ['#f-r1-accion']].forEach(([sel]) => {
      const el = $(sel); const cont = el.closest('.pregunta');
      if (!el.value.trim()) fallar(cont); else marcarError(cont, false);
    });
  }
  // Condicionales riesgo 2
  if (!$('#bloque-riesgo2').classList.contains('hidden')) {
    [['#f-r2-contrato'], ['#f-r2-accion']].forEach(([sel]) => {
      const el = $(sel); const cont = el.closest('.pregunta');
      if (!el.value.trim()) fallar(cont); else marcarError(cont, false);
    });
  }
  // Condicionales riesgo 3
  if (!$('#bloque-riesgo3').classList.contains('hidden')) {
    [['#f-r3-contrato'], ['#f-r3-accion']].forEach(([sel]) => {
      const el = $(sel); const cont = el.closest('.pregunta');
      if (!el.value.trim()) fallar(cont); else marcarError(cont, false);
    });
  }
  // "Otro" en riesgo 3
  const r3 = (form.querySelector('input[name="riesgo3_tipo"]:checked') || {}).value;
  if (r3 === 'otro' && !$('#f-r3-otro').value.trim()) {
    const cont = form.querySelector('[data-radios="riesgo3_tipo"]').closest('fieldset');
    fallar(cont);
  }

  // Condicionales riesgos 4, 5 y 6: si el bloque está visible, contrato y acción son obligatorios.
  ['riesgo4', 'riesgo5', 'riesgo6'].forEach((r) => {
    if (!$('#bloque-' + r).classList.contains('hidden')) {
      [`#f-${r.replace('riesgo', 'r')}-contrato`, `#f-${r.replace('riesgo', 'r')}-accion`].forEach((sel) => {
        const el = $(sel); const cont = el.closest('.pregunta');
        if (!el.value.trim()) fallar(cont); else marcarError(cont, false);
      });
    }
  });

  if (primerError) primerError.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return ok;
}

// Recolecta los datos del formulario en un objeto plano.
function recolectar() {
  const val = (sel) => ($(sel).value || '').trim();
  const radio = (name) => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || '';
  const etapas = $$('input[name="riesgo1_etapas"]:checked').map((c) => c.value);
  const r1 = radio('riesgo1_tipo');
  const r2 = radio('riesgo2_tipo');
  const r3 = radio('riesgo3_tipo');
  const r4 = radio('riesgo4_tipo');
  const r5 = radio('riesgo5_tipo');
  const r6 = radio('riesgo6_tipo');
  return {
    nombre: val('#f-nombre'),
    unidad: val('#f-unidad'),
    riesgo1_tipo: r1,
    riesgo1_etapas: r1 !== 'sin_errores' ? etapas : [],
    riesgo1_contrato: r1 !== 'sin_errores' ? val('#f-r1-contrato') : '',
    riesgo1_accion: r1 !== 'sin_errores' ? val('#f-r1-accion') : '',
    riesgo2_tipo: r2,
    riesgo2_contrato: r2 !== 'sin_conflicto' ? val('#f-r2-contrato') : '',
    riesgo2_accion: r2 !== 'sin_conflicto' ? val('#f-r2-accion') : '',
    riesgo3_tipo: r3,
    riesgo3_otro: r3 === 'otro' ? val('#f-r3-otro') : '',
    riesgo3_contrato: r3 !== 'no_afectado' ? val('#f-r3-contrato') : '',
    riesgo3_accion: r3 !== 'no_afectado' ? val('#f-r3-accion') : '',
    riesgo4_tipo: r4,
    riesgo4_contrato: r4 === 'si' ? val('#f-r4-contrato') : '',
    riesgo4_accion: r4 === 'si' ? val('#f-r4-accion') : '',
    riesgo5_tipo: r5,
    riesgo5_contrato: r5 === 'si' ? val('#f-r5-contrato') : '',
    riesgo5_accion: r5 === 'si' ? val('#f-r5-accion') : '',
    riesgo6_tipo: r6,
    riesgo6_contrato: r6 === 'si' ? val('#f-r6-contrato') : '',
    riesgo6_accion: r6 === 'si' ? val('#f-r6-accion') : '',
    corrupcion_tipo: radio('corrupcion_tipo'),
    observaciones: val('#f-observaciones')
  };
}

// Borrador en localStorage (formularios largos).
function guardarBorrador() {
  try {
    localStorage.setItem(BORRADOR_KEY, JSON.stringify(recolectar()));
    $('#aviso-borrador').textContent = 'Borrador guardado automáticamente.';
  } catch (e) {}
}
function restaurarBorrador() {
  let data;
  try { data = JSON.parse(localStorage.getItem(BORRADOR_KEY) || 'null'); } catch (e) { data = null; }
  if (!data) return;
  const setVal = (sel, v) => { const el = $(sel); if (el && v) el.value = v; };
  setVal('#f-nombre', data.nombre); setVal('#f-unidad', data.unidad);
  setVal('#f-r1-contrato', data.riesgo1_contrato); setVal('#f-r1-accion', data.riesgo1_accion);
  setVal('#f-r2-contrato', data.riesgo2_contrato); setVal('#f-r2-accion', data.riesgo2_accion);
  setVal('#f-r3-contrato', data.riesgo3_contrato); setVal('#f-r3-accion', data.riesgo3_accion);
  setVal('#f-r3-otro', data.riesgo3_otro); setVal('#f-observaciones', data.observaciones);
  setVal('#f-r4-contrato', data.riesgo4_contrato); setVal('#f-r4-accion', data.riesgo4_accion);
  setVal('#f-r5-contrato', data.riesgo5_contrato); setVal('#f-r5-accion', data.riesgo5_accion);
  setVal('#f-r6-contrato', data.riesgo6_contrato); setVal('#f-r6-accion', data.riesgo6_accion);
  const marcarRadio = (name, v) => { const el = form.querySelector(`input[name="${name}"][value="${v}"]`); if (el) el.checked = true; };
  if (data.riesgo1_tipo) marcarRadio('riesgo1_tipo', data.riesgo1_tipo);
  if (data.riesgo2_tipo) marcarRadio('riesgo2_tipo', data.riesgo2_tipo);
  if (data.riesgo3_tipo) marcarRadio('riesgo3_tipo', data.riesgo3_tipo);
  if (data.riesgo4_tipo) marcarRadio('riesgo4_tipo', data.riesgo4_tipo);
  if (data.riesgo5_tipo) marcarRadio('riesgo5_tipo', data.riesgo5_tipo);
  if (data.riesgo6_tipo) marcarRadio('riesgo6_tipo', data.riesgo6_tipo);
  if (data.corrupcion_tipo) marcarRadio('corrupcion_tipo', data.corrupcion_tipo);
  (data.riesgo1_etapas || []).forEach((v) => marcarRadio('riesgo1_etapas', v) === undefined && (function(){ const el = form.querySelector(`input[name="riesgo1_etapas"][value="${v}"]`); if (el) el.checked = true; })());
  actualizarCondicionales(); pintarOpciones();
  $('#aviso-borrador').textContent = 'Borrador restaurado.';
}
function limpiarBorrador() { try { localStorage.removeItem(BORRADOR_KEY); } catch (e) {} }

// Eventos del formulario
form.addEventListener('change', () => { actualizarCondicionales(); pintarOpciones(); guardarBorrador(); });
form.addEventListener('input', () => { guardarBorrador(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validar()) { toast('Revisa los campos obligatorios.', 'error'); return; }

  const btn = $('#btn-enviar');
  btn.disabled = true;
  const textoOrig = btn.querySelector('span').textContent;
  btn.querySelector('span').textContent = 'Enviando…';
  try {
    await window.DB.guardarRespuesta(recolectar());
    limpiarBorrador();
    form.reset();
    pintarOpciones();
    actualizarCondicionales();
    $('#form-encuesta').classList.add('hidden');
    $('#pantalla-exito').classList.remove('hidden');
    toast('¡Respuesta registrada!', 'ok');
  } catch (err) {
    console.error(err);
    toast('No se pudo guardar: ' + (err.code || err.message), 'error');
  } finally {
    btn.disabled = false;
    btn.querySelector('span').textContent = textoOrig;
  }
});

$('#btn-limpiar').addEventListener('click', () => {
  if (!confirm('¿Limpiar todo el formulario?')) return;
  form.reset(); limpiarBorrador(); pintarOpciones(); actualizarCondicionales();
  $('#aviso-borrador').textContent = '';
});
$('#btn-otra').addEventListener('click', () => {
  $('#pantalla-exito').classList.add('hidden');
  $('#form-encuesta').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('#btn-ver-resultados').addEventListener('click', () => {
  $('#pantalla-exito').classList.add('hidden');
  $('#form-encuesta').classList.remove('hidden');
  irAVista('resultados');
});

/* ===== 9. Tablero (agregaciones, KPIs, gráficos, tabla, exportación) ===== */
const colorTexto = () => document.documentElement.classList.contains('dark') ? '#cbd5e1' : '#475569';
const colorGrid  = () => document.documentElement.classList.contains('dark') ? 'rgba(148,163,184,.15)' : 'rgba(100,116,139,.15)';
const PALETA = ['#7fae2f', '#9cc84a', '#638a23', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6'];

// Cuenta ocurrencias de una clave (radios) sobre las respuestas.
function contarPor(campo) {
  const conteo = {};
  respuestas.forEach((r) => { const v = r[campo]; if (v) conteo[v] = (conteo[v] || 0) + 1; });
  return conteo;
}
// Cuenta etapas (selección múltiple).
function contarEtapas() {
  const conteo = {};
  respuestas.forEach((r) => (r.riesgo1_etapas || []).forEach((v) => { conteo[v] = (conteo[v] || 0) + 1; }));
  return conteo;
}

function iconoKPI(path) {
  return `<svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

function renderKPIs() {
  const total = respuestas.length;
  const unidades = new Set(respuestas.map((r) => (r.unidad || '').trim().toLowerCase()).filter(Boolean)).size;
  const conErr = respuestas.filter((r) => r.riesgo1_tipo && r.riesgo1_tipo !== 'sin_errores').length;
  const conCon = respuestas.filter((r) => r.riesgo2_tipo && r.riesgo2_tipo !== 'sin_conflicto').length;
  const conDes = respuestas.filter((r) => r.riesgo3_tipo && r.riesgo3_tipo !== 'no_afectado').length;
  const pct = (n) => total ? Math.round((n / total) * 100) : 0;

  const tarjetas = [
    { label: 'Respuestas', valor: total, extra: 'Total recibidas', color: 'from-marca-500 to-marca-700', icon: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>' },
    { label: 'Unidades', valor: unidades, extra: 'Participantes', color: 'from-sky-500 to-sky-700', icon: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/>' },
    { label: 'Con errores', valor: pct(conErr) + '%', extra: conErr + ' de ' + total, color: 'from-amber-500 to-amber-600', icon: '<path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/>' },
    { label: 'Con conflicto', valor: pct(conCon) + '%', extra: conCon + ' de ' + total, color: 'from-orange-500 to-orange-600', icon: '<path d="M7 8h10M7 12h6"/><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
    { label: 'Con desacierto', valor: pct(conDes) + '%', extra: conDes + ' de ' + total, color: 'from-rose-500 to-rose-600', icon: '<circle cx="12" cy="12" r="9"/><path d="m15 9-6 6M9 9l6 6"/>' }
  ];
  $('#kpis').innerHTML = tarjetas.map((t) => `
    <div class="tarjeta rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 shadow-sm anim-up">
      <div class="w-9 h-9 rounded-xl bg-gradient-to-br ${t.color} text-white grid place-items-center mb-3">${iconoKPI(t.icon)}</div>
      <div class="text-2xl font-extrabold leading-none">${escapar(t.valor)}</div>
      <div class="text-xs font-semibold text-slate-600 dark:text-slate-300 mt-1">${escapar(t.label)}</div>
      <div class="text-[11px] text-slate-400 mt-0.5">${escapar(t.extra)}</div>
    </div>`).join('');
}

function crearChart(id, config) {
  if (charts[id]) charts[id].destroy();
  const el = document.getElementById(id);
  if (!el) return;
  charts[id] = new Chart(el.getContext('2d'), config);
}

function baseOpciones(extra = {}) {
  return Object.assign({
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: colorTexto(), boxWidth: 12, font: { size: 11 } } },
      tooltip: { enabled: true }
    }
  }, extra);
}
function ejes() {
  return {
    x: { ticks: { color: colorTexto(), font: { size: 11 } }, grid: { color: colorGrid() } },
    y: { ticks: { color: colorTexto(), font: { size: 11 }, precision: 0 }, grid: { color: colorGrid() }, beginAtZero: true }
  };
}

function datosDe(campo, orden) {
  const conteo = contarPor(campo);
  const claves = orden || Object.keys(conteo);
  const labels = [], data = [];
  claves.forEach((k) => { if (conteo[k]) { labels.push(etiqueta(campo, k)); data.push(conteo[k]); } });
  return { labels, data };
}

function renderGraficos() {
  const total = respuestas.length;
  if (!total) return;

  // Resumen: riesgos materializados vs no.
  const matErr = respuestas.filter((r) => r.riesgo1_tipo && r.riesgo1_tipo !== 'sin_errores').length;
  const matCon = respuestas.filter((r) => r.riesgo2_tipo && r.riesgo2_tipo !== 'sin_conflicto').length;
  const matDes = respuestas.filter((r) => r.riesgo3_tipo && r.riesgo3_tipo !== 'no_afectado').length;
  const matObr = respuestas.filter((r) => r.riesgo4_tipo === 'si').length;
  const matMov = respuestas.filter((r) => r.riesgo5_tipo === 'si').length;
  const matAus = respuestas.filter((r) => r.riesgo6_tipo === 'si').length;
  const matCor = respuestas.filter((r) => r.corrupcion_tipo && r.corrupcion_tipo !== 'ninguna').length;
  const rep = [matErr, matCon, matDes, matObr, matMov, matAus, matCor];
  crearChart('chart-resumen', {
    type: 'bar',
    data: {
      labels: ['Errores', 'Conflicto', 'Desacierto', 'Obras extras', 'Movilidad', 'Ausentismo', 'Corrupción'],
      datasets: [
        { label: 'Reportado', data: rep, backgroundColor: '#7fae2f', borderRadius: 6 },
        { label: 'No reportado', data: rep.map((n) => total - n), backgroundColor: '#e2e8f0', borderRadius: 6 }
      ]
    },
    options: baseOpciones({ scales: { x: ejes().x, y: Object.assign(ejes().y, { stacked: true }) } })
  });
  // Stacked en X también
  charts['chart-resumen'].options.scales.x.stacked = true;
  charts['chart-resumen'].update();

  // Riesgo 1 tipo (doughnut)
  const d1 = datosDe('riesgo1_tipo', ['estimacion_recursos', 'imprecisiones', 'sin_errores']);
  crearChart('chart-r1', {
    type: 'doughnut',
    data: { labels: d1.labels, datasets: [{ data: d1.data, backgroundColor: PALETA, borderWidth: 0 }] },
    options: baseOpciones({ cutout: '58%' })
  });

  // Etapas (barra horizontal)
  const et = contarEtapas();
  const etOrden = ['analisis', 'factibilidad', 'estructuracion'];
  crearChart('chart-etapas', {
    type: 'bar',
    data: {
      labels: etOrden.map((k) => etiqueta('riesgo1_etapas', k)),
      datasets: [{ label: 'Menciones', data: etOrden.map((k) => et[k] || 0), backgroundColor: '#9cc84a', borderRadius: 6 }]
    },
    options: baseOpciones({ indexAxis: 'y', plugins: { legend: { display: false } }, scales: ejes() })
  });

  // Riesgo 2 tipo (doughnut)
  const d2 = datosDe('riesgo2_tipo', ['desconocimiento', 'insuficiente_comunicacion', 'sin_conflicto']);
  crearChart('chart-r2', {
    type: 'doughnut',
    data: { labels: d2.labels, datasets: [{ data: d2.data, backgroundColor: PALETA, borderWidth: 0 }] },
    options: baseOpciones({ cutout: '58%' })
  });

  // Riesgo 3 tipo (barra)
  const d3 = datosDe('riesgo3_tipo', ['administrativo', 'tecnico', 'juridico', 'no_afectado', 'otro']);
  crearChart('chart-r3', {
    type: 'bar',
    data: { labels: d3.labels, datasets: [{ label: 'Respuestas', data: d3.data, backgroundColor: '#638a23', borderRadius: 6 }] },
    options: baseOpciones({ plugins: { legend: { display: false } }, scales: ejes() })
  });

  // Corrupción (barra horizontal)
  const dc = datosDe('corrupcion_tipo', ['dadivas', 'estudios_previos', 'no_multas', 'informes_falsos', 'ninguna']);
  crearChart('chart-corrupcion', {
    type: 'bar',
    data: { labels: dc.labels, datasets: [{ label: 'Respuestas', data: dc.data, backgroundColor: '#ef4444', borderRadius: 6 }] },
    options: baseOpciones({ indexAxis: 'y', plugins: { legend: { display: false } }, scales: ejes() })
  });

  // Unidades (barra)
  const cu = {};
  respuestas.forEach((r) => { const u = (r.unidad || 'Sin unidad').trim() || 'Sin unidad'; cu[u] = (cu[u] || 0) + 1; });
  const unidadesOrden = Object.entries(cu).sort((a, b) => b[1] - a[1]).slice(0, 12);
  crearChart('chart-unidades', {
    type: 'bar',
    data: {
      labels: unidadesOrden.map(([k]) => k),
      datasets: [{ label: 'Respuestas', data: unidadesOrden.map(([, v]) => v), backgroundColor: '#0ea5e9', borderRadius: 6 }]
    },
    options: baseOpciones({ plugins: { legend: { display: false } }, scales: ejes() })
  });
}

// Píldora de estado para la tabla.
function pildora(texto, tono) {
  const tonos = {
    si: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
    no: 'bg-marca-100 text-marca-700 dark:bg-marca-900/40 dark:text-marca-300',
    neutro: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  };
  return `<span class="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${tonos[tono] || tonos.neutro}">${escapar(texto)}</span>`;
}

function renderTabla() {
  const tbody = $('#tbody-respuestas');
  const q = filtroTabla.trim().toLowerCase();
  const filtradas = respuestas.filter((r) => {
    if (!q) return true;
    return [r.nombre, r.unidad, r.riesgo1_contrato, r.riesgo1_accion, r.riesgo2_contrato,
            r.riesgo2_accion, r.riesgo3_contrato, r.riesgo3_accion, r.riesgo3_otro,
            r.riesgo4_contrato, r.riesgo4_accion, r.riesgo5_contrato, r.riesgo5_accion,
            r.riesgo6_contrato, r.riesgo6_accion, r.observaciones]
      .some((c) => (c || '').toLowerCase().includes(q));
  });
  $('#conteo-tabla').textContent = filtradas.length + (filtradas.length === 1 ? ' registro' : ' registros');

  if (!filtradas.length) {
    tbody.innerHTML = `<tr><td colspan="10" class="px-4 py-8 text-center text-slate-400">Sin coincidencias.</td></tr>`;
    return;
  }
  // Píldora Sí/No para los riesgos de tipo binario (4, 5 y 6).
  const pildoraSiNo = (v) => v === 'si' ? pildora('Sí', 'si') : (v === 'no' ? pildora('No', 'no') : pildora('—', 'neutro'));
  tbody.innerHTML = filtradas.map((r) => {
    const err = r.riesgo1_tipo === 'sin_errores' ? pildora('No', 'no') : pildora(etiqueta('riesgo1_tipo', r.riesgo1_tipo), 'si');
    const con = r.riesgo2_tipo === 'sin_conflicto' ? pildora('No', 'no') : pildora(etiqueta('riesgo2_tipo', r.riesgo2_tipo), 'si');
    const des = r.riesgo3_tipo === 'no_afectado' ? pildora('No', 'no') : pildora(etiqueta('riesgo3_tipo', r.riesgo3_tipo), 'si');
    const cor = r.corrupcion_tipo === 'ninguna' ? pildora('Ninguna', 'no') : pildora(etiqueta('corrupcion_tipo', r.corrupcion_tipo), 'si');
    return `<tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 align-top">
      <td class="px-4 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">${escapar(fmtFecha(r.creado || r.creadoISO))}</td>
      <td class="px-4 py-3 font-medium">${escapar(r.nombre || '—')}</td>
      <td class="px-4 py-3">${escapar(r.unidad || '—')}</td>
      <td class="px-4 py-3">${err}</td>
      <td class="px-4 py-3">${con}</td>
      <td class="px-4 py-3">${des}</td>
      <td class="px-4 py-3">${pildoraSiNo(r.riesgo4_tipo)}</td>
      <td class="px-4 py-3">${pildoraSiNo(r.riesgo5_tipo)}</td>
      <td class="px-4 py-3">${pildoraSiNo(r.riesgo6_tipo)}</td>
      <td class="px-4 py-3">${cor}</td>
    </tr>`;
  }).join('');
}

$('#buscar-tabla').addEventListener('input', (e) => { filtroTabla = e.target.value; renderTabla(); });

function renderTablero() {
  const hay = respuestas.length > 0;
  $('#vacio-resultados').classList.toggle('hidden', hay);
  $('#cont-resultados').classList.toggle('hidden', !hay);
  if (!hay) return;
  renderKPIs();
  renderGraficos();
  renderTabla();
}

// Exportación a Excel (con plan B a CSV).
function filasExport() {
  const siNo = (v) => v === 'si' ? 'Sí' : (v === 'no' ? 'No' : '');
  const cab = ['Fecha', 'Nombre', 'Unidad', 'Periodo',
    'R1 Tipo', 'R1 Etapas', 'R1 Contrato/Motivos', 'R1 Acción',
    'R2 Tipo', 'R2 Contrato/Actores', 'R2 Acción',
    'R3 Tipo', 'R3 Otro', 'R3 Contrato/Motivos', 'R3 Acción',
    'R4 Obras extras', 'R4 Contrato/Motivos', 'R4 Acción',
    'R5 Movilidad', 'R5 Contrato/Motivos', 'R5 Acción',
    'R6 Ausentismo', 'R6 Contrato/Motivos', 'R6 Acción',
    'Corrupción', 'Observaciones'];
  const filas = respuestas.map((r) => [
    fmtFecha(r.creado || r.creadoISO), r.nombre || '', r.unidad || '', r.periodo || '',
    etiqueta('riesgo1_tipo', r.riesgo1_tipo), (r.riesgo1_etapas || []).map((e) => etiqueta('riesgo1_etapas', e)).join('; '),
    r.riesgo1_contrato || '', r.riesgo1_accion || '',
    etiqueta('riesgo2_tipo', r.riesgo2_tipo), r.riesgo2_contrato || '', r.riesgo2_accion || '',
    etiqueta('riesgo3_tipo', r.riesgo3_tipo), r.riesgo3_otro || '', r.riesgo3_contrato || '', r.riesgo3_accion || '',
    siNo(r.riesgo4_tipo), r.riesgo4_contrato || '', r.riesgo4_accion || '',
    siNo(r.riesgo5_tipo), r.riesgo5_contrato || '', r.riesgo5_accion || '',
    siNo(r.riesgo6_tipo), r.riesgo6_contrato || '', r.riesgo6_accion || '',
    etiqueta('corrupcion_tipo', r.corrupcion_tipo), r.observaciones || ''
  ]);
  return { cab, filas };
}
function exportarCSV() {
  const { cab, filas } = filasExport();
  const esc = (c) => '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"';
  const csv = [cab, ...filas].map((f) => f.map(esc).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'respuestas-riesgos-obra-publica.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
$('#btn-exportar').addEventListener('click', () => {
  if (!respuestas.length) { toast('No hay datos para exportar.', 'info'); return; }
  try {
    if (typeof XLSX === 'undefined') throw new Error('XLSX no disponible');
    const { cab, filas } = filasExport();
    const ws = XLSX.utils.aoa_to_sheet([cab, ...filas]);
    ws['!cols'] = cab.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Respuestas');
    XLSX.writeFile(wb, 'respuestas-riesgos-obra-publica.xlsx');
    toast('Exportado a Excel.', 'ok');
  } catch (err) {
    console.warn('Fallo Excel, uso CSV:', err);
    exportarCSV();
    toast('Exportado a CSV.', 'ok');
  }
});

/* ===== Arranque ===== */
function arrancar() {
  // Vista inicial según hash
  const inicial = (location.hash || '').replace('#', '');
  irAVista(inicial === 'resultados' ? 'resultados' : 'encuesta');
  restaurarBorrador();
  pintarOpciones();
  actualizarCondicionales();

  // Escucha en tiempo real de las respuestas para el tablero.
  window.DB.escuchar((arr) => {
    respuestas = arr;
    if ($('#vista-resultados').classList.contains('activa')) renderTablero();
  });
}
arrancar();
